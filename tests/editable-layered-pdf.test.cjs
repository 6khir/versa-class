'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildEditablePages, mergeEditableBook, listEditablePages,
  editablePagePath, editableBookPath, SOURCE_DPI, DEFAULT_DPI
} = require('../src/editable-layered-pdf.cjs');
const visionPages = require('../src/editable-vision-pages.cjs');
const { artworkFingerprint, pageVisionKey } = visionPages;

function harness(t, { pages = 2, withVision = true } = {}) {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'versa-editable-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'jobs'), { recursive: true });

  const jobs = [];
  const settings = new Map();
  for (let index = 0; index < pages; index += 1) {
    const job = { id: `j${index + 1}`, pageNumber: index + 1, status: 'complete' };
    const imagePath = path.join(dir, 'jobs', `${job.id}.png`);
    fs.writeFileSync(imagePath, `page-${index + 1}-pixels`);
    jobs.push(job);
    if (withVision) {
      settings.set(pageVisionKey('p1', job.id), {
        fingerprint: artworkFingerprint(imagePath),
        vision: {
          ok: true, width: 2480, height: 3508,
          text: [{ id: 't1', text: 'Hello', box: [10, 10, 100, 40] }],
          layers: [], counts: { layers: 0, text: 1, orphans: 0 }
        }
      });
    }
  }
  const project = { id: 'p1', name: 'Book', slug: 'book', outputDir: dir, jobs };
  const store = {
    getProject: () => project,
    getSetting: (key, fallback = null) => (settings.has(key) ? settings.get(key) : fallback),
    setSetting: (key, value) => settings.set(key, value)
  };
  return { dir, store, project, jobs, settings };
}

/** Stand in for the Python worker, writing a placeholder file where it was asked to. */
function stubCompose(t, { onSpec = () => {} } = {}) {
  return t.mock.method(visionPages.visionBridge, 'composeLayeredPdf', async (spec) => {
    onSpec(spec);
    fs.mkdirSync(path.dirname(spec.outputPath), { recursive: true });
    fs.writeFileSync(spec.outputPath, '%PDF-1.7 stub');
    return {
      ok: true, outputPath: spec.outputPath, pages: 1, bytes: 13,
      detail: [{ page: 1, textPlaced: 4, textLeftBaked: 1, fontsMatched: ['TrebuchetMS-Bold'] }]
    };
  });
}

test('Interior Text compiles one editable PDF per page, labelled by page number', async (t) => {
  const h = harness(t);
  const specs = [];
  stubCompose(t, { onSpec: (spec) => specs.push(spec) });

  const built = await buildEditablePages({ store: h.store, projectId: 'p1' });

  assert.equal(specs.length, 2);
  // One page per document is what makes the stage resumable and the merge a concat.
  assert.ok(specs.every((spec) => spec.pages.length === 1));
  assert.deepEqual(specs.map((spec) => spec.pages[0].pageLabel), ['p1', 'p2']);
  assert.equal(specs[0].sourceDpi, SOURCE_DPI);
  assert.equal(specs[0].dpi, DEFAULT_DPI);
  assert.equal(built.pages, 2);
  assert.equal(built.compiled, 2);
  assert.equal(built.editableText, 8);
  assert.equal(built.bakedText, 2);
  assert.deepEqual(built.fonts, ['TrebuchetMS-Bold']);
  assert.ok(fs.existsSync(editablePagePath(h.project, 1)));
});

test('replace and font matching are the defaults, because that is what editable means', async (t) => {
  const h = harness(t);
  let seen = null;
  stubCompose(t, { onSpec: (spec) => { seen = spec; } });
  await buildEditablePages({ store: h.store, projectId: 'p1' });
  assert.equal(seen.textMode, 'replace');
  assert.equal(seen.matchFonts, true);

  await buildEditablePages({ store: h.store, projectId: 'p1', textMode: 'overlay', force: true });
  assert.equal(seen.textMode, 'overlay');
});

test('an already compiled page is reused unless the caller forces a rebuild', async (t) => {
  const h = harness(t);
  let calls = 0;
  stubCompose(t, { onSpec: () => { calls += 1; } });

  await buildEditablePages({ store: h.store, projectId: 'p1' });
  assert.equal(calls, 2);
  const second = await buildEditablePages({ store: h.store, projectId: 'p1' });
  assert.equal(calls, 2, 'compiled pages should not be rebuilt');
  assert.equal(second.reused, 2);
  await buildEditablePages({ store: h.store, projectId: 'p1', force: true });
  assert.equal(calls, 4);
});

test('one failed page does not lose the rest of the book', async (t) => {
  const h = harness(t, { pages: 3 });
  t.mock.method(visionPages.visionBridge, 'composeLayeredPdf', async (spec) => {
    if (spec.pages[0].pageLabel === 'p2') return { ok: false, code: 'IMAGE_MISSING', error: 'gone' };
    fs.mkdirSync(path.dirname(spec.outputPath), { recursive: true });
    fs.writeFileSync(spec.outputPath, '%PDF-1.7 stub');
    return { ok: true, outputPath: spec.outputPath, pages: 1, bytes: 13, detail: [{ textPlaced: 1, textLeftBaked: 0 }] };
  });

  const built = await buildEditablePages({ store: h.store, projectId: 'p1' });
  assert.equal(built.pages, 2);
  assert.equal(built.failures.length, 1);
  assert.equal(built.failures[0].pageNumber, 2);
  assert.equal(built.failures[0].code, 'IMAGE_MISSING');
});

test('a book nobody has read yet is refused by name', async (t) => {
  const h = harness(t, { withVision: false });
  t.mock.method(visionPages.visionBridge, 'composeLayeredPdf', async () => {
    throw new Error('the worker should not be reached');
  });
  await assert.rejects(
    () => buildEditablePages({ store: h.store, projectId: 'p1' }),
    (error) => error.code === 'EDITABLE_VISION_MISSING'
  );
});

test('Editable PPTX merges the compiled pages in page order', async (t) => {
  const h = harness(t, { pages: 3 });
  stubCompose(t);
  await buildEditablePages({ store: h.store, projectId: 'p1' });

  let merged = null;
  t.mock.method(visionPages.visionBridge, 'mergeLayeredPdfs', async (spec) => {
    merged = spec;
    fs.writeFileSync(spec.outputPath, '%PDF-1.7 book');
    return { ok: true, outputPath: spec.outputPath, pages: spec.inputs.length, layers: 6, bytes: 4096 };
  });

  const book = await mergeEditableBook({ store: h.store, projectId: 'p1' });
  assert.deepEqual(merged.inputs.map((p) => path.basename(p)), ['page_001.pdf', 'page_002.pdf', 'page_003.pdf']);
  assert.equal(merged.outputPath, editableBookPath(h.project));
  assert.equal(book.pages, 3);
});

test('page files sort numerically, so page 10 does not land before page 2', (t) => {
  const h = harness(t, { pages: 0, withVision: false });
  const dir = path.join(h.dir, 'editable');
  fs.mkdirSync(dir, { recursive: true });
  for (const n of [1, 2, 10, 11, 3]) {
    fs.writeFileSync(editablePagePath(h.project, n), 'x');
  }
  assert.deepEqual(
    listEditablePages(h.project).map((p) => path.basename(p)),
    ['page_001.pdf', 'page_002.pdf', 'page_003.pdf', 'page_010.pdf', 'page_011.pdf']
  );
});

test('Editable PPTX refuses to assemble a book with no editable pages', async (t) => {
  const h = harness(t);
  t.mock.method(visionPages.visionBridge, 'mergeLayeredPdfs', async () => {
    throw new Error('the worker should not be reached');
  });
  await assert.rejects(
    () => mergeEditableBook({ store: h.store, projectId: 'p1' }),
    (error) => error.code === 'EDITABLE_PAGES_MISSING'
  );
});

test('a worker failure surfaces its own code rather than a generic throw', async (t) => {
  const h = harness(t);
  t.mock.method(visionPages.visionBridge, 'composeLayeredPdf', async () => ({
    ok: false, code: 'PIKEPDF_MISSING', error: 'No module named pikepdf'
  }));
  await assert.rejects(
    () => buildEditablePages({ store: h.store, projectId: 'p1' }),
    (error) => error.code === 'PIKEPDF_MISSING'
  );
});
