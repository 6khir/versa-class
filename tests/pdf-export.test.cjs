'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');
const {
  FileManager,
  PRINT_PDF_JPEG,
  encodePrintPdfJpeg
} = require('../src/file-manager.cjs');

test('print PDF compression keeps full page pixels and high-quality 4:4:4 JPEG', async () => {
  assert.equal(PRINT_PDF_JPEG.quality, 90);
  assert.equal(PRINT_PDF_JPEG.chromaSubsampling, '4:4:4');
  const png = await sharp({
    create: {
      width: 240,
      height: 320,
      channels: 3,
      background: { r: 248, g: 244, b: 236 }
    }
  }).png().toBuffer();
  const jpeg = await encodePrintPdfJpeg(png, 240, 320);
  assert.equal(jpeg[0], 0xff);
  assert.equal(jpeg[1], 0xd8);
  const meta = await sharp(jpeg).metadata();
  assert.equal(meta.width, 240);
  assert.equal(meta.height, 320);
  assert.ok(jpeg.length < png.length);
});

test('compiling a book PDF embeds compressed JPEGs without nativeImage quality 98', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'versa-pdf-'));
  try {
    const pagePath = join(dir, 'page-001.png');
    writeFileSync(pagePath, await sharp({
      create: {
        width: 160,
        height: 220,
        channels: 3,
        background: { r: 40, g: 90, b: 160 }
      }
    }).png().toBuffer());
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
    const page = pdf.getPage(0);
    assert.ok(Math.abs(page.getWidth() - 595.28) < 1);
    assert.ok(statSize(outputPath) < 250_000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function statSize(filePath) {
  return require('node:fs').statSync(filePath).size;
}
