'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { PDFDocument, PDFName } = require('pdf-lib');
const {
  FileManager,
  bookFileCode,
  defaultThankYouTemplatePath,
  stampThankYouTemplateLink,
  thankYouPdfDest
} = require('../src/file-manager.cjs');

function readUris(bytes) {
  return PDFDocument.load(bytes, { ignoreEncryption: true }).then((pdf) => {
    const urls = [];
    for (const page of pdf.getPages()) {
      const annots = page.node.Annots();
      if (!annots) continue;
      const list = pdf.context.lookup(annots);
      const refs = typeof list?.asArray === 'function' ? list.asArray() : [];
      for (const ref of refs) {
        const dict = pdf.context.lookup(ref);
        const actionRef = dict?.get?.(PDFName.of('A'));
        if (!actionRef) continue;
        const action = pdf.context.lookup(actionRef);
        const uri = action?.get?.(PDFName.of('URI'));
        if (uri) urls.push(String(uri));
      }
    }
    return urls;
  });
}

test('book file code prefers the listing title then the book name', () => {
  assert.equal(bookFileCode(null), 'book');
  assert.equal(
    bookFileCode('Visual Schedule & Positive Behavior Flipbook'),
    'Visual-Schedule-Positive-Behavior-Flipbook'
  );
  assert.equal(
    bookFileCode({
      name: 'Untitled Book',
      tptListing: { title: 'Creative Classroom Greetings Editable Morning Goodbye Choice Posters' }
    }),
    'Creative-Classroom-Greetings-Editable-Morning-Goodbye-Choice-Posters'
  );
});

test('stamping the default thank-you PDF replaces the Click here Canva link', async () => {
  const source = defaultThankYouTemplatePath();
  assert.equal(existsSync(source), true);
  const original = await readUris(readFileSync(source));
  assert.ok(original.some((url) => /canva\.link/i.test(url)), original.join(' | '));
  const dir = mkdtempSync(join(tmpdir(), 'versa-thank-you-'));
  try {
    const dest = thankYouPdfDest(dir, { name: 'Creative Classroom Greetings' });
    const link = 'https://www.canva.com/design/DAFAKE123456/SHARETOKEN1/view?template=1';
    await stampThankYouTemplateLink(source, dest, link);
    assert.equal(existsSync(dest), true);
    assert.match(dest, /Creative-Classroom-Greetings-thank-you\.pdf$/);
    const stamped = await readUris(readFileSync(dest));
    assert.ok(stamped.every((url) => url.includes(link)), stamped.join(' | '));
    assert.equal(stamped.some((url) => /gbahmv60drok1e8/i.test(url)), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FileManager writes the stamped thank-you PDF next to the book files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'versa-thank-you-export-'));
  try {
    const manager = new FileManager({ nativeImage: {} });
    const path = await manager.exportThankYouPdf(
      { name: 'Morning Greeting System', outputDir: dir },
      'https://www.canva.com/design/DAFAKE123456/view?template=1'
    );
    assert.equal(existsSync(path), true);
    assert.match(path, /Morning-Greeting-System-thank-you\.pdf$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('editable Canva completion stamps the thank-you PDF automatically', () => {
  const main = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/main.cjs'), 'utf8');
  assert.match(main, /exportThankYouPdf/);
  assert.match(main, /ensureThankYouPdfForProject/);
  assert.match(main, /Thank-you PDF stamped with the Canva template link/);
});
