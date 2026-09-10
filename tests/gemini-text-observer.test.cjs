'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  GEMINI_TEXT_PHASE,
  LAG_MS,
  EMPTY_LAG_SHRINK_MS,
  PARTIAL_LAG_ACCEPT_MS,
  classifyGeminiTextObservation,
  decideGeminiTextAction,
  nextPromptBatchSize
} = require('../src/gemini-text-observer.cjs');

const now = 1_000_000;

test('Gemini still drafting while the stop button is up and text is growing', () => {
  const observation = classifyGeminiTextObservation({
    inProgress: true,
    text: 'Page 1: @image a long printable worksheet prompt with margins and labels.',
    previousText: 'Page 1: @image a',
    expectedCount: 50,
    parsedCount: 1,
    now,
    startedAt: now - 5_000,
    lastGrowthAt: now
  });
  assert.equal(observation.phase, GEMINI_TEXT_PHASE.DRAFTING);
  const decision = decideGeminiTextAction(observation, { batchSize: 50 });
  assert.equal(decision.action, 'wait');
  assert.equal(decision.pollMs, 150);
});

test('Gemini lag on a heavy request is distinct from a finished draft', () => {
  const observation = classifyGeminiTextObservation({
    inProgress: true,
    text: '',
    previousText: '',
    expectedCount: 50,
    parsedCount: 0,
    now,
    startedAt: now - EMPTY_LAG_SHRINK_MS,
    lastGrowthAt: now - LAG_MS - 1_000
  });
  assert.equal(observation.phase, GEMINI_TEXT_PHASE.LAGGING);
  const decision = decideGeminiTextAction(observation, { batchSize: 50 });
  assert.equal(decision.action, 'shrink');
  assert.equal(decision.nextBatchSize, 25);
});

test('a stalled mid-draft with some pages is accepted as a partial, then continued', () => {
  const observation = classifyGeminiTextObservation({
    inProgress: true,
    text: 'Page 1: @image a complete printable page prompt with enough visual detail for generation.',
    previousText: 'Page 1: @image a complete printable page prompt with enough visual detail for generation.',
    expectedCount: 50,
    parsedCount: 21,
    now,
    startedAt: now - 90_000,
    lastGrowthAt: now - PARTIAL_LAG_ACCEPT_MS
  });
  assert.equal(observation.phase, GEMINI_TEXT_PHASE.LAGGING);
  const decision = decideGeminiTextAction(observation, { batchSize: 50 });
  assert.equal(decision.action, 'accept-partial');
});

test('Gemini finished prompting when it is idle and the batch quota is met', () => {
  const observation = classifyGeminiTextObservation({
    inProgress: false,
    text: 'done',
    previousText: 'done',
    expectedCount: 50,
    parsedCount: 50,
    now,
    startedAt: now - 80_000,
    lastGrowthAt: now - 2_000
  });
  assert.equal(observation.phase, GEMINI_TEXT_PHASE.FINISHED);
  assert.equal(decideGeminiTextAction(observation).action, 'accept');
});

test('a stable short reply means continue, not done', () => {
  const observation = classifyGeminiTextObservation({
    inProgress: false,
    text: 'partial',
    previousText: 'partial',
    expectedCount: 50,
    parsedCount: 21,
    now,
    startedAt: now - 40_000,
    lastGrowthAt: now - 5_000
  });
  assert.equal(observation.phase, GEMINI_TEXT_PHASE.INCOMPLETE);
  assert.equal(decideGeminiTextAction(observation).action, 'continue');
});

test('collapsed Show more is expanded before the draft is treated as finished', () => {
  const observation = classifyGeminiTextObservation({
    inProgress: false,
    text: 'truncated',
    previousText: 'truncated',
    expectedCount: 50,
    parsedCount: 8,
    collapsedVisible: true,
    now,
    startedAt: now - 20_000,
    lastGrowthAt: now - 5_000
  });
  assert.equal(observation.phase, GEMINI_TEXT_PHASE.COLLAPSED);
  assert.equal(decideGeminiTextAction(observation).action, 'expand');
});

test('analysis replies without a page quota keep waiting while Gemini is busy', () => {
  const observation = classifyGeminiTextObservation({
    inProgress: true,
    text: '{"title":"Workbook"}',
    previousText: '{"title":"Workbook"}',
    expectedCount: 0,
    parsedCount: 1,
    now,
    startedAt: now - 20_000,
    lastGrowthAt: now - 15_000
  });
  assert.equal(observation.phase, GEMINI_TEXT_PHASE.DRAFTING);
  assert.equal(decideGeminiTextAction(observation).action, 'wait');
});

test('batch size halves until the 10-page floor', () => {
  assert.equal(nextPromptBatchSize(50), 25);
  assert.equal(nextPromptBatchSize(25), 13);
  assert.equal(nextPromptBatchSize(13), 10);
  assert.equal(nextPromptBatchSize(10), 10);
});
