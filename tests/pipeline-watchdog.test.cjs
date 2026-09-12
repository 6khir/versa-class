'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { TaskStore } = require('../src/task-store.cjs');
const { TaskRunner } = require('../src/task-runner.cjs');
const {
  assemblePagesBySequence,
  firstUnfinishedPage,
  inspectPipeline,
  applyPipelineWatchdog,
  canCompleteProject
} = require('../src/pipeline-watchdog.cjs');

test('pages assemble strictly by sequenceIndex and ignore arrival order', () => {
  const assembly = assemblePagesBySequence([
    { pageId: 'M03', sequenceIndex: 3, generationStatus: 'ready' },
    { pageId: 'M01', sequenceIndex: 1, generationStatus: 'ready' },
    { pageId: 'M02', sequenceIndex: 2, generationStatus: 'ready' }
  ]);
  assert.deepEqual(assembly.pages.map((page) => page.pageId), ['M01', 'M02', 'M03']);
  assert.equal(assembly.complete, true);
});

test('a missing or invalid page blocks project completion', () => {
  const missing = assemblePagesBySequence([
    { pageId: 'M01', sequenceIndex: 1, generationStatus: 'ready' },
    { pageId: 'M03', sequenceIndex: 3, generationStatus: 'ready' }
  ], { expectedTotal: 3 });
  assert.deepEqual(missing.missing, [2]);
  assert.equal(missing.complete, false);
  assert.equal(canCompleteProject(missing.pages, { expectedTotal: 3 }), false);

  const invalid = assemblePagesBySequence([
    { pageId: 'M01', sequenceIndex: 1, generationStatus: 'ready' },
    { pageId: 'M02', sequenceIndex: 2, generationStatus: 'failed' }
  ]);
  assert.deepEqual(invalid.invalid, [2]);
  assert.equal(invalid.complete, false);
});

test('duplicate completion events do not create a second page or mark the book done early', () => {
  const assembly = assemblePagesBySequence([
    { pageId: 'M01', sequenceIndex: 1, generationStatus: 'ready' },
    { pageId: 'M01-dup', sequenceIndex: 1, generationStatus: 'ready' },
    { pageId: 'M02', sequenceIndex: 2, generationStatus: 'idle' }
  ], { expectedTotal: 2 });
  assert.deepEqual(assembly.duplicates, [1]);
  assert.equal(assembly.complete, false);
});

test('restart after a cancelled book continues from the first unfinished page', () => {
  const pages = [
    { pageId: 'M01', sequenceIndex: 1, generationStatus: 'ready' },
    { pageId: 'M02', sequenceIndex: 2, generationStatus: 'ready' },
    { pageId: 'M03', sequenceIndex: 3, generationStatus: 'idle' },
    { pageId: 'M04', sequenceIndex: 4, generationStatus: 'idle' }
  ];
  const next = firstUnfinishedPage(pages);
  assert.equal(next.pageId, 'M03');
  assert.equal(next.sequenceIndex, 3);
});

test('abandoned leases and a dead worker are reclaimed and restarted', () => {
  const report = inspectPipeline({
    now: 50_000,
    runnerRunning: false,
    lastProgressAt: 1_000,
    stallMs: 10_000,
    tasks: [
      { id: 't1', state: 'leased', leaseExpiresAt: 10_000, kind: 'analysis' },
      { id: 't2', state: 'pending', kind: 'analysis' }
    ]
  });
  assert.equal(report.abandoned[0].id, 't1');
  assert.equal(report.restartWorker, true);
  assert.equal(report.queueStalled, true);
  assert.ok(report.actions.some((item) => item.action === 'reclaim-leases'));
  assert.ok(report.actions.some((item) => item.action === 'restart-worker'));
});

test('completed maze pages are preserved while unfinished pages are requeued', () => {
  const report = inspectPipeline({
    now: 1,
    mazePages: [
      { pageId: 'M01', sequenceIndex: 1, generationStatus: 'ready' },
      { pageId: 'M02', sequenceIndex: 2, generationStatus: 'failed' },
      { pageId: 'M03', sequenceIndex: 3, generationStatus: 'idle' }
    ]
  });
  assert.deepEqual(report.maze.completed, [1]);
  assert.deepEqual(report.unfinishedMaze.map((page) => page.pageId), ['M02', 'M03']);
  assert.equal(report.canComplete, false);
  assert.ok(report.actions.some((item) => item.action === 'requeue-maze-pages'));
});

test('applyPipelineWatchdog reclaims expired leases and restarts a stopped runner', () => {
  const tasks = new TaskStore(new DatabaseSync(':memory:'), { now: () => 1_000 });
  const row = tasks.enqueue({ kind: 'analysis', payload: { listing: {} }, maxAttempts: 4 });
  tasks.lease({ owner: 'dead-worker', leaseMs: 10, now: 1_000 });
  let started = 0;
  const runner = {
    running: false,
    start() {
      started += 1;
      this.running = true;
    }
  };
  const report = applyPipelineWatchdog({
    store: tasks,
    runner,
    now: 5_000
  });
  assert.equal(report.reclaimed.length, 1);
  assert.equal(report.reclaimed[0].id, row.id);
  assert.equal(report.reclaimed[0].state, 'pending');
  assert.equal(started, 1);
  assert.equal(runner.running, true);
});

test('an interrupted 10-page maze job resumes without losing or duplicating pages', () => {
  const pages = Array.from({ length: 10 }, (_, index) => ({
    pageId: `M${String(index + 1).padStart(2, '0')}`,
    sequenceIndex: index + 1,
    generationStatus: index < 4 ? 'ready' : 'idle'
  }));
  const before = inspectPipeline({ now: 1, mazePages: pages, expectedMazeTotal: 10 });
  assert.deepEqual(before.maze.completed, [1, 2, 3, 4]);
  assert.equal(before.firstUnfinished.pageId, 'M05');
  assert.equal(before.canComplete, false);

  const store = memorySupervisorStore();
  const live = new (require('../src/browser-supervisor.cjs').BrowserSupervisor)({ store, now: () => 1_000 });
  live.load({ projectId: 'maze-book', pageId: 'M05' });
  live.markSubmitted('M05-1');
  live.save();

  const restarted = new (require('../src/browser-supervisor.cjs').BrowserSupervisor)({ store, now: () => 9_000 });
  restarted.load({ projectId: 'maze-book', pageId: 'M05' });
  assert.equal(restarted.canSubmit(), false);
  assert.equal(restarted.checkpoint.pageId, 'M05');

  pages[4].generationStatus = 'ready';
  const after = assemblePagesBySequence(pages, { expectedTotal: 10 });
  assert.deepEqual(after.completed, [1, 2, 3, 4, 5]);
  assert.equal(after.complete, false);
  assert.equal(firstUnfinishedPage(pages).pageId, 'M06');
});

function memorySupervisorStore(seed = {}) {
  const data = { ...seed };
  return {
    getSetting(key, fallback = null) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : fallback;
    },
    setSetting(key, value) {
      data[key] = value;
      return value;
    }
  };
}

test('TaskRunner consults the job watchdog while a lane is idle', async () => {
  const tasks = new TaskStore(new DatabaseSync(':memory:'));
  let watched = 0;
  const runner = new TaskRunner({
    store: tasks,
    handlers: { analysis: async () => ({ ok: true }) },
    lanes: { browser: ['analysis'] },
    idleMs: 5,
    watchdog: () => {
      watched += 1;
      return { watched };
    }
  });
  runner.start();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await runner.stop({ abortInFlight: false });
  assert.ok(watched >= 1);
});
