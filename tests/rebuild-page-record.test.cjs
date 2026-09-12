'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PAGE_STATES,
  createPlannedPage,
  ensureRebuildPlan,
  isRebuildPipelineEnabled,
  persistRebuildPipeline,
  plannedCopyFromJob,
  recordToLegacyManifest,
  setPageState,
} = require('../src/rebuild-page-record.cjs');

test('planned copy is taken from quoted prompt text and never inferred from OCR', () => {
  const copy = plannedCopyFromJob({
    prompt: 'ONLY the following text: "Let\'s Hunt Names" "Circle your name." "A B C" "Name: ________"',
    title: 'Wrong OCR Title',
  });
  assert.equal(copy.title, "Let's Hunt Names");
  assert.equal(copy.instruction, 'Circle your name.');
  assert.equal(copy.body, 'A B C');
  assert.equal(copy.footer, 'Name: ________');
});

test('page records follow the explicit state machine and persist by pageId', () => {
  const settings = new Map();
  const store = {
    getSetting: (key, fallback = null) => (settings.has(key) ? settings.get(key) : fallback),
    setSetting: (key, value) => settings.set(key, value),
  };
  const project = {
    id: 'book-1',
    theme: 'washable-marker',
    jobs: [
      { id: 'j1', pageNumber: 1, kind: 'cover', imagePrompt: '@image Cover "Name Pack" "Practice every day."' },
      { id: 'j2', pageNumber: 2, kind: 'page', imagePrompt: '@image Interior "Name Hunt" "Circle your name."' },
      { id: 'j3', pageNumber: 3, kind: 'back', imagePrompt: '@image Back "Thank You"' },
    ],
  };
  persistRebuildPipeline(store, project.id, true);
  assert.equal(isRebuildPipelineEnabled(store, project), true);
  const pages = ensureRebuildPlan(store, project);
  assert.equal(pages.length, 3);
  assert.equal(pages[0].pageRole, 'front-cover');
  assert.equal(pages[1].pageRole, 'interior');
  assert.equal(pages[2].pageRole, 'back-cover');
  assert.equal(pages[1].state, 'PLANNED');
  assert.equal(pages[1].plannedCopy.title, 'Name Hunt');
  const generating = setPageState(pages[1], 'GENERATING');
  assert.equal(generating.state, 'GENERATING');
  assert.ok(PAGE_STATES.includes('IDENTITY_SAVED'));
  const manifest = recordToLegacyManifest(pages[1]);
  assert.equal(manifest.zones[0].text, 'Name Hunt');
  assert.doesNotMatch(JSON.stringify(manifest), /\beditable\b/);
});

test('rebuild pipeline stays off unless explicitly enabled and never follows text-free mode', () => {
  const settings = new Map([['generationMode:p1', 'editable']]);
  const store = {
    getSetting: (key, fallback = null) => (settings.has(key) ? settings.get(key) : fallback),
    setSetting: (key, value) => settings.set(key, value),
  };
  assert.equal(isRebuildPipelineEnabled(store, { id: 'p1' }), false);
  persistRebuildPipeline(store, 'p1', true);
  assert.equal(isRebuildPipelineEnabled(store, { id: 'p1' }), false);
});
