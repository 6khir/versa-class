'use strict';

const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { blankFileName } = require('./text-overlay-layout.cjs');
const {
  inpaintOkSidecar,
  shouldCleanBakedText,
  sidecarIsClean
} = require('./text-inpaint-bridge.cjs');

function sortJobsByPage(jobs) {
  return (Array.isArray(jobs) ? jobs : [])
    .slice()
    .sort((left, right) => (Number(left?.pageNumber) || 0) - (Number(right?.pageNumber) || 0));
}

function isRawPngPath(filePath) {
  return /\.raw\.png$/i.test(String(filePath || ''));
}

function rawSiblingPath(filePath) {
  const value = String(filePath || '');
  if (!value) return null;
  if (isRawPngPath(value)) return value;
  if (/\.png$/i.test(value)) return value.replace(/\.png$/i, '.raw.png');
  return `${value}.raw.png`;
}

function firstExisting(paths) {
  for (const filePath of paths) {
    if (filePath && existsSync(filePath)) return filePath;
  }
  return null;
}

function exportPageRole(index, pageCount) {
  if (index === 0) return 'cover';
  if (pageCount >= 2 && index === pageCount - 1) return 'back';
  return 'interior';
}

function resolveRawFlatPath(job, outputDir) {
  const outputPath = String(job?.outputPath || '');
  const fileName = String(job?.fileName || '');
  const candidates = [
    rawSiblingPath(outputPath),
    outputDir && fileName ? join(outputDir, fileName.replace(/\.png$/i, '.raw.png')) : null
  ];
  const rawPath = firstExisting(candidates);
  if (rawPath) return rawPath;
  if (outputPath && existsSync(outputPath)) return outputPath;
  return rawPath || outputPath || null;
}

function resolveRebuiltInteriorPath(job, outputDir) {
  const outputPath = String(job?.outputPath || '');
  const namedBlank = outputDir ? join(outputDir, blankFileName(job?.pageNumber)) : null;
  const showcaseSibling = outputPath.replace(/_showcase\.png$/i, '_blank.png');
  const candidates = [namedBlank, outputPath, showcaseSibling].filter((filePath) => (
    filePath && existsSync(filePath) && !isRawPngPath(filePath)
  ));
  return candidates[0] || null;
}

function sidecarReportsResidual(imagePath) {
  const sidecar = inpaintOkSidecar(imagePath);
  if (!sidecar || !existsSync(sidecar)) return false;
  try {
    const payload = JSON.parse(readFileSync(sidecar, 'utf8'));
    if (payload?.code === 'TEXT_INPAINT_RESIDUAL') return true;
    if (payload?.ok === false && Number(payload.residual_count || 0) > 0) return true;
    return false;
  } catch {
    return false;
  }
}

function hasTextInpaintResidual(job, imagePath) {
  if (job?.lastErrorCode === 'TEXT_INPAINT_RESIDUAL' || job?.error === 'TEXT_INPAINT_RESIDUAL') {
    return true;
  }
  if (imagePath && sidecarReportsResidual(imagePath)) return true;
  const outputPath = String(job?.outputPath || '');
  return Boolean(outputPath && sidecarReportsResidual(outputPath));
}

function interiorIsRebuilt(job, imagePath) {
  if (!imagePath || !existsSync(imagePath) || isRawPngPath(imagePath)) return false;
  if (hasTextInpaintResidual(job, imagePath)) return false;
  if (job?.rebuilt === true) return true;
  if (sidecarIsClean(imagePath)) return true;
  if (shouldCleanBakedText(job)) return false;
  return true;
}

function assemblyError(message, code, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

function assertExportPageReady(page) {
  const pageNumber = Number(page?.pageNumber) || 0;
  const index = Number(page?.index) || 0;
  const extra = { pageNumber, index, path: page?.path || null, role: page?.role || null };
  if (!page?.path || !existsSync(page.path)) {
    throw assemblyError(
      `Assembly halted: missing file for ${page?.role || 'page'} ${pageNumber}.`,
      'ASSEMBLY_PAGE_MISSING',
      extra
    );
  }
  if (page.role !== 'interior') return page;
  if (hasTextInpaintResidual(page.job, page.path) || page.lastErrorCode === 'TEXT_INPAINT_RESIDUAL') {
    throw assemblyError(
      `Assembly halted: TEXT_INPAINT_RESIDUAL on interior page ${pageNumber}.`,
      'TEXT_INPAINT_RESIDUAL',
      extra
    );
  }
  if (isRawPngPath(page.path)) {
    throw assemblyError(
      `Assembly halted: interior page ${pageNumber} resolved to a raw flat file.`,
      'ASSEMBLY_RAW_FALLBACK_FORBIDDEN',
      extra
    );
  }
  if (page.rebuilt !== true) {
    throw assemblyError(
      `Assembly halted: interior page ${pageNumber} is not rebuilt.`,
      'ASSEMBLY_PAGE_NOT_REBUILT',
      extra
    );
  }
  return page;
}

/**
 * Final export array:
 * [raw flat cover (index 0)] + [verified rebuilt interiors (1..N-2)] + [raw flat back (N-1)]
 */
function buildExportPageArray(project, { validate = true } = {}) {
  const jobs = sortJobsByPage(project?.jobs);
  if (!jobs.length) {
    throw assemblyError('No pages found for document assembly.', 'ASSEMBLY_PAGES_MISSING');
  }
  const outputDir = project?.outputDir || '';
  const pageCount = jobs.length;
  const pages = jobs.map((job, index) => {
    const role = exportPageRole(index, pageCount);
    const path = role === 'interior'
      ? resolveRebuiltInteriorPath(job, outputDir)
      : resolveRawFlatPath(job, outputDir);
    const rebuilt = role === 'interior' ? interiorIsRebuilt(job, path) : false;
    return {
      index,
      pageNumber: Number(job?.pageNumber) || (index + 1),
      role,
      path,
      rebuilt,
      lastErrorCode: job?.lastErrorCode || null,
      job
    };
  });
  if (validate) {
    for (const page of pages) assertExportPageReady(page);
  }
  return pages;
}

function exportPageByNumber(pages, pageNumber) {
  const wanted = Number(pageNumber) || 0;
  return (Array.isArray(pages) ? pages : []).find((page) => page.pageNumber === wanted)
    || (Array.isArray(pages) ? pages[wanted - 1] : null)
    || null;
}

module.exports = {
  ASSEMBLY_RAW_FALLBACK_FORBIDDEN: 'ASSEMBLY_RAW_FALLBACK_FORBIDDEN',
  ASSEMBLY_PAGE_NOT_REBUILT: 'ASSEMBLY_PAGE_NOT_REBUILT',
  assertExportPageReady,
  buildExportPageArray,
  exportPageByNumber,
  exportPageRole,
  interiorIsRebuilt,
  isRawPngPath,
  rawSiblingPath,
  resolveRawFlatPath,
  resolveRebuiltInteriorPath,
  sortJobsByPage
};
