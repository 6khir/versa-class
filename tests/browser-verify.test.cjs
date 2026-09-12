const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const {
  verifyServiceUrl,
  isServiceSignInUrl,
  chromeAppBundleFromExecutable,
  mergePreservedSessionCookies
} = require('../src/browser-controller.cjs');

test('verify landing URLs stay on the live app, not a gem', () => {
  assert.equal(verifyServiceUrl('gemini'), 'https://gemini.google.com/app');
  assert.equal(verifyServiceUrl('chatgpt'), 'https://chatgpt.com/');
  assert.equal(verifyServiceUrl('meta'), 'https://www.meta.ai/');
});

test('Google sign-in pages are not treated as a finished Gemini session', () => {
  assert.equal(isServiceSignInUrl('https://accounts.google.com/v3/signin/identifier', 'gemini'), true);
  assert.equal(isServiceSignInUrl('https://gemini.google.com/app', 'gemini'), false);
  assert.equal(isServiceSignInUrl('https://chatgpt.com/', 'chatgpt'), false);
});

test('Chrome Canary app bundle is derived from the Mac executable path', () => {
  assert.equal(
    chromeAppBundleFromExecutable('/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary'),
    '/Applications/Google Chrome Canary.app'
  );
});

test('managed Chrome starts with a stable debugging port', () => {
  const { managedChromeLaunchArgs } = require('../src/browser-controller.cjs');
  const args = managedChromeLaunchArgs({ background: true, profileDir: '/tmp/versa-profile' });
  assert.ok(args.includes('--remote-debugging-port=9335'));
  assert.ok(!args.includes('--no-startup-window'));
});

test('background CDP guard swallows window activation commands', () => {
  const { shouldBlockCdpActivation } = require('../src/cdp-activation-guard.cjs');
  assert.equal(shouldBlockCdpActivation('Page.bringToFront', {}, false), true);
  assert.equal(shouldBlockCdpActivation('Target.activateTarget', {}, false), true);
  assert.equal(shouldBlockCdpActivation('Page.bringToFront', {}, true), false);
  assert.equal(shouldBlockCdpActivation('Browser.setWindowBounds', { bounds: { windowState: 'normal' } }, false), true);
  assert.equal(shouldBlockCdpActivation('Browser.setWindowBounds', { bounds: { width: 1280, height: 860 } }, false), true);
  assert.equal(shouldBlockCdpActivation('Runtime.evaluate', {}, false), false);
  assert.equal(shouldBlockCdpActivation('Page.bringToFront', {}, false, true), false);
});

test('importing Meta restores previous Gemini and TPT cookies without wiping the imported service', () => {
  const dir = mkdtempSync(join(tmpdir(), 'versa-cookies-'));
  const preservedPath = join(dir, 'preserved.sqlite');
  const targetPath = join(dir, 'target.sqlite');
  const create = (path, rows) => {
    const db = new DatabaseSync(path);
    db.exec('CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, PRIMARY KEY (host_key, name))');
    const insert = db.prepare('INSERT INTO cookies (host_key, name, value) VALUES (?, ?, ?)');
    for (const row of rows) insert.run(row.host_key, row.name, row.value);
    db.close();
  };
  try {
    create(preservedPath, [
      { host_key: '.google.com', name: 'SID', value: 'gemini-session' },
      { host_key: '.meta.ai', name: 'meta_session', value: 'old-meta' },
      { host_key: '.teacherspayteachers.com', name: 'sessionKey', value: 'tpt' }
    ]);
    create(targetPath, [
      { host_key: '.meta.ai', name: 'meta_session', value: 'new-meta' }
    ]);
    const restored = mergePreservedSessionCookies(targetPath, preservedPath, { importing: 'meta' });
    assert.ok(restored >= 2);
    const db = new DatabaseSync(targetPath, { readOnly: true });
    const rows = db.prepare('SELECT host_key, name, value FROM cookies ORDER BY host_key, name').all();
    db.close();
    assert.equal(rows.find((row) => row.name === 'SID')?.value, 'gemini-session');
    assert.equal(rows.find((row) => row.name === 'sessionKey')?.value, 'tpt');
    assert.equal(rows.find((row) => row.name === 'meta_session')?.value, 'new-meta');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
