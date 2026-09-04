'use strict';

function isFolderFileInputMeta(meta = {}) {
  if (meta.webkitdirectory || meta.directory || meta.allowdirs) return true;
  const blob = `${meta.name || ''} ${meta.id || ''} ${meta.className || ''} ${meta.accept || ''}`;
  return /folder|directory|webkitdirectory/i.test(blob);
}

function isUnsafeCanvaUploadClick(name) {
  return /upload files|upload folder|choose files from (your )?(computer|device)|browse files|drop items to upload/i.test(String(name || ''));
}

function scoreCanvaPdfFileInput(meta = {}) {
  if (!meta || isFolderFileInputMeta(meta)) return -1;
  let score = 1;
  const accept = String(meta.accept || '');
  if (/pdf/i.test(accept)) score += 50;
  else if (!accept) score += 10;
  if (meta.inDialog) score += 20;
  if (Number(meta.fileCount) > 0) score += 15;
  if (meta.hidden) score += 4;
  return score;
}

function scoreCanvaImageFileInput(meta = {}) {
  if (!meta || isFolderFileInputMeta(meta)) return -1;
  let score = 1;
  const accept = String(meta.accept || '');
  if (/image\/(png|jpe?g)|(?:^|,|\s)(?:\.png|\.jpe?g)(?:\s|,|$)/i.test(accept)) score += 50;
  else if (/image\//i.test(accept)) score += 30;
  else if (!accept) score += 10;
  else if (/pdf/i.test(accept)) score += 2;
  if (meta.inDialog) score += 20;
  if (Number(meta.fileCount) > 0) score += 15;
  if (meta.hidden) score += 4;
  return score;
}

function pickBestCanvaPdfFileInput(metas = []) {
  const ranked = (Array.isArray(metas) ? metas : [])
    .map((meta, index) => ({ meta, index, score: scoreCanvaPdfFileInput(meta) }))
    .filter((row) => row.score >= 0)
    .sort((left, right) => right.score - left.score || left.index - right.index);
  return ranked[0] || null;
}

function pickBestCanvaImageFileInput(metas = []) {
  const ranked = (Array.isArray(metas) ? metas : [])
    .map((meta, index) => ({ meta, index, score: scoreCanvaImageFileInput(meta) }))
    .filter((row) => row.score >= 0)
    .sort((left, right) => right.score - left.score || left.index - right.index);
  return ranked[0] || null;
}

function scoreCanvaUploadFileInput(meta = {}, kind = 'pdf') {
  return kind === 'image' ? scoreCanvaImageFileInput(meta) : scoreCanvaPdfFileInput(meta);
}

const REAL_CANVA_PDF_INPUT_SCORE = 30;

function isRealCanvaPdfUploadInput(meta = {}) {
  return scoreCanvaPdfFileInput(meta) >= REAL_CANVA_PDF_INPUT_SCORE;
}

function pickBestCanvaUploadFileInput(metas = [], kind = 'pdf') {
  return kind === 'image' ? pickBestCanvaImageFileInput(metas) : pickBestCanvaPdfFileInput(metas);
}

function fileInputMetaFromElement() {
  return (el) => {
    if (!el) return null;
    let hidden = false;
    try {
      const cs = el.ownerDocument?.defaultView?.getComputedStyle?.(el);
      hidden = Boolean(el.hidden)
        || (cs && (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity || 1) === 0));
    } catch {
      hidden = Boolean(el.hidden);
    }
    return {
      accept: el.getAttribute?.('accept') || '',
      webkitdirectory: Boolean(el.webkitdirectory || el.hasAttribute?.('webkitdirectory')),
      directory: Boolean(el.hasAttribute?.('directory')),
      multiple: Boolean(el.multiple),
      id: el.id || '',
      name: el.name || '',
      className: String(el.className || ''),
      hidden,
      inDialog: Boolean(el.closest?.('[role="dialog"], [aria-modal="true"]')),
      fileCount: el.files?.length || 0,
      fileName: el.files?.[0]?.name || ''
    };
  };
}

function basenameFile(value) {
  return String(value || '').split(/[\\/]/).pop().trim();
}

function isCompressedPrintPdfName(name) {
  return /^compressed-\d+\.pdf$/i.test(basenameFile(name));
}

function matchingCanvaPdfName(haystack, wantedNames = []) {
  const text = String(haystack || '').toLowerCase();
  if (!text) return false;
  const names = (Array.isArray(wantedNames) ? wantedNames : [wantedNames])
    .map((item) => basenameFile(item).toLowerCase())
    .filter(Boolean);
  if (!names.length) {
    return /compressed-\d+\.pdf/i.test(text);
  }
  return names.some((name) => {
    if (text.includes(name)) return true;
    return isCompressedPrintPdfName(name) && /compressed-\d+\.pdf/i.test(text);
  });
}

function matchingCanvaImageName(haystack, wantedNames = []) {
  const text = String(haystack || '').toLowerCase();
  if (!text) return false;
  const names = (Array.isArray(wantedNames) ? wantedNames : [wantedNames])
    .map((item) => basenameFile(item).toLowerCase())
    .filter(Boolean);
  return names.some((name) => name && text.includes(name));
}

function emptyCanvaPdfUploadState() {
  return {
    ok: false,
    percent: null,
    busy: false,
    uploading: false,
    converting: false,
    uploadFinished: false,
    importInProgress: false,
    transferSuccess: false,
    fileSelected: false,
    fileName: '',
    progressVisible: false,
    uploadItems: 0,
    uploadItemsDone: 0,
    pickerWaiting: false,
    text: ''
  };
}

function isCanvaPdfTransferSuccess(state = {}) {
  if (!state || typeof state !== 'object') return false;
  if (state.transferSuccess || state.uploadFinished) return true;
  const text = String(state.text || '');
  if (/uploaded to uploads/i.test(text)) return true;
  if (/currently being imported|being imported/i.test(text)) return true;
  if (/uploaded complete|finished uploading|done uploading|upload finished/i.test(text)) return true;
  const hasPdfRow = Boolean(state.fileName) || /compressed-\d+\.pdf|\.pdf/i.test(text);
  const hasItems = Number(state.uploadItems) > 0 || /\d+\s+of\s+\d+\s+items uploaded/i.test(text);
  if (state.importInProgress && (hasPdfRow || hasItems)) return true;
  if (/imports in progress/i.test(text) && (hasPdfRow || hasItems)) return true;
  return false;
}

function shouldSkipCanvaPdfInject(state = {}, { attachedOnce = false, files = [] } = {}) {
  if (attachedOnce) return true;
  const names = (Array.isArray(files) ? files : [files]).filter(Boolean);
  const haystack = `${state.fileName || ''} ${state.text || ''}`;
  const wantedHit = names.length ? matchingCanvaPdfName(haystack, names) : false;
  if (names.length && !wantedHit) return false;
  if (isCanvaPdfTransferSuccess(state)) return true;
  if (Number(state.uploadItems) > 0) return true;
  if (state.fileSelected && !state.pickerWaiting) return true;
  return wantedHit;
}

function summarizeCanvaPdfUploadText(rawText = '', extras = {}) {
  const text = String(rawText || '').replace(/\s+/g, ' ').trim();
  const percents = Array.isArray(extras.percents) ? extras.percents.map((item) => Number(item)).filter((item) => Number.isFinite(item)) : [];
  if (extras.percent != null && Number.isFinite(Number(extras.percent))) percents.push(Number(extras.percent));
  for (const match of text.matchAll(/(?:uploading|importing|converting|processing|preparing)[^%]{0,48}(\d{1,3}(?:\.\d+)?)\s*%|(\d{1,3}(?:\.\d+)?)\s*%[^%]{0,24}(?:uploaded|complete)/ig)) {
    const n = Number(match[1] || match[2]);
    if (Number.isFinite(n)) percents.push(Math.max(0, Math.min(100, Math.round(n))));
  }
  const percent = percents.length ? Math.max(...percents) : null;
  const namedFromText = (text.match(/compressed-\d+\.pdf|[^\s<>"]+\.pdf/i) || [])[0] || '';
  const fileName = extras.fileName || namedFromText;
  const ofItems = text.match(/(\d+)\s+of\s+(\d+)\s+items uploaded/i);
  const uploadingItems = text.match(/uploading\s+(\d+)\s+items/i);
  const uploadItems = Number(ofItems?.[2] || uploadingItems?.[1] || extras.uploadItems || 0) || 0;
  const uploadItemsDone = Number(ofItems?.[1] || extras.uploadItemsDone || 0) || 0;
  const importInProgress = /currently being imported|being imported/i.test(text)
    || (/imports in progress/i.test(text) && Boolean(fileName || ofItems || uploadingItems));
  const uploadedToUploads = /uploaded to uploads/i.test(text);
  const complete = /upload(ed)? complete|finished uploading|done uploading|upload finished/i.test(text) || uploadedToUploads;
  const uploading = (/(?:^|[^a-z])uploading(?:[^a-z]|$)|sending (your )?(file|pdf|document)|transferring/i.test(text) && !uploadedToUploads && !complete);
  const converting = /converting (your )?(file|pdf|document)|processing your (file|pdf|document)|preparing your (design|file)|opening (your )?(file|pdf)|importing (your )?(file|pdf|document)/i.test(text)
    || importInProgress;
  const fileSelected = Boolean(extras.fileSelected || fileName);
  const transferSuccess = Boolean(complete || uploadedToUploads || importInProgress);
  const pickerWaiting = Boolean(
    /drop your (files|content) here|drop items to upload|canva supports images|upload folder/i.test(text)
    && !fileSelected
    && !extras.fileSelected
    && (percent == null || percent === 0)
    && !converting
    && !complete
    && !importInProgress
    && !uploadedToUploads
    && uploadItems === 0
    && !transferSuccess
  );
  const busy = !pickerWaiting && (
    (percent != null && percent > 0 && percent < 100)
    || (uploading && !complete)
    || (Boolean(extras.progressVisible) && percent != null && percent > 0 && percent < 100)
    || (uploadItems > 0 && !complete && !transferSuccess)
    || importInProgress
  );
  return {
    ok: true,
    percent: pickerWaiting ? null : percent,
    busy,
    uploading: Boolean(uploading && !pickerWaiting),
    converting,
    uploadFinished: Boolean(complete || uploadedToUploads),
    importInProgress,
    transferSuccess,
    fileSelected,
    fileName,
    progressVisible: Boolean(extras.progressVisible && !pickerWaiting),
    uploadItems,
    uploadItemsDone,
    pickerWaiting,
    text: text.slice(0, 400)
  };
}

function isUnsafeCanvaPdfOpenClick(name) {
  const label = String(name || '');
  return isUnsafeCanvaUploadClick(label)
    || /create a design|create design|import files|import file|drop your (files|content)/i.test(label)
    || /open uploads folder|^uploads$|^projects$/i.test(label);
}

function scoreCanvaPdfOpenClick(name, wantedNames = []) {
  const label = String(name || '').replace(/\s+/g, ' ').trim();
  if (!label || isUnsafeCanvaPdfOpenClick(label)) return -1;
  let score = 0;
  if (/edit this pdf/i.test(label)) score += 100;
  if (/open as (a )?design/i.test(label)) score += 90;
  if (/^open$/i.test(label) || (/^open\b/i.test(label) && label.length < 28 && !/uploads/i.test(label))) score += 80;
  if (/imports in progress/i.test(label)) score += 70;
  if (/currently being imported/i.test(label)) score += 65;
  if (/^uploads$/i.test(label)) score += 50;
  if (/uploaded to uploads/i.test(label)) score += 45;
  if (/^projects$/i.test(label)) score += 35;
  const wanted = matchingCanvaPdfName(label, wantedNames);
  if (wanted) score += 150;
  if (/compressed-\d+\.pdf/i.test(label) || /\.pdf$/i.test(label)) {
    score += wantedNames.length && !wanted ? -25 : 60;
  }
  return score;
}

function pickCanvaPdfOpenClick(names = [], wantedNames = []) {
  const ranked = (Array.isArray(names) ? names : [])
    .map((name, index) => ({ name, index, score: scoreCanvaPdfOpenClick(name, wantedNames) }))
    .filter((row) => row.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index);
  return ranked[0] || null;
}

function isSafeCanvaUploadPanelClose(name) {
  const label = String(name || '').replace(/\s+/g, ' ').trim();
  if (!label || /cancel|abort|stop upload|remove|delete/i.test(label)) return false;
  return /^(close|dismiss|minimize)$/i.test(label) || /close (panel|window|dialog|uploads?)/i.test(label);
}

function canvaPdfImportTickMessage(expectedPages, count, importing, href, state = {}, elapsed) {
  const seen = Number(count) || 0;
  const inEditor = /\/design\//i.test(String(href || ''));
  const transfer = isCanvaPdfTransferSuccess(state);
  if (!inEditor && seen === 0 && state.percent != null && state.percent < 100 && !transfer) {
    return `Uploading the print PDF — ${state.percent}% (${elapsed}). Waiting until 100% before opening the ${expectedPages}-page design.`;
  }
  if (!inEditor && seen === 0 && (transfer || state.converting || state.uploadFinished || Number(state.uploadItems) > 0)) {
    return `PDF in Uploads / import in progress — opening design (${elapsed}). Still 0 of ${expectedPages} pages.`;
  }
  if (!inEditor && seen === 0) {
    return `Still on Canva home (${elapsed}). The print PDF has not opened as a design yet — 0 of ${expectedPages} pages.`;
  }
  if (inEditor && seen === 0) {
    return `Canva opened a design (${elapsed}) but no page thumbnails yet. Waiting for the PDF to expand to ${expectedPages} pages.`;
  }
  if (inEditor && seen < expectedPages) {
    return `Still importing the print PDF (${elapsed}). Canva has ${seen} of ${expectedPages} pages${importing ? ' and is still converting' : ''}. Waiting for every page before Magic Layer — not treating this as finished.`;
  }
  return `Still importing the print PDF (${elapsed}). Canva has ${seen} of ${expectedPages} pages${importing ? ' and is still converting' : ''}.`;
}

module.exports = {
  isFolderFileInputMeta,
  isUnsafeCanvaUploadClick,
  scoreCanvaPdfFileInput,
  scoreCanvaImageFileInput,
  pickBestCanvaPdfFileInput,
  pickBestCanvaImageFileInput,
  scoreCanvaUploadFileInput,
  isRealCanvaPdfUploadInput,
  REAL_CANVA_PDF_INPUT_SCORE,
  pickBestCanvaUploadFileInput,
  fileInputMetaFromElement,
  basenameFile,
  isCompressedPrintPdfName,
  matchingCanvaPdfName,
  matchingCanvaImageName,
  emptyCanvaPdfUploadState,
  isCanvaPdfTransferSuccess,
  shouldSkipCanvaPdfInject,
  summarizeCanvaPdfUploadText,
  isUnsafeCanvaPdfOpenClick,
  scoreCanvaPdfOpenClick,
  pickCanvaPdfOpenClick,
  isSafeCanvaUploadPanelClose,
  canvaPdfImportTickMessage
};
