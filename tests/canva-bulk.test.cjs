'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { PIPELINE_STEPS, STEP_TIMEOUTS } = require('../src/automation-manager.cjs');
const { AUTH_COOKIE_HOST_SQL } = require('../src/browser-controller.cjs');
const {
  buildTptListingPrompt
} = require('../src/prompt-builder.cjs');
const {
  buildBulkCreateCsv,
  canvaTemplateLinkFromShare,
  isCanvaLoginUrl,
  isCanvaPageUrl,
  isCanvaTemplateLink,
  normalizeCanvaTemplate,
  resolveCanvaTemplate
} = require('../src/canva-bulk.cjs');

test('editable sits between interior and listing in the pipeline', () => {
  assert.deepEqual(PIPELINE_STEPS, [
    'overview',
    'characters',
    'interior',
    'editable',
    'listing',
    'thumbnails',
    'preview',
    'export'
  ]);
  assert.ok(STEP_TIMEOUTS.editable.hardCapMs >= 45 * 60_000);
});

test('Canva cookies survive the session import filter', () => {
  assert.match(AUTH_COOKIE_HOST_SQL, /canva\.com/);
});

test('listing prompt mentions the Canva template for editable products', () => {
  const prompt = buildTptListingPrompt({
    name: 'Flipbook',
    productFormat: 'editable',
    canvaTemplateLink: 'https://www.canva.com/design/XYZ/view'
  });
  assert.match(prompt, /editable Canva template/i);
  assert.match(prompt, /canva\.com\/design\/XYZ/);
});

test('buildBulkCreateCsv writes one row per page image', () => {
  const csv = buildBulkCreateCsv([
    '/books/001_page.png',
    '/books/page,two.png'
  ]);
  assert.match(csv, /^Page,Image,File\n/);
  assert.match(csv, /1,001_page\.png,001_page\.png/);
  assert.match(csv, /2,"page,two\.png","page,two\.png"/);
});

test('resolveCanvaTemplate picks the tightest matching format and page cap', () => {
  const templates = [
    {
      id: 'letter-10',
      label: 'Letter 10',
      format: 'LETTER',
      orientation: 'portrait',
      maxPages: 10,
      canvaDesignUrl: 'https://www.canva.com/design/AAA/edit'
    },
    {
      id: 'letter-40',
      label: 'Letter 40',
      format: 'letter',
      orientation: 'portrait',
      maxPages: 40,
      canvaDesignUrl: 'https://www.canva.com/design/BBB/edit'
    },
    {
      id: 'a4',
      label: 'A4',
      format: 'A4',
      orientation: 'portrait',
      maxPages: 40,
      canvaDesignUrl: 'https://www.canva.com/design/CCC/edit'
    }
  ];
  const match = resolveCanvaTemplate(templates, {
    format: 'LETTER',
    orientation: 'portrait',
    stats: { total: 24 }
  });
  assert.equal(match.id, 'letter-40');
  assert.equal(resolveCanvaTemplate([], { format: 'LETTER' }), null);
});

test('normalizeCanvaTemplate fills defaults and keeps Canva design URLs', () => {
  const template = normalizeCanvaTemplate({
    format: 'us letter',
    orientation: 'Landscape',
    canvaDesignUrl: 'https://www.canva.com/design/XYZ/edit'
  });
  assert.equal(template.format, 'LETTER');
  assert.equal(template.orientation, 'landscape');
  assert.equal(template.maxPages, 20);
  assert.equal(isCanvaPageUrl(template.canvaDesignUrl), true);
  assert.equal(isCanvaLoginUrl('https://www.canva.com/login/'), true);
  assert.equal(
    canvaTemplateLinkFromShare('Copy this https://www.canva.com/design/XYZ/view?template=1 thanks'),
    'https://www.canva.com/design/XYZ/view?template=1'
  );
});

test('Canva editor URLs convert to a buyer template link', () => {
  const {
    CANVA_BLANK_DESIGN_URL,
    canvaDesignId,
    isCanvaDesignUrl,
    sameCanvaDesign,
    toCanvaDesignUrl,
    toCanvaTemplateLink,
    isCanvaTemplateLink
  } = require('../src/canva-bulk.cjs');
  assert.equal(
    toCanvaTemplateLink('https://www.canva.com/design/DAG123abc/edit?ui=eyA'),
    'https://www.canva.com/design/DAG123abc/view?template=1'
  );
  assert.equal(
    toCanvaTemplateLink('https://www.canva.com/design/DAHT3DYlrV0/YXrSF2-QoPjMCEQrWKR66w/edit'),
    'https://www.canva.com/design/DAHT3DYlrV0/YXrSF2-QoPjMCEQrWKR66w/view?template=1'
  );
  assert.equal(
    canvaDesignId('https://www.canva.com/design/editor/shell?designId=DAHTlnjuPFM&mode=edit'),
    'DAHTlnjuPFM'
  );
  assert.equal(canvaDesignId('https://www.canva.com/'), '');
  assert.equal(isCanvaDesignUrl(CANVA_BLANK_DESIGN_URL), false);
  assert.equal(isCanvaDesignUrl('https://www.canva.com/design/editor/shell'), false);
  assert.equal(
    toCanvaDesignUrl('https://www.canva.com/design/DAG123abc/view?template=1'),
    'https://www.canva.com/design/DAG123abc/edit'
  );
  assert.equal(sameCanvaDesign(
    'https://www.canva.com/design/DAG123abc/edit',
    'https://www.canva.com/design/DAG123abc/view?template=1'
  ), true);
  assert.equal(isCanvaTemplateLink('https://www.canva.com/design/DAG123abc/edit'), false);
  assert.equal(isCanvaTemplateLink('https://www.canva.com/design/DAG123abc/view'), false);
  assert.equal(isCanvaTemplateLink('https://www.canva.com/design/DAG123abc/view?template=1'), true);
  assert.equal(isCanvaTemplateLink('https://canva.link/m7dhp067jlgrde1'), true);
  assert.equal(toCanvaTemplateLink('https://canva.link/m7dhp067jlgrde1?utm=1'), 'https://canva.link/m7dhp067jlgrde1');
});

test('Canva print size matches the book page', () => {
  const { canvaCreateDesignUrl, canvaPageDimensions } = require('../src/canva-bulk.cjs');
  assert.equal(
    canvaCreateDesignUrl('A4', 'portrait'),
    'https://www.canva.com/design?create&width=210&height=297&units=mm'
  );
  assert.equal(
    canvaCreateDesignUrl('LETTER', 'portrait'),
    'https://www.canva.com/design?create&width=8.5&height=11&units=in'
  );
  assert.equal(canvaPageDimensions('A4', 'landscape').width, 297);
  assert.match(canvaPageDimensions('A4', 'portrait').label, /A4 portrait/);
});

test('Canva live path is one PDF import plus verified Magic Layers', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/browser-controller.cjs'), 'utf8');
  const inject = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/canva-pdf-inject.cjs'), 'utf8');
  const main = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/main.cjs'), 'utf8');
  const copy = `${source}\n${inject}`;
  assert.match(source, /#canvaImportPdfAsDesign/);
  assert.match(source, /#canvaWaitForPdfImport/);
  assert.match(source, /#canvaImportIndicatorVisible/);
  assert.match(source, /#canvaWaitUntilPdfUploaded/);
  assert.match(source, /#canvaReadPdfUploadState/);
  assert.match(copy, /Waiting until 100%/);
  assert.match(source, /already uploading the print PDF/);
  assert.match(source, /CANVA_HOME_IMPORT_FAIL_MS/);
  assert.match(source, /elapsed >= CANVA_HOME_IMPORT_FAIL_MS/);
  assert.match(source, /CANVA_PDF_IMPORT_STUCK/);
  assert.match(source, /CANVA_PDF_UPLOAD_NOT_STARTED/);
  assert.doesNotMatch(source, /#canvaImportPdfAsDesign[\s\S]{0,8000}compressPdf/);
  assert.match(source, /Using the prepared print PDF/);
  assert.match(source, /canvaDashboardPatch\('upload'/);
  assert.match(source, /this\.canvaPdfAttachedOnce = false/);
  assert.match(main, /canvaLiveDashboard/);
  assert.match(main, /mergeCanvaDashboard/);
  assert.match(main, /prevMsg\.message !== message/);
  assert.doesNotMatch(source, /for \(const pattern of clickPatterns\)/);
  assert.doesNotMatch(source, /async #canvaWaitForPdfImport[\s\S]{0,3500}elapsed >= 45_000 && !importing/);
  assert.match(source, /async #canvaWaitForPdfImport[\s\S]{0,3500}while \(Date\.now\(\) - startedAt < timeoutMs\)/);
  assert.match(source, /async #canvaWaitWhileMagicLayersRuns[\s\S]{0,1800}while \(Date\.now\(\) - startedAt < timeoutMs\)/);
  assert.match(source, /create a design/i);
  assert.match(source, /import file/i);
  assert.match(source, /#canvaNudgePdfConvert/);
  assert.match(source, /#canvaOpenImportedPdfDesign/);
  assert.match(source, /#canvaClosePdfUploadPanel/);
  assert.match(source, /#canvaRecoverPdfImport/);
  assert.match(copy, /PDF in Uploads \/ import in progress/);
  assert.match(source, /Opening from Uploads automatically/);
  assert.doesNotMatch(source, /#canvaHelpWithPdfUpload/);
  assert.doesNotMatch(source, /CANVA_OPEN_DESIGN_HITL_MS/);
  assert.doesNotMatch(copy, /Looking for Edit this PDF/);
  assert.doesNotMatch(source, /#canvaImportPdfAsDesign[\s\S]{0,900}\/\^create\$\/i/);
  assert.match(source, /Canva page count is \$\{got\} but this book has \$\{want\} pages/);
  assert.match(source, /#canvaSelectEditorPage/);
  assert.match(source, /aria-label="Page \$\{pageNumber\}"/);
  assert.match(source, /#canvaVerifyPageSelected/);
  assert.match(source, /#canvaDismissPrintReview/);
  assert.match(source, /review your design/i);
  assert.match(source, /#canvaImageToolbarVisible/);
  assert.match(source, /visible-intersection/);
  assert.match(source, /#canvaCanvasClickPoint/);
  assert.match(source, /#canvaClickToolbarEdit/);
  assert.match(source, /#canvaProbeEditImagePanel/);
  assert.match(source, /skip Edit click, panel already open/);
  assert.match(source, /#canvaClickMagicLayersTool/);
  assert.match(source, /edit image/i);
  assert.match(source, /bg remover/i);
  assert.match(source, /#canvaOpenMagicLayersInEditor/);
  assert.match(source, /#canvaPageLooksLayered/);
  assert.match(source, /ungroupBtn \|\| probe.ungroup \|\| probe.toast/);
  assert.doesNotMatch(source, /ungroupBtn \|\| groupBtn \|\| probe.ungroup \|\| probe.group/);
  assert.match(source, /canvaMagicClickedPages/);
  assert.match(source, /secondClickSkipped/);
  assert.doesNotMatch(source, /async #canvaOpenMagicLayersInEditor[\s\S]{0,500}keyboard\.press\('Escape'\)/);
  assert.doesNotMatch(source, /Auto-adjust 2 things/);
  assert.match(source, /create layers/i);
  assert.match(source, /#canvaClickCreateLayers[\s\S]{0,200}2_000/);
  assert.match(source, /CANVA_MAGIC_LAYERS_NOT_STARTED/);
  assert.match(source, /#canvaReadPageLayerCount/);
  assert.match(source, /count <= 1/);
  assert.match(source, /attempt \$\{attempt\} of 3/);
  assert.match(source, /was not separated after 3 attempts/);
  assert.match(source, /#canvaAuditAllPages/);
  assert.match(source, /Checking layer count on every page/);
  assert.match(source, /#canvaReadTemplateLinkFromSharePanel/);
  assert.match(source, /#canvaDownloadPdf/);
  assert.match(source, /waitForEvent\('download', \{ timeout: 20_000 \}\)/);
  assert.doesNotMatch(source, /waitForEvent\('download', \{ timeout: 180_000 \}\)/);
  assert.match(source, /see all/i);
  assert.match(source, /isCanvaTemplateLink/);
  assert.match(source, /Share panel only showed the editor URL/);
  assert.doesNotMatch(source, /navigator\.clipboard\.readText/);
  assert.doesNotMatch(source, /#canvaCopyTemplateLink/);
  assert.doesNotMatch(source, /buildBulkCreateCsv/);
  assert.doesNotMatch(source, /bulk create/i);
  assert.doesNotMatch(source, /#canvaRunBulkCreateApp/);
  assert.doesNotMatch(source, /#canvaLayerPageViaHome/);
  assert.doesNotMatch(source, /#canvaLayerViaHomeAndPaste/);
  assert.doesNotMatch(source, /#canvaUploadPageImage/);
  assert.doesNotMatch(source, /#canvaStartMagicLayers/);
  assert.doesNotMatch(source, /Opening Magic Layer for \$\{pageSize\.label\}/);
  assert.doesNotMatch(source, /set as background/i);
  assert.match(source, /resumeDesignUrl/);
  assert.match(source, /resumeFromIndex/);
  assert.match(source, /layeredPageNumbers/);
  assert.match(source, /Continuing the Canva design already in progress/);
  assert.match(source, /if \(!resumed\) \{/);
  assert.match(source, /#setAnyPageFileInput/);
  assert.match(source, /#canvaDropLocalFiles/);
  assert.match(source, /Page\.setInterceptFileChooserDialog/);
  assert.match(source, /#canvaTakeImportTarget/);
  assert.match(source, /#canvaUploadTook/);
  assert.match(source, /waitForEvent\('page', \{ timeout: 8_000 \}\)/);
  assert.doesNotMatch(source, /waitForEvent\('page', \{ timeout: 180_000 \}\)/);
  assert.match(source, /PDF selected once/);
  assert.match(source, /canvaPdfImportTimeoutMs/);
  assert.match(copy, /Waiting for every page before Magic Layer/);
  assert.match(copy, /not treating this as finished/);
  assert.match(source, /CANVA_WRONG_DESIGN/);
  assert.match(source, /abandonDesignUrl/);
  assert.match(source, /inferCanvaEditorPageCount/);
  assert.match(source, /looksLikeLeftoverCanvaCount/);
  assert.match(source, /canvaImportKnownDesignIds/);
  assert.doesNotMatch(source, /else if \(editorPages > 0\) \{\s*this\.#canvaThrowIfPageCountMismatch/);
  assert.match(source, /Sending print PDF from VERSA/);
  assert.match(source, /#canvaRevealPdfDropzone/);
  assert.match(source, /#canvaInjectLocalPdf/);
  assert.match(source, /#waitForFileChooserOrAbort\(page, 12_000\)/);
  assert.doesNotMatch(source, /#canvaInjectLocalPdf[\s\S]{0,2200}#sleepOrPause\(50\)/);
  assert.doesNotMatch(source, /async #pickLocalFilesInPage[\s\S]{0,3200}#canvaClickUploadControls/);
  assert.doesNotMatch(source, /input\[type="file"\]:visible/);
  assert.doesNotMatch(source, /waiting for folder picker/i);
  assert.match(source, /attachLiveBrowser/);
  assert.match(source, /beginWork\(\)/);
  assert.doesNotMatch(source, /beginWork\(\) \{\s*this\.abortRequested = false;\s*this\.canvaPdfAttachedOnce = false/);
  assert.match(source, /pauseForHuman/);
  assert.match(source, /Copied the template link|click-copy|\/\^copy\$\/i/);
  assert.match(source, /normalizeCanvaProgressArgs/);
  assert.match(source, /decideHumanLoopExit/);
  assert.match(source, /#revealCanvaBrowser/);
  assert.match(source, /this\.canvaWatch = true/);
  assert.match(source, /#lockCanvaBrowserBackground/);
  assert.match(source, /Canva is connected in the background/);
  assert.doesNotMatch(source, /Opening Canva on screen so you can watch every click/);
  assert.match(copy, /Still on Canva home/);
  assert.match(source, /formatCanvaClock/);
  assert.match(source, /started: true/);
  assert.match(source, /CANVA_PDF_IMPORT_STUCK/);
  assert.doesNotMatch(source, /canvaPages: importedPages/);
  assert.match(source, /Applying Magic Layer to page/);
  assert.match(source, /Creating the public template link/);
  assert.match(source, /Saving the public template link/);
  assert.match(main, /prepareCanvaImportPdf/);
  assert.match(main, /rememberCanvaImportPdf/);
  assert.match(main, /restoreCanvaImportPdfIfMissing/);
  assert.doesNotMatch(main, /prepareCanvaUploadImages/);
  assert.doesNotMatch(main, /resolveCanvaTemplate/);
  assert.doesNotMatch(main, /info\.templateLink \? \{ canvaTemplateLink/);
  assert.match(main, /pdfPath: importPdf/);
  assert.doesNotMatch(main, /inputMode === 'images'/);
  assert.doesNotMatch(main, /pageImages:/);
  assert.doesNotMatch(source, /#canvaAddPageImage/);
  assert.doesNotMatch(source, /#canvaAddEditorPage/);
  assert.doesNotMatch(source, /#canvaOpenSizedBlankDesign/);
  assert.doesNotMatch(source, /resolveCanvaBulkInputMode/);
  assert.match(source, /#canvaImportPdfAsDesign/);
  assert.match(source, /getByRole\('tab', \{ name: \/\^upload\$\/i \}\)/);
  assert.match(main, /expectedPages/);
  assert.match(main, /layeredPageNumbers/);
  assert.match(main, /canvaPageProgress/);
  assert.match(main, /activeCanvaPage/);
  assert.match(main, /resumeFromIndex/);
  assert.match(main, /toCanvaDesignUrl\(project\.canvaDesignUrl\)/);
  assert.doesNotMatch(main, /project\.canvaDesignUrl \|\| project\.canvaTemplateLink/);
  assert.match(main, /isCanvaTemplateLink\(result\.templateLink\)/);
  assert.match(main, /collectProductPageImagePaths/);
  assert.match(main, /pauseAllWork/);
  assert.match(main, /canvaDesignUrl/);
  assert.match(main, /ensureProductPdf/);
  assert.match(main, /QUEUE_PAUSED/);
});

test('Canva editor page count prefers of-N over four visible thumbs', () => {
  const { inferCanvaEditorPageCount, looksLikeLeftoverCanvaCount } = require('../src/canva-bulk.cjs');
  assert.equal(inferCanvaEditorPageCount({
    texts: ['Page 1 of 54', 'Page 1', 'Page 2', 'Page 3', 'Page 4'],
    indexes: [0, 1, 2, 3]
  }, 54), 54);
  assert.equal(inferCanvaEditorPageCount({
    texts: ['Page 1 of 4', 'Page 1', 'Page 2', 'Page 3', 'Page 4'],
    indexes: [0, 1, 2, 3]
  }, 54), 4);
  assert.equal(inferCanvaEditorPageCount({
    texts: ['Page 1', 'Page 2', 'Page 3', 'Page 4', 'A 54 pages coloring book'],
    indexes: [0, 1, 2, 3]
  }, 54), 4);
  assert.equal(looksLikeLeftoverCanvaCount(4, 54), true);
  assert.equal(looksLikeLeftoverCanvaCount(40, 54), false);
  assert.equal(looksLikeLeftoverCanvaCount(3, 3), false);
  assert.equal(looksLikeLeftoverCanvaCount(214, 1), true);
  assert.equal(looksLikeLeftoverCanvaCount(214, 214), false);
});

test('local uploads keep only real files on disk', () => {
  const { localUploadFiles } = require('../src/browser-controller.cjs');
  const { resolve } = require('node:path');
  const existing = __filename;
  assert.deepEqual(localUploadFiles([existing, '/no/such/canva-page.png']), [resolve(existing)]);
  assert.deepEqual(localUploadFiles(existing), [resolve(existing)]);
});

test('Canva import PDF is normalized from the print PDF, not JPEG page uploads', () => {
  const fileManager = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/file-manager.cjs'), 'utf8');
  assert.match(fileManager, /function prepareCanvaImportPdf/);
  assert.match(fileManager, /canva-import/);
  assert.match(fileManager, /CANVA_PDF_PAGE_COUNT_MISMATCH/);
  assert.match(fileManager, /PRINT_PDF_JPEG/);
  assert.match(fileManager, /quality: 90/);
  assert.match(fileManager, /chromaSubsampling: '4:4:4'/);
  assert.match(fileManager, /function encodePrintPdfJpeg/);
  assert.doesNotMatch(fileManager, /toJPEG\(98\)/);
});

test('editable Canva path is print PDF import, then Magic Layer page by page', () => {
  const main = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/main.cjs'), 'utf8');
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/browser-controller.cjs'), 'utf8');
  const fn = main.slice(main.indexOf('async function runCanvaEditableForProject'), main.indexOf('\nasync function openStudioById'));
  assert.match(fn, /productFormat !== 'editable'/);
  assert.match(fn, /CANVA_PAGES_MISSING/);
  assert.match(fn, /ensureProductPdf/);
  assert.match(fn, /prepareCanvaImportPdf/);
  assert.doesNotMatch(fn, /inputMode/);
  assert.doesNotMatch(fn, /pageImages/);
  assert.doesNotMatch(fn, /outputPath:\s*null/);
  assert.doesNotMatch(fn, /request-regeneration|enqueue/);
  assert.doesNotMatch(source, /resolveCanvaBulkInputMode/);
  assert.match(source, /#canvaImportPdfAsDesign/);
  assert.match(source, /Applying Magic Layer to page/);
  const verifier = main.match(/interior: \(projectId\) => \{[\s\S]*?\n      \},/);
  assert.ok(verifier, 'interior verifier missing');
  const editableGate = verifier[0].match(/if \(project\.productFormat === 'editable'\) \{[\s\S]*?CANVA_PAGES_MISSING[\s\S]*?\}/);
  assert.ok(editableGate, 'editable interior verifier branch missing');
  assert.match(editableGate[0], /collectProductPageImagePaths/);
  assert.match(editableGate[0], /CANVA_PAGES_MISSING/);
  assert.match(verifier[0], /PRINT_PDF_MISSING/);
  assert.match(main, /await finishPrintPdf\(\)/);
  assert.doesNotMatch(main, /if \(project\.productFormat !== 'editable'\) await finishPrintPdf/);
});

test('Playwright CDP attach treats Canary as a local browser for large uploads', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/browser-controller.cjs'), 'utf8');
  assert.match(source, /connectOverCDP\([\s\S]{0,180}isLocal:\s*true/);
});
