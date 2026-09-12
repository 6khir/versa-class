'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveGenerationMode,
  resolveStoredGenerationMode,
  persistGenerationMode,
  applyEditableMasterPrompt,
  isolateCurrentPagePrompt,
  neutralizePaintedCopy,
  ZERO_TEXT_CONTRACT,
  TEXT_FREE_TRIGGER,
} = require('../src/editable-mode.cjs');

test('generation mode defaults to fixed and ignores productFormat', () => {
  assert.equal(resolveGenerationMode({}), 'fixed');
  assert.equal(resolveGenerationMode({ productFormat: 'editable' }), 'fixed');
  assert.equal(resolveGenerationMode({ mode: 'editable' }), 'editable');
  assert.equal(resolveGenerationMode({ generationMode: 'editable' }), 'editable');
});

test('stored mode is explicit and never inferred from productFormat', () => {
  const settings = new Map();
  const store = {
    getSetting: (key, fallback = null) => (settings.has(key) ? settings.get(key) : fallback),
    setSetting: (key, value) => settings.set(key, value),
  };
  const project = { id: 'p1', productFormat: 'editable' };
  assert.equal(resolveStoredGenerationMode(store, project), 'fixed');
  persistGenerationMode(store, 'p1', 'editable');
  assert.equal(resolveStoredGenerationMode(store, project), 'editable');
});

test('generation mode is an explicit IPC and is not tied to productFormat', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.cjs'), 'utf8');
  assert.match(main, /project:set-generation-mode/);
  assert.match(main, /persistGenerationMode/);
  assert.match(preload, /setProjectGenerationMode/);
  assert.ok(main.indexOf('project:set-format') < main.indexOf('project:set-generation-mode'));
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8');
  assert.match(renderer, /toggle-generation-mode/);
  const pipeline = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8');
  assert.match(pipeline, /prepareTextFreeManifests/);
  assert.match(pipeline, /persistModeForNewBook/);
  assert.match(pipeline, /isTextFreeProject/);
});

test('editable master prompt strips baked-text contracts and lists reserved zones', () => {
  const prompt = applyEditableMasterPrompt({
    prompt: 'Paint a classroom page titled PAGE 5 — NAME HUNT. The image must contain ONLY the following text: "Hello" "World" Create exactly one A4 page in portrait orientation. Do not add a second page, or any page number.',
    project: { theme: 'washable-marker' },
    job: { pageNumber: 3, kind: 'interior' },
    pageCount: 7,
  });
  assert.match(prompt, /ZERO letters/);
  assert.match(prompt, /text-free master/);
  assert.match(prompt, /no baked text/);
  assert.match(prompt, /title /);
  assert.match(prompt, /no page numbers/);
  assert.match(prompt, /Do not reply with text/);
  assert.equal(prompt.includes(TEXT_FREE_TRIGGER), true);
  assert.ok(prompt.includes(ZERO_TEXT_CONTRACT.slice(0, 24)));
  assert.doesNotMatch(prompt, /ONLY the following text/i);
  assert.doesNotMatch(prompt, /"Hello"/);
  assert.doesNotMatch(prompt, /PAGE 5/i);
  assert.doesNotMatch(prompt, /\beditable\b/i);
  assert.match(prompt, /or any page number/);
});

test('text-free wrap isolates one page and strips baked lettering before the contract', () => {
  const dump = [
    '@image Front Cover page with bold white hand-cut lettering centered: "VERSA CLASS MAKES SUCCESS".',
    'Large construction-paper titles made of cutouts: "MY NAME ACTIVITY PACK" and "AUTOFILLED NAME PRACTICE".',
    'Scattered letter shapes (A, B, C) and a burst sticker: "EDITABLE FOR YOUR CLASS!".',
    'Create exactly one final image only.Page 2: @image Interior Page titled NAME PRACTICE MAT. Title at the top in cutout letters: "NAME PRACTICE MAT".',
  ].join(' ');
  const isolated = isolateCurrentPagePrompt(dump, 1);
  assert.match(isolated, /Front Cover/i);
  assert.doesNotMatch(isolated, /NAME PRACTICE MAT/);
  assert.doesNotMatch(neutralizePaintedCopy(isolated), /MY NAME ACTIVITY PACK/);
  assert.doesNotMatch(neutralizePaintedCopy(isolated), /letter shapes/i);
  const prompt = applyEditableMasterPrompt({
    prompt: dump,
    project: { theme: 'construction-paper' },
    job: { pageNumber: 1, kind: 'cover' },
    pageCount: 7,
  });
  assert.match(prompt, /^@image CRITICAL OVERRIDE/i);
  assert.match(prompt, /text-free master/);
  assert.doesNotMatch(prompt, /MY NAME ACTIVITY PACK/);
  assert.doesNotMatch(prompt, /NAME PRACTICE MAT/);
  assert.doesNotMatch(prompt, /lettering/i);
  assert.doesNotMatch(prompt, /letter shapes/i);
  assert.doesNotMatch(prompt, /\beditable\b/i);
  assert.ok(prompt.indexOf('CRITICAL OVERRIDE') < prompt.indexOf('Front Cover'));
});
