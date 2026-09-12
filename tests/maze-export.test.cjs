'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { PDFDocument } = require('pdf-lib');
const { ProjectStore } = require('../src/store.cjs');
const { FileManager, selectThumbnailPagePaths, selectPreviewFramePaths, collectProductPageImagePaths, buildFinalExportManifest } = require('../src/file-manager.cjs');
const { setMazeConfig } = require('../src/maze-service.cjs');
const { generateMazeBook, setMazeLabState } = require('../src/maze-lab.cjs');
const {
  planMazeExportSlots,
  syncMazeExportJobs,
  buildMazeExportPageArray,
  assertMazeExportReady,
  assembleMazeDeliverables
} = require('../src/maze-export.cjs');

function createBook(label) {
  const root = mkdtempSync(join(tmpdir(), label));
  const store = new ProjectStore(join(root, 'versa.sqlite'));
  store.createProject({
    id: 'maze-export-1',
    name: 'Bee Mazes',
    theme: 'Bees',
    niche: 'Mazes',
    format: 'letter',
    orientation: 'portrait',
    style: 'flat',
    activityCount: 2,
    outputDir: root,
    productFormat: 'maze'
  });
  setMazeConfig(store, 'maze-export-1', {
    keyword: 'bees',
    ageBand: 'kindergarten',
    difficultyTier: 2,
    seed: 'export-book-seed',
    startAssetId: 'bee',
    endAssetId: 'flower',
    title: 'Bee Maze',
    instruction: 'Find the flower.'
  });
  setMazeLabState(store, 'maze-export-1', { pageCount: 2, includeAnswerKey: true });
  return { root, store };
}

async function generateReadyBook(store) {
  const generated = await generateMazeBook(store, 'maze-export-1', {
    persistRender: true,
    skipArtwork: true
  });
  assert.equal(generated.cancelled, false);
  assert.equal(generated.completed, 2);
  return syncMazeExportJobs(store, 'maze-export-1');
}

function unzipList(filePath) {
  return execFileSync('unzip', ['-Z1', filePath], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function slideXml(dir, name) {
  return readFileSync(join(dir, name), 'utf8');
}

test('maze export jobs follow cover, students, answer keys, then back', async () => {
  const { root, store } = createBook('versa-maze-export-order-');
  try {
    const project = await generateReadyBook(store);
    const roles = project.jobs.map((job) => job.kind);
    assert.deepEqual(roles, ['cover', 'maze_interior', 'maze_interior', 'answer_key', 'answer_key', 'back_cover']);
    assert.equal(project.stats.complete, 6);
    assert.equal(project.stats.total, 6);
    const pages = buildMazeExportPageArray(project);
    assert.deepEqual(pages.map((page) => page.role), roles);
    const students = project.mazeProject.pages.filter((page) => page.pageRole === 'maze_interior');
    assert.equal(pages[1].seed, students[0].seed);
    assert.equal(pages[3].seed, students[0].seed);
    assert.equal(pages[2].seed, students[1].seed);
    assert.equal(pages[4].seed, students[1].seed);
    assert.notEqual(students[0].seed, students[1].seed);
    const studentSvg = readFileSync(pages[1].svgPath, 'utf8');
    const answerSvg = readFileSync(pages[3].svgPath, 'utf8');
    assert.match(studentSvg, /data-maze-variant="student"/);
    assert.doesNotMatch(studentSvg, /id="maze-solution"/);
    assert.match(answerSvg, /data-maze-variant="solution"/);
    assert.match(answerSvg, /id="maze-solution"/);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('mockups and preview selectors see maze pages in book order', async () => {
  const { root, store } = createBook('versa-maze-export-select-');
  try {
    const project = await generateReadyBook(store);
    const rasters = collectProductPageImagePaths(project.jobs);
    assert.equal(rasters.length, 6);
    assert.equal(rasters[0], project.jobs[0].outputPath);
    assert.equal(rasters[5], project.jobs[5].outputPath);
    const thumbs = selectThumbnailPagePaths(rasters, 0);
    assert.deepEqual(thumbs, [rasters[0], rasters[1], rasters[2], rasters[3]]);
    const preview = selectPreviewFramePaths(project.jobs);
    assert.deepEqual(preview, [rasters[1], rasters[2]]);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('maze PDF and PPTX keep student paths hidden and one maze object per slide', async () => {
  const { root, store } = createBook('versa-maze-export-files-');
  try {
    const project = await generateReadyBook(store);
    const manager = new FileManager({ nativeImage: {} });
    const pdfPath = await manager.exportPdf(project, { store });
    const pptxPath = await manager.exportPptx(project, { store });
    assert.ok(existsSync(pdfPath));
    assert.ok(existsSync(pptxPath));

    const pdf = await PDFDocument.load(readFileSync(pdfPath));
    assert.equal(pdf.getPageCount(), 6);
    const pages = buildMazeExportPageArray(project);
    assert.doesNotMatch(readFileSync(pages[1].svgPath, 'utf8'), /id="maze-solution"/);
    assert.match(readFileSync(pages[3].svgPath, 'utf8'), /id="maze-solution"/);
    assert.equal(pages[3].seed, pages[1].seed);

    const extractDir = join(root, 'pptx-inspect');
    mkdirSync(extractDir, { recursive: true });
    execFileSync('unzip', ['-q', pptxPath, '-d', extractDir]);
    const entries = unzipList(pptxPath);
    const media = entries.filter((name) => name.startsWith('ppt/media/'));
    assert.ok(media.some((name) => name.endsWith('.svg')), 'PPTX should embed maze SVG objects');
    const slideFiles = entries.filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort();
    assert.equal(slideFiles.length, 6);
    for (const name of slideFiles) {
      const xml = slideXml(extractDir, name);
      const pictures = xml.match(/<p:pic[\s>]/g) || [];
      const shapes = xml.match(/<p:sp[\s>]/g) || [];
      assert.equal(pictures.length, 1, `${name} should contain one maze picture`);
      assert.ok(shapes.length <= 8, `${name} exploded into ${shapes.length} shapes`);
      assert.doesNotMatch(xml, /<a:path[^>]{200,}/);
    }
    const studentSlide = slideXml(extractDir, 'ppt/slides/slide2.xml');
    assert.match(studentSlide, /<a:t>Bees Maze 1<\/a:t>/);
    assert.match(studentSlide, /<a:t>Find the flower\.<\/a:t>/);

    const manifest = buildFinalExportManifest(project, {
      pdfPath,
      pptxPath,
      docxPath: join(root, 'Bee-Mazes.docx')
    });
    assert.equal(manifest.artifacts.find((item) => item.type === 'pdf').required, true);
    assert.equal(manifest.artifacts.find((item) => item.type === 'pdf').status, 'included');
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('incomplete or invalid mazes cannot reach export', async () => {
  const { root, store } = createBook('versa-maze-export-lock-');
  try {
    const controller = new AbortController();
    await generateMazeBook(store, 'maze-export-1', {
      persistRender: true,
      skipArtwork: true,
      signal: controller.signal,
      onProgress: ({ completed }) => {
        if (completed >= 1) controller.abort();
      }
    });
    const incomplete = await syncMazeExportJobs(store, 'maze-export-1');
    const manager = new FileManager({ nativeImage: {} });
    await assert.rejects(
      () => manager.exportPdf(incomplete, { store }),
      (error) => error.code === 'BOOK_INCOMPLETE'
    );
    await assert.rejects(
      () => manager.exportPptx(incomplete, { store }),
      (error) => error.code === 'BOOK_INCOMPLETE'
    );

    const ready = await generateReadyBook(store);
    const student = ready.mazeProject.pages.find((page) => page.pageRole === 'maze_interior');
    writeFileSync(student.render.studentSvgPath, readFileSync(student.render.solutionSvgPath));
    const poisoned = await syncMazeExportJobs(store, 'maze-export-1');
    assert.throws(
      () => assertMazeExportReady(poisoned),
      (error) => error.code === 'MAZE_INVALID'
    );
    await assert.rejects(
      () => manager.exportPdf(poisoned, { store }),
      (error) => error.code === 'MAZE_INVALID'
    );
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('assembleMazeDeliverables writes local PDF, Word, and PowerPoint without Gemini', async () => {
  const { root, store } = createBook('versa-maze-assemble-');
  try {
    await generateReadyBook(store);
    const manager = new FileManager({ nativeImage: {} });
    const assembled = await assembleMazeDeliverables(store, 'maze-export-1', { fileManager: manager });
    assert.ok(existsSync(assembled.pdfPath));
    assert.ok(existsSync(assembled.pptxPath));
    assert.ok(existsSync(assembled.docxPath));
    const project = store.getProject('maze-export-1');
    assert.equal(project.printPdfJson?.reason, 'maze-local-compose');
    assert.equal(project.printPdfJson?.productPdfPath || project.productPdfPath, assembled.pdfPath);
    const pdf = await PDFDocument.load(readFileSync(assembled.pdfPath));
    assert.equal(pdf.getPageCount(), 6);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('answer keys can be omitted from the planned book', () => {
  const slots = planMazeExportSlots({
    config: { title: 'Bee Maze', instruction: 'Go', seed: 's' },
    pages: [{
      pageId: 'M01',
      pageRole: 'maze_interior',
      sequenceIndex: 1,
      seed: 's:M01',
      title: 'Bee Maze',
      instruction: 'Go'
    }]
  }, { includeAnswerKey: false });
  assert.deepEqual(slots.map((slot) => slot.role), ['cover', 'maze_interior', 'back_cover']);
});
