'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isFolderFileInputMeta,
  isUnsafeCanvaUploadClick,
  scoreCanvaPdfFileInput,
  pickBestCanvaPdfFileInput,
  scoreCanvaImageFileInput,
  pickBestCanvaImageFileInput,
  scoreCanvaUploadFileInput,
  isRealCanvaPdfUploadInput,
  pickBestCanvaUploadFileInput,
  matchingCanvaImageName,
  summarizeCanvaPdfUploadText,
  isCanvaPdfTransferSuccess,
  shouldSkipCanvaPdfInject,
  matchingCanvaPdfName,
  pickCanvaPdfOpenClick,
  isSafeCanvaUploadPanelClose,
  canvaPdfImportTickMessage
} = require('../src/canva-pdf-inject.cjs');

test('folder file inputs and Upload folder clicks are rejected', () => {
  assert.equal(isFolderFileInputMeta({ webkitdirectory: true }), true);
  assert.equal(isFolderFileInputMeta({ accept: 'application/pdf', inDialog: true }), false);
  assert.equal(isUnsafeCanvaUploadClick('Upload files'), true);
  assert.equal(isUnsafeCanvaUploadClick('Upload folder'), true);
  assert.equal(isUnsafeCanvaUploadClick('Import file'), false);
  assert.equal(isUnsafeCanvaUploadClick(/^upload$/i), false);
});

test('hidden PDF inputs in the Upload dialog outrank folder pickers', () => {
  const folder = { accept: '', webkitdirectory: true, inDialog: true, hidden: true };
  const hiddenPdf = {
    accept: 'application/pdf,image/png',
    inDialog: true,
    hidden: true,
    fileCount: 0
  };
  assert.equal(scoreCanvaPdfFileInput(folder), -1);
  assert.ok(scoreCanvaPdfFileInput(hiddenPdf) > 20);
  const best = pickBestCanvaPdfFileInput([folder, hiddenPdf]);
  assert.equal(best.index, 1);
  assert.equal(best.meta.accept.includes('pdf'), true);
});

test('Uploaded to Uploads and imports in progress are transfer success, not a failed home wait', () => {
  const screenshot = summarizeCanvaPdfUploadText([
    'Drop items to upload',
    '1 of 6 items uploaded',
    'compressed-1788351443672.pdf',
    'This document is currently being imported. Please check your imports in progress.',
    'Uploaded to Uploads'
  ].join(' '));
  assert.equal(screenshot.transferSuccess, true);
  assert.equal(screenshot.importInProgress, true);
  assert.equal(screenshot.uploadFinished, true);
  assert.equal(screenshot.pickerWaiting, false);
  assert.equal(screenshot.uploadItems, 6);
  assert.equal(isCanvaPdfTransferSuccess(screenshot), true);
  assert.equal(shouldSkipCanvaPdfInject(screenshot, {
    files: ['/tmp/compressed-999.pdf']
  }), true);
  assert.equal(matchingCanvaPdfName(screenshot.fileName, ['compressed-111.pdf']), true);
  const emptyHome = summarizeCanvaPdfUploadText('Drop items to upload Create a design Import file');
  assert.equal(emptyHome.pickerWaiting, true);
  assert.equal(shouldSkipCanvaPdfInject(emptyHome, { files: ['book.pdf'] }), false);
  const leftoverHome = summarizeCanvaPdfUploadText([
    'Science-of-Reading-Sound-Wall-Phoneme-Spelling-Card-Bundle compressed.pdf',
    'This document is currently being imported. Please check your imports in progress.',
    'Uploads'
  ].join(' '));
  assert.equal(shouldSkipCanvaPdfInject(leftoverHome, { files: ['book.pdf'] }), false);
  assert.equal(matchingCanvaPdfName('compressed.pdf', ['book.pdf']), false);
  assert.equal(matchingCanvaPdfName('book.pdf', ['book.pdf']), true);
  const homepageDummy = { accept: '', hidden: true, inDialog: false };
  const dialogPdf = { accept: 'application/pdf', inDialog: true, hidden: true };
  assert.equal(isRealCanvaPdfUploadInput(homepageDummy), false);
  assert.equal(isRealCanvaPdfUploadInput(dialogPdf), true);
});

test('open-design clicks beat Upload files and Create a design', () => {
  const picked = pickCanvaPdfOpenClick([
    'Create a design',
    'Upload files',
    'Import file',
    'This document is currently being imported. Please check your imports in progress.',
    'Uploads',
    'Open as design'
  ]);
  assert.equal(picked.name, 'Open as design');
  assert.equal(pickCanvaPdfOpenClick(['Upload files', 'Create a design']), null);
  assert.equal(
    pickCanvaPdfOpenClick([
      'Science-of-Reading-Sound-Wall-Phoneme-Spelling-Card-Bundle compressed.pdf',
      'book.pdf',
      'Open as design'
    ], ['book.pdf']).name,
    'book.pdf'
  );
  assert.equal(
    pickCanvaPdfOpenClick(['Open Uploads folder Uploads', 'Uploads', 'book.pdf'], ['book.pdf'])?.name,
    'book.pdf'
  );
  assert.equal(isSafeCanvaUploadPanelClose('Close'), true);
  assert.equal(isSafeCanvaUploadPanelClose('Cancel'), false);
});

test('image file inputs beat PDF-only pickers when uploading a page PNG', () => {
  const folder = { accept: '', webkitdirectory: true };
  const pdfOnly = { accept: 'application/pdf,.pdf', inDialog: true, hidden: true };
  const image = { accept: 'image/png,image/jpeg,.png,.jpg', inDialog: true, hidden: true };
  assert.equal(scoreCanvaImageFileInput(folder), -1);
  assert.ok(scoreCanvaImageFileInput(image) > scoreCanvaImageFileInput(pdfOnly));
  assert.ok(scoreCanvaUploadFileInput(image, 'image') > scoreCanvaUploadFileInput(pdfOnly, 'image'));
  const best = pickBestCanvaUploadFileInput([folder, pdfOnly, image], 'image');
  assert.equal(best.index, 2);
  assert.equal(pickBestCanvaImageFileInput([pdfOnly, image]).index, 1);
  assert.equal(matchingCanvaImageName('page-001.png on canvas', ['page-001.png']), true);
  assert.equal(matchingCanvaImageName('compressed-1.pdf', ['page-001.png']), false);
});

test('import tick copy describes Uploads / import in progress instead of Edit this PDF', () => {
  const transferring = canvaPdfImportTickMessage(54, 0, true, 'https://www.canva.com/', {
    transferSuccess: true,
    importInProgress: true,
    uploadFinished: true
  }, '4m 15s');
  assert.match(transferring, /PDF in Uploads \/ import in progress — opening design/);
  assert.doesNotMatch(transferring, /Edit this PDF/);
  const idleHome = canvaPdfImportTickMessage(54, 0, false, 'https://www.canva.com/', {}, '4m 15s');
  assert.match(idleHome, /Still on Canva home/);
  assert.doesNotMatch(idleHome, /Looking for Edit this PDF/);
});
