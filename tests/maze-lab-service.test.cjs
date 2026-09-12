'use strict';

const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { ProjectStore } = require('../src/store.cjs');
const { getMazeProject, setMazeConfig, replaceMazePages, resolveMazeArtifactDir } = require('../src/maze-service.cjs');
const {
  getMazeLabState,
  setMazeLabState,
  planMazePages,
  generateMazeBook,
  clearMazePage,
  clearMazePages,
  rerollMazeSeed,
  abortMazeGeneration,
  pageGenerationSeed,
  resolveMazePreviewPath,
  clampMazePageCount,
  MAX_MAZE_PAGE_COUNT
} = require('../src/maze-lab.cjs');
const { generateMazePage } = require('../src/maze-service.cjs');

function createStore(label) {
  const root = mkdtempSync(join(tmpdir(), label));
  const store = new ProjectStore(join(root, 'versa.sqlite'));
  store.createProject({
    id: 'maze-lab-1',
    name: 'Maze Book',
    theme: 'School',
    niche: 'Mazes',
    format: 'letter',
    orientation: 'portrait',
    style: 'flat',
    activityCount: 4,
    outputDir: root,
    productFormat: 'maze'
  });
  return { root, store };
}

test('lab state plans maze pages and generate book fills them', async () => {
  const { root, store } = createStore('versa-maze-lab-book-');
  try {
    setMazeConfig(store, 'maze-lab-1', {
      keyword: 'bees',
      ageBand: 'kindergarten',
      difficultyTier: 2,
      seed: 'lab-book-seed',
      startAssetId: 'bee',
      endAssetId: 'flower'
    });
    const lab = setMazeLabState(store, 'maze-lab-1', { pageCount: 3 });
    assert.equal(lab.pageCount, 3);
    const planned = planMazePages(store, 'maze-lab-1', 3);
    assert.equal(planned.pages.length, 3);
    assert.equal(planned.pages[0].generationStatus, 'idle');
    const generated = await generateMazeBook(store, 'maze-lab-1', {
      persistRender: false,
      skipArtwork: true
    });
    assert.equal(generated.cancelled, false);
    assert.equal(generated.completed, 3);
    assert.equal(generated.mazeProject.pages.length, 3);
    assert.ok(generated.mazeProject.pages.every((page) => page.generationStatus === 'ready'));
    assert.notEqual(generated.mazeProject.pages[0].seed, generated.mazeProject.pages[1].seed);
    assert.equal(generated.mazeProject.config.themeId, 'bees');
    assert.equal(getMazeLabState(store, 'maze-lab-1').pageCount, 3);
    assert.equal(store.getProject('maze-lab-1').activityCount, 3);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('cancel stops later pages and keeps completed mazes', async () => {
  const { root, store } = createStore('versa-maze-lab-cancel-');
  try {
    setMazeConfig(store, 'maze-lab-1', { keyword: 'school', seed: 'cancel-seed', difficultyTier: 2 });
    const controller = new AbortController();
    const generated = await generateMazeBook(store, 'maze-lab-1', {
      pageCount: 4,
      persistRender: false,
      skipArtwork: true,
      signal: controller.signal,
      onProgress: ({ completed }) => {
        if (completed >= 1) controller.abort();
      }
    });
    assert.equal(generated.cancelled, true);
    assert.ok(generated.completed >= 1);
    assert.ok(generated.remaining >= 1);
    const persisted = getMazeProject(store, 'maze-lab-1');
    assert.ok(persisted.pages.some((page) => page.generationStatus === 'ready'));
    assert.ok(persisted.pages.some((page) => page.generationStatus !== 'ready'));
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('resume fills remaining pages and locked seeds cannot reroll', async () => {
  const { root, store } = createStore('versa-maze-lab-resume-');
  try {
    setMazeConfig(store, 'maze-lab-1', { keyword: 'space', seed: 'resume-seed', difficultyTier: 2 });
    const controller = new AbortController();
    await generateMazeBook(store, 'maze-lab-1', {
      pageCount: 3,
      persistRender: false,
      skipArtwork: true,
      signal: controller.signal,
      onProgress: ({ completed }) => {
        if (completed >= 1) controller.abort();
      }
    });
    const resumed = await generateMazeBook(store, 'maze-lab-1', {
      pageCount: 3,
      resume: true,
      persistRender: false,
      skipArtwork: true
    });
    assert.equal(resumed.cancelled, false);
    assert.equal(resumed.completed, 3);
    const before = getMazeProject(store, 'maze-lab-1').config.seed;
    setMazeLabState(store, 'maze-lab-1', { seedLocked: true });
    assert.throws(() => rerollMazeSeed(store, 'maze-lab-1'), { code: 'MAZE_SEED_LOCKED' });
    setMazeLabState(store, 'maze-lab-1', { seedLocked: false });
    const rerolled = rerollMazeSeed(store, 'maze-lab-1');
    assert.notEqual(rerolled.config.seed, before);
    assert.match(rerolled.config.seed, /^maze:maze-lab-1:/);
    assert.equal(pageGenerationSeed('book', 'M02'), 'book:M02');
    assert.equal(abortMazeGeneration('missing'), false);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('lab accepts a 50-page book, clamps above that, and recovers corrupt lab state', () => {
  const { root, store } = createStore('versa-maze-lab-clamp-');
  try {
    assert.equal(MAX_MAZE_PAGE_COUNT, 50);
    assert.equal(clampMazePageCount(50), 50);
    assert.equal(clampMazePageCount(51), 50);
    const planned = planMazePages(store, 'maze-lab-1', 50);
    assert.equal(planned.pages.length, 50);
    assert.equal(planned.pages[49].pageId, 'M50');
    store.setSetting('mazeLab:maze-lab-1', 'not-an-object');
    const lab = getMazeLabState(store, 'maze-lab-1');
    assert.equal(lab.pageCount, 8);
    assert.equal(lab.includeAnswerKey, true);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('individual regeneration replaces one page and keeps the others', async () => {
  const { root, store } = createStore('versa-maze-lab-regen-');
  try {
    setMazeConfig(store, 'maze-lab-1', { keyword: 'bees', seed: 'regen-book', difficultyTier: 2 });
    const book = await generateMazeBook(store, 'maze-lab-1', {
      pageCount: 3,
      persistRender: false,
      skipArtwork: true
    });
    const before = book.mazeProject.pages.map((page) => page.topology.generationSeed);
    const regenerated = await generateMazePage(store, 'maze-lab-1', {
      pageId: 'M02',
      pageSeed: 'regen-book:M02:rtest',
      persistRender: false,
      skipArtwork: true
    });
    const after = regenerated.mazeProject.pages;
    assert.equal(after.length, 3);
    assert.deepEqual(after[0].topology.generationSeed, before[0]);
    assert.deepEqual(after[2].topology.generationSeed, before[2]);
    assert.notEqual(after[1].topology.generationSeed, before[1]);
    assert.equal(after[1].generationStatus, 'ready');
    assert.equal(after[1].validationResult.valid, true);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('clearing one maze page drops its image and leaves the others', async () => {
  const { root, store } = createStore('versa-maze-lab-clear-');
  try {
    setMazeConfig(store, 'maze-lab-1', { keyword: 'bees', seed: 'clear-book', difficultyTier: 2 });
    const book = await generateMazeBook(store, 'maze-lab-1', {
      pageCount: 3,
      persistRender: false,
      skipArtwork: true
    });
    assert.equal(book.mazeProject.pages[1].generationStatus, 'ready');
    const cleared = clearMazePage(store, 'maze-lab-1', 'M02');
    assert.equal(cleared.pages[1].generationStatus, 'idle');
    assert.equal(cleared.pages[0].generationStatus, 'ready');
    assert.equal(cleared.pages[2].generationStatus, 'ready');
    assert.equal(cleared.pages[1].topology, null);
    const emptied = clearMazePages(store, 'maze-lab-1');
    assert.ok(emptied.pages.every((page) => page.generationStatus === 'idle'));
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('preview files stay inside the maze artifact folder', async () => {
  const { root, store } = createStore('versa-maze-lab-preview-');
  try {
    setMazeConfig(store, 'maze-lab-1', { keyword: 'school', seed: 'preview-seed', difficultyTier: 2 });
    await generateMazeBook(store, 'maze-lab-1', {
      pageCount: 1,
      persistRender: true,
      skipArtwork: true
    });
    const dir = resolveMazeArtifactDir(store, 'maze-lab-1');
    const preview = resolveMazePreviewPath(store, 'maze-lab-1', 'M01', 'student');
    assert.ok(preview);
    assert.ok(preview.startsWith(dir));
    const outside = join(root, 'escape.png');
    writeFileSync(outside, 'not-a-maze');
    const current = getMazeProject(store, 'maze-lab-1');
    replaceMazePages(store, 'maze-lab-1', current.pages.map((page) => ({
      ...page,
      render: { ...page.render, pngPreviewPath: outside, studentSvgPath: outside }
    })));
    assert.throws(
      () => resolveMazePreviewPath(store, 'maze-lab-1', 'M01', 'student'),
      { code: 'MAZE_RENDER_PATH_INVALID' }
    );
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
