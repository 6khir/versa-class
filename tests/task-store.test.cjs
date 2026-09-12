'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { TaskStore, STATES, backoffMs } = require('../src/task-store.cjs');

// A controllable clock, so lease expiry and backoff are tested by moving time
// rather than by sleeping.
function harness() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA journal_mode = WAL;');
  let clock = 1_000_000;
  const store = new TaskStore(db, { now: () => clock });
  return {
    store,
    db,
    at: () => clock,
    advance: (ms) => { clock += ms; return clock; }
  };
}

test('a task starts pending and is claimed exactly once', () => {
  const { store } = harness();
  const queued = store.enqueue({ kind: 'analysis', projectId: 'p1', payload: { url: 'x' } });
  assert.equal(queued.state, STATES.PENDING);
  assert.equal(queued.attempts, 0);

  const first = store.lease({ owner: 'worker-a' });
  assert.equal(first.id, queued.id);
  assert.equal(first.state, STATES.LEASED);
  assert.equal(first.leaseOwner, 'worker-a');
  assert.equal(first.attempts, 1, 'claiming counts as an attempt');

  // A second worker finds nothing: the row is not claimable twice.
  assert.equal(store.lease({ owner: 'worker-b' }), null);
});

test('enqueueing the same work twice yields one task', () => {
  const { store } = harness();
  const a = store.enqueue({ kind: 'page', projectId: 'p1', dedupeKey: 'p1:page:7' });
  const b = store.enqueue({ kind: 'page', projectId: 'p1', dedupeKey: 'p1:page:7' });
  assert.equal(a.id, b.id, 'a double click or a resume must not fan out');
  assert.equal(store.stats('p1').total, 1);

  // Once it is finished the same key may be scheduled again — a regenerate is
  // legitimate work, it just must not stack up while one is already queued.
  store.complete(store.lease({ owner: 'w' }).id, 'w', { ok: true });
  const c = store.enqueue({ kind: 'page', projectId: 'p1', dedupeKey: 'p1:page:7' });
  assert.notEqual(c.id, a.id);
  assert.equal(c.state, STATES.PENDING);
});

test('dispatch order is total and deterministic', () => {
  const { store, advance } = harness();
  store.enqueue({ kind: 'k', dedupeKey: 'low-early', priority: 0 });
  advance(10);
  store.enqueue({ kind: 'k', dedupeKey: 'low-late', priority: 0 });
  advance(10);
  store.enqueue({ kind: 'k', dedupeKey: 'high-late', priority: 5 });

  // Priority first, then age. The same queue always dispatches the same way.
  assert.equal(store.lease({ owner: 'w' }).dedupeKey, 'high-late');
  assert.equal(store.lease({ owner: 'w' }).dedupeKey, 'low-early');
  assert.equal(store.lease({ owner: 'w' }).dedupeKey, 'low-late');
});

test('tasks enqueued in the same millisecond still dispatch in order', () => {
  // The clock does not advance here, so every task shares a created_at. The
  // tie-break used to be the id — a random UUID — which meant the same queue
  // dispatched in a different order on every run. "Deterministic" cannot mean
  // that, so the tie-break is insertion order.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { store } = harness();
    for (const key of ['first', 'second', 'third']) store.enqueue({ kind: 'k', dedupeKey: key });
    assert.deepEqual(
      [
        store.lease({ owner: 'w' }).dedupeKey,
        store.lease({ owner: 'w' }).dedupeKey,
        store.lease({ owner: 'w' }).dedupeKey
      ],
      ['first', 'second', 'third'],
      'order must not depend on which UUIDs happened to be generated'
    );
  }
});

test('kind filtering lets a worker take only what it can run', () => {
  const { store } = harness();
  store.enqueue({ kind: 'vision', dedupeKey: 'v' });
  store.enqueue({ kind: 'browser', dedupeKey: 'b' });
  const claimed = store.lease({ owner: 'vision-worker', kinds: ['vision'] });
  assert.equal(claimed.kind, 'vision');
  assert.equal(store.lease({ owner: 'vision-worker', kinds: ['vision'] }), null);
});

// The crash story: a worker takes a task and dies. Nothing reports the failure,
// because nothing is left running to report it.

test('a task held by a dead worker returns to the queue when its lease lapses', () => {
  const { store, advance } = harness();
  store.enqueue({ kind: 'analysis', dedupeKey: 'a', maxAttempts: 3 });
  const leased = store.lease({ owner: 'doomed', leaseMs: 30_000 });
  assert.equal(leased.state, STATES.LEASED);

  // Still inside the lease: nobody else may take it.
  advance(29_000);
  assert.equal(store.lease({ owner: 'other' }), null);

  // Past it: reclaimed, and the next worker continues the work.
  advance(2_000);
  const recovered = store.lease({ owner: 'fresh' });
  assert.equal(recovered.id, leased.id);
  assert.equal(recovered.attempts, 2, 'the earlier attempt is remembered');
  assert.match(recovered.lastError ?? '', /reclaimed/i);
});

test('a reclaimed task that is out of attempts fails instead of looping forever', () => {
  const { store, advance } = harness();
  store.enqueue({ kind: 'analysis', dedupeKey: 'a', maxAttempts: 1 });
  store.lease({ owner: 'doomed', leaseMs: 1_000 });
  advance(5_000);
  const reclaimed = store.reclaimExpired();
  assert.equal(reclaimed[0].state, STATES.FAILED);
  assert.equal(store.lease({ owner: 'fresh' }), null, 'a failed task is not redispatched');
});

test('a heartbeat keeps genuine long work alive', () => {
  const { store, advance } = harness();
  store.enqueue({ kind: 'video', dedupeKey: 'v' });
  const leased = store.lease({ owner: 'w', leaseMs: 10_000 });
  for (let i = 0; i < 5; i += 1) {
    advance(8_000);
    assert.equal(store.heartbeat(leased.id, 'w', { leaseMs: 10_000 }), true);
  }
  advance(8_000);
  assert.equal(store.lease({ owner: 'thief' }), null, '40s of real work is not a crash');
});

test('a heartbeat from a worker that no longer owns the task is refused', () => {
  const { store, advance } = harness();
  store.enqueue({ kind: 'k', dedupeKey: 'k' });
  const leased = store.lease({ owner: 'first', leaseMs: 1_000 });
  advance(2_000);
  store.lease({ owner: 'second' });
  assert.equal(store.heartbeat(leased.id, 'first'), false, 'a zombie cannot reclaim its old task');
});

// Resumability: a retry continues from the checkpoint rather than restarting.

test('a checkpoint survives a failure and is there for the retry', () => {
  const { store, advance } = harness();
  store.enqueue({ kind: 'interior', dedupeKey: 'i', maxAttempts: 3 });
  const first = store.lease({ owner: 'w1' });
  store.checkpoint(first.id, 'w1', { pagesDone: [1, 2, 3], lastPage: 3 });
  store.fail(first.id, 'w1', new Error('browser died'), { retryable: true });

  advance(60_000);
  const second = store.lease({ owner: 'w2' });
  assert.equal(second.id, first.id);
  assert.deepEqual(second.checkpoint, { pagesDone: [1, 2, 3], lastPage: 3 });
  assert.equal(second.attempts, 2);
});

test('a retryable failure waits, and a fatal one does not retry at all', () => {
  const { store, advance, at } = harness();
  store.enqueue({ kind: 'k', dedupeKey: 'retry', maxAttempts: 3 });
  const t = store.lease({ owner: 'w' });
  const failed = store.fail(t.id, 'w', Object.assign(new Error('rate limited'), { code: 'RATE_LIMIT' }));
  assert.equal(failed.state, STATES.PENDING);
  assert.ok(failed.availableAt > at(), 'a retry backs off rather than spinning');
  assert.match(failed.lastError, /RATE_LIMIT: rate limited/);
  assert.equal(store.lease({ owner: 'w' }), null, 'not runnable until the backoff elapses');
  advance(backoffMs(1) + 1);
  assert.ok(store.lease({ owner: 'w' }), 'runnable once it has');

  store.enqueue({ kind: 'k', dedupeKey: 'fatal', maxAttempts: 5 });
  const f = store.lease({ owner: 'w2', kinds: ['k'] });
  const dead = store.fail(f.id, 'w2', new Error('no such file'), { retryable: false });
  assert.equal(dead.state, STATES.FAILED, 'an unretryable failure is terminal even with attempts left');
});

test('attempts are bounded', () => {
  const { store, advance } = harness();
  store.enqueue({ kind: 'k', dedupeKey: 'k', maxAttempts: 2 });
  for (let i = 0; i < 2; i += 1) {
    const t = store.lease({ owner: 'w' });
    assert.ok(t, `attempt ${i + 1} should be dispatched`);
    store.fail(t.id, 'w', new Error('nope'));
    advance(10 * 60_000);
  }
  assert.equal(store.lease({ owner: 'w' }), null);
  assert.equal(store.stats().failed, 1);
});

test('a still-running handler can complete after its lease was reclaimed', () => {
  const { store, advance } = harness();
  store.enqueue({ kind: 'analysis', dedupeKey: 'analysis', maxAttempts: 4 });
  const leased = store.lease({ owner: 'w', leaseMs: 1_000 });
  advance(5_000);
  const reclaimed = store.reclaimExpired();
  assert.equal(reclaimed[0].state, STATES.PENDING);
  const done = store.complete(leased.id, 'w', { projectId: 'book-1' });
  assert.equal(done.state, STATES.DONE);
  assert.deepEqual(done.result, { projectId: 'book-1' });
});

test('reclaimExpired skips leases the current worker is still running', () => {
  const { store, advance } = harness();
  store.enqueue({ kind: 'analysis', dedupeKey: 'analysis' });
  const leased = store.lease({ owner: 'w', leaseMs: 1_000 });
  advance(5_000);
  const kept = store.reclaimExpired(null, { ignoreIds: [leased.id] });
  assert.equal(kept.length, 0);
  assert.equal(store.get(leased.id).state, STATES.LEASED);
});

test('completion is final and carries its result', () => {
  const { store } = harness();
  store.enqueue({ kind: 'k', dedupeKey: 'k' });
  const t = store.lease({ owner: 'w' });
  const done = store.complete(t.id, 'w', { pages: 24 });
  assert.equal(done.state, STATES.DONE);
  assert.deepEqual(done.result, { pages: 24 });
  assert.equal(store.complete(t.id, 'w', { pages: 99 }), null, 'a finished task does not finish twice');
  assert.equal(store.lease({ owner: 'w' }), null);
});

test('cancelling a project stops its queued and running work only', () => {
  const { store } = harness();
  store.enqueue({ kind: 'k', projectId: 'p1', dedupeKey: 'a' });
  store.enqueue({ kind: 'k', projectId: 'p1', dedupeKey: 'b' });
  store.enqueue({ kind: 'k', projectId: 'p2', dedupeKey: 'c' });
  const running = store.lease({ owner: 'w' });
  store.cancelProject('p1', 'user paused');

  assert.equal(store.get(running.id).state, STATES.CANCELLED);
  assert.equal(store.stats('p1').cancelled, 2);
  assert.equal(store.stats('p2').pending, 1, 'another project is untouched');
});

// The whole point: the queue after a restart is the queue before it.

test('the queue survives a process restart', () => {
  const db = new DatabaseSync(':memory:');
  let clock = 5_000;
  const first = new TaskStore(db, { now: () => clock });
  first.enqueue({ kind: 'interior', projectId: 'p1', dedupeKey: 'p1:interior', payload: { pages: 24 } });
  const leased = first.lease({ owner: 'worker-before-crash', leaseMs: 30_000 });
  first.checkpoint(leased.id, 'worker-before-crash', { pagesDone: 17 });

  // The process dies here. A new TaskStore opens the same database.
  clock += 60_000;
  const second = new TaskStore(db, { now: () => clock });
  const resumed = second.lease({ owner: 'worker-after-restart' });

  assert.equal(resumed.id, leased.id, 'the same work is picked up');
  assert.deepEqual(resumed.checkpoint, { pagesDone: 17 }, 'and it knows where it got to');
  assert.deepEqual(resumed.payload, { pages: 24 });
  assert.equal(second.stats('p1').total, 1, 'nothing was duplicated by the restart');
});

test('latestByKinds returns newest marketplace tasks first', () => {
  const { store, advance } = harness();
  store.enqueue({ kind: 'trend_scan', dedupeKey: 'scan-1' });
  advance(10);
  store.enqueue({ kind: 'analysis', dedupeKey: 'analysis-1' });
  advance(10);
  store.enqueue({ kind: 'interior', dedupeKey: 'other' });
  const latest = store.latestByKinds(['trend_scan', 'analysis'], { limit: 8 });
  assert.equal(latest.length, 2);
  assert.equal(latest[0].kind, 'analysis');
  assert.equal(latest[1].kind, 'trend_scan');
  assert.ok(!latest.some((task) => task.kind === 'interior'));
});

test('finished tasks are pruned, live ones never are', () => {
  const { store, advance } = harness();
  store.enqueue({ kind: 'k', dedupeKey: 'old' });
  const t = store.lease({ owner: 'w' });
  store.complete(t.id, 'w');
  store.enqueue({ kind: 'k', dedupeKey: 'live' });
  advance(30 * 24 * 60 * 60_000);
  assert.equal(store.prune({ olderThanMs: 7 * 24 * 60 * 60_000 }), 1);
  assert.equal(store.stats().pending, 1);
});
