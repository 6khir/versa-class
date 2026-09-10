'use strict';

const {
  CONTENT_GPT_URL,
  MOCKUPS_GPT_URL,
  SEO_GPT_URL
} = require('./prompt-builder.cjs');

const CHATGPT_URL = 'https://chatgpt.com/';
const GEMINI_URL = 'https://gemini.google.com/app';
const CONTENT_GEM_URL = 'https://gemini.google.com/gem/a825fb54b4cf';
const SEO_GEM_URL = 'https://gemini.google.com/gem/b44e0aed9a86';
const MOCKUPS_GEM_URL = 'https://gemini.google.com/gem/6d30d7350cbc?mode=image_creator';
const PREVIEW_GEM_URL = 'https://gemini.google.com/gem/03e82ade1eb7';
const META_URL = 'https://www.meta.ai/';

const CORE_PIPELINE_STAGES = Object.freeze(['text', 'pages', 'mockups']);

class AIProvider {
  constructor({ id, displayName, homeUrl, stages = {} } = {}) {
    this.id = String(id || 'chatgpt');
    this.displayName = String(displayName || this.id);
    this.homeUrl = homeUrl || CHATGPT_URL;
    this.stages = stages;
  }

  startUrlFor(stage) {
    const key = String(stage || 'pages');
    const value = this.stages[key];
    if (!value) return key === 'preview' ? PREVIEW_GEM_URL : this.homeUrl;
    return typeof value === 'string' ? value : String(value.url || this.homeUrl);
  }

  runtimeEngineFor(stage) {
    const key = String(stage || 'pages');
    if (key === 'preview') return 'gemini';
    const value = this.stages[key];
    if (value && typeof value === 'object' && value.runtimeEngine) {
      return String(value.runtimeEngine);
    }
    return this.id;
  }
}

const PROVIDERS = {
  chatgpt: new AIProvider({
    id: 'chatgpt',
    displayName: 'ChatGPT',
    homeUrl: CHATGPT_URL,
    stages: {
      text: CONTENT_GPT_URL,
      listing: SEO_GPT_URL,
      pages: CONTENT_GPT_URL,
      mockups: MOCKUPS_GPT_URL,
      preview: { url: PREVIEW_GEM_URL, runtimeEngine: 'gemini' }
    }
  }),
  gemini: new AIProvider({
    id: 'gemini',
    displayName: 'Gemini',
    homeUrl: GEMINI_URL,
    stages: {
      text: CONTENT_GEM_URL,
      listing: SEO_GEM_URL,
      pages: CONTENT_GEM_URL,
      mockups: MOCKUPS_GEM_URL,
      preview: { url: PREVIEW_GEM_URL, runtimeEngine: 'gemini' }
    }
  }),
  meta: new AIProvider({
    id: 'meta',
    displayName: 'Meta AI',
    homeUrl: META_URL,
    stages: {
      text: { url: CONTENT_GEM_URL, runtimeEngine: 'gemini' },
      listing: { url: SEO_GEM_URL, runtimeEngine: 'gemini' },
      pages: META_URL,
      mockups: META_URL,
      preview: { url: PREVIEW_GEM_URL, runtimeEngine: 'gemini' }
    }
  })
};

function getProvider(engine) {
  const key = String(engine || '').trim().toLowerCase();
  if (key === 'gemini') return PROVIDERS.gemini;
  if (key === 'meta') return PROVIDERS.meta;
  return PROVIDERS.chatgpt;
}

function defaultStageProviders(pagesEngine = 'chatgpt') {
  const pages = String(pagesEngine || 'chatgpt').trim().toLowerCase() === 'gemini'
    ? 'gemini'
    : (String(pagesEngine || '').trim().toLowerCase() === 'meta' ? 'meta' : 'chatgpt');
  return {
    text: 'gemini',
    listing: pages === 'meta' ? 'gemini' : pages,
    pages,
    mockups: pages,
    preview: 'gemini'
  };
}

function resolveStageEngine(stage, settings = {}) {
  const key = String(stage || 'pages');
  if (key === 'preview') return 'gemini';
  const pages = settings.pagesEngine || settings.aiEngine || 'chatgpt';
  const defaults = defaultStageProviders(pages);
  const saved = settings.stageProviders && typeof settings.stageProviders === 'object'
    ? settings.stageProviders
    : {};
  const requested = saved[key] || defaults[key] || pages;
  if (requested === 'gemini' || requested === 'meta' || requested === 'chatgpt') return requested;
  return defaults[key] || 'chatgpt';
}

module.exports = {
  AIProvider,
  CORE_PIPELINE_STAGES,
  PROVIDERS,
  defaultStageProviders,
  getProvider,
  resolveStageEngine,
  CHATGPT_URL,
  GEMINI_URL,
  CONTENT_GEM_URL,
  SEO_GEM_URL,
  MOCKUPS_GEM_URL,
  PREVIEW_GEM_URL,
  META_URL,
  CONTENT_GPT_URL,
  MOCKUPS_GPT_URL,
  SEO_GPT_URL
};
