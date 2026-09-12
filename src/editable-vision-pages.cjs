'use strict';

/**
 * Interior Artwork - local page vision.
 *
 * After the queue has produced the artwork for every page, each page is read locally
 * by MobileSAM (object segmentation) and PaddleOCR (text), and the two are aligned
 * into one layer model: every text run carries the id of the object it sits on, in
 * original page pixels.
 *
 * That model is the whole point of this stage. Coordinates are what let the next
 * stage move an object and carry its text with it, or rewrite one run in place -
 * none of which a description of the page can support.
 *
 * The result is cached per page and keyed by the artwork's own content hash, so a
 * regenerated page is re-read and an untouched one is not.
 */

const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { openSync, readSync, closeSync, readFileSync, statSync } = require('node:fs');
const { VisionBridge } = require('./vision-bridge.cjs');
const { locateJobImage } = require('./editable-page-assets.cjs');
const comfy = require('./comfy-service.cjs');

const visionBridge = new VisionBridge();
const COMPOSE_TIMEOUT_MS = 900_000;

function engineRecoveryState() {
  return {
    recovering: Boolean(comfy.isRecovering?.()),
    message: comfy.isRecovering?.() ? 'Restarting engine' : ''
  };
}

/**
 * Make sure a page image is actually on this disk before anything tries to read it.
 *
 * This project lives under an iCloud-synced folder, so page images are routinely
 * evicted to `compressed,dataless` placeholders. stat() still reports the full size
 * and existsSync() still returns true, but the read comes back empty or throws - which
 * surfaces much later as "cannot identify image file" from a decoder, pointing at the
 * wrong thing entirely. Asking for the file back and waiting is the only reliable fix.
 */
function ensureMaterialized(path, { timeoutMs = 60_000 } = {}) {
  // The only question here is whether bytes come back, not whether they decode. A
  // placeholder yields nothing; anything else is the decoder's problem to report, and
  // treating an unrecognised file as "not yet downloaded" would block for the whole
  // timeout on every file that simply is not a PNG.
  const readable = () => {
    let handle = null;
    try {
      handle = openSync(path, 'r');
      const head = Buffer.alloc(8);
      return readSync(handle, head, 0, 8, 0) > 0;
    } catch {
      return false;
    } finally {
      if (handle !== null) { try { closeSync(handle); } catch { /* already gone */ } }
    }
  };

  if (readable()) return true;
  try {
    // Ask the sync daemon to fetch it. Absent or failing brctl is not fatal: the poll
    // below still gives an ordinary slow read time to complete.
    execFileSync('brctl', ['download', path], { stdio: 'ignore', timeout: 10_000 });
  } catch { /* not an iCloud path, or brctl unavailable */ }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (readable()) return true;
    // Synchronous wait: callers are inside a sequential per-page loop and there is
    // nothing useful to interleave while the file is still arriving.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
  return false;
}

// Page kinds that are finished artwork in their own right. Nothing on them should be
// lifted, erased or turned into a text box.
const FLAT_PAGE_KINDS = new Set(['cover', 'front_cover', 'back_cover', 'front', 'back', 'thank_you']);

/**
 * Whether a page ships as flat artwork rather than being made editable.
 *
 * The cover and the thank-you page are the book's own furniture: their wording is set,
 * a buyer is not meant to retype them, and running them through the pipeline would
 * erase carefully composed titling to redraw it in a substitute face. They still
 * appear in the PPTX, PDF and DOCX - they are just not editable there.
 *
 * Position is what decides: the first page is the cover and the last page is the
 * thank-you page, which is generated as a normal page image like any other. An explicit
 * kind can mark further pages flat, but it can never make the first or last page
 * editable.
 */
function isFlatPage(project, job) {
  const kind = String(job?.kind || '').toLowerCase();
  if (kind && FLAT_PAGE_KINDS.has(kind)) return true;
  // Position always applies, whatever the kind says. The thank-you page is generated
  // like any other page and simply is the last one, so a book whose pages all carry
  // kind "page" must still get its cover and closing page right.
  const numbers = (project?.jobs || []).map((item) => Number(item.pageNumber) || 0);
  if (numbers.length < 2) return false;
  const page = Number(job?.pageNumber) || 0;
  return page === Math.min(...numbers) || page === Math.max(...numbers);
}

/** The vision record a flat page carries: no text, so nothing downstream edits it. */
function flatPageVision(imagePath) {
  return {
    ok: true,
    flat: true,
    text: [],
    layers: [],
    orphanText: [],
    counts: { layers: 0, text: 0, orphans: 0 },
    imagePath,
  };
}

function cacheFallbackVision(store, project, job, imagePath) {
  const vision = flatPageVision(imagePath);
  try {
    store.setSetting(pageVisionKey(project.id, job.id), {
      fingerprint: artworkFingerprint(imagePath, { materialize: true }),
      vision,
    });
  } catch {
    /* fingerprint can fail; the caller still keeps this page in the current run */
  }
  return vision;
}

function pageVisionKey(projectId, jobId) {
  return `editable-page-vision:${projectId}:${jobId}`;
}

function clearPageVision(store, project) {
  const jobs = project?.jobs || [];
  for (const job of jobs) {
    try { store.setSetting(pageVisionKey(project.id, job.id), null); } catch { /* keep going */ }
  }
  return jobs.length;
}

/**
 * Identify the artwork by content, not by path or timestamp. Regenerating a page
 * writes the same filename, so a path-keyed cache would serve a stale layer model
 * whose coordinates no longer match the pixels.
 */
// Fingerprints are cached against the file's own stat. Hashing a 9 MB page costs
// ~10ms, which is nothing once - but this runs for every page on every state
// broadcast, and a broadcast happens on every progress tick.
const fingerprintCache = new Map();

/**
 * Identify the artwork by content.
 *
 * `materialize` is off by default and must stay that way for anything on the render
 * path. Waiting for an evicted iCloud file to come back can take a minute per page,
 * and doing that inside state building froze the whole dashboard - the UI thread sat
 * on a progress tick while five pages were fetched from the network. Only the
 * pipeline, which genuinely needs the bytes, asks for materialisation.
 */
function artworkFingerprint(imagePath, { materialize = false } = {}) {
  if (materialize) ensureMaterialized(imagePath);
  const { size, mtimeMs } = statSync(imagePath);
  const cached = fingerprintCache.get(imagePath);
  if (cached && cached.size === size && cached.mtimeMs === mtimeMs) return cached.hash;
  // Hash the file, but only read it once: these are 8-10 MB PNGs and a book has
  // dozens. Size and mtime are folded in so two identical-looking reads of a file
  // mid-write cannot collide.
  const hash = createHash('sha256');
  hash.update(readFileSync(imagePath));
  hash.update(`${size}:${Math.round(mtimeMs)}`);
  const digest = hash.digest('hex');
  fingerprintCache.set(imagePath, { size, mtimeMs, hash: digest });
  return digest;
}

function readCachedPageVision(store, project, job) {
  const cached = store.getSetting(pageVisionKey(project.id, job.id), null);
  if (!cached?.vision) return null;
  let fingerprint = null;
  try {
    fingerprint = artworkFingerprint(locateJobImage(project, job));
  } catch {
    return null;
  }
  return cached.fingerprint === fingerprint ? cached.vision : null;
}

/**
 * Read every page of a project. Never throws for a page-level problem: a page that
 * cannot be read is reported in `failures` and the rest of the book still completes,
 * because Interior Artwork must not be able to take the pipeline down.
 */
async function runPageVision({ store, projectId, jobIds = null, force = false, maxSide = 1400, signal, onProgress = () => {}, onActivity = () => {} }) {
  const project = store.getProject(projectId);
  if (!project) throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });

  const status = await visionBridge.status();
  if (!status.ok || !status.ready) {
    throw Object.assign(
      new Error(status.error || 'The local vision environment is not installed.'),
      { code: status.code || 'VISION_UNAVAILABLE' }
    );
  }

  // A single-page re-read is the same code path as a whole book, narrowed. Keeping one
  // path means the per-page button cannot drift from what the stage does.
  const wanted = jobIds ? new Set(jobIds) : null;
  const jobs = [...(project.jobs || [])]
    .filter((job) => !wanted || wanted.has(job.id))
    .sort((a, b) => a.pageNumber - b.pageNumber);
  const results = [];
  const failures = [];
  let done = 0;

  for (const job of jobs) {
    if (signal?.aborted) throw Object.assign(new Error('Cancelled.'), { code: 'CANCELLED' });

    onActivity({ jobId: job.id, pageNumber: job.pageNumber, phase: 'reading', state: 'start' });
    if (!force) {
      const cached = readCachedPageVision(store, project, job);
      if (cached) {
        results.push({ job, vision: cached, cached: true });
        onActivity({ jobId: job.id, pageNumber: job.pageNumber, phase: 'reading', state: 'done', cached: true });
        onProgress(Math.round((++done / jobs.length) * 100));
        continue;
      }
    }

    // A flat page is recorded as read with no text at all. Every compiler downstream
    // then does the right thing without a special case: no runs means nothing to erase
    // and no text boxes to place, so the artwork ships exactly as drawn.
    if (isFlatPage(project, job)) {
      let flatPath = null;
      try { flatPath = locateJobImage(project, job); } catch { flatPath = null; }
      if (flatPath) {
        store.setSetting(pageVisionKey(project.id, job.id), {
          fingerprint: artworkFingerprint(flatPath, { materialize: true }),
          vision: flatPageVision(flatPath),
        });
        results.push({ job, vision: flatPageVision(flatPath), cached: false, flat: true });
        onActivity({ jobId: job.id, pageNumber: job.pageNumber, phase: 'reading', state: 'done', cached: false });
        onProgress(Math.round((++done / jobs.length) * 100));
        continue;
      }
    }

    let imagePath;
    try {
      imagePath = locateJobImage(project, job);
    } catch (error) {
      failures.push({ pageNumber: job.pageNumber, code: error.code, error: error.message });
      onActivity({ jobId: job.id, pageNumber: job.pageNumber, phase: 'reading', state: 'done', cached: true });
      onProgress(Math.round((++done / jobs.length) * 100));
      continue;
    }

    if (!ensureMaterialized(imagePath)) {
      failures.push({
        pageNumber: job.pageNumber,
        code: 'ARTWORK_NOT_MATERIALIZED',
        error: `${imagePath} is still a cloud placeholder. Keep it downloaded, or move the project off iCloud Drive.`
      });
      onActivity({ jobId: job.id, pageNumber: job.pageNumber, phase: 'reading', state: 'done', cached: true });
      onProgress(Math.round((++done / jobs.length) * 100));
      continue;
    }
    let vision;
    try {
      vision = await visionBridge.analyzePage(imagePath, { maxSide, prompt: [job.prompt, job.imagePrompt, job.storyText].filter(Boolean).join('\n') });
    } catch (error) {
      const fallback = cacheFallbackVision(store, project, job, imagePath);
      results.push({ job, vision: fallback, cached: false, fallback: true });
      failures.push({ pageNumber: job.pageNumber, code: error.code || 'VISION_FAILED', error: error.message });
      onActivity({ jobId: job.id, pageNumber: job.pageNumber, phase: 'reading', state: 'done', cached: true });
      onProgress(Math.round((++done / jobs.length) * 100));
      continue;
    }
    if (!vision?.ok) {
      const fallback = cacheFallbackVision(store, project, job, imagePath);
      results.push({ job, vision: fallback, cached: false, fallback: true });
      failures.push({ pageNumber: job.pageNumber, code: vision?.code || 'VISION_FAILED', error: vision?.error || 'Vision failed.' });
      onActivity({ jobId: job.id, pageNumber: job.pageNumber, phase: 'reading', state: 'done', cached: true });
      onProgress(Math.round((++done / jobs.length) * 100));
      continue;
    }

    store.setSetting(pageVisionKey(project.id, job.id), {
      fingerprint: artworkFingerprint(imagePath, { materialize: true }),
      vision,
    });
    results.push({ job, vision, cached: false });
    onActivity({ jobId: job.id, pageNumber: job.pageNumber, phase: 'reading', state: 'done', cached: false });
    onProgress(Math.round((++done / jobs.length) * 100));
  }

  return {
    pages: results.length,
    analysed: results.filter((entry) => !entry.cached).length,
    reused: results.filter((entry) => entry.cached).length,
    failures,
    totals: results.reduce(
      (sum, entry) => ({
        layers: sum.layers + (entry.vision.counts?.layers || 0),
        text: sum.text + (entry.vision.counts?.text || 0),
        orphans: sum.orphans + (entry.vision.counts?.orphans || 0),
      }),
      { layers: 0, text: 0, orphans: 0 }
    ),
  };
}

/** Every page that has a usable layer model, in page order. */
function collectPageVision(store, project) {
  return [...(project.jobs || [])]
    .sort((a, b) => a.pageNumber - b.pageNumber)
    .map((job) => {
      const vision = readCachedPageVision(store, project, job);
      if (!vision) return null;
      let imagePath = null;
      try {
        imagePath = locateJobImage(project, job);
      } catch {
        return null;
      }
      return { job, imagePath, vision };
    })
    .filter(Boolean);
}

module.exports = {
  ensureMaterialized,
  isFlatPage,
  flatPageVision,
  runPageVision,
  collectPageVision,
  clearPageVision,
  readCachedPageVision,
  pageVisionKey,
  artworkFingerprint,
  visionBridge,
  engineRecoveryState,
  COMPOSE_TIMEOUT_MS,
};
