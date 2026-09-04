/**
 * Shared layout math for JSON textOverlays → PowerPoint inches / showcase pixels.
 */

function normalizeTextOverlay(raw = {}) {
  const text = String(raw.placeholderText ?? raw.text ?? raw.content ?? '').trim();
  return {
    text,
    placeholderText: String(raw.placeholderText ?? text).trim(),
    verticalPosition: raw.verticalPosition ?? raw.y ?? raw.vertical ?? 'middle',
    horizontalAlignment: String(raw.horizontalAlignment || raw.align || raw.horizontal || 'center').toLowerCase(),
    fontSize: Number(raw.fontSize) > 0 ? Number(raw.fontSize) : 24,
    fontFace: String(raw.fontFace || raw.font || 'Comic Sans MS'),
    color: String(raw.color || '000000').replace(/^#/, ''),
    bold: Boolean(raw.bold),
    width: raw.width != null ? Number(raw.width) : null,
    height: raw.height != null ? Number(raw.height) : null,
    x: raw.x != null ? Number(raw.x) : null,
    y: raw.y != null ? Number(raw.y) : null
  };
}

function normalizeTextOverlays(list) {
  return (Array.isArray(list) ? list : [])
    .map((item) => normalizeTextOverlay(item))
    .filter((item) => item.text);
}

function verticalFraction(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 1 && value <= 100) return Math.min(0.95, Math.max(0.02, value / 100));
    return Math.min(0.95, Math.max(0.02, value));
  }
  const raw = String(value || '').trim().toLowerCase();
  const pct = raw.match(/^(\d+(?:\.\d+)?)\s*%$/);
  if (pct) return Math.min(0.95, Math.max(0.02, Number(pct[1]) / 100));
  if (/^(top|upper)$/.test(raw)) return 0.08;
  if (/upper[- ]?third|near[- ]?top/.test(raw)) return 0.18;
  if (/^(middle|center|centre)$/.test(raw)) return 0.45;
  if (/lower[- ]?third|near[- ]?bottom/.test(raw)) return 0.72;
  if (/^bottom$/.test(raw)) return 0.85;
  const num = Number(raw);
  if (Number.isFinite(num)) return verticalFraction(num);
  return 0.45;
}

function alignToPptx(align) {
  if (/left/.test(align)) return 'left';
  if (/right/.test(align)) return 'right';
  return 'center';
}

/**
 * Map one overlay to pptxgenjs addText options (inches).
 */
function overlayToPptxBox(overlay, widthInches, heightInches) {
  const item = normalizeTextOverlay(overlay);
  const boxW = Number.isFinite(item.width) && item.width > 0
    ? (item.width <= 1 ? widthInches * item.width : item.width)
    : Math.max(2, widthInches * 0.8);
  const boxH = Number.isFinite(item.height) && item.height > 0
    ? (item.height <= 1 ? heightInches * item.height : item.height)
    : Math.max(0.45, Math.min(1.4, (item.fontSize / 72) * 1.6 + 0.25));

  let x;
  let y;
  if (Number.isFinite(item.x) && Number.isFinite(item.y)) {
    x = item.x <= 1 ? widthInches * item.x : item.x;
    y = item.y <= 1 ? heightInches * item.y : item.y;
  } else {
    const vf = verticalFraction(item.verticalPosition);
    y = Math.max(0.15, Math.min(heightInches - boxH - 0.15, heightInches * vf - (boxH / 2)));
    const align = alignToPptx(item.horizontalAlignment);
    if (align === 'left') x = Math.max(0.35, widthInches * 0.08);
    else if (align === 'right') x = Math.max(0.35, widthInches - boxW - widthInches * 0.08);
    else x = Math.max(0.25, (widthInches - boxW) / 2);
  }

  return {
    text: item.placeholderText || item.text,
    x,
    y,
    w: boxW,
    h: boxH,
    fontSize: item.fontSize,
    fontFace: item.fontFace,
    color: item.color,
    align: alignToPptx(item.horizontalAlignment),
    bold: item.bold,
    valign: 'middle'
  };
}

function blankFileName(pageNumber) {
  const n = Math.max(1, Number(pageNumber) || 1);
  return `page_${n}_blank.png`;
}

function showcaseFileName(pageNumber) {
  const n = Math.max(1, Number(pageNumber) || 1);
  return `page_${n}_showcase.png`;
}

function blankPathForJob(job, outputDir) {
  const { join } = require('node:path');
  const { existsSync } = require('node:fs');
  const dir = outputDir || '';
  const named = join(dir, blankFileName(job?.pageNumber));
  if (named && existsSync(named)) return named;
  const out = String(job?.outputPath || '');
  if (out && existsSync(out)) return out;
  const sibling = out.replace(/_showcase\.png$/i, '_blank.png');
  if (sibling && existsSync(sibling)) return sibling;
  return named;
}

function showcasePathForJob(job, outputDir) {
  const { join } = require('node:path');
  return join(outputDir || '', showcaseFileName(job?.pageNumber));
}

module.exports = {
  normalizeTextOverlay,
  normalizeTextOverlays,
  verticalFraction,
  alignToPptx,
  overlayToPptxBox,
  blankFileName,
  showcaseFileName,
  blankPathForJob,
  showcasePathForJob
};
