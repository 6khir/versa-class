'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  GEMINI_TEXT_PHASE,
  LAG_MS,
  EMPTY_LAG_SHRINK_MS,
  PARTIAL_LAG_ACCEPT_MS,
  ANALYSIS_LAG_RETRY_MS,
  SETTLE_MS,
  classifyGeminiTextObservation,
  decideGeminiTextAction,
  nextPromptBatchSize,
  shouldReadFullGeminiTranscript,
  analysisDraftUsable
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
  assert.equal(decision.pollMs, 700);
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

test('two identical busy samples a second apart stay drafting, not finished', () => {
  const observation = classifyGeminiTextObservation({
    inProgress: true,
    text: 'Page 1: @image a complete printable page prompt with enough visual detail for generation.',
    previousText: 'Page 1: @image a complete printable page prompt with enough visual detail for generation.',
    expectedCount: 50,
    parsedCount: 1,
    now,
    startedAt: now - 2_000,
    lastGrowthAt: now - 1_000
  });
  assert.equal(observation.phase, GEMINI_TEXT_PHASE.DRAFTING);
  assert.equal(decideGeminiTextAction(observation).action, 'wait');
});

test('a live analysis draft that grew recently is not recycled just because the job is older than 20s', () => {
  const observation = classifyGeminiTextObservation({
    inProgress: true,
    text: '{"title":"Mazes","description":"Growing',
    previousText: '{"title":"Mazes"',
    expectedCount: 0,
    parsedCount: 0,
    now,
    startedAt: now - 25_000,
    lastGrowthAt: now - 2_000
  });
  assert.equal(decideGeminiTextAction(observation).action, 'wait');
});

test('analysis lag past 20s recycles instead of waiting out the three-minute cap', () => {
  const observation = classifyGeminiTextObservation({
    inProgress: true,
    text: '',
    previousText: '',
    expectedCount: 0,
    parsedCount: 0,
    now,
    startedAt: now - ANALYSIS_LAG_RETRY_MS,
    lastGrowthAt: now - ANALYSIS_LAG_RETRY_MS
  });
  const decision = decideGeminiTextAction(observation, { lagRetryMs: ANALYSIS_LAG_RETRY_MS });
  assert.equal(decision.action, 'retry');
  assert.equal(decision.reason, 'lag-recycle-tab');
});

test('analysis lag recycles by default without an explicit lagRetryMs', () => {
  const observation = classifyGeminiTextObservation({
    inProgress: true,
    text: '',
    previousText: '',
    expectedCount: 0,
    parsedCount: 0,
    now,
    startedAt: now - ANALYSIS_LAG_RETRY_MS,
    lastGrowthAt: now - ANALYSIS_LAG_RETRY_MS
  });
  assert.equal(decideGeminiTextAction(observation).action, 'retry');
  assert.equal(decideGeminiTextAction(observation).reason, 'lag-recycle-tab');
});

test('analysis with no generated title recycles after 20s even while Gemini looks busy', () => {
  const observation = classifyGeminiTextObservation({
    inProgress: true,
    text: '',
    previousText: '',
    expectedCount: 0,
    parsedCount: 0,
    now,
    startedAt: now - 20_000,
    lastGrowthAt: now - 20_000
  });
  assert.equal(decideGeminiTextAction(observation).action, 'retry');
  assert.equal(decideGeminiTextAction(observation).reason, 'lag-recycle-tab');
});

test('leftover Gemini chat without a title JSON recycles after 20s', () => {
  const observation = classifyGeminiTextObservation({
    inProgress: true,
    text: 'Sure — I can help with that leftover reply from the last chat.',
    previousText: 'Sure — I can help with that leftover reply from the last chat.',
    expectedCount: 0,
    parsedCount: 1,
    now,
    startedAt: now - ANALYSIS_LAG_RETRY_MS,
    lastGrowthAt: now - ANALYSIS_LAG_RETRY_MS
  });
  const decision = decideGeminiTextAction(observation);
  assert.equal(decision.action, 'retry');
  assert.equal(decision.reason, 'lag-recycle-tab');
});

test('empty idle analysis waits for the caller timeout instead of failing at 20s', () => {
  const observation = classifyGeminiTextObservation({
    inProgress: false,
    text: '',
    previousText: '',
    expectedCount: 0,
    parsedCount: 0,
    now,
    startedAt: now - 20_000,
    lastGrowthAt: now - 20_000
  });
  assert.equal(observation.phase, GEMINI_TEXT_PHASE.FAILED);
  assert.equal(decideGeminiTextAction(observation, { lagRetryMs: 90_000 }).action, 'wait');
  assert.equal(decideGeminiTextAction(observation, { lagRetryMs: ANALYSIS_LAG_RETRY_MS }).action, 'retry');
});

test('analysis replies without a page quota keep waiting while Gemini is busy', () => {
  const observation = classifyGeminiTextObservation({
    inProgress: true,
    text: '{"title":"Workbook"}',
    previousText: '{"title":"W',
    expectedCount: 0,
    parsedCount: 0,
    now,
    startedAt: now - 4_000,
    lastGrowthAt: now
  });
  assert.equal(observation.phase, GEMINI_TEXT_PHASE.DRAFTING);
  assert.equal(decideGeminiTextAction(observation).action, 'wait');
});

test('a settled analysis JSON is accepted even if Stop is still up', () => {
  const observation = classifyGeminiTextObservation({
    inProgress: true,
    text: '{"title":"Johnny Appleseed Mazes","description":"Seasonal packet","pageCount":24}',
    previousText: '{"title":"Johnny Appleseed Mazes","description":"Seasonal packet","pageCount":24}',
    expectedCount: 0,
    parsedCount: 1,
    now,
    startedAt: now - 8_000,
    lastGrowthAt: now - SETTLE_MS - 200
  });
  assert.equal(observation.phase, GEMINI_TEXT_PHASE.FINISHED);
  assert.equal(observation.reason, 'busy-but-analysis-ready');
  assert.equal(decideGeminiTextAction(observation).action, 'accept');
});

test('analysis JSON without a title key is still usable when pageCount and description landed', () => {
  const draft = '{"description":"Apple maze packet","pageCount":20,"targetAge":"K-2"}';
  assert.equal(analysisDraftUsable(draft), true);
  const observation = classifyGeminiTextObservation({
    inProgress: false,
    text: draft,
    previousText: draft,
    expectedCount: 0,
    parsedCount: 1,
    now,
    startedAt: now - 6_000,
    lastGrowthAt: now - 2_000
  });
  assert.equal(observation.phase, GEMINI_TEXT_PHASE.FINISHED);
  assert.equal(decideGeminiTextAction(observation).action, 'accept');
});

test('leftover chat without analysis JSON is not treated as a finished product', () => {
  assert.equal(analysisDraftUsable('Sure — I can help with that leftover reply from the last chat.'), false);
});

test('an idle leftover Gemini reply without analysis JSON is not accepted', () => {
  const leftover = 'Sure — I can help with that leftover reply from the last chat.';
  const observation = classifyGeminiTextObservation({
    inProgress: false,
    text: leftover,
    previousText: leftover,
    expectedCount: 0,
    parsedCount: 0,
    now,
    startedAt: now - 4_000,
    lastGrowthAt: now - 3_000
  });
  assert.notEqual(observation.phase, GEMINI_TEXT_PHASE.FINISHED);
  assert.equal(decideGeminiTextAction(observation).action, 'wait');
});

test('batch size halves until the 10-page floor', () => {
  assert.equal(nextPromptBatchSize(50), 25);
  assert.equal(nextPromptBatchSize(25), 13);
  assert.equal(nextPromptBatchSize(13), 10);
  assert.equal(nextPromptBatchSize(10), 10);
});

test('drafting growth can be detected from length without re-reading the full transcript', () => {
  const observation = classifyGeminiTextObservation({
    inProgress: true,
    text: 'Page 40: @image …',
    previousText: 'Page 40: @image …',
    textLength: 48_000,
    previousLength: 40_000,
    expectedCount: 50,
    parsedCount: 12,
    now,
    startedAt: now - 20_000,
    lastGrowthAt: now
  });
  assert.equal(observation.phase, GEMINI_TEXT_PHASE.DRAFTING);
  assert.equal(observation.grew, true);
});

test('full transcript reads wait until Gemini is idle or the draft stalls', () => {
  assert.equal(shouldReadFullGeminiTranscript({ inProgress: true, sinceGrowth: 1_000 }), false);
  assert.equal(shouldReadFullGeminiTranscript({ inProgress: true, sinceGrowth: 9_000 }), true);
  assert.equal(shouldReadFullGeminiTranscript({ inProgress: false }), true);
  assert.equal(shouldReadFullGeminiTranscript({ inProgress: true, collapsedVisible: true }), true);
});
