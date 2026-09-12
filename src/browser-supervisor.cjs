'use strict';

/**
 * Persistent Browser Supervisor.
 *
 * One state machine for the existing browser controller. It classifies Gemini
 * and Chrome before acting, checkpoints the job, and recovers instead of
 * failing after two retries. It does not launch a second browser, and it
 * does not rewrite production code from its history.
 */

const STATE = Object.freeze({
  STARTING: 'STARTING',
  READY: 'READY',
  SUBMITTING: 'SUBMITTING',
  GENERATING_WITH_PROGRESS: 'GENERATING_WITH_PROGRESS',
  GENERATING_NO_PROGRESS: 'GENERATING_NO_PROGRESS',
  OUTPUT_READY: 'OUTPUT_READY',
  GEMINI_ERROR: 'GEMINI_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  QUOTA_EXHAUSTED: 'QUOTA_EXHAUSTED',
  NETWORK_OFFLINE: 'NETWORK_OFFLINE',
  TAB_CRASHED_OR_CLOSED: 'TAB_CRASHED_OR_CLOSED',
  BROWSER_DISCONNECTED: 'BROWSER_DISCONNECTED',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  CAPTCHA_OR_USER_ACTION: 'CAPTCHA_OR_USER_ACTION',
  UNKNOWN_STALL: 'UNKNOWN_STALL'
});

const ACTION = Object.freeze({
  WAIT: 'WAIT',
  ACCEPT: 'ACCEPT',
  REPLACE_TAB: 'REPLACE_TAB',
  RECONNECT_BROWSER: 'RECONNECT_BROWSER',
  RELOAD_TAB: 'RELOAD_TAB',
  COOLDOWN: 'COOLDOWN',
  PAUSE_USER: 'PAUSE_USER',
  RETRY_PAGE: 'RETRY_PAGE',
  SNAPSHOT: 'SNAPSHOT'
});

const RECOVERY_ACTIONS = new Set([
  ACTION.REPLACE_TAB,
  ACTION.RECONNECT_BROWSER,
  ACTION.RELOAD_TAB,
  ACTION.RETRY_PAGE
]);

const TERMINAL_USER = new Set([
  STATE.AUTH_REQUIRED,
  STATE.CAPTCHA_OR_USER_ACTION,
  STATE.QUOTA_EXHAUSTED
]);

const GENERATION_TIMEOUT_MS = 90_000;
const BLANK_TAB_WAIT_MS = 25_000;
const UNKNOWN_STALL_WAIT_MS = 45_000;
const SHORT_COOLDOWN_MS = 45_000;
const LONG_COOLDOWN_MS = 180_000;
const IMMEDIATE_RECOVERY_BUDGET = 2;
const HISTORY_LIMIT = 40;

/** Analysis script the supervisor must finish, in order, on one Gemini tab. */
const ANALYSIS_SCRIPT = Object.freeze({
  A: 'A-scan',
  B: 'B-pick',
  C: 'C-scrape',
  E: 'E-studio',
  F: 'F-submitted',
  G: 'G-ready'
});

function supervisorKey(job = {}) {
  const projectId = job.projectId || 'none';
  const pageId = job.pageId || job.stage || 'analysis';
  return `browserSupervisor:${projectId}:${pageId}`;
}

function parseRateLimitMs(text = '') {
  const match = String(text || '').match(/(\d+(?:\.\d+)?)\s*(second|minute|hour|sec|min|hr)s?/i);
  if (!match) return SHORT_COOLDOWN_MS;
  const amount = Number(match[1]) || 0;
  const unit = String(match[2] || '').toLowerCase();
  if (unit.startsWith('hour') || unit === 'hr') return Math.max(SHORT_COOLDOWN_MS, amount * 3_600_000);
  if (unit.startsWith('min')) return Math.max(SHORT_COOLDOWN_MS, amount * 60_000);
  return Math.max(SHORT_COOLDOWN_MS, amount * 1_000);
}

function buildSupervisorSample(input = {}) {
  const error = input.error && typeof input.error === 'object' ? input.error : {};
  const code = String(input.code || error.code || '');
  const watched = input.watched && typeof input.watched === 'object' ? input.watched : {};
  const reason = String(watched.decision?.reason || watched.observation?.reason || input.reason || code || '');
  const phase = String(watched.observation?.phase || input.phase || '');
  const submitted = Boolean(input.submitted)
    || Number(input.submittedAt) > 0
    || Number(input.checkpoint?.submittedAt) > 0;
  const leftoverChrome = reason === 'dead-gemini-image-mode';
  return {
    now: Number(input.now) || Date.now(),
    connected: input.connected !== false && code !== 'BROWSER_CONTEXT_CLOSED' && code !== 'BROWSER_DISCONNECTED',
    tabOpen: input.tabOpen !== false && !input.tabClosed && code !== 'BROWSER_CONTEXT_CLOSED',
    tabResponsive: input.tabResponsive !== false && !input.tabUnresponsive,
    tabClosed: Boolean(input.tabClosed) || reason === 'TAB_CRASHED_OR_CLOSED' || reason === 'tab-closed',
    tabCrashed: Boolean(input.tabCrashed) || reason === 'tab-crashed',
    tabUnresponsive: Boolean(input.tabUnresponsive),
    browserDisconnected: Boolean(input.browserDisconnected)
      || code === 'BROWSER_CONTEXT_CLOSED'
      || code === 'BROWSER_DISCONNECTED',
    generating: Boolean(input.generating) || phase === 'drafting' || phase === 'waiting' || submitted,
    draftGrew: Boolean(input.draftGrew),
    outputAppeared: Boolean(input.outputAppeared),
    domMutated: Boolean(input.domMutated),
    analysisReady: Boolean(input.analysisReady),
    outputReady: Boolean(input.outputReady || input.analysisReady),
    submitted,
    chromeNoise: Boolean(input.chromeNoise) || (leftoverChrome && !submitted),
    imageMode: Boolean(input.imageMode) || (leftoverChrome && !submitted),
    geminiError: Boolean(input.geminiError) || code === 'GPT_RESPONSE_TIMEOUT' || reason === 'GEMINI_ERROR',
    rateLimited: Boolean(input.rateLimited) || ['RATE_LIMIT', 'REQUEST_THROTTLED'].includes(code) || ['RATE_LIMIT', 'REQUEST_THROTTLED'].includes(reason),
    quotaExhausted: Boolean(input.quotaExhausted) || code === 'QUOTA_EXHAUSTED',
    networkOffline: Boolean(input.networkOffline) || code === 'NETWORK_OFFLINE',
    authRequired: Boolean(input.authRequired) || code === 'AUTH_REQUIRED',
    captcha: Boolean(input.captcha) || code === 'CAPTCHA' || code === 'CAPTCHA_OR_USER_ACTION',
    userActionRequired: Boolean(input.userActionRequired),
    submitting: Boolean(input.submitting),
    starting: Boolean(input.starting),
    composerReady: Boolean(input.composerReady),
    selectorMissing: Boolean(input.selectorMissing) || code === 'COMPOSER_NOT_FOUND',
    rateLimitMs: Number(input.rateLimitMs) || parseRateLimitMs(input.rateLimitText || error.message || ''),
    lastProgressAt: Number(input.lastProgressAt) || 0,
    sinceProgress: Number(input.sinceProgress) || 0
  };
}

function classifySupervisorState(sample = {}) {
  const now = Number(sample.now) || Date.now();
  const lastProgressAt = Number(sample.lastProgressAt) || 0;
  const sinceProgress = lastProgressAt ? Math.max(0, now - lastProgressAt) : Number(sample.sinceProgress) || 0;
  const evidence = [];

  if (sample.outputReady || sample.analysisReady) {
    evidence.push('output-ready');
    return { state: STATE.OUTPUT_READY, evidence, sinceProgress };
  }
  if (sample.authRequired) {
    evidence.push('auth-required');
    return { state: STATE.AUTH_REQUIRED, evidence, sinceProgress };
  }
  if (sample.captcha || sample.userActionRequired) {
    evidence.push('captcha-or-consent');
    return { state: STATE.CAPTCHA_OR_USER_ACTION, evidence, sinceProgress };
  }
  if (sample.quotaExhausted) {
    evidence.push('quota-exhausted');
    return { state: STATE.QUOTA_EXHAUSTED, evidence, sinceProgress };
  }
  if (sample.networkOffline) {
    evidence.push('network-offline');
    return { state: STATE.NETWORK_OFFLINE, evidence, sinceProgress };
  }
  if (sample.rateLimited) {
    evidence.push('rate-limited');
    return { state: STATE.RATE_LIMITED, evidence, sinceProgress };
  }
  if (sample.browserDisconnected || sample.connected === false) {
    evidence.push('browser-disconnected');
    return { state: STATE.BROWSER_DISCONNECTED, evidence, sinceProgress };
  }
  if (sample.tabClosed || sample.tabCrashed || sample.tabOpen === false) {
    evidence.push('tab-closed');
    return { state: STATE.TAB_CRASHED_OR_CLOSED, evidence, sinceProgress };
  }
  if (sample.chromeNoise || sample.imageMode) {
    if (sample.submitted) {
      evidence.push('leftover-chrome-after-submit');
      return { state: STATE.GENERATING_NO_PROGRESS, evidence, sinceProgress };
    }
    evidence.push(sample.imageMode ? 'image-mode-chrome' : 'gem-chrome');
    return { state: STATE.TAB_CRASHED_OR_CLOSED, evidence, sinceProgress };
  }
  if (sample.geminiError || sample.selectorMissing) {
    evidence.push(sample.selectorMissing ? 'selector-missing' : 'gemini-error');
    return { state: STATE.GEMINI_ERROR, evidence, sinceProgress };
  }
  if (sample.submitting) {
    evidence.push('submitting');
    return { state: STATE.SUBMITTING, evidence, sinceProgress };
  }
  if (sample.generating && (sample.draftGrew || sample.outputAppeared || sample.domMutated)) {
    evidence.push('generating-with-progress');
    return { state: STATE.GENERATING_WITH_PROGRESS, evidence, sinceProgress };
  }
  if (sample.generating) {
    evidence.push('generating-no-progress');
    return { state: STATE.GENERATING_NO_PROGRESS, evidence, sinceProgress };
  }
  if (sample.composerReady && !sample.generating) {
    evidence.push('composer-ready');
    return { state: STATE.READY, evidence, sinceProgress };
  }
  if (sample.starting) {
    evidence.push('starting');
    return { state: STATE.STARTING, evidence, sinceProgress };
  }
  if (sample.tabUnresponsive || sinceProgress >= UNKNOWN_STALL_WAIT_MS) {
    evidence.push(sample.tabUnresponsive ? 'tab-unresponsive' : 'unknown-stall');
    return { state: STATE.UNKNOWN_STALL, evidence, sinceProgress };
  }
  evidence.push('starting-default');
  return { state: STATE.STARTING, evidence, sinceProgress };
}

function preferredAction(state, history = []) {
  const wins = (Array.isArray(history) ? history : [])
    .filter((item) => item.state === state && item.succeeded && item.action)
    .slice(-8);
  if (!wins.length) return null;
  const counts = new Map();
  for (const item of wins) counts.set(item.action, (counts.get(item.action) || 0) + 1);
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0][0];
}

function circuitFor(recoveryCount = 0) {
  const count = Math.max(0, Number(recoveryCount) || 0);
  if (count < IMMEDIATE_RECOVERY_BUDGET) {
    return { cooldownMs: 0, breaker: 'immediate' };
  }
  if (count < IMMEDIATE_RECOVERY_BUDGET + 2) {
    return { cooldownMs: SHORT_COOLDOWN_MS, breaker: 'short' };
  }
  return { cooldownMs: LONG_COOLDOWN_MS, breaker: 'long' };
}

function decideSupervisorAction(classified = {}, checkpoint = {}, history = []) {
  const state = classified.state || STATE.UNKNOWN_STALL;
  const sinceProgress = Math.max(0, Number(classified.sinceProgress) || 0);
  const now = Number(checkpoint.now) || Date.now();
  const nextRetryAt = Number(checkpoint.nextRetryAt) || 0;
  if (nextRetryAt && now < nextRetryAt) {
    return {
      action: ACTION.COOLDOWN,
      state,
      reason: 'circuit-breaker',
      nextRetryAt,
      replacing: Boolean(checkpoint.replacing)
    };
  }

  if (state === STATE.OUTPUT_READY) {
    return { action: ACTION.ACCEPT, state, reason: 'output-ready', nextRetryAt: 0, scriptStep: ANALYSIS_SCRIPT.G };
  }
  if (TERMINAL_USER.has(state)) {
    return { action: ACTION.PAUSE_USER, state, reason: state, nextRetryAt: 0 };
  }
  const submitted = Number(checkpoint.submittedAt) > 0;
  if (
    submitted
    && state !== STATE.BROWSER_DISCONNECTED
    && state !== STATE.TAB_CRASHED_OR_CLOSED
    && state !== STATE.RATE_LIMITED
    && state !== STATE.NETWORK_OFFLINE
  ) {
    if (state === STATE.GENERATING_NO_PROGRESS && sinceProgress >= GENERATION_TIMEOUT_MS) {
      return { action: ACTION.RETRY_PAGE, state, reason: 'script-resubmit-same-tab', nextRetryAt: 0 };
    }
    return { action: ACTION.WAIT, state, reason: 'script-wait-for-result', nextRetryAt: 0, scriptStep: ANALYSIS_SCRIPT.F };
  }
  if (state === STATE.GENERATING_WITH_PROGRESS || state === STATE.SUBMITTING || state === STATE.READY || state === STATE.STARTING) {
    return { action: ACTION.WAIT, state, reason: state, nextRetryAt: 0 };
  }
  if (state === STATE.GENERATING_NO_PROGRESS && sinceProgress < GENERATION_TIMEOUT_MS) {
    return { action: ACTION.WAIT, state, reason: 'slow-generation', nextRetryAt: 0 };
  }
  if (state === STATE.NETWORK_OFFLINE || state === STATE.RATE_LIMITED) {
    const cooldownMs = state === STATE.RATE_LIMITED
      ? Math.max(SHORT_COOLDOWN_MS, Number(checkpoint.rateLimitMs) || SHORT_COOLDOWN_MS)
      : SHORT_COOLDOWN_MS;
    return { action: ACTION.COOLDOWN, state, reason: state, nextRetryAt: now + cooldownMs };
  }

  if (checkpoint.replacing) {
    return { action: ACTION.WAIT, state, reason: 'one-replacement-in-flight', nextRetryAt: 0, replacing: true };
  }

  const learned = preferredAction(state, history);
  const circuit = circuitFor(checkpoint.recoveryCount);
  const nextRetry = circuit.cooldownMs ? now + circuit.cooldownMs : 0;

  if (state === STATE.BROWSER_DISCONNECTED) {
    return { action: ACTION.RECONNECT_BROWSER, state, reason: 'browser-disconnected', nextRetryAt: nextRetry, replacing: true };
  }
  if (state === STATE.TAB_CRASHED_OR_CLOSED) {
    return { action: learned || ACTION.REPLACE_TAB, state, reason: 'dead-tab', nextRetryAt: nextRetry, replacing: true };
  }
  if (state === STATE.GEMINI_ERROR || state === STATE.GENERATING_NO_PROGRESS) {
    return { action: learned || ACTION.RETRY_PAGE, state, reason: state, nextRetryAt: nextRetry, replacing: true };
  }
  if (state === STATE.UNKNOWN_STALL) {
    if (!checkpoint.snapshotted) {
      return { action: ACTION.SNAPSHOT, state, reason: 'unknown-stall-snapshot', nextRetryAt: now + UNKNOWN_STALL_WAIT_MS };
    }
    if (!checkpoint.reloaded) {
      return { action: ACTION.RELOAD_TAB, state, reason: 'unknown-stall-reload', nextRetryAt: nextRetry, replacing: true };
    }
    return { action: ACTION.REPLACE_TAB, state, reason: 'unknown-stall-reopen', nextRetryAt: nextRetry, replacing: true };
  }
  if (sinceProgress >= BLANK_TAB_WAIT_MS && checkpoint.tabResponsive === false) {
    return { action: ACTION.REPLACE_TAB, state, reason: 'blank-tab', nextRetryAt: nextRetry, replacing: true };
  }
  return { action: ACTION.WAIT, state, reason: 'hold', nextRetryAt: 0 };
}

function applyDecision(checkpoint = {}, classified = {}, decision = {}, { now = Date.now() } = {}) {
  const recovering = RECOVERY_ACTIONS.has(decision.action);
  const recoveryCount = recovering
    ? (Number(checkpoint.recoveryCount) || 0) + 1
    : Number(checkpoint.recoveryCount) || 0;
  const pageId = checkpoint.pageId || 'analysis';
  return {
    projectId: checkpoint.projectId || null,
    pageId,
    attemptId: decision.action === ACTION.RETRY_PAGE
      ? `${pageId}-${recoveryCount + 1}`
      : (checkpoint.attemptId || `${pageId}-1`),
    submittedAt: recovering ? 0 : (Number(checkpoint.submittedAt) || 0),
    lastProgressAt: recovering ? now : (Number(checkpoint.lastProgressAt) || now),
    currentState: decision.state,
    recoveryCount,
    nextRetryAt: Number(decision.nextRetryAt) || 0,
    outputStatus: decision.action === ACTION.ACCEPT
      ? 'ready'
      : (recovering ? 'pending' : (checkpoint.outputStatus || 'pending')),
    replacing: Boolean(decision.replacing),
    snapshotted: checkpoint.snapshotted || decision.action === ACTION.SNAPSHOT,
    reloaded: checkpoint.reloaded || decision.action === ACTION.RELOAD_TAB,
    tabResponsive: checkpoint.tabResponsive,
    rateLimitMs: Number(checkpoint.rateLimitMs) || 0,
    lastAction: decision.action,
    lastReason: decision.reason,
    scriptStep: decision.action === ACTION.ACCEPT
      ? ANALYSIS_SCRIPT.G
      : (recovering ? ANALYSIS_SCRIPT.E : (checkpoint.scriptStep || ANALYSIS_SCRIPT.E)),
    updatedAt: now
  };
}

function recordHistory(history = [], entry = {}) {
  const next = [...(Array.isArray(history) ? history : []), {
    at: Number(entry.at) || Date.now(),
    state: entry.state,
    action: entry.action,
    evidence: entry.evidence || [],
    succeeded: Boolean(entry.succeeded),
    ms: Math.max(0, Number(entry.ms) || 0)
  }];
  return next.slice(-HISTORY_LIMIT);
}

function publicSnapshot(checkpoint = {}, classified = {}, decision = {}) {
  return {
    state: classified.state || checkpoint.currentState || STATE.STARTING,
    action: decision.action || checkpoint.lastAction || ACTION.WAIT,
    reason: decision.reason || checkpoint.lastReason || '',
    pageId: checkpoint.pageId || 'analysis',
    attemptId: checkpoint.attemptId || '',
    recoveryCount: Number(checkpoint.recoveryCount) || 0,
    lastProgressAt: Number(checkpoint.lastProgressAt) || 0,
    nextRetryAt: Number(checkpoint.nextRetryAt) || 0,
    outputStatus: checkpoint.outputStatus || 'pending',
    scriptStep: checkpoint.scriptStep || ANALYSIS_SCRIPT.E,
    userActionRequired: TERMINAL_USER.has(classified.state || checkpoint.currentState)
  };
}

function emptyCheckpoint(job = {}) {
  const pageId = job.pageId || job.stage || 'analysis';
  return {
    projectId: job.projectId || null,
    pageId,
    attemptId: `${pageId}-1`,
    submittedAt: 0,
    lastProgressAt: 0,
    currentState: STATE.STARTING,
    recoveryCount: 0,
    nextRetryAt: 0,
    outputStatus: 'pending',
    replacing: false,
    snapshotted: false,
    reloaded: false,
    scriptStep: ANALYSIS_SCRIPT.E
  };
}

class BrowserSupervisor {
  constructor({ store = null, now = () => Date.now() } = {}) {
    this.store = store;
    this.now = now;
    this.checkpoint = emptyCheckpoint();
    this.history = [];
    this.classified = { state: STATE.STARTING, evidence: [], sinceProgress: 0 };
    this.decision = { action: ACTION.WAIT, state: STATE.STARTING, reason: 'starting' };
  }

  attachStore(store) {
    this.store = store || null;
    return this;
  }

  load(job = {}) {
    const key = supervisorKey(job);
    if (this.store?.getSetting) {
      const saved = this.store.getSetting(key, null);
      if (saved && typeof saved === 'object') this.checkpoint = { ...emptyCheckpoint(job), ...saved };
      const history = this.store.getSetting('browserSupervisorHistory', []);
      if (Array.isArray(history)) this.history = history;
    } else {
      this.checkpoint = { ...emptyCheckpoint(job), ...this.checkpoint, ...job };
    }
    this.checkpoint.projectId = job.projectId || this.checkpoint.projectId;
    this.checkpoint.pageId = job.pageId || job.stage || this.checkpoint.pageId;
    return this.checkpoint;
  }

  beginJob(job = {}) {
    if (this.store?.getSetting) {
      const history = this.store.getSetting('browserSupervisorHistory', []);
      if (Array.isArray(history)) this.history = history;
    }
    this.checkpoint = emptyCheckpoint(job);
    this.classified = { state: STATE.STARTING, evidence: ['new-job'], sinceProgress: 0 };
    this.decision = { action: ACTION.WAIT, state: STATE.STARTING, reason: 'new-job' };
    this.save();
    return this.checkpoint;
  }

  save(job = {}) {
    const key = supervisorKey({ ...this.checkpoint, ...job });
    if (this.store?.setSetting) {
      this.store.setSetting(key, this.checkpoint);
      this.store.setSetting('browserSupervisorHistory', this.history);
    }
    return this.checkpoint;
  }

  observe(sample = {}) {
    const now = this.now();
    const normalized = sample.now || sample.generating !== undefined || sample.error || sample.watched
      ? { ...buildSupervisorSample({ ...sample, submitted: Boolean(this.checkpoint.submittedAt) }), ...sample, submitted: Boolean(this.checkpoint.submittedAt), now }
      : { ...sample, submitted: Boolean(this.checkpoint.submittedAt), now };
    if (sample.rateLimitMs || normalized.rateLimitMs) {
      this.checkpoint.rateLimitMs = Number(sample.rateLimitMs || normalized.rateLimitMs) || 0;
    }
    if (sample.tabResponsive === false) this.checkpoint.tabResponsive = false;
    this.classified = classifySupervisorState(normalized);
    if (normalized.draftGrew || normalized.outputAppeared || normalized.analysisReady || normalized.outputReady) {
      this.checkpoint.lastProgressAt = now;
      this.classified.sinceProgress = 0;
    }
    this.checkpoint.currentState = this.classified.state;
    this.decision = decideSupervisorAction(this.classified, { ...this.checkpoint, now }, this.history);
    return { ...this.decision, classified: this.classified, checkpoint: this.checkpoint };
  }

  commit(decision = this.decision) {
    const now = this.now();
    this.decision = decision;
    this.checkpoint = applyDecision(this.checkpoint, this.classified, decision, { now });
    this.save();
    return this.checkpoint;
  }

  record(succeeded, ms = 0) {
    this.history = recordHistory(this.history, {
      at: this.now(),
      state: this.classified.state,
      action: this.decision.action,
      evidence: this.classified.evidence,
      succeeded,
      ms
    });
    if (succeeded) this.checkpoint.replacing = false;
    this.save();
    return this.history;
  }

  canSubmit() {
    if (this.checkpoint.outputStatus === 'ready') return false;
    return !this.checkpoint.submittedAt;
  }

  markSubmitted(attemptId) {
    this.checkpoint.submittedAt = this.now();
    this.checkpoint.attemptId = attemptId || this.checkpoint.attemptId;
    this.checkpoint.currentState = STATE.SUBMITTING;
    this.checkpoint.scriptStep = ANALYSIS_SCRIPT.F;
    this.save();
    return this.checkpoint.attemptId;
  }

  snapshot() {
    return publicSnapshot(this.checkpoint, this.classified, this.decision);
  }
}

module.exports = {
  STATE,
  ACTION,
  ANALYSIS_SCRIPT,
  TERMINAL_USER,
  RECOVERY_ACTIONS,
  GENERATION_TIMEOUT_MS,
  BLANK_TAB_WAIT_MS,
  UNKNOWN_STALL_WAIT_MS,
  SHORT_COOLDOWN_MS,
  LONG_COOLDOWN_MS,
  IMMEDIATE_RECOVERY_BUDGET,
  supervisorKey,
  parseRateLimitMs,
  buildSupervisorSample,
  classifySupervisorState,
  decideSupervisorAction,
  applyDecision,
  recordHistory,
  preferredAction,
  circuitFor,
  publicSnapshot,
  emptyCheckpoint,
  BrowserSupervisor
};
