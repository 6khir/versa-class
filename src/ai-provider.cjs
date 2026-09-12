'use strict';

const {
  CONTENT_GPT_URL,
  MOCKUPS_GPT_URL,
  SEO_GPT_URL,
  CHATGPT_URL,
  GEMINI_URL,
  CONTENT_GEM_URL,
  SEO_GEM_URL,
  MOCKUPS_GEM_URL,
  PREVIEW_GEM_URL,
  META_URL
} = require('./ai-engine.cjs');
const { resolveLink } = require('./customization.cjs');

const CORE_PIPELINE_STAGES = Object.freeze(['text', 'pages', 'mockups']);

function providerStageLinkKey(engine, stage) {
  const key = String(stage || 'pages');
  const id = String(engine || 'chatgpt');
  if (key === 'preview') return 'geminiPreview';
  if (key === 'text' || key === 'planning') return id === 'chatgpt' ? 'chatgptContent' : 'geminiPlanning';
  if (key === 'listing') return id === 'chatgpt' ? 'chatgptSeo' : 'geminiSeo';
  if (key === 'mockups') {
    if (id === 'meta') return 'metaMockups';
    if (id === 'gemini') return 'geminiMockups';
    return 'chatgptMockups';
  }
  if (key === 'pages') {
    if (id === 'meta') return 'metaPages';
    if (id === 'gemini') return 'geminiPages';
    return 'chatgptContent';
  }
  return '';
}

class AIProvider {
  constructor({ id, displayName, homeUrl, stages = {}, liveDestinations = false } = {}) {
    this.id = String(id || 'chatgpt');
    this.displayName = String(displayName || this.id);
    this.homeUrl = homeUrl || CHATGPT_URL;
    this.stages = stages;
    this.liveDestinations = Boolean(liveDestinations);
  }

  startUrlFor(stage) {
    const key = String(stage || 'pages');
    if (this.liveDestinations) {
      const linkKey = providerStageLinkKey(this.id, key);
      if (linkKey) return resolveLink(linkKey);
    }
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
    liveDestinations: true,
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
    liveDestinations: true,
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
    liveDestinations: true,
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
