'use strict';

const DRAFTING_GROWTH_WINDOW_MS = 12_000;
const SETTLE_MS = 1_200;
const LAG_MS = 25_000;
const PARTIAL_LAG_ACCEPT_MS = 40_000;
const EMPTY_LAG_SHRINK_MS = 55_000;
const EMPTY_WAIT_MS = 45_000;
const MIN_PROMPT_BATCH_SIZE = 10;

const GEMINI_TEXT_PHASE = {
  WAITING: 'waiting',
  DRAFTING: 'drafting',
  LAGGING: 'lagging',
  COLLAPSED: 'collapsed',
  INCOMPLETE: 'incomplete',
  FINISHED: 'finished',
  FAILED: 'failed'
};

function textGrew(text, previousText) {
  return String(text || '').length > String(previousText || '').length;
}

function looksLikeRefusal(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (value.length < 20 || value.length > 1_200) return false;
  return /i (?:can(?:not|'t)|am unable to) (?:help|comply|do that)|won't (?:write|create|generate).*copyright/i.test(value)
    && !/@image\b/i.test(value);
}

function classifyGeminiTextObservation(sample = {}) {
  const inProgress = Boolean(sample.inProgress);
  const text = String(sample.text || '');
  const previousText = String(sample.previousText || '');
  const expectedCount = Math.max(0, Number.parseInt(sample.expectedCount, 10) || 0);
  const parsedCount = Math.max(0, Number.parseInt(sample.parsedCount, 10) || 0);
  const collapsedVisible = Boolean(sample.collapsedVisible);
  const now = Number(sample.now) || Date.now();
  const startedAt = Number(sample.startedAt) || now;
  const lastGrowthAt = Number(sample.lastGrowthAt) || 0;
  const elapsed = Math.max(0, now - startedAt);
  const sinceGrowth = lastGrowthAt ? Math.max(0, now - lastGrowthAt) : elapsed;
  const grew = textGrew(text, previousText);
  const hasText = text.trim().length > 0;
  const enough = expectedCount > 0 ? parsedCount >= expectedCount : hasText;
  const short = expectedCount > 0 && parsedCount > 0 && parsedCount < expectedCount;

  if (looksLikeRefusal(text) && !inProgress) {
    return { phase: GEMINI_TEXT_PHASE.FAILED, reason: 'refusal', grew, elapsed, sinceGrowth, parsedCount, expectedCount };
  }

  if (inProgress && grew) {
    return { phase: GEMINI_TEXT_PHASE.DRAFTING, reason: 'text-growing', grew, elapsed, sinceGrowth, parsedCount, expectedCount };
  }
  if (inProgress && hasText && sinceGrowth < DRAFTING_GROWTH_WINDOW_MS) {
    return { phase: GEMINI_TEXT_PHASE.DRAFTING, reason: 'busy-recent-text', grew, elapsed, sinceGrowth, parsedCount, expectedCount };
  }
  if (inProgress && !hasText && elapsed < EMPTY_WAIT_MS) {
    return { phase: GEMINI_TEXT_PHASE.WAITING, reason: 'busy-no-text-yet', grew, elapsed, sinceGrowth, parsedCount, expectedCount };
  }
  if (inProgress && expectedCount > 0 && enough && sinceGrowth >= SETTLE_MS) {
    return { phase: GEMINI_TEXT_PHASE.FINISHED, reason: 'busy-but-quota-met', grew, elapsed, sinceGrowth, parsedCount, expectedCount };
  }
  if (inProgress && sinceGrowth >= LAG_MS) {
    return { phase: GEMINI_TEXT_PHASE.LAGGING, reason: hasText ? 'busy-stalled-mid-draft' : 'busy-stalled-empty', grew, elapsed, sinceGrowth, parsedCount, expectedCount };
  }

  if (!inProgress && collapsedVisible && hasText) {
    return { phase: GEMINI_TEXT_PHASE.COLLAPSED, reason: 'show-more', grew, elapsed, sinceGrowth, parsedCount, expectedCount };
  }
  if (!inProgress && hasText && sinceGrowth < SETTLE_MS) {
    return { phase: GEMINI_TEXT_PHASE.DRAFTING, reason: 'settling', grew, elapsed, sinceGrowth, parsedCount, expectedCount };
  }
  if (!inProgress && short) {
    return { phase: GEMINI_TEXT_PHASE.INCOMPLETE, reason: 'short-stable-response', grew, elapsed, sinceGrowth, parsedCount, expectedCount };
  }
  if (!inProgress && enough && hasText) {
    return { phase: GEMINI_TEXT_PHASE.FINISHED, reason: 'stable', grew, elapsed, sinceGrowth, parsedCount, expectedCount };
  }
  if (!inProgress && !hasText && elapsed >= EMPTY_WAIT_MS) {
    return { phase: GEMINI_TEXT_PHASE.FAILED, reason: 'no-response', grew, elapsed, sinceGrowth, parsedCount, expectedCount };
  }
  if (!inProgress && !hasText) {
    return { phase: GEMINI_TEXT_PHASE.WAITING, reason: 'no-text-yet', grew, elapsed, sinceGrowth, parsedCount, expectedCount };
  }

  return { phase: GEMINI_TEXT_PHASE.DRAFTING, reason: 'keep-watching', grew, elapsed, sinceGrowth, parsedCount, expectedCount };
}

function nextPromptBatchSize(batchSize) {
  const current = Math.max(MIN_PROMPT_BATCH_SIZE, Number.parseInt(batchSize, 10) || 50);
  if (current <= MIN_PROMPT_BATCH_SIZE) return MIN_PROMPT_BATCH_SIZE;
  return Math.max(MIN_PROMPT_BATCH_SIZE, Math.ceil(current / 2));
}

function decideGeminiTextAction(observation = {}, options = {}) {
  const phase = observation.phase || GEMINI_TEXT_PHASE.WAITING;
  const parsedCount = Math.max(0, Number(observation.parsedCount) || 0);
  const expectedCount = Math.max(0, Number(observation.expectedCount) || 0);
  const elapsed = Math.max(0, Number(observation.elapsed) || 0);
  const sinceGrowth = Math.max(0, Number(observation.sinceGrowth) || 0);
  const batchSize = Math.max(MIN_PROMPT_BATCH_SIZE, Number.parseInt(options.batchSize, 10) || 50);

  if (phase === GEMINI_TEXT_PHASE.DRAFTING || phase === GEMINI_TEXT_PHASE.WAITING) {
    return {
      action: 'wait',
      pollMs: phase === GEMINI_TEXT_PHASE.DRAFTING ? 150 : 300,
      reason: observation.reason || phase
    };
  }

  if (phase === GEMINI_TEXT_PHASE.COLLAPSED) {
    return { action: 'expand', pollMs: 200, reason: observation.reason };
  }

  if (phase === GEMINI_TEXT_PHASE.FINISHED) {
    return { action: 'accept', pollMs: 0, reason: observation.reason };
  }

  if (phase === GEMINI_TEXT_PHASE.INCOMPLETE) {
    return { action: 'continue', pollMs: 0, reason: observation.reason };
  }

  if (phase === GEMINI_TEXT_PHASE.LAGGING) {
    if (expectedCount > 0 && parsedCount >= expectedCount) {
      return { action: 'accept', pollMs: 0, reason: 'lag-but-quota-met' };
    }
    if (expectedCount > 0 && parsedCount > 0 && sinceGrowth >= PARTIAL_LAG_ACCEPT_MS) {
      return { action: 'accept-partial', pollMs: 0, reason: 'lag-with-partial-draft' };
    }
    if (expectedCount > 0 && parsedCount === 0 && elapsed >= EMPTY_LAG_SHRINK_MS && batchSize > MIN_PROMPT_BATCH_SIZE) {
      return {
        action: 'shrink',
        pollMs: 0,
        nextBatchSize: nextPromptBatchSize(batchSize),
        reason: 'heavy-request-no-draft'
      };
    }
    return { action: 'wait', pollMs: 400, reason: observation.reason || 'lag-keep-waiting' };
  }

  if (phase === GEMINI_TEXT_PHASE.FAILED) {
    if (parsedCount > 0) return { action: 'accept-partial', pollMs: 0, reason: observation.reason };
    if (expectedCount > 0 && batchSize > MIN_PROMPT_BATCH_SIZE) {
      return {
        action: 'shrink',
        pollMs: 0,
        nextBatchSize: nextPromptBatchSize(batchSize),
        reason: observation.reason || 'failed-empty'
      };
    }
    return { action: 'retry', pollMs: 0, reason: observation.reason || 'failed' };
  }

  return { action: 'wait', pollMs: 300, reason: 'default-wait' };
}

module.exports = {
  GEMINI_TEXT_PHASE,
  DRAFTING_GROWTH_WINDOW_MS,
  SETTLE_MS,
  LAG_MS,
  PARTIAL_LAG_ACCEPT_MS,
  EMPTY_LAG_SHRINK_MS,
  EMPTY_WAIT_MS,
  MIN_PROMPT_BATCH_SIZE,
  textGrew,
  looksLikeRefusal,
  classifyGeminiTextObservation,
  decideGeminiTextAction,
  nextPromptBatchSize
};
