'use strict';

const { existsSync } = require('node:fs');
const { join, sep } = require('node:path');

/** The queue engine's own page image, reused as the slide background. */
function locateJobImage(project, job) {
  const isEditableArtifact = (path) => path.split(sep).includes('editable');
  const { pageWorkspaceDir } = require('./project-workspace.cjs');
  const workspacePage = pageWorkspaceDir(project?.id);
  const named = job?.fileName || (job?.outputPath ? require('node:path').basename(job.outputPath) : '');
  const candidates = [
    job?.outputPath,
    workspacePage && named ? join(workspacePage, named) : null,
    workspacePage ? join(workspacePage, `${job.id}.png`) : null,
    join(project.outputDir, 'jobs', `${job.id}.png`),
  ];
  for (const candidate of candidates) {
    if (candidate && !isEditableArtifact(candidate) && existsSync(candidate)) return candidate;
  }
  throw Object.assign(new Error(`Page ${job.pageNumber} has no generated image yet. Generate the pages first.`),
    { code: 'EDITABLE_PAGE_IMAGE_MISSING', pageNumber: job.pageNumber });
}

/** Where Stage 2 caches the text it wrote for one page. */
function pageTextKey(projectId, jobId) {
  return `editable-page-text:${projectId}:${jobId}`;
}

module.exports = { locateJobImage, pageTextKey };
