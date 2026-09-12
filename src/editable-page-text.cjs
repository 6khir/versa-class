'use strict';

/**
 * Stage 2 — Interior Text.
 *
 * Reads each finished artwork page and asks Gemini to write the educational text
 * that belongs in its blank frames. The result is cached per page and fingerprinted
 * against the job's own content, so Stage 3 assembly stays entirely local.
 */

const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { buildPageTextPrompt } = require('./editable-prompts.cjs');
const { parseJsonResponse } = require('./editable-generation-adapters.cjs');
const { locateJobImage, pageTextKey } = require('./editable-page-assets.cjs');
const { sanitize, condense } = require('./editable-layout-engine.cjs');
const { VisionBridge, visionResultToPageText } = require('./vision-bridge.cjs');

// One worker for the whole app: models load once, then each page is cheap.
const visionBridge = new VisionBridge();

const MAX_SECTIONS = 12;

function fail(message, code) {
  throw Object.assign(new Error(message), { code });
}

/** Content that decides whether cached text is still valid for this page. */
function jobFingerprint(project, job) {
  return createHash('sha256')
    .update(JSON.stringify([project.name, project.theme, job.id, job.pageNumber, job.title, job.prompt, job.imagePrompt, job.storyText]))
    .digest('hex');
}

function normalizePageText(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('Page text must be a JSON object.', 'EDITABLE_PAGE_TEXT_INVALID');
  const sections = (Array.isArray(raw.sections) ? raw.sections : [])
    .map((item) => condense(typeof item === 'string' ? item : item?.text, 300))
    .filter(Boolean)
    .slice(0, MAX_SECTIONS);
  const payload = {
    title: condense(raw.title, 120),
    instruction: condense(raw.instruction, 300),
    sections,
    footer: sanitize(raw.footer)
  };
  if (!payload.title && !payload.instruction && !payload.sections.length) {
    fail('Page text contained no usable content.', 'EDITABLE_PAGE_TEXT_EMPTY');
  }
  return payload;
}

function readCachedPageText(store, project, job) {
  const cached = store.getSetting(pageTextKey(project.id, job.id), null);
  if (!cached || cached.fingerprint !== jobFingerprint(project, job)) return null;
  try {
    return normalizePageText(cached.text);
  } catch {
    return null;
  }
}

/**
 * Generate and cache the page text for every page that does not already have it.
 */
async function generateEditablePageText({ store, projectId, provider, signal, jobIds = null, onProgress = () => {}, onActivity = () => {}, force = false, useVision = false }) {
  const check = () => { if (signal?.aborted) throw Object.assign(new Error('Page text generation cancelled.'), { code: 'STEP_ABORTED' }); };
  check();
  const project = store.getProject(projectId);
  if (!project) fail('Project not found.', 'PROJECT_NOT_FOUND');
  if (project.productFormat !== 'editable') fail('Page text is only written for editable products.', 'EDITABLE_ENGINE_REQUIRED');
  if (!useVision && typeof provider?.generatePageText !== 'function') fail('A vision-capable provider is required.', 'EDITABLE_TEXT_PROVIDER_MISSING');

  const requested = jobIds ? new Set(jobIds) : null;
  const jobs = [...project.jobs]
    .sort((a, b) => a.pageNumber - b.pageNumber)
    .filter((job) => !requested || requested.has(job.id));
  if (!jobs.length) fail('No pages to write text for.', 'EDITABLE_PAGE_SEQUENCE_INVALID');

  const written = [];
  for (const [index, job] of jobs.entries()) {
    check();
    if (!force && readCachedPageText(store, project, job)) {
      onActivity({ jobId: job.id, phase: 'complete', cached: true });
      onProgress(Math.round(((index + 1) / jobs.length) * 100));
      continue;
    }
    onActivity({ jobId: job.id, phase: 'preparing' });
    const imagePath = locateJobImage(project, job);

    // Local vision first: MobileSAM + PaddleOCR read the page on this machine, so a
    // page that already carries text needs no network turn at all. Any failure falls
    // through to the gem rather than stopping the run.
    if (useVision) {
      const vision = await visionBridge.analyzePage(imagePath);
      const fromVision = vision?.ok ? visionResultToPageText(vision) : null;
      if (fromVision) {
        const text = normalizePageText(fromVision);
        store.setSetting(pageTextKey(project.id, job.id), {
          fingerprint: jobFingerprint(project, job), text, source: "vision",
          layers: vision.counts?.layers ?? 0, orphans: vision.counts?.orphans ?? 0
        });
        written.push({ jobId: job.id, pageNumber: job.pageNumber, text, source: "vision" });
        onActivity({ jobId: job.id, phase: "complete", source: "vision" });
        onProgress(Math.round(((index + 1) / jobs.length) * 100));
        continue;
      }
    }
    const artwork = readFileSync(imagePath);
    const topic = [job.title, job.prompt || job.imagePrompt].filter(Boolean).join(' - ');
    const pageProvider = provider.forJob ? provider.forJob(job.id) : provider;
    const answer = await pageProvider.generatePageText(artwork, buildPageTextPrompt({ topic, pageNumber: job.pageNumber }));
    check();
    const text = normalizePageText(parseJsonResponse(answer));
    store.setSetting(pageTextKey(project.id, job.id), { fingerprint: jobFingerprint(project, job), text });
    written.push({ jobId: job.id, pageNumber: job.pageNumber, text });
    onActivity({ jobId: job.id, phase: 'complete' });
    onProgress(Math.round(((index + 1) / jobs.length) * 100));
  }
  return { pages: written, total: jobs.length };
}

module.exports = { generateEditablePageText, readCachedPageText, normalizePageText, jobFingerprint, visionBridge };
