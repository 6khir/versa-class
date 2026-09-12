'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeProductPipeline } = require('../renderer/product-pipeline.js');

test('product progress stays below 100% when mockups and preview are empty', () => {
  const pipeline = computeProductPipeline({
    stats: { total: 54, complete: 54, remaining: 0, percent: 100 },
    productFormat: 'static',
    highlights: { characters: [] },
    characterSheets: [],
    tptListing: null
  });
  assert.equal(pipeline.pagePercent, 100);
  assert.ok(pipeline.percent < 100, `expected product percent < 100, got ${pipeline.percent}`);
  assert.equal(pipeline.thumbPct, 0);
  assert.equal(pipeline.previewPct, 0);
  // The SEO stage was removed; the preview video took its weight in the score.
  assert.deepEqual(pipeline.requiredOpen.map((stage) => stage.id), ['thumbnails']);
  assert.equal(pipeline.requiredOpen[0].label, 'Mockups Lab');
  assert.equal(pipeline.complete, false);
  assert.equal(pipeline.nextView, 'thumbnails');
});

test('product progress reaches 100% only after all four mockups and the preview', () => {
  const pipeline = computeProductPipeline({
    stats: { total: 12, complete: 12, remaining: 0, percent: 100 },
    productFormat: 'static',
    highlights: { characters: [] },
    characterSheets: [],
    tptListing: {
      title: 'Visual Schedule Flipbook',
      description: 'A description',
      tags: ['Visual'],
      thumbnailPaths: ['a.png', 'b.png', 'c.png', 'd.png'],
      video: { path: '/tmp/preview.mp4', status: 'ready' }
    }
  });
  assert.equal(pipeline.thumbPct, 100);
  assert.equal(pipeline.previewPct, 100);
  assert.equal(pipeline.percent, 100);
  assert.equal(pipeline.complete, true);
  // Nothing reports an SEO stage any more.
  assert.equal(pipeline.listingPct, undefined);
  assert.equal(pipeline.listingReady, undefined);
  assert.ok(!pipeline.openStages.some((stage) => stage.id === 'listing'));
});

test('maze books open Maze Lab and never Text Lab or Editable Lab', () => {
  const pipeline = computeProductPipeline({
    stats: { total: 8, complete: 0, remaining: 8, percent: 0 },
    productFormat: 'maze',
    highlights: { characters: [] },
    characterSheets: [],
    tptListing: null
  });
  assert.ok(pipeline.maze);
  assert.ok(pipeline.requiredOpen.some((stage) => stage.id === 'maze'));
  assert.ok(!pipeline.requiredOpen.some((stage) => stage.id === 'interior'));
  assert.ok(!pipeline.openStages.some((stage) => stage.id === 'interior_text'));
  assert.ok(!pipeline.openStages.some((stage) => stage.id === 'editable_ppt'));
});

test('maze product weight uses generated maze pages', () => {
  const pipeline = computeProductPipeline({
    stats: { total: 8, complete: 0, remaining: 8, percent: 0 },
    productFormat: 'maze',
    mazeLab: { pageCount: 4 },
    mazeProject: {
      pages: [
        { pageRole: 'maze_interior', generationStatus: 'ready' },
        { pageRole: 'maze_interior', generationStatus: 'ready' },
        { pageRole: 'maze_interior', generationStatus: 'idle' },
        { pageRole: 'maze_interior', generationStatus: 'idle' }
      ]
    },
    highlights: { characters: [] },
    characterSheets: [],
    tptListing: null
  });
  assert.equal(pipeline.mazePct, 50);
  assert.ok(pipeline.percent > 0);
  assert.ok(pipeline.percent < 100);
  assert.equal(pipeline.pagesDone, false);
});

test('static books do not open Text Lab or Editable Lab', () => {
  const pipeline = computeProductPipeline({
    stats: { total: 8, complete: 0, remaining: 8, percent: 0 },
    productFormat: 'static',
    highlights: { characters: [] },
    characterSheets: [],
    tptListing: null
  });
  assert.ok(pipeline.requiredOpen.some((stage) => stage.id === 'interior'));
  assert.ok(!pipeline.requiredOpen.some((stage) => stage.id === 'interior_text'));
  assert.ok(!pipeline.requiredOpen.some((stage) => stage.id === 'editable_ppt'));
  assert.ok(!pipeline.openStages.some((stage) => stage.id === 'interior_text'));
  assert.ok(!pipeline.openStages.some((stage) => stage.id === 'editable_ppt'));
});

test('a new book reports empty fills across later stages', () => {
  const pipeline = computeProductPipeline({
    stats: { total: 12, complete: 0, remaining: 12, percent: 0 },
    productFormat: 'static',
    highlights: { characters: [] },
    characterSheets: [],
    tptListing: null
  });
  assert.equal(pipeline.pagePercent, 0);
  assert.equal(pipeline.thumbPct, 0);
  assert.equal(pipeline.previewPct, 0);
  assert.equal(pipeline.textPct, 0);
  assert.equal(pipeline.editablePct, 0);
  assert.equal(pipeline.pagesDone, false);
});

test('editable books require native generation in the product score', () => {
  const pipeline = computeProductPipeline({
    stats: { total: 8, complete: 8, remaining: 0, percent: 100 },
    productFormat: 'editable',
    highlights: { characters: [] },
    characterSheets: [],
    tptListing: { title: 'Book', description: 'Desc', tags: ['T'], thumbnailPaths: ['a.png', 'b.png', 'c.png', 'd.png'] }
  });
  assert.ok(pipeline.percent < 100);
  // Editable books now score across three stages instead of one.
  assert.ok(pipeline.requiredOpen.some((stage) => stage.id === 'interior_text'));
  assert.ok(pipeline.requiredOpen.some((stage) => stage.id === 'editable_ppt'));
});

test('native editable generation completion satisfies the product score', () => {
  const pipeline = computeProductPipeline({
    stats: { total: 8, complete: 8, remaining: 0, percent: 100 },
    productFormat: 'editable',
    highlights: { characters: [] },
    characterSheets: [],
    tptListing: {
      title: 'Book', description: 'Desc', tags: ['T'],
      thumbnailPaths: ['a.png', 'b.png', 'c.png', 'd.png'],
      video: { path: '/tmp/preview.mp4', status: 'ready' }
    },
    stepEditableGenerationStatus: 'completed',
    editableText: { ready: 8, total: 8 }
  });
  assert.equal(pipeline.percent, 100);
  assert.equal(pipeline.editable, true);
  for (const id of ['interior_artwork', 'interior_text', 'editable_ppt']) {
    assert.ok(!pipeline.requiredOpen.some((stage) => stage.id === id));
  }
});

test('maze pages ready do not paint export as already underway', () => {
  const pipeline = computeProductPipeline({
    stats: { total: 6, complete: 6, remaining: 0, percent: 100 },
    productFormat: 'maze',
    mazeLab: { pageCount: 2 },
    mazeProject: {
      pages: [
        { pageRole: 'maze_interior', generationStatus: 'ready' },
        { pageRole: 'maze_interior', generationStatus: 'ready' }
      ]
    },
    highlights: { characters: [] },
    characterSheets: [],
    tptListing: null,
    stepExportStatus: 'pending'
  });
  assert.equal(pipeline.pagesDone, true);
  assert.equal(pipeline.mazePct, 100);
  assert.equal(pipeline.thumbPct, 0);
  assert.equal(pipeline.previewPct, 0);
  assert.equal(pipeline.exportPct, 0);
  assert.ok(pipeline.percent < 50, `maze-only progress should stay under 50, got ${pipeline.percent}`);
});
