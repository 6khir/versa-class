'use strict';

/**
 * The worker that turns queued rows into work.
 *
 * This is the piece that replaces "await the whole stage inside an IPC handler".
 * The runner leases one task at a time per lane, runs its handler with a hard
 * deadline, heartbeats the lease while the handler is genuinely working, and
 * commits the outcome. The UI is never waiting on any of it — it reads task rows.
 *
 * Three rules the design turns on:
 *
 *   a handler is given a signal, not a promise to wait on forever. Every task has
 *   a deadline. When it passes, the handler is aborted and the task goes back to
 *   the queue rather than hanging the lane. A stage can no longer wedge the app.
 *
 *   a lane is serial. Browser work shares one Chrome profile and one composer, so
 *   two browser tasks at once corrupt each other. Lanes let vision run while the
 *   browser waits, without either of them racing itself.
 *
 *   progress is written, not remembered. A handler reports through `checkpoint`,
 *   so the retry after a crash continues from the last committed point.
 *
 * Timers and the clock are injected so the loop can be tested without sleeping.
 */

const EventEmitter = require('node:events');
const { randomUUID } = require('node:crypto');

const DEFAULTS = Object.freeze({
  leaseMs: 60_000,
  heartbeatMs: 15_000,
  idleMs: 750,
  // A task that has not finished in this long is considered stuck. Handlers that
  // legitimately run longer declare their own deadline.
  defaultDeadlineMs: 30 * 60_000
});

/** Thrown when a task passes its deadline; retryable, so the queue redispatches. */
class TaskDeadlineError extends Error {
  constructor(kind, ms) {
    super(`Task "${kind}" passed its ${Math.round(ms / 1000)}s deadline and was aborted.`);
    this.code = 'TASK_DEADLINE';
    this.retryable = true;
  }
}

class TaskRunner extends EventEmitter {
  /**
   * @param {object}   options
   * @param {object}   options.store      a TaskStore
   * @param {object}   options.handlers   map of kind -> async ({ task, signal, checkpoint, log }) => result
   * @param {object}   [options.lanes]    map of lane name -> array of kinds. One task per lane at a time.
   * @param {object}   [options.deadlines] map of kind -> ms
   */
  constructor({
    store,
    handlers = {},
    lanes = null,
    deadlines = {},
    now = () => Date.now(),
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    watchdog = null,
    ...tuning
  } = {}) {
    super();
    if (!store) throw new Error('A runner needs a task store.');
    this.store = store;
    this.handlers = handlers;
    this.deadlines = deadlines;
    this.config = { ...DEFAULTS, ...tuning };
    this._now = now;
    this._setTimer = setTimer;
    this._clearTimer = clearTimer;
    this.watchdog = typeof watchdog === 'function' ? watchdog : null;

    // One lane per group of kinds that must not run concurrently. Anything not
    // named lands in a default lane, which is also serial — concurrency is opt-in.
    this.lanes = lanes || { default: Object.keys(handlers) };
    this.workerId = `worker-${randomUUID().slice(0, 8)}`;
    this.running = false;
    this.active = new Map();   // lane -> { task, abort }
    this._loops = new Map();   // lane -> promise
    this._paused = false;
  }

  /** Start every lane. Returns immediately; the lanes run in the background. */
  start() {
    if (this.running) return;
    this.running = true;
    this._paused = false;
    // Anything left leased by a process that is no longer here comes back first.
    const reclaimed = this.store.reclaimExpired();
    if (reclaimed.length) this.emit('reclaimed', reclaimed);
    this.#watchPipeline();
    this.#failUnhandled();
    for (const lane of Object.keys(this.lanes)) {
      this._loops.set(lane, this.#lane(lane));
    }
    this.emit('started', { workerId: this.workerId, lanes: Object.keys(this.lanes) });
  }

  /**
   * Stop taking new work. In-flight tasks are aborted so their lanes exit; the
   * queue redispatches them because their leases are released by the failure.
   */
  async stop({ abortInFlight = true, reason = 'runner stopped' } = {}) {
    this.running = false;
    if (abortInFlight) {
      for (const [, entry] of this.active) entry.abort.abort(new Error(reason));
    }
    await Promise.allSettled([...this._loops.values()]);
    this._loops.clear();
    this.emit('stopped', { reason });
  }

  /**
   * Fail tasks whose kind no lane can reach.
   *
   * A kind with no handler is never leased, so the task sits pending forever and
   * the stage it belongs to simply never happens — a silent stall, which is the
   * failure this whole design exists to remove. Better to fail it loudly, with
   * the reason on the row.
   */
  #failUnhandled() {
    const reachable = new Set();
    for (const kinds of Object.values(this.lanes)) for (const kind of kinds) reachable.add(kind);
    const orphans = this.store.pendingKinds().filter((kind) => !reachable.has(kind) || typeof this.handlers[kind] !== 'function');
    for (const kind of orphans) {
      const failed = this.store.failKind(kind, `No worker handles task kind "${kind}". It would have waited forever.`);
      if (failed) this.emit('unhandled-kind', { kind, count: failed });
    }
  }

  /** Stop dispatching without tearing down what is already running. */
  pause() { this._paused = true; this.emit('paused'); }
  resume() { this._paused = false; this.emit('resumed'); }

  status() {
    return {
      workerId: this.workerId,
      running: this.running,
      paused: this._paused,
      active: [...this.active.entries()].map(([lane, entry]) => ({
        lane, id: entry.task.id, kind: entry.task.kind, projectId: entry.task.projectId
      })),
      queue: this.store.stats()
    };
  }

  // ---- internals ---------------------------------------------------------

  /** One serial loop per lane. */
  async #lane(lane) {
    const kinds = this.lanes[lane];
    while (this.running) {
      if (this._paused) {
        await this.#idle();
        continue;
      }
      let task = null;
      try {
        task = this.store.lease({ owner: this.workerId, kinds, leaseMs: this.config.leaseMs });
      } catch (error) {
        this.emit('error', error);
      }
      if (!task) {
        this.#watchPipeline();
        await this.#idle();
        continue;
      }
      await this.#run(lane, task);
    }
  }

  async #run(lane, task) {
    const handler = this.handlers[task.kind];
    if (typeof handler !== 'function') {
      // An unknown kind is a programming error, not a transient fault, so it is
      // terminal — retrying cannot make a missing handler appear.
      this.store.fail(task.id, this.workerId, new Error(`No handler for task kind "${task.kind}".`), { retryable: false });
      this.emit('failed', { task, fatal: true });
      return;
    }

    const abort = new AbortController();
    this.active.set(lane, { task, abort });
    this.emit('started-task', { lane, task });

    const deadlineMs = Number(this.deadlines[task.kind]) || this.config.defaultDeadlineMs;
    let heartbeat = null;
    let deadlineTimer = null;
    let timedOut = false;

    // The lease is extended only while the handler is still going. If the handler
    // is wedged the heartbeat keeps its lease alive, which is exactly why the
    // deadline exists as a separate, non-negotiable stop.
    const beat = () => {
      heartbeat = this._setTimer(() => {
        if (!abort.signal.aborted) {
          this.store.heartbeat(task.id, this.workerId, { leaseMs: this.config.leaseMs });
          beat();
        }
      }, this.config.heartbeatMs);
    };
    beat();
    deadlineTimer = this._setTimer(() => {
      timedOut = true;
      abort.abort(new TaskDeadlineError(task.kind, deadlineMs));
    }, deadlineMs);

    try {
      const result = await handler({
        task,
        signal: abort.signal,
        // Handlers report progress through these rather than returning at the end,
        // so a crash halfway still leaves a usable record.
        checkpoint: (data) => this.store.checkpoint(task.id, this.workerId, data),
        progress: (percent, message) => this.emit('progress', { task, percent, message }),
        log: (message) => this.emit('log', { task, message })
      });
      if (timedOut) throw new TaskDeadlineError(task.kind, deadlineMs);
      const done = this.store.complete(task.id, this.workerId, result ?? null);
      this.emit('completed', { lane, task: done ?? task, result: result ?? null });
    } catch (error) {
      const cause = timedOut ? new TaskDeadlineError(task.kind, deadlineMs) : error;
      // `retryable === false` on the error is how a handler says "do not try this
      // again" — a missing file, an invalid input. Everything else is transient
      // until the attempt cap says otherwise.
      const retryable = cause?.retryable !== false;
      const failed = this.store.fail(task.id, this.workerId, cause, { retryable });
      this.emit('failed', { lane, task: failed ?? task, error: cause, retryable, timedOut });
    } finally {
      if (heartbeat) this._clearTimer(heartbeat);
      if (deadlineTimer) this._clearTimer(deadlineTimer);
      this.active.delete(lane);
    }
  }

  #watchPipeline() {
    if (typeof this.watchdog !== 'function') return;
    try {
      const report = this.watchdog({
        runner: this,
        now: this._now(),
        activeIds: [...this.active.values()].map((entry) => entry.task.id)
      });
      if (report) this.emit('watchdog', report);
    } catch (error) {
      this.emit('error', error);
    }
  }

  #idle() {
    return new Promise((resolve) => this._setTimer(resolve, this.config.idleMs));
  }
}

module.exports = { TaskRunner, TaskDeadlineError, DEFAULTS };
