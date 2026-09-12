'use strict';

/**
 * The two editable stages that turn generated artwork into an editable document.
 *
 *   Interior Text   reads each page with MobileSAM + PaddleOCR and compiles it into
 *                   its own single-page layered PDF: the artwork on one layer, real
 *                   text on another, set in the face the artwork itself used.
 *   Editable PPTX   concatenates those pages into one book, layers intact.
 *
 * Splitting it this way is what makes the pipeline resumable. A page is compiled
 * once and left on disk, so re-running the book stage is a concatenation rather than
 * a re-render, and a single bad page can be rebuilt without touching the rest.
 *
 * Layers are real PDF Optional Content Groups. Every viewer with a layers panel keys
 * off those - though note that Preview.app has no layers panel at all, so a correctly
 * layered document still looks flat there. Acrobat, Illustrator and Affinity show them.
 */

const { existsSync, mkdirSync, readdirSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { visionBridge, collectPageVision } = require('./editable-vision-pages.cjs');

// 200 DPI against 300 DPI source art: above the ~150 where print starts to show, and
// the single biggest lever on file size for raster-backed pages.
const DEFAULT_DPI = 200;
const DEFAULT_QUALITY = 88;
const SOURCE_DPI = 300;

/** Where the per-page editable PDFs live. Kept out of the artwork namespace so the
 *  page-image locator cannot mistake one for generated artwork. */
const COMPOSE_CONTRACT = 2;

function editablePagesDir(project) {
  const { projectWorkspaceDir } = require('./project-workspace.cjs');
  const workspace = projectWorkspaceDir(project?.id);
  if (workspace) return join(workspace, 'editable');
  return join(project.outputDir, 'editable');
}

function editablePagePath(project, pageNumber) {
  return join(editablePagesDir(project), `page_${String(pageNumber).padStart(3, '0')}.pdf`);
}

function editableBookPath(project) {
  return join(project.outputDir, `${project.slug || 'book'}-editable.pdf`);
}

/**
 * Interior Text - compile every analysed page into its own layered, editable PDF.
 *
 * `textMode` decides what "editable" means:
 *   replace (default)  the words are erased from the artwork and redrawn as live text
 *                      in the matched face, so editing the string changes the page.
 *                      Only runs on a provably uniform background are converted; the
 *                      rest stay baked in and are reported, because a grey patch over
 *                      the illustration is worse than a word that stayed uneditable.
 *   overlay            the artwork is untouched and the text is drawn invisibly over
 *                      it - selectable and searchable, but not visibly editable.
 */
async function buildEditablePages({
  store,
  projectId,
  dpi = DEFAULT_DPI,
  quality = DEFAULT_QUALITY,
  textMode = 'replace',
  objectLayers = false,
  matchFonts = true,
  force = false,
  jobIds = null,
  signal,
  onProgress = () => {},
  onActivity = () => {},
}) {
  const project = store.getProject(projectId);
  if (!project) throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });

  const wanted = jobIds ? new Set(jobIds) : null;
  const contractKey = `editable-compose-contract:${projectId}`;
  force = force || Number(store.getSetting?.(contractKey, 0)) < COMPOSE_CONTRACT;
  const analysed = collectPageVision(store, project)
    .filter((entry) => !wanted || wanted.has(entry.job.id));
  if (!analysed.length) {
    throw Object.assign(
      new Error('No page has been read yet. Generate the artwork first.'),
      { code: 'EDITABLE_VISION_MISSING' }
    );
  }

  mkdirSync(editablePagesDir(project), { recursive: true });
  const built = [];
  const failures = [];
  let done = 0;

  for (const { job, imagePath, vision } of analysed) {
    if (signal?.aborted) throw Object.assign(new Error('Cancelled.'), { code: 'CANCELLED' });
    const outputPath = editablePagePath(project, job.pageNumber);

    onActivity({ jobId: job.id, pageNumber: job.pageNumber, phase: 'rebuilding', state: 'start' });
    if (!force && existsSync(outputPath)) {
      built.push({ pageNumber: job.pageNumber, path: outputPath, reused: true });
      onActivity({ jobId: job.id, pageNumber: job.pageNumber, phase: 'rebuilding', state: 'done', cached: true });
      onProgress(Math.round((++done / analysed.length) * 100));
      continue;
    }

    let result;
    try {
      result = await visionBridge.composeLayeredPdf({
        outputPath,
        dpi,
        sourceDpi: SOURCE_DPI,
        quality,
        textMode,
        objectLayers,
        matchFonts,
        comfyTimeout: 900,
        // One page per document, labelled with its real page number so the layer names
        // survive the merge in reading order.
        pages: [{ imagePath, vision, pageLabel: `p${job.pageNumber}` }],
      });
    } catch (error) {
      failures.push({ pageNumber: job.pageNumber, code: error.code || 'PAGE_COMPOSE_FAILED', error: error.message });
      onActivity({ jobId: job.id, pageNumber: job.pageNumber, phase: 'rebuilding', state: 'done', cached: false });
      onProgress(Math.round((++done / analysed.length) * 100));
      continue;
    }

    if (!result?.ok) {
      failures.push({ pageNumber: job.pageNumber, code: result?.code || 'PAGE_COMPOSE_FAILED', error: result?.error });
    } else {
      const detail = result.detail?.[0] || {};
      built.push({
        pageNumber: job.pageNumber,
        path: outputPath,
        reused: false,
        bytes: result.bytes,
        editableText: detail.textPlaced || 0,
        bakedText: detail.textLeftBaked || 0,
        fonts: detail.fontsMatched || [],
      });
    }
    onActivity({ jobId: job.id, pageNumber: job.pageNumber, phase: 'rebuilding', state: 'done', cached: false });
    onProgress(Math.round((++done / analysed.length) * 100));
  }

  if (!built.length) {
    throw Object.assign(
      new Error(failures[0]?.error || 'No page could be made editable.'),
      { code: failures[0]?.code || 'EDITABLE_PAGES_FAILED' }
    );
  }

  const summary = {
    pages: built.length,
    compiled: built.filter((page) => !page.reused).length,
    reused: built.filter((page) => page.reused).length,
    failures,
    editableText: built.reduce((sum, page) => sum + (page.editableText || 0), 0),
    bakedText: built.reduce((sum, page) => sum + (page.bakedText || 0), 0),
    fonts: [...new Set(built.flatMap((page) => page.fonts || []))].sort(),
    paths: built.map((page) => page.path),
  };
  if (force) store.setSetting?.(contractKey, COMPOSE_CONTRACT);
  return summary;
}

/** Every compiled page on disk, in page order. */
function listEditablePages(project) {
  const dir = editablePagesDir(project);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => /^page_\d{3}\.pdf$/.test(name))
    .sort()
    .map((name) => join(dir, name));
}

/** Editable PPTX - concatenate the compiled pages into one book. */
async function mergeEditableBook({ store, projectId, outputPath = null, onProgress = () => {} }) {
  const project = store.getProject(projectId);
  if (!project) throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });

  const inputs = listEditablePages(project);
  if (!inputs.length) {
    throw Object.assign(
      new Error('No editable pages found. Run Interior Text first.'),
      { code: 'EDITABLE_PAGES_MISSING' }
    );
  }
  onProgress(20);

  const target = outputPath || editableBookPath(project);
  const result = await visionBridge.mergeLayeredPdfs({ outputPath: target, inputs });
  if (!result?.ok) {
    throw Object.assign(
      new Error(result?.error || 'The editable book could not be assembled.'),
      { code: result?.code || 'EDITABLE_BOOK_FAILED' }
    );
  }
  onProgress(100);
  return result;
}

/** Drop compiled pages so the next run rebuilds them. */
function clearEditablePages(project) {
  rmSync(editablePagesDir(project), { recursive: true, force: true });
}

module.exports = {
  buildEditablePages,
  mergeEditableBook,
  listEditablePages,
  clearEditablePages,
  editablePagesDir,
  editablePagePath,
  editableBookPath,
  DEFAULT_DPI,
  DEFAULT_QUALITY,
  SOURCE_DPI,
};
