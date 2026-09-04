'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { AutomationManager, PIPELINE_STEPS } = require('../src/automation-manager.cjs');

/**
 * Minimal in-memory stand-in for ProjectStore, covering only what AutomationManager
 * touches. Step statuses default to 'completed' so a test can opt a single step into
 * the pipeline and keep runs fast.
 */
function createStore({ projects = [], settings = {}, pendingSteps = [] } = {}) {
  const stepStatus = new Map();
  const events = [];

  const statusKey = (step) => `step${step.charAt(0).toUpperCase() + step.slice(1)}Status`;

  const decorate = (project) => {
    const out = { ...project };
    for (const step of PIPELINE_STEPS) {
      const key = statusKey(step);
      out[key] = stepStatus.get(`${project.id}:${step}`)
        ?? (pendingSteps.includes(step) ? 'pending' : 'completed');
    }
    return out;
  };

  return {
    events,
    stepStatus,
    listProjectsForAutomation: () => projects.map(decorate),
    getProject: (id) => {
      const found = projects.find((project) => project.id === id);
      return found ? decorate(found) : null;
    },
    getAutomationSettings: () => {
      const all = {};
      for (const step of PIPELINE_STEPS) all[step] = settings[step] ?? 'always';
      return all;
    },
    updateProjectStepStatus: (projectId, step, status) => {
      stepStatus.set(`${projectId}:${step}`, status);
    },
    appendEvent: (event) => {
      events.push(event);
    }
  };
}

// Fast watchdog budgets so the tests finish in milliseconds instead of minutes.
const FAST_TIMING = {
  stepTimeouts: { listing: { idleMs: 200, hardCapMs: 200 } },
  watchdogTickMs: 10,
  orphanSettleGraceMs: 100,
  retryDelaysMs: [1, 1, 1]
};

function collectNotifications(manager) {
  const seen = [];
  manager.on('notify', (payload) => seen.push(payload));
  return seen;
}

test('a frozen listing step is aborted instead of hanging the pipeline forever', async () => {
  const store = createStore({
    projects: [{ id: 'p1', name: 'Frozen Book' }],
    pendingSteps: ['listing']
  });

  let abortCalls = 0;
  // Mimics the real freeze: every attempt blocks on an await that only settles once
  // something external (the abort hook) tears down the resource it is waiting on.
  let releaseRunner = () => {};

  const manager = new AutomationManager({
    store,
    broadcast: async () => {},
    ...FAST_TIMING,
    abortStep: async (step) => {
      abortCalls += 1;
      assert.strictEqual(step, 'listing');
      releaseRunner();
    },
    stepRunners: {
      listing: async () => {
        await new Promise((resolve) => { releaseRunner = resolve; });
      }
    }
  });

  const notifications = collectNotifications(manager);
  await manager.start();
  await manager._loopPromise;

  assert.strictEqual(abortCalls, 4, 'every frozen attempt should be aborted');
  assert.strictEqual(store.stepStatus.get('p1:listing'), 'failed');

  const stalled = notifications.find((n) => n.type === 'step_stalled');
  assert.ok(stalled, 'a step_stalled notification should be emitted');

  const stallEvent = store.events.find((e) => e.details?.code === 'STEP_STALLED');
  assert.ok(stallEvent, 'the stall should be recorded in the event log');
  assert.match(stallEvent.message, /frozen/i);
});

test('a frozen step never reports the automation as completed', async () => {
  const store = createStore({
    projects: [{ id: 'p1', name: 'Frozen Book' }],
    pendingSteps: ['listing']
  });

  let releaseRunner = () => {};
  const manager = new AutomationManager({
    store,
    broadcast: async () => {},
    ...FAST_TIMING,
    abortStep: async () => { releaseRunner(); },
    stepRunners: {
      listing: async () => {
        await new Promise((resolve) => { releaseRunner = resolve; });
      }
    }
  });

  const notifications = collectNotifications(manager);
  await manager.start();
  await manager._loopPromise;

  const types = notifications.map((n) => n.type);
  assert.ok(!types.includes('all_completed'), 'must not claim every book completed');
  assert.ok(!types.includes('book_completed'), 'must not claim the book completed');
  assert.ok(!types.includes('step_completed'), 'must not claim the step completed');
  assert.ok(types.includes('pipeline_failed'), 'the run should be reported as failed');
});

test('a one-off freeze recovers on retry instead of failing the book', async () => {
  const store = createStore({
    projects: [{ id: 'p1', name: 'Recovering Book' }],
    pendingSteps: ['listing']
  });

  let attempts = 0;
  let releaseRunner = () => {};

  const manager = new AutomationManager({
    store,
    broadcast: async () => {},
    ...FAST_TIMING,
    abortStep: async () => { releaseRunner(); },
    stepRunners: {
      listing: async (_projectId, onProgress) => {
        attempts += 1;
        // Only the first attempt hangs; the retry after the abort succeeds.
        if (attempts === 1) await new Promise((resolve) => { releaseRunner = resolve; });
        onProgress(100);
      }
    }
  });

  const notifications = collectNotifications(manager);
  await manager.start();
  await manager._loopPromise;

  assert.strictEqual(attempts, 2);
  assert.strictEqual(store.stepStatus.get('p1:listing'), 'completed');
  assert.ok(notifications.some((n) => n.type === 'step_stalled'), 'the freeze should still be reported');
  assert.ok(notifications.some((n) => n.type === 'all_completed'), 'the recovered run should finish');
});

test('a step that returns without producing output fails verification', async () => {
  const store = createStore({
    projects: [{ id: 'p1', name: 'Empty Listing' }],
    pendingSteps: ['listing']
  });

  let runnerCalls = 0;
  const manager = new AutomationManager({
    store,
    broadcast: async () => {},
    ...FAST_TIMING,
    // The runner resolves cleanly — the old code marked this "completed".
    stepRunners: { listing: async (_projectId, onProgress) => { runnerCalls += 1; onProgress(100); } },
    stepVerifiers: {
      listing: () => {
        throw Object.assign(new Error('The generated TPT listing is missing title.'), {
          code: 'TPT_LISTING_INCOMPLETE'
        });
      }
    }
  });

  const notifications = collectNotifications(manager);
  await manager.start();
  await manager._loopPromise;

  assert.strictEqual(runnerCalls, 4, 'the step should be retried before giving up');
  assert.strictEqual(store.stepStatus.get('p1:listing'), 'failed');
  assert.ok(!notifications.some((n) => n.type === 'step_completed'));
  assert.ok(notifications.some((n) => n.type === 'step_failed'));
});

test('a run halted mid-way reports "stopped early" rather than success', async () => {
  const store = createStore({
    projects: [
      { id: 'p1', name: 'Book One' },
      { id: 'p2', name: 'Book Two' }
    ],
    // Listing is forced always-on (must never be skipped). Halt on thumbnails instead.
    pendingSteps: ['listing', 'thumbnails'],
    settings: { listing: 'always', thumbnails: 'manual' }
  });

  const manager = new AutomationManager({
    store,
    broadcast: async () => {},
    ...FAST_TIMING,
    stepRunners: {
      listing: async () => {},
      thumbnails: async () => {}
    },
    stepVerifiers: {
      // Allow empty listing output in this unit harness.
      listing: async () => {}
    }
  });

  const notifications = collectNotifications(manager);
  await manager.start();
  await manager._loopPromise;

  const types = notifications.map((n) => n.type);
  assert.ok(!types.includes('all_completed'), 'a halted run must not report success');

  const stopped = notifications.find((n) => n.type === 'pipeline_stopped');
  assert.ok(stopped, 'a pipeline_stopped notification should be emitted');
  assert.strictEqual(stopped.completedBooks, 0);
  assert.strictEqual(stopped.unprocessedBooks, 2, 'both books were left unprocessed');
});

test('a healthy run still completes and reports success', async () => {
  const store = createStore({
    projects: [{ id: 'p1', name: 'Good Book' }],
    pendingSteps: ['listing']
  });

  const manager = new AutomationManager({
    store,
    broadcast: async () => {},
    ...FAST_TIMING,
    stepRunners: { listing: async (_projectId, onProgress) => { onProgress(100); } },
    stepVerifiers: { listing: () => {} }
  });

  const notifications = collectNotifications(manager);
  await manager.start();
  await manager._loopPromise;

  assert.strictEqual(store.stepStatus.get('p1:listing'), 'completed');
  const completed = notifications.find((n) => n.type === 'all_completed');
  assert.ok(completed, 'a clean run should still report all_completed');
  assert.strictEqual(completed.completedBooks, 1);
  assert.strictEqual(completed.failedBooks, 0);
});

test('progress callbacks keep a slow but healthy step alive', async () => {
  const store = createStore({
    projects: [{ id: 'p1', name: 'Slow Book' }],
    pendingSteps: ['listing']
  });

  let aborted = false;
  const manager = new AutomationManager({
    store,
    broadcast: async () => {},
    ...FAST_TIMING,
    // Idle window of 200ms, no hard cap: steady progress must prevent a stall.
    stepTimeouts: { listing: { idleMs: 200, hardCapMs: 0 } },
    abortStep: async () => { aborted = true; },
    stepRunners: {
      listing: async (_projectId, onProgress) => {
        for (let i = 1; i <= 10; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          onProgress(i * 10);
        }
      }
    }
  });

  await manager.start();
  await manager._loopPromise;

  assert.strictEqual(aborted, false, 'a step reporting progress must not be aborted');
  assert.strictEqual(store.stepStatus.get('p1:listing'), 'completed');
});

test('a fake-complete thumbnails step is reopened instead of reporting success', async () => {
  const store = createStore({
    projects: [{ id: 'p1', name: 'Missing mockups' }]
  });

  let runnerCalls = 0;
  let filesSaved = false;
  const manager = new AutomationManager({
    store,
    broadcast: async () => {},
    ...FAST_TIMING,
    stepRunners: {
      thumbnails: async (_projectId, onProgress) => {
        runnerCalls += 1;
        filesSaved = true;
        onProgress(100);
      }
    },
    stepVerifiers: {
      thumbnails: () => {
        if (!filesSaved) {
          throw Object.assign(new Error('Only 0 of 4 marketing thumbnails were generated.'), {
            code: 'TPT_THUMBNAILS_INCOMPLETE'
          });
        }
      }
    }
  });

  const notifications = collectNotifications(manager);
  await manager.start();
  await manager._loopPromise;

  assert.strictEqual(runnerCalls, 1, 'missing mockups must be generated even if the step was marked complete');
  assert.strictEqual(store.stepStatus.get('p1:thumbnails'), 'completed');
  assert.ok(store.events.some((event) => /output is missing/i.test(event.message)));
  assert.ok(notifications.some((payload) => payload.type === 'all_completed'));
});

test('full automation can be scoped to the current book', async () => {
  const store = createStore({
    projects: [
      { id: 'p1', name: 'First' },
      { id: 'p2', name: 'Current book' }
    ],
    pendingSteps: ['listing']
  });
  const ran = [];
  const manager = new AutomationManager({
    store,
    broadcast: async () => {},
    ...FAST_TIMING,
    stepRunners: {
      listing: async (projectId, onProgress) => {
        ran.push(projectId);
        onProgress(100);
      }
    }
  });
  await manager.start({ projectId: 'p2' });
  await manager._loopPromise;
  assert.deepEqual(ran, ['p2']);
});

test('paused full automation does not switch to a different book on resume', async () => {
  const store = createStore({
    projects: [
      { id: 'p1', name: 'First' },
      { id: 'p2', name: 'Second' }
    ],
    pendingSteps: ['listing']
  });
  const ran = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const manager = new AutomationManager({
    store,
    broadcast: async () => {},
    ...FAST_TIMING,
    stepRunners: {
      listing: async (projectId, onProgress) => {
        ran.push(projectId);
        manager.pause();
        await gate;
        onProgress(100);
      }
    }
  });
  await manager.start({ projectId: 'p1' });
  const deadline = Date.now() + 1000;
  while (!manager.getStatus().paused && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(manager.getStatus().paused, true);
  await assert.rejects(
    () => manager.start({ projectId: 'p2' }),
    (error) => error.code === 'AUTOMATION_BUSY'
  );
  release();
  await manager.start({ projectId: 'p1' });
  await manager._loopPromise;
  assert.deepEqual(ran, ['p1']);
});
