'use strict';

/**
 * Editable PowerPoint export.
 *
 * The primary editable deliverable for the TPT market. A .pptx opens in PowerPoint,
 * Keynote and Google Slides with every text run as a real, draggable, retypeable text
 * box over the cleaned artwork. The layered PDF remains the secondary format: its
 * layers are correct, but a buyer needs Acrobat Pro before they can move or retype
 * anything in it, and most teachers do not have that.
 *
 * Both formats are compiled from the same analysed pages, so the text a buyer edits in
 * the deck is the text the PDF carries.
 */

const { existsSync, statSync } = require('node:fs');
const { join } = require('node:path');
const { visionBridge, collectPageVision } = require('./editable-vision-pages.cjs');
const { locateJobImage } = require('./editable-page-assets.cjs');
const { resolveStoredGenerationMode } = require('./editable-mode.cjs');
const { loadTemplate, pageTypeForJob, slugTheme } = require('./layout-templates.cjs');
const { buildManifest, copyFromJob, manifestKey } = require('./editable-manifest.cjs');

const SOURCE_DPI = 300;
const MIN_PPTX_BYTES = 2048;

function editableDeckPath(project) {
  return join(project.outputDir, `${project.slug || 'book'}-editable.pptx`);
}

/**
 * Compile the project's analysed pages into one editable deck.
 * Throws with a named code; never resolves to a half-built file.
 */
async function buildEditableDeck({ store, projectId, outputPath = null, onProgress = () => {} }) {
  const project = store.getProject(projectId);
  if (!project) throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });

  const mode = resolveStoredGenerationMode(store, project);
  const target = outputPath || editableDeckPath(project);
  onProgress(10);

  let result;
  if (mode === 'editable') {
    const jobs = [...(project.jobs || [])].sort((a, b) => a.pageNumber - b.pageNumber);
    const pages = jobs.map((job) => {
      const imagePath = locateJobImage(project, job);
      const stored = store.getSetting?.(manifestKey(project.id, job.id), null);
      const template = loadTemplate(slugTheme(project.theme), pageTypeForJob(job, jobs.length));
      const manifest = stored?.zones || job.manifest?.zones
        ? (stored?.zones ? stored : job.manifest)
        : buildManifest({
          pageId: `${project.id}_${job.id}`,
          themeId: slugTheme(project.theme),
          template,
          copyByZone: copyFromJob(job, template) || {},
        });
      return { imagePath, manifest, pageLabel: `Slide ${job.pageNumber}` };
    });
    result = await visionBridge.composePptx({
      outputPath: target,
      sourceDpi: SOURCE_DPI,
      mode: 'editable',
      pages,
    });
  } else {
    const analysed = collectPageVision(store, project);
    if (!analysed.length) {
      throw Object.assign(
        new Error('No page has been read yet. Run Interior Text first.'),
        { code: 'EDITABLE_VISION_MISSING' }
      );
    }
    result = await visionBridge.composePptx({
      outputPath: target,
      sourceDpi: SOURCE_DPI,
      pages: analysed.map(({ job, imagePath, vision }) => ({
        imagePath,
        vision,
        prompt: [job.prompt, job.imagePrompt, job.storyText].filter(Boolean).join('\n'),
        pageLabel: `Slide ${job.pageNumber}`,
      })),
    });
  }

  if (!result?.ok) {
    throw Object.assign(
      new Error(result?.error || 'The editable deck could not be built.'),
      { code: result?.code || 'EDITABLE_DECK_FAILED' }
    );
  }
  const written = result.outputPath || target;
  const bytes = written && existsSync(written) ? statSync(written).size : 0;
  if (!written || bytes < MIN_PPTX_BYTES) {
    throw Object.assign(
      new Error(`PPTX was not written or is empty: ${written || target}`),
      { code: 'PPTX_INVALID' }
    );
  }
  onProgress(100);
  return {
    ...result,
    outputPath: written,
    bytes,
    textBoxes: (result.detail || []).reduce((sum, slide) => sum + (slide.textBoxesPlaced || 0), 0),
  };
}

module.exports = { buildEditableDeck, editableDeckPath, SOURCE_DPI };
