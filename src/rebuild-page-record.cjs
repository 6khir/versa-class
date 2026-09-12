'use strict';

const { extractCanonicalLines, manifestKey } = require('./editable-manifest.cjs');
const { resolveRebuildPageRole, PAGE_ROLE } = require('./text-rebuild-source.cjs');
const { loadTemplate, pageTypeForJob, slugTheme } = require('./layout-templates.cjs');

const PAGE_STATES = Object.freeze([
  'PLANNED',
  'GENERATING',
  'PREFLIGHT',
  'IDENTITY_SAVED',
  'CLEANED',
  'STAMPED',
  'VALIDATED',
  'COMPLETE',
  'FAILED',
]);

const BLOCK_ROLES = Object.freeze(['title', 'instruction', 'body', 'footer']);

const ERROR_CODES = Object.freeze({
  WRONG_ROLE: 'WRONG_ROLE',
  WRONG_COPY: 'WRONG_COPY',
  EXTRA_TEXT: 'EXTRA_TEXT',
  VISIBLE_FOLIO: 'VISIBLE_FOLIO',
  AMBIGUOUS_OCR: 'AMBIGUOUS_OCR',
  NONFLAT_BAND: 'NONFLAT_BAND',
  CLEANUP_RESIDUAL: 'CLEANUP_RESIDUAL',
  PPTX_OVERFLOW: 'PPTX_OVERFLOW',
  MISSING_ASSET: 'MISSING_ASSET',
  CANCELLED: 'CANCELLED',
});

const TYPOGRAPHY = Object.freeze({
  family: 'Arial',
  title: { sizePt: 36, minPt: 18, weight: 'semibold' },
  instruction: { sizePt: 18, minPt: 12, weight: 'regular' },
  body: { sizePt: 16, minPt: 11, weight: 'regular' },
  footer: { sizePt: 12, minPt: 10, weight: 'regular' },
  inkHex: '#2B2B2B',
});

function rebuildPageKey(projectId, pageId) {
  return `rebuild-page:${projectId}:${pageId}`;
}

function rebuildBookKey(projectId) {
  return `rebuild-book:${projectId}`;
}

function rebuildPipelineKey(projectId) {
  return `rebuildPipeline:${projectId}`;
}

function isRebuildPipelineEnabled(store, project) {
  const { resolveStoredGenerationMode } = require('./editable-mode.cjs');
  if (resolveStoredGenerationMode(store, project) === 'editable') return false;
  const projectFlag = store?.getSetting?.(rebuildPipelineKey(project?.id), null);
  if (projectFlag === true) return true;
  if (projectFlag === false) return false;
  return store?.getSetting?.('rebuildPipeline', false) === true;
}

function persistRebuildPipeline(store, projectId, enabled) {
  store.setSetting(rebuildPipelineKey(projectId), Boolean(enabled));
  return Boolean(enabled);
}

function makePageId(projectId, jobId) {
  return `${projectId}:${jobId}`;
}

function assignCopyRoles(lines) {
  const copy = { title: '', instruction: '', body: '', footer: '' };
  const items = (lines || []).map((line) => String(line || '').trim()).filter(Boolean);
  if (!items.length) return copy;
  copy.title = items[0];
  let rest = items.slice(1);
  const footerish = /^(name\s*:|date\s*:|©|created by|versa class)/i;
  if (rest.length && footerish.test(rest[rest.length - 1])) {
    copy.footer = rest.pop();
  }
  if (rest[0]) copy.instruction = rest.shift();
  if (rest.length) copy.body = rest.join('\n');
  return copy;
}

function plannedCopyFromJob(job) {
  const lines = extractCanonicalLines([job?.prompt, job?.imagePrompt, job?.storyText].filter(Boolean).join('\n'));
  const copy = assignCopyRoles(lines);
  if (!copy.title && job?.title && !/^prompt\s+\d+/i.test(job.title)) {
    copy.title = String(job.title).replace(/^Activity\s+\d+:\s*/i, '').trim();
  }
  return Object.freeze({
    title: copy.title,
    instruction: copy.instruction,
    body: copy.body,
    footer: copy.footer,
  });
}

function blocksFromCopy(copy) {
  return BLOCK_ROLES
    .filter((role) => String(copy?.[role] || '').trim())
    .map((role) => ({
      role,
      text: String(copy[role]).trim(),
      box: null,
      confidence: null,
      bandColor: null,
      inkColor: null,
    }));
}

function createPlannedPage({ project, job, sequenceTotal } = {}) {
  const sequenceIndex = Math.max(1, Number(job?.pageNumber) || 1);
  const total = Math.max(1, Number(sequenceTotal) || sequenceIndex);
  const pageId = makePageId(project.id, job.id);
  const themeId = slugTheme(project?.theme || job?.theme || 'washable-marker');
  const pageType = pageTypeForJob(job, total);
  const templateId = `${themeId}__${pageType}`;
  const plannedCopy = plannedCopyFromJob(job);
  const pageRole = resolveRebuildPageRole({ job, pageNumber: sequenceIndex, pageCount: total });
  return {
    schemaVersion: 1,
    pageId,
    jobId: job.id,
    sequenceIndex,
    sequenceTotal: total,
    pageRole,
    templateId,
    themeId,
    plannedCopy,
    blocks: blocksFromCopy(plannedCopy),
    generationPrompt: String(job?.imagePrompt || job?.prompt || ''),
    generationAttempt: 0,
    generatedAssetPath: null,
    cleanedAssetPath: null,
    detected: [],
    bandColor: null,
    inkColor: null,
    pptxStyle: { ...TYPOGRAPHY },
    validation: { state: 'pending', issues: [] },
    timings: {},
    history: [],
    state: 'PLANNED',
    error: null,
  };
}

function assertTransition(from, to) {
  if (to === 'FAILED') return true;
  if (from === to) return true;
  if (from === 'FAILED' && ['PLANNED', 'GENERATING', 'PREFLIGHT'].includes(to)) return true;
  if (to === 'GENERATING') return true;
  const order = PAGE_STATES.filter((state) => state !== 'FAILED');
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  if (a < 0 || b < 0) {
    throw Object.assign(new Error(`Unknown rebuild state ${from} → ${to}.`), { code: 'REBUILD_STATE_INVALID' });
  }
  if (b < a && !(from === 'FAILED')) {
    throw Object.assign(new Error(`Cannot move rebuild page from ${from} to ${to}.`), { code: 'REBUILD_STATE_INVALID' });
  }
  return true;
}

function setPageState(record, state, extra = {}) {
  assertTransition(record.state, state);
  const next = {
    ...record,
    ...extra,
    state,
    error: state === 'FAILED' ? (extra.error || record.error) : (state === 'PLANNED' ? extra.error || null : extra.error ?? null),
  };
  next.history = [
    ...(record.history || []),
    {
      at: Date.now(),
      from: record.state,
      to: state,
      code: extra.error?.code || extra.retryReason || null,
    },
  ].slice(-24);
  return next;
}

function failPage(record, code, message, extra = {}) {
  return setPageState(record, 'FAILED', {
    error: {
      code,
      message,
      retry: extra.retry || retryForCode(code),
      details: extra.details || null,
    },
    ...extra.fields,
  });
}

function retryForCode(code) {
  if (['WRONG_ROLE', 'WRONG_COPY', 'EXTRA_TEXT', 'VISIBLE_FOLIO', 'NONFLAT_BAND'].includes(code)) {
    return 'regenerate';
  }
  if (code === 'AMBIGUOUS_OCR') return 'accurate_ocr';
  if (code === 'CLEANUP_RESIDUAL') return 'expand_mask';
  if (code === 'PPTX_OVERFLOW') return 'fit_layout';
  return 'stop';
}

function readRebuildPage(store, projectId, pageId) {
  return store.getSetting(rebuildPageKey(projectId, pageId), null);
}

function writeRebuildPage(store, record) {
  store.setSetting(rebuildPageKey(record.pageId.split(':')[0], record.pageId), record);
  return record;
}

function listRebuildPages(store, project) {
  const jobs = [...(project?.jobs || [])].sort((a, b) => (a.pageNumber || 0) - (b.pageNumber || 0));
  return jobs
    .map((job) => readRebuildPage(store, project.id, makePageId(project.id, job.id)))
    .filter(Boolean);
}

function ensureRebuildPlan(store, project) {
  const jobs = [...(project?.jobs || [])].sort((a, b) => (a.pageNumber || 0) - (b.pageNumber || 0));
  const total = jobs.length;
  const pages = [];
  for (const job of jobs) {
    const pageId = makePageId(project.id, job.id);
    const existing = readRebuildPage(store, project.id, pageId);
    if (existing?.plannedCopy) {
      pages.push(existing);
      continue;
    }
    const record = createPlannedPage({ project, job, sequenceTotal: total });
    writeRebuildPage(store, record);
    pages.push(record);
  }
  store.setSetting(rebuildBookKey(project.id), {
    projectId: project.id,
    pageCount: pages.length,
    updatedAt: Date.now(),
  });
  return pages;
}

function zoneForRole(template, role) {
  return (template.zones || []).find((item) => {
    if (role === 'title') return item.id === 'title' || item.role === 'heading';
    if (role === 'instruction') return item.id === 'instruction';
    if (role === 'footer') return item.id === 'footer' || item.role === 'caption';
    return item.id === 'body' || item.role === 'activity';
  }) || null;
}

function recordToLegacyManifest(record) {
  const themeId = record.themeId || 'washable-marker';
  const pageType = record.pageRole === PAGE_ROLE.COVER ? 'cover'
    : record.pageRole === PAGE_ROLE.BACK ? 'back'
      : 'interior';
  const template = loadTemplate(themeId, pageType);
  const zones = (record.blocks || []).map((block) => {
    const templateZone = zoneForRole(template, block.role);
    const style = TYPOGRAPHY[block.role] || TYPOGRAPHY.body;
    const text = record.plannedCopy?.[block.role] || block.text;
    return {
      zone_id: templateZone?.id || block.role,
      bbox_px: block.box || templateZone?.bbox || [80, 80, 2400, 400],
      text,
      font_family_hint: TYPOGRAPHY.family,
      font_size_pt: style.sizePt,
      min_font_size_pt: style.minPt,
      color_hex: record.inkColor ? rgbToHex(record.inkColor) : TYPOGRAPHY.inkHex,
      align: templateZone?.align || (block.role === 'title' ? 'center' : 'left'),
      rotation_deg: 0,
      role: block.role,
      inset_px: 12,
      strict_fit: true,
    };
  }).filter((zone) => zone.text);
  return {
    page_id: record.pageId,
    theme_id: themeId,
    canvas: template.canvas,
    fromDefault: Boolean(template.fromDefault),
    zones,
  };
}

function rgbToHex(rgb) {
  const values = Array.isArray(rgb) ? rgb : [43, 43, 43];
  return `#${values.map((value) => Number(value).toString(16).padStart(2, '0')).join('')}`.slice(0, 7);
}

function syncLegacyManifest(store, project, job, record) {
  store.setSetting(manifestKey(project.id, job.id), recordToLegacyManifest(record));
}

module.exports = {
  PAGE_STATES,
  BLOCK_ROLES,
  ERROR_CODES,
  TYPOGRAPHY,
  PAGE_ROLE,
  rebuildPageKey,
  rebuildBookKey,
  rebuildPipelineKey,
  isRebuildPipelineEnabled,
  persistRebuildPipeline,
  makePageId,
  assignCopyRoles,
  plannedCopyFromJob,
  createPlannedPage,
  setPageState,
  failPage,
  retryForCode,
  readRebuildPage,
  writeRebuildPage,
  listRebuildPages,
  ensureRebuildPlan,
  recordToLegacyManifest,
  syncLegacyManifest,
};
