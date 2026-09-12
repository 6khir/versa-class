'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assertTextFreeMaster } = require('../src/text-free-validator.cjs');

function tempImage(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'versa-master-'));
  const imagePath = path.join(dir, 'master.png');
  fs.writeFileSync(imagePath, 'png');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return imagePath;
}

test('a clean master passes on the first detection pass', async (t) => {
  const imagePath = tempImage(t);
  const result = await assertTextFreeMaster(imagePath, {
    detect: async () => ({ detections: [] }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.attempts.length, 1);
});

test('leftover words are accepted once and never regenerate', async (t) => {
  const imagePath = tempImage(t);
  const retries = [];
  let detects = 0;
  const result = await assertTextFreeMaster(imagePath, {
    detect: async () => {
      detects += 1;
      return { detections: [{ text: 'ooliturs', box: [10, 10, 80, 40] }] };
    },
    onRetry: (info) => retries.push(info),
  });
  assert.equal(result.ok, true);
  assert.equal(result.acceptedWithLeftovers, true);
  assert.equal(detects, 1);
  assert.equal(retries.length, 1);
  assert.equal(result.leftover[0].text, 'ooliturs');
});

test('panel numbers and coordinates are ignored as layout chrome', async (t) => {
  const imagePath = tempImage(t);
  const { isIgnorableDetection } = require('../src/text-free-validator.cjs');
  assert.equal(isIgnorableDetection({ text: '5' }), true);
  assert.equal(isIgnorableDetection({ text: '2.' }), true);
  assert.equal(isIgnorableDetection({ text: '[0.0645, 0.0285, 0.9355, 0.0912]' }), true);
  assert.equal(isIgnorableDetection({ text: 'MY NAME' }), false);
  const result = await assertTextFreeMaster(imagePath, {
    detect: async () => ({ detections: [{ text: '1' }, { text: '6' }, { text: '[0.0645, 0.171, 0.9355, 0.878]' }] }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.acceptedWithLeftovers, false);
  assert.equal(result.chrome.length, 3);
});
