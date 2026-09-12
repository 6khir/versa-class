'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const {
  attachGeneratedPage,
  processLocalPage,
  runBoundedRemote,
  persistRebuildPipeline,
  ensureRebuildPlan,
} = require('../src/rebuild-pipeline.cjs');

function storeHarness(jobs) {
  const settings = new Map();
  const project = {
    id: 'book-rebuild',
    theme: 'washable-marker',
    outputDir: mkdtempSync(join(tmpdir(), 'versa-rebuild-')),
    slug: 'rebuild-book',
    jobs,
  };
  const store = {
    getProject: () => project,
    getSetting: (key, fallback = null) => (settings.has(key) ? settings.get(key) : fallback),
    setSetting: (key, value) => settings.set(key, value),
  };
  persistRebuildPipeline(store, project.id, true);
  return { store, project, settings };
}

test('generated assets are stored by pageId, not completion order', async () => {
  const jobs = [
    { id: 'late', pageNumber: 2, imagePrompt: '@image "Name Hunt" "Circle your name."' },
    { id: 'early', pageNumber: 1, imagePrompt: '@image "Name Pack" "A classroom pack."' },
  ];
  const { store, project } = storeHarness(jobs);
  ensureRebuildPlan(store, project);
  const finished = [];
  await runBoundedRemote(jobs, async (job) => {
    await new Promise((resolve) => setTimeout(resolve, job.pageNumber === 1 ? 20 : 1));
    const path = join(project.outputDir, `${job.id}.png`);
    writeFileSync(path, 'png');
    attachGeneratedPage(store, project, job, path);
    finished.push(job.id);
    return path;
  }, { limit: 2 });
  assert.deepEqual(finished, ['late', 'early']);
  const pages = ensureRebuildPlan(store, project).sort((a, b) => a.sequenceIndex - b.sequenceIndex);
  assert.equal(pages[0].sequenceIndex, 1);
  assert.ok(String(pages[0].generatedAssetPath).endsWith('early.png'));
  assert.ok(String(pages[1].generatedAssetPath).endsWith('late.png'));
});

test('local processing is one page at a time and keeps manifest copy after OCR salad', async () => {
  const jobs = [
    { id: 'j2', pageNumber: 2, kind: 'page', imagePrompt: '@image "Name Hunt" "Circle your name."' },
  ];
  const { store, project } = storeHarness(jobs);
  ensureRebuildPlan(store, project);
  const imagePath = join(project.outputDir, 'page.png');
  writeFileSync(imagePath, Buffer.from('89504e470d0a1a0a', 'hex'));
  attachGeneratedPage(store, project, jobs[0], imagePath);
  const concurrent = [];
  const worker = {
    async ocr() {
      concurrent.push('ocr');
      return {
        ok: true,
        detections: [
          { text: 'Nane Hunt', box: [30, 30, 300, 90], confidence: 0.8 },
          { text: 'Circle your name.', box: [30, 110, 420, 160], confidence: 0.9 },
        ],
      };
    },
    async inspectBands() {
      return { ok: true, bands: [{ box: [20, 20, 320, 100], color: [250, 246, 236], ink: [40, 40, 40], sigma: 3, flat: true }] };
    },
    async cleanup(_input, output) {
      assert.equal(concurrent.filter((item) => item === 'ocr').length, 1);
      writeFileSync(output, 'clean');
      return { ok: true, watchdog: { ok: true, residuals: [], leftoverText: [] } };
    },
  };
  const record = ensureRebuildPlan(store, project)[0];
  const result = await processLocalPage({
    store,
    project,
    job: jobs[0],
    record,
    worker,
  });
  assert.equal(result.state, 'CLEANED');
  assert.equal(result.plannedCopy.title, 'Name Hunt');
  assert.equal(result.blocks[0].text, 'Name Hunt');
  assert.ok(existsSync(result.cleanedAssetPath));
});

test('10-page mocked local pass stays sequential and reports timings', async () => {
  const jobs = Array.from({ length: 10 }, (_, index) => ({
    id: `p${index + 1}`,
    pageNumber: index + 1,
    kind: index === 0 ? 'cover' : (index === 9 ? 'back' : 'page'),
    imagePrompt: `@image "Title ${index + 1}" "Do the activity."`,
  }));
  const { store, project } = storeHarness(jobs);
  ensureRebuildPlan(store, project);
  let live = 0;
  let peak = 0;
  const worker = {
    async ocr() {
      live += 1;
      peak = Math.max(peak, live);
      live -= 1;
      return { ok: true, detections: [{ text: 'Title', box: [10, 10, 100, 40], confidence: 0.9 }, { text: 'Do the activity.', box: [10, 50, 200, 80], confidence: 0.9 }] };
    },
    async inspectBands() {
      return { ok: true, bands: [{ box: [8, 8, 210, 90], color: [250, 250, 245], ink: [30, 30, 30], sigma: 2, flat: true }] };
    },
    async cleanup(_input, output) {
      writeFileSync(output, 'clean');
      return { ok: true, watchdog: { ok: true, residuals: [], leftoverText: [] } };
    },
  };
  const started = Date.now();
  for (const job of jobs) {
    const imagePath = join(project.outputDir, `${job.id}.png`);
    writeFileSync(imagePath, 'png');
    attachGeneratedPage(store, project, job, imagePath);
    const record = ensureRebuildPlan(store, project).find((item) => item.jobId === job.id);
    const copy = {
      ...record,
      plannedCopy: { title: 'Title', instruction: 'Do the activity.', body: '', footer: '' },
      blocks: [
        { role: 'title', text: 'Title', box: null },
        { role: 'instruction', text: 'Do the activity.', box: null },
      ],
    };
    const result = await processLocalPage({ store, project, job, record: copy, worker });
    assert.equal(result.state, 'CLEANED');
  }
  assert.equal(peak, 1);
  console.log(`mocked 10-page local pass ${Date.now() - started}ms peakWorkers=${peak}`);
});

test('interrupted COMPLETE pages are not regenerated', () => {
  const jobs = [
    { id: 'j1', pageNumber: 1, imagePrompt: '@image "Cover Title"' },
  ];
  const { store, project } = storeHarness(jobs);
  const [record] = ensureRebuildPlan(store, project);
  store.setSetting(`rebuild-page:${project.id}:${record.pageId}`, { ...record, state: 'COMPLETE' });
  const again = ensureRebuildPlan(store, project);
  assert.equal(again[0].state, 'COMPLETE');
  assert.equal(again[0].plannedCopy.title, 'Cover Title');
});
