'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AIProvider,
  CORE_PIPELINE_STAGES,
  defaultStageProviders,
  getProvider,
  resolveStageEngine,
  CONTENT_GEM_URL,
  CONTENT_GPT_URL,
  MOCKUPS_GEM_URL,
  MOCKUPS_GPT_URL,
  SEO_GEM_URL,
  SEO_GPT_URL,
  PREVIEW_GEM_URL,
  META_URL
} = require('../src/ai-provider.cjs');

test('AIProvider is the shared stage URL interface', () => {
  assert.equal(typeof AIProvider, 'function');
  const provider = new AIProvider({
    id: 'chatgpt',
    stages: { pages: 'https://chatgpt.com/g/demo' }
  });
  assert.equal(provider.startUrlFor('pages'), 'https://chatgpt.com/g/demo');
  assert.equal(provider.runtimeEngineFor('pages'), 'chatgpt');
  assert.equal(provider.runtimeEngineFor('preview'), 'gemini');
});

test('core stages Pages, Text, and Mockups accept Gemini, ChatGPT, or Meta', () => {
  assert.deepEqual([...CORE_PIPELINE_STAGES], ['text', 'pages', 'mockups']);
  for (const engine of ['gemini', 'chatgpt', 'meta']) {
    const provider = getProvider(engine);
    for (const stage of CORE_PIPELINE_STAGES) {
      assert.ok(provider.startUrlFor(stage), `${engine} missing ${stage} URL`);
    }
  }
  assert.equal(getProvider('gemini').startUrlFor('text'), CONTENT_GEM_URL);
  assert.equal(getProvider('chatgpt').startUrlFor('text'), CONTENT_GPT_URL);
  assert.equal(getProvider('meta').startUrlFor('text'), CONTENT_GEM_URL);
  assert.equal(getProvider('meta').runtimeEngineFor('text'), 'gemini');
  assert.equal(getProvider('meta').runtimeEngineFor('listing'), 'gemini');
  assert.equal(getProvider('gemini').startUrlFor('pages'), CONTENT_GEM_URL);
  assert.equal(getProvider('chatgpt').startUrlFor('pages'), CONTENT_GPT_URL);
  assert.equal(getProvider('meta').startUrlFor('pages'), META_URL);
  assert.equal(getProvider('gemini').startUrlFor('mockups'), MOCKUPS_GEM_URL);
  assert.equal(getProvider('chatgpt').startUrlFor('mockups'), MOCKUPS_GPT_URL);
  assert.equal(getProvider('meta').startUrlFor('mockups'), META_URL);
  assert.equal(getProvider('chatgpt').startUrlFor('listing'), SEO_GPT_URL);
  assert.equal(getProvider('gemini').startUrlFor('listing'), SEO_GEM_URL);
});

test('preview always stays on the Veo gem regardless of image engine', () => {
  for (const engine of ['chatgpt', 'gemini', 'meta']) {
    assert.equal(getProvider(engine).startUrlFor('preview'), PREVIEW_GEM_URL);
    assert.equal(getProvider(engine).runtimeEngineFor('preview'), 'gemini');
    assert.equal(resolveStageEngine('preview', { aiEngine: engine }), 'gemini');
  }
});

test('default stage providers keep text on Gemini and pages/mockups on the image engine', () => {
  assert.deepEqual(defaultStageProviders('chatgpt'), {
    text: 'gemini',
    listing: 'chatgpt',
    pages: 'chatgpt',
    mockups: 'chatgpt',
    preview: 'gemini'
  });
  assert.deepEqual(defaultStageProviders('meta'), {
    text: 'gemini',
    listing: 'gemini',
    pages: 'meta',
    mockups: 'meta',
    preview: 'gemini'
  });
  assert.equal(resolveStageEngine('text', { aiEngine: 'chatgpt' }), 'gemini');
  assert.equal(resolveStageEngine('pages', { aiEngine: 'chatgpt' }), 'chatgpt');
  assert.equal(resolveStageEngine('mockups', { aiEngine: 'gemini' }), 'gemini');
  assert.equal(resolveStageEngine('pages', {
    aiEngine: 'chatgpt',
    stageProviders: { pages: 'meta', mockups: 'gemini' }
  }), 'meta');
  assert.equal(resolveStageEngine('mockups', {
    aiEngine: 'chatgpt',
    stageProviders: { pages: 'meta', mockups: 'gemini' }
  }), 'gemini');
});
