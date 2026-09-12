'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'renderer/index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'renderer/renderer.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'renderer/styles.css'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src/main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'src/preload.cjs'), 'utf8');

test('the dashboard is told the real vision status instead of guessing', () => {
  // renderVisionStatus reads state.vision. Nothing ever set it, so the panel always
  // rendered "not installed" no matter what was on disk - which is what made the
  // engine look missing while it was working.
  assert.match(main, /vision = await visionBridge\.status\(\)/);
  assert.match(main, /return \{\n\s*vision,/);
  assert.match(renderer, /state\?\.vision\?\.ok && state\?\.vision\?\.ready/);
});

test('Interior Text runs the local pipeline and only falls back to the gem without it', () => {
  const start = main.indexOf("ipcMain.handle('project:generate-editable-text'");
  assert.ok(start > -1);
  const body = main.slice(start, start + 8000);
  assert.match(body, /const visionReady = await visionBridge\.status\(\)/);
  assert.match(body, /runPageVision\(/);
  assert.match(body, /buildEditablePages\(/);
  // The gem path requires a browser; it must sit behind the readiness check, not in
  // front of it, or pressing Run stalls waiting on Chrome.
  assert.ok(body.indexOf('runPageVision') < body.indexOf("requireGeminiForPlanning('page text')"));
  assert.ok(body.indexOf('visionReady') < body.indexOf("assertBrowserFree('writing page text')"));
});

test('Interior Text controls are not gated on the browser when the engine is local', () => {
  const start = renderer.indexOf("if (step === 'interior_text') {");
  const body = renderer.slice(start, start + 600);
  assert.match(body, /if \(visionReady\(\)\) return '';/);
  for (const action of ['write-page-text', 'generate-editable-text', 'rebuild-editable-text']) {
    const index = renderer.indexOf(`if (action === '${action}')`);
    assert.ok(index > -1, `${action} handler should exist`);
    assert.match(renderer.slice(index, index + 700), /visionReady\(\) \? '' : browserBusyReason\(\)/);
  }
});

test('progress names the phase it is in, not just a percentage', () => {
  assert.match(main, /Reading pages \(MobileSAM \+ PaddleOCR\)/);
  assert.match(main, /Erasing text and rebuilding pages/);
  // Reading owns the first half of the bar, rebuilding the second.
  assert.match(main, /percent: Math\.round\(percent \* 0\.5\)/);
  assert.match(main, /percent: 50 \+ Math\.round\(percent \* 0\.5\)/);
  // The stepper follows that same split.
  assert.match(renderer, /if \(phase === "read"\) return percent < 50 \? "active" : "done";/);
});

test('both sections are named for what they are, with a real stepper and metrics', () => {
  // Each stage is named once, in the tab that opens it and the header above it.
  // The panels used to repeat that name in an eyebrow and again in an h3, which
  // is three labels for one thing; the panel now carries status and one action.
  assert.match(html, /data-view-target="interior_text"[^>]*>Text Lab/);
  assert.match(html, /data-view-target="editable_ppt"[^>]*>Editable Lab/);
  assert.match(html, /data-workspace-section="interior_text"/);
  assert.match(html, /id="text-page-deck"/);
  assert.match(html, /data-workspace-section="editable_ppt"/);
  // The detail that was a paragraph is reachable as a tooltip rather than gone.
  assert.match(html, /class="stage-info"[^>]*title="[^"]{20,}"/);
  for (const phase of ['read', 'erase', 'build']) {
    assert.match(html, new RegExp(`data-phase="${phase}"`));
  }
  assert.match(css, /\.pipeline-step\[data-state="active"\]/);
  assert.match(css, /\.pipeline-step\[data-state="done"\]/);
  assert.match(css, /\.metric-cell/);
});

test('the two deliverables are both offered, with the editable one marked primary', () => {
  assert.match(html, /id="export-editable-pptx-button"/);
  assert.match(html, /id="export-editable-pdf-button"/);
  assert.match(html, /class="deliverable is-primary"/);
  assert.match(css, /\.deliverable\.is-primary/);
  // Both unlock from the same rebuilt pages.
  assert.match(renderer, /const canExport = sourcePages > 0 && !busy;/);
  for (const action of ['export-editable-pptx', 'export-editable-pdf']) {
    assert.match(renderer, new RegExp(`action === '${action}'`));
  }
});

test('the state carries what the panels display', () => {
  assert.match(main, /pagesBuilt: compiledPages\.length/);
  assert.match(main, /layers: vision\?\.counts\?\.layers \|\| 0/);
  assert.match(main, /textRuns: vision\?\.counts\?\.text \|\| 0/);
  assert.match(main, /orphans: vision\?\.counts\?\.orphans \|\| 0/);
  assert.match(main, /pdfs:\$\{compiled\}/);
});

test('docx export does not call an unbound sharp identifier', () => {
  const manager = fs.readFileSync(path.join(root, 'src/file-manager.cjs'), 'utf8');
  assert.match(manager, /function getSharp\(\)/);
  assert.doesNotMatch(manager, /kernel:\s*sharp\.kernel/);
  assert.match(manager, /getSharp\(\)\.kernel\.lanczos3/);
});

test('every element the dashboard drives exists in the markup', () => {
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  for (const id of [
    'vision-status', 'vision-dot', 'vision-engine-state', 'vision-engine-detail', 'vision-hint',
    'vision-phases', 'vision-metrics', 'vision-metric-pages', 'vision-metric-layers',
    'vision-metric-text', 'vision-metric-bound', 'vision-metric-orphan', 'vision-metric-built',
    'generate-editable-text-button', 'rebuild-editable-text-button', 'text-lab-eta',
    'ppt-stat-slides', 'ppt-stat-boxes', 'ppt-stat-state', 'ppt-stat-pages',
    'editable-build-dot', 'export-editable-pptx-button', 'export-editable-pdf-button',
    'deliverable-pptx-note', 'deliverable-pdf-note'
  ]) {
    assert.ok(ids.has(id), `${id} is missing from index.html`);
  }
});

test('the cover and the thank-you page ship flat, but still ship', () => {
  const { isFlatPage, flatPageVision } = require('../src/editable-vision-pages.cjs');
  const jobs = [1, 2, 3, 4, 5].map((n) => ({ id: `j${n}`, pageNumber: n }));
  const project = { jobs };
  // First and last by position when the project sets no kind.
  assert.equal(isFlatPage(project, jobs[0]), true);
  assert.equal(isFlatPage(project, jobs[4]), true);
  assert.equal(isFlatPage(project, jobs[2]), false);
  // Position always applies. The thank-you page is generated as a normal page image and
  // simply is the last one, so a book whose pages all carry kind "page" must still get
  // its cover and closing page right - an explicit kind can add flat pages, never
  // subtract the first or last.
  const allPlain = { jobs: [1, 2, 3].map((n) => ({ id: `k${n}`, pageNumber: n, kind: 'page' })) };
  assert.equal(isFlatPage(allPlain, allPlain.jobs[0]), true, 'first page is the cover');
  assert.equal(isFlatPage(allPlain, allPlain.jobs[1]), false);
  assert.equal(isFlatPage(allPlain, allPlain.jobs[2]), true, 'last page is the thank-you page');
  const kinded = { jobs: [{ id: 'a', pageNumber: 1, kind: 'page' }, { id: 'b', pageNumber: 2, kind: 'back_cover' }, { id: 'c', pageNumber: 3, kind: 'page' }] };
  assert.equal(isFlatPage(kinded, kinded.jobs[1]), true, 'an explicit flat kind still counts');

  // A flat page is recorded as read with no text. That is what makes every compiler
  // include it while editing nothing on it - no runs means nothing to erase and no
  // text boxes to place, with no special case anywhere downstream.
  const vision = flatPageVision('/abs/page.png');
  assert.equal(vision.ok, true);
  assert.equal(vision.flat, true);
  assert.deepEqual(vision.text, []);
  assert.equal(vision.counts.text, 0);
});

test('a flat page is shown as settled and offers no edit action', () => {
  assert.match(renderer, /flat \? 'flat'/);
  assert.match(renderer, /Ships as drawn/);
  // No read/re-read button on a page nobody should be editing.
  assert.match(renderer, /\$\{flat \? ''/);
});

test('Text Lab is an image dashboard driven by the watchdog heartbeat', () => {
  assert.match(html, /id="text-page-deck"[^>]*page-preview-grid|class="text-page-deck page-preview-grid"/);
  assert.match(html, /id="text-lab-eta"/);
  assert.match(renderer, /function updateLiveTextFill/);
  assert.match(renderer, /api\.onTextLabHeartbeat/);
  assert.match(renderer, /textLabActivity/);
  assert.match(preload, /onTextLabHeartbeat/);
  assert.match(main, /createTextLabObserver/);
  assert.match(main, /text-lab:heartbeat/);
  assert.match(main, /onActivity: textLabPageActivity\(observer\)/);
});

test('the stamped thank-you PDF is gone', () => {
  // It was a template stamped with a link and dropped in the project folder, and nothing
  // called it any more. The thank-you page is a generated page image that ships inside
  // the book itself.
  const manager = fs.readFileSync(path.join(root, 'src/file-manager.cjs'), 'utf8');
  assert.doesNotMatch(manager, /thankYou/i);
  assert.equal(fs.existsSync(path.join(root, 'assets/templates/thank-you-page.pdf')), false);
  // Old projects still load: the field is read, just never written again.
  const pdfState = fs.readFileSync(path.join(root, 'src/pdf-state.cjs'), 'utf8');
  assert.match(pdfState, /thankYouPdfPath/);
  assert.doesNotMatch(pdfState, /newPrintPdfJson\.thankYouPdfPath = /);
});

test('image fingerprints are cached and never materialise on the render path', () => {
  const source = fs.readFileSync(path.join(root, 'src/editable-vision-pages.cjs'), 'utf8');
  // Hashing every page on every state broadcast, with an iCloud fetch inside it, froze
  // the dashboard for minutes at a time.
  assert.match(source, /const fingerprintCache = new Map\(\)/);
  assert.match(source, /function artworkFingerprint\(imagePath, \{ materialize = false \} = \{\}\) \{/);
  assert.match(source, /if \(materialize\) ensureMaterialized\(imagePath\)/);
  assert.match(source, /if \(cached && cached\.size === size && cached\.mtimeMs === mtimeMs\) return cached\.hash/);
});
