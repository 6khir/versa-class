'use strict';

/**
 * Durable task queue.
 *
 * The pipeline used to be a chain of long awaits inside IPC handlers: one call
 * scraped a listing, drove a browser, uploaded files and waited five minutes for
 * a reply, holding all of its progress in local variables. If anything stalled
 * or the app restarted, that progress existed nowhere and the run had to begin
 * again — which is why a stuck analysis had no way out except a person watching
 * it.
 *
 * Work is now rows. A task is claimed with a *lease* rather than held in memory,
 * so a process that dies holding one loses nothing: the lease expires and the
 * task becomes available again, with its checkpoint intact. Every transition is
 * a committed write, so the queue after a crash is the queue before it.
 *
 * The three properties the rest of the system relies on:
 *
 *   idempotent   enqueueing the same logical work twice yields one task, so a
 *                retry, a double click and a resume cannot fan out into three
 *   resumable    a task carries a checkpoint it writes as it goes, so a retry
 *                continues rather than restarting
 *   deterministic ordering is total (priority, then age, then id), so the same
 *                queue always dispatches in the same order — there is no
 *                "sometimes it picks the other one"
 *
 * Time is injected (`now`) so the state machine can be tested without sleeping.
 */

const { randomUUID } = require('node:crypto');

/** A task is in exactly one of these at any moment. */
const STATES = Object.freeze({
  PENDING: 'pending',
  LEASED: 'leased',
  DONE: 'done',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
});

/** Terminal states never transition again. */
const TERMINAL = Object.freeze(new Set([STATES.DONE, STATES.FAILED, STATES.CANCELLED]));

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_LEASE_MS = 60_000;

/**
 * Exponential backoff with a ceiling, so a failing dependency is retried
 * patiently instead of hammered. Attempt 1 waits 5s, 2 waits 20s, 3 waits 45s.
 */
function backoffMs(attempts, { baseMs = 5_000, maxMs = 5 * 60_000 } = {}) {
  const n = Math.max(1, Number(attempts) || 1);
  return Math.min(maxMs, baseMs * n * n);
}

function toJson(value, fallback = '{}') {
  if (value === undefined || value === null) return fallback;
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function fromJson(text, fallback = null) {
  if (text === null || text === undefined || text === '') return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function rowToTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id ?? null,
    kind: row.kind,
    dedupeKey: row.dedupe_key ?? null,
    payload: fromJson(row.payload_json, {}),
    state: row.state,
    priority: row.priority,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    leaseOwner: row.lease_owner ?? null,
    leaseExpiresAt: row.lease_expires_at ?? null,
    availableAt: row.available_at,
    lastError: row.last_error ?? null,
    result: fromJson(row.result_json, null),
    checkpoint: fromJson(row.checkpoint_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

class TaskStore {
  /**
   * @param {object} db          an open node:sqlite DatabaseSync, shared with the
   *                             project store so task state and project state
   *                             commit to the same file.
   * @param {Function} [options.now] injectable clock, epoch ms.
   */
  constructor(db, { now = () => Date.now(), backoff = {} } = {}) {
    if (!db) throw new Error('TaskStore requires an open database.');
    this.db = db;
    this.now = now;
    // Tunable, because the right wait differs by failure: a rate-limited gem
    // wants minutes, a local vision retry wants seconds.
    this.backoff = { baseMs: 5_000, maxMs: 5 * 60_000, ...backoff };
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        kind TEXT NOT NULL,
        dedupe_key TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}',
        state TEXT NOT NULL DEFAULT 'pending',
        priority INTEGER NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT ${DEFAULT_MAX_ATTEMPTS},
        lease_owner TEXT,
        lease_expires_at INTEGER,
        available_at INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        result_json TEXT,
        checkpoint_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      -- One live task per logical unit of work. Partial, so a finished task does
      -- not block the same work being scheduled again later.
      CREATE UNIQUE INDEX IF NOT EXISTS tasks_dedupe_live
        ON tasks (dedupe_key)
        WHERE dedupe_key IS NOT NULL AND state IN ('pending', 'leased');
      CREATE INDEX IF NOT EXISTS tasks_dispatch
        ON tasks (state, available_at, priority DESC, created_at);
      CREATE INDEX IF NOT EXISTS tasks_by_project ON tasks (project_id, state);
    `);
  }

  /**
   * Add work, or return the task already scheduled for it.
   *
   * `dedupeKey` is what makes a resume safe: re-enqueueing "page 7 of project X"
   * after a restart finds the row that is already pending and returns it rather
   * than queueing a second copy.
   */
  enqueue({
    kind,
    projectId = null,
    payload = {},
    dedupeKey = null,
    priority = 0,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    availableAt = null
  }) {
    if (!kind) throw new Error('A task needs a kind.');
    const now = this.now();
    if (dedupeKey) {
      const existing = this.db
        .prepare("SELECT * FROM tasks WHERE dedupe_key = ? AND state IN ('pending','leased') LIMIT 1")
        .get(dedupeKey);
      if (existing) return rowToTask(existing);
    }
    const task = {
      id: randomUUID(),
      project_id: projectId,
      kind,
      dedupe_key: dedupeKey,
      payload_json: toJson(payload),
      state: STATES.PENDING,
      priority: Number(priority) || 0,
      attempts: 0,
      max_attempts: Math.max(1, Number(maxAttempts) || DEFAULT_MAX_ATTEMPTS),
      available_at: availableAt === null ? now : Number(availableAt),
      created_at: now,
      updated_at: now
    };
    this.db.prepare(`
      INSERT INTO tasks (id, project_id, kind, dedupe_key, payload_json, state, priority,
                         attempts, max_attempts, available_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      task.id, task.project_id, task.kind, task.dedupe_key, task.payload_json, task.state,
      task.priority, task.attempts, task.max_attempts, task.available_at, task.created_at, task.updated_at
    );
    return this.get(task.id);
  }

  get(id) {
    return rowToTask(this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id));
  }

  /**
   * Claim the next runnable task for `owner`.
   *
   * Selection and claim happen in one transaction, so two workers cannot take
   * the same row. Returns null when there is nothing to do — callers idle rather
   * than spin.
   */
  lease({ owner, kinds = null, leaseMs = DEFAULT_LEASE_MS, now = null } = {}) {
    if (!owner) throw new Error('A lease needs an owner.');
    const at = now === null ? this.now() : now;
    // Anything whose lease ran out is fair game again: that is how a task held by
    // a process that died comes back.
    this.reclaimExpired(at);

    const filter = Array.isArray(kinds) && kinds.length
      ? `AND kind IN (${kinds.map(() => '?').join(',')})`
      : '';
    const params = Array.isArray(kinds) && kinds.length ? kinds : [];

    let claimed = null;
    this.#transaction(() => {
      const row = this.db.prepare(`
        SELECT * FROM tasks
        WHERE state = 'pending' AND available_at <= ? ${filter}
        -- rowid is insertion order, and it is the tie-break rather than id
        -- because id is a random UUID: two tasks enqueued in the same
        -- millisecond would otherwise dispatch in a different order each run,
        -- which is not what "deterministic" can mean.
        ORDER BY priority DESC, created_at ASC, rowid ASC
        LIMIT 1
      `).get(at, ...params);
      if (!row) return;
      this.db.prepare(`
        UPDATE tasks
        SET state = 'leased', lease_owner = ?, lease_expires_at = ?, attempts = attempts + 1, updated_at = ?
        WHERE id = ? AND state = 'pending'
      `).run(owner, at + Math.max(1_000, Number(leaseMs) || DEFAULT_LEASE_MS), at, row.id);
      claimed = this.get(row.id);
    });
    return claimed;
  }

  /** Keep a long task's lease alive while it is genuinely working. */
  heartbeat(id, owner, { leaseMs = DEFAULT_LEASE_MS, now = null } = {}) {
    const at = now === null ? this.now() : now;
    const changes = this.db.prepare(`
      UPDATE tasks SET lease_expires_at = ?, updated_at = ?
      WHERE id = ? AND lease_owner = ? AND state = 'leased'
    `).run(at + Math.max(1_000, Number(leaseMs) || DEFAULT_LEASE_MS), at, id, owner).changes;
    return changes > 0;
  }

  /**
   * Record progress inside a task.
   *
   * This is what makes a retry a continuation. A page generator writes which
   * pages are already on disk; when the task is retried it reads the checkpoint
   * and skips them, instead of drawing twenty pages a second time.
   */
  checkpoint(id, owner, data) {
    const at = this.now();
    const changes = this.db.prepare(`
      UPDATE tasks SET checkpoint_json = ?, updated_at = ?
      WHERE id = ? AND lease_owner = ? AND state = 'leased'
    `).run(toJson(data, 'null'), at, id, owner).changes;
    return changes > 0;
  }

  complete(id, owner, result = null) {
    const at = this.now();
    const existing = this.get(id);
    if (!existing || (existing.state !== STATES.LEASED && existing.state !== STATES.PENDING)) return null;
    // A still-running handler must be able to commit even if a watchdog
    // reclaimed the lease while Playwright blocked the heartbeat.
    this.db.prepare(`
      UPDATE tasks
      SET state = 'done', result_json = ?, lease_owner = NULL, lease_expires_at = NULL,
          last_error = NULL, updated_at = ?
      WHERE id = ? AND state IN ('leased', 'pending')
    `).run(toJson(result, 'null'), at, id);
    return this.get(id);
  }

  /**
   * Report a failure.
   *
   * A retryable failure with attempts left goes back to pending behind a backoff.
   * Anything else is terminal, and stays in the table as the record of why.
   */
  fail(id, owner, error, { retryable = true, now = null } = {}) {
    const at = now === null ? this.now() : now;
    const current = this.get(id);
    if (!current || current.leaseOwner !== owner || current.state !== STATES.LEASED) return null;
    const message = String(error?.message ?? error ?? 'Task failed.').slice(0, 2_000);
    const code = error?.code ? String(error.code) : null;
    const detail = code ? `${code}: ${message}` : message;
    const canRetry = retryable && current.attempts < current.maxAttempts;
    if (canRetry) {
      this.db.prepare(`
        UPDATE tasks
        SET state = 'pending', lease_owner = NULL, lease_expires_at = NULL,
            available_at = ?, last_error = ?, updated_at = ?
        WHERE id = ?
      `).run(at + backoffMs(current.attempts, this.backoff), detail, at, id);
    } else {
      this.db.prepare(`
        UPDATE tasks
        SET state = 'failed', lease_owner = NULL, lease_expires_at = NULL,
            last_error = ?, updated_at = ?
        WHERE id = ?
      `).run(detail, at, id);
    }
    return this.get(id);
  }

  /**
   * Return tasks whose lease has lapsed to the pool.
   *
   * This is the crash recovery. A worker that vanished — the app quit, the
   * machine slept, a supervisor killed a wedged engine — leaves its task leased
   * with an expiry in the past. Nothing else needs to know it happened.
   *
   * A task that has already exhausted its attempts is failed rather than looped.
   */
  reclaimExpired(now = null, { ignoreIds = [] } = {}) {
    const at = now === null ? this.now() : now;
    const skip = new Set(Array.isArray(ignoreIds) ? ignoreIds.filter(Boolean) : []);
    const stale = this.db.prepare(`
      SELECT * FROM tasks WHERE state = 'leased' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?
    `).all(at).filter((row) => !skip.has(row.id));
    if (!stale.length) return [];
    const reclaimed = [];
    this.#transaction(() => {
      for (const row of stale) {
        const exhausted = row.attempts >= row.max_attempts;
        if (exhausted) {
          this.db.prepare(`
            UPDATE tasks SET state = 'failed', lease_owner = NULL, lease_expires_at = NULL,
                             last_error = ?, updated_at = ?
            WHERE id = ?
          `).run('Lease expired and no attempts remained. The worker stopped without reporting.', at, row.id);
        } else {
          this.db.prepare(`
            UPDATE tasks SET state = 'pending', lease_owner = NULL, lease_expires_at = NULL,
                             available_at = ?, last_error = ?, updated_at = ?
            WHERE id = ?
          `).run(at, 'Lease expired; the task was reclaimed and will run again.', at, row.id);
        }
        reclaimed.push(this.get(row.id));
      }
    });
    return reclaimed;
  }

  /** Stop a task that has not finished. Terminal tasks are left alone. */
  cancel(id, reason = 'Cancelled.') {
    const at = this.now();
    this.db.prepare(`
      UPDATE tasks SET state = 'cancelled', lease_owner = NULL, lease_expires_at = NULL,
                       last_error = ?, updated_at = ?
      WHERE id = ? AND state IN ('pending','leased')
    `).run(String(reason).slice(0, 500), at, id);
    return this.get(id);
  }

  cancelProject(projectId, reason = 'Project work cancelled.') {
    const at = this.now();
    return this.db.prepare(`
      UPDATE tasks SET state = 'cancelled', lease_owner = NULL, lease_expires_at = NULL,
                       last_error = ?, updated_at = ?
      WHERE project_id = ? AND state IN ('pending','leased')
    `).run(String(reason).slice(0, 500), at, projectId).changes;
  }

  /** Open work the job watchdog inspects without walking every finished row. */
  listOpen({ limit = 200 } = {}) {
    return this.db.prepare(`
      SELECT * FROM tasks WHERE state IN ('pending','leased')
      ORDER BY updated_at DESC LIMIT ?
    `).all(Math.max(1, Number(limit) || 200)).map(rowToTask);
  }

  /** Newest tasks of given kinds — the marketplace rail reads this. */
  latestByKinds(kinds = [], { limit = 8 } = {}) {
    const list = (Array.isArray(kinds) ? kinds : []).filter(Boolean);
    if (!list.length) return [];
    return this.db.prepare(`
      SELECT * FROM tasks
      WHERE kind IN (${list.map(() => '?').join(',')})
      ORDER BY updated_at DESC, created_at DESC
      LIMIT ?
    `).all(...list, Math.max(1, Number(limit) || 8)).map(rowToTask);
  }

  /** Every task for a project, newest first — what the UI reads. */
  listByProject(projectId, { states = null, limit = 200 } = {}) {
    const filter = Array.isArray(states) && states.length
      ? `AND state IN (${states.map(() => '?').join(',')})`
      : '';
    const params = Array.isArray(states) && states.length ? states : [];
    return this.db.prepare(`
      SELECT * FROM tasks WHERE project_id = ? ${filter}
      ORDER BY created_at DESC LIMIT ?
    `).all(projectId, ...params, Math.max(1, Number(limit) || 200)).map(rowToTask);
  }

  /** Distinct kinds currently waiting to run. */
  pendingKinds() {
    return this.db.prepare("SELECT DISTINCT kind FROM tasks WHERE state = 'pending'").all().map((row) => row.kind);
  }

  /** Fail every pending task of a kind. Used when nothing can run it. */
  failKind(kind, reason) {
    const at = this.now();
    return this.db.prepare(`
      UPDATE tasks SET state = 'failed', lease_owner = NULL, lease_expires_at = NULL,
                       last_error = ?, updated_at = ?
      WHERE kind = ? AND state = 'pending'
    `).run(String(reason).slice(0, 500), at, kind).changes;
  }

  /** Counts by state, for a progress readout that survives a restart. */
  stats(projectId = null) {
    const rows = projectId
      ? this.db.prepare('SELECT state, COUNT(*) AS n FROM tasks WHERE project_id = ? GROUP BY state').all(projectId)
      : this.db.prepare('SELECT state, COUNT(*) AS n FROM tasks GROUP BY state').all();
    const out = { pending: 0, leased: 0, done: 0, failed: 0, cancelled: 0, total: 0 };
    for (const row of rows) {
      out[row.state] = row.n;
      out.total += row.n;
    }
    return out;
  }

  /** Drop finished tasks older than `olderThanMs`, so the table does not grow forever. */
  prune({ olderThanMs = 7 * 24 * 60 * 60_000 } = {}) {
    const cutoff = this.now() - olderThanMs;
    return this.db.prepare(`
      DELETE FROM tasks WHERE state IN ('done','cancelled') AND updated_at < ?
    `).run(cutoff).changes;
  }

  /**
   * node:sqlite exposes no transaction helper, so this is the explicit form.
   * A throw inside rolls back, which is what keeps a half-applied lease from
   * existing.
   */
  #transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      fn();
      this.db.exec('COMMIT');
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* the failure below is the real one */ }
      throw error;
    }
  }
}

module.exports = { TaskStore, STATES, TERMINAL, backoffMs, DEFAULT_LEASE_MS, DEFAULT_MAX_ATTEMPTS };
