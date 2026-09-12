'use strict';
const { validateEditablePageContract } = require('./editable-page-contract.cjs');
const { buildDeterministicPageLayout } = require('./editable-layout-engine.cjs');
const { ARTWORK_PROMPT } = require('./editable-prompts.cjs');
function getSharp() {
  return require('sharp');
}
/**
 * Gemini wraps JSON in prose, code fences, or a bare "JSON" label. Pull the first
 * balanced object out of the reply instead of trusting the whole string to parse.
 */
function extractJsonObject(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function parseJsonResponse(raw) {
  if (typeof raw !== 'string') throw new Error('EDITABLE_RESPONSE_INVALID');
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    const candidate = extractJsonObject(cleaned);
    if (!candidate) throw error;
    return JSON.parse(candidate);
  }
}
async function planEditablePage(template, brief, provider) {
  let answer = {
    ...template,
    elements: template.elements?.length ? template.elements : [
      { id: `${template.revisionId}-title`, role: 'title', regionId: 'body', content: { text: brief.split('\n')[0] || 'Title' } }
    ]
  };
  const contract = validateEditablePageContract(answer);
  if (!contract.elements.length) throw new Error('EDITABLE_PLAN_EMPTY');
  if (contract.elements.some(el => ['table','answer-line'].includes(el.role))) throw new Error('EDITABLE_ROLE_UNSUPPORTED');
  return contract;
}
// Stage 3 geometry is deterministic; the layout engine is the single source of truth.
function generateStructuredLayout(input) {
  return buildDeterministicPageLayout(validateEditablePageContract(input));
}
async function generateTextFreeArtwork(input, provider) {
  validateEditablePageContract(input);
  const raw = await provider.generateImage(ARTWORK_PROMPT);
  const buffer = await getSharp()(raw, { failOn: 'warning' }).rotate().png().toBuffer();
  const evidence = await provider.validateArtwork(buffer);
  if (!evidence || evidence.textFree !== true) throw new Error('EDITABLE_ARTWORK_TEXT');
  return { buffer, evidence };
}
module.exports = { planEditablePage, generateStructuredLayout, generateTextFreeArtwork, parseJsonResponse };
