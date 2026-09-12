'use strict';

const { writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const sharp = require('sharp');

// Generates only geometric artwork: there are no text glyphs in the backgrounds.
// Callers supply a temporary directory; this fixture never touches project output.
async function makeThreePageFixture(directory, { format = 'LETTER', orientation = 'portrait' } = {}) {
  const { resolvePageSetup } = require('../../src/file-manager.cjs');
  const { points: [pageW, pageH] } = resolvePageSetup(format, orientation);
  const text = (id, value, overrides = {}) => ({
    id, text: value, units: 'pt', editable: true,
    x: 54, y: 72, width: pageW - 108, height: 60,
    fontFace: 'Arial', fontSize: 24, bold: false, italic: false,
    color: '243247', align: 'left', valign: 'top', lineSpacing: 30, rotation: 0,
    ...overrides
  });
  const records = [
    [text('p1-title', 'Our classroom', { bold: true, align: 'center' }),
      text('p1-name', 'Name: __________________', { y: 216, fontSize: 18, lineSpacing: 24 })],
    [text('p2-title', 'Read & explore <together>', { bold: true }),
      text('p2-instructions', 'Read the question.\nWrite your answer.', { y: 216, height: 144, fontSize: 20, lineSpacing: 28 })],
    [text('p3-title', 'You did it!', { align: 'right', valign: 'bottom', color: '285E45' }),
      text('p3-label', 'Great effort!', { x: 180, y: 288, width: 252, height: 108,
        rotation: 15, bold: true, italic: true, align: 'center', valign: 'middle', color: 'A34324' })]
  ];
  const colors = ['#DEEAF7', '#E6F1DD', '#F8E6D8'];
  const pages = [];
  for (let index = 0; index < 3; index++) {
    const art = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(pageW)}" height="${Math.round(pageH)}"><rect width="100%" height="100%" fill="white"/><rect x="18" y="18" width="${pageW - 36}" height="${pageH - 36}" rx="12" fill="${colors[index]}"/><circle cx="${pageW / 2}" cy="${pageH - 162}" r="45" fill="#A0B4C0"/></svg>`);
    const path = join(directory, `prototype-art-${index + 1}.png`);
    await writeFile(path, await sharp(art).png().toBuffer());
    pages.push({ pageNumber: index + 1, background: { path, textFree: true }, textOverlays: records[index] });
  }
  return { format, orientation, pages };
}

module.exports = { makeThreePageFixture };
