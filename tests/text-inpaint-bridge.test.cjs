'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const {
  MAX_INPAINT_RETRIES,
  shouldCleanBakedText,
  inpaintOkSidecar,
  defaultPythonBin,
  resolvePython
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
  const python = readFileSync(join(__dirname, '..', 'python', 'versa_blank_master.py'), 'utf8');
  const laptop = readFileSync(join(__dirname, '..', 'python', 'versa_text_inpaint.py'), 'utf8');
  assert.match(queue, /cleanBlankMaster\(outputPath\)/);
  assert.match(assembler, /assertBlankMasterClean\(blankPath, job\)/);
  assert.match(python, /det_db_thresh.: 0\.25/);
  assert.match(python, /cv2\.dilate/);
  assert.match(python, /def observe_and_verify/);
  assert.match(python, /MAX_INPAINT_RETRIES = 3/);
  assert.match(python, /SimpleLama/);
  assert.match(python, /GENERATIVE_INPAINT_FORBIDDEN/);
  assert.doesNotMatch(python, /positive_prompt\s*=/);
  assert.match(laptop, /from versa_blank_master import/);
  assert.match(laptop, /cv2\.dilate/);
  assert.match(laptop, /inpaint_lama/);
  assert.match(laptop, /solid-fill/);
  assert.match(laptop, /opencv-telea/);
  assert.doesNotMatch(laptop, /execute_inpainting_workflow/);
  assert.doesNotMatch(laptop, /ComfyBridge/);
});

test('inpaint CLI uses the vision resolver, not bare system python3', () => {
  const bridge = readFileSync(join(__dirname, '..', 'src', 'text-inpaint-bridge.cjs'), 'utf8');
  assert.match(bridge, /resolvePython/);
  assert.match(bridge, /defaultPythonBin\(\)/);
  assert.doesNotMatch(bridge, /pythonBin = process\.env\.VERSA_PYTHON \|\| 'python3'/);
  const resolved = resolvePython();
  const bin = defaultPythonBin();
  if (resolved) {
    assert.equal(bin, resolved);
    assert.match(bin, /\.venv(?:\.nosync)?\/bin\/python/);
  } else {
    assert.equal(bin, process.env.VERSA_PYTHON || 'python3');
  }
});
