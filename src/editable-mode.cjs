'use strict';

const { loadTemplate, pageTypeForJob, describeZones, slugTheme } = require('./layout-templates.cjs');
const { assertPromptIsSafe, scrubPrompt } = require('./editable-prompts.cjs');

const MODE_FIXED = 'fixed';
const MODE_EDITABLE = 'editable';

function resolveGenerationMode(input = {}) {
  const raw = String(input.mode || input.generationMode || '').trim().toLowerCase();
  if (raw === MODE_EDITABLE || raw === 'true') return MODE_EDITABLE;
  return MODE_FIXED;
}

function generationModeKey(projectId) {
  return `generationMode:${projectId}`;
}

function resolveStoredGenerationMode(store, project, job) {
  const stored = store && typeof store.getSetting === 'function'
    ? store.getSetting(generationModeKey(project?.id), null)
    : null;
  return resolveGenerationMode({
    mode: job?.mode || job?.generationMode || project?.mode || project?.generationMode || stored,
  });
}

function persistGenerationMode(store, projectId, mode) {
  const resolved = resolveGenerationMode({ mode });
  store.setSetting(generationModeKey(projectId), resolved);
  return resolved;
}

// Text-free uses this trigger. Baked pages use TEXT-REBUILD SOURCE in text-rebuild-source.cjs.
const TEXT_FREE_TRIGGER = 'text-free master. no baked text.';

const ZERO_TEXT_CONTRACT = [
  'The image must contain ZERO letters, numbers, words, symbols, or typography anywhere',
  '— no title text, no labels, no signage, no speech-bubble text, no background text,',
  'no brand text on any bar, no page numbers, no folio marks, no Page N labels.',
  'Every zone listed below must appear as clean reserved blank space in the given',
  'shape and position, with no marks, scribbles, or placeholder glyphs inside it',
].join(' ');

const IDENTICAL_LAYOUT = 'The illustration, medium, palette, and layout are otherwise identical to the standard version of this page.';

const PAGE_NUMBER_BAN = [
  'Do not paint page numbers, slide indexes, printed folios, or Page N marks anywhere',
  '— not in a corner, header, footer, or decorative badge.',
].join(' ');

const IMAGE_ONLY_CONTRACT = [
  'Return exactly one final image. Do not reply with text, plans, prompt reprints,',
  'or a JSON manifest. The pipeline already holds the zone copy.',
].join(' ');

function stripBakedTextClause(source) {
  return String(source || '')
    .replace(/The image must contain ONLY the following text:[\s\S]*?(?=Create exactly one |Keep all |Use the |Do not ask |$)/i, '')
    .replace(/Keep all text and important artwork/i, 'Keep all important artwork');
}

function stripPageNumberLanguage(source) {
  return String(source || '')
    .replace(/\bPAGE\s+\d+\s*[—\-:|.]*/gi, '')
    .replace(/\bpages?\s+\d+\s+of\s+\d+\b/gi, '')
    .replace(/\bpage\s+#?\d+\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isolateCurrentPagePrompt(source, pageNumber) {
  const text = String(source || '');
  const n = Math.max(1, Number(pageNumber) || 1);
  const chunks = text.split(/(?=Page\s+\d+(?:\s+of\s+\d+)?\s*(?:[—–-]\s*[^:]{0,48})?:)/i);
  if (chunks.length < 2) return text.trim();
  const numbered = chunks.map((chunk) => {
    const match = /^Page\s+(\d+)/i.exec(chunk.trim());
    return { page: match ? Number(match[1]) : null, chunk: chunk.trim() };
  });
  const hit = numbered.find((item) => item.page === n);
  if (hit) {
    return hit.chunk.replace(/^Page\s+\d+(?:\s+of\s+\d+)?\s*(?:[—–-]\s*[^:]{0,48})?:\s*/i, '').trim();
  }
  if (n === 1 && numbered[0].page == null) return numbered[0].chunk;
  return text.trim();
}

function neutralizePaintedCopy(source) {
  return String(source || '')
    .replace(/[“”]/g, '"')
    .replace(/"([^"]{1,240})"/g, 'empty reserved space')
    .replace(/\[[A-Z][A-Z0-9 _.-]{1,48}\]/g, 'empty reserved space')
    .replace(/\bhand-cut lettering\b/gi, 'empty reserved banner')
    .replace(/\blettering\b/gi, 'empty reserved band')
    .replace(/\bcut-?out letters\b/gi, 'empty reserved title band')
    .replace(/\bcut out letters\b/gi, 'empty reserved title band')
    .replace(/\b(layered\s+)?construction-paper titles\b/gi, 'empty reserved title bands')
    .replace(/\btitles made of\b/gi, 'empty reserved title bands as')
    .replace(/\bmarker print\b/gi, 'empty reserved writing band')
    .replace(/\bcredit line\b/gi, 'empty reserved footer band')
    .replace(/\bletter shapes(?:\s*\([^)]*\))?/gi, 'paper stars')
    .replace(/\bletter blocks\b/gi, 'blank paper tiles')
    .replace(/\bletter circles\b/gi, 'blank paper circles')
    .replace(/\bdotted-line font\b/gi, 'blank practice lines')
    .replace(/\btracing arrows\b/gi, 'blank practice lines')
    .replace(/\btitled\s+[^.,;:]{2,80}/gi, 'with an empty reserved title band')
    .replace(/\b([A-Z])\s*,\s*([A-Z])\s*,\s*([A-Z])\b/g, 'paper shapes')
    .replace(/\s+/g, ' ')
    .trim();
}

function applyEditableMasterPrompt({ prompt, project, job, pageCount } = {}) {
  const raw = String(prompt || '');
  const hasImagePrefix = /^@image\b/i.test(raw.trim());
  const themeId = slugTheme(project?.theme || job?.theme || 'washable-marker');
  const pageType = pageTypeForJob(job, pageCount || project?.jobs?.length || job?.pageNumber);
  const template = loadTemplate(themeId, pageType);
  const zones = describeZones(template);
  const isolated = isolateCurrentPagePrompt(raw.replace(/^@image\s*/i, ''), job?.pageNumber);
  const illustration = neutralizePaintedCopy(stripPageNumberLanguage(stripBakedTextClause(isolated)));
  const next = [
    `CRITICAL OVERRIDE. ${TEXT_FREE_TRIGGER}`,
    'Ignore any later request to paint words, titles, letters, numbers, names, or sticker copy. Those become empty reserved shapes.',
    `${ZERO_TEXT_CONTRACT}: ${zones.join('; ')}.`,
    IDENTICAL_LAYOUT,
    PAGE_NUMBER_BAN,
    IMAGE_ONLY_CONTRACT,
    scrubPrompt(illustration),
  ].filter(Boolean).join(' ');
  const safe = assertPromptIsSafe(next);
  return hasImagePrefix ? `@image ${safe}` : safe;
}

module.exports = {
  MODE_FIXED,
  MODE_EDITABLE,
  TEXT_FREE_TRIGGER,
  ZERO_TEXT_CONTRACT,
  PAGE_NUMBER_BAN,
  IMAGE_ONLY_CONTRACT,
  generationModeKey,
  resolveGenerationMode,
  resolveStoredGenerationMode,
  persistGenerationMode,
  applyEditableMasterPrompt,
  isolateCurrentPagePrompt,
  neutralizePaintedCopy,
  stripPageNumberLanguage,
  stripBakedTextClause,
};
