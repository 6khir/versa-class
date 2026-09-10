'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { classifyNoticeText } = require('../src/browser-controller.cjs');

const ROOT = join(__dirname, '..');

function source(relativePath) {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

test('quota copy is classified as RATE_LIMIT so the interceptor can swap accounts', () => {
  const notice = classifyNoticeText('Quota exceeded. You have reached your quota.');
  assert.equal(notice?.code, 'RATE_LIMIT');
  assert.match(String(notice?.message || ''), /swap to the next saved profile/i);
});

test('prompt generation resumes the same missing page after a quota swap', () => {
  const text = source('src/browser-controller.cjs');
  assert.match(text, /async generatePromptsWithGpt/);
  assert.match(text, /#resumeAfterQuotaSwap\(`resuming prompts at page \$\{firstMissing\}`\)/);
  assert.match(text, /conversation = null;/);
  assert.match(text, /continue;/);
  assert.match(text, /this\.profileDir = account\.userDataDir/);
  assert.match(text, /new AccountPool\(/);
});

test('queue retries the same page after a successful account swap instead of pausing', () => {
  const text = source('src/queue-engine.cjs');
  assert.match(text, /isQuotaError\(error\)/);
  assert.match(text, /switchToNextProfile\(\)/);
  assert.match(text, /status: 'retry_wait'/);
  assert.match(text, /conversationUrl: null/);
  assert.match(text, /return 'retry'/);
  assert.match(text, /#engineForJob/);
});

test('login schema bump no longer disables auto-swap', () => {
  const text = source('src/main.cjs');
  assert.match(text, /LOGIN_SESSION_SCHEMA_VERSION = 5/);
  assert.doesNotMatch(text, /store\.setSetting\('enableProfileSwapping', false\)/);
  assert.match(text, /persistBrowserAccounts/);
  assert.match(text, /bindStageEngine/);
  assert.match(text, /requireStageEngine\('text'/);
});
