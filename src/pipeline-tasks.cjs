'use strict';

/**
 * Wiring between the pipeline's stages and the durable queue.
 *
 * Stages used to run as long awaits inside IPC handlers. All of their progress
 * lived in the call stack, so a stall had no exit and a restart had nothing to
 * resume from — which is exactly what "stuck in analyzing" was.
 *
 * A stage is now a task kind with a handler. The handler receives an
 * AbortSignal, writes checkpoints as it goes, and is bounded by a deadline it
 * cannot exceed. Whether the caller waits for the result is a separate question
 * from whether the work is durable: `awaitTask` lets an IPC handler keep its
 * request/response shape while the work itself is a committed row that survives
 * the process.
 *
 * Lanes matter here. The browser is one Chrome profile with one composer, so
 * every stage that drives it shares a lane and can never race itself. Local
 * vision work runs in its own lane, so a page being read does not wait behind a
 * gem answering.
 */

const { TaskRunner } = require('./task-runner.cjs');

/** Stage names, used as task kinds and as dedupe prefixes. */
const KIND = Object.freeze({
  ANALYSIS: 'analysis',
  INTERIOR: 'interior',
  INTERIOR_TEXT: 'interior_text',
  EDITABLE_PPT: 'editable_ppt',
  THUMBNAILS: 'thumbnails',
  PREVIEW: 'preview',
  EXPORT: 'export',
  // VERSA AGENT: reads public market pages and hands a URL to ANALYSIS.
  TREND_SCAN: 'trend_scan'
});

/**
 * Deadlines are per stage, and generous — they exist to break a hang, not to
 * hurry a model. Veo routinely renders past fifteen minutes; a book of two
 * hundred pages takes hours. What they guarantee is that no stage runs forever.
 */
const DEADLINES = Object.freeze({
  [KIND.ANALYSIS]: 15 * 60_000,
  [KIND.INTERIOR]: 12 * 60 * 60_000,
  [KIND.INTERIOR_TEXT]: 3 * 60 * 60_000,
  [KIND.EDITABLE_PPT]: 20 * 60_000,
  [KIND.THUMBNAILS]: 90 * 60_000,
  [KIND.PREVIEW]: 60 * 60_000,
  [KIND.EXPORT]: 30 * 60_000,
  // Four public pages and a rank. If it is not done in ten minutes it is stuck.
  [KIND.TREND_SCAN]: 10 * 60_000
});

/**
 * The browser lane is everything that drives Chrome. One profile, one composer:
 * two of these at once corrupt each other's uploads.
 */
const LANES = Object.freeze({
  browser: [KIND.ANALYSIS, KIND.INTERIOR, KIND.THUMBNAILS, KIND.PREVIEW, KIND.TREND_SCAN],
  local: [KIND.INTERIOR_TEXT, KIND.EDITABLE_PPT, KIND.EXPORT]
});

/** A stable key per logical unit of work, so a resume finds the existing task. */
function dedupeKey(kind, projectId, suffix = '') {
  return [kind, projectId ?? 'none', suffix].filter(Boolean).join(':');
}

/**
 * Build the runner for the app's stages.
 *
 * @param {object} store    ProjectStore (its `.tasks` is the queue)
 * @param {object} handlers map of KIND -> async ({ task, signal, checkpoint, progress }) => result
 */
function createPipelineRunner({ store, handlers, onEvent = null, ...tuning }) {
  const runner = new TaskRunner({
    store: store.tasks,
    handlers,
    lanes: LANES,
    deadlines: DEADLINES,
    ...tuning
  });

  if (typeof onEvent === 'function') {
    for (const name of ['started-task', 'completed', 'failed', 'progress', 'reclaimed', 'unhandled-kind', 'log', 'watchdog']) {
      runner.on(name, (payload) => onEvent(name, payload));
    }
  }
  return runner;
}

/**
 * Wait for one task to reach a terminal state.
 *
 * This is the bridge for callers that still want a reply — the analysis dialog
 * needs the analysed result to open. The work is durable either way: if the wait
 * is abandoned, or the process dies, the task keeps running and its outcome is
 * committed. Only the waiting is given up, never the work.
 */
function awaitTask(store, taskId, { timeoutMs = 15 * 60_000, pollMs = 250 } = {}) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      const task = store.tasks.get(taskId);
      if (!task) {
        reject(Object.assign(new Error('The task disappeared before it finished.'), { code: 'TASK_MISSING' }));
        return;
      }
      if (task.state === 'done') {
        resolve(task);
        return;
      }
      if (task.state === 'failed' || task.state === 'cancelled') {
        reject(Object.assign(
          new Error(task.lastError || `The ${task.kind} stage did not finish.`),
          { code: 'TASK_FAILED', task }
        ));
        return;
      }
      if (Date.now() > deadline) {
        // The caller stops waiting; the task does not stop running. It stays
        // queued or leased and its result lands whenever it lands.
        reject(Object.assign(
          new Error(`The ${task.kind} stage is still running. It will finish in the background.`),
          { code: 'TASK_STILL_RUNNING', task }
        ));
        return;
      }
      setTimeout(tick, pollMs).unref?.();
    };
    tick();
  });
}

/**
 * Everything a project has queued or run, shaped for the UI.
 *
 * The renderer reads this rather than listening for progress events, so what it
 * shows after a restart is what actually happened rather than whatever it
 * happened to catch while it was open.
 */
function projectTaskState(store, projectId) {
  const tasks = store.tasks.listByProject(projectId, { limit: 100 });
  const byKind = {};
  for (const task of tasks) {
    // listByProject is newest first, so the first of each kind is the current one.
    if (!byKind[task.kind]) {
      byKind[task.kind] = {
        id: task.id,
        state: task.state,
        attempts: task.attempts,
        maxAttempts: task.maxAttempts,
        checkpoint: task.checkpoint,
        lastError: task.lastError,
        updatedAt: task.updatedAt
      };
    }
  }
  return { stats: store.tasks.stats(projectId), byKind };
}

module.exports = {
  KIND,
  LANES,
  DEADLINES,
  dedupeKey,
  createPipelineRunner,
  awaitTask,
  projectTaskState
};
