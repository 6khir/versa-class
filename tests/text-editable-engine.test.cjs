'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, readdir, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, posix } = require('node:path');
const JSZip = require('jszip'); // Already installed with pptxgenjs.
const sax = require('sax'); // Existing dependency; strict XML parsing for adversarial output.
const sharp = require('sharp');
const { makeThreePageFixture } = require('./fixtures/text-editable-three-pages.cjs');
const { buildTextEditablePrototype } = require('../src/text-editable-engine.cjs');
const { assembleEditablePptx } = require('../src/pptx-assembler.cjs');
const { prototypeTextToPptxBox, overlayToPptxBox } = require('../src/text-overlay-layout.cjs');
const fm = require('../src/file-manager.cjs');

let directory, fixture, result, zip;
const clone = () => structuredClone(fixture);
const xml = (path) => zip.file(path).async('string');
const escapeXml = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const emu = (points) => Math.round(points * 12700);

before(async () => {
  // All generated artwork lives outside the repository. No cleanup/deletion.
  directory = await mkdtemp(join(tmpdir(), 'versa-phase5b-'));
  fixture = await makeThreePageFixture(directory);
  result = await buildTextEditablePrototype(fixture);
  zip = await JSZip.loadAsync(result.buffer, { checkCRC32: true });
});

test('returns only a three-slide PPTX buffer without mutating input or writing output', async (t) => {
  const input = clone();
  const snapshot = clone();
  const files = await readdir(directory);
  for (const name of ['atomicWrite', 'pageImageAsPngBuffer', 'bookFileCode']) {
    t.mock.method(fm, name, () => { throw new Error(`Unexpected production call: ${name}`); });
  }
  const built = await buildTextEditablePrototype(input);
  assert.deepEqual(Object.keys(built).sort(), ['buffer', 'slideCount']);
  assert.ok(Buffer.isBuffer(built.buffer));
  assert.equal(built.slideCount, 3);
  assert.deepEqual(input, snapshot);
  assert.deepEqual(await readdir(directory), files);
  assert.equal(Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length, 3);
});

test('native text boxes retain IDs, text, geometry and explicit typography in slide XML', async () => {
  for (const page of fixture.pages) {
    const slide = await xml(`ppt/slides/slide${page.pageNumber}.xml`);
    const shapes = [...slide.matchAll(/<p:sp>.*?<\/p:sp>/gs)].map((match) => match[0]);
    assert.equal(shapes.length, page.textOverlays.length);
    assert.doesNotMatch(slide, /<p:grpSp[ >]|<p:graphicFrame|<a:hlinkClick/);
    assert.ok(slide.indexOf('<p:pic>') < slide.indexOf('<p:sp>'));
    for (const [index, record] of page.textOverlays.entries()) {
      const shape = shapes[index];
      assert.ok(shape.includes(`name="${record.id}"`));
      assert.match(shape, /<p:cNvSpPr txBox="1"/);
      assert.ok(shape.includes(`<a:off x="${emu(record.x)}" y="${emu(record.y)}"/>`));
      assert.ok(shape.includes(`<a:ext cx="${emu(record.width)}" cy="${emu(record.height)}"/>`));
      for (const line of record.text.split('\n')) assert.ok(shape.includes(`<a:t>${escapeXml(line)}</a:t>`));
      assert.ok(shape.includes(`sz="${record.fontSize * 100}"`));
      assert.ok(shape.includes(`typeface="${record.fontFace}"`));
      assert.ok(shape.includes(`<a:srgbClr val="${record.color}"/>`));
      assert.ok(shape.includes(`algn="${{ left: 'l', center: 'ctr', right: 'r' }[record.align]}"`));
      assert.ok(shape.includes(`anchor="${{ top: 't', middle: 'ctr', bottom: 'b' }[record.valign]}"`));
      assert.ok(shape.includes(`<a:lnSpc><a:spcPts val="${record.lineSpacing * 100}"/></a:lnSpc>`));
      assert.match(shape, /wrap="none"/);
      for (const inset of ['lIns', 'rIns', 'tIns', 'bIns']) assert.ok(shape.includes(`${inset}="0"`));
      assert.doesNotMatch(shape, /<a:spAutoFit|<a:normAutofit/);
      if (record.rotation) assert.ok(shape.includes(`rot="${record.rotation * 60000}"`));
      assert.equal(/\sb="1"/.test(shape), record.bold);
      assert.equal(/\si="1"/.test(shape), record.italic);
    }
  }
});

test('embeds exact deterministic text-free PNG artwork as one full-page background per slide', async () => {
  const otherDir = await mkdtemp(join(tmpdir(), 'versa-phase5b-repeat-'));
  const repeated = await makeThreePageFixture(otherDir);
  for (const [index, page] of fixture.pages.entries()) {
    const expected = await readFile(page.background.path);
    assert.deepEqual(expected, await readFile(repeated.pages[index].background.path));
    const slide = await xml(`ppt/slides/slide${index + 1}.xml`);
    const pics = [...slide.matchAll(/<p:pic>.*?<\/p:pic>/gs)];
    assert.equal(pics.length, 1);
    const picture = pics[0][0];
    assert.ok(picture.includes('<a:off x="0" y="0"/>'));
    assert.ok(picture.includes(`<a:ext cx="${emu(612)}" cy="${emu(792)}"/>`));
    const relId = picture.match(/r:embed="([^"]+)"/)[1];
    const rels = await xml(`ppt/slides/_rels/slide${index + 1}.xml.rels`);
    const rel = [...rels.matchAll(/<Relationship\s[^>]+/g)].find(([value]) => value.includes(`Id="${relId}"`))[0];
    const target = rel.match(/Target="([^"]+)"/)[1];
    assert.deepEqual(await zip.file(posix.normalize(`ppt/slides/${target}`)).async('nodebuffer'), expected);
  }
});

test('page numbers preserve slide order even when input pages arrive out of order', async () => {
  const input = clone();
  input.pages = [input.pages[2], input.pages[0], input.pages[1]];
  const archive = await JSZip.loadAsync((await buildTextEditablePrototype(input)).buffer);
  const presentation = await archive.file('ppt/presentation.xml').async('string');
  const rels = await archive.file('ppt/_rels/presentation.xml.rels').async('string');
  const ids = [...presentation.matchAll(/<p:sldId\s[^>]*r:id="([^"]+)"/g)];
  assert.equal(ids.length, 3);
  for (const [index, match] of ids.entries()) {
    const rel = [...rels.matchAll(/<Relationship\s[^>]+/g)].find(([value]) => value.includes(`Id="${match[1]}"`))[0];
    const target = rel.match(/Target="([^"]+)"/)[1];
    assert.match(await archive.file(posix.normalize(`ppt/${target}`)).async('string'), new RegExp(`name="p${index + 1}-title"`));
  }
  assert.deepEqual(input.pages.map((page) => page.pageNumber), [3, 1, 2]);
});

for (const format of ['A4', 'LETTER', 'SQUARE']) {
  for (const orientation of ['portrait', 'landscape']) {
    test(`preserves ${format} ${orientation} dimensions`, async () => {
      const dir = await mkdtemp(join(tmpdir(), 'versa-phase5b-size-'));
      const input = await makeThreePageFixture(dir, { format, orientation });
      const archive = await JSZip.loadAsync((await buildTextEditablePrototype(input)).buffer);
      const presentation = await archive.file('ppt/presentation.xml').async('string');
      const [w, h] = fm.resolvePageSetup(format, orientation).points;
      assert.match(presentation, new RegExp(`<p:sldSz cx="${emu(w)}" cy="${emu(h)}"`));
    });
  }
}

const invalidInputs = [
  ['missing input', () => null],
  ['two pages', (input) => { input.pages.pop(); }],
  ['four pages', (input) => { input.pages.push(input.pages[0]); }],
  ['duplicate page', (input) => { input.pages[1].pageNumber = 1; }],
  ['invalid page', (input) => { input.pages[0].pageNumber = 0; }],
  ['fractional page', (input) => { input.pages[0].pageNumber = 1.5; }],
  ['sparse pages', (input) => { input.pages = new Array(3); }],
  ['missing format', (input) => { input.format = undefined; }],
  ['prototype key format', (input) => { input.format = '__proto__'; }],
  ['invalid orientation', (input) => { input.orientation = 'wide'; }],
  ['missing text array', (input) => { input.pages[0].textOverlays = null; }],
  ['empty text array', (input) => { input.pages[0].textOverlays = []; }]
];
for (const [name, mutate] of invalidInputs) {
  test(`rejects ${name}`, async () => {
    const input = clone();
    const replacement = mutate(input);
    await assert.rejects(buildTextEditablePrototype(replacement === null ? null : input), { code: 'TEXT_EDITABLE_INPUT_INVALID' });
  });
}

const invalidText = [
  ['id', ''], ['id', 'bad id'], ['text', '   '], ['text', '\u0000'], ['text', '\uD800'],
  ['units', 'in'], ['editable', false], ['x', -1], ['y', NaN], ['width', 0], ['height', Infinity],
  ['x', 600], ['y', 780], ['fontSize', 0], ['fontSize', '24'], ['lineSpacing', 1],
  ['rotation', 181], ['fontFace', ''], ['color', '#ffffff'], ['color', 123456],
  ['bold', 'true'], ['italic', 1], ['align', 'justify'], ['valign', 'baseline']
];
for (const [index, [key, value]] of invalidText.entries()) {
  test(`rejects invalid text ${index + 1}: ${key}`, async () => {
    const input = clone();
    input.pages[0].textOverlays[0][key] = value;
    await assert.rejects(buildTextEditablePrototype(input), { code: 'TEXT_EDITABLE_TEXT_INVALID' });
  });
}

test('rejects duplicate text IDs across pages and within a page', async () => {
  for (const pageIndex of [0, 1]) {
    const input = clone();
    input.pages[pageIndex].textOverlays[1].id = input.pages[0].textOverlays[0].id;
    await assert.rejects(buildTextEditablePrototype(input), { code: 'TEXT_EDITABLE_TEXT_DUPLICATE' });
  }
});

test('rejects sparse text records and rotated boxes outside the page', async () => {
  const input = clone();
  input.pages[0].textOverlays = new Array(1);
  await assert.rejects(buildTextEditablePrototype(input), { code: 'TEXT_EDITABLE_TEXT_INVALID' });
  input.pages[0].textOverlays = [{ ...fixture.pages[0].textOverlays[0], x: 0, y: 0, rotation: 45 }];
  await assert.rejects(buildTextEditablePrototype(input), { code: 'TEXT_EDITABLE_TEXT_INVALID' });
});

test('point conversion has no fractional heuristics and preserves Unicode and newlines', () => {
  const record = { ...fixture.pages[0].textOverlays[0], x: 0.5, y: 1, text: 'Café 🌟\r\nSecond\rThird' };
  const box = prototypeTextToPptxBox(record, [612, 792]);
  assert.equal(box.x, 0.5 / 72);
  assert.equal(box.y, 1 / 72);
  assert.equal(box.text, 'Café 🌟\nSecond\nThird');
  for (const dimensions of [null, [0, 792], [612, NaN], [612]]) {
    assert.throws(() => prototypeTextToPptxBox(record, dimensions), { code: 'TEXT_EDITABLE_TEXT_INVALID' });
  }
});

const serializationFailures = [
  ...['x', 'y', 'width', 'height', 'fontSize', 'lineSpacing', 'rotation'].flatMap((key) =>
    [NaN, Infinity, -Infinity].map((value) => [`${key} is ${value}`, { [key]: value }])),
  ['overflowing font size', { fontSize: Number.MAX_VALUE, lineSpacing: Number.MAX_VALUE }],
  ['overflowing spacing', { lineSpacing: Number.MAX_VALUE }],
  ['unsafe integer font size', { fontSize: Number.MAX_SAFE_INTEGER, lineSpacing: Number.MAX_SAFE_INTEGER }],
  ['unsafe integer spacing', { lineSpacing: Number.MAX_SAFE_INTEGER }],
  ['font size above DrawingML limit', { fontSize: 4000.01, lineSpacing: 4001 }],
  ['spacing above DrawingML limit', { lineSpacing: 201168.01 }],
  ['font size below DrawingML limit', { fontSize: 0.99 }],
  ['subnormal typography', { fontSize: Number.MIN_VALUE, lineSpacing: Number.MIN_VALUE }],
  ['typography rounding to zero', { fontSize: 0.004, lineSpacing: 0.004 }],
  ...['x', 'y', 'width', 'height'].flatMap((key) => [
    [`subnormal ${key}`, { [key]: Number.MIN_VALUE }],
    [`${key} below half an EMU`, { [key]: 0.499 / 12700 }],
    [`${key} immediately below half an EMU`, { [key]: (0.5 - Number.EPSILON) / 12700 }],
    [`extreme ${key}`, { [key]: Number.MAX_VALUE }]
  ])
];
for (const [name, overrides] of serializationFailures) {
  test(`rejects serialization defect: ${name}`, async () => {
    const input = clone();
    Object.assign(input.pages[0].textOverlays[0], overrides);
    await assert.rejects(buildTextEditablePrototype(input), { code: 'TEXT_EDITABLE_TEXT_INVALID' });
  });
}

function parseXml(source) {
  const elements = [];
  const parser = sax.parser(true, { xmlns: true });
  parser.onopentag = (element) => elements.push(element);
  parser.write(source).close(); // Strict parser throws on malformed XML.
  return elements;
}

for (const codePoint of [0x00, 0x08, 0x0B, 0x0C, 0x1F, 0xD800, 0xDFFF, 0xFFFE, 0xFFFF]) {
  test(`rejects XML-invalid font character U+${codePoint.toString(16).toUpperCase()}`, async () => {
    const input = clone();
    input.pages[0].textOverlays[0].fontFace = `Font${String.fromCharCode(codePoint)}Name`;
    await assert.rejects(buildTextEditablePrototype(input), { code: 'TEXT_EDITABLE_TEXT_INVALID' });
  });
}

test('serializes typography limits and the smallest rounded positive geometry as valid integers', async () => {
  const input = clone();
  input.pages[0].textOverlays = [
    { ...input.pages[0].textOverlays[0], x: 0.501 / 12700, y: 1 / 12700,
      width: 0.501 / 12700, height: 1 / 12700, fontSize: 1, lineSpacing: 1 },
    { ...input.pages[0].textOverlays[1], x: 0, y: 0, fontSize: 4000, lineSpacing: 201168 }
  ];
  const archive = await JSZip.loadAsync((await buildTextEditablePrototype(input)).buffer, { checkCRC32: true });
  const source = await archive.file('ppt/slides/slide1.xml').async('string');
  parseXml(source);
  const shapes = [...source.matchAll(/<p:sp>.*?<\/p:sp>/gs)].map(([shape]) => shape);
  assert.equal(shapes.length, 2);
  assert.ok(shapes[0].includes('<a:off x="1" y="1"/>'));
  assert.ok(shapes[0].includes('<a:ext cx="1" cy="1"/>'));
  assert.ok(shapes[1].includes('<a:off x="0" y="0"/>'));
  for (const [index, size, spacing] of [[0, 100, 100], [1, 400000, 20116800]]) {
    assert.ok(shapes[index].includes(`sz="${size}"`));
    assert.ok(shapes[index].includes(`<a:spcPts val="${spacing}"/>`));
    assert.doesNotMatch(shapes[index], /NaN|Infinity/);
  }
});

test('font names round-trip through strict XML parsing without injecting elements or attributes', async () => {
  const input = clone();
  const fontNames = [
    'A&B <Family> "quoted" \'single\'',
    'Arial"/><a:hlinkClick r:id="evil"/><a:latin typeface="injected',
    'Arial" injected="yes',
    '&quot; &#34; &unknown;',
    'Café 字体 🌟',
    'Font\tTab\nLine\rReturn'
  ];
  const records = input.pages.flatMap((page) => page.textOverlays);
  records.forEach((record, index) => { record.fontFace = fontNames[index]; });
  const snapshot = structuredClone(input);
  const archive = await JSZip.loadAsync((await buildTextEditablePrototype(input)).buffer, { checkCRC32: true });
  assert.deepEqual(input, snapshot);
  for (const entry of Object.values(archive.files)) {
    if (/\.(xml|rels)$/.test(entry.name)) parseXml(await entry.async('string'));
  }
  for (const page of input.pages) {
    const source = await archive.file(`ppt/slides/slide${page.pageNumber}.xml`).async('string');
    const shapes = [...source.matchAll(/<p:sp>.*?<\/p:sp>/gs)].map(([shape]) => shape);
    assert.equal(shapes.length, page.textOverlays.length);
    shapes.forEach((shape, index) => {
      // Parse within the slide namespace context, including each typeface script.
      const elements = parseXml(`<root xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">${shape}</root>`);
      const fonts = elements.filter((element) => ['a:latin', 'a:ea', 'a:cs'].includes(element.name));
      assert.equal(fonts.length, 3 * page.textOverlays[index].text.split('\n').length);
      for (const font of fonts) {
        assert.equal(font.attributes.typeface.value, page.textOverlays[index].fontFace);
        assert.deepEqual(Object.keys(font.attributes).sort(), ['charset', 'pitchFamily', 'typeface']);
      }
      assert.ok(elements.every((element) => element.name !== 'a:hlinkClick'));
    });
  }
});

test('requires explicit text-free artwork and readable paths', async () => {
  for (const background of [null, { path: 'x' }, { path: 'x', textFree: false }, { path: '', textFree: true }]) {
    const input = clone();
    input.pages[0].background = background;
    await assert.rejects(buildTextEditablePrototype(input), { code: 'TEXT_EDITABLE_BACKGROUND_INVALID' });
  }
  const input = clone();
  input.pages[0].background.path = join(directory, 'missing.png');
  await assert.rejects(buildTextEditablePrototype(input), { code: 'TEXT_EDITABLE_BACKGROUND_MISSING' });
});

test('rejects corrupt, non-PNG and wrong-aspect artwork', async () => {
  const png = await readFile(fixture.pages[0].background.path);
  const images = [Buffer.from('not an image'), png.subarray(0, 50),
    await sharp(png).jpeg().toBuffer(),
    await sharp({ create: { width: 100, height: 100, channels: 3, background: 'white' } }).png().toBuffer()];
  for (const [index, bytes] of images.entries()) {
    const input = clone();
    input.pages[0].background.path = join(directory, `invalid-${index}.png`);
    await writeFile(input.pages[0].background.path, bytes);
    await assert.rejects(buildTextEditablePrototype(input), { code: 'TEXT_EDITABLE_BACKGROUND_INVALID' });
  }
});

test('existing assembler caller retains output contract and legacy overlay geometry', async (t) => {
  let written;
  t.mock.method(fm, 'atomicWrite', async (path, buffer) => { written = { path, buffer }; });
  t.mock.method(fm, 'pageImageAsPngBuffer', async (path) => readFile(path));
  const overlay = { text: 'Legacy', x: 0.1, y: 0.2, width: 0.8, height: 0.1, fontSize: 18 };
  const box = overlayToPptxBox(overlay, 8.5, 11);
  assert.equal(box.x, 8.5 * 0.1);
  assert.equal(box.y, 2.2);
  assert.equal(box.w, 8.5 * 0.8);
  const legacy = await assembleEditablePptx({ name: 'Legacy', format: 'LETTER', orientation: 'portrait',
    outputDir: directory, jobs: [{ pageNumber: 1, outputPath: fixture.pages[0].background.path, textOverlays: [overlay] }]
  }, { fileName: 'legacy.pptx' });
  assert.deepEqual(legacy, { pptxPath: join(directory, 'legacy.pptx'), pptxName: 'legacy.pptx', slideCount: 1 });
  assert.equal(written.path, legacy.pptxPath);
  const archive = await JSZip.loadAsync(written.buffer);
  const slide = await archive.file('ppt/slides/slide1.xml').async('string');
  assert.match(slide, /<a:t>Legacy<\/a:t>/);
  assert.ok(slide.includes(`<a:off x="${Math.round(box.x * 914400)}" y="${Math.round(box.y * 914400)}"/>`));
  await assert.rejects(assembleEditablePptx({ jobs: [] }), { code: 'EDITABLE_PAGES_MISSING' });
  await assert.rejects(assembleEditablePptx({ jobs: [{ pageNumber: 1 }], outputDir: directory }), { code: 'EDITABLE_BG_MISSING' });
});
