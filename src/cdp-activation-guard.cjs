'use strict';

const http = require('node:http');
const { dirname, join } = require('node:path');
const { ws, wsServer } = require(join(dirname(require.resolve('playwright-core')), 'lib/utilsBundle.js'));

const BLOCKED_WHEN_HIDDEN = new Set([
  'Page.bringToFront',
  'Target.activateTarget',
  'Browser.setDockTile'
]);

function shouldBlockCdpActivation(method, _params = {}, interactive = false, connecting = false) {
  if (interactive || connecting) return false;
  const name = String(method || '');
  if (BLOCKED_WHEN_HIDDEN.has(name)) return true;
  if (name === 'Browser.setWindowBounds') return true;
  return false;
}

class CdpActivationGuard {
  constructor() {
    this.interactive = false;
    this.connecting = false;
    this.chromePort = null;
    this.server = null;
    this.listenPort = null;
    this.wss = null;
  }

  setConnecting(value) {
    this.connecting = Boolean(value);
  }

  setInteractive(value) {
    this.interactive = Boolean(value);
  }

  async attach(chromePort) {
    this.chromePort = Number(chromePort);
    if (this.server && this.listenPort) return `http://127.0.0.1:${this.listenPort}`;
    this.server = http.createServer((req, res) => {
      this.#proxyHttp(req, res).catch((error) => {
        res.writeHead(502, { 'content-type': 'text/plain' });
        res.end(String(error.message || error));
      });
    });
    this.wss = new wsServer({ noServer: true });
    this.server.on('upgrade', (req, socket, head) => {
      this.wss.handleUpgrade(req, socket, head, (client) => this.#pipeSocket(req, client));
    });
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => {
        this.server.removeListener('error', reject);
        resolve();
      });
    });
    this.listenPort = this.server.address().port;
    return `http://127.0.0.1:${this.listenPort}`;
  }

  async #proxyHttp(req, res) {
    const incoming = await fetch(`http://127.0.0.1:${this.chromePort}${req.url}`, {
      signal: AbortSignal.timeout(8_000)
    });
    const text = await incoming.text();
    let body = text;
    try {
      body = JSON.stringify(this.#rewriteJson(JSON.parse(text)));
    } catch {
      body = this.#rewriteText(text);
    }
    res.writeHead(incoming.status, {
      'content-type': incoming.headers.get('content-type') || 'application/json'
    });
    res.end(body);
  }

  #rewriteJson(value) {
    if (Array.isArray(value)) return value.map((item) => this.#rewriteJson(item));
    if (value && typeof value === 'object') {
      const out = {};
      for (const [key, item] of Object.entries(value)) {
        if (typeof item === 'string' && /webSocketDebuggerUrl|devtoolsFrontendUrl/i.test(key)) {
          out[key] = item
            .replace(/127\.0\.0\.1:\d+|localhost:\d+|\[::1\]:\d+/gi, `127.0.0.1:${this.listenPort}`);
        } else {
          out[key] = this.#rewriteJson(item);
        }
      }
      return out;
    }
    return value;
  }

  #rewriteText(text) {
    return String(text)
      .replace(/ws:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+/gi, `ws://127.0.0.1:${this.listenPort}`)
      .replace(/http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+/gi, `http://127.0.0.1:${this.listenPort}`);
  }

  #pipeSocket(req, client) {
    const chrome = new ws(`ws://127.0.0.1:${this.chromePort}${req.url}`, { perMessageDeflate: false });
    const pending = [];
    const flush = () => {
      while (pending.length && chrome.readyState === ws.OPEN) chrome.send(pending.shift());
    };
    chrome.on('open', flush);
    client.on('message', (data) => {
      const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
      try {
        const parsed = JSON.parse(text);
        if (parsed?.method && shouldBlockCdpActivation(parsed.method, parsed.params, this.interactive, this.connecting)) {
          if (parsed.id != null && client.readyState === ws.OPEN) {
            client.send(JSON.stringify({ id: parsed.id, result: {} }));
          }
          return;
        }
      } catch {}
      if (chrome.readyState === ws.OPEN) chrome.send(data);
      else pending.push(data);
    });
    chrome.on('message', (data) => {
      if (client.readyState === ws.OPEN) client.send(data);
    });
    const closeBoth = () => {
      try { client.close(); } catch {}
      try { chrome.close(); } catch {}
    };
    client.on('close', closeBoth);
    chrome.on('close', closeBoth);
    chrome.on('error', closeBoth);
    client.on('error', closeBoth);
  }

  async close() {
    try { this.wss?.close(); } catch {}
    await new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
    });
    this.server = null;
    this.listenPort = null;
    this.wss = null;
  }
}

module.exports = { CdpActivationGuard, shouldBlockCdpActivation };
