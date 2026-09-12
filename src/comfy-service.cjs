'use strict';

/**
 * Lifecycle for the local ComfyUI instance used by Interior Text.
 *
 * Boot attaches a headless server on 127.0.0.1:8188 and keeps it resident for
 * the life of the Electron app. Text Lab never starts a second copy. The
 * managed process must not outlive the app — quit sends SIGTERM then SIGKILL
 * so no zombie Python is left on the M2.
 *
 * An instance the user started themselves is used as-is and is never adopted
 * for shutdown.
 */

const { spawn } = require('node:child_process');
const { createServer } = require('node:http');
const { existsSync, readdirSync, mkdirSync, openSync, closeSync, readFileSync } = require('node:fs');
const { execSync } = require('node:child_process');
const { dirname, join } = require('node:path');
const { homedir, userInfo } = require('node:os');

function userHome() {
  try {
    const fromPasswd = userInfo()?.homedir;
    if (fromPasswd) return fromPasswd;
  } catch { /* passwd lookup can fail in tests */ }
  return homedir();
}

function loadDotenvHome() {
  const candidates = [
    join(process.cwd(), '.env'),
    join(__dirname, '..', '.env')
  ];
  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue;
    try {
      const text = readFileSync(filePath, 'utf8');
      const match = text.match(/^\s*VERSA_COMFY_HOME\s*=\s*(.+)\s*$/m);
      if (!match) continue;
      const value = match[1].trim().replace(/^['"]|['"]$/g, '');
      if (value) return value;
    } catch { /* ignore unreadable dotenv */ }
  }
  return '';
}

const HOST = '127.0.0.1';
const PORT = 8188;
const BASE_URL = `http://${HOST}:${PORT}`;

function fixedSearchPaths() {
  const home = userHome();
  return [
    join(home, 'ComfyUI-Installs', 'VERSA CLASS', 'ComfyUI'),
    join(home, 'comfyui'),
    join(home, 'ComfyUI'),
    join(home, 'Documents', 'ComfyUI'),
    join(home, 'Desktop', 'ComfyUI'),
    join(home, 'Applications', 'ComfyUI'),
    '/Applications/ComfyUI',
    join(home, 'Library', 'Application Support', 'ComfyUI'),
  ];
}

const KEEPALIVE_MS = 15_000;
const STARTUP_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 2_000;
const KILL_GRACE_MS = 1_500;
const HOOK_PORT = Number(process.env.VERSA_COMFY_HOOK_PORT || 17881);
const HOOK_URL = process.env.VERSA_COMFY_HOOK || `http://127.0.0.1:${HOOK_PORT}/comfy/resuscitate`;

let managed = null;
let managedPid = null;
let hookServer = null;
let recovering = false;
let keepAliveTimer = null;
let quitHooksInstalled = false;
let starting = null;
const recoveryListeners = new Set();

function hookUrl() {
  return HOOK_URL;
}

function isRecovering() {
  return recovering;
}

function onRecovery(listener) {
  if (typeof listener === 'function') recoveryListeners.add(listener);
  return () => recoveryListeners.delete(listener);
}

function emitRecovery(event) {
  for (const listener of recoveryListeners) {
    try { listener(event); } catch { /* UI listeners must not take the engine down */ }
  }
}

function debugLog(location, message, data, hypothesisId) {
}

function logFilePath() {
  if (process.env.VERSA_COMFY_LOG) return process.env.VERSA_COMFY_LOG;
  if (process.platform === 'darwin') {
    return join(userHome(), 'Library', 'Logs', 'VERSA CLASS', 'comfyui.log');
  }
  return join(userHome(), '.versa-class', 'logs', 'comfyui.log');
}

function openLogFd() {
  const filePath = logFilePath();
  mkdirSync(dirname(filePath), { recursive: true });
  return openSync(filePath, 'a');
}

function scanInstallHomes() {
  const root = join(userHome(), 'ComfyUI-Installs');
  const homes = [];
  try {
    for (const name of readdirSync(root)) {
      homes.push(join(root, name, 'ComfyUI'));
      homes.push(join(root, name));
    }
  } catch { /* no ComfyUI-Installs folder */ }
  return homes;
}

function candidateHomes() {
  return [
    process.env.VERSA_COMFY_HOME,
    loadDotenvHome(),
    ...fixedSearchPaths(),
    ...scanInstallHomes()
  ].filter(Boolean);
}

function findHome() {
  const tried = candidateHomes();
  const home = tried.find((path) => existsSync(join(path, 'main.py'))) || null;
  if (home) process.env.VERSA_COMFY_HOME = home;
  return home;
}

function startKeepAlive() {
  if (keepAliveTimer) return keepAliveTimer;
  keepAliveTimer = setInterval(() => {
    if (recovering || starting) return;
    ping().then((up) => {
      if (!up) ensureRunning().catch(() => {});
    }).catch(() => {});
  }, KEEPALIVE_MS);
  keepAliveTimer.unref();
  return keepAliveTimer;
}

function stopKeepAlive() {
  if (!keepAliveTimer) return;
  clearInterval(keepAliveTimer);
  keepAliveTimer = null;
}

/** Find the checkout, launch if needed, and keep the process resident while the app lives. */
async function connectForever({ timeoutMs = STARTUP_TIMEOUT_MS } = {}) {
  startWatchdogServer();
  installQuitHooks();
  startKeepAlive();
  return ensureRunning({ timeoutMs });
}

/** True when ComfyUI answers /system_stats with HTTP 200. */
async function ping({ timeoutMs = 3_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${BASE_URL}/system_stats`, { signal: controller.signal });
    return Number(response.status) === 200 || response.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForReady(timeoutMs = STARTUP_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await ping({ timeoutMs: POLL_INTERVAL_MS })) return true;
    if (managedPid && !processAlive(managedPid)) return false;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return false;
}

function processAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function startWatchdogServer() {
  if (hookServer) return hookServer;
  hookServer = createServer(async (req, res) => {
    if (req.method !== 'POST' || !String(req.url || '').startsWith('/comfy/resuscitate')) {
      res.statusCode = 404;
      res.end(JSON.stringify({ ok: false, code: 'NOT_FOUND' }));
      return;
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    let payload = {};
    try { payload = body ? JSON.parse(body) : {}; } catch { payload = { raw: body }; }
    debugLog('comfy-service.cjs:hook', 'watchdog resuscitation requested', { reason: String(payload.reason || '').slice(0, 180) }, 'H1');
    const result = await brutalRestart(payload);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(result));
  });
  hookServer.on('error', () => { hookServer = null; });
  hookServer.listen(HOOK_PORT, '127.0.0.1');
  hookServer.unref();
  return hookServer;
}

function killPid(pid, signal) {
  if (!pid) return;
  try { process.kill(-pid, signal); } catch {
    try { process.kill(pid, signal); } catch { /* already gone */ }
  }
}

function killManagedImmediate() {
  const pid = managedPid || managed?.pid;
  managed = null;
  managedPid = null;
  if (pid) killPid(pid, 'SIGKILL');
}

function killPortHolders() {
  try {
    execSync(`lsof -ti tcp:${PORT} | xargs kill -9`, { stdio: 'ignore' });
  } catch { /* nothing listening, or already gone */ }
}

async function brutalRestart(payload = {}) {
  recovering = true;
  emitRecovery({
    state: 'restarting',
    recovering: true,
    message: 'Restarting engine',
    reason: payload.reason || 'ComfyUI watchdog'
  });
  debugLog('comfy-service.cjs:brutalRestart', 'brutal Comfy restart', { reason: payload.reason || null }, 'H1');
  await shutdown({ force: true });
  killPortHolders();
  const result = await ensureRunning();
  recovering = false;
  emitRecovery({
    state: result.ok ? 'ready' : 'failed',
    recovering: false,
    message: result.ok ? 'Engine recovered' : (result.error || 'Engine failed to recover'),
    reason: payload.reason || 'ComfyUI watchdog'
  });
  return { ...result, recovered: Boolean(result.ok) };
}

function spawnHeadless(home) {
  const python = existsSync(join(home, '.venv', 'bin', 'python'))
    ? join(home, '.venv', 'bin', 'python')
    : 'python3';
  const logFd = openLogFd();
  const child = spawn(python, [
    'main.py',
    '--listen', HOST,
    '--port', String(PORT),
    '--disable-auto-launch'
  ], {
    cwd: home,
    env: { ...process.env, PYTHONUNBUFFERED: '1', VERSA_COMFY_HOME: home },
    detached: true,
    stdio: ['ignore', logFd, logFd]
  });
  try { closeSync(logFd); } catch { /* child holds the fd */ }
  child.unref();
  child.once('exit', () => {
    if (managedPid === child.pid) {
      managed = null;
      managedPid = null;
    }
  });
  managed = child;
  managedPid = child.pid;
  debugLog('comfy-service.cjs:spawn', 'spawned headless ComfyUI', { pid: child.pid, home, log: logFilePath() }, 'H1');
  return child;
}

function timeoutError(timeoutMs) {
  return Object.assign(
    new Error(`ComfyUI did not answer ${BASE_URL}/system_stats with HTTP 200 within ${Math.round(timeoutMs / 1000)}s.`),
    { code: 'COMFY_TIMEOUT', ok: false }
  );
}

/**
 * Health-check, and launch headless if nothing answers.
 * Resolves only after /system_stats returns 200. Throws COMFY_TIMEOUT after
 * killing the spawned process. Missing installs return a status object.
 */
async function ensureRunning({ timeoutMs = STARTUP_TIMEOUT_MS } = {}) {
  startWatchdogServer();
  installQuitHooks();
  startKeepAlive();
  if (await ping()) {
    return { ok: true, running: true, managed: Boolean(managedPid), url: BASE_URL, home: findHome(), recovering };
  }
  if (starting) return starting;

  starting = (async () => {
    if (managedPid && processAlive(managedPid)) {
      if (await waitForReady(timeoutMs)) {
        return { ok: true, running: true, managed: true, pid: managedPid, url: BASE_URL, home: findHome(), recovering };
      }
      killManagedImmediate();
      throw timeoutError(timeoutMs);
    }

    const home = findHome();
    if (!home) {
      return {
        ok: false,
        code: 'COMFY_NOT_INSTALLED',
        error: 'ComfyUI was not found. Set VERSA_COMFY_HOME to the checkout containing main.py.',
      };
    }

    const child = spawnHeadless(home);
    if (await waitForReady(timeoutMs)) {
      return { ok: true, running: true, managed: true, pid: child.pid, url: BASE_URL, home, recovering };
    }
    if (!processAlive(child.pid)) {
      killManagedImmediate();
      return {
        ok: false,
        code: 'COMFY_EXITED',
        error: `ComfyUI exited during startup. See ${logFilePath()}.`,
      };
    }
    killManagedImmediate();
    throw timeoutError(timeoutMs);
  })().finally(() => { starting = null; });

  return starting;
}

async function shutdown({ force = false } = {}) {
  const pid = managedPid || managed?.pid;
  if (!pid && !force) return false;
  stopKeepAlive();
  if (pid) {
    killPid(pid, 'SIGTERM');
    const deadline = Date.now() + KILL_GRACE_MS;
    while (Date.now() < deadline && processAlive(pid)) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    if (processAlive(pid)) killPid(pid, 'SIGKILL');
  }
  managed = null;
  managedPid = null;
  return Boolean(pid);
}

function shutdownSync() {
  stopKeepAlive();
  killManagedImmediate();
  return true;
}

function installQuitHooks() {
  if (quitHooksInstalled) return;
  quitHooksInstalled = true;
  const die = () => { shutdownSync(); };
  process.once('exit', die);
  process.once('SIGINT', die);
  process.once('SIGTERM', die);
}

async function availableNodes() {
  try {
    const response = await fetch(`${BASE_URL}/api/object_info`);
    if (!response.ok) return [];
    return Object.keys(await response.json());
  } catch {
    return [];
  }
}

async function hasFontNodes() {
  return (await availableNodes()).some((name) => /font|glyph|typeface/i.test(name));
}

async function status() {
  const running = await ping();
  return {
    url: BASE_URL,
    running,
    managed: Boolean(managedPid),
    pid: managedPid,
    home: findHome(),
    logFile: logFilePath(),
    fontNodes: running ? await hasFontNodes() : false,
    recovering,
    hookUrl: HOOK_URL,
  };
}

module.exports = {
  ensureRunning,
  connectForever,
  shutdown,
  shutdownSync,
  installQuitHooks,
  ping,
  status,
  availableNodes,
  hasFontNodes,
  findHome,
  brutalRestart,
  startWatchdogServer,
  startKeepAlive,
  onRecovery,
  isRecovering,
  hookUrl,
  logFilePath,
  HOST,
  PORT,
  BASE_URL,
  HOOK_URL,
  STARTUP_TIMEOUT_MS,
  POLL_INTERVAL_MS
};
