'use strict';

const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPackedCommonJs, packCommonJs } = require('../obfuscate.cjs');
const { decide } = require('../src/license-gate.cjs');

test('packed CommonJS keeps exports and hides the original source', () => {
  const dir = mkdtempSync(join(tmpdir(), 'versa-obf-'));
  const filePath = join(dir, 'sample.cjs');
  try {
    const original = `'use strict';
function secretCheck(flag) { return flag === 'allow-run'; }
module.exports = { secretCheck, label: 'license-core' };
`;
    writeFileSync(filePath, packCommonJs(original));
    const packed = readFileSync(filePath, 'utf8');
    assert.equal(packed.includes('secretCheck'), false);
    assert.equal(packed.includes('allow-run'), false);
    const loaded = loadPackedCommonJs(filePath);
    assert.equal(loaded.label, 'license-core');
    assert.equal(loaded.secretCheck('allow-run'), true);
    assert.equal(loaded.secretCheck('no'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('license decide still blocks a disabled policy after packing helpers remain available', () => {
  assert.equal(decide({ enabled: false }, { currentVersion: '0.1.0' }).allowed, false);
});
