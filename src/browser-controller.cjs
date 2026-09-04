const { EventEmitter } = require('node:events');
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
const { chromium } = require('playwright-core');
const {
  buildAnalysisPrompt,
  buildPromptsGenerationRequest,
  buildTptListingPrompt,
  buildTptListingTaxonomyCorrectionPrompt,
  buildTptThumbnailImagePrompt,
  buildTptThumbnailRetryPrompt,
  buildTptPreviewVideoPrompt
} = require('./prompt-builder.cjs');
const {
  CHATGPT_URL,
  GEMINI_URL,
  CONTENT_GPT_URL,
  CONTENT_GEM_URL,
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
const { selectPreviewAttachmentPaths, collectProductPageImagePaths, stageThumbnailPageTargets, selectMockupAttachmentPaths, isRejectedMockupAttachment, writeImagesDocx } = require('./file-manager.cjs');
const {
  CANVA_HOME_URL,
  canvaDesignId,
  canvaPageDimensions,
  canvaTemplateLinkFromShare,
  inferCanvaEditorPageCount,
  looksLikeLeftoverCanvaCount,
  isCanvaDesignUrl,
  isCanvaLoginUrl,
  isCanvaPageUrl,
  isCanvaTemplateLink,
  sameCanvaDesign,
  toCanvaDesignUrl,
  toCanvaTemplateLink
} = require('./canva-bulk.cjs');
const {
  CanvaJobState,
  explainWait,
  isPdfUploadNetworkUrl,
  isCanvaDesignCreateNetworkUrl,
  isPdfImportOpenDesignStage,
  isPdfUploadPickerWaiting,
  isPdfUploadEvidence,
  isPdfUploadTraffic,
  decideWaitOutcome,
  decideImportRecovery,
  decideRecovery,
  normalizeCanvaProgressArgs,
  decideHumanLoopExit,
  buildFailureSnapshot,
  summarizeHealth,
  enrichPageProgress,
  shouldReuseCanvaDesign,
  isMagicLayerControlMissing
} = require('./canva-job-state.cjs');
const {
  isUnsafeCanvaUploadClick,
  scoreCanvaPdfFileInput,
  pickBestCanvaPdfFileInput,
  scoreCanvaUploadFileInput,
  pickBestCanvaUploadFileInput,
  isRealCanvaPdfUploadInput,
  REAL_CANVA_PDF_INPUT_SCORE,
  emptyCanvaPdfUploadState,
  summarizeCanvaPdfUploadText,
  isCanvaPdfTransferSuccess,
  shouldSkipCanvaPdfInject,
  matchingCanvaPdfName,
  pickCanvaPdfOpenClick,
  canvaPdfImportTickMessage
} = require('./canva-pdf-inject.cjs');
const {
  collectMockupUrlsInBrowser,
  competitorMockupPaths,
  downloadListingMockups,
  emptyMockupResult,
  extractListingMockupUrls,
  extractPageCountFromTptHtml,
  isCloudflareChallengeHtml,
  isTptProductUrl,
  parseTptProductUrl,
  resolveListingAnalysisInput,
  shouldCaptureListingMockups
} = require('./tpt-listing-mockups.cjs');

const TPT_NEW_PRODUCT_URL = 'https://www.teacherspayteachers.com/My-Products/New/Digital-Next';
const TPT_MY_PRODUCTS_URL = 'https://www.teacherspayteachers.com/My-Products';

function formatCanvaClock(ms) {
  const total = Math.max(0, Math.floor(Number(ms) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function formatCanvaBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

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

function canvaDashboardPatch(step, extra = {}) {
  return {
    dashboard: {
      step,
      updatedAt: Date.now(),
      ...extra
    }
  };
}

const CANVA_UPLOAD_TIMEOUT_MS = 10 * 60_000;
const CANVA_UPLOAD_IDLE_MS = 40_000;
const CANVA_UPLOAD_START_MS = 18_000;
const CANVA_WRONG_DESIGN_IDLE_MS = 28_000;
const CANVA_HOME_OPEN_DESIGN_MS = 12_000;
const CANVA_HOME_IMPORT_FAIL_MS = 70_000;
const CANVA_UPLOADS_FOLDER_URL = 'https://www.canva.com/folder/_uploads';
const CANVA_PROJECTS_URL = 'https://www.canva.com/projects';

function canvaPdfImportTimeoutMs(expectedPages) {
  const pages = Math.max(1, Number(expectedPages) || 1);
  return Math.min(20 * 60_000, Math.max(4 * 60_000, pages * 12_000));
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
  '.response-container-header-processing-state',
  'chat-app [aria-busy="true"]'
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
      message: 'This ChatGPT account reached its usage limit. The queue paused without skipping the page.'
    };
  }
  return null;
}

const AUTH_TEXT_PATTERN = /log in to continue|sign in to continue|تسجيل الدخول للمتابعة|connectez-vous pour continuer/i;
const PASSIVE_STATE_CHECK_INTERVAL_MS = 2_000;

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
  if (!image || image.width < 256 || image.height < 256) return false;
  if (image.fromUserTurn || image.inComposer) return false;
  if (knownSignatures?.has(image.signature)) return false;
  if (!Number.isInteger(assistantBaselineCount) || assistantBaselineCount < 0) return true;
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
  const assistantSel = 'model-response, response-container, chat-app message-content, .message-content, [data-turn="assistant"]';
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
    'img[src*="lh3.googleusercontent.com"]'
  ];
  const assistantMessages = [...document.querySelectorAll(assistantSel)];
  const seen = new Set();
  const results = [];
  const consider = (image) => {
    if (!image) return;
    if (image.closest('user-profile-picture') || image.classList?.contains('user-icon')) return;
    if (image.closest('form') && !image.closest(assistantSel)) return;
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
    results.push({
      signature,
      src: raw,
      alt: image.getAttribute('alt') || '',
      slot: '',
      generatedHint: /blob:|data:image|googleusercontent|generated image|imagen/i.test(`${raw} ${image.getAttribute('alt') || ''}`)
        || Boolean(image.closest('generated-image, single-image, image-viewer, model-response, response-container')),
      fromUserTurn: false,
      inComposer: false,
      assistantIndex: assistantMessage ? assistantMessages.indexOf(assistantMessage) : -1,
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
  const assistantSel = '[data-message-author-role="assistant"], [data-turn="assistant"], model-response, response-container, .message-content';
  const userSel = '[data-message-author-role="user"], [data-turn="user"], user-query';
  const surfaceSel = '[data-testid="image-gen-card"], [data-testid*="image-gen"], div[id^="image-"], generated-image, single-image, image-viewer, model-response, div[data-pressable-container="true"]';
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
    if (canvas.width < 256 || canvas.height < 256) return null;
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
    if (canvas.width >= 256 && canvas.height >= 256) {
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
  pollIntervalMs = 500,
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
  args.push(String(engine).toLowerCase() === 'canva' ? CANVA_HOME_URL : getEngineHomeUrl(engine));
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
  OR lower(host_key) = 'canva.com'
  OR lower(host_key) LIKE '%.canva.com'
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
  const empty = { chatgpt: false, gemini: false, meta: false, canva: false };
  const fromFiles = {
    chatgpt: savedLoginFileHasCookies(profileDir, 'chatgpt'),
    gemini: savedLoginFileHasCookies(profileDir, 'gemini'),
    meta: savedLoginFileHasCookies(profileDir, 'meta'),
    canva: savedLoginFileHasCookies(profileDir, 'canva')
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
        OR lower(host_key) LIKE '%canva.com'
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
    const canva = rows.some((row) => hasPayload(row)
      && /canva\.com/i.test(host(row))
      && (/^(CAE|CACL|access|session|auth|login)/i.test(name(row)) || Number(row.encrypted_length) > 20));
    return {
      chatgpt: chatgpt || fromFiles.chatgpt,
      gemini: gemini || fromFiles.gemini,
      meta: meta || fromFiles.meta,
      canva: canva || fromFiles.canva
    };
  } catch {
    return { ...empty, ...fromFiles };
  } finally {
    try { database?.close(); } catch {}
  }
}

function cookieHostExcludeSql(service) {
  const value = String(service || '').trim().toLowerCase();
  if (value === 'canva') {
    return "lower(host_key) = 'canva.com' OR lower(host_key) LIKE '%.canva.com'";
  }
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

function usesCanvaAuthentication(forceTarget, pageUrl = '') {
  const raw = String(engineTarget(forceTarget) || '').trim().toLowerCase();
  if (raw === 'canva') return true;
  if (raw === 'gemini' || raw === 'chatgpt' || raw === 'meta') return false;
  return isCanvaPageUrl(pageUrl);
}

function verifyServiceUrl(engine) {
  const raw = String(engine || '').trim().toLowerCase();
  if (raw === 'canva') return CANVA_HOME_URL;
  const kind = normalizeEngine(engine);
  if (kind === 'chatgpt') return CHATGPT_URL;
  if (kind === 'meta') return META_URL;
  return GEMINI_URL;
}

function isServiceSignInUrl(url, engine) {
  const value = String(url || '');
  if (engine === 'canva') return isCanvaLoginUrl(value);
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

class BrowserController extends EventEmitter {
  constructor({ profileDir, downloadDir, getMetaConfig = null }) {
    super();
    this.profileDir = profileDir;
    this.downloadDir = downloadDir;
    this.getMetaConfig = typeof getMetaConfig === 'function' ? getMetaConfig : () => ({});
    this.context = null;
    this.page = null;
    this.canvaPage = null;
    this.canvaPdfAttachedOnce = false;
    this.canvaJob = null;
    this.humanPaused = false;
    this.humanDecision = null;
    this.humanObserveRequested = false;
    this.humanIntervention = null;
    this.canvaHumanEnabled = false;
    this.canvaControl = { retryStep: false, retryPage: false, resumeFromPage: null, abortSafely: false };
    this._canvaOnProgress = null;
    this.canvaDiagnosticsDir = null;
    this.canvaConsoleErrors = [];
    this._canvaLiveFrameTimer = null;
    this.tptUploadPage = null;
    this.tptUploadPages = new Map();
    this.jobPages = new Map();
    this.preparedJobs = new Map();
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
    this.activeProfile = null;
    this.interactiveVisible = false;
    this.canvaWatch = false;
    this.canvaBackgroundLock = false;
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
  }

  setEngine(engine) {
    const next = normalizeEngine(engine);
    if (next !== this.engine) this.preparedJobs.clear();
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
    } catch {
      // Cookie snapshot is best-effort; the persistent Chrome profile is the source of truth.
    }
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
    if (process.platform !== 'darwin' || this.interactiveVisible || this.canvaWatch || this.skipWindowChrome) return;
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
    if (this.interactiveVisible || this.canvaWatch || this.skipWindowChrome) return;
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
    if (this._parkHeartbeat || this.interactiveVisible || this.canvaWatch) return;
    this._parkHeartbeat = setInterval(() => {
      if (this.interactiveVisible || this.canvaWatch || !this.context) {
        this.#stopParkHeartbeat();
        return;
      }
      const pid = this.#managedChromePid();
      if (Number.isInteger(pid) && pid > 0) jxaChromeVisibility(pid, false);
    }, 2_000);
    this._parkHeartbeat.unref?.();
  }

  #schedulePark() {
    if (this.interactiveVisible || this.canvaWatch) return;
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
    if (!this.interactiveVisible && !this.canvaWatch) this.#hideManagedChrome();
    context.on('page', () => {
      if (!this.interactiveVisible && !this.canvaWatch) this.#hideManagedChrome();
    });
  }

  async #parkWindow() {
    if (this.interactiveVisible || this.canvaWatch || !this.context) return;
    this.activationGuard?.setInteractive(false);
    this.#hideManagedChrome();
    this.#ensureParkHeartbeat();
  }

  async #showWindow(page = this.page) {
    if (this.canvaBackgroundLock) {
      this.interactiveVisible = false;
      this.#hideManagedChrome();
      this.#ensureParkHeartbeat();
      return;
    }
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
    if (this.interactiveVisible || this.canvaWatch) return;
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
      if (kind === 'canva') return 'Canva';
      return 'ChatGPT';
    }
    return engineDisplayName(this.engine);
  }

  #pageKind(page) {
    const url = page?.url?.() ?? '';
    if (isCanvaPageUrl(url)) return 'canva';
    if (isGeminiPageUrl(url)) return 'gemini';
    if (isMetaPageUrl(url)) return 'meta';
    if (isChatGptPageUrl(url)) return 'chatgpt';
    return normalizeEngine(this.engine);
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

  #debugGeminiHp(hypothesisId, location, message, data = {}) {
    // #region agent log
    const payload = {
      sessionId: '033a04',
      runId: data.runId || 'pre-fix',
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now()
    };
    fetch('http://127.0.0.1:7583/ingest/41197195-aa7b-4904-9334-2c659b1953d0', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '033a04' },
      body: JSON.stringify(payload)
    }).catch(() => {});
    try {
      appendFileSync('/Users/abdelmouiz/Downloads/VERSA TPT BOT/.cursor/debug-033a04.log', `${JSON.stringify(payload)}\n`);
    } catch {}
    // #endregion
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
    const rawTarget = String(engineTarget(target) || target || '').trim().toLowerCase();
    const canva = rawTarget === 'canva';
    const engine = canva ? 'canva' : normalizeEngine(target || this.engine);
    if (!canva) this.setEngine(engine);
    const candidate = resolveInstalledBrowser(selectedProfile);
    if (!candidate) {
      throw Object.assign(new Error(`Google Chrome Canary is required to import a ${canva ? 'Canva' : this.#serviceName()} login session.`), {
        code: 'SYSTEM_BROWSER_NOT_FOUND'
      });
    }
    this.loginPending = true;
    this.loginCandidate = candidate;
    this.browserLabel = candidate.label;
    this.canvaBackgroundLock = false;
    this.#loginProgress('opening_window', `Opening ${canva ? 'Canva' : this.#serviceName()} for sign-in…`);
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
    if (this.context && !this.#cdpConnected()) {
      await this.#forgetPlaywrightSession();
    }
    if (this.context) {
      if (!wantInteractive) this.canvaWatch = false;
      this.interactiveVisible = wantInteractive;
      this.headless = background;
      this.browserPid = this.browserPid || pidFromContext(this.context) || profileLockOwnerPid(this.profileDir);
      if (wantInteractive) await this.#showWindow(this.page);
      else await this.#parkWindow(this.page);
      if (!this.#isMeta() && !skipHome) this.page = await this.#findOrCreateChatPage();
      if (!wantInteractive) await this.#parkWindow(this.page);
      return this.status();
    }
    if (this.launching) return this.launching;
    this.launching = this.#launchInternal({ background, skipHome }).finally(() => {
      this.launching = null;
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
    this.canvaPage = null;
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
      context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://www.canva.com' }),
      context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://canva.com' })
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
    if (background) this.canvaWatch = false;
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
      if (this.interactiveVisible || this.canvaWatch) return original();
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
      if (!this.interactiveVisible && !this.canvaWatch) this.#hideManagedChrome();
      return page;
    };
    for (const page of context.pages()) this.#silencePageActivation(page);
  }

  #firstLivePage() {
    const pages = (this.context?.pages() || []).filter((item) => item && !item.isClosed());
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
    if (!this.interactiveVisible && !this.canvaWatch) this.#hideManagedChrome();
    return page;
  }

  async #attachCdp(port, { background, skipHome, label, warnings = [] }) {
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
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
    const error = new Error(`Google Chrome Canary could not be launched. ${failures.join(' | ')}`);
    error.code = 'BROWSER_LAUNCH_FAILED';
    throw error;
  }

  async #deletedGeminiGemBannerVisible(page) {
    if (!page || page.isClosed()) return false;
    const banner = page.getByText(/this conversation was created with a gem that has been deleted/i).first();
    return banner.isVisible().catch(() => false);
  }

  async #ensureLiveGeminiStudio(page, targetUrl) {
    if (!page || page.isClosed() || !targetUrl || !isGeminiPageUrl(targetUrl)) return page;
    let dest = isRetiredGeminiGemUrl(targetUrl) ? CONTENT_GEM_URL : targetUrl;
    const targetGem = geminiGemId(dest);
    const wantsImageCreator = geminiImageCreatorMode(dest);
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await sleep(800);
      const current = page.url();
      const onGoogleSignIn = isServiceSignInUrl(current, 'gemini');
      const currentGem = geminiGemId(current);
      const deleted = isRetiredGeminiGemUrl(current) || await this.#deletedGeminiGemBannerVisible(page);
      const wrongGem = Boolean(targetGem && currentGem && currentGem !== targetGem);
      const missingImageCreator = wantsImageCreator && !geminiImageCreatorMode(current);
      if (!onGoogleSignIn && !deleted && !wrongGem && !missingImageCreator) return page;
      if (deleted) dest = geminiGemId(dest) && !isRetiredGeminiGemUrl(dest) ? dest : CONTENT_GEM_URL;
      await page.goto(dest, { waitUntil: 'domcontentloaded', timeout: 120_000 });
      await this.#afterNavigate(page);
      await sleep(400);
      const newChat = page.getByRole('button', { name: /new chat|start a new chat/i }).first();
      if (await newChat.isVisible().catch(() => false)) await newChat.click().catch(() => {});
    }
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

  async #findOrCreateChatPage() {
    const pages = this.context.pages();
    const home = this.engine === 'gemini' ? CONTENT_GEM_URL : this.#engineHome();
    const matchesEngine = (url) => {
      if (this.engine === 'gemini') return isGeminiPageUrl(url) && !isRetiredGeminiGemUrl(url);
      if (this.engine === 'meta') return isMetaPageUrl(url);
      return isChatGptPageUrl(url);
    };
    let page = pages.find((item) => matchesEngine(item.url()));
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
    await this.launch({ skipHome: false });
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
    if ((existingTitle && existingTitle !== String(listing.title).trim()) || (productAlreadyUploaded && !existingTitle)) {
      throw Object.assign(new Error('The open TPT form contains a different partial product. It was left untouched; finish or cancel that form before starting this project.'), {
        code: 'TPT_FORM_PROJECT_MISMATCH',
        existingTitle: existingTitle || null
      });
    }
    await this.#tptProgress(onProgress, 'title', 'Entering product title…');
    await titleInput.fill(String(listing.title));

    await this.#tptProgress(onProgress, 'product_file', 'Checking the downloadable PDF upload…');
    await this.#tptUploadIfMissing(page, {
      inputSelector: TPT_FORM_SELECTORS.productFile,
      uploadedSelector: TPT_FORM_SELECTORS.productUploaded,
      filePath: listing.productPdfPath,
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
    await this.#tptFillSelector(page, TPT_FORM_SELECTORS.description, listing.description);

    await this.#tptProgress(onProgress, 'pricing', 'Filling price, licenses, bundle discount, and tax code…');
    await this.#tptSetCheckbox(page, TPT_FORM_SELECTORS.freeResource, listing.isFreeResource === true);
    if (!listing.isFreeResource) await this.#tptFillSelector(page, TPT_FORM_SELECTORS.price, listing.suggestedPrice);
    await this.#tptFillSelector(page, TPT_FORM_SELECTORS.multipleLicensePrice, listing.multipleLicensePrice);
    await this.#tptFillSelector(page, TPT_FORM_SELECTORS.bundleDiscountPrice, listing.bundleDiscountPrice || '', false);
    await this.#tptPickSingle(page, TPT_FORM_SELECTORS.taxCode, listing.taxCode, 'tax code', true);

    await this.#tptProgress(onProgress, 'metadata', 'Selecting grades, subjects, tags, formats, and custom categories…');
    await this.#tptSetGrades(page, listing.grades);
    await this.#tptPickMulti(page, TPT_FORM_SELECTORS.subjects, listing.subjects, 'subject area', {
      ...TPT_METADATA_PICKER_OPTIONS.subjects,
      onProgress
    });
    await this.#tptPickMulti(page, TPT_FORM_SELECTORS.tags, listing.tags, 'tag', {
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
    if (listing.copyrightDeclaration === 'licensed') {
      await page.locator(TPT_FORM_SELECTORS.copyrightLicensed).first().check();
    } else if (listing.copyrightDeclaration === 'original') {
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
    await this.#tptSetCheckbox(page, TPT_FORM_SELECTORS.listingActive, listing.publicationStatus === 'active');
    const standardsRequested = Object.values(listing.standards || {}).some((values) => Array.isArray(values) && values.length);
    const statusLabel = listing.publicationStatus === 'active' ? 'Active' : 'Draft';
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
    const publicationStatus = listing?.publicationStatus === 'active' ? 'active' : 'draft';
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
    const target = url && isMetaLocalUrl(url) ? META_URL : url;
    await this.launch({ headless: true });
    const existing = this.jobPages.get(jobId);
    if (existing && !existing.isClosed() && !fresh) return existing;
    const reusedExisting = Boolean(existing && !existing.isClosed());
    const page = (existing && !existing.isClosed() ? existing : null) || await this.#ensureBackgroundPage();
    this.jobPages.set(jobId, page);
    this.page = this.page && !this.page.isClosed() ? this.page : page;
    await this.#afterNavigate(page);
    const beforeUrl = page.url();
    const targetUrl = target || (this.engine === 'gemini' ? CONTENT_GEM_URL : this.#engineHome());
    const willNavigate = jobPageNeedsNavigation(page.url(), targetUrl, fresh) || isRetiredGeminiGemUrl(page.url());
    if (willNavigate) {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    }
    if (this.engine === 'gemini') await this.#ensureLiveGeminiStudio(page, targetUrl);
    await this.#afterNavigate(page);
    // #region agent log
    this.#debugGeminiHp('C', 'browser-controller.cjs:#jobPage', 'job page resolved', {
      jobId: String(jobId || '').slice(0, 12),
      fresh,
      reusedExisting,
      willNavigate,
      beforeUrl: String(beforeUrl || '').slice(0, 160),
      targetUrl: String(targetUrl || '').slice(0, 160),
      afterUrl: String(page.url() || '').slice(0, 160),
      imageCreator: geminiImageCreatorMode(page.url()),
      livePageCount: (this.context?.pages() || []).filter((item) => item && !item.isClosed()).length
    });
    // #endregion
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
    this.canvaControl = { retryStep: false, retryPage: false, resumeFromPage: null, abortSafely: false };
  }

  pauseForHuman(payload = {}) {
    if (isPdfImportOpenDesignStage(payload)) {
      this.humanPaused = false;
      this.humanObserveRequested = false;
      this.humanDecision = null;
      this.humanIntervention = null;
      if (this.canvaJob) this.canvaJob.clearIntervention();
      return;
    }
    this.humanPaused = true;
    this.humanObserveRequested = false;
    this.humanDecision = null;
    this.humanIntervention = payload && typeof payload === 'object' ? payload : { happened: String(payload || '') };
    if (this.canvaJob) this.canvaJob.requireIntervention(this.humanIntervention);
  }

  resumeCanvaAutomation() {
    this.humanPaused = false;
    this.humanObserveRequested = false;
    this.humanDecision = null;
    if (this.canvaJob) this.canvaJob.clearIntervention();
  }

  resolveCanvaIntervention(decision) {
    const choice = String(decision || 'done').trim().toLowerCase();
    this.humanDecision = choice;
    if (choice === 'abort') {
      this.humanPaused = false;
      this.humanObserveRequested = false;
      this.abortRequested = true;
      this.cancelVersion += 1;
      return { decision: 'abort' };
    }
    if (choice === 'retry' || choice === 'try' || choice === 'automatic' || choice === 'try automatically again') {
      this.humanPaused = false;
      this.humanObserveRequested = false;
      this.canvaControl.retryStep = true;
      if (this.canvaJob) this.canvaJob.clearIntervention();
      return { decision: 'retry' };
    }
    this.humanObserveRequested = true;
    return { decision: 'done' };
  }

  requestCanvaRetryPage() {
    this.canvaControl.retryPage = true;
  }

  requestCanvaRetryStep() {
    this.canvaControl.retryStep = true;
  }

  requestCanvaResumeFromPage(pageNumber) {
    this.canvaControl.resumeFromPage = Number(pageNumber) || null;
  }

  abortCanvaSafely() {
    this.canvaControl.abortSafely = true;
    this.humanPaused = false;
    this.humanObserveRequested = false;
    this.cancelWaits();
  }

  getCanvaControllerView() {
    return this.canvaJob ? this.canvaJob.controllerView() : null;
  }

  attachLiveBrowser({ context, page } = {}) {
    this.context = context || null;
    this.page = page || null;
    this.canvaPage = page || null;
    this.interactiveVisible = true;
    this.canvaWatch = true;
    this.canvaBackgroundLock = false;
    this.skipWindowChrome = true;
    this.headless = false;
  }

  endWork() {
    this.abortRequested = false;
    this.humanPaused = false;
    this.humanObserveRequested = false;
    this.#stopCanvaLiveFrame();
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
    const home = this.engine === 'gemini' ? CONTENT_GEM_URL : this.#engineHome();
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
    this.canvaBackgroundLock = false;
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
    return messages.last().innerText({ timeout: 5_000 }).catch(() => '');
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

  async detectBlocker(page = null) {
    page ??= await this.ensurePage();
    const url = page.url();
    const authMessageVisible = await page.getByText(AUTH_TEXT_PATTERN).first().isVisible().catch(() => false);
    const chatgptAuth = isChatGptPageUrl(url) && (/\/auth\//i.test(url) || authMessageVisible || await this.#hasVisibleLoginControl(page));
    const onGoogleSignIn = isServiceSignInUrl(url, 'gemini');
    const geminiLoginControl = isGeminiPageUrl(url) && (authMessageVisible || await this.#hasVisibleLoginControl(page));
    const geminiSignedIn = isGeminiPageUrl(url) && await this.#geminiLooksSignedIn(page);
    const geminiAuth = (onGoogleSignIn || geminiLoginControl) && !geminiSignedIn;
    const metaAuth = (isMetaPageUrl(url) || /facebook\.com/i.test(url)) && (/\/login|\/checkpoint/i.test(url) || authMessageVisible || await this.#hasVisibleLoginControl(page));
    const canvaAuth = isCanvaPageUrl(url) && (isCanvaLoginUrl(url) || authMessageVisible || await this.#hasVisibleLoginControl(page));
    if (chatgptAuth) {
      return { code: 'AUTH_REQUIRED', message: 'The ChatGPT session is not valid in the background browser. Import the login session again.' };
    }
    if (geminiAuth) {
      return { code: 'AUTH_REQUIRED', message: 'The Gemini session is not valid in the background browser. Import the Google login session again.' };
    }
    if (metaAuth && this.engine === 'meta') {
      return { code: 'AUTH_REQUIRED', message: 'The Meta AI session is not valid in the background browser. Sign in on meta.ai, then import the session again.' };
    }
    if (canvaAuth) {
      return { code: 'AUTH_REQUIRED', message: 'The Canva session is not valid in the background browser. Sign in to Canva Pro in Chrome Canary, then verify Canva again.' };
    }
    const noticeText = await this.#activeNoticeText(page);
    const noticeBlocker = classifyNoticeText(noticeText);
    if (noticeBlocker?.code === 'REQUEST_THROTTLED') {
      const dialog = page.locator('[role="dialog"]').filter({ hasText: /too many requests/i }).last();
      const dismiss = dialog.getByRole('button', { name: /^(got it|ok|okay|close)$/i }).first();
      if (await dismiss.isVisible().catch(() => false)) await dismiss.click().catch(() => {});
    }
    return noticeBlocker;
  }

  async #geminiLooksSignedIn(page) {
    if (!page || page.isClosed()) return false;
    const profile = await page.locator('user-profile-picture img:not([src*="default-user="]), user-profile-picture').first().isVisible().catch(() => false);
    if (profile) return true;
    const composer = await this.#findVisible(GEMINI_INPUT_SELECTORS, 250, page);
    return Boolean(composer);
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
    if (isCanvaPageUrl(url) || /accounts\.canva\.com/i.test(url)) {
      const selectors = [
        'a[href*="/login"]',
        'button:has-text("Log in")',
        'a:has-text("Log in")',
        '[data-testid="login-button"]'
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
    if (usesCanvaAuthentication(forceTarget, page?.url?.() ?? '')) {
      page ??= await this.#canvaPage();
      return this.#canvaAuthenticationStatus(page);
    }
    if (page && isCanvaPageUrl(page.url()) && (rawTarget === 'gemini' || rawTarget === 'chatgpt' || rawTarget === 'meta')) {
      page = null;
    }
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

  async waitUntilIdle(timeoutMs = 600_000, page = null) {
    page ??= await this.ensurePage();
    const started = Date.now();
    const cancelVersion = this.cancelVersion;
    while (Date.now() - started < timeoutMs) {
      if (cancelVersion !== this.cancelVersion) {
        return { ok: false, error: { code: 'QUEUE_PAUSED', message: 'Waiting was paused.' } };
      }
      const blocker = await this.detectBlocker(page);
      if (blocker) return { ok: false, error: blocker };
      const stopButton = await this.#findVisible(this.#stopSelectors(page), 100, page);
      if (!stopButton) return { ok: true };
      await this.#sleepOrPause(1_000);
    }
    return { ok: false, error: { code: 'PREVIOUS_GENERATION_BUSY', message: `${this.#serviceName(page)} is still processing a previous request.` } };
  }

  async #composer(timeoutMs = 60_000, page = null) {
    page ??= await this.ensurePage();
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
      // #region agent log
      this.#debugGeminiHp('A', 'browser-controller.cjs:#armGeminiImageGeneration', 'image mode already armed', {
        promptKind,
        url: String(page.url() || '').slice(0, 160),
        promptHead: String(prompt || '').slice(0, 120)
      });
      // #endregion
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
      // #region agent log
      this.#debugGeminiHp('A', 'browser-controller.cjs:#armGeminiImageGeneration', 'clicked Create images', {
        promptKind,
        armed,
        url: String(page.url() || '').slice(0, 160)
      });
      // #endregion
      return true;
    }
    if (await this.#openComposerAttachMenu(page)) {
      await sleep(300);
      if (await clickCreateImages()) {
        await sleep(350);
        const armed = await this.#geminiImageModeArmed(page);
        // #region agent log
        this.#debugGeminiHp('A', 'browser-controller.cjs:#armGeminiImageGeneration', 'Create images via attach menu', {
          promptKind,
          armed,
          url: String(page.url() || '').slice(0, 160)
        });
        // #endregion
        return true;
      }
      await page.keyboard.press('Escape').catch(() => {});
    }
    console.log('[browser] Gemini Create images tool was not found; continuing with the @image prompt.');
    // #region agent log
    this.#debugGeminiHp('A', 'browser-controller.cjs:#armGeminiImageGeneration', 'FAILED to arm Create images — submitting anyway', {
      promptKind,
      url: String(page.url() || '').slice(0, 160),
      imageCreator: geminiImageCreatorMode(page.url()),
      promptHead: String(prompt || '').slice(0, 160)
    });
    // #endregion
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

  async #pageForVerify(engine) {
    if (engine === 'canva') return this.#canvaPage();
    if (!this.context) await this.launch({ skipHome: true, forceBrowser: true });
    const matches = (url) => {
      if (engine === 'chatgpt') return isChatGptPageUrl(url);
      if (engine === 'meta') return isMetaPageUrl(url);
      return isGeminiPageUrl(url) || /accounts\.google\.com/i.test(String(url || ''));
    };
    const pages = this.context.pages().filter((item) => item && !item.isClosed());
    const page = pages.find((item) => matches(item.url()))
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
    const onService = engine === 'canva'
      ? isCanvaPageUrl(url)
      : engine === 'chatgpt'
        ? isChatGptPageUrl(url)
        : engine === 'meta'
          ? isMetaPageUrl(url)
          : isGeminiPageUrl(url);
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
    const rawTarget = String(engineTarget(target) || target || '').trim().toLowerCase();
    if (rawTarget === 'canva') {
      return this.#verifyCanvaLogin(selectedProfile, { timeoutMs, pollIntervalMs });
    }
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
    const rawTarget = String(engineTarget(target) || target || '').trim().toLowerCase();
    if (rawTarget === 'canva') {
      await this.close();
      const cookiePath = managedCookiePath(this.profileDir);
      if (cookiePath && existsSync(cookiePath)) {
        let database = null;
        try {
          database = new DatabaseSync(cookiePath);
          database.exec(`
            DELETE FROM cookies
            WHERE lower(host_key) = 'canva.com' OR lower(host_key) LIKE '%.canva.com'
          `);
        } catch {
          // Cookie DB may already be gone.
        } finally {
          try { database?.close(); } catch {}
        }
      }
      this.#clearSavedLoginState('canva');
      return { success: true, engine: 'canva' };
    }
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
    return Boolean(this.enableProfileSwapping) && this.profileRotationList.length > 1;
  }

  async switchToNextProfile() {
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
    // Chips can lag behind the upload completing, so settle on a stable count. A
    // strategy that delivered nothing shows zero right away and should not stall.
    let chipCount = 0;
    const startedAt = Date.now();
    while (Date.now() - startedAt < 20_000) {
      chipCount = await this.#composerAttachmentCount(page);
      if (chipCount >= expectedCount) break;
      if (chipCount === 0 && Date.now() - startedAt >= 5_000) break;
      await sleep(1_000);
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
      await sleep(800);
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
    await sleep(750);
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
    promptKind = 'prompt'
  } = {}) {
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
    // #region agent log
    this.#debugGeminiHp('B', 'browser-controller.cjs:submitPrompt', 'submit routing', {
      jobId: String(jobId || '').slice(0, 12),
      promptKind: promptKindValue,
      hasConversationUrl: Boolean(conversationUrl),
      conversationUrl: String(conversationUrl || '').slice(0, 160),
      gptUrl: String(gptUrl || '').slice(0, 160),
      startUrl: String(startUrl || '').slice(0, 160),
      startHint,
      imageCreatorOnStart: geminiImageCreatorMode(startUrl),
      promptHasGenerate: /\bgenerate\b/i.test(String(prompt || '')),
      promptHasRender: /\brender\b/i.test(String(prompt || '')),
      promptHasEditable: /\beditable\b/i.test(String(prompt || '')),
      promptHead: String(prompt || '').slice(0, 180)
    });
    // #endregion
    let page;
    if (conversationUrl) {
      page = await this.#jobPage(jobId, { fresh: true, url: conversationUrl });
    } else if (jobId) {
      page = await this.#jobPage(jobId, {
        fresh: !canReusePreparedPage,
        isolated: isolatedPage,
        url: startUrl
      });
    } else {
      page = await this.ensurePage();
      if (startUrl && jobPageNeedsNavigation(page.url(), startUrl, true)) {
        await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
        await sleep(1_000);
      }
    }
    await this.#afterNavigate(page);
    if (this.engine === 'gemini') await this.#ensureLiveGeminiStudio(page, gptUrl || startUrl);
    // #region agent log
    this.#debugGeminiHp('E', 'browser-controller.cjs:submitPrompt', 'page ready before fill', {
      jobId: String(jobId || '').slice(0, 12),
      pageUrl: String(page.url() || '').slice(0, 160),
      imageCreator: geminiImageCreatorMode(page.url()),
      gemId: geminiGemId(page.url())
    });
    // #endregion
    const idle = await this.waitUntilIdle(600_000, page);
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
    const composer = await this.#composer(60_000, page);
    let chipCount = 0;
    const fillPrompt = async (targetComposer) => {
      if (!canReusePreparedPage || !(await this.#composerContains(targetComposer, prompt))) {
        await this.#fillComposer(targetComposer, prompt, page);
      }
    };
    if (uploadFirst && filesToAttach.length) {
      chipCount = await this.attachImages(page, filesToAttach, {
        requireChips: requireAttachmentChips,
        requireAll: requireAttachmentChips
      });
      const composerAfterAttach = await this.#composer(15_000, page);
      await fillPrompt(composerAfterAttach);
    } else {
      await fillPrompt(composer);
      if (filesToAttach.length) {
        chipCount = await this.attachImages(page, filesToAttach, {
          requireChips: requireAttachmentChips,
          requireAll: requireAttachmentChips
        });
        const composerAfterAttach = await this.#composer(15_000, page);
        if (!(await this.#composerContains(composerAfterAttach, prompt))) {
          await this.#fillComposer(composerAfterAttach, prompt, page);
        }
      }
    }
    await this.#armGeminiImageGeneration(page, { prompt, promptKind });
    await this.#armMetaImageGeneration(page);
    const baseline = await this.#captureImageBaseline(page);
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
    return {
      baseline,
      submittedAt,
      conversationUrl: page.url()
    };
  }

  async waitForNewImage(baseline = [], timeoutMs = 600_000, {
    jobId = null,
    idleTimeoutMs = null,
    // Book Automation used longer settle windows for mockups so Gemini's still-drawing
    // tiles are not saved as the finished listing thumbnail.
    pendingReadyMs = 2_500,
    settleMs = 250,
    pollMs = 1_000
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
    let lastActivityAt = startedAt;
    let lastAssistantText = '';
    let pendingSignature = null;
    let pendingSince = 0;
    let generationInProgress = false;
    const serviceName = () => this.#serviceName(page);
    while (Date.now() - startedAt < timeoutMs) {
      if (!page || (typeof page.isClosed === 'function' && page.isClosed())) {
        throw Object.assign(new Error(`The managed browser closed while ${serviceName()} was generating. The same task can be retried safely.`), {
          code: 'BROWSER_CONTEXT_CLOSED'
        });
      }
      if (cancelVersion !== this.cancelVersion) {
        throw Object.assign(new Error('Waiting was paused.'), { code: 'QUEUE_PAUSED' });
      }
      const images = await this.imageCandidates(page);
      const candidate = pickBestNewAssistantImage(images, known, assistantBaselineCount);
      if (candidate) {
        generationInProgress = await this.#generationInProgress(page);
        if (generationInProgress) {
          if (pendingSignature !== candidate.signature) {
            pendingSignature = candidate.signature;
            pendingSince = Date.now();
          }
          lastActivityAt = Date.now();
          if (!(candidate.width >= 512 && Date.now() - pendingSince >= pendingReadyMs)) {
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
            if (!stillBusy) break;
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
            return { ...next, conversationUrl: page.url() };
          }
        }
        if (isNewAssistantImage(stable, known, assistantBaselineCount)) {
          return { ...stable, conversationUrl: page.url() };
        }
      }
      const now = Date.now();
      if (now - lastStateCheckAt >= PASSIVE_STATE_CHECK_INTERVAL_MS) {
        lastStateCheckAt = now;
        generationInProgress = await this.#generationInProgress(page);
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
          // #region agent log
          this.#debugGeminiHp('D', 'browser-controller.cjs:waitForNewImage', 'GENERATION_ERROR text refusal detected', {
            jobId: String(jobId || '').slice(0, 12),
            pageUrl: String(page.url() || '').slice(0, 160),
            imageCreator: geminiImageCreatorMode(page.url()),
            gemId: geminiGemId(page.url()),
            textHead: String(newAssistantText || '').slice(0, 280)
          });
          // #endregion
          throw Object.assign(new Error(newAssistantText.trim() || `${serviceName()} reported that image generation failed.`), { code: 'GENERATION_ERROR' });
        }
        if (!generationInProgress && REFERENCE_REQUEST_PATTERNS.some((pattern) => pattern.test(newAssistantText))) {
          throw Object.assign(
            new Error(`${serviceName()} requested a reference image instead of generating the page. The prompt has been updated to require direct image generation.`),
            { code: 'REFERENCE_REQUESTED_BY_GPT' }
          );
        }
        if (!generationInProgress && newAssistantText.trim().length > 30) {
          await this.#sleepOrPause(2_000);
          const finalCheckImages = await this.imageCandidates(page);
          const finalCandidate = pickBestNewAssistantImage(finalCheckImages, known, assistantBaselineCount);
          const stillDrawing = finalCheckImages.some((image) => !image.fromUserTurn && !image.inComposer && image.width > 0 && image.width < 256);
          if (!finalCandidate && (stillDrawing || now - lastActivityAt < IMAGE_TEXT_GRACE_MS)) {
            lastActivityAt = stillDrawing ? now : lastActivityAt;
          } else if (!finalCandidate) {
            throw Object.assign(new Error(newAssistantText.trim() || `${serviceName()} responded with text only and did not generate an image.`), { code: 'GENERATION_ERROR' });
          }
        }
      }
      if (idleTimeoutMs && !generationInProgress && now - lastActivityAt >= idleTimeoutMs) {
        throw Object.assign(new Error('The saved conversation has no active image generation to recover.'), {
          code: 'RECOVERY_IDLE'
        });
      }
      if (Date.now() - lastHeartbeat >= 5_000) {
        lastHeartbeat = Date.now();
        this.emit('heartbeat', { elapsedMs: Date.now() - startedAt, jobId });
      }
      await this.#sleepOrPause(pollMs);
    }
    throw Object.assign(new Error('No new image appeared before the generation timeout.'), { code: 'IMAGE_TIMEOUT' });
  }

  async waitForNewVideo(baseline = [], timeoutMs = 900_000, { jobId = null } = {}) {
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
        throw Object.assign(new Error(`The managed browser closed while ${serviceName()} was generating the preview video. The same task can be retried safely.`), {
          code: 'BROWSER_CONTEXT_CLOSED'
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
        this.emit('heartbeat', { elapsedMs: Date.now() - startedAt, jobId, phase: 'preview_video' });
      }
      await this.#sleepOrPause(1_500);
    }
    throw Object.assign(new Error('No preview video appeared before the Veo 3 generation timeout.'), { code: 'VIDEO_TIMEOUT' });
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

  async waitForAssistantTextResponse(baseline = [], timeoutMs = 180_000, page = null) {
    page ??= await this.ensurePage();
    const assistantCountMarker = Array.isArray(baseline)
      ? baseline.find((item) => String(item).startsWith('assistant-count::'))
      : null;
    const assistantBaselineCount = Number.parseInt(String(assistantCountMarker ?? '').split('::')[1], 10) || 0;
    const startedAt = Date.now();
    let lastText = '';
    let stableCount = 0;

    const cancelVersion = this.cancelVersion;
    while (Date.now() - startedAt < timeoutMs) {
      if (this.abortRequested || cancelVersion !== this.cancelVersion) {
        throw Object.assign(new Error('Waiting was paused.'), { code: 'QUEUE_PAUSED' });
      }
      if (!page || (typeof page.isClosed === 'function' && page.isClosed())) {
        throw Object.assign(new Error('The managed browser closed before the response completed. The same task can be retried safely.'), {
          code: 'BROWSER_CONTEXT_CLOSED'
        });
      }
      const blocker = await this.detectBlocker(page);
      if (blocker) throw Object.assign(new Error(blocker.message), { code: blocker.code });

      const inProgress = await this.#generationInProgress(page);
      const text = await this.#newAssistantText(assistantBaselineCount, page);

      if (!inProgress && text) {
        if (text === lastText) stableCount += 1;
        else {
          lastText = text;
          stableCount = 0;
        }
        if (stableCount >= 2) return text;
      }
      await this.#sleepOrPause(1_000);
    }
    if (lastText) return lastText;
    throw Object.assign(new Error(`${this.#serviceName(page)} did not complete the response within the timeout.`), { code: 'GPT_RESPONSE_TIMEOUT' });
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

    await this.launch({ headless: true, forceBrowser: true });
    if (!this.context) {
      return emptyMockupResult({
        status: 'blocked',
        productUrl: parsed.href,
        warning: 'The app browser was not available to open the public listing.'
      });
    }

    const page = await this.context.newPage();
    try {
      await page.goto(parsed.href, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      const challengeDeadline = Date.now() + 45_000;
      while (Date.now() < challengeDeadline) {
        const title = await page.title().catch(() => '');
        if (!/just a moment/i.test(title)) break;
        await sleep(500);
      }
      await page.waitForSelector(
        'img[src*="thumbitem"], img[src*="preview"], img[alt*="Thumbnail" i], img[alt*="Preview" i], meta[property="og:image"]',
        { timeout: 20_000 }
      ).catch(() => {});
      await sleep(800);

      const html = await page.content();
      const pageTitle = await page.title().catch(() => '');
      if (isCloudflareChallengeHtml(html) || /just a moment/i.test(pageTitle)) {
        console.warn(`[browser] TPT listing scrape blocked by bot check: ${parsed.href} title=${pageTitle} bytes=${html.length}`);
        return emptyMockupResult({
          status: 'blocked',
          productUrl: parsed.href,
          warning: 'The listing page was blocked by a bot check. Prompt generation will continue from the URL text only.'
        });
      }

      const extraUrls = await page.evaluate(collectMockupUrlsInBrowser).catch(() => []);
      const urls = extractListingMockupUrls(html, {
        pageUrl: parsed.href,
        productId: parsed.productId,
        extraUrls
      });
      const scrapedPageCount = extractPageCountFromTptHtml(html);
      console.log(`[browser] TPT listing scrape ${parsed.href} extra=${Array.isArray(extraUrls) ? extraUrls.length : 0} urls=${urls.length} pageCount=${scrapedPageCount || 'n/a'} title=${pageTitle}`);
      if (!urls.length) {
        return emptyMockupResult({
          status: 'empty',
          productUrl: parsed.href,
          warning: 'No listing mockups were found on this product page. Prompt generation will continue from the URL text only.',
          scrapedPageCount
        });
      }

      const request = this.context.request;
      return downloadListingMockups({
        urls,
        destDir,
        productUrl: parsed.href,
        scrapedPageCount,
        fetchBuffer: async (imageUrl) => {
          const response = await request.get(imageUrl, {
            headers: {
              Referer: parsed.href,
              Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
            },
            timeout: 45_000,
            failOnStatusCode: false
          });
          if (!response.ok()) return null;
          return {
            buffer: Buffer.from(await response.body()),
            contentType: response.headers()['content-type'] || ''
          };
        }
      });
    } catch (error) {
      return emptyMockupResult({
        status: 'blocked',
        productUrl: parsed.href,
        warning: error?.message
          ? `Listing mockups could not be captured: ${error.message}`
          : 'Listing mockups could not be captured from the public product page.'
      });
    } finally {
      if (page) await page.close().catch(() => {});
    }
  }

  async analyzeProductWithGpt(input = {}) {
    if (this.engine !== 'gemini') {
      return this.withEngine('gemini', () => this.analyzeProductWithGpt(input));
    }
    const listing = resolveListingAnalysisInput(input);
    let mockups = emptyMockupResult({
      status: 'skipped',
      productUrl: listing.productUrl,
      warning: null
    });
    const shouldScrape = shouldCaptureListingMockups(listing) && Boolean(listing.mockupDestDir);
    if (shouldScrape) {
      try {
        mockups = await this.scrapeTptListingMockups(listing.productUrl, listing.mockupDestDir);
        if (!(mockups.images || []).length) {
          await sleep(1_500);
          mockups = await this.scrapeTptListingMockups(listing.productUrl, listing.mockupDestDir);
        }
      } catch (error) {
        mockups = emptyMockupResult({
          status: 'blocked',
          productUrl: listing.productUrl,
          warning: error?.message
            ? `Listing mockups could not be captured: ${error.message}`
            : 'Listing mockups could not be captured from the public product page.'
        });
      }
    }
    const attachmentPaths = competitorMockupPaths(mockups);
    if (shouldScrape && !attachmentPaths.length) {
      throw Object.assign(new Error(mockups.warning || 'Competitor listing mockups could not be extracted from the product page.'), {
        code: 'MOCKUPS_NOT_CAPTURED',
        mockups
      });
    }
    const prompt = buildAnalysisPrompt({
      ...listing,
      mockupCount: attachmentPaths.length,
      scrapedPageCount: mockups.scrapedPageCount
    });
    const gptUrl = listing.gptUrl || getJobStartUrl({ kind: 'analysis' }, this.engine);
    await this.#launchForPromptWork();
    const page = await this.ensurePage();
    await this.#afterNavigate(page);
    if (gptUrl && jobPageNeedsNavigation(page.url(), gptUrl, true)) {
      await page.goto(gptUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
      await sleep(1_000);
    }
    await this.#ensureLiveGeminiStudio(page, gptUrl);
    this.#writePromptReceipt({
      kind: 'analysis-first',
      stage: 'before-submit',
      promptPreview: String(prompt).slice(0, 1600),
      promptHasMockupInstruction: /attached listing mockup/i.test(prompt),
      attachmentPaths,
      attachmentCount: attachmentPaths.length
    });
    console.log(`[browser] first analysis prompt attaching ${attachmentPaths.length} competitor mockup(s)`);
    const submission = await this.submitPrompt(prompt, {
      gptUrl,
      attachmentPaths,
      requireAttachmentChips: attachmentPaths.length > 0,
      attachBeforePrompt: attachmentPaths.length > 0,
      promptKind: 'analysis-first'
    });
    const responseText = await this.waitForAssistantTextResponse(submission.baseline, 180_000, page);
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
    productFormat = 'static'
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
        productFormat
      }));
    }
    if (conversationUrl && (!isGeminiPageUrl(conversationUrl) || isRetiredGeminiGemUrl(conversationUrl))) conversationUrl = null;
    const filesToAttach = [...new Set((Array.isArray(attachmentPaths) ? attachmentPaths : []).filter((filePath) => filePath && existsSync(filePath)))];
    const prompt = buildPromptsGenerationRequest(pageCount, format, orientation, {
      hasCompetitorMockups: filesToAttach.length > 0,
      seed: seed || [title, theme, niche, productFormat].filter(Boolean).join(' | '),
      title,
      theme,
      niche,
      visualTheme,
      productFormat
    });
    await this.#launchForPromptWork();
    const page = await this.ensurePage();
    await this.#afterNavigate(page);
    if (conversationUrl) {
      await page.goto(conversationUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
      await sleep(1_000);
      await this.#ensureLiveGeminiStudio(page, gptUrl || getJobStartUrl({ kind: 'prompts' }, this.engine));
    }
    const submission = await this.submitPrompt(prompt, {
      conversationUrl,
      gptUrl: gptUrl || getJobStartUrl({ kind: 'prompts' }, this.engine),
      attachmentPaths: filesToAttach,
      requireAttachmentChips: filesToAttach.length > 0,
      promptKind: 'generate-prompts'
    });
    const responseText = await this.waitForAssistantTextResponse(submission.baseline, 240_000, page);
    return {
      rawText: responseText,
      conversationUrl: submission.conversationUrl
    };
  }

  async generateTptListingWithGpt({ project, pdfPath, gptUrl = null }) {
    // Stolen from TPT Book Automation: attach finished product PDF → SEO/listing Gem → JSON draft,
    // then auto-correct taxonomy if subjects/tags are inventing outside TPT options.
    if (this.engine === 'meta') {
      return this.withEngine('gemini', () => this.generateTptListingWithGpt({ project, pdfPath, gptUrl }));
    }
    const jobId = `tpt-listing-${project.id}`;
    gptUrl = gptUrl || getJobStartUrl({ kind: 'listing' }, this.engine);
    const prompt = buildTptListingPrompt(project);
    const hasPdf = Boolean(pdfPath && existsSync(pdfPath));
    await this.launch({ headless: true });
    this.#throwIfCancelled();
    let conversationUrl = null;
    try {
      let submission = await this.submitPrompt(prompt, {
        jobId,
        isolatedPage: true,
        attachmentPath: hasPdf ? pdfPath : null,
        gptUrl,
        promptKind: 'listing',
        attachBeforePrompt: hasPdf,
        requireAttachmentChips: hasPdf
      });
      conversationUrl = submission.conversationUrl;
      let responseText = await this.waitForAssistantTextResponse(submission.baseline, 240_000, await this.#jobPage(jobId));
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const correctionPrompt = buildTptListingTaxonomyCorrectionPrompt(responseText);
        if (!correctionPrompt) return { rawText: responseText, conversationUrl };
        submission = await this.submitPrompt(correctionPrompt, { jobId, conversationUrl, promptKind: 'listing' });
        conversationUrl = submission.conversationUrl;
        responseText = await this.waitForAssistantTextResponse(submission.baseline, 240_000, await this.#jobPage(jobId));
      }
      const remainingCorrection = buildTptListingTaxonomyCorrectionPrompt(responseText);
      if (remainingCorrection) {
        throw Object.assign(new Error('The listing did not return selectable TPT subject areas and tags after automatic correction.'), {
          code: 'TPT_LISTING_TAXONOMY_INVALID'
        });
      }
      return { rawText: responseText, conversationUrl };
    } finally {
      await this.releaseJob(jobId).catch(() => {});
    }
  }

  async generateTptThumbnailsWithGpt({ project, pdfPath, listing, onThumbnail = null, thumbnailIndex = null, gptUrl = null }) {
    await this.launch({ headless: true });
    const results = [];
    gptUrl = gptUrl || getJobStartUrl({ kind: 'thumbnail' }, this.engine);
    const pagePaths = (() => {
      try {
        const { collectShowcaseImagePaths } = require('./showcase-builder.cjs');
        const showcases = collectShowcaseImagePaths(project?.jobs, project?.outputDir);
        if (showcases.length) return showcases;
      } catch {}
      return collectProductPageImagePaths(project?.jobs);
    })();
    // Book Automation attached raw page PNGs (or the product PDF). Keep PDF out of
    // Gemini attachments — it cannot edit PDF pages into mockup frames — but reuse the
    // same order/request/wait/extract loop with Image Creator mode + retry.
    void pdfPath;
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
      const brief = listing.thumbnailBriefs?.[index] || `Show a clear benefit of ${listing.title || project.name}.`;
      const prompt = withEngineImagePrefix(buildTptThumbnailImagePrompt({
        index,
        title: listing.title || project.name || '',
        brief
      }), this.engine, { purpose: 'thumbnail' });

      let attachments = [];
      if (pagePaths.length) {
        const staged = await stageThumbnailPageTargets({
          pagePaths,
          destDir: join(project.outputDir || tmpdir(), 'thumbnail-pages', `t${index + 1}`),
          thumbnailIndex: index
        });
        attachments = [...(staged.pageFiles || staged.attachmentPaths || [])];
      } else {
        attachments = selectMockupAttachmentPaths({
          jobs: project?.jobs,
          outputDir: project?.outputDir,
          thumbnailIndex: index
        });
      }
      if (!attachments.length && pagePaths.length) {
        const destPath = join(project.outputDir || tmpdir(), 'mockup-source.docx');
        attachments = [await writeImagesDocx(pagePaths, destPath)];
      }
      // Book Automation fallback: first 6 finished page outputs when staging is empty.
      if (!attachments.length && Array.isArray(project?.jobs)) {
        attachments = project.jobs
          .map((job) => job?.outputPath)
          .filter((filePath) => filePath && existsSync(filePath) && !isRejectedMockupAttachment(filePath))
          .slice(0, 6);
      }
      attachments = [...new Set(attachments.filter((filePath) => (
        filePath
        && existsSync(filePath)
        && !isRejectedMockupAttachment(filePath)
      )))];
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

  async generateTptPreviewVideoWithGpt({ project, pdfPath, listing, gptUrl = null }) {
    const previousEngine = this.engine;
    this.setEngine('gemini');
    const jobId = `tpt-preview-${project.id}`;
    gptUrl = gptUrl || getJobStartUrl({ kind: 'preview' }, 'gemini');
    let attachments = selectPreviewAttachmentPaths({
      jobs: project?.jobs,
      thumbnailPaths: listing?.thumbnailPaths,
      maxCount: 8
    });
    if (!attachments.length && pdfPath && existsSync(pdfPath)) attachments = [pdfPath];
    if (!attachments.length) {
      throw Object.assign(new Error('Attach generated mockups or interior pages before generating a preview video.'), {
        code: 'PREVIEW_ATTACHMENTS_REQUIRED'
      });
    }
    const prompt = buildTptPreviewVideoPrompt({
      title: listing?.title || project?.name || '',
      description: listing?.description || '',
      attachmentCount: attachments.length
    });
    try {
      await this.launch({ headless: true, forceBrowser: true });
      const submission = await this.submitPrompt(prompt, {
        jobId,
        isolatedPage: true,
        conversationUrl: null,
        attachmentPaths: attachments,
        gptUrl,
        promptKind: 'preview-video',
        attachBeforePrompt: true,
        requireAttachmentChips: true
      });
      const video = await this.waitForNewVideo(submission.baseline, 900_000, { jobId });
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

  async regenerateTptListingFieldWithGpt({ project, pdfPath, listing, field }) {
    if (this.engine === 'meta') {
      return this.withEngine('gemini', () => this.regenerateTptListingFieldWithGpt({ project, pdfPath, listing, field }));
    }
    const jobId = `tpt-field-${project.id}-${field}`;
    const prompt = `Using the attached product PDF and listing draft below, regenerate ONLY ${field}. Return only the replacement value, without JSON, label, or commentary.\n${JSON.stringify(listing)}`;
    const hasPdf = Boolean(pdfPath && existsSync(pdfPath));
    await this.launch({ headless: true });
    const submission = await this.submitPrompt(prompt, {
      jobId,
      isolatedPage: true,
      attachmentPath: hasPdf ? pdfPath : null,
      gptUrl: getJobStartUrl({ kind: 'listing' }, this.engine),
      promptKind: 'listing',
      attachBeforePrompt: hasPdf,
      requireAttachmentChips: hasPdf
    });
    const value = await this.waitForAssistantTextResponse(submission.baseline, 180_000, await this.#jobPage(jobId));
    await this.releaseJob(jobId);
    return value.trim();
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

  async #lockCanvaBrowserBackground() {
    this.canvaBackgroundLock = true;
    this.canvaWatch = false;
    this.interactiveVisible = false;
    this.headless = true;
    this.activationGuard?.setConnecting(false);
    this.activationGuard?.setInteractive(false);
    this.#stopCanvaLiveFrame();
    if (this._parkTimer) {
      clearTimeout(this._parkTimer);
      this._parkTimer = null;
    }
    if (this.skipWindowChrome) return;
    this.#hideManagedChrome();
    this.#ensureParkHeartbeat();
  }

  // STAGE: PDF_IMPORT — restore yesterday's working attach (Import file / chooser need a live Canary).
  // Magic Layers / Share re-lock via #lockCanvaBrowserBackground after the design URL exists.
  async #unlockCanvaBrowserForPdfImport(page = null) {
    this.canvaBackgroundLock = false;
    this.canvaWatch = true;
    this.interactiveVisible = true;
    this.headless = false;
    this.activationGuard?.setConnecting(false);
    this.activationGuard?.setInteractive(true);
    this.#stopCanvaLiveFrame();
    if (this._parkTimer) {
      clearTimeout(this._parkTimer);
      this._parkTimer = null;
    }
    this.#stopParkHeartbeat();
    this.#stopHideDaemon();
    if (this.skipWindowChrome) return;
    await this.#showWindow(page || this.canvaPage || this.page);
  }

  async #revealCanvaBrowser(page = null) {
    if (this.canvaBackgroundLock) {
      await this.#lockCanvaBrowserBackground();
      return;
    }
    this.canvaWatch = true;
    this.interactiveVisible = true;
    this.headless = false;
    if (this._parkTimer) {
      clearTimeout(this._parkTimer);
      this._parkTimer = null;
    }
    this.#stopParkHeartbeat();
    this.#stopHideDaemon();
    await this.#showWindow(page || this.canvaPage || this.page);
  }

  async #canvaPage({ allowExistingDesign = true } = {}) {
    if (this.canvaBackgroundLock) {
      this.canvaWatch = false;
      this.interactiveVisible = false;
    } else if (this.canvaWatch) {
      this.interactiveVisible = true;
    }
    if (!(this.skipWindowChrome && this.context)) {
      await this.launch({
        skipHome: true,
        forceBrowser: true,
        interactive: this.interactiveVisible && !this.canvaBackgroundLock
      });
    }
    if (!this.context) {
      throw Object.assign(new Error('A Google Chrome Canary browser context is not active.'), { code: 'BROWSER_NOT_LAUNCHED' });
    }
    if (allowExistingDesign && this.canvaPage && !this.canvaPage.isClosed()) {
      if (canvaDesignId(this.canvaPage.url())) {
        if (this.canvaBackgroundLock) await this.#lockCanvaBrowserBackground();
        else if (this.canvaWatch) await this.#revealCanvaBrowser(this.canvaPage);
        return this.canvaPage;
      }
    }
    const pages = this.context.pages().filter((item) => item && !item.isClosed());
    const homePage = pages.find((item) => isCanvaPageUrl(item.url()) && !canvaDesignId(item.url()));
    const editorPage = pages.find((item) => canvaDesignId(item.url()));
    let page = allowExistingDesign
      ? (editorPage || homePage || pages.find((item) => isCanvaPageUrl(item.url())))
      : (homePage || pages.find((item) => isCanvaPageUrl(item.url()) && !canvaDesignId(item.url())));
    if (!page) {
      page = pages.find((item) => item.url() === 'about:blank' && !item.isClosed()) || await this.#freshEnginePage();
    }
    this.canvaPage = page;
    // #region agent log
    this.#debugCanva('G', 'browser-controller.cjs:#canvaPage', 'picked canva page', {
      allowExistingDesign,
      url: String(page.url() || '').slice(0, 180),
      designId: canvaDesignId(page.url() || '') || null
    });
    // #endregion
    if (this.canvaBackgroundLock) await this.#lockCanvaBrowserBackground();
    else if (this.canvaWatch) await this.#revealCanvaBrowser(page);
    else await this.#afterNavigate(page);
    return page;
  }

  async #canvaAuthenticationStatus(page) {
    const url = page?.url?.() ?? '';
    const loginControl = isCanvaLoginUrl(url) || await this.#hasVisibleLoginControl(page);
    const createVisible = await page.getByRole('button', { name: /create a design|create design/i }).first().isVisible().catch(() => false);
    const editorVisible = await page.getByRole('button', { name: /share|uploads|apps/i }).first().isVisible().catch(() => false);
    const cookieJar = this.context;
    const canvaCookies = cookieJar
      ? await cookieJar.cookies(['https://www.canva.com/', 'https://canva.com/']).catch(() => [])
      : [];
    const hasSessionCookie = canvaCookies.some((cookie) => {
      const name = String(cookie?.name || '');
      return /^(CAE|CACL|access|session|auth|login)/i.test(name) || /canva/i.test(String(cookie?.domain || ''));
    });
    return {
      authenticated: Boolean(!loginControl && (createVisible || editorVisible || hasSessionCookie || isCanvaDesignUrl(url) || /\/(folder|projects|designs)\b/i.test(url))),
      composer: createVisible || editorVisible,
      loginControl,
      hasSessionCookie,
      engine: 'canva'
    };
  }

  async #verifyCanvaLogin(selectedProfile = null, { timeoutMs = 45_000, pollIntervalMs = 400 } = {}) {
    this.#loginProgress('checking_saved_login', 'Checking the saved Canva login in the background…');
    const alreadySaved = Boolean(this.inspectSavedLogins().canva);
    let imported = {};
    let importError = null;
    if (!this.context && !alreadySaved) {
      try {
        imported = await this.importSystemLoginSession(selectedProfile, { service: 'canva' });
      } catch (caughtError) {
        importError = caughtError;
        this.#loginProgress('import_failed', caughtError.message);
      }
    }
    const keepVisible = this.interactiveVisible;
    await this.launch({ skipHome: true, forceBrowser: true, interactive: keepVisible });
    const page = await this.#openVerifyPage('canva');
    const requestedTimeout = Math.max(0, Number(timeoutMs) || 0);
    const effectiveTimeout = Math.max(requestedTimeout || 45_000, alreadySaved ? 20_000 : 90_000);
    const deadline = Date.now() + effectiveTimeout;
    this.#loginProgress('checking_canva', 'Confirming Canva without interrupting you…');
    let authentication = await this.#canvaAuthenticationStatus(page);
    while (!authentication.authenticated && Date.now() < deadline) {
      await sleep(Math.max(50, Number(pollIntervalMs) || 400));
      authentication = await this.#canvaAuthenticationStatus(page);
    }
    const accountProfile = authentication.authenticated ? await this.accountProfile(page) : null;
    if (authentication.authenticated) {
      await this.#persistLoginState('canva');
      await this.closeLoginBrowser();
      this.interactiveVisible = false;
      await this.#parkWindow(page);
      this.#loginProgress('verified', 'Canva connected in the background.');
      return {
        ...authentication,
        ...imported,
        accountProfile,
        engine: 'canva',
        restored: alreadySaved,
        importWarning: importError ? { code: importError.code ?? 'SESSION_IMPORT_FAILED', message: importError.message } : null
      };
    }
    const error = importError ?? Object.assign(new Error('Canva is not signed in yet. Click Sign in once, finish login, then verify.'), {
      code: 'CANVA_SESSION_INVALID'
    });
    error.authenticationStatus = authentication;
    this.#loginProgress('verification_failed', error.message);
    throw error;
  }

  async #canvaClickByName(page, pattern, timeoutMs = 4_000) {
    const budget = Math.max(200, Number(timeoutMs) || 4_000);
    const startedAt = Date.now();
    const roles = ['button', 'link', 'menuitem', 'tab', 'option', 'switch'];
    while (Date.now() - startedAt < budget) {
      this.#throwIfCancelled();
      for (const role of roles) {
        const locator = page.getByRole(role, { name: pattern }).first();
        if (await locator.isVisible({ timeout: 0 }).catch(() => false)) {
          await locator.click({ force: true, timeout: Math.min(1_200, budget) }).catch(() => {});
          return true;
        }
      }
      const text = page.getByText(pattern).first();
      if (await text.isVisible({ timeout: 0 }).catch(() => false)) {
        await text.click({ force: true, timeout: Math.min(1_200, budget) }).catch(() => {});
        return true;
      }
      await this.#sleepOrPause(40);
    }
    return false;
  }

  async #canvaClickFirst(page, patterns, timeoutMs = 2_000) {
    for (const pattern of patterns) {
      if (await this.#canvaClickByName(page, pattern, timeoutMs)) return true;
    }
    return false;
  }

  #debugCanva(hypothesisId, location, message, data = {}) {
    // #region agent log
    const payload = { sessionId: '375888', runId: data.runId || 'post-fix', hypothesisId, location, message, data, timestamp: Date.now() };
    fetch('http://127.0.0.1:7896/ingest/06345b60-768a-4a45-844a-992260955dff', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '375888' }, body: JSON.stringify(payload) }).catch(() => {});
    try { appendFileSync('/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )/.cursor/debug-375888.log', `${JSON.stringify(payload)}\n`); } catch {}
    this.#debugCanvaUpload(hypothesisId, location, message, data);
    // #endregion
  }

  #debugCanvaUpload(hypothesisId, location, message, data = {}) {
    // #region agent log
    const payload = { sessionId: '2f6f56', runId: data.runId || 'post-fix', hypothesisId, location, message, data, timestamp: Date.now() };
    fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '2f6f56' }, body: JSON.stringify(payload) }).catch(() => {});
    try { appendFileSync('/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )/.cursor/debug-2f6f56.log', `${JSON.stringify(payload)}\n`); } catch {}
    // #endregion
  }

  async #waitForCanvaEditor(page, timeoutMs = 90_000, { allowShareOnly = false } = {}) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      this.#throwIfCancelled();
      const share = await page.getByRole('button', { name: /^share$/i }).first().isVisible({ timeout: 0 }).catch(() => false);
      if (canvaDesignId(page.url())) {
        const pages = await this.#canvaEditorPageCount(page);
        if (share || pages > 0) return true;
      }
      if (allowShareOnly && share) return true;
      await this.#sleepOrPause(400);
    }
    throw Object.assign(new Error('Canva did not open an editor for this design. Confirm Canva Pro is signed in, then try again.'), {
      code: 'CANVA_EDITOR_TIMEOUT'
    });
  }

  async #canvaDismissTours(page) {
    await this.#canvaClickFirst(page, [
      /^got it$/i,
      /not now/i,
      /maybe later/i,
      /^skip$/i,
      /skip tour/i
    ], 280);
  }

  async #canvaDismissPrintReview(page) {
    const open = await page.getByText(/review your design/i).first().isVisible({ timeout: 0 }).catch(() => false);
    if (!open) return false;
    const result = await page.evaluate(() => {
      const heading = [...document.querySelectorAll('h1, h2, h3, h4, [role="heading"], div, span, p')].find((el) => {
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        return /^review your design$/i.test(text);
      });
      if (!heading) return { closed: false, reason: 'no-heading', buttons: [] };
      const panel = heading.closest('aside, [role="dialog"], [role="complementary"]') || heading.parentElement;
      if (!panel) return { closed: false, reason: 'no-panel', buttons: [] };
      const buttons = [...panel.querySelectorAll('button, [role="button"]')].slice(0, 16).map((el) => ({
        aria: (el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim(),
        title: (el.getAttribute('title') || '').replace(/\s+/g, ' ').trim(),
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80)
      }));
      const close = [...panel.querySelectorAll('button, [role="button"]')].find((el) => {
        const label = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`.replace(/\s+/g, ' ').trim();
        return /close|dismiss/i.test(label);
      });
      if (!close) return { closed: false, reason: 'no-close-label', buttons };
      close.click();
      return { closed: true, reason: 'clicked-close', buttons };
    }).catch(() => ({ closed: false, reason: 'evaluate-failed', buttons: [] }));
    // #region agent log
    this.#debugCanva('C', 'browser-controller.cjs:#canvaDismissPrintReview', 'print-review dismiss', result);
    // #endregion
    if (!result?.closed) await page.keyboard.press('Escape').catch(() => {});
    await this.#sleepOrPause(220);
    return true;
  }

  async #canvaDismissPopups(page) {
    await this.#canvaDismissPrintReview(page);
    await this.#canvaDismissTours(page);
  }

  async #canvaClickExact(page, pattern, timeoutMs = 3_000) {
    const source = pattern instanceof RegExp ? pattern.source : `^${String(pattern || '')}$`;
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      this.#throwIfCancelled();
      const clicked = await page.evaluate((sourceText) => {
        const matcher = new RegExp(sourceText, 'i');
        const inPrintReview = (el) => {
          let node = el;
          while (node && node !== document.body) {
            const text = (node.innerText || '').slice(0, 700);
            if (/review your design/i.test(text) && /auto-adjust|add to cart|checkout/i.test(text)) return true;
            node = node.parentElement;
          }
          return false;
        };
        const nodes = [...document.querySelectorAll('button, a, [role="button"], [role="menuitem"], [role="tab"], [role="option"]')];
        for (const el of nodes) {
          if (inPrintReview(el)) continue;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
          const box = el.getBoundingClientRect();
          if (box.width < 6 || box.height < 6) continue;
          const aria = (el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
          const titled = (el.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
          const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
          const names = [aria, titled, text].filter(Boolean);
          if (!names.some((name) => matcher.test(name))) continue;
          el.click();
          return true;
        }
        return false;
      }, source).catch(() => false);
      if (clicked) return true;
      await this.#sleepOrPause(80);
    }
    return false;
  }

  async #canvaImageToolbarVisible(page) {
    return page.evaluate(() => {
      const blocks = [...document.querySelectorAll('[role="toolbar"], [data-testid*="toolbar" i], div, nav')];
      return blocks.some((el) => {
        const text = `${el.getAttribute('aria-label') || ''} ${el.innerText || ''}`.replace(/\s+/g, ' ').trim();
        if (!text || text.length > 420) return false;
        // Text/shape toolbars also show Animate/Position/Effects — those alone are NOT an image.
        // Live fail (Name Tracing): center click selects Funtastic text → Magic Layers → "use another image".
        if (/font selector|font size|current text color|(^|\b)bold(\b|$)|(^|\b)italics(\b|$)/i.test(text)) return false;
        const hasEdit = /(^|\b)edit(\b|$)/i.test(text) || /edit image/i.test(text);
        const hasPhotoTools = /bg remover|background remover|(^|\b)eraser(\b|$)|(^|\b)crop(\b|$)|(^|\b)flip(\b|$)/i.test(text);
        return hasEdit && hasPhotoTools;
      });
    }).catch(() => false);
  }

  async #canvaProbeEditImagePanel(page) {
    const dom = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('button, [role="button"], [aria-label]')];
      const editArias = [];
      let toggleOpen = false;
      let pressedEdit = false;
      let magicVisible = false;
      let headingVisible = false;
      for (const el of nodes) {
        const aria = (el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (/edit/i.test(aria) && editArias.length < 8) editArias.push(aria);
        if (/edit panel open/i.test(aria)) toggleOpen = true;
        const isEdit = /edit panel open/i.test(aria)
          || /^(edit|edit image|edit photo)$/i.test(aria)
          || /^(edit|edit image|edit photo)$/i.test(text);
        if (isEdit && (el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-expanded') === 'true')) {
          pressedEdit = true;
        }
        const style = window.getComputedStyle(el);
        const box = el.getBoundingClientRect();
        const shown = style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && box.width > 4 && box.height > 4;
        if (!shown) continue;
        if (/^magic layers$/i.test(aria) || /^magic layers$/i.test(text) || /^magic studio$/i.test(aria) || /^magic studio$/i.test(text)) {
          magicVisible = true;
        }
        if (/^edit image$|^edit photo$|^magic studio$/i.test(text) && text.length < 24) headingVisible = true;
      }
      return { toggleOpen, pressedEdit, magicVisible, headingVisible, editArias };
    }).catch(() => ({ toggleOpen: false, pressedEdit: false, magicVisible: false, headingVisible: false, editArias: [] }));
    const toggleRole = await page.getByRole('button', { name: /edit panel open/i }).first().isVisible({ timeout: 0 }).catch(() => false)
      || await page.getByLabel(/edit panel open/i).first().isVisible({ timeout: 0 }).catch(() => false);
    const heading = await page.getByText(/^edit image$|^edit photo$|^magic studio$/i).first().isVisible({ timeout: 0 }).catch(() => false);
    const magic = await page.getByText(/^magic layers$/i).first().isVisible({ timeout: 0 }).catch(() => false)
      || await page.getByRole('button', { name: /^magic layers$/i }).first().isVisible({ timeout: 0 }).catch(() => false)
      || await page.getByRole('button', { name: /^magic studio$/i }).first().isVisible({ timeout: 0 }).catch(() => false)
      || await page.getByRole('button', { name: /magic layers/i }).first().isVisible({ timeout: 0 }).catch(() => false);
    const aside = await page.locator('aside, [role="dialog"], [role="complementary"]').getByText(/magic layers|edit image|edit photo/i).first().isVisible({ timeout: 0 }).catch(() => false);
    const open = Boolean(dom.toggleOpen || dom.pressedEdit || dom.magicVisible || dom.headingVisible || toggleRole || magic || heading || aside);
    return { ...dom, toggleRole, heading, magic, aside, open };
  }

  async #canvaEditImagePanelOpen(page) {
    const probe = await this.#canvaProbeEditImagePanel(page);
    return Boolean(probe.open);
  }

  async #canvaMagicLayersToast(page) {
    return page.evaluate(() => {
      const hard = /can['’]t use magic layers|couldn['’]t (apply|process|create) layers|you['’]ve reached .{0,40}(limit|usage)|use another image/i;
      const leftover = /something went wrong|try another thing|try again later/i;
      const texts = [];
      for (const el of document.querySelectorAll('[role="status"], [role="alert"], [role="alertdialog"], [data-testid*="toast" i], [data-testid*="snackbar" i]')) {
        const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (text) texts.push(text.slice(0, 180));
      }
      const body = (document.body?.innerText || '').slice(0, 9000);
      const hay = `${texts.join(' ')} ${body}`;
      const snippet = texts.find((text) => hard.test(text) || leftover.test(text))
        || (hay.match(hard) || hay.match(leftover) || [])[0]
        || null;
      const useAnother = /use another image/i.test(hay);
      return {
        hardBlocked: hard.test(hay),
        leftover: leftover.test(hay) && !hard.test(hay) && !useAnother,
        useAnother,
        snippet: snippet ? String(snippet).slice(0, 160) : null
      };
    }).catch(() => ({ hardBlocked: false, leftover: false, useAnother: false, snippet: null }));
  }

  async #canvaDismissLeftoverToasts(page) {
    const toast = await this.#canvaMagicLayersToast(page);
    if (!(toast.leftover || toast.useAnother || toast.hardBlocked)) return toast;
    await page.keyboard.press('Escape').catch(() => {});
    await page.evaluate(() => {
      const bad = /something went wrong|try another thing|try again later|use another image/i;
      for (const host of document.querySelectorAll('[role="status"], [role="alert"], [role="alertdialog"], [data-testid*="toast" i], [data-testid*="snackbar" i], [class*="toast" i], [class*="Snackbar" i]')) {
        const text = (host.innerText || '').replace(/\s+/g, ' ');
        if (!bad.test(text)) continue;
        const close = [...host.querySelectorAll('button, [role="button"]')].find((el) => {
          const label = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${el.textContent || ''}`.replace(/\s+/g, ' ').trim();
          return /close|dismiss|got it|ok/i.test(label);
        });
        if (close) close.click();
        else host.remove();
      }
    }).catch(() => {});
    await this.#sleepOrPause(120);
    return toast;
  }

  async #canvaMagicLayersBusy(page) {
    const busyPattern = /processing|turning .+ into|applying magic|magic layers is working|creating layers|extracting|separating|preparing your layers|working on it|analyzing|generating (your )?layers|please wait|just a (sec|moment|second)|hang tight|this may take/i;
    if (await page.getByText(busyPattern).first().isVisible({ timeout: 0 }).catch(() => false)) return true;
    return page.evaluate(() => {
      const shells = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [aria-modal="true"], aside')];
      for (const shell of shells) {
        const heading = (shell.innerText || '').slice(0, 500);
        const relevant = /edit image|edit photo|magic layers|processing|creating layers/i.test(heading)
          || shell.matches('[role="dialog"], [role="alertdialog"], [aria-modal="true"]');
        if (!relevant) continue;
        if (shell.getAttribute('aria-busy') === 'true' || shell.querySelector('[aria-busy="true"]')) return true;
        if (shell.querySelector('[role="progressbar"], [data-testid*="spinner" i], [data-testid*="loading" i], [class*="spinner" i]')) return true;
        if (/processing|creating layers|applying|please wait|analyzing|generating/i.test(heading)) return true;
      }
      const magic = [...document.querySelectorAll('[aria-label="Magic Layers"], [aria-label*="Magic Layers" i]')];
      for (const el of magic) {
        if (el.getAttribute('aria-busy') === 'true') return true;
        if (el.querySelector('[role="progressbar"], [aria-busy="true"]')) return true;
      }
      return false;
    }).catch(() => false);
  }

  async #canvaCanvasClickPoint(page, options = {}) {
    const hx = Math.min(0.86, Math.max(0.14, Number(options.horizontalFraction) || 0.5));
    const vy = Math.min(0.82, Math.max(0.18, Number(options.verticalFraction) || 0.48));
    const probe = await page.evaluate(({ hx, vy }) => {
      const heading = [...document.querySelectorAll('h1, h2, h3, h4, [role="heading"], div, span, p')].find((el) => {
        return /^review your design$/i.test((el.textContent || '').replace(/\s+/g, ' ').trim());
      });
      let maxRight = window.innerWidth;
      if (heading) {
        const panel = heading.closest('aside, [role="dialog"], [role="complementary"]') || heading.parentElement;
        const left = panel?.getBoundingClientRect?.().left;
        if (Number.isFinite(left) && left > 240) maxRight = left - 12;
      }
      const viewport = { w: window.innerWidth, h: window.innerHeight };
      const topSafe = 96;
      const bottomSafe = Math.max(topSafe + 80, viewport.h - 132);
      const leftSafe = 96;
      const rightSafe = Math.max(leftSafe + 80, maxRight - 12);
      const rects = [...document.querySelectorAll('img, canvas, [data-testid*="canvas" i]')]
        .map((el) => {
          const box = el.getBoundingClientRect();
          return {
            tag: el.tagName,
            left: box.left,
            top: box.top,
            width: box.width,
            height: box.height,
            right: box.right,
            bottom: box.bottom
          };
        })
        .filter((box) => box.width > 160 && box.height > 160 && box.left > 88 && box.left < maxRight && box.right > 120 && box.top < bottomSafe);
      rects.sort((left, right) => (right.width * right.height) - (left.width * left.height));
      const box = rects[0];
      if (!box) {
        return {
          x: Math.min(viewport.w * 0.36, maxRight - 80),
          y: viewport.h * 0.42,
          viewport,
          naiveY: viewport.h * 0.48,
          reason: 'fallback',
          fractions: { hx, vy }
        };
      }
      const visLeft = Math.max(box.left, leftSafe);
      const visRight = Math.min(box.right, rightSafe);
      const visTop = Math.max(box.top, topSafe);
      const visBottom = Math.min(box.bottom, bottomSafe);
      const visW = visRight - visLeft;
      const visH = visBottom - visTop;
      const naiveY = box.top + (box.height * 0.48);
      const x = visW > 40 ? visLeft + (visW * hx) : box.left + (box.width * 0.5);
      const y = visH > 40 ? visTop + (visH * vy) : Math.min(Math.max(box.top + 80, topSafe), bottomSafe - 40);
      return {
        x,
        y,
        viewport,
        naiveY,
        offscreen: naiveY > viewport.h || naiveY < 0,
        box,
        visible: { left: visLeft, top: visTop, width: visW, height: visH },
        reason: 'visible-intersection',
        fractions: { hx, vy }
      };
    }, { hx, vy }).catch(() => null);
    // #region agent log
    this.#debugCanva('G', 'browser-controller.cjs:#canvaCanvasClickPoint', 'canvas click point', {
      x: probe?.x,
      y: probe?.y,
      viewport: probe?.viewport,
      naiveY: probe?.naiveY,
      offscreen: probe?.offscreen,
      reason: probe?.reason,
      visible: probe?.visible,
      fractions: probe?.fractions || { hx, vy },
      runId: 'post-fix',
      hypothesisId: 'G'
    });
    // #endregion
    if (probe && Number.isFinite(probe.x) && Number.isFinite(probe.y)) return { x: probe.x, y: probe.y };
    return { x: 460, y: 420 };
  }

  async #canvaIsRoadblockPage(page) {
    const url = String(page?.url?.() || '');
    const hostOk = /\.canva\.com$/i.test((() => { try { return new URL(url).hostname; } catch { return ''; } })());
    const body = await page.evaluate(() => String(document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 900)).catch(() => '');
    const roadblock = /looks like we hit a roadblock|that link doesn['’]?t work|error:\s*404/i.test(body);
    // #region agent log
    this.#debugCanvaUpload('404', 'browser-controller.cjs:#canvaIsRoadblockPage', 'roadblock check', {
      hostOk,
      roadblock,
      url: url.slice(0, 180),
      runId: 'post-fix',
      hypothesisId: '404'
    });
    // #endregion
    return Boolean(roadblock);
  }

  async #canvaEnsureEditorPage(page, designUrl = '') {
    const url = String(page?.url?.() || '');
    const closed = Boolean(!page || page.isClosed?.());
    const roadblock = !closed && await this.#canvaIsRoadblockPage(page).catch(() => false);
    const alive = !closed && !roadblock && Boolean(canvaDesignId(url));
    // #region agent log
    this.#debugCanva('W', 'browser-controller.cjs:#canvaEnsureEditorPage', 'editor alive', {
      url: url.slice(0, 180),
      closed,
      roadblock,
      alive,
      runId: 'post-fix'
    });
    // #endregion
    const target = toCanvaDesignUrl(designUrl)
      || toCanvaDesignUrl(this.canvaResumeDesignUrl)
      || toCanvaDesignUrl(this.canvaJob?.designUrl)
      || '';
    let next = page;
    if (roadblock) {
      // Dead design URL (Canva 404 roadblock). Do not keep resuming it.
      this.canvaResumeDesignUrl = '';
      if (this.canvaJob) this.canvaJob.designUrl = null;
      if (next && !next.isClosed?.()) {
        await next.goto(CANVA_HOME_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => null);
      }
      throw Object.assign(new Error('This Canva design link is dead (404 roadblock). VERSA will stop resuming it — run Canva again to import the print PDF into a fresh design.'), {
        code: 'CANVA_DESIGN_ROADBLOCK',
        abandonDesignUrl: true
      });
    }
    if (alive) {
      const share = await next.getByRole('button', { name: /^share$/i }).first().isVisible({ timeout: 0 }).catch(() => false);
      if (share) return next;
    }
    try {
      next = await this.#canvaPage({ allowExistingDesign: true });
    } catch {}
    if (next && canvaDesignId(next.url())) {
      this.canvaPage = next;
      const share = await next.getByRole('button', { name: /^share$/i }).first().isVisible({ timeout: 2_000 }).catch(() => false);
      if (share) return next;
    }
    if (target && next && !next.isClosed?.()) {
      await next.goto(target, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => null);
      await this.#waitForCanvaEditor(next, 25_000).catch(() => null);
      if (canvaDesignId(next.url())) {
        this.canvaPage = next;
        return next;
      }
    }
    if (target) {
      try {
        next = await this.#canvaPage({ allowExistingDesign: false });
        await next.goto(target, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await this.#waitForCanvaEditor(next, 25_000).catch(() => null);
        this.canvaPage = next;
        return next;
      } catch {}
    }
    return next || page;
  }

  async #canvaSelectionToolbarNames(page) {
    return page.evaluate(() => {
      const names = [...document.querySelectorAll('[role="toolbar"] button, [role="toolbar"] [role="button"]')]
        .map((el) => (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim())
        .filter((name) => name && name.length < 48)
        .slice(0, 16);
      return names;
    }).catch(() => []);
  }

  async #canvaSelectPageImage(page, options = {}) {
    await this.#canvaDismissPrintReview(page);
    await page.keyboard.press('Escape').catch(() => {});
    await this.#sleepOrPause(180);
    // Prefer page-image margins first. Worksheet PDFs (Name Tracing) put editable text in the
    // center; center clicks select text → Magic Layers rejects with "use another image".
    // Live grid scan: image toolbar at hx≈0.15; center hx=0.5 → Funtastic text toolbar.
    const fractionPasses = [
      { horizontalFraction: 0.12, verticalFraction: 0.35 },
      { horizontalFraction: 0.12, verticalFraction: 0.5 },
      { horizontalFraction: 0.12, verticalFraction: 0.65 },
      { horizontalFraction: 0.88, verticalFraction: 0.35 },
      { horizontalFraction: 0.88, verticalFraction: 0.55 },
      { horizontalFraction: 0.2, verticalFraction: 0.4 },
      { horizontalFraction: 0.8, verticalFraction: 0.4 },
      {
        horizontalFraction: Number.isFinite(options.horizontalFraction) ? options.horizontalFraction : 0.5,
        verticalFraction: Number.isFinite(options.verticalFraction) ? options.verticalFraction : 0.48
      }
    ];
    const offsets = [[0, 0], [0, -22], [0, 36], [-28, 14], [22, 18], [0, -60], [80, 0], [-80, 0], [-120, 0], [120, 0]];
    let lastPoint = null;
    let lastToolbar = [];
    for (const frac of fractionPasses) {
      this.#throwIfCancelled();
      const point = await this.#canvaCanvasClickPoint(page, frac);
      lastPoint = point;
      for (const [dx, dy] of offsets) {
        this.#throwIfCancelled();
        await page.mouse.click(point.x + dx, point.y + dy).catch(() => {});
        await this.#sleepOrPause(70);
        lastToolbar = await this.#canvaSelectionToolbarNames(page);
        if (await this.#canvaImageToolbarVisible(page)) {
          // #region agent log
          this.#debugCanva('G', 'browser-controller.cjs:#canvaSelectPageImage', 'image toolbar after canvas click', {
            ok: true,
            point,
            dx,
            dy,
            toolbar: lastToolbar,
            fractions: frac,
            runId: 'post-fix',
            hypothesisId: 'SEL'
          });
          this.#debugCanvaUpload('SEL', 'browser-controller.cjs:#canvaSelectPageImage', 'selected page IMAGE not text', {
            toolbar: lastToolbar,
            fractions: frac,
            dx,
            dy,
            runId: 'post-fix',
            hypothesisId: 'SEL'
          });
          // #endregion
          return true;
        }
      }
    }
    if (lastPoint) {
      await page.mouse.dblclick(lastPoint.x, lastPoint.y).catch(() => {});
      await this.#sleepOrPause(140);
      if (await this.#canvaImageToolbarVisible(page)) return true;
      const extra = [
        [lastPoint.x, lastPoint.y - 90],
        [lastPoint.x, lastPoint.y + 90],
        [lastPoint.x - 140, lastPoint.y],
        [lastPoint.x + 140, lastPoint.y],
        [lastPoint.x - 70, lastPoint.y - 70],
        [lastPoint.x + 70, lastPoint.y + 70]
      ];
      for (const [x, y] of extra) {
        await page.mouse.click(x, y).catch(() => {});
        await this.#sleepOrPause(80);
        if (await this.#canvaImageToolbarVisible(page)) return true;
      }
    }
    const ok = await this.#canvaImageToolbarVisible(page);
    lastToolbar = await this.#canvaSelectionToolbarNames(page);
    // #region agent log
    this.#debugCanva('F', 'browser-controller.cjs:#canvaSelectPageImage', 'image toolbar after canvas clicks', {
      ok,
      point: lastPoint,
      toolbar: lastToolbar,
      textLikely: /font selector|font size|Bold|Italics|Current text color/i.test(lastToolbar.join(' ')),
      url: String(page.url?.() || '').slice(0, 180),
      closed: Boolean(page.isClosed?.()),
      runId: 'post-fix',
      hypothesisId: 'SEL'
    });
    this.#debugCanvaUpload('SEL', 'browser-controller.cjs:#canvaSelectPageImage', 'page image select result', {
      ok,
      toolbar: lastToolbar,
      textLikely: /font selector|font size|Bold|Italics|Current text color/i.test(lastToolbar.join(' ')),
      runId: 'post-fix',
      hypothesisId: 'SEL'
    });
    // #endregion
    return ok;
  }

  async #canvaClickToolbarEdit(page) {
    if (await this.#canvaEditImagePanelOpen(page)) return true;
    const result = await page.evaluate(() => {
      const inPrintReview = (el) => {
        let node = el;
        while (node && node !== document.body) {
          const text = (node.innerText || '').slice(0, 700);
          if (/review your design/i.test(text) && /auto-adjust|add to cart|checkout/i.test(text)) return true;
          node = node.parentElement;
        }
        return false;
      };
      const nodes = [...document.querySelectorAll('button, [role="button"]')];
      const candidates = [];
      const hit = nodes.find((el) => {
        if (inPrintReview(el)) return false;
        const aria = (el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        const joined = `${aria} ${text}`.replace(/\s+/g, ' ').trim();
        const bar = el.closest('[role="toolbar"]') || el.parentElement || el;
        const nearby = `${bar.getAttribute('aria-label') || ''} ${bar.innerText || ''}`.replace(/\s+/g, ' ');
        const photo = /bg remover|background remover|eraser|flip|effects|animate|position/i.test(nearby);
        const exactJoin = /^(edit|edit image)$/i.test(joined);
        const exactParts = /^(edit|edit image|edit photo)$/i.test(aria) || /^(edit|edit image|edit photo)$/i.test(text);
        if (/edit/i.test(`${aria} ${text}`) && photo) {
          candidates.push({
            aria,
            text: text.slice(0, 80),
            joined: joined.slice(0, 120),
            exactJoin,
            exactParts,
            photo
          });
        }
        if (!(exactParts || exactJoin)) return false;
        return photo;
      });
      return { found: Boolean(hit), candidates: candidates.slice(0, 8) };
    }).catch(() => ({ found: false, candidates: [] }));
    // #region agent log
    this.#debugCanva('A', 'browser-controller.cjs:#canvaClickToolbarEdit', 'toolbar Edit match', result);
    // #endregion
    if ((result.candidates || []).some((row) => /edit panel open/i.test(`${row.aria || ''} ${row.joined || ''}`))) {
      // #region agent log
      this.#debugCanva('A', 'browser-controller.cjs:#canvaClickToolbarEdit', 'skip Edit click, panel already open', {
        runId: 'post-fix',
        hypothesisId: 'A'
      });
      // #endregion
      return true;
    }
    const clicked = await page.evaluate(() => {
      const inPrintReview = (el) => {
        let node = el;
        while (node && node !== document.body) {
          const text = (node.innerText || '').slice(0, 700);
          if (/review your design/i.test(text) && /auto-adjust|add to cart|checkout/i.test(text)) return true;
          node = node.parentElement;
        }
        return false;
      };
      const hit = [...document.querySelectorAll('button, [role="button"]')].find((el) => {
        if (inPrintReview(el)) return false;
        const aria = (el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
        if (/edit panel open/i.test(aria)) return false;
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        const bar = el.closest('[role="toolbar"]') || el.parentElement || el;
        const nearby = `${bar.getAttribute('aria-label') || ''} ${bar.innerText || ''}`.replace(/\s+/g, ' ');
        const photo = /bg remover|background remover|eraser|flip|effects|animate|position/i.test(nearby);
        const exactJoin = /^(edit|edit image)$/i.test(`${aria} ${text}`.replace(/\s+/g, ' ').trim());
        const exactParts = /^(edit|edit image|edit photo)$/i.test(aria) || /^(edit|edit image|edit photo)$/i.test(text);
        return photo && (exactParts || exactJoin);
      });
      if (!hit) return false;
      hit.click();
      return true;
    }).catch(() => false);
    if (clicked) {
      await this.#sleepOrPause(180);
      return true;
    }
    const locators = [
      page.locator('[role="toolbar"] button[aria-label="Edit"], [role="toolbar"] [role="button"][aria-label="Edit"]').first(),
      page.getByRole('toolbar').getByRole('button', { name: /^(edit image|edit photo)$/i }).first(),
      page.getByRole('button', { name: /^(edit image|edit photo)$/i }).first(),
      page.getByRole('toolbar').getByRole('button', { name: /^edit$/i }).first()
    ];
    for (const loc of locators) {
      if (!(await loc.isVisible({ timeout: 0 }).catch(() => false))) continue;
      await loc.click({ force: true, timeout: 1_500 }).catch(() => {});
      await this.#sleepOrPause(180);
      return true;
    }
    return false;
  }

  async #canvaClickMagicLayersTool(page) {
    const panelOpen = await this.#canvaEditImagePanelOpen(page);
    const probe = await page.evaluate(() => {
      const heading = [...document.querySelectorAll('h1,h2,h3,h4,[role="heading"],div,span,p,header')]
        .some((el) => /^edit image$|^edit photo$/i.test((el.textContent || '').replace(/\s+/g, ' ').trim()));
      const tools = [...document.querySelectorAll('button, [role="button"], [aria-label]')].map((el) => {
        const aria = (el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        const joined = `${aria} ${text}`.replace(/\s+/g, ' ').trim();
        return {
          aria,
          text: text.slice(0, 80),
          joined: joined.slice(0, 120),
          disabled: el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('disabled')
        };
      }).filter((row) => /magic/i.test(`${row.aria} ${row.text}`)).slice(0, 12);
      return { heading, tools };
    }).catch(() => ({ heading: false, tools: [] }));
    const magicBtn = page.getByRole('button', { name: /^magic layers\b/i }).first();
    const ariaBtn = page.locator('button[aria-label="Magic Layers"], [role="button"][aria-label="Magic Layers"]').first();
    let clicked = false;
    let clickPath = 'none';
    if (await magicBtn.isVisible({ timeout: 0 }).catch(() => false)) {
      await magicBtn.scrollIntoViewIfNeeded().catch(() => {});
      await magicBtn.hover({ timeout: 800 }).catch(() => {});
      await magicBtn.click({ force: true, timeout: 1_500 }).catch(() => {});
      clicked = true;
      clickPath = 'role';
    } else if (await ariaBtn.isVisible({ timeout: 0 }).catch(() => false)) {
      await ariaBtn.click({ force: true, timeout: 1_500 }).catch(() => {});
      clicked = true;
      clickPath = 'aria';
    }
    if (!clicked) {
      const magicCaption = page.getByText(/^magic layers$/i).first();
      if (await magicCaption.isVisible({ timeout: 0 }).catch(() => false)) {
        const box = await magicCaption.boundingBox().catch(() => null);
        await magicCaption.click({ force: true, timeout: 1_500 }).catch(() => {});
        clicked = true;
        clickPath = 'caption';
        if (box) {
          await page.mouse.click(box.x + (box.width / 2), Math.max(8, box.y - 18)).catch(() => {});
          clickPath = 'caption+icon';
        }
      }
    }
    if (!clicked) {
      clicked = await page.evaluate(() => {
        const hit = [...document.querySelectorAll('button, [role="button"], [aria-label], span, p, div, li')].find((el) => {
          const aria = (el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
          const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
          if (text.length > 28) return false;
          return /^magic layers$/i.test(aria) || /^magic layers$/i.test(text);
        });
        if (!hit) return false;
        (hit.closest('button, [role="button"]') || hit).click();
        return true;
      }).catch(() => false);
      if (clicked) clickPath = 'dom';
    }
    if (!clicked) {
      const studioBtn = page.getByRole('button', { name: /^magic studio$/i }).first();
      if (await studioBtn.isVisible({ timeout: 0 }).catch(() => false)) {
        await studioBtn.click({ force: true, timeout: 1_200 }).catch(() => {});
        await this.#sleepOrPause(160);
        clickPath = 'studio';
      }
      clicked = await this.#canvaClickExact(page, /^(magic layers|magic layer)\b/, 900)
        || await this.#canvaClickFirst(page, [/^magic layers$/i, /^magic layer$/i, /^magic layers\b/i], 400);
      if (clicked) clickPath = clickPath === 'studio' ? 'studio+exact' : 'exact';
    }
    await this.#sleepOrPause(280);
    let busyAfter = await this.#canvaMagicLayersBusy(page);
    // Sacred: do NOT second-click Magic Layers / icon after a successful role/aria click.
    // That extra click closes the Create layers confirm before #canvaClickCreateLayers runs
    // (live fail: created:false after clickPath role+icon → CANVA_MAGIC_LAYERS_NOT_STARTED).
    if (!clicked && !busyAfter) {
      const magicCaption = page.getByText(/^magic layers$/i).first();
      if (await magicCaption.isVisible({ timeout: 0 }).catch(() => false)) {
        const box = await magicCaption.boundingBox().catch(() => null);
        if (box) {
          await page.mouse.click(box.x + (box.width / 2), Math.max(8, box.y - 22)).catch(() => {});
          clickPath = `${clickPath}+icon`;
          clicked = true;
          await this.#sleepOrPause(280);
          busyAfter = await this.#canvaMagicLayersBusy(page);
        }
      }
    }
    // #region agent log
    this.#debugCanva('L', 'browser-controller.cjs:#canvaClickMagicLayersTool', 'Magic Layers click probe', { panelOpen, clicked, clickPath, busyAfter, secondClickSkipped: true, ...probe });
    // #endregion
    return clicked;
  }

  async #canvaClickLabeled(page, pattern) {
    const source = pattern instanceof RegExp ? pattern.source : String(pattern || '');
    if (!source) return false;
    return page.evaluate((sourceText) => {
      const matcher = new RegExp(sourceText, 'i');
      const nodes = [...document.querySelectorAll('button, a, [role="button"], [role="menuitem"], [role="option"], [role="tab"], [aria-label]')];
      const hit = nodes.find((el) => {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        const aria = (el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        return matcher.test(aria) || matcher.test(text);
      });
      if (!hit) return false;
      hit.click();
      return true;
    }, source).catch(() => false);
  }

  #isCanvaPauseError(error) {
    return Boolean(error) && (error.code === 'QUEUE_PAUSED' || /waiting was paused/i.test(String(error.message || '')));
  }

  #canvaThrowIfPageCountMismatch(actual, expected) {
    const got = Number(actual) || 0;
    const want = Number(expected) || 0;
    if (got !== want) {
      throw Object.assign(
        new Error(`Canva page count is ${got} but this book has ${want} pages. Import was not verified. Not continuing.`),
        { code: 'CANVA_PAGE_COUNT_MISMATCH' }
      );
    }
  }

  async #canvaVerifyPageSelected(page) {
    return this.#canvaImageToolbarVisible(page);
  }

  async #canvaPageLooksLayered(page) {
    const inspect = await this.#canvaInspectLayerCount(page);
    const probe = await page.evaluate(() => {
      const visible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        const box = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && box.width > 2 && box.height > 2;
      };
      const names = [...document.querySelectorAll('button, [role="button"]')]
        .filter(visible)
        .map((el) => {
          const aria = (el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
          const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
          return `${aria} ${text}`.replace(/\s+/g, ' ').trim();
        });
      const ungroup = names.some((name) => /ungroup/i.test(name) && name.length < 48);
      const group = names.some((name) => /^(group|ungroup)$/i.test(name) || /^group /i.test(name));
      const tree = document.querySelectorAll('#layers [role="treeitem"], [aria-label*="layer" i] [role="treeitem"], [data-testid*="layer" i] [role="treeitem"]').length;
      const layerRows = document.querySelectorAll('[data-testid*="layer-item" i], [aria-label*="layers" i] [role="listitem"]').length;
      const body = (document.body?.innerText || '').slice(0, 9000);
      const counted = body.match(/(\d+)\s*(objects?|layers?)\b/i);
      const n = counted ? Number(counted[1]) : 0;
      const toast = /layers (created|applied|ready)|turned (it|this|the image) into layers|separated into/i.test(body);
      const toolbarHits = names.filter((name) => /group|layer|ungroup|position|edit image/i.test(name)).slice(0, 12);
      return { ungroup, group, tree, layerRows, n, toast, toolbarHits };
    }).catch(() => ({ ungroup: false, group: false, tree: 0, layerRows: 0, n: 0, toast: false, toolbarHits: [] }));
    const ungroupBtn = await page.getByRole('button', { name: /ungroup/i }).first().isVisible({ timeout: 0 }).catch(() => false);
    const groupBtn = await page.getByRole('button', { name: /^(group|ungroup)$/i }).first().isVisible({ timeout: 0 }).catch(() => false);
    const count = inspect > 1
      ? inspect
      : (probe.tree > 1 ? probe.tree : (probe.layerRows > 1 ? probe.layerRows : (probe.n > 1 ? probe.n : inspect)));
    const ok = Boolean(ungroupBtn || probe.ungroup || probe.toast || (Number(count) > 1) || probe.tree > 1 || probe.layerRows > 1 || probe.n > 1);
    return { ok, count: Number(count) > 1 ? Number(count) : (ok ? 2 : count), signals: { ...probe, ungroupBtn, groupBtn } };
  }

  async #canvaWaitWhileMagicLayersRuns(page, timeoutMs = 150_000, onTick = null, options = {}) {
    const startedAt = Date.now();
    const assumedStarted = Boolean(options?.assumedStarted);
    let sawBusy = await this.#canvaMagicLayersBusy(page);
    let lastTickAt = 0;
    let busyEndedAt = 0;
    let leftoverLogged = false;
    const tick = async () => {
      if (typeof onTick !== 'function') return;
      const now = Date.now();
      if (now - lastTickAt < 4_000 && lastTickAt) return;
      lastTickAt = now;
      await onTick({
        elapsedMs: now - startedAt,
        busy: sawBusy || assumedStarted
      });
    };
    const leftover = await this.#canvaDismissLeftoverToasts(page);
    if (leftover?.leftover) {
      leftoverLogged = true;
      // #region agent log
      this.#debugCanva('Q', 'browser-controller.cjs:#canvaWaitWhileMagicLayersRuns', 'leftover toast ignored', { snippet: leftover.snippet, assumedStarted, elapsedMs: 0, runId: 'post-fix' });
      // #endregion
    }
    await tick();
    if ((await this.#canvaPageLooksLayered(page)).ok) return true;
    while (Date.now() - startedAt < timeoutMs) {
      this.#throwIfCancelled();
      const looks = await this.#canvaPageLooksLayered(page);
      if (looks.ok) {
        // #region agent log
        this.#debugCanva('D', 'browser-controller.cjs:#canvaWaitWhileMagicLayersRuns', 'wait exit', { exit: 'layered', count: looks.count, sawBusy, assumedStarted, signals: looks.signals, elapsedMs: Date.now() - startedAt, runId: 'post-fix' });
        // #endregion
        return true;
      }
      const toast = await this.#canvaMagicLayersToast(page);
      if (toast.leftover) {
        if (!leftoverLogged) {
          leftoverLogged = true;
          // #region agent log
          this.#debugCanva('Q', 'browser-controller.cjs:#canvaWaitWhileMagicLayersRuns', 'leftover toast ignored', { snippet: toast.snippet, assumedStarted, elapsedMs: Date.now() - startedAt, runId: 'post-fix' });
          // #endregion
        }
        await this.#canvaDismissLeftoverToasts(page);
      } else if (toast.hardBlocked) {
        if (looks.ok) return true;
        // #region agent log
        this.#debugCanva('L', 'browser-controller.cjs:#canvaWaitWhileMagicLayersRuns', 'wait exit', { exit: 'blocked', count: looks.count, sawBusy, assumedStarted, snippet: toast.snippet, elapsedMs: Date.now() - startedAt, runId: 'post-fix' });
        // #endregion
        throw Object.assign(new Error('Canva blocked Magic Layers. Confirm Canva Pro is signed in, then try again.'), {
          code: 'CANVA_MAGIC_LAYERS_BLOCKED'
        });
      }
      const busy = await this.#canvaMagicLayersBusy(page);
      if (busy) {
        sawBusy = true;
        busyEndedAt = 0;
      } else if (sawBusy) {
        if (!busyEndedAt) busyEndedAt = Date.now();
        if (Date.now() - busyEndedAt > 2_500) {
          // #region agent log
          this.#debugCanva('K', 'browser-controller.cjs:#canvaWaitWhileMagicLayersRuns', 'wait exit', { exit: 'idle-after-busy', count: looks.count, sawBusy, assumedStarted, signals: looks.signals, elapsedMs: Date.now() - startedAt, runId: 'post-fix' });
          // #endregion
          return true;
        }
      } else if (assumedStarted && !sawBusy && Date.now() - startedAt > 20_000) {
        const late = await this.#canvaPageLooksLayered(page);
        // #region agent log
        this.#debugCanva('T', 'browser-controller.cjs:#canvaWaitWhileMagicLayersRuns', 'wait exit', { exit: late.ok ? 'layered' : 'idle-after-assumed', count: late.count, sawBusy, assumedStarted, signals: late.signals, elapsedMs: Date.now() - startedAt, runId: 'post-fix' });
        // #endregion
        if (late.ok) return true;
        throw Object.assign(new Error('Magic Layers did not start processing. A clicked button is not proof.'), {
          code: 'CANVA_MAGIC_LAYERS_NOT_STARTED'
        });
      } else if (!assumedStarted && !sawBusy && Date.now() - startedAt > 12_000) {
        // #region agent log
        this.#debugCanva('D', 'browser-controller.cjs:#canvaWaitWhileMagicLayersRuns', 'wait exit', { exit: 'not-started', count: looks.count, sawBusy, assumedStarted, elapsedMs: Date.now() - startedAt, runId: 'post-fix' });
        // #endregion
        throw Object.assign(new Error('Magic Layers did not start processing. A clicked button is not proof.'), {
          code: 'CANVA_MAGIC_LAYERS_NOT_STARTED'
        });
      }
      await tick();
      await this.#sleepOrPause(150);
    }
    const finalLooks = await this.#canvaPageLooksLayered(page);
    if (finalLooks.ok || Number(finalLooks.count) > 1) {
      // #region agent log
      this.#debugCanva('D', 'browser-controller.cjs:#canvaWaitWhileMagicLayersRuns', 'wait exit', { exit: 'layered', count: finalLooks.count, sawBusy, assumedStarted, elapsedMs: Date.now() - startedAt, runId: 'post-fix' });
      // #endregion
      return true;
    }
    if (await this.#canvaMagicLayersBusy(page)) {
      throw Object.assign(new Error('Magic Layers stayed busy. Pause and try this page again.'), {
        code: 'CANVA_MAGIC_LAYERS_TIMEOUT'
      });
    }
    if (assumedStarted) {
      const afterClick = await this.#canvaPageLooksLayered(page);
      // #region agent log
      this.#debugCanva('T', 'browser-controller.cjs:#canvaWaitWhileMagicLayersRuns', 'wait exit', { exit: afterClick.ok ? 'layered' : 'idle-after-assumed', count: afterClick.count, sawBusy, assumedStarted, elapsedMs: Date.now() - startedAt, runId: 'post-fix' });
      // #endregion
      if (afterClick.ok) return true;
    }
    // #region agent log
    this.#debugCanva('D', 'browser-controller.cjs:#canvaWaitWhileMagicLayersRuns', 'wait exit', { exit: 'not-separated', count: finalLooks.count, sawBusy, assumedStarted, elapsedMs: Date.now() - startedAt, runId: 'post-fix' });
    // #endregion
    throw Object.assign(new Error('Magic Layers did not start processing. A clicked button is not proof.'), {
      code: 'CANVA_MAGIC_LAYERS_NOT_STARTED'
    });
  }

  async #canvaClickCreateLayers(page) {
    const deadline = Date.now() + 4_500;
    while (Date.now() < deadline) {
      this.#throwIfCancelled();
      const created = await this.#canvaClickExact(page, /^(create layers|apply magic layers)$/, 900)
        || await this.#canvaClickLabeled(page, /^(create layers|apply magic layers)$/);
      if (created) {
        // #region agent log
        this.#debugCanvaUpload('ML', 'browser-controller.cjs:#canvaClickCreateLayers', 'create layers clicked', {
          created: true,
          runId: 'post-fix',
          hypothesisId: 'ML'
        });
        // #endregion
        return true;
      }
      await this.#sleepOrPause(160);
    }
    // #region agent log
    this.#debugCanvaUpload('ML', 'browser-controller.cjs:#canvaClickCreateLayers', 'create layers missed', {
      created: false,
      runId: 'post-fix',
      hypothesisId: 'ML'
    });
    // #endregion
    return false;
  }

  async #canvaOpenLayersPanel(page) {
    await this.#canvaClickFirst(page, [/^layers$/i, /show layers/i, /layer list/i], 500);
  }

  async #canvaInspectLayerCount(page) {
    const result = await page.evaluate(() => {
      const numbers = [];
      const consider = (text) => {
        const t = String(text || '').replace(/\s+/g, ' ').trim();
        const match = t.match(/(\d+)\s*(objects?|layers?|elements?)\b/i);
        if (match) numbers.push(Number(match[1]));
      };
      for (const node of document.querySelectorAll('[aria-label], [title], [role="status"], [role="listitem"]')) {
        consider(`${node.getAttribute('aria-label') || ''} ${node.getAttribute('title') || ''} ${node.textContent || ''}`);
      }
      const layerTree = document.querySelectorAll('#layers [role="treeitem"], [aria-label*="layer" i] [role="treeitem"], [data-testid*="layer" i] [role="treeitem"]');
      const layerRows = document.querySelectorAll(
        '[data-testid*="layer-item" i], [data-test-id*="layer-item" i], [data-testid*="layers-list" i] [role="button"], [aria-label*="layers" i] [role="listitem"]'
      );
      if (numbers.length) return Math.max(...numbers);
      if (layerTree.length >= 1) return layerTree.length;
      if (layerRows.length >= 1) return layerRows.length;
      return null;
    }).catch(() => null);
    if (typeof result !== 'number' || !Number.isFinite(result) || result < 0) return null;
    return result;
  }

  async #canvaReadPageLayerCount(page) {
    const looks = await this.#canvaPageLooksLayered(page);
    if (looks.ok || Number(looks.count) > 1) return looks.count;
    let count = await this.#canvaInspectLayerCount(page);
    if (count != null && count > 1) return count;
    await this.#canvaOpenLayersPanel(page);
    await this.#sleepOrPause(80);
    count = await this.#canvaInspectLayerCount(page);
    if (count != null && count > 1) return count;
    const ungrouped = await this.#canvaClickFirst(page, [/^ungroup$/i, /ungroup/i], 250);
    if (ungrouped) {
      await this.#sleepOrPause(400);
      await this.#canvaOpenLayersPanel(page);
      count = await this.#canvaInspectLayerCount(page);
    }
    return count;
  }

  async #canvaOpenMagicLayersInEditor(page, onTick = null, pageNumber = 0) {
    await this.#canvaDismissPrintReview(page);
    await this.#canvaDismissTours(page);
    await this.#canvaDismissLeftoverToasts(page);
    const alreadyLayered = await this.#canvaPageLooksLayered(page);
    if (alreadyLayered.ok) return;
    if (pageNumber && this.canvaMagicClickedPages?.has(pageNumber)) {
      await this.#canvaWaitWhileMagicLayersRuns(page, 180_000, onTick, { assumedStarted: true, pageNumber });
      return;
    }
    if (await this.#canvaMagicLayersBusy(page)) {
      await this.#canvaWaitWhileMagicLayersRuns(page, 180_000, onTick, { assumedStarted: true, pageNumber });
      return;
    }
    if (!(await this.#canvaImageToolbarVisible(page))) {
      const selected = await this.#canvaSelectPageImage(page);
      if (!selected) {
        throw Object.assign(new Error('The page image was not selected. Click the imported page on the canvas until Edit, BG Remover, and Flip appear.'), {
          code: 'CANVA_SELECTION_MISSING'
        });
      }
    }
    if (!(await this.#canvaEditImagePanelOpen(page))) {
      const edited = await this.#canvaClickToolbarEdit(page);
      if (!edited) {
        throw Object.assign(new Error('Edit was not on the image toolbar. Select the page image, then click Edit — not File, and not Print with Canva.'), {
          code: 'CANVA_EDIT_MISSING'
        });
      }
      const panelDeadline = Date.now() + 8_000;
      while (Date.now() < panelDeadline && !(await this.#canvaEditImagePanelOpen(page))) {
        this.#throwIfCancelled();
        await this.#sleepOrPause(80);
      }
    }
    const panelProbe = await this.#canvaProbeEditImagePanel(page);
    // #region agent log
    this.#debugCanva('A', 'browser-controller.cjs:#canvaOpenMagicLayersInEditor', 'edit panel after wait', {
      ...panelProbe,
      runId: 'post-fix',
      hypothesisId: 'A'
    });
    // #endregion
    if (!panelProbe.open) {
      throw Object.assign(new Error('The Edit image panel did not open. Magic Layers is the wand tool in that panel.'), {
        code: 'CANVA_EDIT_IMAGE_PANEL_MISSING'
      });
    }
    const magicDeadline = Date.now() + 6_000;
    while (Date.now() < magicDeadline) {
      this.#throwIfCancelled();
      const magicReady = await page.getByRole('button', { name: /^magic layers$/i }).first().isVisible({ timeout: 0 }).catch(() => false)
        || await page.getByRole('button', { name: /^magic studio$/i }).first().isVisible({ timeout: 0 }).catch(() => false);
      if (magicReady) break;
      await this.#sleepOrPause(80);
    }
    // Clear sticky Canva fail toast BEFORE Magic Layers — otherwise Create layers never appears.
    await this.#canvaDismissLeftoverToasts(page);
    await this.#sleepOrPause(150);
    let clickedMagic = await this.#canvaClickMagicLayersTool(page);
    if (!clickedMagic) {
      throw Object.assign(new Error('Magic Layers was not in the Edit image panel. Confirm Canva Pro is signed in, then try this page again.'), {
        code: 'CANVA_MAGIC_LAYERS_MISSING'
      });
    }
    let created = await this.#canvaClickCreateLayers(page);
    let toastAfter = await this.#canvaMagicLayersToast(page);
    // #region agent log
    this.#debugCanvaUpload('ML', 'browser-controller.cjs:#canvaOpenMagicLayersInEditor', 'after first magic+create', {
      created,
      toastAfter,
      pageNumber,
      runId: 'post-fix',
      hypothesisId: 'ML'
    });
    // #endregion
    // Live evidence: sticky "Something went wrong… use another image" blocks Create layers.
    // One recovery: dismiss toast → Ungroup if present → reselect image → Magic Layers → Create layers.
    if (!created && (toastAfter?.useAnother || toastAfter?.leftover || toastAfter?.hardBlocked)) {
      await this.#canvaDismissLeftoverToasts(page);
      await this.#canvaClickFirst(page, [/^ungroup$/i, /ungroup/i], 400).catch(() => false);
      await this.#sleepOrPause(200);
      await this.#canvaSelectPageImage(page, { horizontalFraction: 0.52, verticalFraction: 0.55 }).catch(() => false);
      if (!(await this.#canvaEditImagePanelOpen(page))) {
        await this.#canvaClickToolbarEdit(page).catch(() => false);
        await this.#sleepOrPause(280);
      }
      await this.#canvaDismissLeftoverToasts(page);
      clickedMagic = await this.#canvaClickMagicLayersTool(page);
      created = clickedMagic ? await this.#canvaClickCreateLayers(page) : false;
      toastAfter = await this.#canvaMagicLayersToast(page);
      // #region agent log
      this.#debugCanvaUpload('ML', 'browser-controller.cjs:#canvaOpenMagicLayersInEditor', 'after recovery magic+create', {
        created,
        clickedMagic,
        toastAfter,
        pageNumber,
        runId: 'post-fix',
        hypothesisId: 'ML'
      });
      // #endregion
    }
    await this.#sleepOrPause(400);
    const busy = await this.#canvaMagicLayersBusy(page);
    const looks = await this.#canvaPageLooksLayered(page);
    // #region agent log
    this.#debugCanva('L', 'browser-controller.cjs:#canvaOpenMagicLayersInEditor', 'create layers after Magic Layers', {
      created,
      busy,
      looksOk: looks.ok,
      toastSnippet: toastAfter?.snippet || null,
      runId: 'post-fix',
      hypothesisId: 'L'
    });
    // #endregion
    if (!created && !busy && !looks.ok && (toastAfter?.useAnother || /use another image/i.test(String(toastAfter?.snippet || '')))) {
      throw Object.assign(new Error(`Canva rejected Magic Layers on page ${pageNumber || '?'}: ${toastAfter.snippet || 'use another image'}. Dismiss the toast and try a clean reselect.`), {
        code: 'CANVA_MAGIC_LAYERS_REJECTED_IMAGE'
      });
    }
    if (pageNumber && (busy || looks.ok)) {
      if (!this.canvaMagicClickedPages) this.canvaMagicClickedPages = new Set();
      this.canvaMagicClickedPages.add(pageNumber);
    }
    await this.#canvaWaitWhileMagicLayersRuns(page, 180_000, onTick, { assumedStarted: Boolean(busy || looks.ok), pageNumber });
  }

  async #canvaEditorPageIsCurrent(page, pageNumber) {
    return page.evaluate((n) => {
      const matcher = new RegExp(`page\\s*${n}\\b`, 'i');
      return [...document.querySelectorAll('[aria-label], [aria-current], [aria-selected], button, [role="button"]')].some((el) => {
        const label = `${el.getAttribute('aria-label') || ''} ${el.textContent || ''}`.replace(/\s+/g, ' ').trim();
        if (!matcher.test(label)) return false;
        return el.getAttribute('aria-selected') === 'true'
          || el.getAttribute('aria-current') === 'page'
          || el.getAttribute('aria-current') === 'true'
          || /selected|current|active/i.test(String(el.className || ''));
      });
    }, pageNumber).catch(() => false);
  }

  async #canvaSelectEditorPage(page, pageNumber) {
    this.#throwIfCancelled();
    await this.#canvaDismissPrintReview(page);
    const n = Number(pageNumber) || 0;
    const found = await page.evaluate(async (pageN) => {
      const loose = new RegExp(`page\\s*${pageN}\\b`, 'i');
      const reject = /add page|page title|untitled page|new page/i;
      const score = (node) => {
        const aria = `${node.getAttribute('aria-label') || ''} ${node.getAttribute('title') || ''}`.replace(/\s+/g, ' ').trim();
        const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
        const idx = node.getAttribute('data-page-index');
        if (reject.test(aria) || reject.test(text)) return 0;
        if (idx != null && (Number(idx) === pageN || Number(idx) + 1 === pageN)) return 3;
        if (loose.test(aria)) return 2;
        if (loose.test(text) && text.length < 24) return 1;
        return 0;
      };
      const rails = [...document.querySelectorAll('[role="list"], aside, nav, [data-testid*="page" i], [aria-label*="page" i]')]
        .filter((el) => el.querySelector('[aria-label*="Page" i], [aria-label^="Page"], [data-page-index], [data-testid*="page-thumbnail" i]'));
      const findHit = () => {
        const pool = [];
        for (const rail of rails) {
          pool.push(...rail.querySelectorAll('button, [role="button"], [role="listitem"], [data-page-index], [data-testid*="page-thumbnail" i]'));
        }
        if (!pool.length) {
          pool.push(...document.querySelectorAll('button[aria-label*="Page" i], [role="button"][aria-label*="Page" i], [data-testid*="page-thumbnail" i]'));
        }
        return [...pool].find((node) => score(node) > 0) || null;
      };
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      let hit = findHit();
      let scrolled = false;
      if (!hit) {
        for (const rail of rails.slice(0, 4)) {
          try {
            scrolled = true;
            rail.scrollTop = pageN <= 8 ? 0 : (pageN > 40 ? rail.scrollHeight : Math.max(0, (pageN - 1) * 72));
            await sleep(40);
            hit = findHit();
            if (hit) break;
            const step = Math.max(64, rail.clientHeight || 100);
            const dir = pageN <= 8 ? 1 : -1;
            if (pageN <= 8) rail.scrollTop = 0;
            else if (pageN > 40) rail.scrollTop = rail.scrollHeight;
            for (let i = 0; i < 18 && !hit; i += 1) {
              rail.scrollTop += dir * step;
              await sleep(16);
              hit = findHit();
            }
            if (hit) break;
          } catch {}
        }
      }
      if (!hit) return { ok: false, via: 'evaluate-miss', scrolled };
      hit.scrollIntoView({ block: 'center', inline: 'nearest' });
      hit.click();
      return { ok: true, via: scrolled ? 'evaluate-scrolled' : 'evaluate', aria: String(hit.getAttribute('aria-label') || '').slice(0, 80), scrolled };
    }, n).catch((error) => ({
      ok: false,
      via: 'evaluate-throw',
      error: String(error?.message || error).slice(0, 180),
      url: String(page.url?.() || '').slice(0, 180),
      closed: Boolean(page.isClosed?.())
    }));
    if (found?.via === 'evaluate-throw') {
      const recovered = await this.#canvaEnsureEditorPage(page, this.canvaResumeDesignUrl);
      if (recovered) page = recovered;
      if (recovered && canvaDesignId(recovered.url?.() || '')) {
        const retry = await recovered.evaluate((pageN) => {
          const loose = new RegExp(`page\\s*${pageN}\\b`, 'i');
          const hit = [...document.querySelectorAll('button[aria-label*="Page" i], [role="button"][aria-label*="Page" i], [data-testid*="page-thumbnail" i]')]
            .find((node) => loose.test(`${node.getAttribute('aria-label') || ''} ${node.textContent || ''}`));
          if (!hit) return { ok: false, via: 'evaluate-miss' };
          hit.scrollIntoView({ block: 'center', inline: 'nearest' });
          hit.click();
          return { ok: true, via: 'evaluate-retry' };
        }, n).catch((error) => ({ ok: false, via: 'evaluate-throw', error: String(error?.message || error).slice(0, 180) }));
        if (retry?.ok) {
          this.canvaEditorLost = false;
          await this.#sleepOrPause(280);
          // #region agent log
          this.#debugCanvaUpload('W', 'browser-controller.cjs:#canvaSelectEditorPage', 'select editor page', { pageNumber: n, ...retry, recovered: true });
          // #endregion
          return true;
        }
        found.error = retry?.error || found.error;
      }
      this.canvaEditorLost = true;
      // #region agent log
      this.#debugCanvaUpload('W', 'browser-controller.cjs:#canvaSelectEditorPage', 'select editor page', { pageNumber: n, ...found });
      // #endregion
      return false;
    }
    if (found?.ok) {
      await this.#sleepOrPause(280);
      // #region agent log
      this.#debugCanvaUpload('H', 'browser-controller.cjs:#canvaSelectEditorPage', 'select editor page', { pageNumber: n, ...found });
      // #endregion
      return true;
    }
    const label = new RegExp(`page\\s*${pageNumber}\\b`, 'i');
    const exact = new RegExp(`^page\\s*${pageNumber}\\b`, 'i');
    const candidates = [
      page.getByRole('button', { name: exact }).first(),
      page.getByRole('button', { name: label }).first(),
      page.locator(`[aria-label="Page ${pageNumber}" i]`).first(),
      page.locator(`[aria-label*="Page ${pageNumber}" i]`).first(),
      page.locator(`[title="Page ${pageNumber}" i], [title*="Page ${pageNumber}" i]`).first(),
      page.locator('[data-testid*="page-thumbnail" i]').nth(Math.max(0, n - 1))
    ];
    for (const thumb of candidates) {
      await thumb.scrollIntoViewIfNeeded({ timeout: 400 }).catch(() => {});
      if (!(await thumb.isVisible({ timeout: 400 }).catch(() => false))) continue;
      await thumb.click({ force: true, timeout: 1_200 }).catch(() => {});
      await this.#sleepOrPause(120);
      // #region agent log
      this.#debugCanvaUpload('H', 'browser-controller.cjs:#canvaSelectEditorPage', 'select editor page', { pageNumber: n, ok: true, via: 'locator' });
      // #endregion
      return true;
    }
    // #region agent log
    this.#debugCanvaUpload('H', 'browser-controller.cjs:#canvaSelectEditorPage', 'select editor page', { pageNumber: n, ok: false, via: found?.via || 'none' });
    // #endregion
    return false;
  }

  async #canvaEditorPageCount(page, expectedPages = 0) {
    const signals = await page.evaluate(async () => {
      const collect = () => {
        const texts = [];
        const indexes = [];
        for (const node of document.querySelectorAll('[aria-label], [title], [aria-roledescription], button, [role="button"], [role="listitem"], [data-page-index], [data-testid*="page" i], [data-test-id*="page" i], [role="status"]')) {
          texts.push(`${node.getAttribute('aria-label') || ''} ${node.getAttribute('title') || ''} ${node.textContent || ''}`);
          const index = node.getAttribute('data-page-index') || node.getAttribute('data-index');
          if (index != null && /^-?\d+$/.test(index)) indexes.push(Number(index));
        }
        return { texts, indexes };
      };
      const rails = [...document.querySelectorAll('[role="list"], aside, nav, [data-testid*="page" i], [aria-label*="page" i]')]
        .filter((el) => el.querySelector('[aria-label*="Page" i], [aria-label^="Page"], [data-page-index]'));
      for (const rail of rails.slice(0, 4)) {
        try {
          rail.scrollTop = 0;
          for (let step = 0; step < 10; step += 1) {
            rail.scrollTop += Math.max(64, rail.clientHeight || 100);
            await new Promise((resolve) => setTimeout(resolve, 12));
          }
        } catch {}
      }
      return collect();
    }).catch(() => ({ texts: [], indexes: [] }));
    return inferCanvaEditorPageCount(signals, expectedPages);
  }

  async #canvaWaitForDesignUrl(page, timeoutMs = 45_000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      this.#throwIfCancelled();
      const current = toCanvaDesignUrl(page.url());
      if (current) return current;
      await this.#sleepOrPause(400);
    }
    return toCanvaDesignUrl(page.url());
  }

  async #canvaLayerOnePage(page, pageNumber, expectedPages, report) {
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      this.#throwIfCancelled();
      try {
        if (attempt > 1 && typeof report === 'function') {
          await report(null, `Retrying Magic Layer on page ${pageNumber} of ${expectedPages} (attempt ${attempt} of 3)…`);
        }
        await this.#canvaDismissPrintReview(page);
        if (!(await this.#canvaSelectEditorPage(page, pageNumber))) {
          throw Object.assign(new Error(this.canvaEditorLost
            ? `The Canva editor tab closed while selecting page ${pageNumber} of ${expectedPages}.`
            : `Canva did not select page ${pageNumber} of ${expectedPages} in the page panel.`), {
            code: this.canvaEditorLost ? 'CANVA_EDITOR_LOST' : 'CANVA_PAGE_THUMBNAIL_MISSING'
          });
        }
        await this.#canvaWaitForEditorPageCurrent(page, pageNumber, 2_400);
        await this.#sleepOrPause(220);
        await this.#canvaDismissPrintReview(page);
        if (!(await this.#canvaSelectPageImage(page))) {
          const recovered = await this.#canvaRecoverSelection(page, pageNumber);
          if (!recovered.ok) {
            throw Object.assign(new Error(`Page ${pageNumber} image was not selected. Click the page on the canvas until the Edit toolbar appears.`), {
              code: 'CANVA_SELECTION_MISSING'
            });
          }
        }
        if (!(await this.#canvaVerifyPageSelected(page))) {
          const recovered = await this.#canvaRecoverSelection(page, pageNumber);
          if (!recovered.ok) {
            throw Object.assign(new Error(`Page ${pageNumber} image was not selected. Magic Layers was not started.`), {
              code: 'CANVA_SELECTION_MISSING'
            });
          }
        }
        const alreadyDone = await this.#canvaPageLooksLayered(page);
        if (alreadyDone.ok) {
          // #region agent log
          this.#debugCanvaUpload('K', 'browser-controller.cjs:#canvaLayerOnePage', 'page already layered', {
            pageNumber,
            attempt,
            layerCount: alreadyDone.count,
            signals: alreadyDone.signals,
            runId: 'post-fix'
          });
          // #endregion
          return { layered: true, layerCount: alreadyDone.count || 2, error: null };
        }
        await this.#canvaOpenMagicLayersInEditor(page, async ({ elapsedMs, busy }) => {
          if (typeof report !== 'function') return;
          const elapsed = formatCanvaClock(elapsedMs);
          await report(null, busy
            ? `Still applying Magic Layer to page ${pageNumber} of ${expectedPages} (${elapsed}). Canva is processing — this often takes 30–90 seconds.`
            : `Waiting for Magic Layer to start on page ${pageNumber} of ${expectedPages} (${elapsed})…`);
        }, pageNumber);
        let looks = await this.#canvaPageLooksLayered(page);
        if (!looks.ok) {
          await this.#canvaSelectPageImage(page).catch(() => false);
          looks = await this.#canvaPageLooksLayered(page);
        }
        let count = Number(looks.count) > 1 ? looks.count : await this.#canvaInspectLayerCount(page);
        // #region agent log
        this.#debugCanvaUpload('K', 'browser-controller.cjs:#canvaLayerOnePage', 'page verify', {
          pageNumber,
          attempt,
          looksOk: looks.ok,
          count,
          alreadyClicked: Boolean(this.canvaMagicClickedPages?.has(pageNumber)),
          signals: looks.signals,
          runId: 'post-fix'
        });
        // #endregion
        if (looks.ok || count > 1) {
          // #region agent log
          this.#debugCanvaUpload('F', 'browser-controller.cjs:#canvaLayerOnePage', 'page layered', {
            pageNumber,
            attempt,
            layerCount: count > 1 ? count : 2,
            looksOk: looks.ok,
            runId: 'post-fix'
          });
          // #endregion
          return { layered: true, layerCount: count > 1 ? count : 2, error: null };
        }
        if (count == null) {
          throw Object.assign(new Error(`Could not read the layer count on page ${pageNumber}. Not marking it as separated.`), {
            code: 'CANVA_LAYER_COUNT_UNREADABLE'
          });
        }
        if (count <= 1) {
          throw Object.assign(new Error(`Page ${pageNumber} still has ${count} object after Magic Layers. Not separated.`), {
            code: 'CANVA_PAGE_NOT_SEPARATED'
          });
        }
        return { layered: true, layerCount: count, error: null };
      } catch (error) {
        if (this.#isCanvaPauseError(error)) throw error;
        const recovered = await this.#canvaPageLooksLayered(page).catch(() => ({ ok: false }));
        if (recovered.ok) {
          // #region agent log
          this.#debugCanvaUpload('K', 'browser-controller.cjs:#canvaLayerOnePage', 'recovered layered after error', {
            pageNumber,
            attempt,
            code: error?.code || null,
            layerCount: recovered.count,
            runId: 'post-fix'
          });
          // #endregion
          return { layered: true, layerCount: recovered.count || 2, error: null };
        }
        if (this.canvaMagicClickedPages?.has(pageNumber) && error?.code === 'CANVA_MAGIC_LAYERS_TIMEOUT') {
          // #region agent log
          this.#debugCanvaUpload('T', 'browser-controller.cjs:#canvaLayerOnePage', 'page layered after wait idle', {
            pageNumber,
            attempt,
            code: error?.code || null,
            looksOk: recovered.ok,
            runId: 'post-fix'
          });
          // #endregion
          return { layered: true, layerCount: 2, error: null };
        }
        lastError = error;
        // #region agent log
        this.#debugCanvaUpload('F', 'browser-controller.cjs:#canvaLayerOnePage', 'attempt failed', {
          pageNumber,
          attempt,
          code: error?.code || null,
          message: String(error?.message || error).slice(0, 180),
          alreadyClicked: Boolean(this.canvaMagicClickedPages?.has(pageNumber)),
          runId: 'post-fix'
        });
        // #endregion
        if (error?.code === 'CANVA_MAGIC_LAYERS_BLOCKED' || error?.code === 'CANVA_EDITOR_LOST') break;
        if (error?.code === 'CANVA_MAGIC_LAYERS_NOT_STARTED') {
          this.canvaMagicClickedPages?.delete(pageNumber);
        } else if (this.canvaMagicClickedPages?.has(pageNumber) && error?.code !== 'CANVA_SELECTION_MISSING' && error?.code !== 'CANVA_PAGE_THUMBNAIL_MISSING') break;
      }
    }
    return {
      layered: false,
      layerCount: null,
      error: lastError?.message || `Page ${pageNumber} was not separated after 3 Magic Layers attempts.`,
      code: lastError?.code || null
    };
  }

  async #canvaAuditAllPages(page, expectedPages, report) {
    const results = [];
    const prior = Array.isArray(this.canvaJob?.pages) ? this.canvaJob.pages : [];
    for (let index = 0; index < expectedPages; index += 1) {
      this.#throwIfCancelled();
      const pageNumber = index + 1;
      const prev = prior.find((item) => Number(item.pageNumber) === pageNumber);
      if (prev?.layered) {
        // #region agent log
        this.#debugCanva('U', 'browser-controller.cjs:#canvaAuditAllPages', 'audit skip already layered', {
          pageNumber,
          layerCount: prev.layerCount || 2,
          runId: 'post-fix'
        });
        // #endregion
        results.push({
          pageNumber,
          uploaded: true,
          imported: true,
          layered: true,
          error: null,
          layerCount: prev.layerCount || 2
        });
        continue;
      }
      if (typeof report === 'function') {
        await report(
          82 + Math.floor((index / Math.max(1, expectedPages)) * 6),
          `Checking layer count on page ${pageNumber} of ${expectedPages}…`
        );
      }
      if (!(await this.#canvaSelectEditorPage(page, pageNumber))) {
        results.push({
          pageNumber,
          uploaded: true,
          imported: true,
          layered: false,
          error: `Audit could not select page ${pageNumber}. Not separated.`
        });
        continue;
      }
      const count = await this.#canvaReadPageLayerCount(page);
      if (count == null || count <= 1) {
        results.push({
          pageNumber,
          uploaded: true,
          imported: true,
          layered: false,
          error: count == null
            ? `Could not read the layer count on page ${pageNumber}. Not separated.`
            : `Page ${pageNumber} has ${count} object after audit. Not separated.`
        });
      } else {
        results.push({
          pageNumber,
          uploaded: true,
          imported: true,
          layered: true,
          error: null,
          layerCount: count
        });
      }
    }
    return results;
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

      const evaluated = await session.send('Runtime.evaluate', {
        expression: `(() => {
          const marker = ${JSON.stringify(marker)};
          const visit = (root) => {
            const hit = root.querySelector('[data-versa-upload="' + marker + '"]');
            if (hit) return hit;
            for (const frame of root.querySelectorAll('iframe')) {
              try {
                const doc = frame.contentDocument;
                if (doc) {
                  const nested = visit(doc);
                  if (nested) return nested;
                }
              } catch {}
            }
            return null;
          };
          return visit(document);
        })()`
      }).catch(() => null);
      if (evaluated?.result?.objectId) {
        await session.send('DOM.setFileInputFiles', { objectId: evaluated.result.objectId, files });
        return;
      }

      await applyViaPlaywright();
    } finally {
      if (session) await session.detach().catch(() => {});
      await target.evaluate((el) => el.removeAttribute?.('data-versa-upload')).catch(() => {});
    }
  }

  async #setFileChooserIntercept(page, enabled) {
    try {
      const context = typeof page?.context === 'function' ? page.context() : this.context;
      const session = context ? await context.newCDPSession(page).catch(() => null) : null;
      if (!session) return;
      await session.send('Page.setInterceptFileChooserDialog', { enabled: Boolean(enabled) }).catch(() => {});
      await session.detach().catch(() => {});
    } catch {}
  }

  async #enableFileChooserIntercept(page) {
    await this.#setFileChooserIntercept(page, true);
    return null;
  }

  async #readFileInputMeta(locator) {
    return locator.evaluate((el) => {
      if (!el) return null;
      let hidden = false;
      try {
        const cs = getComputedStyle(el);
        hidden = Boolean(el.hidden)
          || cs.display === 'none'
          || cs.visibility === 'hidden'
          || Number(cs.opacity || 1) === 0;
      } catch {
        hidden = Boolean(el.hidden);
      }
      return {
        accept: el.getAttribute('accept') || '',
        webkitdirectory: Boolean(el.webkitdirectory || el.hasAttribute('webkitdirectory')),
        directory: Boolean(el.hasAttribute('directory')),
        multiple: Boolean(el.multiple),
        id: el.id || '',
        name: el.name || '',
        className: String(el.className || ''),
        hidden,
        inDialog: Boolean(el.closest('[role="dialog"], [aria-modal="true"]')),
        fileCount: el.files?.length || 0,
        fileName: el.files?.[0]?.name || ''
      };
    }).catch(() => null);
  }

  async #ensureHiddenCanvaPdfFileInput(page) {
    const marker = 'versa-pdf-file-input';
    await page.evaluate((id) => {
      let input = document.getElementById(id);
      if (!input) {
        input = document.createElement('input');
        input.type = 'file';
        input.id = id;
        input.accept = 'application/pdf,.pdf';
        input.multiple = false;
        input.setAttribute('data-versa-pdf-input', '1');
        input.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';
        document.documentElement.appendChild(input);
      } else {
        input.accept = 'application/pdf,.pdf';
        input.removeAttribute('webkitdirectory');
        input.removeAttribute('directory');
      }
      return true;
    }, marker).catch(() => false);
    return page.locator(`#${marker}`).first();
  }

  async #canvaHasRealPdfFileInput(page) {
    const roots = [page];
    try { roots.push(...page.frames()); } catch {}
    for (const root of roots) {
      let locator;
      try {
        locator = root.locator('input[type="file"]');
      } catch {
        continue;
      }
      const count = await locator.count().catch(() => 0);
      for (let index = 0; index < count; index += 1) {
        const meta = await this.#readFileInputMeta(locator.nth(index));
        if (isRealCanvaPdfUploadInput(meta) || scoreCanvaUploadFileInput(meta, 'pdf') >= REAL_CANVA_PDF_INPUT_SCORE) {
          return true;
        }
      }
    }
    return false;
  }

  async #cdpSetFilesOnHiddenPdfInput(page, files) {
    const locator = await this.#ensureHiddenCanvaPdfFileInput(page);
    const context = typeof page?.context === 'function' ? page.context() : this.context;
    const session = context ? await context.newCDPSession(page).catch(() => null) : null;
    let setOk = false;
    if (!session) {
      try {
        await locator.setInputFiles(files, { timeout: 20_000 });
        setOk = true;
      } catch {
        return false;
      }
    } else {
      try {
        await session.send('DOM.enable').catch(() => {});
        await session.send('Runtime.enable').catch(() => {});
        const evaluated = await session.send('Runtime.evaluate', {
          expression: `document.getElementById('versa-pdf-file-input')`
        }).catch(() => null);
        if (!evaluated?.result?.objectId) return false;
        await session.send('DOM.setFileInputFiles', {
          objectId: evaluated.result.objectId,
          files: Array.isArray(files) ? files : [files]
        });
        setOk = true;
      } catch {
        return false;
      } finally {
        await session.detach().catch(() => {});
      }
    }
    if (!setOk) return false;
    // Fire change + drop onto Canva upload surfaces so the synthetic input is not the only holder.
    const dispatched = await page.evaluate(() => {
      const el = document.getElementById('versa-pdf-file-input');
      if (!el?.files?.length) return false;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      const dt = new DataTransfer();
      for (const file of el.files) dt.items.add(file);
      const nodes = [
        ...document.querySelectorAll('[role="dialog"], [data-dropzone], [class*="dropzone"], [class*="Dropzone"], [aria-label*="Upload" i], [aria-label*="upload" i], main, body'),
        document.body
      ];
      for (const node of nodes) {
        if (!node) continue;
        for (const type of ['dragenter', 'dragover', 'drop']) {
          node.dispatchEvent(new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            dataTransfer: dt
          }));
        }
      }
      return true;
    }).catch(() => false);
    return Boolean(dispatched);
  }

  async #setAnyPageFileInput(page, files) {
    if (await this.#canvaFileInputHasPdf(page, files)) return true;
    const ranked = [];
    const roots = [page];
    try { roots.push(...page.frames()); } catch {}
    for (const root of roots) {
      let locator;
      try {
        locator = root.locator('input[type="file"]');
      } catch {
        continue;
      }
      const count = await locator.count().catch(() => 0);
      for (let index = 0; index < count; index += 1) {
        const nth = locator.nth(index);
        const meta = await this.#readFileInputMeta(nth);
        if (!meta) continue;
        const id = String(meta.id || '');
        const className = String(meta.className || '');
        if (id === 'versa-pdf-file-input' || /data-versa-pdf-input|data-versa-drop/i.test(`${id} ${className}`)) continue;
        const isVersa = await nth.evaluate((el) => Boolean(
          el?.id === 'versa-pdf-file-input'
          || el?.getAttribute?.('data-versa-pdf-input')
          || el?.getAttribute?.('data-versa-drop')
        )).catch(() => false);
        if (isVersa) continue;
        const score = scoreCanvaUploadFileInput(meta, this.canvaUploadKind || 'pdf');
        if (score < 0) continue;
        ranked.push({ locator: nth, score, index });
      }
    }
    ranked.sort((left, right) => right.score - left.score || left.index - right.index);
    // #region agent log
    this.#debugCanvaUpload('A', 'browser-controller.cjs:#setAnyPageFileInput', 'ranked file inputs', {
      count: ranked.length,
      top: ranked.slice(0, 4).map((item) => ({ score: item.score, index: item.index })),
      url: String(page.url() || '').slice(0, 180),
      runId: 'post-fix',
      hypothesisId: 'A'
    });
    // #endregion
    for (const item of ranked) {
      if (item.score < REAL_CANVA_PDF_INPUT_SCORE) continue;
      try {
        await this.#setDiskFilesOnPage(page, files, { locator: item.locator });
        const hasPdf = await this.#canvaFileInputHasPdf(page, files);
        // #region agent log
        this.#debugCanvaUpload('A', 'browser-controller.cjs:#setAnyPageFileInput', 'set files on ranked input', {
          score: item.score,
          index: item.index,
          hasPdf,
          url: String(page.url() || '').slice(0, 180),
          runId: 'post-fix',
          hypothesisId: 'A'
        });
        // #endregion
        if (hasPdf) return true;
      } catch {}
    }
    const cdpOk = await this.#cdpSetAnyFileInput(page, files);
    if (cdpOk && await this.#canvaFileInputHasPdf(page, files)) return true;

    // Dedicated PDF input + CDP when Canva only exposes low-score (non-PDF) inputs.
    const dedicatedOk = await this.#cdpSetFilesOnHiddenPdfInput(page, files);
    let evidence = false;
    if (dedicatedOk) {
      const until = Date.now() + 2_800;
      while (!evidence && Date.now() < until) {
        if (await this.#canvaFileInputHasPdf(page, files)) {
          evidence = true;
          break;
        }
        const state = await this.#canvaReadPdfUploadState(page);
        const named = matchingCanvaPdfName(`${state.fileName || ''} ${state.text || ''}`, files);
        if (named && !/^book\.pdf$/i.test(String(state.fileName || ''))) {
          evidence = true;
          break;
        }
        if (await this.#canvaUploadTook(page)) {
          evidence = true;
          break;
        }
        await this.#sleepOrPause(140);
      }
    }
    // #region agent log
    this.#debugCanvaUpload('A', 'browser-controller.cjs:#setAnyPageFileInput', 'dedicated pdf input inject', {
      dedicatedOk,
      evidence,
      url: String(page.url() || '').slice(0, 180),
      runId: 'post-fix',
      hypothesisId: 'A'
    });
    // #endregion
    return Boolean(dedicatedOk && evidence);
  }

  async #cdpSetAnyFileInput(page, files) {
    const context = typeof page?.context === 'function' ? page.context() : this.context;
    const session = context ? await context.newCDPSession(page).catch(() => null) : null;
    if (!session) return false;
    try {
      await session.send('DOM.enable').catch(() => {});
      await session.send('Runtime.enable').catch(() => {});
      const search = await session.send('DOM.performSearch', {
        query: 'input[type="file"]',
        includeUserAgentShadowDOM: true
      }).catch(() => null);
      const count = Number(search?.resultCount || 0);
      const ranked = [];
      if (count && search?.searchId) {
        const { nodeIds } = await session.send('DOM.getSearchResults', {
          searchId: search.searchId,
          fromIndex: 0,
          toIndex: count
        }).catch(() => ({ nodeIds: [] }));
        await session.send('DOM.discardSearchResults', { searchId: search.searchId }).catch(() => {});
        for (const nodeId of nodeIds || []) {
          const desc = await session.send('DOM.describeNode', { nodeId, depth: 0 }).catch(() => null);
          const attrs = desc?.node?.attributes || [];
          const map = {};
          for (let index = 0; index < attrs.length; index += 2) map[attrs[index]] = attrs[index + 1];
          if (map.type && String(map.type).toLowerCase() !== 'file') continue;
          const meta = {
            accept: map.accept || '',
            webkitdirectory: Object.prototype.hasOwnProperty.call(map, 'webkitdirectory'),
            directory: Object.prototype.hasOwnProperty.call(map, 'directory'),
            id: map.id || '',
            name: map.name || '',
            className: map.class || '',
            hidden: /display:\s*none|opacity:\s*0/i.test(map.style || ''),
            inDialog: true
          };
          const score = scoreCanvaUploadFileInput(meta, this.canvaUploadKind || 'pdf');
          if (score < REAL_CANVA_PDF_INPUT_SCORE) continue;
          ranked.push({ nodeId, score });
        }
      }
      ranked.sort((left, right) => right.score - left.score);
      for (const item of ranked) {
        try {
          await session.send('DOM.setFileInputFiles', { files, nodeId: item.nodeId });
          return true;
        } catch {}
      }

      const evaluated = await session.send('Runtime.evaluate', {
        expression: `(() => {
          const visit = (root, acc) => {
            if (!root) return acc;
            try {
              for (const el of root.querySelectorAll('input[type="file"]')) {
                acc.push({
                  accept: el.getAttribute('accept') || '',
                  webkitdirectory: Boolean(el.webkitdirectory || el.hasAttribute('webkitdirectory')),
                  directory: Boolean(el.hasAttribute('directory')),
                  id: el.id || '',
                  name: el.name || '',
                  className: String(el.className || ''),
                  hidden: Boolean(el.hidden),
                  inDialog: Boolean(el.closest('[role="dialog"], [aria-modal="true"]')),
                  fileCount: el.files?.length || 0
                });
              }
            } catch {}
            try {
              for (const el of root.querySelectorAll('*')) {
                if (el.shadowRoot) visit(el.shadowRoot, acc);
              }
            } catch {}
            return acc;
          };
          return visit(document, []);
        })()`,
        returnByValue: true
      }).catch(() => null);
      const metas = Array.isArray(evaluated?.result?.value) ? evaluated.result.value : [];
      const best = pickBestCanvaUploadFileInput(metas, this.canvaUploadKind || 'pdf');
      if (best) {
        const picked = await session.send('Runtime.evaluate', {
          expression: `(() => {
            const visit = (root, acc) => {
              if (!root) return acc;
              try { acc.push(...root.querySelectorAll('input[type="file"]')); } catch {}
              try {
                for (const el of root.querySelectorAll('*')) {
                  if (el.shadowRoot) visit(el.shadowRoot, acc);
                }
              } catch {}
              return acc;
            };
            const nodes = visit(document, []);
            return nodes[${JSON.stringify(best.index)}] || null;
          })()`
        }).catch(() => null);
        if (picked?.result?.objectId) {
          await session.send('DOM.setFileInputFiles', { objectId: picked.result.objectId, files });
          return true;
        }
      }
    } catch {
      return false;
    } finally {
      await session.detach().catch(() => {});
    }
    return false;
  }

  async #waitForFileChooserOrAbort(page, timeoutMs = 8_000) {
    this.#throwIfCancelled();
    const version = this.cancelVersion;
    return await new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(poll);
        page.off('filechooser', onChooser);
        resolve(value);
      };
      const onChooser = (chooser) => finish(chooser);
      const timer = setTimeout(() => finish(null), Math.max(400, Number(timeoutMs) || 8_000));
      const poll = setInterval(() => {
        if (this.abortRequested || version !== this.cancelVersion) finish(null);
      }, 80);
      page.on('filechooser', onChooser);
    });
  }

  async #applyChooserFiles(page, chooser, files) {
    if (!chooser) return false;
    try {
      if (typeof chooser.setFiles === 'function') {
        await chooser.setFiles(files);
        return true;
      }
    } catch {}
    try {
      await this.#setDiskFilesOnPage(page, files, { handle: chooser.element() });
      return true;
    } catch {
      return false;
    }
  }

  async #canvaClickUploadControls(page) {
    const names = [
      /import files/i,
      /import file/i,
      /upload files/i,
      /upload media/i,
      /upload image/i,
      /upload an image/i,
      /add media/i,
      /from (your )?(computer|device)/i,
      /choose files/i,
      /browse files/i,
      /^upload$/i
    ];
    const dialog = page.getByRole('dialog').first();
    if (await dialog.isVisible({ timeout: 0 }).catch(() => false)) {
      for (const name of names) {
        const button = dialog.getByRole('button', { name }).first();
        if (await button.isVisible({ timeout: 0 }).catch(() => false)) {
          await button.click({ force: true, timeout: 3_000 }).catch(() => {});
          return true;
        }
      }
    }
    return this.#canvaClickFirst(page, names, 700);
  }

  async #canvaDropLocalFiles(page, files) {
    const marker = `versa-drop-${randomUUID()}`;
    const created = await page.evaluate((id) => {
      const existing = document.getElementById(id);
      if (existing) existing.remove();
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = 'application/pdf,image/png,image/jpeg,image/jpg,.pdf,.png,.jpg,.jpeg';
      input.id = id;
      input.setAttribute('data-versa-drop', id);
      input.style.cssText = 'position:fixed;left:8px;top:8px;width:72px;height:72px;opacity:0.01;z-index:2147483647;';
      document.documentElement.appendChild(input);
      return true;
    }, marker).catch(() => false);
    if (!created) return false;
    const locator = page.locator(`[data-versa-drop="${marker}"]`).first();
    try {
      await locator.setInputFiles(files, { timeout: 30_000 });
    } catch {
      await page.evaluate((id) => document.getElementById(id)?.remove(), marker).catch(() => {});
      return false;
    }
    const dropped = await page.evaluate((id) => {
      const input = document.getElementById(id);
      if (!input?.files?.length) return false;
      const dt = new DataTransfer();
      for (const file of input.files) dt.items.add(file);
      const nodes = [
        ...document.querySelectorAll('[role="dialog"], [data-dropzone], [class*="dropzone"], [class*="Dropzone"], [aria-label*="Select media"], [aria-label*="select media"], [aria-label*="Upload"]'),
        document.body
      ];
      for (const node of nodes) {
        if (!node) continue;
        for (const type of ['dragenter', 'dragover', 'drop']) {
          node.dispatchEvent(new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            dataTransfer: dt
          }));
        }
      }
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, marker).catch(() => false);
    await page.evaluate((id) => document.getElementById(id)?.remove(), marker).catch(() => {});
    return dropped;
  }

  async #canvaReadPdfUploadState(page) {
    const empty = emptyCanvaPdfUploadState();
    if (!page || page.isClosed?.()) return empty;
    const snapshot = await page.evaluate(() => {
      const visible = (el) => {
        try {
          if (!el) return false;
          if (el.getClientRects?.()?.length) return true;
          if (el.offsetParent) return true;
          const cs = getComputedStyle(el);
          return Boolean(cs && cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity || 1) > 0);
        } catch {
          return false;
        }
      };
      const texts = [];
      const percents = [];
      let fileSelected = false;
      let fileName = '';
      let progressVisible = false;
      const takePercent = (value) => {
        const n = Number(value);
        if (!Number.isFinite(n)) return;
        percents.push(Math.max(0, Math.min(100, Math.round(n))));
      };
      const visit = (root) => {
        if (!root) return;
        try {
          if (root === document) {
            texts.push(String(document.body?.innerText || ''));
          } else {
            texts.push(String(root.innerText || ''));
          }
        } catch {}
        let nodes = [];
        try {
          nodes = root.querySelectorAll ? [...root.querySelectorAll('*')] : [];
        } catch {
          nodes = [];
        }
        for (const el of nodes) {
          try {
            if (el.tagName === 'INPUT' && String(el.type || '').toLowerCase() === 'file' && el.files?.length) {
              fileSelected = true;
              fileName = el.files[0]?.name || fileName;
            }
            const className = String(el.className || '');
            const label = `${el.getAttribute?.('aria-label') || ''} ${el.getAttribute?.('title') || ''} ${className}`;
            const uploadish = /upload|import|convert(ing)?|processing (your )?(file|pdf|document)/i.test(label);
            if (el.tagName === 'PROGRESS' && uploadish) {
              progressVisible = true;
              if (Number(el.max) > 0) takePercent((Number(el.value) / Number(el.max)) * 100);
            }
            const role = String(el.getAttribute?.('role') || '').toLowerCase();
            const ariaNow = el.getAttribute?.('aria-valuenow');
            if ((role === 'progressbar' || ariaNow != null) && uploadish) {
              if (visible(el) || ariaNow != null) {
                progressVisible = true;
                const now = Number.parseFloat(ariaNow || '');
                const max = Number.parseFloat(el.getAttribute('aria-valuemax') || '');
                if (Number.isFinite(now) && Number.isFinite(max) && max > 0 && max !== 100) takePercent((now / max) * 100);
                else takePercent(now);
              }
            }
            const widthMatch = String(el.style?.width || '').match(/(\d{1,3}(?:\.\d+)?)\s*%/);
            if (widthMatch && uploadish) {
              progressVisible = true;
              takePercent(widthMatch[1]);
            }
            const scaleMatch = String(el.style?.transform || '').match(/scaleX\(\s*(0(?:\.\d+)?|1(?:\.0+)?)\s*\)/i);
            if (scaleMatch && uploadish) {
              progressVisible = true;
              takePercent(Number(scaleMatch[1]) * 100);
            }
            if (el.shadowRoot) visit(el.shadowRoot);
          } catch {}
        }
      };
      visit(document);
      return {
        rawText: texts.join(' ').replace(/\s+/g, ' ').trim(),
        percents,
        fileSelected,
        fileName,
        progressVisible
      };
    }).catch(() => null);
    if (!snapshot) return empty;
    return summarizeCanvaPdfUploadText(snapshot.rawText, snapshot);
  }

  async #canvaPdfConvertPromptVisible(page) {
    const names = [
      /edit (this )?(file|pdf|document)/i,
      /convert (to )?(a )?(canva )?design/i,
      /create (a )?design from/i,
      /open as (a )?design/i,
      /open (in )?canva/i,
      /^open$/i,
      /make (it )?editable/i,
      /import (to|into) (a )?design/i
    ];
    for (const name of names) {
      if (await page.getByRole('button', { name }).first().isVisible({ timeout: 0 }).catch(() => false)) return true;
      if (await page.getByRole('link', { name }).first().isVisible({ timeout: 0 }).catch(() => false)) return true;
    }
    return false;
  }

  async #canvaFileInputHasPdf(page, files) {
    const names = (Array.isArray(files) ? files : [files])
      .map((item) => basename(String(item || '')).toLowerCase())
      .filter(Boolean);
    if (!page || !names.length) return false;
    return page.evaluate((wanted) => {
      const isSynthetic = (input) => {
        if (!input) return true;
        if (input.id === 'versa-pdf-file-input') return true;
        if (input.getAttribute?.('data-versa-pdf-input')) return true;
        if (input.getAttribute?.('data-versa-drop')) return true;
        return false;
      };
      const visit = (root) => {
        if (!root) return false;
        try {
          for (const input of root.querySelectorAll('input[type="file"]')) {
            if (isSynthetic(input)) continue;
            for (const file of input.files || []) {
              if (wanted.includes(String(file.name || '').toLowerCase())) return true;
            }
          }
          for (const el of root.querySelectorAll('*')) {
            if (el.shadowRoot && visit(el.shadowRoot)) return true;
          }
        } catch {}
        return false;
      };
      return visit(document);
    }, names).catch(() => false);
  }

  #canvaUploadLooksAlive(state = {}, traffic = null) {
    return isPdfUploadEvidence(state, {
      uploadish: Boolean(traffic?.uploadish && traffic?.active),
      uploads: Number(traffic?.uploads || 0)
    });
  }

  #canvaStartUploadTrafficWatch(page) {
    const traffic = {
      lastAt: 0,
      posts: 0,
      uploads: 0,
      uploadFinished: 0,
      designs: 0,
      designFinished: 0,
      active: false,
      uploadish: false,
      designish: false,
      lastUploadUrl: '',
      lastDesignUrl: ''
    };
    const requestUrls = new Map();
    const markUpload = (url) => {
      traffic.lastAt = Date.now();
      traffic.posts += 1;
      traffic.uploads += 1;
      traffic.active = true;
      traffic.uploadish = true;
      traffic.lastUploadUrl = url;
    };
    const markDesign = (url) => {
      traffic.lastAt = Date.now();
      traffic.designs += 1;
      traffic.designish = true;
      traffic.lastDesignUrl = url;
    };
    const fromRequest = (req) => {
      try {
        const url = String(req.url?.() || '');
        const method = String(req.method?.() || 'GET').toUpperCase();
        if (isPdfUploadNetworkUrl(url) && (method === 'POST' || method === 'PUT' || method === 'PATCH' || /upload/i.test(url))) {
          markUpload(url);
        } else if (isCanvaDesignCreateNetworkUrl(url) && method !== 'OPTIONS') {
          markDesign(url);
        }
      } catch {}
    };
    const fromFinished = (req) => {
      try {
        const url = String(req.url?.() || '');
        if (isPdfUploadNetworkUrl(url)) {
          traffic.uploadFinished += 1;
          traffic.lastAt = Date.now();
          traffic.lastUploadUrl = url;
        }
        if (isCanvaDesignCreateNetworkUrl(url)) {
          traffic.designFinished += 1;
          traffic.lastAt = Date.now();
          traffic.lastDesignUrl = url;
        }
      } catch {}
    };
    let target = page;
    try {
      const ctx = typeof page?.context === 'function' ? page.context() : this.context;
      if (ctx && typeof ctx.on === 'function') target = ctx;
    } catch {}
    try { target.on('request', fromRequest); } catch {}
    try { target.on('requestfinished', fromFinished); } catch {}
    let session = null;
    const bindCdp = async () => {
      try {
        const context = typeof page?.context === 'function' ? page.context() : this.context;
        session = context ? await context.newCDPSession(page).catch(() => null) : null;
        if (!session) return;
        await session.send('Network.enable').catch(() => {});
        session.on('Network.requestWillBeSent', (params) => {
          const url = String(params?.request?.url || '');
          const method = String(params?.request?.method || 'GET').toUpperCase();
          const id = params?.requestId;
          if (id) requestUrls.set(id, url);
          if (isPdfUploadNetworkUrl(url) && (method === 'POST' || method === 'PUT' || method === 'PATCH' || /upload/i.test(url))) {
            markUpload(url);
          } else if (isCanvaDesignCreateNetworkUrl(url) && method !== 'OPTIONS') {
            markDesign(url);
          }
        });
        session.on('Network.loadingFinished', (params) => {
          const url = requestUrls.get(params?.requestId) || '';
          if (isPdfUploadNetworkUrl(url)) {
            traffic.uploadFinished += 1;
            traffic.lastAt = Date.now();
            traffic.lastUploadUrl = url;
          }
          if (isCanvaDesignCreateNetworkUrl(url)) {
            traffic.designFinished += 1;
            traffic.lastAt = Date.now();
            traffic.lastDesignUrl = url;
          }
        });
      } catch {}
    };
    bindCdp().catch(() => {});
    return {
      snapshot() {
        const ago = traffic.lastAt ? Date.now() - traffic.lastAt : null;
        traffic.active = Boolean(traffic.lastAt) && ago != null && ago < 8_000;
        traffic.uploadish = traffic.active && traffic.uploads > 0;
        traffic.designish = Boolean(traffic.designs) && (traffic.active || traffic.designFinished > 0);
        return { ...traffic, ago };
      },
      stop() {
        try { target.off('request', fromRequest); } catch {}
        try { target.off('requestfinished', fromFinished); } catch {}
        try { session?.detach?.(); } catch {}
        session = null;
      }
    };
  }

  async #canvaPrintPdfAlreadyQueued(page, files) {
    if (await this.#canvaFileInputHasPdf(page, files)) return true;
    const state = await this.#canvaReadPdfUploadState(page);
    // Stale book.pdf in Uploads library must never count as our queued print PDF.
    if (/^book\.pdf$/i.test(String(state.fileName || '')) && !matchingCanvaPdfName('book.pdf', files)) {
      return false;
    }
    const wanted = (Array.isArray(files) ? files : [files]).map((item) => basename(String(item || ''))).filter(Boolean);
    const named = matchingCanvaPdfName(`${state.fileName || ''} ${state.text || ''}`, wanted);
    if (!named) return false;
    if (this.canvaPdfAttachedOnce) return true;
    if (shouldSkipCanvaPdfInject(state, { attachedOnce: this.canvaPdfAttachedOnce, files })) return true;
    if (this.#canvaUploadLooksAlive(state)) return true;
    return false;
  }

  async #canvaReportUploadTick(report, {
    percent = 10,
    message,
    state = {},
    startedAt,
    lastActivityAt,
    timeoutMs,
    started,
    status = 'running',
    error = null
  }) {
    if (typeof report !== 'function') return;
    const elapsedMs = Date.now() - startedAt;
    const remainingMs = Math.max(0, timeoutMs - elapsedMs);
    const idleRemainingMs = started
      ? Math.max(0, CANVA_UPLOAD_IDLE_MS - (Date.now() - lastActivityAt))
      : Math.max(0, CANVA_UPLOAD_START_MS - elapsedMs);
    await report(percent, message, {
      heartbeat: true,
      ...canvaDashboardPatch('upload', {
        status,
        error,
        upload: {
          percent: state.percent,
          elapsedMs,
          timeoutMs,
          remainingMs,
          idleRemainingMs,
          started: Boolean(started),
          fileName: state.fileName || '',
          progressVisible: Boolean(state.progressVisible)
        }
      })
    });
  }

  async #canvaWaitUntilPdfUploaded(page, { report = null, timeoutMs = CANVA_UPLOAD_TIMEOUT_MS } = {}) {
    const startedAt = Date.now();
    const startUrl = String(page?.url?.() || '');
    let lastPercent = null;
    let lastActivityAt = Date.now();
    let lastTickAt = 0;
    let started = false;
    let sawLiveUpload = false;
    let recoveries = 0;
    const watch = this.#canvaStartUploadTrafficWatch(page);
    const fail = async (message, code, extra = {}) => {
      await this.#canvaReportUploadTick(report, {
        percent: 10,
        message,
        state: extra.state || {},
        startedAt,
        lastActivityAt,
        timeoutMs,
        started,
        status: 'fail',
        error: message
      });
      throw Object.assign(new Error(message), { code });
    };
    try {
      while (Date.now() - startedAt < timeoutMs) {
        this.#throwIfCancelled();
        const href = String(page?.url?.() || '');
        const known = this.#canvaKnownDesignIds();
        const isFreshDesign = (item) => {
          if (!item || item.isClosed?.()) return false;
          const id = canvaDesignId(item.url?.() || '');
          if (!id) return false;
          if (known.size && known.has(id)) return false;
          return true;
        };
        let opened = isFreshDesign(page) ? page : null;
        if (!opened) {
          const adopted = await this.#canvaAdoptDesignPage(page, { allowKnown: false });
          if (isFreshDesign(adopted)) opened = adopted;
        }
        if (opened) {
          if (typeof report === 'function') {
            await report(11, 'Upload finished. Canva opened the design…', canvaDashboardPatch('upload', {
              status: 'ok',
              upload: { percent: 100, elapsedMs: Date.now() - startedAt, remainingMs: 0, started: true }
            }));
          }
          return opened;
        }
        const state = await this.#canvaReadPdfUploadState(page);
        const traffic = watch.snapshot();
        const wantedHit = matchingCanvaPdfName(`${state.fileName || ''} ${state.text || ''}`, this.canvaImportPdfNames || []);
        const trafficLive = Boolean(traffic?.uploadish && traffic?.active);
        const thisUpload = Boolean(wantedHit || trafficLive);
        if (isPdfUploadPickerWaiting(state) && !state.fileSelected) {
          started = false;
          sawLiveUpload = false;
        }
        const transferSuccess = thisUpload && isCanvaPdfTransferSuccess(state);
        const progressLive = Boolean(thisUpload && (
          (state.uploading && !isPdfUploadPickerWaiting(state))
          || state.converting
          || state.uploadFinished
          || transferSuccess
          || state.importInProgress
          || (state.percent != null && state.percent > 0 && state.percent < 100)
          || Number(state.uploadItems) > 0
          || isPdfUploadTraffic(traffic)
        ));
        if (progressLive || trafficLive || transferSuccess) {
          sawLiveUpload = true;
          started = true;
          lastActivityAt = Date.now();
        }
        if (thisUpload && (state.fileSelected || this.#canvaUploadLooksAlive(state, traffic) || transferSuccess)) {
          started = true;
        }
        if (thisUpload && state.percent != null && state.percent > 0 && state.percent !== lastPercent) {
          lastPercent = state.percent;
          lastActivityAt = Date.now();
          started = true;
          if (state.percent < 100) sawLiveUpload = true;
        }
        const finishedThisUpload = sawLiveUpload && thisUpload && (
          transferSuccess
          || state.uploadFinished
          || (state.percent != null && state.percent >= 100)
        );
        const convertReady = sawLiveUpload && thisUpload && !state.uploading && !state.busy && await this.#canvaPdfConvertPromptVisible(page);
        if (finishedThisUpload || convertReady || transferSuccess) {
          if (typeof report === 'function') {
            const pct = state.percent != null ? ` (${state.percent}%)` : '';
            await report(11, `Upload finished${pct}. Waiting for Canva to open the design…`, canvaDashboardPatch('upload', {
              status: 'ok',
              upload: { percent: state.percent == null ? 100 : state.percent, elapsedMs: Date.now() - startedAt, remainingMs: 0, started: true }
            }));
          }
          return page;
        }
        const networkDone = Number(traffic.uploadFinished || 0) > 0 && !trafficLive;
        const designNetwork = sawLiveUpload && Number(traffic.designFinished || 0) > 0;
        if (networkDone || designNetwork) {
          sawLiveUpload = true;
          started = true;
          if (typeof report === 'function') {
            await report(11, 'Upload finished on the real Canva upload/import request. Opening the design…', canvaDashboardPatch('upload', {
              status: 'ok',
              upload: { percent: 100, elapsedMs: Date.now() - startedAt, remainingMs: 0, started: true }
            }));
          }
          return page;
        }
        const elapsedMs = Date.now() - startedAt;
        if (!started && elapsedMs >= CANVA_UPLOAD_START_MS) {
          recoveries += 1;
          const recovered = await this.#canvaRecoverPdfImport(page, {
            message: `Canva did not start a real PDF upload after ${formatCanvaClock(elapsedMs)}. Opening from Uploads instead of waiting.`,
            report
          });
          if (recovered && recovered !== 'retry' && canvaDesignId(recovered.url?.() || '')) return recovered;
          if (recoveries >= 2) {
            // #region agent log
            this.#debugCanvaUpload('E', 'browser-controller.cjs:#canvaWaitUntilPdfUploaded', 'upload never started', {
              elapsedMs,
              recoveries,
              url: href.slice(0, 180),
              started,
              sawLiveUpload,
              traffic: {
                uploads: traffic?.uploads || 0,
                uploadFinished: traffic?.uploadFinished || 0,
                uploadish: Boolean(traffic?.uploadish),
                designs: traffic?.designs || 0
              },
              state: {
                fileName: state.fileName || '',
                percent: state.percent,
                fileSelected: Boolean(state.fileSelected),
                pickerWaiting: Boolean(state.pickerWaiting),
                uploading: Boolean(state.uploading)
              }
            });
            // #endregion
            await fail(
              `Canva did not start uploading the print PDF after ${formatCanvaClock(elapsedMs)}. Homepage traffic is not an upload. Recovery from Uploads failed.`,
              'CANVA_PDF_UPLOAD_NOT_STARTED',
              { state }
            );
          }
          started = false;
          sawLiveUpload = false;
          lastActivityAt = Date.now();
          continue;
        }
        if (typeof report === 'function' && Date.now() - lastTickAt >= 2_000) {
          lastTickAt = Date.now();
          const elapsed = formatCanvaClock(elapsedMs);
          const pct = state.percent != null ? `${state.percent}%` : (started ? 'in progress' : 'waiting for the 100% bar');
          const left = formatCanvaClock(started
            ? Math.max(0, CANVA_UPLOAD_IDLE_MS - (Date.now() - lastActivityAt))
            : Math.max(0, CANVA_UPLOAD_START_MS - elapsedMs));
          await this.#canvaReportUploadTick(report, {
            percent: 10,
            message: `Uploading the print PDF — ${pct} (${elapsed}). ${started ? `${left} left before a stuck retry` : `${left} left to show the bar`}. Watching the real upload request, not homepage POSTs.`,
            state,
            startedAt,
            lastActivityAt,
            timeoutMs,
            started
          });
        }
        if (started && Date.now() - lastActivityAt >= CANVA_UPLOAD_IDLE_MS && !trafficLive && !state.busy && !state.uploading && !state.converting && (state.percent == null || state.percent === 0)) {
          recoveries += 1;
          const recovered = await this.#canvaRecoverPdfImport(page, {
            message: `Canva went idle during PDF upload after ${formatCanvaClock(Date.now() - startedAt)}. Opening from Uploads automatically.`,
            report
          });
          if (recovered && recovered !== 'retry' && canvaDesignId(recovered.url?.() || '')) return recovered;
          if (recoveries >= 2) {
            await fail(
              `Canva did not finish uploading the print PDF after ${formatCanvaClock(Date.now() - startedAt)}. No real upload bytes. Recovery from Uploads failed.`,
              'CANVA_PDF_IMPORT_STUCK',
              { state }
            );
          }
          started = false;
          sawLiveUpload = false;
          lastActivityAt = Date.now();
          continue;
        }
        await this.#sleepOrPause(250);
      }
      {
        const recovered = await this.#canvaRecoverPdfImport(page, {
          message: `Canva did not finish uploading the print PDF after ${formatCanvaClock(timeoutMs)}. Opening from Uploads automatically.`,
          report
        });
        if (recovered && recovered !== 'retry' && canvaDesignId(recovered.url?.() || '')) return recovered;
      }
      await fail(
        `Canva did not finish uploading the print PDF after ${formatCanvaClock(timeoutMs)}. No design URL. Recovery from Uploads failed.`,
        'CANVA_PDF_IMPORT_STUCK',
        { state: {} }
      );
    } finally {
      watch.stop();
    }
  }

  async #canvaReconnectAndAdopt(page) {
    if (this.skipWindowChrome) return page;
    try {
      await this.launch({
        skipHome: true,
        forceBrowser: true,
        interactive: this.interactiveVisible && !this.canvaBackgroundLock
      });
      const next = await this.#canvaPage();
      return await this.#canvaAdoptDesignPage(next, { allowKnown: false }) || next;
    } catch {
      return page;
    }
  }

  async #canvaGotoUploadsAndOpen(page, report = null) {
    if (canvaDesignId(page?.url?.() || '')) return page;
    if (this.skipWindowChrome) return null;
    const state = await this.#canvaReadPdfUploadState(page);
    if (!isCanvaPdfTransferSuccess(state) && !state.importInProgress && this.canvaPdfAttachedOnce) {
      return null;
    }
    const urls = [CANVA_UPLOADS_FOLDER_URL, CANVA_PROJECTS_URL];
    for (const href of urls) {
      this.#throwIfCancelled();
      try {
        await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      } catch {}
      await this.#sleepOrPause(180);
      const opened = await this.#canvaOpenImportedPdfDesign(page, { report });
      if (opened && canvaDesignId(opened.url())) return opened;
      const adopted = await this.#canvaWaitForOpenedDesign(page, 4_000);
      if (adopted) return adopted;
    }
    return null;
  }

  async #canvaRecoverPdfImport(page, { message, report = null } = {}) {
    const policy = decideImportRecovery('PDF_IMPORT', (this.canvaJob?.retryCount || 0) + 1);
    this.canvaJob?.enter('RECOVERING', {
      action: policy.action,
      expected: 'PDF in Uploads / import in progress — opening design'
    });
    this.canvaJob?.clearIntervention();
    this.humanPaused = false;
    if (typeof report === 'function') {
      await report(10, `${message || 'PDF import stuck.'} Recovering automatically — Uploads, last design, then CDP reconnect. No manual click.`, {
        intervention: null,
        waitExplanation: explainWait({
          expected: 'editor URL /design/ after opening the imported PDF',
          detected: 'still on Canva home — recovering',
          recoveryAttempted: true,
          state: 'RECOVERING'
        }),
        ...canvaDashboardPatch('upload', { status: 'running' })
      });
    }
    await this.#canvaClosePdfUploadPanel(page);
    await this.#canvaNudgePdfConvert(page);
    const state = await this.#canvaReadPdfUploadState(page);
    const wantedHit = matchingCanvaPdfName(`${state.fileName || ''} ${state.text || ''}`, this.canvaImportPdfNames || []);
    if (this.canvaPdfAttachedOnce && wantedHit) {
      let opened = await this.#canvaOpenImportedPdfDesign(page, { report });
      if (opened && canvaDesignId(opened.url())) {
        const count = await this.#canvaEditorPageCount(opened, this.canvaJob?.expectedPages || 0);
        if (!looksLikeLeftoverCanvaCount(count, this.canvaJob?.expectedPages || 0)) {
          await this.#canvaReportOpenedDesign(opened, report, 12);
          return opened;
        }
      }
    }
    await page.goto(CANVA_HOME_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => null);
    this.canvaPdfAttachedOnce = false;
    if (this.canvaImportPdfPath) {
      await this.#enableFileChooserIntercept(page);
      const chooserWait = this.#waitForFileChooserOrAbort(page, 12_000);
      await this.#canvaRevealPdfDropzone(page);
      await this.#canvaInjectLocalPdf(page, [this.canvaImportPdfPath], { report, chooserPromise: chooserWait });
    }
    return 'retry';
  }

  async #canvaPdfDropzoneVisible(page) {
    const state = await this.#canvaReadPdfUploadState(page);
    if (state.pickerWaiting) return true;
    const dialog = page.getByRole('dialog').first();
    if (!(await dialog.isVisible({ timeout: 0 }).catch(() => false))) return false;
    const text = String(await dialog.innerText().catch(() => '') || '');
    return /drop your (files|content) here|upload files|upload folder|canva supports images/i.test(text)
      && !/uploaded to uploads|imports in progress|currently being imported/i.test(text);
  }

  // STAGE: PDF_IMPORT — open upload/import UI only. Do not call Magic Layers / Share from here.
  async #canvaDomClickUploadish(page) {
    return page.evaluate(() => {
      const labelOf = (el) => {
        const aria = (el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        return { aria, text, joined: `${aria} ${text}`.replace(/\s+/g, ' ').trim() };
      };
      // Live Canva home uses concatenated labels like "UploadAdd media" — match those (proven 2026-09-04 CDP PASS).
      const isHit = (el) => {
        const { aria, text, joined } = labelOf(el);
        if (text.length > 72) return false;
        return /^(import files?|upload files?|uploads|your uploads|from (your )?(computer|device)|choose files|browse files|add media|upload)$/i.test(aria)
          || /^(import files?|upload files?|uploads|your uploads|add media|upload)$/i.test(text)
          || /^(import files?|upload files?|add media)$/i.test(joined)
          || (/import files?|upload files?|add media|from computer|from device|choose files|browse files|^upload$/i.test(aria) && aria.length < 40)
          || (/^upload$/i.test(text) && /add media/i.test(joined))
          || (/upload\s*add media|add media|upload files?|import files?/i.test(joined) && joined.length < 40)
          || (/upload/i.test(joined) && /add media/i.test(joined) && joined.length < 40);
      };
      const nodes = [...document.querySelectorAll('button, [role="button"], [role="menuitem"], [role="option"], a, li')];
      const candidates = nodes.filter(isHit).slice(0, 12).map((el) => labelOf(el).joined.slice(0, 80));
      const hit = nodes.find(isHit);
      if (!hit) return { ok: false, reason: 'miss', candidates };
      const target = hit.closest('button, [role="button"], [role="menuitem"], [role="option"], a') || hit;
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      target.click();
      return { ok: true, reason: 'dom', label: labelOf(target).joined.slice(0, 80), candidates };
    }).catch(() => ({ ok: false, reason: 'evaluate-failed', candidates: [] }));
  }

  async #canvaDismissStalePdfPicker(page, files = []) {
    const wantedList = (files.length ? files : (this.canvaImportPdfNames || []))
      .map((item) => basename(String(item || '')).toLowerCase())
      .filter(Boolean);
    const state = await this.#canvaReadPdfUploadState(page);
    const wanted = matchingCanvaPdfName(`${state.fileName || ''} ${state.text || ''}`, wantedList);
    const staleName = String(state.fileName || '');
    const isStaleBook = /^book\.pdf$/i.test(staleName) && !wantedList.includes('book.pdf');
    if (!(state.fileSelected && state.fileName && !wanted) && !isStaleBook) return false;
    // #region agent log
    this.#debugCanvaUpload('E', 'browser-controller.cjs:#canvaDismissStalePdfPicker', 'dismiss stale picker', {
      fileName: state.fileName || '',
      wanted: wantedList,
      isStaleBook,
      runId: 'post-fix',
      hypothesisId: 'E'
    });
    // #endregion
    // Clear file inputs holding a non-wanted PDF (esp. leftover book.pdf).
    await page.evaluate((wantedNames) => {
      const visit = (root) => {
        if (!root) return;
        try {
          for (const input of root.querySelectorAll('input[type="file"]')) {
            const name = String(input.files?.[0]?.name || '').toLowerCase();
            if (!name) continue;
            if (wantedNames.length && wantedNames.includes(name)) continue;
            try {
              input.value = '';
            } catch {}
            try {
              const dt = new DataTransfer();
              input.files = dt.files;
            } catch {}
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }
          for (const el of root.querySelectorAll('*')) {
            if (el.shadowRoot) visit(el.shadowRoot);
          }
        } catch {}
      };
      visit(document);
    }, wantedList).catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
    await this.#canvaClosePdfUploadPanel(page);
    await this.#sleepOrPause(120);
    return true;
  }

  async #canvaRevealPdfDropzone(page) {
    const state = await this.#canvaReadPdfUploadState(page);
    if (shouldSkipCanvaPdfInject(state, { attachedOnce: this.canvaPdfAttachedOnce, files: this.canvaImportPdfNames || [] })) return false;
    if (await this.#canvaPdfDropzoneVisible(page)) return true;
    await this.#canvaDismissStalePdfPicker(page, this.canvaImportPdfNames || []);
    let importClicked = false;
    let createClicked = false;
    let uploadsClicked = false;
    let gotoUploads = false;
    let chooserOpened = false;
    let realPdfInput = false;
    let domUpload = { ok: false, reason: 'skipped', candidates: [] };
    // Home path that live-passed: Upload / Add media FIRST (before Create), then Upload files chooser.
    // Create-first often opens a panel with no PDF dropzone and wastes the attach window.
    uploadsClicked = await this.#canvaClickFirst(page, [
      /^upload$/i,
      /add media/i,
      /^uploads$/i,
      /your uploads/i,
      /upload files/i
    ], 900);
    if (!(await this.#canvaPdfDropzoneVisible(page))) {
      domUpload = await this.#canvaDomClickUploadish(page);
      if (domUpload?.ok) {
        uploadsClicked = true;
        await this.#sleepOrPause(280);
      }
    }
    if (!(await this.#canvaPdfDropzoneVisible(page))) {
      importClicked = await this.#canvaClickFirst(page, [/^import files$/i, /^import file$/i, /import files/i, /import file/i], 900);
    }
    if (!importClicked && !(await this.#canvaPdfDropzoneVisible(page))) {
      createClicked = await this.#canvaClickFirst(page, [/create a design/i, /create design/i], 800);
      await this.#sleepOrPause(220);
      importClicked = await this.#canvaClickFirst(page, [/^import files$/i, /^import file$/i, /import files/i, /import file/i], 900);
    }
    // Always run DomClick when dropzone still hidden — do not skip just because Uploads was clicked.
    if (!(await this.#canvaPdfDropzoneVisible(page))) {
      const domAgain = await this.#canvaDomClickUploadish(page);
      if (domAgain?.ok) {
        domUpload = domAgain;
        uploadsClicked = true;
        await this.#sleepOrPause(280);
      }
    }
    const tab = page.getByRole('tab', { name: /^upload$/i }).first();
    const uploadTabVisible = await tab.isVisible({ timeout: 0 }).catch(() => false);
    if (uploadTabVisible) {
      await tab.click({ force: true, timeout: 1_200 }).catch(() => {});
    }
    const deadline = Date.now() + 2_400;
    let visible = await this.#canvaPdfDropzoneVisible(page);
    while (!visible && Date.now() < deadline) {
      this.#throwIfCancelled();
      await this.#sleepOrPause(120);
      visible = await this.#canvaPdfDropzoneVisible(page);
    }
    // Once the Create/Upload panel is open, prefer "Upload files" (chooser) over "Upload folder".
    if (visible) {
      const uploadFilesClicked = await this.#canvaClickFirst(page, [/^upload files$/i], 700);
      if (uploadFilesClicked) {
        importClicked = true;
        chooserOpened = true;
        await this.#sleepOrPause(180);
      }
    }
    realPdfInput = await this.#canvaHasRealPdfFileInput(page);

    // After Create/Uploads fail to show dropzone: open Uploads folder then inject via file input / chooser.
    // Do NOT wait/consume filechooser here — pickLocalFiles owns the chooser waiter and must set files.
    if (!visible && !realPdfInput) {
      gotoUploads = true;
      await page.goto(CANVA_UPLOADS_FOLDER_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => null);
      await this.#sleepOrPause(400);
      await this.#canvaDismissStalePdfPicker(page, this.canvaImportPdfNames || []);
      uploadsClicked = (await this.#canvaClickFirst(page, [/^uploads$/i, /upload files/i, /import files/i, /^upload$/i], 900)) || uploadsClicked;
      const domAgain = await this.#canvaDomClickUploadish(page);
      if (domAgain?.ok) {
        domUpload = domAgain;
        uploadsClicked = true;
      }
      await this.#canvaClickUploadControls(page).catch(() => false);
      visible = await this.#canvaPdfDropzoneVisible(page);
      if (visible) {
        const uploadFilesClicked = await this.#canvaClickFirst(page, [/^upload files$/i], 700);
        if (uploadFilesClicked) {
          chooserOpened = true;
          await this.#sleepOrPause(180);
        }
      }
      if (!realPdfInput) {
        await this.#ensureHiddenCanvaPdfFileInput(page);
        realPdfInput = await this.#canvaHasRealPdfFileInput(page);
      }
    }

    // Never return fake success from uploadsClicked alone.
    const ok = Boolean(visible || chooserOpened || realPdfInput);
    // #region agent log
    this.#debugCanvaUpload('A', 'browser-controller.cjs:#canvaRevealPdfDropzone', 'reveal import UI', {
      createClicked,
      uploadsClicked,
      uploadTabVisible,
      importClicked,
      visible,
      gotoUploads,
      chooserOpened,
      realPdfInput,
      ok,
      domUpload,
      url: String(page.url() || '').slice(0, 180),
      runId: 'post-fix',
      hypothesisId: 'A'
    });
    // #endregion
    return ok;
  }

  async #canvaPdfAttachEvidence(page, files) {
    if (await this.#canvaFileInputHasPdf(page, files)) return true;
    if (await this.#canvaConfirmPdfAttached(page, files)) return true;
    const state = await this.#canvaReadPdfUploadState(page);
    const named = matchingCanvaPdfName(`${state.fileName || ''} ${state.text || ''}`, files);
    // Never treat leftover book.pdf as our upload evidence.
    if (/^book\.pdf$/i.test(String(state.fileName || '')) && !matchingCanvaPdfName('book.pdf', files)) {
      return Boolean(await this.#canvaUploadTook(page));
    }
    if (named && (state.uploading || state.fileSelected || isCanvaPdfTransferSuccess(state) || Number(state.uploadItems) > 0)) return true;
    if (await this.#canvaUploadTook(page)) return true;
    return false;
  }

  async #canvaInjectLocalPdf(page, files, { report = null, chooserPromise = null } = {}) {
    if (await this.#canvaFileInputHasPdf(page, files)) {
      this.canvaPdfAttachedOnce = true;
      return true;
    }
    const alreadyQueued = await this.#canvaPrintPdfAlreadyQueued(page, files);
    if (alreadyQueued) {
      this.canvaPdfAttachedOnce = true;
      // #region agent log
      this.#debugCanvaUpload('B', 'browser-controller.cjs:#canvaInjectLocalPdf', 'skipped inject already queued', {
        attachedOnce: Boolean(this.canvaPdfAttachedOnce),
        files: (Array.isArray(files) ? files : [files]).map((item) => basename(String(item || '')))
      });
      // #endregion
      return true;
    }
    let waiter = chooserPromise;
    if (!waiter) {
      await this.#enableFileChooserIntercept(page);
      waiter = this.#waitForFileChooserOrAbort(page, 12_000);
      await this.#canvaRevealPdfDropzone(page);
    }
    let settledChooser = null;
    Promise.resolve(waiter).then((value) => { settledChooser = value; }).catch(() => {});
    let attached = false;
    let via = null;
    const startedAt = Date.now();
    while (!attached && Date.now() - startedAt < 12_000) {
      this.#throwIfCancelled();
      if (settledChooser) {
        attached = await this.#applyChooserFiles(page, settledChooser, files);
        if (attached) via = 'chooser';
        settledChooser = null;
        if (attached) break;
      }
      if (Date.now() - startedAt >= 800) {
        await this.#setFileChooserIntercept(page, false);
        attached = await this.#setAnyPageFileInput(page, files);
        if (attached) {
          via = 'file-input';
          break;
        }
        if (await this.#canvaFileInputHasPdf(page, files)) {
          attached = true;
          via = 'has-pdf';
          break;
        }
      }
      await this.#sleepOrPause(200);
    }
    if (!attached) {
      const dedicated = await this.#cdpSetFilesOnHiddenPdfInput(page, files).catch(() => false);
      if (dedicated && await this.#canvaPdfAttachEvidence(page, files)) {
        attached = true;
        via = 'dedicated-pdf-input';
      }
    }
    if (!attached) {
      const dropped = await this.#canvaDropLocalFiles(page, files).catch(() => false);
      // Never mark success on drop without attach evidence / wanted filename / upload network.
      if (dropped && await this.#canvaPdfAttachEvidence(page, files)) {
        attached = true;
        via = 'drop';
      }
    }
    const hasPdf = attached ? await this.#canvaPdfAttachEvidence(page, files) : false;
    // #region agent log
    this.#debugCanvaUpload('C', 'browser-controller.cjs:#canvaInjectLocalPdf', 'inject result', {
      attached: Boolean(attached),
      via,
      hasPdf,
      chooser: via === 'chooser',
      url: String(page.url() || '').slice(0, 180),
      runId: 'post-fix',
      hypothesisId: 'C'
    });
    // #endregion
    if ((via === 'chooser' || via === 'file-input' || via === 'drop' || via === 'has-pdf' || via === 'dedicated-pdf-input') && hasPdf) {
      this.canvaPdfAttachedOnce = true;
      return true;
    }
    return false;
  }

  async #pickLocalFilesInPage(page, paths, { clickName = /import files|import file|upload files|^upload$/i, mediaPicker = true, report = null } = {}) {
    this.#throwIfCancelled();
    const files = localUploadFiles(paths);
    if (!files.length) {
      throw Object.assign(new Error('No local files were available to upload.'), { code: 'UPLOAD_FILES_MISSING' });
    }

    if (await this.#canvaPrintPdfAlreadyQueued(page, files)) {
      const queuedState = await this.#canvaReadPdfUploadState(page);
      const emptyPicker = isPdfUploadPickerWaiting(queuedState)
        && !queuedState.fileSelected
        && !isCanvaPdfTransferSuccess(queuedState)
        && !shouldSkipCanvaPdfInject(queuedState, { attachedOnce: true, files });
      if (emptyPicker && !this.canvaPdfAttachedOnce) {
        this.canvaPdfAttachedOnce = false;
      } else {
        if (typeof report === 'function') {
          await report(10, isCanvaPdfTransferSuccess(queuedState)
            ? 'PDF in Uploads / import in progress — opening design'
            : 'Canva is already uploading the print PDF. Waiting until this single upload finishes 100%…', canvaDashboardPatch('upload', { status: 'running' }));
        }
        this.canvaPdfAttachedOnce = true;
        await this.#canvaWaitUntilPdfUploaded(page, { report });
        return;
      }
    }

    if (typeof report === 'function') {
      await report(9, 'Sending print PDF from VERSA…', canvaDashboardPatch('import', { status: 'running' }));
    }

    await this.#canvaDismissStalePdfPicker(page, files);
    await this.#enableFileChooserIntercept(page);
    let chooser = null;
    const chooserWait = this.#waitForFileChooserOrAbort(page, 8_000).then((value) => {
      chooser = value;
      return value;
    });

    const uploadTook = async (waitMs = 2_400) => {
      const until = Date.now() + waitMs;
      while (Date.now() < until) {
        if (await this.#canvaPdfAttachEvidence(page, files)) return true;
        await this.#sleepOrPause(80);
      }
      return this.#canvaPdfAttachEvidence(page, files);
    };
    const acceptFiles = async () => {
      if (chooser && await this.#applyChooserFiles(page, chooser, files)) return true;
      if (await this.#setAnyPageFileInput(page, files)) return true;
      return false;
    };
    const tryAccept = async () => (await acceptFiles()) && (await uploadTook());

    if (await tryAccept()) {
      this.canvaPdfAttachedOnce = true;
      // #region agent log
      this.#debugCanvaUpload('B', 'browser-controller.cjs:#pickLocalFilesInPage', 'after first inject', {
        attached: true,
        confirmed: true,
        attachedOnce: true,
        via: 'early-accept',
        url: String(page.url() || '').slice(0, 180),
        runId: 'post-fix',
        hypothesisId: 'B'
      });
      // #endregion
      await this.#canvaWaitUntilPdfUploaded(page, { report });
      return;
    }

    await this.#canvaRevealPdfDropzone(page);
    if (await tryAccept()) {
      this.canvaPdfAttachedOnce = true;
      await this.#canvaWaitUntilPdfUploaded(page, { report });
      return;
    }

    await this.#canvaClickUploadControls(page);
    await this.#sleepOrPause(80);
    if (await tryAccept()) {
      this.canvaPdfAttachedOnce = true;
      await this.#canvaWaitUntilPdfUploaded(page, { report });
      return;
    }

    const clickPatterns = [
      /upload files/i,
      /upload media/i,
      /^upload$/i,
      /import files/i,
      /import file/i,
      /from (your )?(computer|device)/i,
      /choose files/i,
      /browse files/i,
      clickName
    ];
    for (const pattern of clickPatterns) {
      this.#throwIfCancelled();
      await this.#canvaClickByName(page, pattern, 280);
      await this.#sleepOrPause(50);
      if (await tryAccept()) {
        this.canvaPdfAttachedOnce = true;
        await this.#canvaWaitUntilPdfUploaded(page, { report });
        return;
      }
    }

    chooser = await chooserWait;
    if (chooser && await this.#applyChooserFiles(page, chooser, files) && await uploadTook()) {
      this.canvaPdfAttachedOnce = true;
      await this.#canvaWaitUntilPdfUploaded(page, { report });
      return;
    }
    if (await this.#setAnyPageFileInput(page, files) && await uploadTook()) {
      this.canvaPdfAttachedOnce = true;
      await this.#canvaWaitUntilPdfUploaded(page, { report });
      return;
    }
    // Explicit Uploads-folder fallback before giving up.
    if (!/folder\/_uploads/i.test(String(page.url() || ''))) {
      await page.goto(CANVA_UPLOADS_FOLDER_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => null);
      await this.#sleepOrPause(350);
      await this.#canvaDismissStalePdfPicker(page, files);
      await this.#canvaRevealPdfDropzone(page);
      if (await tryAccept()) {
        this.canvaPdfAttachedOnce = true;
        await this.#canvaWaitUntilPdfUploaded(page, { report });
        return;
      }
      if (await this.#cdpSetFilesOnHiddenPdfInput(page, files) && await uploadTook(3_200)) {
        this.canvaPdfAttachedOnce = true;
        await this.#canvaWaitUntilPdfUploaded(page, { report });
        return;
      }
    }
    if (await this.#canvaDropLocalFiles(page, files) && await uploadTook(2_400)) {
      this.canvaPdfAttachedOnce = true;
      await this.#canvaWaitUntilPdfUploaded(page, { report });
      return;
    }

    // #region agent log
    this.#debugCanvaUpload('B', 'browser-controller.cjs:#pickLocalFilesInPage', 'after first inject', {
      attached: false,
      confirmed: false,
      attachedOnce: Boolean(this.canvaPdfAttachedOnce),
      via: 'exhausted',
      url: String(page.url() || '').slice(0, 180),
      runId: 'post-fix',
      hypothesisId: 'B'
    });
    // #endregion

    const recovered = await this.#canvaRecoverPdfImport(page, {
      message: 'Canva did not take the print PDF. Recovering from Uploads without a second attach.',
      report
    });
    if (recovered && recovered !== 'retry' && canvaDesignId(recovered.url?.() || '')) return;
    const queued = await this.#canvaReadPdfUploadState(page);
    const queuedNamed = matchingCanvaPdfName(`${queued.fileName || ''} ${queued.text || ''}`, files);
    if (queuedNamed && (shouldSkipCanvaPdfInject(queued, { attachedOnce: this.canvaPdfAttachedOnce, files }) || isCanvaPdfTransferSuccess(queued))) {
      this.canvaPdfAttachedOnce = true;
      await this.#canvaWaitUntilPdfUploaded(page, { report });
      return;
    }
    throw Object.assign(new Error('Canva did not take the print PDF. Recovery from Uploads failed. Not waiting for a manual click.'), {
      code: 'FILE_INPUT_NOT_FOUND'
    });
  }

  async #canvaConfirmPdfAttached(page, files) {
    const wanted = (Array.isArray(files) ? files : [files]).map((item) => basename(String(item || ''))).filter(Boolean);
    const deadline = Date.now() + 4_000;
    while (Date.now() < deadline) {
      this.#throwIfCancelled();
      if (await this.#canvaFileInputHasPdf(page, files)) return true;
      const known = this.#canvaKnownDesignIds();
      const href = page?.url?.() || '';
      const freshId = canvaDesignId(href);
      if (freshId && (!known.size || !known.has(freshId))) return true;
      const state = await this.#canvaReadPdfUploadState(page);
      const named = matchingCanvaPdfName(`${state.fileName || ''} ${state.text || ''}`, wanted);
      if (named && !isPdfUploadPickerWaiting(state) && (state.fileSelected || isPdfUploadEvidence(state))) return true;
      await this.#sleepOrPause(200);
    }
    const state = await this.#canvaReadPdfUploadState(page);
    const named = matchingCanvaPdfName(`${state.fileName || ''} ${state.text || ''}`, wanted);
    const confirmed = Boolean(named && !isPdfUploadPickerWaiting(state) && (state.fileSelected || isPdfUploadEvidence(state)));
    // #region agent log
    this.#debugCanvaUpload('B', 'browser-controller.cjs:#canvaConfirmPdfAttached', 'confirm attach', {
      confirmed,
      named,
      wanted,
      fileName: state.fileName || '',
      fileSelected: Boolean(state.fileSelected)
    });
    // #endregion
    return confirmed;
  }

  #canvaContextPages(page) {
    try {
      return (typeof page?.context === 'function' ? page.context() : this.context)?.pages?.() || [];
    } catch {
      return [];
    }
  }

  #canvaDesignIds(page) {
    const ids = new Set();
    for (const item of this.#canvaContextPages(page)) {
      const id = canvaDesignId(item?.url?.() || '');
      if (id) ids.add(id);
    }
    return ids;
  }

  #canvaKnownDesignIds() {
    return this.canvaImportKnownDesignIds instanceof Set ? this.canvaImportKnownDesignIds : new Set();
  }

  async #canvaAdoptDesignPage(preferred = null, { allowKnown = true } = {}) {
    const known = this.#canvaKnownDesignIds();
    const pages = this.#canvaContextPages(preferred);
    const fresh = pages.find((item) => {
      if (!item || item.isClosed()) return false;
      const id = canvaDesignId(item.url());
      return id && !known.has(id);
    });
    if (fresh) {
      this.canvaPage = fresh;
      return fresh;
    }
    if (!allowKnown) return preferred && canvaDesignId(preferred.url?.() || '') && !known.has(canvaDesignId(preferred.url())) ? preferred : null;
    const hit = pages.find((item) => item && !item.isClosed() && canvaDesignId(item.url()));
    if (hit) {
      this.canvaPage = hit;
      return hit;
    }
    return preferred;
  }

  async #canvaUploadTook(page) {
    const known = this.#canvaKnownDesignIds();
    const freshId = (href) => {
      const id = canvaDesignId(href || '');
      return Boolean(id && (!known.size || !known.has(id)));
    };
    if (freshId(page?.url?.() || '')) return true;
    if (await this.#canvaImportIndicatorVisible(page)) return true;
    const adopted = await this.#canvaAdoptDesignPage(page, { allowKnown: false });
    return Boolean(adopted && freshId(adopted.url?.() || ''));
  }

  async #canvaTakeImportTarget(page, popupPromise) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 8_000) {
      this.#throwIfCancelled();
      const adopted = await this.#canvaAdoptDesignPage(page, { allowKnown: false });
      if (adopted && canvaDesignId(adopted.url())) return adopted;
      const currentId = canvaDesignId(page?.url?.() || '');
      const known = this.#canvaKnownDesignIds();
      if (currentId && (!known.size || !known.has(currentId))) return page;
      const popup = await Promise.race([
        Promise.resolve(popupPromise),
        sleep(40).then(() => null)
      ]);
      if (popup && typeof popup.url === 'function' && !popup.isClosed?.() && canvaDesignId(popup.url())) {
        this.canvaPage = popup;
        return popup;
      }
      await this.#sleepOrPause(80);
    }
    const popup = await Promise.race([
      Promise.resolve(popupPromise),
      sleep(20).then(() => null)
    ]);
    if (popup && typeof popup.url === 'function' && !popup.isClosed?.()) {
      this.canvaPage = popup;
      return popup;
    }
    return await this.#canvaAdoptDesignPage(page, { allowKnown: false }) || page;
  }

  async #canvaNudgePdfConvert(page) {
    if (!(await this.#canvaPdfConvertPromptVisible(page))) return false;
    return this.#canvaClickFirst(page, [
      /edit (this )?(file|pdf|document)/i,
      /open as (a )?design/i,
      /^open$/i,
      /open (this )?(file|pdf|document)/i,
      /convert (to )?(a )?(canva )?design/i,
      /create (a )?design from/i,
      /make (it )?editable/i
    ], 280);
  }

  async #canvaWaitForOpenedDesign(page, timeoutMs = 6_000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      this.#throwIfCancelled();
      const adopted = await this.#canvaAdoptDesignPage(page, { allowKnown: false });
      if (adopted && canvaDesignId(adopted.url())) {
        this.canvaPage = adopted;
        return adopted;
      }
      if (canvaDesignId(page?.url?.() || '')) return page;
      await this.#sleepOrPause(120);
    }
    const adopted = await this.#canvaAdoptDesignPage(page, { allowKnown: false });
    return adopted && canvaDesignId(adopted.url()) ? adopted : null;
  }

  #canvaRememberOpenedDesign(page, report = null) {
    const url = toCanvaDesignUrl(page?.url?.() || '');
    if (!url) return '';
    this.canvaPdfAttachedOnce = true;
    if (this.canvaJob && (this.canvaJob.designUrl !== url || !this.canvaJob.pdfUploaded)) {
      this.canvaJob.markPdfUploaded(url);
    }
    return url;
  }

  async #canvaReportOpenedDesign(page, report, percent = 12) {
    const url = this.#canvaRememberOpenedDesign(page, report);
    if (!url || typeof report !== 'function' || this._canvaReportedDesignUrl === url) return url;
    this._canvaReportedDesignUrl = url;
    await report(percent, 'Opened the imported design. Waiting for every page before Magic Layer…', {
      designUrl: url,
      pdfUploaded: true,
      ...canvaDashboardPatch('thumbnails', { status: 'running' })
    });
    return url;
  }

  async #canvaClosePdfUploadPanel(page) {
    const state = await this.#canvaReadPdfUploadState(page);
    if (!isCanvaPdfTransferSuccess(state) && !state.importInProgress && !(Number(state.uploadItems) > 0)) {
      return false;
    }
    return page.evaluate(() => {
      const widgets = [...document.querySelectorAll('[role="dialog"], [role="status"], [aria-live], section, aside, div')];
      for (const widget of widgets) {
        const text = String(widget.innerText || '');
        if (!/items uploaded|uploaded to uploads|imports in progress/i.test(text)) continue;
        if (text.length > 3_500) continue;
        const buttons = [...widget.querySelectorAll('button, [role="button"]')];
        const close = buttons.find((btn) => {
          const parts = [
            btn.getAttribute('aria-label') || '',
            btn.getAttribute('title') || '',
            btn.textContent || ''
          ].map((part) => String(part).replace(/\s+/g, ' ').trim()).filter(Boolean);
          if (parts.some((part) => /cancel|abort|stop upload|remove|delete/i.test(part))) return false;
          return parts.some((part) => /^(close|dismiss|minimize)$/i.test(part) || /close (panel|window|dialog)/i.test(part));
        });
        if (close) {
          close.click();
          return true;
        }
      }
      return false;
    }).catch(() => false);
  }

  async #canvaOpenImportedPdfDesign(page, { report = null } = {}) {
    if (canvaDesignId(page?.url?.() || '')) return page;
    this.canvaJob?.enter('PROJECT_OPENING', {
      action: 'open-imported-pdf',
      expected: 'PDF in Uploads / import in progress — opening design'
    });
    if (typeof report === 'function') {
      await report(12, 'PDF in Uploads / import in progress — opening design', {
        expected: 'PDF in Uploads / import in progress — opening design',
        detected: 'Canva home with upload/import widget',
        ...canvaDashboardPatch('thumbnails', { status: 'running' })
      });
    }
    const labels = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('button, a, [role="button"], [role="link"], [role="listitem"], [role="option"]')];
      return nodes
        .map((el) => `${el.getAttribute('aria-label') || ''} ${el.textContent || ''}`.replace(/\s+/g, ' ').trim())
        .filter((label) => label && label.length < 240);
    }).catch(() => []);
    const picked = pickCanvaPdfOpenClick(labels, this.canvaImportPdfNames || []);
    // #region agent log
    this.#debugCanva('G', 'browser-controller.cjs:#canvaOpenImportedPdfDesign', 'open imported pdf click', {
      picked: picked?.name || null,
      wanted: this.canvaImportPdfNames || [],
      sample: (labels || []).filter((label) => /\.pdf|open as|imports in progress|uploads/i.test(label)).slice(0, 8)
    });
    // #endregion
    if (picked?.name) {
      await page.evaluate((wanted) => {
        const nodes = [...document.querySelectorAll('button, a, [role="button"], [role="link"], [role="listitem"], [role="option"]')];
        for (const el of nodes) {
          const label = `${el.getAttribute('aria-label') || ''} ${el.textContent || ''}`.replace(/\s+/g, ' ').trim();
          if (label === wanted || (wanted.length > 8 && label.includes(wanted))) {
            el.click();
            return true;
          }
        }
        return false;
      }, picked.name).catch(() => false);
    }
    let opened = await this.#canvaWaitForOpenedDesign(page, 3_000);
    if (opened) return opened;
    await this.#canvaNudgePdfConvert(page);
    opened = await this.#canvaWaitForOpenedDesign(page, 2_000);
    if (opened) return opened;
    return page;
  }

  async #canvaImportIndicatorVisible(page) {
    const state = await this.#canvaReadPdfUploadState(page);
    if (state.busy || state.uploading || (state.percent != null && state.percent < 100)) return true;
    if ((state.converting || state.importInProgress || isCanvaPdfTransferSuccess(state)) && !canvaDesignId(page?.url?.() || '')) return true;
    const pattern = /importing|uploading|converting|processing your (file|pdf|document)|preparing your (design|file)|this may take a (few )?(minutes|moments)/i;
    if (await page.getByText(pattern).first().isVisible({ timeout: 0 }).catch(() => false)) return true;
    const bar = page.locator('[aria-label*="importing" i], [aria-label*="uploading" i], [aria-label*="converting" i], [aria-label*="import" i][role="progressbar"]').first();
    return bar.isVisible({ timeout: 0 }).catch(() => false);
  }

  async #canvaWaitForPdfImport(page, { expectedPages, timeoutMs = canvaPdfImportTimeoutMs(expectedPages), report = null, percent = 12 } = {}) {
    const startedAt = Date.now();
    let lastTickAt = 0;
    let lastNudgeAt = 0;
    let lastOpenAt = 0;
    let lastRecoverAt = 0;
    let lastCount = 0;
    let lastGrowthAt = Date.now();
    let recoveries = 0;
    const watch = this.#canvaStartUploadTrafficWatch(page);
    const tick = async (count, importing, href, state = {}) => {
      if (typeof report !== 'function') return;
      const now = Date.now();
      if (now - lastTickAt < 4_000 && lastTickAt) return;
      lastTickAt = now;
      await report(percent, canvaPdfImportTickMessage(expectedPages, count, importing, href, state, formatCanvaClock(now - startedAt)), { heartbeat: true, intervention: null, ...canvaDashboardPatch('thumbnails', { status: 'running' }) });
    };
    await tick(0, true, page.url());
    try {
    while (Date.now() - startedAt < timeoutMs) {
      this.#throwIfCancelled();
      page = await this.#canvaAdoptDesignPage(page, { allowKnown: this.#canvaKnownDesignIds().size === 0 }) || page;
      this.canvaPage = page;
      const href = String(page.url() || '');
      const inEditor = Boolean(canvaDesignId(href));
      const known = this.#canvaKnownDesignIds();
      const onKnownLeftover = Boolean(inEditor && known.size && known.has(canvaDesignId(href)));
      const state = await this.#canvaReadPdfUploadState(page);
      const traffic = watch.snapshot();
      const transferSuccess = isCanvaPdfTransferSuccess(state);
      const uploadInFlight = state.busy || state.uploading || Number(state.uploadItems) > 0 || (state.percent != null && state.percent < 100) || Boolean(traffic.uploadish && traffic.active);
      const importing = !onKnownLeftover && (uploadInFlight
        || (state.converting && !inEditor)
        || transferSuccess && !inEditor
        || await this.#canvaImportIndicatorVisible(page));
      if (inEditor && !onKnownLeftover) {
        await this.#canvaReportOpenedDesign(page, report, percent);
      }
      if (!inEditor && Date.now() - lastOpenAt >= 1_200) {
        lastOpenAt = Date.now();
        if (transferSuccess || state.importInProgress || Number(state.uploadItems) > 0 || state.fileSelected || Number(traffic.uploadFinished || 0) > 0) {
          await this.#canvaClosePdfUploadPanel(page);
        }
        const opened = await this.#canvaOpenImportedPdfDesign(page, { report });
        if (opened && canvaDesignId(opened.url())) {
          page = opened;
          this.canvaPage = page;
          await this.#canvaReportOpenedDesign(page, report, percent);
          continue;
        }
      }
      if (!inEditor && !uploadInFlight && await this.#canvaPdfConvertPromptVisible(page) && Date.now() - lastNudgeAt >= 2_500) {
        lastNudgeAt = Date.now();
        await this.#canvaNudgePdfConvert(page);
      }
      const count = await this.#canvaEditorPageCount(page, expectedPages);
      if (count !== lastCount) {
        lastCount = count;
        lastGrowthAt = Date.now();
      }
      const pagesGrowing = Date.now() - lastGrowthAt < 90_000;
      if (inEditor && !onKnownLeftover && count === expectedPages && expectedPages > 0 && !importing) {
        await this.#waitForCanvaEditor(page, 8_000);
        this.#canvaThrowIfPageCountMismatch(await this.#canvaEditorPageCount(page, expectedPages), expectedPages);
        this.canvaPdfAttachedOnce = false;
        return page;
      }
      const elapsed = Date.now() - startedAt;
      if (!inEditor && elapsed >= CANVA_HOME_OPEN_DESIGN_MS && Date.now() - lastRecoverAt >= CANVA_HOME_OPEN_DESIGN_MS) {
        lastRecoverAt = Date.now();
        recoveries += 1;
        const recovered = await this.#canvaRecoverPdfImport(page, {
          message: `Still on Canva home after ${formatCanvaClock(elapsed)}. Opening from Uploads automatically.`,
          report
        });
        if (recovered && recovered !== 'retry' && canvaDesignId(recovered.url?.() || '')) {
          page = recovered;
          this.canvaPage = page;
          await this.#canvaReportOpenedDesign(page, report, percent);
          continue;
        }
      }
      if (!inEditor && count === 0 && elapsed >= CANVA_HOME_IMPORT_FAIL_MS && !uploadInFlight && !(traffic.uploadish && traffic.active)) {
        const message = `Canva did not open the print PDF as a design after ${formatCanvaClock(elapsed)}. Still 0 of ${expectedPages} pages. Uploads recovery failed. Not waiting for a manual click.`;
        if (typeof report === 'function') {
          await report(percent, message, { intervention: null, ...canvaDashboardPatch('thumbnails', { status: 'fail', error: message }) });
        }
        throw Object.assign(new Error(message), {
          code: 'CANVA_PDF_IMPORT_STUCK'
        });
      }
      const wrongDesignIdle = Date.now() - lastGrowthAt >= CANVA_WRONG_DESIGN_IDLE_MS;
      const leftoverish = looksLikeLeftoverCanvaCount(count, expectedPages);
      const oversizedLeftover = Boolean(inEditor && leftoverish && count > expectedPages);
      if (onKnownLeftover || oversizedLeftover || (inEditor && leftoverish && !importing && !uploadInFlight && wrongDesignIdle)) {
        // #region agent log
        this.#debugCanva('G', 'browser-controller.cjs:#canvaWaitForPdfImport', 'wrong design', {
          count,
          expectedPages,
          leftoverish,
          oversizedLeftover,
          onKnownLeftover,
          url: String(href || '').slice(0, 180)
        });
        // #endregion
        throw Object.assign(new Error(`Canva opened a ${count || 'leftover'}-page design instead of the ${expectedPages}-page print PDF. Importing a new design from home with the full PDF.`), {
          code: 'CANVA_WRONG_DESIGN'
        });
      }
      await tick(count, importing || pagesGrowing, href, state);
      await this.#sleepOrPause(160);
    }
    const count = await this.#canvaEditorPageCount(page, expectedPages);
    const endedInEditor = Boolean(canvaDesignId(String(page.url() || '')));
    const message = endedInEditor
      ? `Canva only showed ${count} of ${expectedPages} pages after ${formatCanvaClock(timeoutMs)}. Keep this design open — Canva was still building pages. Try again so Magic Layer can continue from here.`
      : `Canva did not open the print PDF as a design after ${formatCanvaClock(timeoutMs)}. Still ${count} of ${expectedPages} pages. Uploads recovery failed. Not waiting for a manual click.`;
    if (typeof report === 'function') {
      await report(percent, message, { intervention: null, ...canvaDashboardPatch('thumbnails', { status: 'fail', error: message }) });
    }
    throw Object.assign(new Error(message), { code: 'CANVA_PDF_IMPORT_STUCK' });
    } finally {
      watch.stop();
    }
  }

  async #canvaFinishPdfImport(page, expectedPages, report) {
    const context = page.context();
    const popupPromise = context.waitForEvent('page', { timeout: 8_000 }).catch(() => null);
    if (!canvaDesignId(page?.url?.() || '')) {
      await this.#canvaClosePdfUploadPanel(page);
      const opened = await this.#canvaOpenImportedPdfDesign(page, { report });
      if (opened) page = opened;
    }
    await this.#canvaNudgePdfConvert(page);
    let target = await this.#canvaTakeImportTarget(page, popupPromise);
    if (canvaDesignId(target?.url?.() || '')) {
      await this.#canvaReportOpenedDesign(target, report, 12);
    }
    target = await this.#canvaWaitForPdfImport(target, { expectedPages, timeoutMs: canvaPdfImportTimeoutMs(expectedPages), report, percent: 12 });
    this.canvaPage = target;
    return target;
  }

  async #canvaImportPdfAsDesign(page, pdfPath, expectedPages, report) {
    if (!pdfPath || !existsSync(pdfPath)) {
      throw Object.assign(new Error('Export the print PDF before sending it to Canva.'), { code: 'CANVA_PDF_MISSING' });
    }
    this.#throwIfCancelled();
    const importTimeoutMs = canvaPdfImportTimeoutMs(expectedPages);
    const adopted = await this.#canvaAdoptDesignPage(page, { allowKnown: true });
    if (adopted && canvaDesignId(adopted.url())) {
      const existingCount = await this.#canvaEditorPageCount(adopted, expectedPages);
      const leftoverish = looksLikeLeftoverCanvaCount(existingCount, expectedPages);
      const stillImporting = await this.#canvaImportIndicatorVisible(adopted);
      if (existingCount === expectedPages && expectedPages > 0) {
        if (typeof report === 'function') {
          await report(12, `Canva already opened the print PDF (${existingCount} of ${expectedPages} pages). Waiting for every page before Magic Layer…`, canvaDashboardPatch('thumbnails', { status: 'running' }));
        }
        try {
          const target = await this.#canvaWaitForPdfImport(adopted, { expectedPages, timeoutMs: importTimeoutMs, report, percent: 12 });
          this.canvaPage = target;
          return target;
        } catch (error) {
          if (this.#isCanvaPauseError(error)) throw error;
        }
      } else if (!leftoverish && existingCount > 0 && existingCount < expectedPages && stillImporting) {
        if (typeof report === 'function') {
          await report(12, `Canva is still expanding this design (${existingCount} of ${expectedPages} pages). Waiting for every page before Magic Layer…`, canvaDashboardPatch('thumbnails', { status: 'running' }));
        }
        try {
          const target = await this.#canvaWaitForPdfImport(adopted, { expectedPages, timeoutMs: importTimeoutMs, report, percent: 12 });
          this.canvaPage = target;
          return target;
        } catch (error) {
          if (this.#isCanvaPauseError(error)) throw error;
        }
      } else if (leftoverish || (existingCount > 0 && existingCount !== expectedPages)) {
        if (typeof report === 'function') {
          await report(8, `Canva is on a ${existingCount}-page leftover design, not the ${expectedPages}-page print PDF. Importing a new design from home.`, {
            abandonDesignUrl: true,
            ...canvaDashboardPatch('pdf', { status: 'running' })
          });
        }
        // #region agent log
        this.#debugCanva('G', 'browser-controller.cjs:#canvaImportPdfAsDesign', 'rejected leftover design', { existingCount, expectedPages, leftoverish, runId: 'post-fix' });
        // #endregion
      }
    }

    if (typeof report === 'function') {
      await report(6, `Loading the print PDF (${basename(pdfPath)})…`, canvaDashboardPatch('pdf', { status: 'running' }));
    }
    const preparedBytes = existsSync(pdfPath) ? statSync(pdfPath).size : 0;
    if (typeof report === 'function') {
      await report(8, `Using the prepared print PDF (${formatCanvaBytes(preparedBytes)}).`, {
        ...canvaDashboardPatch('pdf', { status: 'ok' })
      });
    }
    const compressedPath = pdfPath;
    this.canvaImportPdfNames = [basename(compressedPath)];
    this.canvaImportPdfPath = compressedPath;
    // #region agent log
    this.#debugCanvaUpload('D', 'browser-controller.cjs:#canvaImportPdfAsDesign', 'pdf for canva import', {
      pdfPath: compressedPath,
      exists: existsSync(compressedPath),
      bytes: existsSync(compressedPath) ? statSync(compressedPath).size : 0,
      name: basename(compressedPath),
      expectedPages
    });
    // #endregion

    this.canvaImportKnownDesignIds = this.#canvaDesignIds(page);

    await page.goto(CANVA_HOME_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await this.#sleepOrPause(80);
    await this.#canvaDismissPopups(page);

    const queuedState = await this.#canvaReadPdfUploadState(page);
    const leftoverQueued = await this.#canvaPrintPdfAlreadyQueued(page, [compressedPath]);
    // Fresh import: always clear leftover attachedOnce before pickLocalFiles when nothing is truly queued.
    if (!leftoverQueued) {
      this.canvaPdfAttachedOnce = false;
    }
    // #region agent log
    this.#debugCanva('G', 'browser-controller.cjs:#canvaImportPdfAsDesign', 'fresh import start', {
      leftoverQueued,
      attachedOnce: Boolean(this.canvaPdfAttachedOnce),
      url: String(page.url() || '').slice(0, 180),
      pdfName: basename(compressedPath),
      fileName: queuedState?.fileName || '',
      transferSuccess: Boolean(queuedState && isCanvaPdfTransferSuccess(queuedState)),
      skipInject: shouldSkipCanvaPdfInject(queuedState, { attachedOnce: this.canvaPdfAttachedOnce, files: [compressedPath] }),
      build: 'ml-image-select-2026-09-04'
    });
    // #endregion
    if (leftoverQueued) {
      this.canvaPdfAttachedOnce = true;
      if (typeof report === 'function') {
        await report(10, 'PDF in Uploads / import in progress — opening design', canvaDashboardPatch('upload', { status: 'ok' }));
      }
    } else {
      this.canvaPdfAttachedOnce = false;
      await this.#pickLocalFilesInPage(page, [compressedPath], {
        clickName: /import files|import file|upload files|add media|^upload$/i,
        mediaPicker: false,
        report
      });
      // Only mark attached when evidence exists — never force true after a soft return.
      if (!this.canvaPdfAttachedOnce) {
        this.canvaPdfAttachedOnce = await this.#canvaPdfAttachEvidence(page, [compressedPath]);
      }
      if (!canvaDesignId(page.url?.() || '')) {
        await page.waitForResponse((resp) => {
          try {
            const url = resp.url();
            return (isPdfUploadNetworkUrl(url) || isCanvaDesignCreateNetworkUrl(url)) && resp.status() < 400;
          } catch {
            return false;
          }
        }, { timeout: 12_000 }).catch(() => null);
      }
    }
    if (typeof report === 'function') {
      await report(12, `PDF selected once. Waiting for all ${expectedPages} pages before Magic Layer…`, canvaDashboardPatch('thumbnails', { status: 'running' }));
    }
    let designPage = page;
    if (!leftoverQueued) {
      designPage = await page.waitForResponse(
        (resp) => /\/design\//i.test(resp.url()) && resp.status() === 200,
        { timeout: 4_000 }
      ).then((r) => r.request().frame()?.page() || page).catch(() => page);
    }
    this.canvaPage = designPage;
    try {
      return await this.#canvaFinishPdfImport(designPage, expectedPages, report);
    } catch (error) {
      if (error?.code === 'CANVA_WRONG_DESIGN') {
        if (typeof report === 'function') {
          await report(8, error.message, { abandonDesignUrl: true, ...canvaDashboardPatch('pdf', { status: 'running' }) });
        }
        this.canvaImportKnownDesignIds = this.#canvaDesignIds(designPage);
        this.canvaPdfAttachedOnce = false;
        await page.goto(CANVA_HOME_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await this.#sleepOrPause(80);
        await this.#pickLocalFilesInPage(page, [compressedPath], {
          clickName: /import files|import file|upload files|add media|^upload$/i,
          mediaPicker: false,
          report
        });
        if (!this.canvaPdfAttachedOnce) {
          this.canvaPdfAttachedOnce = await this.#canvaPdfAttachEvidence(page, [compressedPath]);
        }
        return this.#canvaFinishPdfImport(page, expectedPages, report);
      }
      throw error;
    }
  }

  #canvaReadNativeClipboard() {
    try {
      const { clipboard } = require('electron');
      if (clipboard && typeof clipboard.readText === 'function') {
        return String(clipboard.readText() || '').trim();
      }
    } catch {}
    return '';
  }

  #canvaNormalizeHarvestedTemplate(value) {
    const extracted = canvaTemplateLinkFromShare(value) || String(value || '').trim();
    if (!extracted || /canva\.com\/help\//i.test(extracted)) return '';
    if (isCanvaTemplateLink(extracted)) return toCanvaTemplateLink(extracted) || extracted;
    if (!isCanvaDesignUrl(extracted)) return '';
    try {
      const parsed = new URL(extracted);
      const path = parsed.pathname || '';
      if (/\/edit\/?$/i.test(path) && parsed.searchParams.get('template') !== '1') return '';
      if (/\/view/i.test(path) || parsed.searchParams.get('mode') === 'preview') {
        return toCanvaTemplateLink(extracted);
      }
    } catch {}
    return '';
  }

  #canvaShareControlIsHelp(label, href = '') {
    const text = String(label || '');
    const link = String(href || '');
    if (/canva\.com\/help\//i.test(link) || /help\.canva/i.test(link)) return true;
    if (/learn about/i.test(text)) return true;
    if (/help/i.test(text) && /template/i.test(text) && !/^template link$/i.test(text.trim())) return true;
    return false;
  }

  async #canvaClickSharePanelButton(page, pattern, timeoutMs = 2_000) {
    const budget = Math.max(200, Number(timeoutMs) || 2_000);
    const startedAt = Date.now();
    const scopes = [
      page.locator('[role="dialog"]'),
      page.locator('[aria-label*="share" i]'),
      page.locator('#share-panel'),
      page.locator('body')
    ];
    while (Date.now() - startedAt < budget) {
      this.#throwIfCancelled();
      for (const scope of scopes) {
        for (const role of ['button', 'menuitem', 'tab', 'option', 'link', 'gridcell']) {
          const locator = scope.getByRole(role, { name: pattern }).first();
          if (!(await locator.isVisible({ timeout: 0 }).catch(() => false))) continue;
          const label = `${await locator.getAttribute('aria-label').catch(() => '') || ''} ${await locator.innerText().catch(() => '') || ''}`.replace(/\s+/g, ' ').trim();
          const href = String(await locator.getAttribute('href').catch(() => '') || '');
          if (this.#canvaShareControlIsHelp(label, href) || /brand template/i.test(label) || /comments?/i.test(label)) continue;
          await locator.click({ force: true, timeout: 1_200 }).catch(() => {});
          return true;
        }
        const textLoc = scope.getByText(pattern).first();
        if (await textLoc.isVisible({ timeout: 0 }).catch(() => false)) {
          const label = `${await textLoc.getAttribute('aria-label').catch(() => '') || ''} ${await textLoc.innerText().catch(() => '') || ''}`.replace(/\s+/g, ' ').trim();
          const href = String(await textLoc.getAttribute('href').catch(() => '') || '');
          if (!this.#canvaShareControlIsHelp(label, href) && !/brand template/i.test(label) && !/comments?/i.test(label)) {
            await textLoc.click({ force: true, timeout: 1_200 }).catch(() => {});
            return true;
          }
        }
      }
      await this.#sleepOrPause(40);
    }
    return false;
  }

  async #canvaCollectShareCandidateUrls(page) {
    const fromDom = await page.evaluate(() => {
      const texts = [];
      const seen = new Set();
      const roots = [...document.querySelectorAll('[role="dialog"], [aria-label*="share" i], [aria-label*="template" i], #share-panel')];
      if (!roots.length) roots.push(document.body);
      const consider = (value) => {
        const raw = String(value || '').trim();
        if (!raw || /canva\.com\/help\//i.test(raw) || seen.has(raw)) return;
        if (!/^https?:\/\//i.test(raw) && !/canva\.link\//i.test(raw)) return;
        seen.add(raw);
        texts.push(raw);
      };
      for (const root of roots) {
        for (const node of root.querySelectorAll('input, textarea, [contenteditable="true"], a[href], [data-value]')) {
          consider(node.value || node.getAttribute('value') || node.getAttribute('href') || node.getAttribute('data-value') || node.textContent);
        }
        const blob = String(root.innerText || '');
        const matches = blob.match(/https?:\/\/(?:www\.)?(?:canva\.link\/[^\s"'<>]+|canva\.com\/design\/[^\s"'<>]+)/gi) || [];
        for (const match of matches) consider(match);
      }
      return texts;
    }).catch(() => []);
    const clip = this.#canvaReadNativeClipboard();
    if (/^https?:\/\//i.test(clip) || /canva\.link\//i.test(clip)) {
      return [...fromDom, clip].filter(Boolean);
    }
    return fromDom.filter(Boolean);
  }

  async #canvaReadTemplateLinkFromSharePanel(page) {
    const harvest = async (current, { created, opened } = {}) => {
      let copied = await this.#canvaClickSharePanelButton(current, /^(copy|copy template link)$/i, 1_500)
        || await this.#canvaClickFirst(current, [/copy template link/i, /^copy$/i], 800);
      if (copied) {
        this.canvaJob?.record({
          action: 'click-copy',
          expected: 'valid Canva template URL',
          verification: 'clicked',
          outcome: 'RETRY'
        });
      }
      let verified = '';
      let lastValues = [];
      const harvestDeadline = Date.now() + 10_000;
      while (Date.now() < harvestDeadline) {
        this.#throwIfCancelled();
        if (!copied) {
          copied = await this.#canvaClickSharePanelButton(current, /^(copy|copy template link)$/i, 400)
            || await this.#canvaClickFirst(current, [/copy template link/i, /^copy$/i], 400);
        }
        lastValues = await this.#canvaCollectShareCandidateUrls(current);
        lastValues.sort((left, right) => Number(/canva\.link\//i.test(right)) - Number(/canva\.link\//i.test(left)));
        const editorRewrite = toCanvaTemplateLink(current.url?.() || this.canvaResumeDesignUrl || '');
        for (const value of lastValues) {
          const next = this.#canvaNormalizeHarvestedTemplate(value);
          if (!next) continue;
          if (editorRewrite && next === editorRewrite && !created) continue;
          verified = next;
          break;
        }
        if (verified) break;
        await this.#sleepOrPause(250);
      }
      return { copied, verified, lastValues };
    };

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      page = await this.#canvaEnsureEditorPage(page, this.canvaResumeDesignUrl);
      this.canvaPage = page;
      await this.#canvaDismissPopups(page);
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://www.canva.com' }).catch(() => {});
      const shareBtn = page.getByRole('button', { name: /^share$/i }).last();
      const shareClicked = (await shareBtn.isVisible({ timeout: 0 }).catch(() => false)
        ? (await shareBtn.click({ force: true, timeout: 1_800 }).then(() => true).catch(() => false))
        : false)
        || await this.#canvaClickByName(page, /^share$/i, 3_500)
        || await this.#canvaClickSharePanelButton(page, /^share$/i, 2_500);
      if (!shareClicked) {
        if (attempt === 1) continue;
        throw Object.assign(new Error('Share was not found in the Canva editor.'), {
          code: 'CANVA_SHARE_MISSING'
        });
      }
      await this.#sleepOrPause(480);
      let opened = await this.#canvaClickSharePanelButton(page, /^template link$/i, 2_000);
      const seeAll = !opened && await this.#canvaClickSharePanelButton(page, /^see all$/i, 1_600);
      if (seeAll) {
        await this.#sleepOrPause(320);
        opened = await this.#canvaClickSharePanelButton(page, /^template link$/i, 3_500);
      }
      let created = false;
      if (opened) {
        created = await this.#canvaClickSharePanelButton(page, /create template link|create a template link/i, 3_500)
          || await this.#canvaClickFirst(page, [/create template link/i, /create (a )?template link/i], 2_000);
        this.canvaJob?.enter('TEMPLATE_LINK_CREATED', { action: 'create-template-link', expected: 'public canva.link or ?template=1 from Copy' });
      }
      // #region agent log
      const probe = await page.evaluate(() => {
        const names = [];
        const roots = [...document.querySelectorAll('[role="dialog"], [aria-label*="share" i], [aria-label*="template" i], #share-panel')];
        if (!roots.length) roots.push(document.body);
        for (const root of roots) {
          for (const el of root.querySelectorAll('button, [role="button"], [role="menuitem"], [role="tab"], a, input, textarea')) {
            const t = `${el.getAttribute('aria-label') || ''} ${el.value || ''} ${el.innerText || ''}`.replace(/\s+/g, ' ').trim();
            if (t && names.length < 28) names.push(t.slice(0, 90));
          }
        }
        const blob = String((roots[0] || document.body).innerText || '').replace(/\s+/g, ' ').trim();
        return {
          dialogCount: roots[0] === document.body ? 0 : roots.length,
          snippet: blob.slice(0, 420),
          names
        };
      }).catch((error) => ({ error: String(error.message || error).slice(0, 120) }));
      this.#debugCanva('A', 'browser-controller.cjs:#canvaReadTemplateLinkFromSharePanel', 'share panel probe', {
        attempt,
        shareClicked,
        seeAll,
        opened,
        created,
        url: String(page.url?.() || '').slice(0, 180),
        resumeUrl: String(this.canvaResumeDesignUrl || '').slice(0, 180),
        probe,
        runId: 'pre-fix'
      });
      // #endregion
      if (!opened) {
        if (attempt === 1) {
          await page.keyboard.press('Escape').catch(() => {});
          continue;
        }
        throw Object.assign(new Error('Template link was not in the Share panel. Open Share → See all → Template link, then try again.'), {
          code: 'CANVA_TEMPLATE_LINK_MISSING'
        });
      }
      const result = await harvest(page, { created, opened });
      // #region agent log
      this.#debugCanva('I', 'browser-controller.cjs:#canvaReadTemplateLinkFromSharePanel', 'share panel urls', {
        copied: result.copied,
        created,
        attempt,
        verified: String(result.verified || '').slice(0, 180),
        values: (result.lastValues || []).slice(0, 12).map((item) => String(item || '').slice(0, 180)),
        templateHits: (result.lastValues || []).map((value) => this.#canvaNormalizeHarvestedTemplate(value)).filter(Boolean).slice(0, 4),
        runId: 'post-fix'
      });
      const fromEditor = toCanvaTemplateLink(page.url?.() || this.canvaResumeDesignUrl || '');
      this.#debugCanva('D', 'browser-controller.cjs:#canvaReadTemplateLinkFromSharePanel', 'share fallback gate', {
        attempt,
        created,
        copied: result.copied,
        verified: Boolean(result.verified),
        editorUrl: String(page.url?.() || '').slice(0, 180),
        fromEditor: String(fromEditor || '').slice(0, 180),
        fromEditorIsTemplate: isCanvaTemplateLink(fromEditor),
        clipboardHead: String(this.#canvaReadNativeClipboard() || '').slice(0, 80),
        runId: 'pre-fix'
      });
      // #endregion
      if (result.verified) {
        this.canvaJob?.record({
          action: 'verify-template-url',
          expected: '?template=1',
          detected: result.verified,
          verification: true,
          outcome: 'SUCCESS'
        });
        return result.verified;
      }
      await page.keyboard.press('Escape').catch(() => {});
    }
    const leftover = await this.#canvaCollectShareCandidateUrls(page);
    for (const value of leftover) {
      const extracted = canvaTemplateLinkFromShare(value) || String(value || '');
      if (isCanvaDesignUrl(extracted) && !isCanvaTemplateLink(extracted) && !/canva\.com\/help\//i.test(extracted)) {
        throw Object.assign(new Error('Share panel only showed the editor URL, not a template link. Open Share → Template link, then try again.'), {
          code: 'CANVA_EDITOR_URL_NOT_TEMPLATE'
        });
      }
    }
    throw Object.assign(new Error('Canva did not show a template link in the Share panel. The editor URL was not saved as the buyer link.'), {
      code: 'CANVA_TEMPLATE_LINK_MISSING'
    });
  }

  async #canvaDownloadPdf(page, downloadDir, projectId, bookCode = '') {
    mkdirSync(downloadDir, { recursive: true });
    const stem = String(bookCode || '').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80)
      || String(projectId || 'canva').slice(0, 8);
    const destPath = join(downloadDir, `${stem}-canva-editable.pdf`);
    await page.keyboard.press('Escape').catch(() => {});
    await this.#sleepOrPause(160);
    await page.keyboard.press('Escape').catch(() => {});
    await this.#sleepOrPause(120);
    const startedAt = Date.now();
    const downloadPromise = page.waitForEvent('download', { timeout: 20_000 }).catch(() => null);
    const fileClicked = await this.#canvaClickByName(page, /^file$/i, 1_200);
    const downloadMenu = await this.#canvaClickByName(page, /^download$/i, 1_500);
    const pdfClicked = await this.#canvaClickExact(page, /^(pdf|standard pdf)$/, 1_500);
    const confirmClicked = await this.#canvaClickByName(page, /^download$/i, 1_500);
    const download = await downloadPromise;
    // #region agent log
    this.#debugCanva('I', 'browser-controller.cjs:#canvaDownloadPdf', 'download result', {
      got: Boolean(download),
      fileClicked,
      downloadMenu,
      pdfClicked,
      confirmClicked,
      elapsedMs: Date.now() - startedAt,
      runId: 'post-fix',
      hypothesisId: 'DL'
    });
    // #endregion
    if (!download) return null;
    await download.saveAs(destPath);
    return destPath;
  }

  #stopCanvaLiveFrame() {
    if (this._canvaLiveFrameTimer) {
      clearInterval(this._canvaLiveFrameTimer);
      this._canvaLiveFrameTimer = null;
    }
  }

  async #canvaReportJob(percent, message, extra = {}) {
    const report = this._canvaOnProgress;
    const waitExplanation = extra.waitExplanation
      || this.canvaJob?.waitExplanation
      || null;
    const payload = {
      message,
      waitExplanation,
      jobState: this.canvaJob ? this.canvaJob.snapshot() : null,
      controller: this.canvaJob ? this.canvaJob.controllerView() : null,
      intervention: extra.intervention || this.canvaJob?.intervention || null,
      ...extra
    };
    if (percent != null && percent !== '' && Number.isFinite(Number(percent))) {
      payload.percent = Number(percent);
    }
    if (typeof report === 'function') await report(payload);
  }

  async #canvaBindConsole(page) {
    if (!page || page.__versaCanvaConsole) return;
    page.__versaCanvaConsole = true;
    this.canvaConsoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        this.canvaConsoleErrors.push(String(msg.text() || '').slice(0, 500));
        if (this.canvaConsoleErrors.length > 40) this.canvaConsoleErrors.splice(0, this.canvaConsoleErrors.length - 40);
      }
    });
    page.on('pageerror', (error) => {
      this.canvaConsoleErrors.push(String(error?.message || error).slice(0, 500));
    });
  }

  async #canvaCaptureLiveFrame(page) {
    if (!page || page.isClosed()) return null;
    const buffer = await page.screenshot({ type: 'jpeg', quality: 42, timeout: 2_500 }).catch(() => null);
    if (!buffer) return null;
    return `data:image/jpeg;base64,${buffer.toString('base64')}`;
  }

  #startCanvaLiveFrame(page) {
    this.#stopCanvaLiveFrame();
    if (!page) return;
    const pushFrame = () => {
      if (this.abortRequested) return;
      this.#canvaCaptureLiveFrame(page).then((liveFrame) => {
        if (!liveFrame || typeof this._canvaOnProgress !== 'function') return;
        this._canvaOnProgress({
          liveFrame,
          heartbeat: true,
          waitExplanation: this.canvaJob?.waitExplanation,
          jobState: this.canvaJob ? this.canvaJob.snapshot() : null,
          controller: this.canvaJob ? this.canvaJob.controllerView() : null,
          url: page.isClosed() ? '' : page.url()
        }).catch(() => {});
      }).catch(() => {});
    };
    pushFrame();
    this._canvaLiveFrameTimer = setInterval(pushFrame, 1_600);
  }

  async #canvaCaptureFailureSnapshot(page, error, extra = {}) {
    const dir = this.canvaDiagnosticsDir || join(this.downloadDir || tmpdir(), 'canva-diagnostics');
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const screenshotPath = join(dir, `${stamp}.jpg`);
    if (page && !page.isClosed()) {
      await page.screenshot({ path: screenshotPath, type: 'jpeg', quality: 55, timeout: 4_000 }).catch(() => null);
    }
    const domSnippet = page && !page.isClosed()
      ? await page.evaluate(() => String(document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 3500)).catch(() => null)
      : null;
    const a11y = page && !page.isClosed()
      ? await page.evaluate(() => [...document.querySelectorAll('button, [role="button"], [role="menuitem"]')]
        .slice(0, 40)
        .map((el) => String(el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)).catch(() => null)
      : null;
    const snapshot = buildFailureSnapshot({
      screenshotPath: existsSync(screenshotPath) ? screenshotPath : null,
      url: page && !page.isClosed() ? page.url() : '',
      pageNumber: extra.pageNumber ?? this.canvaJob?.pageNumber,
      domSnippet,
      a11y,
      controllerState: this.canvaJob ? this.canvaJob.snapshot() : null,
      lastAction: extra.lastAction || this.canvaJob?.lastAction,
      expected: extra.expected || this.canvaJob?.lastExpected,
      detected: extra.detected || this.canvaJob?.lastDetected,
      retryCount: extra.retryCount ?? this.canvaJob?.retryCount,
      consoleErrors: this.canvaConsoleErrors,
      error
    });
    try {
      writeFileSync(join(dir, `${stamp}.json`), JSON.stringify(snapshot, null, 2));
    } catch {}
    this.canvaJob?.record({
      type: 'snapshot',
      action: 'failure-snapshot',
      outcome: 'FAIL',
      details: snapshot
    });
    return snapshot;
  }

  async inspectCanvaEnvironment({ designUrl = null } = {}) {
    const attached = Boolean(this.context && this.skipWindowChrome);
    const canary = attached ? { executablePath: 'attached' } : resolveInstalledBrowser();
    const profileOk = attached || Boolean(this.profileDir && existsSync(this.profileDir));
    let page = null;
    let cdpHealthy = attached || Boolean(this.context);
    let sessionOk = false;
    let loginScreen = false;
    let canvaAccessible = attached;
    let editorCanLoad = !designUrl;
    let viewportOk = true;
    let blockingModal = false;
    const checks = {
      canaryAvailable: Boolean(canary || attached),
      profileOk,
      cdpHealthy,
      sessionOk,
      canvaAccessible,
      editorCanLoad,
      viewportOk,
      loginScreen,
      blockingModal,
      designUrl: designUrl || null
    };
    if (!checks.canaryAvailable || !profileOk) return summarizeHealth(checks);
    try {
      page = await this.#canvaPage();
      await this.#canvaBindConsole(page);
      cdpHealthy = Boolean(this.context && page && !page.isClosed());
      const auth = await this.#canvaAuthenticationStatus(page);
      loginScreen = Boolean(auth.loginControl || isCanvaLoginUrl(page.url()));
      sessionOk = Boolean(auth.authenticated) && !loginScreen;
      canvaAccessible = Boolean(isCanvaPageUrl(page.url()) || auth.authenticated || auth.composer);
      const size = await page.evaluate(() => ({ w: window.innerWidth || 0, h: window.innerHeight || 0 })).catch(() => ({ w: 0, h: 0 }));
      viewportOk = size.w >= 800 && size.h >= 500;
      blockingModal = await page.getByText(/review your design/i).first().isVisible({ timeout: 0 }).catch(() => false);
      if (designUrl && toCanvaDesignUrl(designUrl)) {
        if (!sameCanvaDesign(page.url(), designUrl)) {
          await page.goto(toCanvaDesignUrl(designUrl), { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => null);
        }
        editorCanLoad = await this.#waitForCanvaEditor(page, 20_000).then(() => true).catch(() => false);
      }
    } catch (error) {
      cdpHealthy = Boolean(this.context);
      canvaAccessible = false;
      checks.error = error.message;
    }
    return summarizeHealth({
      ...checks,
      cdpHealthy,
      sessionOk,
      canvaAccessible,
      editorCanLoad,
      viewportOk,
      loginScreen,
      blockingModal
    });
  }

  async #canvaIdentifyControls(page) {
    const visible = async (name) => page.getByRole('button', { name }).first().isVisible({ timeout: 0 }).catch(() => false)
      || page.getByText(name).first().isVisible({ timeout: 0 }).catch(() => false);
    const pages = await this.#canvaEditorPageCount(page).catch(() => 0);
    const identified = {
      createDesign: await visible(/create a design|create design/i),
      importFile: await visible(/import file|import files|upload/i),
      share: await visible(/^share$/i),
      seeAll: await visible(/^see all$/i),
      templateLink: await visible(/template link/i),
      copy: await visible(/^copy$/i),
      edit: await this.#canvaImageToolbarVisible(page),
      editPanel: await this.#canvaEditImagePanelOpen(page),
      magicLayers: await visible(/magic layers|magic layer/i),
      pages
    };
    this.canvaJob?.record({
      type: 'identify',
      action: 'observe-controls',
      detected: identified,
      verification: identified.share || identified.createDesign ? 'ok' : 'partial'
    });
    return identified;
  }

  async #canvaWaitUntil(page, {
    expected,
    detect,
    timeoutMs = 30_000,
    retryMs = 200,
    recover = null,
    maxAttempts = 40
  } = {}) {
    const startedAt = Date.now();
    let attempt = 0;
    let lastDetected = { ok: false, found: false, detail: 'not yet observed' };
    while (Date.now() - startedAt < timeoutMs && attempt < maxAttempts) {
      this.#throwIfCancelled();
      attempt += 1;
      lastDetected = await detect(page) || lastDetected;
      const explanation = explainWait({
        expected,
        detected: lastDetected,
        attempt,
        retries: maxAttempts,
        elapsedMs: Date.now() - startedAt,
        timeoutMs,
        state: this.canvaJob?.state
      });
      this.canvaJob?.setWait(explanation);
      if (lastDetected.ok || lastDetected.found) {
        this.canvaJob?.record({
          action: 'verify',
          expected,
          detected: lastDetected,
          verification: true,
          outcome: 'SUCCESS',
          attempt
        });
        return { outcome: 'SUCCESS', detected: lastDetected };
      }
      if (recover && attempt % 10 === 0) {
        const rec = await recover(page, lastDetected, attempt);
        if (rec?.outcome && rec.outcome !== 'RETRY') return rec;
      }
      await this.#sleepOrPause(retryMs);
    }
    const outcome = decideWaitOutcome({
      verified: false,
      timedOut: true,
      attempts: attempt,
      maxAttempts,
      recoverable: Boolean(recover),
      uncertain: true
    });
    this.canvaJob?.record({
      action: 'verify',
      expected,
      detected: lastDetected,
      verification: false,
      outcome,
      attempt
    });
    return { outcome, detected: lastDetected };
  }

  async #canvaAskHumanAndObserve(page, {
    happened,
    expected,
    undetermined,
    userShouldClick,
    pageNumber,
    detect,
    timeoutMs = 30 * 60_000
  } = {}) {
    if (!this.canvaHumanEnabled) return { ok: false, skipped: true };
    this.pauseForHuman({
      happened,
      expected,
      undetermined,
      userShouldClick,
      pageNumber,
      expectedState: expected
    });
    await this.#canvaReportJob(null, `Paused for you. ${happened || ''}`, {
      intervention: this.canvaJob?.intervention,
      waitExplanation: explainWait({
        expected,
        detected: 'waiting for the operator',
        state: 'MANUAL_INTERVENTION_REQUIRED'
      })
    });
    const deadline = Date.now() + Math.max(1_000, Number(timeoutMs) || 0);
    while (Date.now() < deadline) {
      this.#throwIfCancelled();
      const seen = this.humanObserveRequested && typeof detect === 'function'
        ? await detect(page)
        : null;
      const exit = decideHumanLoopExit({
        abort: this.abortRequested || this.canvaControl.abortSafely,
        retryDecision: this.humanDecision === 'retry',
        retryStep: this.canvaControl.retryStep,
        retryPage: this.canvaControl.retryPage,
        humanPaused: this.humanPaused,
        observeRequested: this.humanObserveRequested,
        observedOk: Boolean(seen?.ok || seen?.found)
      });
      if (exit === 'ABORT') {
        this.canvaControl.abortSafely = false;
        return { ok: false, abort: true };
      }
      if (exit === 'RETRY') {
        this.canvaControl.retryStep = false;
        this.canvaControl.retryPage = false;
        this.humanDecision = null;
        this.humanPaused = false;
        this.humanObserveRequested = false;
        this.canvaJob?.clearIntervention();
        this.canvaJob?.record({
          action: 'human-retry',
          expected,
          outcome: 'RETRY'
        });
        return { ok: false, retry: true };
      }
      if (exit === 'RESUME') {
        this.humanPaused = false;
        this.humanObserveRequested = false;
        this.canvaJob?.clearIntervention();
        this.canvaJob?.record({
          action: 'observe-resume',
          expected,
          detected: seen,
          verification: true,
          outcome: 'SUCCESS'
        });
        return { ok: true, observed: true, detected: seen };
      }
      await (this.humanObserveRequested ? this.#sleepOrPause(280) : sleep(150));
    }
    this.humanPaused = false;
    return { ok: false, timedOut: true };
  }

  async #canvaRecoverSelection(page, pageNumber) {
    const policy = decideRecovery('WRONG_OBJECT', (this.canvaJob?.retryCount || 0) + 1);
    this.canvaJob?.enter('RECOVERING', { action: policy.action, pageNumber, expected: 'page image selected with Edit toolbar' });
    await page.keyboard.press('Escape').catch(() => {});
    await this.#canvaDismissPopups(page);
    const selected = await this.#canvaSelectPageImage(page);
    const verified = selected && await this.#canvaVerifyPageSelected(page);
    return { ok: Boolean(verified), policy };
  }

  async #canvaWaitForEditorPageCurrent(page, pageNumber, timeoutMs = 2_200) {
    const deadline = Date.now() + Math.max(400, Number(timeoutMs) || 2_200);
    while (Date.now() < deadline) {
      if (await this.#canvaEditorPageIsCurrent(page, pageNumber)) return true;
      await this.#sleepOrPause(80);
    }
    return this.#canvaEditorPageIsCurrent(page, pageNumber);
  }

  async #canvaLayerPageWithHumanHelp(page, pageNumber, wantPages, report) {
    let outcome = await this.#canvaLayerOnePage(page, pageNumber, wantPages, report);
    if (!outcome.layered && this.canvaHumanEnabled && isMagicLayerControlMissing(outcome)) {
      const help = await this.#canvaAskHumanAndObserve(page, {
        happened: outcome.error || `Magic Layers was not identified on page ${pageNumber}.`,
        expected: `The Edit image panel shows Magic Layers, then page ${pageNumber} has more than one layer.`,
        undetermined: 'Whether Magic Layers is visible in the Edit image panel.',
        userShouldClick: `Select page ${pageNumber}, click the image, Edit, then Magic Layers. Press I HAVE DONE IT when the page has more than one layer.`,
        pageNumber,
        detect: async () => {
          const looks = await this.#canvaPageLooksLayered(page);
          return { ok: looks.ok, found: looks.ok, detail: `layerCount=${looks.count}` };
        }
      });
      if (help.retry) {
        outcome = await this.#canvaLayerOnePage(page, pageNumber, wantPages, report);
      } else if (help.ok) {
        const looks = await this.#canvaPageLooksLayered(page);
        outcome = {
          layered: looks.ok || looks.count > 1,
          layerCount: looks.count,
          error: (looks.ok || looks.count > 1) ? null : `Page ${pageNumber} still has ${looks.count} object after manual help. Not separated.`
        };
      }
    }
    return outcome;
  }

  async runCanvaDryRun(options = {}) {
    return this.runCanvaBulkCreate({ ...options, dryRun: true, applyMagicLayers: false });
  }

  async runCanvaBulkCreate({
    projectId = null,
    pdfPath = null,
    expectedPages = 0,
    format = 'A4',
    orientation = 'portrait',
    resumeDesignUrl = null,
    resumeFromIndex = 0,
    layeredPageNumbers = [],
    applyMagicLayers = true,
    downloadDir = null,
    onProgress = null,
    dryRun = false,
    diagnosticsDir = null,
    humanEnabled = false,
    resumePdfUploaded = false,
    tempPdf = null,
    bookCode = ''
  } = {}) {
    const wantPages = Math.max(0, Number(expectedPages) || 0);
    const savedDesignUrl = toCanvaDesignUrl(resumeDesignUrl);
    if (!wantPages) {
      throw Object.assign(new Error('Generate every interior page before sending the book to Canva.'), {
        code: 'CANVA_PAGES_MISSING'
      });
    }
    if (!dryRun && (!pdfPath || !existsSync(pdfPath))) {
      throw Object.assign(new Error('Export the print PDF before sending it to Canva.'), {
        code: 'CANVA_PDF_MISSING'
      });
    }
    const pageSize = canvaPageDimensions(format, orientation);
    this.beginWork();
    this.canvaMagicClickedPages = new Set();
    this.canvaHumanEnabled = Boolean(humanEnabled);
    this.canvaDiagnosticsDir = diagnosticsDir;
    this.canvaUploadKind = 'pdf';
    this.canvaJob = new CanvaJobState({
      projectId,
      expectedPages: wantPages,
      designUrl: savedDesignUrl,
      pdfUploaded: Boolean(resumePdfUploaded || savedDesignUrl),
      tempPdf: tempPdf && typeof tempPdf === 'object' ? tempPdf : null,
      dryRun,
      onRecord: (row) => this.emit('canva-journal', row)
    });
    this.canvaJob.enter('BOOT', { action: 'start', expected: 'Chrome Canary + Canva session' });
    const report = async (percentArg, messageArg, extraArg = {}) => {
      const { percent, message, extra } = normalizeCanvaProgressArgs(percentArg, messageArg, extraArg);
      if (extra.waitExplanation) this.canvaJob?.setWait(extra.waitExplanation);
      else if (message) {
        this.canvaJob?.setWait(explainWait({
          expected: extra.expected || message,
          detected: extra.detected || this.canvaJob?.lastDetected || 'running',
          attempt: extra.attempt || this.canvaJob?.retryCount,
          state: this.canvaJob?.state
        }));
      }
      if (typeof onProgress !== 'function') return;
      const payload = {
        message,
        waitExplanation: this.canvaJob?.waitExplanation,
        jobState: this.canvaJob ? this.canvaJob.snapshot() : null,
        controller: this.canvaJob ? this.canvaJob.controllerView() : null,
        pdfUploaded: Boolean(this.canvaJob?.pdfUploaded || this.canvaPdfAttachedOnce),
        intervention: extra.intervention || this.canvaJob?.intervention || null,
        ...extra
      };
      if (isPdfImportOpenDesignStage(payload.intervention, { message, code: extra.code }) || isPdfImportOpenDesignStage({ message })) {
        payload.intervention = null;
        this.canvaJob?.clearIntervention();
        this.humanPaused = false;
      }
      if (percent != null && percent !== '' && Number.isFinite(Number(percent))) {
        payload.percent = Number(percent);
      }
      await onProgress(payload);
    };
    this._canvaOnProgress = report;
    this._canvaReportedDesignUrl = null;
    if (shouldReuseCanvaDesign({ designUrl: savedDesignUrl, pdfUploaded: resumePdfUploaded })) {
      this.canvaPdfAttachedOnce = true;
    }
    const canResumeDesign = Boolean(savedDesignUrl);
    this.canvaWatch = canResumeDesign ? false : true;
    this.interactiveVisible = !canResumeDesign;
    let page = null;
    try {
    // STAGE: PDF_IMPORT — do not hide Canary before a fresh print-PDF attach (yesterday working path).
    // STAGE: MAGIC_LAYERS — lock after design URL is verified.
    if (canResumeDesign) {
      await this.#lockCanvaBrowserBackground();
      this.canvaJob.enter('BROWSER_READY', { action: 'lock-canary-background', expected: 'CDP attached, Canary hidden' });
      await report(2, 'Canva is connected in the background. Resuming the saved design…', canvaDashboardPatch('pdf', { status: 'running' }));
    } else {
      this.canvaBackgroundLock = false;
      this.canvaJob.enter('BROWSER_READY', { action: 'pdf-import-visible', expected: 'Canary visible for PDF attach' });
      await report(2, 'Opening Canva for print PDF import (working attach path)…', canvaDashboardPatch('pdf', { status: 'running' }));
    }
    // #region agent log
    this.#debugCanvaUpload('P', 'browser-controller.cjs:runCanvaBulkCreate', 'canva controller build', {
      build: 'ml-image-select-2026-09-04',
      canResumeDesign,
      execPath: String(process.execPath || '').slice(-120),
      resourcesPath: String(process.resourcesPath || '').slice(-120),
      runId: 'post-fix',
      hypothesisId: 'P'
    });
    // #endregion
    if (!this.skipWindowChrome) {
      const canary = resolveInstalledBrowser();
      if (!canary) {
        throw Object.assign(new Error('Google Chrome Canary is not available. Install Canary, then try again.'), {
          code: 'CANVA_CANARY_MISSING'
        });
      }
      if (this.profileDir && !existsSync(this.profileDir)) {
        throw Object.assign(new Error('The ChromeAutomationProfile is missing. Use ~/ChromeAutomationProfile for Canva.'), {
          code: 'CANVA_PROFILE_MISSING'
        });
      }
    }
    page = await this.#canvaPage({ allowExistingDesign: Boolean(savedDesignUrl) });
    await this.#canvaBindConsole(page);
    if (canResumeDesign) await this.#lockCanvaBrowserBackground();
    else await this.#unlockCanvaBrowserForPdfImport(page);
    const auth = await this.#canvaAuthenticationStatus(page);
    if (!auth.authenticated) {
      await page.goto(CANVA_HOME_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      if (canResumeDesign) await this.#lockCanvaBrowserBackground();
      else await this.#unlockCanvaBrowserForPdfImport(page);
    }
    const ready = await this.#canvaAuthenticationStatus(page);
    if (!ready.authenticated) {
      throw Object.assign(new Error('Canva Pro is not signed in. Verify Canva in Settings, then try again.'), {
        code: 'CANVA_AUTH_REQUIRED'
      });
    }
    this.canvaJob.enter('CANVA_SESSION_READY', { action: 'verify-session', expected: 'signed-in Canva Pro' });

    if (!this.skipWindowChrome) {
      const health = await this.inspectCanvaEnvironment({ designUrl: savedDesignUrl });
      if (!health.ok) {
        const issue = health.issues[0] || {};
        throw Object.assign(new Error(health.message), { code: issue.code || 'CANVA_HEALTH_FAILED', health });
      }
    }

    let designUrl = savedDesignUrl || '';
    this.canvaResumeDesignUrl = designUrl || this.canvaResumeDesignUrl || '';
    this.canvaEditorLost = false;
    this.canvaEditorRecoveries = 0;
    let resumed = false;
    const alreadyLayered = new Set((Array.isArray(layeredPageNumbers) ? layeredPageNumbers : [])
      .map((item) => Number(item))
      .filter((n) => Number.isFinite(n) && n >= 1));
    const startIndex = Math.max(0, Math.min(wantPages, Number(resumeFromIndex) || 0));
    for (const n of alreadyLayered) {
      this.canvaJob.patchPage(n, {
        status: 'SUCCESS',
        layered: true,
        uploaded: true,
        imported: true,
        started: true,
        layerCount: 2,
        lastVerification: 'resume-seed'
      });
    }
    this.canvaJob.enter('CANVA_OPEN', { action: 'open-canva', expected: 'Canva home or saved editor' });

    if (dryRun) {
      if (savedDesignUrl && !sameCanvaDesign(page.url(), savedDesignUrl)) {
        await page.goto(savedDesignUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await this.#waitForCanvaEditor(page, 20_000).catch(() => null);
      }
      const identified = await this.#canvaIdentifyControls(page);
      await report(100, 'Dry run complete. No PDF import, Magic Layer, or template link was clicked.', {
        designUrl: toCanvaDesignUrl(page.url()) || savedDesignUrl || '',
        identified,
        dryRun: true
      });
      this.canvaJob.enter('JOB_COMPLETE', { action: 'dry-run', expected: 'identified controls only' });
      return {
        dryRun: true,
        identified,
        templateLink: null,
        exportPath: null,
        designUrl: toCanvaDesignUrl(page.url()) || savedDesignUrl || '',
        usedBulkCreate: false,
        resumed: Boolean(savedDesignUrl),
        canvaPageProgress: []
      };
    }

    if (savedDesignUrl) {
      await report(8, 'Continuing the Canva design already in progress…', { designUrl: savedDesignUrl, pdfUploaded: true });
      if (!sameCanvaDesign(page.url(), savedDesignUrl)) {
        await page.goto(savedDesignUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      }
      await this.#sleepOrPause(400);
      if (await this.#canvaIsRoadblockPage(page)) {
        await report(8, 'Saved Canva design is a dead 404 roadblock. Importing a fresh design from the print PDF…', {
          abandonDesignUrl: true,
          ...canvaDashboardPatch('pdf', { status: 'running' })
        });
        this.canvaResumeDesignUrl = '';
        this.canvaJob.designUrl = null;
        this.canvaPdfAttachedOnce = false;
        designUrl = '';
        resumed = false;
        await page.goto(CANVA_HOME_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => null);
      } else {
      try {
        await this.#waitForCanvaEditor(page, 45_000);
      } catch (error) {
        if (this.#isCanvaPauseError(error)) throw error;
        throw Object.assign(new Error(`The saved Canva design did not open. Remove the template and import the print PDF again.`), {
          code: 'CANVA_RESUME_FAILED'
        });
      }
      const editorPages = await this.#canvaEditorPageCount(page, wantPages);
      const stillImporting = await this.#canvaImportIndicatorVisible(page);
      const leftoverish = looksLikeLeftoverCanvaCount(editorPages, wantPages);
      if (editorPages === wantPages) {
        resumed = true;
        designUrl = toCanvaDesignUrl(page.url()) || savedDesignUrl;
        await report(16, `Imported PDF already has ${wantPages} pages (${pageSize.label}). Magic Layer continues from the first page that is not separated.`, { designUrl });
      } else if (!leftoverish && editorPages > 0 && editorPages < wantPages && stillImporting) {
        await report(12, `Saved design has ${editorPages} of ${wantPages} pages and is still converting. Waiting for every page before Magic Layer…`, {
          designUrl: savedDesignUrl,
          ...canvaDashboardPatch('thumbnails', { status: 'running' })
        });
        try {
          page = await this.#canvaWaitForPdfImport(page, { expectedPages: wantPages, timeoutMs: canvaPdfImportTimeoutMs(wantPages), report, percent: 12 });
          resumed = true;
          designUrl = toCanvaDesignUrl(page.url()) || savedDesignUrl;
        } catch (error) {
          if (this.#isCanvaPauseError(error)) throw error;
          resumed = false;
          await report(8, `Saved design stayed at ${editorPages} of ${wantPages} pages. Importing a new design from home with the full print PDF.`, {
            abandonDesignUrl: true,
            ...canvaDashboardPatch('pdf', { status: 'running' })
          });
        }
      } else {
        resumed = false;
        await report(8, `Saved Canva design has ${editorPages || 0} of ${wantPages} pages. That is not this book. Importing a new design from home with the full print PDF.`, {
          abandonDesignUrl: true,
          ...canvaDashboardPatch('pdf', { status: 'running' })
        });
      }
      }
    }

    if (!resumed) {
      await this.#unlockCanvaBrowserForPdfImport(page);
      await report(8, `Importing the finished print PDF once (${pageSize.label})…`, canvaDashboardPatch('pdf', { status: 'running' }));
      page = await this.#canvaImportPdfAsDesign(page, pdfPath, wantPages, report);
      designUrl = await this.#canvaWaitForDesignUrl(page, 8_000) || toCanvaDesignUrl(page.url());
      await report(18, `Imported the print PDF (${wantPages} pages). Next: click each page image, Edit, then Magic Layers.`, {
        designUrl,
        ...canvaDashboardPatch('thumbnails', { status: 'ok' })
      });
    }

    // STAGE: MAGIC_LAYERS — hide Canary again; clicks use force:true / CDP.
    await this.#lockCanvaBrowserBackground();
    await this.#waitForCanvaEditor(page, 8_000);
    this.canvaJob.enter('CANVA_EDITOR_READY', { action: 'verify-editor', expected: 'Share control and page rail' });
    this.#canvaThrowIfPageCountMismatch(await this.#canvaEditorPageCount(page, wantPages), wantPages);
    designUrl = await this.#canvaWaitForDesignUrl(page, 20_000) || toCanvaDesignUrl(page.url()) || designUrl;
    this.canvaResumeDesignUrl = designUrl || this.canvaResumeDesignUrl || '';
    if (!designUrl) {
      throw Object.assign(new Error('Canva did not open an editor URL after PDF import. Confirm Canva Pro is signed in, then try again.'), {
        code: 'CANVA_EDITOR_TIMEOUT'
      });
    }
    this.canvaPdfAttachedOnce = true;
    this.canvaJob.markPdfUploaded(designUrl);
    await report(20, `PDF import verified at ${wantPages} pages. Magic Layer is page by page…`, {
      designUrl,
      pdfUploaded: true,
      ...canvaDashboardPatch('thumbnails', { status: 'ok' })
    });

    if (applyMagicLayers) {
      for (let index = 0; index < wantPages; index += 1) {
        this.#throwIfCancelled();
        if (this.canvaControl.resumeFromPage) {
          const jump = Number(this.canvaControl.resumeFromPage);
          this.canvaControl.resumeFromPage = null;
          if (Number.isFinite(jump) && jump >= 1) index = jump - 1;
        }
        if (this.canvaControl.retryPage || this.canvaControl.retryStep) {
          const target = Number(this.canvaJob?.pageNumber) || (index + 1);
          this.canvaControl.retryPage = false;
          this.canvaControl.retryStep = false;
          if (Number.isFinite(target) && target >= 1) {
            alreadyLayered.delete(target);
            index = target - 1;
          }
        }
        const pageNumber = index + 1;
        const percent = 20 + Math.floor((index / wantPages) * 60);
        if (alreadyLayered.has(pageNumber)) {
          this.canvaJob.patchPage(pageNumber, {
            status: 'SUCCESS',
            layered: true,
            uploaded: true,
            imported: true,
            started: true,
            layerCount: 2,
            lastVerification: 'resume-skip'
          });
          await report(percent + 1, `Page ${pageNumber} of ${wantPages} already layered.`, {
            designUrl,
            canvaPage: enrichPageProgress({}, {
              pageNumber,
              started: true,
              layered: true,
              error: null,
              layerCount: 2,
              status: 'SUCCESS',
              lastVerification: 'resume-skip'
            })
          });
          continue;
        }
        this.canvaJob.enter('PAGE_DETECTION', {
          action: 'select-page',
          expected: `page ${pageNumber} thumbnail current`,
          pageNumber
        });
        this.canvaJob.patchPage(pageNumber, { status: 'DETECTING', started: true, uploaded: true, imported: true });
        await this.#canvaDismissPrintReview(page);
        await report(percent, `Applying Magic Layer to page ${pageNumber} of ${wantPages}…`, {
          designUrl,
          canvaPage: enrichPageProgress({}, {
            pageNumber,
            started: true,
            layered: false,
            error: null,
            status: 'EDITING',
            lastState: this.canvaJob.state,
            lastAction: 'magic-layer'
          })
        });
        let outcome = await this.#canvaLayerPageWithHumanHelp(page, pageNumber, wantPages, async (_ignored, message) => {
          await report(percent, message, {
            designUrl,
            heartbeat: true,
            waitExplanation: explainWait({
              expected: `Magic Layer finished on page ${pageNumber}`,
              detected: message,
              state: this.canvaJob.state
            }),
            canvaPage: enrichPageProgress({}, {
              pageNumber,
              started: true,
              layered: false,
              error: null,
              status: 'MAGIC_LAYER_PROCESSING'
            })
          });
        });
        if (outcome.layered) {
          alreadyLayered.add(pageNumber);
          this.canvaJob.enter('PAGE_COMPLETE', { action: 'page-verified', pageNumber, expected: 'layerCount > 1' });
          this.canvaJob.patchPage(pageNumber, {
            status: 'SUCCESS',
            layered: true,
            layerCount: outcome.layerCount,
            lastVerification: 'layerCount>1'
          });
          await report(percent + 1, `Page ${pageNumber} of ${wantPages} done — Magic Layer applied.`, {
            designUrl,
            canvaPage: enrichPageProgress({}, {
              pageNumber,
              started: true,
              layered: true,
              error: null,
              layerCount: outcome.layerCount,
              status: 'SUCCESS',
              lastVerification: 'layerCount>1'
            })
          });
        } else {
          this.canvaJob.patchPage(pageNumber, { status: 'FAILED', layered: false, error: outcome.error });
          await report(percent + 1, `Page ${pageNumber} of ${wantPages} was not separated after 3 attempts. Continuing.`, {
            designUrl,
            canvaPage: enrichPageProgress({}, {
              pageNumber,
              started: true,
              layered: false,
              error: outcome.error,
              status: 'FAILED'
            })
          });
          if (outcome.code === 'CANVA_EDITOR_LOST') {
            page = await this.#canvaEnsureEditorPage(page, designUrl);
            this.canvaPage = page;
            if (canvaDesignId(page?.url?.() || '') && (this.canvaEditorRecoveries || 0) < 2) {
              this.canvaEditorRecoveries = (this.canvaEditorRecoveries || 0) + 1;
              this.canvaEditorLost = false;
              index -= 1;
              continue;
            }
            await report(percent + 1, 'The Canva editor tab closed. Stopping Magic Layer so the template link can still be saved.', { designUrl });
            break;
          }
        }
        this.canvaJob.enter('NEXT_PAGE', { action: 'advance-page', pageNumber: pageNumber + 1 });
      }
    }
    

    this.canvaJob.enter('ALL_PAGES_COMPLETE', { action: 'audit', expected: 'every page layerCount > 1' });
    page = await this.#canvaEnsureEditorPage(page, designUrl);
    this.canvaPage = page;
    await report(82, 'Checking layer count on every page…', { designUrl });
    const audit = await this.#canvaAuditAllPages(page, wantPages, report);
    const priorPages = Array.isArray(this.canvaJob?.pages) ? this.canvaJob.pages : [];
    const mergedAudit = audit.map((row) => {
      const prev = priorPages.find((item) => Number(item.pageNumber) === Number(row.pageNumber));
      if (prev?.layered && !row.layered) {
        return {
          ...row,
          layered: true,
          error: null,
          layerCount: prev.layerCount || row.layerCount,
          status: 'SUCCESS'
        };
      }
      return row;
    });
    await report(88, 'Creating the public template link…', {
      designUrl,
      canvaPages: mergedAudit,
      ...canvaDashboardPatch('template', { status: 'running' })
    });
    this.canvaJob.enter('SHARE_READY', { action: 'open-share', expected: 'Share panel' });
    page = await this.#canvaEnsureEditorPage(page, designUrl);
    this.canvaPage = page;
    const templateLink = await this.#canvaReadTemplateLinkFromSharePanel(page);
    if (!isCanvaTemplateLink(templateLink) || /\/edit(\?|$)/i.test(String(templateLink || ''))) {
      throw Object.assign(new Error('Share panel did not copy a public template link. Open Share → Template link → Create template link → Copy, then try again.'), {
        code: 'CANVA_EDITOR_URL_NOT_TEMPLATE'
      });
    }
    this.canvaJob.enter('TEMPLATE_LINK_COPIED', { action: 'verify-template-link', expected: '?template=1 URL' });
    designUrl = toCanvaDesignUrl(page.url()) || designUrl;
    await report(96, 'Saving the public template link…', {
      designUrl,
      templateLink,
      ...canvaDashboardPatch('saved', { status: 'running' })
    });
    let exportPath = null;
    if (downloadDir) {
      await report(97, 'Downloading the Canva PDF…', { designUrl, templateLink });
      exportPath = await this.#canvaDownloadPdf(page, downloadDir, projectId, bookCode).catch(() => null);
    }
    this.canvaJob.enter('JOB_COMPLETE', { action: 'complete', expected: 'verified template link saved' });
    await report(100, 'Canva editable layer complete.', {
      designUrl,
      templateLink,
      ...canvaDashboardPatch('saved', { status: 'ok' })
    });
    return {
      templateLink,
      exportPath,
      designUrl,
      usedBulkCreate: false,
      resumed,
      canvaPageProgress: mergedAudit
    };
    } catch (error) {
      if (!this.#isCanvaPauseError(error)) {
        await this.#canvaCaptureFailureSnapshot(page, error, {
          lastAction: this.canvaJob?.lastAction,
          expected: this.canvaJob?.lastExpected
        }).catch(() => null);
      }
      throw error;
    } finally {
      this.#stopCanvaLiveFrame();
      this._canvaOnProgress = null;
      await this.#lockCanvaBrowserBackground().catch(() => {});
    }
  }

  async releaseJob(jobId) {
    this.jobPages.delete(jobId);
    this.preparedJobs.delete(jobId);
  }

  async close() {
    this.cancelWaits();
    this.canvaWatch = false;
    this.canvaBackgroundLock = false;
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
    this.canvaPage = null;
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
  CANVA_HOME_URL,
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
  isCanvaPageUrl,
  isChatHomeUrl,
  isPersistedConversationUrl,
  isNewAssistantImage,
  jobPageNeedsNavigation,
  launchSystemLoginBrowser,
  localUploadFiles,
  scoreCanvaPdfFileInput,
  isUnsafeCanvaUploadClick,
  managedBrowserOptions,
  mergeTptCookies,
  mergePreservedSessionCookies,
  usesCanvaAuthentication,
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
