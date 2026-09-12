'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  STATE,
  ACTION,
  ANALYSIS_SCRIPT,
  GENERATION_TIMEOUT_MS,
  SHORT_COOLDOWN_MS,
  LONG_COOLDOWN_MS,
  classifySupervisorState,
  decideSupervisorAction,
  applyDecision,
  preferredAction,
  circuitFor,
  parseRateLimitMs,
  buildSupervisorSample,
  BrowserSupervisor
} = require('../src/browser-supervisor.cjs');

function memoryStore(seed = {}) {
  const data = { ...seed };
  return {
    getSetting(key, fallback = null) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : fallback;
    },
    setSetting(key, value) {
      data[key] = value;
      return value;
    },
    data
  };
}

test('every named Gemini/Chrome condition classifies to an explicit state', () => {
  const cases = [
    [{ analysisReady: true }, STATE.OUTPUT_READY],
    [{ generating: true, draftGrew: true }, STATE.GENERATING_WITH_PROGRESS],
    [{ generating: true, sinceProgress: 5_000 }, STATE.GENERATING_NO_PROGRESS],
    [{ geminiError: true }, STATE.GEMINI_ERROR],
    [{ rateLimited: true }, STATE.RATE_LIMITED],
    [{ quotaExhausted: true }, STATE.QUOTA_EXHAUSTED],
    [{ networkOffline: true }, STATE.NETWORK_OFFLINE],
    [{ tabClosed: true }, STATE.TAB_CRASHED_OR_CLOSED],
    [{ tabOpen: false }, STATE.TAB_CRASHED_OR_CLOSED],
    [{ browserDisconnected: true }, STATE.BROWSER_DISCONNECTED],
    [{ connected: false }, STATE.BROWSER_DISCONNECTED],
    [{ authRequired: true }, STATE.AUTH_REQUIRED],
    [{ captcha: true }, STATE.CAPTCHA_OR_USER_ACTION],
    [{ chromeNoise: true }, STATE.TAB_CRASHED_OR_CLOSED],
    [{ imageMode: true }, STATE.TAB_CRASHED_OR_CLOSED],
    [{ submitting: true }, STATE.SUBMITTING],
    [{ composerReady: true }, STATE.READY],
    [{ tabUnresponsive: true }, STATE.UNKNOWN_STALL],
    [{ sinceProgress: 60_000 }, STATE.UNKNOWN_STALL]
  ];
  for (const [sample, expected] of cases) {
    assert.equal(classifySupervisorState(sample).state, expected, JSON.stringify(sample));
  }
});

test('slow generation with a live indicator waits instead of recycling', () => {
  const classified = classifySupervisorState({
    generating: true,
    draftGrew: true,
    sinceProgress: 40_000
  });
  const decision = decideSupervisorAction(classified, { now: 40_000, recoveryCount: 0 });
  assert.equal(classified.state, STATE.GENERATING_WITH_PROGRESS);
  assert.equal(decision.action, ACTION.WAIT);
});

test('generation with no progress is allowed a realistic timeout', () => {
  const early = decideSupervisorAction(
    { state: STATE.GENERATING_NO_PROGRESS, sinceProgress: 20_000 },
    { now: 20_000 }
  );
  assert.equal(early.action, ACTION.WAIT);
  assert.equal(early.reason, 'slow-generation');
  const late = decideSupervisorAction(
    { state: STATE.GENERATING_NO_PROGRESS, sinceProgress: GENERATION_TIMEOUT_MS },
    { now: GENERATION_TIMEOUT_MS }
  );
  assert.equal(late.action, ACTION.RETRY_PAGE);
});

test('dead, closed, and disconnected browsers recover with one replacement', () => {
  assert.equal(decideSupervisorAction({ state: STATE.TAB_CRASHED_OR_CLOSED }, { now: 1 }).action, ACTION.REPLACE_TAB);
  assert.equal(decideSupervisorAction({ state: STATE.BROWSER_DISCONNECTED }, { now: 1 }).action, ACTION.RECONNECT_BROWSER);
  const inFlight = decideSupervisorAction(
    { state: STATE.TAB_CRASHED_OR_CLOSED },
    { now: 1, replacing: true }
  );
  assert.equal(inFlight.action, ACTION.WAIT);
  assert.equal(inFlight.reason, 'one-replacement-in-flight');
});

test('rate limit reads the displayed delay and never opens extra tabs', () => {
  assert.equal(parseRateLimitMs('try again in 32 seconds'), Math.max(SHORT_COOLDOWN_MS, 32_000));
  const decision = decideSupervisorAction(
    { state: STATE.RATE_LIMITED },
    { now: 1_000, rateLimitMs: 90_000 }
  );
  assert.equal(decision.action, ACTION.COOLDOWN);
  assert.equal(decision.nextRetryAt, 91_000);
});

test('quota, auth, and CAPTCHA pause for one user action', () => {
  for (const state of [STATE.QUOTA_EXHAUSTED, STATE.AUTH_REQUIRED, STATE.CAPTCHA_OR_USER_ACTION]) {
    const decision = decideSupervisorAction({ state }, { now: 1, recoveryCount: 8 });
    assert.equal(decision.action, ACTION.PAUSE_USER);
  }
});

test('unknown stall snapshots, waits, reloads once, then reopens once', () => {
  const first = decideSupervisorAction({ state: STATE.UNKNOWN_STALL, sinceProgress: 60_000 }, { now: 1_000 });
  assert.equal(first.action, ACTION.SNAPSHOT);
  const second = decideSupervisorAction({ state: STATE.UNKNOWN_STALL, sinceProgress: 60_000 }, {
    now: 50_000,
    snapshotted: true
  });
  assert.equal(second.action, ACTION.RELOAD_TAB);
  const third = decideSupervisorAction({ state: STATE.UNKNOWN_STALL, sinceProgress: 60_000 }, {
    now: 50_000,
    snapshotted: true,
    reloaded: true
  });
  assert.equal(third.action, ACTION.REPLACE_TAB);
});

test('circuit breaker cools down instead of giving up after two retries', () => {
  assert.equal(circuitFor(0).breaker, 'immediate');
  assert.equal(circuitFor(2).breaker, 'short');
  assert.equal(circuitFor(4).breaker, 'long');
  const cooled = decideSupervisorAction(
    { state: STATE.TAB_CRASHED_OR_CLOSED },
    { now: 10_000, nextRetryAt: 20_000, recoveryCount: 2 }
  );
  assert.equal(cooled.action, ACTION.COOLDOWN);
  assert.equal(cooled.reason, 'circuit-breaker');
  const after = decideSupervisorAction(
    { state: STATE.TAB_CRASHED_OR_CLOSED },
    { now: 20_000, recoveryCount: 2 }
  );
  assert.equal(after.action, ACTION.REPLACE_TAB);
  assert.ok(after.nextRetryAt >= 20_000 + SHORT_COOLDOWN_MS);
  const later = decideSupervisorAction(
    { state: STATE.GEMINI_ERROR },
    { now: 1, recoveryCount: 4 }
  );
  assert.equal(later.nextRetryAt, 1 + LONG_COOLDOWN_MS);
});

test('history prefers a recovery that already worked for the same state', () => {
  const history = [
    { state: STATE.TAB_CRASHED_OR_CLOSED, action: ACTION.RELOAD_TAB, succeeded: true },
    { state: STATE.TAB_CRASHED_OR_CLOSED, action: ACTION.REPLACE_TAB, succeeded: true },
    { state: STATE.TAB_CRASHED_OR_CLOSED, action: ACTION.REPLACE_TAB, succeeded: true }
  ];
  assert.equal(preferredAction(STATE.TAB_CRASHED_OR_CLOSED, history), ACTION.REPLACE_TAB);
  const decision = decideSupervisorAction({ state: STATE.TAB_CRASHED_OR_CLOSED }, { now: 1 }, history);
  assert.equal(decision.action, ACTION.REPLACE_TAB);
});

test('observe does not increment recovery until commit, and submit is idempotent', () => {
  const supervisor = new BrowserSupervisor({ now: () => 5_000 });
  supervisor.load({ projectId: 'book-1', pageId: 'page-3' });
  const first = supervisor.observe({ tabClosed: true });
  assert.equal(first.action, ACTION.REPLACE_TAB);
  assert.equal(supervisor.checkpoint.recoveryCount, 0);
  supervisor.commit(first);
  assert.equal(supervisor.checkpoint.recoveryCount, 1);
  supervisor.markSubmitted();
  assert.equal(supervisor.canSubmit(), false);
  supervisor.observe({ analysisReady: true });
  supervisor.commit({ action: ACTION.ACCEPT, state: STATE.OUTPUT_READY });
  assert.equal(supervisor.canSubmit(), false);
  assert.equal(supervisor.checkpoint.outputStatus, 'ready');
});

test('an interrupted job resumes the first unfinished page without a duplicate submit', () => {
  const store = memoryStore();
  const before = new BrowserSupervisor({ store, now: () => 1_000 });
  before.load({ projectId: 'maze-1', pageId: 'M03' });
  before.observe({ submitting: true });
  before.markSubmitted('M03-1');
  before.save();

  const after = new BrowserSupervisor({ store, now: () => 8_000 });
  after.load({ projectId: 'maze-1', pageId: 'M03' });
  assert.equal(after.checkpoint.pageId, 'M03');
  assert.equal(after.checkpoint.attemptId, 'M03-1');
  assert.ok(after.checkpoint.submittedAt);
  assert.equal(after.canSubmit(), false);

  const duplicate = after.observe({ analysisReady: true, outputReady: true });
  assert.equal(duplicate.action, ACTION.ACCEPT);
  after.commit(duplicate);
  after.record(true);
  assert.equal(after.checkpoint.outputStatus, 'ready');
});

test('error samples from the existing controller map onto supervisor states', () => {
  assert.equal(classifySupervisorState(buildSupervisorSample({
    error: { code: 'BROWSER_CONTEXT_CLOSED' }
  })).state, STATE.BROWSER_DISCONNECTED);
  assert.equal(classifySupervisorState(buildSupervisorSample({
    error: { code: 'AUTH_REQUIRED' }
  })).state, STATE.AUTH_REQUIRED);
  assert.equal(classifySupervisorState(buildSupervisorSample({
    error: { code: 'CAPTCHA' }
  })).state, STATE.CAPTCHA_OR_USER_ACTION);
  assert.equal(classifySupervisorState(buildSupervisorSample({
    error: { code: 'RATE_LIMIT', message: 'try again in 2 minutes' }
  })).state, STATE.RATE_LIMITED);
  assert.equal(classifySupervisorState(buildSupervisorSample({
    watched: { decision: { reason: 'dead-gemini-image-mode' } }
  })).state, STATE.TAB_CRASHED_OR_CLOSED);
  assert.equal(classifySupervisorState(buildSupervisorSample({
    error: { code: 'COMPOSER_NOT_FOUND' }
  })).state, STATE.GEMINI_ERROR);
  assert.equal(classifySupervisorState(buildSupervisorSample({
    error: { code: 'NETWORK_OFFLINE' }
  })).state, STATE.NETWORK_OFFLINE);
});

test('after submit, leftover image chrome waits on the same tab until the brief is ready', () => {
  const classified = classifySupervisorState(buildSupervisorSample({
    submitted: true,
    imageMode: true,
    chromeNoise: true,
    watched: { decision: { reason: 'dead-gemini-image-mode' } }
  }));
  assert.equal(classified.state, STATE.GENERATING_NO_PROGRESS);
  const decision = decideSupervisorAction(classified, { now: 5_000, submittedAt: 1_000 });
  assert.equal(decision.action, ACTION.WAIT);
  assert.equal(decision.reason, 'script-wait-for-result');
});

test('analysis script only leaves the tab after submit if the tab is actually gone', () => {
  const closed = decideSupervisorAction(
    { state: STATE.TAB_CRASHED_OR_CLOSED },
    { now: 1, submittedAt: 1 }
  );
  assert.equal(closed.action, ACTION.REPLACE_TAB);
  const ready = decideSupervisorAction(
    { state: STATE.OUTPUT_READY },
    { now: 1, submittedAt: 1 }
  );
  assert.equal(ready.action, ACTION.ACCEPT);
  assert.equal(ready.scriptStep, ANALYSIS_SCRIPT.G);
});

test('a new analysis job ignores a previous ready checkpoint and can submit', () => {
  const store = memoryStore();
  const before = new BrowserSupervisor({ store, now: () => 1_000 });
  before.load({ projectId: 'https://tpt.example/product', pageId: 'analysis' });
  before.markSubmitted('analysis-1');
  before.observe({ analysisReady: true });
  before.commit({ action: ACTION.ACCEPT, state: STATE.OUTPUT_READY });
  assert.equal(before.canSubmit(), false);

  const after = new BrowserSupervisor({ store, now: () => 8_000 });
  after.beginJob({ projectId: 'https://tpt.example/product', pageId: 'analysis' });
  assert.equal(after.canSubmit(), true);
  assert.equal(after.checkpoint.outputStatus, 'pending');
  assert.equal(after.checkpoint.submittedAt, 0);
  assert.equal(after.checkpoint.lastProgressAt, 0);
});

test('empty leftover text is not a crashed tab', () => {
  const classified = classifySupervisorState(buildSupervisorSample({
    watched: { text: '', observation: { phase: 'failed', reason: 'no-response' } }
  }));
  assert.notEqual(classified.state, STATE.TAB_CRASHED_OR_CLOSED);
});

test('recovery clears a stale ready output so the next attempt can submit', () => {
  const applied = applyDecision(
    { pageId: 'analysis', recoveryCount: 0, submittedAt: 99, outputStatus: 'ready' },
    { state: STATE.TAB_CRASHED_OR_CLOSED },
    { action: ACTION.REPLACE_TAB, state: STATE.TAB_CRASHED_OR_CLOSED },
    { now: 3 }
  );
  assert.equal(applied.submittedAt, 0);
  assert.equal(applied.outputStatus, 'pending');
});

test('commit of a retry assigns a new attemptId and clears the submit guard', () => {
  const supervisor = new BrowserSupervisor({ now: () => 2_000 });
  supervisor.load({ pageId: 'analysis' });
  const decision = supervisor.observe({ geminiError: true });
  assert.equal(decision.action, ACTION.RETRY_PAGE);
  supervisor.commit(decision);
  assert.equal(supervisor.canSubmit(), true);
  assert.match(supervisor.checkpoint.attemptId, /analysis-2/);
  const applied = applyDecision(
    { pageId: 'analysis', recoveryCount: 0, submittedAt: 99 },
    { state: STATE.GEMINI_ERROR },
    { action: ACTION.RETRY_PAGE, state: STATE.GEMINI_ERROR },
    { now: 3 }
  );
  assert.equal(applied.submittedAt, 0);
  assert.equal(applied.recoveryCount, 1);
});

test('a Gemini error after submit waits on the same tab instead of recycling', () => {
  const supervisor = new BrowserSupervisor({ now: () => 2_000 });
  supervisor.beginJob({ pageId: 'analysis' });
  supervisor.markSubmitted('analysis-1');
  const decision = supervisor.observe({ geminiError: true });
  assert.equal(decision.action, ACTION.WAIT);
  assert.equal(decision.reason, 'script-wait-for-result');
});
