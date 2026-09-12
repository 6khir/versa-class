'use strict';

const DRAFTING_GROWTH_WINDOW_MS = 12_000;
const SETTLE_MS = 1_200;
const LAG_MS = 25_000;
const PARTIAL_LAG_ACCEPT_MS = 40_000;
const EMPTY_LAG_SHRINK_MS = 55_000;
const ANALYSIS_LAG_RETRY_MS = 20_000;
const EMPTY_WAIT_MS = 20_000;
const MIN_PROMPT_BATCH_SIZE = 10;
const DRAFTING_POLL_MS = 700;
const WAITING_POLL_MS = 500;
const LAGGING_POLL_MS = 800;
const BLOCKER_CHECK_MS = 4_000;
const FULL_TEXT_STALL_MS = 8_000;

const GEMINI_TEXT_PHASE = {
  WAITING: 'waiting',
  DRAFTING: 'drafting',
  LAGGING: 'lagging',
  COLLAPSED: 'collapsed',
  INCOMPLETE: 'incomplete',
  FINISHED: 'finished',
  FAILED: 'failed'
};

function sampleLength(sample = {}, fallbackText = '') {
  const length = Number(sample.textLength);
  if (Number.isFinite(length) && length >= 0) return length;
  return String(fallbackText || sample.text || '').length;
}

function textGrew(text, previousText, sample = {}) {
  if (sample && (Number.isFinite(Number(sample.textLength)) || Number.isFinite(Number(sample.previousLength)))) {
    return sampleLength(sample, text) > sampleLength({ textLength: sample.previousLength }, previousText);
  }
  return String(text || '').length > String(previousText || '').length;
}

function shouldReadFullGeminiTranscript(sample = {}) {
  if (!sample.inProgress) return true;
  if (sample.collapsedVisible) return true;
  const sinceGrowth = Math.max(0, Number(sample.sinceGrowth) || 0);
  return sinceGrowth >= FULL_TEXT_STALL_MS;
}

function looksLikeRefusal(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (value.length < 20 || value.length > 1_200) return false;
  return /i (?:can(?:not|'t)|am unable to) (?:help|comply|do that)|won't (?:write|create|generate).*copyright/i.test(value)
    && !/@image\b/i.test(value);
}

function analysisDraftUsable(text) {
  const value = String(text || '').trim();
  if (value.length < 40) return false;
  try {
    return require('./prompt-builder.cjs').analysisResponseReady(value);
  } catch {
    return false;
  }
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
  const grew = textGrew(text, previousText, sample);
  const hasText = sampleLength(sample, text) > 0 || text.trim().length > 0;
  const analysisReady = expectedCount === 0 && (Boolean(sample.analysisReady) || analysisDraftUsable(text));
  const enough = expectedCount > 0 ? parsedCount >= expectedCount : analysisReady;
  const short = expectedCount > 0 && parsedCount > 0 && parsedCount < expectedCount;

  let phase = GEMINI_TEXT_PHASE.DRAFTING;
  let reason = 'keep-watching';
  if (looksLikeRefusal(text) && !inProgress) {
    phase = GEMINI_TEXT_PHASE.FAILED;
    reason = 'refusal';
  } else if (inProgress && grew) {
    reason = 'text-growing';
  } else if (inProgress && hasText && sinceGrowth < DRAFTING_GROWTH_WINDOW_MS && !analysisReady) {
    reason = 'busy-recent-text';
  } else if (inProgress && !hasText && elapsed < EMPTY_WAIT_MS) {
    phase = GEMINI_TEXT_PHASE.WAITING;
    reason = 'busy-no-text-yet';
  } else if (inProgress && expectedCount > 0 && enough && sinceGrowth >= SETTLE_MS) {
    phase = GEMINI_TEXT_PHASE.FINISHED;
    reason = 'busy-but-quota-met';
  } else if (inProgress && expectedCount === 0 && analysisReady && sinceGrowth >= SETTLE_MS) {
    phase = GEMINI_TEXT_PHASE.FINISHED;
    reason = 'busy-but-analysis-ready';
  } else if (inProgress && sinceGrowth >= LAG_MS) {
    phase = GEMINI_TEXT_PHASE.LAGGING;
    reason = hasText ? 'busy-stalled-mid-draft' : 'busy-stalled-empty';
  } else if (!inProgress && collapsedVisible && hasText) {
    phase = GEMINI_TEXT_PHASE.COLLAPSED;
    reason = 'show-more';
  } else if (!inProgress && hasText && sinceGrowth < SETTLE_MS) {
    reason = 'settling';
  } else if (!inProgress && short) {
    phase = GEMINI_TEXT_PHASE.INCOMPLETE;
    reason = 'short-stable-response';
  } else if (!inProgress && enough && hasText) {
    phase = GEMINI_TEXT_PHASE.FINISHED;
    reason = 'stable';
  } else if (!inProgress && !hasText && elapsed >= EMPTY_WAIT_MS) {
    phase = GEMINI_TEXT_PHASE.FAILED;
    reason = 'no-response';
  } else if (!inProgress && !hasText) {
    phase = GEMINI_TEXT_PHASE.WAITING;
    reason = 'no-text-yet';
  }

  return {
    phase,
    reason,
    grew,
    elapsed,
    sinceGrowth,
    parsedCount,
    expectedCount,
    text,
    hasTitleJson: /"title"\s*:/i.test(text),
    analysisReady
  };
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
  // Analysis has no page quota. Leftover chat is not a product. Recycle
  // empty or short leftover text after ~20s. A usable analysis JSON is a
  // finished draft — accept it even if Stop is still up.
  const analysisLagMs = expectedCount === 0
    ? Math.max(0, Number(options.lagRetryMs) || ANALYSIS_LAG_RETRY_MS)
    : Math.max(0, Number(options.lagRetryMs) || 0);
  const usable = Boolean(observation.analysisReady)
    || analysisDraftUsable(observation.text)
    || Boolean(observation.hasTitleJson)
    || /"title"\s*:/i.test(String(observation.text || ''));
  if (analysisLagMs && !usable && sinceGrowth >= analysisLagMs) {
    return { action: 'retry', pollMs: 0, reason: 'lag-recycle-tab' };
  }

  if (phase === GEMINI_TEXT_PHASE.DRAFTING || phase === GEMINI_TEXT_PHASE.WAITING) {
    return {
      action: 'wait',
      pollMs: phase === GEMINI_TEXT_PHASE.DRAFTING ? DRAFTING_POLL_MS : WAITING_POLL_MS,
      reason: observation.reason || phase
    };
  }

  if (phase === GEMINI_TEXT_PHASE.COLLAPSED) {
    return { action: 'expand', pollMs: 280, reason: observation.reason };
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
    if (usable) {
      return { action: 'accept', pollMs: 0, reason: 'lag-but-analysis-ready' };
    }
    const lagRetryMs = Math.max(0, Number(options.lagRetryMs) || (expectedCount === 0 ? ANALYSIS_LAG_RETRY_MS : 0));
    if (lagRetryMs && sinceGrowth >= lagRetryMs) {
      return { action: 'retry', pollMs: 0, reason: 'lag-recycle-tab' };
    }
    return { action: 'wait', pollMs: LAGGING_POLL_MS, reason: observation.reason || 'lag-keep-waiting' };
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
    if (expectedCount === 0 && analysisLagMs && sinceGrowth < analysisLagMs) {
      return { action: 'wait', pollMs: WAITING_POLL_MS, reason: 'empty-wait-for-generation' };
    }
    return { action: 'retry', pollMs: 0, reason: observation.reason || 'failed' };
  }

  return { action: 'wait', pollMs: WAITING_POLL_MS, reason: 'default-wait' };
}

module.exports = {
  GEMINI_TEXT_PHASE,
  DRAFTING_GROWTH_WINDOW_MS,
  SETTLE_MS,
  LAG_MS,
  PARTIAL_LAG_ACCEPT_MS,
  EMPTY_LAG_SHRINK_MS,
  ANALYSIS_LAG_RETRY_MS,
  EMPTY_WAIT_MS,
  MIN_PROMPT_BATCH_SIZE,
  DRAFTING_POLL_MS,
  WAITING_POLL_MS,
  LAGGING_POLL_MS,
  BLOCKER_CHECK_MS,
  FULL_TEXT_STALL_MS,
  textGrew,
  sampleLength,
  looksLikeRefusal,
  analysisDraftUsable,
  shouldReadFullGeminiTranscript,
  classifyGeminiTextObservation,
  decideGeminiTextAction,
  nextPromptBatchSize
};
