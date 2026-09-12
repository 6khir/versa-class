'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { classifyNoticeText } = require('../src/browser-controller.cjs');
const { AccountPool, isQuotaError } = require('../src/account-pool.cjs');

const ROOT = join(__dirname, '..');

function source(relativePath) {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

test('quota copy is classified as RATE_LIMIT so the interceptor can swap accounts', () => {
  const notice = classifyNoticeText('Quota exceeded. You have reached your quota.');
  assert.equal(notice?.code, 'RATE_LIMIT');
  assert.match(String(notice?.message || ''), /swap to the next saved profile/i);
});

test('AccountPool marks a capped account and activates the next saved profile', () => {
  const pool = new AccountPool({
    rootDir: '/tmp/versa-accounts',
    enabled: true,
    accounts: [
      { profileKey: 'School', email: 'a@school.edu' },
      { profileKey: 'Backup', email: 'b@school.edu' }
    ]
  });
  assert.equal(isQuotaError({ code: 'QUOTA_EXCEEDED' }), true);
  pool.markRateLimited(60_000);
  const next = pool.nextAvailable();
  assert.equal(next.account.profileKey, 'Backup');
  pool.activate(next.index);
  assert.equal(pool.current().profileKey, 'Backup');
});

test('queue retries the same page after a successful account swap instead of pausing', () => {
  const text = source('src/queue-engine.cjs');
  assert.match(text, /isQuotaError\(error\)/);
  assert.match(text, /switchToNextProfile\(\)/);
  assert.match(text, /status: 'retry_wait'/);
  assert.match(text, /conversationUrl: null/);
  assert.match(text, /return 'retry'/);
  assert.match(text, /#engineForJob/);
  assert.match(text, /cleanBlankMaster\(outputPath\)/);
});

test('main persists the account pool beside profile rotation', () => {
  const text = source('src/main.cjs');
  assert.match(text, /setAccountPool/);
  assert.match(text, /generateStitchedPreviewVideo/);
});
