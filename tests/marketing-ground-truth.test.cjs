'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8');

// Mockups, the preview video and the listing copy all describe the book a buyer
// receives. Left to infer from a title and a theme the model invents a grade level, a
// subject, page furniture that is not there - and the buyer gets something that does
// not match what they were shown. Every generator therefore reads the compiled .docx.

test('the ground-truth helper compiles the document and refuses to guess without it', () => {
  const start = main.indexOf('async function ensureMarketingGroundTruth(');
  assert.ok(start > -1, 'the helper should exist');
  const body = main.slice(start, main.indexOf('\n}\n', start));
  assert.match(body, /ensureSeoBookDocument\(projectId\)/);
  // An incomplete book cannot describe itself yet.
  assert.match(body, /MARKETING_SOURCE_INCOMPLETE/);
  // A document that did not compile must stop the run rather than let the model invent.
  assert.match(body, /MARKETING_SOURCE_MISSING/);
  assert.match(body, /!docPath \|\| !existsSync\(docPath\)/);
});

test('no marketing generator is fed the print PDF any more', () => {
  // Editable products never build a print PDF, so getPdf().productPath is null for them
  // and those generators were running with no document at all.
  assert.doesNotMatch(main, /pdfPath: getPdf\(project\)\.productPath/);
});

test('every marketing generator reads the compiled document', () => {
  const feeds = [
    ['generateTptListingWithGpt', 'listing copy'],
    ['generateTptThumbnailsWithGpt', 'mockups'],
    ['regenerateTptListingFieldWithGpt', 'single listing field'],
    ['generateTptPreviewVideoWithGemini', 'preview video']
  ];
  for (const [fn, label] of feeds) {
    let index = main.indexOf(fn);
    if (index === -1) continue; // the video generator is named by its own call site
    while (index !== -1) {
      // Each call site either awaits the helper inline or passes a variable resolved
      // from it a few lines earlier, so the window has to cover the enclosing block.
      const window = main.slice(Math.max(0, index - 2000), index + 400);
      assert.ok(
        /ensureMarketingGroundTruth\(projectId\)/.test(window),
        `${label} (${fn}) should be fed the compiled document`
      );
      index = main.indexOf(fn, index + 1);
    }
  }
});

test('the preview video waits on the same completeness gate', () => {
  const start = main.indexOf('async function generatePreviewVideoForProject(');
  assert.ok(start > -1);
  const body = main.slice(start, start + 4000);
  // Gemini's video model cannot read a .docx, so this one stage animates real interior
  // pages instead of uploading the document. It still has to wait for the document to
  // compile: that is what proves every page is finished, and an unfinished book has no
  // representative middle pages to show.
  assert.match(body, /await ensureMarketingGroundTruth\(projectId\);/);
  assert.doesNotMatch(body, /pdfPath:/);
});

test('both engines resolve to the same document type', () => {
  // ensureSeoBookDocument exports a .docx whatever the product format is, so a static
  // book and an editable book describe themselves from the same kind of source.
  const start = main.indexOf('async function ensureSeoBookDocument(');
  const body = main.slice(start, main.indexOf('\n}\n', start));
  assert.match(body, /fileManager\.exportDocx\(project\)/);
  assert.doesNotMatch(body, /productFormat/);
});
