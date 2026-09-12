'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const archiver = require('archiver');
const { PDFDocument } = require('pdf-lib');
const { verifyOverview, verifyExportZip } = require('../src/file-manager.cjs');

function createZip(zipPath, entries) {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    for (const entry of entries) {
      archive.append(Buffer.from(entry.contents || 'fixture'), { name: entry.name });
    }
    archive.finalize();
  });
}

function makeMp4(path) {
  const payload = Buffer.alloc(12_000, 0);
  Buffer.from('\x00\x00\x00\x18ftypisom').copy(payload, 0);
  writeFileSync(path, payload);
}

async function makeExportFixture({ withSeo = true, mockupCount = 4, withVideo = true } = {}) {
  const outputDir = mkdtempSync(join(tmpdir(), 'versa-export-verifier-'));
  const slug = 'Verifier-Book';
  const pdfDir = join(outputDir, 'product-reference');
  mkdirSync(pdfDir, { recursive: true });
  const pdfPath = join(pdfDir, `${slug}.pdf`);
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]);
  writeFileSync(pdfPath, await pdf.save());
  writeFileSync(join(outputDir, `${slug}.pptx`), 'pptx fixture');
  writeFileSync(join(outputDir, `${slug}.docx`), 'docx fixture');

  const thumbnailPaths = [];
  if (mockupCount > 0) {
    const mockupDir = join(outputDir, 'tpt-thumbnails');
    mkdirSync(mockupDir, { recursive: true });
    for (let index = 1; index <= mockupCount; index += 1) {
      const mockupPath = join(mockupDir, `thumbnail_${index}.jpg`);
      writeFileSync(mockupPath, `mockup fixture ${index}`);
      thumbnailPaths.push(mockupPath);
    }
  }

  let videoPath = null;
  if (withVideo) {
    const videoDir = join(outputDir, 'tpt-preview');
    mkdirSync(videoDir, { recursive: true });
    videoPath = join(videoDir, 'tpt-preview.mp4');
    makeMp4(videoPath);
  }

  const project = {
    name: 'Verifier Book',
    theme: 'Verifier Theme',
    outputDir,
    productPdfPath: pdfPath,
    compressedPdfPath: pdfPath,
    tptListing: {
      title: 'Verifier Book',
      seoText: withSeo ? 'TITLE\nVerifier Book\n\nDESCRIPTION\nFixture' : '',
      thumbnailPaths,
      videoPreviewPath: videoPath
    }
  };
  return { outputDir, project, slug };
}

test('overview verifier accepts the durable state used by the overview runner', () => {
  assert.equal(verifyOverview({ name: 'Valid Book', theme: 'Valid Theme' }), true);
});

test('overview verifier rejects a missing project or incomplete durable state', () => {
  assert.throws(() => verifyOverview(null), { code: 'PROJECT_NOT_FOUND' });
  assert.throws(() => verifyOverview({ name: 'Valid Book', theme: '   ' }), { code: 'PROJECT_OVERVIEW_INCOMPLETE' });
  assert.throws(() => verifyOverview({ name: '', theme: 'Valid Theme' }), { code: 'PROJECT_OVERVIEW_INCOMPLETE' });
});

test('unrelated state does not affect overview verification', () => {
  assert.equal(verifyOverview({
    name: 'Valid Book',
    theme: 'Valid Theme',
    unrelated: null,
    stepOverviewStatus: 'completed'
  }), true);
});

test('export verifier accepts a valid ZIP whose entries exactly match the manifest', async () => {
  const { outputDir, project, slug } = await makeExportFixture();
  try {
    const zipPath = join(outputDir, `${slug}.zip`);
    await createZip(zipPath, [
      { name: `${slug}.pdf` },
      { name: `${slug}.pptx` },
      { name: `${slug}.docx` },
      { name: `${slug}_video.mp4` },
      { name: 'listing_details.txt' },
      { name: 'mockups/mockup_01.jpg' },
      { name: 'mockups/mockup_02.jpg' },
      { name: 'mockups/mockup_03.jpg' },
      { name: 'mockups/mockup_04.jpg' }
    ]);
    assert.equal(verifyExportZip(project), zipPath);
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test('export verifier rejects a missing ZIP', async () => {
  const { outputDir, project } = await makeExportFixture();
  try {
    assert.throws(() => verifyExportZip(project), { code: 'EXPORT_ZIP_MISSING' });
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test('export verifier rejects a zero-byte ZIP', async () => {
  const { outputDir, project, slug } = await makeExportFixture();
  try {
    writeFileSync(join(outputDir, `${slug}.zip`), '');
    assert.throws(() => verifyExportZip(project), { code: 'EXPORT_ZIP_EMPTY' });
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test('export verifier rejects a corrupted ZIP', async () => {
  const { outputDir, project, slug } = await makeExportFixture();
  try {
    writeFileSync(join(outputDir, `${slug}.zip`), 'not a ZIP archive');
    assert.throws(() => verifyExportZip(project), { code: 'EXPORT_ZIP_CORRUPT' });
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test('export verifier rejects missing and unexpected manifest entries', async () => {
  const { outputDir, project, slug } = await makeExportFixture();
  try {
    const zipPath = join(outputDir, `${slug}.zip`);
    await createZip(zipPath, [
      { name: `${slug}.pdf` },
      { name: `${slug}.pptx` },
      { name: `${slug}_video.mp4` },
      { name: 'listing_details.txt' },
      { name: 'mockups/mockup_01.jpg' },
      { name: 'mockups/mockup_02.jpg' },
      { name: 'mockups/mockup_03.jpg' },
      { name: 'mockups/mockup_04.jpg' },
      { name: 'prompts.txt' }
    ]);
    assert.throws(() => verifyExportZip(project), (error) => {
      assert.equal(error.code, 'EXPORT_MANIFEST_MISMATCH');
      assert.ok(error.expected.includes(`${slug}.docx`));
      assert.ok(error.actual.includes('prompts.txt'));
      return true;
    });
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test('export verifier requires video and exactly four mockups, but not SEO', async () => {
  const { outputDir, project, slug } = await makeExportFixture({ mockupCount: 3, withVideo: false, withSeo: false });
  try {
    const zipPath = join(outputDir, `${slug}.zip`);
    await createZip(zipPath, [
      { name: `${slug}.pdf` },
      { name: `${slug}.pptx` },
      { name: `${slug}.docx` },
      { name: 'mockups/mockup_01.jpg' },
      { name: 'mockups/mockup_02.jpg' },
      { name: 'mockups/mockup_03.jpg' }
    ]);
    assert.equal(existsSync(zipPath), true);
    assert.throws(() => verifyExportZip(project), (error) => {
      assert.equal(error.code, 'EXPORT_MANIFEST_INCOMPLETE');
      const missingTypes = error.missing.map((item) => item.type.toUpperCase());
      assert.ok(missingTypes.includes('VIDEO'));
      assert.ok(missingTypes.includes('MOCKUPS'));
      // The listing copy is read in the app and pasted into TPT; the buyer never
      // receives it, so a missing one cannot hold back a finished book.
      assert.ok(!missingTypes.includes('SEO'));
      return true;
    });
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});
