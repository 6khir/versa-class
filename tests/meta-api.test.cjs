const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MetaApiController,
  pickOllamaModel,
  injectPromptIntoWorkflow,
  buildCheckpointWorkflow
} = require('../src/meta-api-controller.cjs');

test('pickOllamaModel prefers llama3.2 then llama3 then mistral/qwen/gemma', () => {
  assert.equal(pickOllamaModel(['mistral:latest', 'llama3.2:latest']), 'llama3.2:latest');
  assert.equal(pickOllamaModel(['gemma:2b', 'llama3:8b']), 'llama3:8b');
  assert.equal(pickOllamaModel(['qwen2.5:7b']), 'qwen2.5:7b');
  assert.equal(pickOllamaModel(['custom-model'], 'custom-model'), 'custom-model');
  assert.equal(pickOllamaModel([]), '');
});

test('injectPromptIntoWorkflow writes the first CLIPTextEncode node', () => {
  const workflow = {
    6: { class_type: 'CLIPTextEncode', inputs: { text: 'old', clip: ['4', 1] } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: 'negative', clip: ['4', 1] } }
  };
  injectPromptIntoWorkflow(workflow, 'a classroom worksheet', 'keep negative');
  assert.equal(workflow[6].inputs.text, 'a classroom worksheet');
  assert.equal(workflow[7].inputs.text, 'keep negative');
});

test('buildCheckpointWorkflow uses the first available checkpoint', () => {
  const info = {
    CheckpointLoaderSimple: { input: { required: { ckpt_name: [['sdxl.safetensors']] } } },
    KSampler: { input: { required: { sampler_name: [['euler']], scheduler: [['normal']] } } }
  };
  const graph = buildCheckpointWorkflow(info, 'a TPT cover');
  assert.equal(graph[4].inputs.ckpt_name, 'sdxl.safetensors');
  assert.equal(graph[6].inputs.text, 'a TPT cover');
});

test('MetaApiController.generateText talks to Ollama /api/generate', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET', body: options.body });
    if (String(url).endsWith('/api/tags')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ models: [{ name: 'llama3.2:latest' }] })
      };
    }
    if (String(url).endsWith('/api/generate')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ response: '{"title":"Local listing"}' })
      };
    }
    throw new Error(`unexpected ${url}`);
  };
  const controller = new MetaApiController({
    getConfig: () => ({ ollamaUrl: 'http://127.0.0.1:11434', comfyUrl: 'http://127.0.0.1:8188' }),
    fetchImpl
  });
  const text = await controller.generateText('Write a TPT title');
  assert.equal(text, '{"title":"Local listing"}');
  assert.equal(calls.some((call) => call.url.endsWith('/api/generate') && call.method === 'POST'), true);
});

test('MetaApiController.probe reports missing local APIs without opening a browser', async () => {
  const fetchImpl = async () => {
    throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
  };
  const controller = new MetaApiController({ fetchImpl });
  const probe = await controller.probe();
  assert.equal(probe.ok, false);
  assert.match(probe.message, /Ollama/);
  assert.match(probe.message, /ComfyUI/);
});
