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

// Prototype-only contract. Legacy normalization and fractional/inch heuristics above
// deliberately remain unchanged. Geometry, font size and line spacing are points.
function prototypeTextToPptxBox(item, pagePoints) {
  const fail = (message) => {
    throw Object.assign(new Error(message), { code: 'TEXT_EDITABLE_TEXT_INVALID' });
  };
  const validString = (value) => typeof value === 'string' && value.trim()
    && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/u.test(value);
  if (!Array.isArray(pagePoints) || pagePoints.length !== 2
    || !pagePoints.every((value) => Number.isFinite(value) && value > 0)) fail('Invalid page dimensions.');
  if (!item || typeof item !== 'object' || Array.isArray(item)) fail('Expected a text record.');
  if (typeof item.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_.-]*$/.test(item.id)) fail('Text needs a stable id.');
  if (!validString(item.text)) fail(`Invalid text: ${item.id}`);
  if (item.units !== 'pt' || item.editable !== true) fail('Text requires units: pt and editable: true.');
  for (const key of ['x', 'y', 'width', 'height', 'fontSize', 'lineSpacing', 'rotation']) {
    if (!Number.isFinite(item[key])) fail(`Invalid ${key}: ${item.id}`);
  }
  const [pageW, pageH] = pagePoints;
  if (item.x < 0 || item.y < 0 || item.width <= 0 || item.height <= 0
    || item.x + item.width > pageW || item.y + item.height > pageH
    || item.fontSize <= 0 || item.lineSpacing < item.fontSize
    || item.rotation < -180 || item.rotation > 180) fail(`Invalid bounds or typography: ${item.id}`);
  // DrawingML stores font size and point spacing in hundredths of a point
  // (ST_TextFontSize / ST_TextSpacingPoint), not arbitrary finite JS numbers.
  if (item.fontSize < 1 || item.fontSize > 4000 || item.lineSpacing > 201168) {
    fail(`Typography exceeds PPTX limits: ${item.id}`);
  }
  // Match PptxGenJS's points -> inches -> integer EMU conversion exactly.
  // Reject lost positive offsets as well as collapsed extents; zero offsets
  // remain valid. Do not silently enlarge or reposition the author's box.
  for (const key of ['x', 'y', 'width', 'height']) {
    const inches = item[key] / 72;
    const serialized = Math.round(inches * 914400);
    if (inches >= 100 || !Number.isSafeInteger(serialized)
      || (item[key] > 0 && serialized === 0)) fail(`Geometry cannot serialize faithfully: ${item.id}.${key}`);
  }
  // Rotated corners must also stay on the page.
  const angle = item.rotation * Math.PI / 180;
  const halfW = (Math.abs(Math.cos(angle)) * item.width + Math.abs(Math.sin(angle)) * item.height) / 2;
  const halfH = (Math.abs(Math.sin(angle)) * item.width + Math.abs(Math.cos(angle)) * item.height) / 2;
  const cx = item.x + item.width / 2;
  const cy = item.y + item.height / 2;
  if (cx - halfW < -1e-8 || cy - halfH < -1e-8 || cx + halfW > pageW + 1e-8 || cy + halfH > pageH + 1e-8) {
    fail(`Rotated text extends outside page: ${item.id}`);
  }
  if (!validString(item.fontFace) || typeof item.color !== 'string' || !/^[0-9A-Fa-f]{6}$/.test(item.color)
    || typeof item.bold !== 'boolean' || typeof item.italic !== 'boolean'
    || !['left', 'center', 'right'].includes(item.align)
    || !['top', 'middle', 'bottom'].includes(item.valign)) fail(`Invalid style: ${item.id}`);
  return {
    text: item.text.replace(/\r\n?/g, '\n'),
    x: item.x / 72, y: item.y / 72, w: item.width / 72, h: item.height / 72,
    fontFace: item.fontFace, fontSize: item.fontSize, color: item.color.toUpperCase(),
    bold: item.bold, italic: item.italic, align: item.align, valign: item.valign,
    rotate: item.rotation, lineSpacing: item.lineSpacing,
    objectName: item.id, isTextBox: true, margin: 0,
    paraSpaceBefore: 0, paraSpaceAfter: 0, fit: 'none', wrap: false
  };
}

module.exports = {
  prototypeTextToPptxBox,
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
