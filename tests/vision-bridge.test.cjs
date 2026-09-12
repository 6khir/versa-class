'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { VisionBridge, visionResultToPageText } = require('../src/vision-bridge.cjs');

test('status reports readiness without spawning the worker', async () => {
  // Spawning imports torch and paddle, which costs tens of seconds and would hang the
  // suite on a machine that has the venv installed. Unit tests stay on the cheap path.
  const bridge = new VisionBridge();
  const status = await bridge.status();
  assert.equal(status.probed, false);
  assert.equal(typeof status.ready, 'boolean');
  assert.equal(typeof bridge.available, 'boolean');
});

test('the layer model maps to the four page-text keys', () => {
  const mapped = visionResultToPageText({
    ok: true, width: 1000, height: 1300,
    text: [
      { id: 't1', text: 'Counting Stars', box: [100, 60, 600, 150] },
      { id: 't2', text: 'Circle the correct answer.', box: [100, 200, 700, 240] },
      { id: 't3', text: 'How many stars?', box: [100, 400, 600, 440] },
      { id: 't4', text: 'Name: ____ Date: ____', box: [100, 1200, 700, 1240] }
    ]
  });
  assert.equal(mapped.title, 'Counting Stars');       // tallest run in the top quarter
  assert.equal(mapped.instruction, 'Circle the correct answer.');
  assert.deepEqual(mapped.sections, ['How many stars?']);
  assert.match(mapped.footer, /Name/);
});

test('an empty or failed result yields no page text', () => {
  assert.equal(visionResultToPageText({ ok: false }), null);
  assert.equal(visionResultToPageText({ ok: true, text: [] }), null);
});

test('Interior Text prefers local vision and keeps the gem as fallback', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'editable-page-text.cjs'), 'utf8');
  assert.match(src, /if \(useVision\) \{/);
  assert.match(src, /visionBridge\.analyzePage\(imagePath\)/);
  // The gem path must still exist below the vision block.
  assert.ok(src.indexOf('visionBridge.analyzePage') < src.indexOf('generatePageText(artwork'));
  // A provider is only mandatory when vision is off.
  assert.match(src, /!useVision && typeof provider\?\.generatePageText/);
});
