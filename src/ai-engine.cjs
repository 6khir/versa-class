const {
  CONTENT_GPT_URL,
  MOCKUPS_GPT_URL,
  SEO_GPT_URL
} = require('./prompt-builder.cjs');

const CHATGPT_URL = 'https://chatgpt.com/';
const GEMINI_URL = 'https://gemini.google.com/app';
const STANDARD_GEMINI_URL = GEMINI_URL;
const CONTENT_PLANNING_GEM_URL = 'https://gemini.google.com/gem/a825fb54b4cf';
const CONTENT_GEM_URL = CONTENT_PLANNING_GEM_URL;
const SEO_GEM_URL = 'https://gemini.google.com/gem/b44e0aed9a86';
// mode=image_creator is the Book Automation trick that opens the Mockups Gem
// already armed for Imagen — without it Gemini often answers in text mode.
const MOCKUPS_GEM_URL = 'https://gemini.google.com/gem/6d30d7350cbc?mode=image_creator';
const PREVIEW_GEM_URL = 'https://gemini.google.com/gem/03e82ade1eb7';
const META_URL = 'https://www.meta.ai/';
const META_LOCAL_URL = 'meta://local';
const RETIRED_GEM_IDS = new Set([
  'be5ff5bc0446',
  'd8064e71d731',
  '863ed43ea7fa',
  '27dd6b9dc38a'
]);

const CHATGPT_HOST_PATTERN = /^(chatgpt\.com|chat\.openai\.com)$/i;
const GEMINI_HOST_PATTERN = /^(gemini\.google\.com)$/i;
const GOOGLE_AUTH_HOST_PATTERN = /^(accounts\.google\.com|google\.com|www\.google\.com)$/i;
const META_HOST_PATTERN = /^(www\.)?meta\.ai$/i;
const META_IMAGE_HOST_PATTERN = /(^|\.)((meta\.ai)|(facebook\.com)|(fbcdn\.net)|(fbsbx\.com)|(cdninstagram\.com)|(instagram\.com)|(facebook\.net))$/i;

const PREVIEW_JOB_KINDS = new Set([
  'preview',
  'preview_video',
  'video',
  'video_preview',
  'veo',
  'veo3'
]);
const MOCKUP_JOB_KINDS = new Set([
  'mockup',
  'mockups',
  'thumbnail',
  'thumbnails',
  'character',
  'character_sheet'
]);
const CONTENT_PAGE_JOB_KINDS = new Set([
  'page',
  'interior',
  'cover',
  'front_cover',
  'back_cover',
  'front',
  'back',
  'activity',
  'thank_you',
  'custom',
  'story_page',
  'image',
  'images',
  'prompt',
  'content'
]);
const SEO_JOB_KINDS = new Set(['listing', 'tpt_listing', 'seo', 'title', 'description']);
const PLANNING_JOB_KINDS = new Set([
  'analysis',
  'analysis-first',
  'blueprint',
  'planning',
  'prompts',
  'generate-prompts'
]);

function engineTarget(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value.target ?? value.engine ?? value.aiEngine ?? '';
  }
  return value;
}

function normalizeEngine(value) {
  const val = String(engineTarget(value) || '').trim().toLowerCase();
  if (val === 'gemini') return 'gemini';
  if (val === 'meta') return 'meta';
  return 'chatgpt';
}

function engineDisplayName(engine) {
  const norm = normalizeEngine(engine);
  if (norm === 'gemini') return 'Gemini';
  if (norm === 'meta') return 'Meta AI';
  return 'ChatGPT';
}

function isBrowserEngine(_engine) {
  return true;
}

function getEngineHomeUrl(engine) {
  const norm = normalizeEngine(engine);
  if (norm === 'gemini') return GEMINI_URL;
  if (norm === 'meta') return META_URL;
  return CHATGPT_URL;
}

function jobRouteKind(job = {}) {
  const kind = String(job.kind || job.jobKind || job.promptKind || '').toLowerCase();
  const purpose = String(job.purpose || '').toLowerCase();
  if (PREVIEW_JOB_KINDS.has(kind) || /^(preview|video|veo)/i.test(purpose)) return 'preview';
  if (PLANNING_JOB_KINDS.has(kind) || /^(planning|analysis|blueprint|prompts)$/i.test(purpose)) return 'planning';
  if (MOCKUP_JOB_KINDS.has(kind) || /^(mockup|mockups|thumbnail|thumbnails)$/i.test(purpose)) return 'mockups';
  if (SEO_JOB_KINDS.has(kind) || /^(seo|listing|title|description)$/i.test(purpose)) return 'seo';
  if (CONTENT_PAGE_JOB_KINDS.has(kind) || /^(image|images|page|interior|content)$/i.test(purpose)) return 'content';
  return 'content';
}

function getJobStartUrl(job = {}, engine = 'chatgpt') {
  const route = jobRouteKind(job);
  if (route === 'preview') return PREVIEW_GEM_URL;
  if (route === 'planning') return CONTENT_GEM_URL;
  const norm = normalizeEngine(engine);
  if (norm === 'meta') {
    if (route === 'seo') return SEO_GEM_URL;
    return META_URL;
  }
  if (norm === 'gemini') {
    if (route === 'mockups') return MOCKUPS_GEM_URL;
    if (route === 'seo') return SEO_GEM_URL;
    return CONTENT_GEM_URL;
  }
  if (route === 'mockups') return MOCKUPS_GPT_URL;
  if (route === 'seo') return SEO_GPT_URL;
  return CONTENT_GPT_URL;
}

const GEMINI_IMAGE_PROMPT_KINDS = new Set([
  'page',
  'cover',
  'activity',
  'thank_you',
  'custom',
  'character',
  'character_sheet',
  'thumbnail',
  'mockup',
  'front',
  'back',
  'front_cover',
  'back_cover',
  'story_page',
  'image'
]);

function wantsGeminiImageMode(promptKind = '', prompt = '', engine = 'gemini') {
  if (normalizeEngine(engine) !== 'gemini') return false;
  const kind = String(promptKind || '').toLowerCase();
  if (GEMINI_IMAGE_PROMPT_KINDS.has(kind)) return true;
  return /^@image\b/i.test(String(prompt || '').trim());
}

function withEngineImagePrefix(prompt, engine, { isImage = true, purpose = '' } = {}) {
  const text = String(prompt || '').trim();
  if (!isImage || !text) return text;
  const norm = normalizeEngine(engine);
  if (norm === 'gemini') {
    const kind = String(purpose || '').toLowerCase();
    const mockup = /^(thumbnail|mockup|mockups|thumbnails)$/.test(kind)
      || /tpt (hero )?thumbnail|listing mockup|2000x2000/i.test(text);
    // Do NOT inject "Generate/render this image now" for interior pages — that wording
    // made the Content Pages Gem answer with text refusals instead of drawing.
    if (mockup) {
      const generateNow = 'Generate this Teachers Pay Teachers listing mockup image now. Do not write any conversational text, acknowledgements, or JSON.';
      if (/^@image\b/i.test(text)) {
        if (/do not write any conversational text/i.test(text)) return text;
        return text.replace(/^@image\s*/i, `@image ${generateNow}\n\n`);
      }
      return `@image ${generateNow}\n\n${text}`;
    }
    if (/^@image\b/i.test(text)) return text;
    return `@image ${text}`;
  }
  if (norm === 'meta') {
    if (/generate (a |an )?(single )?(high-quality )?image|imagine\b/i.test(text)) return text;
    return `Generate a single high-quality image now. Do not reply with only text.\n${text}`;
  }
  return text;
}

function hostnameOf(value) {
  try {
    return new URL(String(value)).hostname;
  } catch {
    return '';
  }
}

function isChatGptHost(hostname) {
  return CHATGPT_HOST_PATTERN.test(String(hostname || ''));
}

function isGeminiHost(hostname) {
  return GEMINI_HOST_PATTERN.test(String(hostname || ''));
}

function isGoogleAuthHost(hostname) {
  return GOOGLE_AUTH_HOST_PATTERN.test(String(hostname || ''));
}

function isChatGptPageUrl(value) {
  return isChatGptHost(hostnameOf(value));
}

function isGeminiPageUrl(value) {
  return isGeminiHost(hostnameOf(value));
}

function isMetaHost(hostname) {
  return META_HOST_PATTERN.test(String(hostname || ''));
}

function isMetaImageHost(hostname) {
  return META_IMAGE_HOST_PATTERN.test(String(hostname || '').toLowerCase());
}

function isMetaPageUrl(value) {
  return isMetaHost(hostnameOf(value));
}

function isMetaLocalUrl(value) {
  return /^meta:\/\//i.test(String(value || '').trim());
}

function geminiGemId(value) {
  try {
    const url = new URL(String(value));
    if (!isGeminiHost(url.hostname)) return '';
    const parts = geminiPathParts(url.pathname);
    return parts[0] === 'gem' && parts[1] ? String(parts[1]).toLowerCase() : '';
  } catch {
    return '';
  }
}

function liveGeminiGemIds() {
  return new Set(
    [CONTENT_GEM_URL, SEO_GEM_URL, MOCKUPS_GEM_URL, PREVIEW_GEM_URL]
      .map((item) => geminiGemId(item))
      .filter(Boolean)
  );
}

function isRetiredGeminiGemUrl(value) {
  const gemId = geminiGemId(value);
  return Boolean(gemId) && (RETIRED_GEM_IDS.has(gemId) || !liveGeminiGemIds().has(gemId));
}

function geminiImageCreatorMode(value) {
  try {
    const url = new URL(String(value || ''));
    if (!isGeminiHost(url.hostname)) return false;
    return String(url.searchParams.get('mode') || '').toLowerCase() === 'image_creator';
  } catch {
    return false;
  }
}

function conversationMatchesEngine(url, engine) {
  if (!url || isMetaLocalUrl(url)) return false;
  if (isRetiredGeminiGemUrl(url)) return false;
  const norm = normalizeEngine(engine);
  if (norm === 'meta') return isMetaPageUrl(url);
  if (norm === 'gemini') return isGeminiPageUrl(url);
  return isChatGptPageUrl(url);
}

function isAllowedChatUrl(value) {
  return isMetaLocalUrl(value) || isMetaPageUrl(value) || isGeminiPageUrl(value) || isChatGptPageUrl(value);
}

function geminiPathParts(pathname) {
  const parts = String(pathname || '/').split('/').filter(Boolean);
  if (parts[0] === 'u' && /^\d+$/.test(parts[1] || '')) return parts.slice(2);
  return parts;
}

function isChatGptHomeUrl(value) {
  try {
    const url = new URL(String(value));
    return isChatGptHost(url.hostname) && (url.pathname === '/' || url.pathname === '');
  } catch {
    return false;
  }
}

function isGeminiHomeUrl(value) {
  try {
    const url = new URL(String(value));
    if (!isGeminiHost(url.hostname)) return false;
    const parts = geminiPathParts(url.pathname);
    return parts.length === 0 || (parts.length === 1 && parts[0] === 'app');
  } catch {
    return false;
  }
}

function isGemHomeUrl(value) {
  try {
    const url = new URL(String(value));
    if (!isGeminiHost(url.hostname)) return false;
    const parts = geminiPathParts(url.pathname);
    return parts.length === 2 && parts[0] === 'gem' && Boolean(parts[1]);
  } catch {
    return false;
  }
}

function geminiSurfaceId(value) {
  try {
    const url = new URL(String(value));
    if (!isGeminiHost(url.hostname)) return '';
    const parts = geminiPathParts(url.pathname);
    if (parts[0] === 'gem' && parts[1]) return `gem:${parts[1]}`;
    if (parts[0] === 'app') return 'app';
    return parts[0] || 'home';
  } catch {
    return '';
  }
}

function chatgptSurfaceId(value) {
  try {
    const url = new URL(String(value));
    if (!isChatGptHost(url.hostname)) return '';
    const gptId = url.pathname.match(/(?:^|\/)g\/([^/?#]+)/i)?.[1] ?? '';
    const conversationId = url.pathname.match(/(?:^|\/)c\/([^/?#]+)/i)?.[1] ?? '';
    if (conversationId) return `c:${conversationId}`;
    if (gptId) return `g:${gptId}`;
    return 'home';
  } catch {
    return '';
  }
}

function isMetaHomeUrl(value) {
  try {
    const url = new URL(String(value));
    return isMetaHost(url.hostname) && (url.pathname === '/' || url.pathname === '');
  } catch {
    return false;
  }
}

function isChatHomeUrl(value) {
  return isChatGptHomeUrl(value) || isGeminiHomeUrl(value) || isMetaHomeUrl(value);
}

function isChatGptConversationUrl(value) {
  try {
    const url = new URL(String(value));
    if (!isChatGptHost(url.hostname)) return false;
    const conversationId = url.pathname.match(/(?:^|\/)c\/([^/?#]+)/i)?.[1] ?? '';
    return Boolean(conversationId && !/^WEB:/i.test(decodeURIComponent(conversationId)));
  } catch {
    return false;
  }
}

function isPersistedConversationUrl(value) {
  if (isMetaLocalUrl(value)) return false;
  if (isMetaPageUrl(value)) return !isMetaHomeUrl(value);
  if (isChatGptConversationUrl(value)) return true;
  try {
    const url = new URL(String(value));
    if (!isGeminiHost(url.hostname)) return false;
    const normalized = `${url.origin}${url.pathname}`.replace(/\/+$/, '');
    const gemHomes = [GEMINI_URL, CONTENT_GEM_URL, MOCKUPS_GEM_URL, SEO_GEM_URL, PREVIEW_GEM_URL]
      .map((item) => String(item).split('?')[0].replace(/\/+$/, ''));
    if (gemHomes.includes(normalized) && !url.search) return false;
    if (isGeminiHomeUrl(value) || isGemHomeUrl(value)) return false;
    return geminiPathParts(url.pathname).length >= 2;
  } catch {
    return false;
  }
}

function jobPageNeedsNavigation(currentUrl, targetUrl, fresh = false) {
  if (fresh) return true;
  if (!currentUrl || !targetUrl) return true;
  if (isRetiredGeminiGemUrl(currentUrl)) return true;
  if (isMetaLocalUrl(currentUrl) || isMetaLocalUrl(targetUrl)) return true;
  // Same Mockups Gem without image_creator mode is not reusable — Gemini stays in text chat.
  if (geminiImageCreatorMode(targetUrl) && !geminiImageCreatorMode(currentUrl)) return true;
  if (isMetaHomeUrl(currentUrl) && isMetaHomeUrl(targetUrl)) return false;
  if (isChatGptHomeUrl(currentUrl) && isChatGptHomeUrl(targetUrl)) return false;
  if (isGeminiHomeUrl(currentUrl) && isGeminiHomeUrl(targetUrl)) return false;
  if (isGemHomeUrl(currentUrl) && isGemHomeUrl(targetUrl) && geminiSurfaceId(currentUrl) === geminiSurfaceId(targetUrl)) {
    return false;
  }
  if (chatgptSurfaceId(currentUrl) && chatgptSurfaceId(currentUrl) === chatgptSurfaceId(targetUrl)) return false;
  return currentUrl !== targetUrl;
}

function loginConfirmedKey(engine) {
  const norm = normalizeEngine(engine);
  if (norm === 'gemini') return 'geminiLoginConfirmed';
  if (norm === 'meta') return 'metaLoginConfirmed';
  return 'chatgptLoginConfirmed';
}

function accountProfileKey(engine) {
  const norm = normalizeEngine(engine);
  if (norm === 'gemini') return 'geminiAccountProfile';
  if (norm === 'meta') return 'metaAccountProfile';
  return 'chatgptAccountProfile';
}

function listGeminiStudios() {
  return [
    { id: 'planning', name: 'Content Pages Gem', kind: 'analysis', engine: 'gemini', url: CONTENT_GEM_URL },
    { id: 'seo-gem', name: 'SEO / Listing Gem', kind: 'listing', engine: 'gemini', url: SEO_GEM_URL },
    { id: 'mockups-gem', name: 'Mockups Gem', kind: 'thumbnail', engine: 'gemini', url: MOCKUPS_GEM_URL },
    { id: 'preview', name: 'Veo 3 Preview Gem', kind: 'preview', engine: 'gemini', url: PREVIEW_GEM_URL }
  ];
}

function listChatGptStudios() {
  return [
    { id: 'content-gpt', name: 'VERSA CLASS Gems Custom GPT', kind: 'content', engine: 'chatgpt', url: CONTENT_GPT_URL },
    { id: 'mockups-gpt', name: 'TPT Winner Mockups Custom GPT', kind: 'thumbnail', engine: 'chatgpt', url: MOCKUPS_GPT_URL },
    { id: 'seo-gpt', name: 'TPT Title SEO Custom GPT', kind: 'listing', engine: 'chatgpt', url: SEO_GPT_URL }
  ];
}

function findStudio(id) {
  const key = String(id || '').trim().toLowerCase();
  return [...listGeminiStudios(), ...listChatGptStudios()].find((item) => item.id === key) || null;
}

module.exports = {
  CHATGPT_URL,
  GEMINI_URL,
  STANDARD_GEMINI_URL,
  CONTENT_GPT_URL,
  MOCKUPS_GPT_URL,
  SEO_GPT_URL,
  CONTENT_PLANNING_GEM_URL,
  CONTENT_GEM_URL,
  MOCKUPS_GEM_URL,
  SEO_GEM_URL,
  PREVIEW_GEM_URL,
  META_URL,
  META_LOCAL_URL,
  normalizeEngine,
  engineDisplayName,
  isBrowserEngine,
  getEngineHomeUrl,
  jobRouteKind,
  getJobStartUrl,
  GEMINI_IMAGE_PROMPT_KINDS,
  wantsGeminiImageMode,
  isMetaLocalUrl,
  engineTarget,
  conversationMatchesEngine,
  isRetiredGeminiGemUrl,
  geminiGemId,
  geminiImageCreatorMode,
  isMetaHost,
  isMetaImageHost,
  isMetaPageUrl,
  withEngineImagePrefix,
  isChatGptHost,
  isGeminiHost,
  isGoogleAuthHost,
  isChatGptPageUrl,
  isGeminiPageUrl,
  isAllowedChatUrl,
  isChatHomeUrl,
  isChatGptHomeUrl,
  isGeminiHomeUrl,
  isGemHomeUrl,
  isPersistedConversationUrl,
  isChatGptConversationUrl,
  jobPageNeedsNavigation,
  geminiSurfaceId,
  chatgptSurfaceId,
  loginConfirmedKey,
  accountProfileKey,
  listGeminiStudios,
  listChatGptStudios,
  findStudio
};
