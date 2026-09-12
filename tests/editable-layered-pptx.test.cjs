'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildEditableDeck, editableDeckPath, SOURCE_DPI } = require('../src/editable-layered-pptx.cjs');
const visionPages = require('../src/editable-vision-pages.cjs');
const { artworkFingerprint, pageVisionKey } = visionPages;

function harness(t, { pages = 2, withVision = true } = {}) {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'versa-deck-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'jobs'), { recursive: true });
  const jobs = [];
  const settings = new Map();
  for (let index = 0; index < pages; index += 1) {
    const job = { id: `j${index + 1}`, pageNumber: index + 1, status: 'complete' };
    const imagePath = path.join(dir, 'jobs', `${job.id}.png`);
    fs.writeFileSync(imagePath, `page-${index + 1}`);
    jobs.push(job);
    if (withVision) {
      settings.set(pageVisionKey('p1', job.id), {
        fingerprint: artworkFingerprint(imagePath),
        vision: { ok: true, width: 2480, height: 3508, text: [{ id: 't1', text: 'Hello', box: [10, 10, 100, 40] }] }
      });
    }
  }
  const project = { id: 'p1', name: 'Book', slug: 'book', outputDir: dir, jobs };
  const store = {
    getProject: () => project,
    getSetting: (key, fallback = null) => (settings.has(key) ? settings.get(key) : fallback),
    setSetting: (key, value) => settings.set(key, value)
  };
  return { dir, store, project, jobs };
}

test('the deck is compiled from every analysed page, in page order', async (t) => {
  const h = harness(t, { pages: 3 });
  let seen = null;
  t.mock.method(visionPages.visionBridge, 'composePptx', async (spec) => {
    seen = spec;
    fs.writeFileSync(spec.outputPath, Buffer.alloc(2048, 80));
    return {
      ok: true, outputPath: spec.outputPath, slides: spec.pages.length, bytes: 2048,
      detail: spec.pages.map((_p, i) => ({ slide: i + 1, textRuns: 4, textBoxesPlaced: 4, erased: true }))
    };
  });

  const deck = await buildEditableDeck({ store: h.store, projectId: 'p1' });
  assert.equal(seen.pages.length, 3);
  assert.deepEqual(seen.pages.map((p) => p.pageLabel), ['Slide 1', 'Slide 2', 'Slide 3']);
  // Without the authoring DPI every coordinate lands at the wrong scale on the slide.
  assert.equal(seen.sourceDpi, SOURCE_DPI);
  assert.equal(seen.outputPath, editableDeckPath(h.project));
  assert.equal(deck.textBoxes, 12);
});

test('a book nobody has read yet is refused by name', async (t) => {
  const h = harness(t, { withVision: false });
  t.mock.method(visionPages.visionBridge, 'composePptx', async () => {
    throw new Error('the worker should not be reached');
  });
  await assert.rejects(
    () => buildEditableDeck({ store: h.store, projectId: 'p1' }),
    (error) => error.code === 'EDITABLE_VISION_MISSING'
  );
});

test('an empty pptx is refused before the UI completion event', async (t) => {
  const h = harness(t);
  t.mock.method(visionPages.visionBridge, 'composePptx', async (spec) => {
    fs.writeFileSync(spec.outputPath, '');
    return { ok: true, outputPath: spec.outputPath, slides: 1, bytes: 0, detail: [] };
  });
  await assert.rejects(
    () => buildEditableDeck({ store: h.store, projectId: 'p1' }),
    (error) => error.code === 'PPTX_INVALID'
  );
});

test('a worker failure surfaces its own code rather than a generic throw', async (t) => {
  const h = harness(t);
  t.mock.method(visionPages.visionBridge, 'composePptx', async () => ({
    ok: false, code: 'PPTX_ENGINE_UNAVAILABLE', error: 'No module named pptx'
  }));
  await assert.rejects(
    () => buildEditableDeck({ store: h.store, projectId: 'p1' }),
    (error) => error.code === 'PPTX_ENGINE_UNAVAILABLE'
  );
});

test('the export step builds the deck and the ZIP, and neither can lose the other', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8');
  const start = source.indexOf('      export: async (projectId, onProgress) => {');
  const body = source.slice(start, source.indexOf('\n      }\n    }', start));
  assert.match(body, /fileManager\.exportPptx\(current, \{ store \}\)/);
  assert.match(body, /fileManager\.exportZip\(current\)/);
  // A missing optional artefact is not a reason to lose a finished book, so the deck
  // is attempted inside its own try and the ZIP still runs when it fails.
  assert.match(body, /catch \(error\) \{[\s\S]*Editable PPTX skipped/);
  assert.ok(body.indexOf('exportPptx') < body.indexOf('exportZip(current)'));
});

test('the PPTX IPC hands the store through so the editable path is reachable', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8');
  const start = source.indexOf("ipcMain.handle('project:export-pptx'");
  assert.ok(start > -1, 'the export-pptx handler should exist');
  // Fixed window rather than the next '});': the handler body contains inner calls
  // that close first, and slicing to those cuts the line under test off.
  const body = source.slice(start, start + 900);
  // Without the store the vision lookup silently fails and the flat deck is exported.
  assert.match(body, /exportPptx\(project, \{ \.\.\.\(options \|\| \{\}\), store \}\)/);
});

test('productFormat editable still uses the analysed vision compose path', async (t) => {
  const h = harness(t);
  h.project.productFormat = 'editable';
  let seen = null;
  t.mock.method(visionPages.visionBridge, 'composePptx', async (spec) => {
    seen = spec;
    fs.writeFileSync(spec.outputPath, Buffer.alloc(2048, 80));
    return {
      ok: true, outputPath: spec.outputPath, slides: spec.pages.length, bytes: 2048,
      detail: spec.pages.map((_p, i) => ({ slide: i + 1, textBoxesPlaced: 1 }))
    };
  });
  await buildEditableDeck({ store: h.store, projectId: 'p1' });
  assert.notEqual(seen.mode, 'editable');
  assert.ok(seen.pages[0].vision);
  assert.equal(seen.pages[0].manifest, undefined);
});

test('generationMode editable stamps manifest zones and skips vision', async (t) => {
  const h = harness(t, { pages: 2 });
  h.project.generationMode = 'editable';
  h.project.theme = 'washable-marker';
  for (const job of h.jobs) {
    job.textOverlays = [{ zone_id: 'title', text: 'Name Tracing' }];
  }
  let seen = null;
  t.mock.method(visionPages.visionBridge, 'composePptx', async (spec) => {
    seen = spec;
    fs.writeFileSync(spec.outputPath, Buffer.alloc(2048, 80));
    return {
      ok: true, outputPath: spec.outputPath, slides: spec.pages.length, bytes: 2048,
      detail: spec.pages.map((_p, i) => ({ slide: i + 1, textBoxesPlaced: 1 }))
    };
  });
  await buildEditableDeck({ store: h.store, projectId: 'p1' });
  assert.equal(seen.mode, 'editable');
  assert.equal(seen.pages.length, 2);
  assert.equal(seen.pages[0].vision, undefined);
  assert.equal(seen.pages[0].manifest.zones[0].zone_id, 'title');
  assert.deepEqual(seen.pages[0].manifest.zones[0].bbox_px, [180, 520, 2300, 1680]);
});

test('the editable file manager prefers the analysed deck over the flat one', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'editable-production.cjs'), 'utf8');
  const start = source.indexOf('  async exportPptx(project, options = {}) {');
  const body = source.slice(start, source.indexOf('\n  }', start));
  assert.match(body, /collectPageVision\(options\.store, project\)\.length/);
  assert.match(body, /buildEditableDeck\(/);
  // The analysed path must be tried before the legacy manifest copy.
  assert.ok(body.indexOf('buildEditableDeck') < body.indexOf('detectProductEngine'));
});
