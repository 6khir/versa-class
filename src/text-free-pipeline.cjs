'use strict';

const { resolveStoredGenerationMode } = require('./editable-mode.cjs');
const { loadTemplate, pageTypeForJob, slugTheme } = require('./layout-templates.cjs');
const { buildManifest, copyFromJob, manifestKey } = require('./editable-manifest.cjs');
const { locateJobImage } = require('./editable-page-assets.cjs');

function isTextFreeProject(store, project) {
  return resolveStoredGenerationMode(store, project) === 'editable';
}

function readStoredManifest(store, project, job) {
  const stored = store.getSetting?.(manifestKey(project.id, job.id), null);
  return stored?.zones?.length ? stored : null;
}

/**
 * Build (or reuse) a manifest for every page. Never OCR-erases.
 * Reuses a stored manifest from the queue validator. Builds one from the
 * page prompt when the store does not have it yet.
 */
function prepareTextFreeManifests({ store, project }) {
  const jobs = [...(project.jobs || [])].sort((a, b) => a.pageNumber - b.pageNumber);
  if (!jobs.length) {
    throw Object.assign(new Error('This book has no pages yet.'), { code: 'NO_PAGES' });
  }
  const pages = [];
  for (const job of jobs) {
    const imagePath = locateJobImage(project, job);
    const stored = readStoredManifest(store, project, job);
    if (stored) {
      pages.push({
        jobId: job.id,
        pageNumber: job.pageNumber,
        imagePath,
        manifest: stored,
        reused: true,
        zones: stored.zones.length,
      });
      continue;
    }
    const template = loadTemplate(slugTheme(project.theme), pageTypeForJob(job, jobs.length));
    const manifest = buildManifest({
      pageId: `${project.id}_${job.id}`,
      themeId: slugTheme(project.theme),
      template,
      copyByZone: copyFromJob(job, template) || {},
    });
    store.setSetting(manifestKey(project.id, job.id), manifest);
    pages.push({
      jobId: job.id,
      pageNumber: job.pageNumber,
      imagePath,
      manifest,
      reused: false,
      zones: manifest.zones.length,
    });
  }
  return {
    ok: true,
    pages: pages.length,
    zones: pages.reduce((sum, page) => sum + page.zones, 0),
    detail: pages,
  };
}

module.exports = {
  isTextFreeProject,
  readStoredManifest,
  prepareTextFreeManifests,
};
