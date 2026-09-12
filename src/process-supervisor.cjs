'use strict';

/**
 * Watchdog for a long-lived child process (the Python vision worker, ComfyUI).
 *
 * The bridge this replaces rejected a request when it timed out but left the
 * child running. `#proc` stayed set, so the next request went straight back into
 * the same wedged interpreter and every request after it timed out too. Nothing
 * ever recovered without someone quitting the app.
 *
 * A supervisor owns the process instead of borrowing it:
 *
 *   liveness   a periodic probe the child must answer. Silence is a fault, not
 *              a pause — a wedged process answers nothing while looking alive.
 *   escalation SIGTERM, a grace period, then SIGKILL. A process that ignores
 *              the first signal is not asked twice.
 *   the group  the child is spawned detached and signalled by process group, so
 *              a worker that spawned its own children (ComfyUI does) does not
 *              leave orphans holding the port and the GPU.
 *   backoff    restarts are spaced, and a child that dies repeatedly inside the
 *              stability window trips a breaker instead of respawning forever.
 *
 * The supervisor never decides what work should happen next. It reports what
 * happened to the process; requeueing the interrupted task belongs to the queue,
 * which already knows how (the lease lapses, or the runner fails the task).
 *
 * `spawnFn`, `now` and `setTimer` are injected so the whole state machine is
 * testable without spawning anything or waiting in real time.
 */

const EventEmitter = require('node:events');
const { spawn: nodeSpawn } = require('node:child_process');

const STATES = Object.freeze({
  STOPPED: 'stopped',
  STARTING: 'starting',
  RUNNING: 'running',
  RESTARTING: 'restarting',
  GAVE_UP: 'gave-up'
});

const DEFAULTS = Object.freeze({
  probeIntervalMs: 15_000,
  probeTimeoutMs: 10_000,
  startTimeoutMs: 60_000,
  killGraceMs: 5_000,
  restartBackoffMs: [1_000, 5_000, 15_000, 30_000],
  // Deaths inside this window count toward the breaker; surviving longer clears
  // the streak, so a process that runs for an hour and then dies starts fresh.
  stabilityWindowMs: 60_000,
  maxRapidRestarts: 5
});

class ProcessSupervisor extends EventEmitter {
  /**
   * @param {object}   options
   * @param {string}   options.command          executable
   * @param {string[]} [options.args]
   * @param {object}   [options.spawnOptions]   cwd, env, stdio
   * @param {Function} [options.probe]          async (child) => boolean; the liveness check
   * @param {Function} [options.spawnFn]        injectable spawn
   * @param {Function} [options.now]            injectable clock
   * @param {Function} [options.setTimer]       injectable setTimeout
   * @param {Function} [options.clearTimer]     injectable clearTimeout
   * @param {Function} [options.killFn]         injectable process.kill
   */
  constructor({
    command,
    args = [],
    spawnOptions = {},
    probe = null,
    name = 'child process',
    spawnFn = nodeSpawn,
    now = () => Date.now(),
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    killFn = (pid, signal) => process.kill(pid, signal),
    ...tuning
  } = {}) {
    super();
    if (!command) throw new Error('A supervisor needs a command to run.');
    this.command = command;
    this.args = args;
    this.spawnOptions = spawnOptions;
    this.probe = probe;
    this.name = name;
    this.config = { ...DEFAULTS, ...tuning };

    this._spawn = spawnFn;
    this._now = now;
    this._setTimer = setTimer;
    this._clearTimer = clearTimer;
    this._kill = killFn;

    this.state = STATES.STOPPED;
    this.child = null;
    this.pid = null;
    this.startedAt = null;
    this.rapidRestarts = 0;
    this.lastError = null;
    this.restarts = 0;

    this._probeTimer = null;
    this._restartTimer = null;
    this._stopping = false;
  }

  get running() {
    return this.state === STATES.RUNNING && Boolean(this.child);
  }

  /** Bring the process up. Safe to call when it is already up. */
  async start() {
    if (this.state === STATES.RUNNING || this.state === STATES.STARTING) return this.child;
    if (this.state === STATES.GAVE_UP) {
      throw Object.assign(
        new Error(`${this.name} failed to stay running and was stopped. Reset the supervisor to try again.`),
        { code: 'SUPERVISOR_GAVE_UP', lastError: this.lastError }
      );
    }
    this._stopping = false;
    this.#setState(STATES.STARTING);

    const child = this._spawn(this.command, this.args, {
      // Its own group, so signalling the group reaches whatever it spawned.
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...this.spawnOptions
    });
    this.child = child;
    this.pid = child.pid ?? null;
    this.startedAt = this._now();

    child.once('exit', (code, signal) => this.#onExit(code, signal));
    child.once('error', (error) => {
      this.lastError = error;
      this.emit('error', error);
      this.#onExit(null, null);
    });

    this.#setState(STATES.RUNNING);
    this.emit('up', { pid: this.pid, restarts: this.restarts });
    this.#scheduleProbe();
    return child;
  }

  /**
   * Take the process down deliberately. A deliberate stop never triggers a
   * restart — that distinction is what stops "quit the app" from racing the
   * watchdog into a respawn.
   */
  async stop({ reason = 'stopped' } = {}) {
    this._stopping = true;
    this.#clearTimers();
    const child = this.child;
    this.child = null;
    this.#setState(STATES.STOPPED);
    if (child) await this.#terminate(child, reason);
    this.pid = null;
    return true;
  }

  /**
   * Kill and bring back up. This is what a hung engine gets: the timeout that
   * detected the hang calls this, and the task that was interrupted is failed or
   * left to its lease, so the queue redispatches it.
   */
  async restart(reason = 'restart requested') {
    if (this.state === STATES.GAVE_UP) return false;
    this.#clearTimers();
    this.#setState(STATES.RESTARTING);
    this.emit('restarting', { reason, pid: this.pid, restarts: this.restarts });
    const child = this.child;
    this.child = null;
    if (child) await this.#terminate(child, reason);
    this.restarts += 1;
    await this.#backoffThenStart(reason);
    return this.state === STATES.RUNNING;
  }

  /** Run the liveness probe once, now. Returns false if the child is not answering. */
  async checkHealth() {
    if (!this.child || this.state !== STATES.RUNNING) return false;
    if (typeof this.probe !== 'function') return true;
    let timer = null;
    try {
      const timeout = new Promise((_resolve, reject) => {
        timer = this._setTimer(
          () => reject(Object.assign(new Error(`${this.name} did not answer its health probe.`), { code: 'PROBE_TIMEOUT' })),
          this.config.probeTimeoutMs
        );
      });
      const healthy = await Promise.race([Promise.resolve(this.probe(this.child)), timeout]);
      return healthy !== false;
    } catch (error) {
      this.lastError = error;
      return false;
    } finally {
      if (timer) this._clearTimer(timer);
    }
  }

  /** Reset the breaker after a person has fixed whatever was wrong. */
  reset() {
    this.rapidRestarts = 0;
    this.lastError = null;
    if (this.state === STATES.GAVE_UP) this.#setState(STATES.STOPPED);
  }

  status() {
    return {
      name: this.name,
      state: this.state,
      pid: this.pid,
      running: this.running,
      restarts: this.restarts,
      rapidRestarts: this.rapidRestarts,
      uptimeMs: this.startedAt && this.running ? this._now() - this.startedAt : 0,
      lastError: this.lastError ? String(this.lastError.message ?? this.lastError) : null
    };
  }

  // ---- internals ---------------------------------------------------------

  #setState(next) {
    if (this.state === next) return;
    const previous = this.state;
    this.state = next;
    this.emit('state', { previous, state: next, ...this.status() });
  }

  #clearTimers() {
    if (this._probeTimer) this._clearTimer(this._probeTimer);
    if (this._restartTimer) this._clearTimer(this._restartTimer);
    this._probeTimer = null;
    this._restartTimer = null;
  }

  #scheduleProbe() {
    if (this.config.probeIntervalMs <= 0 || typeof this.probe !== 'function') return;
    this._probeTimer = this._setTimer(async () => {
      this._probeTimer = null;
      if (this.state !== STATES.RUNNING) return;
      const healthy = await this.checkHealth();
      if (this.state !== STATES.RUNNING) return;
      if (healthy) {
        this.#scheduleProbe();
        return;
      }
      // A process that stops answering is wedged. Left alone it accepts every
      // future request and answers none of them.
      this.emit('unhealthy', { pid: this.pid, lastError: this.status().lastError });
      await this.restart('health probe failed');
    }, this.config.probeIntervalMs);
  }

  /**
   * SIGTERM the group, wait, then SIGKILL the group. Signalling the negative pid
   * reaches every process the child started; a worker that forked ComfyUI would
   * otherwise leave it holding the port.
   */
  async #terminate(child, reason) {
    const pid = child.pid;
    if (!pid) return;
    this.emit('killing', { pid, reason });
    const signalGroup = (signal) => {
      try {
        this._kill(-pid, signal);
      } catch {
        // No group (or already gone): fall back to the pid itself.
        try { this._kill(pid, signal); } catch { /* already dead */ }
      }
    };
    const exited = new Promise((resolve) => {
      if (child.exitCode !== null && child.exitCode !== undefined) return resolve();
      child.once('exit', resolve);
      return undefined;
    });
    signalGroup('SIGTERM');
    let graceTimer = null;
    const grace = new Promise((resolve) => {
      graceTimer = this._setTimer(resolve, this.config.killGraceMs);
    });
    await Promise.race([exited, grace]);
    if (graceTimer) this._clearTimer(graceTimer);
    if (child.exitCode === null || child.exitCode === undefined) {
      signalGroup('SIGKILL');
    }
    this.emit('killed', { pid, reason });
  }

  #onExit(code, signal) {
    const wasRunning = this.state === STATES.RUNNING || this.state === STATES.STARTING;
    this.child = null;
    if (this._stopping || this.state === STATES.STOPPED) return;
    if (this.state === STATES.RESTARTING) return; // restart() owns what happens next

    const ranFor = this.startedAt ? this._now() - this.startedAt : 0;
    // Surviving the stability window clears the streak: a long-lived process that
    // finally dies is a fresh incident, not the fifth of a crash loop.
    if (ranFor >= this.config.stabilityWindowMs) this.rapidRestarts = 0;

    this.emit('down', { code, signal, pid: this.pid, ranFor, unexpected: wasRunning });
    this.pid = null;
    if (!wasRunning) return;
    this.restarts += 1;
    void this.#backoffThenStart(`exited (code ${code}, signal ${signal})`);
  }

  async #backoffThenStart(reason) {
    this.rapidRestarts += 1;
    if (this.rapidRestarts > this.config.maxRapidRestarts) {
      this.lastError = Object.assign(
        new Error(`${this.name} restarted ${this.rapidRestarts - 1} times without staying up. Last reason: ${reason}`),
        { code: 'SUPERVISOR_GAVE_UP' }
      );
      this.#setState(STATES.GAVE_UP);
      this.emit('gave-up', { reason, restarts: this.restarts, lastError: this.lastError.message });
      return;
    }
    const delays = this.config.restartBackoffMs;
    const delay = delays[Math.min(this.rapidRestarts - 1, delays.length - 1)];
    await new Promise((resolve) => {
      this._restartTimer = this._setTimer(() => {
        this._restartTimer = null;
        resolve();
      }, delay);
    });
    if (this._stopping || this.state === STATES.GAVE_UP || this.state === STATES.STOPPED) return;
    this.#setState(STATES.STOPPED); // so start() does not short-circuit
    try {
      await this.start();
    } catch (error) {
      this.lastError = error;
      this.emit('error', error);
    }
  }
}

module.exports = { ProcessSupervisor, STATES, DEFAULTS };
