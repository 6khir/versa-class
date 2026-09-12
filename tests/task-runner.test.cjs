'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { TaskStore, STATES } = require('../src/task-store.cjs');
const { TaskRunner } = require('../src/task-runner.cjs');

// Real timers, small durations: the runner's loop is genuinely asynchronous and
// the point of these tests is that it behaves under real scheduling.
function makeStore(options = {}) {
  const db = new DatabaseSync(':memory:');
  return new TaskStore(db, options);
}

const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms));

/**
 * Build a runner that is always stopped when the test ends.
 *
 * A failed assertion used to skip the explicit stop(), leaving a lane polling on
 * real timers; node then never exited and the whole file hung instead of
 * reporting which assertion failed.
 */
function runnerFor(t, options) {
  const runner = new TaskRunner(options);
  t.after(async () => { await runner.stop({ reason: 'test teardown' }).catch(() => {}); });
  return runner;
}

async function until(predicate, { timeoutMs = 3_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await settle(10);
  }
  return false;
}

test('a queued task is picked up, run, and recorded as done', async (t) => {
  const store = makeStore();
  const seen = [];
  const runner = runnerFor(t, {
    store,
    handlers: { greet: async ({ task }) => { seen.push(task.payload.name); return { ok: true }; } },
    idleMs: 5
  });
  store.enqueue({ kind: 'greet', dedupeKey: 'g1', payload: { name: 'page-1' } });
  runner.start();
  assert.ok(await until(() => store.stats().done === 1), 'the task should complete');
  assert.deepEqual(seen, ['page-1']);
  const [task] = store.listByProject(null).length ? store.listByProject(null) : [];
  void task;
  assert.equal(store.stats().done, 1);
});

test('a lane runs one task at a time', async (t) => {
  const store = makeStore();
  let concurrent = 0;
  let peak = 0;
  const runner = runnerFor(t, {
    store,
    handlers: {
      browser: async () => {
        concurrent += 1;
        peak = Math.max(peak, concurrent);
        await settle(30);
        concurrent -= 1;
      }
    },
    lanes: { browser: ['browser'] },
    idleMs: 5
  });
  for (let i = 0; i < 4; i += 1) store.enqueue({ kind: 'browser', dedupeKey: `b${i}` });
  runner.start();
  assert.ok(await until(() => store.stats().done === 4));
  // Browser work shares one Chrome profile and one composer; two at once corrupt
  // each other.
  assert.equal(peak, 1, `a lane must be serial, saw ${peak} at once`);
});

test('separate lanes run at the same time', async (t) => {
  const store = makeStore();
  let together = false;
  let inVision = false;
  let inBrowser = false;
  const mark = () => { if (inVision && inBrowser) together = true; };
  const runner = runnerFor(t, {
    store,
    handlers: {
      vision: async () => { inVision = true; mark(); await settle(60); inVision = false; },
      browser: async () => { inBrowser = true; mark(); await settle(60); inBrowser = false; }
    },
    lanes: { vision: ['vision'], browser: ['browser'] },
    idleMs: 5
  });
  store.enqueue({ kind: 'vision', dedupeKey: 'v' });
  store.enqueue({ kind: 'browser', dedupeKey: 'b' });
  runner.start();
  assert.ok(await until(() => store.stats().done === 2));
  assert.equal(together, true, 'vision should not have to wait for the browser');
});

// The stuck-stage problem: a handler that never returns must not wedge the app.

test('a task that passes its deadline is aborted and requeued', async (t) => {
  const store = makeStore();
  let aborted = false;
  const runner = runnerFor(t, {
    store,
    handlers: {
      hang: async ({ signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); });
      })
    },
    deadlines: { hang: 60 },
    heartbeatMs: 20,
    idleMs: 5
  });
  store.enqueue({ kind: 'hang', dedupeKey: 'h', maxAttempts: 2 });
  const failures = [];
  runner.on('failed', (e) => failures.push(e));
  runner.start();
  assert.ok(await until(() => failures.length >= 1, { timeoutMs: 3_000 }), 'the deadline should fire');

  assert.equal(aborted, true, 'the handler is told to stop, not left running');
  assert.equal(failures[0].timedOut, true);
  assert.equal(failures[0].error.code, 'TASK_DEADLINE');
  // Requeued rather than lost: a stall is now a retry, not a dead stage.
  const task = store.get(failures[0].task.id);
  assert.ok([STATES.PENDING, STATES.FAILED].includes(task.state));
  assert.ok(task.attempts >= 1);
});

test('a handler that marks an error unretryable is not retried', async (t) => {
  const store = makeStore();
  const runner = runnerFor(t, {
    store,
    handlers: {
      bad: async () => { throw Object.assign(new Error('no such file'), { retryable: false }); }
    },
    idleMs: 5
  });
  store.enqueue({ kind: 'bad', dedupeKey: 'x', maxAttempts: 5 });
  runner.start();
  assert.ok(await until(() => store.stats().failed === 1));
  assert.equal(store.stats().failed, 1);
  assert.equal(store.stats().pending, 0, 'a missing file does not become five attempts');
});

test('a task nothing can run fails loudly instead of waiting forever', async (t) => {
  const store = makeStore();
  const runner = runnerFor(t, { store, handlers: { known: async () => {} }, idleMs: 5 });
  const orphan = store.enqueue({ kind: 'mystery', projectId: 'p1', dedupeKey: 'm', maxAttempts: 3 });
  const unhandled = [];
  runner.on('unhandled-kind', (e) => unhandled.push(e));
  runner.start();

  // Without this it is never leased — no lane covers its kind — so the stage it
  // belongs to simply never happens and nothing says why. That silent stall is
  // the failure this design exists to remove.
  assert.ok(await until(() => store.get(orphan.id).state === STATES.FAILED));
  assert.match(store.get(orphan.id).lastError, /No worker handles task kind "mystery"/);
  assert.deepEqual(unhandled.map((e) => e.kind), ['mystery']);
});

test('a handler writes a checkpoint that the retry reads', async (t) => {
  const store = makeStore({ backoff: { baseMs: 20, maxMs: 100 } });
  const attemptsSeen = [];
  const runner = runnerFor(t, {
    store,
    handlers: {
      pages: async ({ task, checkpoint }) => {
        attemptsSeen.push(task.checkpoint);
        const done = task.checkpoint?.done ?? 0;
        if (done < 2) {
          checkpoint({ done: done + 1 });
          throw new Error('interrupted');
        }
        return { done };
      }
    },
    idleMs: 5
  });
  store.enqueue({ kind: 'pages', dedupeKey: 'p', maxAttempts: 5 });
  runner.start();
  assert.ok(await until(() => store.stats().done === 1, { timeoutMs: 8_000 }), 'should eventually finish');
  // Attempt one starts from nothing; each later attempt sees the committed
  // progress rather than starting over.
  assert.equal(attemptsSeen[0], null);
  assert.deepEqual(attemptsSeen[1], { done: 1 });
  assert.deepEqual(attemptsSeen[2], { done: 2 });
});

test('stopping the runner aborts what is in flight', async (t) => {
  const store = makeStore();
  let aborted = false;
  const runner = runnerFor(t, {
    store,
    handlers: {
      slow: async ({ signal }) => new Promise((_r, reject) => {
        signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); });
      })
    },
    idleMs: 5
  });
  store.enqueue({ kind: 'slow', dedupeKey: 's' });
  runner.start();
  assert.ok(await until(() => runner.status().active.length === 1));
  await runner.stop({ reason: 'user paused' });
  assert.equal(aborted, true);
  assert.equal(runner.status().active.length, 0);
});

test('pausing stops dispatch without killing the runner', async (t) => {
  const store = makeStore();
  let ran = 0;
  const runner = runnerFor(t, { store, handlers: { k: async () => { ran += 1; } }, idleMs: 5 });
  runner.start();
  runner.pause();
  store.enqueue({ kind: 'k', dedupeKey: 'a' });
  await settle(120);
  assert.equal(ran, 0, 'a paused runner does not take work');
  runner.resume();
  assert.ok(await until(() => ran === 1));
});

test('work left leased by a previous process is reclaimed on start', async (t) => {
  const store = makeStore();
  store.enqueue({ kind: 'k', dedupeKey: 'orphan' });
  // A worker that is no longer here took it and never came back.
  store.lease({ owner: 'dead-worker', leaseMs: 1 });
  // lease() floors the duration at a second, so wait past it: the point is a lease
  // that has genuinely lapsed, not one that merely looks short.
  await settle(1_100);

  let ran = 0;
  const runner = runnerFor(t, { store, handlers: { k: async () => { ran += 1; } }, idleMs: 5 });
  const reclaimed = [];
  runner.on('reclaimed', (tasks) => reclaimed.push(...tasks));
  runner.start();
  assert.ok(await until(() => ran === 1), 'orphaned work is picked up, not stranded');
  assert.equal(reclaimed.length, 1);
});
