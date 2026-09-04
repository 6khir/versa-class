'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MINIMAL_PDF = `%PDF-1.1
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj
trailer<</Root 1 0 R>>
%%EOF
`;

test('compressPdf keeps page count and skips a PDF with no raster images', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-'));
  const pdfPath = path.join(tmp, 'blank.pdf');
  fs.writeFileSync(pdfPath, MINIMAL_PDF);
  try {
    const { compressPdf, pdfPageCount } = await import('../src/compress-pdf.mjs');
    const result = await compressPdf(pdfPath);
    assert.equal(result.path, pdfPath);
    assert.equal(result.skipped, true);
    assert.match(String(result.reason), /no raster images/i);
    assert.equal(result.originalBytes, fs.statSync(pdfPath).size);
    assert.equal(result.inputPageCount, 1);
    assert.equal(result.outputPageCount, 1);
    assert.equal(await pdfPageCount(pdfPath), 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('compressPdf does not drop pages on a multi-page raster PDF', async () => {
  const { PDFDocument } = require('pdf-lib');
  const sharp = require('sharp');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-pages-'));
  const pdfPath = path.join(tmp, 'book.pdf');
  try {
    const pdf = await PDFDocument.create();
    for (let index = 0; index < 8; index += 1) {
      const jpeg = await sharp({
        create: {
          width: 600,
          height: 800,
          channels: 3,
          background: { r: 30 + index * 8, g: 80, b: 140 }
        }
      }).jpeg({ quality: 95 }).toBuffer();
      const image = await pdf.embedJpg(jpeg);
      const page = pdf.addPage([612, 792]);
      page.drawImage(image, { x: 0, y: 0, width: 612, height: 792 });
    }
    fs.writeFileSync(pdfPath, Buffer.from(await pdf.save()));
    const { compressPdf, pdfPageCount } = await import('../src/compress-pdf.mjs');
    const inputCount = await pdfPageCount(pdfPath);
    assert.equal(inputCount, 8);
    const result = await compressPdf(pdfPath);
    const outputCount = await pdfPageCount(result.path);
    assert.equal(outputCount, inputCount);
    assert.equal(result.inputPageCount, 8);
    assert.equal(result.outputPageCount, 8);
    if (!result.skipped) {
      assert.notEqual(result.path, pdfPath);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
