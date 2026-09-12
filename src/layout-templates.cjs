'use strict';

const { readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const TEMPLATE_DIR = join(__dirname, '..', 'layout_templates');
const DEFAULT_THEME = 'washable-marker';
const PAGE_TYPES = new Set(['cover', 'interior', 'back']);

function slugTheme(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || DEFAULT_THEME;
}

function pageTypeForJob(job, pageCount) {
  const kind = String(job?.kind || job?.pageLabel || '').toLowerCase();
  if (/cover|front/.test(kind) && !/back/.test(kind)) return 'cover';
  if (/back|thank|closing/.test(kind)) return 'back';
  const number = Number(job?.pageNumber) || 0;
  const total = Number(pageCount) || 0;
  if (number === 1) return 'cover';
  if (total >= 2 && number === total) return 'back';
  return 'interior';
}

function templatePath(themeId, pageType) {
  return join(TEMPLATE_DIR, `${slugTheme(themeId)}__${pageType}.json`);
}

function readTemplateFile(filePath) {
  const raw = JSON.parse(readFileSync(filePath, 'utf8'));
  if (!raw || !raw.canvas || !Array.isArray(raw.zones) || !raw.zones.length) {
    throw Object.assign(new Error(`Layout template is invalid: ${filePath}`), { code: 'LAYOUT_TEMPLATE_INVALID' });
  }
  return raw;
}

function loadTemplate(themeId, pageType) {
  const type = PAGE_TYPES.has(pageType) ? pageType : 'interior';
  const exact = templatePath(themeId, type);
  try {
    return { ...readTemplateFile(exact), fromDefault: false };
  } catch (error) {
    if (error && error.code === 'LAYOUT_TEMPLATE_INVALID') throw error;
  }
  const fallback = templatePath(DEFAULT_THEME, type);
  try {
    return { ...readTemplateFile(fallback), theme_id: slugTheme(themeId), page_type: type, fromDefault: true };
  } catch {
    throw Object.assign(
      new Error(`No layout template for ${slugTheme(themeId)} / ${type}.`),
      { code: 'LAYOUT_TEMPLATE_MISSING', themeId: slugTheme(themeId), pageType: type }
    );
  }
}

function listTemplates() {
  return readdirSync(TEMPLATE_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.replace(/\.json$/, ''));
}

function describeZones(template) {
  return (template.zones || []).map((zone) => {
    const role = String(zone.role || zone.id || 'band');
    const place = role === 'heading' || zone.id === 'title' ? 'across the top'
      : role === 'caption' || zone.id === 'footer' ? 'along the bottom'
      : zone.id === 'instruction' ? 'under the title'
      : role === 'brand_bar' ? 'as a full-width empty bar'
      : 'in the middle of the page';
    return `${zone.id} empty ${zone.shape || 'rect'} band ${place}`;
  });
}

module.exports = {
  TEMPLATE_DIR,
  DEFAULT_THEME,
  slugTheme,
  pageTypeForJob,
  loadTemplate,
  listTemplates,
  describeZones,
};
