'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { ProjectStore } = require('../src/store.cjs');
const { EditableRepository } = require('../src/editable-repository.cjs');
const { createEditablePage, applyEditablePageCommand } = require('../src/editable-page-revisions.cjs');

const key = { projectId: 'project-1', runId: 'run-1', pageId: 'A01' };
function initial() {
  const owner = { ...key, revisionId: 'revision-1' };
  return createEditablePage({
    schemaVersion: 2, engineType: 'native-text-editable', project: { id: key.projectId, revision: 1 },
    runId: key.runId, revisionId: owner.revisionId, page: { id: key.pageId, number: 1 },
    format: 'LETTER', orientation: 'portrait', dimensions: { units: 'pt', width: 612, height: 792 },
    safeRegions: [{ id: 'safe', x: 0, y: 0, width: 612, height: 792 }],
    textRegions: [{ id: 'title', safeRegionId: 'safe', roles: ['title'], x: 36, y: 36, width: 540, height: 72 }],
    artwork: { id: 'art-1', kind: 'artwork', owner, reference: 'A01.png' },
    textLayout: { id: 'layout-1', kind: 'layout', owner, reference: 'A01.json' },
    elements: [{ id: 'title-1', role: 'title', regionId: 'title', content: { text: 'Title' } }]
  });
}
function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'versa-editable-repo-'));
  const path = join(dir, 'store.sqlite');
  const store = new ProjectStore(path);
  t.after(() => { store.db.close(); rmSync(dir, { recursive: true, force: true }); });
  return { store, path, repo: new EditableRepository(store) };
}
function renumber(repo, loaded, number) {
  const command = { type: 'renumber', pageNumber: number };
  return repo.compareAndSwap(key, loaded.token, command, applyEditablePageCommand(loaded.state, command));
}

test('insert and load persist an immutable DRAFT in the existing store database', (t) => {
  const { repo, store } = setup(t);
  assert.equal(repo.load(...Object.values(key)), null);
  const result = repo.insert(initial());
  assert.deepEqual(repo.load(...Object.values(key)), result);
  assert.ok(Object.isFrozen(result.state.revisions[0].contract));
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM editable_pages').get().n, 1);
  assert.throws(() => repo.insert(initial()), { code: 'EDITABLE_REPOSITORY_CONFLICT' });
  assert.deepEqual(repo.load(...Object.values(key)), result);
});

test('CAS persists DRAFT to GENERATED only after both artifact commands', (t) => {
  const { repo } = setup(t);
  let loaded = repo.insert(initial());
  for (const field of ['artwork', 'textLayout']) {
    const command = { type: 'record-artifact', revisionId: 'revision-1', artifact: loaded.state.revisions[0].contract[field] };
    const next = applyEditablePageCommand(loaded.state, command);
    const saved = repo.compareAndSwap(key, loaded.token, command, next);
    assert.notEqual(saved.token, loaded.token);
    assert.deepEqual(repo.load(...Object.values(key)), saved);
    loaded = saved;
  }
  assert.equal(loaded.state.revisions[0].state, 'GENERATED');
});

test('stale writer on another connection cannot overwrite the winner', (t) => {
  const { repo, path } = setup(t);
  const other = new ProjectStore(path);
  try {
    const competitor = new EditableRepository(other);
    const original = repo.insert(initial());
    const stale = competitor.load(...Object.values(key));
    const winner = renumber(repo, original, 2);
    assert.throws(() => renumber(competitor, stale, 3), { code: 'EDITABLE_REPOSITORY_CONFLICT' });
    assert.deepEqual(competitor.load(...Object.values(key)), winner);
  } finally { other.db.close(); }
});

test('invalid transition rolls back without changing state or token', (t) => {
  const { repo } = setup(t);
  const original = repo.insert(initial());
  const forged = structuredClone(original.state);
  forged.revisions[0].contract.elements[0].content.text = 'Changed behind revision identity';
  assert.throws(() => repo.compareAndSwap(key, original.token, { type: 'renumber', pageNumber: 1 }, forged), { code: 'EDITABLE_TRANSITION_INVALID' });
  assert.deepEqual(repo.load(...Object.values(key)), original);
  assert.equal(renumber(repo, original, 2).state.pageNumber, 2);
});

test('CAS rejects a foreign key and insertion cannot import generated history', (t) => {
  const { repo } = setup(t);
  const original = repo.insert(initial());
  assert.throws(() => repo.compareAndSwap({ ...key, runId: 'foreign' }, original.token,
    { type: 'renumber', pageNumber: 1 }, original.state), { code: 'EDITABLE_REPOSITORY_CONFLICT' });
  const command = { type: 'record-artifact', revisionId: 'revision-1', artifact: original.state.revisions[0].contract.artwork };
  assert.throws(() => repo.insert(applyEditablePageCommand(original.state, command)), { code: 'EDITABLE_REPOSITORY_INITIAL_INVALID' });
});

test('page state and token survive connection reopening', (t) => {
  const { repo, path } = setup(t);
  const expected = renumber(repo, repo.insert(initial()), 4);
  for (let i = 0; i < 2; i++) {
    const store = new ProjectStore(path);
    try { assert.deepEqual(new EditableRepository(store).load(...Object.values(key)), expected); }
    finally { store.db.close(); }
  }
});

test('adapter respects caller transactions and leaves Normal tables unchanged', (t) => {
  const { repo, store } = setup(t);
  const tables = store.db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name != 'editable_pages' ORDER BY name").all();
  const snapshot = () => tables.map(({ name, sql }) => ({ name, sql, rows: store.db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all() }));
  const before = snapshot();
  const original = repo.insert(initial());
  store.db.exec('BEGIN');
  renumber(repo, original, 5);
  store.db.exec('ROLLBACK');
  assert.deepEqual(repo.load(...Object.values(key)), original);
  assert.deepEqual(snapshot(), before);
});
