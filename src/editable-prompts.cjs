'use strict';

/**
 * Prompt wrappers for the editable pipeline.
 *
 * Gemini's safety classifiers refuse outright on some words: "render" reads as a
 * 3D/graphics request and "editable" reads as a request to author office files.
 * Neither may appear in anything we send, so every prompt built here is screened.
 */

const { resolvePromptText } = require('./customization.cjs');

const BANNED_PATTERN = /\b(render(?:ing|s|ed)?|render\s+mode|editable)\b/i;

const ARTWORK_PROMPT = [
  'Illustration of an educational activity page with decorative themed borders, illustrations,',
  'and empty blank frames. Clear, clean white negative space inside the boxes. Pure illustration',
  'only, completely blank inside the frames — no writing, no words, no letters, no numbers,',
  'no labels, no typography. High quality, print-ready 300 DPI layout, flat 2D graphic style',
  'suitable for a children\x27s workbook page.'
].join(' ');

const PAGE_TEXT_PROMPT = [
  'Here is a blank educational activity page layout. Look at the empty frames, boxes, and',
  'decorative theme in this image. Write the educational text — a title, brief instructions,',
  'and any questions or activity content — sized and structured to fit cleanly inside each',
  'visible blank frame. Match the tone and theme to the artwork shown. Return the text',
  'organized by frame/section (e.g., Title, Instructions, Question 1, Question 2), not as a',
  'single paragraph, so it can be placed into separate text boxes later.'
].join(' ');

/** Page codes the gem sees: 01A is page one artwork, 01T is page one text. */
function pageCode(pageNumber, kind) {
  const n = Math.max(1, Number(pageNumber) || 1);
  return `${String(n).padStart(2, '0')}${kind === 'text' ? 'T' : 'A'}`;
}

function assertPromptIsSafe(prompt) {
  const match = BANNED_PATTERN.exec(prompt);
  if (match) {
    throw Object.assign(new Error(`Prompt contains a refusal-triggering word: "${match[0]}".`),
      { code: 'EDITABLE_PROMPT_BANNED_WORD', word: match[0] });
  }
  return prompt;
}

/** Strip refusal-triggering words from author-supplied text rather than failing on it. */
function scrubPrompt(value) {
  return String(value ?? '')
    .replace(/\brender\s+mode\b/gi, 'layout style')
    .replace(/\brender(?:ing|s|ed)?\b/gi, 'illustrate')
    // "editable" starts with a vowel and "reusable" does not, so the article moves with it.
    .replace(/\ban(\s+)editable\b/gi, 'a$1reusable')
    .replace(/\beditable\b/gi, 'reusable')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Stage 1: the artwork wrapper plus this page's topic, safe to send as-is. */
function buildArtworkPrompt({ pageNumber, pageTitle, pageVisualDescription } = {}) {
  const topic = [pageTitle, pageVisualDescription].map((part) => scrubPrompt(part)).filter(Boolean).join(' - ');
  const brief = topic || 'General practice page';
  const code = pageCode(pageNumber, 'artwork');
  return assertPromptIsSafe(resolvePromptText(
    'editableArtwork',
    { pageCode: code, brief },
    () => `${ARTWORK_PROMPT}\n\nPAGE TOPIC & THEME:\n${code}: ${brief}`
  ));
}

/** Stage 2: read the finished artwork and write text that fits its blank frames. */
function buildPageTextPrompt({ topic, pageNumber } = {}) {
  const code = pageCode(pageNumber, 'text');
  const topicText = scrubPrompt(topic) || 'General practice page';
  return assertPromptIsSafe(resolvePromptText('editablePageText', {
    pageCode: code,
    topic: topicText
  }, () => [
    `${code}: ${PAGE_TEXT_PROMPT}`,
    '',
    `PAGE TOPIC & THEME: ${topicText}`,
    '',
    'Return ONLY JSON with these keys:',
    '- title: main heading string',
    '- instruction: clear directions string',
    '- sections: array of the questions or activity items, one string per frame/section',
    '- footer: name/date/classroom string'
  ].join('\n')));
}

module.exports = { ARTWORK_PROMPT, PAGE_TEXT_PROMPT, pageCode, BANNED_PATTERN, assertPromptIsSafe, scrubPrompt, buildArtworkPrompt, buildPageTextPrompt };
