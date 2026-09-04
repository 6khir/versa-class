'use strict';

const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { injectLicenseGate } = require('../inject-license-gate.cjs');

test('injectLicenseGate makes startup async and requires the license module', () => {
  const dir = mkdtempSync(join(tmpdir(), 'versa-inject-'));
  const mainPath = join(dir, 'main.cjs');
  writeFileSync(mainPath, `const { app, dialog, shell } = require('electron');
const singleInstanceAcquired = true;
if (singleInstanceAcquired) app.whenReady().then(() => {
  store.recoverInterrupted();
  protocol.handle('tpt-image', async (request) => {
    return request;
  });
});
`);
  try {
    injectLicenseGate(mainPath);
    const source = readFileSync(mainPath, 'utf8');
    assert.match(source, /whenReady\(\)\.then\(async \(\) => \{/);
    assert.match(source, /require\('\.\/license-gate\.cjs'\)/);
    assert.match(source, /enforceRemotePolicy/);
    assert.match(source, /startLicenseWatch/);
    assert.match(source, /app\.exit\(1\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
