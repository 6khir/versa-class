'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { BrowserController } = require('../src/browser-controller.cjs');
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'browser-controller.cjs'), 'utf8');

// A crashed Chrome leaves its profile lock behind, so the next launch believes an
// instance is running and connects to a corpse. That is how one dead browser became six
// stacked connectOverCDP failures in a single message.

test('a dead browser is recognised from what Playwright actually reports', () => {
  const dead = [
    'browserType.connectOverCDP: Target page, context or browser has been closed',
    'Target closed',
    'connect ECONNREFUSED 127.0.0.1:9335',
    'WebSocket error: socket hang up'
  ];
  for (const message of dead) {
    assert.equal(BrowserController.isDeadBrowserError(new Error(message)), true, message);
  }
  // Ordinary failures must not trigger a browser teardown.
  for (const message of ['This ChatGPT account reached its usage limit', 'No preview video appeared']) {
    assert.equal(BrowserController.isDeadBrowserError(new Error(message)), false, message);
  }
});

test('recovery kills the owner, clears the lock, and waits before relaunching', () => {
  const start = source.indexOf('async #recoverManagedBrowser(');
  assert.ok(start > -1, 'the recovery helper should exist');
  const body = source.slice(start, source.indexOf('\n  }\n', start));
  assert.match(body, /#forgetPlaywrightSession\(\)/);
  assert.match(body, /quitManagedChrome\(this\.profileDir, this\.browserPid\)/);
  // The lock is what makes the next launch connect to a corpse.
  assert.match(body, /clearStaleProfileLocks\(this\.profileDir\)/);
  assert.match(body, /this\.browserPid = null/);
  // Chrome releases the profile asynchronously; relaunching immediately trips the lock.
  assert.match(body, /await sleep\(1_200\)/);
});

test('the launch loop recovers instead of reconnecting to the corpse', () => {
  assert.match(source, /if \(BrowserController\.isDeadBrowserError\(error\) && attempt < 2\) \{[\s\S]{0,200}#recoverManagedBrowser/);
});

test('preview submission survives a browser that dies underneath it', () => {
  const start = source.indexOf('async generateTptPreviewVideoWithGpt(');
  const body = source.slice(start, start + 4000);
  assert.match(body, /if \(!BrowserController\.isDeadBrowserError\(error\)\) throw error;/);
  assert.match(body, /await this\.#recoverManagedBrowser\(`preview submit/);
  // It relaunches before retrying, rather than reusing the handle that just died.
  assert.match(body, /await this\.launch\(\{ headless: true, forceBrowser: true \}\);\n\s*submission = await submit\(\);/);
});

test('every wait that can see the browser die resets it and marks the error retryable', () => {
  // Three waits can notice a crash: the image wait, the response wait and the preview
  // video wait. All three have to reset, or whichever one is unfixed leaves the corpse
  // holding the lock for everything after it.
  const sites = ['image wait: browser closed', 'response wait: browser closed', 'preview wait: browser closed'];
  for (const reason of sites) {
    const index = source.indexOf(`#recoverManagedBrowser('${reason}')`);
    assert.ok(index > -1, `${reason} should reset the browser`);
    assert.match(source.slice(index, index + 500), /retryable: true/);
  }
  assert.equal((source.match(/code: 'BROWSER_CONTEXT_CLOSED'/g) || []).length, 3);
});

test('repeated identical launch failures are reported once', () => {
  // Six copies of the same connectOverCDP line tell the reader nothing the first did.
  assert.match(source, /const unique = \[\.\.\.new Set\(failures\.map/);
  assert.match(source, /error\.attempts = failures\.length/);
});
