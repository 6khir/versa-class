'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const { PIPELINE_STEPS, EDITABLE_PIPELINE, STEP_DEPENDENCIES } = require('../src/automation-manager.cjs');

// The SEO stage was removed from the product. These tests exist so it cannot creep
// back in halfway - a dead pipeline entry, an orphaned button, a preload bridge to an
// IPC handler that no longer answers - each of which fails at runtime rather than here.

test('neither pipeline runs a listing stage', () => {
  assert.ok(!PIPELINE_STEPS.includes('listing'));
  assert.ok(!EDITABLE_PIPELINE.includes('listing'));
  assert.equal(STEP_DEPENDENCIES.listing, undefined);
  // Export now follows preview directly in both pipelines.
  assert.deepEqual(STEP_DEPENDENCIES.export, ['preview']);
  assert.equal(PIPELINE_STEPS.at(-1), 'export');
});

test('no main-process code generates or parses a listing', () => {
  const main = read('src/main.cjs');
  for (const gone of [
    'project:generate-tpt-listing',
    'project:regenerate-tpt-field',
    'project:clear-tpt-listing',
    'parseTptListingResponse',
    'applyListingDefaults',
    'isSeoAutomationComplete'
  ]) {
    assert.ok(!main.includes(gone), `main.cjs still references ${gone}`);
  }
  const controller = read('src/browser-controller.cjs');
  assert.ok(!controller.includes('generateTptListingWithGpt'));
  assert.ok(!controller.includes('regenerateTptListingFieldWithGpt'));
  const builder = read('src/prompt-builder.cjs');
  for (const gone of ['buildTptListingPrompt', 'parseTptListingResponse', 'SEO_PROMPT_LEAD']) {
    assert.ok(!builder.includes(gone), `prompt-builder.cjs still references ${gone}`);
  }
});

test('the TPT taxonomy vocabulary is gone with the stage that used it', () => {
  assert.ok(!fs.existsSync(path.join(root, 'src/tpt-taxonomy.cjs')));
  for (const file of ['src/main.cjs', 'src/prompt-builder.cjs', 'src/browser-controller.cjs']) {
    assert.ok(!read(file).includes('tpt-taxonomy'), `${file} still requires the taxonomy module`);
  }
});

// A preload bridge whose IPC handler was deleted throws only when a user clicks it.

test('no preload bridge points at a removed handler', () => {
  const preload = read('src/preload.cjs');
  for (const gone of ['generateTptListing:', 'regenerateTptField:', 'clearTptListing:', 'debugAgentLog:']) {
    assert.ok(!preload.includes(gone), `preload.cjs still exposes ${gone}`);
  }
});

test('no SEO surface is left in the interface', () => {
  const html = read('renderer/index.html');
  for (const gone of [
    'data-view-target="listing"',
    'data-workspace-pane="listing"',
    'data-settings-panel="listing"',
    'data-stage="listing"',
    'id="auto-step-listing"',
    'id="tpt-listing-review"',
    'id="overview-listing-status"',
    'id="settings-listing-tags"'
  ]) {
    assert.ok(!html.includes(gone), `index.html still contains ${gone}`);
  }
  const renderer = read('renderer/renderer.js');
  for (const gone of [
    "'generate-tpt-listing'",
    "'clear-tpt-listing'",
    "'regenerate-tpt-field'",
    "'copy-seo-bundle'",
    "'save-tpt-publication-settings'",
    'tptListingHtml',
    'settingsListingTags'
  ]) {
    assert.ok(!renderer.includes(gone), `renderer.js still references ${gone}`);
  }
  assert.ok(!read('renderer/ui.js').includes('generate-tpt-listing'));
});

// Everything downstream of the removed stage has to keep working on its own.

test('mockups still have a source and four briefs without a listing stage', () => {
  const main = read('src/main.cjs');
  const start = main.indexOf('async function ensureListingShellForAssets(');
  assert.ok(start > -1, 'the shell that feeds mockups and preview must survive');
  const body = main.slice(start, main.indexOf('\n}\n', start));
  // productPdfPath is what the mockups and preview steps gate on, and the briefs are
  // what the mockup prompts are built from. Both came from the SEO stage as well.
  assert.match(body, /productPdfPath:/);
  assert.match(body, /defaultBriefs/);
  assert.match(body, /Hero mockup for \$\{project\.name/);
});

test('the compiled document survives, because mockups and the preview gate read it', () => {
  const main = read('src/main.cjs');
  assert.match(main, /async function ensureMarketingGroundTruth\(projectId\)/);
  assert.match(main, /async function ensureSeoBookDocument\(projectId/);
  // The preview still waits on it as its completeness gate.
  assert.match(main, /await ensureMarketingGroundTruth\(projectId\);/);
});

test('stored listing fields are kept so the TPT upload flow still has copy to send', () => {
  // Removing the stage removed the generator, not the record it wrote into.
  assert.ok(fs.existsSync(path.join(root, 'src/seo-state.cjs')));
  const controller = read('src/browser-controller.cjs');
  assert.match(controller, /async runTptListingPreparation\(/);
  const builder = read('src/prompt-builder.cjs');
  assert.match(builder, /function formatSeoBundleText/);
  assert.match(builder, /function sanitizeSeoListingFields/);
});
