'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const {
  needsFirstRun,
  looksLikePackRoot,
  discoverRoot,
  ensurePackSlots,
  applyRoot,
  persistRoot,
  writePluginEnvPath,
  readPluginEnvPath
} = require('../src/book-management-root.cjs');

function tempDir(label) {
  return mkdtempSync(join(tmpdir(), label));
}

function memoryStore(start = {}) {
  const data = { ...start };
  return {
    getSetting(key, fallback = '') {
      return Object.hasOwn(data, key) ? data[key] : fallback;
    },
    setSetting(key, value) {
      data[key] = value;
    },
    data
  };
}

test('first-run is hidden when a root is already stored', () => {
  assert.equal(needsFirstRun(''), true);
  assert.equal(needsFirstRun('/Users/abdelmouiz/Downloads/My TPT WORK'), false);
  const store = memoryStore({ bookManagementRoot: '/tmp/already' });
  persistRoot(store, '/tmp/already');
  assert.equal(needsFirstRun(store.getSetting('bookManagementRoot')), false);
});

test('discover prefers a stored root and then existing P folders', () => {
  const pack = tempDir('versa-mgmt-pack-');
  try {
    mkdirSync(join(pack, 'P0007', 'Book'), { recursive: true });
    const store = memoryStore();
    assert.equal(discoverRoot({ store, home: tempDir('versa-mgmt-empty-'), env: {} }), '');
    const found = discoverRoot({
      store,
      home: tempDir('versa-mgmt-home-'),
      env: { VERSA_TPT_PATH: pack }
    });
    assert.equal(found, pack);
    assert.equal(store.getSetting('bookManagementRoot'), pack);
    assert.equal(looksLikePackRoot(pack), true);
  } finally {
    rmSync(pack, { recursive: true, force: true });
  }
});

test('new folders get empty P0001–P0005 codes without wiping existing books', () => {
  const pack = tempDir('versa-mgmt-slots-');
  try {
    mkdirSync(join(pack, 'P0001', 'Book'), { recursive: true });
    writeFileSync(join(pack, 'P0001', 'Book', 'keep.txt'), 'titled');
    const slots = ensurePackSlots(pack, { count: 5 });
    assert.equal(slots.count, 5);
    assert.equal(slots.first, 'P0001');
    assert.equal(slots.last, 'P0005');
    assert.equal(slots.created, 4);
    assert.equal(readFileSync(join(pack, 'P0001', 'Book', 'keep.txt'), 'utf8'), 'titled');
    assert.ok(existsSync(join(pack, 'P0005', 'SMM')));
  } finally {
    rmSync(pack, { recursive: true, force: true });
  }
});

test('choose-root stays ok when Flask set_root 404s', async () => {
  const { registerBookManagementIpc } = require('../src/book-management-ipc.cjs');
  const handlers = new Map();
  const pack = tempDir('versa-mgmt-choose-');
  const store = memoryStore();
  try {
    registerBookManagementIpc({
      ipcMain: { handle(name, fn) { handlers.set(name, fn); } },
      store,
      deps: {
        dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [pack] }) },
        applyRoot: (nextStore, rootPath) => {
          nextStore.setSetting('bookManagementRoot', rootPath);
          return { ok: true, rootPath, created: 0, count: 1000, first: 'P0001', last: 'P1000' };
        },
        ensureRunning: async () => ({ ok: true, url: 'http://127.0.0.1:5000' }),
        setPluginRoot: async () => {
          throw Object.assign(new Error('Versa Management request failed (404).'), {
            status: 404,
            code: 'MANAGEMENT_HTTP_ERROR'
          });
        }
      }
    });
    const result = await handlers.get('book-management:choose-root')();
    assert.equal(result.ok, true);
    assert.equal(result.rootPath, pack);
    assert.equal(store.getSetting('bookManagementRoot'), pack);
  } finally {
    rmSync(pack, { recursive: true, force: true });
  }
});

test('applyRoot persists and writes only VERSA_TPT_PATH in the plugin env', () => {
  const home = tempDir('versa-mgmt-env-');
  const pack = tempDir('versa-mgmt-apply-');
  try {
    writeFileSync(join(home, '.env'), 'VERSA_NOTION_TOKEN=keep-me\nVERSA_TPT_PATH=/old\n');
    const store = memoryStore();
    const result = applyRoot(store, pack, { home, count: 3 });
    assert.equal(result.ok, true);
    assert.equal(store.getSetting('bookManagementRoot'), pack);
    assert.equal(readPluginEnvPath(home), pack);
    assert.match(readFileSync(join(home, '.env'), 'utf8'), /VERSA_NOTION_TOKEN=keep-me/);
    writePluginEnvPath(home, pack);
    assert.equal(needsFirstRun(result.rootPath), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(pack, { recursive: true, force: true });
  }
});
