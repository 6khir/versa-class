'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');
const {
  FileManager,
  allInteriorPagesComplete,
  compressedPrintPdfDest,
  prepareCanvaImportPdf,
  printPdfPageChecksum
} = require('../src/file-manager.cjs');

async function writePagePng(filePath, tint = 40) {
  writeFileSync(filePath, await sharp({
    create: {
      width: 160,
      height: 220,
      channels: 3,
      background: { r: tint, g: 90, b: 160 }
    }
  }).png().toBuffer());
}

function sampleProject(dir, jobs, stats) {
  return {
    name: 'Interior Print PDF',
    theme: 'Test',
    format: 'A4',
    orientation: 'portrait',
    outputDir: dir,
    stats,
    jobs
  };
}

test('incomplete interior pages do not convert or compress a print PDF', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'versa-print-pdf-incomplete-'));
  let compressCalls = 0;
  try {
    const pagePath = join(dir, 'page-001.png');
    await writePagePng(pagePath);
    const project = sampleProject(dir, [{
      pageNumber: 1,
      status: 'complete',
      outputPath: pagePath,
      pageLabel: 'Page 1',
      title: 'Cover',
      fileName: 'page-001.png',
      prompt: 'test'
    }, {
      pageNumber: 2,
      status: 'pending',
      outputPath: null,
      pageLabel: 'Page 2',
      title: 'Inside',
      fileName: 'page-002.png',
      prompt: 'test'
    }], { complete: 1, total: 2 });
    assert.equal(allInteriorPagesComplete(project), false);
    const manager = new FileManager({ nativeImage: {} });
    await assert.rejects(
      () => manager.buildPrintPdfPackage(project, {
        compressPdf: async (inputPath) => {
          compressCalls += 1;
          return { path: inputPath, skipped: true };
        }
      }),
      /locked until every page is complete|BOOK_INCOMPLETE/i
    );
    assert.equal(compressCalls, 0);
    assert.equal(existsSync(compressedPrintPdfDest(dir)), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('after the last interior page completes, the compressed print PDF exists', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'versa-print-pdf-complete-'));
  let compressCalls = 0;
  try {
    const jobs = [];
    for (let index = 1; index <= 2; index += 1) {
      const pagePath = join(dir, `page-00${index}.png`);
      await writePagePng(pagePath, 30 + index * 20);
      jobs.push({
        pageNumber: index,
        status: 'complete',
        outputPath: pagePath,
        pageLabel: `Page ${index}`,
        title: `Page ${index}`,
        fileName: `page-00${index}.png`,
        prompt: 'test'
      });
    }
    const project = sampleProject(dir, jobs, { complete: 2, total: 2 });
    assert.equal(allInteriorPagesComplete(project), true);
    const checksum = printPdfPageChecksum(jobs);
    const manager = new FileManager({ nativeImage: {} });
    const pkg = await manager.buildPrintPdfPackage(project, {
      compressPdf: async (inputPath) => {
        compressCalls += 1;
        const size = statSync(inputPath).size;
        return {
          path: inputPath,
          originalBytes: size,
          outputBytes: size,
          skipped: true,
          reason: 'test skip',
          inputPageCount: 2,
          outputPageCount: 2
        };
      }
    });
    assert.equal(compressCalls, 1);
    assert.equal(pkg.checksum, checksum);
    assert.equal(existsSync(pkg.productPdfPath), true);
    assert.equal(existsSync(pkg.compressedPdfPath), true);
    assert.equal(pkg.compressedPdfPath, compressedPrintPdfDest(dir, project));
    const pdf = await PDFDocument.load(readFileSync(pkg.compressedPdfPath));
    assert.equal(pdf.getPageCount(), 2);

    const reused = await prepareCanvaImportPdf(
      pkg.compressedPdfPath,
      dir,
      'A4',
      'portrait',
      2,
      jobs.map((job) => job.outputPath)
    );
    assert.equal(reused, pkg.compressedPdfPath);
    assert.equal(compressCalls, 1, 'Canva import must not compress again');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Canva import reuses the Interior PDF with zero extra compressPdf calls', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'versa-print-pdf-reuse-'));
  let compressCalls = 0;
  const compressPdf = async (inputPath) => {
    compressCalls += 1;
    const size = statSync(inputPath).size;
    return {
      path: inputPath,
      originalBytes: size,
      outputBytes: size,
      skipped: true,
      reason: 'test skip'
    };
  };
  try {
    const pagePath = join(dir, 'page-001.png');
    await writePagePng(pagePath, 80);
    const project = sampleProject(dir, [{
      pageNumber: 1,
      status: 'complete',
      outputPath: pagePath,
      pageLabel: 'Page 1',
      title: 'Cover',
      fileName: 'page-001.png',
      prompt: 'test'
    }], { complete: 1, total: 1 });
    const manager = new FileManager({ nativeImage: {} });
    const pkg = await manager.buildPrintPdfPackage(project, { compressPdf });
    assert.equal(compressCalls, 1);
    const importPath = await prepareCanvaImportPdf(pkg.compressedPdfPath, dir, 'A4', 'portrait', 1, [pagePath]);
    const importAgain = await prepareCanvaImportPdf(pkg.productPdfPath, dir, 'A4', 'portrait', 1, [pagePath]);
    assert.equal(importPath, compressedPrintPdfDest(dir, project));
    assert.equal(importAgain, compressedPrintPdfDest(dir, project));
    assert.equal(compressCalls, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('queue completion and Canva paths keep conversion in Interior', () => {
  const { readFileSync: read } = require('node:fs');
  const { join: joinPath } = require('node:path');
  const root = joinPath(__dirname, '..');
  const queue = read(joinPath(root, 'src/queue-engine.cjs'), 'utf8');
  const main = read(joinPath(root, 'src/main.cjs'), 'utf8');
  const canva = read(joinPath(root, 'src/browser-controller.cjs'), 'utf8');
  const fileManager = read(joinPath(root, 'src/file-manager.cjs'), 'utf8');
  const renderer = read(joinPath(root, 'renderer/renderer.js'), 'utf8');
  const html = read(joinPath(root, 'renderer/index.html'), 'utf8');

  assert.match(queue, /this\.emit\('complete', \{ projectId \}\)/);
  assert.match(queue, /convert and compress the print PDF in Interior/);
  assert.match(main, /queue\.on\('complete'/);
  assert.match(main, /await ensureProductPdf\(projectId, \{ force: true \}\)/);
  assert.match(main, /buildPrintPdfPackage/);
  assert.match(main, /finishPrintPdf/);
  assert.match(main, /compressedPdfPath/);
  assert.match(main, /Using the print PDF prepared in Interior/);
  assert.doesNotMatch(main, /interior:[\s\S]{0,400}runCanvaEditableForProject/);
  assert.match(fileManager, /async buildPrintPdfPackage/);
  assert.match(fileManager, /Does not rasterize pages and does not call compressPdf/);
  assert.doesNotMatch(canva, /#canvaImportPdfAsDesign[\s\S]{0,8000}compressPdf/);
  assert.match(canva, /Using the prepared print PDF/);
  assert.match(html, /id="print-pdf-status"/);
  assert.match(html, /data-workspace-pane="interior"/);
  assert.match(html, /Conversion and compression start after every interior page is finished/);
  assert.match(renderer, /function renderPrintPdfStatus/);
  assert.match(renderer, /Using the print PDF prepared in Interior/);
});
