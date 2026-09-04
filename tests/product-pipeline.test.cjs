'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeProductPipeline } = require('../renderer/product-pipeline.js');

test('product progress stays below 100% when listing and mockups are empty', () => {
  const pipeline = computeProductPipeline({
    stats: { total: 54, complete: 54, remaining: 0, percent: 100 },
    productFormat: 'static',
    highlights: { characters: [] },
    characterSheets: [],
    tptListing: null,
    canvaTemplateLink: null
  });
  assert.equal(pipeline.pagePercent, 100);
  assert.ok(pipeline.percent < 100, `expected product percent < 100, got ${pipeline.percent}`);
  assert.equal(pipeline.listingPct, 0);
  assert.equal(pipeline.thumbPct, 0);
  assert.deepEqual(pipeline.requiredOpen.map((stage) => stage.id), ['thumbnails', 'listing']);
  assert.equal(pipeline.complete, false);
  assert.equal(pipeline.nextView, 'thumbnails');
});

test('product progress reaches 100% only after listing and all four mockups', () => {
  const pipeline = computeProductPipeline({
    stats: { total: 12, complete: 12, remaining: 0, percent: 100 },
    productFormat: 'static',
    highlights: { characters: [] },
    characterSheets: [],
    tptListing: {
      title: 'Visual Schedule Flipbook',
      thumbnailPaths: ['a.png', 'b.png', 'c.png', 'd.png']
    }
  });
  assert.equal(pipeline.listingPct, 100);
  assert.equal(pipeline.thumbPct, 100);
  assert.equal(pipeline.percent, 100);
  assert.equal(pipeline.complete, true);
});

test('editable books keep Canva in the product score', () => {
  const pipeline = computeProductPipeline({
    stats: { total: 8, complete: 8, remaining: 0, percent: 100 },
    productFormat: 'editable',
    highlights: { characters: [] },
    characterSheets: [],
    tptListing: { title: 'Book', thumbnailPaths: ['a.png', 'b.png', 'c.png', 'd.png'] },
    canvaTemplateLink: null
  });
  assert.ok(pipeline.percent < 100);
  assert.ok(pipeline.requiredOpen.some((stage) => stage.id === 'editable'));
});

test('Windows Canva lock drops the editable stage so listing can finish', () => {
  const pipeline = computeProductPipeline({
    stats: { total: 8, complete: 8, remaining: 0, percent: 100 },
    productFormat: 'editable',
    highlights: { characters: [] },
    characterSheets: [],
    tptListing: { title: 'Book', thumbnailPaths: ['a.png', 'b.png', 'c.png', 'd.png'] },
    canvaTemplateLink: null
  }, null, { canvaLocked: true });
  assert.equal(pipeline.percent, 100);
  assert.equal(pipeline.editable, false);
  assert.ok(!pipeline.requiredOpen.some((stage) => stage.id === 'editable'));
});
