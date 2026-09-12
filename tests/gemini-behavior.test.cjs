'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyGeminiDraft,
  isGeminiChromeNoise,
  recoveryPauseMs
} = require('../src/gemini-behavior.cjs');

test('leftover custom-gem image chrome is a dead tab, not an analysis', () => {
  const chrome = 'TPT Book Pages Creation Pro Custom GemCreating your image\n\nTPT Book Pages Creation Pro Custom GemCreating your image';
  const verdict = classifyGeminiDraft(chrome, { inProgress: false });
  assert.equal(verdict.behavior, 'image-mode');
  assert.equal(verdict.dead, true);
  assert.equal(isGeminiChromeNoise(chrome), true);
});

test('a parseable analysis is ready even if Stop is still up', () => {
  const verdict = classifyGeminiDraft('{"title":"Autumn Mazes","pageCount":12}', { analysisReady: true, inProgress: true });
  assert.equal(verdict.behavior, 'analysis-ready');
  assert.equal(verdict.dead, false);
});

test('an empty leftover reply is idle, not a crashed tab', () => {
  const verdict = classifyGeminiDraft('', { inProgress: false });
  assert.equal(verdict.behavior, 'empty');
  assert.equal(verdict.dead, false);
  assert.equal(isGeminiChromeNoise(''), false);
});

test('rate limits pause longer than a dead-tab recycle', () => {
  assert.equal(recoveryPauseMs(1, 'dead'), 0);
  assert.equal(recoveryPauseMs(3, 'chrome-noise'), 20_000);
  assert.equal(recoveryPauseMs(1, 'rate-limit'), 60_000);
});
