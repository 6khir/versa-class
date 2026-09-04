const test = require('node:test');
const assert = require('node:assert/strict');
const {
  listGeminiStudios,
  listChatGptStudios,
  findStudio,
  CONTENT_GEM_URL,
  SEO_GEM_URL,
  MOCKUPS_GEM_URL,
  PREVIEW_GEM_URL,
  CONTENT_GPT_URL,
  MOCKUPS_GPT_URL,
  SEO_GPT_URL
} = require('../src/ai-engine.cjs');
const { parseAnalysisResponse, inferProductFormat, buildAnalysisPrompt } = require('../src/prompt-builder.cjs');

test('four Gemini gems and three ChatGPT GPTs are registered', () => {
  const gems = listGeminiStudios();
  const gpts = listChatGptStudios();
  assert.deepEqual(gems.map((item) => item.id), ['planning', 'seo-gem', 'mockups-gem', 'preview']);
  assert.equal(findStudio('planning').url, CONTENT_GEM_URL);
  assert.equal(findStudio('seo-gem').url, SEO_GEM_URL);
  assert.equal(findStudio('mockups-gem').url, MOCKUPS_GEM_URL);
  assert.equal(findStudio('preview').url, PREVIEW_GEM_URL);
  assert.equal(findStudio('content-gpt').url, CONTENT_GPT_URL);
  assert.equal(findStudio('mockups-gpt').url, MOCKUPS_GPT_URL);
  assert.equal(findStudio('seo-gpt').url, SEO_GPT_URL);
  assert.equal(gpts.length, 3);
  assert.match(CONTENT_GEM_URL, /a825fb54b4cf/);
  assert.match(SEO_GEM_URL, /b44e0aed9a86/);
  assert.match(MOCKUPS_GEM_URL, /6d30d7350cbc/);
  assert.match(PREVIEW_GEM_URL, /03e82ade1eb7/);
});

test('analysis prompt asks for productFormat and regex prefers editable wording', () => {
  const prompt = buildAnalysisPrompt({ sourceMode: 'url', productUrl: 'https://www.teacherspayteachers.com/Product/x' });
  assert.match(prompt, /productFormat/);
  assert.equal(inferProductFormat('Editable Canva template for teachers', 'static'), 'editable');
  assert.equal(inferProductFormat('Printable PDF worksheets', 'static'), 'static');
  const parsed = parseAnalysisResponse(JSON.stringify({
    title: 'Heart Words Canva Template',
    description: 'An editable Canva resource',
    targetAge: 'K-2',
    keyHighlights: ['Editable'],
    pageCount: 12,
    productFormat: 'static'
  }));
  assert.equal(parsed.productFormat, 'editable');
});
