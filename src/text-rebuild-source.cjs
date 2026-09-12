'use strict';

const { isolateCurrentPagePrompt } = require('./editable-mode.cjs');
const { assertPromptIsSafe } = require('./editable-prompts.cjs');

// Gem §11.0 trips only on these exact lines. Do not add "editable" or mode flags.
const TEXT_REBUILD_TRIGGER_LINES = Object.freeze([
  'TEXT-REBUILD SOURCE.',
  'KEEP BAKED TEXT.',
  'ERASABLE PRINT.',
]);

const TEXT_REBUILD_TRIGGER = TEXT_REBUILD_TRIGGER_LINES.join('\n');

const PAGE_ROLE = Object.freeze({
  COVER: 'front-cover',
  INTERIOR: 'interior',
  BACK: 'back-cover',
});

const TEXT_TREATMENT = [
  'TEXT TREATMENT:',
  'Draw the quoted copy as clean, horizontal, high-contrast marker/print.',
  'Place each semantic block on a separate flat pale-paper band.',
  'Use upright, ordinary printed letterforms with generous padding.',
  'Keep all illustration, texture, characters, props, and decoration out of the band interiors.',
].join('\n');

const FORBIDDEN = [
  'FORBIDDEN:',
  'Do not display sequence_index, sequence_total, page numbers, folios, "Page K",',
  '"K of N", control instructions, labels, watermarks, signatures, pseudo-writing,',
  'unquoted text, collage letters, rainbow letters, cutout letters, shadows,',
  'outlines, textured glyphs, curved baselines, rotation, perspective, or text',
  'made from objects.',
].join('\n');

function stripImagePrefix(source) {
  return String(source || '').replace(/^@image\s*/i, '').trim();
}

function hasTextRebuildTrigger(source) {
  const body = stripImagePrefix(source);
  return TEXT_REBUILD_TRIGGER_LINES.every((line, index) => {
    const actual = body.split(/\r?\n/, 3)[index];
    return String(actual || '').trim() === line;
  });
}

function resolveRebuildPageRole({ job, pageNumber, pageCount } = {}) {
  const kind = String(job?.kind || job?.pageLabel || '').toLowerCase();
  if (/cover|front/.test(kind) && !/back/.test(kind)) return PAGE_ROLE.COVER;
  if (/back|thank|closing/.test(kind)) return PAGE_ROLE.BACK;
  const n = Math.max(1, Number(pageNumber || job?.pageNumber) || 1);
  const total = Math.max(1, Number(pageCount) || 1);
  if (n === 1) return PAGE_ROLE.COVER;
  if (total >= 2 && n === total) return PAGE_ROLE.BACK;
  return PAGE_ROLE.INTERIOR;
}

function extractQuotedCopy(source) {
  const text = String(source || '').replace(/[“”]/g, '"');
  const found = [];
  const seen = new Set();
  const pattern = /"([^"]{1,240})"/g;
  let match;
  while ((match = pattern.exec(text))) {
    const value = String(match[1] || '').trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    found.push(value);
  }
  return found;
}

function roleContract(role) {
  const lines = [
    'ROLE CONTRACT:',
    `This is a ${role}.`,
  ];
  if (role === 'interior') lines.push('If interior, do not design a product cover or back cover.');
  if (role === 'front-cover') lines.push('If front cover, do not design an interior worksheet.');
  if (role === 'back-cover') lines.push('If back cover, do not design a front cover or activity page.');
  return lines.join('\n');
}

function visibleCopyBlock(copy = {}) {
  const lines = ['VISIBLE COPY — DRAW ONLY THESE QUOTED STRINGS:'];
  for (const role of ['title', 'instruction', 'body', 'footer']) {
    const text = String(copy[role] || '').trim();
    if (!text) continue;
    const label = role[0].toUpperCase() + role.slice(1);
    lines.push(`${label}: "${text}"`);
  }
  if (lines.length === 1) lines.push('None.');
  return lines.join('\n');
}

function copyFromPrompt(source) {
  const quoted = extractQuotedCopy(source);
  return {
    title: quoted[0] || '',
    instruction: quoted[1] || '',
    body: quoted.slice(2, -1).join('\n') || (quoted.length === 3 ? quoted[2] : ''),
    footer: quoted.length > 3 ? quoted[quoted.length - 1] : '',
  };
}

function illustrationBrief(source, pageNumber) {
  return isolateCurrentPagePrompt(stripTextRebuildWrapper(source), pageNumber)
    .replace(/^@image\s*/i, '')
    .replace(/\breserved writing band\b/gi, 'pale paper band')
    .replace(/\bempty reserved(?: space| banner| band| title band)?\b/gi, 'pale paper band')
    .trim();
}

function stripTextRebuildWrapper(source) {
  let text = stripImagePrefix(source);
  if (!/^TEXT-REBUILD SOURCE\./i.test(text)) return text;
  const forbiddenEnd = text.indexOf('made from objects.');
  if (forbiddenEnd !== -1) {
    return text.slice(forbiddenEnd + 'made from objects.'.length).trim();
  }
  text = text.replace(/^TEXT-REBUILD SOURCE\.\s*\r?\nKEEP BAKED TEXT\.\s*\r?\nERASABLE PRINT\.\s*/i, '');
  text = text.replace(/^(?:sequence_index:\s*\d+\s*\r?\n|sequence_total:\s*\d+\s*\r?\n|page_role:\s*[a-z-]+\s*\r?\n)+/i, '');
  text = text.replace(/^visible_copy:\s*\r?\n(?:- "[^"]*"\s*\r?\n)*/i, '');
  return text.replace(/^\s+/, '').trim();
}

function shouldApplyTextRebuildSource({ project, job, textFree } = {}) {
  if (textFree) return false;
  if (String(project?.projectType || '').toLowerCase() === 'storybook') return false;
  const kind = String(job?.kind || 'page').toLowerCase();
  if (/thumbnail|mockup|character|preview|video|listing/.test(kind)) return false;
  return true;
}

function buildStructuredImageRequest({
  prompt,
  project,
  job,
  pageCount,
  record,
} = {}) {
  const raw = String(prompt || record?.generationPrompt || '');
  const n = Math.max(1, Number(record?.sequenceIndex || job?.pageNumber) || 1);
  const total = Math.max(
    1,
    Number(record?.sequenceTotal || pageCount) || (Array.isArray(project?.jobs) ? project.jobs.length : 0) || n
  );
  const role = record?.pageRole || resolveRebuildPageRole({ job, pageNumber: n, pageCount: total });
  const brief = illustrationBrief(raw, n);
  const copy = record?.plannedCopy || copyFromPrompt(brief);
  const control = [
    TEXT_REBUILD_TRIGGER,
    '',
    'INTERNAL CONTROL — NEVER DRAW OR DISPLAY:',
    `sequence_index: ${n}`,
    `sequence_total: ${total}`,
    `page_role: ${role}`,
    '',
    roleContract(role),
    '',
    visibleCopyBlock(copy),
    '',
    TEXT_TREATMENT,
    '',
    FORBIDDEN,
  ].join('\n');
  assertPromptIsSafe(control);
  return `@image ${control}\n\n${brief}`.trim();
}

function applyTextRebuildSourcePrompt(input = {}) {
  return buildStructuredImageRequest(input);
}

module.exports = {
  TEXT_REBUILD_TRIGGER_LINES,
  TEXT_REBUILD_TRIGGER,
  PAGE_ROLE,
  TEXT_TREATMENT,
  FORBIDDEN,
  hasTextRebuildTrigger,
  resolveRebuildPageRole,
  extractQuotedCopy,
  stripTextRebuildWrapper,
  shouldApplyTextRebuildSource,
  buildStructuredImageRequest,
  applyTextRebuildSourcePrompt,
  visibleCopyBlock,
  roleContract,
};
