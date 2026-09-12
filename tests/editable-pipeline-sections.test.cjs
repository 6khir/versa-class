'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8');

function stepBody(name) {
  const start = source.indexOf(`      ${name}: async (projectId, onProgress) => {`);
  assert.ok(start > -1, `${name} runner should be present`);
  const end = source.indexOf('\n      },', start);
  assert.ok(end > start, `${name} runner should be closed`);
  return source.slice(start, end);
}

// Each editable section owns exactly one job. They drifted before - vision lived in
// Interior Artwork and the book was assembled in Interior Text - so the split is
// pinned here rather than left to reading order.

test('Interior Artwork only draws: it generates artwork and reads nothing', () => {
  const body = stepBody('interior_artwork');
  assert.match(body, /restoreDefaultArtworkPrompts\(projectId\)/);
  assert.match(body, /runQueueToCompletion\(projectId, onProgress\)/);
  // Reading pages belongs to Interior Text, which is what consumes the coordinates.
  assert.doesNotMatch(body, /runPageVision/);
  assert.doesNotMatch(body, /buildEditablePages/);
  assert.doesNotMatch(body, /mergeEditableBook/);
});

test('Interior Artwork draws the same page the static Interior section draws', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8');
  // The editable pipeline no longer needs text-free artwork with empty frames: Interior
  // Text reads the words off the finished page, erases them and redraws them live. So
  // nothing may rewrite the prompt builder's prompt on the way to the queue.
  assert.doesNotMatch(source, /buildArtworkPrompt\(/);
  const start = source.indexOf('function restoreDefaultArtworkPrompts(');
  assert.ok(start > -1, 'the restore helper should exist');
  const body = source.slice(start, source.indexOf('\n}\n', start));
  // It only ever unwraps a prompt stored by the old behaviour.
  assert.match(body, /if \(!current\.startsWith\(ARTWORK_PROMPT\)\) continue;/);
  assert.match(body, /restored = artworkBrief\(job\)/);
  // Only imagePrompt is written. Clearing the queue's baseline here once left it
  // submitting prompts and then waiting on state it no longer had.
  assert.doesNotMatch(body, /updateJob\([^)]*conversationUrl|updateJob\([^)]*baselineJson/);
  assert.match(body, /store\.updateJob\(job\.id, \{ imagePrompt: restored \}\)/);
});

test('Interior Text reads the artwork and compiles the editable pages', () => {
  const body = stepBody('interior_text');
  assert.match(body, /runPageVision\(/);
  assert.match(body, /buildEditablePages\(/);
  // Assembling the book is the next section's job.
  assert.doesNotMatch(body, /mergeEditableBook/);
  // Replace is what "editable" means; overlay leaves the text invisible.
  assert.match(body, /'overlay' \? 'overlay' : 'replace'/);
});

test('Interior Text falls back to the gem only when the local pipeline is absent', () => {
  const body = stepBody('interior_text');
  assert.match(body, /PYTHON_ENV_MISSING/);
  assert.match(body, /generateEditablePageText\(/);
  // A real compile failure must surface, not be masked by a browser round trip.
  assert.match(body, /if \(!\[[^\]]*\]\.includes\(error\.code\)\) \{\s*throw error;/);
  // Cancelling is never a reason to start the fallback.
  assert.match(body, /if \(error\.code === 'CANCELLED'\) throw error;/);
});

test('Editable assembles all three deliverables from the pages Interior Text compiled', () => {
  const body = stepBody('editable_ppt');
  assert.match(body, /listEditablePages\(project\)/);
  assert.match(body, /assembleEditableDeliverables\(projectId, onProgress\)/);
  assert.doesNotMatch(body, /runPageVision/);
  assert.doesNotMatch(body, /buildEditablePages/);

  // The deck, the layered PDF and the Word document are one unit. Only the PDF used to
  // be built here, so the document existed nowhere until a marketing stage went looking
  // for it - and the finder handed over the .pptx instead, which is the
  // "received book-editable.pptx" failure.
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8');
  const assembler = source.slice(
    source.indexOf('async function assembleEditableDeliverables('),
    source.indexOf('\n}\n', source.indexOf('async function assembleEditableDeliverables('))
  );
  assert.match(assembler, /buildEditableDeck\(/);
  assert.match(assembler, /mergeEditableBook\(/);
  assert.match(assembler, /fileManager\.exportDocx\(/);

  // The manual button runs the same assembler, or the two paths drift apart again.
  const manual = source.slice(source.indexOf("ipcMain.handle('project:run-editable-generation'"));
  assert.match(manual.slice(0, 1200), /assembleEditableDeliverables\(projectId/);
});

test('the book document finder never substitutes the deck', () => {
  const fm = fs.readFileSync(path.join(__dirname, '..', 'src', 'file-manager.cjs'), 'utf8');
  const start = fm.indexOf('function findExistingBookDocument(');
  const body = fm.slice(start, fm.indexOf('\n}\n', start));
  // Falling back to .pptx hid the real problem - no document had been built at all -
  // and surfaced it much later as a confusing rejection in the marketing stage.
  assert.doesNotMatch(body, /pick\('\.pptx'\)/);
  assert.match(body, /return docx \? join\(outputDir, docx\) : null;/);
});

test('the editable pipeline still runs artwork, then text, then the book', () => {
  const { PIPELINE_STEPS } = require('../src/automation-manager.cjs');
  const editable = PIPELINE_STEPS.editable || require('../src/automation-manager.cjs').EDITABLE_PIPELINE;
  const order = Array.isArray(editable) ? editable : null;
  if (!order) return; // pipeline shape is asserted in pipeline-order.test.cjs
  const artwork = order.indexOf('interior_artwork');
  const text = order.indexOf('interior_text');
  const book = order.indexOf('editable_ppt');
  assert.ok(artwork > -1 && text > artwork, 'Interior Text must follow Interior Artwork');
  assert.ok(book > text, 'Editable PPTX must follow Interior Text');
});

test('the verifiers accept each section on its own evidence', () => {
  const verifiers = source.slice(source.indexOf('    stepVerifiers: {'), source.indexOf('    stepRunners: {'));
  assert.match(verifiers, /interior_text:[\s\S]{0,900}listEditablePages\(project\)\.length/);
  assert.match(verifiers, /editable_ppt:[\s\S]{0,900}existsSync\(editableBookPath\(project\)\)/);
});
