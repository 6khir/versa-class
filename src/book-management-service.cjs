'use strict';

/**
 * Lifecycle for the isolated Versa Book Management Flask plugin.
 * Mirrors Comfy: reuse an already-running localhost server, otherwise spawn
 * their app.py and kill only the process this module started.
 */

const { spawn, execFileSync } = require('node:child_process');
const { existsSync, mkdirSync, openSync, closeSync } = require('node:fs');
const { dirname, join } = require('node:path');
const { homedir } = require('node:os');

const HOST = '127.0.0.1';
const PORT = Number(process.env.VERSA_BOOK_MGMT_PORT || 5000);
const BASE_URL = process.env.VERSA_BOOK_MGMT_URL || `http://${HOST}:${PORT}`;
const STARTUP_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 250;
const KILL_GRACE_MS = 1_500;

let managed = null;
let managedPid = null;
let starting = null;
let quitHooksInstalled = false;

function bundledServiceDir() {
  const packed = join(__dirname, '..', 'services', 'versa-book-management');
  if (packed.includes('app.asar')) {
    const unpacked = packed.replace('app.asar', 'app.asar.unpacked');
    if (existsSync(join(unpacked, 'app.py'))) return unpacked;
  }
  return packed;
}

function serviceDir(override) {
  return override || process.env.VERSA_BOOK_MGMT_HOME || bundledServiceDir();
}

function logFilePath() {
  if (process.env.VERSA_BOOK_MGMT_LOG) return process.env.VERSA_BOOK_MGMT_LOG;
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Logs', 'VERSA CLASS', 'book-management.log');
  }
  return join(homedir(), '.versa-class', 'logs', 'book-management.log');
}

function pythonHasFlask(python) {
  try {
    execFileSync(python, ['-c', 'import flask, requests'], { stdio: 'ignore', timeout: 8_000 });
    return true;
  } catch {
    return false;
  }
}

function resolvePython(home = serviceDir()) {
  const venv = join(home, '.venv', 'bin', 'python');
  if (existsSync(venv) && pythonHasFlask(venv)) return venv;
  const system = process.env.VERSA_PYTHON || 'python3';
  if (pythonHasFlask(system)) return system;
  if (existsSync(venv)) return venv;
  return system;
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

async function ping({ timeoutMs = 2_000, fetchImpl = fetch, baseUrl = BASE_URL } = {}) {
  const root = String(baseUrl).replace(/\/$/, '');
  for (const path of ['/api/integration/health', '/']) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${root}${path}`, { signal: controller.signal });
      if (Number(response.status) === 200 || response.ok === true) return true;
    } catch {
      /* try the next probe */
    } finally {
      clearTimeout(timer);
    }
  }
  return false;
}

async function waitForReady({ timeoutMs = STARTUP_TIMEOUT_MS, fetchImpl = fetch, baseUrl = BASE_URL } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await ping({ timeoutMs: POLL_INTERVAL_MS, fetchImpl, baseUrl })) return true;
    if (managedPid && !processAlive(managedPid)) return false;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return false;
}

function spawnService({
  home = serviceDir(),
  spawnFn = spawn,
  python = resolvePython(home),
  tptPath = ''
} = {}) {
  const logPath = logFilePath();
  mkdirSync(dirname(logPath), { recursive: true });
  const logFd = openSync(logPath, 'a');
  const child = spawnFn(python, ['app.py'], {
    cwd: home,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      VERSA_BOOK_MGMT_DEBUG: '0',
      VERSA_BOOK_MGMT_PORT: String(PORT),
      ...(tptPath ? { VERSA_TPT_PATH: String(tptPath) } : {})
    },
    detached: true,
    stdio: ['ignore', logFd, logFd]
  });
  try { closeSync(logFd); } catch { /* child holds the fd */ }
  child.unref?.();
  child.once?.('exit', () => {
    if (managedPid === child.pid) {
      managed = null;
      managedPid = null;
    }
  });
  managed = child;
  managedPid = child.pid;
  return child;
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

async function ensureRunning({
  timeoutMs = STARTUP_TIMEOUT_MS,
  fetchImpl = fetch,
  spawnFn = spawn,
  home = serviceDir(),
  tptPath = ''
} = {}) {
  installQuitHooks();
  if (await ping({ fetchImpl })) {
    return { ok: true, running: true, managed: Boolean(managedPid), url: BASE_URL, home };
  }
  if (starting) return starting;

  starting = (async () => {
    if (!existsSync(join(home, 'app.py'))) {
      return {
        ok: false,
        running: false,
        code: 'MANAGEMENT_NOT_INSTALLED',
        error: 'Versa Book Management is missing from services/versa-book-management.'
      };
    }
    const python = resolvePython(home);
    if (!pythonHasFlask(python)) {
      return {
        ok: false,
        running: false,
        code: 'MANAGEMENT_PYTHON_MISSING',
        error: 'Install Flask for this plugin: pip3 install -r services/versa-book-management/requirements.txt'
      };
    }
    if (managedPid && processAlive(managedPid)) {
      if (await waitForReady({ timeoutMs, fetchImpl })) {
        return { ok: true, running: true, managed: true, pid: managedPid, url: BASE_URL, home };
      }
    }
    const child = spawnService({ home, spawnFn, python, tptPath });
    if (await waitForReady({ timeoutMs, fetchImpl })) {
      return { ok: true, running: true, managed: true, pid: child.pid, url: BASE_URL, home };
    }
    killManagedImmediate();
    return {
      ok: false,
      running: false,
      code: 'MANAGEMENT_TIMEOUT',
      error: `Versa Management did not start on ${BASE_URL}. Open Versa Management again, or check ${logFilePath()}.`
    };
  })().finally(() => { starting = null; });

  return starting;
}

async function shutdown({ force = false } = {}) {
  const pid = managedPid || managed?.pid;
  if (!pid && !force) return false;
  if (pid) {
    killPid(pid, 'SIGTERM');
    const deadline = Date.now() + KILL_GRACE_MS;
    while (Date.now() < deadline && processAlive(pid)) {
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    if (processAlive(pid)) killPid(pid, 'SIGKILL');
  }
  managed = null;
  managedPid = null;
  return Boolean(pid);
}

function shutdownSync() {
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

function status() {
  return {
    url: BASE_URL,
    running: false,
    managed: Boolean(managedPid),
    pid: managedPid,
    home: serviceDir(),
    logFile: logFilePath()
  };
}

module.exports = {
  HOST,
  PORT,
  BASE_URL,
  STARTUP_TIMEOUT_MS,
  serviceDir,
  resolvePython,
  ping,
  ensureRunning,
  shutdown,
  shutdownSync,
  installQuitHooks,
  status,
  logFilePath
};
