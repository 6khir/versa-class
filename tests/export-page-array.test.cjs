'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');
const { FileManager } = require('../src/file-manager.cjs');
const {
  buildExportPageArray,
  assertExportPageReady
} = require('../src/editable-production.cjs');

async function writePng(filePath, tint) {
  writeFileSync(filePath, await sharp({
    create: {
      width: 120,
      height: 160,
      channels: 3,
      background: { r: tint, g: 80, b: 140 }
    }
  }).png().toBuffer());
}

function workDir() {
  return mkdtempSync(join(tmpdir(), 'versa-assembly-'));
}

async function fourPageProject(dir, { interiorRaw = false, residual = false, overlayDirty = false } = {}) {
  const jobs = [];
  for (let pageNumber = 1; pageNumber <= 4; pageNumber += 1) {
    const processed = join(dir, `page_${pageNumber}_blank.png`);
    const raw = join(dir, `page_${pageNumber}_blank.raw.png`);
    const isInterior = pageNumber === 2 || pageNumber === 3;
    await writePng(raw, 200);
    if (!(interiorRaw && isInterior)) {
      await writePng(processed, 30 + pageNumber * 20);
    }
    const job = {
      pageNumber,
      pageLabel: `Page ${pageNumber}`,
      title: pageNumber === 1 ? 'Cover' : pageNumber === 4 ? 'Back' : `Interior ${pageNumber}`,
      fileName: `page_${pageNumber}_blank.png`,
      outputPath: interiorRaw && isInterior ? raw : processed,
      status: 'complete',
      textOverlays: overlayDirty && isInterior ? [{ text: 'Name' }] : [],
      lastErrorCode: residual && isInterior ? 'TEXT_INPAINT_RESIDUAL' : null
    };
    if (isInterior && !interiorRaw && !residual && overlayDirty) {
      writeFileSync(join(dir, `page_${pageNumber}_blank.inpaint-ok.json`), JSON.stringify({
        ok: false,
        code: 'TEXT_INPAINT_RESIDUAL',
        residual_count: 2
      }));
    }
    if (isInterior && !interiorRaw && !residual && !overlayDirty) {
      writeFileSync(join(dir, `page_${pageNumber}_blank.inpaint-ok.json`), JSON.stringify({
        ok: true,
        residual_count: 0
      }));
    }
    jobs.push(job);
  }
  return {
    name: 'Assembly Sample',
    theme: 'Test',
    format: 'A4',
    orientation: 'portrait',
    outputDir: dir,
    stats: { complete: 4, total: 4 },
    jobs
  };
}

test('export array is raw cover + rebuilt interiors + raw back', async () => {
  const dir = workDir();
  try {
    const project = await fourPageProject(dir);
    const pages = buildExportPageArray(project);
    assert.equal(pages.length, 4);
    assert.equal(pages[0].role, 'cover');
    assert.equal(pages[1].role, 'interior');
    assert.equal(pages[2].role, 'interior');
    assert.equal(pages[3].role, 'back');
    assert.match(pages[0].path, /\.raw\.png$/i);
    assert.match(pages[3].path, /\.raw\.png$/i);
    assert.doesNotMatch(pages[1].path, /\.raw\.png$/i);
    assert.doesNotMatch(pages[2].path, /\.raw\.png$/i);
    assert.equal(pages[1].rebuilt, true);
    assert.equal(pages[2].rebuilt, true);
    pages.forEach((page) => assertExportPageReady(page));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('assembly halts when an interior page has only a raw flat file', async () => {
  const dir = workDir();
  try {
    const project = await fourPageProject(dir, { interiorRaw: true });
    assert.throws(
      () => buildExportPageArray(project),
      (error) => error.code === 'ASSEMBLY_PAGE_MISSING'
        || error.code === 'ASSEMBLY_RAW_FALLBACK_FORBIDDEN'
        || error.code === 'ASSEMBLY_PAGE_NOT_REBUILT'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('assembly halts when an overlay interior is not rebuilt', async () => {
  const dir = workDir();
  try {
    const project = await fourPageProject(dir);
    for (const job of project.jobs) {
      if (job.pageNumber === 2 || job.pageNumber === 3) {
        job.textOverlays = [{ text: 'Name: ________' }];
        job.rebuilt = false;
      }
    }
    require('node:fs').rmSync(join(dir, 'page_2_blank.inpaint-ok.json'), { force: true });
    require('node:fs').rmSync(join(dir, 'page_3_blank.inpaint-ok.json'), { force: true });
    assert.throws(
      () => buildExportPageArray(project),
      { code: 'ASSEMBLY_PAGE_NOT_REBUILT' }
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('assembly halts on TEXT_INPAINT_RESIDUAL interiors', async () => {
  const dir = workDir();
  try {
    const project = await fourPageProject(dir, { residual: true, overlayDirty: true });
    assert.throws(
      () => buildExportPageArray(project),
      { code: 'TEXT_INPAINT_RESIDUAL' }
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PDF export uses the strict assembly array and still compiles a 1-page book', async () => {
  const dir = workDir();
  try {
    const pagePath = join(dir, 'page-001.png');
    await writePng(pagePath, 40);
    const manager = new FileManager({ nativeImage: {} });
    const outputPath = await manager.exportPdf({
      name: 'Compression Sample',
      theme: 'Test',
      format: 'A4',
      orientation: 'portrait',
      outputDir: dir,
      stats: { complete: 1, total: 1 },
      jobs: [{
        outputPath: pagePath,
        pageNumber: 1,
        pageLabel: 'Page 1',
        title: 'Cover',
        fileName: 'page-001.png',
        prompt: 'test'
      }]
    });
    const pdf = await PDFDocument.load(readFileSync(outputPath));
    assert.equal(pdf.getPageCount(), 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PDF export compiles a 4-page book from cover/raw + rebuilt interiors + back/raw', async () => {
  const dir = workDir();
  try {
    const project = await fourPageProject(dir);
    const manager = new FileManager({ nativeImage: {} });
    const outputPath = await manager.exportPdf(project);
    const pdf = await PDFDocument.load(readFileSync(outputPath));
    assert.equal(pdf.getPageCount(), 4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('file-manager and pptx assembler consume the export array', () => {
  const fileManager = readFileSync(join(__dirname, '..', 'src', 'file-manager.cjs'), 'utf8');
  const assembler = readFileSync(join(__dirname, '..', 'src', 'pptx-assembler.cjs'), 'utf8');
  assert.match(fileManager, /buildExportPageArray/);
  assert.match(fileManager, /for \(const page of exportPages\)/);
  assert.match(assembler, /buildExportPageArray\(project\)/);
  assert.match(assembler, /assertBlankMasterClean\(blankPath, job\)/);
});
