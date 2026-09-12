'use strict';

const { randomUUID } = require('node:crypto');
const { fields, id, jsonSnapshot } = require('./editable-contract-data.cjs');
const {
  createEditablePage, validateEditablePageState, validateEditablePageTransition,
  serializeEditablePageState, deserializeEditablePageState
} = require('./editable-page-revisions.cjs');

function fail(code, path, message) {
  throw Object.assign(new Error(message), { code, path });
}
function keyValues(input) {
  const key = jsonSnapshot(input);
  fields(key, ['projectId', 'runId', 'pageId'], '$.key');
  for (const field of ['projectId', 'runId', 'pageId']) id(key[field], `$.key.${field}`);
  return [key.projectId, key.runId, key.pageId];
}
function matchesKey(state, values) {
  if ([state.projectId, state.runId, state.pageId].some((value, index) => value !== values[index])) {
    fail('EDITABLE_REPOSITORY_KEY_MISMATCH', '$.key', 'Stored/requested key differs from page ownership.');
  }
}

// Explicitly constructed with an existing ProjectStore. No production wiring,
// connection ownership, global PRAGMA changes or Normal table writes.
class EditableRepository {
  #db;
  constructor(store) {
    this.#db = store.db;
    this.#db.exec(`CREATE TABLE IF NOT EXISTS editable_pages (
      project_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      page_id TEXT NOT NULL,
      token TEXT NOT NULL,
      state_json TEXT NOT NULL,
      PRIMARY KEY (project_id, run_id, page_id)
    ) STRICT`);
  }

  load(projectId, runId, pageId) {
    const values = keyValues({ projectId, runId, pageId });
    const row = this.#db.prepare(`SELECT state_json, token FROM editable_pages
      WHERE project_id = ? AND run_id = ? AND page_id = ?`).get(...values);
    if (!row) return null;
    const state = deserializeEditablePageState(row.state_json);
    matchesKey(state, values);
    return { state, token: row.token };
  }

  // Initial insertion only: imported history cannot bypass transition checks.
  insert(input) {
    const state = validateEditablePageState(input);
    const serialized = serializeEditablePageState(state);
    if (serialized !== serializeEditablePageState(createEditablePage(state.revisions[0].contract))) {
      fail('EDITABLE_REPOSITORY_INITIAL_INVALID', '$.state', 'Insertion requires a fresh DRAFT aggregate.');
    }
    const token = randomUUID();
    const result = this.#db.prepare(`INSERT INTO editable_pages
      (project_id, run_id, page_id, token, state_json) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (project_id, run_id, page_id) DO NOTHING`)
      .run(state.projectId, state.runId, state.pageId, token, serialized);
    if (!result.changes) fail('EDITABLE_REPOSITORY_CONFLICT', '$.key', 'Editable page already exists.');
    return { state, token };
  }

  compareAndSwap(key, expectedToken, command, nextState) {
    const values = keyValues(key);
    id(expectedToken, '$.expectedToken');
    // Savepoint also composes with a transaction owned by ProjectStore's caller.
    this.#db.exec('SAVEPOINT editable_repository_cas');
    try {
      const previous = this.load(...values);
      if (!previous || previous.token !== expectedToken) {
        fail('EDITABLE_REPOSITORY_CONFLICT', '$.expectedToken', 'Missing page or stale editable page token.');
      }
      const state = validateEditablePageTransition(previous.state, nextState, command);
      matchesKey(state, values);
      const token = randomUUID();
      const result = this.#db.prepare(`UPDATE editable_pages SET state_json = ?, token = ?
        WHERE project_id = ? AND run_id = ? AND page_id = ? AND token = ?`)
        .run(serializeEditablePageState(state), token, ...values, expectedToken);
      if (result.changes !== 1) fail('EDITABLE_REPOSITORY_CONFLICT', '$.expectedToken', 'Stale editable page token.');
      this.#db.exec('RELEASE SAVEPOINT editable_repository_cas');
      return { state, token };
    } catch (error) {
      this.#db.exec('ROLLBACK TO SAVEPOINT editable_repository_cas');
      this.#db.exec('RELEASE SAVEPOINT editable_repository_cas');
      throw error;
    }
  }
}

module.exports = { EditableRepository };
