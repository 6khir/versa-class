const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

const STATS_ENDPOINT = 'https://podnetwork.store/downloads/tpt-book-automation/stats.php';

class TelemetryService {
  constructor({ userDataPath, appVersion, enabled = true, logger = console, endpoint = STATS_ENDPOINT }) {
    this.userDataPath = userDataPath;
    this.appVersion = appVersion || '0.3.8';
    this.enabled = Boolean(enabled);
    this.logger = logger;
    this.endpoint = endpoint;
    this.deviceId = null;
    this.os = process.platform === 'darwin' ? 'mac' : 'win';
  }

  getDeviceId() {
    if (this.deviceId) return this.deviceId;
    try {
      if (this.userDataPath && fs.existsSync(this.userDataPath)) {
        const idFile = path.join(this.userDataPath, 'device_id.txt');
        if (fs.existsSync(idFile)) {
          const stored = fs.readFileSync(idFile, 'utf8').trim();
          if (stored.length >= 10) {
            this.deviceId = stored;
            return this.deviceId;
          }
        }
        const newId = 'dev_' + crypto.randomBytes(12).toString('hex');
        fs.writeFileSync(idFile, newId, 'utf8');
        this.deviceId = newId;
        return this.deviceId;
      }
    } catch (err) {
      this.logger.error?.('Failed persisting telemetry device ID:', err);
    }
    this.deviceId = 'dev_' + crypto.randomBytes(12).toString('hex');
    return this.deviceId;
  }

  sendRequest(payload) {
    if (!this.enabled) return Promise.resolve({ skipped: true });
    return new Promise((resolve) => {
      try {
        const data = JSON.stringify({
          device_id: this.getDeviceId(),
          os: this.os,
          version: this.appVersion,
          ...payload
        });

        const url = new URL(this.endpoint);
        const protocol = url.protocol === 'https:' ? https : http;

        const req = protocol.request(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data)
          },
          timeout: 8000
        }, (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => {
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              resolve({ success: res.statusCode === 200, raw: body });
            }
          });
        });

        req.on('error', (err) => {
          this.logger.warn?.('Telemetry request warning:', err.message);
          resolve({ error: err.message });
        });

        req.on('timeout', () => {
          req.destroy();
          resolve({ timeout: true });
        });

        req.write(data);
        req.end();
      } catch (err) {
        this.logger.warn?.('Telemetry payload send failed:', err.message);
        resolve({ error: err.message });
      }
    });
  }

  sendPing() {
    return this.sendRequest({ action: 'ping' });
  }

  reportBookCompleted() {
    return this.sendRequest({ action: 'event', type: 'book_completed' });
  }

  reportAdViewed() {
    return this.sendRequest({ action: 'event', type: 'ad_viewed' });
  }
}

module.exports = {
  TelemetryService,
  STATS_ENDPOINT
};
