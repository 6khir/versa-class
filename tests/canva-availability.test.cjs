'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const {
  isCanvaAvailable,
  canvaUnavailableError,
  assertCanvaAvailable,
  CANVA_UNAVAILABLE_CODE,
  CANVA_COMING_SOON_MESSAGE
} = require('../src/canva-availability.cjs');

test('Canva stays on for Mac and is locked on Windows', () => {
  assert.equal(isCanvaAvailable('darwin'), true);
  assert.equal(isCanvaAvailable('linux'), true);
  assert.equal(isCanvaAvailable('win32'), false);
  assert.equal(isCanvaAvailable(), process.platform !== 'win32');
});

test('Windows Canva lock throws a coming-soon error without touching other engines', () => {
  assert.throws(() => assertCanvaAvailable('win32'), (error) => {
    assert.equal(error.code, CANVA_UNAVAILABLE_CODE);
    assert.match(error.message, /coming soon on Windows/i);
    assert.match(error.message, /ChatGPT/);
    assert.match(error.message, /Gemini/);
    assert.match(error.message, /Meta AI/);
    return true;
  });
  assert.doesNotThrow(() => assertCanvaAvailable('darwin'));
  const error = canvaUnavailableError();
  assert.equal(error.message, CANVA_COMING_SOON_MESSAGE);
});

test('Windows build still keeps ChatGPT, Gemini, and Meta login URLs', () => {
  const { verifyServiceUrl } = require('../src/browser-controller.cjs');
  assert.equal(verifyServiceUrl('chatgpt'), 'https://chatgpt.com/');
  assert.equal(verifyServiceUrl('gemini'), 'https://gemini.google.com/app');
  assert.equal(verifyServiceUrl('meta'), 'https://www.meta.ai/');
});

test('main process gates Canva on Windows and skips the automation step', () => {
  const main = readFileSync(join(__dirname, '..', 'src', 'main.cjs'), 'utf8');
  assert.match(main, /canva-availability\.cjs/);
  assert.match(main, /canvaAvailable: isCanvaAvailable\(\)/);
  assert.match(main, /if \(!isCanvaAvailable\(\)\) throw canvaUnavailableError\(\)/);
  assert.match(main, /Skipping the Canva step/);
  assert.match(main, /stepEditableStatus: 'skipped'/);
});
