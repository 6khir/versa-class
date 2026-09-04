'use strict';

const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  compareVersions,
  decide,
  enforceRemotePolicy,
  getDeviceId,
  normalizePolicy
} = require('../src/license-gate.cjs');

test('compareVersions orders dotted versions', () => {
  assert.equal(compareVersions('0.1.0', '0.1.0'), 0);
  assert.equal(compareVersions('0.1.1', '0.1.0'), 1);
  assert.equal(compareVersions('0.2.0', '0.10.0'), -1);
  assert.equal(compareVersions('1.0.0', '0.9.9'), 1);
});

test('normalizePolicy treats disabled aliases as a kill-switch', () => {
  assert.equal(normalizePolicy({ enabled: false }).enabled, false);
  assert.equal(normalizePolicy({ disabled: true }).enabled, false);
  assert.equal(normalizePolicy({ revoked: true }).enabled, false);
  assert.equal(normalizePolicy({ enabled: true }).enabled, true);
});

test('decide blocks disabled, revoked, and blocked versions', () => {
  assert.equal(decide({ enabled: false }, { currentVersion: '0.1.0', deviceId: 'dev_1' }).allowed, false);
  assert.equal(decide({
    enabled: true,
    revokedDeviceIds: ['dev_abc']
  }, { currentVersion: '0.1.0', deviceId: 'dev_abc' }).reason, 'revoked');
  assert.equal(decide({
    enabled: true,
    blockedVersions: ['0.1.0']
  }, { currentVersion: '0.1.0', deviceId: 'dev_1' }).reason, 'blocked-version');
});

test('decide requires upgrades below minVersion and notifies when a newer build exists', () => {
  const blocked = decide({
    enabled: true,
    minVersion: '0.2.0',
    latestVersion: '0.2.1',
    downloadUrl: 'https://example.invalid/app.exe'
  }, { currentVersion: '0.1.0', deviceId: 'dev_1' });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, 'below-min');
  assert.equal(blocked.updateAvailable, true);

  const update = decide({
    enabled: true,
    minVersion: '0.1.0',
    latestVersion: '0.2.0',
    downloadUrl: 'https://example.invalid/app.exe'
  }, { currentVersion: '0.1.0', deviceId: 'dev_1' });
  assert.equal(update.allowed, true);
  assert.equal(update.updateAvailable, true);
  assert.equal(update.latestVersion, '0.2.0');
});

test('getDeviceId persists a stable identifier', () => {
  const dir = mkdtempSync(join(tmpdir(), 'versa-license-'));
  try {
    const first = getDeviceId(dir);
    const second = getDeviceId(dir);
    assert.equal(first, second);
    assert.match(first, /^dev_[a-f0-9]{24}$/);
    assert.equal(readFileSync(join(dir, 'device_id.txt'), 'utf8').trim(), first);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('enforceRemotePolicy quits when the remote kill-switch is on', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'versa-license-'));
  const prompts = [];
  try {
    const allowed = await enforceRemotePolicy({
      currentVersion: '0.1.0',
      userDataPath: dir,
      dialog: {
        showMessageBoxSync(options) {
          prompts.push(options);
          return 1;
        }
      },
      fetcher: async () => JSON.stringify({
        enabled: false,
        message: 'Publisher revoked this build.'
      })
    });
    assert.equal(allowed, false);
    assert.equal(prompts.length, 1);
    assert.match(prompts[0].detail, /revoked/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('enforceRemotePolicy caches a successful remote policy', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'versa-license-'));
  try {
    const allowed = await enforceRemotePolicy({
      currentVersion: '0.1.0',
      userDataPath: dir,
      silentUpdate: true,
      fetcher: async () => JSON.stringify({
        enabled: true,
        latestVersion: '0.1.0',
        minVersion: '0.1.0'
      })
    });
    assert.equal(allowed, true);
    const cached = JSON.parse(readFileSync(join(dir, 'versa-class-policy-cache.json'), 'utf8'));
    assert.equal(cached.enabled, true);
    assert.equal(cached.latestVersion, '0.1.0');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
