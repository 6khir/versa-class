'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateManifest,
  buildManifest,
  bboxToSlideBox,
  extractCanonicalLines,
  copyFromJob,
} = require('../src/editable-manifest.cjs');
const { loadTemplate } = require('../src/layout-templates.cjs');

test('quoted prompt copy maps onto fixed template zones', () => {
  const template = loadTemplate('washable-marker', 'interior');
  const prompt = [
    'Draw a worksheet.',
    'The image must contain ONLY the following text:',
    '"Name Tracing"',
    '"Trace each letter."',
    '"A B C"',
    '"Name: ________"',
  ].join('\n');
  const copy = copyFromJob({ prompt }, template);
  assert.equal(copy.title, 'Name Tracing');
  assert.equal(copy.instruction, 'Trace each letter.');
  assert.equal(copy.body, 'A B C');
  assert.equal(copy.footer, 'Name: ________');
  const manifest = buildManifest({
    pageId: 'book_page02',
    themeId: 'washable-marker',
    template,
    copyByZone: copy,
  });
  assert.equal(manifest.zones[0].bbox_px[0], template.zones[0].bbox[0]);
  assert.equal(validateManifest(manifest).zones.length, 4);
});

test('bbox mapping is a linear scale of the page onto the slide', () => {
  assert.deepEqual(
    bboxToSlideBox([248, 350, 2232, 700], 2480, 3508, 2480, 3508),
    { left: 248, top: 350, width: 1984, height: 350 }
  );
});

test('extractCanonicalLines ignores do-not and @image quotes', () => {
  assert.deepEqual(
    extractCanonicalLines('ONLY the following text: "@image of a cat" "Hello" "Do not add extra words"'),
    ['Hello']
  );
});
