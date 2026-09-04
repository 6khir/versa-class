'use strict';

const { basename } = require('node:path');

const CANVA_HOME_URL = 'https://www.canva.com/';
const CANVA_LOGIN_URL = 'https://www.canva.com/login/';
const CANVA_MAGIC_LAYERS_URL = 'https://www.canva.com/magic-layers/';
const CANVA_BLANK_DESIGN_URL = 'https://www.canva.com/design?create&type=TACQ-gtv2Yk';
const CANVA_HOST_PATTERN = /^(www\.)?canva\.com$/i;
const CANVA_DESIGN_ID_PATTERN = /^DA[A-Za-z0-9_-]{5,}$/i;

function isCanvaPageUrl(url) {
  try {
    const host = new URL(String(url || '')).hostname;
    return CANVA_HOST_PATTERN.test(host) || /\.canva\.com$/i.test(host);
  } catch {
    return false;
  }
}

function isCanvaLoginUrl(url) {
  const href = String(url || '');
  if (/accounts\.canva\.com/i.test(href)) return true;
  try {
    const parsed = new URL(href);
    if (!isCanvaPageUrl(parsed.href)) return false;
    return /\/login|\/signup/i.test(parsed.pathname);
  } catch {
    return /login|signup/i.test(href);
  }
}

function quoteCsvField(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function buildBulkCreateCsv(pageImagePaths = []) {
  const rows = ['Page,Image,File'];
  (Array.isArray(pageImagePaths) ? pageImagePaths : []).forEach((filePath, index) => {
    const fileName = basename(String(filePath || ''));
    rows.push([index + 1, fileName, fileName].map(quoteCsvField).join(','));
  });
  return `${rows.join('\n')}\n`;
}

function normalizeCanvaFormat(format) {
  const raw = String(format || 'LETTER').trim().toUpperCase().replace(/\s+/g, '');
  if (raw === 'USLETTER' || raw === '8.5X11') return 'LETTER';
  if (raw === 'A4' || raw === 'LETTER' || raw === 'SQUARE') return raw;
  return 'LETTER';
}

function normalizeCanvaOrientation(orientation) {
  return String(orientation || 'portrait').trim().toLowerCase() === 'landscape' ? 'landscape' : 'portrait';
}

function canvaPageDimensions(format, orientation) {
  const pageFormat = normalizeCanvaFormat(format);
  const pageOrientation = normalizeCanvaOrientation(orientation);
  if (pageFormat === 'SQUARE') {
    return { width: 2000, height: 2000, unit: 'px', preset: 'Square', label: 'Square' };
  }
  if (pageFormat === 'LETTER') {
    return pageOrientation === 'landscape'
      ? { width: 11, height: 8.5, unit: 'in', preset: 'Letter', label: 'US Letter landscape' }
      : { width: 8.5, height: 11, unit: 'in', preset: 'Letter', label: 'US Letter portrait' };
  }
  return pageOrientation === 'landscape'
    ? { width: 297, height: 210, unit: 'mm', preset: 'A4', label: 'A4 landscape' }
    : { width: 210, height: 297, unit: 'mm', preset: 'A4', label: 'A4 portrait' };
}

function canvaCreateDesignUrl(format, orientation) {
  const { width, height, unit } = canvaPageDimensions(format, orientation);
  return `https://www.canva.com/design?create&width=${encodeURIComponent(width)}&height=${encodeURIComponent(height)}&units=${encodeURIComponent(unit)}`;
}

function normalizeCanvaTemplate(raw = {}) {
  const id = String(raw.id || '').trim();
  return {
    id: id || `tpl-${Date.now()}`,
    label: String(raw.label || '').trim() || 'Canva template',
    format: normalizeCanvaFormat(raw.format),
    orientation: normalizeCanvaOrientation(raw.orientation),
    maxPages: Math.max(1, Number.parseInt(raw.maxPages, 10) || 20),
    canvaDesignUrl: String(raw.canvaDesignUrl || raw.url || '').trim()
  };
}

function resolveCanvaTemplate(templates = [], project = {}) {
  const list = (Array.isArray(templates) ? templates : [])
    .map((item) => normalizeCanvaTemplate(item))
    .filter((item) => item.canvaDesignUrl && isCanvaPageUrl(item.canvaDesignUrl));
  if (!list.length) return null;
  const format = normalizeCanvaFormat(project.format);
  const orientation = normalizeCanvaOrientation(project.orientation);
  const pageCount = Number(project.stats?.total || project.pageCount || project.jobs?.length || 0);
  const matching = list
    .filter((item) => item.format === format && item.orientation === orientation)
    .filter((item) => !pageCount || pageCount <= item.maxPages)
    .sort((left, right) => left.maxPages - right.maxPages);
  return matching[0] || list.find((item) => item.format === format) || list[0];
}

function canvaTemplateLinkFromShare(text) {
  const raw = String(text || '');
  const short = raw.match(/https?:\/\/(?:www\.)?canva\.link\/[^\s"'<>]+/i);
  if (short) return short[0].replace(/[),.;]+$/, '');
  const match = raw.match(/https?:\/\/(?:www\.)?canva\.com\/[^\s"'<>]+/i);
  return match ? match[0].replace(/[),.;]+$/, '') : '';
}

function isCanvaDesignIdToken(value) {
  return CANVA_DESIGN_ID_PATTERN.test(String(value || '').trim());
}

function canvaShareToken(url) {
  const href = canvaTemplateLinkFromShare(url) || String(url || '');
  try {
    const parsed = new URL(href);
    const id = canvaDesignId(parsed.href);
    if (!id) return '';
    const parts = parsed.pathname.split('/').filter(Boolean);
    const token = parts[0] === 'design' && parts[1] === id ? parts[2] : '';
    return token && !/^(edit|view|watch|editor)$/i.test(token) ? token : '';
  } catch {
    return '';
  }
}

function canvaDesignId(url) {
  const href = canvaTemplateLinkFromShare(url) || String(url || '');
  try {
    const parsed = new URL(href);
    if (!isCanvaPageUrl(parsed.href)) return '';
    const fromQuery = parsed.searchParams.get('designId') || parsed.searchParams.get('design_id');
    if (isCanvaDesignIdToken(fromQuery)) return fromQuery;
    const match = parsed.pathname.match(/\/design\/([^/]+)/i);
    const token = match ? decodeURIComponent(match[1]) : '';
    return isCanvaDesignIdToken(token) ? token : '';
  } catch {
    return '';
  }
}

function isCanvaDesignUrl(url) {
  return Boolean(canvaDesignId(url));
}

function toCanvaDesignUrl(url) {
  const href = canvaTemplateLinkFromShare(url) || String(url || '');
  const id = canvaDesignId(href);
  if (!id) return '';
  const token = canvaShareToken(href);
  return token
    ? `https://www.canva.com/design/${id}/${token}/edit`
    : `https://www.canva.com/design/${id}/edit`;
}

function isCanvaShortTemplateLink(url) {
  try {
    const parsed = new URL(String(url || '').trim());
    return /^(www\.)?canva\.link$/i.test(parsed.hostname) && parsed.pathname.replace(/\/+$/, '').length > 1;
  } catch {
    return false;
  }
}

function toCanvaTemplateLink(url) {
  const href = canvaTemplateLinkFromShare(url) || String(url || '');
  if (isCanvaShortTemplateLink(href)) {
    const parsed = new URL(href);
    return `${parsed.origin}${parsed.pathname}`;
  }
  const id = canvaDesignId(href);
  if (!id) return '';
  const token = canvaShareToken(href);
  return token
    ? `https://www.canva.com/design/${id}/${token}/view?template=1`
    : `https://www.canva.com/design/${id}/view?template=1`;
}

function isCanvaTemplateLink(url) {
  const href = canvaTemplateLinkFromShare(url) || String(url || '');
  if (isCanvaShortTemplateLink(href)) return true;
  try {
    const parsed = new URL(href);
    if (!isCanvaPageUrl(parsed.href) || !canvaDesignId(parsed.href)) return false;
    if (parsed.searchParams.get('template') === '1') return true;
    return /(?:\?|&)template=1(?:&|$)/i.test(parsed.search);
  } catch {
    return /(?:\?|&)template=1(?:&|$)/i.test(href);
  }
}

function sameCanvaDesign(left, right) {
  const first = canvaDesignId(left);
  const second = canvaDesignId(right);
  return Boolean(first && second && first === second);
}

function inferCanvaEditorPageCount(signals = {}, expectedPages = 0) {
  const texts = Array.isArray(signals.texts) ? signals.texts : [];
  const indexes = Array.isArray(signals.indexes) ? signals.indexes : [];
  const ids = new Set();
  const ofTotals = [];
  const wordTotals = [];
  const expected = Math.max(0, Number(expectedPages) || 0);

  for (const raw of texts) {
    const text = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const ofPage = text.match(/\bpage\s*(\d+)\s*(?:of|\/)\s*(\d+)\b/i);
    const ofPages = text.match(/\b(\d+)\s*(?:of|\/)\s*(\d+)\s*pages?\b/i);
    const ofMatch = ofPage || ofPages;
    if (ofMatch) {
      const current = Number(ofMatch[1]);
      const total = Number(ofMatch[2]);
      if (current > 0 && current < 500) ids.add(String(current));
      if (total > 0 && total < 500) ofTotals.push(total);
    } else {
      const slash = text.match(/(?:^|[^\d])(\d{1,3})\s*\/\s*(\d{1,3})(?:[^\d]|$)/);
      if (slash) {
        const current = Number(slash[1]);
        const total = Number(slash[2]);
        if (total >= 2 && total < 500 && current >= 1 && current <= total) {
          ids.add(String(current));
          ofTotals.push(total);
        }
      }
    }
    const pageMatch = text.match(/\bpage\s*(\d{1,3})\b/i);
    if (pageMatch) {
      const n = Number(pageMatch[1]);
      if (n > 0 && n < 500) ids.add(String(n));
    }
    const pagesMatch = text.match(/\b(\d{1,3})\s+pages?\b/i);
    if (pagesMatch) {
      const n = Number(pagesMatch[1]);
      if (n > 0 && n < 500) wordTotals.push(n);
    }
  }

  const numeric = indexes.map(Number).filter((n) => Number.isFinite(n));
  const zeroBased = numeric.includes(0);
  for (const n of numeric) {
    const pageNumber = zeroBased ? n + 1 : n;
    if (pageNumber > 0 && pageNumber < 500) ids.add(String(pageNumber));
  }

  const unique = ids.size;
  const ofTotal = ofTotals.length ? Math.max(...ofTotals) : 0;
  const wordTotal = wordTotals.length ? Math.max(...wordTotals) : 0;
  if (expected && ofTotals.includes(expected)) return expected;
  if (expected && wordTotals.includes(expected) && (unique === 0 || unique >= Math.min(8, expected))) return expected;
  if (ofTotal >= 1) return ofTotal;
  if (wordTotal >= Math.max(5, unique) && (unique === 0 || unique >= Math.min(8, wordTotal))) return wordTotal;
  return unique;
}

function looksLikeLeftoverCanvaCount(count, expectedPages) {
  const got = Number(count) || 0;
  const want = Number(expectedPages) || 0;
  if (!want || got <= 0 || got === want) return false;
  if (want > 8 && got <= 4) return true;
  if (got > want && got >= 8 && (got - want >= 8 || want <= 4)) return true;
  return false;
}

module.exports = {
  CANVA_BLANK_DESIGN_URL,
  CANVA_HOME_URL,
  CANVA_LOGIN_URL,
  CANVA_MAGIC_LAYERS_URL,
  buildBulkCreateCsv,
  canvaCreateDesignUrl,
  canvaDesignId,
  canvaPageDimensions,
  canvaShareToken,
  canvaTemplateLinkFromShare,
  isCanvaDesignIdToken,
  isCanvaDesignUrl,
  inferCanvaEditorPageCount,
  looksLikeLeftoverCanvaCount,
  isCanvaLoginUrl,
  isCanvaPageUrl,
  isCanvaTemplateLink,
  normalizeCanvaFormat,
  normalizeCanvaOrientation,
  normalizeCanvaTemplate,
  quoteCsvField,
  resolveCanvaTemplate,
  sameCanvaDesign,
  toCanvaDesignUrl,
  toCanvaTemplateLink
};
