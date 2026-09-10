'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const {
  classifyGeminiTabSession,
  shouldOneClickGeminiSignIn,
  pickPreferredGeminiPage,
  shouldCreateGeminiTab,
  matchSavedGoogleAccount,
  isGoogleAccountChooserNoise
} = require('../src/gemini-session.cjs');

const mainSource = readFileSync(join(__dirname, '../src/main.cjs'), 'utf8');
const rendererSource = readFileSync(join(__dirname, '../renderer/renderer.js'), 'utf8');

test('a signed-in Gemini conversation wins over a blank or guest tab', () => {
  const pick = pickPreferredGeminiPage([
    { url: 'about:blank', isGemini: false, signedIn: false },
    { url: 'https://gemini.google.com/app', isGemini: true, signedIn: false },
    { url: 'https://gemini.google.com/app/2a9e7545b921c65c', isGemini: true, signedIn: true }
  ]);
  assert.equal(pick.url, 'https://gemini.google.com/app/2a9e7545b921c65c');
  assert.equal(shouldCreateGeminiTab([pick]), false);
});

test('one-click Sign in is allowed when Settings already verified the Google profile', () => {
  assert.equal(classifyGeminiTabSession({
    url: 'https://gemini.google.com/app',
    hasSignInControl: true
  }), 'signed-out-landing');
  assert.equal(shouldOneClickGeminiSignIn({
    url: 'https://gemini.google.com/app',
    hasSignInControl: true,
    loginConfirmed: true
  }), true);
  assert.equal(shouldOneClickGeminiSignIn({
    url: 'https://accounts.google.com/v3/signin/identifier',
    loginConfirmed: true,
    hasSavedCookies: true
  }), true);
  assert.equal(shouldOneClickGeminiSignIn({
    url: 'https://gemini.google.com/app',
    signedIn: true,
    loginConfirmed: true
  }), false);
  assert.equal(shouldOneClickGeminiSignIn({
    url: 'https://gemini.google.com/app',
    hasSignInControl: true,
    loginConfirmed: false,
    hasSavedCookies: false
  }), false);
});

test('the saved Google account is preferred over Use another account', () => {
  assert.equal(matchSavedGoogleAccount({ identifier: 'versa@school.edu' }, 'versa@school.edu'), true);
  assert.equal(isGoogleAccountChooserNoise('Use another account'), true);
  assert.equal(isGoogleAccountChooserNoise('versa@school.edu'), false);
});

test('main hands the verified Gemini email to the browser controller', () => {
  assert.match(mainSource, /syncBrowserVerifiedAccounts/);
  assert.match(mainSource, /geminiLoginConfirmed/);
  assert.match(mainSource, /geminiAccountProfile/);
  assert.match(mainSource, /browser\.setVerifiedAccounts/);
});

test('Settings Sign in restores the saved Google profile instead of opening a guest tab', () => {
  assert.match(rendererSource, /Sign in with saved profile/);
  assert.match(rendererSource, /it will not open a guest tab/);
  assert.match(rendererSource, /Signing in with the Google account saved in Settings/);
});
