'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const {
  AccountPool,
  accountUserDataDir,
  isQuotaError,
  normalizeAccount
} = require('../src/account-pool.cjs');

const ROOT = '/tmp/versa-chrome-root';

test('each account gets a dedicated userDataDir under the managed root', () => {
  const account = normalizeAccount({ profileKey: 'Profile 2', profileName: 'Work Gemini' }, ROOT);
  assert.equal(account.userDataDir, join(ROOT, 'accounts', 'Profile-2'));
  assert.equal(accountUserDataDir(ROOT, { profileKey: 'Default' }), join(ROOT, 'accounts', 'Default'));
});

test('the active account keeps the live ChromeAutomationProfile until a dedicated dir is persisted', () => {
  const pool = AccountPool.fromRotation(
    [
      { profileKey: 'Default', profileName: 'Account A' },
      { profileKey: 'Profile 1', profileName: 'Account B' }
    ],
    { rootDir: ROOT, currentIndex: 0, enabled: true }
  );
  assert.equal(pool.current().userDataDir, ROOT);
  assert.equal(pool.accounts[1].userDataDir, join(ROOT, 'accounts', 'Profile-1'));
});

test('failover skips the rate-limited account and activates the next available profile', () => {
  const pool = AccountPool.fromRotation(
    [
      { profileKey: 'Default', profileName: 'Account A' },
      { profileKey: 'Profile 1', profileName: 'Account B' },
      { profileKey: 'Profile 2', profileName: 'Account C', enabled: false }
    ],
    { rootDir: ROOT, currentIndex: 0, enabled: true }
  );
  assert.equal(pool.canFailover(), true);
  pool.markRateLimited(60_000);
  const next = pool.nextAvailable();
  assert.equal(next.account.profileName, 'Account B');
  pool.activate(next.index);
  assert.equal(pool.current().profileKey, 'Profile 1');
  assert.equal(pool.nextAvailable(), null);
});

test('isQuotaError recognizes RATE_LIMIT, QUOTA_EXCEEDED, and quota copy', () => {
  assert.equal(isQuotaError({ code: 'RATE_LIMIT' }), true);
  assert.equal(isQuotaError({ code: 'QUOTA_EXCEEDED' }), true);
  assert.equal(isQuotaError(new Error('Quota exceeded for Gemini Pro')), true);
  assert.equal(isQuotaError(new Error('You have hit a usage cap')), true);
  assert.equal(isQuotaError(new Error('network timeout')), false);
});

test('fromRotation preserves persisted userDataDir and cooldown across UI resaves', () => {
  const previous = AccountPool.fromRotation(
    [
      { profileKey: 'Default', profileName: 'A' },
      { profileKey: 'Profile 1', profileName: 'B' }
    ],
    { rootDir: ROOT, currentIndex: 0, enabled: true }
  );
  previous.activate(1);
  previous.accounts[1].userDataDir = join(ROOT, 'accounts', 'Profile-1');
  previous.markRateLimited(120_000);
  const restored = AccountPool.fromRotation(
    [
      { profileKey: 'Default', profileName: 'A' },
      { profileKey: 'Profile 1', profileName: 'B' }
    ],
    { rootDir: ROOT, currentIndex: 1, enabled: true, previousAccounts: previous.accounts }
  );
  assert.equal(restored.current().userDataDir, join(ROOT, 'accounts', 'Profile-1'));
  assert.ok(restored.current().rateLimitedUntil > Date.now());
});
