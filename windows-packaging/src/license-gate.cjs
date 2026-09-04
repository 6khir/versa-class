'use strict';

const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_POLICY_URL = process.env.VERSA_LICENSE_URL
  || 'https://podnetwork.store/downloads/tpt-book-automation/versa-class-policy.json';
const REQUEST_TIMEOUT_MS = Number(process.env.VERSA_LICENSE_TIMEOUT_MS || 8000);
const WATCH_INTERVAL_MS = Number(process.env.VERSA_LICENSE_WATCH_MS || 15 * 60 * 1000);
const CACHE_FILE_NAME = 'versa-class-policy-cache.json';
const DEVICE_FILE_NAME = 'device_id.txt';

function parseVersion(value) {
  return String(value || '0')
    .split(/[.+-]/)
    .map((part) => Number.parseInt(part, 10) || 0);
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d > 0) return 1;
    if (d < 0) return -1;
  }
  return 0;
}

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter(Boolean);
}

function normalizePolicy(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: source.enabled !== false && source.disabled !== true && source.revoked !== true,
    latestVersion: String(source.latestVersion || source.latest_version || source.version || ''),
    minVersion: String(source.minVersion || source.min_version || '0.0.0'),
    downloadUrl: String(source.downloadUrl || source.download_url || source.url || ''),
    message: String(source.message || source.detail || ''),
    blockedVersions: asStringArray(source.blockedVersions || source.blocked_versions),
    revokedDeviceIds: asStringArray(source.revokedDeviceIds || source.revoked_devices),
    forceUpdate: Boolean(source.forceUpdate || source.force_update)
  };
}

function defaultAllowPolicy(currentVersion) {
  return normalizePolicy({
    enabled: true,
    latestVersion: currentVersion,
    minVersion: '0.0.0',
    downloadUrl: '',
    message: '',
    blockedVersions: [],
    revokedDeviceIds: [],
    forceUpdate: false
  });
}

function cachePath(userDataPath) {
  return path.join(userDataPath, CACHE_FILE_NAME);
}

function loadCachedPolicy(userDataPath) {
  try {
    if (!userDataPath) return null;
    const file = cachePath(userDataPath);
    if (!fs.existsSync(file)) return null;
    return normalizePolicy(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return null;
  }
}

function saveCachedPolicy(userDataPath, policy) {
  try {
    if (!userDataPath) return;
    fs.mkdirSync(userDataPath, { recursive: true });
    fs.writeFileSync(cachePath(userDataPath), JSON.stringify(policy), 'utf8');
  } catch {
    // Ignore cache write failures; the remote check still applies on the next launch.
  }
}

function getDeviceId(userDataPath) {
  try {
    if (userDataPath) {
      fs.mkdirSync(userDataPath, { recursive: true });
      const idFile = path.join(userDataPath, DEVICE_FILE_NAME);
      if (fs.existsSync(idFile)) {
        const stored = fs.readFileSync(idFile, 'utf8').trim();
        if (stored.length >= 10) return stored;
      }
      const created = `dev_${crypto.randomBytes(12).toString('hex')}`;
      fs.writeFileSync(idFile, created, 'utf8');
      return created;
    }
  } catch {
    // Fall through to an ephemeral id.
  }
  return `dev_${crypto.randomBytes(12).toString('hex')}`;
}

function fetchText(url, { fetcher, timeoutMs = REQUEST_TIMEOUT_MS, headers = {} } = {}) {
  if (typeof fetcher === 'function') {
    return Promise.resolve(fetcher(url)).then((result) => {
      if (result == null) throw new Error('Empty license response');
      return typeof result === 'string' ? result : JSON.stringify(result);
    });
  }

  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      reject(error);
      return;
    }

    const transport = parsed.protocol === 'http:' ? http : https;
    const request = transport.request(parsed, {
      method: 'GET',
      headers: {
        Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
        'User-Agent': `VERSA-CLASS/${process.env.npm_package_version || '0.1.0'}`,
        'Cache-Control': 'no-cache',
        ...headers
      },
      timeout: timeoutMs
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        fetchText(new URL(response.headers.location, parsed).toString(), { timeoutMs, headers })
          .then(resolve, reject);
        return;
      }

      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode && response.statusCode >= 400) {
          reject(new Error(`License endpoint HTTP ${response.statusCode}`));
          return;
        }
        resolve(body);
      });
    });

    request.on('timeout', () => {
      request.destroy();
      reject(new Error('License endpoint timed out'));
    });
    request.on('error', reject);
    request.end();
  });
}

async function fetchRemotePolicy(url, options = {}) {
  const body = await fetchText(url, options);
  const trimmed = String(body || '').trim();
  if (!trimmed) throw new Error('Empty license policy');
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return normalizePolicy(JSON.parse(trimmed));
  }
  throw new Error('License policy is not JSON');
}

function decide(policyInput, { currentVersion, deviceId } = {}) {
  const policy = normalizePolicy(policyInput);
  const version = String(currentVersion || '0.0.0');
  const id = String(deviceId || '');

  if (!policy.enabled) {
    return {
      allowed: false,
      reason: 'disabled',
      message: policy.message || 'This application has been disabled by the publisher.',
      policy
    };
  }

  if (id && policy.revokedDeviceIds.includes(id)) {
    return {
      allowed: false,
      reason: 'revoked',
      message: policy.message || 'This license has been revoked for this device.',
      policy
    };
  }

  if (policy.blockedVersions.includes(version)) {
    return {
      allowed: false,
      reason: 'blocked-version',
      message: policy.message || `Version ${version} is no longer allowed to run. Please install a supported release.`,
      policy
    };
  }

  if (policy.minVersion && compareVersions(version, policy.minVersion) < 0) {
    return {
      allowed: false,
      reason: 'below-min',
      updateAvailable: true,
      latestVersion: policy.latestVersion || policy.minVersion,
      downloadUrl: policy.downloadUrl,
      message: policy.message || `Version ${version} is no longer supported. Please install ${policy.minVersion} or newer.`,
      policy
    };
  }

  const updateAvailable = Boolean(policy.latestVersion)
    && compareVersions(version, policy.latestVersion) < 0;

  return {
    allowed: true,
    reason: updateAvailable ? 'update-available' : 'ok',
    updateAvailable,
    forceUpdate: Boolean(updateAvailable && policy.forceUpdate),
    latestVersion: policy.latestVersion || version,
    downloadUrl: policy.downloadUrl,
    message: policy.message,
    policy
  };
}

function showDialog(dialog, options) {
  if (!dialog) return 0;
  if (typeof dialog.showMessageBoxSync === 'function') {
    return dialog.showMessageBoxSync(options);
  }
  return 0;
}

async function openDownload(downloadUrl, { shell, dialog, title } = {}) {
  if (!downloadUrl) return false;
  try {
    if (shell && typeof shell.openExternal === 'function') {
      await shell.openExternal(downloadUrl);
      return true;
    }
  } catch (error) {
    showDialog(dialog, {
      type: 'error',
      title: title || 'VERSA CLASS',
      message: 'Unable to open the download page',
      detail: String(error.message || error),
      buttons: ['OK']
    });
  }
  return false;
}

async function resolvePolicy({ policyUrl = DEFAULT_POLICY_URL, userDataPath, currentVersion, fetcher } = {}) {
  try {
    const policy = await fetchRemotePolicy(policyUrl, { fetcher });
    saveCachedPolicy(userDataPath, policy);
    return { policy, source: 'remote' };
  } catch (error) {
    const cached = loadCachedPolicy(userDataPath);
    if (cached) return { policy: cached, source: 'cache', error };
    return { policy: defaultAllowPolicy(currentVersion), source: 'default', error };
  }
}

async function enforceRemotePolicy({
  app = null,
  dialog = null,
  shell = null,
  currentVersion,
  userDataPath,
  policyUrl = DEFAULT_POLICY_URL,
  fetcher,
  silentUpdate = false,
  logger = console
} = {}) {
  const version = String(currentVersion || app?.getVersion?.() || '0.0.0');
  const dataPath = userDataPath || app?.getPath?.('userData') || '';
  const deviceId = getDeviceId(dataPath);
  const { policy, source, error } = await resolvePolicy({
    policyUrl,
    userDataPath: dataPath,
    currentVersion: version,
    fetcher
  });

  if (error && source !== 'remote') {
    logger.warn?.(`[license-gate] Remote policy unavailable (${source}): ${error.message || error}`);
  }

  const decision = decide(policy, { currentVersion: version, deviceId });
  const title = 'VERSA CLASS';

  if (!decision.allowed) {
    const buttons = decision.downloadUrl ? ['Download update', 'Quit'] : ['Quit'];
    const choice = showDialog(dialog, {
      type: 'error',
      title,
      message: 'This copy of VERSA CLASS cannot continue',
      detail: decision.message,
      buttons,
      defaultId: 0,
      noLink: true
    });
    if (decision.downloadUrl && choice === 0) {
      await openDownload(decision.downloadUrl, { shell, dialog, title });
    }
    return false;
  }

  if (decision.updateAvailable && !silentUpdate) {
    const buttons = decision.forceUpdate
      ? ['Download update', 'Quit']
      : ['Download update', 'Later'];
    const choice = showDialog(dialog, {
      type: 'info',
      title,
      message: `Version ${decision.latestVersion} is available`,
      detail: decision.message || `A newer version of VERSA CLASS is ready. Your version is ${version}.`,
      buttons,
      defaultId: 0,
      cancelId: decision.forceUpdate ? 1 : 1,
      noLink: true
    });
    if (choice === 0) {
      await openDownload(decision.downloadUrl, { shell, dialog, title });
    }
    if (decision.forceUpdate) return false;
  }

  return true;
}

function startLicenseWatch(options = {}) {
  const intervalMs = Number(options.intervalMs || WATCH_INTERVAL_MS);
  const timer = setInterval(() => {
    enforceRemotePolicy({ ...options, silentUpdate: true })
      .then((allowed) => {
        if (!allowed) options.app?.exit?.(1);
      })
      .catch((error) => {
        options.logger?.warn?.('[license-gate] Watch check failed:', error.message || error);
      });
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = {
  DEFAULT_POLICY_URL,
  CACHE_FILE_NAME,
  compareVersions,
  decide,
  defaultAllowPolicy,
  enforceRemotePolicy,
  fetchRemotePolicy,
  getDeviceId,
  loadCachedPolicy,
  normalizePolicy,
  resolvePolicy,
  startLicenseWatch
};
