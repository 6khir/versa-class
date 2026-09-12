'use strict';

/**
 * Job-level pipeline watchdog.
 *
 * Separate from the Browser Supervisor. This one owns abandoned leases, stalled
 * queues, unfinished maze pages, and whether a book may be marked complete.
 * Assembly is always by sequenceIndex / pageNumber. A missing or invalid page
 * keeps the project unfinished.
 */

const QUEUE_STALL_MS = 120_000;

function sequenceOf(item = {}, key = 'sequenceIndex') {
  return Math.max(0, Number(item?.[key] || item?.pageNumber || item?.sequenceIndex) || 0);
}

function pageReady(item = {}, statusKey = 'generationStatus', readyValue = 'ready') {
  const status = item?.[statusKey] || item?.status || item?.generationStatus;
  if (item?.valid === false || item?.outputStatus === 'invalid') return false;
  return status === readyValue || status === 'complete' || item?.outputStatus === 'ready';
}

function assemblePagesBySequence(items = [], {
  sequenceKey = 'sequenceIndex',
  statusKey = 'generationStatus',
  readyValue = 'ready',
  expectedTotal = 0
} = {}) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  const ordered = [...list].sort((left, right) => sequenceOf(left, sequenceKey) - sequenceOf(right, sequenceKey));
  const seen = new Set();
  const duplicates = [];
  const missing = [];
  const invalid = [];
  const completed = [];
  let maxIndex = 0;
  for (const item of ordered) {
    const index = sequenceOf(item, sequenceKey);
    if (!index) {
      invalid.push(item.pageId || item.id || 0);
      continue;
    }
    if (seen.has(index)) duplicates.push(index);
    seen.add(index);
    maxIndex = Math.max(maxIndex, index);
    if (pageReady(item, statusKey, readyValue)) completed.push(index);
    else invalid.push(index);
  }
  const total = Math.max(Number(expectedTotal) || 0, maxIndex, ordered.length);
  for (let index = 1; index <= total; index += 1) {
    if (!seen.has(index)) missing.push(index);
  }
  return {
    pages: ordered,
    completed,
    missing,
    invalid,
    duplicates,
    expectedTotal: total,
    complete: total > 0
      && missing.length === 0
      && invalid.length === 0
      && duplicates.length === 0
      && completed.length === total
  };
}

function firstUnfinishedPage(items = [], options = {}) {
  const assembly = assemblePagesBySequence(items, options);
  return assembly.pages.find((item) => !pageReady(item, options.statusKey, options.readyValue)) || null;
}

function inspectPipeline({
  now = Date.now(),
  tasks = [],
  mazePages = [],
  queueJobs = [],
  lastProgressAt = 0,
  runnerRunning = false,
  expectedMazeTotal = 0,
  expectedQueueTotal = 0,
  stallMs = QUEUE_STALL_MS
} = {}) {
  const open = (Array.isArray(tasks) ? tasks : []).filter((task) => task && (task.state === 'pending' || task.state === 'leased'));
  const leased = open.filter((task) => task.state === 'leased');
  const pending = open.filter((task) => task.state === 'pending');
  const abandoned = leased.filter((task) => {
    const expires = Number(task.leaseExpiresAt || task.lease_expires_at) || 0;
    return expires > 0 && expires <= now;
  });
  const sinceProgress = lastProgressAt ? Math.max(0, now - lastProgressAt) : 0;
  const queueStalled = open.length > 0 && lastProgressAt > 0 && sinceProgress >= stallMs;
  const maze = assemblePagesBySequence(mazePages, {
    sequenceKey: 'sequenceIndex',
    statusKey: 'generationStatus',
    readyValue: 'ready',
    expectedTotal: expectedMazeTotal
  });
  const queue = assemblePagesBySequence(queueJobs, {
    sequenceKey: 'pageNumber',
    statusKey: 'status',
    readyValue: 'complete',
    expectedTotal: expectedQueueTotal
  });
  const unfinishedMaze = maze.pages.filter((page) => !pageReady(page));
  const unfinishedJobs = queue.pages.filter((job) => !pageReady(job, 'status', 'complete'));
  const actions = [];
  if (abandoned.length) actions.push({ action: 'reclaim-leases', ids: abandoned.map((task) => task.id) });
  if (!runnerRunning && (pending.length || abandoned.length)) {
    actions.push({ action: 'restart-worker' });
  }
  if (queueStalled) actions.push({ action: 'requeue-unfinished' });
  if (unfinishedMaze.length) {
    actions.push({ action: 'requeue-maze-pages', pageIds: unfinishedMaze.map((page) => page.pageId) });
  }
  const hasPages = maze.pages.length > 0 || queue.pages.length > 0;
  return {
    abandoned,
    pending,
    leased,
    queueStalled,
    sinceProgress,
    restartWorker: !runnerRunning && (pending.length > 0 || abandoned.length > 0),
    maze,
    queue,
    unfinishedMaze,
    unfinishedJobs,
    firstUnfinished: firstUnfinishedPage(maze.pages.length ? mazePages : queueJobs, maze.pages.length
      ? { sequenceKey: 'sequenceIndex', statusKey: 'generationStatus', readyValue: 'ready' }
      : { sequenceKey: 'pageNumber', statusKey: 'status', readyValue: 'complete' }),
    canComplete: hasPages && (maze.pages.length ? maze.complete : queue.complete),
    actions
  };
}

function applyPipelineWatchdog({
  store,
  runner = null,
  now = Date.now(),
  mazePages = [],
  queueJobs = [],
  lastProgressAt = 0,
  expectedMazeTotal = 0,
  expectedQueueTotal = 0,
  activeIds = []
} = {}) {
  const liveIds = (Array.isArray(activeIds) && activeIds.length
    ? activeIds
    : (runner?.status?.()?.active || []).map((entry) => entry.id)
  ).filter(Boolean);
  const reclaim = (when) => {
    if (typeof store?.reclaimExpired === 'function') return store.reclaimExpired(when, { ignoreIds: liveIds });
    if (typeof store?.tasks?.reclaimExpired === 'function') return store.tasks.reclaimExpired(when, { ignoreIds: liveIds });
    return [];
  };
  const reclaimed = reclaim(now);
  const tasks = typeof store?.listOpen === 'function'
    ? store.listOpen()
    : (typeof store?.tasks?.listOpen === 'function' ? store.tasks.listOpen() : []);
  const report = inspectPipeline({
    now,
    tasks,
    mazePages,
    queueJobs,
    lastProgressAt,
    runnerRunning: Boolean(runner?.running),
    expectedMazeTotal,
    expectedQueueTotal
  });
  if (report.restartWorker && runner && typeof runner.start === 'function' && !runner.running) {
    runner.start();
  }
  return { reclaimed, ...report };
}

function canCompleteProject(items = [], options = {}) {
  return assemblePagesBySequence(items, options).complete;
}

module.exports = {
  QUEUE_STALL_MS,
  assemblePagesBySequence,
  firstUnfinishedPage,
  inspectPipeline,
  applyPipelineWatchdog,
  canCompleteProject,
  pageReady,
  sequenceOf
};
