'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluatePreflight, attachIdentity } = require('../src/rebuild-preflight.cjs');
const { ERROR_CODES } = require('../src/rebuild-page-record.cjs');

function record(overrides = {}) {
  return {
    pageRole: 'interior',
    sequenceIndex: 2,
    sequenceTotal: 5,
    plannedCopy: {
      title: 'Name Hunt',
      instruction: "Circle your name.",
      body: '',
      footer: '',
    },
    blocks: [
      { role: 'title', text: 'Name Hunt', box: null },
      { role: 'instruction', text: "Circle your name.", box: null },
    ],
    ...overrides,
  };
}

test('preflight accepts expected copy and writes identity from boxes only', () => {
  const detections = [
    { text: 'Name Hunt', box: [20, 20, 400, 80], confidence: 0.92 },
    { text: 'Circle your name.', box: [20, 100, 500, 150], confidence: 0.88 },
  ];
  const verdict = evaluatePreflight(record(), { detections, bands: [{ sigma: 4, flat: true }] });
  assert.equal(verdict.ok, true);
  const identified = attachIdentity(record(), { detections, matches: verdict.matches });
  assert.equal(identified.blocks[0].text, 'Name Hunt');
  assert.deepEqual(identified.blocks[0].box, [20, 20, 400, 80]);
});

test('wrong interior cover, extra Gemini text, and visible folios are rejected', () => {
  const cover = evaluatePreflight(record(), {
    detections: [
      { text: 'Summer Activity Pack', box: [10, 10, 200, 40], confidence: 0.9 },
      { text: 'Thank You', box: [10, 80, 200, 110], confidence: 0.8 },
    ],
  });
  assert.equal(cover.ok, false);
  assert.ok([ERROR_CODES.WRONG_ROLE, ERROR_CODES.WRONG_COPY].includes(cover.code));

  const extra = evaluatePreflight(record(), {
    detections: [
      { text: 'Name Hunt', box: [20, 20, 400, 80], confidence: 0.9 },
      { text: 'Circle your name.', box: [20, 100, 500, 150], confidence: 0.9 },
      { text: 'Bonus sticker shop', box: [20, 200, 400, 230], confidence: 0.8 },
    ],
  });
  assert.equal(extra.code, ERROR_CODES.EXTRA_TEXT);

  const folio = evaluatePreflight(record(), {
    detections: [
      { text: 'Name Hunt', box: [20, 20, 400, 80], confidence: 0.9 },
      { text: 'Circle your name.', box: [20, 100, 500, 150], confidence: 0.9 },
      { text: 'Page 3 of 7', box: [2200, 3400, 2400, 3480], confidence: 0.95 },
    ],
  });
  assert.equal(folio.code, ERROR_CODES.VISIBLE_FOLIO);
});

test('non-flat bands fail before cleanup', () => {
  const verdict = evaluatePreflight(record(), {
    detections: [
      { text: 'Name Hunt', box: [20, 20, 400, 80], confidence: 0.9 },
      { text: 'Circle your name.', box: [20, 100, 500, 150], confidence: 0.9 },
    ],
    bands: [{ sigma: 42, flat: false, role: 'title' }],
  });
  assert.equal(verdict.code, ERROR_CODES.NONFLAT_BAND);
});
