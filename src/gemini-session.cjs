'use strict';

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function classifyGeminiTabSession(sample = {}) {
  const url = String(sample.url || '');
  if (/accounts\.google\.com/i.test(url)) return 'account-chooser';
  if (sample.signedIn) return 'signed-in';
  if (sample.hasSignInControl) return 'signed-out-landing';
  if (sample.hasComposer && !sample.hasSignInControl) return 'likely-signed-in';
  if (/gemini\.google\.com/i.test(url)) return 'gemini-unknown';
  return 'other';
}

function shouldOneClickGeminiSignIn(sample = {}) {
  const state = sample.state || classifyGeminiTabSession(sample);
  if (state === 'signed-in' || state === 'likely-signed-in') return false;
  const trusted = Boolean(sample.loginConfirmed || sample.hasSavedCookies);
  if (!trusted) return false;
  return state === 'signed-out-landing' || state === 'account-chooser' || state === 'gemini-unknown';
}

function pickPreferredGeminiPage(pages = []) {
  const list = Array.isArray(pages) ? pages.filter(Boolean) : [];
  const signedIn = list.find((item) => item.isGemini && item.signedIn);
  if (signedIn) return signedIn;
  const gemini = list.find((item) => item.isGemini);
  if (gemini) return gemini;
  return list.find((item) => /accounts\.google\.com/i.test(String(item.url || ''))) || null;
}

function shouldCreateGeminiTab(pages = []) {
  return !pickPreferredGeminiPage(pages);
}

function googleAccountLocatorHints(email = '') {
  const value = String(email || '').trim();
  const hints = [];
  if (value) {
    hints.push(`[data-identifier="${value}"]`);
    hints.push(`[data-email="${value}"]`);
  }
  hints.push('[data-identifier][data-authuser]');
  hints.push('div[data-identifier]');
  hints.push('[data-authuser="0"]');
  return hints;
}

function isGoogleAccountChooserNoise(label) {
  return /use another account|add account|create account|remove an account/i.test(String(label || ''));
}

function matchSavedGoogleAccount(entry = {}, email = '') {
  const wanted = normalizeEmail(email);
  if (!wanted) return false;
  const identifier = normalizeEmail(entry.identifier || entry.email || entry.datasetIdentifier);
  if (identifier && identifier === wanted) return true;
  const text = normalizeEmail(entry.text || entry.label);
  return Boolean(text && text.includes(wanted));
}

module.exports = {
  classifyGeminiTabSession,
  shouldOneClickGeminiSignIn,
  pickPreferredGeminiPage,
  shouldCreateGeminiTab,
  googleAccountLocatorHints,
  isGoogleAccountChooserNoise,
  matchSavedGoogleAccount,
  normalizeEmail
};
