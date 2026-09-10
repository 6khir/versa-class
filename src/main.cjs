
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
  // #region agent log
  try {
    const payload = { sessionId: '2f6f56', runId: 'post-fix', hypothesisId: 'P', location: 'main.cjs:bootLog', message: String(message || ''), data: { extra: extra ? String(extra).slice(0, 240) : null }, timestamp: Date.now() };
    fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '2f6f56' }, body: JSON.stringify(payload) }).catch(() => {});
    require('node:fs').appendFileSync('/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )/.cursor/debug-2f6f56.log', `${JSON.stringify(payload)}\n`);
  } catch {}
  // #endregion
  try { console.error('[versa]', message, extra || ''); } catch {}
}

process.on('uncaughtException', (error) => {
  if (isAddressInUseError(error)) {
    try { console.warn('[tpt-versa] 127.0.0.1:31338 already in use; continuing.'); } catch {}
    return;
  }
  bootLog('uncaughtException', error?.stack || error);
});

process.on('unhandledRejection', (error) => {
  bootLog('unhandledRejection', error?.stack || error);
});

const { app, BrowserWindow, dialog, ipcMain, nativeImage, nativeTheme, net, protocol, shell } = require('electron');
nativeTheme.themeSource = 'system';
const { autoUpdater } = require('electron-updater');
const { createHash, randomUUID } = require('node:crypto');
const { copyFileSync, cpSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } = require('node:fs');
const { dirname, extname, isAbsolute, join, basename } = require('node:path');
const { pathToFileURL } = require('node:url');
const { DatabaseSync } = require('node:sqlite');
const { BrowserController } = require('./browser-controller.cjs');
let startTelemetry = async () => null;
let stopTelemetry = () => {};
let telemetryEmit = () => {};
try {
  ({ startTelemetry, stopTelemetry, emit: telemetryEmit } = require('./canva-telemetry.cjs'));
} catch (error) {
  bootLog('canva-telemetry unavailable', error?.stack || error);
}
const { runBundleUploadSequence } = require('./bundle-upload-runner.cjs');
const { FileManager, collectProductPageImagePaths, prepareCanvaImportPdf, allInteriorPagesComplete, printPdfPageChecksum, printPdfPackageIsCurrent, compressedPrintPdfDest, bookFileCode, formatPrintPdfBytes, findExistingBookDocument } = require('./file-manager.cjs');
const {
  rememberCanvaImportPdf,
  restoreCanvaImportPdfIfMissing,
  forgetCanvaImportPdf,
  describeCanvaTempStorage
} = require('./canva-temp-storage.cjs');
const { FORMAT_INSTRUCTIONS, buildBookJobs, buildImportedJobs, buildStorybookJobs, cleanText, normalizeOrientation, parseAnalysisResponse, parseGeneratedPrompts, parseTptListingResponse, formatSeoBundleText, sanitizeSeoListingFields, isSeoSkipStub, slugify } = require('./prompt-builder.cjs');
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
} = require('./ai-engine.cjs');
const { MetaApiController } = require('./meta-api-controller.cjs');
const { QueueEngine } = require('./queue-engine.cjs');
const { startAutomationHttp } = require('./automation-http.cjs');
const { ProjectStore } = require('./store.cjs');
const { AutomationManager, PIPELINE_STEPS } = require('./automation-manager.cjs');
const { toCanvaDesignUrl, toCanvaTemplateLink, isCanvaTemplateLink } = require('./canva-bulk.cjs');
const { mergeCanvaPageProgress, pdfImportHumanHelp, isHumanRecoverableCanvaError, isPdfImportOpenDesignStage, isMagicLayerControlMissing } = require('./canva-job-state.cjs');
let isCanvaAvailable;
let canvaUnavailableError;
let CANVA_COMING_SOON_MESSAGE;
try {
  ({ isCanvaAvailable, canvaUnavailableError, CANVA_COMING_SOON_MESSAGE } = require('./canva-availability.cjs'));
} catch {
  CANVA_COMING_SOON_MESSAGE = 'Canva Magic Layer is coming soon on Windows. ChatGPT, Gemini, Meta AI, listing, mockups, and TPT still work.';
  isCanvaAvailable = (platform = process.platform) => String(platform || '') !== 'win32';
  canvaUnavailableError = () => Object.assign(new Error(CANVA_COMING_SOON_MESSAGE), { code: 'CANVA_UNAVAILABLE' });
}
const { normalizeAppearance, resolveAppearance, windowBackground, splashBackground } = require('./appearance.cjs');
const {
  TPT_SUBJECT_AREA_OPTIONS,
  TPT_TAG_OPTIONS,
  canonicalTptTaxonomyValue,
  canonicalizeTptTaxonomyValues
} = require('./tpt-taxonomy.cjs');

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
let liveOperation = null;
let canvaLiveDashboard = null;
const printPdfInflight = new Map();
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
    ['meta', 'metaLoginConfirmed'],
    ['canva', 'canvaLoginConfirmed']
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
  // #region agent log
  try {
    const fs = require('fs');
    const path = require('path');
    fs.appendFileSync(path.join(__dirname, '..', '.cursor', 'debug-1c3662.log'), `${JSON.stringify({
      sessionId: '1c3662', runId: 'browser-lock', hypothesisId: 'L', location: 'main.cjs:lockBrowserDesk',
      message: 'locking browser to background',
      data: { reason }, timestamp: Date.now()
    })}\n`);
  } catch { /* ignore */ }
  // #endregion
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
  // #region agent log
  try {
    const fs = require('fs');
    const path = require('path');
    const line = `${JSON.stringify({ sessionId: '1c3662', timestamp: Date.now(), ...payload })}\n`;
    const candidates = [
      path.join(__dirname, '..', '.cursor', 'debug-1c3662.log'),
      '/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )/.cursor/debug-1c3662.log'
    ];
    for (const logPath of candidates) {
      try {
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        fs.appendFileSync(logPath, line);
      } catch { /* ignore */ }
    }
    fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '1c3662' },
      body: line
    }).catch(() => {});
  } catch { /* ignore */ }
  // #endregion
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
  // Leftover accounts.google / Canva tabs can mask session state. Probe engine home under lock,
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

function requireCanva(actionLabel) {
  if (!isCanvaAvailable()) throw canvaUnavailableError();
  if (store?.getSetting('canvaLoginConfirmed', false)) return;
  throw Object.assign(
    new Error(`Connect Canva Pro before ${actionLabel}. Sign in on canva.com in Google Chrome Canary, then Verify Canva in Settings.`),
    { code: 'CANVA_AUTH_REQUIRED' }
  );
}

const CANVA_DASH_STEPS = ['pdf', 'import', 'upload', 'thumbnails', 'template', 'saved'];

function canvaStepFromProgress(message = '', percent = 0, dashboard = null) {
  if (dashboard?.step && CANVA_DASH_STEPS.includes(dashboard.step)) {
    return CANVA_DASH_STEPS.indexOf(dashboard.step) + 1;
  }
  const text = String(message || '').toLowerCase();
  const value = Number(percent) || 0;
  if (/saving the public template|editable layer complete/.test(text) || value >= 96) return 6;
  if (/template link|creating the public|share panel/.test(text) || value >= 88) return 5;
  if (/checking layer|audit|page \d+|applying magic layer|magic layer applied|not separated/.test(text) || value >= 20) return 4;
  if (/image_ready|adding image|upload finished|uploading the print pdf|waiting until 100%|already uploading/.test(text) || value >= 10) return 3;
  if (/add page|upload image|import file|create a design|sending print pdf/.test(text) || value >= 8) return 2;
  if (/opening a |canva design|import|print pdf|imported|loading the print pdf|opening canva/.test(text) || value >= 2) return 1;
  return 1;
}

function mergeCanvaDashboard(prev, patch = null, extras = {}) {
  const order = CANVA_DASH_STEPS;
  const base = prev && typeof prev === 'object'
    ? { ...prev, steps: { ...(prev.steps || {}) }, log: Array.isArray(prev.log) ? [...prev.log] : [] }
    : {
      step: 'pdf',
      status: 'idle',
      steps: {},
      log: [],
      compression: null,
      upload: null,
      lastError: null,
      attempt: 0
    };
  if (!patch && extras.message == null && extras.lastError == null) return base;
  const step = patch?.step || base.step || 'pdf';
  const status = patch?.status || extras.status || (patch?.error ? 'fail' : 'running');
  const steps = { ...base.steps };
  const message = extras.message || patch?.message || null;
  if (step) {
    steps[step] = {
      ...(steps[step] || {}),
      status,
      message: message || steps[step]?.message || '',
      updatedAt: Date.now()
    };
    const idx = order.indexOf(step);
    if (idx > 0 && status !== 'fail') {
      for (let index = 0; index < idx; index += 1) {
        const id = order[index];
        if (!steps[id] || steps[id].status === 'waiting' || steps[id].status === 'idle' || steps[id].status === 'running') {
          steps[id] = { ...(steps[id] || {}), status: 'ok', updatedAt: Date.now() };
        }
      }
    }
  }
  const log = base.log;
  if (message) {
    const prevMsg = log[log.length - 1];
    if (!prevMsg || prevMsg.message !== message || prevMsg.step !== step) {
      log.push({ at: Date.now(), step, message, status });
      if (log.length > 16) log.splice(0, log.length - 16);
    }
  }
  const lastError = patch?.error || patch?.lastError || extras.lastError || (status === 'fail' ? message : null) || base.lastError;
  return {
    ...base,
    ...patch,
    step,
    status: status === 'fail' ? 'fail' : (status === 'ok' && step === 'saved' ? 'ok' : status),
    steps,
    log,
    compression: patch?.compression || base.compression,
    upload: patch?.upload || extras.upload || base.upload,
    lastError,
    attempt: patch?.attempt ?? extras.attempt ?? base.attempt,
    updatedAt: Date.now()
  };
}

function seedCanvaPageProgress(project, { reset = false } = {}) {
  const previous = reset ? [] : (Array.isArray(project?.canvaPageProgress) ? project.canvaPageProgress : []);
  const byPage = new Map(previous.map((item) => [Number(item.pageNumber), item]));
  return (project?.jobs || []).map((job) => {
    const prior = byPage.get(Number(job.pageNumber)) || {};
    return {
      pageNumber: Number(job.pageNumber) || 0,
      jobId: job.id,
      uploaded: Boolean(prior.uploaded || prior.imported),
      imported: Boolean(prior.imported || prior.uploaded),
      started: Boolean(prior.started || prior.layered || prior.error),
      layered: Boolean(prior.layered),
      error: reset ? null : (prior.error || null),
      layerCount: reset ? null : (prior.layerCount ?? null),
      status: reset ? 'PENDING' : (prior.status || (prior.layered ? 'SUCCESS' : prior.error ? 'FAILED' : 'PENDING')),
      attempts: reset ? 0 : (Number(prior.attempts) || 0),
      lastState: reset ? null : (prior.lastState || null),
      lastAction: reset ? null : (prior.lastAction || null),
      lastVerification: reset ? null : (prior.lastVerification || null),
      timestamp: reset ? null : (prior.timestamp || null),
      detectionMethod: reset ? null : (prior.detectionMethod || null),
      confidence: reset ? null : (prior.confidence ?? null)
    };
  });
}

function persistCanvaPageLayered(projectId, pageNumber, patch = {}) {
  const updated = store.persistCanvaPageLayered(projectId, pageNumber, patch);
  if (!updated) return null;
  if (liveOperation?.projectId === projectId) {
    setLiveOperation({
      ...liveOperation,
      canvaPageProgress: updated.canvaPageProgress
    });
  }
  return updated.canvaPageProgress;
}

function applyCanvaPagesPatch(list, pages) {
  let progress = Array.isArray(list) ? list : [];
  for (const item of Array.isArray(pages) ? pages : []) {
    if (item?.pageNumber) progress = mergeCanvaPageProgress(progress, item.pageNumber, item);
  }
  return progress;
}

function setLiveOperation(next = null) {
  if (!next) {
    liveOperation = null;
    return;
  }
  const dashboard = next.kind === 'canva'
    ? mergeCanvaDashboard(
      canvaLiveDashboard || liveOperation?.canvaDashboard || null,
      next.canvaDashboard,
      {
        message: next.message,
        lastError: next.lastError,
        attempt: next.attempt
      }
    )
    : (next.canvaDashboard || liveOperation?.canvaDashboard || null);
  if (next.kind === 'canva') canvaLiveDashboard = dashboard;
  liveOperation = {
    kind: next.kind || 'work',
    label: next.label || 'Working',
    message: next.message || '',
    percent: Math.max(0, Math.min(100, Number(next.percent) || 0)),
    stepIndex: Number.isFinite(Number(next.stepIndex)) ? Number(next.stepIndex) : null,
    stepCount: Number(next.stepCount) || null,
    projectId: next.projectId || null,
    canvaPageProgress: Array.isArray(next.canvaPageProgress)
      ? next.canvaPageProgress
      : (Array.isArray(liveOperation?.canvaPageProgress) ? liveOperation.canvaPageProgress : null),
    canvaDashboard: dashboard,
    lastError: next.lastError !== undefined ? next.lastError : (liveOperation?.lastError || dashboard?.lastError || null),
    attempt: next.attempt ?? liveOperation?.attempt ?? dashboard?.attempt ?? 0,
    activeCanvaPage: Number.isFinite(Number(next.activeCanvaPage))
      ? Number(next.activeCanvaPage)
      : (liveOperation?.kind === (next.kind || 'work') && liveOperation?.projectId === (next.projectId || null)
        ? liveOperation.activeCanvaPage
        : null),
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
    canvaState: next.canvaState || next.jobState?.state || (liveOperation?.kind === (next.kind || 'work') ? liveOperation.canvaState : null),
    browserUrl: next.browserUrl || next.url || (liveOperation?.kind === (next.kind || 'work') ? liveOperation.browserUrl : null),
    jobStream: Array.isArray(next.jobStream)
      ? next.jobStream
      : (Array.isArray(next.jobState?.stream)
        ? next.jobState.stream
        : (liveOperation?.kind === (next.kind || 'work') ? liveOperation.jobStream : null)),
    lockMessage: (next.kind || liveOperation?.kind) === 'canva'
      ? 'Canva browser currently controlled by VERSA.'
      : null
  };
}

async function publishLiveOperation(next) {
  setLiveOperation(next);
  await broadcastState();
  // Emit telemetry for live operation updates to renderer UI
  telemetryEmit({ type: 'liveOperation', payload: liveOperation });
}

function finishLiveWork() {
  setLiveOperation(null);
  try { browser?.endWork?.(); } catch {}
}

function tryRemovePath(filePath) {
  if (!filePath || !existsSync(filePath)) return;
  try { rmSync(filePath, { force: true }); } catch {}
}

async function ensureProductPdf(projectId, { force = false, onProgress = null } = {}) {
  const existingRun = printPdfInflight.get(projectId);
  if (existingRun) return existingRun;

  const run = (async () => {
    const project = store.getProject(projectId);
    if (!project) return null;
    if (!project.stats?.total || project.stats.complete !== project.stats.total) return null;
    if (!allInteriorPagesComplete(project)) {
      throw Object.assign(new Error('PDF export is locked until every page is complete.'), { code: 'BOOK_INCOMPLETE' });
    }

    const checksum = printPdfPageChecksum(project.jobs);
    const existingProduct = project.productPdfPath || project.tptListing?.productPdfPath || project.printPdfJson?.productPdfPath;
    const existingCompressed = project.compressedPdfPath || project.printPdfJson?.compressedPdfPath;
    if (!force && printPdfPackageIsCurrent(project)) {
      if (existingProduct !== project.productPdfPath || existingCompressed !== project.compressedPdfPath) {
        store.updateProject(projectId, {
          productPdfPath: existingProduct,
          compressedPdfPath: existingCompressed
        });
      }
      return existingProduct;
    }
    if (!force && existingProduct && existsSync(existingProduct) && existingCompressed && existsSync(existingCompressed) && project.printPdfJson?.checksum === checksum && project.printPdfJson?.stage === 'ready') {
      return existingProduct;
    }

    const publishedLive = !liveOperation || liveOperation.kind === 'print-pdf';
    const mergePrintPdfJson = (patch) => {
      const current = store.getProject(projectId);
      return {
        ...(current?.printPdfJson || {}),
        checksum,
        ...patch,
        updatedAt: new Date().toISOString()
      };
    };
    const report = async (patch) => {
      store.updateProject(projectId, { printPdfJson: mergePrintPdfJson(patch) });
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
      store.updateProject(projectId, {
        printPdfJson: mergePrintPdfJson({
          stage: 'converting',
          message: 'Converting pages to PDF…',
          error: null
        })
      });
      const pkg = await fileManager.buildPrintPdfPackage(project, { onProgress: report });
      const listing = project.tptListing
        ? { ...project.tptListing, productPdfPath: pkg.productPdfPath }
        : project.tptListing;
      store.updateProject(projectId, {
        productPdfPath: pkg.productPdfPath,
        compressedPdfPath: pkg.compressedPdfPath,
        printPdfJson: mergePrintPdfJson({
          stage: 'ready',
          productPdfPath: pkg.productPdfPath,
          compressedPdfPath: pkg.compressedPdfPath,
          originalBytes: pkg.originalBytes,
          outputBytes: pkg.outputBytes,
          skipped: pkg.skipped,
          reason: pkg.reason,
          pageCount: pkg.pageCount,
          checksum: pkg.checksum,
          error: null,
          message: pkg.skipped
            ? `Print PDF ready (${formatPrintPdfBytes(pkg.originalBytes)}).`
            : `Print PDF ready (${formatPrintPdfBytes(pkg.originalBytes)} → ${formatPrintPdfBytes(pkg.outputBytes)}).`
        }),
        ...(listing ? { tptListing: listing } : {})
      });
      const sizeLine = pkg.skipped
        ? `Print PDF ready (${formatPrintPdfBytes(pkg.originalBytes)}). Canva will reuse this file.`
        : `Print PDF ready (${formatPrintPdfBytes(pkg.originalBytes)} → ${formatPrintPdfBytes(pkg.outputBytes)}). Canva will reuse this file.`;
      store.appendEvent({
        projectId,
        level: 'success',
        message: sizeLine
      });
      return pkg.productPdfPath;
    } catch (error) {
      store.updateProject(projectId, {
        printPdfJson: mergePrintPdfJson({
          stage: 'error',
          error: error?.message || String(error),
          message: error?.message || 'Print PDF conversion failed.'
        })
      });
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
  const pdfPath = await ensureProductPdf(projectId);
  if (!pdfPath) {
    throw Object.assign(new Error('Complete every page before mockups or preview. The book PDF is built when pages finish.'), {
      code: 'BOOK_INCOMPLETE'
    });
  }
  const existing = sanitizeSeoListingFields(project.tptListing && typeof project.tptListing === 'object' ? project.tptListing : {});
  const shell = {
    ...existing,
    productPdfPath: existing.productPdfPath && existsSync(existing.productPdfPath) ? existing.productPdfPath : pdfPath,
    title: existing.title || '',
    description: existing.description || '',
    tags: Array.isArray(existing.tags) ? existing.tags : [],
    subjects: Array.isArray(existing.subjects) ? existing.subjects : [],
    thumbnailPaths: Array.isArray(existing.thumbnailPaths) ? existing.thumbnailPaths : [],
    thumbnailBriefs: Array.isArray(existing.thumbnailBriefs) && existing.thumbnailBriefs.length
      ? existing.thumbnailBriefs
      : [
          `Hero mockup for ${project.name || 'this product'}`,
          `Classroom use mockup for ${project.name || 'this product'}`,
          `Feature highlight mockup for ${project.name || 'this product'}`,
          `Close-up detail mockup for ${project.name || 'this product'}`
        ],
    status: existing.status || 'assets_pending'
  };
  const listingDirty = !project.tptListing
    || project.tptListing.productPdfPath !== shell.productPdfPath
    || !Array.isArray(project.tptListing.thumbnailBriefs)
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
    // #region agent log
    try {
      const fs = require('fs');
      const path = require('path');
      fs.appendFileSync(path.join(__dirname, '..', '.cursor', 'debug-1c3662.log'), `${JSON.stringify({
        sessionId: '1c3662', runId: 'seo-stage', hypothesisId: 'DOC', location: 'main.cjs:ensureSeoBookDocument',
        message: 'reusing existing book document for SEO',
        data: { projectId, docPath: existing, ext: path.extname(existing) }, timestamp: Date.now()
      })}\n`);
    } catch { /* ignore */ }
    // #endregion
    return existing;
  }
  const docPath = await fileManager.exportDocx(project);
  // #region agent log
  try {
    const fs = require('fs');
    const path = require('path');
    fs.appendFileSync(path.join(__dirname, '..', '.cursor', 'debug-1c3662.log'), `${JSON.stringify({
      sessionId: '1c3662', runId: 'seo-stage', hypothesisId: 'DOC', location: 'main.cjs:ensureSeoBookDocument',
      message: 'built Word/Google-Doc style book document for SEO',
      data: { projectId, docPath, bytes: existsSync(docPath) ? fs.statSync(docPath).size : 0 }, timestamp: Date.now()
    })}\n`);
  } catch { /* ignore */ }
  // #endregion
  return docPath;
}

function isPauseError(error) {
  return Boolean(error) && (error.code === 'QUEUE_PAUSED' || /waiting was paused/i.test(String(error.message || '')));
}

async function pauseAllWork(reason = 'Stopped. You paused this work.') {
  const projectId = liveOperation?.projectId || queue?.status()?.activeProjectId || automation?.getStatus()?.currentProjectId || null;
  if (liveOperation) {
    setLiveOperation({
      ...liveOperation,
      message: 'Stopping — pause received.'
    });
  }
  try { queue.pause(); } catch {}
  try { automation?.pause(); } catch {}
  try { browser?.cancelWaits(); } catch {}
  if (projectId) store.appendEvent({ projectId, level: 'warn', message: reason });
  await broadcastState();
  return { paused: true, projectId };
}

async function runCanvaEditableForProject(projectId, onProgress = () => {}, options = {}) {
  if (!isCanvaAvailable()) throw canvaUnavailableError();
  requireCanva('Canva editable layer');
  const project = ensureProjectOutputDirectory(projectId);
  if (!project) throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });
  if (project.productFormat !== 'editable') {
    onProgress(100);
    return { skipped: true };
  }
  const pageImagePaths = collectProductPageImagePaths(project.jobs || []);
  const expectedPages = (project.jobs || []).length;
  if (!pageImagePaths.length || pageImagePaths.length < expectedPages) {
    throw Object.assign(new Error('Generate every interior page before sending the book to Canva.'), {
      code: 'CANVA_PAGES_MISSING'
    });
  }
  let importPdf = null;
  let rememberedPdf = null;
  const destImport = compressedPrintPdfDest(project.outputDir, project);
  const preparedCompressed = project.compressedPdfPath && existsSync(project.compressedPdfPath)
    ? project.compressedPdfPath
    : (project.printPdfJson?.compressedPdfPath && existsSync(project.printPdfJson.compressedPdfPath)
      ? project.printPdfJson.compressedPdfPath
      : (existsSync(destImport) ? destImport : null));
  let pdfPath = project.productPdfPath && existsSync(project.productPdfPath)
    ? project.productPdfPath
    : null;
  importPdf = preparedCompressed;
  if (!importPdf) {
    importPdf = await restoreCanvaImportPdfIfMissing({
      destPath: destImport,
      tempPdf: project.canvaJobJson?.tempPdf,
      store
    }).catch(() => null);
  }
  if (!importPdf && !pdfPath) {
    pdfPath = await ensureProductPdf(projectId);
    const refreshed = store.getProject(projectId);
    importPdf = refreshed?.compressedPdfPath && existsSync(refreshed.compressedPdfPath)
      ? refreshed.compressedPdfPath
      : null;
    pdfPath = pdfPath || (refreshed?.productPdfPath && existsSync(refreshed.productPdfPath) ? refreshed.productPdfPath : null);
  }
  if (!importPdf && pdfPath && existsSync(pdfPath)) {
    importPdf = await prepareCanvaImportPdf(
      pdfPath,
      project.outputDir,
      project.format,
      project.orientation,
      expectedPages,
      pageImagePaths
    );
  } else if (importPdf && existsSync(importPdf)) {
    importPdf = await prepareCanvaImportPdf(
      importPdf,
      project.outputDir,
      project.format,
      project.orientation,
      expectedPages,
      pageImagePaths
    );
  }
  if (!importPdf || !existsSync(importPdf)) {
    throw Object.assign(new Error('Export the print PDF before sending the book to Canva.'), {
      code: 'CANVA_PDF_MISSING'
    });
  }
  rememberedPdf = await rememberCanvaImportPdf({
    projectId,
    jobId: project.canvaJobJson?.state || null,
    localPath: importPdf,
    store
  }).catch((error) => {
    console.warn('[canva] Supabase temp PDF remember failed:', error?.message || error);
    return project.canvaJobJson?.tempPdf || null;
  });
  const resumeDesignUrl = toCanvaDesignUrl(project.canvaDesignUrl);
  const resumePdfUploaded = Boolean(project.canvaPdfUploaded || resumeDesignUrl);
  const canvaPageProgress = seedCanvaPageProgress(project, { reset: !resumeDesignUrl });
  const firstUnlayered = canvaPageProgress.findIndex((item) => !item?.layered);
  const resumeFromIndex = resumeDesignUrl
    ? (firstUnlayered === -1 ? expectedPages : firstUnlayered)
    : 0;
  const layeredPageNumbers = canvaPageProgress
    .filter((item) => item?.layered)
    .map((item) => item.pageNumber);
  store.updateProject(projectId, {
    canvaPageProgress,
    stepEditableStatus: options.dryRun ? (project.stepEditableStatus || 'pending') : 'processing',
    canvaJobJson: {
      ...(project.canvaJobJson || {}),
      ...(project.canvaJobJson?.interrupted ? { interrupted: false } : {}),
      ...(rememberedPdf?.objectPath ? { tempPdf: rememberedPdf } : {})
    }
  });
  await onProgress(4);
  const printMeta = store.getProject(projectId)?.printPdfJson || project.printPdfJson || {};
  const preparedSize = existsSync(importPdf) ? statSync(importPdf).size : Number(printMeta.outputBytes) || 0;
  const preparedMessage = printMeta.originalBytes && printMeta.outputBytes && printMeta.originalBytes !== printMeta.outputBytes
    ? `Using the print PDF prepared in Interior (${formatPrintPdfBytes(printMeta.originalBytes)} → ${formatPrintPdfBytes(printMeta.outputBytes)}).`
    : `Using the print PDF prepared in Interior (${formatPrintPdfBytes(preparedSize)}).`;
  store.appendEvent({ projectId, message: preparedMessage });
  canvaLiveDashboard = mergeCanvaDashboard(null, { step: 'pdf', status: 'running' }, {
    message: preparedMessage,
    compression: {
      path: importPdf,
      originalBytes: Number(printMeta.originalBytes) || preparedSize,
      outputBytes: Number(printMeta.outputBytes) || preparedSize,
      skipped: Boolean(printMeta.skipped),
      reason: printMeta.reason || 'prepared in Interior'
    }
  });
  await publishLiveOperation({
    kind: 'canva',
    label: 'Canva editable',
    percent: 4,
    stepIndex: 1,
    stepCount: 7,
    message: preparedMessage,
    projectId,
    canvaPageProgress,
    canvaDashboard: canvaLiveDashboard
  });
  let result;
  try {
    result = await browser.runCanvaBulkCreate({
      projectId,
      pdfPath: importPdf,
      expectedPages,
      format: project.format,
      orientation: project.orientation,
      resumeDesignUrl,
      resumeFromIndex,
      layeredPageNumbers,
      applyMagicLayers: !options.dryRun,
      downloadDir: options.dryRun ? null : join(project.outputDir, 'canva-export'),
      dryRun: Boolean(options.dryRun),
      humanEnabled: false,
      resumePdfUploaded,
      tempPdf: rememberedPdf || project.canvaJobJson?.tempPdf || null,
      diagnosticsDir: join(app.getPath('userData'), 'canva-diagnostics', String(projectId)),
      onProgress: async (info) => {
        const percent = typeof info === 'number' ? info : Number(info?.percent);
        if (Number.isFinite(percent)) onProgress(percent);
        if (info && typeof info === 'object' && isPdfImportOpenDesignStage(info.intervention, info)) {
          info.intervention = null;
        }
        const message = info?.message || liveOperation?.message || '';
        const current = store.getProject(projectId);
        let progress = Array.isArray(current?.canvaPageProgress) ? current.canvaPageProgress : canvaPageProgress;
        if (Array.isArray(info?.canvaPages) && info.canvaPages.length) {
          progress = applyCanvaPagesPatch(progress, info.canvaPages);
          store.updateProject(projectId, { canvaPageProgress: progress });
        }
        if (info?.canvaPage?.pageNumber) {
          progress = mergeCanvaPageProgress(progress, info.canvaPage.pageNumber, info.canvaPage);
          store.updateProject(projectId, { canvaPageProgress: progress });
        }
        const persistPatch = {};
        if (info?.abandonDesignUrl) {
          persistPatch.canvaDesignUrl = null;
          persistPatch.canvaPdfUploaded = false;
        }
        if (info?.designUrl) {
          persistPatch.canvaDesignUrl = toCanvaDesignUrl(info.designUrl) || info.designUrl;
        }
        if (info?.pdfUploaded || info?.designUrl) persistPatch.canvaPdfUploaded = true;
        if (info?.jobState && !info?.heartbeat) {
          const currentJob = store.getProject(projectId);
          persistPatch.canvaJobJson = {
            ...(currentJob?.canvaJobJson || {}),
            ...info.jobState,
            tempPdf: info.jobState?.tempPdf || currentJob?.canvaJobJson?.tempPdf || rememberedPdf || null,
            interrupted: false
          };
          if (isPdfImportOpenDesignStage(persistPatch.canvaJobJson.intervention, persistPatch.canvaJobJson)) {
            persistPatch.canvaJobJson.intervention = null;
          }
        }
        if (info?.designUrl) {
          const currentJob = store.getProject(projectId);
          const tempPdf = persistPatch.canvaJobJson?.tempPdf || currentJob?.canvaJobJson?.tempPdf || rememberedPdf;
          if (tempPdf?.objectPath) {
            forgetCanvaImportPdf({ tempPdf, store }).then((ok) => {
              if (!ok) return;
              const latest = store.getProject(projectId);
              store.updateProject(projectId, {
                canvaJobJson: { ...(latest?.canvaJobJson || {}), tempPdf: null }
              });
            }).catch(() => {});
          }
        }
        if (Object.keys(persistPatch).length) store.updateProject(projectId, persistPatch);
        setLiveOperation({
          kind: 'canva',
          label: options.dryRun ? 'Canva dry run' : 'Canva editable',
          percent: Number.isFinite(percent) ? percent : (liveOperation?.percent || 0),
          stepIndex: canvaStepFromProgress(message, percent, info?.dashboard),
          stepCount: 7,
          message,
          projectId,
          canvaPageProgress: progress,
          canvaDashboard: info?.dashboard,
          lastError: info?.dashboard?.error || info?.dashboard?.lastError || info?.lastError,
          attempt: info?.dashboard?.attempt ?? info?.attempt,
          activeCanvaPage: info?.canvaPage?.pageNumber,
          pageFileName: info?.pageFileName,
          waitExplanation: info?.waitExplanation,
          controller: info?.controller,
          liveFrame: info?.liveFrame,
          intervention: info?.intervention && !isPdfImportOpenDesignStage(info.intervention, info) ? info.intervention : null,
          canvaState: info?.jobState?.state,
          browserUrl: info?.url || persistPatch.canvaDesignUrl,
          jobStream: info?.jobState?.stream
        });
        if (info?.intervention && !isPdfImportOpenDesignStage(info.intervention, info) && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('canva:intervention', info.intervention);
        }
        if (info?.message && !info?.heartbeat && !/^Checking layer count on page \d+ of \d+/i.test(info.message) && !/^Still (importing|applying|on Canva)|Waiting for Magic Layer to start|Canva opened a design/i.test(info.message)) {
          store.appendEvent({ projectId, message: info.message, details: info?.waitExplanation ? { waitExplanation: info.waitExplanation } : null });
        }
        await broadcastState();
      }
    });
  } catch (error) {
    if (isPauseError(error)) {
      store.appendEvent({ projectId, level: 'warn', message: 'Canva paused. Start again when you are ready.' });
      await broadcastState();
      throw Object.assign(new Error('Stopped. You paused this work.'), { code: 'QUEUE_PAUSED' });
    }
    const current = store.getProject(projectId);
    const text = String(error.message || liveOperation?.message || '');
    const pageMatch = text.match(/page (\d+)/i);
    const fallbackPage = (current?.canvaPageProgress || []).find((item) => item?.imported && !item?.layered)?.pageNumber
      || (current?.canvaPageProgress || []).find((item) => item?.uploaded && !item?.layered)?.pageNumber
      || 1;
    const pageNumber = pageMatch ? Number(pageMatch[1]) : fallbackPage;
    const intervention = isPdfImportOpenDesignStage(error)
      ? null
      : (liveOperation?.intervention && !isPdfImportOpenDesignStage(liveOperation.intervention)
        ? liveOperation.intervention
        : (current?.canvaJobJson?.intervention && !isPdfImportOpenDesignStage(current.canvaJobJson.intervention)
          ? current.canvaJobJson.intervention
          : (isMagicLayerControlMissing(error) ? {
            happened: error.message,
            expected: 'The Edit image panel shows Magic Layers, then this page has more than one layer.',
            undetermined: 'Whether Magic Layers is visible in the Edit image panel.',
            userShouldClick: 'In Chrome Canary: click the page image, Edit, then Magic Layers. Press I HAVE DONE IT when the page has more than one layer.'
          } : null)));
    canvaLiveDashboard = mergeCanvaDashboard(canvaLiveDashboard, {
      status: 'fail',
      error: error.message,
      lastError: error.message
    }, { lastError: error.message, message: error.message });
    store.updateProject(projectId, {
      canvaPageProgress: mergeCanvaPageProgress(current?.canvaPageProgress, pageNumber, {
        error: error.message,
        layered: false,
        status: 'FAILED'
      }),
      stepEditableStatus: current?.canvaDesignUrl || current?.canvaPdfUploaded ? 'processing' : 'pending',
      canvaJobJson: {
        ...(current?.canvaJobJson || liveOperation?.controller || {}),
        interrupted: true,
        lastError: error.message,
        pageNumber,
        intervention,
        waitExplanation: liveOperation?.waitExplanation || (intervention
          ? { expected: intervention.expected, detected: 'job stopped', message: error.message, state: 'MANUAL_INTERVENTION_REQUIRED' }
          : current?.canvaJobJson?.waitExplanation)
      }
    });
    store.appendEvent({
      projectId,
      level: 'error',
      message: error.message,
      details: { kind: 'canva_failure', pageNumber, code: error.code || null }
    });
    throw error;
  } finally {
    if (liveOperation?.kind === 'canva' && liveOperation.projectId) {
      const current = store.getProject(liveOperation.projectId);
      if (current) {
        store.updateProject(liveOperation.projectId, {
          canvaJobJson: {
            ...(current.canvaJobJson || {}),
            ...(liveOperation.controller || {}),
            state: liveOperation.canvaState || current.canvaJobJson?.state,
            updatedAt: Date.now()
          }
        });
      }
    }
    finishLiveWork();
    await broadcastState();
  }
  if (result?.dryRun) {
    store.appendEvent({ projectId, message: 'Canva dry run finished. No image upload or Magic Layer clicks were sent.' });
    await broadcastState();
    return result;
  }
  if (Array.isArray(result?.canvaPageProgress) && result.canvaPageProgress.length) {
    store.updateProject(projectId, {
      canvaPageProgress: applyCanvaPagesPatch(store.getProject(projectId)?.canvaPageProgress, result.canvaPageProgress)
    });
  }
  const verifiedLink = isCanvaTemplateLink(result.templateLink)
    ? (toCanvaTemplateLink(result.templateLink) || result.templateLink)
    : '';
  const finished = store.getProject(projectId);
  const layered = (finished?.canvaPageProgress || []).filter((item) => item?.layered).length;
  const total = (finished?.jobs || []).length;
  const missedPages = (finished?.canvaPageProgress || [])
    .filter((item) => !item?.layered)
    .map((item) => item.pageNumber);
  store.updateProject(projectId, {
    canvaDesignUrl: toCanvaDesignUrl(result.designUrl || finished?.canvaDesignUrl) || project.canvaDesignUrl,
    canvaExportPath: result.exportPath || finished?.canvaExportPath,
    canvaPdfUploaded: true,
    canvaJobJson: { ...(finished?.canvaJobJson || {}), interrupted: false, state: 'JOB_COMPLETE' },
    ...(verifiedLink ? { canvaTemplateLink: verifiedLink } : {}),
    stepEditableStatus: verifiedLink ? 'completed' : 'pending'
  });
  if (!verifiedLink) {
    throw Object.assign(new Error('Canva did not return a verified template link. The editor URL was not saved as the buyer link.'), {
      code: 'CANVA_TEMPLATE_LINK_MISSING'
    });
  }
  store.appendEvent({
    projectId,
    level: missedPages.length ? 'warn' : 'success',
    message: missedPages.length
      ? `Canva Magic Layer applied to ${layered} of ${total} pages. Not separated: ${missedPages.join(', ')}. Template link saved.`
      : result.resumed
        ? `Canva design continued from saved pages. Template link saved.`
        : `Canva imported the print PDF and applied Magic Layer to every page. Template link saved.`
  });
  await broadcastState();
  return result;
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
  if (!force && listing.videoPreviewPath && existsSync(listing.videoPreviewPath)) {
    onProgress?.(100);
    return store.getProject(projectId);
  }
  store.updateProject(projectId, {
    tptListing: {
      ...listing,
      videoPreviewStatus: 'generating',
      videoPreviewError: null,
      ...(force ? { videoPreviewPath: null } : {})
    }
  });
  await publishLiveOperation({
    kind: 'preview',
    label: 'Preview video',
    percent: 8,
    message: 'Starting the teacher preview video…',
    projectId
  });
  const previousEngine = getActiveEngine();
  try {
    browser.setEngine('gemini');
    const { generateStitchedPreviewVideo } = require('./preview-video-engine.cjs');
    const generated = await generateStitchedPreviewVideo({
      browser,
      project,
      listing: { ...listing, videoPreviewPath: force ? null : listing.videoPreviewPath },
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
    const current = store.getProject(projectId)?.tptListing ?? listing;
    store.updateProject(projectId, {
      tptListing: {
        ...current,
        videoPreviewPath: outputPath,
        videoPreviewStatus: 'ready',
        videoPreviewError: null,
        videoPreviewConversationUrl: generated.conversationUrl
      }
    });
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
      store.appendEvent({ projectId, level: 'warn', message: 'Preview paused. Start again when you are ready.' });
      throw Object.assign(new Error('Stopped. You paused this work.'), { code: 'QUEUE_PAUSED' });
    }
    require('fs').writeFileSync('/tmp/tpt-error.log', error.stack || String(error));
    const current = store.getProject(projectId)?.tptListing ?? listing;
    store.updateProject(projectId, {
      tptListing: {
        ...current,
        videoPreviewStatus: 'failed',
        videoPreviewError: error.message
      }
    });
    store.appendEvent({ projectId, level: 'error', message: `Preview video generation paused: ${error.message}` });
    await broadcastState();
    throw error;
  } finally {
    browser.setEngine(previousEngine);
    finishLiveWork();
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
    }
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
  const invalidTags = rawTags.filter((value) => !canonicalTptTaxonomyValue(value, TPT_TAG_OPTIONS));
  const invalidSubjects = rawSubjects.filter((value) => !canonicalTptTaxonomyValue(value, TPT_SUBJECT_AREA_OPTIONS));
  if (invalidTags.length || invalidSubjects.length) {
    const details = [
      invalidTags.length ? `Invalid TPT tags: ${invalidTags.join(', ')}` : '',
      invalidSubjects.length ? `Invalid TPT subjects: ${invalidSubjects.join(', ')}` : ''
    ].filter(Boolean).join('. ');
    throw Object.assign(new Error(`${details}. Use the exact names shown by Teachers Pay Teachers.`), {
      code: 'SETTINGS_TPT_TAXONOMY_INVALID'
    });
  }
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
      tags: canonicalizeTptTaxonomyValues(rawTags, TPT_TAG_OPTIONS, 6),
      subjects: canonicalizeTptTaxonomyValues(rawSubjects, TPT_SUBJECT_AREA_OPTIONS, 3),
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
    }
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

function applyListingDefaults(listing, preferences) {
  const defaults = preferences.listingDefaults;
  const isFreeResource = defaults.pricingMode === 'free';
  return {
    ...listing,
    tags: canonicalizeTptTaxonomyValues([...(defaults.tags ?? []), ...(listing.tags ?? [])], TPT_TAG_OPTIONS, 6),
    subjects: canonicalizeTptTaxonomyValues([...(defaults.subjects ?? []), ...(listing.subjects ?? [])], TPT_SUBJECT_AREA_OPTIONS, 3),
    grades: mergeUniqueValues(defaults.grades, listing.grades, 4),
    formats: mergeUniqueValues(defaults.formats, listing.formats, 3),
    taxCode: defaults.taxCode || listing.taxCode || '',
    copyrightDeclaration: defaults.copyrightDeclaration || listing.copyrightDeclaration || '',
    isFreeResource,
    suggestedPrice: isFreeResource ? '' : (defaults.suggestedPrice || listing.suggestedPrice || ''),
    multipleLicensePrice: defaults.multipleLicensePrice || listing.multipleLicensePrice || '',
    publicationStatus: defaults.publicationStatus,
    thumbnailMode: defaults.thumbnailMode,
    sellerProfile: {
      businessName: preferences.profile.businessName,
      sellerName: preferences.profile.sellerName,
      authorName: preferences.projectIdentity.authorName,
      publisherName: preferences.projectIdentity.publisherName,
      copyrightHolder: preferences.projectIdentity.copyrightHolder,
      copyrightYear: preferences.projectIdentity.copyrightYear
    }
  };
}

function tptListingReviewApproved(listing) {
  return Boolean(listing?.reviewApprovedAt || listing?.reviewedAt || listing?.uploadStartedAt);
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

if (!singleInstanceAcquired) app.quit();

app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (store) createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

function nativeWindowIcon() {
  // On macOS, BrowserWindow `icon` and dock.setIcon(PNG) skip the system squircle
  // mask and show a sharp square in the Dock. Leave the bundled ICNS alone.
  if (process.platform === 'darwin') return {};
  return { icon: join(__dirname, '..', 'assets', 'icon.png') };
}

function createSplashWindow() {
  if (process.env.TPT_TEST_USER_DATA && !process.env.TPT_TEST_SHOW_SPLASH) return;
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
  splashWindow.once('ready-to-show', showSplash);
  splashWindow.webContents.once('did-fail-load', (_event, code, desc) => {
    bootLog('splash did-fail-load', `${code} ${desc}`);
    showSplash();
  });
  splashWindow.webContents.once('did-finish-load', () => setTimeout(showSplash, 0));
  splashWindow.on('closed', () => {
    splashWindow = null;
  });
}

function revealMainWindow() {
  const elapsed = Date.now() - splashShownAt;
  const minimumDuration = process.env.TPT_TEST_SHOW_SPLASH ? 5000 : SPLASH_MIN_DURATION_MS;
  const delay = splashWindow ? Math.max(0, minimumDuration - elapsed) : 0;
  setTimeout(() => {
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  }, delay);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
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
  mainWindow.once('ready-to-show', revealMainWindow);
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

async function buildState() {
  const dashboard = store.getDashboardState();
  const whenCompleteAction = store.getSetting('whenCompleteAction', 'nothing');
  const aiEngine = getActiveEngine();
  const chatgptConfirmed = Boolean(store.getSetting('chatgptLoginConfirmed', false));
  const geminiConfirmed = Boolean(store.getSetting('geminiLoginConfirmed', false));
  const metaConfirmed = Boolean(store.getSetting('metaLoginConfirmed', false));
  const canvaConfirmed = Boolean(store.getSetting('canvaLoginConfirmed', false));
  const loginRequired = !isEngineConfirmed(aiEngine);
  const detectedChatGptProfile = store.getSetting('chatgptAccountProfile', null);
  const selectedChatGptProfile = store.getSetting('chatgptSelectedProfile', null);
  const detectedGeminiProfile = store.getSetting('geminiAccountProfile', null);
  const detectedMetaProfile = store.getSetting('metaAccountProfile', null);
  const detectedCanvaProfile = store.getSetting('canvaAccountProfile', null);
  return {
    ...dashboard,
    queue: queue.status(),
    browser: await browser.status(),
    settings: getPreferences(),
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
      canva: {
        connected: isCanvaAvailable() ? canvaConfirmed : false,
        available: isCanvaAvailable(),
        locked: !isCanvaAvailable(),
        lockMessage: isCanvaAvailable() ? '' : CANVA_COMING_SOON_MESSAGE,
        profile: detectedCanvaProfile
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
    canvaTemplates: store ? store.getCanvaTemplates() : [],
    liveOperation,
    canvaLiveDashboard,
    workBusy: {
      queue: Boolean(queue?.running),
      automation: Boolean(automation?.getStatus()?.active && !automation?.getStatus()?.paused),
      liveOperation: Boolean(liveOperation),
      tptListing: Boolean(tptListingAutomationActive),
      bundle: Boolean(bundleUploadActive),
      characters: Boolean(storybookAssetGenerationActive),
      stopping: Boolean(browser?.isAborting?.())
    },
    app: {
      version: app.getVersion(),
      platform: process.platform,
      canvaAvailable: isCanvaAvailable(),
      canvaLockMessage: isCanvaAvailable() ? '' : CANVA_COMING_SOON_MESSAGE,
      loginRequired,
      appearance: appearanceState(),
      whenCompleteAction,
      systemAction: systemActionPayload,
      supabase: describeCanvaTempStorage(store),
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

async function broadcastState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('state:changed', await buildState());
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
  } catch (error) { require("fs").writeFileSync("/tmp/tpt-error.log", error.stack || String(error));
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
  updateManager = new UpdateManager({
    autoUpdater,
    currentVersion: app.getVersion(),
    enabled: false, // Disabled per user request
    onStateChange: () => broadcastState().catch((error) => console.error('Failed to broadcast update state:', error)),
    onDownloaded: (info) => promptForUpdateInstall(info).catch((error) => console.error('Failed to show update prompt:', error))
  });
  // updateManager.start(); // Disabled per user request
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

async function ensureThankYouPdfForProject(projectId) {
  const project = store.getProject(projectId);
  if (!project || project.productFormat !== 'editable' || !project.canvaTemplateLink) return project;
  // Local SVG packages are file paths, not Canva template URLs — skip thank-you stamp.
  if (!/^https?:\/\//i.test(String(project.canvaTemplateLink || ''))) return project;
  const existing = project.printPdfJson?.thankYouPdfPath;
  if (existing && existsSync(existing)) return { ...project, thankYouPdfPath: existing };
  const thankYouPdfPath = await fileManager.exportThankYouPdf(project, project.canvaTemplateLink);
  store.updateProject(projectId, {
    printPdfJson: {
      ...(project.printPdfJson || {}),
      thankYouPdfPath
    }
  });
  return { ...store.getProject(projectId), thankYouPdfPath };
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
  } catch (error) { require("fs").writeFileSync("/tmp/tpt-error.log", error.stack || String(error));
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
  } catch (error) { require("fs").writeFileSync("/tmp/tpt-error.log", error.stack || String(error));
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
  } catch (error) { require("fs").writeFileSync("/tmp/tpt-error.log", error.stack || String(error));
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
  if (liveOperation?.kind === 'print-pdf') return 'print PDF conversion';
  if (liveOperation?.kind === 'canva') return liveOperation.label || 'Canva editable';
  if (liveOperation?.kind === 'listing') return 'TPT listing';
  if (liveOperation?.kind === 'thumbnails') return 'mockups';
  if (liveOperation?.kind === 'preview') return 'preview video';
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
  if (queue.running && queue.status()?.activeProjectId === projectId) {
    throw Object.assign(new Error(`This book is generating. Pause it before ${action}.`), { code: 'QUEUE_RUNNING' });
  }
}

function startAutomationIfIdle() {
  // Full automation starts only when the user clicks Start Full Automation on the current book.
}

function registerIpc() {
  ipcMain.handle('state:get', () => buildState());
  // #region agent log
  ipcMain.handle('debug:agent-log', async (_event, payload = {}) => {
    try {
      const fs = require('fs');
      const path = require('path');
      const logPath = path.join(__dirname, '..', '.cursor', 'debug-1c3662.log');
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      const line = JSON.stringify({
        sessionId: '1c3662',
        timestamp: Date.now(),
        ...payload
      }) + '\n';
      fs.appendFileSync(logPath, line, 'utf8');
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });
  // #endregion
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
      'printolli.com', 'www.printolli.com',
      'canva.com', 'www.canva.com'
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
    return describeCanvaTempStorage(store);
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
    const next = String(productFormat || '').trim().toLowerCase() === 'editable' ? 'editable' : 'static';
    store.updateProject(projectId, { productFormat: next });
    await broadcastState();
    return store.getProject(projectId);
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
      conversationUrl: input.conversationUrl ?? null
    };

    if (input.conversationUrl) {
      for (const job of generated.jobs) {
        job.conversationUrl = input.conversationUrl;
      }
    }

    store.createProject(project, generated.jobs);
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
    assertIdle();
    requireGeminiForPlanning('starting analysis');
    const listing = resolveListingAnalysisInput(input);
    const cacheKey = parseTptProductUrl(listing.productUrl)?.productId || randomUUID();
    const mockupDir = join(app.getPath('userData'), 'competitor-mockup-cache', cacheKey);
    mkdirSync(mockupDir, { recursive: true });
    const result = await browser.analyzeProductWithGpt({ ...listing, mockupDestDir: mockupDir });
    const analysis = parseAnalysisResponse(result.rawText);
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
      targetAge: analysis.targetAge || 'Pre-K to 2nd Grade',
      description: analysis.description || '',
      competitorMockups,
      productFormat: analysis.productFormat || 'static'
    };

    store.createProject(project, []);
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

    return {
      project: store.getProject(projectId),
      analysis,
      conversationUrl: result.conversationUrl,
      competitorMockups,
      promptReceipt: result.promptReceipt || browser.lastPromptReceipt || null
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
      const result = await browser.generatePromptsWithGpt({
        conversationUrl: activeUrl,
        pageCount,
        format,
        orientation,
        attachmentPaths,
        title: existingProject.name,
        theme: existingProject.theme,
        niche: existingProject.niche,
        productFormat: existingProject.productFormat || 'static',
        seed: `${existingProject.id} | ${existingProject.name} | ${existingProject.theme} | ${existingProject.niche} | ${existingProject.productFormat || 'static'}`,
        onBatch: ({ startPage, endPage, have, total, phase }) => {
          console.log(`[analysis] Content Gem prompt batch: pages ${startPage}–${endPage} (${have}/${total} saved)${phase ? ` [${phase}]` : ''}.`);
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
      seed: `${name} | ${theme} | ${niche} | ${pageCount}`
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
      description: ''
    };

    store.createProject(project, generated.jobs);
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
    const rawTarget = String(target && typeof target === 'object' ? (target.target ?? target.engine ?? '') : (target || '')).trim().toLowerCase();
    const selectedProfile = store.getSetting('chatgptSelectedProfile', null);
    // #region agent log
    try {
      const fs = require('fs');
      const path = require('path');
      fs.appendFileSync(path.join(__dirname, '..', '.cursor', 'debug-1c3662.log'), `${JSON.stringify({
        sessionId: '1c3662', runId: 'browser-lock', hypothesisId: 'L', location: 'main.cjs:browser:open-login',
        message: 'UNLOCK for profile sign-in only',
        data: { rawTarget }, timestamp: Date.now()
      })}\n`);
    } catch { /* ignore */ }
    // #endregion
    if (rawTarget === 'canva') {
      if (!isCanvaAvailable()) throw canvaUnavailableError();
      const result = await browser.openLoginBrowser(selectedProfile, { target: 'canva' });
      await broadcastState();
      return result;
    }
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
    const rawTarget = String(target && typeof target === 'object' ? (target.target ?? target.engine ?? '') : (target || '')).trim().toLowerCase();
    if (rawTarget === 'canva') {
      if (!isCanvaAvailable()) throw canvaUnavailableError();
      const selectedProfile = store.getSetting('chatgptSelectedProfile', null);
      try {
        const result = await browser.verifyLogin(selectedProfile, { target: 'canva' });
        store.setSetting('canvaLoginConfirmed', Boolean(result.authenticated));
        store.setSetting('canvaAccountProfile', {
          name: cleanText(result.accountProfile?.name),
          email: cleanText(result.accountProfile?.email),
          label: cleanText(result.accountProfile?.label),
          sourceBrowser: cleanText(result.sourceBrowser),
          sourceProfile: cleanText(result.sourceProfile),
          verifiedAt: new Date().toISOString()
        });
        store.appendEvent({ level: result.authenticated ? 'success' : 'warn', message: result.authenticated ? 'Canva Pro login verified.' : 'Canva is not signed in yet.' });
        if (result.authenticated) await lockBrowserDesk('after-canva-verify');
        await broadcastState();
        return { ...result, engine: 'canva' };
      } catch (error) {
        store.setSetting('canvaLoginConfirmed', false);
        store.appendEvent({
          level: 'warn',
          message: `Canva login verification failed: ${error.message}`,
          details: { code: error.code ?? 'CANVA_VERIFICATION_FAILED' }
        });
        await lockBrowserDesk('after-canva-verify-fail');
        await broadcastState();
        throw error;
      }
    }
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

  ipcMain.handle('browser:logout-chatgpt', async () => {
    await browser.logout('chatgpt');
    store.setSetting('chatgptLoginConfirmed', false);
    store.setSetting('chatgptAccountProfile', null);
    store.appendEvent({ level: 'info', message: 'ChatGPT session logged out. Gemini was left signed in.' });
    await broadcastState();
    return { success: true };
  });

  ipcMain.handle('browser:logout-gemini', async () => {
    await browser.logout('gemini');
    store.setSetting('geminiLoginConfirmed', false);
    store.setSetting('geminiAccountProfile', null);
    store.appendEvent({ level: 'info', message: 'Gemini session logged out. ChatGPT was left signed in.' });
    await broadcastState();
    return { success: true };
  });

  ipcMain.handle('browser:logout-meta', async () => {
    await browser.logout('meta');
    store.setSetting('metaLoginConfirmed', false);
    store.setSetting('metaAccountProfile', null);
    store.appendEvent({ level: 'info', message: 'Meta AI session logged out. ChatGPT and Gemini were left signed in.' });
    await broadcastState();
    return { success: true };
  });

  ipcMain.handle('browser:logout-canva', async () => {
    await browser.logout('canva');
    store.setSetting('canvaLoginConfirmed', false);
    store.setSetting('canvaAccountProfile', null);
    store.appendEvent({ level: 'info', message: 'Canva session logged out. ChatGPT, Gemini, and Meta were left signed in.' });
    await broadcastState();
    return { success: true };
  });

  ipcMain.handle('settings:get-canva-templates', () => store.getCanvaTemplates());

  ipcMain.handle('settings:set-canva-templates', async (_event, templates) => {
    const list = Array.isArray(templates) ? templates : [];
    store.setCanvaTemplates(list);
    await broadcastState();
    return store.getCanvaTemplates();
  });

  ipcMain.handle('project:run-canva-editable', async (_event, projectId, options = {}) => {
    assertIdle();
    const result = await runCanvaEditableForProject(projectId, () => {}, options || {});
    return result;
  });

  ipcMain.handle('project:canva-dry-run', async (_event, projectId) => {
    assertIdle();
    return runCanvaEditableForProject(projectId, () => {}, { dryRun: true, humanEnabled: false });
  });

  ipcMain.handle('project:canva-health-check', async (_event, projectId) => {
    if (!isCanvaAvailable()) throw canvaUnavailableError();
    const project = store.getProject(projectId);
    if (liveOperation?.kind && liveOperation.kind !== 'canva') assertBrowserFree('Canva health check');
    const designUrl = liveOperation?.kind === 'canva' ? null : (project?.canvaDesignUrl || null);
    return browser.inspectCanvaEnvironment({ designUrl });
  });

  ipcMain.handle('canva:pause-job', async () => {
    const help = {
      happened: 'Operator paused the Canva controller.',
      expected: 'The current verified Canva state, unchanged.',
      undetermined: 'Nothing — the job is paused on purpose.',
      userShouldClick: 'Leave Canva as it is, then press Resume. If the Upload dialog is waiting, drop the print PDF first.'
    };
    const lastError = liveOperation?.lastError || store.getProject(liveOperation?.projectId || store.getSetting('selectedProjectId'))?.canvaJobJson?.lastError;
    const payload = lastError && isHumanRecoverableCanvaError({ message: lastError }) && !isPdfImportOpenDesignStage({ message: lastError })
      ? pdfImportHumanHelp(lastError)
      : help;
    browser.pauseForHuman(payload);
    const intervention = browser.canvaJob?.intervention || payload;
    if (liveOperation?.kind === 'canva') {
      setLiveOperation({
        ...liveOperation,
        message: 'Paused. Canva stays open. Resume when you are ready.',
        intervention
      });
    } else {
      const projectId = store.getSetting('selectedProjectId');
      const current = projectId ? store.getProject(projectId) : null;
      if (current) {
        store.updateProject(projectId, {
          canvaJobJson: {
            ...(current.canvaJobJson || {}),
            intervention,
            interrupted: true
          }
        });
      }
    }
    await broadcastState();
    return { paused: true, lockMessage: 'Canva browser currently controlled by VERSA.' };
  });

  ipcMain.handle('canva:resume-job', async () => {
    if (liveOperation?.kind === 'canva') {
      setLiveOperation({ ...liveOperation, intervention: null, message: 'Resuming Canva editable…' });
      await broadcastState();
    }
    const projectId = store.getSetting('selectedProjectId') || liveOperation?.projectId;
    if (!projectId) throw Object.assign(new Error('Select a book first.'), { code: 'PROJECT_NOT_FOUND' });
    const current = store.getProject(projectId);
    if (current?.canvaJobJson?.intervention) {
      store.updateProject(projectId, {
        canvaJobJson: { ...current.canvaJobJson, intervention: null, interrupted: false }
      });
    }
    return runCanvaEditableForProject(projectId, () => {}, {});
  });

  ipcMain.handle('canva:retry-step', async () => {
    const projectId = store.getSetting('selectedProjectId') || liveOperation?.projectId;
    if (!projectId) throw Object.assign(new Error('Select a book first.'), { code: 'PROJECT_NOT_FOUND' });
    return runCanvaEditableForProject(projectId, () => {}, {});
  });

  ipcMain.handle('canva:retry-page', async () => {
    const projectId = store.getSetting('selectedProjectId') || liveOperation?.projectId;
    if (!projectId) throw Object.assign(new Error('Select a book first.'), { code: 'PROJECT_NOT_FOUND' });
    return runCanvaEditableForProject(projectId, () => {}, {});
  });

  ipcMain.handle('canva:resume-from-page', async (_event, pageNumber) => {
    const projectId = store.getSetting('selectedProjectId') || liveOperation?.projectId;
    if (!projectId) throw Object.assign(new Error('Select a book first.'), { code: 'PROJECT_NOT_FOUND' });
    return runCanvaEditableForProject(projectId, () => {}, { resumeFromPage: Number(pageNumber) || null });
  });

  ipcMain.handle('canva:abort', async () => {
    return pauseAllWork('Canva editable aborted. Re-run Build Canva layer when ready.');
  });

  ipcMain.handle('canva:resolve-intervention', async (_event, decision) => {
    const choice = String(decision || 'done').trim().toLowerCase();
    const projectId = store.getSetting('selectedProjectId') || liveOperation?.projectId;
    const current = projectId ? store.getProject(projectId) : null;
    if (choice === 'abort') {
      return pauseAllWork('Canva editable aborted. Re-run Build Canva layer when ready.');
    }
    if (current) {
      store.updateProject(projectId, {
        canvaJobJson: { ...(current.canvaJobJson || {}), intervention: null, interrupted: false }
      });
    }
    if (!projectId) throw Object.assign(new Error('Select a book first.'), { code: 'PROJECT_NOT_FOUND' });
    const result = await runCanvaEditableForProject(projectId, () => {}, {});
    return { decision: choice === 'retry' ? 'retry' : 'done', result };
  });

  ipcMain.handle('project:clear-canva-template', async (_event, projectId) => {
    const project = store.getProject(projectId);
    if (!project) throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });
    assertNotGeneratingProject(projectId, 'removing the Canva template');
    store.updateProject(projectId, {
      canvaTemplateLink: null,
      canvaDesignUrl: null,
      canvaExportPath: null,
      canvaPageProgress: [],
      canvaPdfUploaded: false,
      canvaJobJson: null,
      stepEditableStatus: 'pending'
    });
    store.appendEvent({ projectId, message: 'Canva template cleared. You can re-run Build Canva layer.' });
    await broadcastState();
    return store.getProject(projectId);
  });

  ipcMain.handle('project:clear-tpt-listing', async (_event, projectId) => {
    const project = store.getProject(projectId);
    if (!project) throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });
    assertNotGeneratingProject(projectId, 'deleting the listing');
    const listing = project.tptListing || {};
    for (const filePath of [...(listing.thumbnailPaths || []), listing.previewPdfPath, listing.videoPreviewPath]) {
      tryRemovePath(filePath);
    }
    store.updateProject(projectId, {
      tptListing: null,
      stepListingStatus: 'pending',
      stepThumbnailsStatus: 'pending',
      stepPreviewStatus: 'pending'
    });
    store.appendEvent({ projectId, message: 'Listing, mockups, and preview were deleted. Generate a new draft when ready.' });
    await broadcastState();
    return store.getProject(projectId);
  });

  ipcMain.handle('project:clear-tpt-thumbnail', async (_event, projectId, index) => {
    const project = store.getProject(projectId);
    const listing = project?.tptListing;
    if (!project || !listing) throw Object.assign(new Error('Create the listing draft first.'), { code: 'TPT_LISTING_REQUIRED' });
    assertNotGeneratingProject(projectId, 'deleting a mockup');
    const slot = Math.max(0, Math.min(3, Number(index) || 0));
    const thumbnailPaths = [...(listing.thumbnailPaths || [])];
    tryRemovePath(thumbnailPaths[slot]);
    thumbnailPaths[slot] = null;
    store.updateProject(projectId, {
      tptListing: invalidateTptListingReview(listing, {
        thumbnailPaths,
        status: thumbnailPaths.filter(Boolean).length ? 'draft_reviewing' : 'draft_ready',
        thumbnailProgress: { completed: thumbnailPaths.filter(Boolean).length, total: 4 }
      }),
      stepThumbnailsStatus: thumbnailPaths.filter(Boolean).length ? project.stepThumbnailsStatus : 'pending'
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
    for (const filePath of listing.thumbnailPaths || []) tryRemovePath(filePath);
    store.updateProject(projectId, {
      tptListing: invalidateTptListingReview(listing, {
        thumbnailPaths: [],
        status: 'draft_ready',
        thumbnailProgress: { completed: 0, total: 4 }
      }),
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
    if (opts.engine) setActiveEngine(opts.engine);
    requireActiveEngine('starting generation');
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
    const project = await ensureThankYouPdfForProject(projectId);
    const outputPath = await fileManager.exportPdf(project, options);
    const modeLabel = options?.exportMode === 'BOOKLET_SADDLE_STITCH' ? 'Booklet Spreads PDF' : 'PDF';
    store.appendEvent({ projectId, level: 'success', message: `${modeLabel} created: ${outputPath}` });
    await broadcastState();
    return outputPath;
  });

  ipcMain.handle('project:export-zip', async (_event, projectId, options) => {
    const project = await ensureThankYouPdfForProject(projectId);
    const outputPath = await fileManager.exportZip(project, options);
    const modeLabel = options?.exportMode === 'BOOKLET_SADDLE_STITCH' ? 'Booklet Spreads ZIP' : 'ZIP';
    store.appendEvent({ projectId, level: 'success', message: `${modeLabel} created: ${outputPath}` });
    await broadcastState();
    return outputPath;
  });

  ipcMain.handle('project:export-pptx', async (_event, projectId, options) => {
    const project = await ensureThankYouPdfForProject(projectId);
    if (!project) throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });
    const outputPath = await fileManager.exportPptx(project, options);
    const modeLabel = options?.exportMode === 'BOOKLET_SADDLE_STITCH' ? 'Booklet Spreads PPTX' : 'PPTX';
    store.appendEvent({ projectId, level: 'success', message: `${modeLabel} created: ${outputPath}` });
    await broadcastState();
    return outputPath;
  });

  ipcMain.handle('project:export-all-files', async (_event, projectId, options) => {
    const project = await ensureThankYouPdfForProject(projectId);
    if (!project) throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });
    if (project.stats.complete !== project.stats.total || project.stats.total === 0) {
      throw Object.assign(new Error('Export All Files is available after every page is complete.'), { code: 'BOOK_INCOMPLETE' });
    }
    const choice = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose where to export the complete book folder',
      defaultPath: app.getPath('desktop'),
      buttonLabel: 'Export all files here',
      properties: ['openDirectory', 'createDirectory']
    });
    if (choice.canceled || !choice.filePaths[0]) return null;
    await fileManager.exportPdf(project, options);
    await fileManager.exportZip(project, options);
    const exportDirectory = uniqueExportDirectory(choice.filePaths[0], project.name);
    cpSync(project.outputDir, exportDirectory, { recursive: true, errorOnExist: true, filter: (src) => !src.endsWith(".raw.png") });
    store.appendEvent({ projectId, level: 'success', message: `All book files exported to: ${exportDirectory}` });
    await broadcastState();
    return exportDirectory;
  });

  ipcMain.handle('project:generate-tpt-listing', async (_event, projectId) => {
    assertBrowserFree('SEO');
    await assertListingChatSessionReady('preparing SEO');
    const project = store.getProject(projectId);
    if (!project) throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });
    // #region agent log
    try {
      const fs = require('fs');
      const path = require('path');
      const logPath = path.join(__dirname, '..', '.cursor', 'debug-1c3662.log');
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.appendFileSync(logPath, `${JSON.stringify({
        sessionId: '1c3662',
        runId: 'seo-functional',
        hypothesisId: 'SEO',
        location: 'main.cjs:generate-tpt-listing',
        message: 'SEO generate invoked',
        data: {
          projectId,
          engine: getActiveEngine(),
          stepListingStatus: project.stepListingStatus || null,
          pagesComplete: project.stats?.complete,
          pagesTotal: project.stats?.total,
          hasExistingListing: Boolean(project.tptListing?.title)
        },
        timestamp: Date.now()
      })}\n`);
    } catch { /* ignore */ }
    // #endregion
    if (project.stats.complete !== project.stats.total || project.stats.total === 0) {
      throw Object.assign(new Error('Complete every page before preparing SEO.'), { code: 'BOOK_INCOMPLETE' });
    }
    try {
      await publishLiveOperation({
        kind: 'listing',
        label: 'SEO',
        percent: 8,
        message: 'Building the finished book PDF for SEO…',
        projectId
      });
      const pdfPath = await ensureProductPdf(projectId);
      if (!pdfPath) {
        throw Object.assign(new Error('Complete every page before preparing SEO. The book PDF is built automatically when pages finish.'), {
          code: 'BOOK_INCOMPLETE'
        });
      }
      // Keep Word/Google-Doc export for the ZIP pack, but Gemini listing reads the PDF
      // the same way TPT Book Automation did.
      let seoDocPath = null;
      try {
        seoDocPath = await ensureSeoBookDocument(projectId);
      } catch {
        seoDocPath = null;
      }
      await publishLiveOperation({
        kind: 'listing',
        label: 'SEO',
        percent: 32,
        message: 'Uploading the finished book PDF and drafting best-seller SEO…',
        projectId
      });
      // #region agent log
      try {
        const fs = require('fs');
        const path = require('path');
        fs.appendFileSync(path.join(__dirname, '..', '.cursor', 'debug-1c3662.log'), `${JSON.stringify({
          sessionId: '1c3662', runId: 'seo-stage', hypothesisId: 'DOC', location: 'main.cjs:generate-tpt-listing:attach',
          message: 'SEO attachment chosen',
          data: {
            projectId,
            usedDoc: Boolean(seoDocPath),
            attachmentExt: path.extname(pdfPath || ''),
            attachmentBytes: pdfPath && existsSync(pdfPath) ? fs.statSync(pdfPath).size : 0,
            attachMode: 'pdf-like-tpt-book-automation'
          },
          timestamp: Date.now()
        })}\n`);
      } catch { /* ignore */ }
      // #endregion
      const result = await browser.generateTptListingWithGpt({ project, pdfPath });
      await publishLiveOperation({
        kind: 'listing',
        label: 'SEO',
        percent: 88,
        message: 'Saving title, description, and tags into one SEO draft…',
        projectId
      });
      const previous = project.tptListing || {};
      const listing = {
        ...previous,
        ...applyListingDefaults(parseTptListingResponse(result.rawText), getPreferences()),
        rawResponse: result.rawText,
        productPdfPath: pdfPath,
        seoDocumentPath: seoDocPath || previous.seoDocumentPath || null,
        conversationUrl: result.conversationUrl,
        status: 'draft_ready',
        thumbnailPaths: Array.isArray(previous.thumbnailPaths) ? previous.thumbnailPaths : [],
        previewPdfPath: previous.previewPdfPath || null,
        videoPreviewPath: previous.videoPreviewPath || null,
        videoPreviewStatus: previous.videoPreviewStatus || null,
        formContract: previous.formContract || null
      };
      listing.seoText = formatSeoBundleText(listing);
      // #region agent log
      try {
        const fs = require('fs');
        const path = require('path');
        const logPath = path.join(__dirname, '..', '.cursor', 'debug-1c3662.log');
        fs.appendFileSync(logPath, `${JSON.stringify({
          sessionId: '1c3662',
          runId: 'listing-debug',
          hypothesisId: 'D',
          location: 'main.cjs:generate-tpt-listing:parsed',
          message: 'listing extracted from chat',
          data: {
            projectId,
            engine: getActiveEngine(),
            hasTitle: Boolean(listing.title),
            hasDescription: Boolean(listing.description),
            tagCount: Array.isArray(listing.tags) ? listing.tags.length : 0,
            subjectCount: Array.isArray(listing.subjects) ? listing.subjects.length : 0,
            rawLen: String(result.rawText || '').length,
            conversationUrl: Boolean(result.conversationUrl)
          },
          timestamp: Date.now()
        })}\n`);
      } catch { /* ignore */ }
      // #endregion
      store.updateProject(projectId, { tptListing: listing, stepListingStatus: 'completed' });
      store.appendEvent({ projectId, level: 'success', message: 'Best-seller SEO drafted from the finished book PDF.' });
      return store.getProject(projectId);
    } catch (error) {
      // #region agent log
      try {
        const fs = require('fs');
        const path = require('path');
        const logPath = path.join(__dirname, '..', '.cursor', 'debug-1c3662.log');
        fs.appendFileSync(logPath, `${JSON.stringify({
          sessionId: '1c3662',
          runId: 'listing-debug',
          hypothesisId: 'D',
          location: 'main.cjs:generate-tpt-listing:error',
          message: 'listing generate failed',
          data: { projectId, code: error?.code || null, err: String(error?.message || error).slice(0, 200) },
          timestamp: Date.now()
        })}\n`);
      } catch { /* ignore */ }
      // #endregion
      store.updateProject(projectId, { stepListingStatus: 'pending' });
      if (isPauseError(error)) {
        store.appendEvent({ projectId, level: 'warn', message: 'Listing paused. Start again when you are ready.' });
        throw Object.assign(new Error('Stopped. You paused this work.'), { code: 'QUEUE_PAUSED' });
      }
      throw error;
    } finally {
      finishLiveWork();
      await broadcastState();
    }
  });

  ipcMain.handle('project:generate-tpt-thumbnails', async (_event, projectId) => {
    assertBrowserFree('mockups');
    requireActiveEngine('generating listing thumbnails');
    const project = await ensureListingShellForAssets(projectId);
    const listing = project?.tptListing;
    if (!project || !listing?.productPdfPath) {
      throw Object.assign(new Error('Complete every page before mockups.'), { code: 'BOOK_INCOMPLETE' });
    }
    const thumbnailPaths = [...(listing.thumbnailPaths ?? [])];
    store.updateProject(projectId, { tptListing: invalidateTptListingReview(listing, { thumbnailPaths, status: 'thumbnails_generating', thumbnailProgress: { completed: thumbnailPaths.length, total: 4 } }) });
    await publishLiveOperation({
      kind: 'thumbnails',
      label: 'Listing mockups',
      percent: 8,
      message: 'Preparing listing mockups…',
      projectId
    });
    try {
      const generated = await browser.generateTptThumbnailsWithGpt({ project, pdfPath: listing.productPdfPath, listing, onThumbnail: async ({ index, buffer, conversationUrl }) => {
        const outputPath = await fileManager.saveGeneratedThumbnail({ buffer, fileName: `thumbnail_${index + 1}.png`, outputDir: project.outputDir });
        thumbnailPaths[index] = outputPath;
        const current = store.getProject(projectId)?.tptListing ?? listing;
        const completed = thumbnailPaths.filter(Boolean).length;
        store.updateProject(projectId, { tptListing: { ...current, thumbnailPaths, thumbnailConversationUrl: conversationUrl, status: 'thumbnails_generating', thumbnailProgress: { completed, total: 4 } } });
        store.appendEvent({ projectId, level: 'success', message: `TPT thumbnail ${index + 1}/4 saved.` });
        await publishLiveOperation({
          kind: 'thumbnails',
          label: 'Listing mockups',
          percent: Math.round((completed / 4) * 100),
          message: `Filling mockup ${index + 1} of 4…`,
          projectId
        });
      }});
      const current = store.getProject(projectId)?.tptListing ?? listing;
      store.updateProject(projectId, { tptListing: { ...current, thumbnailPaths, thumbnailConversationUrl: generated.conversationUrl, status: 'assets_ready', thumbnailProgress: { completed: 4, total: 4 } } });
      store.appendEvent({ projectId, level: 'success', message: 'Four listing thumbnails generated from the book pages.' });
      return store.getProject(projectId);
    } catch (error) {
      if (isPauseError(error)) {
        store.appendEvent({ projectId, level: 'warn', message: 'Mockups paused. Start again when you are ready.' });
        throw Object.assign(new Error('Stopped. You paused this work.'), { code: 'QUEUE_PAUSED' });
      }
      require("fs").writeFileSync("/tmp/tpt-error.log", error.stack || String(error));
      const current = store.getProject(projectId)?.tptListing ?? listing;
      store.updateProject(projectId, { tptListing: { ...current, thumbnailPaths, status: 'thumbnails_failed', thumbnailProgress: { completed: thumbnailPaths.filter(Boolean).length, total: 4 }, thumbnailError: error.message } });
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

  ipcMain.handle('project:regenerate-tpt-field', async (_event, projectId, field) => {
    assertIdle();
    const project = store.getProject(projectId);
    const listing = project?.tptListing;
    const listFields = new Set(['highlights', 'tags', 'grades', 'subjects', 'formats']);
    const allowed = new Set(['title', 'description', 'teachingDuration', 'answerKey', ...listFields]);
    if (!project || !listing?.productPdfPath || !allowed.has(field)) throw Object.assign(new Error('Select a valid listing field.'), { code: 'TPT_FIELD_INVALID' });
    const rawValue = await browser.regenerateTptListingFieldWithGpt({ project, pdfPath: listing.productPdfPath, listing, field });
    const value = listFields.has(field) ? rawValue.split(/[\n,]/).map((item) => cleanText(item.replace(/^[-•]\s*/, ''))).filter(Boolean) : rawValue;
    store.updateProject(projectId, { tptListing: invalidateTptListingReview(listing, { [field]: value, status: 'draft_reviewing' }) });
    store.appendEvent({ projectId, level: 'success', message: `TPT ${field} regenerated.` });
    await broadcastState();
    return store.getProject(projectId);
  });

  ipcMain.handle('project:regenerate-tpt-thumbnail', async (_event, projectId, thumbnailIndex) => {
    assertIdle();
    const project = store.getProject(projectId);
    const listing = project?.tptListing;
    const index = Number.parseInt(thumbnailIndex, 10);
    if (!project || !listing?.productPdfPath || !Number.isInteger(index) || index < 0 || index > 3) {
      throw Object.assign(new Error('Select a valid thumbnail to regenerate.'), { code: 'TPT_THUMBNAIL_INVALID' });
    }
    const thumbnailPaths = [...(listing.thumbnailPaths ?? [])];
    thumbnailPaths[index] = null;
    store.updateProject(projectId, {
      tptListing: invalidateTptListingReview(listing, {
        thumbnailPaths,
        status: 'thumbnails_generating',
        thumbnailError: null,
        thumbnailProgress: { completed: thumbnailPaths.filter(Boolean).length, total: 4 }
      })
    });
    await broadcastState();
    try {
      const generated = await browser.generateTptThumbnailsWithGpt({
        project,
        pdfPath: listing.productPdfPath,
        listing: { ...listing, thumbnailPaths },
        thumbnailIndex: index,
        onThumbnail: async ({ buffer, conversationUrl }) => {
          const outputPath = await fileManager.saveGeneratedThumbnail({
            buffer,
            fileName: `thumbnail_${index + 1}.png`,
            outputDir: project.outputDir
          });
          thumbnailPaths[index] = outputPath;
          const current = store.getProject(projectId)?.tptListing ?? listing;
          store.updateProject(projectId, {
            tptListing: {
              ...current,
              thumbnailPaths,
              thumbnailConversationUrl: conversationUrl,
              status: 'assets_ready',
              thumbnailError: null,
              thumbnailProgress: { completed: thumbnailPaths.filter(Boolean).length, total: 4 }
            }
          });
          store.appendEvent({ projectId, level: 'success', message: `TPT thumbnail ${index + 1}/4 regenerated and saved.` });
          await broadcastState();
        }
      });
      const current = store.getProject(projectId)?.tptListing ?? listing;
      store.updateProject(projectId, {
        tptListing: {
          ...current,
          thumbnailPaths,
          thumbnailConversationUrl: generated.conversationUrl || current.thumbnailConversationUrl,
          status: 'assets_ready',
          thumbnailProgress: { completed: thumbnailPaths.filter(Boolean).length, total: 4 }
        }
      });
      await broadcastState();
      return store.getProject(projectId);
    } catch (error) { require("fs").writeFileSync("/tmp/tpt-error.log", error.stack || String(error));
      const current = store.getProject(projectId)?.tptListing ?? listing;
      store.updateProject(projectId, {
        tptListing: {
          ...current,
          thumbnailPaths,
          status: 'thumbnails_failed',
          thumbnailError: error.message,
          thumbnailProgress: { completed: thumbnailPaths.filter(Boolean).length, total: 4 }
        }
      });
      store.appendEvent({ projectId, level: 'error', message: `TPT thumbnail ${index + 1} regeneration paused: ${error.message}` });
      await broadcastState();
      throw error;
    }
  });

  ipcMain.handle('project:mark-tpt-ready', async (_event, projectId) => {
    const project = store.getProject(projectId);
    const listing = project?.tptListing;
    const paidPrice = Number.parseFloat(listing?.suggestedPrice);
    const licensePrice = Number.parseFloat(listing?.multipleLicensePrice);
    const bundlePrice = Number.parseFloat(listing?.bundleDiscountPrice);
    const pricingReady = listing?.isFreeResource === true || (Number.isFinite(paidPrice) && paidPrice >= 0);
    const licenseReady = Number.isFinite(licensePrice) && licensePrice >= 0;
    const bundleReady = !listing?.bundleDiscountPrice || (Number.isFinite(bundlePrice) && bundlePrice >= 0);
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
      && listing.taxCode
      && ['original', 'licensed'].includes(listing.copyrightDeclaration)
    );
    const thumbnailMode = ['auto', 'manual', 'later'].includes(listing?.thumbnailMode) ? listing.thumbnailMode : 'manual';
    const thumbnailsReady = thumbnailMode !== 'manual'
      || Boolean(listing.thumbnailPaths?.[0] && existsSync(listing.thumbnailPaths[0]));
    if (!metadataReady || !thumbnailsReady || !pricingReady || !licenseReady || !bundleReady) {
      throw Object.assign(new Error('Complete the current TPT contract: PDF, title, description, tax code, grades, subjects, tags, price/free choice, multi-license price, copyright, and a Main Cover when manual thumbnails are selected.'), { code: 'TPT_REVIEW_INCOMPLETE' });
    }
    const reviewApprovedAt = new Date().toISOString();
    store.updateProject(projectId, {
      isReadyToPublish: 1,
      tptListing: {
        ...listing,
        status: 'ready_to_upload',
        reviewApprovedAt,
        reviewedAt: reviewApprovedAt,
        uploadError: null,
        uploadMessage: null
      }
    });
    store.appendEvent({ projectId, level: 'success', message: 'GPT listing marked ready to upload after manual review.' });
    await broadcastState();
    return store.getProject(projectId);
  });

  ipcMain.handle('project:update-tpt-publication', async (_event, projectId, settings = {}) => {
    const project = store.getProject(projectId);
    const listing = project?.tptListing;
    if (!listing) throw Object.assign(new Error('Create the GPT listing draft first.'), { code: 'TPT_LISTING_REQUIRED' });
    const compactList = (value, limit) => String(value ?? '').split(/[\n,]/).map((item) => cleanText(item)).filter(Boolean).slice(0, limit);
    const title = settings.title != null ? cleanText(settings.title, listing.title || project.name) : (listing.title || project.name || '');
    const description = settings.description != null ? cleanText(settings.description, listing.description || '') : (listing.description || '');
    const tags = settings.tags != null ? compactList(settings.tags, 6) : (listing.tags || []);
    const grades = settings.grades != null ? compactList(settings.grades, 4) : (listing.grades || []);
    const subjects = settings.subjects != null ? compactList(settings.subjects, 3) : (listing.subjects || []);
    const formats = settings.formats != null ? compactList(settings.formats, 3) : (listing.formats || []);
    const customCategories = settings.customCategories != null ? compactList(settings.customCategories, 8) : (listing.customCategories || []);
    const sanitizedSeo = sanitizeSeoListingFields({ title, description, tags, subjects });
    const pageCount = settings.pageCount != null ? Math.max(0, Number.parseInt(settings.pageCount, 10) || 0) : (listing.pageCount || 0);
    const standards = {
      ccss: settings.ccss != null ? compactList(settings.ccss, 50) : (listing.standards?.ccss || []),
      ngss: settings.ngss != null ? compactList(settings.ngss, 50) : (listing.standards?.ngss || []),
      teks: settings.teks != null ? compactList(settings.teks, 50) : (listing.standards?.teks || []),
      vaSol: settings.vaSol != null ? compactList(settings.vaSol, 50) : (listing.standards?.vaSol || [])
    };
    const isFreeResource = settings.isFreeResource != null
      ? settings.isFreeResource === true
      : listing.isFreeResource === true;
    const suggestedPrice = settings.suggestedPrice != null
      ? cleanText(settings.suggestedPrice)
      : (listing.suggestedPrice || '');
    const multipleLicensePrice = settings.multipleLicensePrice != null
      ? cleanText(settings.multipleLicensePrice)
      : (listing.multipleLicensePrice || '');
    const bundleDiscountPrice = settings.bundleDiscountPrice != null
      ? cleanText(settings.bundleDiscountPrice)
      : (listing.bundleDiscountPrice || '');
    const taxCode = settings.taxCode != null ? cleanText(settings.taxCode) : (listing.taxCode || '');
    const copyrightDeclaration = settings.copyrightDeclaration != null
      ? (['original', 'licensed'].includes(settings.copyrightDeclaration) ? settings.copyrightDeclaration : '')
      : (listing.copyrightDeclaration || '');
    const publicationStatus = settings.publicationStatus != null
      ? (settings.publicationStatus === 'active' ? 'active' : 'draft')
      : (listing.publicationStatus === 'active' ? 'active' : 'draft');
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
      isFreeResource,
      suggestedPrice: isFreeResource ? '' : suggestedPrice,
      multipleLicensePrice,
      bundleDiscountPrice,
      taxCode,
      copyrightDeclaration,
      publicationStatus,
      thumbnailMode,
      seoText: formatSeoBundleText(sanitizedSeo)
    };
    const materialChanged = Object.entries(publicationChanges)
      .some(([key, value]) => JSON.stringify(listing[key] ?? null) !== JSON.stringify(value ?? null));
    store.updateProject(projectId, {
      tptListing: materialChanged
        ? invalidateTptListingReview(listing, { ...publicationChanges, status: 'draft_reviewing' })
        : { ...listing, ...publicationChanges }
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
    store.updateProject(projectId, { tptListing: invalidateTptListingReview(listing, { [definition.key]: outputPath, status: 'draft_reviewing' }) });
    store.appendEvent({ projectId, level: 'success', message: `${assetType === 'videoPreview' ? 'Video preview' : 'Product preview'} saved to the local TPT asset package.` });
    await broadcastState();
    return store.getProject(projectId);
  });

  ipcMain.handle('project:clear-tpt-asset', async (_event, projectId, assetType) => {
    const project = store.getProject(projectId);
    const listing = project?.tptListing;
    if (!listing) throw Object.assign(new Error('Create the GPT listing draft first.'), { code: 'TPT_LISTING_REQUIRED' });
    const key = assetType === 'videoPreview' ? 'videoPreviewPath' : 'previewPdfPath';
    store.updateProject(projectId, { tptListing: invalidateTptListingReview(listing, { [key]: null, status: 'draft_reviewing' }) });
    await broadcastState();
    return store.getProject(projectId);
  });

  ipcMain.handle('tpt:open-upload', () => browser.openTptDraftUpload());
  ipcMain.handle('tpt:complete-human-verification', () => browser.completeTptHumanVerification());
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
    const project = store.getProject(projectId);
    const listing = project?.tptListing;
    if (!project || !listing?.productPdfPath || !tptListingReviewApproved(listing)) {
      throw Object.assign(new Error('Mark the listing ready only after reviewing its PDF, complete metadata, commercial fields, and chosen thumbnail mode.'), { code: 'TPT_REVIEW_INCOMPLETE' });
    }
    const updateProgress = async ({ stage, message }) => {
      const current = store.getProject(projectId)?.tptListing ?? listing;
      store.updateProject(projectId, {
        tptListing: {
          ...current,
          status: stage === 'ready_for_listing_submit' ? 'listing_form_ready' : 'uploading_listing',
          uploadStage: stage,
          uploadMessage: message,
          uploadError: null,
          uploadStartedAt: current.uploadStartedAt ?? new Date().toISOString()
        }
      });
      store.appendEvent({ projectId, level: 'info', message: `TPT upload — ${message}` });
      await broadcastState();
    };
    await updateProgress({ stage: 'opening', message: 'Opening the app-owned Chromium and the TPT upload form…' });
    const result = await browser.runTptListingPreparation({ listing, projectId, onProgress: updateProgress });
    const current = store.getProject(projectId)?.tptListing ?? listing;
    store.updateProject(projectId, {
      tptListing: {
        ...current,
        status: 'listing_form_ready',
        uploadUrl: result.url,
        formContract: result.formContract,
        standardsRequireReview: result.standardsRequireReview,
        uploadStage: 'ready_for_listing_submit',
        uploadError: null,
        uploadMessage: listing.publicationStatus === 'active' || result.standardsRequireReview
          ? `All automated steps completed. The TPT form is ready for final ${listing.publicationStatus === 'active' ? 'Active' : 'Draft'} submission.`
          : 'All automated steps completed. Submitting the inactive TPT draft automatically…'
      }
    });
    const autoSubmitDraft = listing.publicationStatus !== 'active' && !result.standardsRequireReview;
    store.appendEvent({
      projectId,
      level: 'success',
      message: autoSubmitDraft
        ? 'TPT form prepared for an inactive draft. Continuing directly to final submission.'
        : `TPT form prepared for ${listing.publicationStatus === 'active' ? 'an active listing' : 'a draft with education standards that require review'}. Review it in TPT before final submission.`
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
    } catch (error) { require("fs").writeFileSync("/tmp/tpt-error.log", error.stack || String(error));
      if (error?.tptSubmissionHandled) throw error;
      const project = store.getProject(projectId);
      const listing = project?.tptListing;
      if (listing) {
        store.updateProject(projectId, {
          tptListing: {
            ...listing,
            status: 'upload_failed',
            uploadStage: listing.uploadStage ?? 'opening',
            uploadError: error.message,
            uploadMessage: `Stopped: ${error.message}`
          }
        });
        store.appendEvent({ projectId, level: 'error', message: `TPT upload stopped at ${listing.uploadStage ?? 'opening'}: ${error.message}` });
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
        if (listing && !listing.uploadError) {
          store.updateProject(projectId, {
            tptListing: {
              ...listing,
              status: 'upload_failed',
              uploadStage: listing.uploadStage ?? 'opening',
              uploadError: error.message,
              uploadMessage: handledFailure
                ? `This product failed; the bundle continued safely: ${error.message}`
                : `Bundle stopped: ${error.message}`
            }
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
    const isReadyOrApprovedFailed = ['listing_form_ready', 'draft_form_ready'].includes(listing?.status) || (listing?.status === 'upload_failed' && Boolean(listing?.reviewApprovedAt));
    if (!project || !isReadyOrApprovedFailed) {
      throw Object.assign(new Error('Prepare and review the TPT form before submitting it.'), { code: 'TPT_LISTING_NOT_READY' });
    }
    const submissionListing = forceDraft ? { ...listing, publicationStatus: 'draft' } : listing;
    const statusLabel = submissionListing.publicationStatus === 'active' ? 'active listing' : 'inactive draft';
    const updateProgress = async ({ stage, message }) => {
      const current = store.getProject(projectId)?.tptListing ?? listing;
      store.updateProject(projectId, { tptListing: { ...current, status: 'submitting_listing', uploadStage: stage, uploadMessage: message } });
      store.appendEvent({ projectId, level: 'info', message: `TPT upload — ${message}` });
      await broadcastState();
    };
    try {
      const result = await browser.submitTptListing({ listing: submissionListing, projectId, onProgress: updateProgress });
      const current = store.getProject(projectId)?.tptListing ?? listing;
      const completedStatus = result.publicationStatus === 'active' ? 'listing_published' : 'draft_submitted';
      store.updateProject(projectId, { tptListing: { ...current, publicationStatus: result.publicationStatus, status: completedStatus, uploadStage: completedStatus, uploadUrl: result.url, uploadVerified: result.verified, uploadedAt: new Date().toISOString() } });
      store.appendEvent({ projectId, level: 'success', message: `TPT ${statusLabel} submitted and verified in My Products.` });
      await broadcastState();
      return result;
    } catch (error) { require("fs").writeFileSync("/tmp/tpt-error.log", error.stack || String(error));
      error.tptSubmissionHandled = true;
      const current = store.getProject(projectId)?.tptListing ?? listing;
      const preparedFormLost = ['TPT_PAGE_CLOSED', 'TPT_PREPARED_FORM_STALE', 'TPT_REQUIRED_METADATA_MISSING'].includes(error.code);
      store.updateProject(projectId, {
        tptListing: {
          ...current,
          status: preparedFormLost ? 'upload_failed' : 'listing_form_ready',
          uploadError: error.message,
          uploadMessage: preparedFormLost
            ? `The prepared TPT form needs automatic recovery. Resume uploading restores it without another listing review.`
            : `Submission stopped: ${error.message}`
        }
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

  ipcMain.handle('project:submit-tpt-listing', async (_event, projectId) => submitTptListingExclusively(projectId, false));
  ipcMain.handle('project:submit-tpt-draft', async (_event, projectId) => submitTptListingExclusively(projectId, true));

  ipcMain.handle('path:reveal', (_event, targetPath) => {
    if (targetPath && existsSync(targetPath)) shell.showItemInFolder(targetPath);
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
    
    // 2. Delete files on disk recursively if outputDir exists
    const fs = require('node:fs');
    if (project.outputDir && fs.existsSync(project.outputDir)) {
      try {
        fs.rmSync(project.outputDir, { recursive: true, force: true });
      } catch (err) {
        console.error(`Failed to delete output directory ${project.outputDir}:`, err);
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

if (singleInstanceAcquired) app.whenReady().then(() => {
  bootLog('whenReady');
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
  applyNativeAppearance();
  nativeTheme.on('updated', () => {
    if (!store) return;
    applyNativeAppearance();
    broadcastState().catch(() => {});
  });
  createSplashWindow();
  bootLog('splash created');
  if (store.getSetting('loginSessionSchemaVersion', 0) !== LOGIN_SESSION_SCHEMA_VERSION) {
    store.setSetting('loginSessionSchemaVersion', LOGIN_SESSION_SCHEMA_VERSION);
    store.setSetting('enableProfileSwapping', false);
  }
  if (process.env.TPT_TEST_USER_DATA && !process.env.TPT_TEST_REQUIRE_LOGIN) {
    store.setSetting('chatgptLoginConfirmed', true);
    store.setSetting('geminiLoginConfirmed', true);
    store.setSetting('metaLoginConfirmed', true);
    store.setSetting('canvaLoginConfirmed', true);
  }
  store.recoverInterrupted();
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
      const body = await fs.promises.readFile(filePath);
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': mimeForPath(filePath),
          'Cache-Control': 'no-store'
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
        const thumbnailPath = store.getProject(projectId)?.tptListing?.thumbnailPaths?.[Number.parseInt(indexValue, 10)];
        if (!thumbnailPath || !fs.existsSync(thumbnailPath)) return new Response('Not found', { status: 404 });
        return serveLocalFile(thumbnailPath);
      }
      if (url.hostname === 'video-preview') {
        const projectId = decodeURIComponent(url.pathname.slice(1).split('/')[0] || '');
        const videoPath = store.getProject(projectId)?.tptListing?.videoPreviewPath;
        if (!videoPath || !fs.existsSync(videoPath)) return new Response('Not found', { status: 404 });
        return serveLocalFile(videoPath);
      }
      if (url.hostname === 'competitor-mockup') {
        const [projectId, indexValue] = url.pathname.slice(1).split('/').map(decodeURIComponent);
        const mockupPath = store.getProject(projectId)?.competitorMockups?.images?.[Number.parseInt(indexValue, 10)]?.path;
        if (!mockupPath || !fs.existsSync(mockupPath)) return new Response('Not found', { status: 404 });
        return serveLocalFile(mockupPath);
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
      let targetPath = job.outputPath;
      if (rawMode && /\.png$/i.test(job.outputPath)) {
        const rawPath = job.outputPath.replace(/\.png$/i, '.raw.png');
        if (fs.existsSync(rawPath)) {
          targetPath = rawPath;
        }
      }
      // Serve SVG masters with image/svg+xml so <img> page-board / studio previews render.
      return serveLocalFile(targetPath);
    } catch {
      return new Response('Bad request', { status: 400 });
    }
  });
  fileManager = new FileManager({ nativeImage });
  browser = new BrowserController({
    profileDir: require('os').homedir() + '/ChromeAutomationProfile',
    downloadDir: join(userData, 'browser-downloads'),
    getMetaConfig
  });
  browser.on('canva-journal', (row) => {
    try {
      store.appendCanvaJournal({
        projectId: row.projectId || liveOperation?.projectId || null,
        state: row.state,
        pageNumber: row.pageNumber,
        action: row.action,
        expected: row.expected,
        detected: row.detected,
        verification: row.verification,
        outcome: row.outcome,
        retryCount: row.retryCount,
        details: row.details
      });
    } catch {}
  });

  const savedRotation = store.getSetting('profileRotationList', []);
  const savedIndex = store.getSetting('currentProfileIndex', 0);
  const savedSwappingEnabled = store.getSetting('enableProfileSwapping', false);
  browser.enableProfileSwapping = Boolean(savedSwappingEnabled);
  if (Array.isArray(savedRotation) && savedRotation.length) {
    browser.setProfileRotation(savedRotation, savedIndex);
  }
  restoreSavedServiceLogins();
  browser.on('profile-swapped', (data) => {
    store.setSetting('currentProfileIndex', data.currentIndex);
    broadcastState();
  });

  applyActiveEngineToBrowser();
  queue = new QueueEngine({ store, browser, fileManager });
  queue.on('changed', broadcastState);
  queue.on('log', broadcastState);
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
    try {
      await ensureProductPdf(projectId, { force: true });
    } catch (error) {
      store.appendEvent({
        projectId,
        level: 'error',
        message: `Pages are complete, but the book PDF could not be built: ${error.message}`
      });
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
  browser.on('status', broadcastState);
  browser.on('login-progress', (payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('browser:login-progress', payload);
    }
  });

  // ─── AutomationManager instantiation ─────────────────────────────────────
  // Step runners delegate to the same functions used by the manual workflow.
  automation = new AutomationManager({
    store,
    broadcast: broadcastState,
    abortStep: async (step, projectId) => {
      store.appendEvent({
        projectId,
        level: 'warn',
        message: `[Automation] Force-closing the browser session for the frozen step "${step}".`,
        details: { code: 'STEP_ABORT' }
      });
      if (step === 'interior') {
        try { queue.pause(); } catch {}
      }
      browser.abortTptHumanVerification?.(
        Object.assign(new Error(`The "${step}" step was aborted because it stopped responding.`), { code: 'STEP_ABORTED' })
      );
      await browser.close().catch(() => {});
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
      try { queue.pause(); } catch {}
      try { browser.cancelWaits(); } catch {}
    },
    onResume: () => {
      const currentId = automation.getStatus().currentProjectId;
      const step = automation.getStatus().currentStep;
      if (step === 'interior' && currentId && !queue.running) {
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
        const paths = store.getProject(projectId)?.tptListing?.thumbnailPaths ?? [];
        const saved = paths.filter((filePath) => filePath && existsSync(filePath)).length;
        if (saved < 4) {
          throw Object.assign(
            new Error(`Only ${saved} of 4 marketing thumbnails were generated.`),
            { code: 'TPT_THUMBNAILS_INCOMPLETE' }
          );
        }
      },
      preview: (projectId) => {
        const listing = store.getProject(projectId)?.tptListing;
        if (listing?.videoPreviewPath && existsSync(listing.videoPreviewPath)) return;
        if (listing?.videoPreviewStatus === 'ready' && listing?.videoPreviewPath) return;
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
        if (project.productFormat === 'editable') {
          const rasterPaths = collectProductPageImagePaths(project.jobs || []);
          const want = (project.jobs || []).length;
          if (rasterPaths.length < want) {
            throw Object.assign(new Error('Generate every interior page before sending the book to Canva.'), {
              code: 'CANVA_PAGES_MISSING'
            });
          }
        }
        const compressed = project.compressedPdfPath || project.printPdfJson?.compressedPdfPath || compressedPrintPdfDest(project.outputDir, project);
        if (!compressed || !existsSync(compressed)) {
          throw Object.assign(
            new Error('Interior pages finished, but the compressed print PDF is not ready.'),
            { code: 'PRINT_PDF_MISSING' }
          );
        }
      },
      editable: (projectId) => {
        const project = store.getProject(projectId);
        if (!project || project.productFormat !== 'editable') return;
        const link = project.canvaTemplateLink;
        if (link && isCanvaTemplateLink(link)) return;
        throw Object.assign(
          new Error('Canva template link was not saved. Run Build Canva layer (Magic Layers) first.'),
          { code: 'CANVA_TEMPLATE_LINK_MISSING' }
        );
      }
    },
    stepRunners: {
      // Projects enter this pipeline only after project creation has persisted
      // the overview, so the automated step validates that saved input.
      overview: async (projectId, onProgress) => {
        const project = store.getProject(projectId);
        if (!project) throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });
        if (!project.name || !project.theme) {
          throw Object.assign(new Error('The saved project overview is incomplete.'), { code: 'PROJECT_OVERVIEW_INCOMPLETE' });
        }
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
        queue.start(projectId);
        let lastRestartAt = 0;
        await new Promise((resolve, reject) => {
          const checkDone = async () => {
            const p = store.getProject(projectId);
            const pct = p?.stats?.total ? Math.round((p.stats.complete / p.stats.total) * 100) : 0;
            onProgress(Math.min(95, pct));
            if (p?.stats?.complete === p?.stats?.total && p?.stats?.total > 0) {
              queue.removeListener('changed', checkDone);
              resolve();
            } else if (!queue.running) {
              if (automation?.getStatus()?.paused) return;
              const remaining = (p?.stats?.total || 0) - (p?.stats?.complete || 0);
              if (remaining > 0 && automation?.getStatus()?.active) {
                if (Date.now() - lastRestartAt < 2_000) return;
                lastRestartAt = Date.now();
                try { queue.start(projectId); } catch {}
                return;
              }
              queue.removeListener('changed', checkDone);
              reject(Object.assign(new Error('Queue stopped before all pages completed.'), { code: 'QUEUE_STOPPED' }));
            }
          };
          queue.on('changed', checkDone);
          checkDone().catch(reject);
        });
        await finishPrintPdf();
      },
      editable: async (projectId, onProgress) => {
        const project = ensureProjectOutputDirectory(projectId);
        if (!project || project.productFormat !== 'editable') {
          onProgress(100);
          return;
        }
        await runCanvaEditableForProject(projectId, onProgress);
      },
      listing: async (projectId, onProgress) => {
        await assertListingChatSessionReady('listing generation');
        const project = ensureProjectOutputDirectory(projectId);
        if (!project) throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });
        // #region agent log
        try {
          const fs = require('fs');
          const path = require('path');
          const logPath = path.join(__dirname, '..', '.cursor', 'debug-1c3662.log');
          fs.mkdirSync(path.dirname(logPath), { recursive: true });
          fs.appendFileSync(logPath, `${JSON.stringify({
            sessionId: '1c3662',
            runId: 'listing-debug',
            hypothesisId: 'C',
            location: 'main.cjs:automation.listing',
            message: 'automation listing step start',
            data: {
              projectId,
              engine: getActiveEngine(),
              stepListingStatus: project.stepListingStatus || null,
              pagesComplete: project.stats?.complete,
              pagesTotal: project.stats?.total
            },
            timestamp: Date.now()
          })}\n`);
        } catch { /* ignore */ }
        // #endregion
        const pdfPath = await ensureProductPdf(projectId);
        if (!pdfPath) {
          throw Object.assign(new Error('Complete every page before preparing SEO.'), { code: 'BOOK_INCOMPLETE' });
        }
        let seoDocPath = null;
        try {
          seoDocPath = await ensureSeoBookDocument(projectId);
        } catch {
          seoDocPath = null;
        }
        // #region agent log
        try {
          const fs = require('fs');
          const path = require('path');
          fs.appendFileSync(path.join(__dirname, '..', '.cursor', 'debug-1c3662.log'), `${JSON.stringify({
            sessionId: '1c3662', runId: 'seo-stage', hypothesisId: 'DOC', location: 'main.cjs:automation.listing:attach',
            message: 'automation SEO attachment chosen',
            data: {
              projectId,
              usedDoc: Boolean(seoDocPath),
              attachmentExt: path.extname(pdfPath || ''),
              attachMode: 'pdf-like-tpt-book-automation'
            },
            timestamp: Date.now()
          })}\n`);
        } catch { /* ignore */ }
        // #endregion
        const result = await browser.generateTptListingWithGpt({ project, pdfPath });
        const previous = project.tptListing || {};
        const listing = {
          ...previous,
          ...applyListingDefaults(parseTptListingResponse(result.rawText), getPreferences()),
          rawResponse: result.rawText,
          productPdfPath: pdfPath,
          seoDocumentPath: seoDocPath || previous.seoDocumentPath || null,
          conversationUrl: result.conversationUrl,
          status: 'draft_ready',
          thumbnailPaths: Array.isArray(previous.thumbnailPaths) ? previous.thumbnailPaths : [],
          previewPdfPath: previous.previewPdfPath || null,
          videoPreviewPath: previous.videoPreviewPath || null,
          videoPreviewStatus: previous.videoPreviewStatus || null,
          formContract: previous.formContract || null
        };
        listing.seoText = formatSeoBundleText(listing);
        // #region agent log
        try {
          const fs = require('fs');
          const path = require('path');
          const logPath = path.join(__dirname, '..', '.cursor', 'debug-1c3662.log');
          fs.appendFileSync(logPath, `${JSON.stringify({
            sessionId: '1c3662',
            runId: 'listing-debug',
            hypothesisId: 'D',
            location: 'main.cjs:automation.listing:parsed',
            message: 'automation listing extracted',
            data: {
              projectId,
              engine: getActiveEngine(),
              hasTitle: Boolean(listing.title),
              hasDescription: Boolean(listing.description),
              tagCount: Array.isArray(listing.tags) ? listing.tags.length : 0,
              subjectCount: Array.isArray(listing.subjects) ? listing.subjects.length : 0,
              rawLen: String(result.rawText || '').length
            },
            timestamp: Date.now()
          })}\n`);
        } catch { /* ignore */ }
        // #endregion
        store.updateProject(projectId, { tptListing: listing, stepListingStatus: 'completed' });
        store.appendEvent({ projectId, level: 'success', message: '[Automation] Best-seller SEO drafted from the finished book PDF.' });
        onProgress(100);
        await broadcastState();
      },
      // thumbnails: generate 4 marketing thumbnails
      thumbnails: async (projectId, onProgress) => {
        requireActiveEngine('thumbnail generation');
        const project = await ensureListingShellForAssets(projectId);
        const listing = project?.tptListing;
        if (!project || !listing?.productPdfPath) {
          throw Object.assign(new Error('Complete every page before mockups.'), { code: 'BOOK_INCOMPLETE' });
        }
        const thumbnailPaths = [...(listing.thumbnailPaths ?? [])];
        store.updateProject(projectId, { tptListing: invalidateTptListingReview(listing, { thumbnailPaths, status: 'thumbnails_generating', thumbnailProgress: { completed: thumbnailPaths.length, total: 4 } }) });
        await broadcastState();
        let thumbCount = thumbnailPaths.filter(Boolean).length;
        await browser.generateTptThumbnailsWithGpt({ project, pdfPath: listing.productPdfPath, listing, onThumbnail: async ({ index, buffer, conversationUrl }) => {
          const outputPath = await fileManager.saveGeneratedThumbnail({ buffer, fileName: `thumbnail_${index + 1}.png`, outputDir: project.outputDir });
          thumbnailPaths[index] = outputPath;
          thumbCount += 1;
          const current = store.getProject(projectId)?.tptListing ?? listing;
          store.updateProject(projectId, { tptListing: { ...current, thumbnailPaths, thumbnailConversationUrl: conversationUrl, status: 'thumbnails_generating', thumbnailProgress: { completed: thumbCount, total: 4 } } });
          store.appendEvent({ projectId, level: 'success', message: `[Automation] Thumbnail ${index + 1}/4 saved.` });
          onProgress(Math.round((thumbCount / 4) * 100));
          await broadcastState();
        }});
        const current = store.getProject(projectId)?.tptListing ?? listing;
        store.updateProject(projectId, { tptListing: { ...current, thumbnailPaths, status: 'assets_ready', thumbnailProgress: { completed: 4, total: 4 } } });
        await broadcastState();
        onProgress(100);
      },
      preview: async (projectId, onProgress) => {
        const project = await ensureListingShellForAssets(projectId);
        const listing = project?.tptListing;
        if (!project || !listing) {
          throw Object.assign(new Error('Complete every page before preview.'), { code: 'BOOK_INCOMPLETE' });
        }
        if (listing.videoPreviewPath && existsSync(listing.videoPreviewPath)) {
          onProgress(100);
          return;
        }
        await generatePreviewVideoForProject(projectId, { onProgress });
      },
      // export: ZIP pack (PDF + listing mockups + PPTX + DOCX)
      export: async (projectId, onProgress) => {
        const project = ensureProjectOutputDirectory(projectId);
        if (!project) throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });
        if (project.stats.complete !== project.stats.total || project.stats.total === 0) {
          throw Object.assign(new Error('All pages must be complete before export.'), { code: 'BOOK_INCOMPLETE' });
        }
        await ensureThankYouPdfForProject(projectId);
        onProgress(25);
        await fileManager.exportZip(store.getProject(projectId) || project);
        store.appendEvent({
          projectId,
          level: 'success',
          message: '[Automation] Export ZIP ready (print PDF, listing mockups, PPTX, DOCX).'
        });
        await broadcastState();
        onProgress(100);
      }
    }
  });

  // Forward automation events to the renderer via IPC
  automation.on('progress', (payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('automation:progress', payload);
    }
    broadcastState().catch(() => {});
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  if (installingUpdate) return;
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  const installUpdateOnQuit = updateManager?.getState().status === 'ready';
  updateManager?.stop();
  queue?.pause();
  Promise.resolve(browser?.close()).finally(() => {
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
