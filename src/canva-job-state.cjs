'use strict';

/**
 * Canva job-state wrapper. BrowserController remains the only clicker.
 * Principle: OBSERVE → IDENTIFY → ACT → VERIFY → RECORD → CONTINUE.
 * Click-returned is never treated as success.
 */

const {
  isCanvaPdfTransferSuccess
} = require('./canva-pdf-inject.cjs');

const CANVA_STATES = Object.freeze([
  'BOOT',
  'BROWSER_READY',
  'CANVA_SESSION_READY',
  'CANVA_OPEN',
  'CREATE_DESIGN_READY',
  'IMAGE_INPUT_READY',
  'IMAGE_SELECTED',
  'IMAGE_ON_CANVAS',
  'IMAGE_READY',
  'PAGE_ADDED',
  'IMPORT_DIALOG_READY',
  'PDF_SELECTED',
  'PDF_UPLOADING',
  'PDF_UPLOAD_COMPLETE',
  'PROJECT_OPENING',
  'CANVA_EDITOR_READY',
  'PAGE_DETECTION',
  'EDIT_PANEL_READY',
  'MAGIC_LAYER_READY',
  'MAGIC_LAYER_PROCESSING',
  'MAGIC_LAYER_VERIFIED',
  'PAGE_COMPLETE',
  'NEXT_PAGE',
  'ALL_PAGES_COMPLETE',
  'SHARE_READY',
  'TEMPLATE_LINK_MENU',
  'TEMPLATE_LINK_CREATED',
  'TEMPLATE_LINK_COPIED',
  'JOB_COMPLETE',
  'RECOVERING',
  'MANUAL_INTERVENTION_REQUIRED'
]);

const PAGE_STATUSES = Object.freeze([
  'PENDING',
  'DETECTING',
  'SELECTING',
  'IMAGE_READY',
  'EDITING',
  'MAGIC_LAYER_PROCESSING',
  'VERIFYING',
  'SUCCESS',
  'RECOVERING',
  'MANUAL_INTERVENTION_REQUIRED',
  'FAILED'
]);

const WAIT_OUTCOMES = Object.freeze(['SUCCESS', 'RETRY', 'RECOVER', 'MANUAL_INTERVENTION', 'FAIL']);

const RECOVERY_POLICIES = Object.freeze({
  WRONG_OBJECT: {
    kind: 'WRONG_OBJECT',
    action: 'deselect → re-detect → retry',
    maxAttempts: 3,
    next: 'RETRY'
  },
  EDIT_PANEL_MISSING: {
    kind: 'EDIT_PANEL_MISSING',
    action: 'inspect → retry Edit → close floating UI if safe',
    maxAttempts: 3,
    next: 'RETRY'
  },
  MAGIC_LAYER_MISSING: {
    kind: 'MAGIC_LAYER_MISSING',
    action: 'a11y → DOM → screenshot → equivalent control → retry',
    maxAttempts: 3,
    next: 'RETRY'
  },
  STUCK_PROCESSING: {
    kind: 'STUCK_PROCESSING',
    action: 'adaptive wait → inspect → recover if genuinely stuck',
    maxAttempts: 2,
    next: 'RECOVER'
  },
  UNEXPECTED_NAVIGATION: {
    kind: 'UNEXPECTED_NAVIGATION',
    action: 'return to editor',
    maxAttempts: 2,
    next: 'RECOVER'
  },
  MODAL: {
    kind: 'MODAL',
    action: 'identify, close only if safe',
    maxAttempts: 2,
    next: 'RETRY'
  },
  BROWSER_UNRESPONSIVE: {
    kind: 'BROWSER_UNRESPONSIVE',
    action: 'health check, reconnect CDP, recover job state',
    maxAttempts: 2,
    next: 'RECOVER'
  },
  EXPIRED_SESSION: {
    kind: 'EXPIRED_SESSION',
    action: 'STOP and explain login',
    maxAttempts: 1,
    next: 'FAIL'
  },
  SLOW_LOAD: {
    kind: 'SLOW_LOAD',
    action: 'extend condition wait up to ceiling',
    maxAttempts: 3,
    next: 'RETRY'
  },
  SLOW_UPLOAD: {
    kind: 'SLOW_UPLOAD',
    action: 'keep watching real upload bytes; do not start a second upload',
    maxAttempts: 2,
    next: 'RETRY'
  },
  DELAYED_EDITOR: {
    kind: 'DELAYED_EDITOR',
    action: 'wait for Share/pages, then continue',
    maxAttempts: 3,
    next: 'RETRY'
  },
  PDF_IMPORT: {
    kind: 'PDF_IMPORT',
    action: 'retry a different import strategy, then open from Uploads, then reconnect CDP',
    maxAttempts: 3,
    next: 'RECOVER'
  },
  USER_INTERACTION: {
    kind: 'USER_INTERACTION',
    action: 'pause CDP waits, observe, then resume',
    maxAttempts: 1,
    next: 'MANUAL_INTERVENTION'
  },
  APP_RESTART: {
    kind: 'APP_RESTART',
    action: 'reconnect browser, open saved design URL, continue from first unlayered page',
    maxAttempts: 1,
    next: 'RECOVER'
  }
});

const STATE_TIMEOUTS_MS = Object.freeze({
  BOOT: 15_000,
  BROWSER_READY: 45_000,
  CANVA_SESSION_READY: 45_000,
  CANVA_OPEN: 30_000,
  CREATE_DESIGN_READY: 12_000,
  IMAGE_INPUT_READY: 12_000,
  IMAGE_SELECTED: 12_000,
  IMAGE_ON_CANVAS: 12_000,
  IMAGE_READY: 12_000,
  PAGE_ADDED: 12_000,
  IMPORT_DIALOG_READY: 12_000,
  PDF_SELECTED: 20_000,
  PDF_UPLOADING: 10 * 60_000,
  PDF_UPLOAD_COMPLETE: 30_000,
  PROJECT_OPENING: 45_000,
  CANVA_EDITOR_READY: 90_000,
  PAGE_DETECTION: 20_000,
  IMAGE_SELECTED: 12_000,
  EDIT_PANEL_READY: 12_000,
  MAGIC_LAYER_READY: 12_000,
  MAGIC_LAYER_PROCESSING: 180_000,
  MAGIC_LAYER_VERIFIED: 20_000,
  PAGE_COMPLETE: 8_000,
  NEXT_PAGE: 8_000,
  ALL_PAGES_COMPLETE: 20_000,
  SHARE_READY: 12_000,
  TEMPLATE_LINK_MENU: 12_000,
  TEMPLATE_LINK_CREATED: 20_000,
  TEMPLATE_LINK_COPIED: 12_000,
  JOB_COMPLETE: 5_000,
  RECOVERING: 45_000,
  MANUAL_INTERVENTION_REQUIRED: 0
});

function isCanvaState(value) {
  return CANVA_STATES.includes(String(value || ''));
}

function isPageStatus(value) {
  return PAGE_STATUSES.includes(String(value || ''));
}

function enrichPageProgress(row = {}, patch = {}) {
  const pageNumber = Number(patch.pageNumber ?? row.pageNumber) || 0;
  const layered = patch.layered !== undefined ? Boolean(patch.layered) : Boolean(row.layered);
  const error = patch.error !== undefined ? patch.error : (row.error || null);
  let status = patch.status || row.status || null;
  if (!status) {
    if (layered) status = 'SUCCESS';
    else if (error) status = 'FAILED';
    else if (row.started || patch.started) status = 'SELECTING';
    else status = 'PENDING';
  }
  return {
    pageNumber,
    jobId: patch.jobId || row.jobId || null,
    uploaded: Boolean(patch.uploaded ?? row.uploaded ?? row.imported),
    imported: Boolean(patch.imported ?? row.imported ?? row.uploaded),
    started: Boolean(patch.started ?? row.started ?? (layered || error)),
    layered,
    error,
    layerCount: patch.layerCount !== undefined ? patch.layerCount : (row.layerCount ?? null),
    status,
    attempts: Number(patch.attempts ?? row.attempts) || 0,
    lastState: patch.lastState !== undefined ? patch.lastState : (row.lastState || null),
    lastAction: patch.lastAction !== undefined ? patch.lastAction : (row.lastAction || null),
    lastVerification: patch.lastVerification !== undefined ? patch.lastVerification : (row.lastVerification || null),
    timestamp: patch.timestamp || row.timestamp || Date.now(),
    detectionMethod: patch.detectionMethod !== undefined ? patch.detectionMethod : (row.detectionMethod || null),
    confidence: patch.confidence !== undefined ? patch.confidence : (row.confidence ?? null)
  };
}

function mergeCanvaPageProgress(list, pageNumber, patch) {
  const rows = Array.isArray(list) ? list.map((item) => ({ ...item })) : [];
  const index = rows.findIndex((item) => Number(item.pageNumber) === Number(pageNumber));
  const current = index >= 0 ? rows[index] : { pageNumber };
  const keepLayered = Boolean(current.layered) && patch?.layered === false && !patch?.forceUnlayer;
  const next = enrichPageProgress(current, {
    pageNumber,
    ...patch,
    ...(keepLayered ? {
      layered: true,
      error: null,
      status: 'SUCCESS',
      layerCount: current.layerCount || patch.layerCount || 2
    } : {})
  });
  if (index >= 0) rows[index] = next;
  else rows.push(next);
  return rows.sort((left, right) => Number(left.pageNumber) - Number(right.pageNumber));
}

function resumeCursor(progress = []) {
  const rows = Array.isArray(progress) ? progress : [];
  const firstUnlayered = rows.findIndex((item) => !item?.layered);
  const layeredPageNumbers = rows.filter((item) => item?.layered).map((item) => Number(item.pageNumber));
  const resumeFromIndex = firstUnlayered === -1 ? rows.length : firstUnlayered;
  const resumeFromPage = firstUnlayered === -1
    ? (rows.length ? Number(rows[rows.length - 1].pageNumber) + 1 : 1)
    : Number(rows[firstUnlayered].pageNumber);
  return {
    resumeFromIndex,
    resumeFromPage: Number.isFinite(resumeFromPage) ? resumeFromPage : 1,
    layeredPageNumbers,
    shouldReuploadPdf: false
  };
}

function shouldReuseCanvaDesign({ designUrl = null, pdfUploaded = false } = {}) {
  return Boolean(String(designUrl || '').trim()) || Boolean(pdfUploaded);
}

function explainWait({
  expected = '',
  detected = '',
  attempt = 0,
  retries = 0,
  elapsedMs = 0,
  timeoutMs = 0,
  recoveryAttempted = false,
  state = null
} = {}) {
  const remainingMs = Math.max(0, (Number(timeoutMs) || 0) - (Number(elapsedMs) || 0));
  const detectedText = typeof detected === 'object' && detected
    ? (detected.detail || detected.label || detected.state || JSON.stringify(detected))
    : String(detected || 'not observed yet');
  const expectedText = String(expected || 'the next verified Canva state');
  const waitingLine = /^(waiting for|canva did not|paused|the print pdf|upload)/i.test(expectedText)
    ? expectedText.replace(/\.+$/, '.')
    : `Waiting for ${expectedText}.`;
  const message = [
    waitingLine,
    `Detected: ${detectedText}.`,
    `Retry ${Number(attempt) || 0}${retries ? ` of ${retries}` : ''}.`,
    remainingMs ? `${Math.ceil(remainingMs / 1000)}s until timeout.` : '',
    recoveryAttempted ? 'Recovery already attempted.' : ''
  ].filter(Boolean).join(' ');
  return {
    expected: expectedText,
    detected: detectedText,
    retries: Number(attempt) || 0,
    retryBudget: Number(retries) || 0,
    recoveryAttempted: Boolean(recoveryAttempted),
    elapsedMs: Number(elapsedMs) || 0,
    timeoutMs: Number(timeoutMs) || 0,
    remainingMs,
    state: state || null,
    message
  };
}

function isPdfUploadNetworkUrl(url) {
  const value = String(url || '');
  if (!value) return false;
  if (/graphql|telemetry|metrics|analytics|client-events|growthbook|amplitude|sentry|homepage|feed|notifications|featureflag/i.test(value)) {
    return false;
  }
  if (/upload\.canva\.com|media-upload|resumable|signed[-]?url|storage\.googleapis\.com|googleusercontent[^/]*\/upload/i.test(value)) {
    return true;
  }
  return /(?:canva\.com|googleapis\.com)/i.test(value) && /\/(upload|uploads|multipart)(?:\/|\?|$)/i.test(value);
}

function isCanvaDesignCreateNetworkUrl(url) {
  const value = String(url || '');
  if (!/canva\.com/i.test(value)) return false;
  if (/graphql|telemetry|metrics|analytics|client-events|growthbook|amplitude|sentry/i.test(value)) return false;
  return /\/_ajax\/designs|\/api\/[^/?#]+\/designs|\/designs(?:\/|\?|$)|\/design\/[A-Za-z0-9_-]{8,}|import[-_]?(?:to[-_]?design|as[-_]?design)|create[-_]?design/i.test(value);
}

function isPdfImportOpenDesignStage(value = {}, extra = {}) {
  const code = String(value?.code || extra?.code || '');
  const text = [
    typeof value === 'string' ? value : '',
    value?.message,
    value?.happened,
    value?.expected,
    value?.userShouldClick,
    value?.undetermined,
    extra?.message,
    extra?.happened
  ].filter(Boolean).join(' ');
  if (/CANVA_PDF|FILE_INPUT_NOT_FOUND|CANVA_WRONG_DESIGN/i.test(code)) return true;
  return /print PDF|upload hits 100%|did not take the print PDF|confirm the upload reached 100%|imports in progress|Still 0 of \d+ pages|Homepage traffic is not an upload|Uploaded to Uploads|PDF in Uploads|open the print PDF as a design|opening design/i.test(text);
}

function isPdfUploadPickerWaiting(state = {}) {
  if (isCanvaPdfTransferSuccess(state)) return false;
  const text = String(state.text || '');
  const waitingCopy = Boolean(state.pickerWaiting)
    || /drop your (files|content) here|drop items to upload|canva supports images|upload folder/i.test(text);
  const noProgress = (state.percent == null || Number(state.percent) === 0)
    && !state.fileSelected
    && !state.converting
    && !state.uploadFinished
    && !state.importInProgress
    && !(Number(state.uploadItems) > 0);
  return waitingCopy && noProgress;
}

function isPdfUploadTraffic(traffic = null) {
  if (!traffic) return false;
  return Boolean(traffic.uploadish && traffic.active);
}

function isPdfUploadEvidence(state = {}, traffic = null) {
  if (isPdfUploadPickerWaiting(state)) return false;
  if (isCanvaPdfTransferSuccess(state)) return true;
  if (state.fileSelected) return true;
  if (state.converting) return true;
  if (state.uploadFinished) return true;
  if (state.importInProgress) return true;
  if (Number(state.uploadItems) > 0) return true;
  if (state.percent != null && Number(state.percent) > 0) return true;
  if (state.progressVisible && state.percent != null && Number(state.percent) > 0) return true;
  return isPdfUploadTraffic(traffic);
}

function pdfImportHumanHelp(message = '') {
  const happened = String(message || 'Canva did not take the print PDF.');
  if (/open(ed)? as a design|imported pdf|imports in progress|uploaded to uploads|opening design/i.test(happened)) {
    return {
      happened,
      expected: 'The imported PDF opens as a Canva design.',
      undetermined: 'Whether Canva finished converting the PDF into a design.',
      userShouldClick: 'Click the imported PDF to open it as a design. Do not choose a file from disk.'
    };
  }
  return {
    happened,
    expected: 'The Upload dialog shows this book’s print PDF, the bar hits 100%, and Canva opens the new design.',
    undetermined: 'Whether Canva received the file. Homepage traffic is not an upload.',
    userShouldClick: 'In Chrome Canary: confirm the upload reached 100%, then press I HAVE DONE IT. Do not pick a file from Finder — VERSA already sent the print PDF.'
  };
}

function isMagicLayerControlMissing(error = {}) {
  const code = String(error?.code || '');
  const text = String(error?.message || error || '');
  return /CANVA_MAGIC_LAYERS_MISSING|CANVA_EDIT_IMAGE_PANEL_MISSING/i.test(code)
    || /Magic Layers was not in the Edit image panel|The Edit image panel did not open/i.test(text);
}

function isHumanRecoverableCanvaError(error = {}) {
  if (isPdfImportOpenDesignStage(error)) return false;
  return isMagicLayerControlMissing(error);
}

function decideWaitOutcome({
  verified = false,
  timedOut = false,
  attempts = 0,
  maxAttempts = 3,
  recoverable = false,
  uncertain = false,
  fatal = false
} = {}) {
  if (fatal) return 'FAIL';
  if (verified) return 'SUCCESS';
  if (uncertain && (timedOut || attempts >= maxAttempts)) return 'MANUAL_INTERVENTION';
  if (recoverable && (timedOut || attempts >= maxAttempts)) return 'RECOVER';
  if (!timedOut && attempts < maxAttempts) return 'RETRY';
  if (uncertain) return 'MANUAL_INTERVENTION';
  return 'FAIL';
}

function decideRecovery(kind, attempt = 1) {
  const policy = RECOVERY_POLICIES[kind] || RECOVERY_POLICIES.STUCK_PROCESSING;
  const tries = Number(attempt) || 1;
  if (tries < policy.maxAttempts) {
    return { ...policy, outcome: policy.next === 'FAIL' ? 'FAIL' : 'RETRY', exhausted: false };
  }
  if (policy.next === 'FAIL') return { ...policy, outcome: 'FAIL', exhausted: true };
  if (policy.next === 'RECOVER') return { ...policy, outcome: 'FAIL', exhausted: true };
  if (policy.next === 'MANUAL_INTERVENTION') {
    return { ...policy, outcome: 'MANUAL_INTERVENTION', exhausted: true };
  }
  return { ...policy, outcome: 'MANUAL_INTERVENTION', exhausted: true };
}

function decideImportWaitOutcome(args = {}) {
  const outcome = decideWaitOutcome({
    ...args,
    uncertain: false,
    recoverable: args.recoverable !== false
  });
  if (outcome === 'MANUAL_INTERVENTION') {
    return args.timedOut !== false && args.recoverable !== false ? 'RECOVER' : 'FAIL';
  }
  return outcome;
}

function decideImportRecovery(kind, attempt = 1) {
  const rec = decideRecovery(kind === 'USER_INTERACTION' ? 'PDF_IMPORT' : (kind || 'PDF_IMPORT'), attempt);
  if (rec.outcome === 'MANUAL_INTERVENTION') {
    return { ...rec, outcome: rec.exhausted ? 'FAIL' : 'RECOVER', next: rec.exhausted ? 'FAIL' : 'RECOVER' };
  }
  return rec;
}

function observeResumeDecision({
  humanSaidDone = false,
  detectedMatchesExpected = false,
  observeTimedOut = false,
  abort = false
} = {}) {
  if (abort) return 'FAIL';
  if (!humanSaidDone) return 'WAIT_FOR_HUMAN';
  if (detectedMatchesExpected) return 'RESUME';
  if (observeTimedOut) return 'KEEP_OBSERVING_EXPIRED';
  return 'KEEP_OBSERVING';
}

function normalizeCanvaProgressArgs(percent, message, extra = {}) {
  if (percent && typeof percent === 'object' && !Array.isArray(percent)) {
    const payload = { ...percent };
    if (message && typeof message === 'object' && !Array.isArray(message)) {
      Object.assign(payload, message);
    } else if (typeof message === 'string' && payload.message == null) {
      payload.message = message;
    }
    if (extra && typeof extra === 'object' && extra !== percent) {
      Object.assign(payload, extra);
    }
    return {
      percent: payload.percent,
      message: payload.message,
      extra: payload
    };
  }
  return {
    percent,
    message,
    extra: extra && typeof extra === 'object' ? extra : {}
  };
}

function decideHumanLoopExit({
  abort = false,
  retryDecision = false,
  retryStep = false,
  retryPage = false,
  humanPaused = true,
  observeRequested = false,
  observedOk = false
} = {}) {
  if (abort) return 'ABORT';
  if (retryDecision || retryStep || retryPage) return 'RETRY';
  if (observeRequested && observedOk) return 'RESUME';
  if (observeRequested && !observedOk) return 'KEEP_OBSERVING';
  if (!humanPaused && !observeRequested) return 'RETRY';
  return 'WAIT_FOR_HUMAN';
}

function buildFailureSnapshot({
  screenshotPath = null,
  url = '',
  pageNumber = null,
  domSnippet = null,
  a11y = null,
  controllerState = null,
  lastAction = null,
  expected = null,
  detected = null,
  retryCount = 0,
  timestamp = Date.now(),
  consoleErrors = [],
  error = null
} = {}) {
  return {
    screenshotPath,
    url: String(url || ''),
    pageNumber: pageNumber == null ? null : Number(pageNumber),
    domSnippet: domSnippet ? String(domSnippet).slice(0, 4_000) : null,
    a11y: a11y || null,
    controllerState: controllerState || null,
    lastAction,
    expected,
    detected,
    retryCount: Number(retryCount) || 0,
    timestamp,
    consoleErrors: Array.isArray(consoleErrors) ? consoleErrors.slice(-20) : [],
    error: error ? { message: error.message || String(error), code: error.code || null } : null
  };
}

function healthIssue(code, message, fix) {
  return { code, message, fix };
}

function summarizeHealth(checks = {}) {
  const issues = [];
  if (!checks.canaryAvailable) {
    issues.push(healthIssue('CANVA_CANARY_MISSING', 'Google Chrome Canary is not available.', 'Install Google Chrome Canary, then try again.'));
  }
  if (!checks.profileOk) {
    issues.push(healthIssue('CANVA_PROFILE_MISSING', 'The ChromeAutomationProfile is missing or unreadable.', 'Use the VERSA ChromeAutomationProfile at ~/ChromeAutomationProfile.'));
  }
  if (!checks.cdpHealthy) {
    issues.push(healthIssue('CANVA_CDP_UNHEALTHY', 'CDP is not attached to Canary.', 'Show the browser, then Verify Canva in Settings.'));
  }
  if (!checks.sessionOk) {
    issues.push(healthIssue('CANVA_AUTH_REQUIRED', 'Canva Pro is not signed in.', 'Sign in on canva.com in Google Chrome Canary, then Verify Canva in Settings.'));
  }
  if (checks.loginScreen) {
    issues.push(healthIssue('CANVA_LOGIN_SCREEN', 'Canva is showing a login screen.', 'Sign in to Canva Pro in the Canary window, then try again.'));
  }
  if (!checks.canvaAccessible) {
    issues.push(healthIssue('CANVA_UNREACHABLE', 'Canva did not load.', 'Check the network, then open canva.com in Canary.'));
  }
  if (checks.designUrl && !checks.editorCanLoad) {
    issues.push(healthIssue('CANVA_EDITOR_TIMEOUT', 'The saved Canva design did not open.', 'Open the design in Canary or remove the template and import the print PDF again.'));
  }
  if (checks.viewportOk === false) {
    issues.push(healthIssue('CANVA_VIEWPORT', 'The Canva viewport is too small to control.', 'Make the Canary window visible and large enough to show Share and the page rail.'));
  }
  if (checks.blockingModal) {
    issues.push(healthIssue('CANVA_BLOCKING_MODAL', 'A blocking Canva dialog is open.', 'Close the dialog in Canary if it is safe, then retry.'));
  }
  return {
    ok: issues.length === 0,
    issues,
    checks,
    message: issues.length
      ? issues.map((item) => `${item.message} ${item.fix}`).join(' ')
      : 'Canva environment is ready.'
  };
}

class CanvaJobState {
  constructor({
    projectId = null,
    expectedPages = 0,
    designUrl = null,
    pdfUploaded = false,
    tempPdf = null,
    dryRun = false,
    onRecord = null
  } = {}) {
    this.projectId = projectId;
    this.expectedPages = Number(expectedPages) || 0;
    this.designUrl = designUrl || null;
    this.pdfUploaded = Boolean(pdfUploaded);
    this.tempPdf = tempPdf && typeof tempPdf === 'object' ? tempPdf : null;
    this.dryRun = Boolean(dryRun);
    this.onRecord = typeof onRecord === 'function' ? onRecord : null;
    this.state = 'BOOT';
    this.lastState = null;
    this.lastAction = null;
    this.lastVerification = null;
    this.lastExpected = null;
    this.lastDetected = null;
    this.confidence = 0;
    this.detectionMethod = null;
    this.retryCount = 0;
    this.pageNumber = null;
    this.waitExplanation = explainWait({ expected: 'browser boot', detected: 'starting' });
    this.intervention = null;
    this.stream = [];
    this.pages = [];
    this.interrupted = false;
    this.updatedAt = Date.now();
    this.startedAt = Date.now();
  }

  snapshot() {
    return {
      projectId: this.projectId,
      state: this.state,
      lastState: this.lastState,
      lastAction: this.lastAction,
      lastVerification: this.lastVerification,
      lastExpected: this.lastExpected,
      lastDetected: this.lastDetected,
      confidence: this.confidence,
      detectionMethod: this.detectionMethod,
      retryCount: this.retryCount,
      pageNumber: this.pageNumber,
      expectedPages: this.expectedPages,
      designUrl: this.designUrl,
      pdfUploaded: this.pdfUploaded,
      tempPdf: this.tempPdf,
      dryRun: this.dryRun,
      interrupted: this.interrupted,
      waitExplanation: this.waitExplanation,
      intervention: this.intervention,
      stream: this.stream.slice(-40),
      pages: this.pages,
      updatedAt: this.updatedAt,
      startedAt: this.startedAt
    };
  }

  restore(saved = {}) {
    if (!saved || typeof saved !== 'object') return this;
    if (isCanvaState(saved.state)) this.state = saved.state;
    this.lastState = saved.lastState || this.lastState;
    this.lastAction = saved.lastAction || this.lastAction;
    this.designUrl = saved.designUrl || this.designUrl;
    this.pdfUploaded = Boolean(saved.pdfUploaded || this.pdfUploaded);
    if (saved.tempPdf && typeof saved.tempPdf === 'object') this.tempPdf = saved.tempPdf;
    this.pageNumber = saved.pageNumber ?? this.pageNumber;
    this.retryCount = Number(saved.retryCount) || 0;
    this.interrupted = Boolean(saved.interrupted);
    if (Array.isArray(saved.pages)) this.pages = saved.pages.map((row) => enrichPageProgress(row));
    return this;
  }

  enter(state, extra = {}) {
    const next = isCanvaState(state) ? state : this.state;
    this.lastState = this.state;
    this.state = next;
    this.lastAction = extra.action || this.lastAction;
    this.lastExpected = extra.expected || this.lastExpected;
    this.pageNumber = extra.pageNumber !== undefined ? extra.pageNumber : this.pageNumber;
    this.detectionMethod = extra.detectionMethod || this.detectionMethod;
    this.confidence = extra.confidence !== undefined ? extra.confidence : this.confidence;
    this.retryCount = extra.attempt !== undefined ? Number(extra.attempt) || 0 : this.retryCount;
    this.updatedAt = Date.now();
    const record = this.record({
      type: 'enter',
      state: next,
      action: this.lastAction,
      expected: this.lastExpected,
      ...extra
    });
    return record;
  }

  record(entry = {}) {
    const row = {
      at: Date.now(),
      projectId: this.projectId,
      state: entry.state || this.state,
      pageNumber: entry.pageNumber !== undefined ? entry.pageNumber : this.pageNumber,
      action: entry.action || this.lastAction,
      expected: entry.expected !== undefined ? entry.expected : this.lastExpected,
      detected: entry.detected !== undefined ? entry.detected : this.lastDetected,
      verification: entry.verification !== undefined ? entry.verification : this.lastVerification,
      outcome: entry.outcome || null,
      retryCount: entry.attempt !== undefined ? Number(entry.attempt) || 0 : this.retryCount,
      confidence: entry.confidence !== undefined ? entry.confidence : this.confidence,
      detectionMethod: entry.detectionMethod || this.detectionMethod,
      details: entry.details || null,
      type: entry.type || 'event'
    };
    if (entry.detected !== undefined) this.lastDetected = entry.detected;
    if (entry.verification !== undefined) this.lastVerification = entry.verification;
    if (entry.expected !== undefined) this.lastExpected = entry.expected;
    this.stream.push(row);
    if (this.stream.length > 80) this.stream.splice(0, this.stream.length - 80);
    this.updatedAt = Date.now();
    if (this.onRecord) {
      try { this.onRecord(row); } catch {}
    }
    return row;
  }

  markPdfUploaded(designUrl = null) {
    this.pdfUploaded = true;
    if (designUrl) this.designUrl = designUrl;
    this.enter('PDF_UPLOAD_COMPLETE', { action: 'pdf-once', expected: 'design URL persisted before Magic Layer' });
  }

  markImageReady(designUrl = null, extra = {}) {
    if (designUrl) this.designUrl = designUrl;
    this.enter('IMAGE_READY', {
      action: extra.action || 'image-ready',
      expected: extra.expected || 'page image on canvas with Edit toolbar',
      pageNumber: extra.pageNumber
    });
  }

  setWait(explanation) {
    this.waitExplanation = explanation && typeof explanation === 'object'
      ? explanation
      : explainWait({ expected: String(explanation || '') });
    this.updatedAt = Date.now();
    return this.waitExplanation;
  }

  requireIntervention(payload = {}) {
    this.enter('MANUAL_INTERVENTION_REQUIRED', {
      action: 'human-in-the-loop',
      expected: payload.expected,
      pageNumber: payload.pageNumber
    });
    this.intervention = {
      happened: payload.happened || 'The controller could not verify the next Canva state.',
      expected: payload.expected || 'A verified Canva control matching the current step.',
      undetermined: payload.undetermined || 'Whether the last click reached the intended object.',
      userShouldClick: payload.userShouldClick || 'Do the highlighted action in Canva, then choose I HAVE DONE IT.',
      expectedState: payload.expectedState || this.lastExpected,
      pageNumber: payload.pageNumber || this.pageNumber,
      at: Date.now()
    };
    this.confidence = 0;
    return this.intervention;
  }

  clearIntervention() {
    this.intervention = null;
    if (this.state === 'MANUAL_INTERVENTION_REQUIRED' && this.lastState) {
      this.state = this.lastState;
    }
  }

  patchPage(pageNumber, patch = {}) {
    this.pages = mergeCanvaPageProgress(this.pages, pageNumber, {
      ...patch,
      lastState: patch.lastState || this.state
    });
    return this.pages.find((item) => Number(item.pageNumber) === Number(pageNumber));
  }

  controllerView() {
    const wait = this.waitExplanation || {};
    return {
      state: this.state,
      action: this.lastAction,
      expected: this.lastExpected,
      detected: this.lastDetected,
      verification: this.lastVerification,
      detectionMethod: this.detectionMethod,
      confidence: this.confidence,
      retryCount: this.retryCount,
      pageNumber: this.pageNumber,
      lastSuccess: this.lastVerification === true || this.lastVerification === 'ok' ? this.lastAction : null,
      lastVerification: this.lastVerification,
      nextAction: this.intervention ? 'Wait for the operator' : this.lastExpected,
      recoveryDecision: this.intervention
        ? 'manual'
        : (this.state === 'RECOVERING'
          ? 'automated recovery'
          : (this.state === 'PROJECT_OPENING' ? 'navigate' : 'continue')),
      waitExplanation: wait,
      lockMessage: 'Canva browser currently controlled by VERSA.',
      pdfUploaded: this.pdfUploaded,
      designUrl: this.designUrl,
      dryRun: this.dryRun
    };
  }
}

module.exports = {
  CANVA_STATES,
  PAGE_STATUSES,
  WAIT_OUTCOMES,
  RECOVERY_POLICIES,
  STATE_TIMEOUTS_MS,
  CanvaJobState,
  isCanvaState,
  isPageStatus,
  enrichPageProgress,
  mergeCanvaPageProgress,
  resumeCursor,
  shouldReuseCanvaDesign,
  explainWait,
  isPdfUploadNetworkUrl,
  isCanvaDesignCreateNetworkUrl,
  isPdfImportOpenDesignStage,
  isPdfUploadPickerWaiting,
  isPdfUploadTraffic,
  isPdfUploadEvidence,
  isCanvaPdfTransferSuccess,
  pdfImportHumanHelp,
  isMagicLayerControlMissing,
  isHumanRecoverableCanvaError,
  decideWaitOutcome,
  decideRecovery,
  decideImportWaitOutcome,
  decideImportRecovery,
  observeResumeDecision,
  normalizeCanvaProgressArgs,
  decideHumanLoopExit,
  buildFailureSnapshot,
  summarizeHealth
};
