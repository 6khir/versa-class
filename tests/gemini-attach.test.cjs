const test = require('node:test');
const assert = require('node:assert/strict');
const {
  GEMINI_ATTACH_SELECTORS,
  countComposerAttachmentChipsInBrowser
} = require('../src/browser-controller.cjs');

test('Gemini attach uses Upload & tools, not the ChatGPT plus button', () => {
  assert.ok(GEMINI_ATTACH_SELECTORS.some((selector) => /Upload & tools/i.test(selector)));
  assert.ok(!GEMINI_ATTACH_SELECTORS.some((selector) => /composer-plus-btn/i.test(selector)));
  assert.equal(typeof countComposerAttachmentChipsInBrowser, 'function');
});
