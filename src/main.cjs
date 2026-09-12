
// Forcefully intercept console.log to prevent EPIPE crashes

const originalWarn = console.warn;
console.warn = function(...args) {
  try { originalWarn.apply(console, args); } catch (err) { if (err.code !== 'EPIPE' && err.code !== 'EOF') throw err; }
};
const originalError = console.error;
console.error = function(...args) {
  try { originalError.apply(console, args); } catch (err) { if (err.code !== 'EPIPE' && err.code !== 'EOF') throw err; }
};

const originalLog = console.log;
console.log = function(...args) {
  try {
    originalLog.apply(console, args);
  } catch (err) {
    if (err.code !== 'EPIPE' && err.code !== 'EOF' && err.code !== 'ERR_STREAM_DESTROYED') {
      throw err;
    }
  }
};

function isAddressInUseError(error) {
  return Boolean(error) && (
    error.code === 'EADDRINUSE'
    || /EADDRINUSE|address already in use/i.test(String(error.message || error))
  );
}

function bootLog(message, extra) {
  try {
    const line = `[${new Date().toISOString()}] ${message}${extra ? `\n${extra}` : ''}\n`;
    require('node:fs').appendFileSync('/tmp/versa-boot.log', line);
  } catch {}
  try { console.error('[versa]', message, extra || ''); } catch {}
}

function agentLog(location, message, data) {
  try { bootLog(message, JSON.stringify(data || {})); } catch {}
}

agentLog('main.cjs:entry', 'main-entry', {
  electron: process.versions.electron || null,
  execPath: process.execPath,
  argv: process.argv.slice(0, 4),
  runAsNode: process.env.ELECTRON_RUN_AS_NODE === undefined ? 'unset' : String(process.env.ELECTRON_RUN_AS_NODE),
  type: process.type || null
}, 'H3');

process.on('uncaughtException', (error) => {
  if (isAddressInUseError(error)) {
    try { console.warn('[tpt-versa] 127.0.0.1:31338 already in use; continuing.'); } catch {}
    return;
  }
  bootLog('uncaughtException', error?.stack || error);
  try {
    if (typeof app !== 'undefined') app.quit();
    else process.exit(1);
  } catch { process.exit(1); }
});

process.on('unhandledRejection', (error) => {
  bootLog('unhandledRejection', error?.stack || error);
  
});

const { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, nativeTheme, net, protocol, screen, shell } = require('electron');
agentLog('main.cjs:electron', 'after-electron-require', { hasApp: Boolean(app), ready: Boolean(app?.isReady?.()) }, 'H3');
nativeTheme.themeSource = 'system';
let autoUpdater = null;
function getAutoUpdater() {
  if (!autoUpdater) {
    autoUpdater = require('electron-updater').autoUpdater;
  }
  return autoUpdater;
}
agentLog('main.cjs:updater', 'skipped-electron-updater-at-boot', { lazy: true }, 'H6');
function loadMod(label, loader) {
  const exported = loader();
  return exported;
}
const { createHash, randomUUID } = require('node:crypto');
const { copyFileSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } = require('node:fs');
const { dirname, extname, isAbsolute, join, basename, resolve, sep } = require('node:path');
const { pathToFileURL } = require('node:url');
const { DatabaseSync } = require('node:sqlite');
const { normalizeAppearance, resolveAppearance, windowBackground, splashBackground } = require('./appearance.cjs');
const { BrowserController } = loadMod('browser-controller', () => require('./browser-controller.cjs'));
const { runBundleUploadSequence } = loadMod('bundle-upload-runner', () => require('./bundle-upload-runner.cjs'));
const { FileManager, collectProductPageImagePaths, allInteriorPagesComplete, printPdfPageChecksum, printPdfPackageIsCurrent, compressedPrintPdfDest, bookFileCode, verifyOverview, verifyExportZip, formatPrintPdfBytes, findExistingBookDocument, atomicWrite, ensureCardPreview, cardPreviewPathFor } = loadMod('file-manager', () => require('./file-manager.cjs'));
const { FORMAT_INSTRUCTIONS, buildBookJobs, buildImportedJobs, buildStorybookJobs, cleanText, normalizeOrientation, parseAnalysisResponse, parseGeneratedPrompts, formatSeoBundleText, sanitizeSeoListingFields, isSeoSkipStub, slugify } = loadMod('prompt-builder', () => require('./prompt-builder.cjs'));
const {
  normalizeEngine,
  engineDisplayName,
  getJobStartUrl,
  loginConfirmedKey,
  accountProfileKey,
  isBrowserEngine,
  listGeminiStudios,
  listChatGptStudios,
  findStudio
} = loadMod('ai-engine', () => require('./ai-engine.cjs'));
const {
  setCustomizationSource,
  normalizeCustomization,
  customizationDefaults
} = loadMod('customization', () => require('./customization.cjs'));
const { MetaApiController } = loadMod('meta-api-controller', () => require('./meta-api-controller.cjs'));
const { runOperation } = loadMod('generation-control', () => require('./generation-control.cjs'));
const { QueueEngine } = loadMod('queue-engine', () => require('./queue-engine.cjs'));
const { startAutomationHttp } = loadMod('automation-http', () => require('./automation-http.cjs'));
const { ProjectStore } = loadMod('store', () => require('./store.cjs'));
const { runEditableProject, verifyEditableOutput, ProductFileManager } = loadMod('editable-production', () => require('./editable-production.cjs'));
const { generateEditablePageText, readCachedPageText } = loadMod('editable-page-text', () => require('./editable-page-text.cjs'));
const { ARTWORK_PROMPT } = loadMod('editable-prompts', () => require('./editable-prompts.cjs'));
const { detectProductFormat } = loadMod('product-format-detector', () => require('./product-format-detector.cjs'));
const { runPageVision, collectPageVision, clearPageVision, visionBridge } = loadMod('editable-vision-pages', () => require('./editable-vision-pages.cjs'));
const { createTextLabObserver } = loadMod('text-lab-observer', () => require('./text-lab-observer.cjs'));
const comfy = loadMod('comfy-service', () => require('./comfy-service.cjs'));
const bookManagementService = loadMod('book-management-service', () => require('./book-management-service.cjs'));
const {
  registerBookManagementIpc,
  exportToManagementFolder
} = loadMod('book-management-ipc', () => require('./book-management-ipc.cjs'));
const { requireManagementDestination } = loadMod('book-management-bridge', () => require('./book-management-bridge.cjs'));
const {
  buildEditablePages, mergeEditableBook, listEditablePages, clearEditablePages, editableBookPath
} = loadMod('editable-layered-pdf', () => require('./editable-layered-pdf.cjs'));
const { buildEditableDeck, editableDeckPath } = loadMod('editable-layered-pptx', () => require('./editable-layered-pptx.cjs'));
const { createEditableBrowserProvider } = loadMod('editable-browser-provider', () => require('./editable-browser-provider.cjs'));
let editableAbortController = null;
let pendingNativeStart = null;
const { AutomationManager, PIPELINE_STEPS } = loadMod('automation-manager', () => require('./automation-manager.cjs'));
const {
  SOURCES: TREND_SOURCES,
  MARKETPLACES: TREND_MARKETPLACES,
  discoverKeywords,
  validateKeyword,
  chooseOpportunity,
  scrapeSource,
  toAnalysisInput,
  pickTrendListing,
  recentTrendPickUrls,
  rememberTrendPick
} = loadMod('trend-scout', () => require('./trend-scout.cjs'));
const {
  KIND: TASK_KIND,
  createPipelineRunner,
  awaitTask,
  dedupeKey,
  projectTaskState
} = loadMod('pipeline-tasks', () => require('./pipeline-tasks.cjs'));
const { applyPipelineWatchdog } = loadMod('pipeline-watchdog', () => require('./pipeline-watchdog.cjs'));
agentLog('main.cjs:requires', 'after-heavy-requires', { rss: process.memoryUsage().rss }, 'H7');

function normalizeTrendMarketplace(value) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return TREND_MARKETPLACES.includes(candidate) ? candidate : 'tpt';
}

app.commandLine.appendSwitch('force-renderer-accessibility');
app.commandLine.appendSwitch('remote-debugging-port', '9222');

// Prevent EPIPE errors from crashing the main process when stdout/stderr is closed
['stdout', 'stderr'].forEach((streamName) => {
  if (process[streamName]) {
    process[streamName].on('error', (err) => {
      if (err.code === 'EPIPE' || err.code === 'EOF' || err.code === 'ERR_STREAM_DESTROYED') {
        return; // Ignore closed pipes safely
      }
      console.error(err);
    });
  }
});


const apiHandlers = {};
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, callback) => {
  apiHandlers[channel] = callback;
  originalHandle(channel, callback);
};

const { UpdateManager } = require('./update-manager.cjs');
const { TelemetryService } = require('./telemetry.cjs');
const {
  competitorMockupPaths,
  parseTptProductUrl,
  persistCompetitorMockups,
  resolveListingAnalysisInput
} = require('./tpt-listing-mockups.cjs');
const {
  getMockups,
  applyMockupsToListing,
  mirrorMockupsOnListing,
  countValidMockupPaths,
  enrichProjectWithMockups
} = require('./mockups-state.cjs');
const {
  getVideo,
  applyVideoToListing,
  hasValidVideoFile,
  enrichProjectWithVideo
} = require('./video-state.cjs');
const {
  getPdf,
  applyPdfToProject,
  hasValidPdfFile
} = require('./pdf-state.cjs');
const {
  getSeo,
  applySeoToListing,
  pickSeoFieldsFromObject,
  isSeoContentComplete,
  enrichProjectWithSeo
} = require('./seo-state.cjs');
const { exec } = require('node:child_process');

let mainWindow = null;
let splashWindow = null;
let splashShownAt = 0;
let store = null;
let browser = null;
let fileManager = null;
let queue = null;
let quitting = false;
let systemActionTimer = null;

/** Stop a pending sleep/shutdown countdown. Returns whether one was actually running. */
function cancelPendingSystemAction() {
  if (!systemActionTimer) return false;
  clearInterval(systemActionTimer);
  systemActionTimer = null;
  systemActionPayload = null;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('system:action-cancelled');
  }
  return true;
}
let systemActionPayload = null; // { actionType: 'shutdown' | 'sleep', secondsRemaining: 60, projectId: '...' }
let storybookAssetGenerationActive = false;
let tptListingAutomationActive = false;
let bundleUploadActive = false;
let bundleUploadQueue = []; // list of projectIds queued for batch upload
let bundleUploadCurrentId = null;
let updateManager = null;
let telemetryService = null;
let updatePromptOpen = false;
let installingUpdate = false;
let automation = null;
let pipelineRunner = null;
let pipelineStepRunners = null;
let liveOperation = null;
const printPdfInflight = new Map();
const mazeAssembleInflight = new Map();
const mazeContinueInflight = new Map();
const LOGIN_SESSION_SCHEMA_VERSION = 4;
const APP_NAME = 'VERSA CLASS';
const LEGACY_APP_NAME = 'POD Network Book Studio';
const LEGACY_USER_DATA_NAMES = ['TPT VERSA', 'tpt-book-builder-desktop', 'Versa AI', LEGACY_APP_NAME];
const SPLASH_MIN_DURATION_MS = 1400;
const CUSTOM_GPT_NAME = 'VERSA CLASS Gems';
const CONTENT_GEM_NAME = 'Content Pages Gem';
const MOCKUPS_GEM_NAME = 'Mockups Gem';
const PREVIEW_GEM_NAME = 'Veo 3 Preview Gem';

function getActiveEngine() {
  return normalizeEngine(store?.getSetting('aiEngine', 'chatgpt'));
}

function isEngineConfirmed(engine = getActiveEngine()) {
  if (normalizeEngine(engine) === 'meta') {
    return Boolean(store?.getSetting('metaLoginConfirmed', false));
  }
  return Boolean(store?.getSetting(loginConfirmedKey(engine), false));
}

function requireActiveEngine(actionLabel) {
  const engine = getActiveEngine();
  applyActiveEngineToBrowser();
  if (isEngineConfirmed(engine)) return engine;
  throw Object.assign(
    new Error(`Connect ${engineDisplayName(engine)} before ${actionLabel}. The other engine stays signed in but is not used.`),
    { code: 'AUTH_REQUIRED' }
  );
}

function applyActiveEngineToBrowser() {
  if (browser && typeof browser.setEngine === 'function') {
    browser.setEngine(getActiveEngine());
  }
  syncBrowserVerifiedAccounts();
}

function syncBrowserVerifiedAccounts() {
  if (!browser || typeof browser.setVerifiedAccounts !== 'function' || !store) return;
  const gemini = store.getSetting('geminiAccountProfile', null) || {};
  const chatgpt = store.getSetting('chatgptAccountProfile', null) || {};
  const meta = store.getSetting('metaAccountProfile', null) || {};
  browser.setVerifiedAccounts({
    gemini: {
      confirmed: Boolean(store.getSetting('geminiLoginConfirmed', false)),
      email: gemini.email || '',
      name: gemini.name || ''
    },
    chatgpt: {
      confirmed: Boolean(store.getSetting('chatgptLoginConfirmed', false)),
      email: chatgpt.email || '',
      name: chatgpt.name || ''
    },
    meta: {
      confirmed: Boolean(store.getSetting('metaLoginConfirmed', false)),
      email: meta.email || '',
      name: meta.name || ''
    }
  });
}

function restoreSavedServiceLogins() {
  if (!browser || !store || typeof browser.inspectSavedLogins !== 'function') return;
  let saved = null;
  try {
    saved = browser.inspectSavedLogins();
  } catch {
    return;
  }
  if (!saved || typeof saved !== 'object') return;
  const mapping = [
    ['chatgpt', 'chatgptLoginConfirmed'],
    ['gemini', 'geminiLoginConfirmed'],
    ['meta', 'metaLoginConfirmed']
  ];
  for (const [service, key] of mapping) {
    if (saved[service]) store.setSetting(key, true);
  }
}

function setActiveEngine(engine) {
  const next = normalizeEngine(engine);
  store.setSetting('aiEngine', next);
  applyActiveEngineToBrowser();
  if (queue && typeof queue.notifyEngineChange === 'function') {
    queue.notifyEngineChange(next);
  }
  return next;
}

function requireGeminiForPreview(actionLabel) {
  if (isEngineConfirmed('gemini')) return 'gemini';
  throw Object.assign(
    new Error(`Connect Gemini before ${actionLabel}. Preview videos always use the Veo 3 custom gem. ChatGPT and Meta stay signed in and unused for this stage.`),
    { code: 'GEMINI_REQUIRED' }
  );
}

function requireGeminiForPlanning(actionLabel) {
  syncBrowserVerifiedAccounts();
  if (isEngineConfirmed('gemini')) return 'gemini';
  throw Object.assign(
    new Error(`Connect Gemini before ${actionLabel}. Gemini always writes analysis, blueprints, and prompts. ChatGPT and Meta stay signed in and unused for this stage.`),
    { code: 'GEMINI_REQUIRED' }
  );
}

function requireListingEngine(actionLabel) {
  if (getActiveEngine() === 'meta') return requireGeminiForPlanning(actionLabel);
  return requireActiveEngine(actionLabel);
}

async function lockBrowserDesk(reason = 'desk-lock') {
  try {
    if (typeof browser.launch === 'function') {
      await browser.launch({ interactive: false, skipHome: true, headless: true });
    }
  } catch {
    /* ignore park failures */
  }
  return typeof browser.status === 'function' ? browser.status() : { background: true };
}

function appendDebug1c3662(payload) {
}

async function assertListingChatSessionReady(actionLabel = 'listing generation') {
  const engine = getActiveEngine() === 'meta' ? 'gemini' : getActiveEngine();
  requireListingEngine(actionLabel);
  const looksSignedOutUrl = (rawUrl) => /accounts\.google\.com|ServiceLogin|signin\/|\/auth\/|login\.chatgpt|auth\.openai/i.test(String(rawUrl || ''));
  const looksLikeEngineHome = (rawUrl) => {
    const url = String(rawUrl || '');
    if (engine === 'chatgpt') return /chatgpt\.com|chat\.openai\.com/i.test(url);
    return /gemini\.google\.com/i.test(url);
  };
  // Guest Gemini landing still exposes a composer; require cookie/profile evidence for listing.
  // Also treat visible Sign in controls as signed-out even if stale Google cookies remain.
  const authLooksSignedOut = (probe) => {
    if (!probe || typeof probe !== 'object') return false;
    if (probe.authenticated === false) return true;
    if (probe.loginControl === true) return true;
    const hasIdentity = Boolean(probe.hasSessionCookie || probe.hasProfileButton);
    return !hasIdentity;
  };
  const pageShowsSignIn = async () => {
    const page = browser?.page;
    if (!page || page.isClosed?.()) return false;
    try {
      const signInButton = page.getByRole('button', { name: /^(sign in|log in)$/i }).first();
      if (await signInButton.isVisible().catch(() => false)) return true;
      const signInLink = page.getByRole('link', { name: /^(sign in|log in)$/i }).first();
      if (await signInLink.isVisible().catch(() => false)) return true;
      return false;
    } catch {
      return false;
    }
  };
  let status = null;
  try {
    status = await lockBrowserDesk('listing-session-check');
  } catch (error) {
    appendDebug1c3662({
      runId: 'browser-lock', hypothesisId: 'C', location: 'main.cjs:assertListingChatSessionReady',
      message: 'browser launch/status failed before listing',
      data: { engine, err: String(error?.message || error).slice(0, 180) }
    });
    throw error;
  }
  let url = String(status?.url || '');
  let signedOut = looksSignedOutUrl(url);
  let authProbe = null;
  let signInVisible = false;
    // Leftover accounts.google tabs can mask session state. Probe engine home under lock,
  // then use authenticationStatus (no login flag writes). Never clear loginConfirmed here.
  const needsHomeProbe = signedOut || !looksLikeEngineHome(url);
  if (needsHomeProbe || typeof browser.authenticationStatus === 'function') {
    appendDebug1c3662({
      runId: 'browser-lock', hypothesisId: 'A', location: 'main.cjs:assertListingChatSessionReady:probe-home',
      message: 'probing engine home under lock before session expiry throw',
      data: { engine, beforeUrl: url.slice(0, 180), signedOutBefore: signedOut, needsHomeProbe, loginFlagKept: true }
    });
    try {
      if (typeof browser.launch === 'function') {
        await browser.launch({ interactive: false, skipHome: true, headless: true, forceBrowser: true });
      }
      if (needsHomeProbe) {
        if (typeof browser.openHome === 'function') {
          await browser.openHome();
        } else if (typeof browser.navigate === 'function') {
          await browser.navigate(engine === 'chatgpt' ? 'https://chatgpt.com/' : 'https://gemini.google.com/app');
        }
      } else if (typeof browser.navigate === 'function' && engine === 'gemini') {
        // Force a fresh Gemini surface so stale cookies + guest landing are visible to Playwright.
        await browser.navigate('https://gemini.google.com/app');
      }
      status = typeof browser.status === 'function' ? await browser.status() : status;
      url = String(status?.url || '');
      if (typeof browser.authenticationStatus === 'function') {
        authProbe = await browser.authenticationStatus(null, { forceTarget: engine });
      }
      signInVisible = await pageShowsSignIn();
      // Gemini marketing pages often show a Sign in CTA even when the automation profile
      // already has a live authenticated session + cookie. Prefer authProbe over that CTA.
      const authOk = authProbe?.authenticated === true
        && Boolean(authProbe?.hasSessionCookie || authProbe?.hasProfileButton)
        && authProbe?.loginControl !== true;
      signedOut = looksSignedOutUrl(url) || authLooksSignedOut(authProbe) || (signInVisible && !authOk);
    } catch (probeError) {
      appendDebug1c3662({
        runId: 'browser-lock', hypothesisId: 'A', location: 'main.cjs:assertListingChatSessionReady:probe-fail',
        message: 'engine home probe failed; keeping prior signedOut decision',
        data: { engine, err: String(probeError?.message || probeError).slice(0, 180), url: url.slice(0, 180), signedOut }
      });
    }
    try {
      status = await lockBrowserDesk('listing-session-recheck');
      url = String(status?.url || url);
      if (looksSignedOutUrl(url)) signedOut = true;
    } catch { /* keep prior decision */ }
  }
  appendDebug1c3662({
    runId: 'browser-lock', hypothesisId: 'A', location: 'main.cjs:assertListingChatSessionReady',
    message: 'listing chat session check',
    data: {
      engine, signedOut, url: url.slice(0, 180), title: status?.title || null, loginFlagKept: true,
      authAuthenticated: authProbe?.authenticated ?? null,
      authLoginControl: authProbe?.loginControl ?? null,
      authHasSessionCookie: authProbe?.hasSessionCookie ?? null,
      authHasProfileButton: authProbe?.hasProfileButton ?? null,
      signInVisible
    }
  });
  if (!signedOut) return engine;
  // Do NOT clear loginConfirmed flags here — that looked like "signing the user out".
  // Ask them to re-verify once; Settings Verify is the only unlock path.
  throw Object.assign(
    new Error(
      engine === 'chatgpt'
        ? 'Background ChatGPT session needs a refresh. Settings → Verify ChatGPT login (unlocks browser only for that), then Generate SEO again.'
        : 'Background Gemini session needs a refresh. Settings → Verify Gemini login (unlocks browser only for that), then Generate SEO again.'
    ),
    { code: 'ENGINE_SESSION_EXPIRED' }
  );
}

function setLiveOperation(next = null) {
  if (!next) {
    liveOperation = null;
    return;
  }
  liveOperation = {
    kind: next.kind || 'work',
    label: next.label || 'Working',
    message: next.message || '',
    percent: Math.max(0, Math.min(100, Number(next.percent) || 0)),
    stepIndex: Number.isFinite(Number(next.stepIndex)) ? Number(next.stepIndex) : null,
    stepCount: Number(next.stepCount) || null,
    projectId: next.projectId || null,
    jobId: next.jobId || null,
    lastError: next.lastError !== undefined ? next.lastError : (liveOperation?.lastError || null),
    attempt: next.attempt ?? liveOperation?.attempt ?? 0,
    pageFileName: next.pageFileName !== undefined
      ? next.pageFileName
      : (liveOperation?.kind === (next.kind || 'work') && liveOperation?.projectId === (next.projectId || null)
        ? liveOperation.pageFileName
        : null),
    startedAt: Number(next.startedAt)
      || (liveOperation?.kind === (next.kind || 'work') && liveOperation?.projectId === (next.projectId || null)
        ? liveOperation.startedAt
        : Date.now()),
    updatedAt: Date.now(),
    waitExplanation: next.waitExplanation !== undefined
      ? next.waitExplanation
      : (liveOperation?.kind === (next.kind || 'work') ? liveOperation.waitExplanation : null),
    controller: next.controller !== undefined
      ? next.controller
      : (liveOperation?.kind === (next.kind || 'work') ? liveOperation.controller : null),
    liveFrame: next.liveFrame !== undefined
      ? next.liveFrame
      : (liveOperation?.kind === (next.kind || 'work') ? liveOperation.liveFrame : null),
    intervention: next.intervention !== undefined
      ? next.intervention
      : (liveOperation?.kind === (next.kind || 'work') ? liveOperation.intervention : null),
    jobState: next.jobState || (liveOperation?.kind === (next.kind || 'work') ? liveOperation.jobState : null),
    browserUrl: next.browserUrl || next.url || (liveOperation?.kind === (next.kind || 'work') ? liveOperation.browserUrl : null),
    jobStream: Array.isArray(next.jobStream)
      ? next.jobStream
      : (Array.isArray(next.jobState?.stream)
        ? next.jobState.stream
        : (liveOperation?.kind === (next.kind || 'work') ? liveOperation.jobStream : null)),
    recovering: Boolean(next.recovering),
    remainingMs: next.remainingMs != null ? Number(next.remainingMs) : (liveOperation?.remainingMs ?? null),
    phase: next.phase || (liveOperation?.kind === (next.kind || 'work') ? liveOperation.phase : null),
    lockMessage: null
  };
}

async function publishLiveOperation(next) {
  setLiveOperation(next);
  await broadcastState();
}

function finishLiveWork() {
  setLiveOperation(null);
  try { browser?.endWork?.(); } catch {}
}

function tryRemovePath(filePath) {
  if (!filePath || !existsSync(filePath)) return;
  try { rmSync(filePath, { force: true }); } catch {}
}

async function assembleMazeProductExports(projectId, { onProgress = null } = {}) {
  const existing = mazeAssembleInflight.get(projectId);
  if (existing) return existing;
  const run = (async () => {
    const { assembleMazeDeliverables } = require('./maze-export.cjs');
    return assembleMazeDeliverables(store, projectId, { fileManager, onProgress });
  })();
  mazeAssembleInflight.set(projectId, run);
  try {
    return await run;
  } finally {
    if (mazeAssembleInflight.get(projectId) === run) mazeAssembleInflight.delete(projectId);
  }
}

async function continueMazeProductPipeline(projectId, { fromAutomation = false } = {}) {
  const existing = mazeContinueInflight.get(projectId);
  if (existing) return existing;
  const run = (async () => {
    const project = store.getProject(projectId);
    if (!project || project.productFormat !== 'maze') return null;
    // #region agent log
    fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H201',location:'src/main.cjs:continueMazeProductPipeline',message:'maze pipeline continuing after generate',data:{projectId,fromAutomation,stepMaze:project.stepMazeStatus||null},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    const occupyAssemble = !liveOperation || liveOperation.kind === 'maze-assemble' || liveOperation.kind === 'print-pdf';
    if (occupyAssemble) {
      await publishLiveOperation({
        kind: 'maze-assemble',
        label: 'Assembling exports',
        percent: 8,
        message: 'Assembling…',
        projectId
      });
    }
    try {
      await assembleMazeProductExports(projectId, {
        onProgress: async (info) => {
          if (!occupyAssemble) return;
          await publishLiveOperation({
            kind: 'maze-assemble',
            label: 'Assembling exports',
            percent: Number(info?.percent) || 20,
            message: info?.message || 'Assembling maze exports…',
            projectId
          });
        }
      });
      store.appendEvent({
        projectId,
        level: 'success',
        message: 'Assembling. Mockups next.'
      });
    } finally {
      if (liveOperation?.kind === 'maze-assemble' && liveOperation.projectId === projectId) {
        setLiveOperation(null);
        await broadcastState();
      }
    }
    if (fromAutomation) return { assembled: true, continued: 'automation' };
    const liveKind = liveOperation?.kind;
    if (liveOperation?.projectId === projectId && ['thumbnails', 'preview', 'export'].includes(liveKind)) {
      return { assembled: true, continued: liveKind };
    }
    const auto = automation?.getStatus?.();
    if (auto?.active && auto.currentProjectId === projectId) return { assembled: true, continued: 'automation' };
    if (auto?.active) return { assembled: true, continued: false };
    await automation.start({ projectId });
    return { assembled: true, continued: 'started' };
  })();
  mazeContinueInflight.set(projectId, run);
  try {
    return await run;
  } finally {
    if (mazeContinueInflight.get(projectId) === run) mazeContinueInflight.delete(projectId);
  }
}

async function ensureProductPdf(projectId, { force = false, onProgress = null } = {}) {
  const mazeProject = store.getProject(projectId);
  if (mazeProject?.productFormat === 'maze') {
    const assembled = await assembleMazeProductExports(projectId, { onProgress });
    return assembled?.pdfPath || null;
  }
  const existingRun = printPdfInflight.get(projectId);
  if (existingRun) return existingRun;

  const run = (async () => {
    const project = store.getProject(projectId);
    if (!project) return null;
    // Editable products ship as .pptx; teachers do not want a flattened PDF of them.
    if (project.productFormat === 'editable') return null;
    if (!project.stats?.total || project.stats.complete !== project.stats.total) return null;
    if (!allInteriorPagesComplete(project)) {
      throw Object.assign(new Error('PDF export is locked until every page is complete.'), { code: 'BOOK_INCOMPLETE' });
    }

    const checksum = printPdfPageChecksum(project.jobs);
    const pdf = getPdf(project);
    const existingProduct = pdf.productPath;
    const existingCompressed = pdf.compressedPath;
    if (!force && printPdfPackageIsCurrent(project)) {
      if (getPdf(project).productPath !== existingProduct || getPdf(project).compressedPath !== existingCompressed) {
        store.updateProjectTransactionally(projectId, (p) => applyPdfToProject(p, { productPath: existingProduct, compressedPath: existingCompressed }));
      }
      return existingProduct;
    }
    if (!force && hasValidPdfFile(existingProduct) && hasValidPdfFile(existingCompressed) && pdf.metadata.checksum === checksum && pdf.metadata.stage === 'ready') {
      return existingProduct;
    }

    const publishedLive = !liveOperation || liveOperation.kind === 'print-pdf';
    const report = async (patch) => {
      store.updateProjectTransactionally(projectId, (p) => applyPdfToProject(p, {
        metadata: {
          checksum,
          ...patch,
          updatedAt: new Date().toISOString()
        }
      }));
      if (typeof onProgress === 'function') await onProgress(patch);
      if (publishedLive) {
        await publishLiveOperation({
          kind: 'print-pdf',
          label: 'Print PDF',
          percent: patch.stage === 'converting' ? 92 : patch.stage === 'compressing' ? 96 : 100,
          message: patch.message,
          projectId
        });
      } else {
        await broadcastState();
      }
    };

    try {
      store.updateProjectTransactionally(projectId, (p) => applyPdfToProject(p, {
        metadata: {
          checksum,
          stage: 'converting',
          message: 'Converting pages to PDF…',
          error: null,
          updatedAt: new Date().toISOString()
        }
      }));
      const pkg = await fileManager.buildPrintPdfPackage(project, { onProgress: report, store });
      store.updateProjectTransactionally(projectId, (p) => applyPdfToProject(p, {
        productPath: pkg.productPdfPath,
        compressedPath: pkg.compressedPdfPath,
        metadata: {
          checksum,
          stage: 'ready',
          originalBytes: pkg.originalBytes,
          outputBytes: pkg.outputBytes,
          skipped: pkg.skipped,
          reason: pkg.reason,
          pageCount: pkg.pageCount,
          error: null,
          message: pkg.skipped
            ? `Print PDF ready (${formatPrintPdfBytes(pkg.originalBytes)}).`
            : `Print PDF ready (${formatPrintPdfBytes(pkg.originalBytes)} → ${formatPrintPdfBytes(pkg.outputBytes)}).`,
          updatedAt: new Date().toISOString()
        }
      }));
      const sizeLine = pkg.skipped
        ? `Print PDF ready (${formatPrintPdfBytes(pkg.originalBytes)}). Downstream stages will reuse this file.`
        : `Print PDF ready (${formatPrintPdfBytes(pkg.originalBytes)} → ${formatPrintPdfBytes(pkg.outputBytes)}). Downstream stages will reuse this file.`;
      store.appendEvent({
        projectId,
        level: 'success',
        message: sizeLine
      });
      return pkg.productPdfPath;
    } catch (error) {
      store.updateProjectTransactionally(projectId, (p) => applyPdfToProject(p, {
        metadata: {
          checksum,
          stage: 'error',
          error: error?.message || String(error),
          message: error?.message || 'Print PDF conversion failed.',
          updatedAt: new Date().toISOString()
        }
      }));
      throw error;
    } finally {
      if (liveOperation?.kind === 'print-pdf' && liveOperation.projectId === projectId) {
        setLiveOperation(null);
        await broadcastState();
      }
    }
  })();

  printPdfInflight.set(projectId, run);
  try {
    return await run;
  } finally {
    if (printPdfInflight.get(projectId) === run) printPdfInflight.delete(projectId);
  }
}

async function ensureListingShellForAssets(projectId) {
  const project = ensureProjectOutputDirectory(projectId);
  if (!project) return null;
  const pdfPath = await ensureProductSourceDocument(projectId);
  if (!pdfPath) {
    throw Object.assign(new Error('Complete every page before mockups or preview. The book file is built when pages finish.'), {
      code: 'BOOK_INCOMPLETE'
    });
  }
  const existing = sanitizeSeoListingFields(project.tptListing && typeof project.tptListing === 'object' ? project.tptListing : {});
  const existingMockups = getMockups(project);
  const defaultBriefs = [
    `Hero mockup for ${project.name || 'this product'}`,
    `Classroom use mockup for ${project.name || 'this product'}`,
    `Feature highlight mockup for ${project.name || 'this product'}`,
    `Close-up detail mockup for ${project.name || 'this product'}`
  ];
  const briefs = existingMockups.briefs.length ? existingMockups.briefs : defaultBriefs;
  const existingSeo = getSeo(project);
  let shell = applyMockupsToListing({
    ...existing,
    productPdfPath: existing.productPdfPath && existsSync(existing.productPdfPath) ? existing.productPdfPath : pdfPath,
    status: existing.status || 'assets_pending'
  }, {
    paths: existingMockups.paths,
    briefs,
    progress: existingMockups.progress,
    conversationUrl: existingMockups.conversationUrl,
    error: existingMockups.error,
    mode: existingMockups.mode
  });
  // Phase 3C: dual-write SEO shell fields (empty ok — preserves legacy if present).
  shell = applySeoToListing(shell, {
    title: existingSeo.title || '',
    description: existingSeo.description || '',
    tags: Array.isArray(existingSeo.tags) ? existingSeo.tags : [],
    subjects: Array.isArray(existingSeo.subjects) ? existingSeo.subjects : [],
    seoText: existingSeo.seoText || '',
    highlights: existingSeo.highlights,
    grades: existingSeo.grades,
    formats: existingSeo.formats,
    customCategories: existingSeo.customCategories,
    pageCount: existingSeo.pageCount,
    teachingDuration: existingSeo.teachingDuration,
    answerKey: existingSeo.answerKey,
    standards: existingSeo.standards,
    rawResponse: existingSeo.rawResponse,
    conversationUrl: existingSeo.conversationUrl,
    seoDocumentPath: existingSeo.seoDocumentPath
  });
  const listingDirty = !project.tptListing
    || getPdf(project).productPath !== shell.productPdfPath
    || !Array.isArray(project.tptListing.thumbnailBriefs)
    || !project.tptListing.mockups
    || !project.tptListing.seo
    || project.tptListing.description !== shell.description
    || JSON.stringify(project.tptListing.tags || []) !== JSON.stringify(shell.tags)
    || JSON.stringify(project.tptListing.subjects || []) !== JSON.stringify(shell.subjects);
  if (listingDirty) {
    store.updateProject(projectId, { tptListing: shell });
  }
  return store.getProject(projectId);
}

async function ensureSeoBookDocument(projectId, { force = false } = {}) {
  const project = ensureProjectOutputDirectory(projectId);
  if (!project) return null;
  if (!project.stats?.total || project.stats.complete !== project.stats.total) return null;
  const existing = !force ? findExistingBookDocument(project.outputDir) : null;
  if (existing && existsSync(existing)) {
    return existing;
  }
  const docPath = await fileManager.exportDocx(project);
  return docPath;
}

// The document SEO, mockups and preview upload. Editable products ship as .pptx and
// never build a print PDF, so their source is the Word/Google-Doc export instead.
async function ensureProductSourceDocument(projectId) {
  const project = store.getProject(projectId);
  if (project?.productFormat === 'editable') return ensureSeoBookDocument(projectId);
  return ensureProductPdf(projectId);
}

/**
 * The compiled .docx, which every marketing generator reads as ground truth.
 *
 * Mockups, the preview video and the listing copy all have to describe the book that
 * actually shipped. Left to infer from a title and a theme, the model fills the gaps -
 * it invents a grade level, a subject, page furniture that is not there - and the buyer
 * receives a product that does not match what they were shown. That is a refund.
 *
 * So the document is compiled first and fed in as the context, for both engines. Static
 * books previously sent the print PDF and editable books sent nothing at all for
 * mockups, because they never build one.
 */
/**
 * Build all three deliverables from the pages Interior Text rebuilt.
 *
 * The deck, the layered PDF and the Word document are one unit. They were not: only the
 * PDF was assembled here, so the document existed nowhere until a marketing stage tried
 * to read it - and the finder quietly handed over the .pptx instead, which is the
 * "received book-editable.pptx" failure. Building all three together means the ground
 * truth marketing depends on is produced by the stage that owns the book.
 */
async function assembleEditableDeliverables(projectId, onProgress = () => {}) {
  const project = store.getProject(projectId);
  if (!project) throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });

  onProgress(5);
  const { isTextFreeProject } = require('./text-free-pipeline.cjs');
  const textFree = isTextFreeProject(store, project);
  const deck = await buildEditableDeck({
    store, projectId, onProgress: (value) => onProgress(5 + Math.round(value * 0.45))
  });
  const deckPath = deck.outputPath || editableDeckPath(store.getProject(projectId));
  const deckBytes = deckPath && existsSync(deckPath) ? statSync(deckPath).size : 0;
  if (!deckPath || !existsSync(deckPath) || deckBytes < 2048) {
    throw Object.assign(
      new Error(`PPTX was not written or is empty: ${deckPath || '(missing path)'}`),
      { code: 'PPTX_INVALID' }
    );
  }
  let book = null;
  let docxPath = null;
  if (!textFree) {
    book = await mergeEditableBook({
      store, projectId, onProgress: (value) => onProgress(50 + Math.round(value * 0.3))
    });
    docxPath = await fileManager.exportDocx(store.getProject(projectId));
  }
  onProgress(100);

  store.appendEvent({
    projectId, level: 'success',
    message: textFree
      ? `Text-free deck ready: ${deck.slides} slides stamped from the layout template. Nothing was erased.`
      : `Editable deliverables ready: ${deck.slides} slide deck, ${book.pages}-page layered PDF, and the Word document.`
  });
  console.log(`[editable_ppt] pptx ${Math.round(deck.bytes / 1024)}KB`
    + (book ? `, pdf ${Math.round(book.bytes / 1024)}KB` : '')
    + (docxPath ? `, docx -> ${docxPath}` : ''));
  return { deck, book, docxPath };
}


/**
 * The analysis stage.
 *
 * This used to be the body of an IPC handler: one call that scraped a listing,
 * drove a browser, uploaded mockups and waited five minutes, holding every bit
 * of its state in local variables. A stall had no exit and a restart had nothing
 * to resume from.
 *
 * As a task it is bounded by a deadline it cannot exceed, abortable, and its
 * outcome is a committed row. The checkpoints are coarse because the stage is
 * coarse — there is one long call to the gem in the middle of it — but they are
 * enough to say where a failed attempt got to.
 */
async function runAnalysisTask({ task, signal, checkpoint, progress }) {
  // A prior pause leaves abortRequested set. This is a new analysis, so clear
  // that leftover without disabling a pause the user sends once work starts.
  browser.beginWork?.();
  const listing = task.payload.listing;
  checkpoint({ phase: 'scraping' });
  progress(10, 'Reading the product listing…');
  const cacheKey = parseTptProductUrl(listing.productUrl)?.productId || randomUUID();
  const mockupDir = join(app.getPath('userData'), 'competitor-mockup-cache', cacheKey);
  mkdirSync(mockupDir, { recursive: true });
  progress(30, 'Asking the content gem to read the product…');
  const result = await browser.analyzeProductWithGpt({ ...listing, mockupDestDir: mockupDir });
  // The stage is abortable at every boundary, so a deadline or a pause stops it
  // here rather than after it has created a half-formed project.
  if (signal.aborted) throw signal.reason;
  checkpoint({ phase: 'analysed', conversationUrl: result.conversationUrl ?? null });
  progress(70, 'Reading the analysis…');
  let analysis;
  try {
    analysis = parseAnalysisResponse(result.rawText);
  } catch (error) {
    // #region agent log
    fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H93',location:'src/main.cjs:runAnalysisTask',message:'analysis parse failed after Gemini returned text',data:{textLength:String(result.rawText||'').length,preview:String(result.rawText||'').slice(0,220),tail:String(result.rawText||'').slice(-120),error:String(error?.message||error).slice(0,160)},timestamp:Date.now()})}).catch(()=>{});
    try { require('node:fs').appendFileSync('/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )/.cursor/debug-d45d8d.log', `${JSON.stringify({ sessionId: 'd45d8d', runId: 'post-fix', hypothesisId: 'H93', location: 'src/main.cjs:runAnalysisTask', message: 'analysis parse failed after Gemini returned text', data: { textLength: String(result.rawText || '').length, preview: String(result.rawText || '').slice(0, 220), error: String(error?.message || error).slice(0, 160) }, timestamp: Date.now() })}\n`); } catch {}
    // #endregion
    throw error;
  }
  // The analysis gem often omits productFormat. Defaulting to static sent editable
  // listings down the print pipeline, so the listing itself decides when it is silent.
  const detected = detectProductFormat(analysis, { ...listing, rawText: result.rawText });
  const scrapedFacts = result.mockups?.listingFacts || null;
  // #region agent log
  fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'pre-fix',hypothesisId:'H1',location:'src/main.cjs:runAnalysisTask',message:'analysis created project with detected format',data:{detected,analysisFormat:analysis?.productFormat||null,analysisTitle:analysis?.title||'',listingTitle:listing?.title||listing?.concept||scrapedFacts?.title||'',keyword:listing?.keyword||listing?.trendMetadata?.query||'',productUrl:String(listing?.productUrl||'').slice(0,120),scrapedGrade:scrapedFacts?.grade||null,scrapedPageCount:scrapedFacts?.pageCount||null},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  const format = FORMAT_INSTRUCTIONS[listing.format] ? listing.format : 'LETTER';
  const orientation = normalizeOrientation(listing.orientation);

  const projectId = randomUUID();
  const defaultBookName = analysis.title || `Book Project ${store.listProjects().length + 1}`;
  const root = join(app.getPath('documents'), APP_NAME);
  const outputDir = join(root, `${slugify(defaultBookName)}-${projectId.slice(0, 6)}`);
  mkdirSync(outputDir, { recursive: true });
  const competitorMockups = saveCompetitorMockups(result.mockups, outputDir);
  const project = {
    id: projectId,
    name: defaultBookName,
    theme: defaultBookName,
    niche: analysis.description || 'analyzed competitor product',
    format,
    orientation,
    style: 'Concept Only',
    activityCount: 0,
    status: 'draft',
    outputDir,
    conversationUrl: result.conversationUrl,
    highlights: analysis.keyHighlights || [],
    targetAge: analysis.targetAge || scrapedFacts?.grade || 'Pre-K to 2nd Grade',
    description: analysis.description || scrapedFacts?.description || '',
    competitorMockups,
    productFormat: detected.productFormat,
    tptListing: {
      marketplace: 'tpt',
      productUrl: listing.productUrl || scrapedFacts?.productUrl || '',
      title: scrapedFacts?.title || listing.title || listing.concept || defaultBookName,
      description: scrapedFacts?.description || analysis.description || '',
      grade: scrapedFacts?.grade || analysis.targetAge || '',
      pageCount: scrapedFacts?.pageCount || result.mockups?.scrapedPageCount || analysis.pageCount || null,
      mockupCount: competitorMockupPaths(result.mockups).length,
      scrapedAt: result.mockups?.scrapedAt || new Date().toISOString()
    }
  };

  store.createProject(project, []);
  persistModeForNewBook(projectId, detected.productFormat);
  store.setSetting('selectedProjectId', projectId);
  // #region agent log
  fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H91',location:'src/main.cjs:runAnalysisTask',message:'analysis project persisted',data:{projectId,productFormat:detected.productFormat,title:project.name||''},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  store.appendEvent({
    projectId,
    level: 'info',
    message: detected.productFormat === 'editable'
      ? `Editable (${detected.source}).`
      : detected.productFormat === 'maze'
        ? `Maze (${detected.source}).`
        : `Static (${detected.source}).`
  });
  checkpoint({ phase: 'project-created', projectId, conversationUrl: result.conversationUrl ?? null });
  progress(90, 'Saving the book concept…');
  store.updateProject(projectId, { competitorMockups });
  const mockupCount = competitorMockupPaths(competitorMockups).length;
  store.appendEvent({
    projectId,
    level: mockupCount ? 'success' : competitorMockups?.status === 'ok' ? 'success' : 'warn',
    message: mockupCount
      ? `Saved ${mockupCount} competitor listing mockup${mockupCount === 1 ? '' : 's'} for vision-based prompt generation.`
      : competitorMockups?.warning || 'Competitor listing mockups were not captured. Prompt generation will use the URL and text analysis only.'
  });
  await broadcastState();
  const finishedPayload = {
    project: store.getProject(projectId),
    analysis,
    // The dialog uses this to select the pipeline instead of asking the user.
    detectedFormat: detected,
    conversationUrl: result.conversationUrl,
    competitorMockups,
    promptReceipt: result.promptReceipt || browser.lastPromptReceipt || null
  };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('analysis:finished', finishedPayload);
  }
  // #region agent log
  fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H130',location:'src/main.cjs:runAnalysisTask',message:'analysis finished event sent to renderer',data:{projectId,productFormat:detected.productFormat,hasWindow:Boolean(mainWindow && !mainWindow.isDestroyed())},timestamp:Date.now()})}).catch(()=>{});
  try { require('node:fs').appendFileSync('/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )/.cursor/debug-d45d8d.log', `${JSON.stringify({ sessionId: 'd45d8d', runId: 'post-fix', hypothesisId: 'H130', location: 'src/main.cjs:runAnalysisTask', message: 'analysis finished event sent to renderer', data: { projectId, productFormat: detected.productFormat, hasWindow: Boolean(mainWindow && !mainWindow.isDestroyed()) }, timestamp: Date.now() })}\n`); } catch {}
  fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H91',location:'src/main.cjs:runAnalysisTask',message:'analysis broadcast finished; returning result',data:{projectId,productFormat:detected.productFormat},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  progress(100, "Analysis complete.");

  return finishedPayload;

}

/**
 * Adapt the pipeline's step runners into task handlers.
 *
 * A step runner is `async (projectId, onProgress)`. As a task it also gets an
 * abort signal and a checkpoint, so the queue can stop it at a deadline and a
 * retry knows what the last attempt achieved. The runner itself is unchanged —
 * wrapping rather than rewriting is what keeps the manual path and the automated
 * path from drifting apart.
 */
/** Which automated step maps to which durable task kind. Built after modules load. */
function stepToTaskKind(step) {
  return {
    interior: TASK_KIND.INTERIOR,
    interior_artwork: TASK_KIND.INTERIOR,
    interior_text: TASK_KIND.INTERIOR_TEXT,
    editable_ppt: TASK_KIND.EDITABLE_PPT,
    thumbnails: TASK_KIND.THUMBNAILS,
    preview: TASK_KIND.PREVIEW,
    export: TASK_KIND.EXPORT
  }[step];
}

function stageHandlers() {
  const map = {
    [TASK_KIND.INTERIOR]: 'interior',
    [TASK_KIND.INTERIOR_TEXT]: 'interior_text',
    [TASK_KIND.EDITABLE_PPT]: 'editable_ppt',
    [TASK_KIND.THUMBNAILS]: 'thumbnails',
    [TASK_KIND.PREVIEW]: 'preview',
    [TASK_KIND.EXPORT]: 'export'
  };
  const handlers = {};
  for (const [kind, defaultStep] of Object.entries(map)) {
    handlers[kind] = async ({ task, signal, checkpoint, progress }) => {
      // The kind picks the lane and the deadline; the step picks the runner. They
      // are not the same thing — interior and interior_artwork share a lane but
      // are different runners — so the step travels in the payload.
      const step = task.payload?.step || defaultStep;
      const runner = pipelineStepRunners?.[step];
      if (typeof runner !== 'function') {
        throw Object.assign(new Error(`No step runner registered for "${step}".`), { retryable: false });
      }
      const projectId = task.projectId || task.payload?.projectId;
      if (!projectId) throw Object.assign(new Error(`Task ${task.kind} has no project.`), { retryable: false });
      checkpoint({ step, phase: 'running', percent: 0 });
      const onProgress = (percent) => {
        const value = Math.max(0, Math.min(100, Number(percent) || 0));
        // Written, not just emitted: after a restart the stage can say how far it
        // got even though nobody was listening at the time.
        checkpoint({ step, phase: 'running', percent: value });
        progress(value, step);
      };
      const outcome = await runner(projectId, onProgress);
      if (signal.aborted) throw signal.reason;
      checkpoint({ step, phase: 'done', percent: 100 });
      return outcome ?? { step, projectId };
    };
  }
  return handlers;
}

/**
 * VERSA AGENT — the market-research stage.
 *
 * Reads the public trend and marketplace pages, ranks what it finds, and hands
 * the best candidate to the analysis stage as a URL plus the metadata the
 * listing states about itself. Everything after that is the pipeline that
 * already exists: analysis writes the concept, and its specs end up in the
 * compiled .docx that mockups, preview and SEO all read.
 *
 * It runs in the browser lane, so it can never scrape while a generation is
 * driving the managed Chrome instance.
 *
 * Public trend reads use a visible marketplace tab in the bundled Chromium,
 * not a hidden scratch window and not the Gemini tab.
 */
async function runTrendScanTask({ task, signal, checkpoint, progress }) {
  const seed = String(task.payload?.query || '').trim().slice(0, 120);
  const marketplace = normalizeTrendMarketplace(task.payload?.marketplace ?? task.payload?.marketplaces);
  const marketplaces = [marketplace];

  return browser.withVisibleMarketContext(async (context) => {
    const openPage = () => context.newPage();

    if (marketplace === 'tpt') {
      const queryLabel = seed || 'trending';
      progress(12, seed
        ? `Opening Teachers Pay Teachers for "${seed}"…`
        : 'Opening trending Teachers Pay Teachers books…');
      checkpoint({ phase: 'discovering', marketplace, query: queryLabel });
      const result = await scrapeSource({ source: 'tpt', query: seed, openPage, signal });
      const listings = Array.isArray(result.candidates) ? result.candidates : [];
      if (!listings.length) {
        throw Object.assign(
          new Error(seed
            ? `VERSA AGENT found no trendy educational books on Teachers Pay Teachers for "${seed}".`
            : 'VERSA AGENT found no trending educational books on Teachers Pay Teachers.'),
          { code: 'TREND_SCAN_EMPTY' }
        );
      }
      const excludeUrls = recentTrendPickUrls(store);
      const best = pickTrendListing(listings, { query: queryLabel, excludeUrls });
      if (!best) {
        throw Object.assign(
          new Error(seed
            ? `VERSA AGENT found no trendy educational books on Teachers Pay Teachers for "${seed}".`
            : 'VERSA AGENT found no trending educational books on Teachers Pay Teachers.'),
          { code: 'TREND_SCAN_EMPTY' }
        );
      }
      rememberTrendPick(store, best);
      const analysisInput = toAnalysisInput(best, { source: 'tpt', query: queryLabel });
      // #region agent log
      fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'pre-fix',hypothesisId:'H5',location:'src/main.cjs:runTrendScanTask',message:'versa agent handed listing to analysis',data:{query:queryLabel,title:best?.title||'',url:String(best?.url||'').slice(0,160),listingCount:listings.length},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      analysisInput.trendMetadata.opportunity = {
        keyword: queryLabel,
        score: best.score || 0,
        listings: listings.length,
        marketplaces: ['tpt']
      };
      const choice = {
        keyword: queryLabel,
        score: best.score || 0,
        candidate: best,
        evidence: {
          marketplaces: ['tpt'],
          listings: listings.length,
          medianPrice: null,
          topReviews: 0,
          problems: []
        },
        runnersUp: listings.slice(1, 4).map((item) => ({ keyword: item.title, score: item.score || 0 }))
      };
      store.appendEvent({
        level: 'success',
        message: `Found "${best.title}".`
      });
      checkpoint({ phase: 'handed-off', keyword: queryLabel, marketplace });
      progress(100, 'Ready for analysis.');
      await broadcastState();
      return {
        chosen: analysisInput,
        analysisInput,
        opportunity: choice,
        keywords: [{ keyword: queryLabel, score: best.score || 0, seenIn: listings.length, example: best.title }],
        marketplace,
        degradedDiscovery: false
      };
    }

    // Phase 1 — what is rising.
    progress(8, 'Reading the trending feed…');
    checkpoint({ phase: 'discovering', marketplace });
    const discovery = await discoverKeywords({ openPage, signal, seed });
    if (discovery.degraded) {
      store.appendEvent({
        level: 'warn',
        message: `Validating "${seed}".`
      });
    }
    store.appendEvent({
      level: 'info',
      message: `Validating ${discovery.keywords.length} keyword${discovery.keywords.length === 1 ? '' : 's'}.`
    });

    // Phase 2 — does it sell.
    const validations = [];
    for (let index = 0; index < discovery.keywords.length; index += 1) {
      if (signal.aborted) throw signal.reason;
      const { keyword, score } = discovery.keywords[index];
      progress(15 + Math.round((index / discovery.keywords.length) * 65), `Checking ${TREND_SOURCES[marketplace]?.label || marketplace} for "${keyword}"…`);
      const validation = await validateKeyword({ keyword, marketplaces, openPage, signal });
      validations.push({ ...validation, demandScore: score });
      // Committed per keyword, so an interrupted scan resumes with what it proved
      // rather than repeating the whole tour.
      checkpoint({
        phase: 'validating',
        marketplace,
        done: validations.map((v) => v.keyword),
        remaining: discovery.keywords.length - validations.length
      });
    }

    // Phase 3 — pick, and say why.
    progress(85, 'Weighing demand against competition…');
    const choice = chooseOpportunity(validations, { excludeUrls: recentTrendPickUrls(store) });
    if (!choice) {
      throw Object.assign(
        new Error('Nothing the agent found is selling in the selected marketplace, or every candidate was outside the allowed educational scope.'),
        { code: 'TREND_SCAN_EMPTY' }
      );
    }

    rememberTrendPick(store, choice.candidate);
    const analysisInput = toAnalysisInput(choice.candidate, { source: choice.candidate.source, query: choice.keyword });
    // The evidence travels with the handoff, so analysis is told what the market
    // looks like rather than just given a link.
    analysisInput.trendMetadata.opportunity = {
      keyword: choice.keyword,
      score: choice.score,
      ...choice.evidence
    };

    const evidence = choice.evidence;
    store.appendEvent({
      level: 'success',
      message: `Chose "${choice.keyword}".`
        + `${evidence.medianPrice ? `, median ${evidence.medianPrice}` : ''}`
        + `${evidence.topReviews ? `, leader has ${evidence.topReviews} reviews` : ''}. Ready for URL analysis.`
    });
    checkpoint({ phase: 'handed-off', keyword: choice.keyword, marketplace });
    progress(100, 'Ready for analysis.');
    await broadcastState();

    return {
      chosen: analysisInput,
      analysisInput,
      opportunity: choice,
      keywords: discovery.keywords,
      marketplace,
      degradedDiscovery: Boolean(discovery.degraded)
    };
  });
}

async function ensureMarketingGroundTruth(projectId) {
  const project = store.getProject(projectId);
  if (!project) throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });
  if (!project.stats?.total || project.stats.complete !== project.stats.total) {
    throw Object.assign(
      new Error('Finish pages first.'),
      { code: 'MARKETING_SOURCE_INCOMPLETE' }
    );
  }
  const docPath = await ensureSeoBookDocument(projectId);
  if (!docPath || !existsSync(docPath)) {
    throw Object.assign(
      new Error('The book document could not be compiled, so marketing assets cannot be written from it.'),
      { code: 'MARKETING_SOURCE_MISSING' }
    );
  }
  return docPath;
}

async function persistSeoListingDetails(project, seoText) {
  const text = String(seoText || '').trim();
  if (!project?.outputDir || !text) return null;
  const dir = join(project.outputDir, 'seo');
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, 'listing_details.txt');
  await atomicWrite(filePath, Buffer.from(`${text}\n`, 'utf8'));
  return filePath;
}

function reconcileCompletedPipelineSteps() {
  if (!store) return;
  const reopen = (projectId, step, reason) => {
    store.updateProjectStepStatus(projectId, step, 'pending');
    store.appendEvent({
      projectId,
      level: 'warn',
      message: `[Recovery] Step "${step}" was marked complete but its artifact contract is no longer valid. It will run again. ${reason}`
    });
  };
  for (const listed of store.listProjects()) {
    const project = store.getProject(listed.id) || listed;
    const projectId = project.id;
    const pagesReady = allInteriorPagesComplete(project);
    const pdf = getPdf(project);
    const printPdfsReady = String(project.productFormat || '').toLowerCase() === 'editable'
      || (hasValidPdfFile(pdf.productPath) && hasValidPdfFile(pdf.compressedPath));
    const artworkReady = pagesReady && printPdfsReady;
    if (artworkReady && project.stepInteriorStatus !== 'completed') {
      store.updateProjectStepStatus(projectId, 'interior_artwork', 'completed');
    } else if (project.stepInteriorStatus === 'completed' && !artworkReady) {
      reopen(projectId, 'interior_artwork', pagesReady
        ? 'Print PDFs are missing/invalid.'
        : 'Interior page files are missing/invalid.');
    }
    if (project.stepEditableGenerationStatus === 'completed') {
      try {
        verifyEditableOutput(project);
      } catch (error) {
        reopen(projectId, 'editable_generation', error.message || 'Editable output is stale.');
      }
    }
    if (project.stepThumbnailsStatus === 'completed' && countValidMockupPaths(project) < 4) {
      reopen(projectId, 'thumbnails', 'Four valid mockup files are required.');
    }
    if (project.stepPreviewStatus === 'completed' && !hasValidVideoFile(project)) {
      reopen(projectId, 'preview', 'Preview video is missing or invalid.');
    }
    if (project.stepExportStatus === 'completed') {
      try {
        verifyExportZip(project);
      } catch (error) {
        reopen(projectId, 'export', error.message || 'Final ZIP is missing or invalid.');
      }
    }
  }
}

function isPauseError(error) {
  return Boolean(error) && (error.code === 'QUEUE_PAUSED' || /waiting was paused/i.test(String(error.message || '')));
}

async function pauseAllWork(reason = 'Stopped. You paused this work.') {
  pendingNativeStart = null;
  editableAbortController?.abort();
  require('./maze-lab.cjs').abortAllMazeGeneration();
  const projectId = liveOperation?.projectId || queue?.status()?.activeProjectId || automation?.getStatus()?.currentProjectId || null;
  if (liveOperation) {
    setLiveOperation({
      ...liveOperation,
      message: 'Stopping.'
    });
  }
  try { queue.pause(); } catch {}
  try { automation?.pause(); } catch {}
  try { browser?.cancelWaits(); } catch {}
  if (projectId) store.appendEvent({ projectId, level: 'warn', message: reason });
  await broadcastState();
  return { paused: true, projectId };
}

async function runNativeEditableForProject(projectId, onProgress = () => {}, options = {}) {
  if (editableAbortController) throw Object.assign(new Error('Editable generation is already running.'), {code:'QUEUE_BUSY'});
  verifyOverview(store.getProject(projectId));
  ensureProjectOutputDirectory(projectId);
  editableAbortController = new AbortController();
  const signal = editableAbortController.signal;
  let activeNativeJobId = null;
  let lastNativePhase = null;
  const activity = info => {
    if (signal.aborted) return;
    activeNativeJobId = info.jobId || activeNativeJobId;
    const phase = ['complete','retry_wait','downloading','validating','generating'].includes(info.phase) ? info.phase : 'preparing';
    if (info.jobId && lastNativePhase !== `${info.jobId}:${phase}`) {
      lastNativePhase = `${info.jobId}:${phase}`;
      store.updateJob(info.jobId,{status:phase});
      broadcastState().catch(()=>{});
    }
    setLiveOperation({kind:'editable-generation',projectId,jobId:activeNativeJobId,percent:liveOperation?.percent || 0,message:info.message || `Page generation: ${info.phase}`});
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('queue:heartbeat',{...info,jobId:activeNativeJobId,projectId});
  };
  store.updateProjectStepStatus(projectId, 'editable_generation', 'processing');
  setLiveOperation({kind:'editable-generation',projectId,percent:0,message:'Generating…'});
  try {
    const result = await runEditableProject({store,projectId,signal,jobIds:options.jobIds,onActivity:activity,onProgress: percent => {
      setLiveOperation({kind:"editable-generation",projectId,jobId:activeNativeJobId,percent,message:"Generating…"});
      onProgress(percent);
      broadcastState().catch(() => {});
    }});
    if (signal.aborted) throw Object.assign(new Error('Editable generation cancelled.'), {code:'STEP_ABORTED'});
    if (result.partial) {
      store.updateProjectStepStatus(projectId, "editable_generation", "pending");
      return result;
    }
    if (signal.aborted) throw Object.assign(new Error("Editable generation cancelled."), {code:"STEP_ABORTED"});
    store.updateProjectStepStatus(projectId, 'editable_generation', 'completed');
    onProgress(100);
    return result;
  } catch (error) {
    store.updateProjectStepStatus(projectId, 'editable_generation', signal.aborted ? 'pending' : 'failed');
    throw error;
  } finally {
    editableAbortController = null;
    setLiveOperation(null);
    await broadcastState();
    const next=pendingNativeStart;
    pendingNativeStart=null;
    if (next) startNativeEditableInBackground(next.projectId,next.options);
  }
}

function startNativeEditableInBackground(projectId, options = {}) {
  if (editableAbortController) {
    if (liveOperation?.projectId !== projectId) throw Object.assign(new Error('Another book is generating.'),{code:'QUEUE_BUSY'});
    if (editableAbortController.signal.aborted || options.jobIds) {
      pendingNativeStart={projectId,options: pendingNativeStart && !pendingNativeStart.options.jobIds ? {} : {jobIds:[...new Set([...(pendingNativeStart?.options.jobIds || []),...(options.jobIds || [])])]}};
      if (!options.jobIds) pendingNativeStart.options={};
    }
    return {running:true,stopping:editableAbortController.signal.aborted};
  }
  verifyOverview(store.getProject(projectId));
  if (options.jobIds) for (const id of options.jobIds) store.resetJob(id);
  runNativeEditableForProject(projectId,()=>{},options).catch(error=>{
    if (!['STEP_ABORTED','QUEUE_PAUSED'].includes(error.code)) store.appendEvent({projectId,level:'error',message:error.message});
    broadcastState().catch(()=>{});
  });
  broadcastState().catch(()=>{});
  return {running:true,projectId};
}

async function openStudioById(studioId = 'planning') {
  const studio = findStudio(studioId) || findStudio('planning');
  assertIdle();
  if (studio.engine === 'gemini') requireGeminiForPlanning(`opening ${studio.name}`);
  else if (!isEngineConfirmed('chatgpt')) {
    throw Object.assign(
      new Error(`Connect ChatGPT before opening ${studio.name}. Gemini gems stay available after you verify Gemini.`),
      { code: 'AUTH_REQUIRED' }
    );
  }
  const previous = getActiveEngine();
  try {
    browser.setEngine(studio.engine);
    await browser.launch({ interactive: false, forceBrowser: true, headless: true });
    await browser.navigate(studio.url);
  } finally {
    if (typeof browser.setEngine === 'function') browser.setEngine(previous);
  }
  await broadcastState();
  return { ...(await browser.status()), studio };
}

async function generatePreviewVideoForProject(projectId, { onProgress = null, force = false } = {}) {
  requireGeminiForPreview('generating the preview video');
  const project = store.getProject(projectId);
  const listing = project?.tptListing;
  if (!project || !listing) {
    throw Object.assign(new Error('Create the listing draft first, then generate a preview from mockups or book pages.'), {
      code: 'TPT_LISTING_REQUIRED'
    });
  }
  const existingVideo = getVideo(project);
  if (!force && existingVideo.path && existsSync(existingVideo.path)) {
    onProgress?.(100);
    return store.getProject(projectId);
  }
  store.updateProject(projectId, {
    tptListing: applyVideoToListing(listing, {
      status: 'generating',
      error: null,
      ...(force ? { path: null } : {})
    })
  });
  await publishLiveOperation({
    kind: 'preview',
    label: 'Preview video',
    percent: 8,
    message: 'Starting the teacher preview video…',
    projectId
  });
  const previousEngine = getActiveEngine();
  // Veo reports no percentage, so progress is derived from elapsed time on an
  // asymptotic curve: it always advances, never reaches 100, and only the finished
  // video completes it. A bar that stalls at a number is worse than one that keeps
  // moving slowly, and claiming a percentage the model never gave us would be a lie.
  const onPreviewHeartbeat = (payload) => {
    if (payload?.phase !== 'preview_video') return;
    const elapsedMs = Number(payload.elapsedMs) || 0;
    const minutes = elapsedMs / 60_000;
    const percent = Math.min(96, Math.round(8 + 88 * (1 - Math.exp(-minutes / 4))));
    publishLiveOperation({
      kind: 'preview',
      label: 'Preview video',
      percent,
      elapsedMs,
      message: payload.generating
        ? 'Gemini is rendering the preview video…'
        : 'Waiting for the preview video…',
      projectId
    }).catch(() => {});
  };
  browser.on('heartbeat', onPreviewHeartbeat);
  try {
    browser.setEngine('gemini');
    // The document is required but not uploaded. Gemini's video model cannot read a
    // .docx, so the preview animates real interior pages instead — but compiling the
    // document is the completeness gate every marketing stage shares, and a book whose
    // pages are not all finished has no representative middle pages to show.
    await ensureMarketingGroundTruth(projectId);
    const { generateStitchedPreviewVideo } = require('./preview-video-engine.cjs');
    const generated = await generateStitchedPreviewVideo({
      browser,
      project,
      listing: { ...listing, videoPreviewPath: listing.videoPreviewPath },
      pdfPath: listing.productPdfPath,
      tempDir: join(app.getPath('temp'), `versa-preview-${projectId}`),
      onProgress
    });
    const outputPath = await fileManager.saveGeneratedPreviewVideo({
      buffer: generated.buffer,
      contentType: generated.contentType,
      outputDir: project.outputDir,
      fileName: 'preview_final.mp4'
    });
    store.updateProjectTransactionally(projectId, (c) => ({ tptListing: applyVideoToListing((c.tptListing || listing || {}), {
        path: outputPath,
        status: 'ready',
        error: null,
        conversationUrl: generated.conversationUrl
      }) }));
    store.appendEvent({
      projectId,
      level: 'success',
      message: 'Veo 3 teacher preview video saved for this listing.'
    });
    await broadcastState();
    onProgress?.(100);
    return store.getProject(projectId);
  } catch (error) {
    if (isPauseError(error)) {
      // Pausing used to throw without clearing the status set at the start of the run,
      // so the card kept reporting "Generating…" forever against nothing - a false
      // state the operator could not clear from the UI.
      store.updateProjectTransactionally(projectId, (c) => ({
        tptListing: applyVideoToListing((c.tptListing || listing || {}), { status: 'idle', error: null })
      }));
      store.appendEvent({ projectId, level: 'warn', message: 'Preview paused. Start again when you are ready.' });
      throw Object.assign(new Error('Stopped. You paused this work.'), { code: 'QUEUE_PAUSED' });
    }
    store.updateProjectTransactionally(projectId, (c) => ({ tptListing: applyVideoToListing((c.tptListing || listing || {}), {
        status: 'failed',
        error: error.message
      }) }));
    store.appendEvent({ projectId, level: 'error', message: `Preview video generation paused: ${error.message}` });
    await broadcastState();
    throw error;
  } finally {
    // The listener is per-run; leaving it attached would stack one per preview and keep
    // publishing progress for a step that already ended.
    browser.removeListener('heartbeat', onPreviewHeartbeat);
    browser.setEngine(previousEngine);
    finishLiveWork();
    // Last line of defence. However this run ended - return, throw, cancel - the status
    // must not still say generating, because nothing is generating any more.
    const settled = store.getProject(projectId);
    if (getVideo(settled).status === 'generating') {
      store.updateProjectTransactionally(projectId, (c) => ({
        tptListing: applyVideoToListing((c.tptListing || {}), { status: 'idle', error: null })
      }));
    }
    await broadcastState();
  }
}

function preferenceDefaults() {
  return {
    profile: {
      displayName: '',
      email: '',
      businessName: '',
      sellerName: '',
      website: '',
      supportEmail: ''
    },
    projectIdentity: {
      authorName: '',
      publisherName: '',
      copyrightHolder: '',
      copyrightYear: String(new Date().getFullYear()),
      projectNotes: ''
    },
    listingDefaults: {
      tags: [],
      subjects: [],
      grades: [],
      formats: [],
      taxCode: '',
      copyrightDeclaration: '',
      pricingMode: 'paid',
      suggestedPrice: '',
      multipleLicensePrice: '',
      publicationStatus: 'draft',
      thumbnailMode: 'manual'
    },
    workflow: {
      defaultFormat: 'A4',
      defaultOrientation: 'portrait',
      whenCompleteAction: 'nothing'
    },
    appearance: 'dark',
    notifications: {
      soundEnabled: true,
      soundVolume: 80,
      toastsEnabled: true,
      desktopEnabled: true
    },
    customization: normalizeCustomization({})
  };
}

function preferenceList(value, limit = 20) {
  const entries = Array.isArray(value) ? value : String(value ?? '').split(/[\n,]/);
  return [...new Set(entries.map((entry) => cleanText(entry)).filter(Boolean))].slice(0, limit);
}

function normalizePreferences(preferences = {}) {
  const defaults = preferenceDefaults();
  const profile = preferences.profile ?? {};
  const projectIdentity = preferences.projectIdentity ?? {};
  const listingDefaults = preferences.listingDefaults ?? {};
  const workflow = preferences.workflow ?? {};
  const rawTags = preferenceList(listingDefaults.tags, 6);
  const rawSubjects = preferenceList(listingDefaults.subjects, 3);
  const trimValue = (value, max = 240) => cleanText(value).slice(0, max);
  const emailValue = (value) => trimValue(value, 254);
  return {
    profile: {
      displayName: trimValue(profile.displayName, 100),
      email: emailValue(profile.email),
      sellerName: trimValue(profile.sellerName, 140),
      businessName: trimValue(profile.businessName || profile.sellerName, 140),
      website: trimValue(profile.website, 300),
      supportEmail: emailValue(profile.supportEmail)
    },
    projectIdentity: {
      authorName: trimValue(projectIdentity.authorName, 140),
      publisherName: trimValue(projectIdentity.publisherName, 140),
      copyrightHolder: trimValue(projectIdentity.copyrightHolder, 180),
      copyrightYear: trimValue(projectIdentity.copyrightYear, 4) || defaults.projectIdentity.copyrightYear,
      projectNotes: String(projectIdentity.projectNotes ?? '').trim().slice(0, 4_000)
    },
    listingDefaults: {
      tags: rawTags,
      subjects: rawSubjects,
      grades: preferenceList(listingDefaults.grades, 4),
      formats: preferenceList(listingDefaults.formats, 3),
      taxCode: trimValue(listingDefaults.taxCode, 180),
      copyrightDeclaration: ['original', 'licensed'].includes(listingDefaults.copyrightDeclaration)
        ? listingDefaults.copyrightDeclaration
        : '',
      pricingMode: listingDefaults.pricingMode === 'free' ? 'free' : 'paid',
      suggestedPrice: trimValue(listingDefaults.suggestedPrice, 20),
      multipleLicensePrice: trimValue(listingDefaults.multipleLicensePrice, 20),
      publicationStatus: listingDefaults.publicationStatus === 'active' ? 'active' : 'draft',
      thumbnailMode: ['auto', 'manual', 'later'].includes(listingDefaults.thumbnailMode)
        ? listingDefaults.thumbnailMode
        : 'manual'
    },
    workflow: {
      defaultFormat: ['A4', 'LETTER', 'SQUARE'].includes(workflow.defaultFormat)
        ? workflow.defaultFormat
        : defaults.workflow.defaultFormat,
      defaultOrientation: normalizeOrientation(workflow.defaultOrientation),
      whenCompleteAction: ['nothing', 'sleep', 'shutdown'].includes(workflow.whenCompleteAction)
        ? workflow.whenCompleteAction
        : defaults.workflow.whenCompleteAction
    },
    appearance: normalizeAppearance(preferences.appearance ?? defaults.appearance),
    notifications: {
      soundEnabled: preferences.notifications?.soundEnabled !== false,
      soundVolume: Number.isFinite(Number(preferences.notifications?.soundVolume))
        ? Math.min(100, Math.max(0, Number(preferences.notifications.soundVolume)))
        : defaults.notifications.soundVolume,
      toastsEnabled: preferences.notifications?.toastsEnabled !== false,
      desktopEnabled: preferences.notifications?.desktopEnabled !== false
    },
    customization: normalizeCustomization(preferences.customization)
  };
}

function appearancePreference() {
  try {
    return normalizeAppearance(getPreferences().appearance);
  } catch {
    return 'light';
  }
}

function appearanceState() {
  const preference = appearancePreference();
  const resolved = resolveAppearance(preference, Boolean(nativeTheme.shouldUseDarkColors));
  return { preference, resolved };
}

function applyNativeAppearance() {
  const preference = appearancePreference();
  nativeTheme.themeSource = preference === 'system' ? 'system' : preference;
  const resolved = resolveAppearance(preference, Boolean(nativeTheme.shouldUseDarkColors));
  const color = windowBackground(resolved);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(color);
  }
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.setBackgroundColor(splashBackground(resolved));
  }
  return { preference, resolved };
}

function getPreferences() {
  const saved = store?.getSetting('userPreferences', {}) ?? {};
  const legacyWhenCompleteAction = store?.getSetting('whenCompleteAction', null);
  const normalized = normalizePreferences(saved);
  if (['nothing', 'sleep', 'shutdown'].includes(legacyWhenCompleteAction)) {
    normalized.workflow.whenCompleteAction = legacyWhenCompleteAction;
  }
  return normalized;
}

function mergeUniqueValues(preferred, generated, limit) {
  return [...new Set([...(preferred ?? []), ...(generated ?? [])].map((value) => cleanText(value)).filter(Boolean))].slice(0, limit);
}

function tptListingReviewApproved(listing) {
  const m = getMarketplace({ tptListing: listing });
  return Boolean(m.review.approvedAt || listing?.reviewedAt || listing?.uploadStartedAt);
}

function invalidateTptListingReview(listing, changes = {}) {
  return {
    ...listing,
    ...changes,
    reviewApprovedAt: null,
    reviewedAt: null,
    uploadStartedAt: null,
    uploadError: null,
    uploadMessage: null,
    uploadStage: null
  };
}

function saveCompetitorMockups(mockups, outputDir) {
  try {
    return persistCompetitorMockups(mockups, outputDir, copyFileSync);
  } catch {
    return mockups && typeof mockups === 'object' ? mockups : null;
  }
}

function competitorMockupAttachments(project, include = true) {
  if (!include) return [];
  return competitorMockupPaths(project?.competitorMockups);
}

function executeSystemAction(actionType) {
  const platform = process.platform;
  let command = '';

  if (actionType === 'shutdown') {
    if (platform === 'win32') {
      command = 'shutdown /s /f /t 0';
    } else if (platform === 'darwin') {
      command = "osascript -e 'tell app \"System Events\" to shut down'";
    } else {
      command = 'shutdown -h now';
    }
  } else if (actionType === 'sleep') {
    if (platform === 'win32') {
      command = 'rundll32.exe powrprof.dll,SetSuspendState 0,1,0';
    } else if (platform === 'darwin') {
      command = 'pmset sleepnow';
    } else {
      command = 'systemctl suspend';
    }
  }

  if (command) {
    exec(command, (error) => {
      if (error) {
        console.error(`Failed to execute system action ${actionType}:`, error);
      }
    });
  }
}


protocol.registerSchemesAsPrivileged([{
  scheme: 'tpt-image',
  privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true, corsEnabled: true, stream: true }
}]);

app.setName(APP_NAME);

function databaseProjectCount(databasePath) {
  if (!existsSync(databasePath)) return 0;
  let database = null;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    return Number(database.prepare('SELECT count(*) AS count FROM projects').get()?.count ?? 0);
  } catch {
    return 0;
  } finally {
    database?.close();
  }
}

if (process.env.TPT_TEST_USER_DATA) {
  app.setPath('userData', process.env.TPT_TEST_USER_DATA);
} else {
  const currentUserData = app.getPath('userData');
  const currentDatabase = join(currentUserData, 'tpt-books.sqlite');
  const legacyUserData = LEGACY_USER_DATA_NAMES
    .map((name) => join(app.getPath('appData'), name))
    .find((directory) => directory !== currentUserData && databaseProjectCount(join(directory, 'tpt-books.sqlite')) > 0);
  if (legacyUserData && databaseProjectCount(currentDatabase) === 0) {
    // Keep existing projects and the managed browser session available after the public app rename.
    app.setPath('userData', legacyUserData);
  }
}

const singleInstanceAcquired = app.requestSingleInstanceLock();
agentLog('main.cjs:lock', 'single-instance', { acquired: singleInstanceAcquired }, 'H1');

if (!singleInstanceAcquired) {
  try { console.error('[versa] already running; this npm start will exit.'); } catch {}
  app.quit();
}

function workAreaFor(bounds) {
  try {
    return screen.getDisplayMatching(bounds || { x: 0, y: 0, width: 1, height: 1 }).workArea;
  } catch {
    try { return screen.getPrimaryDisplay().workArea; } catch { return { x: 0, y: 0, width: 1480, height: 940 }; }
  }
}

function windowCreateBounds() {
  const work = workAreaFor({ x: 0, y: 0, width: 1, height: 1 });
  const width = Math.min(1480, Math.max(1120, work.width));
  const height = Math.min(940, Math.max(720, work.height));
  return {
    x: work.x + Math.max(0, Math.floor((work.width - width) / 2)),
    y: work.y + Math.max(0, Math.floor((work.height - height) / 2)),
    width,
    height
  };
}

function fitWindowToWorkArea(win) {
  const bounds = win.getBounds();
  const work = workAreaFor(bounds);
  const width = Math.min(bounds.width, work.width);
  const height = Math.min(bounds.height, work.height);
  let x = bounds.x;
  let y = bounds.y;
  if (x < work.x || x + width > work.x + work.width) {
    x = work.x + Math.max(0, Math.floor((work.width - width) / 2));
  }
  if (y < work.y || y + height > work.y + work.height) {
    y = work.y + Math.max(0, Math.floor((work.height - height) / 2));
  }
  if (x !== bounds.x || y !== bounds.y || width !== bounds.width || height !== bounds.height) {
    win.setBounds({ x, y, width, height });
  }
}

function presentMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  fitWindowToWorkArea(mainWindow);
  mainWindow.show();
  mainWindow.focus();
  agentLog('main.cjs:present', 'present-main-window', { visible: mainWindow.isVisible(), bounds: mainWindow.getBounds() }, 'H5');
  if (typeof mainWindow.moveTop === 'function') {
    try { mainWindow.moveTop(); } catch {}
  }
  if (process.platform === 'darwin') {
    app.dock?.show();
    app.focus({ steal: true });
  }
  return true;
}

app.on('second-instance', () => {
  if (!presentMainWindow() && store) createWindow();
});

function nativeWindowIcon() {
  // On macOS, BrowserWindow `icon` and dock.setIcon(PNG) skip the system squircle
  // mask and show a sharp square in the Dock. Leave the bundled ICNS alone.
  if (process.platform === 'darwin') return {};
  return { icon: join(__dirname, '..', 'assets', 'icon.png') };
}

function createSplashWindow() {
  if (process.env.TPT_TEST_USER_DATA && !process.env.TPT_TEST_SHOW_SPLASH) return Promise.resolve();
  splashShownAt = Date.now();
  splashWindow = new BrowserWindow({
    width: 560,
    height: 430,
    frame: false,
    resizable: false,
    movable: true,
    center: true,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: splashBackground(appearanceState().resolved),
    ...nativeWindowIcon(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  splashWindow.loadFile(join(__dirname, '..', 'renderer', 'splash.html'));
  const showSplash = () => {
    if (splashWindow && !splashWindow.isDestroyed() && !splashWindow.isVisible()) splashWindow.show();
  };
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      showSplash();
      resolve();
    };
    splashWindow.once('ready-to-show', done);
    splashWindow.webContents.once('did-fail-load', (_event, code, desc) => {
      bootLog('splash did-fail-load', `${code} ${desc}`);
      done();
    });
    splashWindow.webContents.once('did-finish-load', done);
    splashWindow.on('closed', () => {
      splashWindow = null;
    });
  });
}

function revealMainWindow() {
  const elapsed = Date.now() - splashShownAt;
  const minimumDuration = process.env.TPT_TEST_SHOW_SPLASH ? 5000 : SPLASH_MIN_DURATION_MS;
  const delay = splashWindow ? Math.max(0, minimumDuration - elapsed) : 0;
  setTimeout(() => {
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
    if (mainWindow && !mainWindow.isDestroyed()) {
      presentMainWindow();
    }
  }, delay);
}

function createWindow() {
  agentLog('main.cjs:createWindow', 'create-window', { hadWindow: Boolean(mainWindow && !mainWindow.isDestroyed()) }, 'H5');
  const createBounds = windowCreateBounds();
  mainWindow = new BrowserWindow({
    x: createBounds.x,
    y: createBounds.y,
    width: createBounds.width,
    height: createBounds.height,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: windowBackground(appearanceState().resolved),
    title: APP_NAME,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 20 },
    show: false,
    ...nativeWindowIcon(),
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.loadFile(join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    revealMainWindow();
  });
  mainWindow.webContents.once('did-fail-load', (_event, code, desc, url) => {
    bootLog('main did-fail-load', `${code} ${desc} ${url}`);
    revealMainWindow();
  });
  mainWindow.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) revealMainWindow();
    }, 50);
  });
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      bootLog('main show fallback');
      revealMainWindow();
    }
  }, 2500);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) event.preventDefault();
  });
}

function getMetaConfig() {
  return {
    ollamaUrl: store?.getSetting('metaOllamaUrl', 'http://127.0.0.1:11434'),
    comfyUrl: store?.getSetting('metaComfyUrl', 'http://127.0.0.1:8188'),
    ollamaModel: store?.getSetting('metaOllamaModel', ''),
    comfyWorkflow: store?.getSetting('metaComfyWorkflow', null)
  };
}

async function probeMetaConnection() {
  const controller = new MetaApiController({ getConfig: getMetaConfig });
  const probe = await controller.probe();
  store.setSetting('metaLoginConfirmed', Boolean(probe.ok));
  store.setSetting('metaAccountProfile', {
    name: 'Meta AI (Local)',
    email: '',
    label: probe.message,
    sourceBrowser: 'Local APIs',
    sourceProfile: probe.ollama?.model || 'Ollama + ComfyUI',
    verifiedAt: new Date().toISOString()
  });
  return probe;
}

function prewarmBackgroundBrowser() {
  if (process.env.TPT_TEST_USER_DATA || !isEngineConfirmed()) return;
  applyActiveEngineToBrowser();
  if (!isBrowserEngine(getActiveEngine())) return;
  setTimeout(() => {
    if (quitting || queue.running) return;
    browser.launch({ headless: true }).catch(() => {
      // Queue start reports actionable launch or authentication failures to the user.
    });
  }, 500);
}

let cachedBrowserStatus = {connected:false};
let browserStatusReading = false;
let browserStatusReadAt = 0;
function readBrowserStatus() {
  if (!browserStatusReading && Date.now()-browserStatusReadAt > 2000) {
    browserStatusReading=true;
    browserStatusReadAt=Date.now();
    runOperation(()=>browser.status(),{timeoutMs:1500,phase:'browser status'})
      .then(status=>{cachedBrowserStatus=status;})
      .catch(()=>{cachedBrowserStatus={...cachedBrowserStatus,unresponsive:true};})
      .finally(()=>{browserStatusReading=false;});
  }
  return cachedBrowserStatus;
}

// Runs the page queue for one project and resolves once every page is complete.
// Shared by the static interior step and the editable artwork step.
function runQueueToCompletion(projectId, onProgress) {
  queue.start(projectId);
  return new Promise((resolve, reject) => {
    const reportQueueProgress = () => {
      const p = store.getProject(projectId);
      const pct = p?.stats?.total ? Math.round((p.stats.complete / p.stats.total) * 100) : 0;
      onProgress(Math.min(95, pct));
      return p;
    };
    const cleanup = () => {
      queue.removeListener('changed', checkDone);
      queue.removeListener('heartbeat', keepAlive);
    };
    const keepAlive = () => {
      if (queue.status()?.activeProjectId === projectId) reportQueueProgress();
    };
    const checkDone = async () => {
      const p = reportQueueProgress();
      if (p?.stats?.complete === p?.stats?.total && p?.stats?.total > 0) {
        cleanup();
        resolve();
      } else if (!queue.running) {
        if (automation?.getStatus()?.paused) return;
        cleanup();
        reject(Object.assign(new Error('Queue stopped before all pages completed.'), { code: 'QUEUE_STOPPED' }));
      }
    };
    queue.on('changed', checkDone);
    queue.on('heartbeat', keepAlive);
    checkDone().catch(reject);
  });
}

// Stage 1 sends the refusal-proof artwork wrapper, so pages come back as themed
// backgrounds with blank frames and no typography baked into the pixels.
// Recover the page's own brief from a prompt that may already carry the wrapper, so
// re-running a page never nests the wrapper inside itself.
function artworkBrief(job) {
  const current = String(job.imagePrompt || '').trim();
  if (current.startsWith(ARTWORK_PROMPT)) {
    const match = current.match(/PAGE TOPIC & THEME:\s*\n\s*\d+[AT]?:\s*([\s\S]*)$/);
    return (match ? match[1] : '').trim() || String(job.prompt || '').trim();
  }
  return current || String(job.prompt || '').trim();
}

function attachTextLabObserver(projectId, pages) {
  const observer = createTextLabObserver();
  let beat = 0;
  observer.on('heartbeat', (snap) => {
    setLiveOperation({
      kind: 'editable-text',
      label: 'Text Lab',
      projectId,
      jobId: snap.jobId,
      percent: snap.percent,
      message: snap.message,
      remainingMs: snap.remainingMs,
      phase: snap.phase
    });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('text-lab:heartbeat', snap);
    }
  });
  observer.start({ projectId, pages });
  return observer;
}

function textLabPageActivity(observer) {
  return (event) => {
    if (!event) return;
    if (event.state === 'start') observer.pageBegin(event);
    else observer.pageEnd(event);
  };
}

function restoreDefaultArtworkPrompts(projectId, jobIds = null) {
  const project = store.getProject(projectId);
  if (!project || project.productFormat !== 'editable') return;
  const wanted = jobIds ? new Set(jobIds) : null;
  for (const job of project.jobs || []) {
    if (wanted ? !wanted.has(job.id) : job.status === 'complete') continue;
    // Interior Artwork draws the same page the static Interior section draws, using the
    // prompt the prompt builder wrote. It used to be wrapped in an instruction demanding
    // text-free artwork with empty frames, because the old pipeline needed somewhere to
    // put text it generated separately. That is no longer true: Interior Text now reads
    // the words off the finished page, erases them and redraws them as live text, so the
    // artwork should arrive complete, exactly as the static engine produces it.
    //
    // Prompts stored by the previous behaviour are unwrapped back to their brief here,
    // so existing books recover the default without needing to be recreated.
    const current = String(job.imagePrompt || '').trim();
    if (!current.startsWith(ARTWORK_PROMPT)) continue;
    const restored = artworkBrief(job);
    // Only the prompt is written. conversationUrl and baselineJson belong to the queue:
    // the baseline is how it recognises the newly generated image, so clearing them left
    // it submitting prompts and then waiting on state it no longer had.
    if (restored && restored !== current) store.updateJob(job.id, { imagePrompt: restored });
  }
}

// Derived, read-only: what the editable PowerPoint currently contains.
function enrichProjectWithEditableBuild(project) {
  if (!project || project.productFormat !== 'editable') return project;
  const meta = project.editableOutputJson;
  const fresh = Boolean(meta) && (() => { try { verifyEditableOutput(project); return true; } catch { return false; } })();
  const metaSlides = (meta?.pages || [])
    .map((page) => ({
      jobId: page.jobId,
      pageNumber: page.pageNumber ?? project.jobs?.find((job) => job.id === page.jobId)?.pageNumber ?? null,
      textBoxes: Number(page.textBoxes) || 0
    }))
    .sort((a, b) => (a.pageNumber || 0) - (b.pageNumber || 0));
  let compiledPages = [];
  try { compiledPages = listEditablePages(project); } catch { compiledPages = []; }
  const textByPage = new Map();
  try {
    for (const entry of collectPageVision(store, project)) {
      textByPage.set(entry.job.pageNumber, Number(entry.vision?.counts?.text) || 0);
    }
  } catch { /* vision cache is optional here */ }
  const slides = compiledPages.length
    ? compiledPages.map((file) => {
        const pageNumber = Number(String(file).match(/page_(\d+)\.pdf$/i)?.[1] || 0);
        const match = metaSlides.find((slide) => slide.pageNumber === pageNumber);
        const job = (project.jobs || []).find((item) => item.pageNumber === pageNumber);
        return {
          jobId: match?.jobId || job?.id || null,
          pageNumber,
          textBoxes: match?.textBoxes || textByPage.get(pageNumber) || 0,
        };
      })
    : metaSlides;
  const deckPath = meta?.pptxPath || (project.outputDir ? editableDeckPath(project) : null);
  const deckReady = Boolean(deckPath && existsSync(deckPath));
  return {
    ...project,
    editableBuild: {
      built: compiledPages.length > 0 && (fresh || deckReady),
      stale: Boolean(meta) && !fresh,
      pptxPath: deckReady ? deckPath : (meta?.pptxPath || null),
      slides,
      totalTextBoxes: slides.reduce((sum, slide) => sum + slide.textBoxes, 0)
    }
  };
}

// Derived, read-only: how many editable pages already have Stage 2 text written.
function enrichProjectWithEditableText(project) {
  if (!project || project.productFormat !== 'editable') return project;
  const jobs = Array.isArray(project.jobs) ? project.jobs : [];
  // What the local pipeline actually produced, read from disk and from the cached
  // layer models. The dashboard needs both: the per-page vision counts it displays,
  // and whether a compiled editable page exists yet, which is what unlocks export.
  let compiledPages = [];
  try { compiledPages = listEditablePages(project); } catch { compiledPages = []; }
  const visionByJob = new Map();
  try {
    for (const entry of collectPageVision(store, project)) {
      visionByJob.set(entry.job.id, entry.vision);
    }
  } catch { /* no vision cached yet */ }

  const { isTextFreeProject, readStoredManifest } = require('./text-free-pipeline.cjs');
  const textFree = isTextFreeProject(store, project);
  const pages = jobs
    .map((job) => {
      let text = null;
      try { text = readCachedPageText(store, project, job); } catch {}
      const vision = visionByJob.get(job.id) || null;
      const manifest = textFree ? readStoredManifest(store, project, job) : null;
      return {
        jobId: job.id,
        pageNumber: job.pageNumber,
        artworkReady: job.status === 'complete',
        written: Boolean(text) || Boolean(vision) || Boolean(manifest),
        read: Boolean(vision) || Boolean(manifest),
        zoneCount: manifest?.zones?.length || 0,
        built: compiledPages.some((file) => Number(String(file).match(/page_(\d+)\.pdf$/i)?.[1] || 0) === job.pageNumber) || Boolean(manifest),
        flat: Boolean(vision?.flat),
        layers: vision?.counts?.layers || 0,
        textRuns: vision?.counts?.text || 0,
        orphans: vision?.counts?.orphans || 0,
        title: text?.title || '',
        instruction: text?.instruction || '',
        sections: text?.sections?.length || 0,
        footer: text?.footer || ''
      };
    })
    .sort((a, b) => (a.pageNumber || 0) - (b.pageNumber || 0));
  return {
    ...project,
    editableText: {
      ready: pages.filter((page) => page.written).length,
      total: pages.length,
      read: pages.filter((page) => page.read).length,
      pagesBuilt: compiledPages.length,
      pages
    }
  };
}

const enrichCache = new Map();
let visionStatusCache = { at: 0, value: null };
let buildStateLogTick = 0;

function projectEnrichKey(project) {
  if (!project) return '';
  const jobs = (project.jobs || []).map((job) => `${job.id}:${job.status}:${job.outputPath || ''}`).join(',');
  const listing = project.tptListing || {};
  let compiled = 0;
  let visionPages = 0;
  try { compiled = listEditablePages(project).length; } catch { compiled = 0; }
  try { visionPages = collectPageVision(store, project).length; } catch { visionPages = 0; }
  return [
    project.id,
    project.productFormat || '',
    project.editableOutputJson ? 1 : 0,
    listing.videoPreviewPath || '',
    (listing.thumbnailPaths || []).join(','),
    jobs,
    `pdfs:${compiled}`,
    `vision:${visionPages}`,
    `mode:${store.getSetting?.(`generationMode:${project.id}`, 'fixed')}`
  ].join('|');
}

function cachedEnrichProject(project) {
  if (!project) return project;
  const key = projectEnrichKey(project);
  const hit = enrichCache.get(project.id);
  if (hit && hit.key === key) return hit.value;
  const enrichStarted = Date.now();
  const value = enrichProjectWithEditableBuild(enrichProjectWithEditableText(enrichProjectWithSeo(enrichProjectWithVideo(enrichProjectWithMockups(project)))));
  enrichCache.set(project.id, { key, value });
  return value;
}

async function cachedVisionStatus() {
  if (visionStatusCache.value && (Date.now() - visionStatusCache.at) < 15_000) return visionStatusCache.value;
  let vision = { ok: false, ready: false, code: 'VISION_UNKNOWN', error: null };
  try {
    vision = await visionBridge.status();
  } catch (error) {
    vision = { ok: false, ready: false, code: error.code || 'VISION_UNAVAILABLE', error: error.message };
  }
  visionStatusCache = { at: Date.now(), value: vision };
  return vision;
}

function attachGenerationMode(project) {
  if (!project) return project;
  const { resolveStoredGenerationMode } = require('./editable-mode.cjs');
  const { isRebuildPipelineEnabled } = require('./rebuild-page-record.cjs');
  return attachMazeProject({
    ...project,
    generationMode: resolveStoredGenerationMode(store, project),
    rebuildPipeline: isRebuildPipelineEnabled(store, project),
  });
}

function persistModeForNewBook(projectId, productFormat) {
  const { persistGenerationMode } = require('./editable-mode.cjs');
  persistGenerationMode(store, projectId, 'fixed');
  if (productFormat === 'maze') {
    require('./maze-service.cjs').ensureMazeProject(store, projectId);
  }
}

function attachMazeProject(project) {
  if (!project || project.productFormat !== 'maze') return project;
  const { getMazeProject } = require('./maze-service.cjs');
  const { getMazeLabState } = require('./maze-lab.cjs');
  return {
    ...project,
    mazeProject: getMazeProject(store, project.id),
    mazeLab: getMazeLabState(store, project.id)
  };
}

async function buildState() {
  const buildStarted = Date.now();
  const dashboard = store.getDashboardState();
  const whenCompleteAction = store.getSetting('whenCompleteAction', 'nothing');
  const aiEngine = getActiveEngine();
  const chatgptConfirmed = Boolean(store.getSetting('chatgptLoginConfirmed', false));
  const geminiConfirmed = Boolean(store.getSetting('geminiLoginConfirmed', false));
  const metaConfirmed = Boolean(store.getSetting('metaLoginConfirmed', false));
  const loginRequired = !isEngineConfirmed(aiEngine);
  const detectedChatGptProfile = store.getSetting('chatgptAccountProfile', null);
  const selectedChatGptProfile = store.getSetting('chatgptSelectedProfile', null);
  const detectedGeminiProfile = store.getSetting('geminiAccountProfile', null);
  const detectedMetaProfile = store.getSetting('metaAccountProfile', null);
  // Only the open book needs derived mockups/text. List rows already carry stats.
  const activeProject = attachGenerationMode(cachedEnrichProject(dashboard.activeProject));
  const projects = (dashboard.projects || []).map((project) => attachGenerationMode(
    activeProject && project.id === activeProject.id ? activeProject : project
  ));
  // What the queue actually holds, read from the table rather than from whatever
  // progress events the window happened to be open for. After a restart this is
  // still the truth; live events are not.
  const tasks = pipelineRunner && store.tasks
    ? {
        runner: pipelineRunner.status(),
        byProject: Object.fromEntries(
          projects.map((project) => [project.id, projectTaskState(store, project.id)])
        )
      }
    : null;
  const vision = await cachedVisionStatus();
  return {
    vision,
    tasks,
    ...dashboard,
    projects,
    activeProject,
    queue: queue.status(),
    browser: readBrowserStatus(),
    settings: {
      ...getPreferences(),
      customizationDefaults: customizationDefaults()
    },
    integrations: {
      aiEngine,
      chatgpt: {
        connected: chatgptConfirmed,
        active: aiEngine === 'chatgpt',
        profile: detectedChatGptProfile,
        selectedProfile: selectedChatGptProfile
      },
      gemini: {
        connected: geminiConfirmed,
        active: aiEngine === 'gemini',
        profile: detectedGeminiProfile,
        selectedProfile: selectedChatGptProfile
      },
      meta: {
        connected: metaConfirmed,
        active: aiEngine === 'meta',
        profile: detectedMetaProfile
      },
      customGpt: {
        name: CONTENT_GEM_NAME,
        url: getJobStartUrl({ kind: 'analysis' }, 'gemini'),
        connected: geminiConfirmed,
        usesChatGptSession: false,
        usesGeminiSession: true,
        usesMetaSession: false
      },
      mockups: {
        name: aiEngine === 'chatgpt' ? 'TPT Winner Mockups Custom GPT' : MOCKUPS_GEM_NAME,
        url: getJobStartUrl({ kind: 'thumbnail' }, aiEngine === 'chatgpt' ? 'chatgpt' : 'gemini')
      },
      seo: {
        name: 'SEO / Listing Gem',
        url: getJobStartUrl({ kind: 'listing' }, 'gemini')
      },
      preview: {
        name: PREVIEW_GEM_NAME,
        url: getJobStartUrl({ kind: 'preview' }, 'gemini')
      },
      studios: {
        gems: listGeminiStudios().map((studio) => ({ ...studio, connected: geminiConfirmed })),
        gpts: listChatGptStudios().map((studio) => ({ ...studio, connected: chatgptConfirmed }))
      }
    },
    browserSupervisor: (() => {
      const snap = browser?.supervisorSnapshot?.() || null;
      if (!snap) return null;
      const mazePages = activeProject?.mazeProject?.pages || [];
      const jobs = activeProject?.jobs || [];
      if (mazePages.length) {
        return {
          ...snap,
          pagesCompleted: mazePages.filter((page) => page.generationStatus === 'ready').length,
          pagesQueued: mazePages.filter((page) => page.generationStatus !== 'ready').length,
          pagesTotal: mazePages.length
        };
      }
      if (jobs.length) {
        return {
          ...snap,
          pagesCompleted: jobs.filter((job) => job.status === 'complete').length,
          pagesQueued: jobs.filter((job) => job.status !== 'complete').length,
          pagesTotal: jobs.length
        };
      }
      return snap;
    })(),
    profileRotation: browser ? browser.getProfileRotation() : null,
    bundleUpload: {
      active: bundleUploadActive,
      currentProjectId: bundleUploadCurrentId,
      queue: bundleUploadQueue
    },
    automation: automation ? automation.getStatus() : {
      active: false, paused: false, currentProjectId: null, currentStep: null,
      currentBookIndex: 0, totalBooks: 0, stepRetryCount: 0, awaitingAsk: false
    },
    automationSettings: store ? store.getAutomationSettings() : {},
    liveOperation,
    workBusy: {
      queue: Boolean(queue?.running),
      automation: Boolean(automation?.getStatus()?.active && !automation?.getStatus()?.paused),
      liveOperation: Boolean(liveOperation),
      comfyRecovering: Boolean(liveOperation?.recovering || comfy.isRecovering?.()),
      tptListing: Boolean(tptListingAutomationActive),
      bundle: Boolean(bundleUploadActive),
      characters: Boolean(storybookAssetGenerationActive),
      stopping: Boolean(browser?.isAborting?.())
    },
    app: {
      version: app.getVersion(),
      platform: process.platform,
      loginRequired,
      appearance: appearanceState(),
      whenCompleteAction,
      systemAction: systemActionPayload,
      update: updateManager?.getState() ?? {
        status: 'disabled',
        currentVersion: app.getVersion(),
        availableVersion: null,
        percent: null,
        message: null,
        checkedAt: null
      }
    }
  };
}

let broadcastTimer = null;
let broadcastWaiters = [];
let lastBrowserStatusKey = '';

function broadcastState() {
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve();
  return new Promise((resolve) => {
    broadcastWaiters.push(resolve);
    if (broadcastTimer) return;
    broadcastTimer = setTimeout(async () => {
      broadcastTimer = null;
      const waiters = broadcastWaiters;
      broadcastWaiters = [];
      try {
        const payload = await buildState();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('state:changed', payload);
        }
      } finally {
        for (const waiter of waiters) waiter();
      }
    }, 200);
  });
}

function getFirstInstalledAt() {
  if (!store) return new Date().toISOString();
  let firstInstalledAt = store.getSetting('firstInstalledAt', null);
  if (!firstInstalledAt) {
    firstInstalledAt = new Date().toISOString();
    store.setSetting('firstInstalledAt', firstInstalledAt);
  }
  return firstInstalledAt;
}

function shouldShowAnnouncement() {
  return false;
}

async function fetchBlogAnnouncement() {
  const showAnnouncement = shouldShowAnnouncement();
  const defaultAnnouncement = {
    title: 'أحدث الإعلانات الرسمية - POD Network Store',
    category: 'إعلان رسمي',
    date: new Date().toISOString().split('T')[0],
    url: 'https://podnetwork.store/announcement/',
    showAnnouncement,
    image: '../assets/brand/pod-monogram.png',
    excerpt: 'تعرض هذه النافذة أحدث العروض والتحديثات المنشورة مباشرة على موقع POD Network.',
    highlights: [
      'تحديثات تلقائية مباشرة من السيرفر',
      'عروض حصرية لبناء ورفع الكتب',
      'إرشادات استخدام أدوات الذكاء الاصطناعي'
    ]
  };

  if (process.env.TPT_TEST_USER_DATA) {
    return { ...defaultAnnouncement, isTestEnvironment: true };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const response = await fetch('https://podnetwork.store/announcement/', { signal: controller.signal, headers: { 'User-Agent': 'TPT-Book-Automation-App' } });
    clearTimeout(timeout);
    if (response.ok) {
      const html = await response.text();
      const titleMatch = html.match(/<h1[^>]*>(.*?)<\/h1>/i) || html.match(/<title>(.*?)<\/title>/i);
      if (titleMatch && titleMatch[1]) {
        defaultAnnouncement.title = titleMatch[1].replace(/<[^>]+>/g, '').trim();
      }
    }
  } catch {
    // Return default announcement on network failure
  }
  return defaultAnnouncement;
}

async function installReadyUpdate(options = {}) {
  if (!updateManager || updateManager.getState().status !== 'ready') {
    return updateManager?.getState() ?? null;
  }

  installingUpdate = true;
  quitting = true;
  if (systemActionTimer) {
    clearInterval(systemActionTimer);
    systemActionTimer = null;
    systemActionPayload = null;
  }
  queue?.pause();

  try {
    if (options.clearData && store) {
      try {
        store.clearAllData();
      } catch (err) {
        console.error('Failed to clear store data before update:', err);
      }
    }
    await browser?.close();
    store?.close();
    const started = updateManager.install();
    if (!started) {
      installingUpdate = false;
      quitting = false;
    }
    return updateManager.getState();
  } catch (error) {
    installingUpdate = false;
    quitting = false;
    throw error;
  }
}

async function promptForUpdateInstall(info) {
  if (updatePromptOpen || !mainWindow || mainWindow.isDestroyed()) return;
  updatePromptOpen = true;
  const version = info?.version ?? updateManager?.getState().availableVersion ?? 'new';
  const queueIsRunning = Boolean(queue?.running);
  try {
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'VERSA CLASS - التحديث التلقائي',
      message: `الإصدار الجديد ${version} جاهز للتثبيت!`,
      detail: queueIsRunning
        ? 'يتم الآن إنشاء كتاب. اختر لاحقاً لإكمال العمل أولاً، أو اختر التحديث للبدء فوراً.'
        : 'هل ترغب في إعادة تشغيل التطبيق وتثبيت التحديث الآن؟ يمكنك اختيار الحفاظ على البيانات السابقة أو حذفها وتطهيرها.',
      buttons: ['تحديث والحفاظ على البيانات', 'تحديث وحذف البيانات السابقة', 'لاحقاً / إلغاء'],
      defaultId: queueIsRunning ? 2 : 0,
      cancelId: 2,
      noLink: true
    });
    if (result.response === 0) await installReadyUpdate({ clearData: false });
    else if (result.response === 1) await installReadyUpdate({ clearData: true });
  } finally {
    updatePromptOpen = false;
  }
}

function configureAutoUpdates() {
  const updatesEnabled = false;
  updateManager = new UpdateManager({
    autoUpdater: updatesEnabled ? getAutoUpdater() : null,
    currentVersion: app.getVersion(),
    enabled: updatesEnabled,
    onStateChange: () => broadcastState().catch((error) => console.error('Failed to broadcast update state:', error)),
    onDownloaded: (info) => promptForUpdateInstall(info).catch((error) => console.error('Failed to show update prompt:', error))
  });
}

function storybookPackage(project, parsed = null) {
  const storyPages = Array.isArray(project.jobs)
    ? project.jobs.filter((job) => job.kind === 'story_page').map((job) => ({
        pageNumber: Number(job.title?.match(/\d+/)?.[0] ?? job.pageNumber - 1),
        storyText: job.storyText || '',
        imagePrompt: job.imagePrompt || job.prompt || ''
      }))
    : [];
  return {
    blueprint: parsed?.blueprint ?? project.storyBlueprint ?? '',
    storyIdea: parsed?.storyIdea ?? project.storyInput?.approvedStoryIdea ?? project.description ?? '',
    exactPageText: parsed?.exactPageText ?? project.storyExactText ?? [],
    characters: parsed?.characters ?? project.highlights?.characters ?? [],
    frontCover: parsed?.frontCover ?? project.frontCoverPrompt ?? '',
    pages: parsed?.pages ?? storyPages,
    backCover: parsed?.backCover ?? project.backCoverPrompt ?? ''
  };
}

function persistStorybookPhoto(sourcePath, outputDir) {
  if (!sourcePath) return null;
  if (!existsSync(sourcePath)) {
    throw Object.assign(new Error('The uploaded real-person photo is no longer available. Please choose it again.'), {
      code: 'REFERENCE_IMAGE_MISSING'
    });
  }
  const referencesDir = join(outputDir, 'references');
  mkdirSync(referencesDir, { recursive: true });
  // ChatGPT's upload UI is most reliable with PNG/JPEG. In particular, a photo
  // chosen from macOS can be AVIF/HEIC, so retain a safe PNG copy whenever
  // Chromium can decode it instead of silently sending an unsupported format.
  const decoded = nativeImage.createFromPath(sourcePath);
  const canConvert = decoded && !decoded.isEmpty() && decoded.getSize().width > 0;
  const sourceExtension = extname(sourcePath).toLowerCase() || '.png';
  const destination = join(referencesDir, `original_character_photo${canConvert ? '.png' : sourceExtension}`);
  if (canConvert) writeFileSync(destination, decoded.toPNG());
  else copyFileSync(sourcePath, destination);
  return destination;
}

function prepareStorybookPhotoForUpload(photoPath) {
  if (!photoPath || !existsSync(photoPath)) return photoPath;
  if (/\.(?:png|jpe?g|webp)$/i.test(photoPath)) return photoPath;
  const decoded = nativeImage.createFromPath(photoPath);
  if (!decoded || decoded.isEmpty() || decoded.getSize().width < 1) return photoPath;
  const pngPath = join(dirname(photoPath), 'original_character_photo.png');
  writeFileSync(pngPath, decoded.toPNG());
  return pngPath;
}

function uniqueExportDirectory(rootDirectory, projectName) {
  const baseName = `${slugify(projectName, 'pod-network-book')}-export`;
  let candidate = join(rootDirectory, baseName);
  let suffix = 2;
  while (existsSync(candidate)) {
    candidate = join(rootDirectory, `${baseName}-${suffix}`);
    suffix += 1;
  }
  return candidate;
}


/** The folder every book's output lives under. Nothing outside it may ever be deleted. */
function getLibraryRoot() {
  return join(app.getPath('documents'), APP_NAME);
}

function ensureProjectOutputDirectory(projectId) {
  let project = store.getProject(projectId);
  if (!project) throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });
  const existingPath = String(project.outputDir ?? '').trim();
  const outputDir = existingPath && isAbsolute(existingPath)
    ? existingPath
    : join(app.getPath('documents'), APP_NAME, `${slugify(project.name)}-${project.id.slice(0, 6)}`);
  try {
    mkdirSync(outputDir, { recursive: true });
  } catch (error) {
    throw Object.assign(new Error(`The book output folder is unavailable: ${outputDir}`), {
      code: 'OUTPUT_DIRECTORY_UNAVAILABLE',
      cause: error
    });
  }
  if (outputDir !== existingPath) {
    store.updateProject(projectId, { outputDir });
    store.appendEvent({
      projectId,
      level: 'info',
      message: `Automation assigned a safe output folder: ${outputDir}`
    });
    project = store.getProject(projectId);
  }
  return project;
}

async function emitStorybookStage(projectId, phase, { parsed = null, progress = null, error = null } = {}) {
  const project = store.getProject(projectId);
  if (!project) return;
  await broadcastState();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('storybook:phase1-ready', {
      project,
      parsed: storybookPackage(project, parsed),
      phase,
      progress,
      error
    });
  }
}

async function saveStorybookCharacterReference(projectId, characterIndex, { force = false } = {}) {
  const project = store.getProject(projectId);
  const record = store.getCharacterByIndex(projectId, characterIndex);
  if (!project || !record) {
    throw Object.assign(new Error('Character record not found.'), { code: 'CHARACTER_RECORD_NOT_FOUND' });
  }
  if (!force && record.status === 'complete' && record.outputPath && existsSync(record.outputPath)) return record;
  const characters = Array.isArray(project.highlights?.characters) ? project.highlights.characters : [];
  const character = characters[characterIndex] ?? record;
  let attachmentPath = characterIndex === 0 ? project.storyInput?.attachmentPath ?? null : null;
  if (attachmentPath && !existsSync(attachmentPath)) {
    throw Object.assign(new Error('The original real-person photo is missing. Restore it before generating the main character.'), {
      code: 'REFERENCE_IMAGE_MISSING'
    });
  }
  if (attachmentPath) {
    const uploadSafePath = prepareStorybookPhotoForUpload(attachmentPath);
    if (uploadSafePath !== attachmentPath) {
      attachmentPath = uploadSafePath;
      store.updateProject(projectId, {
        storyInput: { ...project.storyInput, attachmentPath, hasPhoto: true }
      });
    }
  }
  store.updateCharacter(record.id, {
    name: character.name,
    prompt: character.prompt,
    status: 'generating',
    outputPath: null,
    imageHash: null,
    error: null
  });
  await broadcastState();
  try {
    const generated = await browser.generateCharacterSheetWithGpt({
      projectId,
      characterId: record.id,
      characterIndex,
      characterName: character.name,
      prompt: character.prompt,
      attachmentPath
    });
    const imageHash = createHash('sha256').update(generated.buffer).digest('hex');
    const duplicateCharacter = store.findCharacterByImageHash(projectId, imageHash, record.id);
    if (duplicateCharacter) {
      throw Object.assign(new Error(`ChatGPT returned the existing ${duplicateCharacter.name} reference instead of a new image for ${character.name}.`), {
        code: 'DUPLICATE_CHARACTER_IMAGE',
        duplicateCharacterId: duplicateCharacter.id
      });
    }
    const saved = await fileManager.saveGeneratedImage({
      buffer: generated.buffer,
      job: { fileName: join('characters', `char_${slugify(character.name, 'character')}_${record.id}.png`) },
      outputDir: project.outputDir,
      format: 'SQUARE',
      orientation: 'portrait'
    });
    const updated = store.updateCharacter(record.id, {
      status: 'complete',
      outputPath: saved.outputPath,
      imageHash,
      conversationUrl: generated.conversationUrl,
      error: null
    });
    store.appendEvent({
      projectId,
      level: 'success',
      message: `${attachmentPath ? 'Photo-based main character' : 'Independent character'} reference generated for ${character.name}.`
    });
    return updated;
  } catch (error) {
    store.updateCharacter(record.id, { status: 'failed', error: error.message });
    throw error;
  }
}

async function generateAllStorybookCharacterReferences(projectId) {
  if (storybookAssetGenerationActive) {
    throw Object.assign(new Error('Another character reference is already being generated.'), { code: 'STORYBOOK_ASSET_BUSY' });
  }
  storybookAssetGenerationActive = true;
  try {
    const initial = store.getProject(projectId);
    const total = initial?.characterSheets?.length ?? 0;
    for (let index = 0; index < total; index += 1) {
      const current = store.getCharacterByIndex(projectId, index);
      if (current?.status === 'complete' && current.outputPath && existsSync(current.outputPath)) continue;
      await emitStorybookStage(projectId, 'references_generating', {
        progress: { completed: index, total, currentName: current?.name ?? `Character ${index + 1}` }
      });
      await saveStorybookCharacterReference(projectId, index);
    }
    await emitStorybookStage(projectId, 'references_complete', {
      progress: { completed: total, total }
    });
  } finally {
    storybookAssetGenerationActive = false;
  }
}

async function finalizeStorybookPages({ projectId, parsed, conversationUrl }) {
  const existingProject = store.getProject(projectId);
  if (!existingProject) throw Object.assign(new Error('Storybook project not found.'), { code: 'PROJECT_NOT_FOUND' });
  const finalPages = parsed.pages;
  const exactPageText = finalPages.map(({ pageNumber, storyText }) => ({ pageNumber, storyText }));
  const jobs = buildStorybookJobs({
    projectToken: projectId.split('-')[0],
    // Each official page starts its own generation chat; the project keeps the planning chat URL.
    conversationUrl: null,
    frontCover: parsed.frontCover,
    pages: finalPages,
    backCover: parsed.backCover
  });
  store.populateProjectJobs(
    projectId,
    jobs,
    existingProject.format,
    existingProject.orientation,
    jobs.length
  );
  const project = store.updateProject(projectId, {
    conversationUrl,
    style: "Children's Storybook Studio",
    projectType: 'storybook',
    storybookPhase: 'complete',
    storyExactText: exactPageText,
    frontCoverPrompt: parsed.frontCover,
    backCoverPrompt: parsed.backCover
  });
  store.appendEvent({
    projectId,
    level: 'success',
    message: `Storybook page stage saved the front cover, ${finalPages.length} story pages, and the back cover.`
  });
  const result = {
    project,
    parsed: storybookPackage(project, { ...parsed, pages: finalPages, exactPageText }),
    conversationUrl
  };
  await emitStorybookStage(projectId, 'complete', { parsed: result.parsed });
  startAutomationIfIdle();
  return result;
}

async function runStorybookWorkflow(projectId, { reuseCurrentPage = false } = {}) {
  try {
    let project = store.getProject(projectId);
    if (!project || project.projectType !== 'storybook') {
      throw Object.assign(new Error('Storybook project not found.'), { code: 'PROJECT_NOT_FOUND' });
    }
    if (!project.conversationUrl) {
      throw Object.assign(new Error('The saved Storybook planning conversation URL is missing.'), { code: 'CONVERSATION_URL_REQUIRED' });
    }
    if (project.storybookPhase === 'complete' && project.jobs?.length) {
      return { project, parsed: storybookPackage(project), conversationUrl: project.conversationUrl };
    }
    const storyInput = project.storyInput ?? {};
    const pageCount = Math.max(1, Number.parseInt(storyInput.pageCount, 10) || 10);
    let characters = Array.isArray(project.highlights?.characters) ? project.highlights.characters : [];

    if (!characters.length) {
      store.updateProject(projectId, { storybookPhase: 'characters_generating' });
      await emitStorybookStage(projectId, 'characters_generating');
      const characterResult = await browser.generateStorybookCharactersWithGpt({
        input: {
          ...storyInput,
          blueprint: project.storyBlueprint,
          hasPhoto: Boolean(storyInput.attachmentPath)
        },
        conversationUrl: project.conversationUrl,
        reuseCurrentPage
      });
      characters = characterResult.parsed.characters;
      const characterSheets = characters.map((character, index) => ({
        index,
        name: character.name,
        prompt: character.prompt,
        status: 'not_generated',
        outputPath: null,
        conversationUrl: null,
        error: null
      }));
      project = store.updateProject(projectId, {
        conversationUrl: characterResult.conversationUrl,
        storybookPhase: 'characters_complete',
        highlights: { ...(project.highlights ?? {}), characters },
        characterSheets
      });
      store.appendEvent({ projectId, level: 'success', message: `Saved ${characters.length} standalone character prompt cards.` });
      await emitStorybookStage(projectId, 'characters_complete');
    }

    project = store.getProject(projectId);
    const incompleteCharacters = project.characterSheets.filter((character) => (
      character.status !== 'complete' || !character.outputPath || !existsSync(character.outputPath)
    ));
    if (incompleteCharacters.length) {
      store.updateProject(projectId, { storybookPhase: 'references_generating' });
      await generateAllStorybookCharacterReferences(projectId);
    }

    project = store.getProject(projectId);
    const readyReferences = project.characterSheets.filter((character) => (
      character.status === 'complete' && character.outputPath && existsSync(character.outputPath)
    ));
    if (!characters.length || project.characterSheets.length !== characters.length || readyReferences.length !== characters.length) {
      throw Object.assign(new Error('Every character reference must be generated before page prompts are requested.'), {
        code: 'CHARACTER_REFERENCES_INCOMPLETE'
      });
    }

    store.updateProject(projectId, { storybookPhase: 'pages_generating' });
    await emitStorybookStage(projectId, 'pages_generating');
    const pageResult = await browser.generateStorybookPagesWithGpt({
      input: {
        ...storyInput,
        pageCount,
        title: project.name,
        blueprint: project.storyBlueprint,
        characters,
        approvedExactText: project.storyExactText,
        frontCover: project.frontCoverPrompt
      },
      conversationUrl: project.conversationUrl,
      reuseCurrentPage: false
    });
    return finalizeStorybookPages({
      projectId,
      parsed: pageResult.parsed,
      conversationUrl: pageResult.conversationUrl
    });
  } catch (error) {
    const current = store.getProject(projectId);
    if (current) {
      const failedStage = current.storybookPhase;
      store.updateProject(projectId, {
        storybookPhase: 'workflow_failed',
        storyInput: { ...(current.storyInput ?? {}), failedStage }
      });
      store.appendEvent({
        projectId,
        level: 'error',
        message: `Storybook workflow failed during ${failedStage || 'an unknown stage'}: ${error.message}`,
        details: { code: error.code ?? 'STORYBOOK_WORKFLOW_FAILED', responsePreview: error.responsePreview ?? null }
      });
      await emitStorybookStage(projectId, 'workflow_failed', { error: error.message });
    }
    error.projectId = projectId;
    throw error;
  }
}

function generatingProjectName() {
  const id = queue?.running ? queue.status()?.activeProjectId : null;
  return id ? (store.getProject(id)?.name || 'Another book') : 'Another book';
}

function liveWorkLabel() {
  if (queue?.running) return `interior generation on "${generatingProjectName()}"`;
  // Print-PDF and maze assemble are local file compose. They must not hold the
  // Gemini/browser lane or Mockups Lab cannot start after Maze Lab finishes.
  if (liveOperation?.kind === 'print-pdf') return '';
  if (liveOperation?.kind === 'maze-assemble') return '';
  if (liveOperation?.kind === 'editable-generation') return 'native editable generation';
  if (liveOperation?.kind === 'listing') return 'TPT listing';
  if (liveOperation?.kind === 'thumbnails') return 'mockups';
  if (liveOperation?.kind === 'preview') return 'preview video';
  if (liveOperation?.recovering || comfy.isRecovering?.()) return 'Text Lab engine self-heal';
  if (tptListingAutomationActive) return 'TPT upload';
  if (storybookAssetGenerationActive) return 'character generation';
  if (bundleUploadActive) return 'bundle upload';
  const auto = automation?.getStatus?.();
  if (auto?.active && !auto?.paused) return `full automation (${auto.currentStep || 'running'})`;
  return '';
}

function assertBrowserFree(action = 'starting this stage') {
  const label = liveWorkLabel();
  if (!label) return;
  throw Object.assign(
    new Error(`The browser is busy with ${label}. You can still open listing, interior, export, settings, and other books. Pause the running stage to start ${action} by itself.`),
    { code: 'BROWSER_BUSY' }
  );
}

function assertIdle(action = 'starting this workflow') {
  if (editableAbortController) throw Object.assign(new Error('Pause native editable generation before starting another workflow.'), {code:'QUEUE_RUNNING'});
  if (queue.running) {
    throw Object.assign(
      new Error(`"${generatingProjectName()}" is still generating. Pause it before ${action}. You can keep opening other books while it runs.`),
      { code: 'QUEUE_RUNNING' }
    );
  }
  const auto = automation?.getStatus?.();
  if (auto?.active && !auto?.paused) {
    throw Object.assign(new Error('Pause the full automation pipeline before starting another workflow.'), { code: 'AUTOMATION_RUNNING' });
  }
  if (tptListingAutomationActive) {
    throw Object.assign(new Error('Wait for the current TPT workflow to finish before starting another operation.'), { code: 'TPT_UPLOAD_ALREADY_RUNNING' });
  }
}

function assertNotGeneratingProject(projectId, action = 'changing this book') {
  if (editableAbortController && liveOperation?.projectId === projectId) throw Object.assign(new Error(`This book is generating. Pause it before ${action}.`), {code:'QUEUE_RUNNING'});
  if (queue.running && queue.status()?.activeProjectId === projectId) {
    throw Object.assign(new Error(`This book is generating. Pause it before ${action}.`), { code: 'QUEUE_RUNNING' });
  }
}

function startAutomationIfIdle() {
  // Full automation starts only when the user clicks Start Full Automation on the current book.
}

comfy.onRecovery((event) => {
  if (event.recovering) {
    setLiveOperation({
      kind: liveOperation?.kind || 'interior_text',
      projectId: liveOperation?.projectId || null,
      label: 'Restarting engine',
      message: event.message || 'Restarting engine',
      percent: liveOperation?.percent || 0,
      recovering: true
    });
  } else if (liveOperation?.recovering) {
    if (editableAbortController) {
      setLiveOperation({
        ...liveOperation,
        recovering: false,
        message: event.message || liveOperation.message || 'Engine recovered'
      });
    } else {
      setLiveOperation(null);
    }
  }
  broadcastState().catch(() => {});
});

function registerIpc() {
  registerBookManagementIpc({
    ipcMain,
    fileManager,
    store,
    broadcastState
  });
  ipcMain.handle('state:get', () => buildState());
  ipcMain.handle('app:open-external', (_event, rawUrl) => {
    let parsed;
    try {
      parsed = new URL(String(rawUrl || ''));
    } catch {
      throw Object.assign(new Error('This resource link is invalid.'), { code: 'EXTERNAL_URL_INVALID' });
    }
    const allowedHosts = new Set([
      'podnetwork.store', 'www.podnetwork.store',
      'skool.com', 'www.skool.com',
      'youtube.com', 'www.youtube.com',
      'instagram.com', 'www.instagram.com',
      'printolli.com', 'www.printolli.com'
    ]);
    if (parsed.protocol !== 'https:' || !allowedHosts.has(parsed.hostname.toLowerCase())) {
      throw Object.assign(new Error('This resource is not on the approved POD Network link list.'), { code: 'EXTERNAL_URL_NOT_ALLOWED' });
    }
    return shell.openExternal(parsed.href);
  });
  ipcMain.handle('guide:export-pdf', async (_event, language) => {
    if (!['darija', 'en'].includes(language)) {
      throw Object.assign(new Error('Choose Darija or English before exporting the guide.'), { code: 'GUIDE_LANGUAGE_INVALID' });
    }
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw Object.assign(new Error('The app window is not available for PDF export.'), { code: 'GUIDE_WINDOW_UNAVAILABLE' });
    }
    const fileName = language === 'darija'
      ? 'VERSA-CLASS-Guide-Darija.pdf'
      : 'VERSA-CLASS-Guide-English.pdf';
    const choice = await dialog.showSaveDialog(mainWindow, {
      title: language === 'darija' ? 'حفظ دليل VERSA CLASS' : 'Save VERSA CLASS guide',
      defaultPath: join(app.getPath('documents'), fileName),
      filters: [{ name: 'PDF document', extensions: ['pdf'] }]
    });
    if (choice.canceled || !choice.filePath) return null;
    const pdfBuffer = await mainWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      preferCSSPageSize: true
    });
    writeFileSync(choice.filePath, pdfBuffer);
    return choice.filePath;
  });
  ipcMain.handle('app:check-update', () => updateManager?.check() ?? null);
  ipcMain.handle('app:install-update', (_event, options) => installReadyUpdate(options));
  ipcMain.handle('telemetry:report-book-completed', () => telemetryService?.reportBookCompleted() ?? null);
  ipcMain.handle('telemetry:report-ad-viewed', () => telemetryService?.reportAdViewed() ?? null);
  ipcMain.handle('announcement:fetch', () => fetchBlogAnnouncement());

  ipcMain.handle('settings:update', async (_event, input = {}) => {
    const preferences = normalizePreferences(input);
    store.setSetting('userPreferences', preferences);
    store.setSetting('whenCompleteAction', preferences.workflow.whenCompleteAction);
    applyNativeAppearance();
    store.appendEvent({ level: 'success', message: 'Profile and default settings saved locally.' });
    await broadcastState();
    return preferences;
  });

  ipcMain.handle('settings:set-supabase', async (_event, input = {}) => {
    const url = String(input?.url || '').trim().replace(/\/+$/, '');
    const serviceRoleKey = String(input?.serviceRoleKey || '').trim();
    if (url) store.setSetting('supabaseUrl', url);
    if (serviceRoleKey) store.setSetting('supabaseServiceRoleKey', serviceRoleKey);
    await broadcastState();
    return { configured: Boolean(url && serviceRoleKey) };
  });

  ipcMain.handle('settings:set-appearance', async (_event, appearance) => {
    const preferences = getPreferences();
    preferences.appearance = normalizeAppearance(appearance);
    store.setSetting('userPreferences', preferences);
    const next = applyNativeAppearance();
    await broadcastState();
    return next;
  });

  ipcMain.handle('profiles:get-rotation', async () => {
    let systemProfiles = [];
    try {
      systemProfiles = await browser.getSystemProfiles();
    } catch (e) {
      systemProfiles = [];
    }
    const rotation = browser.getProfileRotation();
    return {
      systemProfiles,
      ...rotation
    };
  });

  ipcMain.handle('profiles:set-rotation', async (_event, { profiles = [], currentIndex = 0, enabled = true } = {}) => {
    browser.enableProfileSwapping = Boolean(enabled);
    browser.setProfileRotation(profiles, currentIndex);
    store.setSetting('profileRotationList', profiles);
    store.setSetting('currentProfileIndex', currentIndex);
    store.setSetting('enableProfileSwapping', Boolean(enabled));
    if (typeof browser.setAccountPool === 'function') {
      browser.setAccountPool({ enabled: Boolean(enabled) });
      store.setSetting('accountPool', browser.accountPool.toJSON());
    }
    await broadcastState();
    return browser.getProfileRotation();
  });

  ipcMain.handle('profiles:switch-next', async () => {
    const result = await browser.switchToNextProfile();
    store.setSetting('currentProfileIndex', browser.currentProfileIndex);
    await broadcastState();
    return result;
  });

  ipcMain.handle('project:select', async (_event, projectId) => {
    if (!store.getProject(projectId)) throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });
    store.setSetting('selectedProjectId', projectId);
    await broadcastState();
    return buildState();
  });

  ipcMain.handle('project:set-format', async (_event, projectId, productFormat) => {
    const project = store.getProject(projectId);
    if (!project) throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });
    const { normalizeProductFormat } = require('./product-engine-boundary.cjs');
    const next = normalizeProductFormat(productFormat);
    store.updateProject(projectId, { productFormat: next });
    if (next === 'maze') require('./maze-service.cjs').ensureMazeProject(store, projectId);
    await broadcastState();
    return store.getProject(projectId);
  });

  ipcMain.handle('maze:get', async (_event, projectId) => {
    const project = store.getProject(projectId);
    require('./maze-service.cjs').assertMazeEngine(project);
    return require('./maze-service.cjs').getMazeProject(store, projectId);
  });

  ipcMain.handle('maze:set-config', async (_event, projectId, config) => {
    const project = store.getProject(projectId);
    require('./maze-service.cjs').assertMazeEngine(project);
    if (config != null && (typeof config !== 'object' || Array.isArray(config))) {
      throw Object.assign(new Error('Maze config must be an object.'), { code: 'MAZE_CONTRACT_INVALID' });
    }
    const mazeProject = require('./maze-service.cjs').setMazeConfig(store, projectId, config);
    await broadcastState();
    return mazeProject;
  });

  ipcMain.handle('maze:generate', async (_event, projectId, options) => {
    const project = store.getProject(projectId);
    require('./maze-service.cjs').assertMazeEngine(project);
    if (options != null && (typeof options !== 'object' || Array.isArray(options))) {
      throw Object.assign(new Error('Maze generate options must be an object.'), { code: 'MAZE_CONTRACT_INVALID' });
    }
    try {
      return require('./maze-service.cjs').generateMaze(store, projectId, options || {});
    } finally {
      await broadcastState();
    }
  });

  require('./maze-ipc.cjs').registerMazeLabIpc({
    ipcMain,
    store,
    broadcastState,
    setLiveOperation,
    onMazeBookReady: (projectId) => continueMazeProductPipeline(projectId)
  });

  ipcMain.handle('project:set-rebuild-pipeline', async (_event, projectId, enabled) => {
    const project = store.getProject(projectId);
    if (!project) throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });
    const { persistRebuildPipeline, isRebuildPipelineEnabled } = require('./rebuild-page-record.cjs');
    persistRebuildPipeline(store, projectId, enabled);
    await broadcastState();
    return { ...store.getProject(projectId), rebuildPipeline: isRebuildPipelineEnabled(store, project) };
  });

  ipcMain.handle('project:set-generation-mode', async (_event, projectId, mode) => {
    const project = store.getProject(projectId);
    if (!project) throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });
    const { persistGenerationMode, resolveStoredGenerationMode } = require('./editable-mode.cjs');
    persistGenerationMode(store, projectId, mode);
    await broadcastState();
    return { ...store.getProject(projectId), generationMode: resolveStoredGenerationMode(store, project) };
  });

  ipcMain.handle('project:create', async (_event, input = {}) => {
    const projectId = randomUUID();
    const sourceMode = input.sourceMode === 'bulk' ? 'bulk' : 'generated';
    const defaultBookName = `Book Project ${store.listProjects().length + 1}`;
    const name = cleanText(input.name, cleanText(input.theme, sourceMode === 'bulk' ? defaultBookName : 'TPT Book'));
    const generated = sourceMode === 'bulk'
      ? buildImportedJobs({ ...input, projectToken: projectId.split('-')[0] })
      : buildBookJobs({ ...input, projectToken: projectId.split('-')[0] });
    const root = join(app.getPath('documents'), APP_NAME);
    const outputDir = sourceMode === 'bulk' ? '' : join(root, `${slugify(name)}-${projectId.slice(0, 6)}`);
    if (outputDir) mkdirSync(outputDir, { recursive: true });
    const project = {
      id: projectId,
      name,
      theme: sourceMode === 'bulk' ? cleanText(input.theme, name) : generated.normalized.theme,
      niche: sourceMode === 'bulk' ? cleanText(input.niche, 'custom prompt queue') : generated.normalized.niche,
      format: sourceMode === 'bulk'
        ? (FORMAT_INSTRUCTIONS[input.format] ? input.format : 'A4')
        : generated.normalized.format,
      orientation: sourceMode === 'bulk'
        ? normalizeOrientation(input.orientation)
        : generated.normalized.orientation,
      style: sourceMode === 'bulk' ? 'User-supplied prompts (preserved verbatim)' : generated.normalized.style,
      activityCount: sourceMode === 'bulk' ? generated.jobs.length : generated.normalized.activityCount,
      status: 'draft',
      outputDir,
      conversationUrl: input.conversationUrl ?? null,
      productFormat: (() => {
        const { normalizeProductFormat } = require('./product-engine-boundary.cjs');
        try { return normalizeProductFormat(input.productFormat || 'static'); }
        catch { return 'static'; }
      })()
    };

    if (input.conversationUrl) {
      for (const job of generated.jobs) {
        job.conversationUrl = input.conversationUrl;
      }
    }

    store.createProject(project, generated.jobs);
    persistModeForNewBook(projectId, project.productFormat);
    store.appendEvent({
      projectId,
      level: 'success',
      message: sourceMode === 'bulk'
        ? `Imported ${generated.jobs.length} prompts into the ordered queue.`
        : `Created an ordered ${generated.jobs.length}-page book.`
    });
    await broadcastState();
    startAutomationIfIdle();
    return store.getProject(projectId);
  });

  ipcMain.handle('project:choose-output', async (_event, projectId) => {
    assertNotGeneratingProject(projectId, 'changing the output folder');
    const project = store.getProject(projectId);
    if (!project) throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });
    if (project.stats.complete > 0) {
      throw Object.assign(new Error('The output folder cannot change after pages have downloaded. Create a new book or move the files after export.'), { code: 'OUTPUT_ALREADY_USED' });
    }
    const suggestedPath = project.outputDir || join(app.getPath('documents'), APP_NAME, `${slugify(project.name)}-${project.id.slice(0, 6)}`);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose the book output folder',
      defaultPath: suggestedPath,
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return null;
    mkdirSync(result.filePaths[0], { recursive: true });
    store.updateProject(projectId, { outputDir: result.filePaths[0] });
    store.appendEvent({ projectId, message: `Output folder changed to: ${result.filePaths[0]}` });
    await broadcastState();
    return result.filePaths[0];
  });

  ipcMain.handle('analysis:analyze', async (_event, input = {}) => {
    const listing = resolveListingAnalysisInput(input);
    // A product URL from Gate / VERSA AGENT is a handoff, not a second
    // generation. Do not wait for the page queue to go idle.
    if (!listing.productUrl) assertIdle();
    requireGeminiForPlanning('starting analysis');
    // The work is a durable task, not this call's stack. If the window closes,
    // the app restarts, or the caller stops waiting, the analysis keeps its place
    // in the queue and its result is committed when it lands — instead of the
    // stage sitting in "analyzing" with nothing behind it.
    const task = store.tasks.enqueue({
      kind: TASK_KIND.ANALYSIS,
      projectId: null,
      dedupeKey: dedupeKey(TASK_KIND.ANALYSIS, null, listing.productUrl || listing.concept || 'adhoc'),
      payload: { listing },
      maxAttempts: 6
    });
    await broadcastState();
    const finished = await awaitTask(store, task.id, { timeoutMs: 15 * 60_000 });
    return finished.result;
  });

  /**
   * Start VERSA AGENT.
   *
   * Returns as soon as the scan is queued. The scan and the analysis it triggers
   * are both durable tasks, so closing the dialog — or the app — does not stop
   * them, and the result appears in the library when it lands.
   */
  ipcMain.handle('agent:scan-trends', async (_event, input = {}) => {
    const query = String(input?.query || '').trim().slice(0, 120);
    const marketplace = normalizeTrendMarketplace(input?.marketplace ?? input?.sources);
    const scanKey = dedupeKey(TASK_KIND.TREND_SCAN, null, `${marketplace}:${query || 'all'}`);
    const analysisOpen = (store.tasks.listOpen() || []).some((item) => item.kind === TASK_KIND.ANALYSIS);
    const recentScan = (store.tasks.latestByKinds([TASK_KIND.TREND_SCAN], { limit: 8 }) || [])
      .find((item) => item.dedupeKey === scanKey);
    if (analysisOpen && recentScan?.state === 'done') {
      // #region agent log
      fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H163',location:'src/main.cjs:agent:scan-trends',message:'reused finished scan instead of starting a second one',data:{query,marketplace,taskId:recentScan.id,analysisOpen:true},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      return { taskId: recentScan.id, state: recentScan.state, reused: true };
    }
    const task = store.tasks.enqueue({
      kind: TASK_KIND.TREND_SCAN,
      dedupeKey: scanKey,
      payload: { query, marketplace },
      maxAttempts: 2
    });
    store.appendEvent({
      level: 'info',
      message: query
        ? `VERSA AGENT is scanning ${TREND_SOURCES[marketplace]?.label || marketplace} for "${query}".`
        : `VERSA AGENT is scanning trending products on ${TREND_SOURCES[marketplace]?.label || marketplace}.`
    });
    await broadcastState();
    return { taskId: task.id, state: task.state };
  });

  /** What the agent found, for the panel that shows it. */
  ipcMain.handle('agent:scan-result', async (_event, taskId) => {
    const task = store.tasks.get(taskId);
    if (!task) return null;
    return {
      id: task.id,
      state: task.state,
      attempts: task.attempts,
      checkpoint: task.checkpoint,
      lastError: task.lastError,
      result: task.result
    };
  });

  ipcMain.handle('analysis:capture-listing-mockups', async (_event, input = {}) => {
    const listing = resolveListingAnalysisInput(input);
    if (!listing.productUrl || !parseTptProductUrl(listing.productUrl)) {
      throw Object.assign(new Error('A Teachers Pay Teachers product URL is required to extract listing mockups.'), {
        code: 'INVALID_PRODUCT_URL'
      });
    }
    const cacheKey = parseTptProductUrl(listing.productUrl).productId;
    const destDir = listing.destDir || join(app.getPath('userData'), 'competitor-mockup-cache', cacheKey);
    mkdirSync(destDir, { recursive: true });
    const mockups = await browser.scrapeTptListingMockups(listing.productUrl, destDir);
    const paths = competitorMockupPaths(mockups);
    if (!paths.length) {
      throw Object.assign(new Error(mockups.warning || 'No listing mockups could be extracted from the product page.'), {
        code: 'MOCKUPS_NOT_CAPTURED',
        mockups
      });
    }
    return { ...mockups, paths, destDir };
  });

  ipcMain.handle('analysis:last-prompt-receipt', async () => browser?.lastPromptReceipt || null);

  ipcMain.handle('analysis:generate-storybook', async (_event, input = {}) => {
    assertIdle();
    requireGeminiForPlanning('starting storybook generation');
    const pageCount = Math.max(1, Math.min(100, Number.parseInt(input.pageCount, 10) || 10));
    const format = FORMAT_INSTRUCTIONS[input.format] ? input.format : 'LETTER';
    const orientation = normalizeOrientation(input.orientation);
    const blueprintResult = await browser.generateStorybookBlueprintWithGpt({ ...input, pageCount });
    const blueprint = blueprintResult.parsed;
    const projectId = randomUUID();
    const fallbackName = cleanText(input.storyIdea, 'Storybook Project').slice(0, 80);
    const name = cleanText(blueprint.title, fallbackName);
    const root = join(app.getPath('documents'), APP_NAME);
    const outputDir = join(root, `${slugify(name, 'storybook')}-${projectId.slice(0, 6)}`);
    mkdirSync(outputDir, { recursive: true });
    const attachmentPath = persistStorybookPhoto(input.attachmentPath, outputDir);
    const storyInput = {
      storyIdea: cleanText(input.storyIdea, ''),
      storyBody: cleanText(input.storyBody, ''),
      pageCount,
      ageRange: cleanText(input.ageRange, ''),
      language: cleanText(input.language, ''),
      moralLesson: cleanText(input.moralLesson, ''),
      hasPhoto: Boolean(attachmentPath),
      attachmentPath,
      approvedStoryIdea: blueprint.storyIdea
    };

    const savedBlueprintProject = store.createProject({
      id: projectId,
      name,
      theme: name,
      niche: cleanText(input.storyIdea, "children's storybook"),
      format,
      orientation,
      style: "Children's Storybook Studio",
      activityCount: 0,
      status: 'draft',
      outputDir,
      conversationUrl: blueprintResult.conversationUrl,
      highlights: { characters: [] },
      targetAge: cleanText(input.ageRange, null),
      description: blueprint.storyIdea,
      projectType: 'storybook',
      storybookPhase: 'blueprint_complete',
      storyBlueprint: blueprint.blueprint,
      storyExactText: [],
      frontCoverPrompt: null,
      backCoverPrompt: null,
      characterSheets: [],
      storyInput
    }, []);
    store.appendEvent({
      projectId,
      level: 'success',
      message: 'Storybook idea and blueprint saved in the main planning conversation.'
    });
    await emitStorybookStage(projectId, 'blueprint_complete', { parsed: blueprint });
    return runStorybookWorkflow(savedBlueprintProject.id, { reuseCurrentPage: true });
  });

  ipcMain.handle('analysis:retry-storybook-phase2', async (_event, projectId) => {
    assertIdle();
    requireGeminiForPlanning('resuming the Storybook workflow');
    const project = store.getProject(projectId);
    if (!project || project.projectType !== 'storybook') {
      throw Object.assign(new Error('Storybook project not found.'), { code: 'PROJECT_NOT_FOUND' });
    }
    if (!project.conversationUrl) {
      throw Object.assign(new Error('The saved Storybook conversation URL is missing.'), { code: 'CONVERSATION_URL_REQUIRED' });
    }
    store.appendEvent({ projectId, message: 'Resuming the fixed Storybook workflow from the first incomplete stage.' });
    return runStorybookWorkflow(projectId, { reuseCurrentPage: false });
  });

  ipcMain.handle('storybook:generate-character-sheet', async (_event, projectId, characterIndex) => {
    assertIdle();
    if (storybookAssetGenerationActive) {
      throw Object.assign(new Error('Another character sheet is already being generated.'), { code: 'STORYBOOK_ASSET_BUSY' });
    }
    const project = store.getProject(projectId);
    if (!project || project.projectType !== 'storybook') {
      throw Object.assign(new Error('Storybook project not found.'), { code: 'PROJECT_NOT_FOUND' });
    }
    const characters = Array.isArray(project.highlights?.characters) ? project.highlights.characters : [];
    const index = Number.parseInt(characterIndex, 10);
    const character = characters[index];
    if (!character?.name || !character?.prompt) {
      throw Object.assign(new Error('Character prompt not found.'), { code: 'CHARACTER_NOT_FOUND' });
    }
    const characterRecord = store.getCharacterByIndex(projectId, index);
    if (!characterRecord) {
      throw Object.assign(new Error('Character database record not found.'), { code: 'CHARACTER_RECORD_NOT_FOUND' });
    }

    storybookAssetGenerationActive = true;
    try {
      await saveStorybookCharacterReference(projectId, index, { force: true });
      await broadcastState();
      return store.getProject(projectId);
    } finally {
      storybookAssetGenerationActive = false;
    }
  });

  ipcMain.handle('storybook:generate-all-character-sheets', async (_event, projectId) => {
    assertBrowserFree('characters');
    const project = store.getProject(projectId);
    if (!project || project.projectType !== 'storybook') {
      throw Object.assign(new Error('Storybook project not found.'), { code: 'STORYBOOK_PROJECT_NOT_FOUND' });
    }
    await generateAllStorybookCharacterReferences(projectId);
    store.updateProject(projectId, { stepCharactersStatus: 'completed' });
    await broadcastState();
    return store.getProject(projectId);
  });

  ipcMain.handle('analysis:generate-prompts', async (_event, payload = {}) => {
    assertIdle();
    requireGeminiForPlanning('generating prompts');
    const { projectId, conversationUrl, pageCount, format, orientation, name, theme, niche } = payload;

    // Check if we are updating an existing concept project
    if (projectId) {
      const existingProject = store.getProject(projectId);
      if (!existingProject) {
        throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });
      }
      const activeUrl = conversationUrl || existingProject.conversationUrl;
      if (!activeUrl) {
        throw Object.assign(new Error('No active conversation URL found for this project.'), { code: 'CONVERSATION_URL_REQUIRED' });
      }

      const includeMockups = payload.includeCompetitorMockups !== false;
      const attachmentPaths = competitorMockupAttachments(existingProject, includeMockups);
      const { normalizeProductFormat } = require('./product-engine-boundary.cjs');
      const chosenFormat = normalizeProductFormat(payload.productFormat || existingProject.productFormat || 'static');
      if (payload.productFormat) {
        store.updateProject(projectId, { productFormat: chosenFormat });
      }
      if (chosenFormat === 'maze') {
        require('./maze-service.cjs').ensureMazeProject(store, projectId);
        store.appendEvent({
          projectId,
          level: 'success',
          message: 'Maze Lab opened.'
        });
        await broadcastState();
        return store.getProject(projectId);
      }

      const result = await browser.generatePromptsWithGpt({
        conversationUrl: activeUrl,
        pageCount,
        format,
        orientation,
        attachmentPaths,
        title: existingProject.name,
        theme: existingProject.theme,
        niche: existingProject.niche,
        productFormat: chosenFormat,
        seed: `${existingProject.id} | ${existingProject.name} | ${existingProject.theme} | ${existingProject.niche} | ${chosenFormat}`,
        onBatch: (payload) => {
          const { startPage, endPage, have, total, phase } = payload || {};
          console.log(`[analysis] Content Gem prompt batch: pages ${startPage}–${endPage} (${have}/${total} saved)${phase ? ` [${phase}]` : ''}.`);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('analysis:prompt-progress', payload);
          }
        }
      });
      const prompts = Array.isArray(result.prompts) && result.prompts.length
        ? result.prompts
        : parseGeneratedPrompts(result.rawText, pageCount);
      const generated = prompts.pages
        ? buildImportedJobs({
          pages: prompts.pages,
          projectToken: projectId.split('-')[0]
        })
        : buildImportedJobs({
          promptsText: prompts.join('\n'),
          promptSplitMode: 'line',
          projectToken: projectId.split('-')[0]
        });
      store.populateProjectJobs(
        projectId,
        generated.jobs,
        FORMAT_INSTRUCTIONS[format] ? format : 'LETTER',
        normalizeOrientation(orientation),
        generated.jobs.length
      );

      store.appendEvent({
        projectId,
        level: 'success',
        message: attachmentPaths.length
          ? `Generated and saved ${generated.jobs.length} page prompts using ${attachmentPaths.length} competitor listing mockup${attachmentPaths.length === 1 ? '' : 's'}.`
          : `Generated and saved ${generated.jobs.length} page prompts for project.`
      });

      await broadcastState();
      return store.getProject(projectId);
    }

    // Otherwise, create a new project (the old flow fallback just in case)
    const activeUrl = conversationUrl;
    const result = await browser.generatePromptsWithGpt({
      conversationUrl: activeUrl,
      pageCount,
      format,
      orientation,
      title: name,
      theme,
      niche,
      seed: `${name} | ${theme} | ${niche} | ${pageCount}`,
      onBatch: (payload) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('analysis:prompt-progress', payload);
        }
      }
    });
    const prompts = Array.isArray(result.prompts) && result.prompts.length
      ? result.prompts
      : parseGeneratedPrompts(result.rawText, pageCount);
    const promptsText = prompts.join('\n');

    const newProjectId = randomUUID();
    const defaultBookName = name || `Book Project ${store.listProjects().length + 1}`;
    const generated = buildImportedJobs({
      promptsText,
      promptSplitMode: 'line',
      projectToken: newProjectId.split('-')[0]
    });
    const root = join(app.getPath('documents'), APP_NAME);
    const outputDir = join(root, `${slugify(defaultBookName)}-${newProjectId.slice(0, 6)}`);
    mkdirSync(outputDir, { recursive: true });

    const project = {
      id: newProjectId,
      name: defaultBookName,
      theme: cleanText(theme, defaultBookName),
      niche: cleanText(niche, 'analyzed competitor product'),
      format: FORMAT_INSTRUCTIONS[format] ? format : 'LETTER',
      orientation: normalizeOrientation(orientation),
      style: 'Custom GPT generated page prompts',
      activityCount: generated.jobs.length,
      status: 'draft',
      outputDir,
      conversationUrl: activeUrl,
      highlights: [],
      targetAge: '',
      description: '',
      productFormat: payload.productFormat || 'static'
    };

    store.createProject(project, generated.jobs);
    persistModeForNewBook(newProjectId, project.productFormat);
    store.appendEvent({
      projectId: newProjectId,
      level: 'success',
      message: `Analyzed product and generated ${generated.jobs.length} page prompts.`
    });
    await broadcastState();
    startAutomationIfIdle();
    return store.getProject(newProjectId);
  });

  ipcMain.handle('settings:set-ai-engine', async (_event, engine) => {
    if (queue.running) {
      throw Object.assign(
        new Error(`"${generatingProjectName()}" is still generating. Pause it before switching the image engine.`),
        { code: 'QUEUE_RUNNING' }
      );
    }
    const next = setActiveEngine(engine);
    store.appendEvent({
      level: 'info',
      message: next === 'meta'
        ? `${engineDisplayName(next)} is now the image engine. Gemini still writes analysis, blueprints, and prompts. ChatGPT stays signed in and unused.`
        : `${engineDisplayName(next)} is now the active image engine. Gemini still writes analysis, blueprints, and prompts.`
    });
    await broadcastState();
    return {
      aiEngine: next,
      loginRequired: !isEngineConfirmed(next)
    };
  });

  ipcMain.handle('settings:test-meta-connection', async () => {
    const selectedProfile = store.getSetting('chatgptSelectedProfile', null);
    try {
      const result = await browser.verifyLogin(selectedProfile, { target: 'meta' });
      store.setSetting('metaLoginConfirmed', Boolean(result.authenticated));
      store.setSetting('metaAccountProfile', {
        name: cleanText(result.accountProfile?.name),
        email: cleanText(result.accountProfile?.email),
        label: cleanText(result.accountProfile?.label),
        sourceBrowser: cleanText(result.sourceBrowser),
        sourceProfile: cleanText(result.sourceProfile),
        verifiedAt: new Date().toISOString()
      });
      store.appendEvent({ level: result.authenticated ? 'success' : 'warn', message: result.authenticated ? 'Meta AI login verified.' : 'Meta AI is not signed in yet.' });
      await broadcastState();
      return { ok: Boolean(result.authenticated), authenticated: Boolean(result.authenticated), message: result.authenticated ? 'Meta AI connected.' : 'Sign in on meta.ai, then verify again.', ...result };
    } catch (error) {
      store.setSetting('metaLoginConfirmed', false);
      store.appendEvent({ level: 'warn', message: `Meta AI login verification failed: ${error.message}` });
      await broadcastState();
      throw error;
    }
  });

  ipcMain.handle('browser:open-login', async (_event, target = null) => {
    const selectedProfile = store.getSetting('chatgptSelectedProfile', null);
    const engine = normalizeEngine(target || getActiveEngine());
    const result = await browser.openLoginBrowser(selectedProfile, { target: engine });
    await broadcastState();
    return result;
  });

  ipcMain.handle('browser:launch', async () => {
    applyActiveEngineToBrowser();
    const result = await lockBrowserDesk('browser:launch');
    await broadcastState();
    return result;
  });

  ipcMain.handle('browser:verify-login', async (_event, target = null) => {
    const engine = normalizeEngine(target || getActiveEngine());
    const selectedProfile = store.getSetting('chatgptSelectedProfile', null);
    const serviceName = engineDisplayName(engine);
    try {
      const result = await browser.verifyLogin(selectedProfile, { target: engine });
      store.setSetting(loginConfirmedKey(engine), Boolean(result.authenticated));
      store.setSetting(accountProfileKey(engine), {
        name: cleanText(result.accountProfile?.name),
        email: cleanText(result.accountProfile?.email),
        label: cleanText(result.accountProfile?.label),
        sourceBrowser: cleanText(result.sourceBrowser),
        sourceProfile: cleanText(result.sourceProfile),
        verifiedAt: new Date().toISOString()
      });
      applyActiveEngineToBrowser();
      store.appendEvent({ level: 'success', message: `${serviceName} login verified.` });
      if (result.authenticated) await lockBrowserDesk(`after-${engine}-verify`);
      await broadcastState();
      return { ...result, engine };
    } catch (error) {
      if (!['BROWSER_PROFILE_IN_USE', 'BROWSER_RECONNECTING'].includes(error.code)) {
        store.setSetting(loginConfirmedKey(engine), false);
      }
      applyActiveEngineToBrowser();
      store.appendEvent({
        level: 'warn',
        message: `${serviceName} login verification failed: ${error.message}`,
        details: { code: error.code ?? `${engine.toUpperCase()}_VERIFICATION_FAILED` }
      });
      await lockBrowserDesk(`after-${engine}-verify-fail`);
      await broadcastState();
      throw error;
    }
  });

  // Clipboard, cancel and the debug sink. The preload exposed all three, so every call
  // rejected with "No handler registered" - which is what made Copy do nothing and the
  // countdown Cancel button report a failure it could not explain.
  ipcMain.handle('util:copy', async (_event, text) => {
    clipboard.writeText(String(text ?? ''));
    return true;
  });

  ipcMain.handle('app:cancel-system-action', async () => {
    // Whatever shutdown/sleep countdown is pending, this stops it.
    const cancelled = cancelPendingSystemAction();
    if (cancelled) store.appendEvent({ level: 'notice', message: 'Scheduled system action cancelled.' });
    return cancelled;
  });

  // The renderer's debug sink. It is called with optional chaining, so a missing
  // handler produced an unhandled rejection on every call rather than an error anyone
  // could see. Kept deliberately quiet.
  ipcMain.handle('browser:logout-chatgpt', async () => {
    await browser.logout('chatgpt');
    store.setSetting('chatgptLoginConfirmed', false);
    store.setSetting('chatgptAccountProfile', null);
    store.appendEvent({ level: 'info', message: 'ChatGPT session logged out. Gemini was left signed in.' });
    syncBrowserVerifiedAccounts();
    await broadcastState();
    return { success: true };
  });

  ipcMain.handle('browser:logout-gemini', async () => {
    await browser.logout('gemini');
    store.setSetting('geminiLoginConfirmed', false);
    store.setSetting('geminiAccountProfile', null);
    store.appendEvent({ level: 'info', message: 'Gemini session logged out. ChatGPT was left signed in.' });
    syncBrowserVerifiedAccounts();
    await broadcastState();
    return { success: true };
  });

  ipcMain.handle('browser:logout-meta', async () => {
    await browser.logout('meta');
    store.setSetting('metaLoginConfirmed', false);
    store.setSetting('metaAccountProfile', null);
    store.appendEvent({ level: 'info', message: 'Meta AI session logged out. ChatGPT and Gemini were left signed in.' });
    syncBrowserVerifiedAccounts();
    await broadcastState();
    return { success: true };
  });

  ipcMain.handle('project:run-editable-generation', async (_event, projectId) => {
    if (!editableAbortController) assertIdle();
    store.lockProductEngine(projectId);
    // The manual button and the automated stage assemble the same three deliverables.
    // They used to diverge, which is how the deck and PDF could exist without the Word
    // document that every marketing generator then went looking for.
    const project = store.getProject(projectId);
    const { isTextFreeProject } = require('./text-free-pipeline.cjs');
    if (isTextFreeProject(store, project) || (project && listEditablePages(project).length)) {
      setLiveOperation({ kind: 'editable-generation', projectId, percent: 0, message: 'Assembling deliverables…' });
      try {
        const built = await assembleEditableDeliverables(projectId, (percent) => {
          setLiveOperation({ kind: 'editable-generation', projectId, percent, message: 'Assembling deliverables…' });
          broadcastState().catch(() => {});
        });
        return built;
      } catch (error) {
        const fatal = /cannot import name|ImportError|ModuleNotFoundError|FATAL_ENGINE_ERROR/i.test(String(error.message || ''));
        const wrapped = Object.assign(error, { code: error.code || (fatal ? 'FATAL_ENGINE_ERROR' : error.code) });
        store.appendEvent({ projectId, level: 'error', message: wrapped.message });
        throw wrapped;
      } finally {
        setLiveOperation(null);
        await broadcastState();
      }
    }
    return startNativeEditableInBackground(projectId);
  });

  // Stage 2. Separate from assembly so the editable build itself stays local and instant.
  ipcMain.handle('project:generate-editable-text', async (_event, projectId, options) => {
    assertIdle();
    const project = store.getProject(projectId);
    if (!project) throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });
    store.lockProductEngine(projectId);

    const { isTextFreeProject, prepareTextFreeManifests } = require('./text-free-pipeline.cjs');
    if (isTextFreeProject(store, project)) {
      const prepared = prepareTextFreeManifests({ store, project });
      store.appendEvent({
        projectId,
        level: 'success',
        message: `Text-free masters confirmed: ${prepared.pages} page(s), ${prepared.zones} zone(s). Nothing was erased.`
      });
      try {
        await assembleEditableDeliverables(projectId, () => {});
      } catch (error) {
        store.appendEvent({ projectId, level: 'error', message: error.message });
      }
      await broadcastState();
      return { total: prepared.pages, written: prepared.pages, source: 'manifest', zones: prepared.zones };
    }

    // Local pipeline first. This handler used to require a Gemini session and go
    // straight to the gem, which is why pressing Run on Interior Text sat at 0% -
    // it was waiting on a browser, not on the engine that does the work.
    const visionReady = await visionBridge.status().then((s) => s.ok && s.ready).catch(() => false);
    if (visionReady) {
      const localController = new AbortController();
      editableAbortController = localController;
      const watchPages = (project.jobs || [])
        .filter((job) => !options?.jobIds || options.jobIds.includes(job.id))
        .map((job) => ({ jobId: job.id, pageNumber: job.pageNumber }));
      const observer = attachTextLabObserver(projectId, watchPages);
      try {
        observer.setPhase('starting');
        observer.setPhase('reading');
        const read = await runPageVision({
          store,
          projectId,
          jobIds: options?.jobIds || null,
          force: Boolean(options?.force),
          signal: localController.signal,
          onActivity: textLabPageActivity(observer),
          onProgress: (percent) => {
            setLiveOperation({
              kind: 'editable-text', projectId,
              percent: Math.round(percent * 0.5),
              message: 'Reading pages (MobileSAM + PaddleOCR)…',
              remainingMs: observer.snapshot()?.remainingMs,
              phase: 'reading'
            });
            broadcastState().catch(() => {});
          }
        });
        observer.setPhase('rebuilding');
        const built = await buildEditablePages({
          store,
          projectId,
          jobIds: options?.jobIds || null,
          // A single page is re-read on demand, so its compiled page must be rebuilt
          // even though one already exists on disk.
          force: Boolean(options?.force) || Boolean(options?.jobIds),
          signal: localController.signal,
          onActivity: textLabPageActivity(observer),
          onProgress: (percent) => {
            setLiveOperation({
              kind: 'editable-text', projectId,
              percent: 50 + Math.round(percent * 0.5),
              message: 'Erasing text and rebuilding pages…',
              remainingMs: observer.snapshot()?.remainingMs,
              phase: 'rebuilding'
            });
            broadcastState().catch(() => {});
          }
        });
        store.appendEvent({
          projectId, level: built.failures?.length ? 'warn' : 'success',
          message: `Interior Text: ${built.pages} editable page(s), ${built.editableText} live text run(s)`
            + `${built.bakedText ? `, ${built.bakedText} left in artwork` : ''}.`
        });
        if (read.failures.length) {
          store.appendEvent({
            projectId, level: 'warn',
            message: `${read.failures.length} page(s) could not be read: `
              + read.failures.map((f) => `p${f.pageNumber} ${f.code}`).join(', ')
          });
        }
        if (built.failures?.length) {
          store.appendEvent({
            projectId, level: 'warn',
            message: `${built.failures.length} page(s) could not be rebuilt: `
              + built.failures.map((f) => `p${f.pageNumber} ${f.code}`).join(', ')
          });
        }
        if (!built.failures?.length) {
          try {
            const ready = store.getProject(projectId);
            if (ready && listEditablePages(ready).length) {
              await assembleEditableDeliverables(projectId, () => {});
            }
          } catch (error) {
            store.appendEvent({ projectId, level: 'error', message: error.message });
          }
        }
        return { total: built.pages, written: built.pages, editableText: built.editableText, bakedText: built.bakedText, source: 'vision' };
      } catch (error) {
        if (error.code !== 'STEP_ABORTED' && error.code !== 'CANCELLED') {
          store.appendEvent({ projectId, level: 'error', message: error.message });
        }
        throw error;
      } finally {
        observer.stop();
        editableAbortController = null;
        setLiveOperation(null);
        await broadcastState();
      }
    }

    // No local vision environment: fall back to the gem, exactly as before.
    assertBrowserFree('writing page text');
    requireGeminiForPlanning('page text');
    const controller = new AbortController();
    editableAbortController = controller;
    browser.beginWork?.();
    setLiveOperation({ kind: 'editable-text', projectId, percent: 0, message: 'Writing page text…' });
    try {
      const result = await generateEditablePageText({
        store,
        projectId,
        provider: createEditableBrowserProvider(browser, { signal: controller.signal, onActivity: () => {} }),
        signal: controller.signal,
        jobIds: options?.jobIds || null,
        force: Boolean(options?.force),
        onProgress: (percent) => {
          setLiveOperation({ kind: 'editable-text', projectId, percent, message: 'Writing page text…' });
          broadcastState().catch(() => {});
        }
      });
      store.appendEvent({ projectId, level: 'success', message: `Page text ready for ${result.total} page(s).` });
      return result;
    } catch (error) {
      if (error.code !== 'STEP_ABORTED') store.appendEvent({ projectId, level: 'error', message: error.message });
      throw error;
    } finally {
      editableAbortController = null;
      setLiveOperation(null);
      await broadcastState();
    }
  });

  ipcMain.handle('queue:generate-job', async (_event, jobId) => {
    const existing=store.getJob(jobId);
    if (existing) restoreDefaultArtworkPrompts(existing.projectId, [jobId]);
    const job=store.getJob(jobId);
    if (!job) throw Object.assign(new Error('Page not found.'),{code:'JOB_NOT_FOUND'});
    const project=store.getProject(job.projectId);
    if (!project.outputDir) throw Object.assign(new Error('Choose the output folder first.'),{code:'OUTPUT_DIR_REQUIRED'});
    if (!queue.running) assertBrowserFree('generating this image');
    requireActiveEngine('generating this image');
    store.lockProductEngine(project.id);
    const result=queue.generate(jobId);
    await broadcastState();
    return result;
  });

  ipcMain.handle('project:clear-tpt-thumbnail', async (_event, projectId, index) => {
    const project = store.getProject(projectId);
    const listing = project?.tptListing;
    if (!project || !listing) throw Object.assign(new Error('Create the listing draft first.'), { code: 'TPT_LISTING_REQUIRED' });
    assertNotGeneratingProject(projectId, 'deleting a mockup');
    const slot = Math.max(0, Math.min(3, Number(index) || 0));
    const thumbnailPaths = [...getMockups(project).paths];
    tryRemovePath(thumbnailPaths[slot]);
    thumbnailPaths[slot] = null;
    const completed = thumbnailPaths.filter(Boolean).length;
    store.updateProject(projectId, {
      tptListing: applyMockupsToListing(
        invalidateTptListingReview(listing, {
          status: completed ? 'draft_reviewing' : 'draft_ready'
        }),
        {
          paths: thumbnailPaths,
          progress: { completed, total: 4 }
        }
      ),
      stepThumbnailsStatus: completed ? project.stepThumbnailsStatus : 'pending'
    });
    store.appendEvent({ projectId, message: `Listing mockup ${slot + 1} deleted.` });
    await broadcastState();
    return store.getProject(projectId);
  });

  ipcMain.handle('project:clear-tpt-thumbnails', async (_event, projectId) => {
    const project = store.getProject(projectId);
    const listing = project?.tptListing;
    if (!project || !listing) throw Object.assign(new Error('Create the listing draft first.'), { code: 'TPT_LISTING_REQUIRED' });
    assertNotGeneratingProject(projectId, 'deleting mockups');
    for (const filePath of getMockups(project).paths) tryRemovePath(filePath);
    store.updateProject(projectId, {
      tptListing: applyMockupsToListing(
        invalidateTptListingReview(listing, { status: 'draft_ready' }),
        {
          paths: [],
          progress: { completed: 0, total: 4 },
          error: null
        }
      ),
      stepThumbnailsStatus: 'pending'
    });
    store.appendEvent({ projectId, message: 'All listing mockups were deleted.' });
    await broadcastState();
    return store.getProject(projectId);
  });

  ipcMain.handle('project:clear-competitor-mockups', async (_event, projectId) => {
    const project = store.getProject(projectId);
    if (!project) throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });
    store.updateProject(projectId, { competitorMockups: null });
    store.appendEvent({ projectId, message: 'Competitor listing mockups were deleted.' });
    await broadcastState();
    return store.getProject(projectId);
  });

  ipcMain.handle('job:clear-image', async (_event, jobId) => {
    const job = store.getJob(jobId);
    if (!job) throw Object.assign(new Error('Page not found.'), { code: 'JOB_NOT_FOUND' });
    assertNotGeneratingProject(job.projectId, 'deleting a page image');
    tryRemovePath(job.outputPath);
    const updated = store.updateJob(jobId, {
      status: job.editInstruction ? 'edit_pending' : 'pending',
      outputPath: null,
      width: null,
      height: null,
      attempts: 0,
      lastError: null,
      lastErrorCode: null,
      baselineJson: null
    });
    store.appendEvent({
      projectId: job.projectId,
      jobId,
      message: `Page ${job.pageNumber} image deleted. You can regenerate it.`
    });
    await broadcastState();
    return updated;
  });

  ipcMain.handle('job:clear-all', async (_event, projectId) => {
    const project = store.getProject(projectId);
    if (!project) throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });
    assertNotGeneratingProject(projectId, 'deleting page images');
    const jobs = store.listJobs(projectId);
    for (const job of jobs) {
      tryRemovePath(job.outputPath);
      store.updateJob(job.id, {
        status: job.editInstruction ? 'edit_pending' : 'pending',
        outputPath: null,
        width: null,
        height: null,
        attempts: 0,
        lastError: null,
        lastErrorCode: null,
        baselineJson: null
      });
    }
    store.updateProjectStepStatus(projectId, 'interior', 'pending');
    store.appendEvent({ projectId, message: 'All page images were deleted.' });
    await broadcastState();
    return store.getProject(projectId);
  });

  ipcMain.handle('text-lab:clear-all', async (_event, projectId) => {
    const project = store.getProject(projectId);
    if (!project) throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });
    assertNotGeneratingProject(projectId, 'deleting text lab work');
    clearPageVision(store, project);
    for (const job of store.listJobs(projectId)) {
      store.updateJob(job.id, { textOverlays: [], baselineJson: null });
    }
    try { clearEditablePages(project); } catch { /* nothing compiled */ }
    store.updateProjectStepStatus(projectId, 'interior_text', 'pending');
    store.appendEvent({ projectId, message: 'Text Lab was cleared.' });
    await broadcastState();
    return store.getProject(projectId);
  });

  ipcMain.handle('editable:clear-all', async (_event, projectId) => {
    const project = store.getProject(projectId);
    if (!project) throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });
    assertNotGeneratingProject(projectId, 'deleting editable files');
    try { clearEditablePages(project); } catch { /* nothing compiled */ }
    store.updateProject(projectId, { editableOutputJson: null, printPdfJson: null });
    store.updateProjectStepStatus(projectId, 'editable_ppt', 'pending');
    store.appendEvent({ projectId, message: 'Editable Lab was cleared.' });
    await broadcastState();
    return store.getProject(projectId);
  });

  ipcMain.handle('project:clear-preview', async (_event, projectId) => {
    const project = store.getProject(projectId);
    if (!project) throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });
    assertNotGeneratingProject(projectId, 'deleting the preview');
    const listing = project.tptListing || {};
    tryRemovePath(listing.videoPreviewPath || listing.video?.path);
    store.updateProject(projectId, {
      tptListing: applyVideoToListing(listing, {
        path: null,
        status: 'pending',
        error: null,
        conversationUrl: null
      }),
      stepPreviewStatus: 'pending'
    });
    store.appendEvent({ projectId, message: 'Preview was deleted.' });
    await broadcastState();
    return store.getProject(projectId);
  });

  ipcMain.handle('browser:get-system-profiles', async () => {
    return await browser.getSystemProfiles();
  });

  ipcMain.handle('browser:set-selected-profile', async (_event, profile) => {
    store.setSetting('chatgptSelectedProfile', profile);
    await broadcastState();
    return { success: true };
  });

  ipcMain.handle('browser:focus', async () => {
    // Forever desk lock: never raise the managed browser over VERSA CLASS.
    // Unlock happens only via Settings → openLoginBrowser for profile sign-in.
    return lockBrowserDesk('browser:focus');
  });

  ipcMain.handle('browser:open-custom-gpt', async () => openStudioById('planning'));
  ipcMain.handle('browser:open-studio', async (_event, studioId) => openStudioById(studioId));

  ipcMain.handle('browser:open-job', async (_event, jobId) => {
    assertIdle();
    applyActiveEngineToBrowser();
    const job = store.getJob(jobId);
    if (!job) throw Object.assign(new Error('Page not found.'), { code: 'JOB_NOT_FOUND' });
    await browser.launch({ interactive: false, forceBrowser: true, headless: true });
    if (job.conversationUrl && !String(job.conversationUrl).startsWith('meta://')) await browser.navigate(job.conversationUrl);
    else await browser.openHome();
    await lockBrowserDesk('after-open-job');
    return browser.status();
  });

  ipcMain.handle('queue:start', async (_event, projectId, options = {}) => {
    const opts = options && typeof options === 'object' ? options : {};
    restoreDefaultArtworkPrompts(projectId);
    if (opts.engine) setActiveEngine(opts.engine);
    const pausedAutomation=automation?.getStatus();
    if (pausedAutomation?.active && pausedAutomation.paused && pausedAutomation.currentProjectId === projectId) {
      return automation.start({projectId});
    }
    if (queue.running && queue.pauseRequested && queue.activeProjectId === projectId) return queue.start(projectId);
    if (editableAbortController && liveOperation?.projectId === projectId) return startNativeEditableInBackground(projectId);
    if (!opts.automation) assertBrowserFree('interior pages');
    let project = store.getProject(projectId);
    if (!project) throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });
    if (!project?.outputDir) {
      if (opts.outputDir) {
        mkdirSync(opts.outputDir, { recursive: true });
        store.updateProject(projectId, { outputDir: opts.outputDir });
        store.appendEvent({ projectId, message: `Output folder selected: ${opts.outputDir}` });
        project = store.getProject(projectId);
      } else if (opts.automation) {
        throw Object.assign(new Error('Set an output folder before starting generation from automation.'), {
          code: 'OUTPUT_DIR_REQUIRED'
        });
      } else {
        const suggestedPath = join(app.getPath('documents'), APP_NAME, `${slugify(project.name)}-${project.id.slice(0, 6)}`);
        const choice = await dialog.showOpenDialog(mainWindow, {
          title: 'Choose where to save this book project',
          defaultPath: suggestedPath,
          buttonLabel: 'Use this folder and start',
          properties: ['openDirectory', 'createDirectory']
        });
        if (choice.canceled || !choice.filePaths[0]) return { cancelled: true };
        mkdirSync(choice.filePaths[0], { recursive: true });
        store.updateProject(projectId, { outputDir: choice.filePaths[0] });
        store.appendEvent({ projectId, message: `Output folder selected: ${choice.filePaths[0]}` });
        project = store.getProject(projectId);
      }
    }
    requireActiveEngine('starting generation');
    store.lockProductEngine(projectId);
    queue.start(projectId);
    await broadcastState();
    return queue.status();
  });

  ipcMain.handle('automation:continue', async (_event, payload = {}) => {
    const body = payload && typeof payload === 'object' ? payload : {};
    const projectId = body.projectId || store.getDashboardState()?.selectedProjectId || queue.status()?.activeProjectId;
    if (body.engine) setActiveEngine(body.engine);
    const engine = getActiveEngine();
    const project = projectId ? store.getProject(projectId) : null;
    const remaining = Number(project?.stats?.remaining) > 0;
    const shouldStart = Boolean(projectId)
      && !queue.status().running
      && (body.start === true || remaining);
    if (shouldStart) {
      return apiHandlers['queue:start']({}, projectId, {
        automation: body.automation !== false,
        engine,
        outputDir: body.outputDir
      });
    }
    await broadcastState();
    return {
      aiEngine: engine,
      loginRequired: !isEngineConfirmed(engine),
      continued: Boolean(queue.status().running),
      started: false,
      remaining: remaining ? project.stats.remaining : 0,
      projectId: projectId || null,
      queue: queue.status()
    };
  });

  ipcMain.handle('queue:pause', async () => pauseAllWork());

  ipcMain.handle('queue:retry-job', async (_event, jobId) => {
    const job = store.getJob(jobId);
    if (!job) throw Object.assign(new Error('Page not found.'), { code: 'JOB_NOT_FOUND' });
    assertNotGeneratingProject(job.projectId, 'retrying a page in this book');
    const result = queue.retryJob(jobId);
    await broadcastState();
    return result;
  });

  ipcMain.handle('queue:retry-all', async (_event, projectId) => {
    assertNotGeneratingProject(projectId, 'resetting pages in this book');
    queue.retryAll(projectId);
    await broadcastState();
    return store.getProject(projectId);
  });

  ipcMain.handle('job:import-image', async (_event, jobId) => {
    const job = store.getJob(jobId);
    if (!job) throw Object.assign(new Error('Page not found.'), { code: 'JOB_NOT_FOUND' });
    assertNotGeneratingProject(job.projectId, 'importing an image into this book');
    const project = store.getProject(job.projectId);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: `Choose an image for page ${job.pageNumber}`,
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const saved = await fileManager.importImage({
      sourcePath: result.filePaths[0],
      job,
      outputDir: project.outputDir,
      format: project.format,
      orientation: project.orientation
    });
    store.updateJob(job.id, {
      status: 'complete',
      outputPath: saved.outputPath,
      width: saved.width,
      height: saved.height,
      lastError: null,
      lastErrorCode: null,
      baselineJson: null
    });
    store.appendEvent({
      projectId: project.id,
      jobId: job.id,
      level: 'success',
      message: `Page ${job.pageNumber} image imported manually.`
    });
    const refreshed = store.getProject(project.id);
    if (refreshed.stats.complete === refreshed.stats.total) {
      store.updateProject(project.id, { status: 'complete' });
      await ensureProductPdf(project.id, { force: true });
    }
    await broadcastState();
    return saved;
  });

  ipcMain.handle('job:request-edit', async (_event, jobId, instruction) => {
    const existing = store.getJob(jobId);
    if (!existing) throw Object.assign(new Error('Page not found.'), { code: 'JOB_NOT_FOUND' });
    assertNotGeneratingProject(existing.projectId, 'editing a page in this book');
    const job = store.queuePageEdit(jobId, instruction);
    if (!queue.running) store.updateProject(job.projectId, { status: 'paused' });
    store.appendEvent({
      projectId: job.projectId,
      jobId,
      message: job.conversationUrl
        ? `Page ${job.pageNumber} edit was queued in its saved ChatGPT conversation.`
        : `Page ${job.pageNumber} edit was queued with its saved local image.`
    });
    await broadcastState();
    return job;
  });

  ipcMain.handle('job:request-regeneration', async (_event, jobId) => {
    const existing = store.getJob(jobId);
    if (!existing) throw Object.assign(new Error('Page not found.'), { code: 'JOB_NOT_FOUND' });
    assertNotGeneratingProject(existing.projectId, 'regenerating a page in this book');
    const job = store.queuePageRegeneration(jobId);
    store.updateProject(job.projectId, { status: 'paused' });
    store.appendEvent({
      projectId: job.projectId,
      jobId,
      message: `Page ${job.pageNumber} regeneration was queued in its saved ChatGPT conversation.`
    });
    await broadcastState();
    return job;
  });

  ipcMain.handle('job:reprocess-image', async (_event, jobId, zoom, offsetX, offsetY) => {
    const job = store.getJob(jobId);
    if (!job) throw Object.assign(new Error('Page not found.'), { code: 'JOB_NOT_FOUND' });
    assertNotGeneratingProject(job.projectId, 'cropping a page in this book');
    const project = store.getProject(job.projectId);
    if (!project) throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });

    const rawPath = job.outputPath.replace(/\.png$/, '.raw.png');
    if (!require('node:fs').existsSync(rawPath)) {
      if (job.outputPath && require('node:fs').existsSync(job.outputPath)) {
        require('node:fs').copyFileSync(job.outputPath, rawPath);
      } else {
        throw Object.assign(new Error('Original page image is missing. Run page generation or upload the file first.'), { code: 'REPROCESS_SOURCE_MISSING' });
      }
    }

    store.updateJob(jobId, {
      zoom: Number(zoom),
      offsetX: Number(offsetX),
      offsetY: Number(offsetY)
    });

    const saved = await fileManager.saveGeneratedImage({
      buffer: require('node:fs').readFileSync(rawPath),
      job,
      outputDir: project.outputDir,
      format: project.format,
      orientation: project.orientation,
      zoom: Number(zoom),
      offsetX: Number(offsetX),
      offsetY: Number(offsetY)
    });

    store.updateJob(jobId, {
      width: saved.width,
      height: saved.height
    });

    await broadcastState();
    return store.getJob(jobId);
  });

  ipcMain.handle('project:export-pdf', async (_event, projectId, options) => {
    const project = store.getProject(projectId);
    const outputPath = await fileManager.exportPdf(project, { ...(options || {}), store });
    const modeLabel = options?.exportMode === 'BOOKLET_SADDLE_STITCH' ? 'Booklet Spreads PDF' : 'PDF';
    store.appendEvent({ projectId, level: 'success', message: `${modeLabel} created: ${outputPath}` });
    await broadcastState();
    return outputPath;
  });

  ipcMain.handle('project:export-zip', async (_event, projectId, options) => {
    const project = store.getProject(projectId);
    const outputPath = await fileManager.exportZip(project, { ...(options || {}), store });
    const modeLabel = options?.exportMode === 'BOOKLET_SADDLE_STITCH' ? 'Booklet Spreads ZIP' : 'ZIP';
    store.appendEvent({ projectId, level: 'success', message: `${modeLabel} created: ${outputPath}` });
    await broadcastState();
    return outputPath;
  });

  ipcMain.handle('project:export-docx', async (_event, projectId) => {
    const project = store.getProject(projectId);
    if (!project) throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });
    const outputPath = await fileManager.exportDocx(project, { store });
    store.appendEvent({ projectId, level: 'success', message: `Word document created: ${outputPath}` });
    await broadcastState();
    return outputPath;
  });

  ipcMain.handle('project:export-pptx', async (_event, projectId, options) => {
    const project = store.getProject(projectId);
    if (!project) throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });
    // The store goes through so the editable path can find the analysed pages. Without
    // it that lookup silently fails and the export falls back to the flat deck.
    const outputPath = await fileManager.exportPptx(project, { ...(options || {}), store });
    const modeLabel = options?.exportMode === 'BOOKLET_SADDLE_STITCH' ? 'Booklet Spreads PPTX' : 'PPTX';
    store.appendEvent({ projectId, level: 'success', message: `${modeLabel} created: ${outputPath}` });
    await broadcastState();
    return outputPath;
  });

  ipcMain.handle('project:export-all-files', async (_event, projectId, options) => {
    const project = store.getProject(projectId);
    if (!project) throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });
    if (project.stats.complete !== project.stats.total || project.stats.total === 0) {
      throw Object.assign(new Error('Export All Files is available after every page is complete.'), { code: 'BOOK_INCOMPLETE' });
    }
    const destination = requireManagementDestination(options?.managementDestination);
    const exported = await exportToManagementFolder({
      project,
      destination,
      exportMode: options?.exportMode,
      fileManager,
      store,
      bookName: options?.bookName || project.name
    });
    const exportDirectory = exported.exportDirectory;
    const missingNote = (exported.result?.manifest?.missing || [])
      .filter((item) => !item.required)
      .map((item) => item.type)
      .join(', ');
    store.appendEvent({
      projectId,
      level: 'success',
      message: missingNote
        ? `Exported to Versa Management ${destination.productId}: ${exportDirectory} (optional missing: ${missingNote})`
        : `Exported to Versa Management ${destination.productId}: ${exportDirectory}`
    });
    await broadcastState();
    return exportDirectory;
  });

  ipcMain.handle('project:generate-tpt-thumbnails', async (_event, projectId) => {
    assertBrowserFree('mockups');
    requireActiveEngine('generating listing thumbnails');
    const project = await ensureListingShellForAssets(projectId);
    const listing = project?.tptListing;
    if (!project || !listing?.productPdfPath) {
      throw Object.assign(new Error('Complete every page before mockups.'), { code: 'BOOK_INCOMPLETE' });
    }
    const thumbnailPaths = [...getMockups(project).paths];
    store.updateProject(projectId, {
      tptListing: applyMockupsToListing(
        invalidateTptListingReview(listing, { status: 'thumbnails_generating' }),
        {
          paths: thumbnailPaths,
          progress: { completed: thumbnailPaths.filter(Boolean).length, total: 4 },
          error: null
        }
      )
    });
    await publishLiveOperation({
      kind: 'thumbnails',
      label: 'Listing mockups',
      percent: 8,
      message: 'Preparing listing mockups…',
      projectId
    });
    try {
      // The mockups must depict this book. getPdf().productPath is null for editable
      // products - they never build a print PDF - so those were being generated with no
      // document at all, from the title alone.
      const sourceDocPath = await ensureMarketingGroundTruth(projectId);
      const generated = await browser.generateTptThumbnailsWithGpt({ project, pdfPath: sourceDocPath, listing, onThumbnail: async ({ index, buffer, conversationUrl }) => {
        const outputPath = await fileManager.saveGeneratedThumbnail({ buffer, fileName: `thumbnail_${index + 1}.png`, outputDir: project.outputDir });
        thumbnailPaths[index] = outputPath;
        const current = store.getProject(projectId)?.tptListing ?? listing;
        const completed = thumbnailPaths.filter(Boolean).length;
        store.updateProject(projectId, {
          tptListing: applyMockupsToListing(current, {
            paths: thumbnailPaths,
            conversationUrl,
            progress: { completed, total: 4 },
            error: null
          }, { status: 'thumbnails_generating' })
        });
        store.appendEvent({ projectId, level: 'success', message: `TPT thumbnail ${index + 1}/4 saved.` });
        await publishLiveOperation({
          kind: 'thumbnails',
          label: 'Listing mockups',
          percent: Math.round((completed / 4) * 100),
          message: `Filling mockup ${index + 1} of 4…`,
          projectId
        });
      }});
      store.updateProjectTransactionally(projectId, (c) => ({ tptListing: applyMockupsToListing((c.tptListing || listing || {}), {
          paths: thumbnailPaths,
          conversationUrl: generated.conversationUrl,
          progress: { completed: 4, total: 4 },
          error: null
        }, { status: 'assets_ready' }) }));
      store.appendEvent({ projectId, level: 'success', message: 'Four listing thumbnails generated from the book pages.' });
      return store.getProject(projectId);
    } catch (error) {
      if (isPauseError(error)) {
        store.appendEvent({ projectId, level: 'warn', message: 'Mockups paused. Start again when you are ready.' });
        throw Object.assign(new Error('Stopped. You paused this work.'), { code: 'QUEUE_PAUSED' });
      }
     
      store.updateProjectTransactionally(projectId, (c) => ({ tptListing: applyMockupsToListing((c.tptListing || listing || {}), {
          paths: thumbnailPaths,
          progress: { completed: thumbnailPaths.filter(Boolean).length, total: 4 },
          error: error.message
        }, { status: 'thumbnails_failed' }) }));
      store.appendEvent({ projectId, level: 'error', message: `TPT thumbnail generation paused: ${error.message}` });
      throw error;
    } finally {
      finishLiveWork();
      await broadcastState();
    }
  });

  ipcMain.handle('project:generate-tpt-preview-video', async (_event, projectId, options = {}) => {
    assertBrowserFree('the preview video');
    return generatePreviewVideoForProject(projectId, { force: Boolean(options?.force) });
  });

  ipcMain.handle('project:regenerate-tpt-thumbnail', async (_event, projectId, thumbnailIndex) => {
    assertIdle();
    const project = store.getProject(projectId);
    const listing = project?.tptListing;
    const index = Number.parseInt(thumbnailIndex, 10);
    if (!project || !listing?.productPdfPath || !Number.isInteger(index) || index < 0 || index > 3) {
      throw Object.assign(new Error('Select a valid thumbnail to regenerate.'), { code: 'TPT_THUMBNAIL_INVALID' });
    }
    const thumbnailPaths = [...getMockups(project).paths];
    thumbnailPaths[index] = null;
    store.updateProject(projectId, {
      tptListing: applyMockupsToListing(
        invalidateTptListingReview(listing, { status: 'thumbnails_generating' }),
        {
          paths: thumbnailPaths,
          error: null,
          progress: { completed: thumbnailPaths.filter(Boolean).length, total: 4 }
        }
      )
    });
    await broadcastState();
    try {
      const generated = await browser.generateTptThumbnailsWithGpt({
        project,
        // Regenerating one mockup reads the same ground truth as generating all four,
        // or the replacement would not match its siblings.
        pdfPath: await ensureMarketingGroundTruth(projectId),
        listing: applyMockupsToListing(listing, { paths: thumbnailPaths }),
        thumbnailIndex: index,
        onThumbnail: async ({ buffer, conversationUrl }) => {
          const outputPath = await fileManager.saveGeneratedThumbnail({
            buffer,
            fileName: `thumbnail_${index + 1}.png`,
            outputDir: project.outputDir
          });
          thumbnailPaths[index] = outputPath;
          store.updateProjectTransactionally(projectId, (c) => ({ tptListing: applyMockupsToListing((c.tptListing || listing || {}), {
              paths: thumbnailPaths,
              conversationUrl,
              error: null,
              progress: { completed: thumbnailPaths.filter(Boolean).length, total: 4 }
            }, { status: 'assets_ready' }) }));
          store.appendEvent({ projectId, level: 'success', message: `TPT thumbnail ${index + 1}/4 regenerated and saved.` });
          await broadcastState();
        }
      });
      store.updateProjectTransactionally(projectId, (c) => ({ tptListing: applyMockupsToListing((c.tptListing || listing || {}), {
          paths: thumbnailPaths,
          conversationUrl: generated.conversationUrl || getMockups({ tptListing: (c.tptListing || listing || {}) }).conversationUrl,
          progress: { completed: thumbnailPaths.filter(Boolean).length, total: 4 }
        }, { status: 'assets_ready' }) }));
      await broadcastState();
      return store.getProject(projectId);
    } catch (error) {
      store.updateProjectTransactionally(projectId, (c) => ({ tptListing: applyMockupsToListing((c.tptListing || listing || {}), {
          paths: thumbnailPaths,
          error: error.message,
          progress: { completed: thumbnailPaths.filter(Boolean).length, total: 4 }
        }, { status: 'thumbnails_failed' }) }));
      store.appendEvent({ projectId, level: 'error', message: `TPT thumbnail ${index + 1} regeneration paused: ${error.message}` });
      await broadcastState();
      throw error;
    }
  });

  ipcMain.handle('project:mark-tpt-ready', async (_event, projectId) => {
    const project = store.getProject(projectId);
    const listing = project?.tptListing;
    const mSet = getMarketplace(project).settings;
    const paidPrice = Number.parseFloat(mSet.suggestedPrice);
    const licensePrice = Number.parseFloat(mSet.multipleLicensePrice);
    const bundlePrice = Number.parseFloat(mSet.bundleDiscountPrice);
    const pricingReady = mSet.isFreeResource === true || (Number.isFinite(paidPrice) && paidPrice >= 0);
    const licenseReady = Number.isFinite(licensePrice) && licensePrice >= 0;
    const bundleReady = !mSet.bundleDiscountPrice || (Number.isFinite(bundlePrice) && bundlePrice >= 0);
    const metadataReady = Boolean(
      listing?.productPdfPath
      && listing?.title
      && listing?.description
      && listing.tags?.length
      && listing.tags.length <= 6
      && listing.grades?.length
      && listing.grades.length <= 4
      && listing.subjects?.length
      && listing.subjects.length <= 3
      && (listing.formats?.length ?? 0) <= 3
      && mSet.taxCode
      && ['original', 'licensed'].includes(mSet.copyrightDeclaration)
    );
    const mockups = getMockups(project);
    const thumbnailMode = ['auto', 'manual', 'later'].includes(mockups.mode) ? mockups.mode : 'manual';
    const thumbnailsReady = thumbnailMode !== 'manual'
      || Boolean(mockups.paths?.[0] && existsSync(mockups.paths[0]));
    if (!metadataReady || !thumbnailsReady || !pricingReady || !licenseReady || !bundleReady) {
      throw Object.assign(new Error('Complete the current TPT contract: PDF, title, description, tax code, grades, subjects, tags, price/free choice, multi-license price, copyright, and a Main Cover when manual thumbnails are selected.'), { code: 'TPT_REVIEW_INCOMPLETE' });
    }
    const reviewApprovedAt = new Date().toISOString();
    store.updateProject(projectId, {
      isReadyToPublish: 1,
      tptListing: mirrorMockupsOnListing(applyMarketplaceToListing({
        ...listing,
        status: 'ready_to_upload'
      }, {
        review: { approvedAt: reviewApprovedAt },
        upload: { error: null, message: null }
      }))
    });
    store.appendEvent({ projectId, level: 'success', message: 'GPT listing marked ready to upload after manual review.' });
    await broadcastState();
    return store.getProject(projectId);
  });

  ipcMain.handle('project:update-tpt-publication', async (_event, projectId, settings = {}) => {
    const project = store.getProject(projectId);
    const listing = project?.tptListing;
    if (!listing) throw Object.assign(new Error('Create the GPT listing draft first.'), { code: 'TPT_LISTING_REQUIRED' });
    const seo = getSeo(project);
    const compactList = (value, limit) => String(value ?? '').split(/[\n,]/).map((item) => cleanText(item)).filter(Boolean).slice(0, limit);
    const title = settings.title != null ? cleanText(settings.title, seo.title || project.name) : (seo.title || project.name || '');
    const description = settings.description != null ? cleanText(settings.description, seo.description || '') : (seo.description || '');
    const tags = settings.tags != null ? compactList(settings.tags, 6) : (seo.tags || []);
    const grades = settings.grades != null ? compactList(settings.grades, 4) : (seo.grades || []);
    const subjects = settings.subjects != null ? compactList(settings.subjects, 3) : (seo.subjects || []);
    const formats = settings.formats != null ? compactList(settings.formats, 3) : (seo.formats || []);
    const customCategories = settings.customCategories != null ? compactList(settings.customCategories, 8) : (seo.customCategories || []);
    const sanitizedSeo = sanitizeSeoListingFields({ title, description, tags, subjects });
    const pageCount = settings.pageCount != null ? Math.max(0, Number.parseInt(settings.pageCount, 10) || 0) : (seo.pageCount || 0);
    const standards = {
      ccss: settings.ccss != null ? compactList(settings.ccss, 50) : (seo.standards?.ccss || []),
      ngss: settings.ngss != null ? compactList(settings.ngss, 50) : (seo.standards?.ngss || []),
      teks: settings.teks != null ? compactList(settings.teks, 50) : (seo.standards?.teks || []),
      vaSol: settings.vaSol != null ? compactList(settings.vaSol, 50) : (seo.standards?.vaSol || [])
    };
    const m = getMarketplace({ tptListing: listing }).settings;
    const isFreeResource = settings.isFreeResource != null
      ? settings.isFreeResource === true
      : m.isFreeResource === true;
    const suggestedPrice = settings.suggestedPrice != null
      ? cleanText(settings.suggestedPrice)
      : (m.suggestedPrice || '');
    const multipleLicensePrice = settings.multipleLicensePrice != null
      ? cleanText(settings.multipleLicensePrice)
      : (m.multipleLicensePrice || '');
    const bundleDiscountPrice = settings.bundleDiscountPrice != null
      ? cleanText(settings.bundleDiscountPrice)
      : (m.bundleDiscountPrice || '');
    const taxCode = settings.taxCode != null ? cleanText(settings.taxCode) : (m.taxCode || '');
    const copyrightDeclaration = settings.copyrightDeclaration != null
      ? (['original', 'licensed'].includes(settings.copyrightDeclaration) ? settings.copyrightDeclaration : '')
      : (m.copyrightDeclaration || '');
    const publicationStatus = settings.publicationStatus != null
      ? (settings.publicationStatus === 'active' ? 'active' : 'draft')
      : (m.publicationStatus === 'active' ? 'active' : 'draft');
    const thumbnailMode = settings.thumbnailMode != null && ['auto', 'manual', 'later'].includes(settings.thumbnailMode)
      ? settings.thumbnailMode
      : (listing.thumbnailMode || 'manual');
    const publicationChanges = {
      title: sanitizedSeo.title,
      description: sanitizedSeo.description,
      tags: sanitizedSeo.tags,
      grades,
      subjects: sanitizedSeo.subjects || subjects,
      formats,
      customCategories,
      pageCount,
      teachingDuration: settings.teachingDuration != null ? cleanText(settings.teachingDuration) : (listing.teachingDuration || ''),
      answerKey: settings.answerKey != null ? cleanText(settings.answerKey) : (listing.answerKey || ''),
      standards,

      thumbnailMode,
      seoText: formatSeoBundleText(sanitizedSeo)
    };
    const materialChanged = Object.entries(publicationChanges)
      .some(([key, value]) => JSON.stringify(listing[key] ?? null) !== JSON.stringify(value ?? null));
    const nextListing = materialChanged
      ? invalidateTptListingReview(listing, { ...publicationChanges, status: 'draft_reviewing' })
      : { ...listing, ...publicationChanges };
    store.updateProject(projectId, {
      tptListing: applyMockupsToListing(nextListing, { mode: thumbnailMode })
    });
    store.appendEvent({ projectId, level: 'success', message: 'TPT publication settings saved locally.' });
    await broadcastState();
    return store.getProject(projectId);
  });

  ipcMain.handle('project:choose-tpt-asset', async (_event, projectId, assetType) => {
    const project = store.getProject(projectId);
    const listing = project?.tptListing;
    if (!project || !listing) throw Object.assign(new Error('Create the GPT listing draft first.'), { code: 'TPT_LISTING_REQUIRED' });
    const definition = assetType === 'videoPreview'
      ? { title: 'Choose an optional TPT video preview', extensions: ['mp4', 'mov', 'm4v', 'webm'], key: 'videoPreviewPath', maxBytes: 1024 * 1024 * 1024, stem: 'video-preview' }
      : { title: 'Choose an optional TPT product preview', extensions: ['pdf'], key: 'previewPdfPath', maxBytes: 30 * 1024 * 1024, stem: 'product-preview' };
    const choice = await dialog.showOpenDialog(mainWindow, {
      title: definition.title,
      properties: ['openFile'],
      filters: [{ name: assetType === 'videoPreview' ? 'Video preview' : 'PDF preview', extensions: definition.extensions }]
    });
    if (choice.canceled || !choice.filePaths[0]) return null;
    const sourcePath = choice.filePaths[0];
    if (statSync(sourcePath).size > definition.maxBytes) {
      throw Object.assign(new Error(`${definition.title} exceeds TPT's current file-size limit.`), { code: 'TPT_FILE_TOO_LARGE' });
    }
    const assetDirectory = join(project.outputDir, 'tpt-assets');
    mkdirSync(assetDirectory, { recursive: true });
    const outputPath = join(assetDirectory, `${definition.stem}${extname(sourcePath).toLowerCase()}`);
    copyFileSync(sourcePath, outputPath);
    store.updateProjectTransactionally(projectId, (currentProject) => {
      let nextListing = invalidateTptListingReview(currentProject.tptListing || {}, { status: 'draft_reviewing' });
      if (assetType === 'videoPreview') {
        nextListing = applyVideoToListing(nextListing, {
          path: outputPath,
          status: 'ready',
          error: null
        });
      } else {
        nextListing = { ...nextListing, previewPdfPath: outputPath };
      }
      return { tptListing: nextListing };
    });
    store.appendEvent({ projectId, level: 'success', message: `${assetType === 'videoPreview' ? 'Video preview' : 'Product preview'} saved to the local TPT asset package.` });
    await broadcastState();
    return store.getProject(projectId);
  });

  ipcMain.handle('project:clear-tpt-asset', async (_event, projectId, assetType) => {
    const project = store.getProject(projectId);
    const listing = project?.tptListing;
    if (!listing) throw Object.assign(new Error('Create the GPT listing draft first.'), { code: 'TPT_LISTING_REQUIRED' });
    store.updateProjectTransactionally(projectId, (currentProject) => {
      let nextListing = invalidateTptListingReview(currentProject.tptListing || {}, { status: 'draft_reviewing' });
      if (assetType === 'videoPreview') {
        nextListing = applyVideoToListing(nextListing, {
          path: null,
          status: 'pending',
          error: null,
          conversationUrl: null
        });
      } else {
        nextListing = { ...nextListing, previewPdfPath: null };
      }
      return { tptListing: nextListing };
    });
    await broadcastState();
    return store.getProject(projectId);
  });

  ipcMain.handle('tpt:open-upload', () => { throw Object.assign(new Error('TPT posting has been permanently removed from VERSA (editable-only brain).'), { code: 'TPT_UPLOAD_REMOVED' }); });
  ipcMain.handle('tpt:complete-human-verification', () => { throw Object.assign(new Error('TPT posting has been permanently removed from VERSA (editable-only brain).'), { code: 'TPT_UPLOAD_REMOVED' }); });
  ipcMain.handle('tpt:open-saved-listing', (_event, listingUrl) => {
    let parsed;
    try {
      parsed = new URL(String(listingUrl || ''));
    } catch {
      throw Object.assign(new Error('The saved GPT listing link is invalid.'), { code: 'TPT_LISTING_URL_INVALID' });
    }
    if (parsed.protocol !== 'https:' || !/(^|\.)teacherspayteachers\.com$/i.test(parsed.hostname)) {
      throw Object.assign(new Error('Only saved Teachers Pay Teachers listing links can be opened.'), { code: 'TPT_LISTING_URL_INVALID' });
    }
    return shell.openExternal(parsed.href);
  });

  // Core helper — executes a single project TPT upload end-to-end (prepare + optional auto-submit).
  async function executeTptUpload(projectId) {
  // VERSA editable-brain: TPT posting permanently removed. Single choke disables every entry path.
  throw Object.assign(new Error('TPT posting has been permanently removed from VERSA (editable-only brain).'), { code: 'TPT_UPLOAD_REMOVED' });
    const project = store.getProject(projectId);
    const listing = project?.tptListing;
    if (!project || !listing?.productPdfPath || !tptListingReviewApproved(listing)) {
      throw Object.assign(new Error('Mark the listing ready only after reviewing its PDF, complete metadata, commercial fields, and chosen thumbnail mode.'), { code: 'TPT_REVIEW_INCOMPLETE' });
    }
    const updateProgress = async ({ stage, message }) => {
      const current = store.getProject(projectId)?.tptListing ?? listing;
      store.updateProject(projectId, {
        tptListing: applyMarketplaceToListing({
          ...current,
          status: stage === 'ready_for_listing_submit' ? 'listing_form_ready' : 'uploading_listing',
          uploadStartedAt: current.uploadStartedAt ?? new Date().toISOString()
        }, {
          upload: {
            stage,
            message,
            error: null
          }
        })
      });
      store.appendEvent({ projectId, level: 'info', message: `TPT upload: ${message}` });
      await broadcastState();
    };
    await updateProgress({ stage: 'opening', message: 'Opening the app-owned Chromium and the TPT upload form…' });
    const result = await browser.runTptListingPreparation({ listing, projectId, onProgress: updateProgress });
    const current = store.getProject(projectId)?.tptListing ?? listing;
    store.updateProject(projectId, {
      tptListing: applyMarketplaceToListing({
        ...current,
        status: 'listing_form_ready',
        uploadUrl: result.url,
        standardsRequireReview: result.standardsRequireReview
      }, {
        upload: {
          formContract: result.formContract,
          stage: 'ready_for_listing_submit',
          error: null,
          message: getMarketplace({ tptListing: listing }).settings.publicationStatus === 'active' || result.standardsRequireReview
            ? `All automated steps completed. The TPT form is ready for final ${getMarketplace({ tptListing: listing }).settings.publicationStatus === 'active' ? 'Active' : 'Draft'} submission.`
            : 'All automated steps completed. Submitting the inactive TPT draft automatically…'
        }
      })
    });
    const autoSubmitDraft = getMarketplace(project).settings.publicationStatus !== 'active' && !result.standardsRequireReview;
    store.appendEvent({
      projectId,
      level: 'success',
      message: autoSubmitDraft
        ? 'TPT form prepared for an inactive draft. Continuing directly to final submission.'
        : `TPT form prepared for ${getMarketplace(project).settings.publicationStatus === 'active' ? 'an active listing' : 'a draft with education standards that require review'}. Review it in TPT before final submission.`
    });
    await broadcastState();
    if (autoSubmitDraft) {
      await submitPreparedTptListing(projectId, true);
      return store.getProject(projectId);
    }
    return result;
  }

  ipcMain.handle('project:start-tpt-upload', async (_event, projectId) => {
    assertIdle();
    if (tptListingAutomationActive) {
      throw Object.assign(new Error('A TPT upload is already opening. Keep the app-owned Chrome window open and wait for the current attempt.'), {
        code: 'TPT_UPLOAD_ALREADY_RUNNING'
      });
    }
    tptListingAutomationActive = true;
    try {
      return await executeTptUpload(projectId);
    } catch (error) {
      if (error?.tptSubmissionHandled) throw error;
      const project = store.getProject(projectId);
      const listing = project?.tptListing;
      if (listing) {
        store.updateProject(projectId, {
          tptListing: applyMarketplaceToListing({
            ...listing,
            status: 'upload_failed'
          }, {
            upload: {
              stage: getMarketplace(project).upload.stage ?? 'opening',
              error: error.message,
              message: `Stopped: ${error.message}`
            }
          })
        });
        store.appendEvent({ projectId, level: 'error', message: `TPT upload stopped at ${getMarketplace({ tptListing: listing }).upload.stage ?? 'opening'}: ${error.message}` });
        await broadcastState();
      }
      throw error;
    } finally {
      tptListingAutomationActive = false;
    }
  });

  // Bundle upload loop — uploads all ready_to_upload projects sequentially.
  async function runBundleUploadLoop() {
    return runBundleUploadSequence({
      projectIds: bundleUploadQueue,
      isActive: () => bundleUploadActive,
      onCurrent: async (projectId) => {
        bundleUploadCurrentId = projectId;
        await broadcastState();
      },
      execute: executeTptUpload,
      onCompleted: async (projectId) => {
        bundleUploadQueue = bundleUploadQueue.filter((id) => id !== projectId);
        await broadcastState();
      },
      onError: async (projectId, error, { handledFailure }) => {
        const project = store.getProject(projectId);
        const listing = project?.tptListing;
        if (listing && !getMarketplace(project).upload.error) {
          store.updateProject(projectId, {
            tptListing: applyMarketplaceToListing({
              ...listing,
              status: 'upload_failed'
            }, {
              upload: {
                stage: getMarketplace({ tptListing: listing }).upload.stage ?? 'opening',
                error: error.message,
                message: handledFailure
                  ? `This product failed; the bundle continued safely: ${error.message}`
                  : `Bundle stopped: ${error.message}`
              }
            })
          });
          store.appendEvent({
            projectId,
            level: 'error',
            message: handledFailure
              ? `Bundle upload skipped failed project ${projectId} and continued: ${error.message}`
              : `Bundle upload stopped at project ${projectId}: ${error.message}`
          });
        }
        if (!handledFailure) bundleUploadActive = false;
        await broadcastState();
      },
      onFinally: async () => {
        bundleUploadActive = false;
        bundleUploadCurrentId = null;
        tptListingAutomationActive = false;
        await broadcastState();
      }
    });
  }

  ipcMain.handle('bundle-upload:start', async () => {
    throw Object.assign(new Error('TPT bundle upload has been permanently removed from VERSA (editable-only brain).'), { code: 'TPT_UPLOAD_REMOVED' });
    assertIdle();
    if (tptListingAutomationActive) {
      throw Object.assign(new Error('A TPT upload is already in progress. Wait for the current upload to finish first.'), { code: 'TPT_UPLOAD_ALREADY_RUNNING' });
    }
    // Gather all projects that are ready_to_upload
    const readyProjects = store.listProjects().filter(
      (p) => p.tptListing?.status === 'ready_to_upload' && p.tptListing?.productPdfPath && tptListingReviewApproved(p.tptListing)
    );
    if (readyProjects.length === 0) {
      throw Object.assign(new Error('No projects are ready to upload. Mark at least one listing ready before starting the bundle.'), { code: 'BUNDLE_QUEUE_EMPTY' });
    }
    bundleUploadActive = true;
    bundleUploadQueue = readyProjects.map((p) => p.id);
    bundleUploadCurrentId = null;
    tptListingAutomationActive = true;
    await broadcastState();
    // Fire-and-forget: run the loop in the background
    runBundleUploadLoop().catch((err) => {
      console.error('Bundle upload loop crashed unexpectedly:', err);
      bundleUploadActive = false;
      bundleUploadCurrentId = null;
      tptListingAutomationActive = false;
      broadcastState().catch(() => {});
    });
    return { queued: readyProjects.length };
  });

  ipcMain.handle('bundle-upload:stop', async () => {
    bundleUploadActive = false;
    if (!bundleUploadCurrentId) {
      tptListingAutomationActive = false;
    }
    await broadcastState();
    return { stopping: Boolean(bundleUploadCurrentId), remaining: bundleUploadQueue.length };
  });

  async function submitPreparedTptListing(projectId, forceDraft = false) {
    const project = store.getProject(projectId);
    const listing = project?.tptListing;
    const isReadyOrApprovedFailed = ['listing_form_ready', 'draft_form_ready'].includes(listing?.status) || (listing?.status === 'upload_failed' && Boolean(getMarketplace(project).review.approvedAt));
    if (!project || !isReadyOrApprovedFailed) {
      throw Object.assign(new Error('Prepare and review the TPT form before submitting it.'), { code: 'TPT_LISTING_NOT_READY' });
    }
    const submissionListing = forceDraft ? applyMarketplaceToListing(listing, { settings: { publicationStatus: 'draft' } }) : listing;
    const statusLabel = getMarketplace({ tptListing: submissionListing }).settings.publicationStatus === 'active' ? 'active listing' : 'inactive draft';
    const updateProgress = async ({ stage, message }) => {
      store.updateProjectTransactionally(projectId, (currentProject) => {
        const current = currentProject.tptListing || listing;
        return { tptListing: applyMarketplaceToListing({ ...current, status: 'submitting_listing' }, { upload: { stage, message } }) };
      });
      store.appendEvent({ projectId, level: 'info', message: `TPT upload: ${message}` });
      await broadcastState();
    };
    try {
      const result = await browser.submitTptListing({ listing: submissionListing, projectId, onProgress: updateProgress });
      const current = store.getProject(projectId)?.tptListing ?? listing;
      const completedStatus = result.publicationStatus === 'active' ? 'listing_published' : 'draft_submitted';
      store.updateProjectTransactionally(projectId, (currentProject) => {
        const currentListing = currentProject.tptListing || listing;
        return { tptListing: applyMarketplaceToListing({ ...currentListing, status: completedStatus, uploadedAt: new Date().toISOString() }, { settings: { publicationStatus: result.publicationStatus }, upload: { stage: completedStatus, productUrl: result.url, verified: result.verified } }) };
      });
      store.appendEvent({ projectId, level: 'success', message: `TPT ${statusLabel} submitted and verified in My Products.` });
      await broadcastState();
      return result;
    } catch (error) {
      error.tptSubmissionHandled = true;
      const current = store.getProject(projectId)?.tptListing ?? listing;
      const preparedFormLost = ['TPT_PAGE_CLOSED', 'TPT_PREPARED_FORM_STALE', 'TPT_REQUIRED_METADATA_MISSING'].includes(error.code);
      store.updateProject(projectId, {
        tptListing: applyMarketplaceToListing({
          ...current,
          status: preparedFormLost ? 'upload_failed' : 'listing_form_ready'
        }, {
          upload: {
            error: error.message,
            message: preparedFormLost
              ? `The prepared TPT form needs automatic recovery. Resume uploading restores it without another listing review.`
              : `Submission stopped: ${error.message}`
          }
        })
      });
      store.appendEvent({ projectId, level: 'error', message: `GPT listing submission was not verified: ${error.message}` });
      await broadcastState();
      throw error;
    }
  }

  async function submitTptListingExclusively(projectId, forceDraft) {
    assertIdle();
    tptListingAutomationActive = true;
    try {
      return await submitPreparedTptListing(projectId, forceDraft);
    } finally {
      tptListingAutomationActive = false;
      await broadcastState();
    }
  }

  ipcMain.handle('project:submit-tpt-listing', async () => { throw Object.assign(new Error('TPT posting has been permanently removed from VERSA (editable-only brain).'), { code: 'TPT_UPLOAD_REMOVED' }); });
  ipcMain.handle('project:submit-tpt-draft', async () => { throw Object.assign(new Error('TPT posting has been permanently removed from VERSA (editable-only brain).'), { code: 'TPT_UPLOAD_REMOVED' }); });

  ipcMain.handle('path:reveal', (_event, targetPath) => {
    if (!targetPath || !existsSync(targetPath)) return false;
    // A directory is opened, not "revealed" - showItemInFolder on a folder selects it in
    // its parent, which is one level away from what the user asked to see.
    if (statSync(targetPath).isDirectory()) shell.openPath(targetPath);
    else shell.showItemInFolder(targetPath);
    return true;
  });

  ipcMain.handle('project:rename', async (_event, projectId, newName) => {
    const project = store.getProject(projectId);
    if (!project) throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });
    const cleanedName = cleanText(newName, project.name);
    store.updateProject(projectId, { name: cleanedName });
    store.appendEvent({ projectId, level: 'info', message: `Project renamed to: ${cleanedName}` });
    await broadcastState();
    return store.getProject(projectId);
  });

  ipcMain.handle('project:delete', async (_event, projectId) => {
    assertNotGeneratingProject(projectId, 'deleting this book');
    const project = store.getProject(projectId);
    if (!project) throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });

    // 1. Delete SQLite record
    store.deleteProject(projectId);

    // 2. Move the book's folder to the Trash. Never rmSync.
    //
    // This used to be fs.rmSync(outputDir, { recursive: true, force: true }): permanent,
    // instant, and unrecoverable. A book is hours of generation and the only copy of
    // artwork that cost real credits to produce, so deleting it must be undoable. The
    // Trash costs nothing and gives the operator a way back.
    if (project.outputDir && existsSync(project.outputDir)) {
      const target = resolve(project.outputDir);
      const library = resolve(getLibraryRoot());
      // Refuse anything that is not inside the library. A malformed outputDir - blank,
      // "/", a home directory - would otherwise hand a recursive delete an enormous
      // target. Belt and braces now that the call is trash-based anyway.
      const insideLibrary = target !== library && target.startsWith(`${library}${sep}`);
      if (!insideLibrary) {
        store.appendEvent({
          projectId, level: 'warn',
          message: `Left files untouched: "${target}" is outside the book library, so it was not deleted.`
        });
      } else {
        try {
          await shell.trashItem(target);
          store.appendEvent({
            projectId, level: 'info',
            message: 'Book files moved to the Trash. Recover them from there if this was a mistake.'
          });
        } catch (err) {
          // Failing to delete is safe; deleting the wrong thing is not. Report and stop.
          store.appendEvent({
            projectId, level: 'warn',
            message: `Book record removed, but its files could not be moved to the Trash: ${err.message}`
          });
        }
      }
    }

    // 3. Reset selectedProjectId if deleted project was selected
    if (store.getSetting('selectedProjectId') === projectId) {
      const remaining = store.listProjects();
      const nextSelected = remaining[0]?.id || null;
      store.setSetting('selectedProjectId', nextSelected);
    }

    await broadcastState();
    return buildState();
  });

  ipcMain.handle('project:set-when-complete', async (_event, action) => {
    const normalizedAction = ['nothing', 'sleep', 'shutdown'].includes(action) ? action : 'nothing';
    store.setSetting('whenCompleteAction', normalizedAction);
    const preferences = getPreferences();
    preferences.workflow.whenCompleteAction = normalizedAction;
    store.setSetting('userPreferences', preferences);
    await broadcastState();
    return buildState();
  });

  ipcMain.handle('project:cancel-system-action', async () => {
    if (systemActionTimer) {
      clearInterval(systemActionTimer);
      systemActionTimer = null;
    }
    systemActionPayload = null;
    await broadcastState();
    return buildState();
  });

  // ─── Automation Pipeline IPC ──────────────────────────────────────────────

  ipcMain.handle('automation:get-settings', () => {
    return store.getAutomationSettings();
  });

  ipcMain.handle('automation:update-setting', async (_event, stepName, mode) => {
    store.setAutomationSetting(stepName, mode);
    await broadcastState();
    return store.getAutomationSettings();
  });

  ipcMain.handle('automation:start', async (_event, projectId = null) => {
    const status = automation.getStatus();
    const selected = String(projectId || store.getSetting('selectedProjectId') || '').trim() || null;
    if (!status.active) {
      if (!selected) {
        throw Object.assign(new Error('Select the book you want to automate, then click Start Full Automation.'), {
          code: 'PROJECT_NOT_FOUND'
        });
      }
      if (queue.running && queue.status()?.activeProjectId && queue.status().activeProjectId !== selected) {
        throw Object.assign(
          new Error(`"${generatingProjectName()}" is still generating. Pause it, then start full automation on this book.`),
          { code: 'QUEUE_RUNNING' }
        );
      }
      if (tptListingAutomationActive) {
        throw Object.assign(new Error('A TPT upload is already in progress. Wait for it to finish before starting automation.'), { code: 'TPT_UPLOAD_ALREADY_RUNNING' });
      }
      const sameBookQueue = queue.running && queue.status()?.activeProjectId === selected;
      if (!sameBookQueue) assertBrowserFree('full automation');
    }
    await automation.start({ projectId: selected });
    await broadcastState();
    return automation.getStatus();
  });

  ipcMain.handle('automation:pause', async () => pauseAllWork('Full automation paused.'));

  ipcMain.handle('automation:status', () => {
    return automation.getStatus();
  });

  ipcMain.handle('automation:resolve_ask', async (_event, decision) => {
    automation.resolveAsk(decision);
    await broadcastState();
    return automation.getStatus();
  });
}

if (singleInstanceAcquired) app.whenReady().then(async () => {
  bootLog('whenReady');
  agentLog('main.cjs:whenReady', 'whenReady', { windows: BrowserWindow.getAllWindows().length }, 'H5');
  await createSplashWindow();
  bootLog('splash created');
  startAutomationHttp({
    port: 31338,
    getAppName: () => APP_NAME,
    getHandlers: () => apiHandlers,
    getHealth: () => ({
      ready: Boolean(store && queue && browser),
      engine: store ? getActiveEngine() : null,
      queue: queue && typeof queue.status === 'function' ? queue.status() : null
    })
  });
  app.setAccessibilitySupportEnabled(true);
  const userData = app.getPath('userData');
  store = new ProjectStore(join(userData, 'tpt-books.sqlite'));
  setCustomizationSource(() => {
    try {
      return store?.getSetting('userPreferences', {})?.customization || null;
    } catch {
      return null;
    }
  });
  const { setWorkspaceRoot, migrateProjectWorkingFiles } = require('./project-workspace.cjs');
  setWorkspaceRoot(userData);
  for (const listed of store.listProjects()) {
    const loaded = store.getProject(listed.id);
    if (loaded) migrateProjectWorkingFiles(store, loaded);
  }
  applyNativeAppearance();
  nativeTheme.on('updated', () => {
    if (!store) return;
    applyNativeAppearance();
    broadcastState().catch(() => {});
  });
  if (store.getSetting('loginSessionSchemaVersion', 0) !== LOGIN_SESSION_SCHEMA_VERSION) {
    store.setSetting('loginSessionSchemaVersion', LOGIN_SESSION_SCHEMA_VERSION);
    store.setSetting('enableProfileSwapping', false);
  }
  if (process.env.TPT_TEST_USER_DATA && !process.env.TPT_TEST_REQUIRE_LOGIN) {
    store.setSetting('chatgptLoginConfirmed', true);
    store.setSetting('geminiLoginConfirmed', true);
    store.setSetting('metaLoginConfirmed', true);
  }
  store.recoverInterrupted();
  store.reconcileCompletedArtifacts();
  reconcileCompletedPipelineSteps();
  protocol.handle('tpt-image', async (request) => {
    const fs = require('node:fs');
    const { extname: pathExtname } = require('node:path');
    const mimeForPath = (filePath) => {
      switch (pathExtname(String(filePath || '')).toLowerCase()) {
        case '.png': return 'image/png';
        case '.jpg':
        case '.jpeg': return 'image/jpeg';
        case '.webp': return 'image/webp';
        case '.gif': return 'image/gif';
        case '.svg': return 'image/svg+xml';
        case '.mp4': return 'video/mp4';
        case '.webm': return 'video/webm';
        default: return 'application/octet-stream';
      }
    };
    const serveLocalFile = async (filePath) => {
      const serveStarted = Date.now();
      const body = await fs.promises.readFile(filePath);
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': mimeForPath(filePath),
          'Cache-Control': 'private, max-age=86400'
        }
      });
    };
    try {
      const url = new URL(request.url);
      if (url.hostname === 'character') {
        const [projectId, indexValue] = url.pathname.slice(1).split('/').map(decodeURIComponent);
        const project = store.getProject(projectId);
        const sheet = project?.characterSheets?.[Number.parseInt(indexValue, 10)];
        if (!sheet?.outputPath || !fs.existsSync(sheet.outputPath)) {
          return new Response('Not found', { status: 404 });
        }
        return serveLocalFile(sheet.outputPath);
      }
      if (url.hostname === 'thumbnail') {
        const [projectId, indexValue] = url.pathname.slice(1).split('/').map(decodeURIComponent);
        const thumbnailPath = getMockups(store.getProject(projectId))?.paths?.[Number.parseInt(indexValue, 10)];
        if (!thumbnailPath || !fs.existsSync(thumbnailPath)) return new Response('Not found', { status: 404 });
        return serveLocalFile(thumbnailPath);
      }
      if (url.hostname === 'video-preview') {
        const projectId = decodeURIComponent(url.pathname.slice(1).split('/')[0] || '');
        const videoPath = getVideo(store.getProject(projectId))?.path;
        if (!videoPath || !fs.existsSync(videoPath)) return new Response('Not found', { status: 404 });
        return serveLocalFile(videoPath);
      }
      if (url.hostname === 'competitor-mockup') {
        const [projectId, indexValue] = url.pathname.slice(1).split('/').map(decodeURIComponent);
        const mockupPath = store.getProject(projectId)?.competitorMockups?.images?.[Number.parseInt(indexValue, 10)]?.path;
        if (!mockupPath || !fs.existsSync(mockupPath)) return new Response('Not found', { status: 404 });
        return serveLocalFile(mockupPath);
      }
      if (url.hostname === 'maze') {
        return require('./maze-ipc.cjs').serveMazeImage(store, request);
      }
      if (url.hostname !== 'job') {
        return new Response('Not found', { status: 404 });
      }
      const jobId = decodeURIComponent(url.pathname.slice(1));
      const job = store.getJob(jobId);
      if (!job) {
        return new Response('Not found', { status: 404 });
      }
      if (!job.outputPath || !fs.existsSync(job.outputPath)) {
        return new Response('Not found', { status: 404 });
      }

      const rawMode = url.searchParams.get('raw') === 'true';
      const cardMode = url.searchParams.get('card') === '1';
      let targetPath = job.outputPath;
      if (rawMode && /\.png$/i.test(job.outputPath)) {
        const rawPath = job.outputPath.replace(/\.png$/i, '.raw.png');
        if (fs.existsSync(rawPath)) {
          targetPath = rawPath;
        }
      } else if (cardMode) {
        const cardPath = cardPreviewPathFor(job.outputPath);
        if (cardPath && fs.existsSync(cardPath)) {
          targetPath = cardPath;
        } else {
          try {
            const made = await ensureCardPreview(job.outputPath, cardPath);
            if (made) targetPath = made;
          } catch { /* fall back to the print PNG */ }
        }
      }
      // Serve SVG masters with image/svg+xml so <img> page-board / studio previews render.
      return serveLocalFile(targetPath);
    } catch {
      return new Response('Bad request', { status: 400 });
    }
  });
  fileManager = new ProductFileManager({ nativeImage });
  browser = new BrowserController({
    profileDir: require('os').homedir() + '/VERSA_PROFILES',
    downloadDir: join(userData, 'browser-downloads'),
    getMetaConfig
  });
  browser.attachStore(store);
  browser.on('supervisor', () => { broadcastState().catch(() => {}); });

  const savedRotation = store.getSetting('profileRotationList', []);
  const savedIndex = store.getSetting('currentProfileIndex', 0);
  const savedSwappingEnabled = store.getSetting('enableProfileSwapping', false);
  browser.enableProfileSwapping = Boolean(savedSwappingEnabled);
  if (Array.isArray(savedRotation) && savedRotation.length) {
    browser.setProfileRotation(savedRotation, savedIndex);
  }
  const savedPool = store.getSetting('accountPool', null);
  if (typeof browser.setAccountPool === 'function') {
    browser.setAccountPool({
      ...(savedPool && typeof savedPool === 'object' ? savedPool : {}),
      enabled: Boolean(savedSwappingEnabled)
    });
  }
  restoreSavedServiceLogins();
  browser.on('profile-swapped', (data) => {
    store.setSetting('currentProfileIndex', data.currentIndex);
    if (browser.accountPool) store.setSetting('accountPool', browser.accountPool.toJSON());
    broadcastState();
  });

  applyActiveEngineToBrowser();
  queue = new QueueEngine({ store, browser, fileManager });

  // The durable worker. Stages register as task handlers; the queue owns whether
  // and when they run, so a stall is a deadline rather than a hang and a restart
  // resumes instead of starting over.
  pipelineRunner = createPipelineRunner({
    store,
    watchdog: ({ runner, now, activeIds = [] }) => {
      const selectedId = store.getSetting('selectedProjectId', null);
      const project = selectedId ? store.getProject(selectedId) : null;
      const mazePages = project?.mazeProject?.pages || [];
      const report = applyPipelineWatchdog({
        store: store.tasks,
        runner,
        now,
        activeIds,
        mazePages,
        queueJobs: project?.jobs || [],
        lastProgressAt: browser?.supervisor?.checkpoint?.lastProgressAt || 0,
        expectedMazeTotal: project?.mazeLab?.pageCount || mazePages.length,
        expectedQueueTotal: project?.stats?.total || (project?.jobs || []).length
      });
      // #region agent log
      if (report.abandoned.length || report.restartWorker || report.queueStalled) {
        fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H122',location:'src/main.cjs:pipelineWatchdog',message:'pipeline watchdog inspected the job',data:{abandoned:report.abandoned.length,restartWorker:report.restartWorker,queueStalled:report.queueStalled,canComplete:report.canComplete,missing:report.maze?.missing||report.queue?.missing||[]},timestamp:Date.now()})}).catch(()=>{});
      }
      // #endregion
      return report;
    },
    handlers: {
      [TASK_KIND.ANALYSIS]: runAnalysisTask,
      [TASK_KIND.TREND_SCAN]: runTrendScanTask,
      // Every other stage is the same function the automation manager runs, wrapped
      // so the queue owns its durability. One definition, two callers: a stage
      // cannot behave differently depending on which path reached it.
      ...stageHandlers()
    },
    onEvent: (name, payload) => {
      const task = payload?.task;
      if (!task) return;
      if (name === 'failed' && payload.error) {
        store.appendEvent({
          projectId: task.projectId || null,
          level: 'error',
          message: `${task.kind} failed (attempt ${task.attempts}/${task.maxAttempts}): ${payload.error.message}`
        });
      }
      if (name === 'reclaimed') {
        store.appendEvent({
          projectId: task.projectId || null,
          level: 'warn',
          message: `${task.kind} was interrupted and has been requeued. It resumes from where it stopped.`
        });
      }
      broadcastState().catch(() => {});
    }
  });
  queue.on('changed', broadcastState);
  queue.on('log', (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('queue:log', event);
  });
  queue.on('heartbeat', (payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('queue:heartbeat', payload);
  });
  queue.on('auth-required', () => {
    const engine = getActiveEngine();
    if (engine === 'meta') store.setSetting('metaLoginConfirmed', false);
    else store.setSetting(loginConfirmedKey(engine), false);
    broadcastState();
  });
  queue.on('complete', async ({ projectId }) => {
    // An editable book's PDF/PPTX is published by the editable step, which the user
    // has not run yet at this point. Building it here would only report it as stale.
    // Maze books assemble locally after Maze Lab — they must not enter print-PDF.
    const format = store.getProject(projectId)?.productFormat;
    const awaitingEditableStep = format === 'editable';
    if (!awaitingEditableStep && format !== 'maze') {
      try {
        await ensureProductPdf(projectId, { force: true });
      } catch (error) {
        store.appendEvent({
          projectId,
          level: 'error',
          message: `Pages are complete, but the book PDF could not be built: ${error.message}`
        });
      }
    }
    const action = store.getSetting('whenCompleteAction', 'nothing');
    if (action === 'nothing') {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('notification:complete', { projectId });
      }
      return;
    }

    if (systemActionTimer) clearInterval(systemActionTimer);
    systemActionPayload = {
      actionType: action,
      secondsRemaining: 60,
      projectId
    };
    await broadcastState();

    systemActionTimer = setInterval(async () => {
      if (!systemActionPayload) {
        clearInterval(systemActionTimer);
        systemActionTimer = null;
        return;
      }
      systemActionPayload.secondsRemaining -= 1;
      if (systemActionPayload.secondsRemaining <= 0) {
        clearInterval(systemActionTimer);
        systemActionTimer = null;
        const finalAction = systemActionPayload.actionType;
        systemActionPayload = null;
        await broadcastState();
        executeSystemAction(finalAction);
      } else {
        await broadcastState();
      }
    }, 1000);
  });
  browser.on('status', (status) => {
    const key = `${Boolean(status?.connected)}|${Boolean(status?.unresponsive)}|${status?.engine || ''}`;
    if (key === lastBrowserStatusKey) return;
    lastBrowserStatusKey = key;
    broadcastState().catch(() => {});
  });
  browser.on('login-progress', (payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('browser:login-progress', payload);
    }
  });

  // ─── AutomationManager instantiation ─────────────────────────────────────
  // Step runners delegate to the same functions used by the manual workflow.
  const stepRunners = {
      // Projects enter this pipeline only after project creation has persisted
      // the overview, so the automated step validates that saved input.
      overview: async (projectId, onProgress) => {
        const project = store.getProject(projectId);
        verifyOverview(project);
        onProgress(100);
      },
      maze: async (projectId, onProgress) => {
        const { runMazeBook } = require('./maze-ipc.cjs');
        const { assertMazeBookReady } = require('./maze-export.cjs');
        const result = await runMazeBook(store, projectId, {
          skipArtwork: true,
          onProgress: ({ completed, total }) => {
            onProgress(total ? Math.round((completed / total) * 88) : 0);
          }
        }, { broadcastState, setLiveOperation });
        if (result.cancelled) {
          throw Object.assign(new Error('Maze generation was cancelled.'), { code: 'MAZE_CANCELLED' });
        }
        if (result.failed || result.remaining) {
          throw Object.assign(new Error('Maze pages are incomplete.'), { code: 'BOOK_INCOMPLETE' });
        }
        await assertMazeBookReady(store, projectId);
        onProgress(90);
        await continueMazeProductPipeline(projectId, { fromAutomation: true });
        onProgress(100);
      },
      // characters: generate all character references
      characters: async (projectId, onProgress) => {
        const project = ensureProjectOutputDirectory(projectId);
        if (!project || project.projectType !== 'storybook') return; // only storybook has characters
        await generateAllStorybookCharacterReferences(projectId);
        onProgress(100);
      },
      // interior: generate every page, then convert + compress the print PDF
      interior: async (projectId, onProgress) => {
        const project = ensureProjectOutputDirectory(projectId);
        if (!project) throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });
        if (!project.stats?.total) {
          throw Object.assign(new Error('Cannot generate interior for a project with 0 pages.'), { code: 'NO_PAGES' });
        }
        requireActiveEngine('interior generation');
        const finishPrintPdf = async () => {
          await ensureProductPdf(projectId, {
            onProgress: async (info) => {
              if (info?.stage === 'converting') onProgress(96);
              else if (info?.stage === 'compressing') onProgress(98);
              else if (info?.stage === 'ready') onProgress(100);
            }
          });
          onProgress(100);
        };
        if (project.stats.complete === project.stats.total && project.stats.total > 0) {
          await finishPrintPdf();
          return;
        }
        await runQueueToCompletion(projectId, onProgress);
        await finishPrintPdf();
      },
      editable_generation: runNativeEditableForProject,
      // Editable pipeline. Artwork reuses the interior page generator, minus the
      // print-PDF tail that editable products do not build.
      interior_artwork: async (projectId, onProgress) => {
        const project = ensureProjectOutputDirectory(projectId);
        if (!project) throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });
        if (!project.stats?.total) {
          throw Object.assign(new Error('Cannot generate artwork for a project with 0 pages.'), { code: 'NO_PAGES' });
        }
        requireActiveEngine('artwork generation');
        restoreDefaultArtworkPrompts(projectId);
        // This stage only draws. Reading the pages belongs to Interior Text, which is
        // what consumes the coordinates.
        await runQueueToCompletion(projectId, onProgress);
      },
      interior_text: async (projectId, onProgress) => {
        // Read every page locally, then compile each one into its own layered,
        // editable PDF. MobileSAM finds the objects, PaddleOCR finds the words and
        // where they sit, and the compiler redraws those words as live text in the
        // face the artwork itself used.
        const controller = new AbortController();
        editableAbortController = controller;
        // ComfyUI is a resident background server. Boot keeps it attached; this
        // stage only waits until it answers. Never shut it down when the book ends.
        const project = store.getProject(projectId);
        const { isTextFreeProject, prepareTextFreeManifests } = require('./text-free-pipeline.cjs');
        const { isRebuildPipelineEnabled, runRebuildLocalPass } = require('./rebuild-pipeline.cjs');
        if (isRebuildPipelineEnabled(store, project)) {
          const rebuildController = new AbortController();
          editableAbortController = rebuildController;
          try {
            return await runRebuildLocalPass({
              store,
              projectId,
              onProgress,
              signal: rebuildController.signal,
            });
          } finally {
            editableAbortController = null;
          }
        }
        if (isTextFreeProject(store, project)) {
          const prepared = prepareTextFreeManifests({ store, project });
          store.appendEvent({
            projectId,
            level: 'success',
            message: `Text-free masters confirmed: ${prepared.pages} page(s), ${prepared.zones} zone(s). Nothing was erased.`
          });
          onProgress(100);
          editableAbortController = null;
          return prepared;
        }
        const watchPages = (project?.jobs || []).map((job) => ({ jobId: job.id, pageNumber: job.pageNumber }));
        const observer = attachTextLabObserver(projectId, watchPages);
        try {
          observer.setPhase('starting');
          observer.setPhase('reading');
          // Reading owns the first 60% of the bar, compiling the rest.
          const vision = await runPageVision({
            store,
            projectId,
            signal: controller.signal,
            onActivity: textLabPageActivity(observer),
            onProgress: (value) => onProgress(Math.round(value * 0.6))
          });
          if (vision.failures.length) {
            console.warn(`[interior_text] ${vision.failures.length} page(s) could not be read: `
              + vision.failures.map((failure) => `p${failure.pageNumber} ${failure.code}`).join(', '));
          }
          const preferences = getPreferences();
          observer.setPhase('rebuilding');
          const built = await buildEditablePages({
            store,
            projectId,
            // Overlay keeps the artwork pixel-identical but leaves the text invisible,
            // so it is only useful for search. Replace is what "editable" means here.
            textMode: preferences.editableTextMode === 'overlay' ? 'overlay' : 'replace',
            objectLayers: Boolean(preferences.editableObjectLayers),
            signal: controller.signal,
            onActivity: textLabPageActivity(observer),
            onProgress: (value) => onProgress(60 + Math.round(value * 0.4))
          });
          console.log(`[interior_text] ${built.pages} editable pages `
            + `(${built.compiled} compiled, ${built.reused} reused), `
            + `${built.editableText} live text runs, ${built.bakedText} left in artwork, `
            + `fonts: ${built.fonts.join(', ') || 'none matched'}`);
          return;
        } catch (error) {
          if (error.code === 'CANCELLED') throw error;
          // Fall through to the gem only when the local pipeline is genuinely absent.
          if (!['PYTHON_ENV_MISSING', 'WORKER_MISSING', 'CHECKPOINT_MISSING', 'VISION_UNAVAILABLE'].includes(error.code)) {
            throw error;
          }
          console.warn(`[interior_text] local vision unavailable (${error.code}); using the gem.`);
        } finally {
          observer.stop();
          editableAbortController = null;
        }
        requireGeminiForPlanning('page text');
        const fallback = new AbortController();
        editableAbortController = fallback;
        browser.beginWork?.();
        try {
          await generateEditablePageText({
            store,
            projectId,
            provider: createEditableBrowserProvider(browser, { signal: fallback.signal, onActivity: () => {} }),
            signal: fallback.signal,
            onProgress
          });
        } finally {
          editableAbortController = null;
        }
      },
      // Editable PPTX - combine every editable page from Interior Text into one
      // layered book. Concatenation, so the artwork keeps the exact bytes that stage
      // produced and nothing is re-encoded.
      editable_ppt: async (projectId, onProgress) => {
        const project = store.getProject(projectId);
        const { isTextFreeProject } = require('./text-free-pipeline.cjs');
        const { isRebuildPipelineEnabled, runRebuildLocalPass } = require('./rebuild-pipeline.cjs');
        if (isRebuildPipelineEnabled(store, project)) {
          const { listRebuildPages } = require('./rebuild-page-record.cjs');
          const { editableDeckPath } = require('./editable-layered-pptx.cjs');
          const pages = listRebuildPages(store, project);
          const deck = editableDeckPath(project);
          if (pages.length && pages.every((page) => page.state === 'COMPLETE') && existsSync(deck)) {
            onProgress(100);
            return { outputPath: deck, reused: true };
          }
          return runRebuildLocalPass({ store, projectId, onProgress });
        }
        if (isTextFreeProject(store, project) || (project && listEditablePages(project).length)) {
          await assembleEditableDeliverables(projectId, onProgress);
          return;
        }
        await runNativeEditableForProject(projectId, onProgress);
      },
      // thumbnails: generate 4 marketing thumbnails
      thumbnails: async (projectId, onProgress) => {
        requireActiveEngine('thumbnail generation');
        const project = await ensureListingShellForAssets(projectId);
        const listing = project?.tptListing;
        if (!project || !listing?.productPdfPath) {
          throw Object.assign(new Error('Complete every page before mockups.'), { code: 'BOOK_INCOMPLETE' });
        }
        const thumbnailPaths = [...getMockups(project).paths];
        store.updateProject(projectId, {
          tptListing: applyMockupsToListing(
            invalidateTptListingReview(listing, { status: 'thumbnails_generating' }),
            {
              paths: thumbnailPaths,
              progress: { completed: thumbnailPaths.filter(Boolean).length, total: 4 },
              error: null
            }
          )
        });
        await broadcastState();
        let thumbCount = thumbnailPaths.filter(Boolean).length;
        const sourceDocPath = await ensureMarketingGroundTruth(projectId);
        await browser.generateTptThumbnailsWithGpt({ project, pdfPath: sourceDocPath, listing, onThumbnail: async ({ index, buffer, conversationUrl }) => {
          const outputPath = await fileManager.saveGeneratedThumbnail({ buffer, fileName: `thumbnail_${index + 1}.png`, outputDir: project.outputDir });
          thumbnailPaths[index] = outputPath;
          thumbCount += 1;
          store.updateProjectTransactionally(projectId, (c) => ({ tptListing: applyMockupsToListing((c.tptListing || listing || {}), {
              paths: thumbnailPaths,
              conversationUrl,
              progress: { completed: thumbCount, total: 4 },
              error: null
            }, { status: 'thumbnails_generating' }) }));
          store.appendEvent({ projectId, level: 'success', message: `[Automation] Thumbnail ${index + 1}/4 saved.` });
          onProgress(Math.round((thumbCount / 4) * 100));
          await broadcastState();
        }});
        store.updateProjectTransactionally(projectId, (c) => ({ tptListing: applyMockupsToListing((c.tptListing || listing || {}), {
            paths: thumbnailPaths,
            progress: { completed: 4, total: 4 },
            error: null
          }, { status: 'assets_ready' }) }));
        await broadcastState();
        onProgress(100);
      },
      preview: async (projectId, onProgress) => {
        const project = await ensureListingShellForAssets(projectId);
        const listing = project?.tptListing;
        if (!project || !listing) {
          throw Object.assign(new Error('Complete every page before preview.'), { code: 'BOOK_INCOMPLETE' });
        }
        if (hasValidVideoFile(project)) {
          onProgress(100);
          return;
        }
        await generatePreviewVideoForProject(projectId, { onProgress });
      },
      // export: manifest-backed ZIP pack with every required buyer deliverable.
      export: async (projectId, onProgress) => {
        const project = ensureProjectOutputDirectory(projectId);
        if (!project) throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });
        if (project.stats.complete !== project.stats.total || project.stats.total === 0) {
          throw Object.assign(new Error('All pages must be complete before export.'), { code: 'BOOK_INCOMPLETE' });
        }
        onProgress(25);
        const current = store.getProject(projectId) || project;
        // Dual export for editable products. The deck is the primary deliverable - it
        // is what a buyer can actually drag and retype in - and the layered PDF is the
        // secondary. A failure in either is reported and does not cancel the other or
        // the ZIP, because a missing optional artefact is not a reason to lose a
        // finished book.
        let deckPath = null;
        try {
          deckPath = await fileManager.exportPptx(current, { store });
          onProgress(45);
        } catch (error) {
          store.appendEvent({
            projectId, level: 'warn',
            message: `[Automation] Editable PPTX skipped: ${error.code || error.message}`
          });
        }
        await fileManager.exportZip(current, { store });
        store.appendEvent({
          projectId,
          level: 'success',
          message: deckPath
            ? '[Automation] Export ZIP ready (editable PPTX, PDF, DOCX, 4 mockups, preview video, listing details).'
            : '[Automation] Export ZIP ready (PDF, PPTX, DOCX, 4 mockups, preview video, listing details).'
        });
        await broadcastState();
        onProgress(100);
      }
  };
  // Published so the durable queue runs the same functions.
  pipelineStepRunners = stepRunners;
  // Started only once the handlers can reach their runners: a task leased before
  // this line would fail for no reason other than boot order.
  pipelineRunner.start();

  automation = new AutomationManager({
    store,
    /**
     * Run an automated step as a durable task.
     *
     * The manager keeps what it is good at — retries, verification, notifications,
     * the stall watchdog. What it gives up is holding the work on its own stack:
     * the stage becomes a committed row, so a crash mid-step resumes from its
     * checkpoint instead of starting the stage again.
     *
     * maxAttempts is 1 on purpose. The manager already retries with its own
     * backoff; letting the queue retry as well would multiply the two.
     *
     * A stage the queue does not know about falls through to the runner directly,
     * so adding a step does not silently stop it working.
     */
    dispatchStep: async ({ step, projectId, onProgress, runner }) => {
      const kind = stepToTaskKind(step);
      if (!kind || !pipelineRunner) return runner(projectId, onProgress);
      const task = store.tasks.enqueue({
        kind,
        projectId,
        dedupeKey: dedupeKey(kind, projectId, step),
        payload: { projectId, step },
        maxAttempts: 1
      });
      const unsubscribe = (() => {
        const onTaskProgress = ({ task: t, percent }) => {
          if (t.id === task.id) onProgress(percent);
        };
        pipelineRunner.on('progress', onTaskProgress);
        return () => pipelineRunner.off('progress', onTaskProgress);
      })();
      try {
        const finished = await awaitTask(store, task.id, { timeoutMs: 24 * 60 * 60_000, pollMs: 500 });
        return finished.result;
      } finally {
        unsubscribe();
      }
    },
    broadcast: broadcastState,
    abortStep: async (step, projectId) => {
      if (['editable_generation', 'editable_ppt', 'interior_text'].includes(step)) editableAbortController?.abort();
      if (step === 'maze') require('./maze-lab.cjs').abortMazeGeneration(projectId);
      store.appendEvent({
        projectId,
        level: 'warn',
        message: `[Automation] Force-closing the browser session for the frozen step "${step}".`,
        details: { code: 'STEP_ABORT' }
      });
      let queueShutdown = null;
      if (step === 'interior') {
        try { queueShutdown = queue.pauseAndWait({ timeoutMs: 5_000 }); } catch {}
      }
      browser.abortTptHumanVerification?.(
        Object.assign(new Error(`The "${step}" step was aborted because it stopped responding.`), { code: 'STEP_ABORTED' })
      );
      await browser.close().catch(() => {});
      if (queueShutdown) {
        const result = await queueShutdown.catch(() => ({ settled: false }));
        if (!result.settled) {
          store.appendEvent({
            projectId,
            level: 'warn',
            message: '[Automation] The interior queue is still shutting down; the retry fence will wait for the interior runner before allowing another attempt.',
            details: { code: 'QUEUE_STOP_PENDING' }
          });
        }
      }
    },
    resetBeforeRetry: async (step, projectId, attempt) => {
      browser.cancelWaits();
      store.appendEvent({
        projectId,
        level: 'info',
        message: `[Automation] Reset the ${step} step before retry ${attempt} without relaunching Canary.`
      });
    },
    onPause: () => {
      editableAbortController?.abort();
      require('./maze-lab.cjs').abortAllMazeGeneration();
      try { queue.pause(); } catch {}
      try { browser.cancelWaits(); } catch {}
    },
    onResume: () => {
      const currentId = automation.getStatus().currentProjectId;
      const step = automation.getStatus().currentStep;
      if (step === 'interior' && currentId) {
        const project = store.getProject(currentId);
        if (project?.stats?.total && project.stats.complete < project.stats.total) {
          queue.start(currentId);
        }
      }
    },
    stepVerifiers: {
      listing: (projectId) => {
        const listing = sanitizeSeoListingFields(store.getProject(projectId)?.tptListing || {});
        const missing = [];
        if (!listing?.title) missing.push('title');
        if (!listing?.description) missing.push('description');
        if (!(listing?.subjects?.length)) missing.push('subject areas');
        if (!(listing?.tags?.length)) missing.push('tags');
        if (missing.length) {
          throw Object.assign(
            new Error(`The generated TPT listing is missing ${missing.join(', ')}.`),
            { code: 'TPT_LISTING_INCOMPLETE' }
          );
        }
      },
      thumbnails: (projectId) => {
        const saved = countValidMockupPaths(store.getProject(projectId));
        if (saved < 4) {
          throw Object.assign(
            new Error(`Only ${saved} of 4 marketing thumbnails were generated.`),
            { code: 'TPT_THUMBNAILS_INCOMPLETE' }
          );
        }
      },
      preview: (projectId) => {
        // Filesystem authority: only an existing MP4 counts as complete.
        if (hasValidVideoFile(store.getProject(projectId))) return;
        throw Object.assign(
          new Error('The Veo 3 teacher preview video was not saved.'),
          { code: 'TPT_PREVIEW_INCOMPLETE' }
        );
      },
      interior: (projectId) => {
        const project = store.getProject(projectId);
        const stats = project?.stats;
        if (!stats?.total || stats.complete !== stats.total) {
          throw Object.assign(
            new Error(`Only ${stats?.complete ?? 0} of ${stats?.total ?? 0} pages finished generating.`),
            { code: 'BOOK_INCOMPLETE' }
          );
        }
        const compressed = hasValidPdfFile(getPdf(project).compressedPath) ? getPdf(project).compressedPath : compressedPrintPdfDest(project.outputDir, project);
        if (!compressed || !existsSync(compressed)) {
          throw Object.assign(
            new Error('Interior pages finished, but the compressed print PDF is not ready.'),
            { code: 'PRINT_PDF_MISSING' }
          );
        }
      },
      editable_generation: (projectId) => {
        verifyEditableOutput(store.getProject(projectId));
      },
      interior_artwork: (projectId) => {
        const project = store.getProject(projectId);
        if (!allInteriorPagesComplete(project)) {
          throw Object.assign(new Error('Every page needs finished artwork.'), { code: 'BOOK_INCOMPLETE' });
        }
      },
      interior_text: (projectId) => {
        const project = store.getProject(projectId);
        const { isTextFreeProject, readStoredManifest } = require('./text-free-pipeline.cjs');
        if (isTextFreeProject(store, project)) {
          const missing = (project.jobs || []).filter((job) => !readStoredManifest(store, project, job));
          if (missing.length) {
            throw Object.assign(new Error(`Text-free manifests are still missing for ${missing.length} page(s).`), { code: 'EDITABLE_MANIFEST_MISSING' });
          }
          return;
        }
        // Either output satisfies this stage: compiled editable pages when the local
        // pipeline ran, or the cached per-page text when the gem fallback did.
        if (listEditablePages(project).length) return;
        const missing = (project.jobs || []).filter((job) => !readCachedPageText(store, project, job));
        if (missing.length) {
          throw Object.assign(new Error(`Page text is still missing for ${missing.length} page(s).`), { code: 'EDITABLE_PAGE_TEXT_MISSING' });
        }
      },
      editable_ppt: (projectId) => {
        const project = store.getProject(projectId);
        const { isTextFreeProject } = require('./text-free-pipeline.cjs');
        if (isTextFreeProject(store, project)) {
          const deck = editableDeckPath(project);
          if (deck && existsSync(deck) && statSync(deck).size >= 2048) return;
          throw Object.assign(new Error('The text-free PowerPoint deck is missing.'), { code: 'PPTX_INVALID' });
        }
        if (existsSync(editableBookPath(project))) return;
        verifyEditableOutput(project);
      },
      overview: (projectId) => verifyOverview(store.getProject(projectId)),
      maze: (projectId) => require('./maze-export.cjs').assertMazeBookReady(store, projectId),
      export: (projectId) => verifyExportZip(store.getProject(projectId))
    },
    stepRunners,
  });

  // Forward automation events to the renderer via IPC
  automation.on('progress', (payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('automation:progress', payload);
    }
  });
  automation.on('ask_required', (payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('automation:ask_required', payload);
    }
    broadcastState().catch(() => {});
  });
  automation.on('notify', (payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('automation:notify', payload);
    }
    if (payload?.event === 'book_completed' || payload?.event === 'all_completed') {
      telemetryService?.reportBookCompleted().catch(() => {});
    }
  });

  telemetryService = new TelemetryService({
    userDataPath: app.getPath('userData'),
    appVersion: app.getVersion(),
    enabled: app.isPackaged || process.env.TPT_ENABLE_TELEMETRY === 'true'
  });
  telemetryService.sendPing().catch(() => {});

  registerIpc();
  createWindow();
  bootLog('main window created');
  configureAutoUpdates();
  prewarmBackgroundBrowser();
  comfy.connectForever().then((state) => {
    bootLog(state?.ok ? `comfy ready ${state.url || ''}` : `comfy unavailable ${state?.error || ''}`);
    if (!state?.ok && store) {
      store.appendEvent({
        level: 'warn',
        message: state?.error || 'ComfyUI is not running in the background.'
      });
    }
    broadcastState().catch(() => {});
  }).catch((error) => {
    bootLog(`comfy connect failed ${error?.message || error}`);
  });

  app.on('activate', () => {
    if (!presentMainWindow() && store) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  comfy.shutdownSync();
  bookManagementService.shutdownSync();
});

app.on('before-quit', (event) => {
  if (installingUpdate) return;
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  const installUpdateOnQuit = updateManager?.getState().status === 'ready';
  updateManager?.stop();
  queue?.pause();
  Promise.resolve(comfy.shutdown({ force: true }))
    .catch(() => {})
    .then(() => bookManagementService.shutdown({ force: true }))
    .catch(() => {})
    .then(() => browser?.close())
    .finally(() => {
      comfy.shutdownSync();
      bookManagementService.shutdownSync();
      if (installUpdateOnQuit) {
        installingUpdate = true;
        const started = updateManager.install();
        store?.close();
        if (started) return;
        installingUpdate = false;
      }
      store?.close();
      app.exit(0);
    });
});
