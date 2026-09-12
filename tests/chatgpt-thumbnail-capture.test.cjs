'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  GPT_IMAGE_SELECTORS,
  collectChatGptImageCandidatesInBrowser,
  isNewAssistantImage,
  pickBestNewAssistantImage
} = require('../src/browser-controller.cjs');

test('ChatGPT mockup selectors include image-gen cards and do not require https src', () => {
  assert.ok(GPT_IMAGE_SELECTORS.some((selector) => selector.includes('image-gen-card')));
  assert.ok(GPT_IMAGE_SELECTORS.some((selector) => selector.includes('oaiusercontent')));
  assert.ok(GPT_IMAGE_SELECTORS.some((selector) => selector === 'div[id^="image-"] img'));
});

test('accepts the ChatGPT blob mockup that the old skip-blob filter dropped', () => {
  const blob = {
    width: 1024,
    height: 1024,
    signature: 'image-gen-card::blob:https://chatgpt.com/abc',
    src: 'blob:https://chatgpt.com/abc',
    generatedHint: true,
    assistantIndex: 0
  };
  assert.equal(isNewAssistantImage(blob, new Set(['assistant-count::0']), 0), true);
});

test('ignores the uploaded page images in the user turn', () => {
  const upload = {
    width: 1200,
    height: 1600,
    signature: '::blob:https://chatgpt.com/user-page',
    src: 'blob:https://chatgpt.com/user-page',
    fromUserTurn: true,
    assistantIndex: -1
  };
  assert.equal(isNewAssistantImage(upload, new Set(), 0), false);
});

test('ignores composer chips so they are not saved as listing mockups', () => {
  const chip = {
    width: 300,
    height: 300,
    signature: 'composer::blob:https://chatgpt.com/chip',
    src: 'blob:https://chatgpt.com/chip',
    inComposer: true,
    assistantIndex: -1
  };
  assert.equal(isNewAssistantImage(chip, new Set(), 0), false);
});

test('prefers the generated mockup over a large reference image in the same reply', () => {
  const reference = {
    width: 1400,
    height: 1800,
    signature: 'ref::https://files.oaiusercontent.com/page.png',
    src: 'https://files.oaiusercontent.com/page.png',
    generatedHint: false,
    assistantIndex: 0
  };
  const mockup = {
    width: 1024,
    height: 1024,
    signature: 'image-gen-card::blob:https://chatgpt.com/mockup',
    src: 'blob:https://chatgpt.com/mockup',
    generatedHint: true,
    assistantIndex: 0
  };
  const picked = pickBestNewAssistantImage([reference, mockup], new Set(), 0);
  assert.equal(picked.signature, mockup.signature);
});

test('collector function is Playwright-serializable and does not close over Node state', () => {
  assert.equal(typeof collectChatGptImageCandidatesInBrowser, 'function');
  assert.doesNotMatch(Function.prototype.toString.call(collectChatGptImageCandidatesInBrowser), /require\(|module\.|process\./);
});

test('listing mockups use the Gemini Mockups Gem, not ChatGPT', () => {
  const { getJobStartUrl, MOCKUPS_GEM_URL, MOCKUPS_GPT_URL } = require('../src/ai-engine.cjs');
  assert.equal(getJobStartUrl({ kind: 'thumbnail' }, 'gemini'), MOCKUPS_GEM_URL);
  assert.equal(getJobStartUrl({ kind: 'mockup' }, 'gemini'), MOCKUPS_GEM_URL);
  assert.equal(getJobStartUrl({ purpose: 'thumbnail' }, 'gemini'), MOCKUPS_GEM_URL);
  assert.match(MOCKUPS_GEM_URL, /gemini\.google\.com\/gem\/6d30d7350cbc/);
  assert.notEqual(getJobStartUrl({ kind: 'thumbnail' }, 'gemini'), MOCKUPS_GPT_URL);
});

test('mockup generation attaches the compiled document, then arms Gemini image mode', () => {
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const { GEMINI_IMAGE_MODE_NAME } = require('../src/browser-controller.cjs');
  const source = readFileSync(join(__dirname, '../src/browser-controller.cjs'), 'utf8');
  assert.match(source, /promptKind: 'thumbnail'/);
  assert.match(source, /#armGeminiImageGeneration/);
  // Page images used to be staged and attached. A 100-200 page pack is hundreds of
  // megabytes of PNGs, which exceeds the context limit before the model reads any of
  // them, so the compiled .docx carries the ground truth instead.
  assert.match(source, /const attachments = \[sourceDocument\];/);
  assert.doesNotMatch(source, /stageThumbnailPageTargets/);
  assert.doesNotMatch(source, /writeImagesDocx/);
  assert.match(GEMINI_IMAGE_MODE_NAME.source, /create images\?/);
});

test('Gemini blob mockups in the assistant reply are treated as the finished image', () => {
  const geminiBlob = {
    width: 1024,
    height: 1024,
    signature: 'blob:https://gemini.google.com/abc',
    src: 'blob:https://gemini.google.com/abc',
    generatedHint: true,
    assistantIndex: 0
  };
  assert.equal(isNewAssistantImage(geminiBlob, new Set(), 0), true);
  assert.equal(pickBestNewAssistantImage([geminiBlob], new Set(), 0).src, geminiBlob.src);
});
