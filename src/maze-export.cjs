'use strict';

const { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } = require('node:fs');
const { basename, dirname, join, relative, resolve, sep } = require('node:path');
const { PAGE_ROLES } = require('./maze-contract.cjs');
const { MAZE_RENDER_COLORS, normalizePageFormat, resolveMazePageSetup } = require('./maze-svg.cjs');

const SOLUTION_MARK = /id="maze-solution"|data-maze-variant="solution"/;
const STUDENT_MARK = /data-maze-variant="student"/;
const MAZE_EXPORT_ROLES = new Set(Object.values(PAGE_ROLES));

function fail(message, code, extra = {}) {
  throw Object.assign(new Error(message), { code, ...extra });
}

function isMazeProduct(project) {
  return String(project?.productFormat || '').toLowerCase() === 'maze';
}

function isMazeExportRole(kind) {
  return MAZE_EXPORT_ROLES.has(String(kind || ''));
}

function includeAnswerKeys(lab) {
  return lab?.includeAnswerKey !== false;
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isInsideDir(root, filePath) {
  if (!root || !filePath) return false;
  const relativePath = relative(resolve(root), resolve(filePath));
  return Boolean(relativePath) && !relativePath.startsWith('..') && !relativePath.startsWith(sep);
}

function studentPages(mazeProject) {
  return (Array.isArray(mazeProject?.pages) ? mazeProject.pages : [])
    .filter((page) => page.pageRole === PAGE_ROLES.MAZE_INTERIOR)
    .slice()
    .sort((left, right) => (Number(left.sequenceIndex) || 0) - (Number(right.sequenceIndex) || 0));
}

function readSvg(filePath) {
  if (!filePath || !existsSync(filePath)) return '';
  return readFileSync(filePath, 'utf8');
}

function studentPageInvalidReason(page) {
  if (!page) return 'Maze page is missing.';
  if (page.generationStatus !== 'ready') return null;
  if (page.validationResult && page.validationResult.valid === false) {
    return page.validationResult.messages?.[0] || 'Maze validation failed.';
  }
  if (!page.topology || !page.solution) return 'Maze topology is missing.';
  if (page.topology.seed !== page.seed) return 'Maze seed does not match its topology.';
  const studentSvg = readSvg(page.render?.studentSvgPath);
  if (page.render?.studentSvgPath && studentSvg) {
    if (SOLUTION_MARK.test(studentSvg)) return 'Student maze includes a solution path.';
    if (!STUDENT_MARK.test(studentSvg)) return 'Student maze is not marked as a student page.';
  }
  return null;
}

function isStudentPageReady(page) {
  return page?.generationStatus === 'ready'
    && !studentPageInvalidReason(page)
    && Boolean(page.render?.studentSvgPath && existsSync(page.render.studentSvgPath));
}

function mazeJobId(projectId, slot) {
  return `mz-${projectId}-${slot.pageId}`;
}

function planMazeExportSlots(mazeProject, mazeLab = {}) {
  const students = studentPages(mazeProject);
  const title = mazeProject?.config?.title || mazeProject?.config?.keyword || 'Maze Pack';
  const instruction = mazeProject?.config?.instruction || '';
  const slots = [{
    role: PAGE_ROLES.COVER,
    pageId: 'cover',
    sourcePageId: null,
    variant: 'cover',
    seed: mazeProject?.config?.seed || '',
    title,
    instruction,
    label: 'Cover'
  }];
  for (const page of students) {
    slots.push({
      role: PAGE_ROLES.MAZE_INTERIOR,
      pageId: page.pageId,
      sourcePageId: page.pageId,
      variant: 'student',
      seed: page.seed,
      title: page.title || title,
      instruction: page.instruction || instruction,
      label: page.title || `Maze ${page.sequenceIndex}`,
      page
    });
  }
  if (includeAnswerKeys(mazeLab)) {
    for (const page of students) {
      slots.push({
        role: PAGE_ROLES.ANSWER_KEY,
        pageId: `${page.pageId}-answer`,
        sourcePageId: page.pageId,
        variant: 'solution',
        seed: page.seed,
        title: `${page.title || title} — Answer Key`,
        instruction: `Answer key for seed ${page.seed}`,
        label: `Answer ${page.sequenceIndex}`,
        page
      });
    }
  }
  slots.push({
    role: PAGE_ROLES.BACK_COVER,
    pageId: 'back',
    sourcePageId: null,
    variant: 'back_cover',
    seed: mazeProject?.config?.seed || '',
    title,
    instruction: includeAnswerKeys(mazeLab) ? 'Answer keys are included.' : instruction,
    label: 'Back cover'
  });
  return slots;
}

function renderShellSvg({ role, title, instruction, format, orientation }) {
  const setup = resolveMazePageSetup(format, orientation);
  const colors = MAZE_RENDER_COLORS;
  const subtitle = role === PAGE_ROLES.BACK_COVER
    ? (instruction || 'Thank you for using this maze pack.')
    : (instruction || 'Printable maze pack');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${setup.width}" height="${setup.height}" viewBox="0 0 ${setup.width} ${setup.height}" data-maze-variant="${role}" data-page-role="${role}" data-page-format="${escapeXml(setup.format)}" data-page-orientation="${escapeXml(setup.orientation)}">`,
    `<rect x="0" y="0" width="${setup.width}" height="${setup.height}" fill="${colors.pageFill}"/>`,
    `<rect x="18" y="18" width="${setup.width - 36}" height="${setup.height - 36}" fill="none" stroke="${colors.frameStroke}" stroke-width="2" rx="10"/>`,
    `<text id="maze-title" xml:space="preserve" x="${setup.width / 2}" y="${setup.height * 0.42}" text-anchor="middle" font-family="Trebuchet MS, Arial, sans-serif" font-size="28" font-weight="700" fill="${colors.text}">${escapeXml(title)}</text>`,
    `<text id="maze-instruction" xml:space="preserve" x="${setup.width / 2}" y="${setup.height * 0.48}" text-anchor="middle" font-family="Trebuchet MS, Arial, sans-serif" font-size="14" fill="${colors.text}">${escapeXml(subtitle)}</text>`,
    '</svg>'
  ].join('');
}

function mazeSvgWithoutBakedText(svg) {
  return String(svg || '').replace(/<g id="maze-text">[\s\S]*?<\/g>/, '');
}

async function writePngFromSvg(svgPath, destPath) {
  const { atomicWrite, pageImageAsPngBuffer, ensureCardPreview } = require('./file-manager.cjs');
  await atomicWrite(destPath, await pageImageAsPngBuffer(svgPath));
  try { await ensureCardPreview(destPath); } catch { /* display-only */ }
  return destPath;
}

async function ensureSlotArtifacts(store, projectId, slot, mazeProject) {
  const { resolveMazeArtifactDir } = require('./maze-service.cjs');
  const dir = resolveMazeArtifactDir(store, projectId);
  if (!dir) return { ...slot, ready: false, svgPath: null, pngPath: null };
  mkdirSync(dir, { recursive: true });
  const project = typeof store.getProject === 'function' ? store.getProject(projectId) : null;
  const format = normalizePageFormat(project?.format || 'A4');
  const orientation = project?.orientation || 'portrait';

  if (slot.role === PAGE_ROLES.COVER || slot.role === PAGE_ROLES.BACK_COVER) {
    const svgPath = join(dir, `${slot.pageId}.svg`);
    const pngPath = join(dir, `${slot.pageId}.png`);
    if (!isInsideDir(dir, svgPath) || !isInsideDir(dir, pngPath)) {
      fail('Maze export path left the approved project folder.', 'MAZE_RENDER_PATH_INVALID');
    }
    writeFileSync(svgPath, renderShellSvg({
      role: slot.role,
      title: slot.title,
      instruction: slot.instruction,
      format,
      orientation
    }));
    await writePngFromSvg(svgPath, pngPath);
    return { ...slot, ready: existsSync(pngPath), svgPath, pngPath };
  }

  const page = slot.page || studentPages(mazeProject).find((item) => item.pageId === slot.sourcePageId);
  const invalid = studentPageInvalidReason(page);
  if (invalid) return { ...slot, ready: false, svgPath: null, pngPath: null, invalid };
  if (page?.generationStatus !== 'ready') {
    return { ...slot, ready: false, svgPath: page?.render?.studentSvgPath || null, pngPath: null };
  }

  if (slot.role === PAGE_ROLES.MAZE_INTERIOR) {
    const svgPath = page.render?.studentSvgPath || null;
    let pngPath = page.render?.pngPreviewPath || null;
    if (svgPath && existsSync(svgPath) && (!pngPath || !existsSync(pngPath))) {
      pngPath = join(dir, `${page.pageId}-preview.png`);
      if (!isInsideDir(dir, pngPath)) fail('Maze export path left the approved project folder.', 'MAZE_RENDER_PATH_INVALID');
      await writePngFromSvg(svgPath, pngPath);
    }
    return {
      ...slot,
      ready: Boolean(svgPath && pngPath && existsSync(svgPath) && existsSync(pngPath) && isStudentPageReady(page)),
      svgPath,
      pngPath
    };
  }

  const svgPath = page.render?.solutionSvgPath || null;
  if (!svgPath || !existsSync(svgPath)) {
    return { ...slot, ready: false, svgPath, pngPath: null };
  }
  const answerSvg = readSvg(svgPath);
  if (!SOLUTION_MARK.test(answerSvg) || page.seed !== slot.seed || page.topology?.seed !== slot.seed) {
    return { ...slot, ready: false, svgPath, pngPath: null, invalid: 'Answer key does not match its source seed.' };
  }
  const pngPath = join(dir, `${page.pageId}-answer.png`);
  if (!isInsideDir(dir, pngPath)) fail('Maze export path left the approved project folder.', 'MAZE_RENDER_PATH_INVALID');
  await writePngFromSvg(svgPath, pngPath);
  return { ...slot, ready: existsSync(pngPath), svgPath, pngPath };
}

function attachMazeContext(project, store, projectId) {
  if (!project) return project;
  if (project.mazeProject && project.mazeLab) return project;
  const id = projectId || project.id;
  const { getMazeProject } = require('./maze-service.cjs');
  const { getMazeLabState } = require('./maze-lab.cjs');
  return {
    ...project,
    mazeProject: project.mazeProject || (store && id ? getMazeProject(store, id) : null),
    mazeLab: project.mazeLab || (store && id ? getMazeLabState(store, id) : { includeAnswerKey: true })
  };
}

function assertMazeExportReady(project) {
  if (!isMazeProduct(project)) return project;
  const mazeProject = project.mazeProject;
  const mazeLab = project.mazeLab || { includeAnswerKey: true };
  const students = studentPages(mazeProject);
  const planned = Number(mazeLab.pageCount) || students.length;
  if (!planned || !students.length) {
    fail('Export is locked until every maze page is complete.', 'BOOK_INCOMPLETE');
  }
  if (students.some((page) => page.generationStatus !== 'ready')) {
    fail('Export is locked until every maze page is complete.', 'BOOK_INCOMPLETE');
  }
  for (const page of students) {
    const invalid = studentPageInvalidReason(page);
    if (invalid) fail(invalid, 'MAZE_INVALID', { pageId: page.pageId });
    if (!page.render?.studentSvgPath || !existsSync(page.render.studentSvgPath)) {
      fail('Export is locked until every maze page is complete.', 'BOOK_INCOMPLETE');
    }
    if (!isStudentPageReady(page)) {
      fail('Invalid mazes cannot be previewed or exported.', 'MAZE_INVALID', { pageId: page.pageId });
    }
  }
  const jobs = Array.isArray(project.jobs) ? project.jobs : [];
  const slots = planMazeExportSlots(mazeProject, mazeLab);
  if (project.stats?.total && project.stats.complete !== project.stats.total) {
    fail('Export is locked until every maze page is complete.', 'BOOK_INCOMPLETE');
  }
  if (!jobs.length || jobs.length !== slots.length) {
    fail('Export is locked until every maze page is complete.', 'BOOK_INCOMPLETE');
  }
  jobs.forEach((job, index) => {
    const slot = slots[index];
    if (!job || job.status !== 'complete' || !job.outputPath || !existsSync(job.outputPath)) {
      fail('Export is locked until every maze page is complete.', 'BOOK_INCOMPLETE');
    }
    if (slot && job.kind && job.kind !== slot.role) {
      fail('Maze export page order is invalid.', 'MAZE_EXPORT_ORDER_INVALID');
    }
  });
  return project;
}

function mazePagesComplete(project) {
  try {
    assertMazeExportReady(project);
    return true;
  } catch (error) {
    if (error?.code === 'BOOK_INCOMPLETE' || error?.code === 'MAZE_INVALID' || error?.code === 'MAZE_EXPORT_ORDER_INVALID') {
      return false;
    }
    throw error;
  }
}

function buildMazeExportPageArray(project) {
  assertMazeExportReady(project);
  const mazeProject = project.mazeProject;
  const slots = planMazeExportSlots(mazeProject, project.mazeLab);
  const jobs = [...(project.jobs || [])].sort((left, right) => (
    (Number(left?.pageNumber) || 0) - (Number(right?.pageNumber) || 0)
  ));
  return slots.map((slot, index) => {
    const job = jobs[index];
    const svgPath = job?.editSourcePath || null;
    const path = job?.outputPath || null;
    if (slot.role === PAGE_ROLES.MAZE_INTERIOR) {
      const svg = readSvg(svgPath || slot.page?.render?.studentSvgPath);
      if (SOLUTION_MARK.test(svg)) {
        fail('Student maze includes a solution path.', 'MAZE_INVALID', { pageId: slot.pageId });
      }
    }
    if (slot.role === PAGE_ROLES.ANSWER_KEY) {
      const svg = readSvg(svgPath || slot.page?.render?.solutionSvgPath);
      if (!SOLUTION_MARK.test(svg) || slot.page?.seed !== slot.seed) {
        fail('Answer key does not match its source seed.', 'MAZE_INVALID', { pageId: slot.pageId });
      }
    }
    return {
      index,
      pageNumber: Number(job?.pageNumber) || (index + 1),
      role: slot.role,
      path,
      svgPath,
      rebuilt: true,
      title: slot.title,
      instruction: slot.instruction,
      seed: slot.seed,
      sourcePageId: slot.sourcePageId,
      job
    };
  });
}

async function syncMazeExportJobs(store, projectId) {
  if (!store || !projectId) return null;
  const { getMazeProject } = require('./maze-service.cjs');
  const { getMazeLabState, planMazePages } = require('./maze-lab.cjs');
  let project = store.getProject(projectId);
  if (!project || !isMazeProduct(project)) return project;
  const mazeLab = getMazeLabState(store, projectId);
  let mazeProject = getMazeProject(store, projectId);
  if (!studentPages(mazeProject).length && mazeLab.pageCount) {
    mazeProject = planMazePages(store, projectId, mazeLab.pageCount);
  }
  const slots = [];
  for (const slot of planMazeExportSlots(mazeProject, mazeLab)) {
    slots.push(await ensureSlotArtifacts(store, projectId, slot, mazeProject));
  }
  const jobs = slots.map((slot, index) => ({
    id: mazeJobId(projectId, slot),
    pageNumber: index + 1,
    pageLabel: slot.label,
    kind: slot.role,
    title: slot.title,
    prompt: slot.seed || slot.pageId,
    storyText: slot.instruction || '',
    imagePrompt: slot.sourcePageId || slot.pageId,
    fileName: slot.pngPath ? basename(slot.pngPath) : `${slot.pageId}.png`,
    status: slot.ready && !slot.invalid ? 'complete' : 'pending'
  }));
  const previous = {
    style: project.style,
    status: project.status,
    activityCount: project.activityCount
  };
  store.populateProjectJobs(
    projectId,
    jobs,
    project.format,
    project.orientation,
    mazeLab.pageCount || studentPages(mazeProject).length || jobs.length
  );
  slots.forEach((slot, index) => {
    const job = jobs[index];
    if (!job || !slot.ready || slot.invalid || !slot.pngPath) return;
    store.updateJob(job.id, {
      status: 'complete',
      outputPath: slot.pngPath,
      editSourcePath: slot.svgPath,
      storyText: slot.instruction || '',
      imagePrompt: slot.sourcePageId || slot.pageId
    });
  });
  store.updateProject(projectId, {
    style: previous.style,
    status: previous.status,
    activityCount: previous.activityCount
  });
  return attachMazeContext(store.getProject(projectId), store, projectId);
}

async function prepareMazeProject(project, store) {
  if (!isMazeProduct(project)) return project;
  if (store && project?.id) {
    const synced = await syncMazeExportJobs(store, project.id);
    assertMazeExportReady(synced);
    return synced;
  }
  return assertMazeExportReady(attachMazeContext(project, store, project?.id));
}

async function assertMazeBookReady(store, projectId) {
  const project = await syncMazeExportJobs(store, projectId);
  return assertMazeExportReady(project);
}

function mazeDocxPath(project) {
  const { findExistingBookDocument, bookFileCode } = require('./file-manager.cjs');
  return findExistingBookDocument(project?.outputDir) || join(project?.outputDir || '', `${bookFileCode(project)}.docx`);
}

function mazePptxPath(project) {
  const { bookFileCode } = require('./file-manager.cjs');
  return join(project?.outputDir || '', `${bookFileCode(project)}.pptx`);
}

function mazeDeliverablesCurrent(project) {
  if (!project || !isMazeProduct(project)) return null;
  const { getPdf, hasValidPdfFile } = require('./pdf-state.cjs');
  const { printPdfPageChecksum } = require('./file-manager.cjs');
  const pdf = getPdf(project);
  if (!hasValidPdfFile(pdf.productPath)) return null;
  const checksum = printPdfPageChecksum(project.jobs);
  if (pdf.metadata?.checksum && checksum && pdf.metadata.checksum !== checksum) return null;
  const docxPath = mazeDocxPath(project);
  const pptxPath = mazePptxPath(project);
  if (!docxPath || !existsSync(docxPath) || statSync(docxPath).size < 1024) return null;
  if (!pptxPath || !existsSync(pptxPath) || statSync(pptxPath).size < 1024) return null;
  return {
    pdfPath: pdf.productPath,
    compressedPath: hasValidPdfFile(pdf.compressedPath) ? pdf.compressedPath : pdf.productPath,
    docxPath,
    pptxPath,
    reused: true
  };
}

function persistMazePrintPdf(store, projectId, pdfPath) {
  const { applyPdfToProject, hasValidPdfFile } = require('./pdf-state.cjs');
  const { printPdfPageChecksum, compressedPrintPdfDest } = require('./file-manager.cjs');
  const project = store.getProject(projectId);
  if (!project || !hasValidPdfFile(pdfPath)) {
    fail('Maze PDF was not written.', 'MAZE_ASSEMBLE_PDF_MISSING');
  }
  const dest = compressedPrintPdfDest(project.outputDir, project);
  mkdirSync(dirname(dest), { recursive: true });
  if (resolve(pdfPath) !== resolve(dest)) copyFileSync(pdfPath, dest);
  const checksum = printPdfPageChecksum(project.jobs);
  const bytes = statSync(pdfPath).size;
  store.updateProjectTransactionally(projectId, (current) => applyPdfToProject(current, {
    productPath: pdfPath,
    compressedPath: dest,
    metadata: {
      checksum,
      stage: 'ready',
      originalBytes: bytes,
      outputBytes: bytes,
      skipped: true,
      reason: 'maze-local-compose',
      pageCount: (current.jobs || []).length,
      error: null,
      message: 'Assembled.',
      updatedAt: new Date().toISOString()
    }
  }));
  return dest;
}

/**
 * Compose PDF + Word + PowerPoint from the local maze SVGs/PNGs.
 * This never opens Gemini and never leases the browser lane.
 */
async function assembleMazeDeliverables(store, projectId, { onProgress = null, fileManager = null } = {}) {
  const report = async (percent, message) => {
    if (typeof onProgress === 'function') await onProgress({ percent, message, stage: 'assemble' });
  };
  await report(6, 'Preparing maze pages for export…');
  const project = await assertMazeBookReady(store, projectId);
  const existing = mazeDeliverablesCurrent(project);
  if (existing) {
    await report(100, 'Maze PDF, Word, and PowerPoint are already assembled.');
    return existing;
  }
  // #region agent log
  fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H200',location:'src/maze-export.cjs:assembleMazeDeliverables',message:'assembling maze exports locally',data:{projectId,jobCount:(project.jobs||[]).length},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  await report(18, 'Composing the print PDF from local maze pages…');
  const pdfPath = await exportMazePdf(project);
  const compressedPath = persistMazePrintPdf(store, projectId, pdfPath);
  await report(48, 'Composing the PowerPoint from local maze pages…');
  const afterPdf = attachMazeContext(store.getProject(projectId) || project, store, projectId);
  const pptxPath = await exportMazePptx(afterPdf);
  await report(72, 'Composing the Word document from local maze pages…');
  const manager = fileManager || new (require('./file-manager.cjs').FileManager)({ nativeImage: {} });
  const afterPptx = attachMazeContext(store.getProject(projectId) || afterPdf, store, projectId);
  const docxPath = await manager.exportDocx(afterPptx, { store });
  await report(100, 'Maze PDF, Word, and PowerPoint are ready.');
  return {
    pdfPath,
    compressedPath,
    pptxPath,
    docxPath,
    reused: false
  };
}

function selectMazePreviewFramePaths(jobs = [], limit) {
  const { PREVIEW_PAGE_FRAME_MIN, PREVIEW_PAGE_FRAME_MAX, PREVIEW_PAGE_FRAME_COUNT, isRasterImagePath } = require('./file-manager.cjs');
  const interiors = (Array.isArray(jobs) ? jobs : [])
    .slice()
    .sort((left, right) => (Number(left?.pageNumber) || 0) - (Number(right?.pageNumber) || 0))
    .filter((job) => job?.kind === PAGE_ROLES.MAZE_INTERIOR)
    .map((job) => job.outputPath)
    .filter((filePath) => filePath && existsSync(filePath) && isRasterImagePath(filePath));
  const cap = Math.min(
    PREVIEW_PAGE_FRAME_MAX,
    Math.max(PREVIEW_PAGE_FRAME_MIN, Math.round(limit) || PREVIEW_PAGE_FRAME_COUNT)
  );
  if (interiors.length <= cap) return interiors;
  const picked = [];
  for (let index = 0; index < cap; index += 1) {
    picked.push(interiors[Math.round((index * (interiors.length - 1)) / (cap - 1))]);
  }
  return [...new Set(picked)];
}

function selectMazeThumbnailPaths(jobs = []) {
  const { collectProductPageImagePaths } = require('./file-manager.cjs');
  return collectProductPageImagePaths(jobs);
}

async function rasterForPdf(page) {
  const { pageImageAsPngBuffer } = require('./file-manager.cjs');
  const source = page.svgPath && existsSync(page.svgPath) ? page.svgPath : page.path;
  return pageImageAsPngBuffer(source);
}

async function exportMazePdf(project, options = {}) {
  const pages = buildMazeExportPageArray(project);
  const {
    resolvePageSetup,
    addCompressedPdfPage,
    createSpreadPng,
    atomicWrite,
    bookFileCode
  } = require('./file-manager.cjs');
  const { calculateSaddleStitchSpreads } = require('./imposition.cjs');
  const mode = typeof options === 'string'
    ? options
    : (options && options.exportMode) ? options.exportMode : 'STANDARD_SEQUENTIAL';
  const isBooklet = mode === 'BOOKLET_SADDLE_STITCH';
  const setup = resolvePageSetup(normalizePageFormat(project.format), project.orientation || 'portrait');
  const { PDFDocument } = require('pdf-lib');
  const pdf = await PDFDocument.create();
  pdf.setTitle(project.name || 'Maze Pack');
  pdf.setSubject(project.theme || project.mazeProject?.config?.keyword || 'Maze');
  const slug = bookFileCode(project);
  const outputPath = join(project.outputDir, isBooklet ? `${slug}-booklet.pdf` : `${slug}.pdf`);

  if (isBooklet) {
    const imposition = calculateSaddleStitchSpreads(pages.length);
    const spreadPoints = [setup.points[0] * 2, setup.points[1]];
    for (const spread of imposition.spreads) {
      const leftPage = pages[spread.leftPage - 1];
      const rightPage = pages[spread.rightPage - 1];
      const spreadPng = await createSpreadPng({
        leftPng: leftPage ? await rasterForPdf(leftPage) : null,
        rightPng: rightPage ? await rasterForPdf(rightPage) : null,
        format: project.format,
        orientation: project.orientation
      });
      await addCompressedPdfPage(pdf, spreadPng, spreadPoints, setup.width * 2, setup.height);
    }
  } else {
    for (const page of pages) {
      const png = await rasterForPdf(page);
      await addCompressedPdfPage(pdf, png, setup.points, setup.width, setup.height);
    }
  }
  await atomicWrite(outputPath, Buffer.from(await pdf.save({ useObjectStreams: true })));
  return outputPath;
}

async function exportMazePptx(project, options = {}) {
  const pages = buildMazeExportPageArray(project);
  const { resolvePageSetup, atomicWrite, bookFileCode, pageImageAsPngBuffer } = require('./file-manager.cjs');
  const mode = typeof options === 'string'
    ? options
    : (options && options.exportMode) ? options.exportMode : 'STANDARD_SEQUENTIAL';
  if (mode === 'BOOKLET_SADDLE_STITCH') {
    const setup = resolvePageSetup(normalizePageFormat(project.format), project.orientation || 'portrait');
    const PptxGenJS = require('pptxgenjs');
    const pres = new PptxGenJS();
    const widthInches = (setup.points[0] * 2) / 72;
    const heightInches = setup.points[1] / 72;
    pres.title = project.name;
    pres.defineLayout({ name: 'CUSTOM', width: widthInches, height: heightInches });
    pres.layout = 'CUSTOM';
    const { calculateSaddleStitchSpreads } = require('./imposition.cjs');
    const { createSpreadPng } = require('./file-manager.cjs');
    const imposition = calculateSaddleStitchSpreads(pages.length);
    for (const spread of imposition.spreads) {
      const leftPage = pages[spread.leftPage - 1];
      const rightPage = pages[spread.rightPage - 1];
      const spreadPng = await createSpreadPng({
        leftPng: leftPage ? await pageImageAsPngBuffer(leftPage.path) : null,
        rightPng: rightPage ? await pageImageAsPngBuffer(rightPage.path) : null,
        format: project.format,
        orientation: project.orientation
      });
      const slide = pres.addSlide();
      slide.addImage({
        data: `data:image/png;base64,${spreadPng.toString('base64')}`,
        x: 0,
        y: 0,
        w: widthInches,
        h: heightInches
      });
    }
    const outputPath = join(project.outputDir, `${bookFileCode(project)}-booklet.pptx`);
    await atomicWrite(outputPath, await pres.write({ outputType: 'nodebuffer' }));
    return outputPath;
  }

  const setup = resolvePageSetup(normalizePageFormat(project.format), project.orientation || 'portrait');
  const widthInches = setup.points[0] / 72;
  const heightInches = setup.points[1] / 72;
  const PptxGenJS = require('pptxgenjs');
  const pres = new PptxGenJS();
  pres.title = project.name || 'Maze Pack';
  pres.subject = project.theme || 'Maze';
  pres.defineLayout({ name: 'CUSTOM', width: widthInches, height: heightInches });
  pres.layout = 'CUSTOM';

  for (const page of pages) {
    const slide = pres.addSlide();
    const svgRaw = page.svgPath && existsSync(page.svgPath) ? readFileSync(page.svgPath) : null;
    const svgForSlide = svgRaw
      ? mazeSvgWithoutBakedText(svgRaw.toString('utf8'))
      : null;
    if (svgForSlide) {
      slide.addImage({
        data: `data:image/svg+xml;base64,${Buffer.from(svgForSlide, 'utf8').toString('base64')}`,
        x: 0,
        y: 0,
        w: widthInches,
        h: heightInches
      });
    } else {
      const png = await pageImageAsPngBuffer(page.path);
      slide.addImage({
        data: `data:image/png;base64,${png.toString('base64')}`,
        x: 0,
        y: 0,
        w: widthInches,
        h: heightInches
      });
    }
    if (page.title) {
      slide.addText(page.title, {
        x: 0.35,
        y: 0.28,
        w: widthInches - 0.7,
        h: 0.42,
        align: 'center',
        fontSize: 16,
        bold: true,
        fontFace: 'Arial',
        color: '1A1F2B'
      });
    }
    if (page.instruction) {
      slide.addText(page.instruction, {
        x: 0.35,
        y: 0.68,
        w: widthInches - 0.7,
        h: 0.32,
        align: 'center',
        fontSize: 11,
        fontFace: 'Arial',
        color: '1A1F2B'
      });
    }
    if (page.job?.storyText) slide.addNotes(page.job.storyText);
  }

  const outputPath = join(project.outputDir, `${bookFileCode(project)}.pptx`);
  await atomicWrite(outputPath, await pres.write({ outputType: 'nodebuffer' }));
  return outputPath;
}

module.exports = {
  PAGE_ROLES,
  isMazeProduct,
  isMazeExportRole,
  includeAnswerKeys,
  planMazeExportSlots,
  studentPages,
  studentPageInvalidReason,
  isStudentPageReady,
  mazePagesComplete,
  assertMazeExportReady,
  assertMazeBookReady,
  mazeDeliverablesCurrent,
  assembleMazeDeliverables,
  buildMazeExportPageArray,
  syncMazeExportJobs,
  prepareMazeProject,
  selectMazePreviewFramePaths,
  selectMazeThumbnailPaths,
  exportMazePdf,
  exportMazePptx,
  mazeSvgWithoutBakedText,
  renderShellSvg
};
