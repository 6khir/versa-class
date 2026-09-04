const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { Jimp } = require('jimp');

const {
  collectProductPageImagePaths,
  normalizePngToPage,
  selectThumbnailPagePaths,
  selectMockupAttachmentPaths,
  isRejectedMockupAttachment,
  writeImagesDocx,
  stageThumbnailPageTargets
} = require('../src/file-manager.cjs');
const {
  buildTptThumbnailImagePrompt,
  buildTptThumbnailRetryPrompt
} = require('../src/prompt-builder.cjs');

async function writePng(destPath, color) {
  const image = new Jimp({ width: 120, height: 160, color });
  writeFileSync(destPath, await image.getBuffer('image/png'));
  return destPath;
}

test('collects only raster page images and ignores the product PDF', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thumb-pages-'));
  try {
    const pngPath = await writePng(join(dir, 'page_01.png'), 0xFF0000FF);
    const pdfPath = join(dir, 'product.pdf');
    writeFileSync(pdfPath, '%PDF-1.7');

    const collected = collectProductPageImagePaths([
      { outputPath: pngPath },
      { outputPath: pdfPath },
      { outputPath: join(dir, 'missing.png') },
      { outputPath: null }
    ]);

    assert.deepEqual(collected, [pngPath]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('selects four page targets per thumbnail and wraps around short products', async () => {
  const pages = ['a.png', 'b.png', 'c.png'];
  assert.deepEqual(selectThumbnailPagePaths(pages, 0), ['a.png', 'b.png', 'c.png', 'a.png']);
  assert.equal(selectThumbnailPagePaths([], 0).length, 0);
});

test('normalizePngToPage uses Jimp like Book Automation and does not pass Sharp kernel bicubic', async () => {
  const image = new Jimp({ width: 400, height: 560, color: 0xFF336699 });
  const png = await image.getBuffer('image/png');
  const result = await normalizePngToPage(png, 'A4', 'portrait');
  assert.equal(result.width, 2480);
  assert.equal(result.height, 3508);
  assert.equal(result.dpi, 300);
  assert.ok(Buffer.isBuffer(result.png));
  assert.ok(result.png.length > 10_000);
});

test('staging fails loudly when no page images exist', async () => {
  await assert.rejects(
    () => stageThumbnailPageTargets({ pagePaths: [], destDir: join(tmpdir(), 'never'), thumbnailIndex: 0 }),
    (error) => error.code === 'THUMBNAIL_PAGES_MISSING'
  );
});

test('mockup attachments prefer real page images and never attach the product PDF', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mockup-attach-'));
  try {
    const pngPath = await writePng(join(dir, 'page_01.png'), 0xFF0000FF);
    const pdfPath = join(dir, 'product.pdf');
    const docxPath = join(dir, 'book.docx');
    writeFileSync(pdfPath, '%PDF-1.7');
    writeFileSync(docxPath, 'PK');

    assert.equal(isRejectedMockupAttachment(pdfPath), true);
    assert.equal(isRejectedMockupAttachment(join(dir, 'Thumbnail-1-contact-sheet.png')), true);
    assert.equal(isRejectedMockupAttachment(pngPath), false);

    assert.deepEqual(selectMockupAttachmentPaths({
      jobs: [{ outputPath: pngPath }, { outputPath: pdfPath }],
      outputDir: dir,
      thumbnailIndex: 0
    }), [pngPath]);

    assert.deepEqual(selectMockupAttachmentPaths({
      jobs: [{ outputPath: pdfPath }],
      outputDir: dir
    }), [docxPath]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('staging mockup pages omits the contact sheet from Gemini attachments', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mockup-stage-'));
  try {
    const pages = [
      await writePng(join(dir, 'a.png'), 0xFF0000FF),
      await writePng(join(dir, 'b.png'), 0x00FF00FF)
    ];
    const staged = await stageThumbnailPageTargets({
      pagePaths: pages,
      destDir: join(dir, 'out'),
      thumbnailIndex: 0
    });
    assert.equal(staged.pageFiles.length, 4);
    assert.equal(staged.attachmentPaths.includes(staged.contactSheetPath), false);
    assert.ok(staged.attachmentPaths.every((filePath) => !isRejectedMockupAttachment(filePath)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writes a Word document of page images for Gemini when PDF cannot be used', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mockup-docx-'));
  try {
    const pages = [
      await writePng(join(dir, 'page-1.png'), 0xFF3366FF),
      await writePng(join(dir, 'page-2.png'), 0x33FF66FF)
    ];
    const destPath = join(dir, 'book.docx');
    await writeImagesDocx(pages, destPath);
    const zip = readFileSync(destPath);
    assert.equal(zip[0], 0x50);
    assert.equal(zip[1], 0x4B);
    assert.match(zip.toString('binary'), /word\/document\.xml/);
    assert.match(zip.toString('binary'), /word\/media\/image1\.jpg/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('thumbnail prompts demand a single hero mockup and forbid collages', () => {
  const prompt = buildTptThumbnailImagePrompt({ index: 0, title: 'Alphabet Tracing', brief: 'Show the practice' });
  assert.match(prompt, /exactly ONE single 2000x2000 hero listing graphic/i);
  assert.match(prompt, /Do NOT create a collage/i);
  assert.match(prompt, /contact sheet/i);
  assert.doesNotMatch(prompt, /2x2 PNG contact sheet/i);
  assert.doesNotMatch(prompt, /page fan vs station grid/i);
  assert.doesNotMatch(prompt, /4-6 unaltered pages/i);

  const skills = buildTptThumbnailImagePrompt({ index: 1, title: 'Alphabet Tracing', brief: 'Skills' });
  assert.match(skills, /ONE unaltered page/i);
  assert.doesNotMatch(skills, /4-6 unaltered pages/i);
  assert.match(prompt, /REAL product/i);
  assert.match(prompt, /exact pages/i);
  assert.doesNotMatch(prompt, /Do not ask me to upload page images/i);

  const retry = buildTptThumbnailRetryPrompt({ index: 0 });
  assert.match(retry, /No collage/i);
  assert.match(retry, /exactly one polished 2000x2000 TPT hero thumbnail/i);
});
