'use strict';

/**
 * Stage-aware stall detector for the browser lane.
 *
 * The Gemini text observer already knows about draft growth. This helper
 * answers the wider question the controller needs: which STAGE is current,
 * did anything progress, and is it time to close the tab.
 *
 * Progress is real work — a URL change, new listings, draft growth, or a
 * title JSON — not a Stop button that never moves.
 */

const STAGE = Object.freeze({
  TREND_SCAN: 'trend-scan',
  LISTING_SCRAPE: 'listing-scrape',
  GEMINI_ANALYSIS: 'gemini-analysis',
  MAZE_GATE: 'maze-gate'
});

const STAGE_LAG_MS = 20_000;

function isMarketplacePageUrl(url) {
  const value = String(url || '').trim();
  if (!value || value === 'about:blank' || value.startsWith('chrome://')) return false;
  try {
    const host = new URL(value).hostname.toLowerCase();
    return (
      /(^|\.)teacherspayteachers\.com$/.test(host)
      || /(^|\.)etsy\.com$/.test(host)
      || /(^|\.)amazon\.com$/.test(host)
      || host === 'trending.ytuong.me'
    );
  } catch {
    return /teacherspayteachers\.com|(^|[/.])etsy\.com|amazon\.com|trending\.ytuong\.me/i.test(value);
  }
}

function observeStageProgress(previous = null, sample = {}) {
  const now = Number(sample.now) || Date.now();
  const startedAt = Number(sample.startedAt) || Number(previous?.startedAt) || now;
  const stage = sample.stage || previous?.stage || STAGE.TREND_SCAN;
  const url = String(sample.url || '');
  const candidateCount = Math.max(0, Number(sample.candidateCount) || 0);
  const draftLength = Math.max(0, Number(sample.draftLength) || 0);
  const hasTitleJson = Boolean(sample.hasTitleJson);
  const analysisReady = Boolean(sample.analysisReady) || hasTitleJson || Boolean(previous?.analysisReady);
  const domFingerprint = String(sample.domFingerprint || '');
  const urlChanged = Boolean(previous?.url) && previous.url !== url;
  const progressed = !previous
    || urlChanged
    || candidateCount > (Number(previous.candidateCount) || 0)
    || draftLength > (Number(previous.draftLength) || 0)
    || (hasTitleJson && !previous.hasTitleJson)
    || (analysisReady && !previous.analysisReady)
    || (domFingerprint && domFingerprint !== String(previous.domFingerprint || ''));
  const lastProgressAt = progressed ? now : (Number(previous?.lastProgressAt) || startedAt);
  const elapsed = Math.max(0, now - startedAt);
  const sinceProgress = Math.max(0, now - lastProgressAt);
  const lagMs = Math.max(1_000, Number(sample.lagMs) || STAGE_LAG_MS);
  const challenged = Boolean(sample.challenged);
  const lagging = challenged || sinceProgress >= lagMs;
  return {
    stage,
    url,
    candidateCount,
    draftLength,
    hasTitleJson,
    analysisReady,
    domFingerprint,
    startedAt,
    lastProgressAt,
    elapsed,
    sinceProgress,
    challenged,
    lagging,
    action: analysisReady ? 'wait' : (lagging ? 'recycle' : 'wait'),
    reason: analysisReady
      ? 'analysis-ready'
      : (challenged ? `challenge-${stage}` : (lagging ? `lag-${stage}` : 'watching'))
  };
}

module.exports = {
  STAGE,
  STAGE_LAG_MS,
  isMarketplacePageUrl,
  observeStageProgress
};
