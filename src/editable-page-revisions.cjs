'use strict';

const { jsonSnapshot, fields, id, positiveInteger, string, deepFreeze } = require('./editable-contract-data.cjs');
const {
  OWNED_CONTRACT_VERSION, validateEditablePageContract, getEditablePageOwnership,
  validateEditableOwnership, validateEditableArtifact, validateArtifactPair
} = require('./editable-page-contract.cjs');

const REVISION_STATES = Object.freeze(['DRAFT', 'GENERATED', 'VALIDATED', 'SUPERSEDED', 'FAILED']);
const OPEN = new Set(['DRAFT', 'GENERATED']);

function fail(path, message, code = 'EDITABLE_REVISION_INVALID') {
  throw Object.assign(new Error(`${path}: ${message}`), { code, path });
}
function equal(a, b) {
  return JSON.stringify(jsonSnapshot(a)) === JSON.stringify(jsonSnapshot(b));
}
function scopeMatches(state, owner, path) {
  for (const key of ['projectId', 'runId', 'pageId']) {
    if (state[key] !== owner[key]) fail(`${path}.${key}`, 'Page ownership cannot change.', 'EDITABLE_IDENTITY_IMMUTABLE');
  }
}
function checkArtifact(revision, artifact, kind, path) {
  const record = validateEditableArtifact(artifact);
  const planned = revision.contract[kind === 'artwork' ? 'artwork' : 'textLayout'];
  if (record.kind !== kind || record.id !== planned.id || !equal(record.owner, planned.owner)) {
    fail(path, 'Artifact kind, identity and full owner must match the revision contract.', 'EDITABLE_ARTIFACT_OWNERSHIP');
  }
  // A locator may change without changing semantic identity. Storage must resolve
  // (owner, id, reference), never a reference/filename alone.
}
function failureRecord(value, path) {
  fields(value, ['code', 'message'], path);
  id(value.code, `${path}.code`);
  string(value.message, `${path}.message`);
}

function validateEditablePageState(input) {
  const state = jsonSnapshot(input);
  fields(state, ['schemaVersion', 'projectId', 'runId', 'pageId', 'pageNumber', 'currentRevisionId', 'revisions'], '$');
  if (state.schemaVersion !== 1) fail('$.schemaVersion', 'Unsupported page-state version.');
  positiveInteger(state.pageNumber, '$.pageNumber');
  if (!Array.isArray(state.revisions) || !state.revisions.length) fail('$.revisions', 'At least one revision is required.');
  validateEditableOwnership({ projectId: state.projectId, runId: state.runId, pageId: state.pageId, revisionId: state.revisions[0]?.id });
  if (state.currentRevisionId !== null) id(state.currentRevisionId, '$.currentRevisionId');
  const revisionIds = new Set(), artifactIds = new Set();
  let currentIndex = -1;
  state.revisions.forEach((revision, index) => {
    const path = `$.revisions[${index}]`;
    fields(revision, ['id', 'state', 'contract', 'artwork', 'layout', 'failure'], path);
    id(revision.id, `${path}.id`);
    if (revisionIds.has(revision.id)) fail(`${path}.id`, 'Duplicate revision identity.');
    revisionIds.add(revision.id);
    if (!REVISION_STATES.includes(revision.state)) fail(`${path}.state`, 'Unsupported revision state.');
    const contract = validateEditablePageContract(revision.contract);
    if (contract.schemaVersion !== OWNED_CONTRACT_VERSION) fail(`${path}.contract.schemaVersion`, 'Revision ownership requires contract version 2.');
    scopeMatches(state, getEditablePageOwnership(contract), `${path}.contract`);
    if (contract.revisionId !== revision.id) fail(`${path}.id`, 'Revision identity differs from its contract.');
    for (const planned of [contract.artwork, contract.textLayout]) {
      if (artifactIds.has(planned.id)) fail(`${path}.contract`, 'Artifact identities cannot be reused across revisions.');
      artifactIds.add(planned.id);
    }
    if (revision.artwork !== null) checkArtifact(revision, revision.artwork, 'artwork', `${path}.artwork`);
    if (revision.layout !== null) checkArtifact(revision, revision.layout, 'layout', `${path}.layout`);
    const paired = revision.artwork !== null && revision.layout !== null;
    if (paired) validateArtifactPair(revision.artwork, revision.layout);
    if (revision.state === 'DRAFT' && paired) fail(`${path}.state`, 'A complete pair must be GENERATED.');
    if (['GENERATED', 'VALIDATED', 'SUPERSEDED'].includes(revision.state) && !paired) {
      fail(path, 'This state requires both owned artifacts.');
    }
    if (OPEN.has(revision.state) && index !== state.revisions.length - 1) {
      fail(`${path}.state`, 'Only the latest revision may be active.');
    }
    if (revision.state === 'FAILED') failureRecord(revision.failure, `${path}.failure`);
    else if (revision.failure !== null) fail(`${path}.failure`, 'Only FAILED revisions carry failure metadata.');
    if (revision.state === 'VALIDATED') {
      if (currentIndex !== -1) fail(`${path}.state`, 'Multiple current/VALIDATED revisions are prohibited.');
      currentIndex = index;
    }
  });
  const current = currentIndex < 0 ? null : state.revisions[currentIndex].id;
  if (state.currentRevisionId !== current) fail('$.currentRevisionId', 'Current pointer must identify the sole VALIDATED revision.');
  state.revisions.forEach((revision, index) => {
    if (revision.state === 'SUPERSEDED' && index >= currentIndex) {
      fail(`$.revisions[${index}].state`, 'A superseded revision must precede the current validated revision.');
    }
  });
  return deepFreeze(state);
}

function draft(contract) {
  return { id: contract.revisionId, state: 'DRAFT', contract, artwork: null, layout: null, failure: null };
}

function createEditablePage(input) {
  const contract = validateEditablePageContract(input);
  const owner = getEditablePageOwnership(contract);
  return validateEditablePageState({
    schemaVersion: 1, projectId: owner.projectId, runId: owner.runId, pageId: owner.pageId,
    pageNumber: contract.page.number, currentRevisionId: null, revisions: [draft(contract)]
  });
}

// Pure commands: return a frozen replacement snapshot; never mutate the caller.
// A future repository must compare-and-swap the WHOLE page aggregate atomically.
function applyEditablePageCommand(input, commandInput) {
  const state = jsonSnapshot(validateEditablePageState(input));
  const command = jsonSnapshot(commandInput);
  const shapes = {
    'begin-revision': ['type', 'contract'],
    'record-artifact': ['type', 'revisionId', 'artifact'],
    'validate-pair': ['type', 'revisionId'],
    'fail-revision': ['type', 'revisionId', 'failure'],
    renumber: ['type', 'pageNumber']
  };
  if (!command || typeof command.type !== 'string' || !Object.hasOwn(shapes, command.type)) {
    fail('$.command.type', 'Unsupported revision command.', 'EDITABLE_TRANSITION_INVALID');
  }
  fields(command, shapes[command.type], '$.command');
  if (command.type === 'renumber') {
    positiveInteger(command.pageNumber, '$.command.pageNumber');
    state.pageNumber = command.pageNumber;
  } else if (command.type === 'begin-revision') {
    if (state.revisions.some((revision) => OPEN.has(revision.state))) {
      fail('$.revisions', 'Finish or fail the active revision before starting another.', 'EDITABLE_TRANSITION_INVALID');
    }
    const contract = validateEditablePageContract(command.contract);
    scopeMatches(state, getEditablePageOwnership(contract), '$.command.contract');
    if (contract.page.number !== state.pageNumber) fail('$.command.contract.page.number', 'New contract must use the current page number.');
    state.revisions.push(draft(contract));
  } else {
    id(command.revisionId, '$.command.revisionId');
    const revision = state.revisions.find((item) => item.id === command.revisionId);
    if (!revision) fail('$.command.revisionId', 'Revision does not belong to this page.', 'EDITABLE_REVISION_NOT_FOUND');
    if (!OPEN.has(revision.state)) fail('$.command.revisionId', 'Historical/current revisions cannot be rewritten.', 'EDITABLE_TRANSITION_INVALID');
    if (command.type === 'record-artifact') {
      const artifact = validateEditableArtifact(command.artifact);
      checkArtifact(revision, artifact, artifact.kind, '$.command.artifact');
      if (revision[artifact.kind] !== null) fail('$.command.artifact', 'An artifact cannot be replaced; start a new revision.', 'EDITABLE_TRANSITION_INVALID');
      revision[artifact.kind] = artifact;
      if (revision.artwork !== null && revision.layout !== null) revision.state = 'GENERATED';
    } else if (command.type === 'fail-revision') {
      failureRecord(command.failure, '$.command.failure');
      revision.state = 'FAILED';
      revision.failure = command.failure;
    } else {
      if (revision.state !== 'GENERATED') fail('$.command.revisionId', 'Both artifacts must be recorded before pair validation.', 'EDITABLE_TRANSITION_INVALID');
      validateArtifactPair(revision.artwork, revision.layout);
      const old = state.revisions.find((item) => item.id === state.currentRevisionId);
      if (old) old.state = 'SUPERSEDED';
      revision.state = 'VALIDATED';
      state.currentRevisionId = revision.id;
    }
  }
  return validateEditablePageState(state);
}

// Persistence boundary: validating a snapshot alone cannot establish history.
// Compare the stored predecessor and declared command with the proposed successor.
function validateEditablePageTransition(previousInput, nextInput, command) {
  const previous = validateEditablePageState(previousInput);
  const next = validateEditablePageState(nextInput);
  scopeMatches(previous, next, '$');
  previous.revisions.forEach((revision, index) => {
    if (next.revisions[index]?.id !== revision.id) {
      fail(`$.revisions[${index}].id`, 'Revision identity and history order are immutable.', 'EDITABLE_IDENTITY_IMMUTABLE');
    }
  });
  const expected = applyEditablePageCommand(previous, command);
  if (!equal(expected, next)) fail('$', 'Successor does not match the authorized domain transition.', 'EDITABLE_TRANSITION_INVALID');
  return next;
}

function selectCurrentEditablePair(input) {
  const state = validateEditablePageState(input);
  if (state.currentRevisionId === null) fail('$.currentRevisionId', 'No validated current pair exists.', 'EDITABLE_CURRENT_MISSING');
  const revision = state.revisions.find((item) => item.id === state.currentRevisionId);
  return deepFreeze({
    owner: getEditablePageOwnership(revision.contract),
    pageNumber: state.pageNumber, artwork: revision.artwork, layout: revision.layout
  });
}
function serializeEditablePageState(input) {
  return JSON.stringify(validateEditablePageState(input));
}
function deserializeEditablePageState(text) {
  if (typeof text !== 'string') fail('$', 'Expected serialized JSON text.');
  let input;
  try { input = JSON.parse(text); } catch { fail('$', 'Malformed JSON page state.'); }
  return validateEditablePageState(input);
}

module.exports = {
  REVISION_STATES, createEditablePage, applyEditablePageCommand,
  validateEditablePageState, validateEditablePageTransition, selectCurrentEditablePair,
  serializeEditablePageState, deserializeEditablePageState
};
