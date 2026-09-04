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
