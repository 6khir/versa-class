const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const { installedBrowserCandidates, resolveInstalledBrowser } = require('../src/browser-controller.cjs');

test('installed browsers are Google Chrome Canary only', () => {
  const candidates = installedBrowserCandidates();
  assert.ok(candidates.length > 0);
  for (const candidate of candidates) {
    assert.equal(candidate.label, 'Google Chrome Canary');
    assert.match(String(candidate.executablePath), /Canary|Chrome SxS|chrome-canary/i);
    assert.doesNotMatch(String(candidate.executablePath), /Google Chrome\.app/);
    assert.doesNotMatch(String(candidate.executablePath), /Microsoft Edge/i);
    assert.doesNotMatch(String(candidate.userDataDir || ''), /Application Support\/Google\/Chrome$/);
  }
});

test('stale Chrome/Edge profile selections still resolve to Canary', () => {
  const resolved = resolveInstalledBrowser({ browser: 'Google Chrome', profileKey: 'Default' });
  if (process.platform === 'darwin' && existsSync('/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary')) {
    assert.ok(resolved);
    assert.equal(resolved.label, 'Google Chrome Canary');
    assert.match(resolved.executablePath, /Google Chrome Canary/);
  }
});
