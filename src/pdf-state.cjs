'use strict';

function getPdf(project) {
  if (!project) return { productPath: null, compressedPath: null, thankYouPath: null, metadata: {} };

  const meta = (project.printPdfJson && typeof project.printPdfJson === 'object') ? project.printPdfJson : {};
  
  const productPath = meta.productPdfPath ?? project.productPdfPath ?? project.tptListing?.productPdfPath ?? null;
  const compressedPath = meta.compressedPdfPath ?? project.compressedPdfPath ?? null;
  const thankYouPath = meta.thankYouPdfPath ?? project.thankYouPdfPath ?? null;

  const metadata = {
    stage: meta.stage ?? null,
    error: meta.error ?? null,
    message: meta.message ?? null,
    originalBytes: meta.originalBytes ?? null,
    outputBytes: meta.outputBytes ?? null,
    pageCount: meta.pageCount ?? null,
    skipped: meta.skipped ?? null,
    reason: meta.reason ?? null,
    checksum: meta.checksum ?? null,
    updatedAt: meta.updatedAt ?? null
  };

  return { productPath, compressedPath, thankYouPath, metadata };
}

function applyPdfToProject(project, patch) {
  if (!project) return {};
  
  const current = getPdf(project);
  
  const mergedProduct = patch.productPath !== undefined ? patch.productPath : current.productPath;
  const mergedCompressed = patch.compressedPath !== undefined ? patch.compressedPath : current.compressedPath;
  const mergedThankYou = patch.thankYouPath !== undefined ? patch.thankYouPath : current.thankYouPath;
  const mergedMetadata = { ...current.metadata, ...(patch.metadata || {}) };

  const updatePatch = {};

  const newPrintPdfJson = {
    ...((project.printPdfJson && typeof project.printPdfJson === 'object') ? project.printPdfJson : {}),
    ...mergedMetadata
  };

  if (mergedProduct !== undefined && mergedProduct !== null) newPrintPdfJson.productPdfPath = mergedProduct;
  if (mergedCompressed !== undefined && mergedCompressed !== null) newPrintPdfJson.compressedPdfPath = mergedCompressed;
  // The stamped thank-you PDF is gone: the thank-you page is generated as a normal page
  // image and ships inside the book. Existing values are still read so old projects load
  // unchanged, but nothing writes a new one.
  void mergedThankYou;

  updatePatch.printPdfJson = newPrintPdfJson;

  if (mergedProduct !== undefined && mergedProduct !== null) updatePatch.productPdfPath = mergedProduct;
  if (mergedCompressed !== undefined && mergedCompressed !== null) updatePatch.compressedPdfPath = mergedCompressed;

  if (project.tptListing && mergedProduct !== undefined && mergedProduct !== null) {
    updatePatch.tptListing = {
      ...project.tptListing,
      productPdfPath: mergedProduct
    };
  }

  // Allow deleting legacy root fields if canonical explicitly removes them.
  // Note: store.cjs ignores fields not in PROJECT_COLUMNS, but for cleanliness,
  // we emit explicit nulls to trigger deletion logic in the store if applicable.
  if (patch.productPath === null) {
    updatePatch.productPdfPath = null;
    if (project.tptListing) {
      updatePatch.tptListing = { ...project.tptListing };
      delete updatePatch.tptListing.productPdfPath;
    }
    delete newPrintPdfJson.productPdfPath;
  }
  if (patch.compressedPath === null) {
    updatePatch.compressedPdfPath = null;
    delete newPrintPdfJson.compressedPdfPath;
  }
  if (patch.thankYouPath === null) {
    delete newPrintPdfJson.thankYouPdfPath;
  }

  return updatePatch;
}

const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;
let fs;
if (isNode) {
  try {
    fs = require('fs');
  } catch (e) {}
}

function hasValidPdfFile(pathStr) {
  if (!pathStr || typeof pathStr !== 'string') return false;
  if (fs && typeof fs.existsSync === 'function') {
    if (!fs.existsSync(pathStr)) return false;
    try {
      const info = fs.statSync(pathStr);
      if (!info.isFile() || info.size <= 0) return false;
      const header = Buffer.alloc(Math.min(5, info.size));
      const fd = fs.openSync(pathStr, 'r');
      try {
        fs.readSync(fd, header, 0, header.length, 0);
      } finally {
        fs.closeSync(fd);
      }
      return header.toString('latin1').startsWith('%PDF-');
    } catch {
      return false;
    }
  }
  // Fallback for browser/renderer
  return true;
}

module.exports = {
  getPdf,
  applyPdfToProject,
  hasValidPdfFile
};
