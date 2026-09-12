'use strict';

const { fail, jsonSnapshot, fields, string, id, positiveInteger } = require('./editable-contract-data.cjs');
const { ENGINE_TYPES } = require('./product-engine-boundary.cjs');

const CONTRACT_VERSION = 1; // Accepted planning contract remains supported.
const OWNED_CONTRACT_VERSION = 2;
const ELEMENT_ROLES = Object.freeze([
  'title', 'subtitle', 'instruction', 'paragraph', 'question', 'answer-line',
  'label', 'table', 'footer', 'caption', 'number'
]);
// Version-1 canonical page sizes in points; deliberately independent of production.
const SIZES = Object.freeze({
  A4: Object.freeze([595.28, 841.89]),
  LETTER: Object.freeze([612, 792]),
  SQUARE: Object.freeze([720, 720])
});

function list(value, path) {
  if (!Array.isArray(value) || !value.length) fail(path, 'Expected a nonempty array.');
}
function unique(set, value, path) {
  if (set.has(value)) fail(path, 'Duplicate identity or number.');
  set.add(value);
}
function rectangle(value, bounds, path) {
  for (const key of ['x', 'y', 'width', 'height']) {
    if (!Number.isFinite(value[key])) fail(`${path}.${key}`, 'Expected a finite number.');
  }
  if (value.x < bounds.x || value.y < bounds.y || value.width <= 0 || value.height <= 0
    || value.width > bounds.width || value.height > bounds.height
    || value.x - bounds.x > bounds.width - value.width
    || value.y - bounds.y > bounds.height - value.height) fail(path, 'Rectangle lies outside its containing region.');
}

// Identity is allocated once, NOT recomputed when a page is reordered.
function createPageId(sequence) {
  positiveInteger(sequence, '$.pageIdSequence');
  return `A${String(sequence).padStart(2, '0')}`;
}

function validatePage(page, path) {
  const owned = page?.schemaVersion === OWNED_CONTRACT_VERSION;
  fields(page, ['schemaVersion', 'engineType', 'project', 'page', 'format', 'orientation',
    'dimensions', 'safeRegions', 'textRegions', 'artwork', 'textLayout', 'elements',
    ...(owned ? ['runId', 'revisionId'] : [])], path);
  if (page.schemaVersion !== CONTRACT_VERSION && !owned) fail(`${path}.schemaVersion`, 'Unsupported schema version.');
  if (page.engineType !== ENGINE_TYPES.NATIVE_TEXT_EDITABLE) fail(`${path}.engineType`, 'Expected native-text-editable.');
  fields(page.project, ['id', 'revision'], `${path}.project`);
  id(page.project.id, `${path}.project.id`);
  positiveInteger(page.project.revision, `${path}.project.revision`);
  fields(page.page, ['id', 'number'], `${path}.page`);
  if (typeof page.page.id !== 'string' || !/^A(?:0[1-9]|[1-9]\d+)$/.test(page.page.id)
    || !Number.isSafeInteger(Number(page.page.id.slice(1)))) fail(`${path}.page.id`, 'Expected canonical A01-style identity.');
  positiveInteger(page.page.number, `${path}.page.number`);
  if (owned) {
    id(page.runId, `${path}.runId`);
    id(page.revisionId, `${path}.revisionId`);
  }
  if (typeof page.format !== 'string' || !Object.hasOwn(SIZES, page.format)) fail(`${path}.format`, 'Unsupported format.');
  if (!['portrait', 'landscape'].includes(page.orientation)) fail(`${path}.orientation`, 'Unsupported orientation.');
  fields(page.dimensions, ['units', 'width', 'height'], `${path}.dimensions`);
  const [width, height] = page.orientation === 'landscape' ? [...SIZES[page.format]].reverse() : SIZES[page.format];
  if (page.dimensions.units !== 'pt' || page.dimensions.width !== width || page.dimensions.height !== height) {
    fail(`${path}.dimensions`, 'Expected canonical format/orientation dimensions in points.');
  }
  list(page.safeRegions, `${path}.safeRegions`);
  const safe = new Map();
  for (const region of page.safeRegions) {
    fields(region, ['id', 'x', 'y', 'width', 'height'], `${path}.safeRegions`);
    id(region.id, `${path}.safeRegions.id`);
    if (safe.has(region.id)) fail(`${path}.safeRegions`, 'Duplicate safe-region identity.');
    rectangle(region, { x: 0, y: 0, width, height }, `${path}.safeRegions.${region.id}`);
    safe.set(region.id, region);
  }
  list(page.textRegions, `${path}.textRegions`);
  const regions = new Map();
  for (const region of page.textRegions) {
    fields(region, ['id', 'safeRegionId', 'roles', 'x', 'y', 'width', 'height'], `${path}.textRegions`);
    id(region.id, `${path}.textRegions.id`);
    if (regions.has(region.id)) fail(`${path}.textRegions`, 'Duplicate text-region identity.');
    if (!safe.has(region.safeRegionId)) fail(`${path}.textRegions.safeRegionId`, 'Unknown safe region.');
    list(region.roles, `${path}.textRegions.roles`);
    if (new Set(region.roles).size !== region.roles.length || region.roles.some((role) => !ELEMENT_ROLES.includes(role))) {
      fail(`${path}.textRegions.roles`, 'Expected unique supported roles.');
    }
    rectangle(region, safe.get(region.safeRegionId), `${path}.textRegions.${region.id}`);
    regions.set(region.id, region);
  }
  for (const key of ['artwork', 'textLayout']) {
    if (owned) {
      validateArtifact(page[key], key === 'artwork' ? 'artwork' : 'layout', `${path}.${key}`);
      assertSameOwner(page[key].owner, ownershipOf(page), `${path}.${key}.owner`);
    } else {
      fields(page[key], ['id', 'pageId', 'reference'], `${path}.${key}`);
      id(page[key].id, `${path}.${key}.id`);
      if (page[key].pageId !== page.page.id) fail(`${path}.${key}.pageId`, 'Reference belongs to another page.');
      string(page[key].reference, `${path}.${key}.reference`);
    }
  }
  if (page.artwork.id === page.textLayout.id || page.artwork.reference === page.textLayout.reference) {
    fail(path, 'Artwork and text/layout require distinct identities and references.');
  }
  // Elements may legitimately be empty. A page whose text was never recovered, and the
  // cover and thank-you pages, ship as artwork with no text boxes at all - which is the
  // correct outcome, and far better than the previous behaviour of filling the page
  // with the generation prompt to satisfy this rule.
  if (!Array.isArray(page.elements)) fail(`${path}.elements`, 'Expected an array.');
  const elementIds = new Set();
  for (const element of page.elements) {
    fields(element, ['id', 'role', 'regionId', 'content'], `${path}.elements`);
    id(element.id, `${path}.elements.id`);
    unique(elementIds, element.id, `${path}.elements.id`);
    if (!ELEMENT_ROLES.includes(element.role)) fail(`${path}.elements.role`, 'Unsupported element role.');
    if (!regions.get(element.regionId)?.roles.includes(element.role)) fail(`${path}.elements.regionId`, 'Region does not allow this role.');
    if (element.role === 'answer-line') {
      fields(element.content, [], `${path}.elements.content`);
    } else if (element.role === 'table') {
      fields(element.content, ['rows'], `${path}.elements.content`);
      list(element.content.rows, `${path}.elements.content.rows`);
      const columns = element.content.rows[0]?.length;
      for (const row of element.content.rows) {
        list(row, `${path}.elements.content.rows`);
        if (row.length !== columns || row.some((cell) => typeof cell !== 'string')) {
          fail(`${path}.elements.content.rows`, 'Expected rectangular rows of text cells.');
        }
      }
    } else {
      fields(element.content, ['text'], `${path}.elements.content`);
      string(element.content.text, `${path}.elements.content.text`);
    }
  }
  return page;
}

// The owner is derived from existing contract identity; project.revision remains
// the source project snapshot, distinct from the page-generation revisionId.
function ownershipOf(page) {
  return { projectId: page.project.id, runId: page.runId, pageId: page.page.id, revisionId: page.revisionId };
}
function validateOwner(owner, path) {
  fields(owner, ['projectId', 'runId', 'pageId', 'revisionId'], path);
  for (const key of ['projectId', 'runId', 'revisionId']) id(owner[key], `${path}.${key}`);
  if (typeof owner.pageId !== 'string' || !/^A(?:0[1-9]|[1-9]\d+)$/.test(owner.pageId)
    || !Number.isSafeInteger(Number(owner.pageId.slice(1)))) fail(`${path}.pageId`, 'Expected canonical A01-style identity.');
  return owner;
}
function assertSameOwner(actual, expected, path) {
  for (const key of ['projectId', 'runId', 'pageId', 'revisionId']) {
    if (actual[key] !== expected[key]) fail(`${path}.${key}`, `Ownership mismatch: expected ${expected[key]}.`);
  }
}
function validateArtifact(artifact, kind, path) {
  fields(artifact, ['id', 'kind', 'owner', 'reference'], path);
  id(artifact.id, `${path}.id`);
  if (!['artwork', 'layout'].includes(artifact.kind) || (kind && artifact.kind !== kind)) {
    fail(`${path}.kind`, `Expected ${kind || 'artwork or layout'} artifact.`);
  }
  validateOwner(artifact.owner, `${path}.owner`);
  string(artifact.reference, `${path}.reference`);
  return artifact;
}
function validateEditableOwnership(input) {
  return validateOwner(jsonSnapshot(input), '$.owner');
}
function validateEditableArtifact(input) {
  return validateArtifact(jsonSnapshot(input), null, '$.artifact');
}
function validateArtifactPair(artworkInput, layoutInput) {
  const artwork = validateArtifact(jsonSnapshot(artworkInput), 'artwork', '$.artwork');
  const layout = validateArtifact(jsonSnapshot(layoutInput), 'layout', '$.layout');
  assertSameOwner(layout.owner, artwork.owner, '$.layout.owner');
  if (artwork.id === layout.id || artwork.reference === layout.reference) {
    fail('$.layout', 'Artwork and layout require distinct identities and references.');
  }
  return { artwork, layout };
}
function getEditablePageOwnership(input) {
  const page = validateEditablePageContract(input);
  if (page.schemaVersion !== OWNED_CONTRACT_VERSION) fail('$.schemaVersion', 'Ownership requires schema version 2.');
  return ownershipOf(page);
}

function validateEditablePageContract(input) {
  return validatePage(jsonSnapshot(input), '$');
}

// A page set is scoped to one project revision and page setup. Gaps in page
// numbers are allowed; completeness is a future product-level concern.
function validateEditablePageContracts(input) {
  const pages = jsonSnapshot(input);
  list(pages, '$');
  const ids = new Set(), numbers = new Set(), artifacts = new Set(), references = new Set();
  pages.forEach((page, index) => {
    const path = `$[${index}]`;
    validatePage(page, path);
    const first = pages[0];
    if (page.schemaVersion !== first.schemaVersion || page.runId !== first.runId
      || page.project.id !== first.project.id || page.project.revision !== first.project.revision
      || page.format !== first.format || page.orientation !== first.orientation) fail(path, 'Mixed contract version, run, project revision or page setup.');
    unique(ids, page.page.id, `${path}.page.id`);
    unique(numbers, page.page.number, `${path}.page.number`);
    for (const key of ['artwork', 'textLayout']) {
      unique(artifacts, page[key].id, `${path}.${key}.id`);
      unique(references, page[key].reference, `${path}.${key}.reference`);
    }
  });
  return pages;
}

function serializeEditablePageContract(input) {
  return JSON.stringify(validateEditablePageContract(input));
}

module.exports = {
  CONTRACT_VERSION, OWNED_CONTRACT_VERSION, ELEMENT_ROLES, createPageId,
  validateEditableOwnership, validateEditableArtifact, validateArtifactPair, getEditablePageOwnership,
  validateEditablePageContract, validateEditablePageContracts, serializeEditablePageContract
};
