'use strict';

/**
 * Deterministic educational page layout. Pure computation — no AI provider, no I/O.
 * Elements are stacked top-down inside their text region with fixed gaps, and
 * footers are pinned to the region floor, so a page can never self-collide.
 */

const FOOTER_TEXT = 'Name: ________________________________    Date: ______________';
const FONT = 'Nunito';
const COLOR = '#1A1A1A';
const GAP = 10;
const LINE_RATIO = 1.28;
// Mean glyph advance in em for Nunito/Geist at mixed case. Deliberately generous:
// overestimating line count grows the box rather than clipping the teacher's text.
const GLYPH_EM = 0.52;

const ROLE_STYLE = Object.freeze({
  title: { fontSize: 26, bold: true, align: 'center', minHeight: 34 },
  subtitle: { fontSize: 16, bold: false, align: 'center', minHeight: 24 },
  instruction: { fontSize: 14, bold: false, align: 'left', minHeight: 22 },
  paragraph: { fontSize: 13, bold: false, align: 'left', minHeight: 20 },
  question: { fontSize: 13, bold: false, align: 'left', minHeight: 20 },
  label: { fontSize: 12, bold: false, align: 'left', minHeight: 18 },
  caption: { fontSize: 11, bold: false, align: 'center', minHeight: 18 },
  number: { fontSize: 12, bold: true, align: 'left', minHeight: 18 },
  footer: { fontSize: 11, bold: false, align: 'left', minHeight: 18 }
});

// Element order within a region. Roles absent here fall to the end, stable-sorted.
const FLOW_ORDER = ['title', 'subtitle', 'instruction', 'number', 'question', 'paragraph', 'label', 'caption'];

function styleFor(role) {
  return ROLE_STYLE[role] || ROLE_STYLE.paragraph;
}

/** Strip control characters and unpaired surrogates the contract validator rejects. */
function sanitize(value) {
  return String(value ?? '')
    .replace(/^@image\b\s*/i, '')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\p{Cs}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function condense(value, limit) {
  const clean = sanitize(value);
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return stop > limit / 4 ? cut.slice(0, stop + 1) : `${cut.trimEnd()}…`;
}

function measureHeight(text, fontSize, widthPoints) {
  const charsPerLine = Math.max(8, Math.floor(widthPoints / (fontSize * GLYPH_EM)));
  let lines = 0;
  for (const segment of String(text).split('\n')) lines += Math.max(1, Math.ceil(segment.length / charsPerLine));
  return Math.ceil(lines * fontSize * LINE_RATIO) + 6;
}

/**
 * Derive the editable text elements for one page. Stage 2 text, written against the
 * page's own artwork, is preferred; stored job content is the offline fallback.
 */
/**
 * The text boxes for one page.
 *
 * `pageText` is the only source. It comes from the local vision pass or, failing that,
 * the gem - both of which read what is actually printed on the page.
 *
 * Nothing else may be used. This previously fell back to job.title, job.prompt and
 * job.imagePrompt whenever pageText was missing, which put the raw generation prompt on
 * the slide: pages shipped reading "Prompt 2: @image A RACES writing strategy anchor
 * chart poster page, 2480 x 3508 px, rendered in the crayon-box visual style...". Those
 * fields describe how the artwork was requested; they are not page content, and a
 * customer must never see them.
 *
 * With no page text, the page is artwork only. An unread page shipping as clean artwork
 * is a missing feature; the same page shipping with our prompts printed across it is a
 * defect we would have to refund.
 */
function buildPageElements(project, job, revisionId, regionId, pageText = null) {
  const elements = [];
  if (!pageText) return elements;
  const push = (suffix, role, text) => {
    const value = sanitize(text);
    if (value) elements.push({ id: `${revisionId}-${suffix}`, role, regionId, content: { text: value } });
  };
  push('title', 'title', pageText.title);
  push('instruction', 'instruction', pageText.instruction);
  (Array.isArray(pageText.sections) ? pageText.sections : [])
    .forEach((section, index) => push(`section-${index + 1}`, 'question', section));
  push('footer', 'footer', pageText.footer || FOOTER_TEXT);
  return elements;
}

function toBox(element, x, y, width, height, style) {
  return {
    id: element.id,
    text: element.content.text,
    font: FONT,
    fontSize: style.fontSize,
    x: Math.round(x * 100) / 100,
    y: Math.round(y * 100) / 100,
    width: Math.round(width * 100) / 100,
    height: Math.round(height * 100) / 100,
    bold: style.bold,
    italic: false,
    color: COLOR,
    alignment: style.align,
    verticalAlignment: 'top',
    rotation: 0
  };
}

/**
 * Place every contract element deterministically. Returns a layout whose boxes are
 * guaranteed inside their declared text region and free of mutual overlap.
 */
function buildDeterministicPageLayout(contract) {
  const regions = new Map(contract.textRegions.map((region) => [region.id, region]));
  const floors = new Map();
  const placed = [];

  for (const element of contract.elements) {
    if (element.role !== 'footer') continue;
    const region = regions.get(element.regionId);
    const style = styleFor('footer');
    const height = Math.min(
      Math.max(style.minHeight, measureHeight(element.content.text, style.fontSize, region.width)),
      region.height
    );
    const y = region.y + region.height - height;
    floors.set(region.id, Math.min(floors.get(region.id) ?? Infinity, y - GAP));
    placed.push(toBox(element, region.x, y, region.width, height, style));
  }

  const flow = contract.elements
    .filter((element) => element.role !== 'footer')
    .map((element, index) => ({ element, index }))
    .sort((a, b) => {
      const rank = FLOW_ORDER.indexOf(a.element.role) - FLOW_ORDER.indexOf(b.element.role);
      return rank || a.index - b.index;
    });

  const cursors = new Map();
  for (const { element } of flow) {
    const region = regions.get(element.regionId);
    const style = styleFor(element.role);
    const floor = floors.get(region.id) ?? region.y + region.height;
    const top = Math.min(cursors.get(region.id) ?? region.y, Math.max(region.y, floor - style.minHeight));
    const natural = Math.max(style.minHeight, measureHeight(element.content.text, style.fontSize, region.width));
    const height = Math.max(style.minHeight, Math.min(natural, floor - top));
    const bounded = Math.min(height, region.y + region.height - top);
    placed.push(toBox(element, region.x, top, region.width, bounded, style));
    cursors.set(region.id, top + bounded + GAP);
  }

  const order = new Map(contract.elements.map((element, index) => [element.id, index]));
  placed.sort((a, b) => order.get(a.id) - order.get(b.id));
  return { elements: placed };
}

module.exports = { buildDeterministicPageLayout, buildPageElements, sanitize, condense, measureHeight, FOOTER_TEXT };
