'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateEditablePageContract, validateEditablePageContracts, serializeEditablePageContract,
  validateEditableOwnership, validateEditableArtifact, validateArtifactPair, getEditablePageOwnership
} = require('../src/editable-page-contract.cjs');
const {
  REVISION_STATES, createEditablePage, applyEditablePageCommand: apply,
  validateEditablePageState: validate, validateEditablePageTransition: transition,
  selectCurrentEditablePair: current, serializeEditablePageState: serialize,
  deserializeEditablePageState: deserialize
} = require('../src/editable-page-revisions.cjs');

const PROJECT = '554dd8b0-b94b-4a1d-af27-eee9cac5d82f';
function contract({ pageId = 'A01', pageNumber = 1, revisionId = 'revision-1', runId = 'run-1', projectId = PROJECT } = {}) {
  const owner = { projectId, runId, pageId, revisionId };
  return {
    schemaVersion: 2, engineType: 'native-text-editable',
    project: { id: projectId, revision: 1 }, runId, revisionId,
    page: { id: pageId, number: pageNumber }, format: 'LETTER', orientation: 'portrait',
    dimensions: { units: 'pt', width: 612, height: 792 },
    safeRegions: [{ id: 'safe', x: 36, y: 36, width: 540, height: 720 }],
    textRegions: [{ id: 'title-region', safeRegionId: 'safe', roles: ['title'], x: 54, y: 54, width: 504, height: 72 }],
    artwork: { id: `${pageId}-${revisionId}-art`, kind: 'artwork', owner: { ...owner }, reference: `${pageId}.png` },
    textLayout: { id: `${pageId}-${revisionId}-layout`, kind: 'layout', owner: { ...owner }, reference: `${pageId}.json` },
    elements: [{ id: 'title', role: 'title', regionId: 'title-region', content: { text: 'Our classroom' } }]
  };
}
function generated(state = createEditablePage(contract())) {
  const revision = state.revisions.at(-1);
  let next = apply(state, { type: 'record-artifact', revisionId: revision.id, artifact: revision.contract.artwork });
  return apply(next, { type: 'record-artifact', revisionId: revision.id, artifact: revision.contract.textLayout });
}
function validated(state = generated()) {
  return apply(state, { type: 'validate-pair', revisionId: state.revisions.at(-1).id });
}
function successor(state = validated()) {
  return apply(state, { type: 'begin-revision', contract: contract({ revisionId: 'revision-2', pageNumber: state.pageNumber }) });
}
function fails(fn, code) {
  assert.throws(fn, (error) => {
    assert.equal(typeof error.code, 'string');
    assert.equal(typeof error.path, 'string');
    assert.ok(error.path.startsWith('$'));
    assert.ok(error.message.length > error.path.length);
    if (code) assert.equal(error.code, code);
    return true;
  });
}

test('version 2 adds ownership while version 1 remains an isolated planning contract', () => {
  const owned = contract();
  assert.deepEqual(validateEditablePageContract(owned), owned);
  const legacy = structuredClone(owned);
  legacy.schemaVersion = 1; delete legacy.runId; delete legacy.revisionId;
  for (const key of ['artwork', 'textLayout']) {
    legacy[key] = { id: legacy[key].id, pageId: legacy.page.id, reference: legacy[key].reference };
  }
  assert.deepEqual(validateEditablePageContract(legacy), legacy);
  fails(() => createEditablePage(legacy));
  fails(() => validateEditablePageContracts([owned, legacy]));
});

test('project revision remains distinct from the page generation revision', () => {
  const page = contract(); page.project.revision = 17;
  const state = createEditablePage(page);
  assert.equal(state.projectId, PROJECT);
  assert.equal(state.revisions[0].contract.project.revision, 17);
  assert.equal(state.revisions[0].id, 'revision-1');
});

test('two pages have distinct stable identities, independent of their numbers', () => {
  const a = createEditablePage(contract());
  const b = createEditablePage(contract({ pageId: 'A02', pageNumber: 2 }));
  assert.notEqual(a.pageId, b.pageId);
  assert.equal(a.revisions[0].id, b.revisions[0].id); // revision IDs are scoped by owner
  assert.equal(validateEditablePageContracts([a.revisions[0].contract, b.revisions[0].contract]).length, 2);
});

test('identical ownership tuple pairs successfully and role is explicit', () => {
  const c = contract();
  assert.deepEqual(validateArtifactPair(c.artwork, c.textLayout), { artwork: c.artwork, layout: c.textLayout });
  fails(() => validateArtifactPair(c.textLayout, c.artwork));
});

for (const [key, value] of [['projectId', 'other-project'], ['runId', 'other-run'], ['pageId', 'A02'], ['revisionId', 'other-revision']]) {
  test(`pairing rejects cross-${key} even with identical filenames`, () => {
    const c = contract(); c.textLayout.owner[key] = value;
    fails(() => validateArtifactPair(c.artwork, c.textLayout), 'EDITABLE_CONTRACT_INVALID');
    fails(() => validateEditablePageContract(c));
  });
  test(`artifact recording rejects foreign ${key}`, () => {
    const state = createEditablePage(contract());
    const artifact = structuredClone(state.revisions[0].contract.artwork);
    artifact.owner[key] = value;
    fails(() => apply(state, { type: 'record-artifact', revisionId: 'revision-1', artifact }), 'EDITABLE_ARTIFACT_OWNERSHIP');
  });
}

test('lifecycle is DRAFT to GENERATED to VALIDATED only after both sides', () => {
  assert.deepEqual(REVISION_STATES, ['DRAFT', 'GENERATED', 'VALIDATED', 'SUPERSEDED', 'FAILED']);
  const draft = createEditablePage(contract());
  assert.equal(draft.revisions[0].state, 'DRAFT');
  assert.equal(draft.currentRevisionId, null);
  fails(() => current(draft), 'EDITABLE_CURRENT_MISSING');
  const half = apply(draft, { type: 'record-artifact', revisionId: 'revision-1', artifact: draft.revisions[0].contract.textLayout });
  assert.equal(half.revisions[0].state, 'DRAFT');
  fails(() => apply(half, { type: 'validate-pair', revisionId: 'revision-1' }), 'EDITABLE_TRANSITION_INVALID');
  const pair = apply(half, { type: 'record-artifact', revisionId: 'revision-1', artifact: draft.revisions[0].contract.artwork });
  assert.equal(pair.revisions[0].state, 'GENERATED');
  assert.equal(pair.currentRevisionId, null);
  const accepted = validated(pair);
  assert.equal(accepted.revisions[0].state, 'VALIDATED');
  assert.equal(current(accepted).owner.revisionId, 'revision-1');
});

test('regeneration retains page identity and old current until both new sides validate', () => {
  const old = validated();
  const next = successor(old);
  assert.equal(next.pageId, old.pageId);
  assert.deepEqual(next.revisions.map((r) => r.id), ['revision-1', 'revision-2']);
  assert.deepEqual(next.revisions[0], old.revisions[0]);
  assert.equal(current(next).owner.revisionId, 'revision-1');
  assert.equal(next.revisions[1].artwork, null);
  assert.equal(next.revisions[1].layout, null);
  const complete = validated(generated(next));
  assert.deepEqual(complete.revisions.map((r) => r.state), ['SUPERSEDED', 'VALIDATED']);
  assert.equal(current(complete).owner.revisionId, 'revision-2');
  assert.equal(old.revisions[0].state, 'VALIDATED');
  assert.equal(old.revisions.length, 1);
});

test('an older layout cannot be reused with regenerated artwork', () => {
  const state = successor();
  const older = state.revisions[0].layout;
  fails(() => apply(state, { type: 'record-artifact', revisionId: 'revision-2', artifact: older }), 'EDITABLE_ARTIFACT_OWNERSHIP');
});

test('pending generation and failure never discard the previous valid pair', () => {
  const state = generated(successor());
  const failed = apply(state, { type: 'fail-revision', revisionId: 'revision-2', failure: { code: 'GENERATION_FAILED', message: 'Rejected output.' } });
  assert.equal(failed.revisions[1].state, 'FAILED');
  assert.equal(current(failed).owner.revisionId, 'revision-1');
  const next = apply(failed, { type: 'begin-revision', contract: contract({ revisionId: 'revision-3' }) });
  assert.equal(next.revisions[2].state, 'DRAFT');
  assert.equal(next.revisions[2].layout, null);
});

test('renumbering preserves identity, history and ownership even with an active draft', () => {
  const state = successor();
  const renamed = apply(state, { type: 'renumber', pageNumber: 9 });
  assert.equal(renamed.pageId, 'A01');
  assert.equal(renamed.pageNumber, 9);
  assert.deepEqual(renamed.revisions, state.revisions);
  assert.equal(renamed.revisions[1].contract.page.number, 1); // immutable historical snapshot
  assert.equal(current(renamed).pageNumber, 9);
  assert.deepEqual(current(renamed).owner, current(state).owner);
});

test('artifact filenames and renamed locators do not define semantic ownership', () => {
  const c = contract();
  const renamed = { ...c.artwork, reference: 'opaque-store:renamed-asset' };
  assert.deepEqual(validateArtifactPair(renamed, c.textLayout).artwork.owner, c.artwork.owner);
  let state = createEditablePage(c);
  state = apply(state, { type: 'record-artifact', revisionId: c.revisionId, artifact: renamed });
  state = apply(state, { type: 'record-artifact', revisionId: c.revisionId, artifact: c.textLayout });
  const selected = current(validated(state));
  assert.equal(selected.artwork.id, c.artwork.id);
  assert.equal(selected.artwork.reference, renamed.reference);
  fails(() => validateEditableArtifact({ reference: 'A01.png' }));
  fails(() => current({ filename: 'A01.png' }));
});

for (const field of ['projectId', 'runId', 'pageId']) {
  test(`returned ${field} is frozen and coherent forged changes fail transition validation`, () => {
    const previous = validated();
    assert.throws(() => { previous[field] = 'changed'; }, TypeError);
    const next = structuredClone(previous);
    const value = field === 'pageId' ? 'A02' : 'changed';
    next[field] = value;
    for (const r of next.revisions) {
      if (field === 'projectId') r.contract.project.id = value;
      if (field === 'runId') r.contract.runId = value;
      if (field === 'pageId') r.contract.page.id = value;
      for (const artifact of [r.artwork, r.layout, r.contract.artwork, r.contract.textLayout]) artifact.owner[field] = value;
    }
    fails(() => transition(previous, next, { type: 'renumber', pageNumber: previous.pageNumber }), 'EDITABLE_IDENTITY_IMMUTABLE');
  });
}

test('revision identity is immutable even when all copied ownership fields are changed consistently', () => {
  const previous = validated();
  assert.throws(() => { previous.revisions[0].id = 'forged'; }, TypeError);
  const next = structuredClone(previous);
  const revision = next.revisions[0];
  revision.id = revision.contract.revisionId = next.currentRevisionId = 'forged';
  for (const artifact of [revision.artwork, revision.layout, revision.contract.artwork, revision.contract.textLayout]) artifact.owner.revisionId = 'forged';
  fails(() => transition(previous, next, { type: 'renumber', pageNumber: 1 }), 'EDITABLE_IDENTITY_IMMUTABLE');
});

test('valid transitions can be checked by future persistence; other changes cannot piggyback', () => {
  const old = validated();
  const command = { type: 'renumber', pageNumber: 4 };
  const next = apply(old, command);
  assert.deepEqual(transition(old, next, command), next);
  const forged = structuredClone(next);
  forged.revisions[0].contract.elements[0].content.text = 'Overwritten';
  fails(() => transition(old, forged, command), 'EDITABLE_TRANSITION_INVALID');
  assert.equal(old.pageNumber, 1);
});

test('superseded, failed and already validated revisions cannot be promoted or rewritten', () => {
  const state = validated(generated(successor()));
  for (const revisionId of ['revision-1', 'revision-2']) {
    for (const command of [
      { type: 'validate-pair', revisionId },
      { type: 'record-artifact', revisionId, artifact: state.revisions[0].artwork },
      { type: 'fail-revision', revisionId, failure: { code: 'X', message: 'X' } }
    ]) fails(() => apply(state, command), 'EDITABLE_TRANSITION_INVALID');
  }
  const failed = apply(createEditablePage(contract()), { type: 'fail-revision', revisionId: 'revision-1', failure: { code: 'X', message: 'X' } });
  fails(() => apply(failed, { type: 'validate-pair', revisionId: 'revision-1' }), 'EDITABLE_TRANSITION_INVALID');
});

test('duplicate active revisions and overwriting one side fail closed', () => {
  const state = createEditablePage(contract());
  fails(() => successor(state), 'EDITABLE_TRANSITION_INVALID');
  const half = apply(state, { type: 'record-artifact', revisionId: 'revision-1', artifact: state.revisions[0].contract.artwork });
  fails(() => apply(half, { type: 'record-artifact', revisionId: 'revision-1', artifact: state.revisions[0].contract.artwork }), 'EDITABLE_TRANSITION_INVALID');
});

for (const [label, mutate] of [
  ['historical pointer', (s) => { s.currentRevisionId = 'revision-1'; }],
  ['missing pointer', (s) => { s.currentRevisionId = null; }],
  ['unknown pointer', (s) => { s.currentRevisionId = 'missing'; }],
  ['duplicate validated', (s) => { s.revisions[0].state = 'VALIDATED'; }],
  ['historical becomes current', (s) => { s.revisions[0].state = 'VALIDATED'; s.revisions[1].state = 'SUPERSEDED'; s.currentRevisionId = 'revision-1'; }],
  ['duplicate open', (s) => { for (const r of s.revisions) r.state = 'GENERATED'; s.currentRevisionId = null; }],
  ['missing artwork', (s) => { s.revisions[1].artwork = null; }],
  ['missing layout', (s) => { s.revisions[1].layout = null; }],
  ['duplicate revision', (s) => { s.revisions.push(structuredClone(s.revisions[1])); }],
  ['invalid state', (s) => { s.revisions[1].state = 'COMPLETE'; }],
  ['invalid schema', (s) => { s.schemaVersion = 2; }],
  ['extra field', (s) => { s.currentFilename = 'A01.png'; }]
]) {
  test(`metadata rejects ${label}`, () => {
    const state = structuredClone(validated(generated(successor()))); mutate(state);
    fails(() => validate(state));
    fails(() => current(state));
  });
}

for (const [key, value] of [['runId', 'other'], ['projectId', 'other'], ['pageId', 'A02']]) {
  test(`regeneration cannot change ${key}`, () => {
    const c = contract({ revisionId: 'revision-2', [key]: value });
    fails(() => apply(validated(), { type: 'begin-revision', contract: c }), 'EDITABLE_IDENTITY_IMMUTABLE');
  });
}
test('regeneration rejects reused revision/artifact IDs and incorrect page number', () => {
  const state = validated();
  fails(() => apply(state, { type: 'begin-revision', contract: contract() }));
  const c = contract({ revisionId: 'revision-2' }); c.artwork.id = state.revisions[0].artwork.id;
  fails(() => apply(state, { type: 'begin-revision', contract: c }));
  fails(() => apply(state, { type: 'begin-revision', contract: contract({ revisionId: 'revision-2', pageNumber: 3 }) }));
});

for (const value of ['', null, 1, {}, 'bad id']) {
  for (const key of ['projectId', 'runId', 'pageId', 'revisionId']) {
    test(`invalid ${key}: ${JSON.stringify(value)}`, () => {
      const owner = getEditablePageOwnership(contract()); owner[key] = value;
      fails(() => validateEditableOwnership(owner));
    });
  }
}

test('malformed metadata and commands fail with stable errors and paths', () => {
  for (const input of [null, [], {}, 1, 'A01.png', undefined, new Date()]) fails(() => validate(input));
  for (const command of [null, {}, [], { type: 'activate' }, { type: 'renumber' }, { type: 'renumber', pageNumber: 1, projectId: 'new' }]) {
    fails(() => apply(createEditablePage(contract()), command));
  }
  for (const number of [0, -1, 1.5, '2', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    fails(() => apply(createEditablePage(contract()), { type: 'renumber', pageNumber: number }));
  }
  fails(() => apply(createEditablePage(contract()), { type: 'validate-pair', revisionId: 'missing' }), 'EDITABLE_REVISION_NOT_FOUND');
  fails(() => apply(createEditablePage(contract()), { type: 'fail-revision', revisionId: 'revision-1', failure: { code: '', message: '' } }));
  for (const input of ['{', 'null', '{}', 123]) fails(() => deserialize(input));
});

test('accessors, sparse history, cycles and nonfinite data are rejected without side effects', () => {
  const original = createEditablePage(contract());
  let reads = 0;
  const accessor = structuredClone(original);
  Object.defineProperty(accessor, 'runId', { enumerable: true, get() { reads++; return 'run-1'; } });
  fails(() => validate(accessor)); assert.equal(reads, 0);
  const sparse = structuredClone(original); sparse.revisions = new Array(1); fails(() => validate(sparse));
  const cycle = structuredClone(original); cycle.revisions.push(cycle); fails(() => validate(cycle));
  const bad = structuredClone(original); bad.pageNumber = NaN; fails(() => validate(bad));
});

test('serialization round trips exact ownership, history, frozen identity and current selection', () => {
  const state = validated(generated(successor()));
  const text = serialize(state);
  const restored = deserialize(text);
  assert.deepEqual(restored, state);
  assert.equal(serialize(restored), text);
  assert.deepEqual(current(restored), current(state));
  assert.ok(Object.isFrozen(restored.revisions[0].contract.artwork.owner));
  assert.equal(serializeEditablePageContract(JSON.parse(serializeEditablePageContract(contract()))), serializeEditablePageContract(contract()));
  const reversed = Object.fromEntries(Object.entries(state).reverse());
  assert.equal(serialize(reversed), text);
});

test('owned page collections reject mixed runs and do not conflate revision IDs across pages', () => {
  const first = contract();
  const second = contract({ pageId: 'A02', pageNumber: 2, runId: 'run-2' });
  fails(() => validateEditablePageContracts([first, second]));
  const sameRun = contract({ pageId: 'A02', pageNumber: 2, revisionId: 'another-revision' });
  assert.equal(validateEditablePageContracts([first, sameRun]).length, 2);
});

for (const key of ['projectId', 'runId', 'pageId', 'revisionId']) {
  test(`artifact requires owner component ${key}`, () => {
    const c = contract(); delete c.artwork.owner[key];
    fails(() => validateEditableArtifact(c.artwork));
    fails(() => validateEditablePageContract(c));
  });
}

test('owned contracts reject missing run/revision and malformed artifact declarations', () => {
  for (const key of ['runId', 'revisionId']) {
    const c = contract(); delete c[key]; fails(() => validateEditablePageContract(c));
  }
  for (const change of [
    (a) => { a.kind = 'image'; }, (a) => { a.kind = 'layout'; },
    (a) => { a.id = ''; }, (a) => { a.reference = ''; },
    (a) => { a.pageId = 'A01'; }, (a) => { a.owner.extra = 'unexpected'; }
  ]) {
    const c = contract(); change(c.artwork); fails(() => validateEditablePageContract(c));
  }
});

test('first revision may fail without inventing a current pair; retries use fresh identities', () => {
  const state = createEditablePage(contract());
  const failed = apply(state, { type: 'fail-revision', revisionId: 'revision-1', failure: { code: 'REJECTED', message: 'Rejected.' } });
  assert.equal(failed.currentRevisionId, null);
  fails(() => current(failed), 'EDITABLE_CURRENT_MISSING');
  const next = validated(generated(successor(failed)));
  assert.deepEqual(next.revisions.map((r) => r.state), ['FAILED', 'VALIDATED']);
  assert.equal(current(next).owner.revisionId, 'revision-2');
});

test('every lifecycle command has a deterministic persistence transition', () => {
  let state = createEditablePage(contract());
  const commands = [
    { type: 'record-artifact', revisionId: 'revision-1', artifact: contract().artwork },
    { type: 'record-artifact', revisionId: 'revision-1', artifact: contract().textLayout },
    { type: 'validate-pair', revisionId: 'revision-1' },
    { type: 'begin-revision', contract: contract({ revisionId: 'revision-2' }) },
    { type: 'fail-revision', revisionId: 'revision-2', failure: { code: 'X', message: 'Failure' } },
    { type: 'renumber', pageNumber: Number.MAX_SAFE_INTEGER }
  ];
  for (const command of commands) {
    const before = serialize(state);
    const commandBefore = structuredClone(command);
    const next = apply(state, command);
    assert.equal(serialize(next), serialize(apply(state, command)));
    assert.deepEqual(transition(state, next, command), next);
    assert.equal(serialize(state), before);
    assert.deepEqual(command, commandBefore);
    state = next;
  }
});

test('invalid commands leave prior state intact including the authoritative current pointer', () => {
  const state = successor();
  const before = serialize(state);
  fails(() => apply(state, { type: 'validate-pair', revisionId: 'revision-2' }));
  fails(() => apply(state, { type: 'record-artifact', revisionId: 'revision-2', artifact: state.revisions[0].layout }));
  assert.equal(serialize(state), before);
  assert.equal(current(state).owner.revisionId, 'revision-1');
});
