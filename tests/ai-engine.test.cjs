const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeEngine,
  engineDisplayName,
  getJobStartUrl,
  getEngineHomeUrl,
  withEngineImagePrefix,
  GEMINI_IMAGE_PROMPT_KINDS,
  wantsGeminiImageMode,
  isAllowedChatUrl,
  isPersistedConversationUrl,
  isMetaLocalUrl,
  conversationMatchesEngine,
  isBrowserEngine,
  jobRouteKind,
  jobPageNeedsNavigation,
  isRetiredGeminiGemUrl,
  geminiGemId,
  loginConfirmedKey,
  CONTENT_GPT_URL,
  MOCKUPS_GPT_URL,
  SEO_GPT_URL,
  CONTENT_GEM_URL,
  MOCKUPS_GEM_URL,
  SEO_GEM_URL,
  PREVIEW_GEM_URL,
  CHATGPT_URL,
  GEMINI_URL,
  META_URL
} = require('../src/ai-engine.cjs');

test('normalizeEngine is exclusive chatgpt, gemini, or meta', () => {
  assert.equal(normalizeEngine('gemini'), 'gemini');
  assert.equal(normalizeEngine('GEMINI'), 'gemini');
  assert.equal(normalizeEngine('meta'), 'meta');
  assert.equal(normalizeEngine('chatgpt'), 'chatgpt');
  assert.equal(normalizeEngine(''), 'chatgpt');
  assert.equal(normalizeEngine('both'), 'chatgpt');
  assert.equal(normalizeEngine({ target: 'gemini' }), 'gemini');
  assert.equal(normalizeEngine({ target: 'meta' }), 'meta');
  assert.equal(normalizeEngine({ engine: 'gemini' }), 'gemini');
  assert.equal(normalizeEngine({ target: 'chatgpt' }), 'chatgpt');
});

test('turning one engine on maps image jobs to that engine only', () => {
  assert.equal(getJobStartUrl({ kind: 'analysis' }, 'chatgpt'), CONTENT_GEM_URL);
  assert.equal(getJobStartUrl({ kind: 'listing' }, 'chatgpt'), SEO_GPT_URL);
  assert.equal(getJobStartUrl({ kind: 'thumbnail' }, 'chatgpt'), MOCKUPS_GPT_URL);
  assert.equal(getJobStartUrl({ kind: 'page' }, 'chatgpt'), CONTENT_GPT_URL);
  assert.equal(getJobStartUrl({ kind: 'page', purpose: 'image' }, 'chatgpt'), CONTENT_GPT_URL);

  assert.equal(getJobStartUrl({ kind: 'analysis' }, 'gemini'), CONTENT_GEM_URL);
  assert.equal(getJobStartUrl({ kind: 'listing' }, 'gemini'), SEO_GEM_URL);
  assert.equal(getJobStartUrl({ kind: 'thumbnail' }, 'gemini'), MOCKUPS_GEM_URL);
  assert.equal(getJobStartUrl({ kind: 'page' }, 'gemini'), CONTENT_GEM_URL);
  assert.equal(getJobStartUrl({ kind: 'cover' }, 'gemini'), CONTENT_GEM_URL);
  assert.equal(getJobStartUrl({ kind: 'page', purpose: 'image' }, 'gemini'), CONTENT_GEM_URL);
  assert.equal(getJobStartUrl({ kind: 'character_sheet' }, 'gemini'), MOCKUPS_GEM_URL);

  assert.notEqual(getJobStartUrl({ kind: 'page' }, 'gemini'), getJobStartUrl({ kind: 'page' }, 'chatgpt'));
  assert.ok(!String(getJobStartUrl({ kind: 'listing' }, 'gemini')).includes('chatgpt.com'));
  assert.ok(!String(getJobStartUrl({ kind: 'listing' }, 'chatgpt')).includes('gemini.google.com'));
  assert.equal(getJobStartUrl({ kind: 'page' }, 'meta'), META_URL);
  assert.equal(getJobStartUrl({ kind: 'thumbnail' }, 'meta'), META_URL);
  assert.equal(getJobStartUrl({ kind: 'listing' }, 'meta'), SEO_GEM_URL);
});

test('preview video jobs always open the Veo 3 custom gem', () => {
  assert.equal(jobRouteKind({ kind: 'preview' }), 'preview');
  assert.equal(jobRouteKind({ kind: 'preview_video' }), 'preview');
  assert.equal(jobRouteKind({ kind: 'veo' }), 'preview');
  assert.equal(jobRouteKind({ kind: 'veo3' }), 'preview');
  assert.equal(getJobStartUrl({ kind: 'preview' }, 'chatgpt'), PREVIEW_GEM_URL);
  assert.equal(getJobStartUrl({ kind: 'preview' }, 'gemini'), PREVIEW_GEM_URL);
  assert.equal(getJobStartUrl({ kind: 'preview' }, 'meta'), PREVIEW_GEM_URL);
  assert.equal(getJobStartUrl({ kind: 'veo' }, 'chatgpt'), PREVIEW_GEM_URL);
  assert.ok(String(PREVIEW_GEM_URL).includes('03e82ade1eb7'));
  assert.equal(isPersistedConversationUrl(PREVIEW_GEM_URL), false);
});

test('jobRouteKind keeps interior pages off the mockups gem', () => {
  assert.equal(jobRouteKind({ kind: 'page' }), 'content');
  assert.equal(jobRouteKind({ kind: 'page', purpose: 'image' }), 'content');
  assert.equal(jobRouteKind({ purpose: 'image' }), 'content');
  assert.equal(jobRouteKind({ kind: 'content' }), 'content');
  assert.equal(jobRouteKind({ kind: 'thumbnail' }), 'mockups');
  assert.equal(jobRouteKind({ kind: 'listing' }), 'seo');
  assert.equal(jobRouteKind({ kind: 'analysis' }), 'planning');
  assert.equal(jobRouteKind({ kind: 'blueprint' }), 'planning');
  assert.equal(jobRouteKind({ kind: 'prompts' }), 'planning');
  assert.equal(jobRouteKind({ kind: 'preview' }), 'preview');
});

test('studio kind content follows the XOR image engine, not Gemini planning', () => {
  assert.equal(jobRouteKind({ kind: 'content' }), 'content');
  assert.equal(getJobStartUrl({ kind: 'content' }, 'chatgpt'), CONTENT_GPT_URL);
  assert.equal(getJobStartUrl({ kind: 'content' }, 'gemini'), CONTENT_GEM_URL);
  assert.equal(getJobStartUrl({ kind: 'content' }, 'meta'), META_URL);
});

test('planning jobs always open the Gemini content gem', () => {
  for (const engine of ['chatgpt', 'gemini', 'meta']) {
    assert.equal(getJobStartUrl({ kind: 'analysis' }, engine), CONTENT_GEM_URL);
    assert.equal(getJobStartUrl({ kind: 'blueprint' }, engine), CONTENT_GEM_URL);
    assert.equal(getJobStartUrl({ kind: 'prompts' }, engine), CONTENT_GEM_URL);
  }
});

test('engine homes and conversation URL helpers accept both providers', () => {
  assert.equal(getEngineHomeUrl('chatgpt'), CHATGPT_URL);
  assert.equal(getEngineHomeUrl('gemini'), GEMINI_URL);
  assert.equal(getEngineHomeUrl('meta'), META_URL);
  assert.equal(getEngineHomeUrl({ target: 'gemini' }), GEMINI_URL);
  assert.equal(getEngineHomeUrl({ target: 'meta' }), META_URL);
  assert.equal(isAllowedChatUrl(CONTENT_GPT_URL), true);
  assert.equal(isAllowedChatUrl(CONTENT_GEM_URL), true);
  assert.equal(isAllowedChatUrl(META_URL), true);
  assert.equal(isAllowedChatUrl('meta://local/abc'), true);
  assert.equal(isAllowedChatUrl('https://www.teacherspayteachers.com/'), false);
  assert.equal(isPersistedConversationUrl('https://chatgpt.com/c/abc123'), true);
  assert.equal(isPersistedConversationUrl(CONTENT_GPT_URL), false);
  assert.equal(isPersistedConversationUrl(CONTENT_GEM_URL), false);
  assert.equal(isPersistedConversationUrl('https://gemini.google.com/app/abcdef1234'), true);
  assert.equal(isPersistedConversationUrl(META_URL), false);
  assert.equal(isPersistedConversationUrl('https://www.meta.ai/chat/abc'), true);
  assert.equal(isPersistedConversationUrl('meta://local/job-1'), false);
  assert.equal(isPersistedConversationUrl('meta://local'), false);
  assert.equal(isMetaLocalUrl('meta://local/job-1'), true);
  assert.equal(isBrowserEngine('meta'), true);
  assert.equal(isBrowserEngine('gemini'), true);
});

test('retired Gemini gems are never treated as live conversations', () => {
  const deleted = 'https://gemini.google.com/gem/be5ff5bc0446';
  const deletedChat = 'https://gemini.google.com/gem/d8064e71d731';
  assert.equal(isRetiredGeminiGemUrl(deleted), true);
  assert.equal(isRetiredGeminiGemUrl(deletedChat), true);
  assert.equal(isRetiredGeminiGemUrl(CONTENT_GEM_URL), false);
  assert.equal(isRetiredGeminiGemUrl(MOCKUPS_GEM_URL), false);
  assert.equal(isRetiredGeminiGemUrl(SEO_GEM_URL), false);
  assert.equal(isRetiredGeminiGemUrl(PREVIEW_GEM_URL), false);
  assert.equal(isRetiredGeminiGemUrl('https://gemini.google.com/u/0/gem/be5ff5bc0446'), true);
  assert.equal(isRetiredGeminiGemUrl('https://gemini.google.com/app/abcdef1234'), false);
  assert.equal(conversationMatchesEngine(deleted, 'gemini'), false);
  assert.equal(jobPageNeedsNavigation(deleted, CONTENT_GEM_URL, false), true);
  assert.equal(geminiGemId(CONTENT_GEM_URL), 'a825fb54b4cf');
  assert.equal(geminiGemId(deleted), 'be5ff5bc0446');
});

test('jobPageNeedsNavigation treats matching gem surfaces as reusable', () => {
  assert.equal(jobPageNeedsNavigation(CONTENT_GEM_URL, CONTENT_GEM_URL, false), false);
  assert.equal(jobPageNeedsNavigation(CONTENT_GEM_URL, SEO_GEM_URL, false), true);
  assert.equal(jobPageNeedsNavigation(CHATGPT_URL, CHATGPT_URL, false), false);
  assert.equal(jobPageNeedsNavigation(CONTENT_GPT_URL, MOCKUPS_GPT_URL, false), true);
  assert.equal(jobPageNeedsNavigation(META_URL, META_URL, false), false);
  assert.equal(jobPageNeedsNavigation('meta://local/a', 'meta://local/a', false), true);
});

test('Gemini image prompts force an image now and forbid conversational text', () => {
  assert.equal(withEngineImagePrefix('Draw a cover', 'chatgpt'), 'Draw a cover');
  // Interior pages get a light @image prefix only — heavy "generate now" wording
  // made the Content Pages Gem refuse with text instead of drawing.
  const prefixed = withEngineImagePrefix('Draw a cover', 'gemini');
  assert.match(prefixed, /^@image /);
  assert.match(prefixed, /Draw a cover/);
  assert.doesNotMatch(prefixed, /Do not write any conversational text/i);
  const already = withEngineImagePrefix('@image already prefixed visual scene with enough detail for a printable page', 'gemini');
  assert.equal(already, '@image already prefixed visual scene with enough detail for a printable page');
  assert.match(withEngineImagePrefix('Draw a cover', 'meta'), /Generate a single high-quality image now/i);
  assert.equal(withEngineImagePrefix('Imagine a cover', 'meta'), 'Imagine a cover');
  const mockup = withEngineImagePrefix('Create a 2000x2000 TPT hero thumbnail now.', 'gemini', { purpose: 'thumbnail' });
  assert.match(mockup, /listing mockup image now/i);
  assert.match(mockup, /Do not write any conversational text/i);
  assert.doesNotMatch(mockup, /printable page image now/i);
  assert.match(String(MOCKUPS_GEM_URL), /mode=image_creator/i);
  assert.equal(
    jobPageNeedsNavigation(
      'https://gemini.google.com/gem/6d30d7350cbc',
      MOCKUPS_GEM_URL,
      false
    ),
    true
  );
});

test('Gemini image generation mode is armed after prompts, not during text planning', () => {
  assert.equal(wantsGeminiImageMode('thumbnail', '', 'gemini'), true);
  assert.equal(wantsGeminiImageMode('page', '', 'gemini'), true);
  assert.equal(wantsGeminiImageMode('generate-prompts', '', 'gemini'), false);
  assert.equal(wantsGeminiImageMode('analysis-first', '', 'gemini'), false);
  assert.equal(wantsGeminiImageMode('listing', '', 'gemini'), false);
  assert.equal(wantsGeminiImageMode('prompt', '@image Draw this page', 'gemini'), true);
  assert.equal(wantsGeminiImageMode('page', '', 'chatgpt'), false);
  assert.ok(GEMINI_IMAGE_PROMPT_KINDS.has('thumbnail'));
  assert.ok(!GEMINI_IMAGE_PROMPT_KINDS.has('generate-prompts'));
});

test('XOR login keys stay independent', () => {
  assert.equal(loginConfirmedKey('chatgpt'), 'chatgptLoginConfirmed');
  assert.equal(loginConfirmedKey('gemini'), 'geminiLoginConfirmed');
  assert.equal(loginConfirmedKey('meta'), 'metaLoginConfirmed');
  assert.equal(engineDisplayName('gemini'), 'Gemini');
  assert.equal(engineDisplayName('chatgpt'), 'ChatGPT');
  assert.equal(engineDisplayName('meta'), 'Meta AI');
});

test('saved conversations only follow the active image engine', () => {
  assert.equal(conversationMatchesEngine('https://chatgpt.com/c/abc123', 'chatgpt'), true);
  assert.equal(conversationMatchesEngine('https://chatgpt.com/c/abc123', 'meta'), false);
  assert.equal(conversationMatchesEngine('https://chatgpt.com/c/abc123', 'gemini'), false);
  assert.equal(conversationMatchesEngine('https://gemini.google.com/app/abcdef', 'gemini'), true);
  assert.equal(conversationMatchesEngine('https://gemini.google.com/gem/a825fb54b4cf', 'meta'), false);
  assert.equal(conversationMatchesEngine('https://www.meta.ai/', 'meta'), true);
  assert.equal(conversationMatchesEngine('https://www.meta.ai/chat/abc', 'chatgpt'), false);
  assert.equal(conversationMatchesEngine('meta://local/job-1', 'meta'), false);
  assert.equal(conversationMatchesEngine('', 'meta'), false);
});
