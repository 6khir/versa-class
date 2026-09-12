'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ENGINE_TYPES, getEngineBoundary } = require('../src/product-engine-boundary.cjs');
const {
  CONTRACT_VERSION, ELEMENT_ROLES, createPageId,
  validateEditablePageContract: validate,
  validateEditablePageContracts: validatePages,
  serializeEditablePageContract: serialize
} = require('../src/editable-page-contract.cjs');

function fixture(sequence = 1) {
  const pageId = createPageId(sequence);
  return {
    schemaVersion: CONTRACT_VERSION,
    engineType: ENGINE_TYPES.NATIVE_TEXT_EDITABLE,
    project: { id: 'project-1', revision: 1 },
    page: { id: pageId, number: sequence },
    format: 'LETTER', orientation: 'portrait',
    dimensions: { units: 'pt', width: 612, height: 792 },
    safeRegions: [{ id: 'safe', x: 36, y: 36, width: 540, height: 720 }],
    textRegions: [{ id: 'body', safeRegionId: 'safe', roles: [...ELEMENT_ROLES], x: 54, y: 54, width: 504, height: 684 }],
    artwork: { id: `${pageId}-art`, pageId, reference: `${pageId}.png` },
    textLayout: { id: `${pageId}-layout`, pageId, reference: `${pageId}.json` },
    elements: [{ id: 'title-1', role: 'title', regionId: 'body', content: { text: 'Our classroom' } }]
  };
}
const rejects = (value) => assert.throws(() => validate(value), { code: 'EDITABLE_CONTRACT_INVALID' });

test('engine boundary represents three explicit immutable product engines', () => {
  assert.deepEqual(Object.values(ENGINE_TYPES), ['normal', 'native-text-editable', 'maze']);
  for (const type of Object.values(ENGINE_TYPES)) {
    const boundary = getEngineBoundary(type);
    assert.deepEqual(boundary, { type });
    assert.ok(Object.isFrozen(boundary));
    assert.equal(getEngineBoundary(type), boundary);
    assert.throws(() => { boundary.type = 'changed'; }, TypeError);
  }
  assert.ok(Object.isFrozen(ENGINE_TYPES));
  for (const type of [undefined, null, '', 'static', 'editable', 'NORMAL', '__proto__', {}, 1]) {
    assert.throws(() => getEngineBoundary(type), { code: 'PRODUCT_ENGINE_INVALID' });
  }
});

test('valid contract returns an independent snapshot without altering input', () => {
  const input = fixture();
  const before = structuredClone(input);
  const result = validate(input);
  assert.deepEqual(result, before);
  result.elements[0].content.text = 'Changed';
  result.textRegions[0].roles.push('unknown');
  assert.deepEqual(input, before);
});

for (const key of Object.keys(fixture())) {
  test(`rejects missing required top-level field: ${key}`, () => {
    const page = fixture();
    delete page[key];
    rejects(page);
  });
}

const invalidCases = [
  ['old version', (p) => { p.schemaVersion = 0; }],
  ['future version', (p) => { p.schemaVersion = 3; }],
  ['string version', (p) => { p.schemaVersion = '1'; }],
  ['normal engine', (p) => { p.engineType = 'normal'; }],
  ['unknown engine', (p) => { p.engineType = 'editable'; }],
  ['project ID', (p) => { p.project.id = ''; }],
  ['project revision', (p) => { p.project.revision = 0; }],
  ['fractional revision', (p) => { p.project.revision = 1.5; }],
  ['missing revision', (p) => { delete p.project.revision; }],
  ['missing artwork identity', (p) => { delete p.artwork.id; }],
  ['artwork pairing', (p) => { p.artwork.pageId = 'A02'; }],
  ['text pairing', (p) => { p.textLayout.pageId = 'A02'; }],
  ['empty reference', (p) => { p.textLayout.reference = ' '; }],
  ['shared artifact identity', (p) => { p.textLayout.id = p.artwork.id; }],
  ['shared artifact reference', (p) => { p.textLayout.reference = p.artwork.reference; }],
  ['unknown format', (p) => { p.format = 'LEGAL'; }],
  ['inherited format name', (p) => { p.format = 'toString'; }],
  ['object format', (p) => { p.format = { toString: 'LETTER' }; }],
  ['invalid orientation', (p) => { p.orientation = 'auto'; }],
  ['dimensions unit', (p) => { p.dimensions.units = 'in'; }],
  ['dimension mismatch', (p) => { p.dimensions.width = 613; }],
  ['orientation mismatch', (p) => { p.orientation = 'landscape'; }],
  ['zero dimension', (p) => { p.dimensions.height = 0; }],
  ['negative dimension', (p) => { p.dimensions.height = -1; }],
  ['string dimension', (p) => { p.dimensions.width = '612'; }],
  ['nonfinite dimension', (p) => { p.dimensions.height = Infinity; }],
  ['missing safe regions', (p) => { p.safeRegions = []; }],
  ['duplicate safe region', (p) => { p.safeRegions.push({ ...p.safeRegions[0] }); }],
  ['off-page safe region', (p) => { p.safeRegions[0].width = 613; }],
  ['negative region offset', (p) => { p.safeRegions[0].x = -1; }],
  ['zero region extent', (p) => { p.safeRegions[0].height = 0; }],
  ['nonfinite region extent', (p) => { p.safeRegions[0].height = NaN; }],
  ['missing text regions', (p) => { p.textRegions = []; }],
  ['duplicate text region', (p) => { p.textRegions.push({ ...p.textRegions[0] }); }],
  ['unknown safe region', (p) => { p.textRegions[0].safeRegionId = 'missing'; }],
  ['text outside safe region', (p) => { p.textRegions[0].x = 0; }],
  ['unsupported allowed role', (p) => { p.textRegions[0].roles = ['art']; }],
  ['duplicate allowed role', (p) => { p.textRegions[0].roles.push('title'); }],
  ['empty allowed roles', (p) => { p.textRegions[0].roles = []; }],
  ['element ID', (p) => { p.elements[0].id = ''; }],
  ['missing element ID', (p) => { delete p.elements[0].id; }],
  ['duplicate element ID', (p) => { p.elements.push(structuredClone(p.elements[0])); }],
  ['unknown role', (p) => { p.elements[0].role = 'image'; }],
  ['unknown text region', (p) => { p.elements[0].regionId = 'missing'; }],
  ['role forbidden by region', (p) => { p.textRegions[0].roles = ['paragraph']; }],
  ['missing content', (p) => { delete p.elements[0].content; }],
  ['blank text', (p) => { p.elements[0].content.text = ' '; }],
  ['numeric text', (p) => { p.elements[0].content.text = 123; }],
  ['unknown top-level field', (p) => { p.textFree = true; }],
  ['unknown nested field', (p) => { p.elements[0].fontSize = 24; }],
  ['undefined value', (p) => { p.elements[0].content.text = undefined; }],
  ['function value', (p) => { p.elements[0].content.text = () => 'text'; }],
  ['bigint value', (p) => { p.project.revision = 1n; }],
  ['negative zero', (p) => { p.safeRegions[0].x = -0; }],
  ['unpaired surrogate', (p) => { p.elements[0].content.text = '\uD800'; }],
  ['control character', (p) => { p.elements[0].content.text = 'a\u0000b'; }],
  ['sparse elements', (p) => { p.elements = new Array(1); }],
  ['array custom property', (p) => { p.elements.extra = 1; }],
  ['cycle', (p) => { p.elements[0].content = p; }],
  ['custom prototype', (p) => { p.project = new Date(); }],
  ['symbol field', (p) => { p[Symbol('x')] = true; }],
  ['nonenumerable field', (p) => { Object.defineProperty(p, 'hidden', { value: 1 }); }]
];
for (const [name, mutate] of invalidCases) {
  test(`fails closed: ${name}`, () => { const page = fixture(); mutate(page); rejects(page); });
}

test('a page with no text boxes is valid artwork, not a broken page', () => {
  // Covers, thank-you pages, and any page whose text was never recovered ship as
  // artwork alone. Requiring at least one element is what pushed the old code into
  // filling the page with the generation prompt just to satisfy this rule.
  const page = fixture();
  page.elements = [];
  assert.doesNotThrow(() => validate(page));
});

test('elements must still be an array', () => {
  const page = fixture();
  page.elements = null;
  rejects(page);
});

for (const number of [0, -1, 1.5, '1', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null]) {
  test(`rejects invalid page number ${String(number)} (${typeof number})`, () => {
    const page = fixture(); page.page.number = number; rejects(page);
    assert.throws(() => createPageId(number), { code: 'EDITABLE_CONTRACT_INVALID' });
  });
}
for (const value of ['', 'A1', 'A00', 'A001', 'a01', 'A01.png', 'A9007199254740992', 1, null]) {
  test(`rejects invalid page identity ${String(value)}`, () => {
    const page = fixture(); page.page.id = value; rejects(page);
  });
}
for (const value of [null, undefined, [], 'contract', 1, true]) {
  test(`rejects malformed root ${String(value)}`, () => rejects(value));
}

test('accessor data is rejected without executing the getter', () => {
  const page = fixture();
  let calls = 0;
  Object.defineProperty(page, 'format', { enumerable: true, get() { calls++; return 'LETTER'; } });
  rejects(page);
  assert.equal(calls, 0);
});

test('page identity survives reordering and does not depend on reference filenames', () => {
  assert.equal(createPageId(1), 'A01');
  assert.equal(createPageId(99), 'A99');
  assert.equal(createPageId(100), 'A100');
  const page = fixture();
  page.page.number = 3;
  page.artwork.reference = 'asset:opaque-background';
  page.textLayout.reference = 'asset:opaque-layout';
  assert.equal(validate(page).page.id, 'A01');
});

test('page set accepts scoped element IDs and preserves explicit caller order', () => {
  const pages = [fixture(3), fixture(1), fixture(2)];
  assert.deepEqual(validatePages(pages).map((p) => p.page.id), ['A03', 'A01', 'A02']);
});
for (const [name, mutate] of [
  ['page identity', (p) => { p[1] = structuredClone(p[0]); p[1].page.number = 2; }],
  ['page number', (p) => { p[1].page.number = 1; }],
  ['artifact identity', (p) => { p[1].artwork.id = p[0].artwork.id; }],
  ['artifact reference', (p) => { p[1].artwork.reference = p[0].artwork.reference; }],
  ['project identity', (p) => { p[1].project.id = 'other'; }],
  ['project revision', (p) => { p[1].project.revision = 2; }],
  ['page setup', (p) => { p[1].orientation = 'landscape'; p[1].dimensions = { units: 'pt', width: 792, height: 612 }; }]
]) {
  test(`page set rejects conflicting ${name}`, () => {
    const pages = [fixture(), fixture(2)]; mutate(pages);
    assert.throws(() => validatePages(pages), { code: 'EDITABLE_CONTRACT_INVALID' });
  });
}
test('page set rejects malformed collections', () => {
  for (const value of [[], null, {}, new Array(2)]) {
    assert.throws(() => validatePages(value), { code: 'EDITABLE_CONTRACT_INVALID' });
  }
});

for (const role of ELEMENT_ROLES) {
  test(`supports typed role: ${role}`, () => {
    const page = fixture();
    page.elements[0].role = role;
    page.elements[0].content = role === 'answer-line' ? {}
      : role === 'table' ? { rows: [['Name', 'Score'], ['', '5']] } : { text: 'Example' };
    assert.deepEqual(validate(page), page);
  });
}
test('table and answer-line reject incompatible content', () => {
  for (const content of [{ rows: [] }, { rows: [[]] }, { rows: [['a'], ['b', 'c']] }, { rows: [[3]] }, { text: 'table' }]) {
    const page = fixture(); Object.assign(page.elements[0], { role: 'table', content }); rejects(page);
  }
  const page = fixture(); page.elements[0].role = 'answer-line'; rejects(page);
});

test('serialization is canonical, lossless and keeps meaningful element order', () => {
  const reverseKeys = (value) => Array.isArray(value) ? value.map(reverseKeys)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reverseKeys(v)])) : value;
  const page = fixture();
  page.elements[0].content.text = 'Read & explore <together> 🌟\nمرحبا';
  page.elements.push({ id: 'second', role: 'paragraph', regionId: 'body', content: { text: 'Next' } });
  const serialized = serialize(page);
  assert.equal(serialized, serialize(reverseKeys(page)));
  assert.deepEqual(JSON.parse(serialized), page);
  assert.equal(serialize(JSON.parse(serialized)), serialized);
  page.elements.reverse();
  assert.notEqual(serialize(page), serialized);
  page.schemaVersion = 2;
  assert.throws(() => serialize(page), { code: 'EDITABLE_CONTRACT_INVALID' });
});

test('contract sizes remain compatible with all existing Phase 5B page setups', () => {
  const { resolvePageSetup } = require('../src/file-manager.cjs');
  for (const format of ['A4', 'LETTER', 'SQUARE']) {
    for (const orientation of ['portrait', 'landscape']) {
      const page = fixture();
      const [width, height] = resolvePageSetup(format, orientation).points;
      Object.assign(page, { format, orientation, dimensions: { units: 'pt', width, height } });
      page.safeRegions = [{ id: 'safe', x: 0, y: 0, width, height }];
      Object.assign(page.textRegions[0], { x: 36, y: 36, width: width - 72, height: height - 72 });
      assert.deepEqual(validate(page), page);
    }
  }
});

test('foundation can coexist with the unchanged Phase 5B API and fixture', async () => {
  const { mkdtemp, readdir } = require('node:fs/promises');
  const { join } = require('node:path');
  const { tmpdir } = require('node:os');
  const { makeThreePageFixture } = require('./fixtures/text-editable-three-pages.cjs');
  const { buildTextEditablePrototype } = require('../src/text-editable-engine.cjs');
  const directory = await mkdtemp(join(tmpdir(), 'versa-phase5c-compat-'));
  const input = await makeThreePageFixture(directory);
  const snapshot = structuredClone(input);
  const files = await readdir(directory);
  serialize(fixture());
  const result = await buildTextEditablePrototype(input);
  assert.deepEqual(Object.keys(result).sort(), ['buffer', 'slideCount']);
  assert.ok(Buffer.isBuffer(result.buffer));
  assert.equal(result.slideCount, 3);
  assert.deepEqual(input, snapshot);
  assert.deepEqual(await readdir(directory), files);
});
