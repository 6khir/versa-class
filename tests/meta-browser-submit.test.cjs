const test = require('node:test');
const assert = require('node:assert/strict');
const {
  GENERATION_PROGRESS_PATTERNS,
  META_SUBMIT_SELECTORS
} = require('../src/browser-controller.cjs');

test('Meta submit selectors include Send role buttons and SVG icons', () => {
  assert.ok(META_SUBMIT_SELECTORS.includes('div[role="button"][aria-label*="Send" i]'));
  assert.ok(META_SUBMIT_SELECTORS.includes('svg[aria-label*="Send" i]'));
  assert.ok(META_SUBMIT_SELECTORS.includes('button[aria-label="Submit"]'));
});

test('generation progress patterns recognize Meta AI loading copy', () => {
  const sample = ['Generating image…', 'Generating…', 'Creating…', 'Creating image'];
  for (const text of sample) {
    assert.ok(
      GENERATION_PROGRESS_PATTERNS.some((pattern) => pattern.test(text)),
      `expected a progress pattern to match ${JSON.stringify(text)}`
    );
  }
});
