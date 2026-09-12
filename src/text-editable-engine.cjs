'use strict';

const { readFile } = require('node:fs/promises');
const sharp = require('sharp');
const { resolvePageSetup } = require('./file-manager.cjs');
const { prototypeTextToPptxBox } = require('./text-overlay-layout.cjs');
const { assembleEditablePptx } = require('./pptx-assembler.cjs');

/** Isolated Phase 5B adapter: no state, output files, routing, or OCR.
 * background.textFree is an explicit author assertion, not pixel recognition.
 * Page numbers define slide order; text array order defines reading order.
 * Explicit newlines define wrapping; font substitution remains viewer-dependent.
 */
async function buildTextEditablePrototype(input) {
  const fail = (message, code = 'TEXT_EDITABLE_INPUT_INVALID') => {
    throw Object.assign(new Error(message), { code });
  };
  if (!input || !Array.isArray(input.pages) || input.pages.length !== 3) {
    fail('The Phase 5B prototype requires exactly three pages.');
  }
  if (!['A4', 'LETTER', 'SQUARE'].includes(input.format)
    || !['portrait', 'landscape'].includes(input.orientation)) {
    fail('An explicit supported format and orientation are required.');
  }
  const setup = resolvePageSetup(input.format, input.orientation);
  const pageNumbers = new Set();
  const textIds = new Set();
  const pages = [];
  for (const page of input.pages) {
    if (!page || !Number.isInteger(page.pageNumber) || page.pageNumber < 1 || page.pageNumber > 3
      || pageNumbers.has(page.pageNumber)) fail('Page numbers must be unique integers 1 through 3.');
    pageNumbers.add(page.pageNumber);
    if (!page.background || page.background.textFree !== true
      || typeof page.background.path !== 'string' || !page.background.path.trim()) {
      fail('Each page requires an explicit text-free background path.', 'TEXT_EDITABLE_BACKGROUND_INVALID');
    }
    if (!Array.isArray(page.textOverlays) || !page.textOverlays.length) fail('Each prototype page requires text records.');
    const textBoxes = [];
    for (const record of page.textOverlays) {
      const box = prototypeTextToPptxBox(record, setup.points);
      if (textIds.has(record.id)) fail(`Duplicate text id: ${record.id}`, 'TEXT_EDITABLE_TEXT_DUPLICATE');
      textIds.add(record.id);
      textBoxes.push(box);
    }
    let backgroundPng;
    try {
      backgroundPng = await readFile(page.background.path);
    } catch {
      fail(`Background cannot be read for page ${page.pageNumber}.`, 'TEXT_EDITABLE_BACKGROUND_MISSING');
    }
    let metadata;
    try {
      const image = sharp(backgroundPng, { failOn: 'warning' });
      metadata = await image.metadata();
      await image.raw().toBuffer(); // Validate actual pixel decoding, not just headers.
    } catch {
      fail(`Background is not a valid image for page ${page.pageNumber}.`, 'TEXT_EDITABLE_BACKGROUND_INVALID');
    }
    if (metadata.format !== 'png' || (metadata.pages || 1) !== 1
      || Math.abs(metadata.width / metadata.height - setup.points[0] / setup.points[1]) > 0.001) {
      fail('Background must be a single PNG matching the page aspect ratio.', 'TEXT_EDITABLE_BACKGROUND_INVALID');
    }
    pages.push({ pageNumber: page.pageNumber, backgroundPath: page.background.path, backgroundPng, textBoxes });
  }
  return assembleEditablePptx({
    name: 'Text Editable Engine — Three-page Prototype',
    format: input.format,
    orientation: input.orientation
  }, { prototypePages: pages });
}

module.exports = { buildTextEditablePrototype };
