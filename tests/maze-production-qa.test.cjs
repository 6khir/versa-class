'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { PDFDocument } = require('pdf-lib');
const { ProjectStore } = require('../src/store.cjs');
const { FileManager } = require('../src/file-manager.cjs');
const { AGE_BANDS, DIFFICULTY_PRESETS, DEFAULT_MAZE_PANEL } = require('../src/maze-contract.cjs');
const { generateMazeTopology } = require('../src/maze-generator.cjs');
const { generateMazePage, getMazeProject, setMazeConfig } = require('../src/maze-service.cjs');
const { generateMazeBook, setMazeLabState } = require('../src/maze-lab.cjs');
const { renderMazePageDocuments } = require('../src/maze-svg.cjs');
const { directMazeTheme, ensureMazeFrames } = require('../src/maze-artwork.cjs');

function heapMb() {
  return Number((process.memoryUsage().heapUsed / (1024 * 1024)).toFixed(2));
}

function config(overrides = {}) {
  return {
    schemaVersion: 1,
    engineType: 'maze',
    project: { id: 'maze-qa-1', revision: 1 },
    keyword: 'school',
    ageBand: AGE_BANDS.kindergarten.id,
    difficultyTier: DIFFICULTY_PRESETS.easy.tier,
    shape: 'rectangular',
    seed: 'qa-seed',
    startAssetId: 'pencil',
    endAssetId: 'apple',
    themeId: 'classroom',
    frameVariantId: 'edge-a',
    framePrompt: '',
    title: 'Find the apple',
    instruction: 'Trace the path',
    ...overrides
  };
}

function createBook(label) {
  const root = mkdtempSync(join(tmpdir(), label));
  const store = new ProjectStore(join(root, 'versa.sqlite'));
  store.createProject({
    id: 'maze-qa-1',
    name: 'QA Mazes',
    theme: 'School',
    niche: 'Mazes',
    format: 'letter',
    orientation: 'portrait',
    style: 'flat',
    activityCount: 1,
    outputDir: root,
    productFormat: 'maze'
  });
  return { root, store };
}

async function generateSizedBook(store, pageCount, persistRender) {
  setMazeConfig(store, 'maze-qa-1', {
    keyword: 'school',
    seed: `qa-book-${pageCount}`,
    difficultyTier: 2,
    ageBand: 'kindergarten'
  });
  setMazeLabState(store, 'maze-qa-1', { pageCount, includeAnswerKey: true });
  const started = performance.now();
  const before = heapMb();
  const generated = await generateMazeBook(store, 'maze-qa-1', {
    pageCount,
    persistRender,
    skipArtwork: true
  });
  return {
    generated,
    ms: performance.now() - started,
    heapMb: heapMb(),
    heapDeltaMb: Number((heapMb() - before).toFixed(2))
  };
}

test('Slice 7 production QA: sizes, presets, cancel/resume/regen/seed, export, mocked remote', async () => {
  const report = {
    presets: [],
    books: [],
    svg: {},
    export: {},
    remote: {},
    cancelResume: {},
    regen: {},
    seed: {},
    retries: 0
  };

  for (const preset of Object.values(DIFFICULTY_PRESETS)) {
    const started = performance.now();
    const generated = generateMazeTopology(config({
      seed: `qa-preset-${preset.id}`,
      difficultyTier: preset.tier,
      ageBand: preset.tier <= 2 ? 'kindergarten' : 'grades_6_8'
    }), { mazePanel: DEFAULT_MAZE_PANEL });
    const ms = performance.now() - started;
    assert.equal(generated.result.validationResult.valid, true);
    assert.equal(generated.result.solution.path.length, generated.result.topology.stats.solutionLength);
    report.retries += generated.metrics.retryCount;
    report.presets.push({
      id: preset.id,
      wallMs: Number(ms.toFixed(3)),
      generationMs: Number(generated.metrics.generationMs.toFixed(3)),
      validationMs: Number(generated.metrics.validationMs.toFixed(3)),
      retries: generated.metrics.retryCount
    });
    assert.ok(ms < 250, `${preset.id} took ${ms.toFixed(2)}ms`);
  }
  const typical = report.presets.find((item) => item.id === 'easy');
  assert.ok(typical.generationMs + typical.validationMs < 100, 'easy maze exceeded the 100ms typical gate');

  const { root, store } = createBook('versa-maze-qa-books-');
  try {
    for (const pageCount of [1, 10, 20, 30, 50]) {
      const persistRender = pageCount <= 10;
      const measured = await generateSizedBook(store, pageCount, persistRender);
      assert.equal(measured.generated.cancelled, false);
      assert.equal(measured.generated.completed, pageCount);
      assert.ok(measured.generated.mazeProject.pages.every((page) => (
        page.generationStatus === 'ready' && page.validationResult?.valid === true && page.solution?.path?.length >= 2
      )));
      report.books.push({
        pageCount,
        persistRender,
        ms: Number(measured.ms.toFixed(2)),
        heapMb: measured.heapMb,
        heapDeltaMb: measured.heapDeltaMb
      });
    }
    const fifty = report.books.find((item) => item.pageCount === 50);
    assert.ok(fifty.ms < 8000, `50-page book took ${fifty.ms}ms`);
    const one = report.books.find((item) => item.pageCount === 1);
    const ten = report.books.find((item) => item.pageCount === 10);
    assert.ok(fifty.heapMb < one.heapMb + 80, `heap grew from ${one.heapMb}MB to ${fifty.heapMb}MB`);
    assert.ok(ten.heapMb < one.heapMb + 40, `10-page heap ${ten.heapMb}MB vs 1-page ${one.heapMb}MB`);

    const svgSource = generateMazeTopology(config({ seed: 'qa-svg' }), { mazePanel: DEFAULT_MAZE_PANEL });
    const svgStarted = performance.now();
    const documents = renderMazePageDocuments({
      result: svgSource.result,
      format: 'LETTER',
      orientation: 'portrait',
      mazePanel: DEFAULT_MAZE_PANEL,
      title: 'Find the apple',
      instruction: 'Trace the path'
    });
    const svgMs = performance.now() - svgStarted;
    assert.match(documents.studentSvg, /data-maze-variant="student"/);
    assert.doesNotMatch(documents.studentSvg, /id="maze-solution"/);
    assert.match(documents.solutionSvg, /id="maze-solution"/);
    report.svg = { ms: Number(svgMs.toFixed(3)), studentBytes: documents.studentSvg.length };
    assert.ok(svgMs < 100, `SVG took ${svgMs.toFixed(2)}ms`);

    setMazeConfig(store, 'maze-qa-1', { keyword: 'export', seed: 'qa-export', difficultyTier: 2 });
    const exportBook = await generateMazeBook(store, 'maze-qa-1', {
      pageCount: 1,
      persistRender: true,
      skipArtwork: true
    });
    assert.equal(exportBook.completed, 1);
    const manager = new FileManager({ nativeImage: {} });
    const exportStarted = performance.now();
    const project = store.getProject('maze-qa-1');
    const pdfPath = await manager.exportPdf(project, { store });
    const exportMs = performance.now() - exportStarted;
    assert.ok(existsSync(pdfPath));
    const pdf = await PDFDocument.load(require('node:fs').readFileSync(pdfPath));
    assert.ok(pdf.getPageCount() >= 3);
    report.export = { pdfMs: Number(exportMs.toFixed(2)), pages: pdf.getPageCount(), pathExists: true };

    const controller = new AbortController();
    setMazeConfig(store, 'maze-qa-1', { keyword: 'cancel', seed: 'qa-cancel', difficultyTier: 2 });
    const cancelled = await generateMazeBook(store, 'maze-qa-1', {
      pageCount: 6,
      persistRender: false,
      skipArtwork: true,
      signal: controller.signal,
      onProgress: ({ completed }) => {
        if (completed >= 2) controller.abort();
      }
    });
    assert.equal(cancelled.cancelled, true);
    const resumed = await generateMazeBook(store, 'maze-qa-1', {
      pageCount: 6,
      resume: true,
      persistRender: false,
      skipArtwork: true
    });
    assert.equal(resumed.cancelled, false);
    assert.equal(resumed.completed, 6);
    report.cancelResume = { cancelledReady: cancelled.completed, resumedReady: resumed.completed };

    const beforeRegen = getMazeProject(store, 'maze-qa-1');
    const firstSeed = beforeRegen.pages[0].topology.generationSeed;
    const thirdSeed = beforeRegen.pages[2].topology.generationSeed;
    const regenerated = await generateMazePage(store, 'maze-qa-1', {
      pageId: 'M02',
      pageSeed: 'qa-cancel:M02:rqa',
      persistRender: false,
      skipArtwork: true
    });
    assert.equal(regenerated.mazeProject.pages[0].topology.generationSeed, firstSeed);
    assert.equal(regenerated.mazeProject.pages[2].topology.generationSeed, thirdSeed);
    assert.notEqual(regenerated.mazeProject.pages[1].topology.generationSeed, beforeRegen.pages[1].topology.generationSeed);
    report.regen = { replacedPage: 'M02', neighborsUnchanged: true };

    setMazeConfig(store, 'maze-qa-1', { keyword: 'seed', seed: 'qa-repro', difficultyTier: 2 });
    const first = await generateMazeBook(store, 'maze-qa-1', {
      pageCount: 3,
      persistRender: false,
      skipArtwork: true
    });
    const second = await generateMazeBook(store, 'maze-qa-1', {
      pageCount: 3,
      persistRender: false,
      skipArtwork: true
    });
    assert.deepEqual(
      first.mazeProject.pages.map((page) => page.topology.generationSeed),
      second.mazeProject.pages.map((page) => page.topology.generationSeed)
    );
    assert.deepEqual(
      first.mazeProject.pages[0].topology.horizontalWalls,
      second.mazeProject.pages[0].topology.horizontalWalls
    );
    report.seed = { reproduced: true, pages: 3 };

    const theme = await directMazeTheme({
      generateText() { throw Object.assign(new Error('Gemini rejected the key'), { code: 'AUTH_REQUIRED', retryable: false }); }
    }, { keyword: 'school' });
    assert.equal(theme.fallback, true);
    const frames = await ensureMazeFrames(store, 'maze-qa-1', [
      { sequenceIndex: 2, pageId: 'M02', themeId: 'school', frameVariantId: 'edge-b' },
      { sequenceIndex: 1, pageId: 'M01', themeId: 'school', frameVariantId: 'edge-a' }
    ], {
      provider: {
        generateImage: async () => {
          throw Object.assign(new Error('remote failed'), { code: 'PROVIDER_ERROR', retryable: true });
        }
      },
      retryDelayMs: 1,
      remoteAttempts: 2
    });
    assert.deepEqual(frames.pages.map((page) => page.sequenceIndex), [1, 2]);
    assert.ok(frames.pages.every((page) => page.fallback === true));
    report.remote = { themeFallback: theme.reason, framesFallback: true, peak: frames.peak, artworkMs: 'mocked' };
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }

  console.log(JSON.stringify({ slice7ProductionQa: report }, null, 2));
});
