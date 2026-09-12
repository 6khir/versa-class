const { EventEmitter } = require('node:events');
const { getMarketplace } = require('./marketplace-state.cjs');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const {
  appendFileSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} = require('node:fs');
const { homedir, hostname, tmpdir } = require('node:os');
const { basename, dirname, join, resolve } = require('node:path');
const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');
const { CdpActivationGuard } = require('./cdp-activation-guard.cjs');
let chromiumLib = null;
function getChromium() {
  if (!chromiumLib) {
    chromiumLib = require('playwright-core').chromium;
  }
  return chromiumLib;
}
const {
  buildAnalysisPrompt,
  buildPromptsGenerationRequest,
  buildPromptsContinuationRequest,
  parseGeneratedPrompts,
  mergeGeneratedPromptSlots,
  inspectGeneratedPromptProgress,
  estimatePromptProgressFromSample,
  densePromptPrefix,
  PROMPT_BATCH_SIZE,
  buildTptThumbnailImagePrompt,
  buildTptThumbnailRetryPrompt,
  buildTptPreviewVideoPrompt
} = require('./prompt-builder.cjs');
const {
  classifyGeminiTextObservation,
  decideGeminiTextAction,
  shouldReadFullGeminiTranscript,
  nextPromptBatchSize,
  analysisDraftUsable,
  GEMINI_TEXT_PHASE,
  BLOCKER_CHECK_MS,
  ANALYSIS_LAG_RETRY_MS
} = require('./gemini-text-observer.cjs');
const {
  classifyGeminiDraft,
  isGeminiChromeNoise,
  recoveryPauseMs
} = require('./gemini-behavior.cjs');
const {
  pickPreferredGeminiPage,
  shouldOneClickGeminiSignIn,
  classifyGeminiTabSession,
  googleAccountLocatorHints,
  isGoogleAccountChooserNoise
} = require('./gemini-session.cjs');
const { AccountPool } = require('./account-pool.cjs');
const {
  CHATGPT_URL,
  GEMINI_URL,
  resolvedContentGemUrl,
  META_LOCAL_URL,
  META_URL,
  normalizeEngine,
  engineDisplayName,
  isBrowserEngine,
  getEngineHomeUrl,
  getJobStartUrl,
  withEngineImagePrefix,
  wantsGeminiImageMode,
  isChatGptPageUrl,
  isGeminiPageUrl,
  isMetaPageUrl,
  isMetaImageHost,
  isAllowedChatUrl,
  isChatHomeUrl,
  isPersistedConversationUrl,
  isMetaLocalUrl,
  engineTarget,
  conversationMatchesEngine,
  jobPageNeedsNavigation,
  isRetiredGeminiGemUrl,
  geminiGemId,
  geminiImageCreatorMode,
  geminiSurfaceId,
  isGemHomeUrl,
  isGeminiHost,
  isGoogleAuthHost,
  isChatGptHost
} = require('./ai-engine.cjs');
const { MetaApiController } = require('./meta-api-controller.cjs');
// Page-image collectors are deliberately absent: marketing generators read the
// compiled document, never the raw interior pages.
function listingFileHelpers() {
  return require('./file-manager.cjs');
}
const {
  collectMockupUrlsInBrowser,
  competitorMockupPaths,
  downloadListingMockups,
  emptyMockupResult,
  extractListingMockupUrls,
  extractPageCountFromTptHtml,
  extractTptListingFacts,
  isCloudflareChallengeHtml,
  isTptProductUrl,
  parseTptProductUrl,
  resolveListingAnalysisInput,
  shouldCaptureListingMockups
} = require('./tpt-listing-mockups.cjs');
const {
  STAGE,
  STAGE_LAG_MS,
  isMarketplacePageUrl,
  observeStageProgress
} = require('./stage-watchdog.cjs');
const {
  BrowserSupervisor,
  ACTION: SUPERVISOR_ACTION,
  GENERATION_TIMEOUT_MS
} = require('./browser-supervisor.cjs');

const TPT_NEW_PRODUCT_URL = 'https://www.teacherspayteachers.com/My-Products/New/Digital-Next';
const TPT_MY_PRODUCTS_URL = 'https://www.teacherspayteachers.com/My-Products';

function unwrapCompressPdfResult(result, inputPath) {
  if (result && typeof result === 'object' && !Array.isArray(result) && result.path) {
    return {
      path: result.path,
      originalBytes: Number(result.originalBytes) || 0,
      outputBytes: Number(result.outputBytes) || Number(result.originalBytes) || 0,
      skipped: Boolean(result.skipped || result.path === inputPath),
      reason: result.reason || null,
      imagesReplaced: Number(result.imagesReplaced) || 0,
      inputPageCount: result.inputPageCount ?? null,
      outputPageCount: result.outputPageCount ?? null
    };
  }
  const path = typeof result === 'string' && result ? result : inputPath;
  return {
    path,
    originalBytes: 0,
    outputBytes: 0,
    skipped: path === inputPath,
    reason: path === inputPath ? 'using original PDF' : null,
    imagesReplaced: 0
  };
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function profileLockOwnerPid(profileDir) {
  if (!profileDir) return null;
  const lockPath = join(profileDir, 'SingletonLock');
  try {
    if (!lstatSync(lockPath).isSymbolicLink()) return null;
    const target = readlinkSync(lockPath);
    const match = String(target).match(/^(.*)-(\d+)$/);
    if (!match) return null;
    if (match[1] !== hostname()) return null;
    const pid = Number.parseInt(match[2], 10);
    return processIsAlive(pid) ? pid : null;
  } catch {
    return null;
  }
}

function clearStaleProfileLocks(profileDir) {
  if (!profileDir || !existsSync(profileDir)) return { cleared: false, ownerPid: null };
  const ownerPid = profileLockOwnerPid(profileDir);
  if (ownerPid) return { cleared: false, ownerPid };
  const lockNames = ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'DevToolsActivePort', 'LOCK'];
  let cleared = false;
  for (const name of lockNames) {
    const lockPath = join(profileDir, name);
    try {
      rmSync(lockPath, { force: true, recursive: true });
      cleared = true;
    } catch {}
  }
  return { cleared, ownerPid: null };
}

const TPT_FORM_SELECTORS = Object.freeze({
  title: '[data-testid="upload-form-item-name"], #ItemName, input[name="data[Item][name]"]',
  productFile: 'input[type="file"]#ItemDigitalProduct',
  productUploaded: '#ItemsPropertyProductUploaded',
  previewFile: 'input[type="file"]#ItemDigitalPreview',
  previewUploaded: '#ItemsPropertyPreviewUploaded',
  videoPreviewFile: 'input[type="file"]#UploadVideopreview',
  videoPreviewUploaded: '#UploadCustomVideopreviewUploaded',
  manualThumbnails: '#ItemGenerateThumbnail2',
  automaticThumbnails: '#ItemGenerateThumbnail1',
  laterThumbnails: '#ItemGenerateThumbnail3',
  description: '[contenteditable="true"][aria-label="Description"], [role="textbox"][aria-label="Description"]',
  freeResource: 'input[type="checkbox"][name="data[Item][free]"]',
  price: '[data-testid="upload-form-item-price"], #item-price',
  multipleLicensePrice: '[data-testid="upload-form-item-license-price"], #item-license-price',
  bundleDiscountPrice: '[data-testid="upload-form-item-discount-price"], #item-bundle-price',
  taxCode: '#taxCode-toggle-button',
  subjects: '#subject-areas',
  tags: '#tags',
  formats: '#formats',
  customCategories: '#custom-categories',
  grades: '[id^="data.Grade.Grade-checkbox_"][role="checkbox"]',
  teachingDuration: '#teachingDuration-toggle-button',
  pageCount: '[data-testid="upload-form-item-pages"], #numberOfPagesOrSlides',
  answerKey: '#answerKey-toggle-button',
  copyrightOriginal: 'input[type="radio"][name="data[ItemsProperty][copyright_declaration]"][value="1"]',
  copyrightLicensed: 'input[type="radio"][name="data[ItemsProperty][copyright_declaration]"][value="2"]',
  listingActive: 'input[type="checkbox"][name="data[Item][status_user]"]'
});

const TPT_FILE_LIMITS = Object.freeze({
  product: 4 * 1024 * 1024 * 1024,
  preview: 30 * 1024 * 1024,
  videoPreview: 1024 * 1024 * 1024,
  thumbnail: 4 * 1024 * 1024
});

const TPT_METADATA_PICKER_OPTIONS = Object.freeze({
  subjects: Object.freeze({
    allowFlexibleMatch: true,
    skipUnavailable: true,
    requireAtLeastOne: true
  }),
  tags: Object.freeze({
    allowTagFallback: true,
    skipUnavailable: true,
    requireAtLeastOne: true
  })
});

const GEMINI_INPUT_SELECTORS = [
  'rich-textarea .ql-editor[contenteditable="true"][aria-label*="Gemini" i]',
  'rich-textarea .ql-editor[contenteditable="true"][aria-label*="prompt" i]',
  'rich-textarea .ql-editor[contenteditable="true"]',
  '[role="textbox"][aria-label*="Gemini" i]',
  '[role="textbox"][aria-label*="prompt" i]',
  '[contenteditable="true"][data-placeholder*="Gemini" i]',
  '[contenteditable="true"][data-placeholder*="prompt" i]',
  'textarea[aria-label*="prompt" i]',
  'textarea[placeholder*="Gemini" i]',
  'chat-app rich-textarea .ql-editor',
  'gemini-chat-app rich-textarea .ql-editor',
  '.input-area rich-textarea .ql-editor'
];

const GEMINI_SUBMIT_SELECTORS = [
  'button[aria-label="Send message"]',
  'input-area-v2 button[aria-label="Send message"]',
  'input-container button[aria-label="Send message"]',
  'button[aria-label*="Send" i]',
  'button[mattooltip*="Send" i]',
  '.send-button'
];

const GEMINI_STOP_SELECTORS = [
  'button[aria-label="Stop response"]',
  'button[aria-label="Stop generating"]',
  'button[aria-label*="Stop" i]',
  'input-area-v2 button[aria-label*="Stop" i]',
  'input-container button[aria-label*="Stop" i]'
];

const GEMINI_BUSY_SELECTORS = [
  'button[aria-label="Stop response"]',
  'button[aria-label="Stop generating"]',
  'button[aria-label*="Stop" i]',
  '.model-response-label-announcer[aria-busy="true"]',
  'thinking-overlay',
  '.response-container-header-processing-state'
];

const GEMINI_ASSISTANT_MESSAGE_SELECTOR = 'model-response, response-container, chat-app message-content, .message-content';
const GEMINI_ASSISTANT_TEXT_SELECTOR = 'model-response message-content, response-container .message-content, chat-app message-content, .message-content';
const GEMINI_ATTACH_SELECTORS = [
  'button[aria-label="Upload & tools"]',
  'button[aria-label*="Upload & tools" i]',
  'button[aria-label*="Upload and tools" i]',
  'gem-icon-button[arialabel*="Upload" i] button',
  'button[aria-label*="Open upload file menu" i]',
  'button[aria-label*="Upload files" i]',
  'button[aria-label*="Add files" i]',
  'input-area-v2 button[aria-haspopup="menu"]',
  'input-container button[aria-haspopup="menu"]',
  '.menu-button.gem-menu-button'
];
const GEMINI_ATTACH_MENU_SELECTORS = [
  '[role="menuitem"]',
  '[role="menuitemradio"]',
  '[role="option"]',
  'button.mat-mdc-menu-item',
  '.mat-mdc-menu-item',
  'button.mat-mdc-list-item',
  'toolbox-drawer button',
  '.toolbox-drawer-item'
];
const GEMINI_IMAGE_MODE_NAME = /create images?|generate images?|image generation/i;
const IMAGE_TEXT_GRACE_MS = 120_000;

const META_INPUT_SELECTORS = [
  '[contenteditable="true"][role="textbox"]',
  '[data-lexical-editor="true"][contenteditable="true"]',
  'div[aria-label*="Ask Meta" i][contenteditable="true"]',
  'div[aria-placeholder*="Ask" i][contenteditable="true"]',
  'div[aria-placeholder*="Meta" i][contenteditable="true"]',
  '[role="textbox"][contenteditable="true"]',
  'textarea[placeholder*="Ask Meta" i]',
  'textarea[placeholder*="Ask" i]',
  'textarea[aria-label*="Ask" i]'
];

const META_SUBMIT_SELECTORS = [
  'div[role="button"][aria-label*="Send" i]',
  'svg[aria-label*="Send" i]',
  'button[aria-label="Submit"]',
  'button[aria-label="Send"]',
  'button[aria-label*="Send" i]',
  'button[type="submit"]'
];

const META_STOP_SELECTORS = [
  'button[aria-label*="Stop" i]',
  'button[aria-label*="Cancel" i]'
];

const META_BUSY_SELECTORS = [
  '[aria-busy="true"]',
  '[class*="loading" i]',
  '[class*="spinner" i]',
  'button[aria-label*="Stop" i]'
];

const META_ASSISTANT_SELECTOR = '[role="article"], [data-scope="assistant"], [data-author="assistant"]';

const COMPOSER_SELECTORS = [
  '#prompt-textarea',
  'textarea[data-id="root"]',
  'textarea[placeholder*="Message"]',
  'textarea[placeholder*="رسالة"]',
  'div.ProseMirror[contenteditable="true"]',
  '[contenteditable="true"][data-virtualkeyboard="true"]'
];

const SUBMIT_SELECTORS = [
  'button[data-testid="send-button"]',
  'button[data-testid="composer-submit-button"]',
  'button[data-id="send-button"]',
  'button[aria-label="Send prompt"]',
  'button[aria-label="Send message"]',
  'button[aria-label="إرسال"]',
  'button[aria-label*="Send"]',
  'button[aria-label*="send"]'
];

const STOP_SELECTORS = [
  'button[data-testid="stop-button"]',
  'button[aria-label*="Stop generating"]',
  'button[aria-label*="إيقاف"]'
];

const CHATGPT_BUSY_SELECTORS = [
  'button[data-testid="stop-button"]',
  'button[aria-label*="Stop generating"]',
  'button[aria-label*="إيقاف"]',
  '.result-streaming',
  '[data-testid="stop-button"]'
];

const IMAGE_SELECTORS = [
  'div[id^="image-"] img[src]',
  'img[alt^="Generated image"]',
  'img[src*="/backend-api/estuary/content"]',
  'img[src*="oaiusercontent"]',
  '[data-testid="image-gen-card"] img[src]'
];

const GPT_IMAGE_SELECTORS = [
  '[data-testid="image-gen-card"] img',
  '[data-testid*="image-gen"] img',
  'div[id^="image-"] img',
  'img[alt^="Generated image"]',
  'img[src*="oaiusercontent"]',
  'img[src*="/backend-api/estuary/content"]'
];

// ChatGPT currently marks conversation turns with `data-turn`. Older page
// versions used `data-message-author-role`, so keep both representations.
const ASSISTANT_MESSAGE_SELECTOR = [
  '[data-message-author-role="assistant"]',
  '[data-turn="assistant"]'
].join(', ');

const RATE_LIMIT_PATTERNS = [
  /quota exceeded/i,
  /you have reached your quota/i,
  /usage (?:cap|limit)/i,
  /you(?:'|’)ve reached (?:the|your) (?:current )?(?:usage |image )?limit/i,
  /usage cap/i,
  /image generation limit/i,
  /limit resets?/i,
  /try again after/i,
  /try again in/i,
  /لقد وصلت.*الحد/i,
  /تجاوزت.*الحد/i,
  /limite.*atteinte/i
];

const REQUEST_THROTTLE_PATTERNS = [
  /too many requests/i,
  /making requests too quickly/i,
  /temporarily limited access to your conversations/i,
  /please wait a few minutes before trying again/i
];

function classifyNoticeText(value) {
  const text = String(value ?? '');
  if (REQUEST_THROTTLE_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      code: 'REQUEST_THROTTLED',
      cooldownMs: 60_000,
      message: 'ChatGPT temporarily limited rapid conversation requests. The app will wait automatically, then retry the same page.'
    };
  }
  if (RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      code: 'RATE_LIMIT',
      message: 'This account reached its usage limit. Swap to the next saved profile to keep going without skipping the page.'
    };
  }
  return null;
}

const AUTH_TEXT_PATTERN = /log in to continue|sign in to continue|تسجيل الدخول للمتابعة|connectez-vous pour continuer/i;
const PASSIVE_STATE_CHECK_INTERVAL_MS = 2_000;
const IMAGE_GENERATION_OBSERVE_MS = 500;
const IMAGE_WAIT_HEARTBEAT_MS = 1_000;

const GENERATION_ERROR_PATTERNS = [
  /couldn(?:'|’)t generate/i,
  /unable to generate/i,
  /something went wrong while generating/i,
  /image generation failed/i,
  /incorrectly classify|incorrectly classifying/i,
  /edit of an existing image/i,
  /won(?:'|’)t generate/i,
  /cannot generate|can(?:'|’)t generate/i,
  /will not generate/i,
  /refus(?:e|es|ing) to generate/i,
  /unable to create/i,
  /cannot create|can(?:'|’)t create/i,
  /will not create/i,
  /not generate/i,
  /not generating/i,
  /I am unable to/i,
  /I cannot/i,
  /I can't/i,
  /no image (?:was|is|will be) generated/i,
  /I have unified all .{0,120}instruction/i,
  /wait for your explicit instructions/i,
  /Image-Only Response protocol/i,
  /My framework is unified/i,
  /instead of (?:a new|generating)/i,
  /تعذر.*إنشاء/i,
  /لم يقم بإنشاء/i,
  /لا يمكن إنشاء/i,
  /impossible de générer/i
];

const REFERENCE_REQUEST_PATTERNS = [
  /please (?:provide|upload|attach|share) (?:the|a) (?:reference|character|sample|source) image/i,
  /provide (?:the|a) (?:reference|character) image/i,
  /upload (?:the|a) (?:reference|character) image/i,
  /need (?:the|a) (?:reference|character) image/i,
  /send (?:the|a) (?:reference|character) image/i,
  /working with a reference/i,
  /based on the reference/i,
  /please upload the \d+ exact page images/i,
  /upload the \d+ exact page images/i,
  /please upload the .{0,80}page images/i,
  /upload the .{0,40}page images directly in this chat/i,
  /aren't available to the image editor/i,
  /are not available to the image editor/i,
  /usable image targets/i,
  /usable visual inputs/i,
  /as usable (?:visual|image) inputs/i,
  /image[- ]generation tool does not (?:currently )?have/i,
  /file[- ]library material/i,
  /I can see the reference PDF/i,
  /reference PDF, but the four page images/i,
  /صورة مرجعية/i,
  /إرفاق.*صورة/i,
  /تقديم.*صورة/i,
  /image de référence/i
];

function isThumbnailUploadStall(error) {
  const message = String(error?.message || '');
  return ['REFERENCE_REQUESTED_BY_GPT', 'REFERENCE_IMAGE_NOT_ATTACHED', 'REFERENCE_IMAGE_NOT_SENT'].includes(error?.code)
    || (
      error?.code === 'GENERATION_ERROR'
      && REFERENCE_REQUEST_PATTERNS.some((pattern) => pattern.test(message))
    );
}

// Video generation is slower and far more variable than images. The ceiling is high
// because the wait is governed by inactivity, not by this number.
const PREVIEW_VIDEO_TIMEOUT_MS = 45 * 60_000;
const PREVIEW_VIDEO_IDLE_TIMEOUT_MS = 10 * 60_000;

const GENERATION_PROGRESS_PATTERNS = [
  /generating image/i,
  /creating image/i,
  /generating video/i,
  /creating video/i,
  /generating your video/i,
  /generating/i,
  /creating/i,
  /veo/i,
  /finishing up/i,
  /finalizing image/i,
  /finalizing video/i
];

function shouldWaitForImageBeforeThrottle(blocker, generationInProgress) {
  return Boolean(generationInProgress && blocker?.code === 'REQUEST_THROTTLED');
}

function isNewAssistantImage(image, knownSignatures, assistantBaselineCount) {
  if (!image || image.width < 32 || image.height < 32) return false;
  if (image.fromUserTurn || image.inComposer) return false;
  if (knownSignatures?.has(image.signature)) return false;
  if (!Number.isInteger(assistantBaselineCount) || assistantBaselineCount < 0) return true;
  if (image.assistantIndex === -1) return true;
  return Number.isInteger(image.assistantIndex) && image.assistantIndex >= assistantBaselineCount;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const IMAGE_MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf'
};

function imageMimeType(filePath) {
  const extension = String(filePath || '').toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? '';
  return IMAGE_MIME_TYPES[extension] ?? 'application/octet-stream';
}

/**
 * Runs inside the page: counts image attachments on the most recent user turn.
 * Returns -1 when no user turn exists yet.
 *
 * Uploaded attachments are identified by their source rather than their rendered
 * size, because a size check reports zero while the thumbnails are still loading
 * and would wrongly condemn a message that did carry the pages. Images nested in a
 * control are skipped so message-toolbar icons never count.
 */
function countSentAttachmentsInBrowser() {
  const turns = [...document.querySelectorAll('[data-message-author-role="user"]')];
  const last = turns[turns.length - 1];
  if (!last) return -1;
  const container = last.closest('article') ?? last;
  const images = [...container.querySelectorAll('img')]
    .filter((image) => !image.closest('button, [role="button"]'))
    .filter((image) => /^blob:|^data:image|oaiusercontent|\/backend-api\/|\/files\//i.test(image.getAttribute('src') || ''));
  if (images.length) return images.length;
  return container.querySelectorAll('[data-testid*="attachment" i], [data-testid*="file-thumbnail" i]').length;
}

/**
 * Runs inside the page: counts attachment chips in the composer, not the transcript.
 * Generic "Remove" buttons are ignored so a settings control cannot fake a successful upload.
 */
function countComposerAttachmentChipsInBrowser() {
  const geminiArea = document.querySelector('input-area-v2, input-container, .input-area, chat-app, gemini-chat-app');
  const chatgptSend = document.querySelector('[data-testid="send-button"], #prompt-textarea');
  if (geminiArea && !chatgptSend) {
    const removeButtons = [...geminiArea.querySelectorAll('button')].filter((button) => {
      const label = `${button.getAttribute('aria-label') || ''} ${button.getAttribute('title') || ''}`;
      return /remove (file|attachment|image|photo)|remove uploaded|^remove$/i.test(label);
    });
    if (removeButtons.length) return removeButtons.length;
    const tiles = geminiArea.querySelectorAll('uploader-file-preview, file-preview, [class*="file-preview"], [class*="uploaded-file"]');
    if (tiles.length) return tiles.length;
    return [...geminiArea.querySelectorAll('img')].filter((image) => {
      if (image.closest('button, [role="button"], user-profile-picture')) return false;
      return /^(blob:|data:image)/i.test(image.getAttribute('src') || '');
    }).length;
  }
  const form = document.querySelector('form:has([data-testid="send-button"]), form:has(textarea), form:has([contenteditable="true"])')
    || document.querySelector('form');
  const root = form || document.querySelector('main') || document.body;
  const removeButtons = [...root.querySelectorAll('button')].filter((button) => {
    const label = `${button.getAttribute('aria-label') || ''} ${button.getAttribute('title') || ''}`;
    return /remove (file|attachment|image|photo)|remove uploaded|إزالة الملف|supprimer le fichier/i.test(label);
  });
  if (removeButtons.length) return removeButtons.length;
  const tiles = root.querySelectorAll('[data-testid*="file-thumbnail" i], [data-testid*="attachment" i], [data-testid*="composer-file" i]');
  if (tiles.length) return tiles.length;
  return [...root.querySelectorAll('img')].filter((image) => {
    if (image.closest('button, [role="button"]')) return false;
    return /^(blob:|data:image)/i.test(image.getAttribute('src') || '');
  }).length;
}

function collectChatGptImageCandidatesInBrowser() {
  const assistantSel = '[data-message-author-role="assistant"], [data-turn="assistant"], article';
  const userSel = '[data-message-author-role="user"], [data-turn="user"]';
  const selectors = [
    '[data-testid="image-gen-card"] img',
    '[data-testid*="image-gen"] img',
    'div[id^="image-"] img',
    'img[alt*="Generated image" i]',
    'img[alt*="Generated by DALL" i]',
    'img[alt*="Created with DALL" i]',
    'img[src*="oaiusercontent"]',
    'img[src*="/backend-api/estuary/content"]',
    'img[src*="dall-e"]'
  ];
  const assistantMessages = [...document.querySelectorAll(assistantSel)];
  const seen = new Set();
  const results = [];
  const consider = (image, fromAssistant = false, assistantMsg = null) => {
    if (!image) return;
    if (image.closest(userSel) || image.closest('[data-testid*="attachment" i]')) return;
    if (image.closest('form') && !fromAssistant) return;
    const raw = image.currentSrc || image.src || image.getAttribute('src') || '';
    if (!raw) return;
    if (/avatar|profile|icon|logo|sprite|user-icon/i.test(`${raw} ${image.className} ${image.alt || ''}`)) return;
    const slot = image.closest('div[id^="image-"]')?.id || image.closest('[data-testid*="image-gen"]')?.id || '';
    const signature = `${slot}::${raw.split('#')[0]}`;
    if (seen.has(signature)) return;
    seen.add(signature);
    const rect = image.getBoundingClientRect();
    const width = image.naturalWidth || Math.round(rect.width) || 0;
    const height = image.naturalHeight || Math.round(rect.height) || 0;
    const assistantMessage = assistantMsg || image.closest(assistantSel);
    results.push({
      signature,
      src: raw,
      alt: image.getAttribute('alt') || '',
      slot,
      generatedHint: /blob:|data:image|oaiusercontent|generated image|image-gen|dall/i.test(`${raw} ${slot} ${image.getAttribute('alt') || ''}`)
        || Boolean(image.closest('[data-testid*="image-gen"], div[id^="image-"]')),
      fromUserTurn: Boolean(image.closest(userSel)),
      inComposer: Boolean(image.closest('form')),
      assistantIndex: assistantMessage ? assistantMessages.indexOf(assistantMessage) : -1,
      width,
      height
    });
  };
  for (const selector of selectors) {
    for (const image of document.querySelectorAll(selector)) consider(image);
  }
  for (const message of assistantMessages) {
    for (const image of message.querySelectorAll('img')) consider(image, true, message);
  }
  return results;
}

function collectGeminiImageCandidatesInBrowser() {
  const assistantSel = 'model-response, response-container, chat-app message-content, .message-content, [data-turn="assistant"], [data-turn="model"], [data-message-author-role="model"], model-turn, .model-turn, .chat-turn, chat-turn, conversation-turn, div[class*="model-response"], div[class*="response-container"], infinite-scroller';
  const userSel = 'user-query, [data-turn="user"], [data-message-author-role="user"], user-turn, .user-turn';
  const composerSel = 'form, [role="textbox"], .input-area, [contenteditable="true"], rich-textarea, chat-window-footer, input-area-v2';
  const imageSelectors = [
    'model-response img',
    'message-content img',
    'response-container img',
    'generated-image img',
    'single-image img',
    'image-viewer img',
    'media-viewer img',
    'picture img',
    'img[src^="blob:"]',
    'img[src^="data:image"]',
    'img[alt*="Generated image" i]',
    'img[alt*="Created with Imagen" i]',
    'img[alt*="Generated by Gemini" i]',
    'img[alt*="Imagen" i]',
    'img[src*="googleusercontent.com"]',
    'img[src*="lh3.googleusercontent.com"]',
    'img'
  ];
  const assistantMessages = [...document.querySelectorAll(assistantSel)];
  const seen = new Set();
  const results = [];
  const consider = (image) => {
    if (!image) return;
    if (image.closest('user-profile-picture') || image.classList?.contains('user-icon')) return;
    if (image.closest(userSel)) return;
    if (image.closest(composerSel) && !image.closest(assistantSel)) return;
    const raw = image.currentSrc || image.src || image.getAttribute('src') || '';
    if (!raw) return;
    if (/gstatic\.com\/lamda|default-user=/.test(raw)) return;
    const rect = image.getBoundingClientRect();
    const width = image.naturalWidth || Math.round(rect.width) || 0;
    const height = image.naturalHeight || Math.round(rect.height) || 0;
    const signature = raw.split('#')[0];
    if (seen.has(signature)) return;
    seen.add(signature);
    const assistantMessage = image.closest(assistantSel);
    let assistantIndex = assistantMessage ? assistantMessages.indexOf(assistantMessage) : -1;
    if (assistantIndex === -1 && assistantMessages.length > 0) {
      assistantIndex = assistantMessages.length - 1;
    }
    results.push({
      signature,
      src: raw,
      alt: image.getAttribute('alt') || '',
      slot: '',
      generatedHint: /blob:|data:image|googleusercontent|generated image|imagen/i.test(`${raw} ${image.getAttribute('alt') || ''}`)
        || Boolean(image.closest('generated-image, single-image, image-viewer, model-response, response-container, picture')),
      fromUserTurn: false,
      inComposer: false,
      assistantIndex,
      width,
      height
    });
  };
  for (const selector of imageSelectors) {
    for (const image of document.querySelectorAll(selector)) consider(image);
  }
  for (const message of assistantMessages) {
    for (const image of message.querySelectorAll('img')) consider(image);
  }
  return results;
}

function collectMetaImageCandidatesInBrowser() {
  const seen = new Set();
  const results = [];
  const preferred = [...document.querySelectorAll('div[data-pressable-container="true"] img, img[alt*="Meta AI" i], [data-scope="assistant"] img, [role="article"] img')];
  const preferredSet = new Set(preferred);
  const rest = [...document.querySelectorAll('img')].filter((image) => !preferredSet.has(image));
  for (const image of [...preferred, ...rest]) {
    if (image.closest('[role="textbox"], form, [contenteditable="true"][role="textbox"]')) continue;
    const raw = image.currentSrc || image.src || image.getAttribute('src') || '';
    if (!raw) continue;
    if (/emoji|avatar|profile|icon|logo|spinner|sprite|pixel|placeholder|blur/i.test(`${raw} ${image.className} ${image.alt || ''}`)) continue;
    if (/^data:image\/svg/i.test(raw)) continue;
    const rect = image.getBoundingClientRect();
    const width = image.naturalWidth || Math.round(rect.width) || 0;
    const height = image.naturalHeight || Math.round(rect.height) || 0;
    if (width < 256 || height < 256) continue;
    const signature = raw.split('#')[0];
    if (seen.has(signature)) continue;
    seen.add(signature);
    const inMetaSurface = Boolean(image.closest('div[data-pressable-container="true"], [data-scope="assistant"], [role="article"]') || /meta ai/i.test(image.getAttribute('alt') || ''));
    results.push({
      signature,
      src: raw,
      alt: image.getAttribute('alt') || '',
      slot: '',
      generatedHint: inMetaSurface || /blob:|data:image|scontent|fbcdn|fbsbx|cdninstagram|meta\.ai|facebook/i.test(raw),
      fromUserTurn: Boolean(image.closest('[data-scope="user"]')),
      inComposer: false,
      assistantIndex: -1,
      width,
      height
    });
  }
  return results;
}

function collectGeminiVideoCandidatesInBrowser() {
  const assistantSel = 'model-response, response-container, chat-app message-content, .message-content, [data-message-author-role="assistant"]';
  const assistantMessages = [...document.querySelectorAll(assistantSel)];
  const seen = new Set();
  const results = [];
  const consider = (src, extra = {}) => {
    const raw = String(src || '').trim();
    if (!raw) return;
    if (/gstatic\.com\/lamda|default-user=|data:image\//i.test(raw)) return;
    const signature = raw.split('#')[0];
    if (seen.has(signature)) return;
    seen.add(signature);
    const assistantMessage = extra.element?.closest?.(assistantSel) || null;
    results.push({
      signature,
      src: raw,
      generatedHint: /\.mp4(\?|$)|video\/mp4|googleusercontent|blob:|googlevideo|veo|generated.video/i.test(`${raw} ${extra.contentType || ''}`),
      fromUserTurn: Boolean(extra.element?.closest?.('[data-message-author-role="user"], [data-turn="user"], user-query')),
      inComposer: Boolean(extra.element?.closest?.('form') && !assistantMessage),
      assistantIndex: assistantMessage ? assistantMessages.indexOf(assistantMessage) : -1,
      contentType: extra.contentType || 'video/mp4'
    });
  };
  for (const video of document.querySelectorAll('video, generated-video video, model-response video, media-player video')) {
    const source = video.querySelector('source');
    consider(video.currentSrc || video.src || source?.src || source?.getAttribute('src') || '', {
      element: video,
      contentType: source?.getAttribute('type') || 'video/mp4'
    });
  }
  for (const source of document.querySelectorAll('source[type*="video" i], source[src*=".mp4" i]')) {
    consider(source.src || source.getAttribute('src') || '', { element: source, contentType: source.getAttribute('type') || 'video/mp4' });
  }
  for (const link of document.querySelectorAll('a[href]')) {
    const href = link.href || link.getAttribute('href') || '';
    if (/\.mp4(\?|$)/i.test(href) || /videoplayback|googlevideo|download.*video|generated.video/i.test(href)) {
      consider(href, { element: link, contentType: 'video/mp4' });
    }
  }
  return results;
}

async function extractRenderedVideoInBrowser(src) {
  const wanted = String(src || '');
  const videos = [...document.querySelectorAll('video, generated-video video, model-response video, media-player video')];
  let video = videos.find((element) => {
    const source = element.querySelector('source');
    const current = element.currentSrc || element.src || source?.src || '';
    return current === wanted || current.split('#')[0] === wanted.split('#')[0];
  }) || videos.at(-1) || null;
  const fetchSrc = wanted || video?.currentSrc || video?.src || video?.querySelector('source')?.src || '';
  if (fetchSrc && /^(blob:|data:|https?:)/i.test(fetchSrc)) {
    try {
      const response = await fetch(fetchSrc, { credentials: 'include' });
      if (response.ok) {
        const contentType = response.headers.get('content-type') || 'video/mp4';
        const blob = await response.blob();
        const dataUrl = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        });
        if (dataUrl) return { dataUrl, contentType };
      }
    } catch {
      // Fall through.
    }
  }
  return null;
}

async function extractRenderedImageInBrowser(src) {
  const wanted = String(src || '');
  const assistantSel = '[data-message-author-role="assistant"], [data-message-author-role="model"], [data-turn="assistant"], [data-turn="model"], model-response, response-container, .message-content, model-turn, .model-turn, chat-turn';
  const userSel = '[data-message-author-role="user"], [data-turn="user"], user-query';
  const surfaceSel = '[data-testid="image-gen-card"], [data-testid*="image-gen"], div[id^="image-"], generated-image, single-image, image-viewer, media-viewer, model-response, response-container, picture, div[data-pressable-container="true"]';
  const imgs = [...document.querySelectorAll('img')];
  let image = imgs.find((element) => element.src === wanted || element.currentSrc === wanted);
  if (!image) {
    image = document.querySelector(`${surfaceSel} img, img[alt*="Generated image" i], img[alt*="Created with Imagen" i], img[alt*="Meta AI" i], generated-image img, single-image img, model-response img, response-container img, .message-content img`);
  }
  if (image && image.complete === false) {
    await new Promise((resolve) => {
      image.addEventListener('load', resolve, { once: true });
      setTimeout(resolve, 3_000);
    });
  }
  if (!image) {
    const assistantImages = [...document.querySelectorAll(`${assistantSel} img`)]
      .filter((element) => !element.closest(userSel) && !element.closest('[data-testid*="attachment" i]'))
      .sort((left, right) => (right.naturalWidth * right.naturalHeight) - (left.naturalWidth * left.naturalHeight));
    image = assistantImages[0] || null;
  }
  const paint = (element) => {
    if (!element || !(element.naturalWidth || element.width) || !(element.naturalHeight || element.height)) return null;
    const canvas = document.createElement('canvas');
    canvas.width = element.naturalWidth || element.width;
    canvas.height = element.naturalHeight || element.height;
    if (canvas.width < 32 || canvas.height < 32) return null;
    const context = canvas.getContext('2d');
    context.drawImage(element, 0, 0);
    return {
      dataUrl: canvas.toDataURL('image/png'),
      contentType: 'image/png'
    };
  };
  if (image) {
    try {
      const painted = paint(image);
      if (painted) return painted;
    } catch {
      // Tainted canvas — fall through to fetch.
    }
  }
  const fetchSrc = wanted || image?.currentSrc || image?.src || '';
  if (fetchSrc && /^(blob:|data:|https?:)/i.test(fetchSrc)) {
    try {
      const response = await fetch(fetchSrc, { credentials: 'include' });
      if (response.ok) {
        const contentType = response.headers.get('content-type') || 'image/png';
        const blob = await response.blob();
        const dataUrl = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        });
        if (dataUrl) return { dataUrl, contentType };
      }
    } catch {
      // Fall through to canvases in the image card.
    }
  }
  for (const canvas of document.querySelectorAll(`${surfaceSel} canvas`)) {
    if (canvas.width >= 32 && canvas.height >= 32) {
      try {
        return { dataUrl: canvas.toDataURL('image/png'), contentType: 'image/png' };
      } catch {
        continue;
      }
    }
  }
  return null;
}

function writeImageToOsClipboard(filePath) {
  try {
    const electron = require('electron');
    const image = electron.nativeImage.createFromPath(filePath);
    if (!image || image.isEmpty()) return false;
    electron.clipboard.writeImage(image);
    return true;
  } catch {
    return false;
  }
}

function tptFileUploadWaitPolicy(fileSize, limit) {
  const largeUpload = Number(limit) >= 1024 * 1024 * 1024;
  if (!largeUpload) {
    return {
      pollIntervalMs: 1_000,
      idleTimeoutMs: 15 * 60_000,
      maxTimeoutMs: 60 * 60_000
    };
  }
  const conservativeBytesPerSecond = 128 * 1024;
  const estimatedTransferMs = Math.max(0, Number(fileSize) || 0) / conservativeBytesPerSecond * 1_000;
  return {
    pollIntervalMs: 1_000,
    idleTimeoutMs: 60 * 60_000,
    maxTimeoutMs: Math.min(12 * 60 * 60_000, Math.max(2 * 60 * 60_000, estimatedTransferMs + 60 * 60_000))
  };
}

function tptSelectedFileMatches(selectedFile, filePath, fileSize) {
  return Boolean(
    selectedFile
    && selectedFile.name === basename(filePath)
    && Number(selectedFile.size) === Number(fileSize)
  );
}

async function waitForTptUploadCompletion({
  isUploaded,
  readActivity,
  isPageClosed = () => false,
  onActivity = null,
  policy,
  now = Date.now,
  sleepFn = sleep
}) {
  const startedAt = now();
  let lastActivityAt = startedAt;
  let lastSignature = null;
  let latestActivity = null;
  while (now() - startedAt < policy.maxTimeoutMs) {
    if (isPageClosed()) return { completed: false, reason: 'page_closed', activity: latestActivity };
    if (await isUploaded()) return { completed: true, reason: 'completed', activity: latestActivity };
    latestActivity = await readActivity().catch(() => null);
    if (latestActivity?.error) return { completed: false, reason: 'explicit_error', activity: latestActivity };
    const signature = String(latestActivity?.signature || '');
    if (signature && signature !== lastSignature) {
      lastSignature = signature;
      lastActivityAt = now();
      if (typeof onActivity === 'function') await onActivity(latestActivity);
    }
    if (now() - lastActivityAt >= policy.idleTimeoutMs) {
      return { completed: false, reason: 'idle', activity: latestActivity };
    }
    await sleepFn(policy.pollIntervalMs);
  }
  return { completed: false, reason: 'max_timeout', activity: latestActivity };
}

async function waitForReferenceImageUpload({
  isUploading,
  timeoutMs = 90_000,
  pollIntervalMs = 250,
  now = Date.now,
  sleepFn = sleep
}) {
  const deadline = now() + timeoutMs;
  while (now() < deadline && await isUploading()) {
    await sleepFn(pollIntervalMs);
  }
  return !await isUploading();
}

function pickBestNewAssistantImage(images, knownSignatures, assistantBaselineCount) {
  const matches = (Array.isArray(images) ? images : [])
    .filter((image) => isNewAssistantImage(image, knownSignatures, assistantBaselineCount))
    .sort((left, right) => {
      const hint = Number(Boolean(right.generatedHint)) - Number(Boolean(left.generatedHint));
      if (hint) return hint;
      const recency = (Number(right.assistantIndex) || 0) - (Number(left.assistantIndex) || 0);
      if (recency) return recency;
      return (right.width * right.height) - (left.width * left.height);
    });
  return matches[0] || null;
}

function isGoogleSessionCookie(cookie) {
  return Boolean(cookie?.value) && /^(?:SID|SSID|HSID|APISID|SAPISID|__Secure-1PSID|__Secure-3PSID|__Secure-1PSIDTS|__Secure-3PSIDTS)$/i.test(cookie.name);
}

function isChatGptSessionCookie(cookie) {
  const name = String(cookie?.name || '');
  const hasValue = cookie.value == null || Boolean(cookie.value) || Number(cookie.encrypted_length) > 0 || Number(cookie.value_length) > 0;
  if (!name || !hasValue) return false;
  return /^__Secure-next-auth\.session-token(?:\.\d+)?$/i.test(name)
    || /^__Host-next-auth\.session-token(?:\.\d+)?$/i.test(name)
    || /^unified_session_manifest$/i.test(name)
    || /^session-token$/i.test(name)
    || /^__Secure-next-auth\.callback-url$/i.test(name)
    || /^_account$/i.test(name)
    || /^oai-/i.test(name);
}


function installedBrowserCandidates() {
  const result = [];
  if (process.platform === 'darwin') {
    result.push(
      {
        executablePath: '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
        label: 'Google Chrome Canary',
        processName: 'Google Chrome Canary',
        userDataDir: join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome Canary')
      },
      {
        executablePath: `${homedir()}/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary`,
        label: 'Google Chrome Canary',
        processName: 'Google Chrome Canary',
        userDataDir: join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome Canary')
      }
    );
  } else if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA;
    const roots = [localAppData, process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)']].filter(Boolean);
    for (const root of roots) {
      result.push({
        executablePath: `${root}\\Google\\Chrome SxS\\Application\\chrome.exe`,
        label: 'Google Chrome Canary',
        processName: 'chrome.exe',
        userDataDir: localAppData ? `${localAppData}\\Google\\Chrome SxS\\User Data` : null
      });
    }
  } else {
    result.push(
      {
        executablePath: '/opt/google/chrome-canary/chrome',
        label: 'Google Chrome Canary',
        processName: 'google-chrome-canary',
        userDataDir: join(homedir(), '.config', 'google-chrome-canary')
      },
      {
        executablePath: '/usr/bin/google-chrome-canary',
        label: 'Google Chrome Canary',
        processName: 'google-chrome-canary',
        userDataDir: join(homedir(), '.config', 'google-chrome-canary')
      }
    );
  }
  return result;
}

function resolveInstalledBrowser(selectedProfile = null) {
  const installed = installedBrowserCandidates().filter((item) => item.executablePath && existsSync(item.executablePath));
  if (!installed.length) return null;
  if (selectedProfile?.browser) {
    const named = installed.find((item) => item.label === selectedProfile.browser);
    if (named) return named;
  }
  return installed.find((item) => item.userDataDir && existsSync(item.userDataDir)) || installed[0];
}

function browserCandidates() {
  return installedBrowserCandidates()
    .filter((candidate) => candidate.executablePath && existsSync(candidate.executablePath))
    .map(({ executablePath, label }) => ({ executablePath, label }));
}

function systemLoginArgs(profileKey = null, engine = 'chatgpt') {
  const args = [];
  // Put Chromium switches before the URL. Windows Chrome can otherwise hand
  // the URL to an already-running instance before it applies the profile
  // switch, which makes the user sign in to a different profile than the one
  // the app imports.
  if (/^(Default|Profile \d+)$/i.test(String(profileKey ?? ''))) {
    args.push(`--profile-directory=${profileKey}`);
  }
  args.push(getEngineHomeUrl(engine));
  return args;
}

function launchSystemLoginBrowser(executablePath, args, { spawnFn = spawn } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnFn(executablePath, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      });
    } catch (error) {
      reject(error);
      return;
    }

    const fail = (error) => {
      reject(Object.assign(new Error(`Could not open ${basename(executablePath)} for Google Chrome Canary sign-in: ${error.message}`), {
        code: 'SYSTEM_BROWSER_LOGIN_LAUNCH_FAILED',
        cause: error
      }));
    };
    child.once('error', fail);
    child.once('spawn', () => {
      child.removeListener('error', fail);
      child.unref?.();
      resolve(child);
    });
  });
}

function tptHumanVerificationArgs(profileDir) {
  return [
    `--user-data-dir=${profileDir}`,
    '--profile-directory=Default',
    '--no-first-run',
    '--no-default-browser-check',
    TPT_NEW_PRODUCT_URL
  ];
}

function isTptCloudflareChallengeText(value) {
  return /performing security verification|verify you are human|cloudflare/i.test(String(value ?? ''));
}

function isTptLoginPage(value, url = '') {
  return /teacherspayteachers\.com\/(?:Login|SignIn|Account\/Login)/i.test(String(url ?? ''))
    || /(?:log in|sign in)\s+(?:to\s+)?(?:teachers pay teachers|tpt)/i.test(String(value ?? ''));
}

function normalizeTptGrade(value) {
  const str = String(value ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .trim();
  const compact = str.replace(/[^a-z0-9]/g, '');
  const aliasMap = {
    pk: 'preschool',
    prek: 'preschool',
    prekindergarten: 'preschool',
    preschool: 'preschool',
    k: 'kindergarten',
    kindergarten: 'kindergarten',
    '1': '1stgrade', '1st': '1stgrade', '1stgrade': '1stgrade', 'grade1': '1stgrade', 'firstgrade': '1stgrade', 'first': '1stgrade',
    '2': '2ndgrade', '2nd': '2ndgrade', '2ndgrade': '2ndgrade', 'grade2': '2ndgrade', 'secondgrade': '2ndgrade', 'second': '2ndgrade',
    '3': '3rdgrade', '3rd': '3rdgrade', '3rdgrade': '3rdgrade', 'grade3': '3rdgrade', 'thirdgrade': '3rdgrade', 'third': '3rdgrade',
    '4': '4thgrade', '4th': '4thgrade', '4thgrade': '4thgrade', 'grade4': '4thgrade', 'fourthgrade': '4thgrade', 'fourth': '4thgrade',
    '5': '5thgrade', '5th': '5thgrade', '5thgrade': '5thgrade', 'grade5': '5thgrade', 'fifthgrade': '5thgrade', 'fifth': '5thgrade',
    '6': '6thgrade', '6th': '6thgrade', '6thgrade': '6thgrade', 'grade6': '6thgrade', 'sixthgrade': '6thgrade', 'sixth': '6thgrade',
    '7': '7thgrade', '7th': '7thgrade', '7thgrade': '7thgrade', 'grade7': '7thgrade', 'seventhgrade': '7thgrade', 'seventh': '7thgrade',
    '8': '8thgrade', '8th': '8thgrade', '8thgrade': '8thgrade', 'grade8': '8thgrade', 'eighthgrade': '8thgrade', 'eighth': '8thgrade',
    '9': '9thgrade', '9th': '9thgrade', '9thgrade': '9thgrade', 'grade9': '9thgrade', 'ninthgrade': '9thgrade', 'ninth': '9thgrade',
    '10': '10thgrade', '10th': '10thgrade', '10thgrade': '10thgrade', 'grade10': '10thgrade', 'tenthgrade': '10thgrade', 'tenth': '10thgrade',
    '11': '11thgrade', '11th': '11thgrade', '11thgrade': '11thgrade', 'grade11': '11thgrade', 'eleventhgrade': '11thgrade', 'eleventh': '11thgrade',
    '12': '12thgrade', '12th': '12thgrade', '12thgrade': '12thgrade', 'grade12': '12thgrade', 'twelfthgrade': '12thgrade', 'twelfth': '12thgrade',
    highered: 'highereducation',
    highereducation: 'highereducation',
    adulted: 'adulteducation',
    adulteducation: 'adulteducation',
    notgradespecific: 'notgradespecific',
    allgrades: 'notgradespecific'
  };
  if (aliasMap[compact]) return aliasMap[compact];
  const match = compact.match(/^([0-9]{1,2})(?:st|nd|rd|th)?(?:grade)?$/);
  if (match) {
    const num = match[1];
    const ordinals = { '1': '1st', '2': '2nd', '3': '3rd', '4': '4th', '5': '5th', '6': '6th', '7': '7th', '8': '8th', '9': '9th', '10': '10th', '11': '11th', '12': '12th' };
    if (ordinals[num]) return `${ordinals[num]}grade`;
  }
  return compact;
}

const TPT_TAG_GENERIC_WORDS = new Set([
  'activity',
  'activities',
  'book',
  'books',
  'lesson',
  'lessons',
  'resource',
  'resources',
  'story',
  'stories'
]);

function normalizeTptMetadataChoice(value) {
  const singular = {
    activities: 'activity',
    books: 'book',
    games: 'game',
    holidays: 'holiday',
    lessons: 'lesson',
    resources: 'resource',
    stories: 'story',
    worksheets: 'worksheet'
  };
  return String(value ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => singular[word] ?? word)
    .join(' ');
}

function tptTagSearchCandidates(value) {
  const original = String(value ?? '').trim();
  if (!original) return [];
  const words = original
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const orderedWords = [
    ...words.filter((word) => !TPT_TAG_GENERIC_WORDS.has(word))
  ];
  const candidates = [original, ...orderedWords];
  const seen = new Set();
  return candidates.filter((candidate) => {
    const normalized = normalizeTptMetadataChoice(candidate);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function tptMetadataChoiceMatches(optionLabel, searchTerm) {
  const option = normalizeTptMetadataChoice(optionLabel);
  const search = normalizeTptMetadataChoice(searchTerm);
  if (!option || !search) return false;
  if (option === search) return true;
  const searchWords = search.split(' ');
  if (searchWords.length !== 1) return false;
  const controlledShortTokens = new Set(['doc', 'docx', 'mp3', 'mp4', 'pdf', 'ppt', 'pptx', 'zip']);
  if (search.length < 4 && !controlledShortTokens.has(search)) return false;
  return option.split(' ').includes(search);
}

function chooseTptMetadataOption(optionLabels, searchTerm, preferredTerm = searchTerm) {
  const available = (Array.isArray(optionLabels) ? optionLabels : [])
    .map((label) => String(label ?? '').trim())
    .filter(Boolean);
  const normalizedSearch = normalizeTptMetadataChoice(searchTerm);
  const exact = available.find((label) => normalizeTptMetadataChoice(label) === normalizedSearch);
  if (exact) return exact;
  const preferredWords = new Set(normalizeTptMetadataChoice(preferredTerm).split(' ').filter((word) => word && word !== 'and'));
  const overlap = (label) => normalizeTptMetadataChoice(label)
    .split(' ')
    .filter((word) => preferredWords.has(word)).length;
  return available
    .filter((label) => tptMetadataChoiceMatches(label, searchTerm))
    .sort((left, right) => overlap(right) - overlap(left)
      || normalizeTptMetadataChoice(left).length - normalizeTptMetadataChoice(right).length)[0] ?? null;
}

function confirmedTptMetadataSelection(selectedLabels, expectedLabel) {
  const expected = normalizeTptMetadataChoice(expectedLabel);
  if (!expected) return null;
  return (Array.isArray(selectedLabels) ? selectedLabels : [])
    .map((label) => String(label ?? '').trim())
    .find((label) => normalizeTptMetadataChoice(label) === expected) ?? null;
}

function tptMetadataOptionIsSelectable({ visible = false, enabled = false, ariaDisabled = null } = {}) {
  return Boolean(visible && enabled && String(ariaDisabled).toLowerCase() !== 'true');
}

async function waitForTptMetadataSelection({ readSelectedLabels, expectedLabel, attempts = 20, wait = async () => {} }) {
  let selected = [];
  const maximumAttempts = Math.max(1, Number.parseInt(attempts, 10) || 1);
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    selected = await readSelectedLabels();
    const confirmed = confirmedTptMetadataSelection(selected, expectedLabel);
    if (confirmed) return { confirmed, selected };
    if (attempt + 1 < maximumAttempts) await wait();
  }
  return { confirmed: null, selected };
}

async function clearTptMultiSearchWhenNeeded({ readValue, clear }) {
  const searchValue = String(await readValue() || '');
  if (!searchValue) return false;
  await clear();
  return true;
}

function normalizeTptProductTitle(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u2012-\u2015]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function tptCheckboxStateMatches({ inputChecked = null, customVisible = false, customChecked = null } = {}, expectedChecked) {
  const expected = Boolean(expectedChecked);
  return inputChecked === expected && (!customVisible || customChecked === expected);
}

function resolveTptListingCard(cards, expectedTitle, publicationStatus = 'draft', baseUrl = TPT_MY_PRODUCTS_URL) {
  const expected = normalizeTptProductTitle(expectedTitle);
  if (!expected) return null;
  const match = (Array.isArray(cards) ? cards : []).find((card) => normalizeTptProductTitle(card?.title) === expected);
  if (!match) return null;
  const inactive = Boolean(match.inactive);
  if (publicationStatus === 'draft' && !inactive) return null;
  if (publicationStatus === 'active' && inactive) return null;
  // Inactive drafts can expose both links. The public product URL may be
  // unusable while inactive, so persist the edit URL as the canonical link.
  const href = publicationStatus === 'draft'
    ? match.editHref || match.productHref || ''
    : match.productHref || match.editHref || '';
  return {
    ...match,
    inactive,
    url: href ? new URL(href, baseUrl).href : baseUrl
  };
}

async function readVisibleTptValidationErrors(page) {
  return page.locator('[aria-invalid="true"], [role="alert"], .error-message, .field-error').evaluateAll((elements) => {
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const rectangle = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || 1) !== 0
        && rectangle.width > 0
        && rectangle.height > 0;
    };
    return elements
      .filter(visible)
      .map((element) => {
        const ownText = String(element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
        const validationMessage = String(element.validationMessage || '').replace(/\s+/g, ' ').trim();
        const nearbyAlert = element.matches('[aria-invalid="true"]')
          ? String(element.closest('label, fieldset, div')?.querySelector('[role="alert"], .error-message, .field-error')?.textContent || '').replace(/\s+/g, ' ').trim()
          : '';
        return ownText || validationMessage || nearbyAlert;
      })
      .filter(Boolean);
  }).catch(() => []);
}

async function waitForTptSubmissionOutcome({
  page,
  timeoutMs = 3 * 60_000,
  pollIntervalMs = 1_000,
  now = () => Date.now(),
  sleepFn = sleep
}) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    if (page.isClosed()) return { transitioned: false, pageClosed: true, validationErrors: [] };
    const url = page.url();
    if (!url.startsWith(TPT_NEW_PRODUCT_URL)) {
      return { transitioned: true, pageClosed: false, validationErrors: [], url };
    }
    const validationErrors = await readVisibleTptValidationErrors(page);
    if (validationErrors.length) {
      return { transitioned: false, pageClosed: false, validationErrors, url };
    }
    await sleepFn(pollIntervalMs);
  }
  return { transitioned: false, pageClosed: false, timedOut: true, validationErrors: [], url: page.url() };
}

function assessTptPreparedForm({ url = '', titleVisible = false, currentTitle = '', productStatusPresent = false } = {}, expectedTitle = '') {
  if (!String(url).startsWith(TPT_NEW_PRODUCT_URL)) {
    return { ready: false, reason: 'The prepared TPT product form is no longer open.' };
  }
  if (!titleVisible || !productStatusPresent) {
    return { ready: false, reason: 'The prepared TPT product form controls are no longer available.' };
  }
  const normalize = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  if (normalize(currentTitle) !== normalize(expectedTitle)) {
    return { ready: false, reason: 'The open TPT form belongs to a different product.' };
  }
  return { ready: true, reason: null };
}

function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function copyFileWithSharedRead(sourcePath, targetPath) {
  mkdirSync(dirname(targetPath), { recursive: true });
  let lastError = null;
  try {
    const buffer = readFileSync(sourcePath);
    writeFileSync(targetPath, buffer);
    return true;
  } catch (error) {
    lastError = error;
    try {
      copyFileSync(sourcePath, targetPath);
      return true;
    } catch (copyError) {
      lastError = copyError;
    }
  }
  throw lastError ?? Object.assign(new Error('The browser cookie file could not be copied.'), { code: 'COOKIE_COPY_FAILED' });
}

async function copyFileWithRetry(sourcePath, targetPath, { attempts = 8, retryDelayMs = 125 } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      copyFileWithSharedRead(sourcePath, targetPath);
      if (!existsSync(targetPath) || statSync(targetPath).size === 0) {
        throw Object.assign(new Error('The copied browser cookie file is empty.'), { code: 'COOKIE_COPY_EMPTY' });
      }
      return true;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(retryDelayMs * attempt);
    }
  }
  throw Object.assign(new Error(`The browser cookie file stayed locked after ${attempts} attempts.`), {
    code: 'COOKIE_COPY_LOCKED',
    cause: lastError
  });
}

function validateAndCheckpointSqliteSnapshot(snapshotPath) {
  let database = null;
  try {
    database = new DatabaseSync(snapshotPath);
    // Never use a blocking TRUNCATE checkpoint here. On Windows, Chrome can
    // leave a copied WAL in a state where TRUNCATE waits indefinitely and the
    // first-run login dialog appears frozen. PASSIVE returns immediately.
    database.exec('PRAGMA busy_timeout = 1000');
    const result = database.prepare('PRAGMA quick_check').get();
    if (!Object.values(result ?? {}).includes('ok')) {
      throw Object.assign(new Error('The copied browser cookie database did not pass SQLite validation.'), {
        code: 'COOKIE_SNAPSHOT_INVALID'
      });
    }
    const checkpoint = database.prepare('PRAGMA wal_checkpoint(PASSIVE)').get() ?? {};
    const busy = Number(checkpoint.busy ?? 0);
    const loggedFrames = Number(checkpoint.log ?? 0);
    const checkpointedFrames = Number(checkpoint.checkpointed ?? 0);
    if (busy || (Number.isFinite(loggedFrames) && Number.isFinite(checkpointedFrames) && loggedFrames !== checkpointedFrames)) {
      throw Object.assign(new Error('The copied browser cookie database changed before its snapshot could be completed.'), {
        code: 'COOKIE_SNAPSHOT_BUSY'
      });
    }
    return true;
  } finally {
    try { database?.close(); } catch {}
  }
}

async function backupCookieDatabase(sourcePath, targetPath, { attempts = 5, copyAttempts = 8, copyRetryDelayMs = 125 } = {}) {
  if (!existsSync(sourcePath)) {
    throw Object.assign(new Error('The selected browser cookie database no longer exists.'), {
      code: 'SYSTEM_COOKIES_NOT_FOUND'
    });
  }
  mkdirSync(dirname(targetPath), { recursive: true });
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const snapshotPath = `${targetPath}.snapshot-${process.pid}-${Date.now()}-${attempt}`;
    try {
      for (const suffix of ['', '-wal', '-shm', '-journal']) {
        try { rmSync(`${snapshotPath}${suffix}`, { force: true }); } catch {}
      }
      // SQLite's online backup restarts whenever Chrome mutates its WAL. A
      // busy browser can therefore keep that Promise alive forever. Copy a
      // bounded byte snapshot, validate it, then checkpoint its private WAL.
      await copyFileWithRetry(sourcePath, snapshotPath, { attempts: copyAttempts, retryDelayMs: copyRetryDelayMs });
      if (existsSync(`${sourcePath}-wal`)) {
        await copyFileWithRetry(`${sourcePath}-wal`, `${snapshotPath}-wal`, { attempts: copyAttempts, retryDelayMs: copyRetryDelayMs });
      }
      validateAndCheckpointSqliteSnapshot(snapshotPath);
      for (const suffix of ['', '-wal', '-shm', '-journal']) {
        try { rmSync(`${targetPath}${suffix}`, { force: true }); } catch {}
      }
      renameSync(snapshotPath, targetPath);
      for (const suffix of ['-wal', '-shm', '-journal']) {
        try { rmSync(`${snapshotPath}${suffix}`, { force: true }); } catch {}
      }
      return { bytes: statSync(targetPath).size, attempts: attempt };
    } catch (error) {
      lastError = error;
      for (const suffix of ['', '-wal', '-shm', '-journal']) {
        try { rmSync(`${snapshotPath}${suffix}`, { force: true }); } catch {}
      }
      if (attempt < attempts) await sleep(150 * attempt);
    }
  }
  throw Object.assign(new Error('The app could not create a stable snapshot of the browser cookie database. Close the normal Chrome/Edge window and try again.'), {
    code: 'COOKIE_SNAPSHOT_FAILED',
    cause: lastError
  });
}

const AUTH_COOKIE_HOST_SQL = `
  lower(host_key) = 'gemini.google.com'
  OR lower(host_key) LIKE '%.gemini.google.com'
  OR lower(host_key) = 'google.com'
  OR lower(host_key) LIKE '%.google.com'
  OR lower(host_key) = 'chatgpt.com'
  OR lower(host_key) LIKE '%.chatgpt.com'
  OR lower(host_key) = 'openai.com'
  OR lower(host_key) LIKE '%.openai.com'
  OR lower(host_key) = 'chat.openai.com'
  OR lower(host_key) LIKE '%.chat.openai.com'
  OR lower(host_key) = 'meta.ai'
  OR lower(host_key) LIKE '%.meta.ai'
  OR lower(host_key) = 'facebook.com'
  OR lower(host_key) LIKE '%.facebook.com'
  OR lower(host_key) = 'instagram.com'
  OR lower(host_key) LIKE '%.instagram.com'
`;

function filterAuthCookies(cookiePath) {
  if (!existsSync(cookiePath)) return 0;
  let database = null;
  try {
    database = new DatabaseSync(cookiePath);
    database.exec(`
      DELETE FROM cookies
      WHERE NOT (
        ${AUTH_COOKIE_HOST_SQL}
      )
    `);
    return Number(database.prepare('SELECT count(*) AS count FROM cookies').get()?.count ?? 0);
  } catch {
    return 0;
  } finally {
    try { database?.close(); } catch {}
  }
}

function localUploadFiles(paths) {
  return [...new Set((Array.isArray(paths) ? paths : [paths])
    .map((item) => {
      try {
        return resolve(String(item || ''));
      } catch {
        return '';
      }
    })
    .filter((item) => item && existsSync(item)))];
}

function managedCookiePath(profileDir) {
  return [join(profileDir, 'Default', 'Network', 'Cookies'), join(profileDir, 'Default', 'Cookies')]
    .find((cookiePath) => existsSync(cookiePath)) ?? null;
}

function readTptSessionState(profileDir) {
  const cookiePath = managedCookiePath(profileDir);
  const empty = { authenticated: false, clearance: false, activitySignature: '', cookiePath };
  if (!cookiePath) return empty;
  let database = null;
  try {
    database = new DatabaseSync(cookiePath, { readOnly: true });
    const columns = new Set(database.prepare('PRAGMA table_info(cookies)').all().map((column) => column.name));
    if (!columns.has('host_key') || !columns.has('name')) return empty;
    const projection = [
      'host_key',
      'name',
      columns.has('last_update_utc') ? 'last_update_utc' : "'' AS last_update_utc",
      columns.has('expires_utc') ? 'expires_utc' : "'' AS expires_utc",
      columns.has('encrypted_value') ? 'length(encrypted_value) AS encrypted_length' : '0 AS encrypted_length',
      columns.has('value') ? 'length(value) AS value_length' : '0 AS value_length'
    ].join(', ');
    const rows = database.prepare(`
      SELECT ${projection}
      FROM cookies
      WHERE lower(host_key) = 'teacherspayteachers.com'
        OR lower(host_key) LIKE '%.teacherspayteachers.com'
        OR (lower(name) = 'cf_clearance' AND (lower(host_key) = 'cloudflare.com' OR lower(host_key) LIKE '%.cloudflare.com'))
      ORDER BY lower(host_key), lower(name)
    `).all();
    const usableNames = new Set(rows
      .filter((row) => Number(row.encrypted_length) > 0 || Number(row.value_length) > 0)
      .map((row) => String(row.name).toLowerCase()));
    return {
      authenticated: usableNames.has('sessionkey') || usableNames.has('n_users') || usableNames.has('tpt'),
      clearance: usableNames.has('cf_clearance'),
      activitySignature: rows.map((row) => [
        row.host_key,
        row.name,
        row.last_update_utc,
        row.expires_utc,
        row.encrypted_length,
        row.value_length
      ].join(':')).join('|'),
      cookiePath
    };
  } catch {
    return empty;
  } finally {
    try { database?.close(); } catch {}
  }
}

function savedLoginStatePath(profileDir, engine) {
  return join(profileDir, 'saved-logins', `${engine}.json`);
}

function savedLoginFileHasCookies(profileDir, engine) {
  const filePath = savedLoginStatePath(profileDir, engine);
  if (!existsSync(filePath)) return false;
  try {
    const state = JSON.parse(readFileSync(filePath, 'utf8'));
    return Array.isArray(state?.cookies) && state.cookies.length > 0;
  } catch {
    return false;
  }
}

function readManagedLoginState(profileDir) {
  const empty = { chatgpt: false, gemini: false, meta: false };
  const fromFiles = {
    chatgpt: savedLoginFileHasCookies(profileDir, 'chatgpt'),
    gemini: savedLoginFileHasCookies(profileDir, 'gemini'),
    meta: savedLoginFileHasCookies(profileDir, 'meta')
  };
  const cookiePath = managedCookiePath(profileDir);
  if (!cookiePath) return { ...empty, ...fromFiles };
  let database = null;
  try {
    database = new DatabaseSync(cookiePath, { readOnly: true });
    const columns = new Set(database.prepare('PRAGMA table_info(cookies)').all().map((column) => column.name));
    if (!columns.has('host_key') || !columns.has('name')) return { ...empty, ...fromFiles };
    const projection = [
      'host_key',
      'name',
      columns.has('encrypted_value') ? 'length(encrypted_value) AS encrypted_length' : '0 AS encrypted_length',
      columns.has('value') ? 'length(value) AS value_length' : '0 AS value_length'
    ].join(', ');
    const rows = database.prepare(`
      SELECT ${projection}
      FROM cookies
      WHERE
        lower(host_key) LIKE '%chatgpt.com'
        OR lower(host_key) LIKE '%openai.com'
        OR lower(host_key) LIKE '%google.com'
        OR lower(host_key) LIKE '%meta.ai'
        OR lower(host_key) LIKE '%facebook.com'
    `).all();
    const hasPayload = (row) => Number(row.encrypted_length) > 0 || Number(row.value_length) > 0;
    const host = (row) => String(row.host_key || '').toLowerCase();
    const name = (row) => String(row.name || '');
    const chatgpt = rows.some((row) => hasPayload(row)
      && /chatgpt\.com|openai\.com/i.test(host(row))
      && isChatGptSessionCookie({ name: name(row), encrypted_length: row.encrypted_length, value_length: row.value_length, value: '1' }));
    const gemini = rows.some((row) => hasPayload(row)
      && /google\.com/i.test(host(row))
      && isGoogleSessionCookie({ name: name(row), value: '1' }));
    const meta = rows.some((row) => hasPayload(row)
      && /meta\.ai|facebook\.com/i.test(host(row))
      && /^(c_user|xs|datr|sb)$/i.test(name(row)));
    return {
      chatgpt: chatgpt || fromFiles.chatgpt,
      gemini: gemini || fromFiles.gemini,
      meta: meta || fromFiles.meta
    };
  } catch {
    return { ...empty, ...fromFiles };
  } finally {
    try { database?.close(); } catch {}
  }
}

function cookieHostExcludeSql(service) {
  const value = String(service || '').trim().toLowerCase();
  if (value === 'chatgpt') {
    return "lower(host_key) LIKE '%chatgpt.com' OR lower(host_key) LIKE '%openai.com'";
  }
  if (value === 'meta') {
    return "lower(host_key) LIKE '%meta.ai' OR lower(host_key) LIKE '%facebook.com' OR lower(host_key) LIKE '%instagram.com'";
  }
  if (value === 'gemini' || value === 'google') {
    return [
      "lower(host_key) = 'gemini.google.com'",
      "lower(host_key) LIKE '%.gemini.google.com'",
      "lower(host_key) = 'google.com'",
      "lower(host_key) LIKE '%.google.com'"
    ].join(' OR ');
  }
  return '0';
}

function preservedSessionCookieWhereSql(importing = '') {
  return `
    (
      ${AUTH_COOKIE_HOST_SQL}
      OR lower(host_key) = 'teacherspayteachers.com'
      OR lower(host_key) LIKE '%.teacherspayteachers.com'
      OR (lower(name) = 'cf_clearance' AND (lower(host_key) = 'cloudflare.com' OR lower(host_key) LIKE '%.cloudflare.com'))
    )
    AND NOT (${cookieHostExcludeSql(importing)})
  `;
}

function mergeCookieRows(targetCookiePath, preservedCookiePath, whereSql) {
  if (!existsSync(targetCookiePath) || !existsSync(preservedCookiePath) || !whereSql) return 0;
  let source = null;
  let target = null;
  try {
    source = new DatabaseSync(preservedCookiePath, { readOnly: true });
    target = new DatabaseSync(targetCookiePath);
    const sourceColumns = new Set(source.prepare('PRAGMA table_info(cookies)').all().map((column) => column.name));
    const targetColumns = target.prepare('PRAGMA table_info(cookies)').all().map((column) => column.name);
    const commonColumns = targetColumns.filter((column) => sourceColumns.has(column));
    if (!commonColumns.includes('host_key') || !commonColumns.includes('name')) return 0;
    const quotedColumns = commonColumns.map((column) => `"${String(column).replaceAll('"', '""')}"`).join(', ');
    const rows = source.prepare(`
      SELECT ${quotedColumns}
      FROM cookies
      WHERE ${whereSql}
    `).all();
    if (!rows.length) return 0;
    const placeholders = commonColumns.map(() => '?').join(', ');
    const insert = target.prepare(`INSERT OR REPLACE INTO cookies (${quotedColumns}) VALUES (${placeholders})`);
    target.exec('BEGIN');
    try {
      for (const row of rows) insert.run(...commonColumns.map((column) => row[column]));
      target.exec('COMMIT');
      return rows.length;
    } catch {
      try { target.exec('ROLLBACK'); } catch {}
      return 0;
    }
  } catch {
    return 0;
  } finally {
    try { source?.close(); } catch {}
    try { target?.close(); } catch {}
  }
}

function mergeTptCookies(targetCookiePath, preservedCookiePath) {
  return mergeCookieRows(targetCookiePath, preservedCookiePath, `
    lower(host_key) = 'teacherspayteachers.com'
    OR lower(host_key) LIKE '%.teacherspayteachers.com'
    OR (lower(name) = 'cf_clearance' AND (lower(host_key) = 'cloudflare.com' OR lower(host_key) LIKE '%.cloudflare.com'))
  `);
}

function mergePreservedSessionCookies(targetCookiePath, preservedCookiePath, { importing = '' } = {}) {
  return mergeCookieRows(targetCookiePath, preservedCookiePath, preservedSessionCookieWhereSql(importing));
}

function verifyServiceUrl(engine) {
  const kind = normalizeEngine(engine);
  if (kind === 'chatgpt') return CHATGPT_URL;
  if (kind === 'meta') return META_URL;
  return GEMINI_URL;
}

function isServiceSignInUrl(url, engine) {
  const value = String(url || '');
  if (engine === 'chatgpt') return /auth\.openai\.com|(chatgpt\.com|chat\.openai\.com)\/(auth|log-?in)/i.test(value);
  if (engine === 'meta') return /facebook\.com\/login|accounts\.facebook/i.test(value);
  return /accounts\.google\.com/i.test(value);
}

const SHOWN_WINDOW_BOUNDS = Object.freeze({
  windowState: 'normal',
  width: 1280,
  height: 860
});

function pidFromContext(context) {
  try {
    const pid = Number(context?.browser?.()?.process?.()?.pid);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function chromeAppBundleFromExecutable(executablePath) {
  const value = String(executablePath || '');
  const index = value.toLowerCase().lastIndexOf('.app/contents/macos/');
  if (index === -1) return null;
  return value.slice(0, index + 4);
}

function readDevToolsPort(profileDir) {
  if (!profileDir) return null;
  try {
    const text = readFileSync(join(profileDir, 'DevToolsActivePort'), 'utf8');
    const port = Number.parseInt(String(text).split(/\r?\n/)[0], 10);
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

function probeCdp(port) {
  return new Promise((resolve) => {
    if (!Number.isInteger(port) || port <= 0) {
      resolve(false);
      return;
    }
    const req = http.get({
      host: '127.0.0.1',
      port,
      path: '/json/version',
      timeout: 500
    }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

function chromeHasPages(port) {
  return new Promise((resolve) => {
    if (!Number.isInteger(port) || port <= 0) {
      resolve(false);
      return;
    }
    const req = http.get({
      host: '127.0.0.1',
      port,
      path: '/json/list',
      timeout: 1_500
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const list = JSON.parse(body);
          resolve(Array.isArray(list) && list.some((item) => item && (item.type === 'page' || item.webSocketDebuggerUrl)));
        } catch {
          resolve(false);
        }
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function ensureCdpTarget(port) {
  if (await chromeHasPages(port)) return true;
  return createCdpTarget(port);
}

function createCdpTarget(port, url = 'about:blank') {
  return new Promise((resolve) => {
    if (!Number.isInteger(port) || port <= 0) {
      resolve(false);
      return;
    }
    const path = `/json/new?${encodeURIComponent(url)}`;
    const req = http.get({
      host: '127.0.0.1',
      port,
      path,
      timeout: 2_000
    }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

const MANAGED_CDP_PORT = 9335;

async function readLiveCdpPort(profileDir, waitMs = 0) {
  const deadline = Date.now() + Math.max(0, waitMs);
  do {
    const fromFile = readDevToolsPort(profileDir);
    const ports = [...new Set([MANAGED_CDP_PORT, fromFile].filter((port) => Number.isInteger(port) && port > 0))];
    for (const port of ports) {
      if (await probeCdp(port)) return port;
    }
    if (Date.now() >= deadline) break;
    await sleep(80);
  } while (Date.now() <= deadline);
  return null;
}

async function quitManagedChrome(profileDir, pid = null) {
  const owner = Number.isInteger(pid) && pid > 0 ? pid : profileLockOwnerPid(profileDir);
  if (Number.isInteger(owner) && owner > 0) {
    try { process.kill(owner, 'SIGTERM'); } catch {}
  }
  const deadline = Date.now() + 8_000;
  while (profileLockOwnerPid(profileDir) && Date.now() < deadline) await sleep(200);
  const leftover = profileLockOwnerPid(profileDir);
  if (leftover) {
    try { process.kill(leftover, 'SIGKILL'); } catch {}
    await sleep(400);
  }
  clearStaleProfileLocks(profileDir);
}

function disconnectCdpBrowser(browser) {
  if (!browser) return;
  try { browser.removeAllListeners?.('disconnected'); } catch {}
  try {
    const connection = browser._connection;
    if (connection && typeof connection.close === 'function') {
      connection.close();
      return;
    }
  } catch {}
}

function disableChromeSpaceSwitchOnActivate() {
  if (process.platform !== 'darwin') return;
  try {
    const child = spawn('defaults', ['write', 'com.google.Chrome.canary', 'AppleSpacesSwitchOnActivate', '-bool', 'false'], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref?.();
  } catch {
    // Per-app Space switching is best-effort; hide-by-PID still applies.
  }
}

function jxaChromeVisibility(pid, visible) {
  if (process.platform !== 'darwin' || !Number.isInteger(pid) || pid <= 0) return;
  const action = visible
    ? 'app.unhide(); app.activateWithOptions($.NSApplicationActivateIgnoringOtherApps);'
    : 'if (!(app.hidden && app.hidden.js === true)) app.hide();';
  const script = [
    'ObjC.import("AppKit");',
    `const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(${pid});`,
    `if (app) { ${action} }`
  ].join('\n');
  try {
    const child = spawn('osascript', ['-l', 'JavaScript', '-e', script], { stdio: 'ignore', detached: true });
    child.unref?.();
  } catch {
    // Accessibility permission is optional; hidden launch flags still apply.
  }
}

function spawnHiddenChrome({ executablePath, args }) {
  disableChromeSpaceSwitchOnActivate();
  const child = spawn(executablePath, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: process.env
  });
  child.unref?.();
  return child;
}

function setChromeProcessVisible(pid, visible) {
  jxaChromeVisibility(pid, visible);
}

function prepareManagedProfileForBackground(profileDir, downloadDir = null) {
  disableChromeSpaceSwitchOnActivate();
  if (!profileDir) return;
  mkdirSync(join(profileDir, 'Default'), { recursive: true });
  const prefsPath = join(profileDir, 'Default', 'Preferences');
  let prefs = {};
  try {
    if (existsSync(prefsPath)) prefs = JSON.parse(readFileSync(prefsPath, 'utf8'));
    if (!prefs || typeof prefs !== 'object') prefs = {};
  } catch {
    prefs = {};
  }
  const profile = prefs.profile && typeof prefs.profile === 'object' ? prefs.profile : {};
  const session = prefs.session && typeof prefs.session === 'object' ? prefs.session : {};
  const browser = prefs.browser && typeof prefs.browser === 'object' ? prefs.browser : {};
  const download = prefs.download && typeof prefs.download === 'object' ? prefs.download : {};
  prefs.profile = { ...profile, exit_type: 'Normal', exited_cleanly: true };
  prefs.session = { ...session, restore_on_startup: 5 };
  prefs.browser = { ...browser, has_seen_welcome_page: true };
  prefs.exit_type = 'Normal';
  prefs.exited_cleanly = true;
  if (downloadDir) {
    prefs.download = {
      ...download,
      default_directory: downloadDir,
      prompt_for_download: false,
      directory_upgrade: true
    };
  }
  try {
    writeFileSync(prefsPath, JSON.stringify(prefs));
  } catch {}
  for (const relative of ['Current Session', 'Last Session', 'Current Tabs', 'Last Tabs']) {
    try { rmSync(join(profileDir, 'Default', relative), { force: true }); } catch {}
  }
  const sessionsDir = join(profileDir, 'Default', 'Sessions');
  if (!existsSync(sessionsDir)) return;
  try {
    for (const name of readdirSync(sessionsDir)) {
      if (/^(Session_|Tabs_)/i.test(name)) {
        try { rmSync(join(sessionsDir, name), { force: true }); } catch {}
      }
    }
  } catch {}
}

function managedChromeLaunchArgs({ background, profileDir }) {
  return [
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled',
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${MANAGED_CDP_PORT}`,
    '--remote-debugging-address=127.0.0.1',
    '--remote-allow-origins=*',
    '--disable-features=Translate,InfiniteSessionRestore,CalculateNativeWinOcclusion,MediaRouter',
    '--hide-crash-restore-bubble',
    '--disable-session-crashed-bubble',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-hang-monitor',
    '--disable-ipc-flooding-protection',
    '--noerrdialogs',
    '--window-size=1280,860'
  ];
}

function managedBrowserOptions({ background, downloadDir, profileDir }) {
  const args = [
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled',
    `--user-data-dir=${profileDir}`,
    '--remote-debugging-pipe',
    '--disable-features=Translate,InfiniteSessionRestore,CalculateNativeWinOcclusion,MediaRouter',
    '--hide-crash-restore-bubble',
    '--disable-session-crashed-bubble',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-hang-monitor',
    '--disable-ipc-flooding-protection',
    '--noerrdialogs',
    ...(background ? ['--no-startup-window'] : ['--window-size=1280,860'])
  ];
  return {
    // ChatGPT/Cloudflare block true Chromium headless. Background mode launches
    // a real headed Canary without switching Spaces or moving windows onto
    // other displays. Renderer backgrounding is disabled so Gemini keeps working.
    headless: false,
    acceptDownloads: true,
    downloadsPath: downloadDir,
    timeout: 45_000,
    viewport: null,
    locale: 'en-US',
    ignoreDefaultArgs: true,
    args
  };
}

function playwrightChromiumPath() {
  try {
    const filePath = getChromium().executablePath();
    return filePath && existsSync(filePath) ? filePath : null;
  } catch {
    return null;
  }
}

function scratchBrowserCandidates() {
  const result = [];
  const bundled = playwrightChromiumPath();
  if (bundled) result.push({ executablePath: bundled, label: 'Playwright Chromium' });
  if (process.platform === 'darwin') {
    result.push(
      { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', label: 'Google Chrome' },
      { executablePath: `${homedir()}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, label: 'Google Chrome' }
    );
  } else if (process.platform === 'win32') {
    const roots = [process.env.LOCALAPPDATA, process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)']].filter(Boolean);
    for (const root of roots) {
      result.push({ executablePath: `${root}\\Google\\Chrome\\Application\\chrome.exe`, label: 'Google Chrome' });
    }
  } else {
    result.push(
      { executablePath: '/usr/bin/google-chrome-stable', label: 'Google Chrome' },
      { executablePath: '/usr/bin/google-chrome', label: 'Google Chrome' },
      { executablePath: '/usr/bin/chromium-browser', label: 'Chromium' }
    );
  }
  for (const item of installedBrowserCandidates()) {
    result.push({ executablePath: item.executablePath, label: item.label });
  }
  const seen = new Set();
  return result.filter((item) => {
    if (!item.executablePath || !existsSync(item.executablePath) || seen.has(item.executablePath)) return false;
    seen.add(item.executablePath);
    return true;
  });
}

function isMissingPlaywrightBrowser(error) {
  const message = String(error?.message || error || '');
  return /Executable doesn't exist|browserType\.launch|playwright install|chromium_headless_shell/i.test(message);
}

function headlessScratchLaunchOptions({ downloadDir = null, executablePath = null, headed = false } = {}) {
  const options = {
    headless: !headed,
    timeout: 45_000,
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=Translate,MediaRouter',
      '--disable-dev-shm-usage',
      '--noerrdialogs',
      ...(headed ? ['--window-size=1280,860'] : ['--headless=new'])
    ]
  };
  if (executablePath) options.executablePath = executablePath;
  if (downloadDir) options.downloadsPath = downloadDir;
  return options;
}

async function launchHeadlessScratchBrowser({ downloadDir = null, headed = false } = {}) {
  const chromium = getChromium();
  const candidates = scratchBrowserCandidates();
  const attempts = candidates.length
    ? candidates
    : [{ executablePath: null, label: 'Playwright Chromium' }];
  let lastError = null;
  for (const candidate of attempts) {
    try {
      const browser = await chromium.launch(headlessScratchLaunchOptions({
        downloadDir,
        executablePath: candidate.executablePath,
        headed
      }));
      // #region agent log
      fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H70',location:'src/browser-controller.cjs:launchHeadlessScratchBrowser',message:'headless scratch browser launched',data:{source:candidate.label,hasExecutable:Boolean(candidate.executablePath)},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      return browser;
    } catch (error) {
      lastError = error;
      // #region agent log
      fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H70',location:'src/browser-controller.cjs:launchHeadlessScratchBrowser',message:'headless scratch launch failed',data:{source:candidate.label,missingBrowser:isMissingPlaywrightBrowser(error),error:String(error?.message||error).slice(0,180)},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
    }
  }
  throw Object.assign(new Error(
    'Versa Agent could not open a browser to read the marketplace. Install Google Chrome, or run npx playwright install chromium.'
  ), {
    code: 'PLAYWRIGHT_BROWSER_MISSING',
    cause: lastError,
    retryable: false
  });
}

class BrowserController extends EventEmitter {
  constructor({ profileDir, downloadDir, getMetaConfig = null }) {
    super();
    this.baseProfileDir = profileDir;
    this.downloadDir = downloadDir;
    this.getMetaConfig = typeof getMetaConfig === 'function' ? getMetaConfig : () => ({});
    this.context = null;
    this.page = null;
    this.humanPaused = false;
    this.humanDecision = null;
    this.humanObserveRequested = false;
    this.humanIntervention = null;
    this.tptUploadPage = null;
    this.tptUploadPages = new Map();
    this.jobPages = new Map();
    this.preparedJobs = new Map();
    // detectBlocker is called on every tick of every wait loop, and on a Gemini
    // page each call costs a full-DOM text scan plus two sign-in probes. A
    // blocker is a page-level condition that does not change between ticks, so
    // the result is reused for a moment instead of recomputed a hundred times
    // during one analysis.
    this.blockerCache = new WeakMap();
    this.launching = null;
    this.cancelVersion = 0;
    this.abortRequested = false;
    this.browserLabel = null;
    this.launchWarnings = [];
    this.headless = null;
    this.loginProcess = null;
    this.loginPending = false;
    this.loginCandidate = null;
    this.tptHumanVerification = null;
    this.lastPromptReceipt = null;
    this.engine = 'chatgpt';
    this.metaApi = null;
    this.metaSessions = new Map();
    this.metaImageCache = new Map();
    this.metaConversationUrl = META_LOCAL_URL;
    this.profileRotationList = [];
    this.currentProfileIndex = 0;
    this.enableProfileSwapping = false;
    this.accountPool = null;
    this.verifiedAccounts = {};
    this._lastLoginPersistAt = new Map();
    this.lastGeminiTextWatch = null;
    this.activeProfile = null;
    this.interactiveVisible = false;
    this.skipWindowChrome = false;
    this.verifyInFlight = null;
    this.browserPid = null;
    this.cdpBrowser = null;
    this.activationGuard = null;
    this._hideDaemon = null;
    this._hideDaemonPid = null;
    this._parkTimer = null;
    this._parkHeartbeat = null;
    this._parking = false;
    this._returnedAppFocus = false;
    this._watchersBound = null;
    this.supervisor = new BrowserSupervisor();
    this._supervisorReplacing = false;
  }

  attachStore(store) {
    this.supervisor.attachStore(store);
    return this.supervisor;
  }

  supervisorSnapshot() {
    return this.supervisor.snapshot();
  }

  async #closeExtraGeminiTabs(keep = null) {
    const pages = (this.context?.pages() || []).filter((item) => item && !item.isClosed());
    for (const extra of pages) {
      if (keep && extra === keep) continue;
      if (!isGeminiPageUrl(extra.url())) continue;
      await extra.close().catch(() => {});
    }
  }

  async #writeSupervisorSnapshot(page, decision = {}) {
    const dir = join(this.downloadDir || tmpdir(), 'supervisor-snapshots');
    mkdirSync(dir, { recursive: true });
    const stamp = Date.now();
    const url = page && typeof page.url === 'function' && !page.isClosed?.() ? String(page.url() || '') : '';
    let screenshot = null;
    try {
      if (page && !page.isClosed?.()) {
        screenshot = join(dir, `stall-${stamp}.png`);
        await page.screenshot({ path: screenshot, timeout: 5_000 });
      }
    } catch {
      screenshot = null;
    }
    const payload = {
      at: stamp,
      url,
      state: decision.state || this.supervisor.classified.state,
      reason: decision.reason || '',
      evidence: this.supervisor.classified.evidence || [],
      checkpoint: this.supervisor.checkpoint,
      screenshot
    };
    writeFileSync(join(dir, `stall-${stamp}.json`), JSON.stringify(payload));
    return payload;
  }

  async #applySupervisorDecision(decision, { gptUrl = null, stalePage = null } = {}) {
    if (this._supervisorReplacing && ['REPLACE_TAB', 'RECONNECT_BROWSER', 'RELOAD_TAB'].includes(decision.action)) {
      return stalePage;
    }
    this._supervisorReplacing = true;
    try {
      if (decision.action === SUPERVISOR_ACTION.SNAPSHOT) {
        await this.#writeSupervisorSnapshot(stalePage, decision);
        return stalePage;
      }
      if (decision.action === SUPERVISOR_ACTION.RECONNECT_BROWSER) {
        await this.#recoverManagedBrowser(decision.reason || 'supervisor-reconnect');
        const page = await this.ensurePage();
        await this.#ensureLiveGeminiStudio(page, gptUrl);
        await this.#disarmGeminiImageGeneration(page);
        await this.#closeExtraGeminiTabs(page);
        return page;
      }
      if (decision.action === SUPERVISOR_ACTION.RELOAD_TAB && stalePage && !stalePage.isClosed?.()) {
        await stalePage.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
        await this.#ensureLiveGeminiStudio(stalePage, gptUrl);
        return stalePage;
      }
      if (decision.action === SUPERVISOR_ACTION.REPLACE_TAB || decision.action === SUPERVISOR_ACTION.RETRY_PAGE) {
        if (stalePage && !stalePage.isClosed?.()) {
          await this.#disarmGeminiImageGeneration(stalePage);
          await this.#closeExtraGeminiTabs(stalePage);
          return stalePage;
        }
        const page = await this.#openFreshGeminiStudioTab(gptUrl, stalePage);
        await this.#disarmGeminiImageGeneration(page);
        await this.#closeExtraGeminiTabs(page);
        return page;
      }
      return stalePage;
    } finally {
      this._supervisorReplacing = false;
    }
  }

  setEngine(engine) {
    const next = normalizeEngine(engine);
    if (next !== this.engine) {
      this.preparedJobs.clear();
      if (this.context || this.launching || this.browserPid) {
        const shutdown = this.close().catch(() => {});
        this.launching = shutdown.then(() => {
          if (this.launching === shutdown) this.launching = null;
        });
      }
    }
    this.engine = next;
    return this.engine;
  }

  async withEngine(engine, work) {
    const previous = this.engine;
    this.setEngine(engine);
    try {
      return await work();
    } finally {
      this.setEngine(previous);
    }
  }

  get profileDir() {
    return join(this.baseProfileDir, this.engine || 'chatgpt');
  }

  inspectSavedLogins() {
    return readManagedLoginState(this.profileDir);
  }

  #clearSavedLoginState(engine) {
    try {
      rmSync(savedLoginStatePath(this.profileDir, engine), { force: true });
    } catch {}
  }

  async #persistLoginState(engine) {
    if (!this.context || !engine) return;
    try {
      const state = await this.context.storageState();
      if (!Array.isArray(state?.cookies) || !state.cookies.length) return;
      mkdirSync(join(this.profileDir, 'saved-logins'), { recursive: true });
      writeFileSync(savedLoginStatePath(this.profileDir, engine), JSON.stringify(state));
      this._lastLoginPersistAt.set(engine, Date.now());
    } catch {
      // Cookie snapshot is best-effort; the persistent Chrome profile is the source of truth.
    }
  }

  async #persistLoginStateThrottled(engine, minMs = 60_000) {
    const last = this._lastLoginPersistAt.get(engine) || 0;
    if (Date.now() - last < Math.max(5_000, Number(minMs) || 60_000)) return;
    await this.#persistLoginState(engine);
  }

  async #restorePersistedLoginCookies() {
    if (!this.context) return;
    const dir = join(this.profileDir, 'saved-logins');
    if (!existsSync(dir)) return;
    let files = [];
    try {
      files = readdirSync(dir).filter((name) => name.endsWith('.json'));
    } catch {
      return;
    }
    for (const file of files) {
      try {
        const state = JSON.parse(readFileSync(join(dir, file), 'utf8'));
        if (Array.isArray(state?.cookies) && state.cookies.length) {
          await this.context.addCookies(state.cookies);
        }
      } catch {}
    }
  }

  #managedChromePid() {
    return this.browserPid || profileLockOwnerPid(this.profileDir);
  }

  #startHideDaemon() {
    const pid = this.#managedChromePid();
    if (this._hideDaemon?.pid && this._hideDaemonPid === pid) return;
    this.#stopHideDaemon();
    if (process.platform !== 'darwin' || this.interactiveVisible || this.skipWindowChrome) return;
    if (!Number.isInteger(pid) || pid <= 0) return;
    const script = [
      'ObjC.import("AppKit");',
      `const pid = ${pid};`,
      'function hideNow() {',
      '  const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(pid);',
      '  if (!app) return;',
      '  if (app.hidden && app.hidden.js === true) return;',
      '  app.hide();',
      '}',
      'hideNow();',
      'while (true) { delay(0.5); hideNow(); }'
    ].join('\n');
    try {
      this._hideDaemon = spawn('osascript', ['-l', 'JavaScript', '-e', script], { stdio: 'ignore', detached: true });
      this._hideDaemon.unref?.();
      this._hideDaemonPid = pid;
    } catch {
      this._hideDaemon = null;
      this._hideDaemonPid = null;
    }
  }

  #stopHideDaemon() {
    const child = this._hideDaemon;
    this._hideDaemon = null;
    this._hideDaemonPid = null;
    if (!child?.pid) return;
    try { process.kill(child.pid, 'SIGTERM'); } catch {}
  }

  #hideManagedChrome() {
    if (this.interactiveVisible || this.skipWindowChrome) return;
    setChromeProcessVisible(this.#managedChromePid(), false);
    this.#startHideDaemon();
  }

  #showManagedChrome() {
    if (this.skipWindowChrome) return;
    this.#stopHideDaemon();
    this.activationGuard?.setInteractive(true);
    setChromeProcessVisible(this.#managedChromePid(), true);
  }

  #stopParkHeartbeat() {
    if (!this._parkHeartbeat) return;
    clearInterval(this._parkHeartbeat);
    this._parkHeartbeat = null;
  }

  #ensureParkHeartbeat() {
    if (this._parkHeartbeat || this.interactiveVisible) return;
    this._parkHeartbeat = setInterval(() => {
      if (this.interactiveVisible || !this.context) {
        this.#stopParkHeartbeat();
        return;
      }
      const pid = this.#managedChromePid();
      if (Number.isInteger(pid) && pid > 0) jxaChromeVisibility(pid, false);
    }, 2_000);
    this._parkHeartbeat.unref?.();
  }

  #schedulePark() {
    if (this.interactiveVisible) return;
    this.#hideManagedChrome();
    if (this._parkTimer) return;
    this._parkTimer = setTimeout(() => {
      this._parkTimer = null;
      this.#parkWindow().catch(() => {});
    }, 40);
  }

  #bindBackgroundWatchers(context) {
    if (!context || this._watchersBound === context) return;
    this._watchersBound = context;
    if (!this.interactiveVisible) this.#hideManagedChrome();
    context.on('page', () => {
      if (!this.interactiveVisible) this.#hideManagedChrome();
    });
  }

  async #parkWindow() {
    if (this.interactiveVisible || !this.context) return;
    this.activationGuard?.setInteractive(false);
    this.#hideManagedChrome();
    this.#ensureParkHeartbeat();
  }

  async #showWindow(page = this.page) {
    this.#stopParkHeartbeat();
    this.interactiveVisible = true;
    this.headless = false;
    this._returnedAppFocus = false;
    if (this.skipWindowChrome) return;
    this.#showManagedChrome();
    if (!this.context) return;
    const target = (page && !page.isClosed() ? page : null)
      || this.context.pages().find((item) => item && !item.isClosed());
    if (!target) return;
    const session = await this.context.newCDPSession(target).catch(() => null);
    if (!session) {
      await target.bringToFront().catch(() => {});
      return;
    }
    try {
      const { windowId } = await session.send('Browser.getWindowForTarget');
      await session.send('Browser.setWindowBounds', { windowId, bounds: SHOWN_WINDOW_BOUNDS });
      await target.bringToFront().catch(() => {});
    } catch {
      await target.bringToFront().catch(() => {});
    } finally {
      await session.detach().catch(() => {});
    }
  }

  async #afterNavigate(page = this.page) {
    if (this.interactiveVisible) return;
    await this.#parkWindow(page);
  }

  #isMeta() {
    return !isBrowserEngine(this.engine);
  }

  #meta() {
    if (!this.metaApi) {
      this.metaApi = new MetaApiController({ getConfig: () => this.getMetaConfig() });
    }
    return this.metaApi;
  }

  #metaStubPage(url = this.metaConversationUrl || META_LOCAL_URL) {
    const self = this;
    return {
      url: () => self.metaConversationUrl || url,
      goto: async (next) => {
        self.metaConversationUrl = String(next || META_LOCAL_URL);
      },
      bringToFront: async () => {},
      isClosed: () => false,
      title: async () => 'Meta AI (Local)',
      close: async () => {},
      reload: async () => {}
    };
  }

  #metaSessionKey(jobId, conversationUrl, baseline = []) {
    if (jobId && this.metaSessions.has(jobId)) return jobId;
    if (conversationUrl && this.metaSessions.has(conversationUrl)) return conversationUrl;
    const marker = (Array.isArray(baseline) ? baseline : []).find((item) => String(item).startsWith('meta::'));
    if (marker) return String(marker).slice(6);
    return jobId || conversationUrl || this.metaConversationUrl;
  }

  #rememberMetaSession({ jobId = null, prompt, attachmentPaths = [], conversationUrl, promptKind = 'prompt' }) {
    const session = {
      jobId,
      prompt,
      attachmentPaths,
      conversationUrl,
      promptKind,
      submittedAt: new Date().toISOString()
    };
    if (jobId) this.metaSessions.set(jobId, session);
    this.metaSessions.set(conversationUrl, session);
    this.metaConversationUrl = conversationUrl;
    return session;
  }

  async #metaStatus() {
    const probe = this.#meta().lastProbe;
    return {
      connected: Boolean(probe?.ok),
      url: this.metaConversationUrl || META_LOCAL_URL,
      title: 'Meta AI (Local)',
      browserLabel: 'Local APIs',
      launchWarnings: this.launchWarnings,
      headless: true,
      loginMode: false,
      activePages: this.jobPages.size,
      preparedPages: this.preparedJobs.size,
      engine: 'meta'
    };
  }

  #engineHome() {
    return getEngineHomeUrl(this.engine);
  }

  #serviceName(page = null) {
    if (page) {
      const kind = this.#pageKind(page);
      if (kind === 'gemini') return 'Gemini';
      if (kind === 'meta') return 'Meta AI';
      return 'ChatGPT';
    }
    return engineDisplayName(this.engine);
  }

  #pageKind(page) {
    const url = page?.url?.() ?? '';
    if (isMarketplacePageUrl(url)) return 'marketplace';
    if (isGeminiPageUrl(url)) return 'gemini';
    if (isMetaPageUrl(url)) return 'meta';
    if (isChatGptPageUrl(url)) return 'chatgpt';
    return normalizeEngine(this.engine);
  }

  #isManagedUploadPage(page) {
    if (!page) return false;
    if (this.tptUploadPage === page) return true;
    for (const item of this.tptUploadPages.values()) {
      if (item === page) return true;
    }
    return false;
  }

  async #closeManagedMarketplaceTabs() {
    const pages = (this.context?.pages() || []).filter((item) => item && !item.isClosed());
    let closed = 0;
    const urls = [];
    for (const page of pages) {
      if (this.#isManagedUploadPage(page)) continue;
      const url = String(page.url() || '');
      if (!isMarketplacePageUrl(url)) continue;
      urls.push(url.slice(0, 120));
      await page.close().catch(() => {});
      closed += 1;
    }
    if (this.page && this.page.isClosed()) this.page = null;
    if (closed) {
      // #region agent log
      fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H20',location:'src/browser-controller.cjs:#closeManagedMarketplaceTabs',message:'closed leftover marketplace tabs before studio work',data:{closed,urls},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      console.log(`[browser] Closed ${closed} leftover marketplace tab(s) so Gemini stays on Gemini.`);
    }
    return closed;
  }

  #isChatGptPage(page) {
    return this.#pageKind(page) === 'chatgpt';
  }

  #composerSelectors(page) {
    const kind = this.#pageKind(page);
    if (kind === 'gemini') return GEMINI_INPUT_SELECTORS;
    if (kind === 'meta') return META_INPUT_SELECTORS;
    return COMPOSER_SELECTORS;
  }

  #submitSelectors(page) {
    const kind = this.#pageKind(page);
    if (kind === 'gemini') return GEMINI_SUBMIT_SELECTORS;
    if (kind === 'meta') return META_SUBMIT_SELECTORS;
    return SUBMIT_SELECTORS;
  }

  #stopSelectors(page) {
    const kind = this.#pageKind(page);
    if (kind === 'gemini') return GEMINI_STOP_SELECTORS;
    if (kind === 'meta') return META_STOP_SELECTORS;
    return STOP_SELECTORS;
  }

  #assistantDraftConfig(page) {
    const kind = this.#pageKind(page);
    if (kind === 'chatgpt') {
      return {
        kind,
        stopSelectors: STOP_SELECTORS,
        busySelectors: CHATGPT_BUSY_SELECTORS,
        messageSelector: ASSISTANT_MESSAGE_SELECTOR,
        textSelector: ASSISTANT_MESSAGE_SELECTOR,
        collapsedRootSelector: ''
      };
    }
    if (kind === 'meta') {
      return {
        kind,
        stopSelectors: META_STOP_SELECTORS,
        busySelectors: META_BUSY_SELECTORS,
        messageSelector: META_ASSISTANT_SELECTOR,
        textSelector: META_ASSISTANT_SELECTOR,
        collapsedRootSelector: ''
      };
    }
    return {
      kind: 'gemini',
      stopSelectors: GEMINI_STOP_SELECTORS,
      busySelectors: GEMINI_BUSY_SELECTORS,
      messageSelector: GEMINI_ASSISTANT_MESSAGE_SELECTOR,
      textSelector: GEMINI_ASSISTANT_TEXT_SELECTOR,
      collapsedRootSelector: 'model-response:last-of-type, response-container:last-of-type'
    };
  }

  #writePromptReceipt(payload) {
    const receipt = {
      at: new Date().toISOString(),
      ...payload
    };
    this.lastPromptReceipt = receipt;
    if (!this.downloadDir) return receipt;
    try {
      writeFileSync(join(this.downloadDir, 'last-prompt-receipt.json'), JSON.stringify(receipt, null, 2));
    } catch (error) {
      console.warn(`[browser] could not write prompt receipt: ${error?.message || error}`);
    }
    return receipt;
  }

  #loginProcessIsActive() {
    return this.loginPending;
  }

  #loginProgress(stage, message) {
    this.emit('login-progress', {
      stage,
      message,
      timestamp: new Date().toISOString()
    });
  }

  async openLoginBrowser(selectedProfile = null, { target = null } = {}) {
    const engine = normalizeEngine(target || this.engine);
    this.setEngine(engine);
    const candidate = resolveInstalledBrowser(selectedProfile);
    if (!candidate) {
      throw Object.assign(new Error(`Google Chrome Canary is required to import a ${this.#serviceName()} login session.`), {
        code: 'SYSTEM_BROWSER_NOT_FOUND'
      });
    }
    this.loginPending = true;
    this.loginCandidate = candidate;
    this.browserLabel = candidate.label;
    this.#loginProgress('opening_window', `Opening ${this.#serviceName()} for sign-in...`);
    try {
      await this.launch({ interactive: true, forceBrowser: true, skipHome: true });
      await this.#openVerifyPage(engine);
    } finally {
      this.loginPending = false;
    }
    const status = await this.status();
    this.emit('status', status);
    return status;
  }

  async closeLoginBrowser() {
    this.loginProcess = null;
    this.loginPending = false;
    this.loginCandidate = null;
  }

  async importSystemLoginSession(selectedProfile = null, { service = null } = {}) {
    const importing = String(service || engineTarget(this.engine) || 'gemini').trim().toLowerCase();
    this.#loginProgress('closing_managed_browser', 'Closing the previous managed browser session…');
    if (this.context) await this.context.close().catch(() => {});
    this.context = null;
    this.page = null;
    this.jobPages.clear();
    this.preparedJobs.clear();

    const candidate = this.loginCandidate
      ?? resolveInstalledBrowser(selectedProfile);
    if (!candidate?.userDataDir || !existsSync(candidate.userDataDir)) {
      throw Object.assign(new Error('The Google Chrome Canary profile could not be found for session import.'), {
        code: 'SYSTEM_PROFILE_NOT_FOUND'
      });
    }
    const sourceLocalStatePath = join(candidate.userDataDir, 'Local State');
    const sourceLocalState = readJson(sourceLocalStatePath);
    const lastUsed = selectedProfile?.profileKey || String(sourceLocalState?.profile?.last_used || 'Default');
    if (!/^(Default|Profile \d+)$/i.test(lastUsed)) {
      throw Object.assign(new Error('The active Chrome profile name is not valid for import.'), { code: 'INVALID_SYSTEM_PROFILE' });
    }
    const sourceProfileDir = join(candidate.userDataDir, lastUsed);
    const sourceCookie = [
      { path: join(sourceProfileDir, 'Network', 'Cookies'), relativeTarget: join('Network', 'Cookies') },
      { path: join(sourceProfileDir, 'Cookies'), relativeTarget: 'Cookies' }
    ].find((item) => existsSync(item.path));
    if (!sourceCookie) {
      throw Object.assign(new Error(`No saved Chrome session was found. Open ${this.#serviceName()}, sign in, then verify again.`), {
        code: 'SYSTEM_COOKIES_NOT_FOUND'
      });
    }

    this.#loginProgress('copying_session', `Copying the ${candidate.label} session from ${lastUsed}…`);

    const targetProfileDir = join(this.profileDir, 'Default');
    const targetCookiePath = join(targetProfileDir, sourceCookie.relativeTarget);
    const preservedTptCookiePath = join(this.profileDir, 'tpt-session-preservation.sqlite');
    const existingManagedCookiePath = managedCookiePath(this.profileDir);
    mkdirSync(dirname(targetCookiePath), { recursive: true });
    try { rmSync(preservedTptCookiePath, { force: true }); } catch {}
    if (existingManagedCookiePath) {
      try {
        await backupCookieDatabase(existingManagedCookiePath, preservedTptCookiePath);
      } catch {}
    }
    try {
      let importedCookieCount = 1;
      let preservedTptCookieCount = 0;
      if (sourceCookie.path !== targetCookiePath) {
      for (const staleCookiePath of [join(targetProfileDir, 'Cookies'), join(targetProfileDir, 'Network', 'Cookies')]) {
        for (const suffix of ['', '-wal', '-shm', '-journal']) {
          try { rmSync(`${staleCookiePath}${suffix}`, { force: true }); } catch {}
        }
      }
      // A live Chrome process can lock its Cookies database on Windows. Do a
      // short, bounded attempt, then let verifyLogin offer direct sign-in in
      // the app-owned Chrome profile instead of locking this dialog for a long
      // chain of retries.
      await backupCookieDatabase(sourceCookie.path, targetCookiePath, {
        attempts: 2,
        copyAttempts: 3,
        copyRetryDelayMs: 100
      });
      this.#loginProgress('filtering_session', `Keeping ${this.#serviceName()} and related session cookies…`);
      importedCookieCount = filterAuthCookies(targetCookiePath);
      if (importedCookieCount < 1) {
        throw Object.assign(new Error(`The selected Chrome/Edge profile does not contain a saved ${this.#serviceName()} session. Sign in to ${this.#serviceName()} in that exact profile, then try again.`), {
          code: 'SYSTEM_CHATGPT_COOKIES_NOT_FOUND'
        });
      }
      preservedTptCookieCount = mergePreservedSessionCookies(targetCookiePath, preservedTptCookiePath, { importing });
      }

      const targetLocalStatePath = join(this.profileDir, 'Local State');
      const targetLocalState = readJson(targetLocalStatePath);
      if (sourceLocalState.os_crypt) targetLocalState.os_crypt = sourceLocalState.os_crypt;
      targetLocalState.profile = {
        ...(targetLocalState.profile ?? {}),
        last_used: 'Default',
        last_active_profiles: ['Default']
      };
      mkdirSync(this.profileDir, { recursive: true });
      writeFileSync(targetLocalStatePath, JSON.stringify(targetLocalState), { mode: 0o600 });
      this.loginPending = false;
      this.loginProcess = null;
      this.#loginProgress('session_copied', `Imported ${importedCookieCount} ${this.#serviceName()} session cookies.`);
      return { importedCookieCount, preservedTptCookieCount, sourceBrowser: candidate.label, sourceProfile: lastUsed };
    } finally {
      try { rmSync(preservedTptCookiePath, { force: true }); } catch {}
    }
  }

  async launch({ headless = true, interactive = false, forceBrowser = false, skipHome = false } = {}) {
    if (this.#isMeta() && !forceBrowser) {
      return this.#metaStatus();
    }
    const wantInteractive = Boolean(interactive);
    const background = !wantInteractive;
    if (headless && this.loginPending) {
      this.loginPending = false;
      this.loginProcess = null;
    }
    if (this.launching) {
      await this.launching;
    }
    if (this.context && !this.#cdpConnected()) {
      await this.#forgetPlaywrightSession();
    }
    if (this.context) {
      this.interactiveVisible = wantInteractive;
      this.headless = background;
      this.browserPid = this.browserPid || pidFromContext(this.context) || profileLockOwnerPid(this.profileDir);
      if (wantInteractive) await this.#showWindow(this.page);
      else await this.#parkWindow(this.page);
      if (!this.#isMeta() && !skipHome) this.page = await this.#findOrCreateChatPage();
      if (!wantInteractive) await this.#parkWindow(this.page);
      return this.status();
    }
    this.launching = this.#launchInternal({ background, skipHome }).finally(() => {
      if (this.launching) this.launching = null;
    });
    return this.launching;
  }

  #cdpConnected() {
    try {
      if (!this.context) return false;
      const browser = this.cdpBrowser || (typeof this.context.browser === 'function' ? this.context.browser() : null);
      if (browser && typeof browser.isConnected === 'function' && !browser.isConnected()) return false;
      this.context.pages();
      return true;
    } catch {
      return false;
    }
  }

  async #forgetPlaywrightSession() {
    const context = this.context;
    const cdpBrowser = this.cdpBrowser;
    this.context = null;
    this.page = null;
    this.tptUploadPage = null;
    this.tptUploadPages.clear();
    this.jobPages.clear();
    this.preparedJobs.clear();
    this.cdpBrowser = null;
    this._watchersBound = null;
    const pid = profileLockOwnerPid(this.profileDir);
    if (pid) this.browserPid = pid;
    const guard = this.activationGuard;
    this.activationGuard = null;
    if (guard) await guard.close().catch(() => {});
    if (context) {
      try { context.removeAllListeners?.('close'); } catch {}
    }
    disconnectCdpBrowser(cdpBrowser);
    if (!this.interactiveVisible) this.#hideManagedChrome();
  }

  _handleContextClosed(closedContext) {
    if (this.context !== closedContext) return false;
    this.context = null;
    this.page = null;
    this.tptUploadPage = null;
    this.tptUploadPages.clear();
    this.jobPages.clear();
    this.preparedJobs.clear();
    this.cdpBrowser = null;
    this._watchersBound = null;
    this._returnedAppFocus = false;
    const pid = profileLockOwnerPid(this.profileDir);
    if (pid) this.browserPid = pid;
    const guard = this.activationGuard;
    this.activationGuard = null;
    if (guard) guard.close().catch(() => {});
    if (!this.interactiveVisible) this.#hideManagedChrome();
    this.emit('status', this.status());
    return true;
  }

  async #grantSitePermissions(context) {
    if (!context) return;
    await Promise.all([
      context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://chatgpt.com' }),
      context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://chat.openai.com' }),
      context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://gemini.google.com' }),
      context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://www.meta.ai' }),
    ]).catch(() => {});
  }

  async #bindLaunchedContext(launchedContext, { background, skipHome, label, cdpBrowser = null, warnings = [] }) {
    this.context = launchedContext;
    this.cdpBrowser = cdpBrowser;
    await this.#grantSitePermissions(launchedContext);
    await this.#restorePersistedLoginCookies();
    this.browserLabel = label;
    this.launchWarnings = warnings;
    this.headless = background;
    this.interactiveVisible = !background;
    this.browserPid = pidFromContext(launchedContext) || profileLockOwnerPid(this.profileDir);
    this.#armContextAgainstActivation(launchedContext);
    launchedContext.once('close', () => this._handleContextClosed(launchedContext));
    if (cdpBrowser && typeof cdpBrowser.once === 'function') {
      cdpBrowser.once('disconnected', () => this._handleContextClosed(launchedContext));
    }
    this.#bindBackgroundWatchers(launchedContext);
    if (background) this.#hideManagedChrome();
    if (skipHome) {
      const pages = launchedContext.pages().filter((item) => item && !item.isClosed());
      this.page = pages.find((item) => item.url() === 'about:blank') || pages[0] || await launchedContext.newPage();
    } else {
      this.page = await this.#findOrCreateChatPage();
    }
    if (background) {
      this.#hideManagedChrome();
      await this.#parkWindow();
    } else {
      await this.#showWindow(this.page);
    }
    this.emit('status', await this.status());
    return this.status();
  }

  #silencePageActivation(page) {
    if (!page || page.__versaSilenced) return page;
    page.__versaSilenced = true;
    const original = page.bringToFront.bind(page);
    page.bringToFront = async () => {
      if (this.interactiveVisible) return original();
    };
    return page;
  }

  #armContextAgainstActivation(context) {
    if (!context || context.__versaArmed) return;
    context.__versaArmed = true;
    const originalNewPage = context.newPage.bind(context);
    context.newPage = async (...args) => {
      const page = await originalNewPage(...args);
      this.#silencePageActivation(page);
      if (!this.interactiveVisible) this.#hideManagedChrome();
      return page;
    };
    for (const page of context.pages()) this.#silencePageActivation(page);
  }

  #firstLivePage() {
    const pages = (this.context?.pages() || []).filter((item) => item && !item.isClosed());
    if (this.engine === 'gemini') {
      const preferred = pickPreferredGeminiPage(this.#geminiPageSnapshots())?.page;
      if (preferred && !preferred.isClosed()) return preferred;
      const gemini = pages.find((item) => isGeminiPageUrl(item.url()) || /accounts\.google\.com/i.test(String(item.url() || '')));
      if (gemini) return gemini;
    }
    if (this.page && !this.page.isClosed()) return this.page;
    return pages.find((item) => item.url() === 'about:blank') || pages[0] || null;
  }

  async #ensureBackgroundPage() {
    const existing = this.#firstLivePage();
    if (existing) {
      this.page = this.page && !this.page.isClosed() ? this.page : existing;
      this.#silencePageActivation(this.page);
      return this.page;
    }
    const page = await this.context.newPage();
    this.page = page;
    this.#silencePageActivation(page);
    if (!this.interactiveVisible) this.#hideManagedChrome();
    return page;
  }

  /**
   * Whether an error means the browser we were talking to is gone.
   *
   * Playwright reports a dead target as "Target page, context or browser has been
   * closed" from whichever call noticed. Reconnecting to that endpoint just produces
   * the same error again, which is how one dead Chrome turned into six stacked
   * connectOverCDP failures in a single message.
   */
  static isDeadBrowserError(error) {
    const text = String(error?.message || '');
    return /Target page, context or browser has been closed/i.test(text)
      || /browser has been closed|Browser closed|Target closed|WebSocket error|ECONNREFUSED/i.test(text);
  }

  /**
   * Put the managed browser back into a state a fresh launch can succeed from.
   *
   * A crashed Chrome leaves its profile lock behind, so the next launch believes an
   * instance is already running and connects to a corpse. Killing the owner and
   * clearing the lock files is what makes the retry meaningful rather than a repeat of
   * the same failure.
   */
  async #recoverManagedBrowser(reason = 'unknown') {
    await this.#forgetPlaywrightSession();
    try {
      await quitManagedChrome(this.profileDir, this.browserPid);
    } catch { /* best effort - the point is to get the lock released */ }
    clearStaleProfileLocks(this.profileDir);
    this.browserPid = null;
    this.emit('recovered', { scope: 'browser', reason });
    // Chrome needs a moment to release the profile after SIGTERM, or the relaunch trips
    // over the lock it is still holding.
    await sleep(1_200);
  }

  async #attachCdp(port, { background, skipHome, label, warnings = [] }) {
    const browser = await getChromium().connectOverCDP(`http://127.0.0.1:${port}`, {
      timeout: 20_000,
      isLocal: true
    });
    let context = browser.contexts()[0];
    if (!context) {
      await ensureCdpTarget(port);
      await sleep(250);
      context = browser.contexts()[0];
    }
    if (!context) {
      disconnectCdpBrowser(browser);
      throw new Error('Chrome Canary started without a usable session.');
    }
    return this.#bindLaunchedContext(context, {
      background,
      skipHome,
      label,
      cdpBrowser: browser,
      warnings
    });
  }

  async #adoptLiveChrome({ background, skipHome }) {
    const port = await readLiveCdpPort(this.profileDir, 1_500);
    if (!port) return null;
    if (!(await chromeHasPages(port))) return null;
    try {
      return await this.#attachCdp(port, { background, skipHome, label: 'Google Chrome Canary' });
    } catch {
      await this.#forgetPlaywrightSession();
      return null;
    }
  }

  async #launchForPromptWork() {
    await this.launch({ skipHome: false });
    await this.#closeManagedMarketplaceTabs();
  }

  async #launchInternal({ background = true, skipHome = false } = {}) {
    mkdirSync(this.profileDir, { recursive: true });
    mkdirSync(this.downloadDir, { recursive: true });
    const alreadyRunning = await this.#adoptLiveChrome({ background, skipHome });
    if (alreadyRunning) return alreadyRunning;

    const locked = clearStaleProfileLocks(this.profileDir);
    if (locked.ownerPid) {
      await quitManagedChrome(this.profileDir, locked.ownerPid);
    }

    const failures = [];
    prepareManagedProfileForBackground(this.profileDir, this.downloadDir);
    for (const candidate of browserCandidates()) {
      if (candidate.executablePath && !existsSync(candidate.executablePath)) continue;
      let attempt = 0;
      while (attempt < 2) {
        attempt += 1;
        try {
          spawnHiddenChrome({
            executablePath: candidate.executablePath,
            args: managedChromeLaunchArgs({ background, profileDir: this.profileDir })
          });
          const hideEarly = setInterval(() => {
            const pid = profileLockOwnerPid(this.profileDir);
            if (Number.isInteger(pid) && pid > 0) {
              this.browserPid = this.browserPid || pid;
              if (background) jxaChromeVisibility(pid, false);
            }
          }, 40);
          hideEarly.unref?.();
          let port;
          try {
            port = await readLiveCdpPort(this.profileDir, 20_000);
          } finally {
            clearInterval(hideEarly);
          }
          if (!port) {
            throw new Error('Chrome Canary did not open a background debugging port.');
          }
          this.browserPid = profileLockOwnerPid(this.profileDir);
          if (background) this.#hideManagedChrome();
          return await this.#attachCdp(port, {
            background,
            skipHome,
            label: candidate.label,
            warnings: failures
          });
        } catch (error) {
          await this.#forgetPlaywrightSession();
          // A dead target is recoverable and worth another pass: kill the corpse, drop
          // its lock, and launch clean. Without this the next attempt reconnects to the
          // same dead endpoint and fails identically.
          if (BrowserController.isDeadBrowserError(error) && attempt < 2) {
            await this.#recoverManagedBrowser(`launch: ${error.message.slice(0, 80)}`);
            continue;
          }
          const owner = profileLockOwnerPid(this.profileDir);
          if (owner && attempt === 1) {
            const live = await this.#adoptLiveChrome({ background, skipHome });
            if (live) return live;
            await quitManagedChrome(this.profileDir, owner);
            continue;
          }
          failures.push(`${candidate.label}: ${error.message}`);
          break;
        }
      }
    }
    // Deduplicate: repeating the same connectOverCDP failure six times tells the reader
    // nothing the first one did not, and buries the useful part of the message.
    const unique = [...new Set(failures.map((line) => line.replace(/\s+/g, ' ').trim()))];
    const error = new Error(`Google Chrome Canary could not be launched. ${unique.join(' | ')}`);
    error.code = 'BROWSER_LAUNCH_FAILED';
    error.attempts = failures.length;
    throw error;
  }

  async #deletedGeminiGemBannerVisible(page) {
    if (!page || page.isClosed()) return false;
    const banner = page.getByText(/this conversation was created with a gem that has been deleted/i).first();
    return banner.isVisible().catch(() => false);
  }

  async #ensureLiveGeminiStudio(page, targetUrl) {
    if (!page || page.isClosed() || !targetUrl || !isGeminiPageUrl(targetUrl)) return page;
    if (isMarketplacePageUrl(page.url())) {
      // #region agent log
      fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H20',location:'src/browser-controller.cjs:#ensureLiveGeminiStudio',message:'studio tab was a marketplace page; opening a fresh Gemini tab',data:{url:String(page.url()||'').slice(0,120)},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      return this.#openFreshGeminiStudioTab(targetUrl, page);
    }
    let dest = isRetiredGeminiGemUrl(targetUrl) ? resolvedContentGemUrl() : targetUrl;
    const targetGem = geminiGemId(dest);
    const wantsImageCreator = geminiImageCreatorMode(dest);
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await sleep(800);
      const current = page.url();
      const onGoogleSignIn = isServiceSignInUrl(current, 'gemini');
      const currentGem = geminiGemId(current);
      const deleted = isRetiredGeminiGemUrl(current) || await this.#deletedGeminiGemBannerVisible(page);
      const wrongGem = Boolean(targetGem && currentGem !== targetGem);
      const missingImageCreator = wantsImageCreator && !geminiImageCreatorMode(current);
      const unexpectedImage = !wantsImageCreator && (
        geminiImageCreatorMode(current)
        || await this.#geminiLooksLikeImageStudio(page)
      );
      if (!onGoogleSignIn && !deleted && !wrongGem && !missingImageCreator && !unexpectedImage) return page;
      if (deleted) dest = geminiGemId(dest) && !isRetiredGeminiGemUrl(dest) ? dest : resolvedContentGemUrl();
      await page.goto(dest, { waitUntil: 'domcontentloaded', timeout: STAGE_LAG_MS });
      await this.#afterNavigate(page);
      await sleep(400);
      const newChat = page.getByRole('button', { name: /new chat|start a new chat/i }).first();
      if (await newChat.isVisible().catch(() => false)) await newChat.click().catch(() => {});
    }
    return page;
  }

  async #openFreshGeminiStudioTab(gptUrl, stalePage = null) {
    if (!this.context) await this.launch({ skipHome: false });
    await this.#closeManagedMarketplaceTabs();
    const page = await this.#freshEnginePage();
    this.page = page;
    this.#silencePageActivation(page);
    if (gptUrl && jobPageNeedsNavigation(page.url(), gptUrl, true)) {
      await page.goto(gptUrl, { waitUntil: 'domcontentloaded', timeout: STAGE_LAG_MS });
      await sleep(1_000);
    }
    if (!isMarketplacePageUrl(page.url())) {
      await this.#ensureLiveGeminiStudio(page, gptUrl);
    }
    await this.#afterNavigate(page);
    if (stalePage && stalePage !== page && typeof stalePage.isClosed === 'function' && !stalePage.isClosed()) {
      await stalePage.close().catch(() => {});
    }
    await this.#closeExtraGeminiTabs(page);
    return page;
  }

  async #freshEnginePage() {
    const pages = (this.context?.pages() || []).filter((item) => item && !item.isClosed());
    const blank = pages.find((item) => {
      const url = String(item.url() || '');
      return url === 'about:blank' || url === 'chrome://newtab/' || url === 'chrome://new-tab-page/';
    });
    if (blank) return blank;
    return this.context.newPage();
  }

  async #findOrCreateChatPage(preferredHome = null) {
    const pages = this.context.pages();
    const home = this.engine === 'gemini' ? (preferredHome || resolvedContentGemUrl()) : this.#engineHome();
    // A page already inside a conversation is acceptable as-is: Gemini serves chats
    // under the gem's canonical id, which need not match a registered gem URL, and
    // navigating away would abandon a generation the queue is waiting on.
    const inConversation = (url) => /\/gem\/[^/]+\/[^/?#]+/.test(String(url || ''));
    const matchesEngine = (url) => {
      if (this.engine === 'gemini') return isGeminiPageUrl(url) && (inConversation(url) || !isRetiredGeminiGemUrl(url));
      if (this.engine === 'meta') return isMetaPageUrl(url);
      return isChatGptPageUrl(url);
    };
    let page = this.engine === 'gemini'
      ? pickPreferredGeminiPage(this.#geminiPageSnapshots())?.page
      : pages.find((item) => matchesEngine(item.url()));
    if (!page) {
      page = pages.find((item) => this.engine === 'gemini' && isGeminiPageUrl(item.url()))
        || await this.#freshEnginePage();
    }
    if (!matchesEngine(page.url())) {
      try {
        await page.goto(home, { waitUntil: 'domcontentloaded', timeout: this.engine === 'meta' ? 120_000 : 60_000 });
      } catch (error) {
        if (matchesEngine(page.url())) return page;
        throw error;
      }
    }
    if (this.engine === 'gemini') await this.#ensureLiveGeminiStudio(page, home);
    await this.#afterNavigate(page);
    return page;
  }

  async #minimizeWindow(page) {
    await this.#parkWindow(page);
  }

  async ensurePage() {
    if (this.#isMeta()) return this.#metaStubPage();
    await this.launch({ skipHome: true });
    this.page = await this.#findOrCreateChatPage();
    await this.#afterNavigate(this.page);
    return this.page;
  }

  #tptPageForProject(projectId = null) {
    const projectPage = projectId ? this.tptUploadPages.get(String(projectId)) : null;
    if (projectPage?.isClosed()) this.tptUploadPages.delete(String(projectId));
    if (projectPage && !projectPage.isClosed()) return projectPage;
    if (!projectId && this.tptUploadPage && !this.tptUploadPage.isClosed()) return this.tptUploadPage;
    return null;
  }

  #rememberTptPage(projectId, page) {
    this.tptUploadPage = page;
    if (projectId) this.tptUploadPages.set(String(projectId), page);
  }

  async openTptDraftUpload({ projectId = null } = {}) {
    await this.launch({ skipHome: true, forceBrowser: true });
    if (!this.context) throw Object.assign(new Error('A Google Chrome Canary browser context is not active.'), { code: 'BROWSER_NOT_LAUNCHED' });
    if (this.tptUploadPage?.isClosed()) this.tptUploadPage = null;
    const context = this.context;
    const page = this.#tptPageForProject(projectId) ?? await context.newPage();
    if (this.context !== context) {
      await page.close().catch(() => {});
      throw Object.assign(new Error('The app-owned Chrome session changed while the TPT form was opening. Try the upload again.'), {
        code: 'BROWSER_CONTEXT_CHANGED'
      });
    }
    this.#rememberTptPage(projectId, page);
    if (!page.url().startsWith(TPT_NEW_PRODUCT_URL)) await page.goto(TPT_NEW_PRODUCT_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 120_000
    });
    await this.#afterNavigate(page);
    return { ...(await this.status()), url: page.url() };
  }

  async #tptProgress(onProgress, stage, message) {
    if (typeof onProgress === 'function') await onProgress({ stage, message });
  }

  async #closeControlledContext() {
    const controlledContext = this.context;
    if (controlledContext) await controlledContext.close().catch(() => {});
    if (this.context === controlledContext) this._handleContextClosed(controlledContext);
  }

  async runTptHumanVerificationHandoff({ onProgress, requireClearance = true } = {}) {
    if (this.tptHumanVerification) return this.tptHumanVerification.promise;
    const candidate = resolveInstalledBrowser();
    if (!candidate) {
      throw Object.assign(new Error('Google Chrome Canary is required for the manual TPT security verification.'), {
        code: 'SYSTEM_BROWSER_NOT_FOUND'
      });
    }

    await this.#tptProgress(
      onProgress,
      'opening_tpt_human_verification',
      'Cloudflare is looping in the automated browser. Switching this same TPT session to a normal Chrome window for one manual verification…'
    );
    await this.#closeControlledContext();
    const baselineSession = readTptSessionState(this.profileDir);
    const initialLock = clearStaleProfileLocks(this.profileDir);
    if (initialLock.ownerPid) {
      throw Object.assign(new Error('The app-owned Chrome profile is still in use. Close its extra Chrome window, then retry the TPT upload.'), {
        code: 'BROWSER_PROFILE_IN_USE',
        ownerPid: initialLock.ownerPid
      });
    }

    const verificationProcess = spawn(candidate.executablePath, tptHumanVerificationArgs(this.profileDir), {
      stdio: 'ignore'
    });
    let settled = false;
    let resolveVerification;
    let rejectVerification;
    const promise = new Promise((resolve, reject) => {
      resolveVerification = (reason) => {
        if (settled) return;
        settled = true;
        resolve(reason);
      };
      rejectVerification = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
    });
    const verification = {
      candidate,
      process: verificationProcess,
      promise,
      resolve: resolveVerification,
      reject: rejectVerification
    };
    this.tptHumanVerification = verification;
    const sessionMonitor = (async () => {
      while (!settled && this.tptHumanVerification === verification) {
        await sleep(1_000);
        const currentSession = readTptSessionState(this.profileDir);
        const sessionChanged = Boolean(
          currentSession.activitySignature
          && currentSession.activitySignature !== baselineSession.activitySignature
        );
        if (sessionChanged && currentSession.authenticated && (!requireClearance || currentSession.clearance)) {
          resolveVerification('session_ready');
        }
      }
    })();
    verificationProcess.once('error', (error) => {
      rejectVerification(Object.assign(new Error(`The normal TPT verification browser could not open: ${error.message}`), {
        code: 'TPT_VERIFICATION_BROWSER_FAILED'
      }));
    });
    verificationProcess.once('exit', () => {
      setTimeout(() => {
        if (!profileLockOwnerPid(this.profileDir)) resolveVerification('browser_closed');
      }, 250);
    });

    await this.#tptProgress(
      onProgress,
      'waiting_for_tpt_human_verification',
      'Use the normal Chrome window to sign in or complete “Verify you are human” once. The app will detect the saved TPT session and resume automatically.'
    );

    let completionReason;
    try {
      completionReason = await promise;
      await this.#tptProgress(
        onProgress,
        'closing_tpt_human_verification',
        'Saving the verified TPT session and reconnecting the upload automation…'
      );
      if (completionReason !== 'browser_closed') {
        const ownerPid = profileLockOwnerPid(this.profileDir);
        const processIds = new Set([verificationProcess.pid, ownerPid].filter((pid) => Number.isInteger(pid) && pid > 0));
        for (const pid of processIds) {
          try {
            process.kill(pid, 'SIGTERM');
          } catch (error) {
            if (error?.code !== 'ESRCH') throw error;
          }
        }
      }

      const releaseDeadline = Date.now() + 15_000;
      while (profileLockOwnerPid(this.profileDir) && Date.now() < releaseDeadline) await sleep(250);
      const finalLock = clearStaleProfileLocks(this.profileDir);
      if (finalLock.ownerPid) {
        throw Object.assign(new Error('The temporary verification Chrome window is still open. Close it, then start the TPT upload again.'), {
          code: 'TPT_VERIFICATION_BROWSER_STILL_OPEN',
          ownerPid: finalLock.ownerPid
        });
      }
      return { browserLabel: candidate.label, completionReason };
    } finally {
      if (this.tptHumanVerification === verification) this.tptHumanVerification = null;
      await sessionMonitor.catch(() => {});
    }
  }

  completeTptHumanVerification() {
    const verification = this.tptHumanVerification;
    if (!verification) {
      throw Object.assign(new Error('No TPT human-verification window is waiting.'), {
        code: 'TPT_VERIFICATION_NOT_WAITING'
      });
    }
    verification.resolve('confirmed');
    return { accepted: true };
  }

  async waitForTptProductForm({ projectId = null, onProgress, timeoutMs = 600_000, maxHumanVerificationAttempts = 2 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let verificationAttempts = 0;
    while (Date.now() < deadline) {
      const page = this.#tptPageForProject(projectId) ?? this.tptUploadPage;
      if (!page || page.isClosed()) {
        throw Object.assign(new Error('The TPT upload page closed while waiting for the product form.'), {
          code: 'TPT_PAGE_CLOSED'
        });
      }
      const titleInput = page.locator(TPT_FORM_SELECTORS.title).first();
      if (await titleInput.isVisible().catch(() => false)) return { page, titleInput };
      const bodyText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
      const cloudflareChallenge = isTptCloudflareChallengeText(bodyText);
      const loginPage = isTptLoginPage(bodyText, page.url?.() ?? '');
      if (cloudflareChallenge || loginPage) {
        if (verificationAttempts >= maxHumanVerificationAttempts) {
          throw Object.assign(new Error('Cloudflare restarted its verification after the normal-browser handoff. Turn off VPN, proxy, or iCloud Private Relay, wait 15–30 minutes, then retry.'), {
            code: 'TPT_CLOUDFLARE_VERIFICATION_LOOP'
          });
        }
        verificationAttempts += 1;
        await this.runTptHumanVerificationHandoff({ onProgress, requireClearance: cloudflareChallenge });
        await this.openTptDraftUpload({ projectId });
        continue;
      }
      await sleep(1_000);
    }
    throw Object.assign(new Error('TPT product form did not appear after 10 minutes. Finish signing in, then start uploading again.'), { code: 'TPT_LOGIN_TIMEOUT' });
  }

  async inspectTptUploadForm(page = null, { waitForCompleteMs = 0, retryIntervalMs = 1_000 } = {}) {
    page ??= this.tptUploadPage;
    if (!page || page.isClosed()) throw Object.assign(new Error('The TPT upload page is not open.'), { code: 'TPT_PAGE_CLOSED' });
    const required = ['title', 'productFile', 'description', 'price', 'multipleLicensePrice', 'taxCode', 'grades', 'subjects', 'tags', 'copyright', 'productStatus'];
    const deadline = Date.now() + Math.max(0, Number(waitForCompleteMs) || 0);
    let contract;
    let missing;
    do {
      contract = await page.evaluate(({ selectors, limits }) => {
        const visibleText = String(document.body?.innerText || '').replace(/\s+/g, ' ');
        const present = (selector) => Boolean(document.querySelector(selector));
        return {
          inspectedAt: new Date().toISOString(),
          title: present(selectors.title),
          productFile: present(selectors.productFile),
          previewFile: present(selectors.previewFile),
          videoPreviewFile: present(selectors.videoPreviewFile),
          description: present(selectors.description),
          price: present(selectors.price),
          multipleLicensePrice: present(selectors.multipleLicensePrice),
          bundleDiscountPrice: present(selectors.bundleDiscountPrice),
          taxCode: present(selectors.taxCode),
          grades: present(selectors.grades),
          subjects: present(selectors.subjects),
          tags: present(selectors.tags),
          formats: present(selectors.formats),
          customCategories: present(selectors.customCategories),
          teachingDuration: present(selectors.teachingDuration),
          pageCount: present(selectors.pageCount),
          answerKey: present(selectors.answerKey),
          copyright: present(selectors.copyrightOriginal) && present(selectors.copyrightLicensed),
          productStatus: present(selectors.listingActive),
          standards: ['Select CCSS', 'Select NGSS', 'Select TEKS', 'Select VA SOL'].filter((label) => visibleText.includes(label)),
          limits
        };
      }, { selectors: TPT_FORM_SELECTORS, limits: TPT_FILE_LIMITS });
      missing = required.filter((field) => !contract[field]);
      if (!missing.length || Date.now() >= deadline) break;
      await sleep(Math.max(50, Number(retryIntervalMs) || 1_000));
    } while (!page.isClosed());
    if (missing.length) {
      throw Object.assign(new Error(`TPT changed its product form. Missing inspected controls: ${missing.join(', ')}.`), {
        code: 'TPT_FORM_CONTRACT_CHANGED',
        missing
      });
    }
    return contract;
  }

  #assertTptFile(filePath, limit, label) {
    if (!filePath || !existsSync(filePath)) {
      throw Object.assign(new Error(`${label} is missing from the local project.`), { code: 'TPT_LOCAL_FILE_MISSING' });
    }
    const size = statSync(filePath).size;
    if (size > limit) {
      throw Object.assign(new Error(`${label} exceeds TPT's current upload limit.`), {
        code: 'TPT_FILE_TOO_LARGE',
        filePath,
        size,
        limit
      });
    }
  }

  async #tptUploaded(page, selector) {
    const value = await page.locator(selector).first().evaluate((element) => element.value).catch(() => null);
    return value === '1' || value === 'true';
  }

  async #tptUploadActivity(page, inputSelector) {
    return page.evaluate(({ selector }) => {
      const input = document.querySelector(selector);
      if (!input) return null;
      const root = input.closest([
        '[data-testid*="upload"]',
        '[class*="upload"]',
        '[class*="Upload"]',
        '.form-group',
        'fieldset'
      ].join(',')) || input.parentElement?.parentElement?.parentElement || input.parentElement;
      const progressSelector = [
        'progress',
        '[role="progressbar"]',
        '[aria-valuenow]',
        '[class*="progress"]',
        '[class*="Progress"]'
      ].join(',');
      const visible = (element) => Boolean(element && (element.getClientRects?.().length || element.offsetParent));
      const progress = root?.querySelector(progressSelector) || null;
      const progressRoot = progress?.closest('[class*="upload"], [class*="Upload"], .form-group, fieldset') || progress?.parentElement;
      const rawText = [root?.innerText || root?.textContent, progressRoot?.innerText || progressRoot?.textContent]
        .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      const ariaValue = Number.parseFloat(progress?.getAttribute('aria-valuenow') || '');
      const nativeValue = progress?.tagName === 'PROGRESS' && Number(progress.max) > 0
        ? Number(progress.value) / Number(progress.max) * 100
        : Number.NaN;
      const textValue = Number.parseFloat(rawText.match(/(?:^|\s)(\d{1,3}(?:\.\d+)?)\s*%/)?.[1] || '');
      const percentValue = [ariaValue, nativeValue, textValue].find((value) => Number.isFinite(value));
      const percent = Number.isFinite(percentValue) ? Math.max(0, Math.min(100, Math.round(percentValue))) : null;
      const error = /upload failed|failed to upload|could not upload|file (?:is )?too large|unsupported file|network error/i.test(rawText);
      const progressVisible = visible(progress);
      const fileSelected = Number(input.files?.length || 0) > 0;
      const active = !error && (fileSelected || progressVisible || percent != null || /uploading|processing|preparing|scanning/i.test(rawText));
      return {
        active,
        error,
        fileSelected,
        fileName: input.files?.[0]?.name || '',
        fileSize: Number(input.files?.[0]?.size || 0),
        percent,
        text: rawText.slice(0, 240),
        signature: active ? `${percent ?? 'active'}:${fileSelected ? 'selected' : 'unselected'}:${rawText.slice(0, 160)}` : ''
      };
    }, { selector: inputSelector }).catch(() => null);
  }

  async #tptUploadIfMissing(page, {
    inputSelector,
    uploadedSelector,
    filePath,
    limit,
    label,
    onProgress = null,
    progressStage = 'file_upload'
  }) {
    if (!filePath) return false;
    this.#assertTptFile(filePath, limit, label);
    if (uploadedSelector && await this.#tptUploaded(page, uploadedSelector)) return false;
    const input = page.locator(inputSelector).first();
    if (!(await input.count().catch(() => 0))) {
      throw Object.assign(new Error(`TPT file control was not found: ${label}.`), { code: 'TPT_FILE_INPUT_NOT_FOUND' });
    }
    const fileSize = statSync(filePath).size;
    const selectedFile = await input.evaluate((element) => {
      const file = element.files?.[0];
      return file ? { name: file.name, size: file.size } : null;
    }).catch(() => null);
    if (!tptSelectedFileMatches(selectedFile, filePath, fileSize)) {
      await this.#tptProgress(onProgress, progressStage, `${label} is not attached yet — selecting the local file now…`);
      await this.#setDiskFilesOnPage(page, [filePath], { locator: input });
      await this.#tptProgress(onProgress, progressStage, `${label} selected — waiting for TPT to upload it…`);
    }
    if (!uploadedSelector) return true;

    const policy = tptFileUploadWaitPolicy(fileSize, limit);
    let lastReportedBucket = null;
    const result = await waitForTptUploadCompletion({
      isUploaded: () => this.#tptUploaded(page, uploadedSelector),
      readActivity: () => this.#tptUploadActivity(page, inputSelector),
      isPageClosed: () => page.isClosed(),
      policy,
      onActivity: async (activity) => {
        const bucket = activity.percent == null ? null : Math.floor(activity.percent / 5) * 5;
        if (bucket === lastReportedBucket) return;
        lastReportedBucket = bucket;
        await this.#tptProgress(
          onProgress,
          progressStage,
          bucket == null ? `${label} is still uploading to TPT…` : `${label} uploading to TPT — ${activity.percent}%…`
        );
      }
    });
    if (result.completed) return true;
    if (result.reason === 'explicit_error') {
      throw Object.assign(new Error(`${label} was rejected by TPT: ${result.activity?.text || 'the upload failed'}`), {
        code: 'TPT_FILE_UPLOAD_REJECTED'
      });
    }
    if (result.reason === 'page_closed') {
      throw Object.assign(new Error(`${label} upload stopped because the TPT page was closed.`), { code: 'TPT_PAGE_CLOSED' });
    }
    const timeoutMessage = result.reason === 'max_timeout'
      ? `${label} reached the ${Math.round(policy.maxTimeoutMs / 3_600_000)}-hour safety limit. The partial TPT form was kept for Resume uploading.`
      : `${label} showed no upload progress for ${Math.round(policy.idleTimeoutMs / 60_000)} minutes. The partial TPT form was kept for Resume uploading.`;
    throw Object.assign(new Error(timeoutMessage), {
      code: 'TPT_FILE_UPLOAD_STALLED',
      reason: result.reason
    });
  }

  async #tptFillSelector(page, selector, value, required = true) {
    const locator = page.locator(selector).first();
    if (!(await locator.count().catch(() => 0)) || !(await locator.isVisible().catch(() => false))) {
      if (!required) return false;
      throw Object.assign(new Error(`TPT field not found: ${selector}`), { code: 'TPT_FIELD_NOT_FOUND' });
    }
    const nextValue = String(value ?? '');
    const currentValue = await locator.evaluate((element) => element.isContentEditable
      ? String(element.textContent || '')
      : String(element.value || '')).catch(() => null);
    const normalize = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
    if (normalize(currentValue) !== normalize(nextValue)) await locator.fill(nextValue);
    return true;
  }

  async #tptSetCheckbox(page, selector, checked) {
    const locator = page.locator(selector).first();
    if (!(await locator.count().catch(() => 0))) throw Object.assign(new Error(`TPT checkbox not found: ${selector}`), { code: 'TPT_FIELD_NOT_FOUND' });
    const nextChecked = Boolean(checked);
    const customCheckbox = locator.locator('xpath=ancestor::label[1]').getByRole('checkbox').first();
    const customVisible = Boolean(await customCheckbox.count().catch(() => 0))
      && await customCheckbox.isVisible().catch(() => false);
    const customChecked = customVisible
      ? await customCheckbox.getAttribute('aria-checked').then((value) => value === 'true').catch(() => null)
      : null;
    const inputChecked = await locator.isChecked().catch(() => null);
    if (tptCheckboxStateMatches({ inputChecked, customVisible, customChecked }, nextChecked)) return;

    if (customVisible) {
      await customCheckbox.click();
    } else if (await locator.isVisible().catch(() => false)) {
      if (nextChecked) await locator.check();
      else await locator.uncheck();
    } else {
      await locator.evaluate((element, value) => {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked')?.set;
        if (nativeSetter) nativeSetter.call(element, value);
        else element.checked = value;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }, nextChecked);
    }
    await page.waitForTimeout(150);
    const finalInputChecked = await locator.isChecked().catch(() => null);
    const finalCustomChecked = customVisible
      ? await customCheckbox.getAttribute('aria-checked').then((value) => value === 'true').catch(() => null)
      : nextChecked;
    if (!tptCheckboxStateMatches({ inputChecked: finalInputChecked, customVisible, customChecked: finalCustomChecked }, nextChecked)) {
      throw Object.assign(new Error(`TPT checkbox did not change safely: ${selector}`), { code: 'TPT_CHECKBOX_STATE_UNCHANGED' });
    }
  }

  async #tptSelectedMultiLabels(input) {
    return input.evaluate((element) => {
      let root = element.closest('.Select, [class*="MultiSelect"]');
      if (!root) {
        let candidate = element.parentElement;
        for (let depth = 0; candidate && depth < 8; depth += 1, candidate = candidate.parentElement) {
          root = candidate;
          if (candidate.querySelector('[id$="-live-region"]')) break;
        }
      }
      const labels = [];
      for (const removeControl of root?.querySelectorAll('[aria-label^="Remove "]') || []) {
        const label = String(removeControl.getAttribute('aria-label') || '').replace(/^Remove\s+/i, '').trim();
        if (label) labels.push(label);
      }
      for (const chip of root?.querySelectorAll('[class*="-multiValue"], [class*="multi-value"], [class*="multiValue"], [class*="value__label"]') || []) {
        const removeControl = chip.querySelector?.('[aria-label^="Remove "]');
        const removeLabel = String(removeControl?.getAttribute('aria-label') || '').replace(/^Remove\s+/i, '').trim();
        const label = removeLabel || String(chip.firstElementChild?.textContent || chip.textContent || '').trim();
        if (label) labels.push(label);
      }
      const valueContainer = root?.querySelector('.Select__value-container, [class*="value-container"]');
      for (const child of valueContainer?.children || []) {
        if (child === element || child.contains(element)) continue;
        const className = String(child.className || '');
        if (/placeholder|input-container/i.test(className)) continue;
        const label = String(child.textContent || '').replace(/\s+/g, ' ').trim();
        if (label) labels.push(label);
      }
      const seen = new Set();
      return labels.filter((label) => {
        const key = String(label).toLowerCase().replace(/\s+/g, ' ').trim();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }).catch(() => []);
  }

  async #tptFindMultiOption(page, input, searchTerm, allowFlexibleMatch = false, preferredTerm = searchTerm) {
    const listboxId = await input.getAttribute('aria-controls').catch(() => null);
    const optionScope = listboxId ? page.locator(`#${listboxId}`) : page;
    const exact = optionScope.getByRole('option', { name: searchTerm, exact: true }).last();
    if (await exact.count().catch(() => 0)) {
      if (tptMetadataOptionIsSelectable({
        visible: await exact.isVisible().catch(() => false),
        enabled: await exact.isEnabled().catch(() => false),
        ariaDisabled: await exact.getAttribute('aria-disabled').catch(() => null)
      })) {
        return { locator: exact, label: String(await exact.innerText().catch(() => searchTerm)).trim() || searchTerm };
      }
    }
    if (!allowFlexibleMatch) return null;
    const visibleLabels = await optionScope.locator('[role="option"]').evaluateAll((elements) => elements
      .filter((element) => element.getAttribute('aria-disabled') !== 'true')
      .map((element) => String(element.textContent || '').trim())
      .filter(Boolean)).catch(() => []);
    const matchedLabel = chooseTptMetadataOption(visibleLabels, searchTerm, preferredTerm);
    if (!matchedLabel) return null;
    const matchedOption = optionScope.getByRole('option', { name: matchedLabel, exact: true }).last();
    return { locator: matchedOption, label: matchedLabel };
  }

  async #tptSelectMultiOptionWithKeyboard(page, input, option) {
    const optionId = await option.getAttribute('id').catch(() => null);
    if (!optionId) return false;
    await page.waitForTimeout(120);
    for (let step = 0; step < 150; step += 1) {
      if (await input.getAttribute('aria-activedescendant').catch(() => null) === optionId) {
        await input.press('Enter');
        return true;
      }
      await input.press('ArrowDown');
      await page.waitForTimeout(30);
    }
    return false;
  }

  async #tptClearMultiSearch(input) {
    return clearTptMultiSearchWhenNeeded({
      readValue: () => input.evaluate((element) => String(element.value || '')).catch(() => ''),
      clear: () => input.fill('')
    });
  }

  async #tptPickMulti(page, selector, values, label, {
    allowTagFallback = false,
    allowFlexibleMatch = false,
    skipUnavailable = false,
    requireAtLeastOne = false,
    onProgress = null
  } = {}) {
    const input = page.locator(selector).first();
    if (!(await input.isVisible().catch(() => false))) {
      throw Object.assign(new Error(`TPT ${label} picker was not found.`), { code: 'TPT_METADATA_PICKER_NOT_FOUND' });
    }
    const requested = Array.isArray(values) ? values.filter(Boolean) : [];
    let selectedLabels = await this.#tptSelectedMultiLabels(input);
    const unavailable = [];
    for (const rawValue of requested) {
      const value = String(rawValue).trim();
      const candidates = allowTagFallback ? tptTagSearchCandidates(value) : [value];
      const flexibleMatch = allowTagFallback || allowFlexibleMatch;
      selectedLabels = await this.#tptSelectedMultiLabels(input);
      const alreadySelected = selectedLabels.find((selected) => candidates.some((candidate) => (
        flexibleMatch
          ? tptMetadataChoiceMatches(selected, candidate)
          : normalizeTptMetadataChoice(selected) === normalizeTptMetadataChoice(candidate)
      )));
      if (alreadySelected) continue;
      let selectedOption = null;
      let selectedSearchTerm = null;
      for (const searchTerm of candidates) {
        await this.#tptClearMultiSearch(input);
        await input.type(searchTerm, { delay: 25 });
        await page.waitForTimeout(120);
        selectedOption = await this.#tptFindMultiOption(page, input, searchTerm, flexibleMatch, value);
        if (selectedOption) {
          selectedSearchTerm = searchTerm;
          break;
        }
      }
      if (!selectedOption) {
        unavailable.push(value);
        await this.#tptClearMultiSearch(input);
        if (skipUnavailable) {
          await this.#tptProgress(onProgress, 'metadata', `TPT ${label} "${value}" is not available and was skipped; continuing with the valid choices…`);
          continue;
        }
        throw Object.assign(new Error(`TPT does not expose "${value}" as a selectable ${label} option.`), {
          code: 'TPT_METADATA_OPTION_NOT_FOUND',
          field: label,
          value
        });
      }
      let confirmation = { confirmed: null, selected: selectedLabels };
      let lastClickError = null;
      for (let attempt = 1; attempt <= 3 && !confirmation.confirmed; attempt += 1) {
        await this.#tptClearMultiSearch(input);
        await input.type(selectedSearchTerm, { delay: 25 });
        await page.waitForTimeout(120);
        const currentOption = await this.#tptFindMultiOption(page, input, selectedSearchTerm, flexibleMatch, value);
        if (!currentOption) break;
        selectedOption = currentOption;
        try {
          if (attempt === 2) {
            const selectedWithKeyboard = await this.#tptSelectMultiOptionWithKeyboard(page, input, currentOption.locator);
            if (!selectedWithKeyboard) await currentOption.locator.click({ force: true, timeout: 5_000 });
          } else {
            await currentOption.locator.click({ force: attempt === 3, timeout: 5_000 });
          }
        } catch (error) {
          lastClickError = error;
        }
        confirmation = await waitForTptMetadataSelection({
          readSelectedLabels: () => this.#tptSelectedMultiLabels(input),
          expectedLabel: currentOption.label,
          attempts: 20,
          wait: () => page.waitForTimeout(100)
        });
        if (!confirmation.confirmed) {
          if (attempt === 1) {
            await this.#tptProgress(onProgress, 'metadata', `TPT showed "${selectedOption.label}" but did not commit it after the first click; retrying with keyboard selection…`);
          }
          if (attempt < 3) {
            await this.#tptClearMultiSearch(input).catch(() => {});
            await page.waitForTimeout(150);
          }
        }
      }
      if (!confirmation.confirmed) {
        throw Object.assign(new Error(`TPT showed the ${label} option "${selectedOption.label}", but did not confirm it as selected after three attempts. Resume uploading to retry this field.`), {
          code: 'TPT_METADATA_SELECTION_NOT_CONFIRMED',
          field: label,
          value,
          option: selectedOption.label,
          cause: lastClickError ?? undefined
        });
      }
      selectedLabels = confirmation.selected;
      if (flexibleMatch && normalizeTptMetadataChoice(selectedOption.label) !== normalizeTptMetadataChoice(value)) {
        await this.#tptProgress(
          onProgress,
          'metadata',
          `TPT ${label} "${value}" matched the available option "${selectedOption.label}" via "${selectedSearchTerm}".`
        );
      }
    }
    await this.#tptClearMultiSearch(input);
    selectedLabels = await this.#tptSelectedMultiLabels(input);
    if (requireAtLeastOne && !selectedLabels.length) {
      throw Object.assign(new Error(`TPT does not expose any selectable options for the requested ${label}s: ${unavailable.join(', ') || 'none provided'}.`), {
        code: 'TPT_METADATA_OPTION_NOT_FOUND',
        field: label,
        values: unavailable
      });
    }
    return { selected: selectedLabels, unavailable };
  }

  async #tptAssertRequiredMetadataSelected(page) {
    const requiredPickers = [
      { selector: TPT_FORM_SELECTORS.subjects, label: 'subject area' },
      { selector: TPT_FORM_SELECTORS.tags, label: 'tag' }
    ];
    const selected = {};
    for (const { selector, label } of requiredPickers) {
      const input = page.locator(selector).first();
      const labels = await this.#tptSelectedMultiLabels(input);
      if (!labels.length) {
        throw Object.assign(new Error(`TPT has no confirmed ${label} selection. Resume uploading to select a real dropdown option before submission.`), {
          code: 'TPT_REQUIRED_METADATA_MISSING',
          field: label
        });
      }
      selected[label] = labels;
    }
    return selected;
  }

  async #tptSetGrades(page, grades) {
    const requested = new Map((Array.isArray(grades) ? grades : [])
      .map((item) => [normalizeTptGrade(item), String(item).trim()])
      .filter(([key]) => key));
    const controls = await page.locator(TPT_FORM_SELECTORS.grades).all();
    if (!controls.length) throw Object.assign(new Error('TPT grade controls were not found.'), { code: 'TPT_METADATA_PICKER_NOT_FOUND' });
    const available = new Set();
    const labelledControls = [];
    for (const control of controls) {
      const label = String(await control.getAttribute('aria-label').catch(() => '') || '').trim();
      if (!label) continue;
      const normalizedLabel = normalizeTptGrade(label);
      available.add(normalizedLabel);
      labelledControls.push({ control, label: normalizedLabel });
    }
    const missing = [...requested.entries()].filter(([grade]) => !available.has(grade)).map(([, original]) => original);
    if (missing.length) {
      throw Object.assign(new Error(`TPT does not expose these grade choices: ${missing.join(', ')}.`), {
        code: 'TPT_METADATA_OPTION_NOT_FOUND',
        field: 'grade',
        values: missing
      });
    }
    for (const { control, label } of labelledControls) {
      const shouldBeChecked = requested.has(label);
      const checked = (await control.getAttribute('aria-checked').catch(() => null)) === 'true'
        || await control.isChecked().catch(() => false);
      if (checked !== shouldBeChecked) await control.click();
    }
  }

  async #tptPickSingle(page, selector, value, label, required = false, onProgress = null, progressStage = 'details') {
    if (!value) {
      if (required) throw Object.assign(new Error(`${label} is required before TPT upload.`), { code: 'TPT_REQUIRED_METADATA_MISSING' });
      return false;
    }
    const trigger = page.locator(selector).first();
    if (!(await trigger.isVisible().catch(() => false))) {
      if (!required) {
        await this.#tptProgress(onProgress, progressStage, `Optional TPT ${label} control is unavailable and was skipped…`);
        return false;
      }
      throw Object.assign(new Error(`TPT ${label} selector was not found.`), { code: 'TPT_FIELD_NOT_FOUND' });
    }
    if (String(await trigger.innerText().catch(() => '')).trim().toLowerCase() === String(value).trim().toLowerCase()) return true;
    await trigger.click();
    let option = page.getByRole('option', { name: String(value), exact: true }).last();
    if (!(await option.isVisible().catch(() => false))) {
      const visibleOptions = [];
      for (const locator of await page.getByRole('option').all()) {
        if (!(await locator.isVisible().catch(() => false)) || !(await locator.isEnabled().catch(() => true))) continue;
        const optionLabel = String(await locator.innerText().catch(() => '')).trim();
        if (optionLabel) visibleOptions.push({ locator, label: optionLabel });
      }
      const matchedLabel = chooseTptMetadataOption(visibleOptions.map(({ label: optionLabel }) => optionLabel), value);
      if (matchedLabel) option = visibleOptions.find(({ label: optionLabel }) => optionLabel === matchedLabel)?.locator ?? option;
    }
    if (!(await option.isVisible().catch(() => false))) option = page.getByText(String(value), { exact: true }).last();
    if (!(await option.isVisible().catch(() => false)) || !(await option.isEnabled().catch(() => true))) {
      if (!required) {
        await trigger.press('Escape').catch(() => {});
        await this.#tptProgress(onProgress, progressStage, `Optional TPT ${label} "${value}" is not available and was skipped…`);
        return false;
      }
      throw Object.assign(new Error(`TPT does not expose "${value}" as a selectable ${label} option.`), {
        code: 'TPT_METADATA_OPTION_NOT_FOUND',
        field: label,
        value
      });
    }
    await option.click();
    return true;
  }

  async runTptListingPreparation({ listing, projectId = null, onProgress }) {
    await this.openTptDraftUpload({ projectId });
    await this.#tptProgress(onProgress, 'waiting_for_tpt_login', 'Waiting for the signed-in TPT product form…');
    const { page, titleInput } = await this.waitForTptProductForm({ projectId, onProgress });
    const formContract = await this.inspectTptUploadForm(page, { waitForCompleteMs: 60_000 });
    const existingTitle = String(await titleInput.evaluate((element) => element.value || '').catch(() => '')).trim();
    const productAlreadyUploaded = await this.#tptUploaded(page, TPT_FORM_SELECTORS.productUploaded);
    const targetTitle = String(listing.seo?.title || listing.title || '').trim();
    if ((existingTitle && existingTitle !== targetTitle) || (productAlreadyUploaded && !existingTitle)) {
      throw Object.assign(new Error('The open TPT form contains a different partial product. It was left untouched; finish or cancel that form before starting this project.'), {
        code: 'TPT_FORM_PROJECT_MISMATCH',
        existingTitle: existingTitle || null
      });
    }
    await this.#tptProgress(onProgress, 'title', 'Entering product title…');
    await titleInput.fill(targetTitle);

    await this.#tptProgress(onProgress, 'product_file', 'Checking the downloadable PDF upload…');
    await this.#tptUploadIfMissing(page, {
      inputSelector: TPT_FORM_SELECTORS.productFile,
      uploadedSelector: TPT_FORM_SELECTORS.productUploaded,
      filePath: getPdf({ tptListing: listing }).productPath,
      limit: TPT_FILE_LIMITS.product,
      label: 'Downloadable product file',
      onProgress,
      progressStage: 'product_file'
    });
    if (listing.previewPdfPath) {
      await this.#tptProgress(onProgress, 'preview_file', 'Checking the optional product preview upload…');
      await this.#tptUploadIfMissing(page, {
        inputSelector: TPT_FORM_SELECTORS.previewFile,
        uploadedSelector: TPT_FORM_SELECTORS.previewUploaded,
        filePath: listing.previewPdfPath,
        limit: TPT_FILE_LIMITS.preview,
        label: 'Product preview',
        onProgress,
        progressStage: 'preview_file'
      });
    }
    if (listing.videoPreviewPath) {
      await this.#tptProgress(onProgress, 'video_preview_file', 'Checking the optional video preview upload…');
      await this.#tptUploadIfMissing(page, {
        inputSelector: TPT_FORM_SELECTORS.videoPreviewFile,
        uploadedSelector: TPT_FORM_SELECTORS.videoPreviewUploaded,
        filePath: listing.videoPreviewPath,
        limit: TPT_FILE_LIMITS.videoPreview,
        label: 'Video preview',
        onProgress,
        progressStage: 'video_preview_file'
      });
    }

    await this.#tptProgress(onProgress, 'description', 'Entering description…');
    await this.#tptFillSelector(page, TPT_FORM_SELECTORS.description, listing.seo?.description || listing.description);

    await this.#tptProgress(onProgress, 'pricing', 'Filling price, licenses, bundle discount, and tax code…');
    const mSettings = getMarketplace({ tptListing: listing }).settings;
    await this.#tptSetCheckbox(page, TPT_FORM_SELECTORS.freeResource, mSettings.isFreeResource === true);
    if (!mSettings.isFreeResource) await this.#tptFillSelector(page, TPT_FORM_SELECTORS.price, mSettings.suggestedPrice);
    await this.#tptFillSelector(page, TPT_FORM_SELECTORS.multipleLicensePrice, mSettings.multipleLicensePrice);
    await this.#tptFillSelector(page, TPT_FORM_SELECTORS.bundleDiscountPrice, mSettings.bundleDiscountPrice || '', false);
    await this.#tptPickSingle(page, TPT_FORM_SELECTORS.taxCode, mSettings.taxCode, 'tax code', true);

    await this.#tptProgress(onProgress, 'metadata', 'Selecting grades, subjects, tags, formats, and custom categories…');
    await this.#tptSetGrades(page, listing.grades);
    await this.#tptPickMulti(page, TPT_FORM_SELECTORS.subjects, listing.subjects, 'subject area', {
      ...TPT_METADATA_PICKER_OPTIONS.subjects,
      onProgress
    });
    const targetTags = Array.isArray(listing.seo?.tags) && listing.seo.tags.length > 0 ? listing.seo.tags : (listing.tags || []);
    await this.#tptPickMulti(page, TPT_FORM_SELECTORS.tags, targetTags, 'tag', {
      ...TPT_METADATA_PICKER_OPTIONS.tags,
      onProgress
    });
    if (listing.formats?.length) {
      await this.#tptPickMulti(page, TPT_FORM_SELECTORS.formats, listing.formats, 'format', {
        allowFlexibleMatch: true,
        skipUnavailable: true,
        onProgress
      });
    }
    if (listing.customCategories?.length) await this.#tptPickMulti(page, TPT_FORM_SELECTORS.customCategories, listing.customCategories, 'custom category');

    await this.#tptProgress(onProgress, 'details', 'Filling product duration, page count, answer key, and copyright…');
    await this.#tptPickSingle(page, TPT_FORM_SELECTORS.teachingDuration, listing.teachingDuration, 'teaching duration', false, onProgress);
    if (listing.pageCount) await this.#tptFillSelector(page, TPT_FORM_SELECTORS.pageCount, listing.pageCount, false);
    await this.#tptPickSingle(page, TPT_FORM_SELECTORS.answerKey, listing.answerKey, 'answer key', false, onProgress);
    if (mSettings.copyrightDeclaration === 'licensed') {
      await page.locator(TPT_FORM_SELECTORS.copyrightLicensed).first().check();
    } else if (mSettings.copyrightDeclaration === 'original') {
      await page.locator(TPT_FORM_SELECTORS.copyrightOriginal).first().check();
    } else {
      throw Object.assign(new Error('Choose the truthful TPT copyright declaration before uploading.'), { code: 'TPT_COPYRIGHT_REQUIRED' });
    }

    const thumbnailMode = ['auto', 'manual', 'later'].includes(listing.thumbnailMode) ? listing.thumbnailMode : 'manual';
    const thumbnailRadio = {
      auto: TPT_FORM_SELECTORS.automaticThumbnails,
      manual: TPT_FORM_SELECTORS.manualThumbnails,
      later: TPT_FORM_SELECTORS.laterThumbnails
    }[thumbnailMode];
    await page.locator(thumbnailRadio).first().check();
    if (thumbnailMode === 'manual') {
      await this.#tptProgress(onProgress, 'thumbnails', 'Checking the main cover and optional thumbnail uploads…');
      const paths = Array.isArray(listing.thumbnailPaths) ? listing.thumbnailPaths : [];
      if (!paths[0]) throw Object.assign(new Error('Manual thumbnail mode requires a Main Cover.'), { code: 'TPT_MAIN_COVER_REQUIRED' });
      for (let index = 0; index < Math.min(4, paths.length); index += 1) {
        if (!paths[index]) continue;
        await this.#tptUploadIfMissing(page, {
          inputSelector: `input[type="file"]#ItemDigitalThumb${index + 1}`,
          uploadedSelector: `#ItemsPropertyThumb${index + 1}Uploaded`,
          filePath: paths[index],
          limit: TPT_FILE_LIMITS.thumbnail,
          label: index === 0 ? 'Main Cover' : `Optional thumbnail ${index}`,
          onProgress,
          progressStage: `thumbnail_${index + 1}`
        });
        await this.#tptProgress(onProgress, `thumbnail_${index + 1}`, `${index === 0 ? 'Main Cover' : `Optional thumbnail ${index}`} ready.`);
      }
    }

    const confirmedMetadata = await this.#tptAssertRequiredMetadataSelected(page);
    await this.#tptProgress(onProgress, 'metadata', `Confirmed ${confirmedMetadata['subject area'].length} selected subject area(s) and ${confirmedMetadata.tag.length} selected tag(s) in TPT.`);
    await this.#tptSetCheckbox(page, TPT_FORM_SELECTORS.listingActive, mSettings.publicationStatus === 'active');
    const standardsRequested = Object.values(listing.standards || {}).some((values) => Array.isArray(values) && values.length);
    const statusLabel = mSettings.publicationStatus === 'active' ? 'Active' : 'Draft';
    await this.#tptProgress(onProgress, 'ready_for_listing_submit', standardsRequested
      ? `Core fields are ready for ${statusLabel}. Review and select the approved education standards in TPT before submission.`
      : `All supplied fields and assets are ready for final ${statusLabel} submission.`);
    return { url: page.url(), formContract, standardsRequireReview: standardsRequested };
  }

  async runTptDraftPreparation(options) {
    return this.runTptListingPreparation(options);
  }

  async submitTptListing({ listing, projectId = null, onProgress }) {
    let page = this.#tptPageForProject(projectId) ?? (!projectId ? this.tptUploadPage : null);
    let titleInput = page && !page.isClosed() ? page.locator(TPT_FORM_SELECTORS.title).first() : null;
    let formAssessment = page && !page.isClosed()
      ? assessTptPreparedForm({
          url: page.url(),
          titleVisible: await titleInput.isVisible().catch(() => false),
          currentTitle: await titleInput.evaluate((element) => element.value || '').catch(() => ''),
          productStatusPresent: Boolean(await page.locator(TPT_FORM_SELECTORS.listingActive).first().count().catch(() => 0))
        }, listing?.title)
      : { ready: false, reason: 'The prepared TPT page is no longer open.' };

    if (!formAssessment.ready) {
      await this.#tptProgress(onProgress, 'auto_restore', `Prepared TPT form unavailable (${formAssessment.reason}). Automatically restoring product form…`);
      await this.runTptListingPreparation({ listing, projectId, onProgress });
      page = this.#tptPageForProject(projectId) ?? (!projectId ? this.tptUploadPage : null);
      if (!page || page.isClosed()) {
        throw Object.assign(new Error('The prepared TPT page could not be restored.'), { code: 'TPT_PAGE_CLOSED' });
      }
      titleInput = page.locator(TPT_FORM_SELECTORS.title).first();
      formAssessment = assessTptPreparedForm({
        url: page.url(),
        titleVisible: await titleInput.isVisible().catch(() => false),
        currentTitle: await titleInput.evaluate((element) => element.value || '').catch(() => ''),
        productStatusPresent: Boolean(await page.locator(TPT_FORM_SELECTORS.listingActive).first().count().catch(() => 0))
      }, listing?.title);
      if (!formAssessment.ready) {
        throw Object.assign(new Error(`${formAssessment.reason} Resume uploading to restore this product without repeating review.`), {
          code: 'TPT_PREPARED_FORM_STALE'
        });
      }
    }
    await this.#tptAssertRequiredMetadataSelected(page);
    const publicationStatus = getMarketplace({ tptListing: listing }).settings.publicationStatus === 'active' ? 'active' : 'draft';
    await this.#tptProgress(onProgress, 'listing_submit', `Confirming TPT Product Status: ${publicationStatus === 'active' ? 'Active' : 'Draft'}…`);
    await this.#tptSetCheckbox(page, TPT_FORM_SELECTORS.listingActive, publicationStatus === 'active');
    await this.#tptProgress(onProgress, 'listing_submit', `Submitting the product as ${publicationStatus === 'active' ? 'an active listing' : 'an inactive draft'}…`);
    const submit = page.getByRole('button', { name: /^(submit|save.*draft|create.*product|publish)$/i }).last();
    if (!(await submit.isVisible().catch(() => false)) || !(await submit.isEnabled().catch(() => false))) {
      throw Object.assign(new Error('The final TPT Submit button is not ready. Review the visible required-field errors in TPT; nothing was submitted.'), { code: 'TPT_SUBMIT_NOT_READY' });
    }
    await submit.click();
    await this.#tptProgress(onProgress, 'listing_submit', 'Waiting for TPT to finish creating the listing…');
    const outcome = await waitForTptSubmissionOutcome({ page });
    if (outcome.pageClosed) {
      throw Object.assign(new Error('The TPT page closed before the final submission result appeared.'), { code: 'TPT_PAGE_CLOSED' });
    }
    if (outcome.validationErrors.length) {
      throw Object.assign(new Error(`TPT rejected the form: ${outcome.validationErrors.slice(0, 3).join(' | ')}`), {
        code: 'TPT_VALIDATION_ERROR',
        validationErrors: outcome.validationErrors.slice(0, 10)
      });
    }
    if (!outcome.transitioned) {
      throw Object.assign(new Error('TPT did not finish the final submission within three minutes. The form was left open and was not resubmitted; inspect it before retrying.'), {
        code: 'TPT_SUBMISSION_TIMEOUT',
        url: page.url()
      });
    }

    const title = String(listing?.title || '').trim();
    if (!page.url().startsWith(TPT_MY_PRODUCTS_URL)) {
      await page.goto(TPT_MY_PRODUCTS_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });
      await page.waitForTimeout(2_000);
    }
    const cards = await page.locator('.MyProductsProductCard').evaluateAll((elements) => elements.map((element) => ({
      title: element.querySelector('.MyProductsProductCard__title')?.textContent || '',
      inactive: element.classList.contains('MyProductsProductCard--inactive')
        || /\binactive\b/i.test(element.querySelector('.MyProductsProductCard__thirdColumn')?.textContent || ''),
      productHref: element.querySelector('[data-testid="my-products-item-title"]')?.getAttribute('href')
        || element.querySelector('[data-testid="my-products-item-cover-image"]')?.getAttribute('href')
        || '',
      editHref: element.querySelector('[data-testid="my-products-edit-item-link"]')?.getAttribute('href') || ''
    })));
    const verifiedListing = resolveTptListingCard(cards, title, publicationStatus, page.url());
    if (!verifiedListing) {
      throw Object.assign(new Error('TPT submission could not be verified in My Products. The result is ambiguous; check the open TPT page before retrying.'), {
        code: 'TPT_SUBMISSION_UNVERIFIED',
        url: page.url()
      });
    }
    const stage = publicationStatus === 'active' ? 'listing_published' : 'draft_submitted';
    await this.#tptProgress(onProgress, stage, `TPT verified the ${publicationStatus === 'active' ? 'active listing' : 'inactive draft'} in My Products.`);
    return { url: verifiedListing.url, publicationStatus, verified: true };
  }

  async submitTptDraft({ projectId = null, onProgress, listing = {} }) {
    return this.submitTptListing({ listing: { ...listing, publicationStatus: 'draft' }, projectId, onProgress });
  }

  async #jobPage(jobId, { fresh = false, url = null } = {}) {
    const version = this.cancelVersion;
    const target = url && isMetaLocalUrl(url) ? META_URL : url;
    // skipHome: this method navigates the job's own page below. Letting launch()
    // run #findOrCreateChatPage() first sent every job through the content gem.
    await this.launch({ headless: true, skipHome: true });
    if (version !== this.cancelVersion) throw Object.assign(new Error('Generation paused.'), {code:'QUEUE_PAUSED'});
    const existing = this.jobPages.get(jobId);
    // Only a gem root is corrected; a live conversation is left alone (see above).
    const stillOnRequestedGem = !target || !existing || existing.isClosed()
      || this.engine !== 'gemini'
      || /\/gem\/[^/]+\/[^/?#]+/.test(String(existing.url() || ''))
      || geminiGemId(existing.url()) === geminiGemId(target);
    if (existing && !existing.isClosed() && !fresh && stillOnRequestedGem) return existing;
    const reusedExisting = Boolean(existing && !existing.isClosed());
    const page = (existing && !existing.isClosed() ? existing : null) || await this.#ensureBackgroundPage();
    this.jobPages.set(jobId, page);
    this.page = this.page && !this.page.isClosed() ? this.page : page;
    await this.#afterNavigate(page);
    const beforeUrl = page.url();
    const targetUrl = target || (this.engine === 'gemini' ? resolvedContentGemUrl() : this.#engineHome());
    const willNavigate = jobPageNeedsNavigation(page.url(), targetUrl, fresh) || isRetiredGeminiGemUrl(page.url());
    if (willNavigate) {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    }
    if (this.engine === 'gemini') await this.#ensureLiveGeminiStudio(page, targetUrl);
    await this.#afterNavigate(page);
    return page;
  }

  async status() {
    if (this.#isMeta()) return this.#metaStatus();
    const loginActive = this.#loginProcessIsActive();
    const representativePage = this.page && !this.page.isClosed()
      ? this.page
      : [...this.jobPages.values()].find((page) => !page.isClosed());
    const connected = Boolean(this.context && representativePage);
    let url = null;
    let title = null;
    if (connected) {
      url = representativePage.url();
      title = await representativePage.title().catch(() => null);
    }
    return {
      connected: connected || loginActive,
      url: loginActive ? this.#engineHome() : url,
      title: loginActive ? 'ChatGPT Login' : title,
      browserLabel: this.browserLabel,
      launchWarnings: this.launchWarnings,
      headless: Boolean(this.headless),
      loginMode: loginActive,
      activePages: this.jobPages.size,
      preparedPages: this.preparedJobs.size
    };
  }

  beginWork() {
    this.abortRequested = false;
    this.humanPaused = false;
    this.humanDecision = null;
    this.humanObserveRequested = false;
    this.humanIntervention = null;
  }

  pauseForHuman(payload = {}) {
    this.humanPaused = true;
    this.humanObserveRequested = false;
    this.humanDecision = null;
    this.humanIntervention = payload && typeof payload === 'object' ? payload : { happened: String(payload || '') };
  }

  attachLiveBrowser({ context, page } = {}) {
    this.context = context || null;
    this.page = page || null;
    this.interactiveVisible = true;
    this.skipWindowChrome = true;
    this.headless = false;
  }

  endWork() {
    this.abortRequested = false;
    this.humanPaused = false;
    this.humanObserveRequested = false;
  }

  isAborting() {
    return Boolean(this.abortRequested);
  }

  cancelWaits() {
    this.abortRequested = true;
    this.cancelVersion += 1;
  }

  #throwIfCancelled() {
    if (this.abortRequested) {
      throw Object.assign(new Error('Waiting was paused.'), { code: 'QUEUE_PAUSED' });
    }
  }

  async #sleepOrPause(ms) {
    const until = Date.now() + Math.max(0, Number(ms) || 0);
    const version = this.cancelVersion;
    while (true) {
      if (this.abortRequested || version !== this.cancelVersion) {
        throw Object.assign(new Error('Waiting was paused.'), { code: 'QUEUE_PAUSED' });
      }
      if (this.humanPaused && !this.humanObserveRequested) {
        await sleep(120);
        continue;
      }
      if (Date.now() >= until) return;
      await sleep(Math.min(120, until - Date.now()));
    }
  }

  async openHome({ jobId = null } = {}) {
    const page = jobId ? await this.#jobPage(jobId, { fresh: true }) : await this.ensurePage();
    const home = this.engine === 'gemini' ? resolvedContentGemUrl() : this.#engineHome();
    await page.goto(home, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    if (this.engine === 'gemini') await this.#ensureLiveGeminiStudio(page, home);
    await this.#afterNavigate(page);
  }

  async navigate(url, { jobId = null } = {}) {
    const dest = isMetaLocalUrl(url) ? META_URL : url;
    if (!isAllowedChatUrl(dest) && dest !== META_URL) {
      throw Object.assign(new Error('Invalid conversation URL'), { code: 'INVALID_CHAT_URL' });
    }
    const page = jobId ? await this.#jobPage(jobId, { fresh: true, url: dest }) : await this.ensurePage();
    if (!jobId) await page.goto(dest, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    if (this.engine === 'gemini') await this.#ensureLiveGeminiStudio(page, dest);
    await this.#afterNavigate(page);
  }

  async reload({ jobId = null } = {}) {
    if (this.#isMeta()) return this.#metaStatus();
    const page = jobId ? await this.#jobPage(jobId) : await this.ensurePage();
    if (page && !page.isClosed()) {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
    }
  }

  async bringToFront() {
    if (this.#isMeta()) return this.#metaStatus();
    await this.launch({ interactive: true, forceBrowser: true, skipHome: true });
    const page = this.page && !this.page.isClosed() ? this.page : await this.ensurePage();
    await this.#showWindow(page);
    return this.status();
  }

  async #assistantCount(page = null) {
    page ??= await this.ensurePage();
    const kind = this.#pageKind(page);
    if (kind === 'chatgpt') return page.locator(ASSISTANT_MESSAGE_SELECTOR).count().catch(() => 0);
    if (kind === 'meta') return page.locator(META_ASSISTANT_SELECTOR).count().catch(() => 0);
    return page.locator(GEMINI_ASSISTANT_MESSAGE_SELECTOR).count().catch(() => 0);
  }

  async #newAssistantText(baselineCount, page = null) {
    page ??= await this.ensurePage();
    if (this.#isChatGptPage(page)) {
      const messages = page.locator(ASSISTANT_MESSAGE_SELECTOR);
      const count = await messages.count().catch(() => 0);
      if (count <= baselineCount) return '';
      return messages.last().innerText({ timeout: 5_000 }).catch(() => '');
    }
    if (this.#pageKind(page) === 'meta') {
      const messages = page.locator(META_ASSISTANT_SELECTOR);
      const count = await messages.count().catch(() => 0);
      if (count <= baselineCount) return '';
      return messages.last().innerText({ timeout: 5_000 }).catch(() => '');
    }
    const messages = page.locator(GEMINI_ASSISTANT_TEXT_SELECTOR);
    const count = await page.locator(GEMINI_ASSISTANT_MESSAGE_SELECTOR).count().catch(() => 0);
    if (count <= baselineCount) return '';
    return messages.last().evaluate((element) => String(element.textContent || element.innerText || '')).catch(() => '');
  }

  async #activeNoticeText(page = null) {
    page ??= await this.ensurePage();
    return page.evaluate(() => {
      const selectors = [
        '[role="alert"]',
        '[role="dialog"]',
        '[aria-live="assertive"]',
        '[data-testid*="toast"]',
        '[data-testid*="limit"]'
      ];
      const seen = new Set();
      const parts = [];
      for (const selector of selectors) {
        for (const element of document.querySelectorAll(selector)) {
          const style = getComputedStyle(element);
          const visible = style.display !== 'none'
            && style.visibility !== 'hidden'
            && element.getBoundingClientRect().width > 0
            && element.getBoundingClientRect().height > 0;
          const value = visible ? (element.innerText || element.textContent || '').trim() : '';
          if (value && !seen.has(value)) {
            seen.add(value);
            parts.push(value);
          }
        }
      }
      return parts.join('\n');
    }).catch(() => '');
  }

  /**
   * Whether the page is blocked by a sign-in wall, a rate limit or a notice.
   *
   * Every wait loop in this file calls this once a second. The work it does is
   * page-level and does not change tick to tick, so a result is reused for
   * `maxAgeMs`. Pass `maxAgeMs: 0` where a fresh read matters — before
   * submitting, or right after a navigation.
   */
  async detectBlocker(page = null, { maxAgeMs = 2_500 } = {}) {
    page ??= await this.ensurePage();
    const url = page.url();
    if (maxAgeMs > 0) {
      const cached = this.blockerCache.get(page);
      if (cached && cached.url === url && Date.now() - cached.at < maxAgeMs) return cached.value;
    }
    // What follows used to be preceded by a sign-in sweep: a full-DOM text scan
    // for auth copy, plus two overlapping "are we signed in" probes, one of which
    // waits 250ms for the composer. Its three results were computed on every tick
    // and then discarded — the AUTH_REQUIRED returns they fed were removed in an
    // earlier refactor and the detection was left behind. Running it once a second
    // for the length of an analysis is most of why this felt slow.
    //
    // It is not reinstated here on purpose. assertAuthenticated already checks the
    // session before work starts, and reviving a mid-generation check that reads
    // "composer not visible right now" as "session is dead" would abort valid runs
    // on a slow frame. A deliberate mid-run check belongs behind its own guard.
    const noticeText = await this.#activeNoticeText(page);
    const noticeBlocker = classifyNoticeText(noticeText);
    if (noticeBlocker?.code === 'REQUEST_THROTTLED') {
      const dialog = page.locator('[role="dialog"]').filter({ hasText: /too many requests/i }).last();
      const dismiss = dialog.getByRole('button', { name: /^(got it|ok|okay|close)$/i }).first();
      if (await dismiss.isVisible().catch(() => false)) await dismiss.click().catch(() => {});
    }
    this.blockerCache.set(page, { at: Date.now(), url, value: noticeBlocker });
    return noticeBlocker;
  }

  async #geminiLooksSignedIn(page) {
    if (!page || page.isClosed()) return false;
    const profile = await page.locator('user-profile-picture img:not([src*="default-user="]), user-profile-picture').first().isVisible().catch(() => false);
    if (profile) return true;
    const composer = await this.#findVisible(GEMINI_INPUT_SELECTORS, 250, page);
    return Boolean(composer);
  }

  async #clickVisibleGeminiSignIn(page) {
    if (!page || page.isClosed()) return false;
    return page.evaluate(() => {
      const visible = (element) => {
        if (!element) return false;
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return box.width > 2 && box.height > 2 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const labelOf = (element) => `${element.getAttribute('aria-label') || ''} ${(element.innerText || element.textContent || '')}`.replace(/\s+/g, ' ').trim();
      const nodes = [...document.querySelectorAll('a, button, [role="link"], [role="button"]')];
      const match = nodes.find((element) => {
        if (!visible(element)) return false;
        const label = labelOf(element);
        if (/^(sign in|log in)$/i.test(label)) return true;
        if (/continue with google/i.test(label)) return true;
        const href = String(element.getAttribute('href') || '');
        return /accounts\.google\.com/i.test(href) && /sign.?in|ServiceLogin/i.test(label + href);
      });
      if (!match) return false;
      match.click();
      return true;
    }).catch(() => false);
  }

  async #clickSavedGoogleAccount(page, email = '') {
    if (!page || page.isClosed()) return '';
    const clicked = await page.evaluate((wanted) => {
      const visible = (element) => {
        if (!element) return false;
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return box.width > 2 && box.height > 2 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const noise = /use another account|add account|create account|remove an account/i;
      const wantedLower = String(wanted || '').trim().toLowerCase();
      const accounts = [...document.querySelectorAll('[data-identifier], [data-email], [data-authuser]')];
      const byEmail = wantedLower
        ? accounts.find((element) => {
          const identifier = String(element.getAttribute('data-identifier') || element.getAttribute('data-email') || '').toLowerCase();
          return identifier === wantedLower && visible(element) && !noise.test(element.textContent || '');
        })
        : null;
      if (byEmail) {
        byEmail.click();
        return 'email';
      }
      if (wantedLower) {
        const textHit = [...document.querySelectorAll('div, span, li, [role="link"]')].find((element) => {
          const text = String(element.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
          return text === wantedLower && visible(element);
        });
        if (textHit) {
          (textHit.closest('[data-identifier], [role="link"], li, button') || textHit).click();
          return 'email-text';
        }
      }
      const first = accounts.find((element) => {
        const identifier = String(element.getAttribute('data-identifier') || '');
        return identifier && visible(element) && !noise.test(element.textContent || '');
      });
      if (first) {
        first.click();
        return 'first';
      }
      return '';
    }, String(email || '')).catch(() => '');
    if (clicked) return clicked;
    for (const selector of googleAccountLocatorHints(email)) {
      const locator = page.locator(selector).first();
      if (!(await locator.isVisible().catch(() => false))) continue;
      const label = await locator.innerText().catch(() => '');
      if (isGoogleAccountChooserNoise(label)) continue;
      await locator.click().catch(() => {});
      return 'locator';
    }
    return '';
  }

  async #hasVisibleLoginControl(page) {
    const url = page.url();
    if (/accounts\.google\.com/i.test(url) && /signin|ServiceLogin|identifier|challenge/i.test(url)) return true;
    if (isGeminiPageUrl(url) && await this.#geminiLooksSignedIn(page)) return false;
    if (isChatGptPageUrl(url)) {
      const selectors = [
        'a[href*="/auth/login"]',
        'button[data-testid="login-button"]',
        '[data-testid="login-button"]'
      ];
      for (const selector of selectors) {
        if (await page.locator(selector).first().isVisible().catch(() => false)) return true;
      }
    }
    if (isMetaPageUrl(url) || /facebook\.com/i.test(url)) {
      const selectors = [
        'a[href*="login"]',
        'button[aria-label*="Log in" i]',
        'button[aria-label*="Sign in" i]',
        '[aria-label*="Log in" i]',
        '[aria-label*="Sign in" i]'
      ];
      for (const selector of selectors) {
        if (await page.locator(selector).first().isVisible().catch(() => false)) return true;
      }
    }
    const roleButton = page.getByRole('button', { name: /^(log in|sign in|تسجيل الدخول|connexion)$/i }).first();
    if (await roleButton.isVisible().catch(() => false)) return true;
    const roleLink = page.getByRole('link', { name: /^(log in|sign in|تسجيل الدخول|connexion)$/i }).first();
    return roleLink.isVisible().catch(() => false);
  }

  async authenticationStatus(page = null, { forceTarget = null } = {}) {
    const rawTarget = String(engineTarget(forceTarget) || '').trim().toLowerCase();
    page ??= await this.ensurePage();
    const kind = normalizeEngine(forceTarget || this.engine);
    const chatgptPage = kind === 'chatgpt';
    const metaPage = kind === 'meta';
    const onSignIn = isServiceSignInUrl(page.url(), kind);
    const composerSelectors = this.#composerSelectors(page);
    const cookieJar = this.context;
    const [composer, loginControl, geminiProfileButton, chatgptProfileButton, metaProfileButton, googleCookies, chatgptCookies, metaCookies] = await Promise.all([
      this.#findVisible(composerSelectors, 400, page).then((found) => Boolean(found)),
      this.#hasVisibleLoginControl(page),
      page.locator('user-profile-picture img:not([src*="default-user="]), user-profile-picture').first().isVisible().catch(() => false),
      page.locator([
        'button[data-testid="profile-button"]',
        '[data-testid="profile-button"]',
        'button[aria-label*="profile" i]',
        'button[aria-label*="account" i]',
        'button[aria-label*="User menu" i]',
        'nav button img[alt]'
      ].join(',')).first().isVisible().catch(() => false),
      page.locator([
        'img[alt*="profile" i]',
        'img[alt*="account" i]',
        'button[aria-label*="profile" i]',
        'button[aria-label*="account" i]',
        '[aria-label*="Your profile" i]'
      ].join(',')).first().isVisible().catch(() => false),
      cookieJar ? cookieJar.cookies(['https://gemini.google.com/', 'https://accounts.google.com/', 'https://www.google.com/', 'https://google.com/']).catch(() => []) : Promise.resolve([]),
      cookieJar ? cookieJar.cookies(['https://chatgpt.com/', 'https://auth.openai.com/', 'https://chat.openai.com/']).catch(() => []) : Promise.resolve([]),
      cookieJar ? cookieJar.cookies(['https://www.meta.ai/', 'https://meta.ai/', 'https://www.facebook.com/', 'https://facebook.com/']).catch(() => [])
        : Promise.resolve([])
    ]);
    const hasProfileButton = chatgptPage ? chatgptProfileButton : (metaPage ? metaProfileButton : geminiProfileButton);
    const hasGoogleSessionCookie = googleCookies.some((cookie) => isGoogleSessionCookie(cookie));
    const hasChatGptSessionCookie = chatgptCookies.some((cookie) => isChatGptSessionCookie(cookie));
    const hasMetaSessionCookie = metaCookies.some((cookie) => /^(c_user|xs|datr|sb)$/i.test(String(cookie?.name || '')) || /meta\.ai/i.test(String(cookie?.domain || '')));
    const hasSessionCookie = chatgptPage ? hasChatGptSessionCookie : (metaPage ? hasMetaSessionCookie : hasGoogleSessionCookie);
    const accountNavigationCount = hasProfileButton ? 1 : 0;
    return {
      authenticated: Boolean(
        !onSignIn
        && !loginControl
        && (hasSessionCookie || hasProfileButton || composer)
      ),
      composer,
      loginControl,
      hasSessionCookie,
      hasGoogleSessionCookie,
      hasChatGptSessionCookie,
      hasMetaSessionCookie,
      accountNavigationCount,
      hasProfileButton,
      engine: kind
    };
  }

  async accountProfile(page = null) {
    page ??= await this.ensurePage();
    return page.evaluate(() => {
      const selectors = [
        'user-profile-picture',
        'button[data-testid="profile-button"]',
        '[data-testid="profile-button"]',
        'button[aria-label*="profile" i]',
        'button[aria-label*="account" i]',
        'nav button img[alt]'
      ];
      let element = null;
      for (const selector of selectors) {
        const candidate = document.querySelector(selector);
        if (candidate) {
          element = candidate.closest('button') || candidate;
          break;
        }
      }
      if (!element) return null;
      const image = element.querySelector('img[alt]');
      const values = [
        element.textContent,
        element.getAttribute('aria-label'),
        element.getAttribute('title'),
        image?.getAttribute('alt')
      ].map((value) => String(value ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean);
      const label = [...new Set(values)].join(' · ').slice(0, 300);
      const email = label.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || '';
      const ignored = /^(profile|account|user menu|open profile menu|settings)$/i;
      const name = values.find((value) => value !== email && !ignored.test(value) && !value.includes('@')) || '';
      return { name: name.slice(0, 120), email: email.slice(0, 254), label };
    }).catch(() => null);
  }

  async assertAuthenticated(page = null) {
    const status = await this.authenticationStatus(page, { forceTarget: this.engine });
    if (!status.authenticated) {
      throw Object.assign(new Error('The signed-in AI session is not valid in the background browser. Import the login session before starting the queue.'), {
        code: 'AUTH_REQUIRED',
        authenticationStatus: status
      });
    }
    return status;
  }

  async #findVisible(selectors, timeoutMs = 1_000, page = null) {
    page ??= await this.ensurePage();
    const list = Array.isArray(selectors) ? selectors : [selectors];
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      const hits = await Promise.all(list.map(async (selector) => {
        const locator = page.locator(selector).first();
        return (await locator.isVisible().catch(() => false)) ? locator : null;
      }));
      const found = hits.find(Boolean);
      if (found) return found;
      if (Date.now() + 80 > deadline) break;
      await sleep(80);
    }
    return null;
  }

  #idleStopSelectors(page) {
    if (this.#pageKind(page) === 'gemini') {
      return [
        'button[aria-label="Stop response"]',
        'button[aria-label="Stop generating"]'
      ];
    }
    return this.#stopSelectors(page);
  }

  async waitUntilIdle(timeoutMs = 600_000, page = null) {
    page ??= await this.ensurePage();
    const started = Date.now();
    const cancelVersion = this.cancelVersion;
    let lastBeat = 0;
    while (Date.now() - started < timeoutMs) {
      if (cancelVersion !== this.cancelVersion) {
        return { ok: false, error: { code: 'QUEUE_PAUSED', message: 'Waiting was paused.' } };
      }
      if (isMarketplacePageUrl(typeof page.url === 'function' ? page.url() : '')) {
        return { ok: false, error: { code: 'MARKET_TAB_HIJACK', message: 'The studio tab was replaced by a marketplace page.' } };
      }
      const blocker = await this.detectBlocker(page);
      if (blocker) return { ok: false, error: blocker };
      const stopButton = await this.#findVisible(this.#idleStopSelectors(page), 100, page);
      if (!stopButton) return { ok: true };
      if (Date.now() - lastBeat >= 4_000) {
        lastBeat = Date.now();
        this.emit('heartbeat', {
          elapsedMs: Date.now() - started,
          phase: 'waiting_for_idle',
          generating: true
        });
        // #region agent log
        fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H11',location:'src/browser-controller.cjs:waitUntilIdle',message:'gemini still looks busy before submit',data:{elapsedMs:Date.now()-started,timeoutMs,service:this.#serviceName(page)},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
      }
      await this.#sleepOrPause(1_000);
    }
    return { ok: false, error: { code: 'PREVIOUS_GENERATION_BUSY', message: `${this.#serviceName(page)} is still processing a previous request.` } };
  }

  async #composer(timeoutMs = 60_000, page = null) {
    page ??= await this.ensurePage();
    if (this.#pageKind(page) === 'marketplace' || isMarketplacePageUrl(page.url())) {
      throw Object.assign(new Error('The studio tab was replaced by a marketplace page.'), {
        code: 'MARKET_TAB_HIJACK',
        retryable: true
      });
    }
    const composer = await this.#findVisible(this.#composerSelectors(page), timeoutMs, page);
    if (!composer) {
      const blocker = await this.detectBlocker(page);
      throw Object.assign(new Error(blocker?.message ?? `The ${this.#serviceName(page)} composer could not be found.`), {
        code: blocker?.code ?? 'COMPOSER_NOT_FOUND',
        cooldownMs: blocker?.cooldownMs
      });
    }
    return composer;
  }

  async #fillComposer(locator, prompt, page = null) {
    page ??= await this.ensurePage();
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    try {
      await locator.click({ timeout: 10_000 });
    } catch (error) {
      const blocker = await this.detectBlocker(page);
      if (blocker) {
        throw Object.assign(new Error(blocker.message), { code: blocker.code, cooldownMs: blocker.cooldownMs });
      }
      if (/modal-conversation-history-rate-limit|intercepts pointer events/i.test(String(error?.message))) {
        const throttle = classifyNoticeText('Too many requests. You are making requests too quickly.');
        throw Object.assign(new Error(throttle.message), throttle);
      }
      throw Object.assign(new Error(`The ${this.#serviceName(page)} composer was temporarily blocked by an overlay.`), {
        code: 'COMPOSER_OVERLAY_BLOCKED',
        cause: error
      });
    }
    await locator.fill(prompt).catch(async () => {
      const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
      await locator.press(`${modifier}+A`).catch(() => {});
      await locator.press('Backspace').catch(() => {});
      await locator.evaluate((element, value) => {
        element.focus();
        if ('value' in element) {
          const proto = element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          if (setter) setter.call(element, value);
          else element.value = value;
        } else {
          element.innerHTML = '';
          for (const line of String(value).split('\n')) {
            const paragraph = document.createElement('p');
            paragraph.textContent = line || ' ';
            element.appendChild(paragraph);
          }
        }
        element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }, prompt).catch(() => {});
    });
    // Meta AI's React composer ignores locator.fill() until a real keystroke fires onChange.
    await locator.press('Space').catch(() => {});
    await locator.press('Backspace').catch(() => {});
    await sleep(500);
    if (!(await this.#composerContains(locator, prompt))) {
      await locator.evaluate((element, value) => {
        element.focus();
        if ('value' in element) {
          const proto = element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          if (setter) setter.call(element, value);
          else element.value = value;
        } else {
          element.innerHTML = '';
          for (const line of String(value).split('\n')) {
            const paragraph = document.createElement('p');
            paragraph.textContent = line || ' ';
            element.appendChild(paragraph);
          }
        }
        element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }, prompt).catch(() => {});
      await locator.press('Space').catch(() => {});
      await locator.press('Backspace').catch(() => {});
      await sleep(300);
    }
    if (!(await this.#composerContains(locator, prompt))) {
      throw Object.assign(new Error('The app could not verify that the full prompt was entered.'), { code: 'PROMPT_FILL_MISMATCH' });
    }
  }

  async #armMetaImageGeneration(page) {
    if (this.#pageKind(page) !== 'meta') return;
    const imagine = page.getByRole('button', { name: /^(imagine|create image|generate image)$/i }).first();
    if (await imagine.isVisible().catch(() => false)) {
      await imagine.click({ timeout: 3_000 }).catch(() => {});
      await sleep(250);
    }
  }

  async #geminiLooksLikeImageStudio(page) {
    if (!page || page.isClosed?.()) return false;
    if (await this.#geminiImageModeArmed(page)) return true;
    const noise = page.getByText(/creating your image|tpt book pages creation pro custom gem/i).first();
    return noise.isVisible().catch(() => false);
  }

  async #disarmGeminiImageGeneration(page) {
    if (this.#pageKind(page) !== 'gemini') return false;
    if (!(await this.#geminiImageModeArmed(page))) return false;
    const pressed = page.locator([
      'button[aria-pressed="true"][aria-label*="Create image" i]',
      'button[aria-pressed="true"][aria-label*="Create images" i]',
      '[aria-label*="Create images" i][aria-pressed="true"]'
    ].join(', ')).first();
    if (await pressed.isVisible().catch(() => false)) {
      await pressed.click({ timeout: 3_000 }).catch(() => {});
    }
    const newChat = page.getByRole('button', { name: /new chat|start a new chat/i }).first();
    if (await newChat.isVisible().catch(() => false)) await newChat.click().catch(() => {});
    return true;
  }

  async #geminiImageModeArmed(page) {
    if (!page || page.isClosed()) return false;
    const pressed = page.locator([
      'button[aria-pressed="true"][aria-label*="Create image" i]',
      'button[aria-pressed="true"][aria-label*="Create images" i]',
      '[aria-label*="Create images" i][aria-pressed="true"]',
      '[data-tool*="image" i][aria-pressed="true"]'
    ].join(', ')).first();
    if (await pressed.isVisible().catch(() => false)) return true;
    const chip = page.getByText(/create images?/i).first();
    const chipVisible = await chip.isVisible().catch(() => false);
    if (!chipVisible) return false;
    const label = `${await chip.getAttribute('aria-pressed').catch(() => '')} ${await chip.getAttribute('aria-label').catch(() => '')}`.toLowerCase();
    return label.includes('true') || /create images?/i.test(await chip.getAttribute('aria-label').catch(() => ''));
  }

  async #clickGeminiMenuItem(page, matcher) {
    const items = page.locator(GEMINI_ATTACH_MENU_SELECTORS.join(', '));
    const count = await items.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const item = items.nth(index);
      const text = `${await item.innerText().catch(() => '')} ${await item.getAttribute('aria-label').catch(() => '')}`.toLowerCase();
      if (!matcher(text)) continue;
      await item.click({ timeout: 5_000 }).catch(() => {});
      return true;
    }
    return false;
  }

  async #armGeminiImageGeneration(page, { prompt = '', promptKind = 'prompt' } = {}) {
    if (this.#pageKind(page) !== 'gemini') return false;
    if (!wantsGeminiImageMode(promptKind, prompt, 'gemini')) return false;
    if (await this.#geminiImageModeArmed(page)) {
      return true;
    }

    const clickCreateImages = async () => {
      const roleItem = page.getByRole('menuitem', { name: GEMINI_IMAGE_MODE_NAME }).first();
      if (await roleItem.isVisible().catch(() => false)) {
        await roleItem.click({ timeout: 5_000 }).catch(() => {});
        return true;
      }
      const roleButton = page.getByRole('button', { name: GEMINI_IMAGE_MODE_NAME }).first();
      if (await roleButton.isVisible().catch(() => false)) {
        await roleButton.click({ timeout: 5_000 }).catch(() => {});
        return true;
      }
      return this.#clickGeminiMenuItem(page, (text) => (
        GEMINI_IMAGE_MODE_NAME.test(text)
        && !/upload|file|photo|camera|video|music|search|canvas/i.test(text)
      ));
    };

    await page.keyboard.press('Escape').catch(() => {});
    await sleep(200);
    if (await clickCreateImages()) {
      await sleep(350);
      const armed = await this.#geminiImageModeArmed(page);
      return true;
    }
    if (await this.#openComposerAttachMenu(page)) {
      await sleep(300);
      if (await clickCreateImages()) {
        await sleep(350);
        const armed = await this.#geminiImageModeArmed(page);
        return true;
      }
      await page.keyboard.press('Escape').catch(() => {});
    }
    console.log('[browser] Gemini Create images tool was not found; continuing with the @image prompt.');
    return false;
  }

  async #composerContains(locator, prompt) {
    const rawText = await locator.evaluate((element) => ('value' in element ? element.value : (element.innerText || element.textContent)) ?? '').catch(() => '');
    const currentNormalized = String(rawText ?? '').replace(/\s+/g, ' ').trim();
    const promptNormalized = String(prompt ?? '').replace(/\s+/g, ' ').trim();
    const expectedStart = promptNormalized.slice(0, 40).trim();
    return currentNormalized.includes(expectedStart) || currentNormalized.length >= promptNormalized.length * 0.5;
  }

  async #submitButton(timeoutMs = 60_000, page = null) {
    page ??= await this.ensurePage();
    const startTime = Date.now();
    const deadline = startTime + timeoutMs;
    let wakeCount = 0;
    const submitSelectors = this.#submitSelectors(page);
    while (Date.now() < deadline) {
      const blocker = await this.detectBlocker(page);
      if (blocker) throw Object.assign(new Error(blocker.message), { code: blocker.code, cooldownMs: blocker.cooldownMs });
      for (const selector of submitSelectors) {
        const locator = page.locator(selector).first();
        const ready = await locator.isVisible().catch(() => false)
          && await locator.isEnabled().catch(() => false)
          && await locator.getAttribute('aria-disabled').catch(() => null) !== 'true';
        if (ready) return locator;
      }
      const roleButton = page.getByRole('button', { name: /send|إرسال|envoyer/i }).first();
      if (await roleButton.isVisible().catch(() => false) && await roleButton.isEnabled().catch(() => false)) return roleButton;

      if (wakeCount < 3 && Date.now() - startTime > (wakeCount + 1) * 3_000) {
        wakeCount += 1;
        const composer = await this.#findVisible(this.#composerSelectors(page), 1_000, page).catch(() => null);
        if (composer) {
          await composer.evaluate((element) => {
            element.focus();
            element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
          }).catch(() => {});
        }
      }

      await sleep(500);
    }

    for (const selector of submitSelectors) {
      const locator = page.locator(selector).first();
      if (await locator.isVisible().catch(() => false)) return locator;
    }
    const fallbackRole = page.getByRole('button', { name: /send|إرسال|envoyer/i }).first();
    if (await fallbackRole.isVisible().catch(() => false)) return fallbackRole;

    throw Object.assign(new Error(`${this.#serviceName(page)} submit button never became ready after filling the job payload.`), {
      code: 'SUBMIT_NOT_READY'
    });
  }

  async #submitFilledPrompt(page) {
    const isMeta = this.#pageKind(page) === 'meta';
    const submitTimeout = isMeta ? 8_000 : 60_000;
    const submit = await this.#submitButton(submitTimeout, page).catch(() => null);
    let clicked = false;
    if (submit) {
      const disabled = await submit.getAttribute('aria-disabled').catch(() => null) === 'true'
        || !(await submit.isEnabled().catch(() => true));
      if (!disabled) {
        try {
          await submit.click({ timeout: isMeta ? 5_000 : 15_000 });
          clicked = true;
        } catch {
          clicked = false;
        }
      }
    }
    if (!clicked) {
      const activeComposer = await this.#findVisible(this.#composerSelectors(page), 1_000, page).catch(() => null);
      if (activeComposer) {
        await activeComposer.press('Enter').catch(() => {});
        return;
      }
      throw Object.assign(new Error(`${this.#serviceName(page)} submit button never became ready after filling the job payload.`), {
        code: 'SUBMIT_NOT_READY'
      });
    }
  }

  async imageCandidates(page = null) {
    page ??= await this.ensurePage();
    const kind = this.#pageKind(page);
    if (kind === 'gemini') {
      return page.evaluate(collectGeminiImageCandidatesInBrowser).catch(() => []);
    }
    if (kind === 'meta') {
      return page.evaluate(collectMetaImageCandidatesInBrowser).catch(() => []);
    }
    return page.evaluate(collectChatGptImageCandidatesInBrowser).catch(() => []);
  }

  async videoCandidates(page = null) {
    page ??= await this.ensurePage();
    return page.evaluate(collectGeminiVideoCandidatesInBrowser).catch(() => []);
  }

  async #generationInProgress(page = null) {
    page ??= await this.ensurePage();
    const kind = this.#pageKind(page);
    if (kind === 'chatgpt') {
      const stopButton = await this.#findVisible(STOP_SELECTORS, 100, page);
      if (stopButton) return true;
      const progressText = await page.locator([
        '[data-testid="image-gen-card"]',
        '[data-message-author-role="assistant"]',
        '[data-turn="assistant"]'
      ].join(',')).last().innerText({ timeout: 2_000 }).catch(() => '');
      return GENERATION_PROGRESS_PATTERNS.some((pattern) => pattern.test(progressText));
    }
    if (kind === 'meta') {
      const stopButton = await this.#findVisible(META_STOP_SELECTORS, 100, page);
      if (stopButton) return true;
      const busy = await page.locator(META_BUSY_SELECTORS.join(', ')).first().isVisible().catch(() => false);
      if (busy) return true;
      const progressText = await page.locator('[role="article"], [data-scope="assistant"]').last().innerText({ timeout: 2_000 }).catch(() => '');
      return GENERATION_PROGRESS_PATTERNS.some((pattern) => pattern.test(progressText));
    }
    const stopButton = await this.#findVisible(GEMINI_STOP_SELECTORS, 100, page);
    if (stopButton) return true;
    const busy = await page.locator(GEMINI_BUSY_SELECTORS.join(', ')).first().isVisible().catch(() => false);
    if (busy) return true;
    const progressText = await page.locator(GEMINI_ASSISTANT_TEXT_SELECTOR).last().innerText({ timeout: 2_000 }).catch(() => '');
    return GENERATION_PROGRESS_PATTERNS.some((pattern) => pattern.test(progressText));
  }

  #geminiPageSnapshots() {
    const verified = this.verifiedAccounts?.gemini || {};
    const pages = this.context?.pages?.() || [];
    return pages.filter((item) => item && !item.isClosed()).map((item) => {
      const url = item.url();
      const inConversation = /\/gem\/[^/]+\/[^/?#]+/.test(url);
      return {
        page: item,
        url,
        isGemini: isGeminiPageUrl(url),
        signedIn: inConversation || /\/app\/[a-f0-9]{8,}/i.test(url),
        hasSignInControl: false,
        loginConfirmed: Boolean(verified.confirmed),
        email: verified.email || ''
      };
    });
  }

  async #pageForVerify(engine) {
    if (!this.context) await this.launch({ skipHome: true, forceBrowser: true });
    const matches = (url) => {
      if (engine === 'chatgpt') return isChatGptPageUrl(url);
      if (engine === 'meta') return isMetaPageUrl(url);
      return isGeminiPageUrl(url) || /accounts\.google\.com/i.test(String(url || ''));
    };
    const pages = this.context.pages().filter((item) => item && !item.isClosed());
    const preferred = engine === 'gemini' ? pickPreferredGeminiPage(this.#geminiPageSnapshots()) : null;
    const page = preferred?.page
      || pages.find((item) => matches(item.url()))
      || await this.#freshEnginePage();
    this.page = page;
    return page;
  }

  async #openVerifyPage(engine) {
    const dest = verifyServiceUrl(engine);
    const page = await this.#pageForVerify(engine);
    const url = page.url();
    if (isServiceSignInUrl(url, engine)) {
      if (this.interactiveVisible) await this.#showWindow(page);
      else await this.#afterNavigate(page);
      return page;
    }
    const onService = engine === 'chatgpt'
      ? isChatGptPageUrl(url)
      : engine === 'meta'
        ? isMetaPageUrl(url)
        : isGeminiPageUrl(url);
    if (engine === 'gemini') {
      const verified = this.verifiedAccounts?.gemini || {};
      const sample = {
        url,
        hasSignInControl: /gemini\.google\.com/i.test(url),
        loginConfirmed: Boolean(verified.confirmed),
        hasSavedCookies: Boolean(verified.confirmed),
        signedIn: Boolean(pickPreferredGeminiPage(this.#geminiPageSnapshots())?.signedIn)
      };
      const state = classifyGeminiTabSession(sample);
      if (shouldOneClickGeminiSignIn({ ...sample, state })) {
        await this.#restorePersistedLoginCookies().catch(() => {});
        if (this.interactiveVisible) await this.#showWindow(page);
        else await this.#afterNavigate(page);
        const clickedSignIn = await this.#clickVisibleGeminiSignIn(page);
        if (clickedSignIn) await sleep(900);
        await this.#clickSavedGoogleAccount(page, verified.email);
        return page;
      }
    }
    if (!onService) {
      await page.goto(dest, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    }
    if (this.interactiveVisible) await this.#showWindow(page);
    else await this.#afterNavigate(page);
    return page;
  }

  async verifyLogin(selectedProfile = null, { timeoutMs = 45_000, pollIntervalMs = 400, target = null } = {}) {
    if (this.verifyInFlight) return this.verifyInFlight;
    this.verifyInFlight = this.#verifyLoginOnce(selectedProfile, { timeoutMs, pollIntervalMs, target })
      .finally(() => { this.verifyInFlight = null; });
    return this.verifyInFlight;
  }

  async #verifyLoginOnce(selectedProfile, { timeoutMs, pollIntervalMs, target }) {
    const engine = normalizeEngine(target || this.engine);
    this.setEngine(engine);
    const chatgpt = engine === 'chatgpt';
    const meta = engine === 'meta';
    const serviceName = chatgpt ? 'ChatGPT' : (meta ? 'Meta AI' : 'Gemini');
    this.#loginProgress('checking_saved_login', `Checking the saved ${serviceName} login in the background…`);
    const saved = this.inspectSavedLogins();
    const alreadySaved = Boolean(saved[engine]);
    let imported = {};
    let importError = null;
    if (!this.context && !alreadySaved) {
      try {
        imported = await this.importSystemLoginSession(selectedProfile, { service: engine });
      } catch (caughtError) {
        importError = caughtError;
        this.#loginProgress('import_failed', caughtError.message);
      }
    }
    const keepVisible = this.interactiveVisible;
    await this.launch({ skipHome: true, forceBrowser: true, interactive: keepVisible });
    const page = await this.#openVerifyPage(engine);
    const requestedTimeout = Math.max(0, Number(timeoutMs) || 0);
    const effectiveTimeout = Math.max(requestedTimeout || 45_000, alreadySaved ? 20_000 : 90_000);
    const deadline = Date.now() + effectiveTimeout;
    this.#loginProgress(chatgpt ? 'checking_chatgpt' : (meta ? 'checking_meta' : 'checking_gemini'), `Confirming ${serviceName} without interrupting you…`);
    let authentication = await this.authenticationStatus(page, { forceTarget: engine });
    while (!authentication.authenticated && Date.now() < deadline) {
      await sleep(Math.max(50, Number(pollIntervalMs) || 400));
      authentication = await this.authenticationStatus(page, { forceTarget: engine });
    }
    const accountProfile = authentication.authenticated ? await this.accountProfile(page) : null;
    if (authentication.authenticated) {
      await this.#persistLoginState(engine);
      await this.closeLoginBrowser();
      this.interactiveVisible = false;
      await this.#parkWindow(page);
      this.#loginProgress('verified', `${serviceName} connected in the background.`);
      return {
        ...authentication,
        ...imported,
        accountProfile,
        engine,
        restored: alreadySaved,
        importWarning: importError ? { code: importError.code ?? 'SESSION_IMPORT_FAILED', message: importError.message } : null
      };
    }
    const error = importError ?? Object.assign(new Error(`${serviceName} is not signed in yet. Click Sign in once, finish login in the window, then verify.`), {
      code: chatgpt ? 'CHATGPT_SESSION_INVALID' : (meta ? 'META_SESSION_INVALID' : 'GEMINI_SESSION_INVALID')
    });
    error.authenticationStatus = authentication;
    this.#loginProgress('verification_failed', error.message);
    throw error;
  }

  async logout(target = null) {
    const engine = normalizeEngine(target || this.engine);
    await this.close();
    const cookiePath = managedCookiePath(this.profileDir);
    if (cookiePath && existsSync(cookiePath)) {
      let database = null;
      try {
        database = new DatabaseSync(cookiePath);
        if (engine === 'gemini') {
          database.exec(`
            DELETE FROM cookies
            WHERE (
              lower(host_key) = 'gemini.google.com'
              OR lower(host_key) LIKE '%.gemini.google.com'
              OR lower(host_key) = 'google.com'
              OR lower(host_key) LIKE '%.google.com'
            )
          `);
        } else if (engine === 'meta') {
          this.metaSessions.clear();
          this.metaImageCache.clear();
          database.exec(`
            DELETE FROM cookies
            WHERE (
              lower(host_key) = 'meta.ai'
              OR lower(host_key) LIKE '%.meta.ai'
              OR lower(host_key) = 'facebook.com'
              OR lower(host_key) LIKE '%.facebook.com'
              OR lower(host_key) = 'instagram.com'
              OR lower(host_key) LIKE '%.instagram.com'
            )
          `);
        } else {
          database.exec(`
            DELETE FROM cookies
            WHERE (
              lower(host_key) = 'chatgpt.com'
              OR lower(host_key) LIKE '%.chatgpt.com'
              OR lower(host_key) = 'openai.com'
              OR lower(host_key) LIKE '%.openai.com'
              OR lower(host_key) = 'chat.openai.com'
              OR lower(host_key) LIKE '%.chat.openai.com'
            )
          `);
        }
      } catch (e) {
        if (engine !== 'meta') {
          const targetProfileDir = join(this.profileDir, 'Default');
          for (const staleCookiePath of [join(targetProfileDir, 'Cookies'), join(targetProfileDir, 'Network', 'Cookies')]) {
            for (const suffix of ['', '-wal', '-shm', '-journal']) {
              rmSync(`${staleCookiePath}${suffix}`, { force: true });
            }
          }
        }
      } finally {
        try { database?.close(); } catch {}
      }
    }
    this.#clearSavedLoginState(engine);
    return { success: true, engine };
  }

  async getSystemProfiles() {
    const profiles = [];
    const candidates = installedBrowserCandidates();
    const seenDirs = new Set();
    for (const candidate of candidates) {
      if (!candidate.userDataDir || !existsSync(candidate.userDataDir)) continue;
      if (seenDirs.has(candidate.userDataDir)) continue;
      seenDirs.add(candidate.userDataDir);
      const localStatePath = join(candidate.userDataDir, 'Local State');
      if (!existsSync(localStatePath)) continue;
      try {
        const localState = readJson(localStatePath);
        const infoCache = localState?.profile?.info_cache || {};
        const lastUsed = String(localState?.profile?.last_used || 'Default');
        for (const [key, info] of Object.entries(infoCache)) {
          if (!/^(Default|Profile \d+)$/i.test(key)) continue;
          const profileDir = join(candidate.userDataDir, key);
          const hasCookies = [
            join(profileDir, 'Network', 'Cookies'),
            join(profileDir, 'Cookies')
          ].some((p) => existsSync(p));
          if (!hasCookies) continue;
          profiles.push({
            browser: candidate.label,
            profileKey: key,
            profileName: info.name || key,
            email: info.user_name || '',
            isLastUsed: key === lastUsed
          });
        }
      } catch (e) {
        // Safe fallback
      }
    }
    return profiles;
  }

  setProfileRotation(profiles = [], currentIndex = 0) {
    this.profileRotationList = Array.isArray(profiles) ? [...profiles] : [];
    this.currentProfileIndex = Math.max(0, Math.min(currentIndex, Math.max(0, this.profileRotationList.length - 1)));
    if (this.profileRotationList.length > 0 && !this.activeProfile) {
      this.activeProfile = this.profileRotationList[this.currentProfileIndex];
    }
    this.setAccountPool({ enabled: this.enableProfileSwapping });
  }

  setAccountPool(payload = {}) {
    this.accountPool = AccountPool.fromRotation(this.profileRotationList, {
      rootDir: this.baseProfileDir,
      currentIndex: this.currentProfileIndex,
      enabled: payload.enabled ?? this.enableProfileSwapping,
      previousAccounts: payload.accounts || this.accountPool?.accounts
    });
    return this.accountPool;
  }

  setVerifiedAccounts(accounts = {}) {
    this.verifiedAccounts = accounts && typeof accounts === 'object' ? { ...accounts } : {};
  }

  getProfileRotation() {
    return {
      profiles: this.profileRotationList,
      currentIndex: this.currentProfileIndex,
      activeProfile: this.profileRotationList[this.currentProfileIndex] || this.activeProfile,
      enabled: Boolean(this.enableProfileSwapping)
    };
  }

  canSwapProfile() {
    if (this.accountPool?.canFailover()) return true;
    return Boolean(this.enableProfileSwapping) && this.profileRotationList.length > 1;
  }

  async switchToNextProfile() {
    if (this.accountPool?.canFailover()) {
      this.accountPool.markRateLimited();
      const next = this.accountPool.nextAvailable();
      if (next) {
        this.accountPool.activate(next.index);
        this.currentProfileIndex = next.index;
        this.activeProfile = {
          ...this.profileRotationList[next.index],
          userDataDir: next.account.userDataDir,
          profileName: next.account.profileName,
          profileKey: next.account.profileKey
        };
        await this.close();
        await this.importSystemLoginSession({
          browser: next.account.browser || this.browserLabel || 'Google Chrome Canary',
          profileKey: next.account.profileKey || 'Default'
        });
        await this.launch({ headless: true });
        this.emit('profile-swapped', {
          previousIndex: (next.index + this.profileRotationList.length - 1) % Math.max(1, this.profileRotationList.length),
          currentIndex: this.currentProfileIndex,
          profile: this.activeProfile,
          account: next.account
        });
        return { swapped: true, profileName: next.account.profileName, account: next.account };
      }
    }
    if (!this.profileRotationList.length) {
      const detected = await this.getSystemProfiles();
      if (detected.length > 1) {
        this.profileRotationList = detected;
      }
    }
    if (!this.profileRotationList.length) {
      return { swapped: false, reason: 'NO_PROFILES_AVAILABLE' };
    }

    const previousIndex = this.currentProfileIndex;
    this.currentProfileIndex = (this.currentProfileIndex + 1) % this.profileRotationList.length;
    const nextProfile = this.profileRotationList[this.currentProfileIndex];
    const profileKey = typeof nextProfile === 'string' ? nextProfile : nextProfile.profileKey;
    const profileName = typeof nextProfile === 'string' ? nextProfile : (nextProfile.profileName || nextProfile.profileKey);
    const browserLabel = typeof nextProfile === 'object' ? nextProfile.browser : null;

    console.log(`[browser] Rotating profile due to rate limit: index ${previousIndex} → ${this.currentProfileIndex} (${profileName})`);

    await this.close();

    await this.importSystemLoginSession({
      browser: browserLabel || this.browserLabel || 'Google Chrome Canary',
      profileKey: profileKey || 'Default'
    });

    this.activeProfile = nextProfile;
    await this.launch({ headless: true });

    this.emit('profile-swapped', {
      previousIndex,
      currentIndex: this.currentProfileIndex,
      profile: nextProfile,
      profileName
    });

    return {
      swapped: true,
      previousIndex,
      currentIndex: this.currentProfileIndex,
      profile: nextProfile,
      profileName
    };
  }

  /** Every usable file input on the page, best composer candidate first. */
  async #composerFileInputs(page) {
    const inputs = await page.locator('input[type="file"]').all().catch(() => []);
    const ranked = [];
    for (const locator of inputs) {
      const info = await locator.evaluate((element) => ({
        multiple: Boolean(element.multiple),
        accept: element.accept || '',
        disabled: Boolean(element.disabled),
        inForm: Boolean(element.closest('form')),
        inMain: Boolean(element.closest('main'))
      })).catch(() => null);
      if (!info || info.disabled) continue;
      const acceptsImages = !info.accept || /image|\*/i.test(info.accept);
      ranked.push({
        locator,
        multiple: info.multiple,
        score: (info.inForm ? 8 : 0) + (info.inMain ? 4 : 0) + (info.multiple ? 2 : 0) + (acceptsImages ? 1 : 0)
      });
    }
    return ranked.sort((left, right) => right.score - left.score);
  }

  async #composerAttachmentCount(page) {
    const evaluated = await page.evaluate(countComposerAttachmentChipsInBrowser).catch(() => 0);
    if (evaluated > 0) return evaluated;
    return page.locator([
      'form button[aria-label*="Remove file" i]',
      'form button[aria-label*="Remove attachment" i]',
      'form button[aria-label*="Remove image" i]',
      'form button[aria-label*="Remove photo" i]',
      'form [data-testid*="file-thumbnail"]',
      'form [data-testid*="attachment"]',
      'form [data-testid*="composer-file"]',
      'form img[alt*="preview" i]',
      'form img[src^="blob:"]',
      'form img[src^="data:image"]',
      'input-area-v2 button[aria-label*="Remove" i]',
      'input-area-v2 img[src^="blob:"]',
      'input-area-v2 img[src^="data:image"]',
      'uploader-file-preview img',
      'file-preview img',
      'rich-textarea img[src^="blob:"]',
      '[aria-label*="Remove attached" i]',
      '[data-test-id*="attachment"] img',
      'img[src^="blob:"][alt*="upload" i]'
    ].join(', ')).count().catch(() => 0);
  }

  async #clearComposerAttachments(page) {
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const remove = page.locator([
        'form button[aria-label*="Remove file" i]',
        'form button[aria-label*="Remove attachment" i]',
        'form button[aria-label*="Remove image" i]',
        'form button[aria-label*="Remove photo" i]',
        'input-area-v2 button[aria-label*="Remove" i]',
        'uploader-file-preview button',
        'file-preview button[aria-label*="Remove" i]'
      ].join(', ')).first();
      if (!(await remove.isVisible().catch(() => false))) break;
      await remove.click({ timeout: 2_000 }).catch(() => {});
      await sleep(250);
    }
  }

  async #openComposerAttachMenu(page) {
    const gemini = this.#pageKind(page) === 'gemini';
    const selectors = gemini
      ? GEMINI_ATTACH_SELECTORS
      : [
        'form button[data-testid="composer-plus-btn"]',
        'form button[aria-label*="Attach" i]',
        'form button[aria-label*="Add files" i]',
        'form button[aria-label*="Add photos" i]',
        'form button[aria-label*="Add photos and files" i]',
        'form button[aria-haspopup="menu"]',
        'form button[aria-label="+"]',
        'button[data-testid="composer-plus-btn"]',
        'button[aria-label*="Attach" i]',
        'button[aria-label*="Add files" i]',
        'button[aria-label*="Add photos" i]',
        'button[aria-label="+"]'
      ];
    for (const selector of selectors) {
      const button = page.locator(selector).last();
      if (!(await button.isVisible().catch(() => false))) continue;
      await button.click({ timeout: 5_000 }).catch(() => {});
      await sleep(400);
      return true;
    }
    return false;
  }

  async #clickUploadMenuItem(page) {
    const items = page.locator(GEMINI_ATTACH_MENU_SELECTORS.join(', '));
    const count = await items.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const item = items.nth(index);
      const text = `${await item.innerText().catch(() => '')} ${await item.getAttribute('aria-label').catch(() => '')}`.toLowerCase();
      if (/camera|take photo|screenshot|google drive|onedrive|dropbox|connect|apps|gpt|canvas|search|sora|imagen|create image|video|music/i.test(text)) continue;
      if (/photo|file|upload|computer|device|image|صور|ملف|إرفاق|fichier|add/i.test(text) || count <= 4) {
        await item.click({ timeout: 5_000 }).catch(() => {});
        return true;
      }
    }
    if (count > 0) {
      await items.first().click({ timeout: 5_000 }).catch(() => {});
      return true;
    }
    return false;
  }

  async #waitForChipIncrease(page, previousCount, timeoutMs = 20_000) {
    const startedAt = Date.now();
    let chips = previousCount;
    while (Date.now() - startedAt < timeoutMs) {
      chips = await this.#composerAttachmentCount(page);
      if (chips > previousCount) {
        await this.#waitForComposerUploads(page, chips);
        return await this.#composerAttachmentCount(page);
      }
      await sleep(400);
    }
    return chips;
  }

  /** Drive the real upload control so the model opens its own file chooser. */
  async #attachViaFileChooser(page, paths) {
    const chooserPromise = page.waitForEvent('filechooser', { timeout: 15_000 }).catch(() => null);
    if (!(await this.#openComposerAttachMenu(page))) return false;
    await sleep(300);
    const menuVisible = await page.locator(GEMINI_ATTACH_MENU_SELECTORS.join(', ')).first().isVisible().catch(() => false);
    if (menuVisible) await this.#clickUploadMenuItem(page);
    const chooser = await chooserPromise;
    if (!chooser) {
      await page.keyboard.press('Escape').catch(() => {});
      return false;
    }
    await this.#setDiskFilesOnPage(page, paths, { handle: chooser.element() }).catch(() => {});
    return true;
  }

  async #attachViaFileChooserSequential(page, paths) {
    let chips = await this.#composerAttachmentCount(page);
    const remaining = paths.slice(chips);
    for (const filePath of remaining) {
      const before = chips;
      const chooserPromise = page.waitForEvent('filechooser', { timeout: 12_000 }).catch(() => null);
      if (!(await this.#openComposerAttachMenu(page))) continue;
      await sleep(300);
      const menuVisible = await page.locator(GEMINI_ATTACH_MENU_SELECTORS.join(', ')).first().isVisible().catch(() => false);
      if (menuVisible) await this.#clickUploadMenuItem(page);
      const chooser = await chooserPromise;
      if (!chooser) {
        await page.keyboard.press('Escape').catch(() => {});
        continue;
      }
      await this.#setDiskFilesOnPage(page, [filePath], { handle: chooser.element() }).catch(() => {});
      chips = await this.#waitForChipIncrease(page, before, 20_000);
    }
    return chips > 0;
  }

  /** Strategy 2: set files straight onto the hidden inputs React is listening to. */
  async #attachViaFileInput(page, paths) {
    let candidates = await this.#composerFileInputs(page);
    if (!candidates.length) {
      await this.#openComposerAttachMenu(page);
      await sleep(400);
      candidates = await this.#composerFileInputs(page);
    }
    for (const candidate of candidates) {
      const before = await this.#composerAttachmentCount(page);
      const attached = candidate.multiple
        ? await this.#setDiskFilesOnPage(page, paths, { locator: candidate.locator }).then(() => true).catch(() => false)
        : await this.#setDiskFilesOnPage(page, [paths[0]], { locator: candidate.locator }).then(() => true).catch(() => false);
      if (!attached) continue;
      await sleep(1_200);
      if (await this.#composerAttachmentCount(page) > before) {
        if (candidate.multiple) return true;
        for (const extraPath of paths.slice(1)) {
          const [next] = await this.#composerFileInputs(page);
          if (!next) break;
          await this.#setDiskFilesOnPage(page, [extraPath], { locator: next.locator }).catch(() => {});
          await sleep(600);
        }
        return true;
      }
    }
    return false;
  }

  async #writeClipboardImage(page, filePath) {
    if (writeImageToOsClipboard(filePath)) return true;
    const mime = imageMimeType(filePath);
    if (!/^image\//.test(mime)) return false;
    const data = readFileSync(filePath).toString('base64');
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    return page.evaluate(async ({ data, mime }) => {
      try {
        const binary = atob(data);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        await navigator.clipboard.write([new ClipboardItem({ [mime]: new Blob([bytes], { type: mime }) })]);
        return true;
      } catch {
        return false;
      }
    }, { data, mime }).catch(() => false);
  }

  /**
   * Native clipboard paste puts images into ChatGPT as vision targets, not file-library
   * documents. That is the reliable path for the mockup image editor.
   */
  async #attachViaClipboardPaste(page, paths) {
    const composer = await this.#findVisible(this.#composerSelectors(page), 10_000, page).catch(() => null);
    if (!composer) return false;
    const pasteKey = process.platform === 'darwin' ? 'Meta+v' : 'Control+v';
    let chips = await this.#composerAttachmentCount(page);
    let attachedAny = false;
    for (const filePath of paths) {
      const before = chips;
      const wrote = await this.#writeClipboardImage(page, filePath);
      if (!wrote) continue;
      await composer.click({ timeout: 5_000 }).catch(() => {});
      await page.keyboard.press(pasteKey).catch(() => {});
      chips = await this.#waitForChipIncrease(page, before, 12_000);
      if (chips > before) attachedAny = true;
    }
    return attachedAny;
  }

  /**
   * Strategy 3: hand real File objects to the composer through a synthetic drop or
   * paste. This bypasses hidden inputs entirely, so it survives composer redesigns.
   */
  async #attachViaDataTransfer(page, paths, mode) {
    const files = paths.map((filePath) => ({
      name: basename(filePath),
      type: imageMimeType(filePath),
      data: readFileSync(filePath).toString('base64')
    }));
    const composer = await this.#findVisible(this.#composerSelectors(page), 10_000, page).catch(() => null);
    if (!composer) return false;
    const geminiDrop = this.#pageKind(page) === 'gemini' && mode !== 'paste'
      ? page.locator('input-area-v2, file-drop-indicator, .input-area').first()
      : null;
    const dropHost = geminiDrop && (await geminiDrop.count().catch(() => 0))
      ? geminiDrop
      : composer;
    return dropHost.evaluate((element, payload) => {
      const transfer = new DataTransfer();
      for (const record of payload.files) {
        const binary = atob(record.data);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        transfer.items.add(new File([bytes], record.name, { type: record.type }));
      }
      const target = payload.mode === 'drop-document'
        ? (document.querySelector('input-area-v2, .input-area') || document.body)
        : element;
      if (payload.mode === 'paste') {
        target.dispatchEvent(new ClipboardEvent('paste', {
          clipboardData: transfer,
          bubbles: true,
          cancelable: true
        }));
        return true;
      }
      for (const type of ['dragenter', 'dragover', 'drop']) {
        target.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }));
      }
      return true;
    }, { files, mode }).catch(() => false);
  }

  async #waitForComposerUploads(page, expectedCount) {
    const uploadProgress = page.locator([
      'form [role="progressbar"]',
      'form .animate-spin',
      'form [class*="progress"]',
      'form [class*="loading"]',
      'form svg circle[stroke-dasharray]',
      '[data-testid*="upload-progress"]',
      '[aria-label*="Uploading"]',
      '[aria-label*="uploading"]',
      'uploader-progress',
      'file-upload-progress'
    ].join(','));
    const uploadCompleted = await waitForReferenceImageUpload({
      isUploading: () => uploadProgress.first().isVisible().catch(() => false)
    });
    if (!uploadCompleted) {
      throw Object.assign(new Error('The composer did not finish uploading the attached files within 90 seconds.'), {
        code: 'REFERENCE_IMAGE_UPLOAD_TIMEOUT'
      });
    }
    // Chips can lag behind the upload completing, so settle on a stable count.
    //
    // This used to poll once a second and, on a partial attach, grind the full
    // twenty seconds every time — then do it again after the clear-and-retry, so
    // an upload that was never going to complete cost the better part of a
    // minute. It now polls four times a second and stops as soon as the count
    // has held still for a second, which is what "settled" actually means. The
    // ceiling is unchanged, so nothing that used to succeed now gives up early.
    let chipCount = 0;
    let lastCount = -1;
    let stableFor = 0;
    const startedAt = Date.now();
    while (Date.now() - startedAt < 20_000) {
      chipCount = await this.#composerAttachmentCount(page);
      if (chipCount >= expectedCount) break;
      if (chipCount === lastCount) {
        stableFor += 1;
        // Four polls at 250ms: the count has not moved for a second.
        if (stableFor >= 4 && Date.now() - startedAt >= 1_500) break;
      } else {
        lastCount = chipCount;
        stableFor = 0;
      }
      await sleep(250);
    }
    return chipCount;
  }

  /**
   * Ground truth for whether the upload worked: composer chips can be faked by a
   * loose selector, but the sent user turn only shows images ChatGPT really received.
   */
  async #sentAttachmentCount(page) {
    return page.evaluate(countSentAttachmentsInBrowser).catch(() => -1);
  }

  async #saveComposerDiagnostic(page, label) {
    if (!this.downloadDir) return null;
    const path = join(this.downloadDir, `attachment-diagnostic-${label}-${Date.now()}.png`);
    const saved = await page.screenshot({ path, fullPage: false }).then(() => path).catch(() => null);
    if (saved) console.warn(`[browser] saved composer diagnostic screenshot: ${saved}`);
    return saved;
  }

  async attachImages(page, filePaths, { requireChips = false, requireAll = false } = {}) {
    const paths = [...new Set((Array.isArray(filePaths) ? filePaths : [filePaths]).filter(Boolean))];
    if (!paths.length) return 0;
    const missing = paths.filter((filePath) => !existsSync(filePath));
    if (missing.length) {
      throw Object.assign(new Error(`A required local reference image is missing: ${missing[0]}`), {
        code: 'REFERENCE_IMAGE_MISSING',
        missingPaths: missing
      });
    }
    const mustHaveAll = Boolean(requireAll || requireChips);
    console.log(`[browser] attaching ${paths.length} file(s): ${paths.map((filePath) => basename(filePath)).join(', ')}`);
    await page.keyboard.press('Escape').catch(() => {});

    const currentCount = () => this.#composerAttachmentCount(page);
    let chipCount = await currentCount();
    const runStrategy = async (label, fn, { append = false } = {}) => {
      if (chipCount >= paths.length) return true;
      if (!append && chipCount > 0) return false;
      console.log(`[browser] attachment strategy "${label}" (${chipCount}/${paths.length} already visible)`);
      const ok = await fn().catch((error) => {
        console.warn(`[browser] attachment strategy "${label}" failed: ${error?.message ?? error}`);
        return false;
      });
      if (!ok && !(append && chipCount > 0)) {
        console.warn(`[browser] attachment strategy "${label}" could not deliver the files; trying the next one`);
      }
      await sleep(200);
      chipCount = await this.#waitForComposerUploads(page, paths.length);
      console.log(`[browser] attachment strategy "${label}": ${chipCount} of ${paths.length} attachment(s) visible in the composer`);
      return chipCount >= paths.length;
    };

    const geminiLike = this.#pageKind(page) === 'gemini';
    if (geminiLike) {
      await runStrategy('file chooser', () => this.#attachViaFileChooser(page, paths));
      await runStrategy('file chooser one-by-one', () => this.#attachViaFileChooserSequential(page, paths), { append: true });
      await runStrategy('hidden file input', () => this.#attachViaFileInput(page, paths), { append: true });
    } else {
      await runStrategy('file chooser', () => this.#attachViaFileChooser(page, paths));
      await runStrategy('file chooser one-by-one', () => this.#attachViaFileChooserSequential(page, paths), { append: true });
      await runStrategy('hidden file input', () => this.#attachViaFileInput(page, paths));
    }
    await runStrategy('native clipboard paste', () => this.#attachViaClipboardPaste(page, paths.slice(chipCount)), { append: true });
    await runStrategy('synthetic drop', () => this.#attachViaDataTransfer(page, paths, 'drop'));
    await runStrategy('synthetic paste', () => this.#attachViaDataTransfer(page, paths, 'paste'));
    await runStrategy('synthetic drop on document', () => this.#attachViaDataTransfer(page, paths, 'drop-document'));

    if (mustHaveAll && chipCount > 0 && chipCount < paths.length) {
      console.warn(`[browser] only ${chipCount} of ${paths.length} attachments landed; clearing and forcing clipboard paste of every page image`);
      await this.#clearComposerAttachments(page);
      chipCount = 0;
      await this.#attachViaClipboardPaste(page, paths);
      chipCount = await this.#waitForComposerUploads(page, paths.length);
      if (chipCount < paths.length) {
        await this.#attachViaFileChooserSequential(page, paths);
        chipCount = await this.#waitForComposerUploads(page, paths.length);
      }
    }

    if (chipCount >= paths.length) return chipCount;
    if (mustHaveAll) {
      await this.#saveComposerDiagnostic(page, chipCount > 0 ? 'composer-partial' : 'composer-empty');
        throw Object.assign(
          new Error(`The model accepted ${chipCount} of ${paths.length} page images, so the mockup prompt was not sent. Open the managed browser and confirm the composer still offers image uploads.`),
        { code: 'REFERENCE_IMAGE_NOT_ATTACHED', attachedCount: chipCount, expectedCount: paths.length }
      );
    }
    if (chipCount > 0) {
      console.warn(`[browser] only ${chipCount} of ${paths.length} attachment(s) landed; sending with what the composer accepted`);
      return chipCount;
    }
    console.warn('[browser] no attachment chips appeared after every upload strategy; sending the prompt without attachments');
    return 0;
  }

  async #captureImageBaseline(page) {
    await sleep(250);
    const baseline = (await this.imageCandidates(page)).map((image) => image.signature);
    baseline.push(`assistant-count::${await this.#assistantCount(page)}`);
    return baseline;
  }

  async preparePrompt(prompt, { jobId = null, gptUrl = null } = {}) {
    if (!jobId) throw Object.assign(new Error('A page ID is required to preload a prompt.'), { code: 'PRELOAD_JOB_REQUIRED' });
    const page = await this.#jobPage(jobId, { fresh: true, url: gptUrl || getJobStartUrl({ kind: 'page' }, this.engine) });
    const idle = await this.waitUntilIdle(120_000, page);
    if (!idle.ok) throw Object.assign(new Error(idle.error.message), { code: idle.error.code, cooldownMs: idle.error.cooldownMs });
    const composer = await this.#composer(60_000, page);
    await this.#fillComposer(composer, prompt, page);
    this.preparedJobs.set(jobId, { prompt, preparedAt: Date.now() });
    this.emit('status', await this.status());
    return { jobId, prepared: true, conversationUrl: page.url() };
  }

  async submitPrompt(prompt, {
    jobId = null,
    attachmentPath = null,
    attachmentPaths = [],
    conversationUrl = null,
    isolatedPage = false,
    gptUrl = null,
    requireAttachmentChips = false,
    attachBeforePrompt = false,
    promptKind = 'prompt',
    reuseCurrentPage = false
  } = {}) {
    const submissionVersion = this.cancelVersion;
    const checkSubmission = () => { if (this.abortRequested || submissionVersion !== this.cancelVersion) throw Object.assign(new Error('Generation paused.'), {code:'QUEUE_PAUSED'}); };
    checkSubmission();
    if (conversationUrl && isMetaLocalUrl(conversationUrl)) conversationUrl = null;
    if (conversationUrl && isRetiredGeminiGemUrl(conversationUrl)) conversationUrl = null;
    if (conversationUrl && !conversationMatchesEngine(conversationUrl, this.engine)) conversationUrl = null;
    if (conversationUrl && !isAllowedChatUrl(conversationUrl)) {
      throw Object.assign(new Error('The saved conversation URL is invalid.'), { code: 'INVALID_CHAT_URL' });
    }
    const prepared = jobId ? this.preparedJobs.get(jobId) : null;
    const canReusePreparedPage = Boolean(!isolatedPage && !conversationUrl && prepared && prepared.prompt === prompt);
    const promptKindValue = String(promptKind || 'prompt').toLowerCase();
    const startHint = promptKindValue === 'preview-video' || promptKindValue === 'preview'
      ? { kind: 'preview' }
      : promptKindValue === 'thumbnail' || promptKindValue === 'mockup'
        ? { kind: 'thumbnail' }
        : promptKindValue === 'generate-prompts' || promptKindValue === 'analysis-first' || promptKindValue === 'analysis'
          ? { kind: promptKindValue === 'analysis-first' ? 'analysis' : 'prompts' }
          : promptKindValue === 'listing'
            ? { kind: 'listing' }
            : { kind: promptKindValue === 'prompt' ? 'page' : promptKindValue, purpose: 'image' };
    const startUrl = conversationUrl || gptUrl || getJobStartUrl(startHint, this.engine);
    let page;
    if (conversationUrl && reuseCurrentPage) {
      page = jobId
        ? await this.#jobPage(jobId, { fresh: false, url: conversationUrl })
        : await this.ensurePage();
    } else if (conversationUrl) {
      page = await this.#jobPage(jobId, { fresh: false, url: conversationUrl });
    } else if (jobId) {
      page = await this.#jobPage(jobId, {
        fresh: !canReusePreparedPage,
        isolated: isolatedPage,
        url: startUrl
      });
    } else {
      page = await this.ensurePage();
      if (!reuseCurrentPage && startUrl && jobPageNeedsNavigation(page.url(), startUrl, false)) {
        await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: STAGE_LAG_MS });
        await sleep(1_000);
      }
    }
    checkSubmission();
    await this.#afterNavigate(page);
    await this.#closeManagedMarketplaceTabs();
    if (!page || page.isClosed?.() || isMarketplacePageUrl(page.url())) {
      // #region agent log
      fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H20',location:'src/browser-controller.cjs:submitPrompt',message:'submit found a marketplace tab; opening a fresh Gemini tab',data:{promptKind:promptKindValue,url:String(page.url()||'').slice(0,120)},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      page = await this.#openFreshGeminiStudioTab(gptUrl || startUrl, page);
    }
    if (this.engine === 'gemini') await this.#ensureLiveGeminiStudio(page, gptUrl || startUrl);
    const analysisTurn = promptKindValue === 'analysis-first' || promptKindValue === 'analysis';
    const idleBudget = analysisTurn ? STAGE_LAG_MS : 600_000;
    // #region agent log
    fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H38',location:'src/browser-controller.cjs:submitPrompt',message:'submit-phase watchdog armed',data:{promptKind:promptKindValue,analysisTurn,host:(()=>{try{return new URL(page.url()).host;}catch{return '';}})(),idleBudget},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    let idle = await this.waitUntilIdle(idleBudget, page);
    if (!idle.ok && analysisTurn && idle.error?.code === 'MARKET_TAB_HIJACK') {
      // #region agent log
      fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H11',location:'src/browser-controller.cjs:submitPrompt',message:'stalled gemini tab before submit; opening a fresh tab',data:{promptKind:promptKindValue,idleBudget},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      page = await this.#openFreshGeminiStudioTab(gptUrl || startUrl, page);
      idle = await this.waitUntilIdle(8_000, page);
    } else if (!idle.ok && analysisTurn && idle.error?.code === 'PREVIOUS_GENERATION_BUSY') {
      await this.#disarmGeminiImageGeneration(page);
      idle = await this.waitUntilIdle(8_000, page);
    }
    if (!idle.ok) throw Object.assign(new Error(idle.error.message), { code: idle.error.code, cooldownMs: idle.error.cooldownMs });
    const filesToAttach = [...new Set([
      ...(Array.isArray(attachmentPaths) ? attachmentPaths : [attachmentPaths]),
      attachmentPath
    ].filter(Boolean))];
    const uploadFirst = Boolean(attachBeforePrompt)
      || promptKind === 'preview-video'
      || (this.#pageKind(page) === 'gemini' && filesToAttach.length > 0);
    if (uploadFirst && filesToAttach.length) {
      requireAttachmentChips = true;
    }
    const composer = await this.#composer(analysisTurn ? STAGE_LAG_MS : 60_000, page);
    let chipCount = 0;
    const fillPrompt = async (targetComposer) => {
      if (!canReusePreparedPage || !(await this.#composerContains(targetComposer, prompt))) {
        await this.#fillComposer(targetComposer, prompt, page);
      }
    };
    const attachWithBudget = async () => {
      if (!analysisTurn) {
        return this.attachImages(page, filesToAttach, {
          requireChips: requireAttachmentChips,
          requireAll: requireAttachmentChips
        });
      }
      const raced = await Promise.race([
        this.attachImages(page, filesToAttach, { requireChips: false, requireAll: false })
          .then((count) => ({ count })),
        sleep(18_000).then(() => ({ timedOut: true, count: 0 }))
      ]);
      if (raced.timedOut) {
        // #region agent log
        fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H38',location:'src/browser-controller.cjs:submitPrompt',message:'analysis mockup attach stalled; sending without images',data:{wanted:filesToAttach.length},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
      }
      requireAttachmentChips = false;
      return raced.count || 0;
    };
    if (uploadFirst && filesToAttach.length) {
      chipCount = await attachWithBudget();
      const composerAfterAttach = await this.#composer(15_000, page);
      await fillPrompt(composerAfterAttach);
    } else {
      await fillPrompt(composer);
      if (filesToAttach.length) {
        chipCount = await attachWithBudget();
        const composerAfterAttach = await this.#composer(15_000, page);
        if (!(await this.#composerContains(composerAfterAttach, prompt))) {
          await this.#fillComposer(composerAfterAttach, prompt, page);
        }
      }
    }
    await this.#armGeminiImageGeneration(page, { prompt, promptKind });
    await this.#armMetaImageGeneration(page);
    const baseline = await this.#captureImageBaseline(page);
    checkSubmission();
    await this.#submitFilledPrompt(page);
    if (jobId) this.preparedJobs.delete(jobId);
    const submittedAt = new Date().toISOString();
    const urlDeadline = Date.now() + 15_000;
    while (Date.now() < urlDeadline) {
      const currentUrl = page.url();
      if (isPersistedConversationUrl(currentUrl)) break;
      await sleep(250);
    }
    if (requireAttachmentChips && filesToAttach.length && this.#isChatGptPage(page)) {
      let sentCount = 0;
      const deadline = Date.now() + 45_000;
      while (Date.now() < deadline) {
        sentCount = await this.#sentAttachmentCount(page);
        if (sentCount >= filesToAttach.length) break;
        await sleep(1_000);
      }
      console.log(`[browser] sent user message contains ${sentCount} of ${filesToAttach.length} image attachment(s)`);
      this.#writePromptReceipt({
        kind: promptKind,
        promptPreview: String(prompt || '').slice(0, 1600),
        promptHasMockupInstruction: /attached listing mockup|attached competitor listing mockup/i.test(String(prompt || '')),
        attachmentPaths: filesToAttach,
        attachmentCount: filesToAttach.length,
        chipCount,
        sentCount,
        conversationUrl: page.url()
      });
      if (sentCount < filesToAttach.length) {
        await this.#saveComposerDiagnostic(page, 'sent-without-images');
        throw Object.assign(
          new Error(`The prompt was sent but ${this.#serviceName(page)} recorded ${sentCount} of ${filesToAttach.length} image attachments on that message, so the page images never fully reached the model.`),
          { code: 'REFERENCE_IMAGE_NOT_SENT', sentCount, expectedCount: filesToAttach.length }
        );
      }
    } else {
      this.#writePromptReceipt({
        kind: promptKind,
        promptPreview: String(prompt || '').slice(0, 1600),
        promptHasMockupInstruction: /attached listing mockup|attached competitor listing mockup/i.test(String(prompt || '')),
        attachmentPaths: filesToAttach,
        attachmentCount: filesToAttach.length,
        chipCount,
        sentCount: filesToAttach.length ? null : 0,
        conversationUrl: page.url()
      });
    }
    checkSubmission();
    return {
      baseline,
      submittedAt,
      conversationUrl: page.url(),
      page
    };
  }

  async waitForNewImage(baseline = [], timeoutMs = 600_000, {
    jobId = null,
    idleTimeoutMs = null,
    // Book Automation used longer settle windows for mockups so Gemini's still-drawing
    // tiles are not saved as the finished listing thumbnail.
    pendingReadyMs = 1_000,
    settleMs = 250,
    pollMs = 250
  } = {}) {
    const page = jobId ? await this.#jobPage(jobId) : await this.ensurePage();
    const known = new Set(Array.isArray(baseline) ? baseline : []);
    const assistantCountMarker = Array.isArray(baseline)
      ? baseline.find((item) => String(item).startsWith('assistant-count::'))
      : null;
    const assistantBaselineCount = Number.parseInt(String(assistantCountMarker ?? '').split('::')[1], 10) || 0;
    const cancelVersion = this.cancelVersion;
    const startedAt = Date.now();
    let lastHeartbeat = 0;
    let lastStateCheckAt = 0;
    let lastGenerationCheckAt = 0;
    let lastActivityAt = startedAt;
    let lastAssistantText = '';
    let pendingSignature = null;
    let pendingSince = 0;
    let generationInProgress = false;
    let lastEmittedGenerating = null;
    const serviceName = () => this.#serviceName(page);
    const emitImageWaitHeartbeat = (extra = {}) => {
      lastHeartbeat = Date.now();
      lastEmittedGenerating = extra.generating;
      this.emit('heartbeat', {
        elapsedMs: Date.now() - startedAt,
        jobId,
        generating: extra.generating,
        phase: extra.phase || (extra.generating ? 'generating' : 'waiting')
      });
    };
    const pulseImageWait = (nextGenerating, extra = {}) => {
      const changed = lastEmittedGenerating !== nextGenerating;
      generationInProgress = nextGenerating;
      if (changed || Date.now() - lastHeartbeat >= IMAGE_WAIT_HEARTBEAT_MS) {
        emitImageWaitHeartbeat({
          generating: nextGenerating,
          phase: extra.phase || (nextGenerating ? 'generating' : 'waiting')
        });
      }
    };
    while (Date.now() - startedAt < timeoutMs) {
      if (!page || (typeof page.isClosed === 'function' && page.isClosed())) {
        // Reset before surfacing, or the retry connects to the crashed instance that is
        // still holding the profile lock and fails the same way.
        await this.#recoverManagedBrowser('image wait: browser closed');
        throw Object.assign(new Error(`The managed browser closed while ${serviceName()} was generating. It has been reset, and the same task can be retried safely.`), {
          code: 'BROWSER_CONTEXT_CLOSED',
          retryable: true
        });
      }
      if (cancelVersion !== this.cancelVersion) {
        throw Object.assign(new Error('Waiting was paused.'), { code: 'QUEUE_PAUSED' });
      }
      const images = await this.imageCandidates(page);
      const candidate = pickBestNewAssistantImage(images, known, assistantBaselineCount);
      if (candidate) {
        generationInProgress = await this.#generationInProgress(page);
        lastGenerationCheckAt = Date.now();
        if (generationInProgress) {
          pulseImageWait(true);
          if (pendingSignature !== candidate.signature) {
            pendingSignature = candidate.signature;
            pendingSince = Date.now();
          }
          lastActivityAt = Date.now();
          if (!(candidate.width >= 32 && Date.now() - pendingSince >= pendingReadyMs)) {
            await this.#sleepOrPause(Math.min(500, pollMs));
            continue;
          }
        }
        await this.#sleepOrPause(settleMs);
        const stableImages = await this.imageCandidates(page);
        let stable = stableImages.find((image) => image.signature === candidate.signature)
          || pickBestNewAssistantImage(stableImages, known, assistantBaselineCount);
        if (this.#pageKind(page) === 'meta' && isNewAssistantImage(stable, known, assistantBaselineCount)) {
          let previousSrc = stable.src;
          for (let poll = 0; poll < 2; poll += 1) {
            const stillBusy = await this.#generationInProgress(page);
            lastGenerationCheckAt = Date.now();
            if (!stillBusy) break;
            pulseImageWait(true);
            await this.#sleepOrPause(500);
            const latest = await this.imageCandidates(page);
            const next = latest.find((image) => image.signature === stable.signature)
              || pickBestNewAssistantImage(latest, known, assistantBaselineCount);
            if (!isNewAssistantImage(next, known, assistantBaselineCount)) break;
            if (next.src !== previousSrc) {
              previousSrc = next.src;
              stable = next;
              continue;
            }
            emitImageWaitHeartbeat({ generating: false, phase: 'image_ready' });
            return { ...next, conversationUrl: page.url() };
          }
        }
        if (isNewAssistantImage(stable, known, assistantBaselineCount)) {
          emitImageWaitHeartbeat({ generating: false, phase: 'image_ready' });
          return { ...stable, conversationUrl: page.url() };
        }
      }
      const now = Date.now();
      if (now - lastGenerationCheckAt >= IMAGE_GENERATION_OBSERVE_MS) {
        lastGenerationCheckAt = now;
        pulseImageWait(await this.#generationInProgress(page));
      }
      if (now - lastStateCheckAt >= PASSIVE_STATE_CHECK_INTERVAL_MS) {
        lastStateCheckAt = now;
        generationInProgress = await this.#generationInProgress(page);
        lastGenerationCheckAt = now;
        pulseImageWait(generationInProgress);
        const blocker = await this.detectBlocker(page);
        if (['REQUEST_THROTTLED', 'RATE_LIMIT', 'AUTH_REQUIRED'].includes(blocker?.code)
          && !shouldWaitForImageBeforeThrottle(blocker, generationInProgress)) {
          throw Object.assign(new Error(blocker.message), { code: blocker.code, cooldownMs: blocker.cooldownMs });
        }
        const newAssistantText = await this.#newAssistantText(assistantBaselineCount, page);
        if (generationInProgress || newAssistantText !== lastAssistantText) lastActivityAt = now;
        lastAssistantText = newAssistantText;
        const assistantBlocker = classifyNoticeText(newAssistantText);
        if (assistantBlocker && !shouldWaitForImageBeforeThrottle(assistantBlocker, generationInProgress)) {
          throw Object.assign(new Error(assistantBlocker.message), assistantBlocker);
        }
        if (GENERATION_ERROR_PATTERNS.some((pattern) => pattern.test(newAssistantText))) {
          emitImageWaitHeartbeat({ generating: false, phase: 'failed' });
          throw Object.assign(new Error(newAssistantText.trim() || `${serviceName()} reported that image generation failed.`), { code: 'GENERATION_ERROR' });
        }
        if (!generationInProgress && REFERENCE_REQUEST_PATTERNS.some((pattern) => pattern.test(newAssistantText))) {
          emitImageWaitHeartbeat({ generating: false, phase: 'failed' });
          throw Object.assign(
            new Error(`${serviceName()} requested a reference image instead of generating the page. The prompt has been updated to require direct image generation.`),
            { code: 'REFERENCE_REQUESTED_BY_GPT' }
          );
        }
        if (!generationInProgress && newAssistantText.trim().length > 30) {
          await this.#sleepOrPause(2_000);
          const finalCheckImages = await this.imageCandidates(page);
          const finalCandidate = pickBestNewAssistantImage(finalCheckImages, known, assistantBaselineCount);
          const stillDrawing = finalCheckImages.some((image) => !image.fromUserTurn && !image.inComposer && image.width > 0 && image.width < 32);
          if (!finalCandidate && (stillDrawing || now - lastActivityAt < IMAGE_TEXT_GRACE_MS)) {
            lastActivityAt = stillDrawing ? now : lastActivityAt;
          } else if (!finalCandidate) {
            emitImageWaitHeartbeat({ generating: false, phase: 'failed' });
            throw Object.assign(new Error(newAssistantText.trim() || `${serviceName()} responded with text only and did not generate an image.`), { code: 'GENERATION_ERROR' });
          }
        }
      }
      if (idleTimeoutMs && !generationInProgress && now - lastActivityAt >= idleTimeoutMs) {
        emitImageWaitHeartbeat({ generating: false, phase: 'failed' });
        throw Object.assign(new Error('The saved conversation has no active image generation to recover.'), {
          code: 'RECOVERY_IDLE'
        });
      }
      pulseImageWait(generationInProgress);
      await this.#sleepOrPause(pollMs);
    }
    emitImageWaitHeartbeat({ generating: false, phase: 'failed' });
    throw Object.assign(new Error('No new image appeared before the generation timeout.'), { code: 'IMAGE_TIMEOUT' });
  }

  /**
   * Wait for a newly generated video.
   *
   * `timeoutMs` is a ceiling, not a schedule. Video generation is far slower and far
   * more variable than images, so the real stop is `idleTimeoutMs`: as long as the page
   * still reports generating, the clock keeps being pushed back. The previous fixed
   * fifteen minutes expired on videos that were still rendering, and because a failed
   * step is retried that produced a fresh tab, a re-attached prompt and a second
   * generation racing the first.
   */
  async waitForNewVideo(baseline = [], timeoutMs = PREVIEW_VIDEO_TIMEOUT_MS, { jobId = null, idleTimeoutMs = PREVIEW_VIDEO_IDLE_TIMEOUT_MS } = {}) {
    const page = jobId ? await this.#jobPage(jobId) : await this.ensurePage();
    const known = new Set((Array.isArray(baseline) ? baseline : []).filter((item) => !String(item).startsWith('assistant-count::')));
    for (const existing of await this.videoCandidates(page)) {
      if (existing?.signature) known.add(existing.signature);
    }
    const assistantCountMarker = Array.isArray(baseline)
      ? baseline.find((item) => String(item).startsWith('assistant-count::'))
      : null;
    const assistantBaselineCount = Number.parseInt(String(assistantCountMarker ?? '').split('::')[1], 10) || 0;
    const cancelVersion = this.cancelVersion;
    const startedAt = Date.now();
    let lastHeartbeat = 0;
    let lastStateCheckAt = 0;
    let lastActivityAt = startedAt;
    let lastAssistantText = '';
    let generationInProgress = false;
    const serviceName = () => this.#serviceName(page);
    const pickNewVideo = (videos) => (Array.isArray(videos) ? videos : []).find((video) => {
      if (!video?.src || video.fromUserTurn || video.inComposer) return false;
      if (known.has(video.signature)) return false;
      if (!Number.isInteger(video.assistantIndex) || video.assistantIndex < 0) return true;
      return video.assistantIndex >= assistantBaselineCount;
    });
    while (Date.now() - startedAt < timeoutMs) {
      if (!page || (typeof page.isClosed === 'function' && page.isClosed())) {
        // Clean up before surfacing it. The crashed Chrome still holds its profile
        // lock, so without this the retry connects to the corpse and fails the same way
        // - which is what turned one crash into a run of identical launch errors.
        await this.#recoverManagedBrowser('preview wait: browser closed');
        throw Object.assign(new Error(`The managed browser closed while ${serviceName()} was generating the preview video. It has been reset, and the same task can be retried safely.`), {
          code: 'BROWSER_CONTEXT_CLOSED',
          retryable: true
        });
      }
      if (cancelVersion !== this.cancelVersion) {
        throw Object.assign(new Error('Waiting was paused.'), { code: 'QUEUE_PAUSED' });
      }
      const videos = await this.videoCandidates(page);
      const candidate = pickNewVideo(videos);
      if (candidate) {
        generationInProgress = await this.#generationInProgress(page);
        if (generationInProgress) {
          lastActivityAt = Date.now();
          await this.#sleepOrPause(2_000);
          continue;
        }
        await this.#sleepOrPause(1_500);
        const stableVideos = await this.videoCandidates(page);
        const stable = stableVideos.find((video) => video.signature === candidate.signature) || pickNewVideo(stableVideos);
        if (stable?.src) return { ...stable, conversationUrl: page.url() };
      }
      const now = Date.now();
      if (now - lastStateCheckAt >= PASSIVE_STATE_CHECK_INTERVAL_MS) {
        lastStateCheckAt = now;
        generationInProgress = await this.#generationInProgress(page);
        const blocker = await this.detectBlocker(page);
        if (['REQUEST_THROTTLED', 'RATE_LIMIT', 'AUTH_REQUIRED'].includes(blocker?.code)
          && !(generationInProgress && blocker?.code === 'REQUEST_THROTTLED')) {
          throw Object.assign(new Error(blocker.message), { code: blocker.code, cooldownMs: blocker.cooldownMs });
        }
        const newAssistantText = await this.#newAssistantText(assistantBaselineCount, page);
        if (generationInProgress || newAssistantText !== lastAssistantText) lastActivityAt = now;
        lastAssistantText = newAssistantText;
        const assistantBlocker = classifyNoticeText(newAssistantText);
        if (assistantBlocker && !generationInProgress) {
          throw Object.assign(new Error(assistantBlocker.message), assistantBlocker);
        }
        if (!generationInProgress && /couldn.?t generate (a )?video|failed to generate (the )?video|video generation failed/i.test(newAssistantText)) {
          throw Object.assign(new Error(newAssistantText.trim() || `${serviceName()} reported that video generation failed.`), { code: 'GENERATION_ERROR' });
        }
      }
      if (Date.now() - lastHeartbeat >= 5_000) {
        lastHeartbeat = Date.now();
        this.emit('heartbeat', {
          elapsedMs: Date.now() - startedAt,
          idleMs: Date.now() - lastActivityAt,
          generating: generationInProgress,
          jobId,
          phase: 'preview_video'
        });
      }
      // Only give up when nothing has moved for a long time. A render that is visibly
      // still going refreshes lastActivityAt on every poll, so it is never abandoned.
      if (idleTimeoutMs && Date.now() - lastActivityAt > idleTimeoutMs) {
        throw Object.assign(
          new Error(`${serviceName()} stopped responding while generating the preview video.`),
          { code: 'VIDEO_STALLED' }
        );
      }
      await this.#sleepOrPause(1_500);
    }
    throw Object.assign(
      new Error(generationInProgress
        ? 'The preview video is still rendering after the maximum wait. It was left running rather than restarted; check the conversation, or run this step again once it finishes.'
        : 'No preview video appeared before the Veo 3 generation ceiling.'),
      {
        code: 'VIDEO_TIMEOUT',
        stillGenerating: generationInProgress,
        // Never retry into a live render. A retry opens a fresh tab and re-attaches the
        // prompt, so the second request races the first, and the session ends up holding
        // two generations and responding to neither - which is what "frozen" looked like.
        retryable: !generationInProgress
      }
    );
  }

  async checkRequestAccess() {
    if (!this.context) await this.launch({ skipHome: false });
    const page = this.page && !this.page.isClosed() ? this.page : await this.ensurePage();
    try {
      const blocker = await this.detectBlocker(page);
      if (blocker) return { available: false, ...blocker };
      const composer = await this.#findVisible(this.#composerSelectors(page), 4_000, page);
      return composer
        ? { available: true, code: null }
        : { available: false, code: 'PROBE_INCONCLUSIVE', message: `${this.#serviceName(page)} did not expose a ready composer during the safety check.` };
    } catch (error) {
      return {
        available: false,
        code: error.code ?? 'PROBE_INCONCLUSIVE',
        message: error.message ?? `The ${engineDisplayName(this.engine)} safety check was inconclusive.`
      };
    }
  }

  #decodeInPageImagePayload(payload) {
    if (payload?.dataUrl) {
      const matches = payload.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (matches) {
        const buffer = Buffer.from(matches[2], 'base64');
        if (buffer && buffer.length > 50) {
          return { buffer, contentType: matches[1] || 'image/png' };
        }
      }
    }
    if (payload?.bytes && payload.bytes.length > 50) {
      return {
        buffer: Buffer.from(payload.bytes),
        contentType: payload.contentType || 'image/png'
      };
    }
    return null;
  }

  async fetchImage(imageUrl, { jobId = null } = {}) {
    if (isMetaLocalUrl(imageUrl)) {
      const cached = this.metaImageCache.get(String(imageUrl))
        || this.metaImageCache.get(String(imageUrl).replace(/\/image$/, ''))
        || (jobId && this.metaSessions.get(jobId)?.imageSrc && this.metaImageCache.get(this.metaSessions.get(jobId).imageSrc));
      if (cached?.buffer) return cached;
      throw Object.assign(new Error('This page was generated with the old local Meta path and cannot be recovered. Retry the page on meta.ai.'), { code: 'INVALID_IMAGE_URL' });
    }
    const page = jobId ? await this.#jobPage(jobId) : await this.ensurePage();
    const rawUrl = String(imageUrl || '');
    if (!rawUrl || rawUrl.startsWith('dom:')) {
      const extracted = this.#decodeInPageImagePayload(
        await page.evaluate(extractRenderedImageInBrowser, rawUrl).catch(() => null)
      );
      if (extracted) return extracted;
      throw Object.assign(new Error('The generated image URL is invalid.'), { code: 'INVALID_IMAGE_URL' });
    }
    let resolved;
    try {
      resolved = new URL(rawUrl, page.url());
    } catch {
      throw Object.assign(new Error('The generated image URL is invalid.'), { code: 'INVALID_IMAGE_URL' });
    }
    const allowed = resolved.protocol === 'blob:'
      || resolved.protocol === 'data:'
      || isGeminiHost(resolved.hostname)
      || isGoogleAuthHost(resolved.hostname)
      || isChatGptHost(resolved.hostname)
      || resolved.hostname.endsWith('.openai.com')
      || resolved.hostname.endsWith('.oaiusercontent.com')
      || resolved.hostname.endsWith('.oaistatic.com')
      || resolved.hostname === 'oaistatic.com'
      || resolved.hostname.endsWith('.blob.core.windows.net')
      || resolved.hostname.endsWith('.googleusercontent.com')
      || resolved.hostname === 'googleusercontent.com'
      || resolved.hostname.endsWith('.google.com')
      || isMetaImageHost(resolved.hostname)
      || isMetaPageUrl(resolved.toString());
    if (!allowed) throw Object.assign(new Error(`Untrusted image source rejected: ${resolved.hostname}`), { code: 'IMAGE_HOST_REJECTED' });

    const extracted = this.#decodeInPageImagePayload(
      await page.evaluate(extractRenderedImageInBrowser, resolved.toString()).catch(() => null)
    );
    if (extracted && extracted.buffer.length >= 10_000) return extracted;
    if (resolved.protocol === 'blob:' || resolved.protocol === 'data:') {
      if (extracted) return extracted;
      throw Object.assign(new Error(`The generated image could not be read from the ${this.#serviceName(page)} page.`), { code: 'IMAGE_DOWNLOAD_FAILED' });
    }

    const response = await this.context.request.get(resolved.toString(), {
      failOnStatusCode: false,
      timeout: 120_000
    });
    if (!response.ok()) {
      if (extracted) return extracted;
      throw Object.assign(new Error(`Image download failed (${response.status()}).`), { code: 'IMAGE_DOWNLOAD_FAILED' });
    }
    const contentType = response.headers()['content-type'] ?? 'image/png';
    const buffer = await response.body();
    if (!buffer || buffer.length < 50) {
      if (extracted) return extracted;
      throw Object.assign(new Error('The downloaded file is not a valid image.'), { code: 'INVALID_IMAGE_FILE' });
    }
    return { buffer, contentType };
  }

  async fetchVideo(videoUrl, { jobId = null } = {}) {
    const page = jobId ? await this.#jobPage(jobId) : await this.ensurePage();
    const rawUrl = String(videoUrl || '');
    if (!rawUrl) {
      throw Object.assign(new Error('The generated video URL is invalid.'), { code: 'INVALID_VIDEO_URL' });
    }
    let resolved;
    try {
      resolved = new URL(rawUrl, page.url());
    } catch {
      throw Object.assign(new Error('The generated video URL is invalid.'), { code: 'INVALID_VIDEO_URL' });
    }
    const allowed = resolved.protocol === 'blob:'
      || resolved.protocol === 'data:'
      || isGeminiHost(resolved.hostname)
      || isGoogleAuthHost(resolved.hostname)
      || resolved.hostname.endsWith('.googleusercontent.com')
      || resolved.hostname === 'googleusercontent.com'
      || resolved.hostname.endsWith('.google.com')
      || resolved.hostname.endsWith('.googlevideo.com')
      || resolved.hostname === 'googlevideo.com'
      || resolved.hostname.endsWith('.gvt1.com')
      || resolved.hostname.endsWith('.googleapis.com')
      || resolved.hostname === 'storage.googleapis.com';
    if (!allowed) throw Object.assign(new Error(`Untrusted video source rejected: ${resolved.hostname}`), { code: 'VIDEO_HOST_REJECTED' });

    const extracted = this.#decodeInPageImagePayload(
      await page.evaluate(extractRenderedVideoInBrowser, resolved.toString()).catch(() => null)
    );
    if (extracted && extracted.buffer.length >= 8_000) {
      return { buffer: extracted.buffer, contentType: extracted.contentType || 'video/mp4' };
    }
    if (resolved.protocol === 'blob:' || resolved.protocol === 'data:') {
      if (extracted) return { buffer: extracted.buffer, contentType: extracted.contentType || 'video/mp4' };
      throw Object.assign(new Error(`The generated video could not be read from the ${this.#serviceName(page)} page.`), { code: 'VIDEO_DOWNLOAD_FAILED' });
    }

    const response = await this.context.request.get(resolved.toString(), {
      failOnStatusCode: false,
      timeout: 180_000
    });
    if (!response.ok()) {
      if (extracted) return { buffer: extracted.buffer, contentType: extracted.contentType || 'video/mp4' };
      throw Object.assign(new Error(`Video download failed (${response.status()}).`), { code: 'VIDEO_DOWNLOAD_FAILED' });
    }
    const contentType = response.headers()['content-type'] ?? 'video/mp4';
    const buffer = await response.body();
    if (!buffer || buffer.length < 8_000) {
      if (extracted) return { buffer: extracted.buffer, contentType: extracted.contentType || 'video/mp4' };
      throw Object.assign(new Error('The downloaded file is not a valid video.'), { code: 'INVALID_VIDEO_FILE' });
    }
    return { buffer, contentType };
  }

  async #expandCollapsedAssistant(page = null) {
    page ??= await this.ensurePage();
    const config = this.#assistantDraftConfig(page);
    return page.evaluate(({ messageSelector, collapsedRootSelector }) => {
      const labels = /show more|show all|expand|see more|view more|show full/i;
      const visible = (element) => {
        if (!element) return false;
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return box.width > 1 && box.height > 1 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const messages = document.querySelectorAll(messageSelector);
      const root = (collapsedRootSelector && document.querySelector(collapsedRootSelector))
        || messages[messages.length - 1]
        || document;
      let clicked = 0;
      for (const element of root.querySelectorAll('button, [role="button"], a')) {
        const label = `${element.getAttribute('aria-label') || ''} ${element.textContent || ''}`.replace(/\s+/g, ' ').trim();
        if (!labels.test(label) || !visible(element)) continue;
        element.click();
        clicked += 1;
      }
      return clicked;
    }, {
      messageSelector: config.messageSelector,
      collapsedRootSelector: config.collapsedRootSelector
    }).catch(() => 0);
  }

  async #sampleGeminiDraft(baselineCount, page = null, options = {}) {
    page ??= await this.ensurePage();
    const wantFull = Boolean(options.fullText);
    const wantCollapsed = Boolean(options.checkCollapsed);
    const config = this.#assistantDraftConfig(page);
    return page.evaluate(({
      stopSelectors,
      busySelectors,
      messageSelector,
      textSelector,
      collapsedRootSelector,
      baselineCount,
      wantFull,
      wantCollapsed
    }) => {
      const visible = (element) => {
        if (!element) return false;
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return box.width > 1 && box.height > 1 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const firstVisible = (selectors) => {
        for (const selector of selectors) {
          const matches = document.querySelectorAll(selector);
          for (const element of matches) {
            if (visible(element)) return true;
          }
        }
        return false;
      };
      const stopVisible = firstVisible(stopSelectors);
      const busyVisible = firstVisible(busySelectors);
      const messages = [...document.querySelectorAll(messageSelector)];
      const count = messages.length;
      let text = '';
      let length = 0;
      let suffix = '';
      if (count > baselineCount) {
        const fresh = messages.slice(Math.max(0, baselineCount));
        const parts = fresh.map((message) => {
          const nested = textSelector ? [...message.querySelectorAll(textSelector)] : [];
          if (nested.length) {
            return nested.map((node) => String(node.textContent || node.innerText || '').trim()).filter(Boolean).join('\n');
          }
          if (textSelector && typeof message.matches === 'function' && message.matches(textSelector)) {
            return String(message.textContent || message.innerText || '').trim();
          }
          return String(message.textContent || message.innerText || '').trim();
        }).filter(Boolean);
        const last = (textSelector ? document.querySelectorAll(textSelector) : [])[(textSelector ? document.querySelectorAll(textSelector).length : 0) - 1]
          || messages[messages.length - 1];
        const raw = parts.join('\n\n') || String(last?.textContent || last?.innerText || '');
        length = raw.length;
        suffix = raw.slice(-1200);
        text = wantFull ? raw : suffix;
      }
      let collapsedVisible = false;
      if (wantCollapsed) {
        const labels = /show more|see more|view more|show full|expand/i;
        const root = (collapsedRootSelector && document.querySelector(collapsedRootSelector))
          || messages[messages.length - 1]
          || document;
        collapsedVisible = [...root.querySelectorAll('button, [role="button"], a')].some((element) => {
          const label = `${element.getAttribute('aria-label') || ''} ${element.textContent || ''}`;
          return labels.test(label) && visible(element);
        });
      }
      return {
        inProgress: stopVisible || busyVisible,
        stopVisible,
        busyVisible,
        collapsedVisible,
        text,
        length,
        suffix,
        count
      };
    }, {
      stopSelectors: config.stopSelectors,
      busySelectors: config.busySelectors,
      messageSelector: config.messageSelector,
      textSelector: config.textSelector,
      collapsedRootSelector: config.collapsedRootSelector,
      baselineCount,
      wantFull,
      wantCollapsed
    }).catch(() => ({
      inProgress: false,
      stopVisible: false,
      busyVisible: false,
      collapsedVisible: false,
      text: '',
      length: 0,
      suffix: ''
    }));
  }

  async waitForAssistantTextResponse(baseline = [], timeoutMs = 180_000, page = null, options = {}) {
    const result = await this.#waitForAssistantTextObservation(baseline, timeoutMs, page, options);
    if (result.text) return result.text;
    if (Math.max(0, Number.parseInt(options.expectedCount, 10) || 0) > 0) return result.text || '';
    throw Object.assign(new Error(`${this.#serviceName(page)} did not complete the response within the timeout.`), {
      code: 'GPT_RESPONSE_TIMEOUT',
      observation: result.observation || null
    });
  }

  async #waitForAssistantTextObservation(baseline = [], timeoutMs = 180_000, page = null, options = {}) {
    page ??= await this.ensurePage();
    const assistantCountMarker = Array.isArray(baseline)
      ? baseline.find((item) => String(item).startsWith('assistant-count::'))
      : null;
    const assistantBaselineCount = Number.parseInt(String(assistantCountMarker ?? '').split('::')[1], 10) || 0;
    const expectedCount = Math.max(0, Number.parseInt(options.expectedCount, 10) || 0);
    const startPage = Math.max(1, Number.parseInt(options.startPage, 10) || 1);
    const endPage = Math.max(startPage, Number.parseInt(options.endPage, 10) || (expectedCount ? startPage + expectedCount - 1 : startPage));
    const batchSize = Math.max(10, Number.parseInt(options.batchSize, 10) || expectedCount || 50);
    const hardCapMs = expectedCount
      ? Math.max(timeoutMs || 180_000, Number(options.maxDraftMs) || Number(options.hardCapMs) || 10 * 60_000)
      : (timeoutMs || 180_000);
    const startedAt = Date.now();
    let previousText = '';
    let lastText = '';
    let lastLength = 0;
    let lastParsedCount = 0;
    let lastGrowthAt = startedAt;
    let lastPhase = '';
    let lastBlockerAt = 0;
    let expandAttempts = 0;
    let observation = null;
    let decision = { action: 'wait', pollMs: 500 };
    const finish = (result) => {
      this.lastGeminiTextWatch = result;
      return result;
    };

    const cancelVersion = this.cancelVersion;
    let stageWatch = null;
    let lastStageBeat = 0;
    while (Date.now() - startedAt < hardCapMs) {
      if (this.abortRequested || cancelVersion !== this.cancelVersion) {
        throw Object.assign(new Error('Waiting was paused.'), { code: 'QUEUE_PAUSED' });
      }
      if (!page || (typeof page.isClosed === 'function' && page.isClosed())) {
        const disconnected = !this.context || this.context.browser?.()?.isConnected?.() === false;
        const closedDecision = this.supervisor.observe({
          tabClosed: !disconnected,
          tabOpen: false,
          browserDisconnected: disconnected,
          now: Date.now()
        });
        return finish({
          text: lastText,
          observation: { phase: GEMINI_TEXT_PHASE.FAILED, reason: disconnected ? 'browser-disconnected' : 'tab-closed', parsedCount: lastParsedCount, expectedCount },
          decision: { action: 'retry', reason: disconnected ? 'BROWSER_DISCONNECTED' : 'TAB_CRASHED_OR_CLOSED' },
          parsedCount: lastParsedCount,
          supervisor: closedDecision
        });
      }
      const now = Date.now();
      const pageUrl = typeof page.url === 'function' ? String(page.url() || '') : '';
      if (isMarketplacePageUrl(pageUrl)) {
        // #region agent log
        fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H20',location:'src/browser-controller.cjs:#waitForAssistantTextObservation',message:'text watch found a marketplace tab; requesting recycle',data:{url:pageUrl.slice(0,120),expectedCount},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        return finish({
          text: lastText,
          observation: { phase: GEMINI_TEXT_PHASE.LAGGING, reason: 'marketplace-tab', parsedCount: lastParsedCount, expectedCount },
          decision: { action: 'retry', reason: 'lag-recycle-tab' },
          parsedCount: lastParsedCount
        });
      }
      if (now - lastBlockerAt >= BLOCKER_CHECK_MS) {
        lastBlockerAt = now;
        const blocker = await this.detectBlocker(page);
        if (blocker) throw Object.assign(new Error(blocker.message), { code: blocker.code });
      }

      const sinceGrowth = now - lastGrowthAt;
      const wantFull = observation
        ? shouldReadFullGeminiTranscript({
          inProgress: observation.phase === GEMINI_TEXT_PHASE.DRAFTING || observation.phase === GEMINI_TEXT_PHASE.WAITING,
          collapsedVisible: observation.phase === GEMINI_TEXT_PHASE.COLLAPSED,
          sinceGrowth
        })
        : false;
      const snapshot = await this.#sampleGeminiDraft(assistantBaselineCount, page, {
        fullText: Boolean(wantFull),
        checkCollapsed: !observation || observation.phase !== GEMINI_TEXT_PHASE.DRAFTING
      });
      const snapshotText = isGeminiChromeNoise(snapshot.text || snapshot.suffix)
        ? ''
        : String(snapshot.text || snapshot.suffix || '');
      const keptDraft = analysisDraftUsable(snapshotText) || snapshotText.length >= 40
        ? snapshotText
        : (lastText || snapshotText);
      const currentLength = Math.max(Number(snapshot.length) || 0, keptDraft.length);
      if (currentLength > lastLength + 8) lastGrowthAt = now;
      const analysisReady = expectedCount === 0 && analysisDraftUsable(keptDraft);
      let progress = { parsedCount: lastParsedCount, complete: false };
      if (expectedCount) {
        if (wantFull && snapshot.text) {
          progress = inspectGeneratedPromptProgress(snapshot.text, { startPage, endPage, expectedCount });
        } else {
          progress = estimatePromptProgressFromSample(snapshot, {
            startPage,
            endPage,
            expectedCount,
            lastParsedCount
          });
        }
      } else {
        progress = { parsedCount: analysisReady ? 1 : 0, complete: analysisReady };
      }
      lastParsedCount = Math.max(lastParsedCount, progress.parsedCount);
      const draftText = keptDraft;
      if (expectedCount === 0 && isGeminiChromeNoise(snapshot.text || snapshot.suffix || lastText)) {
        await this.#disarmGeminiImageGeneration(page).catch(() => {});
      }
      stageWatch = observeStageProgress(stageWatch, {
        stage: options.stage || STAGE.GEMINI_ANALYSIS,
        url: pageUrl,
        draftLength: currentLength,
        hasTitleJson: analysisReady || /"title"\s*:/i.test(draftText),
        analysisReady,
        startedAt,
        now,
        lagMs: Number(options.lagRetryMs) || (expectedCount ? 0 : STAGE_LAG_MS)
      });
      if (now - lastStageBeat >= 5_000) {
        lastStageBeat = now;
        let pageHost = '';
        try { pageHost = new URL(pageUrl).host; } catch {}
        // #region agent log
        fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H23',location:'src/browser-controller.cjs:#waitForAssistantTextObservation',message:'stage watchdog heartbeat',data:{stage:stageWatch.stage,reason:stageWatch.reason,action:stageWatch.action,elapsed:stageWatch.elapsed,sinceProgress:stageWatch.sinceProgress,draftLength:currentLength,hasTitleJson:stageWatch.hasTitleJson,parsedCount:lastParsedCount,host:pageHost,inProgress:Boolean(snapshot.inProgress)},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
      }
      const supervisorDecision = this.supervisor.observe({
        now,
        submitted: Boolean(this.supervisor.checkpoint.submittedAt),
        generating: Boolean(snapshot.inProgress) || Boolean(this.supervisor.checkpoint.submittedAt),
        draftGrew: currentLength > lastLength + 8,
        analysisReady,
        lastProgressAt: lastGrowthAt,
        watched: { observation, decision: { action: stageWatch.action, reason: stageWatch.reason } }
      });
      if (stageWatch.action === 'recycle') {
        if (supervisorDecision.action === SUPERVISOR_ACTION.WAIT || supervisorDecision.action === SUPERVISOR_ACTION.ACCEPT) {
          // Slow generation with a live tab is not a dead browser.
        } else {
          return finish({
            text: lastText,
            observation: { phase: GEMINI_TEXT_PHASE.LAGGING, reason: stageWatch.reason, parsedCount: lastParsedCount, expectedCount },
            decision: { action: 'retry', reason: 'lag-recycle-tab' },
            parsedCount: lastParsedCount,
            supervisor: supervisorDecision
          });
        }
      }
      observation = classifyGeminiTextObservation({
        inProgress: snapshot.inProgress,
        text: draftText || snapshot.text || snapshot.suffix,
        previousText,
        textLength: currentLength,
        previousLength: lastLength,
        expectedCount,
        parsedCount: lastParsedCount,
        analysisReady,
        collapsedVisible: snapshot.collapsedVisible,
        now,
        startedAt,
        lastGrowthAt
      });
      decision = decideGeminiTextAction(observation, { batchSize, lagRetryMs: options.lagRetryMs });
      if (decision.action === 'retry' && decision.reason === 'lag-recycle-tab') {
        const lagDecision = this.supervisor.observe({
          now,
          submitted: Boolean(this.supervisor.checkpoint.submittedAt),
          generating: Boolean(snapshot.inProgress) || Boolean(this.supervisor.checkpoint.submittedAt),
          draftGrew: currentLength > lastLength + 8,
          analysisReady,
          lastProgressAt: lastGrowthAt,
          watched: { observation, decision }
        });
        if (lagDecision.action === SUPERVISOR_ACTION.WAIT || lagDecision.action === SUPERVISOR_ACTION.ACCEPT) {
          decision = { action: 'wait', pollMs: 800, reason: 'supervisor-slow-generation' };
        } else {
          // #region agent log
          fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H6',location:'src/browser-controller.cjs:#waitForAssistantTextObservation',message:'gemini lag watchdog requested a tab recycle',data:{phase:observation.phase,reason:observation.reason,elapsed:observation.elapsed,sinceGrowth:observation.sinceGrowth,expectedCount,parsedCount:lastParsedCount,hasText:Boolean(lastText),supervisor:lagDecision.action},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
        }
      }
      if (observation.phase !== lastPhase) {
        lastPhase = observation.phase;
        console.log(`[browser] ${this.#serviceName(page)} text watch: ${observation.phase} (${observation.reason}) pages=${lastParsedCount}/${expectedCount || 'n'} busy=${snapshot.inProgress} stop=${snapshot.stopVisible} chars=${currentLength}`);
        if (typeof options.onObservation === 'function') {
          try { options.onObservation({ ...observation, ...snapshot, parsedCount: lastParsedCount, expectedCount, decision }); } catch {}
        }
      }
      previousText = draftText || snapshot.text || snapshot.suffix || previousText;
      lastLength = currentLength;
      if (draftText && draftText.length >= lastText.length) lastText = draftText;
      else if (snapshot.text && snapshot.text.length >= lastText.length) lastText = snapshot.text;
      else if (snapshot.suffix && !lastText) lastText = snapshot.suffix;
      if (currentLength > 400) {
        const persistEngine = this.#pageKind(page);
        if (persistEngine === 'gemini' || persistEngine === 'chatgpt' || persistEngine === 'meta') {
          await this.#persistLoginStateThrottled(persistEngine, 45_000);
        }
      }

      if (decision.action === 'expand' && expandAttempts < 4) {
        expandAttempts += 1;
        await this.#expandCollapsedAssistant(page).catch(() => {});
        await this.#sleepOrPause(280);
        continue;
      }
      if (decision.action === 'accept' || decision.action === 'accept-partial' || decision.action === 'continue') {
        if (snapshot.collapsedVisible) await this.#expandCollapsedAssistant(page).catch(() => {});
        const finalSnap = await this.#sampleGeminiDraft(assistantBaselineCount, page, { fullText: true, checkCollapsed: true });
        if (finalSnap.collapsedVisible) await this.#expandCollapsedAssistant(page).catch(() => {});
        const finalText = analysisDraftUsable(finalSnap.text)
          ? finalSnap.text
          : (analysisDraftUsable(lastText) ? lastText : (finalSnap.text || snapshot.text || lastText));
        const finalProgress = expectedCount
          ? inspectGeneratedPromptProgress(finalText, { startPage, endPage, expectedCount })
          : { parsedCount: analysisDraftUsable(finalText) || finalText ? 1 : lastParsedCount };
        if (expectedCount === 0) {
          // #region agent log
          fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H90',location:'src/browser-controller.cjs:#waitForAssistantTextObservation',message:'analysis watch accepted a usable draft',data:{reason:decision.reason||observation.reason||'',phase:observation.phase,inProgress:Boolean(snapshot.inProgress),finalLength:String(finalText||'').length,usable:analysisDraftUsable(finalText),elapsed:Date.now()-startedAt},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
        }
        return finish({ text: finalText, observation, decision, parsedCount: finalProgress.parsedCount });
      }
      if (decision.action === 'shrink' || decision.action === 'retry') {
        return finish({ text: lastText, observation, decision, parsedCount: lastParsedCount });
      }
      await this.#sleepOrPause(Math.max(280, Number(decision.pollMs) || 500));
    }
    if (lastText) {
      const finalSnap = await this.#sampleGeminiDraft(assistantBaselineCount, page, { fullText: true, checkCollapsed: true }).catch(() => null);
      const finalText = finalSnap?.text || lastText;
      const hardProgress = expectedCount
        ? inspectGeneratedPromptProgress(finalText, { startPage, endPage, expectedCount })
        : { parsedCount: lastParsedCount || 1 };
      return finish({
        text: finalText,
        observation: observation || { phase: GEMINI_TEXT_PHASE.LAGGING, reason: 'hard-cap', parsedCount: hardProgress.parsedCount, expectedCount },
        decision: { action: hardProgress.parsedCount ? 'accept-partial' : 'retry', reason: 'hard-cap' },
        parsedCount: hardProgress.parsedCount
      });
    }
    return finish({
      text: '',
      observation: observation || { phase: GEMINI_TEXT_PHASE.FAILED, reason: 'timeout-empty' },
      decision: { action: 'retry', reason: 'timeout-empty' },
      parsedCount: 0
    });
  }

  /**
   * A true-headless browser context for public market pages.
   *
   * This does not touch the managed Gemini/content browser: no shared profile,
   * no CDP attach, no parked headed window. The caller receives a temporary
   * context and this helper closes the context and browser after the callback.
   */
  async withHeadlessScratchContext(work) {
    if (typeof work !== 'function') {
      throw Object.assign(new Error('A headless scratch callback is required.'), { retryable: false });
    }
    const scratchBrowser = await launchHeadlessScratchBrowser({ downloadDir: this.downloadDir });
    let scratchContext = null;
    try {
      scratchContext = await scratchBrowser.newContext({
        acceptDownloads: false,
        locale: 'en-US',
        viewport: { width: 1365, height: 900 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      });
      if (typeof scratchContext.setDefaultTimeout === 'function') scratchContext.setDefaultTimeout(STAGE_LAG_MS);
      if (typeof scratchContext.setDefaultNavigationTimeout === 'function') scratchContext.setDefaultNavigationTimeout(18_000);
      await scratchContext.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      }).catch(() => {});
      return await work(scratchContext);
    } finally {
      if (scratchContext) await scratchContext.close().catch(() => {});
      await scratchBrowser.close().catch(() => {});
    }
  }

  async withHeadedScratchContext(work) {
    if (typeof work !== 'function') {
      throw Object.assign(new Error('A headed scratch callback is required.'), { retryable: false });
    }
    const scratchBrowser = await launchHeadlessScratchBrowser({ downloadDir: this.downloadDir, headed: true });
    let scratchContext = null;
    try {
      scratchContext = await scratchBrowser.newContext({
        acceptDownloads: false,
        locale: 'en-US',
        viewport: { width: 1365, height: 900 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      });
      if (typeof scratchContext.setDefaultTimeout === 'function') scratchContext.setDefaultTimeout(STAGE_LAG_MS);
      if (typeof scratchContext.setDefaultNavigationTimeout === 'function') scratchContext.setDefaultNavigationTimeout(18_000);
      await scratchContext.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      }).catch(() => {});
      return await work(scratchContext);
    } finally {
      if (scratchContext) await scratchContext.close().catch(() => {});
      await scratchBrowser.close().catch(() => {});
    }
  }

  /**
   * Open public TPT pages in the same bundled Chromium the user already watches.
   * Uses a dedicated tab so Gemini stays on Gemini. Falls back to a headed
   * scratch window when the managed browser is not attached yet.
   */
  async withVisibleMarketContext(work) {
    if (typeof work !== 'function') {
      throw Object.assign(new Error('A visible market callback is required.'), { retryable: false });
    }
    try {
      await this.launch({ skipHome: true, interactive: true });
    } catch {
      // Fall through to headed scratch.
    }
    if (this.context) {
      const opened = [];
      const wrapper = {
        newPage: async () => {
          const page = await this.context.newPage();
          opened.push(page);
          await this.#showWindow(page);
          return page;
        },
        request: this.context.request
      };
      try {
        // #region agent log
        fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H171',location:'src/browser-controller.cjs:withVisibleMarketContext',message:'opening a visible marketplace tab in the bundled Chromium',data:{managed:true,pageCount:(this.context.pages()||[]).length},timestamp:Date.now()})}).catch(()=>{});
        try { require('node:fs').appendFileSync('/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )/.cursor/debug-d45d8d.log', `${JSON.stringify({ sessionId: 'd45d8d', runId: 'post-fix', hypothesisId: 'H171', location: 'src/browser-controller.cjs:withVisibleMarketContext', message: 'opening a visible marketplace tab in the bundled Chromium', data: { managed: true }, timestamp: Date.now() })}\n`); } catch {}
        // #endregion
        return await work(wrapper);
      } finally {
        for (const page of opened) await page.close().catch(() => {});
      }
    }
    // #region agent log
    fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H171',location:'src/browser-controller.cjs:withVisibleMarketContext',message:'managed browser missing; using a headed scratch window for TPT',data:{managed:false},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return this.withHeadedScratchContext(work);
  }

  /**
   * A blank page in the managed browser, for flows that need the app profile.
   *
   * Public market discovery uses withHeadlessScratchContext() instead; this is
   * kept for browser work that must share the managed session. The caller closes
   * the page.
   */
  async openScratchPage() {
    await this.launch({ headless: true, forceBrowser: true });
    if (!this.context) {
      throw Object.assign(new Error('The managed browser was not available.'), { code: 'BROWSER_UNAVAILABLE', retryable: true });
    }
    return this.context.newPage();
  }

  async scrapeTptListingMockups(productUrl, destDir) {
    const parsed = parseTptProductUrl(productUrl);
    if (!parsed) {
      return emptyMockupResult({
        status: 'skipped',
        productUrl,
        warning: 'Listing mockup capture is available for Teachers Pay Teachers product links.'
      });
    }
    if (!destDir) {
      return emptyMockupResult({
        status: 'empty',
        productUrl: parsed.href,
        warning: 'No local folder was available to save listing mockups.'
      });
    }

    return this.withVisibleMarketContext(async (context) => {
      const scrapeOnce = async (attempt) => {
        const page = await context.newPage();
        try {
          // #region agent log
          fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H16',location:'src/browser-controller.cjs:scrapeTptListingMockups',message:'visible marketplace scrape attempt',data:{attempt,productId:parsed.productId,href:parsed.href},timestamp:Date.now()})}).catch(()=>{});
          try { require('node:fs').appendFileSync('/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )/.cursor/debug-d45d8d.log', `${JSON.stringify({ sessionId: 'd45d8d', runId: 'post-fix', hypothesisId: 'H16', location: 'src/browser-controller.cjs:scrapeTptListingMockups', message: 'visible marketplace scrape attempt', data: { attempt, productId: parsed.productId }, timestamp: Date.now() })}\n`); } catch {}
          // #endregion
          await Promise.race([
            page.goto(parsed.href, { waitUntil: 'domcontentloaded', timeout: 18_000 }),
            sleep(20_000).then(() => {
              throw Object.assign(new Error('TPT listing navigation stalled.'), { code: 'MARKET_NAV_STALLED', retryable: true });
            })
          ]);
          const challengeDeadline = Date.now() + 8_000;
          while (Date.now() < challengeDeadline) {
            const title = await page.title().catch(() => '');
            if (!/just a moment/i.test(title)) break;
            await sleep(400);
          }
          await page.waitForSelector(
            'img[src*="thumbitem"], img[src*="preview"], img[alt*="Thumbnail" i], img[alt*="Preview" i], meta[property="og:image"]',
            { timeout: 8_000 }
          ).catch(() => {});

          const html = await Promise.race([
            page.content(),
            sleep(8_000).then(() => {
              throw Object.assign(new Error('TPT listing HTML read stalled.'), { code: 'MARKET_NAV_STALLED', retryable: true });
            })
          ]);
          const pageTitle = await page.title().catch(() => '');
          const stage = observeStageProgress(null, {
            stage: STAGE.LISTING_SCRAPE,
            url: parsed.href,
            challenged: isCloudflareChallengeHtml(html) || /just a moment/i.test(pageTitle),
            now: Date.now()
          });
          if (isCloudflareChallengeHtml(html) || /just a moment/i.test(pageTitle) || stage.action === 'recycle') {
            throw Object.assign(new Error('The listing page was blocked by a bot check.'), { code: 'MARKET_NAV_STALLED', retryable: true });
          }

          const extraUrls = await Promise.race([
            page.evaluate(collectMockupUrlsInBrowser),
            sleep(8_000).then(() => [])
          ]).catch(() => []);
          const urls = extractListingMockupUrls(html, {
            pageUrl: parsed.href,
            productId: parsed.productId,
            extraUrls
          });
          const listingFacts = extractTptListingFacts(html, parsed.href);
          const scrapedPageCount = listingFacts.pageCount || extractPageCountFromTptHtml(html);
          console.log(`[browser] TPT listing scrape ${parsed.href} extra=${Array.isArray(extraUrls) ? extraUrls.length : 0} urls=${urls.length} pageCount=${scrapedPageCount || 'n/a'} title=${listingFacts.title || pageTitle}`);
          if (!urls.length) {
            return emptyMockupResult({
              status: 'empty',
              productUrl: parsed.href,
              warning: 'No listing mockups were found on this product page. Prompt generation will continue from the URL text only.',
              scrapedPageCount,
              listingFacts
            });
          }

          const request = context.request;
          return downloadListingMockups({
            urls,
            destDir,
            productUrl: parsed.href,
            scrapedPageCount,
            listingFacts,
            fetchBuffer: async (imageUrl) => {
              const response = await request.get(imageUrl, {
                headers: {
                  Referer: parsed.href,
                  Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
                },
                timeout: 12_000,
                failOnStatusCode: false
              });
              if (!response.ok()) return null;
              return {
                buffer: Buffer.from(await response.body()),
                contentType: response.headers()['content-type'] || ''
              };
            }
          });
        } finally {
          await page.close().catch(() => {});
        }
      };

      try {
        return await scrapeOnce(1);
      } catch (error) {
        // #region agent log
        fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H16',location:'src/browser-controller.cjs:scrapeTptListingMockups',message:'marketplace scrape stalled; retrying a fresh headless tab',data:{code:error?.code||null,message:String(error?.message||error).slice(0,160)},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        console.log('[browser] TPT listing scrape stalled; opening a fresh headless tab.');
        try {
          return await scrapeOnce(2);
        } catch (retryError) {
          return emptyMockupResult({
            status: 'blocked',
            productUrl: parsed.href,
            warning: retryError?.message
              ? `Listing mockups could not be captured: ${retryError.message}`
              : 'Listing mockups could not be captured from the public product page.'
          });
        }
      }
    });
  }

  async analyzeProductWithGpt(input = {}) {
    if (this.engine !== 'gemini') {
      return this.withEngine('gemini', () => this.analyzeProductWithGpt(input));
    }
    const listing = resolveListingAnalysisInput(input);
    let mockups = emptyMockupResult({
      status: 'skipped',
      productUrl: getMarketplace({ tptListing: listing }).upload.productUrl,
      warning: null
    });
    const shouldScrape = shouldCaptureListingMockups(listing) && Boolean(listing.mockupDestDir);
    if (shouldScrape) {
      try {
        mockups = await this.scrapeTptListingMockups(getMarketplace({ tptListing: listing }).upload.productUrl, listing.mockupDestDir);
      } catch (error) {
        mockups = emptyMockupResult({
          status: 'blocked',
          productUrl: getMarketplace({ tptListing: listing }).upload.productUrl,
          warning: error?.message
            ? `Listing mockups could not be captured: ${error.message}`
            : 'Listing mockups could not be captured from the public product page.'
        });
      }
    }
    const attachmentPaths = competitorMockupPaths(mockups);
    const prompt = buildAnalysisPrompt({
      ...listing,
      mockupCount: attachmentPaths.length,
      scrapedPageCount: mockups.scrapedPageCount,
      listingTitle: mockups.listingTitle || mockups.listingFacts?.title || listing.title || listing.concept,
      listingDescription: mockups.listingDescription || mockups.listingFacts?.description || listing.description,
      listingGrade: mockups.listingGrade || mockups.listingFacts?.grade || listing.grade
    });
    const gptUrl = listing.gptUrl || getJobStartUrl({ kind: 'analysis' }, this.engine);
    await this.#launchForPromptWork();
    let page = await this.ensurePage();
    await this.#afterNavigate(page);
    if (isMarketplacePageUrl(page.url())) {
      page = await this.#openFreshGeminiStudioTab(gptUrl, page);
    }
    if (gptUrl && jobPageNeedsNavigation(page.url(), gptUrl, true)) {
      try {
        await page.goto(gptUrl, { waitUntil: 'domcontentloaded', timeout: STAGE_LAG_MS });
        await sleep(1_000);
      } catch (error) {
        // #region agent log
        fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H21',location:'src/browser-controller.cjs:analyzeProductWithGpt',message:'analysis studio navigation stalled; opening a fresh tab',data:{code:error?.code||null,message:String(error?.message||error).slice(0,160)},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        page = await this.#openFreshGeminiStudioTab(gptUrl, page);
      }
    }
    await this.#ensureLiveGeminiStudio(page, gptUrl);
    await this.#disarmGeminiImageGeneration(page);
    this.#writePromptReceipt({
      kind: 'analysis-first',
      stage: 'before-submit',
      promptPreview: String(prompt).slice(0, 1600),
      promptHasMockupInstruction: /attached listing mockup/i.test(prompt),
      attachmentPaths,
      attachmentCount: attachmentPaths.length
    });
    console.log(`[browser] first analysis prompt attaching ${attachmentPaths.length} competitor mockup(s)`);
    // #region agent log
    fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H8',location:'src/browser-controller.cjs:analyzeProductWithGpt',message:'analysis scrape finished, submitting to gemini',data:{mockupCount:attachmentPaths.length,mockupStatus:mockups?.status||null,listingTitle:mockups.listingTitle||null,listingGrade:mockups.listingGrade||null,scrapedPageCount:mockups.scrapedPageCount||null,productUrl:String(listing?.productUrl||'').slice(0,120)},timestamp:Date.now()})}).catch(()=>{});
    try { require('node:fs').appendFileSync('/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )/.cursor/debug-d45d8d.log', `${JSON.stringify({ sessionId: 'd45d8d', runId: 'post-fix', hypothesisId: 'H8', location: 'src/browser-controller.cjs:analyzeProductWithGpt', message: 'analysis scrape finished, submitting to gemini', data: { mockupCount: attachmentPaths.length, listingTitle: mockups.listingTitle || null, scrapedPageCount: mockups.scrapedPageCount || null }, timestamp: Date.now() })}\n`); } catch {}
    // #endregion
    const waitForAnalysis = async (targetPage, { skipAttachments = false } = {}) => {
      const files = skipAttachments ? [] : attachmentPaths;
      const submission = await this.submitPrompt(prompt, {
        gptUrl,
        attachmentPaths: files,
        requireAttachmentChips: files.length > 0,
        attachBeforePrompt: files.length > 0,
        promptKind: 'analysis-first'
      });
      const watchPage = submission.page && !submission.page.isClosed?.() ? submission.page : targetPage;
      if (watchPage !== targetPage) {
        // #region agent log
        fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H22',location:'src/browser-controller.cjs:analyzeProductWithGpt',message:'watching the tab submitPrompt actually used',data:{hadStaleTarget:Boolean(targetPage),sameTab:watchPage===targetPage},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
      }
      const watched = await this.#waitForAssistantTextObservation(submission.baseline, GENERATION_TIMEOUT_MS, watchPage, {
        expectedCount: 0,
        maxDraftMs: GENERATION_TIMEOUT_MS,
        hardCapMs: GENERATION_TIMEOUT_MS,
        lagRetryMs: GENERATION_TIMEOUT_MS,
        stage: STAGE.GEMINI_ANALYSIS
      });
      return { submission, watched };
    };
    const analysisLooksReady = (text) => analysisDraftUsable(text);
    this.supervisor.beginJob({
      projectId: listing.productUrl || listing.concept || 'analysis',
      pageId: 'analysis',
      stage: 'analysis'
    });
    // #region agent log
    fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix-b',hypothesisId:'H140',location:'src/browser-controller.cjs:analyzeProductWithGpt',message:'analysis job reset before submit',data:{canSubmit:this.supervisor.canSubmit(),submittedAt:this.supervisor.checkpoint.submittedAt,outputStatus:this.supervisor.checkpoint.outputStatus,lastProgressAt:this.supervisor.checkpoint.lastProgressAt,recoveryCount:this.supervisor.checkpoint.recoveryCount},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    let submission;
    let watched;
    while (!this.abortRequested) {
      if (this.abortRequested) {
        throw Object.assign(new Error('Waiting was paused.'), { code: 'QUEUE_PAUSED' });
      }
      const now = Date.now();
      const snap = this.supervisor.snapshot();
      if (snap.nextRetryAt && now < snap.nextRetryAt) {
        await this.#sleepOrPause(Math.min(5_000, snap.nextRetryAt - now));
        continue;
      }
      if (snap.userActionRequired) {
        throw Object.assign(new Error(`Gemini needs a user action (${snap.state}). The job is paused so it does not burn quota.`), {
          code: snap.state,
          retryable: false,
          userActionRequired: true
        });
      }
      try {
        if (this.supervisor.canSubmit()) {
          // #region agent log
          fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix-b',hypothesisId:'H140',location:'src/browser-controller.cjs:analyzeProductWithGpt',message:'analysis will submit this attempt',data:{attemptId:this.supervisor.checkpoint.attemptId,outputStatus:this.supervisor.checkpoint.outputStatus,recoveryCount:this.supervisor.checkpoint.recoveryCount},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
          this.supervisor.markSubmitted(this.supervisor.checkpoint.attemptId);
          ({ submission, watched } = await waitForAnalysis(page, {
            skipAttachments: this.supervisor.checkpoint.recoveryCount > 0
          }));
        } else {
          // #region agent log
          fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix-b',hypothesisId:'H140',location:'src/browser-controller.cjs:analyzeProductWithGpt',message:'analysis skipped submit (watch only)',data:{attemptId:this.supervisor.checkpoint.attemptId,submittedAt:this.supervisor.checkpoint.submittedAt,outputStatus:this.supervisor.checkpoint.outputStatus,recoveryCount:this.supervisor.checkpoint.recoveryCount},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
          watched = await this.#waitForAssistantTextObservation([], GENERATION_TIMEOUT_MS, page, {
            expectedCount: 0,
            maxDraftMs: GENERATION_TIMEOUT_MS,
            hardCapMs: GENERATION_TIMEOUT_MS,
            lagRetryMs: GENERATION_TIMEOUT_MS,
            stage: STAGE.GEMINI_ANALYSIS
          });
          submission = { page, conversationUrl: page?.url?.() || '' };
        }
      } catch (error) {
        const recoverable = [
          'MARKET_TAB_HIJACK', 'COMPOSER_NOT_FOUND', 'PREVIOUS_GENERATION_BUSY',
          'RATE_LIMIT', 'REQUEST_THROTTLED', 'BROWSER_CONTEXT_CLOSED',
          'AUTH_REQUIRED', 'CAPTCHA', 'CAPTCHA_OR_USER_ACTION', 'QUOTA_EXHAUSTED',
          'NETWORK_OFFLINE', 'GPT_RESPONSE_TIMEOUT'
        ];
        if (!recoverable.includes(error?.code)) throw error;
        watched = {
          text: '',
          decision: { action: 'retry', reason: error.code },
          observation: { phase: GEMINI_TEXT_PHASE.LAGGING, reason: error.code }
        };
        const caught = this.supervisor.observe({ error, watched });
        if (caught.action === SUPERVISOR_ACTION.PAUSE_USER) {
          throw Object.assign(error, { userActionRequired: true, retryable: false });
        }
        if (caught.action === SUPERVISOR_ACTION.WAIT) continue;
        this.supervisor.commit(caught);
        page = await this.#applySupervisorDecision(caught, { gptUrl, stalePage: page });
        this.supervisor.record(Boolean(page));
        continue;
      }
      if (analysisLooksReady(watched?.text)) {
        this.supervisor.observe({ analysisReady: true, outputReady: true });
        this.supervisor.commit({ action: SUPERVISOR_ACTION.ACCEPT, state: 'OUTPUT_READY', reason: 'output-ready' });
        this.supervisor.record(true);
        break;
      }
      const verdict = classifyGeminiDraft(watched?.text, {
        analysisReady: false,
        inProgress: watched?.observation?.phase === GEMINI_TEXT_PHASE.DRAFTING,
        rateLimited: ['RATE_LIMIT', 'REQUEST_THROTTLED'].includes(watched?.decision?.reason)
      });
      const submitted = Boolean(this.supervisor.checkpoint.submittedAt);
      const chromeNoise = verdict.behavior === 'chrome-noise' && !submitted;
      const imageMode = verdict.behavior === 'image-mode' && !submitted;
      let decision = watched?.supervisor || this.supervisor.observe({
        watched,
        submitted,
        chromeNoise,
        imageMode,
        generating: watched?.observation?.phase === GEMINI_TEXT_PHASE.DRAFTING || submitted,
        lastProgressAt: this.supervisor.checkpoint.lastProgressAt
      });
      const tabGone = !page || page.isClosed?.();
      if (
        submitted
        && !tabGone
        && [SUPERVISOR_ACTION.REPLACE_TAB, SUPERVISOR_ACTION.RELOAD_TAB].includes(decision.action)
        && decision.state !== 'BROWSER_DISCONNECTED'
        && decision.state !== 'TAB_CRASHED_OR_CLOSED'
      ) {
        decision = { action: SUPERVISOR_ACTION.WAIT, state: decision.state, reason: 'script-stay-until-result' };
      }
      // #region agent log
      fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix-b',hypothesisId:'H141',location:'src/browser-controller.cjs:analyzeProductWithGpt',message:'analysis recovery sample flags',data:{chromeNoise,imageMode,dead:verdict.dead,behavior:verdict.behavior,action:decision.action,state:decision.state,textLength:String(watched?.text||'').length,canSubmit:this.supervisor.canSubmit()},timestamp:Date.now()})}).catch(()=>{});
      fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix-c',hypothesisId:'H150',location:'src/browser-controller.cjs:analyzeProductWithGpt',message:'analysis script decision',data:{scriptStep:this.supervisor.checkpoint.scriptStep,action:decision.action,reason:decision.reason,state:decision.state,submitted,tabGone,stayedOnTab:decision.action==='WAIT',textLength:String(watched?.text||'').length},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      // #region agent log
      fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H120',location:'src/browser-controller.cjs:analyzeProductWithGpt',message:'browser supervisor classified analysis recovery',data:{state:decision.state,action:decision.action,reason:decision.reason,recoveryCount:this.supervisor.checkpoint.recoveryCount,attemptId:this.supervisor.checkpoint.attemptId,behavior:verdict.behavior,dead:verdict.dead,textLength:String(watched?.text||'').length,preview:String(watched?.text||'').slice(0,120)},timestamp:Date.now()})}).catch(()=>{});
      try { appendFileSync('/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )/.cursor/debug-d45d8d.log', `${JSON.stringify({ sessionId: 'd45d8d', runId: 'post-fix', hypothesisId: 'H120', location: 'src/browser-controller.cjs:analyzeProductWithGpt', message: 'browser supervisor classified analysis recovery', data: { state: decision.state, action: decision.action, reason: decision.reason, recoveryCount: this.supervisor.checkpoint.recoveryCount, attemptId: this.supervisor.checkpoint.attemptId, behavior: verdict.behavior, dead: verdict.dead, textLength: String(watched?.text || '').length }, timestamp: Date.now() })}\n`); } catch {}
      // #endregion
      if (decision.action === SUPERVISOR_ACTION.ACCEPT) break;
      if (decision.action === SUPERVISOR_ACTION.WAIT) continue;
      if (decision.action === SUPERVISOR_ACTION.PAUSE_USER) {
        throw Object.assign(new Error(`Gemini needs a user action (${decision.state}).`), {
          code: decision.state,
          retryable: false,
          userActionRequired: true
        });
      }
      if (decision.action === SUPERVISOR_ACTION.COOLDOWN) {
        this.supervisor.commit(decision);
        continue;
      }
      this.supervisor.commit(decision);
      this.emit('supervisor', this.supervisor.snapshot());
      // #region agent log
      fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H110',location:'src/browser-controller.cjs:analyzeProductWithGpt',message:'dead or lagged Gemini; recovering on a fresh text-gem tab',data:{attempt:this.supervisor.checkpoint.recoveryCount,maxRecoveries:null,behavior:verdict.behavior,dead:verdict.dead,reason:decision.reason||watched?.decision?.reason||'',textLength:String(watched?.text||'').length,preview:String(watched?.text||'').slice(0,120),action:decision.action,state:decision.state},timestamp:Date.now()})}).catch(()=>{});
      try { appendFileSync('/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )/.cursor/debug-d45d8d.log', `${JSON.stringify({ sessionId: 'd45d8d', runId: 'post-fix', hypothesisId: 'H110', location: 'src/browser-controller.cjs:analyzeProductWithGpt', message: 'dead or lagged Gemini; recovering on a fresh text-gem tab', data: { attempt: this.supervisor.checkpoint.recoveryCount, behavior: verdict.behavior, dead: verdict.dead, reason: decision.reason, action: decision.action, state: decision.state, textLength: String(watched?.text || '').length }, timestamp: Date.now() })}\n`); } catch {}
      // #endregion
      console.log(`[browser] Supervisor ${decision.state} → ${decision.action} (${decision.reason || 'recover'}).`);
      page = await this.#applySupervisorDecision(decision, { gptUrl, stalePage: page });
      this.supervisor.record(Boolean(page));
    }
    const responseText = String(watched?.text || '').trim();
    if (!analysisLooksReady(responseText)) {
      throw Object.assign(new Error(`${this.#serviceName(page)} did not return a usable analysis. It will keep recovering on the next attempt.`), {
        code: 'GPT_RESPONSE_TIMEOUT',
        retryable: true,
        observation: watched?.observation || null
      });
    }
    return {
      rawText: responseText,
      conversationUrl: submission.conversationUrl,
      mockups,
      promptReceipt: this.lastPromptReceipt
    };
  }

  async generatePromptsWithGpt({
    conversationUrl,
    pageCount,
    format,
    orientation,
    attachmentPaths = [],
    gptUrl = null,
    seed = '',
    title = '',
    theme = '',
    niche = '',
    visualTheme = '',
    productFormat = 'static',
    onBatch = null
  }) {
    if (this.engine !== 'gemini') {
      return this.withEngine('gemini', () => this.generatePromptsWithGpt({
        conversationUrl,
        pageCount,
        format,
        orientation,
        attachmentPaths,
        gptUrl,
        seed,
        title,
        theme,
        niche,
        visualTheme,
        productFormat,
        onBatch
      }));
    }
    if (conversationUrl && (!isGeminiPageUrl(conversationUrl) || isRetiredGeminiGemUrl(conversationUrl))) conversationUrl = null;
    this.beginWork();
    const filesToAttach = [...new Set((Array.isArray(attachmentPaths) ? attachmentPaths : []).filter((filePath) => filePath && existsSync(filePath)))];
    const total = Math.max(1, Math.min(500, Number.parseInt(pageCount, 10) || 20));
    const seedValue = seed || [title, theme, niche, productFormat].filter(Boolean).join(' | ');
    await this.#launchForPromptWork();
    const page = await this.ensurePage();
    await this.#afterNavigate(page);
    if (conversationUrl && jobPageNeedsNavigation(page.url(), conversationUrl, false)) {
      await page.goto(conversationUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
      await sleep(1_000);
      await this.#ensureLiveGeminiStudio(page, gptUrl || getJobStartUrl({ kind: 'prompts', productFormat }, this.engine));
    }

    let slots = new Array(total).fill(null);
    const rawParts = [];
    const batches = [];
    let conversation = conversationUrl;
    let batchSize = Math.min(PROMPT_BATCH_SIZE, total);
    let emptyRounds = 0;
    let round = 0;
    const maxRounds = Math.max(6, Math.ceil(total / 10) * 3);

    while (slots.includes(null) && round < maxRounds) {
      this.beginWork();
      const firstMissing = slots.findIndex((item) => !item) + 1;
      const have = slots.filter(Boolean).length;
      const endPage = Math.min(total, firstMissing + batchSize - 1);
      const batchCount = endPage - firstMissing + 1;
      const prompt = have === 0
        ? buildPromptsGenerationRequest(total, format, orientation, {
          startPage: firstMissing,
          endPage,
          alreadyHave: have,
          hasCompetitorMockups: filesToAttach.length > 0 && round === 0,
          seed: seedValue,
          title,
          theme,
          niche,
          visualTheme,
          productFormat
        })
        : buildPromptsContinuationRequest(total, format, orientation, {
          startPage: firstMissing,
          endPage,
          alreadyHave: have
        });
      const submission = await this.submitPrompt(prompt, {
        conversationUrl: conversation,
        gptUrl: gptUrl || getJobStartUrl({ kind: 'prompts', productFormat }, this.engine),
        attachmentPaths: round === 0 ? filesToAttach : [],
        requireAttachmentChips: round === 0 && filesToAttach.length > 0,
        promptKind: 'generate-prompts',
        reuseCurrentPage: round > 0
      });
      conversation = submission.conversationUrl || conversation;
      const watched = await this.#waitForAssistantTextObservation(submission.baseline, 240_000, page, {
        expectedCount: batchCount,
        startPage: firstMissing,
        endPage,
        batchSize,
        maxDraftMs: 10 * 60_000,
        hardCapMs: 10 * 60_000,
        onObservation: (obs) => {
          if (typeof onBatch === 'function') {
            onBatch({
              startPage: firstMissing,
              endPage,
              have,
              total,
              phase: obs.phase,
              reason: obs.reason,
              parsedCount: obs.parsedCount
            });
          }
        }
      });
      rawParts.push(watched.text || '');
      let parsed = [];
      try {
        parsed = parseGeneratedPrompts(watched.text || '', total, {
          startPage: 1,
          endPage: total,
          allowEmpty: true
        });
      } catch {
        parsed = [];
      }
      slots = mergeGeneratedPromptSlots(slots, parsed, { startPage: firstMissing, total });
      const after = slots.filter(Boolean).length;
      const phase = watched.observation?.phase || 'unknown';
      batches.push({
        startPage: firstMissing,
        endPage,
        have: after,
        total,
        phase,
        reason: watched.observation?.reason || watched.decision?.reason || ''
      });
      console.log(`[analysis] Content Gem prompt batch: pages ${firstMissing}–${endPage} (${after}/${total} saved) [${phase}].`);
      if (typeof onBatch === 'function') {
        onBatch({ startPage: firstMissing, endPage, have: after, total, phase, reason: watched.observation?.reason });
      }

      if (after === have) {
        emptyRounds += 1;
        if (watched.decision?.action === 'shrink' || phase === GEMINI_TEXT_PHASE.LAGGING || phase === GEMINI_TEXT_PHASE.FAILED) {
          batchSize = nextPromptBatchSize(batchSize);
          console.log(`[browser] Gemini lagged on a ${batchCount}-page request; retrying with ${batchSize}-page batches.`);
        }
        if (emptyRounds >= 3 && batchSize <= 10) break;
      } else {
        emptyRounds = 0;
        await this.#persistLoginStateThrottled('gemini', 45_000);
        if (after - have >= batchCount && batchSize < PROMPT_BATCH_SIZE) {
          batchSize = Math.min(PROMPT_BATCH_SIZE, batchSize * 2);
        }
      }
      round += 1;
    }

    const prompts = densePromptPrefix(slots);
    if (!prompts.length) {
      throw Object.assign(new Error('The Content Gem did not finish drafting page prompts. Generate prompts again.'), {
        code: 'PROMPTS_NOT_PARSED'
      });
    }
    if (prompts.length < total) {
      console.warn(`[browser] Gemini finished with ${prompts.length} of ${total} page prompts after ${round} watched batches.`);
    }
    return {
      rawText: rawParts.filter(Boolean).join('\n\n'),
      conversationUrl: conversation,
      prompts,
      batches
    };
  }
  async generateTptThumbnailsWithGpt({ project, pdfPath, listing, onThumbnail = null, thumbnailIndex = null, gptUrl = null }) {
    await this.launch({ headless: true });
    const results = [];
    gptUrl = gptUrl || getJobStartUrl({ kind: 'thumbnail' }, this.engine);
    // The compiled .docx is the only thing attached. Raw page PNGs used to be, which
    // does not survive a real book: a 100-200 page pack is hundreds of megabytes of
    // images and blows the context limit long before it reaches the model. The document
    // carries the same ground truth - title, grade level, curriculum, interior wording,
    // page count - in a few hundred kilobytes of text.
    const sourceDocument = pdfPath && existsSync(pdfPath) ? pdfPath : null;
    if (!sourceDocument) {
      throw Object.assign(
        new Error('Mockups are written from the compiled book document, which is missing.'),
        { code: 'MOCKUP_SOURCE_MISSING' }
      );
    }
    if (!/\.docx$/i.test(sourceDocument)) {
      // A PDF cannot be read into mockup frames by the image model, and an image
      // attachment is what this change exists to remove. Fail loudly rather than
      // silently going back to guessing from the title.
      throw Object.assign(
        new Error(`Mockups require the compiled .docx, received ${basename(sourceDocument)}.`),
        { code: 'MOCKUP_SOURCE_NOT_DOCX' }
      );
    }

    const mockupWaitOpts = {
      pendingReadyMs: 8_000,
      settleMs: 2_000,
      pollMs: 1_000
    };

    for (let index = 0; index < 4; index += 1) {
      this.#throwIfCancelled();
      if (thumbnailIndex !== null && index !== thumbnailIndex) continue;
      if (listing.thumbnailPaths?.[index]) continue;

      const jobId = `tpt-thumbnail-${project.id}-${index}`;
      const brief = listing.thumbnailBriefs?.[index] || `Show a clear benefit of ${listing.seo?.title || listing.title || project.name}.`;
      const prompt = withEngineImagePrefix(buildTptThumbnailImagePrompt({
        index,
        title: listing.seo?.title || listing.title || project.name || '',
        brief
      }), this.engine, { purpose: 'thumbnail' });

      // One attachment, every time: the book itself.
      const attachments = [sourceDocument];

      if (!attachments.length) {
        throw Object.assign(new Error('Attach the finished book as page images or a Word document. Gemini cannot use the PDF for mockups.'), {
          code: 'THUMBNAIL_PAGES_MISSING'
        });
      }

      const submitOptions = {
        jobId,
        isolatedPage: true,
        conversationUrl: null,
        attachmentPaths: attachments,
        gptUrl,
        promptKind: 'thumbnail',
        attachBeforePrompt: true,
        requireAttachmentChips: true
      };

      let submission = await this.submitPrompt(prompt, submitOptions);
      let image;
      try {
        image = await this.waitForNewImage(submission.baseline, 600_000, { jobId, ...mockupWaitOpts });
      } catch (error) {
        const retryable = ['GENERATION_ERROR', 'REFERENCE_REQUESTED_BY_GPT', 'IMAGE_TIMEOUT'].includes(error?.code);
        if (!retryable) throw error;
        // Same conversation: nudge Gemini/ChatGPT to draw instead of chatting.
        const retryPrompt = withEngineImagePrefix(buildTptThumbnailRetryPrompt({ index }), this.engine, { purpose: 'thumbnail' });
        submission = await this.submitPrompt(retryPrompt, {
          jobId,
          conversationUrl: submission.conversationUrl,
          promptKind: 'thumbnail',
          attachBeforePrompt: false,
          requireAttachmentChips: false
        });
        image = await this.waitForNewImage(submission.baseline, 600_000, { jobId, ...mockupWaitOpts });
      }
      const downloaded = await this.fetchImage(image.src, { jobId });

      const currentConversationUrl = image.conversationUrl || submission.conversationUrl;
      results.push({ buffer: downloaded.buffer, conversationUrl: currentConversationUrl });
      if (onThumbnail) await onThumbnail({ index, buffer: downloaded.buffer, conversationUrl: currentConversationUrl });
      await this.releaseJob(jobId);
    }

    const lastUrl = results[results.length - 1]?.conversationUrl || null;
    return { thumbnails: results, conversationUrl: lastUrl };
  }

  async generateTptPreviewVideoWithGpt({
    project,
    gptUrl = null,
    clipIndex = 0,
    clipCount = 1,
    clipSeconds = 8
  }) {
    const previousEngine = this.engine;
    this.setEngine('gemini');
    const clips = Math.max(1, Number(clipCount) || 1);
    const index = Math.max(0, Number(clipIndex) || 0);
    const seconds = Math.max(1, Number(clipSeconds) || 8);
    const jobId = clips > 1
      ? `tpt-preview-${project.id}-clip-${index + 1}`
      : `tpt-preview-${project.id}`;
    gptUrl = gptUrl || getJobStartUrl({ kind: 'preview' }, 'gemini');
    // Page images, not the document. Gemini's video model cannot read a .docx: given one
    // it has nothing to animate and sits in analysis until the step times out. The
    // mockup gem is the opposite and reads the document, so the two are fed differently.
    //
    // Five to eight interior pages, sampled across the middle of the book. The cover and
    // the thank-you page are deliberately not among them - see selectPreviewFramePaths.
    const frames = listingFileHelpers().selectPreviewFramePaths(project?.jobs);
    if (!frames.length) {
      throw Object.assign(
        new Error('The preview video needs finished interior pages to animate — the cover and thank-you page are not enough.'),
        { code: 'PREVIEW_FRAMES_MISSING' }
      );
    }
    // Nothing else goes up. Not the compiled document, and not the watermark: the gem
    // treats every upload as a product page, so the tile could be animated as if it were
    // one. It lives in the gem's knowledge base and is applied from there.
    const attachments = [...frames];
    const prompt = buildTptPreviewVideoPrompt({
      clipIndex: index,
      clipCount: clips,
      clipSeconds: seconds
    });
    try {
      await this.launch({ headless: true, forceBrowser: true });
      // The browser can die between launching and submitting - it did, mid-render, and
      // the step then failed with a stale handle. One clean recovery and retry here is
      // the difference between losing the run and continuing it.
      const submit = () => this.submitPrompt(prompt, {
        jobId,
        isolatedPage: true,
        conversationUrl: null,
        attachmentPaths: attachments,
        gptUrl,
        promptKind: 'preview-video',
        attachBeforePrompt: true,
        requireAttachmentChips: true
      });
      let submission;
      try {
        submission = await submit();
      } catch (error) {
        if (!BrowserController.isDeadBrowserError(error)) throw error;
        await this.#recoverManagedBrowser(`preview submit: ${error.message.slice(0, 80)}`);
        await this.launch({ headless: true, forceBrowser: true });
        submission = await submit();
      }
      // Veo 3 routinely runs past fifteen minutes. The ceiling is generous and the real
      // stop is inactivity: while the page still shows it generating, waiting continues.
      const video = await this.waitForNewVideo(submission.baseline, PREVIEW_VIDEO_TIMEOUT_MS, {
        jobId,
        idleTimeoutMs: PREVIEW_VIDEO_IDLE_TIMEOUT_MS
      });
      const downloaded = await this.fetchVideo(video.src, { jobId });
      return {
        buffer: downloaded.buffer,
        contentType: downloaded.contentType || 'video/mp4',
        conversationUrl: video.conversationUrl || submission.conversationUrl,
        attachmentCount: attachments.length
      };
    } finally {
      await this.releaseJob(jobId).catch(() => {});
      this.setEngine(previousEngine);
    }
  }
  async generateStorybookBlueprintWithGpt(input) {
    if (this.engine !== 'gemini') {
      return this.withEngine('gemini', () => this.generateStorybookBlueprintWithGpt(input));
    }
    const {
      buildStorybookBlueprintPrompt,
      parseStorybookBlueprintResponse
    } = require('./prompt-builder.cjs');

    const prompt1 = buildStorybookBlueprintPrompt(input);
    await this.launch({ headless: true });
    const page = await this.ensurePage();
    await this.#afterNavigate(page);
    await page.goto(getJobStartUrl({ kind: 'blueprint' }, this.engine), { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await sleep(1_000);

    // The original photo is deliberately not attached to the planning chat. It is
    // attached only to the first character's isolated image-generation chat.
    const submission1 = await this.submitPrompt(prompt1);
    const responseText1 = await this.waitForAssistantTextResponse(submission1.baseline, 300_000, page);
    const parsed1 = parseStorybookBlueprintResponse(responseText1);

    return {
      rawText: responseText1,
      conversationUrl: page.url() || submission1.conversationUrl,
      parsed: parsed1
    };
  }

  async generateStorybookCharactersWithGpt({ input = {}, conversationUrl, reuseCurrentPage = false }) {
    if (this.engine !== 'gemini') {
      return this.withEngine('gemini', () => this.generateStorybookCharactersWithGpt({ input, conversationUrl, reuseCurrentPage }));
    }
    if (conversationUrl && !isGeminiPageUrl(conversationUrl)) {
      throw Object.assign(new Error('Storybook planning now uses the Gemini custom gem. Start a new storybook so Gemini can write the prompts.'), {
        code: 'GEMINI_PLANNING_REQUIRED'
      });
    }
    const {
      buildStorybookCharactersPrompt,
      parseStorybookCharactersResponse
    } = require('./prompt-builder.cjs');

    if (!isPersistedConversationUrl(conversationUrl)) {
      throw Object.assign(new Error('The saved Storybook conversation URL is missing.'), { code: 'CONVERSATION_URL_REQUIRED' });
    }
    await this.launch({ headless: true });
    const page = await this.ensurePage();
    await this.#afterNavigate(page);
    if (!reuseCurrentPage || page.url() !== conversationUrl) {
      await page.goto(conversationUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
      await sleep(1_000);
    }

    const prompt2 = buildStorybookCharactersPrompt(input);
    const submission2 = await this.submitPrompt(prompt2);
    const responseText2 = await this.waitForAssistantTextResponse(submission2.baseline, 300_000, page);
    let parsed2;
    let finalRawText = responseText2;
    try {
      parsed2 = parseStorybookCharactersResponse(responseText2);
    } catch (error) {
      if (error.code !== 'STORYBOOK_PARSING_FAILED') throw error;
      const repairPrompt = [
        'CORRECTION REQUIRED: Your previous response could not be imported because it did not contain the required character JSON.',
        'Return ONLY the valid character JSON object requested below. Do not include pages, covers, images, or commentary.',
        '',
        prompt2
      ].join('\n');
      const repairSubmission = await this.submitPrompt(repairPrompt);
      const repairResponse = await this.waitForAssistantTextResponse(repairSubmission.baseline, 300_000, page);
      try {
        parsed2 = parseStorybookCharactersResponse(repairResponse);
      } catch (repairError) {
        repairError.responsePreview = String(repairResponse || responseText2).replace(/\s+/g, ' ').trim().slice(0, 500);
        throw repairError;
      }
      finalRawText = `${responseText2}\n\n--- AUTOMATIC REPAIR RESPONSE ---\n\n${repairResponse}`;
    }

    return {
      rawText: finalRawText,
      conversationUrl: page.url() || submission2.conversationUrl,
      parsed: parsed2
    };
  }

  async generateStorybookPagesWithGpt({ input = {}, conversationUrl, reuseCurrentPage = false }) {
    if (this.engine !== 'gemini') {
      return this.withEngine('gemini', () => this.generateStorybookPagesWithGpt({ input, conversationUrl, reuseCurrentPage }));
    }
    if (conversationUrl && !isGeminiPageUrl(conversationUrl)) {
      throw Object.assign(new Error('Storybook planning now uses the Gemini custom gem. Start a new storybook so Gemini can write the prompts.'), {
        code: 'GEMINI_PLANNING_REQUIRED'
      });
    }
    const {
      buildStorybookPagesPrompt,
      parseStorybookPagesResponse
    } = require('./prompt-builder.cjs');

    if (!isPersistedConversationUrl(conversationUrl)) {
      throw Object.assign(new Error('The saved Storybook conversation URL is missing.'), { code: 'CONVERSATION_URL_REQUIRED' });
    }
    await this.launch({ headless: true });
    const page = await this.ensurePage();
    await this.#afterNavigate(page);
    if (!reuseCurrentPage || page.url() !== conversationUrl) {
      await page.goto(conversationUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
      await sleep(1_000);
    }

    const prompt = buildStorybookPagesPrompt(input);
    const submission = await this.submitPrompt(prompt);
    const responseText = await this.waitForAssistantTextResponse(submission.baseline, 300_000, page);
    let parsed;
    let finalRawText = responseText;
    const parseOptions = {
      pageCount: input.pageCount,
      approvedExactText: input.approvedExactText,
      frontCoverFallback: input.frontCover
    };
    try {
      parsed = parseStorybookPagesResponse(responseText, parseOptions);
    } catch (error) {
      if (error.code !== 'STORYBOOK_PARSING_FAILED') throw error;
      const expectedLines = [
        'FRONT COVER | <complete front-cover prompt>',
        ...Array.from({ length: Math.max(1, Number.parseInt(input.pageCount, 10) || 10) }, (_, index) => `PAGE ${index + 1} | <complete prompt for Page ${index + 1}>`),
        'BACK COVER | <complete back-cover prompt>'
      ];
      const repairPrompt = [
        'REFORMAT ONLY: The previous answer contains useful book prompts, but its formatting could not be imported.',
        'Keep every existing prompt and exact story text. Do not rewrite, shorten, summarize, translate, or explain them.',
        'Do NOT return JSON, Markdown, a code fence, headings, blank lines, or commentary.',
        'Return exactly these labeled physical lines, with one complete prompt after each | marker:',
        '',
        ...expectedLines,
        '',
        `Return exactly ${expectedLines.length} non-empty lines. Never split one prompt across multiple lines.`
      ].join('\n');
      const repairSubmission = await this.submitPrompt(repairPrompt);
      const repairResponse = await this.waitForAssistantTextResponse(repairSubmission.baseline, 300_000, page);
      try {
        parsed = parseStorybookPagesResponse(repairResponse, parseOptions);
      } catch (repairError) {
        repairError.responsePreview = String(repairResponse || responseText).replace(/\s+/g, ' ').trim().slice(0, 500);
        throw repairError;
      }
      finalRawText = `${responseText}\n\n--- AUTOMATIC REPAIR RESPONSE ---\n\n${repairResponse}`;
    }

    return {
      rawText: finalRawText,
      conversationUrl: page.url() || submission.conversationUrl,
      parsed
    };
  }

  // Backward-compatible names for callers outside the desktop workflow.
  async generateStorybookPhase1WithGpt(input) {
    return this.generateStorybookBlueprintWithGpt(input);
  }

  async generateStorybookPhase2WithGpt({ input = {}, conversationUrl, reuseCurrentPage = false }) {
    return this.generateStorybookPagesWithGpt({ input, conversationUrl, reuseCurrentPage });
  }

  async generateStorybookWithGpt(input) {
    const blueprint = await this.generateStorybookBlueprintWithGpt(input);
    const characters = await this.generateStorybookCharactersWithGpt({
      input: { ...input, blueprint: blueprint.parsed.blueprint },
      conversationUrl: blueprint.conversationUrl,
      reuseCurrentPage: true
    });
    return {
      rawText: `${blueprint.rawText}\n\n${characters.rawText}`,
      conversationUrl: characters.conversationUrl,
      parsed: { ...blueprint.parsed, ...characters.parsed }
    };
  }

  async generateCharacterSheetWithGpt({ projectId, characterId, characterIndex, characterName, prompt, attachmentPath = null, gptUrl = null }) {
    const jobId = `storybook-character-${projectId}-${characterId ?? characterIndex}`;
    gptUrl = gptUrl || getJobStartUrl({ kind: 'character_sheet' }, this.engine);
    const generationPrompt = withEngineImagePrefix([
      prompt,
      '',
      ...(attachmentPath ? [
        'Use the attached real-person photo as the identity reference for this main story character.',
        'Transform that same person into the requested polished cartoon/storybook hero while preserving recognizable facial features, hair, skin tone, age cues, and overall identity. Replace the photo background and clothing only as required by the character prompt.',
        ''
      ] : []),
      `Generate the image now as a professional character reference sheet for ${characterName}.`,
      'Show one consistent full-body turnaround/reference composition on a clean neutral background.',
      'Do not add story text, labels, logos, borders, mockups, or watermarks.'
    ].join('\n'), this.engine);
    try {
      const submission = await this.submitPrompt(generationPrompt, {
        jobId,
        isolatedPage: true,
        attachmentPath,
        gptUrl,
        promptKind: 'character_sheet'
      });
      const image = await this.waitForNewImage(submission.baseline, 600_000, { jobId });
      const downloaded = await this.fetchImage(image.src, { jobId });
      return {
        ...downloaded,
        conversationUrl: image.conversationUrl || submission.conversationUrl
      };
    } finally {
      await this.releaseJob(jobId).catch(() => {});
    }
  }

  async abortJob(jobId) {
    const page = this.jobPages.get(jobId) || this.preparedJobs.get(jobId)?.page;
    this.jobPages.delete(jobId);
    this.preparedJobs.delete(jobId);
    if (page && !page.isClosed()) await page.close({ runBeforeUnload: false }).catch(() => {});
  }

  async releaseJob(jobId) {
    this.jobPages.delete(jobId);
    this.preparedJobs.delete(jobId);
  }

  async #setDiskFilesOnPage(page, paths, { handle = null, locator = null } = {}) {
    const files = localUploadFiles(paths);
    if (!files.length) {
      throw Object.assign(new Error('No local files were available to upload.'), { code: 'UPLOAD_FILES_MISSING' });
    }
    const target = handle || (locator ? await locator.elementHandle({ timeout: 8_000 }).catch(() => null) : null);
    if (!target) {
      throw Object.assign(new Error('The file picker was not found.'), { code: 'FILE_INPUT_NOT_FOUND' });
    }
    const marker = `versa-upload-${randomUUID()}`;
    await target.evaluate((el, id) => {
      if (el && el.setAttribute) el.setAttribute('data-versa-upload', id);
    }, marker);
    const applyViaPlaywright = async () => {
      if (locator && typeof locator.setInputFiles === 'function') {
        await locator.setInputFiles(files, { timeout: 20_000 });
        return;
      }
      if (typeof target.setInputFiles === 'function') {
        await target.setInputFiles(files, { timeout: 20_000 });
        return;
      }
      throw Object.assign(new Error('The file picker was not found in the page.'), { code: 'FILE_INPUT_NOT_FOUND' });
    };
    const context = typeof page.context === 'function' ? page.context() : this.context;
    const session = context ? await context.newCDPSession(page).catch(() => null) : null;
    try {
      if (!session) {
        await applyViaPlaywright();
        return;
      }
      await session.send('DOM.enable').catch(() => {});
      await session.send('Runtime.enable').catch(() => {});
      const search = await session.send('DOM.performSearch', {
        query: `[data-versa-upload="${marker}"]`,
        includeUserAgentShadowDOM: true
      }).catch(() => null);
      const count = Number(search?.resultCount || 0);
      if (count && search?.searchId) {
        const { nodeIds } = await session.send('DOM.getSearchResults', {
          searchId: search.searchId,
          fromIndex: 0,
          toIndex: count
        });
        await session.send('DOM.discardSearchResults', { searchId: search.searchId }).catch(() => {});
        const nodeId = nodeIds?.[0];
        if (nodeId) {
          await session.send('DOM.setFileInputFiles', { files, nodeId });
          return;
        }
      }
      await applyViaPlaywright();
    } finally {
      if (session) await session.detach().catch(() => {});
      await target.evaluate((el) => el.removeAttribute?.('data-versa-upload')).catch(() => {});
    }
  }

  async close() {
    this.cancelWaits();
    this.interactiveVisible = false;
    this._watchersBound = null;
    this.browserPid = null;
    this._returnedAppFocus = false;
    this.#stopHideDaemon();
    this.#stopParkHeartbeat();
    if (this._parkTimer) {
      clearTimeout(this._parkTimer);
      this._parkTimer = null;
    }
    await this.closeLoginBrowser();
    const tptVerification = this.tptHumanVerification;
    if (tptVerification) {
      tptVerification.reject(Object.assign(new Error('TPT human verification was cancelled because the browser session closed.'), {
        code: 'TPT_VERIFICATION_CANCELLED'
      }));
      const ownerPid = profileLockOwnerPid(this.profileDir);
      const processIds = new Set([tptVerification.process?.pid, ownerPid].filter((pid) => Number.isInteger(pid) && pid > 0));
      for (const pid of processIds) {
        try {
          process.kill(pid, 'SIGTERM');
        } catch (error) {
          if (error?.code !== 'ESRCH') throw error;
        }
      }
      this.tptHumanVerification = null;
    }
    const cdpBrowser = this.cdpBrowser;
    this.cdpBrowser = null;
    if (this.context) await this.context.close().catch(() => {});
    if (cdpBrowser) await cdpBrowser.close().catch(() => {});
    const guard = this.activationGuard;
    this.activationGuard = null;
    if (guard) await guard.close().catch(() => {});
    this.context = null;
    this.page = null;
    this.tptUploadPage = null;
    this.tptUploadPages.clear();
    this.jobPages.clear();
    this.preparedJobs.clear();
    this.headless = null;
  }
}

module.exports = {
  BrowserController,
  AUTH_COOKIE_HOST_SQL,
  installedBrowserCandidates,
  resolveInstalledBrowser,
  CHATGPT_URL,
  GEMINI_URL,
  COMPOSER_SELECTORS,
  GEMINI_ATTACH_SELECTORS,
  GEMINI_IMAGE_MODE_NAME,
  IMAGE_SELECTORS,
  GPT_IMAGE_SELECTORS,
  collectChatGptImageCandidatesInBrowser,
  pickBestNewAssistantImage,
  GENERATION_PROGRESS_PATTERNS,
  META_SUBMIT_SELECTORS,
  RATE_LIMIT_PATTERNS,
  REQUEST_THROTTLE_PATTERNS,
  SUBMIT_SELECTORS,
  TPT_FILE_LIMITS,
  TPT_FORM_SELECTORS,
  TPT_METADATA_PICKER_OPTIONS,
  TPT_MY_PRODUCTS_URL,
  TPT_NEW_PRODUCT_URL,
  backupCookieDatabase,
  assessTptPreparedForm,
  clearTptMultiSearchWhenNeeded,
  confirmedTptMetadataSelection,
  classifyNoticeText,
  clearStaleProfileLocks,
  chromeAppBundleFromExecutable,
  managedChromeLaunchArgs,
  filterAuthCookies,
  isTptLoginPage,
  isChatHomeUrl,
  isPersistedConversationUrl,
  isNewAssistantImage,
  jobPageNeedsNavigation,
  launchSystemLoginBrowser,
  localUploadFiles,
  managedBrowserOptions,
  mergeTptCookies,
  mergePreservedSessionCookies,
  countSentAttachmentsInBrowser,
  countComposerAttachmentChipsInBrowser,
  imageMimeType,
  isThumbnailUploadStall,
  REFERENCE_REQUEST_PATTERNS,
  normalizeTptMetadataChoice,
  normalizeTptGrade,
  normalizeTptProductTitle,
  profileLockOwnerPid,
  readTptSessionState,
  readManagedLoginState,
  verifyServiceUrl,
  isServiceSignInUrl,
  resolveTptListingCard,
  shouldWaitForImageBeforeThrottle,
  systemLoginArgs,
  chooseTptMetadataOption,
  tptMetadataChoiceMatches,
  tptMetadataOptionIsSelectable,
  tptCheckboxStateMatches,
  tptTagSearchCandidates,
  tptFileUploadWaitPolicy,
  tptSelectedFileMatches,
  isTptCloudflareChallengeText,
  tptHumanVerificationArgs,
  waitForTptUploadCompletion,
  waitForReferenceImageUpload,
  waitForTptMetadataSelection,
  waitForTptSubmissionOutcome
};
