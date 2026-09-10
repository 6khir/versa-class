'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const browserSource = readFileSync(join(__dirname, '../src/browser-controller.cjs'), 'utf8');
const mainSource = readFileSync(join(__dirname, '../src/main.cjs'), 'utf8');

test('close() aborts in-flight waits but does not leave Analyze paused', () => {
  assert.match(browserSource, /async close\(\) \{\s*this\.cancelWaits\(\);\s*this\.abortRequested = false;/);
  assert.match(browserSource, /cancelWaits\(\) \{\s*this\.abortRequested = true;\s*this\.cancelVersion \+= 1;/);
});

test('URL analysis and prompt generation start by clearing leftover pause', () => {
  assert.match(browserSource, /async analyzeProductWithGpt[\s\S]{0,400}this\.beginWork\(\)/);
  assert.match(browserSource, /async generatePromptsWithGpt[\s\S]{0,1200}this\.beginWork\(\)/);
  assert.match(browserSource, /async close\(\) \{\s*this\.cancelWaits\(\);\s*this\.abortRequested = false;/);
});

test('Gemini prompt waits observe drafting vs lag vs finished instead of a 1s poll', () => {
  assert.match(browserSource, /#waitForAssistantTextObservation/);
  assert.match(browserSource, /#observeGeminiAssistant/);
  assert.match(browserSource, /#expandCollapsedAssistant/);
  assert.match(browserSource, /classifyGeminiTextObservation/);
  assert.match(browserSource, /decideGeminiTextAction/);
  assert.match(browserSource, /maxDraftMs: 10 \* 60_000/);
  assert.doesNotMatch(
    browserSource,
    /async waitForAssistantTextResponse[\s\S]{0,900}if \(stableCount >= 2\) return text;/
  );
  assert.match(browserSource, /reuseCurrentPage: round > 0/);
  assert.match(browserSource, /buildPromptsContinuationRequest/);
  assert.match(browserSource, /Gemini lagged on a/);
});

test('assistant text is read from textContent so collapsed Gemini drafts are not truncated', () => {
  assert.match(browserSource, /evaluate\(\(element\) => String\(element\.textContent \|\| element\.innerText \|\| ''\)\)/);
});

test('main keeps parsed batch prompts instead of re-slicing a truncated transcript', () => {
  assert.match(mainSource, /Array\.isArray\(result\.prompts\) && result\.prompts\.length/);
  assert.match(mainSource, /Content Gem prompt batch: pages/);
});
