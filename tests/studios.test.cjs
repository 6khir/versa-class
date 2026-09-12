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
  assert.match(SEO_GEM_URL, /1jnpd8-MCWS8VhcatZ8yQoX3uXlbr9orG/);
  assert.match(MOCKUPS_GEM_URL, /6d30d7350cbc/);
  assert.match(PREVIEW_GEM_URL, /1P0s70mcBrh1YRrSEf2lZdKtv5lf2phw4/);
});

test('analysis prompt asks for productFormat and regex prefers editable wording', () => {
  const prompt = buildAnalysisPrompt({ sourceMode: 'url', productUrl: 'https://www.teacherspayteachers.com/Product/x' });
  assert.match(prompt, /productFormat/);
  assert.equal(inferProductFormat('Editable PowerPoint template for teachers', 'static'), 'editable');
  assert.equal(inferProductFormat('Printable PDF worksheets', 'static'), 'static');
  assert.equal(inferProductFormat('Johnny Appleseed Word Search Maze Tracing', 'static'), 'maze');
  assert.equal(inferProductFormat('Printable PDF worksheets', 'maze'), 'maze');
  const parsed = parseAnalysisResponse(JSON.stringify({
    title: 'Heart Words Editable Template',
    description: 'An editable PowerPoint resource',
    targetAge: 'K-2',
    keyHighlights: ['Editable'],
    pageCount: 12,
    productFormat: 'static'
  }));
  assert.equal(parsed.productFormat, 'editable');
});

test('analysis extract accepts a balanced JSON object even when leftover prose wraps it', () => {
  const { parseAnalysisResponse, analysisResponseReady } = require('../src/prompt-builder.cjs');
  const wrapped = [
    'Here is the book brief {not json}',
    '{"title":"Autumn Mazes","description":"Seasonal maze packet","targetAge":"K-2","keyHighlights":["Mazes"],"pageCount":24,"productFormat":"maze"}',
    'Thanks!'
  ].join('\n');
  assert.equal(analysisResponseReady(wrapped), true);
  const parsed = parseAnalysisResponse(wrapped);
  assert.equal(parsed.title, 'Autumn Mazes');
  assert.equal(parsed.pageCount, 24);
});

test('analysis extract can read Title and Description lines the way storybook parse does', () => {
  const { parseAnalysisResponse } = require('../src/prompt-builder.cjs');
  const parsed = parseAnalysisResponse([
    'Title: Forest Maze Adventures',
    'Description: Printable maze pages for early finishers.',
    'Target Age: Grade 1',
    'Page Count: 16'
  ].join('\n'));
  assert.equal(parsed.title, 'Forest Maze Adventures');
  assert.equal(parsed.pageCount, 16);
});

test('every content stage routes to the one content gem, editable or not', () => {
  const { getJobStartUrl, CONTENT_GEM_URL } = require('../src/ai-engine.cjs');
  // The editable gem is gone. It existed for a pipeline that baked text into the
  // artwork; Interior Text now lifts, erases and rebuilds the text locally, so no
  // downstream stage depends on which gem wrote the brief. It was also returning 7
  // page prompts when asked for 100, which cost pages on every editable run.
  for (const kind of ['analysis', 'analysis-first', 'blueprint', 'planning', 'prompts', 'generate-prompts']) {
    for (const productFormat of ['editable', 'static', undefined]) {
      assert.equal(getJobStartUrl({ kind, productFormat }, 'gemini'), CONTENT_GEM_URL, `${kind}/${productFormat}`);
      // Planning stays on the Gemini content gem whatever the image engine is.
      assert.equal(getJobStartUrl({ kind, productFormat }, 'chatgpt'), CONTENT_GEM_URL, `${kind}/${productFormat}`);
    }
  }
  // Page images and the artwork turn take the same route.
  for (const job of [
    { kind: 'page', purpose: 'image', productFormat: 'editable' },
    { kind: 'page', purpose: 'image', productFormat: 'static' },
    { kind: 'artwork', productFormat: 'editable' }
  ]) {
    assert.equal(getJobStartUrl(job, 'gemini'), CONTENT_GEM_URL, JSON.stringify(job));
  }
});

test('the abandoned editable gem is not reachable from anywhere', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..');
  for (const file of ['src/ai-engine.cjs', 'src/prompt-builder.cjs', 'src/editable-browser-provider.cjs']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(!source.includes('b3b310bffb0f'), `${file} still carries the editable gem id`);
    assert.ok(!source.includes('EDITABLE_GEM_URL'), `${file} still references EDITABLE_GEM_URL`);
  }
});
