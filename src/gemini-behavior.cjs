'use strict';

/**
 * Classifies what Gemini is actually doing so the browser watchdog can
 * recover instead of babysitting. A leftover custom-gem chrome line is not
 * a product brief. An image-mode studio is a dead tab for analysis.
 */

const IMAGE_MODE = /creating your image|create images?\b|image generation/i;
const GEM_CHROME = /custom gem|tpt book pages creation pro|content pages gemcreating/i;
const RECOVERY_PAUSES_MS = Object.freeze([0, 5_000, 20_000, 30_000, 60_000]);

function classifyGeminiDraft(text = '', options = {}) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (options.analysisReady) {
    return { behavior: 'analysis-ready', dead: false };
  }
  if (options.rateLimited) {
    return { behavior: 'rate-limit', dead: false };
  }
  if (IMAGE_MODE.test(value) && value.length < 400) {
    return { behavior: 'image-mode', dead: true };
  }
  if (GEM_CHROME.test(value) && value.length < 400 && !/"title"\s*:/i.test(value)) {
    return { behavior: 'chrome-noise', dead: true };
  }
  if (options.inProgress && value.length > 40) {
    return { behavior: 'drafting', dead: false };
  }
  if (!value || value.length < 40) {
    return { behavior: options.inProgress ? 'waiting' : 'empty', dead: false };
  }
  if (!options.inProgress && value.length < 200 && !/"title"\s*:/i.test(value)) {
    return { behavior: 'empty', dead: false };
  }
  return { behavior: options.inProgress ? 'lagging' : 'dead', dead: !options.inProgress };
}

function isGeminiChromeNoise(text) {
  const behavior = classifyGeminiDraft(text).behavior;
  return behavior === 'image-mode' || behavior === 'chrome-noise';
}

function recoveryPauseMs(attempt = 1, behavior = '') {
  if (behavior === 'rate-limit') return 60_000;
  const index = Math.max(0, Number(attempt) || 1) - 1;
  return RECOVERY_PAUSES_MS[Math.min(index, RECOVERY_PAUSES_MS.length - 1)];
}

module.exports = {
  IMAGE_MODE,
  GEM_CHROME,
  RECOVERY_PAUSES_MS,
  classifyGeminiDraft,
  isGeminiChromeNoise,
  recoveryPauseMs
};
