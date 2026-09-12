'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { detectProductFormat } = require('../src/product-format-detector.cjs');

test('an explicit productFormat from the analysis always wins', () => {
  assert.equal(detectProductFormat({ productFormat: 'editable' }).productFormat, 'editable');
  assert.equal(detectProductFormat({ productFormat: 'static' }).productFormat, 'static');
  assert.equal(detectProductFormat({ productFormat: 'maze' }).productFormat, 'maze');
  // Even when the text disagrees, the gem's own answer is authoritative.
  assert.equal(detectProductFormat({ productFormat: 'static', description: 'fully editable PowerPoint' }).productFormat, 'static');
});

test('maze in the listing title overrides a gem that declared static', () => {
  assert.equal(detectProductFormat(
    { productFormat: 'static', title: 'Johnny Appleseed & Apples: Foldable Mini Activity Book for Fall' },
    { title: 'Johnny Appleseed and Apple Activity Book Word Search Maze Tracing Coloring Page' }
  ).productFormat, 'maze');
});

test('a search keyword alone does not classify an unrelated listing as maze', () => {
  assert.equal(detectProductFormat(
    { productFormat: 'static', title: 'EXPLORING CENSORSHIP & LITERARY FREEDOM: Middle & High School Critical Thinking Unit' },
    { title: 'BANNED BOOKS WEEK Activities Literary Censorship Worksheets Reading Project PACK', keyword: 'maze puzzle book' }
  ).productFormat, 'static');
});

test('maze listings are not misclassified as editable', () => {
  for (const listing of [
    { title: 'Kindergarten Maze Book', description: 'Printable maze puzzles with an answer key.' },
    { description: 'A labyrinth activity pack for early finishers.' }
  ]) {
    const r = detectProductFormat({}, listing);
    assert.equal(r.productFormat, 'maze', JSON.stringify(listing));
  }
  assert.equal(detectProductFormat({}, { title: 'EDITABLE Name Tracing Templates' }).productFormat, 'editable');
});

test('editable listings are detected when the analysis omits the field', () => {
  for (const listing of [
    { title: 'EDITABLE Name Tracing Templates' },
    { description: 'Comes as a PowerPoint you can customise.' },
    { description: 'Fully editable Google Slides resource.' },
    { keyHighlights: ['Editable text boxes', 'Type in your own words'] },
    { formats: ['PPTX', 'PDF'] }
  ]) {
    const r = detectProductFormat({}, listing);
    assert.equal(r.productFormat, 'editable', JSON.stringify(listing));
    assert.equal(r.source, 'listing-signals');
  }
});

test('static printables are not misread as editable', () => {
  for (const listing of [
    { title: 'Print and Go Math Worksheets', description: 'No prep printable PDF.' },
    { description: 'This resource is not editable. PDF only.' },
    { title: 'Color by Code Seasonal Pack', description: 'Just print and hand out.' },
    { description: 'A digital resource with printable pages.' }
  ]) {
    assert.equal(detectProductFormat({}, listing).productFormat, 'static', JSON.stringify(listing));
  }
});

test('an explicit "not editable" outweighs the word editable', () => {
  const r = detectProductFormat({}, { description: 'These templates are NOT editable — printable PDF only.' });
  assert.equal(r.productFormat, 'static');
});

test('empty input falls back to static', () => {
  assert.equal(detectProductFormat(null, null).productFormat, 'static');
  assert.equal(detectProductFormat({}, {}).productFormat, 'static');
});

test('the analysis result carries the detected format to the dialog', () => {
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const main = readFileSync(join(__dirname, '..', 'src', 'main.cjs'), 'utf8');
  // The handler must return the decision, not just apply it to the project.
  assert.match(main, /detectedFormat: detected/);
  assert.match(main, /const detected = detectProductFormat\(analysis, \{ \.\.\.listing, rawText: result\.rawText \}\)/);
  assert.match(main, /productFormat: detected\.productFormat/);

  const renderer = readFileSync(join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8');
  // The dialog applies it instead of asking, and hides the options.
  assert.match(renderer, /function applyDetectedPipeline/);
  assert.match(renderer, /applyDetectedPipeline\(result\.detectedFormat\)/);
  assert.match(renderer, /option\.hidden = true/);
});
