'use strict';

const { existsSync, mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { locateJobImage } = require('./editable-page-assets.cjs');
const { sharedRebuildWorker } = require('./rebuild-worker-bridge.cjs');
const { evaluatePreflight, attachIdentity } = require('./rebuild-preflight.cjs');
const { validateRebuildDeck } = require('./rebuild-validate.cjs');
const {
  ERROR_CODES,
  ensureRebuildPlan,
  failPage,
  isRebuildPipelineEnabled,
  listRebuildPages,
  makePageId,
  persistRebuildPipeline,
  readRebuildPage,
  recordToLegacyManifest,
  setPageState,
  syncLegacyManifest,
  writeRebuildPage,
} = require('./rebuild-page-record.cjs');

const MAX_REMOTE_IN_FLIGHT = 2;
const LOCAL_WORKERS = 1;

function now() {
  return Date.now();
}

function markTiming(record, key, started) {
  return {
    ...record,
    timings: { ...(record.timings || {}), [key]: now() - started },
  };
}

function percentile(values, p) {
  const sorted = [...values].filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function summarizeTimings(records) {
  const keys = ['preflight', 'cleanup', 'stamp', 'validate'];
  const summary = {};
  for (const key of keys) {
    const values = records.map((record) => Number(record.timings?.[key])).filter((value) => Number.isFinite(value));
    summary[key] = {
      p50: percentile(values, 50),
      p95: percentile(values, 95),
      count: values.length,
    };
  }
  return summary;
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Math.max(1, Math.min(limit, items.length || 1));
  await Promise.all(Array.from({ length: workers }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  }));
  return results;
}

function debugDir(project) {
  const { projectWorkspaceDir } = require('./project-workspace.cjs');
  const workspace = projectWorkspaceDir(project?.id);
  return join(workspace || project.outputDir || process.cwd(), '.rebuild-debug');
}

function writeFailureDiagnostics(project, record, extra = {}) {
  if (!project?.outputDir) return null;
  const dir = debugDir(project);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${record.sequenceIndex}-${record.pageId.replace(/[^\w.-]+/g, '_')}.json`);
  writeFileSync(path, JSON.stringify({ ...record, extra }, null, 2));
  return path;
}

function attachGeneratedPage(store, project, job, imagePath) {
  if (!isRebuildPipelineEnabled(store, project)) return null;
  ensureRebuildPlan(store, project);
  const pageId = makePageId(project.id, job.id);
  let record = readRebuildPage(store, project.id, pageId);
  if (!record) return null;
  record = setPageState({
    ...record,
    generatedAssetPath: imagePath,
    generationAttempt: Number(record.generationAttempt || 0) + (record.state === 'GENERATING' ? 0 : 0),
  }, record.state === 'PLANNED' || record.state === 'GENERATING' ? 'PREFLIGHT' : record.state);
  return writeRebuildPage(store, record);
}

async function processLocalPage({
  store,
  project,
  job,
  record,
  worker = sharedRebuildWorker,
  signal,
  debug = false,
  regenerate,
} = {}) {
  if (signal?.aborted) {
    throw Object.assign(new Error('Rebuild cancelled.'), { code: ERROR_CODES.CANCELLED });
  }
  const imagePath = record.generatedAssetPath || locateJobImage(project, job);
  if (!imagePath || !existsSync(imagePath)) {
    const failed = failPage(record, ERROR_CODES.MISSING_ASSET, 'Generated page image is missing.');
    writeRebuildPage(store, failed);
    return failed;
  }

  let current = setPageState({ ...record, generatedAssetPath: imagePath }, 'PREFLIGHT');
  writeRebuildPage(store, current);

  const preflightStarted = now();
  let ocr = await worker.ocr(imagePath, 'fast');
  let detections = ocr.detections || [];
  let bands = [];
  if (detections.length) {
    const inspected = await worker.inspectBands(imagePath, detections.map((item) => item.box).filter(Boolean));
    bands = inspected.bands || [];
  }
  let verdict = evaluatePreflight(current, { detections, bands, accurate: false });
  if (verdict.code === ERROR_CODES.AMBIGUOUS_OCR) {
    ocr = await worker.ocr(imagePath, 'accurate');
    detections = ocr.detections || [];
    const inspected = await worker.inspectBands(imagePath, detections.map((item) => item.box).filter(Boolean));
    bands = inspected.bands || [];
    verdict = evaluatePreflight(current, { detections, bands, accurate: true });
  }
  current = markTiming(current, 'preflight', preflightStarted);

  if (!verdict.ok) {
    current = failPage(current, verdict.code, verdict.message || verdict.code, { details: verdict.details });
    writeFailureDiagnostics(project, current, verdict);
    writeRebuildPage(store, current);
    if (verdict.retry === 'regenerate' && typeof regenerate === 'function') {
      await regenerate(job, current);
    }
    return current;
  }

  current = setPageState(attachIdentity(current, {
    detections,
    matches: verdict.matches,
    bands,
  }), 'IDENTITY_SAVED');
  writeRebuildPage(store, current);

  const cleanupStarted = now();
  const { resolvePageSaveDir } = require('./project-workspace.cjs');
  const cleanedPath = join(resolvePageSaveDir(project) || project.outputDir, `rebuild-clean-${String(current.sequenceIndex).padStart(3, '0')}.png`);
  const boxes = (current.blocks || []).map((block) => block.box).filter((box) => Array.isArray(box) && box.length === 4);
  let cleaned = await worker.cleanup(imagePath, cleanedPath, boxes, { expandPx: 2, detections });
  if (!cleaned.ok) {
    cleaned = await worker.cleanup(imagePath, cleanedPath, boxes, { expandPx: 3, detections });
  }
  current = markTiming({ ...current, cleanedAssetPath: cleanedPath }, 'cleanup', cleanupStarted);
  if (!cleaned.ok) {
    current = failPage(current, ERROR_CODES.CLEANUP_RESIDUAL, 'Cleanup left glyph residuals.', {
      details: cleaned.watchdog,
    });
    writeFailureDiagnostics(project, current, cleaned);
    writeRebuildPage(store, current);
    return current;
  }
  current = setPageState(current, 'CLEANED');
  writeRebuildPage(store, current);
  if (!debug) {
    /* successful pages keep only the cleaned PNG */
  }
  return current;
}

async function stampAndValidate({ store, project, records, worker = sharedRebuildWorker, outputPath }) {
  const ordered = [...records].sort((a, b) => a.sequenceIndex - b.sequenceIndex);
  const stampStarted = now();
  const pages = ordered.map((record) => {
    const job = (project.jobs || []).find((item) => item.id === record.jobId);
    if (job) syncLegacyManifest(store, project, job, record);
    return {
      imagePath: record.cleanedAssetPath || record.generatedAssetPath,
      manifest: recordToLegacyManifest(record),
      pageLabel: `Slide ${record.sequenceIndex}`,
    };
  });
  const target = outputPath || join(project.outputDir, `${project.slug || 'book'}-editable.pptx`);
  const composed = await worker.composePptx({
    outputPath: target,
    sourceDpi: 300,
    mode: 'rebuild',
    pages,
  });
  if (!composed?.ok) {
    throw Object.assign(new Error(composed?.error || 'Rebuild PPTX compose failed.'), {
      code: composed?.code || 'PPTX_COMPOSE_FAILED',
    });
  }
  const stamped = ordered.map((record) => markTiming(setPageState(record, 'STAMPED'), 'stamp', stampStarted));
  stamped.forEach((record) => writeRebuildPage(store, record));

  const validateStarted = now();
  const validated = validateRebuildDeck({ outputPath: target, records: stamped });
  const next = stamped.map((record) => {
    const updated = markTiming(setPageState(record, validated.ok ? 'VALIDATED' : record.state), 'validate', validateStarted);
    if (!validated.ok) {
      return failPage(updated, 'PPTX_VALIDATION_FAILED', validated.issues.join(' '), { details: validated });
    }
    return setPageState(updated, 'COMPLETE');
  });
  next.forEach((record) => writeRebuildPage(store, record));
  if (!validated.ok) {
    throw Object.assign(new Error(validated.issues[0] || 'Rebuild deck validation failed.'), {
      code: 'PPTX_VALIDATION_FAILED',
      details: validated,
    });
  }
  return { outputPath: target, records: next, composed, validation: validated };
}

async function runRebuildLocalPass({
  store,
  projectId,
  onProgress = () => {},
  signal,
  worker = sharedRebuildWorker,
  regenerate,
  debug = false,
} = {}) {
  const project = store.getProject(projectId);
  if (!project) throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });
  const planned = ensureRebuildPlan(store, project);
  const jobs = [...(project.jobs || [])].sort((a, b) => a.pageNumber - b.pageNumber);
  const work = [];
  for (const record of planned) {
    if (['COMPLETE', 'VALIDATED', 'STAMPED', 'CLEANED'].includes(record.state)) continue;
    const job = jobs.find((item) => item.id === record.jobId);
    if (!job) continue;
    work.push({ record, job });
  }
  const processed = [];
  for (let index = 0; index < work.length; index += 1) {
    if (signal?.aborted) {
      throw Object.assign(new Error('Rebuild cancelled.'), { code: ERROR_CODES.CANCELLED });
    }
    const item = work[index];
    const result = await processLocalPage({
      store,
      project,
      job: item.job,
      record: readRebuildPage(store, project.id, item.record.pageId) || item.record,
      worker,
      signal,
      debug,
      regenerate,
    });
    processed.push(result);
    onProgress(Math.round(((index + 1) / Math.max(1, work.length)) * 70));
  }
  const ready = listRebuildPages(store, project).filter((record) => ['CLEANED', 'STAMPED', 'VALIDATED', 'COMPLETE'].includes(record.state));
  const failed = listRebuildPages(store, project).filter((record) => record.state === 'FAILED');
  if (failed.length) {
    throw Object.assign(new Error(`${failed.length} rebuild page(s) failed: ${failed.map((item) => item.error?.code).join(', ')}`), {
      code: failed[0].error?.code || 'REBUILD_PAGE_FAILED',
      details: failed.map((item) => item.error),
    });
  }
  const assembled = await stampAndValidate({
    store,
    project,
    records: ready,
    worker,
  });
  onProgress(100);
  return {
    ok: true,
    pages: assembled.records.length,
    outputPath: assembled.outputPath,
    timings: summarizeTimings(assembled.records),
    remoteInFlight: MAX_REMOTE_IN_FLIGHT,
    localWorkers: LOCAL_WORKERS,
  };
}

async function runBoundedRemote(items, generatePage, { limit = MAX_REMOTE_IN_FLIGHT } = {}) {
  const completed = [];
  await mapLimit(items, limit, async (item) => {
    const result = await generatePage(item);
    completed.push({ pageId: item.pageId || item.id, sequenceIndex: item.sequenceIndex || item.pageNumber, result });
  });
  return completed.sort((a, b) => a.sequenceIndex - b.sequenceIndex);
}

module.exports = {
  MAX_REMOTE_IN_FLIGHT,
  LOCAL_WORKERS,
  attachGeneratedPage,
  processLocalPage,
  runRebuildLocalPass,
  stampAndValidate,
  runBoundedRemote,
  summarizeTimings,
  isRebuildPipelineEnabled,
  persistRebuildPipeline,
  ensureRebuildPlan,
};
