'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} = require('node:fs');
const { tmpdir } = require('node:os');
const { basename, join } = require('node:path');
const { execFileSync } = require('node:child_process');
const sharp = require('sharp');
const {
  FileManager,
  bookFileCode,
  buildFinalExportManifest,
  assertFinalExportManifestComplete,
  writeFinalExportPackageFromManifest,
  materializeFinalExportSeoFile
} = require('../src/file-manager.cjs');

async function makePng(filePath, color = { r: 40, g: 90, b: 160 }) {
  writeFileSync(filePath, await sharp({
    create: {
      width: 120,
      height: 160,
      channels: 3,
      background: color
    }
  }).png().toBuffer());
}

async function makeProjectFixture({
  withVideo = true,
  withSeo = true,
  withMockups = true,
  withPdfSources = true,
  withCompetitor = true,
  withInteriorExtras = true
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'versa-export-manifest-'));
  const pagePath = join(dir, 'page-001.png');
  await makePng(pagePath);

  const mockupDir = join(dir, 'tpt-thumbnails');
  mkdirSync(mockupDir, { recursive: true });
  const mockupPaths = [];
  if (withMockups) {
    for (let index = 1; index <= 4; index += 1) {
      const mockupPath = join(mockupDir, `thumbnail_${index}.jpg`);
      writeFileSync(mockupPath, await sharp({
        create: {
          width: 80,
          height: 80,
          channels: 3,
          background: { r: 200, g: 120, b: 40 }
        }
      }).jpeg().toBuffer());
      mockupPaths.push(mockupPath);
    }
  }

  if (withCompetitor) {
    const competitorDir = join(dir, 'competitor-mockups');
    mkdirSync(competitorDir, { recursive: true });
    await makePng(join(competitorDir, 'competitor-1.png'), { r: 10, g: 10, b: 10 });
  }

  if (withInteriorExtras) {
    writeFileSync(join(dir, 'prompts.txt'), 'secret prompts');
    writeFileSync(join(dir, 'debug.log'), 'internal log');
    mkdirSync(join(dir, 'engine-diagnostics'), { recursive: true });
    writeFileSync(join(dir, 'engine-diagnostics', 'trace.json'), '{}');
  }

  let videoPath = null;
  if (withVideo) {
    const videoDir = join(dir, 'tpt-preview');
    mkdirSync(videoDir, { recursive: true });
    videoPath = join(videoDir, 'tpt-preview.mp4');
    // Minimal fake "mp4-like" payload with ftyp marker and enough bytes.
    const payload = Buffer.alloc(12_000, 0);
    Buffer.from('....ftypisom').copy(payload, 0);
    writeFileSync(videoPath, payload);
  }

  const seoText = withSeo
    ? 'TITLE\nManifest Book\n\nDESCRIPTION\nA complete pack.\n\nTAGS\nmath, reading'
    : '';

  const project = {
    name: 'Manifest Book',
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
      prompt: 'test',
      status: 'complete'
    }],
    tptListing: {
      title: 'Manifest Book',
      seoText,
      videoPreviewPath: videoPath,
      thumbnailPaths: mockupPaths,
      competitorIgnored: true
    },
    competitorMockups: withCompetitor
      ? { images: [{ path: join(dir, 'competitor-mockups', 'competitor-1.png') }] }
      : null,
    productPdfPath: null,
    compressedPdfPath: null
  };

  if (!withPdfSources) {
    // Leave generators to build from page raster.
  }

  return { dir, project, pagePath, mockupPaths, videoPath };
}

function listZipEntries(zipPath) {
  const output = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' });
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}

function listPackageFiles(rootDir) {
  const out = [];
  const walk = (dir, prefix = '') => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (require('node:fs').statSync(full).isDirectory()) walk(full, rel);
      else out.push(rel.replace(/\\/g, '/'));
    }
  };
  walk(rootDir);
  return out.sort();
}

test('product code naming uses bookFileCode for final filenames', () => {
  const code = bookFileCode({ name: 'Manifest Book', tptListing: { title: 'Manifest Book' } });
  assert.equal(code, 'Manifest-Book');
  const manifest = buildFinalExportManifest({
    name: 'Manifest Book',
    tptListing: { title: 'Manifest Book', seoText: 'TITLE\nX', videoPreviewPath: null, thumbnailPaths: [] }
  }, {
    pdfPath: '/tmp/a.pdf',
    pptxPath: '/tmp/a.pptx',
    docxPath: '/tmp/a.docx'
  });
  assert.equal(manifest.artifacts.find((item) => item.type === 'pdf').finalName, 'Manifest-Book.pdf');
  assert.equal(manifest.artifacts.find((item) => item.type === 'pptx').finalName, 'Manifest-Book.pptx');
  assert.equal(manifest.artifacts.find((item) => item.type === 'docx').finalName, 'Manifest-Book.docx');
  assert.equal(manifest.artifacts.find((item) => item.type === 'video').finalName, 'Manifest-Book_video.mp4');
  assert.equal(manifest.artifacts.find((item) => item.type === 'seo').finalName, 'listing_details.txt');
});

test('editable products do not require a print PDF in the export pack', () => {
  const listing = { title: 'Editable Book', seoText: 'TITLE\nX', videoPreviewPath: null, thumbnailPaths: [] };
  const sources = { pdfPath: null, pptxPath: '/tmp/a.pptx', docxPath: '/tmp/a.docx' };
  const pdfOf = (format) => buildFinalExportManifest({ name: 'Editable Book', productFormat: format, tptListing: listing }, sources)
    .artifacts.find((item) => item.type === 'pdf');
  assert.equal(pdfOf('editable').required, false);
  assert.equal(pdfOf('static').required, true);
  assert.equal(pdfOf('maze').required, true);
  // The .pptx and .docx stay mandatory for editable products.
  const editable = buildFinalExportManifest({ name: 'Editable Book', productFormat: 'editable', tptListing: listing }, sources);
  for (const type of ['pptx', 'docx']) assert.equal(editable.artifacts.find((item) => item.type === type).required, true);
});

test('complete package exports required + optional artifacts and excludes junk', async () => {
  const { dir, project } = await makeProjectFixture();
  try {
    const manager = new FileManager({ nativeImage: {} });
    const zipPath = await manager.exportZip(project);
    assert.ok(existsSync(zipPath));
    const entries = listZipEntries(zipPath);
    assert.deepEqual(entries, [
      'Manifest-Book.docx',
      'Manifest-Book.pdf',
      'Manifest-Book.pptx',
      'Manifest-Book_video.mp4',
      'listing_details.txt',
      // Resized to 2000x2000 at export so a storefront grid does not show four
      // different sizes; the container is left as it arrived.
      'mockups/mockup_01.jpg',
      'mockups/mockup_02.jpg',
      'mockups/mockup_03.jpg',
      'mockups/mockup_04.jpg'
    ]);
    assert.ok(!entries.some((name) => name.includes('page-001')));
    assert.ok(!entries.some((name) => name.includes('competitor')));
    assert.ok(!entries.some((name) => name.includes('prompts')));
    assert.ok(!entries.some((name) => name.includes('debug.log')));
    assert.ok(!entries.some((name) => name.includes('engine-diagnostics')));

    const packDir = join(dir, 'final-pack');
    const result = await manager.exportFinalPackageDirectory(project, packDir);
    assert.equal(result.manifest.complete, true);
    assert.deepEqual(listPackageFiles(packDir), entries);
    assert.ok(readFileSync(join(packDir, 'listing_details.txt'), 'utf8').includes('TITLE'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('missing video blocks final package instead of fabricating video', async () => {
  const { dir, project } = await makeProjectFixture({ withVideo: false });
  try {
    const manager = new FileManager({ nativeImage: {} });
    const manifest = buildFinalExportManifest(project, {
      pdfPath: join(dir, 'Manifest-Book.pdf'),
      pptxPath: join(dir, 'Manifest-Book.pptx'),
      docxPath: join(dir, 'Manifest-Book.docx')
    });
    const video = manifest.artifacts.find((item) => item.type === 'video');
    assert.equal(video.status, 'missing');
    assert.match(video.reason, /Video Preview was not generated/);
    await assert.rejects(() => manager.exportZip(project), /Final export is incomplete/);
    await assert.rejects(() => manager.exportFinalPackageDirectory(project, join(dir, 'pack-no-video')), /Final export is incomplete/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('missing SEO does not block the package, and no fake seo txt is invented', async () => {
  const { dir, project } = await makeProjectFixture({ withSeo: false });
  try {
    const manager = new FileManager({ nativeImage: {} });
    const manifest = buildFinalExportManifest(project, {
      pdfPath: join(dir, 'Manifest-Book.pdf'),
      pptxPath: join(dir, 'Manifest-Book.pptx'),
      docxPath: join(dir, 'Manifest-Book.docx')
    });
    const seo = manifest.artifacts.find((item) => item.type === 'seo');
    assert.equal(seo.status, 'missing');
    assert.equal(seo.required, false);
    // Still never fabricated - a missing listing writes no file at all.
    assert.equal(materializeFinalExportSeoFile(manifest, join(dir, 'pack-no-seo')), null);
    // The listing copy is read in the app and pasted into TPT; the buyer never receives
    // it, so its absence must not hold back a finished book.
    const zipPath = await manager.exportZip(project);
    assert.ok(existsSync(zipPath));
    const entries = listZipEntries(zipPath);
    assert.ok(!entries.includes('listing_details.txt'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('missing mockups block final package and mockups folder is omitted', async () => {
  const { dir, project } = await makeProjectFixture({ withMockups: false });
  try {
    const manager = new FileManager({ nativeImage: {} });
    const manifest = buildFinalExportManifest(project, {
      pdfPath: join(dir, 'Manifest-Book.pdf'),
      pptxPath: join(dir, 'Manifest-Book.pptx'),
      docxPath: join(dir, 'Manifest-Book.docx')
    });
    const mockups = manifest.artifacts.find((item) => item.type === 'mockups');
    assert.equal(mockups.status, 'missing');
    await assert.rejects(() => manager.exportZip(project), /Final export is incomplete/);
    await assert.rejects(() => manager.exportFinalPackageDirectory(project, join(dir, 'pack-no-mockups')), /Final export is incomplete/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('missing PDF fails export clearly', async () => {
  const { dir, project } = await makeProjectFixture();
  try {
    const manifest = buildFinalExportManifest(project, {
      pdfPath: null,
      pptxPath: join(dir, 'x.pptx'),
      docxPath: join(dir, 'x.docx')
    });
    writeFileSync(join(dir, 'x.pptx'), 'pptx');
    writeFileSync(join(dir, 'x.docx'), 'docx');
    assert.equal(manifest.complete, false);
    assert.throws(
      () => assertFinalExportManifestComplete(manifest),
      (error) => error.code === 'EXPORT_MANIFEST_INCOMPLETE'
    );
    assert.throws(
      () => writeFinalExportPackageFromManifest(manifest, join(dir, 'bad-pack')),
      (error) => error.code === 'EXPORT_MANIFEST_INCOMPLETE'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('competitor mockups and interior pages never enter the final package', async () => {
  const { dir, project, pagePath } = await makeProjectFixture({
    withCompetitor: true,
    withInteriorExtras: true
  });
  try {
    const manager = new FileManager({ nativeImage: {} });
    const packDir = join(dir, 'pack-clean');
    await manager.exportFinalPackageDirectory(project, packDir);
    const files = listPackageFiles(packDir);
    assert.ok(!files.includes(basename(pagePath)));
    assert.ok(!files.some((name) => /competitor/i.test(name)));
    assert.ok(!files.includes('prompts.txt'));
    assert.ok(files.includes('mockups/mockup_01.jpg'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ZIP contents exactly match manifest expected entries', async () => {
  const { dir, project } = await makeProjectFixture();
  try {
    const manager = new FileManager({ nativeImage: {} });
    const zipPath = await manager.exportZip(project);
    const entries = listZipEntries(zipPath);
    // Reconstruct manifest with generated deliverable paths on disk.
    const pdfPath = join(dir, 'Manifest-Book.pdf');
    const pptxPath = join(dir, 'Manifest-Book.pptx');
    const docxPath = join(dir, 'Manifest-Book.docx');
    assert.ok(existsSync(pdfPath));
    assert.ok(existsSync(pptxPath));
    assert.ok(existsSync(docxPath));
    const manifest = buildFinalExportManifest(project, { pdfPath, pptxPath, docxPath });
    assert.deepEqual(entries, [...manifest.expectedZipEntries].sort());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('debug outputDir dump remains available separately from final package', async () => {
  const { dir, project } = await makeProjectFixture();
  const dumpRoot = mkdtempSync(join(tmpdir(), 'versa-export-dump-'));
  try {
    const manager = new FileManager({ nativeImage: {} });
    const dumpDir = join(dumpRoot, 'workspace-dump');
    manager.exportOutputDirDump(project, dumpDir);
    const dumped = listPackageFiles(dumpDir);
    assert.ok(dumped.includes('page-001.png'));
    assert.ok(dumped.includes('prompts.txt'));
    const packDir = join(dir, 'final-only');
    await manager.exportFinalPackageDirectory(project, packDir);
    const finalFiles = listPackageFiles(packDir);
    assert.ok(!finalFiles.includes('page-001.png'));
    assert.ok(!finalFiles.includes('prompts.txt'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(dumpRoot, { recursive: true, force: true });
  }
});
