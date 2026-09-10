'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const {
  MAX_INPAINT_RETRIES,
  shouldCleanBakedText,
  inpaintOkSidecar
} = require('../src/text-inpaint-bridge.cjs');

test('blank masters with textOverlays must be cleaned before assembly', () => {
  assert.equal(shouldCleanBakedText({ textOverlays: [] }), false);
  assert.equal(shouldCleanBakedText({ textOverlays: [{ text: 'Name: ________' }] }), true);
  assert.equal(inpaintOkSidecar('/tmp/page_1_blank.png'), '/tmp/page_1_blank.inpaint-ok.json');
  assert.equal(MAX_INPAINT_RETRIES, 3);
});

test('queue and assembler refuse dirty blanks; Python path is LaMa-only', () => {
  const queue = readFileSync(join(__dirname, '..', 'src', 'queue-engine.cjs'), 'utf8');
  const assembler = readFileSync(join(__dirname, '..', 'src', 'pptx-assembler.cjs'), 'utf8');
  const python = readFileSync(join(__dirname, '..', 'python', 'versa_text_inpaint.py'), 'utf8');
  assert.match(queue, /cleanBlankMaster\(outputPath\)/);
  assert.match(assembler, /assertBlankMasterClean\(blankPath, job\)/);
  assert.match(python, /det_db_thresh.: 0\.25/);
  assert.match(python, /cv2\.dilate/);
  assert.match(python, /def observe_and_verify/);
  assert.match(python, /MAX_INPAINT_RETRIES = 3/);
  assert.match(python, /SimpleLama/);
  assert.match(python, /GENERATIVE_INPAINT_FORBIDDEN/);
  assert.doesNotMatch(python, /positive_prompt\s*=/);
});
