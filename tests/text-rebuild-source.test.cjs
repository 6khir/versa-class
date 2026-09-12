'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TEXT_REBUILD_TRIGGER_LINES,
  TEXT_REBUILD_TRIGGER,
  PAGE_ROLE,
  applyTextRebuildSourcePrompt,
  hasTextRebuildTrigger,
  resolveRebuildPageRole,
  extractQuotedCopy,
  stripTextRebuildWrapper,
  shouldApplyTextRebuildSource,
} = require('../src/text-rebuild-source.cjs');
const { buildPromptsGenerationRequest } = require('../src/prompt-builder.cjs');

test('trigger lines are exact and do not use editable or render', () => {
  assert.deepEqual(TEXT_REBUILD_TRIGGER_LINES, [
    'TEXT-REBUILD SOURCE.',
    'KEEP BAKED TEXT.',
    'ERASABLE PRINT.',
  ]);
  assert.equal(TEXT_REBUILD_TRIGGER, 'TEXT-REBUILD SOURCE.\nKEEP BAKED TEXT.\nERASABLE PRINT.');
  assert.doesNotMatch(TEXT_REBUILD_TRIGGER, /\beditable\b/i);
  assert.doesNotMatch(TEXT_REBUILD_TRIGGER, /\brender\b/i);
});

test('page roles follow sequence position unless the job kind overrides', () => {
  assert.equal(resolveRebuildPageRole({ pageNumber: 1, pageCount: 7 }), PAGE_ROLE.COVER);
  assert.equal(resolveRebuildPageRole({ pageNumber: 3, pageCount: 7 }), PAGE_ROLE.INTERIOR);
  assert.equal(resolveRebuildPageRole({ pageNumber: 7, pageCount: 7 }), PAGE_ROLE.BACK);
  assert.equal(resolveRebuildPageRole({ job: { kind: 'cover', pageNumber: 3 }, pageCount: 7 }), PAGE_ROLE.COVER);
  assert.equal(resolveRebuildPageRole({ job: { kind: 'back_cover', pageNumber: 2 }, pageCount: 7 }), PAGE_ROLE.BACK);
});

test('baked wrap starts with the three control lines and supplies sequence fields', () => {
  const prompt = applyTextRebuildSourcePrompt({
    prompt: '@image A classroom page titled "Name Hunt" with the instruction "Circle your name." on A4 portrait 2480 × 3508 px.',
    job: { pageNumber: 3, kind: 'interior' },
    pageCount: 7,
  });
  const body = prompt.replace(/^@image\s*/, '');
  const lines = body.split('\n');
  assert.match(prompt, /^@image /);
  assert.equal(lines[0], 'TEXT-REBUILD SOURCE.');
  assert.equal(lines[1], 'KEEP BAKED TEXT.');
  assert.equal(lines[2], 'ERASABLE PRINT.');
  assert.match(prompt, /sequence_index: 3/);
  assert.match(prompt, /sequence_total: 7/);
  assert.match(prompt, /page_role: interior/);
  assert.match(prompt, /INTERNAL CONTROL — NEVER DRAW OR DISPLAY:/);
  assert.match(prompt, /VISIBLE COPY — DRAW ONLY THESE QUOTED STRINGS:/);
  assert.match(prompt, /Title: "Name Hunt"/);
  assert.match(prompt, /Instruction: "Circle your name\."/);
  assert.match(prompt, /Name Hunt/);
  assert.doesNotMatch(prompt, /reserved writing band/i);
  assert.doesNotMatch(prompt, /\beditable\b/i);
  assert.doesNotMatch(prompt, /\brender\b/i);
  assert.doesNotMatch(prompt, /mode:\s*editable/i);
  assert.equal(hasTextRebuildTrigger(prompt), true);
});

test('baked wrap isolates the current page and does not nest on rewrap', () => {
  const dump = [
    '@image Page 1 of 7 — Cover: A front cover with "MY NAME PACK" and safe print margins on A4 portrait 2480 × 3508 px.',
    'Page 3 of 7 — Interior: A worksheet titled "Name Hunt" with the instruction "Circle your name." and safe print margins on A4 portrait 2480 × 3508 px.',
  ].join('\n');
  const first = applyTextRebuildSourcePrompt({
    prompt: dump,
    job: { pageNumber: 3 },
    pageCount: 7,
  });
  const second = applyTextRebuildSourcePrompt({
    prompt: first,
    job: { pageNumber: 3 },
    pageCount: 7,
  });
  assert.equal(first.split('TEXT-REBUILD SOURCE.').length - 1, 1);
  assert.equal(second.split('TEXT-REBUILD SOURCE.').length - 1, 1);
  assert.match(first, /Name Hunt/);
  assert.doesNotMatch(first, /MY NAME PACK/);
  assert.equal(stripTextRebuildWrapper(second).includes('Name Hunt'), true);
});

test('text-free and non-page jobs do not take the rebuild wrapper', () => {
  assert.equal(shouldApplyTextRebuildSource({ textFree: true, job: { kind: 'page' } }), false);
  assert.equal(shouldApplyTextRebuildSource({ project: { projectType: 'storybook' }, job: { kind: 'story_page' } }), false);
  assert.equal(shouldApplyTextRebuildSource({ job: { kind: 'thumbnail' } }), false);
  assert.equal(shouldApplyTextRebuildSource({ job: { kind: 'page' } }), true);
});

test('quoted copy extraction keeps unique strings and ignores control labels', () => {
  assert.deepEqual(
    extractQuotedCopy('Title "Hello" and Title "Hello" then "Count to 3."'),
    ['Hello', 'Count to 3.']
  );
});

test('prompt planning asks for quoted copy on pale bands and never says editable', () => {
  const request = buildPromptsGenerationRequest(7, 'A4', 'portrait');
  assert.match(request, /EXACT text inside quotation marks/);
  assert.match(request, /flat pale paper bands/);
  assert.match(request, /not collage letters/);
  assert.doesNotMatch(request, /TEXT-REBUILD SOURCE/);
  assert.doesNotMatch(request, /\beditable\b/i);
});
