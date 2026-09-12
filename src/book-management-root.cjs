'use strict';

const {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync
} = require('node:fs');
const { join } = require('node:path');

const SLOT_COUNT = 1000;
const SLOT_NAME = /^P\d{3,4}$/;

function packSlotName(num) {
  return `P${String(Number(num)).padStart(4, '0')}`;
}

function needsFirstRun(rootPath) {
  return !String(rootPath || '').trim();
}

function isDirectory(filePath) {
  try {
    return Boolean(filePath) && existsSync(filePath) && statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function looksLikePackRoot(dir) {
  if (!isDirectory(dir)) return false;
  try {
    return readdirSync(dir).some((name) => {
      if (!SLOT_NAME.test(name)) return false;
      try {
        return statSync(join(dir, name)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

function readDotEnv(filePath) {
  const out = {};
  if (!filePath || !existsSync(filePath)) return out;
  try {
    for (const raw of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const index = line.indexOf('=');
      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key) out[key] = value;
    }
  } catch {
    /* ignore unreadable env */
  }
  return out;
}

function readConfigDefault(home) {
  const file = join(home || '', 'config.py');
  if (!existsSync(file)) return '';
  try {
    const text = readFileSync(file, 'utf8');
    const match = text.match(/BASE_TPT_PATH\s*=\s*os\.environ\.get\(\s*['"]VERSA_TPT_PATH['"]\s*,\s*['"]([^'"]*)['"]\s*\)/);
    return String(match?.[1] || '').trim();
  } catch {
    return '';
  }
}

function pluginEnvPath(home) {
  return home ? join(home, '.env') : '';
}

function readPluginEnvPath(home) {
  return String(readDotEnv(pluginEnvPath(home)).VERSA_TPT_PATH || '').trim();
}

function writePluginEnvPath(home, rootPath) {
  const file = pluginEnvPath(home);
  if (!file || !rootPath) return false;
  let lines = [];
  if (existsSync(file)) {
    lines = readFileSync(file, 'utf8').split(/\r?\n/);
  }
  let replaced = false;
  const next = lines.map((line) => {
    if (!/^\s*VERSA_TPT_PATH\s*=/.test(line)) return line;
    replaced = true;
    return `VERSA_TPT_PATH=${rootPath}`;
  });
  if (!replaced) next.push(`VERSA_TPT_PATH=${rootPath}`);
  writeFileSync(file, `${next.filter((line, index) => !(index === next.length - 1 && line === '')).join('\n')}\n`);
  return true;
}

function persistRoot(store, rootPath) {
  const path = String(rootPath || '').trim();
  if (!path || typeof store?.setSetting !== 'function') return path;
  store.setSetting('bookManagementRoot', path);
  return path;
}

function readStoredRoot(store) {
  if (typeof store?.getSetting !== 'function') return '';
  return String(store.getSetting('bookManagementRoot', '') || '').trim();
}

function discoverRoot({
  store,
  home = '',
  env = process.env
} = {}) {
  const stored = readStoredRoot(store);
  if (isDirectory(stored)) return persistRoot(store, stored);

  const candidates = [
    String(env?.VERSA_TPT_PATH || '').trim(),
    readPluginEnvPath(home),
    readConfigDefault(home)
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (looksLikePackRoot(candidate) || isDirectory(candidate)) {
      return persistRoot(store, candidate);
    }
  }
  return '';
}

function ensurePackSlots(rootPath, { count = SLOT_COUNT } = {}) {
  const root = String(rootPath || '').trim();
  if (!root) {
    throw Object.assign(new Error('Choose a book-management root first.'), { code: 'MANAGEMENT_ROOT_REQUIRED' });
  }
  const total = Math.max(1, Math.min(Number(count) || SLOT_COUNT, SLOT_COUNT));
  mkdirSync(root, { recursive: true });
  let created = 0;
  for (let index = 1; index <= total; index += 1) {
    const name = packSlotName(index);
    const fullPath = join(root, name);
    const existed = isDirectory(fullPath);
    mkdirSync(join(fullPath, 'Book'), { recursive: true });
    mkdirSync(join(fullPath, 'SMM'), { recursive: true });
    if (!existed) created += 1;
  }
  return {
    root_path: root,
    rootPath: root,
    count: total,
    created,
    first: packSlotName(1),
    last: packSlotName(total)
  };
}

function applyRoot(store, rootPath, { home = '', count = SLOT_COUNT, bootstrap = true } = {}) {
  const path = persistRoot(store, rootPath);
  if (home) {
    try { writePluginEnvPath(home, path); } catch { /* store is enough */ }
  }
  const slots = bootstrap
    ? ensurePackSlots(path, { count })
    : {
      root_path: path,
      rootPath: path,
      count: 0,
      created: 0,
      first: packSlotName(1),
      last: packSlotName(count)
    };
  return { ok: true, rootPath: path, ...slots };
}

module.exports = {
  SLOT_COUNT,
  packSlotName,
  needsFirstRun,
  isDirectory,
  looksLikePackRoot,
  readDotEnv,
  readConfigDefault,
  readPluginEnvPath,
  writePluginEnvPath,
  persistRoot,
  readStoredRoot,
  discoverRoot,
  ensurePackSlots,
  applyRoot
};
