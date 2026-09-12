const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseGeneratedPrompts,
  looksLikePageImagePrompt
} = require('../src/prompt-builder.cjs');

test('looksLikePageImagePrompt rejects JSON debris and accepts a visual page prompt', () => {
  assert.equal(looksLikePageImagePrompt('JSON'), false);
  assert.equal(looksLikePageImagePrompt('@image JSON'), false);
  assert.equal(looksLikePageImagePrompt('{'), false);
  assert.equal(looksLikePageImagePrompt('"title": "First Then Board"'), false);
  assert.equal(looksLikePageImagePrompt('@image A colorful teacher-made first-then board worksheet for special education with large icons, exact labels in quotes, and safe print margins on A4 portrait 2480 × 3508 px.'), true);
});

test('parseGeneratedPrompts drops JSON commentary and keeps real @image lines', () => {
  const prompts = parseGeneratedPrompts([
    'JSON',
    '{',
    '  "title": "First Then Board",',
    'Page 1: @image A colorful teacher-made first-then board worksheet for special education with large icons, exact labels in quotes, and safe print margins on A4 portrait 2480 × 3508 px.',
    '}'
  ].join('\n'), 1);
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /^@image /);
  assert.match(prompts[0], /first-then board/i);
});

test('parseGeneratedPrompts throws when the gem only returned JSON', () => {
  assert.throws(
    () => parseGeneratedPrompts('JSON\n{\n  "title": "x"\n}', 4),
    (error) => error.code === 'PROMPTS_NOT_PARSED'
  );
});

const {
  buildPromptsGenerationRequest,
  buildPromptsContinuationRequest,
  promptPageBatches,
  PROMPT_BATCH_SIZE,
  inspectGeneratedPromptProgress,
  estimatePromptProgressFromSample,
  mergeGeneratedPromptSlots
} = require('../src/prompt-builder.cjs');

function samplePageLine(page) {
  return `Page ${page}: @image A colorful teacher-made first-then board worksheet for special education with large icons, exact labels in quotes, and safe print margins on A4 portrait 2480 × 3508 px. Activity ${page}.`;
}

test('promptPageBatches splits a 500-page book into 50-page Gemini phases', () => {
  assert.equal(PROMPT_BATCH_SIZE, 50);
  const plan = promptPageBatches(500);
  assert.equal(plan.total, 500);
  assert.equal(plan.batches.length, 10);
  assert.deepEqual(plan.batches[0], { startPage: 1, endPage: 50 });
  assert.deepEqual(plan.batches[9], { startPage: 451, endPage: 500 });
  assert.equal(promptPageBatches(21).batches.length, 1);
});

test('prompt plan labels every page as K of N with a role and no on-page folio', () => {
  const request = buildPromptsGenerationRequest(7, 'A4', 'portrait');
  assert.match(request, /Page 1 of 7 — Cover:/);
  assert.match(request, /Page K of 7/);
  assert.match(request, /Never write a second cover/);
  assert.match(request, /prompt metadata only/);
});

test('continuation batches tell Gemini not to repeat earlier pages', () => {
  const first = buildPromptsGenerationRequest(500, 'LETTER', 'portrait');
  assert.match(first, /exactly 500 pages/i);
  assert.doesNotMatch(first, /THIS BATCH/i);
  const next = buildPromptsGenerationRequest(500, 'LETTER', 'portrait', {
    startPage: 51,
    endPage: 100,
    alreadyHave: 50
  });
  assert.match(next, /THIS BATCH: write pages 51–100/i);
  assert.match(next, /already wrote pages 1–50/i);
  assert.match(next, /exactly 50 prompt lines for pages 51–100/i);
  const continuation = buildPromptsContinuationRequest(500, 'LETTER', 'portrait', {
    startPage: 51,
    endPage: 100,
    alreadyHave: 50
  });
  assert.match(continuation, /Do not repeat those pages/i);
  assert.match(continuation, /pages 51 through 100/i);
});

test('parseGeneratedPrompts splits glued Page N: dumps into one prompt per page', () => {
  const glued = [
    'Page 1: @image A colorful teacher-made cover with large icons, exact labels in quotes, and safe print margins on A4 portrait 2480 × 3508 px. Create exactly one final image only.',
    'Page 2: @image A colorful teacher-made interior worksheet with large icons, exact labels in quotes, and safe print margins on A4 portrait 2480 × 3508 px.',
  ].join('');
  const prompts = parseGeneratedPrompts(glued, 2);
  assert.equal(prompts.length, 2);
  assert.deepEqual(prompts.pageNumbers, [1, 2]);
  assert.match(prompts[0], /teacher-made cover/i);
  assert.doesNotMatch(prompts[0], /teacher-made interior/i);
  assert.match(prompts[1], /teacher-made interior/i);
});

test('parseGeneratedPrompts keeps only the requested page range', () => {
  const text = [samplePageLine(48), samplePageLine(51), samplePageLine(52), samplePageLine(120)].join('\n');
  const prompts = parseGeneratedPrompts(text, 50, { startPage: 51, endPage: 100 });
  assert.equal(prompts.length, 2);
  assert.deepEqual(prompts.pageNumbers, [51, 52]);
});

test('inspect and merge recover a truncated 21-page Gemini draft into later batches', () => {
  const draft = Array.from({ length: 21 }, (_, index) => samplePageLine(index + 1)).join('\n');
  const progress = inspectGeneratedPromptProgress(draft, { startPage: 1, endPage: 50, expectedCount: 50 });
  assert.equal(progress.parsedCount, 21);
  assert.equal(progress.complete, false);
  assert.equal(progress.highestPage, 21);
  const slots = mergeGeneratedPromptSlots(new Array(50).fill(null), parseGeneratedPrompts(draft, 50, { startPage: 1, endPage: 50 }), { startPage: 1, total: 50 });
  assert.equal(slots.filter(Boolean).length, 21);
  assert.equal(slots[0] && slots[20] && !slots[21], true);
});

test('suffix samples estimate the current page without parsing the whole draft', () => {
  const progress = estimatePromptProgressFromSample(
    { suffix: 'Page 261: @image A cute cartoon lizard. Clear traceable fonts.\n', length: 180_000 },
    { startPage: 251, endPage: 300, expectedCount: 50, lastParsedCount: 8 }
  );
  assert.equal(progress.parsedCount, 11);
  assert.equal(progress.highestPage, 261);
  assert.equal(progress.complete, false);
});

