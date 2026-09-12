'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const controller = fs.readFileSync(path.join(__dirname, '..', 'src', 'browser-controller.cjs'), 'utf8');

// Bounded by the next method, not a character count: a fixed window silently spills
// into the following function, and then asserts against the wrong one.
function body(name) {
  const start = controller.indexOf(`async ${name}(`);
  assert.ok(start > -1, `${name} should exist`);
  const end = controller.indexOf('\n  async ', start + 1);
  return controller.slice(start, end === -1 ? controller.length : end);
}

// A 100-200 page pack is hundreds of megabytes of PNGs. Attaching those exceeds the
// context limit before the model reads any of them, so every marketing generator takes
// the compiled .docx instead - it carries the same ground truth in a few hundred KB.

test('mockups attach the compiled document and nothing else', () => {
  const source = body('generateTptThumbnailsWithGpt');
  assert.match(source, /const attachments = \[sourceDocument\];/);
  // The old code discarded the document outright with `void pdfPath` and attached PNGs.
  assert.doesNotMatch(source, /void pdfPath/);
  assert.doesNotMatch(source, /collectProductPageImagePaths|collectShowcaseImagePaths|stageThumbnailPageTargets|selectMockupAttachmentPaths/);
});

test('mockups refuse to run without a .docx rather than guessing from the title', () => {
  const source = body('generateTptThumbnailsWithGpt');
  assert.match(source, /MOCKUP_SOURCE_MISSING/);
  // A PDF is not a substitute: the image model cannot read one into mockup frames, and
  // silently accepting it would put us back to inventing the product.
  assert.match(source, /MOCKUP_SOURCE_NOT_DOCX/);
  assert.match(source, /\/\\\.docx\$\/i\.test\(sourceDocument\)/);
});

test('the preview attaches interior page frames and nothing else', () => {
  const source = body('generateTptPreviewVideoWithGpt');
  // Veo cannot read a .docx - given one it has nothing to animate and sits in analysis
  // until the step times out. The mockup gem is the opposite and reads the document, so
  // the two stages are fed differently on purpose.
  assert.match(source, /const attachments = \[\.\.\.frames\];/);
  assert.match(source, /selectPreviewFramePaths\(project\?\.jobs\)/);
  assert.match(source, /PREVIEW_FRAMES_MISSING/);
  // Bounded: the unbounded version attached every page, which a 200 page pack cannot fit.
  assert.doesNotMatch(source, /selectPreviewAttachmentPaths/);
  assert.doesNotMatch(source, /\.\.\.mockups/);
  // And the document is never smuggled back in alongside the frames.
  assert.doesNotMatch(source, /sourceDocument|pdfPath/);
});

test('the preview skips the cover and the thank-you page', () => {
  const fm = fs.readFileSync(path.join(__dirname, '..', 'src', 'file-manager.cjs'), 'utf8');
  const start = fm.indexOf('function selectPreviewFramePaths(');
  const source = fm.slice(start, fm.indexOf('\n}\n', start));
  // Both are stock pages rather than product content, and the cover already has four
  // mockups of its own. A preview built from them advertises the packaging.
  assert.match(source, /pages\.slice\(1, -1\)/);
  assert.match(fm, /const PREVIEW_PAGE_FRAME_MIN = 5;/);
  assert.match(fm, /const PREVIEW_PAGE_FRAME_MAX = 8;/);
});

test('the page-image collectors are not reachable from the browser controller', () => {
  // Keeping the imports around invites the next change to reach for them again.
  assert.doesNotMatch(controller, /collectProductPageImagePaths/);
  assert.doesNotMatch(controller, /selectPreviewAttachmentPaths/);
  assert.doesNotMatch(controller, /writeImagesDocx/);
});

// The preview goes out publicly on the storefront. An unbranded one is a free copy of
// the product's look, so the watermark is a hard requirement rather than a nicety.

test('the watermark is applied by the gem, not attached by us', () => {
  const source = body('generateTptPreviewVideoWithGpt');
  // Naming it in the prompt read as compositing media and was refused on video policy
  // grounds; uploading it put a second kind of image in front of a gem that treats every
  // upload as product. It lives in the gem's knowledge base and is applied from there.
  assert.doesNotMatch(source, /watermarkPath/);
  assert.doesNotMatch(source, /resolvePreviewWatermarkPath\(\)/);
});

test('the watermark ships with the app rather than living in a user folder', () => {
  const fm = fs.readFileSync(path.join(__dirname, '..', 'src', 'file-manager.cjs'), 'utf8');
  const start = fm.indexOf('function resolvePreviewWatermarkPath(');
  assert.ok(start > -1, 'the resolver should exist');
  const body = fm.slice(start, fm.indexOf('\n}\n', start));
  assert.match(body, /'assets', 'branding', 'preview-watermark\.png'/);
  // A Downloads path would not survive packaging.
  assert.doesNotMatch(body, /Downloads|homedir/);
  assert.ok(
    fs.existsSync(path.join(__dirname, '..', 'assets/branding/preview-watermark.png')),
    'the watermark asset must be committed'
  );
  // assets/** is already in the build files list, so it ships.
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('assets/**/*'));
});

test('the preview prompt asks for the watermark instead of forbidding it', () => {
  const { buildTptPreviewVideoPrompt } = require('../src/prompt-builder.cjs');
  const prompt = buildTptPreviewVideoPrompt({ title: 'X', attachmentCount: 6, hasWatermark: true });
  // The prompt no longer mentions the watermark at all. Instructing the model to place
  // one image onto a video was refused on policy grounds, and the gem is configured to
  // watermark what it is given - so the file is attached and nothing is said about it.
  // Never named in the prompt: the gem applies it from its own instructions, and asking
  // for it in the prompt was refused on video policy grounds.
  assert.doesNotMatch(prompt, /watermark/i);
  assert.match(prompt, /preview video for this tpt product/i);
  // The original prompt ended with "No watermark", which would have cancelled the ask.
  assert.doesNotMatch(prompt, /No watermark/);
  // The watermark is still a required attachment; that is asserted separately.
});

test('the export ships exactly six kinds of file, and never a page image', () => {
  const fm = fs.readFileSync(path.join(__dirname, '..', 'src', 'file-manager.cjs'), 'utf8');
  const start = fm.indexOf('function buildFinalExportManifest(');
  const source = fm.slice(start, fm.indexOf('\n}\n', start));
  const declared = [...source.matchAll(/artifact\('(\w+)'/g)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(declared)].sort(),
    ['docx', 'mockups', 'pdf', 'pptx', 'seo', 'video'],
    'the buyer receives the book in three formats plus the marketing assets - nothing else'
  );
  // Raw interior pages are the product's source material, not part of what is sold.
  assert.doesNotMatch(source, /collectProductPageImagePaths|pageImagePaths/);
});

test('"Show files" opens the folder the deliverables are written to', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer/renderer.js'), 'utf8');
  const start = renderer.indexOf("if (action === 'open-output-folder')");
  const source = renderer.slice(start, start + 600);
  assert.match(source, /api\.revealPath\(project\.outputDir\)/);
  // It used to reveal the legacy engine's book-editable.pptx, which lives elsewhere and
  // is not one of the exported deliverables.
  assert.doesNotMatch(source, /editableBuild\?\.pptxPath/);
});
