'use strict';

const { ERROR_CODES } = require('./rebuild-page-record.cjs');

const FOLIO_PATTERN = /\b(?:page\s*#?\s*\d+|\d+\s*(?:of|\/)\s*\d+|folio)\b/i;
const COVER_SIGNAL = /\b(activity pack|printable pack|thank you|credits|front cover|back cover)\b/i;

function normalizeCopy(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9']+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value) {
  return normalizeCopy(value).split(' ').filter((token) => token.length > 1);
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i += 1) grid[i][0] = i;
  for (let j = 0; j < cols; j += 1) grid[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      grid[i][j] = Math.min(grid[i - 1][j] + 1, grid[i][j - 1] + 1, grid[i - 1][j - 1] + cost);
    }
  }
  return grid[a.length][b.length];
}

function similarity(a, b) {
  const left = normalizeCopy(a);
  const right = normalizeCopy(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.86;
  const maxLen = Math.max(left.length, right.length);
  const edit = 1 - (levenshtein(left, right) / maxLen);
  const aTokens = new Set(tokens(left));
  const bTokens = new Set(tokens(right));
  let overlap = 0;
  if (aTokens.size && bTokens.size) {
    let hit = 0;
    for (const token of aTokens) {
      if (bTokens.has(token)) hit += 1;
    }
    overlap = (2 * hit) / (aTokens.size + bTokens.size);
  }
  return Math.max(edit, overlap);
}

function plannedStrings(record) {
  return ['title', 'instruction', 'body', 'footer']
    .map((role) => String(record?.plannedCopy?.[role] || '').trim())
    .filter(Boolean);
}

function matchExpectedCopy(record, detections) {
  const expected = plannedStrings(record);
  const observed = (detections || []).map((item) => String(item.text || '').trim()).filter(Boolean);
  const missing = [];
  const matches = [];
  for (const text of expected) {
    let best = { score: 0, detection: null };
    for (const item of detections || []) {
      const score = similarity(text, item.text);
      if (score > best.score) best = { score, detection: item };
    }
    if (best.score < 0.72) missing.push(text);
    else matches.push({ text, detection: best.detection, score: best.score });
  }
  return { expected, observed, missing, matches };
}

function unexpectedText(record, detections) {
  const planned = plannedStrings(record).map(normalizeCopy);
  const extras = [];
  for (const item of detections || []) {
    const text = String(item.text || '').trim();
    if (!text || text.length < 2) continue;
    if (FOLIO_PATTERN.test(text)) continue;
    const normalized = normalizeCopy(text);
    const explained = planned.some((line) => {
      if (!line) return false;
      return similarity(line, normalized) >= 0.62 || line.includes(normalized) || normalized.includes(line);
    });
    if (!explained) extras.push(text);
  }
  return extras;
}

function folioHits(detections) {
  return (detections || [])
    .map((item) => String(item.text || '').trim())
    .filter((text) => FOLIO_PATTERN.test(text));
}

function roleViolation(record, detections, matches) {
  const role = record.pageRole;
  const blob = (detections || []).map((item) => item.text).join(' ');
  if (role === 'interior' && COVER_SIGNAL.test(blob) && matches.some((item) => item.score < 0.8)) {
    return 'Interior page looks like a cover or closing page.';
  }
  if (role === 'front-cover' && /worksheet|circle the|trace each|cut out/i.test(blob) && !record.plannedCopy?.instruction) {
    return 'Front cover looks like an interior worksheet.';
  }
  if (role === 'back-cover' && /front cover|activity pack/i.test(blob) && record.sequenceIndex !== 1) {
    return 'Back cover looks like a front cover.';
  }
  return null;
}

function averageConfidence(detections) {
  const scores = (detections || []).map((item) => Number(item.confidence ?? item.score)).filter((value) => Number.isFinite(value));
  if (!scores.length) return 0;
  return scores.reduce((sum, value) => sum + value, 0) / scores.length;
}

function evaluatePreflight(record, { detections = [], bands = [], accurate = false } = {}) {
  const copy = matchExpectedCopy(record, detections);
  const extras = unexpectedText(record, detections);
  const folios = folioHits(detections);
  const roleError = roleViolation(record, detections, copy.matches);
  const nonflat = (bands || []).filter((band) => band.flat === false || Number(band.sigma) > 18);
  const confidence = averageConfidence(detections);
  const ambiguous = !accurate && copy.missing.length && confidence < 0.55 && detections.length > 0;

  if (folios.length) {
    return { ok: false, code: ERROR_CODES.VISIBLE_FOLIO, retry: 'regenerate', details: { folios, ...copy } };
  }
  if (roleError) {
    return { ok: false, code: ERROR_CODES.WRONG_ROLE, retry: 'regenerate', message: roleError, details: copy };
  }
  if (ambiguous) {
    return { ok: false, code: ERROR_CODES.AMBIGUOUS_OCR, retry: 'accurate_ocr', details: { confidence, ...copy } };
  }
  if (copy.missing.length) {
    return { ok: false, code: ERROR_CODES.WRONG_COPY, retry: 'regenerate', details: copy };
  }
  if (extras.length) {
    return { ok: false, code: ERROR_CODES.EXTRA_TEXT, retry: 'regenerate', details: { extras, ...copy } };
  }
  if (nonflat.length) {
    return { ok: false, code: ERROR_CODES.NONFLAT_BAND, retry: 'regenerate', details: { bands: nonflat } };
  }
  return {
    ok: true,
    code: null,
    matches: copy.matches,
    extras: [],
    folios: [],
    confidence,
  };
}

function attachIdentity(record, { detections = [], matches = [], bands = [] } = {}) {
  const blocks = (record.blocks || []).map((block) => {
    const hit = matches.find((item) => item.text === block.text)
      || matches.find((item) => similarity(item.text, block.text) >= 0.72);
    const box = hit?.detection?.box || block.box;
    const band = (bands || []).find((item) => item.role === block.role) || {};
    return {
      ...block,
      text: record.plannedCopy[block.role] || block.text,
      box: box || null,
      confidence: hit?.score ?? null,
      bandColor: band.color || record.bandColor,
      inkColor: band.ink || record.inkColor,
    };
  });
  const bandColor = bands[0]?.color || record.bandColor;
  const inkColor = bands[0]?.ink || record.inkColor || [43, 43, 43];
  return {
    ...record,
    blocks,
    detected: detections,
    bandColor,
    inkColor,
  };
}

module.exports = {
  FOLIO_PATTERN,
  normalizeCopy,
  similarity,
  plannedStrings,
  matchExpectedCopy,
  unexpectedText,
  folioHits,
  evaluatePreflight,
  attachIdentity,
};
