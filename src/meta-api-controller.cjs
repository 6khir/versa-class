const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { extname } = require('node:path');

const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
const DEFAULT_COMFY_URL = 'http://127.0.0.1:8188';
const OLLAMA_MODEL_PREFERENCE = [
  /llama3\.2/i,
  /llama3\.1/i,
  /llama3/i,
  /mistral/i,
  /qwen/i,
  /gemma/i
];
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trimSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function pickOllamaModel(models, preferred = '') {
  const names = (Array.isArray(models) ? models : [])
    .map((item) => String(item?.name || item?.model || item || '').trim())
    .filter(Boolean);
  const wanted = String(preferred || '').trim();
  if (wanted) {
    const exact = names.find((name) => name === wanted || name.startsWith(`${wanted}:`));
    if (exact) return exact;
  }
  for (const pattern of OLLAMA_MODEL_PREFERENCE) {
    const match = names.find((name) => pattern.test(name));
    if (match) return match;
  }
  return names[0] || '';
}

function nodeChoices(info, classType, inputName) {
  const required = info?.[classType]?.input?.required?.[inputName];
  const optional = info?.[classType]?.input?.optional?.[inputName];
  const raw = required || optional;
  if (Array.isArray(raw) && Array.isArray(raw[0])) return raw[0].filter(Boolean);
  if (Array.isArray(raw)) return raw.filter((item) => typeof item === 'string');
  return [];
}

function firstChoice(info, classType, inputName, fallback = '') {
  return nodeChoices(info, classType, inputName)[0] || fallback;
}

function injectPromptIntoWorkflow(workflow, prompt, negativePrompt = '') {
  const graph = workflow && typeof workflow === 'object' && workflow.prompt && typeof workflow.prompt === 'object'
    ? workflow.prompt
    : workflow;
  if (!graph || typeof graph !== 'object') return graph;
  const textNodes = Object.values(graph).filter((node) => node && typeof node === 'object' && (
    node.class_type === 'CLIPTextEncode'
    || node.class_type === 'CLIPTextEncodeFlux'
    || /textencode/i.test(String(node.class_type || ''))
  ));
  if (textNodes[0]?.inputs && Object.prototype.hasOwnProperty.call(textNodes[0].inputs, 'text')) {
    textNodes[0].inputs.text = String(prompt || '');
  }
  if (textNodes[1]?.inputs && Object.prototype.hasOwnProperty.call(textNodes[1].inputs, 'text') && negativePrompt) {
    textNodes[1].inputs.text = String(negativePrompt);
  }
  return graph;
}

function buildCheckpointWorkflow(info, prompt, { width = 1024, height = 1024 } = {}) {
  const ckpt = firstChoice(info, 'CheckpointLoaderSimple', 'ckpt_name');
  if (!ckpt) return null;
  const sampler = firstChoice(info, 'KSampler', 'sampler_name', 'euler');
  const scheduler = firstChoice(info, 'KSampler', 'scheduler', 'normal');
  return {
    3: {
      class_type: 'KSampler',
      inputs: {
        seed: Math.floor(Math.random() * 1_000_000_000),
        steps: 20,
        cfg: 7,
        sampler_name: sampler,
        scheduler,
        denoise: 1,
        model: ['4', 0],
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['5', 0]
      }
    },
    4: {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: ckpt }
    },
    5: {
      class_type: 'EmptyLatentImage',
      inputs: { width, height, batch_size: 1 }
    },
    6: {
      class_type: 'CLIPTextEncode',
      inputs: { text: String(prompt || ''), clip: ['4', 1] }
    },
    7: {
      class_type: 'CLIPTextEncode',
      inputs: { text: 'blurry, low quality, watermark, text artifacts', clip: ['4', 1] }
    },
    8: {
      class_type: 'VAEDecode',
      inputs: { samples: ['3', 0], vae: ['4', 2] }
    },
    9: {
      class_type: 'SaveImage',
      inputs: { filename_prefix: 'tpt_meta', images: ['8', 0] }
    }
  };
}

function buildFluxWorkflow(info, prompt, { width = 1024, height = 1024 } = {}) {
  const unet = firstChoice(info, 'UNETLoader', 'unet_name');
  if (!unet || !info.CLIPTextEncode || !info.VAEDecode || !info.SaveImage) return null;
  const clipNode = info.DualCLIPLoader ? 'DualCLIPLoader' : (info.CLIPLoader ? 'CLIPLoader' : null);
  const vae = firstChoice(info, 'VAELoader', 'vae_name');
  if (!clipNode || !vae) return null;
  const latentType = info.EmptySD3LatentImage ? 'EmptySD3LatentImage' : 'EmptyLatentImage';
  const sampler = firstChoice(info, 'KSampler', 'sampler_name', 'euler');
  const scheduler = firstChoice(info, 'KSampler', 'scheduler', 'simple');
    const clipInputs = clipNode === 'DualCLIPLoader'
      ? {
        clip_name1: firstChoice(info, 'DualCLIPLoader', 'clip_name1'),
        clip_name2: firstChoice(info, 'DualCLIPLoader', 'clip_name2'),
        type: firstChoice(info, 'DualCLIPLoader', 'type', 'flux')
      }
      : { clip_name: firstChoice(info, 'CLIPLoader', 'clip_name'), type: firstChoice(info, 'CLIPLoader', 'type', 'flux') };
    const unetInputs = { unet_name: unet };
    const dtype = firstChoice(info, 'UNETLoader', 'weight_dtype');
    if (dtype) unetInputs.weight_dtype = dtype;
    return {
      1: { class_type: 'UNETLoader', inputs: unetInputs },
    2: { class_type: clipNode, inputs: clipInputs },
    3: { class_type: 'VAELoader', inputs: { vae_name: vae } },
    4: { class_type: 'CLIPTextEncode', inputs: { text: String(prompt || ''), clip: ['2', 0] } },
    5: { class_type: latentType, inputs: { width, height, batch_size: 1 } },
    6: {
      class_type: 'KSampler',
      inputs: {
        seed: Math.floor(Math.random() * 1_000_000_000),
        steps: 20,
        cfg: 1,
        sampler_name: sampler,
        scheduler,
        denoise: 1,
        model: ['1', 0],
        positive: ['4', 0],
        negative: ['4', 0],
        latent_image: ['5', 0]
      }
    },
    7: { class_type: 'VAEDecode', inputs: { samples: ['6', 0], vae: ['3', 0] } },
    8: { class_type: 'SaveImage', inputs: { filename_prefix: 'tpt_meta', images: ['7', 0] } }
  };
}

function collectHistoryImages(entry) {
  const outputs = entry?.outputs || {};
  const images = [];
  for (const node of Object.values(outputs)) {
    for (const image of node?.images || []) {
      if (image?.filename) images.push(image);
    }
  }
  return images;
}

function imageAttachmentPayloads(paths = []) {
  return [...new Set((Array.isArray(paths) ? paths : [paths]).filter(Boolean))]
    .filter((filePath) => IMAGE_EXTENSIONS.has(extname(String(filePath)).toLowerCase()))
    .map((filePath) => {
      try {
        return readFileSync(filePath).toString('base64');
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

class MetaApiController {
  constructor({ getConfig, fetchImpl } = {}) {
    this.getConfig = typeof getConfig === 'function' ? getConfig : () => ({});
    this.fetchImpl = fetchImpl || globalThis.fetch.bind(globalThis);
    this.lastProbe = null;
  }

  #config() {
    const raw = this.getConfig() || {};
    return {
      ollamaUrl: trimSlash(raw.ollamaUrl || raw.metaOllamaUrl || DEFAULT_OLLAMA_URL) || DEFAULT_OLLAMA_URL,
      comfyUrl: trimSlash(raw.comfyUrl || raw.metaComfyUrl || DEFAULT_COMFY_URL) || DEFAULT_COMFY_URL,
      ollamaModel: String(raw.ollamaModel || raw.metaOllamaModel || '').trim(),
      comfyWorkflow: raw.comfyWorkflow || raw.metaComfyWorkflow || null
    };
  }

  async #request(url, { method = 'GET', body = null, headers = {}, timeoutMs = 30_000 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...headers
        },
        body: body == null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
        signal: controller.signal
      });
      const text = await response.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = null; }
      if (!response.ok) {
        const detail = json?.error || text.slice(0, 240) || `HTTP ${response.status}`;
        throw Object.assign(new Error(String(detail)), { code: 'META_API_ERROR', status: response.status });
      }
      return { response, text, json };
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw Object.assign(new Error(`Timed out talking to ${url}`), { code: 'META_API_TIMEOUT' });
      }
      if (error?.code) throw error;
      throw Object.assign(new Error(error?.message || `Could not reach ${url}`), { code: 'META_API_UNAVAILABLE', cause: error });
    } finally {
      clearTimeout(timer);
    }
  }

  async listOllamaModels() {
    const { ollamaUrl } = this.#config();
    const { json } = await this.#request(`${ollamaUrl}/api/tags`, { timeoutMs: 8_000 });
    return Array.isArray(json?.models) ? json.models : [];
  }

  async resolveOllamaModel() {
    const { ollamaModel } = this.#config();
    const models = await this.listOllamaModels();
    const selected = pickOllamaModel(models, ollamaModel);
    if (!selected) {
      throw Object.assign(
        new Error('Ollama is running but no text model is installed. Pull llama3.2, mistral, qwen, or gemma, then tap Test connection.'),
        { code: 'META_OLLAMA_MODEL_MISSING' }
      );
    }
    return selected;
  }

  async probe() {
    const { ollamaUrl, comfyUrl } = this.#config();
    const result = {
      ok: false,
      ollama: { ok: false, url: ollamaUrl, model: '', error: null },
      comfy: { ok: false, url: comfyUrl, error: null }
    };
    try {
      result.ollama.model = await this.resolveOllamaModel();
      result.ollama.ok = true;
    } catch (error) {
      result.ollama.error = error.message;
    }
    try {
      await this.#request(`${comfyUrl}/system_stats`, { timeoutMs: 8_000 });
      result.comfy.ok = true;
    } catch (error) {
      try {
        await this.#request(`${comfyUrl}/object_info`, { timeoutMs: 8_000 });
        result.comfy.ok = true;
      } catch (inner) {
        result.comfy.error = inner.message || error.message;
      }
    }
    result.ok = result.ollama.ok && result.comfy.ok;
    if (!result.ok) {
      const parts = [];
      if (!result.ollama.ok) parts.push(`Ollama at ${ollamaUrl} (${result.ollama.error || 'not reachable'})`);
      if (!result.comfy.ok) parts.push(`ComfyUI at ${comfyUrl} (${result.comfy.error || 'not reachable'})`);
      result.message = `Meta AI is local. ${parts.join(' and ')}. Start those services, then tap Test connection. ChatGPT and Gemini stay signed in and unused.`;
    } else {
      result.message = `Meta AI ready · ${result.ollama.model} + ComfyUI`;
    }
    this.lastProbe = { ...result, at: new Date().toISOString() };
    return this.lastProbe;
  }

  async generateText(prompt, { attachmentPaths = [], timeoutMs = 180_000 } = {}) {
    const { ollamaUrl } = this.#config();
    const model = await this.resolveOllamaModel();
    const images = imageAttachmentPayloads(attachmentPaths);
    const payload = {
      model,
      prompt: String(prompt || ''),
      stream: false
    };
    if (images.length) payload.images = images;
    try {
      const { json } = await this.#request(`${ollamaUrl}/api/generate`, {
        method: 'POST',
        body: payload,
        timeoutMs
      });
      const text = String(json?.response || '').trim();
      if (!text) {
        throw Object.assign(new Error('Ollama returned an empty response.'), { code: 'META_EMPTY_TEXT' });
      }
      return text;
    } catch (error) {
      if (images.length && error?.status === 400) {
        const { json } = await this.#request(`${ollamaUrl}/api/generate`, {
          method: 'POST',
          body: { model, prompt: String(prompt || ''), stream: false },
          timeoutMs
        });
        return String(json?.response || '').trim();
      }
      if (error?.code === 'META_API_UNAVAILABLE') {
        throw Object.assign(
          new Error(`Could not reach Ollama at ${ollamaUrl}. Start Ollama and pull a text model (llama3.2, mistral, qwen, or gemma).`),
          { code: 'META_API_UNAVAILABLE' }
        );
      }
      throw error;
    }
  }

  async #objectInfo(comfyUrl) {
    const { json } = await this.#request(`${comfyUrl}/object_info`, { timeoutMs: 20_000 });
    return json || {};
  }

  async #buildImageWorkflow(prompt, options = {}) {
    const { comfyWorkflow } = this.#config();
    if (comfyWorkflow) {
      const cloned = JSON.parse(JSON.stringify(comfyWorkflow));
      return injectPromptIntoWorkflow(cloned, prompt);
    }
    const { comfyUrl } = this.#config();
    const info = await this.#objectInfo(comfyUrl);
    const checkpoint = buildCheckpointWorkflow(info, prompt, options);
    if (checkpoint) return checkpoint;
    const flux = buildFluxWorkflow(info, prompt, options);
    if (flux) return flux;
    throw Object.assign(
      new Error('ComfyUI has no usable CheckpointLoaderSimple or Flux workflow. Load a checkpoint, or save a custom workflow in settings (metaComfyWorkflow).'),
      { code: 'META_COMFY_WORKFLOW_MISSING' }
    );
  }

  async generateImage(prompt, { attachmentPaths = [], width = 1024, height = 1024, timeoutMs = 600_000 } = {}) {
    const { comfyUrl } = this.#config();
    void attachmentPaths;
    const workflow = await this.#buildImageWorkflow(prompt, { width, height });
    const clientId = randomUUID();
    let queued;
    try {
      queued = await this.#request(`${comfyUrl}/prompt`, {
        method: 'POST',
        body: { prompt: workflow, client_id: clientId },
        timeoutMs: 30_000
      });
    } catch (error) {
      if (error?.code === 'META_API_UNAVAILABLE') {
        throw Object.assign(
          new Error(`Could not reach ComfyUI at ${comfyUrl}. Start ComfyUI on port 8188, then tap Test connection.`),
          { code: 'META_API_UNAVAILABLE' }
        );
      }
      throw error;
    }
    const promptId = queued.json?.prompt_id;
    if (!promptId) {
      throw Object.assign(new Error('ComfyUI did not accept the image prompt.'), { code: 'META_COMFY_REJECTED' });
    }
    const deadline = Date.now() + timeoutMs;
    let imageMeta = null;
    while (Date.now() < deadline) {
      const { json } = await this.#request(`${comfyUrl}/history/${encodeURIComponent(promptId)}`, { timeoutMs: 15_000 });
      const entry = json?.[promptId];
      const images = collectHistoryImages(entry);
      if (images[0]) {
        imageMeta = images[0];
        break;
      }
      const status = entry?.status;
      if (status?.status_str === 'error' || status?.completed === false && Array.isArray(status?.messages) && status.messages.some((item) => item?.[0] === 'execution_error')) {
        throw Object.assign(new Error('ComfyUI reported that image generation failed.'), { code: 'GENERATION_ERROR' });
      }
      await sleep(1_000);
    }
    if (!imageMeta) {
      throw Object.assign(new Error('No new image appeared from ComfyUI before the generation timeout.'), { code: 'IMAGE_TIMEOUT' });
    }
    const view = new URL(`${comfyUrl}/view`);
    view.searchParams.set('filename', imageMeta.filename);
    view.searchParams.set('subfolder', imageMeta.subfolder || '');
    view.searchParams.set('type', imageMeta.type || 'output');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    try {
      const response = await this.fetchImpl(view.toString(), { signal: controller.signal });
      if (!response.ok) {
        throw Object.assign(new Error(`ComfyUI image download failed (${response.status}).`), { code: 'IMAGE_DOWNLOAD_FAILED' });
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer || buffer.length < 50) {
        throw Object.assign(new Error('The ComfyUI file is not a valid image.'), { code: 'INVALID_IMAGE_FILE' });
      }
      const contentType = response.headers.get('content-type') || 'image/png';
      return { buffer, contentType };
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = {
  MetaApiController,
  DEFAULT_OLLAMA_URL,
  DEFAULT_COMFY_URL,
  pickOllamaModel,
  injectPromptIntoWorkflow,
  buildCheckpointWorkflow,
  buildFluxWorkflow
};
