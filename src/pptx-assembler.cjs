/**
 * Editable PowerPoint assembler — blank page art + native textOverlays.
 * Native slide assembly. No SVG-on-slide embeds.
 */
const { existsSync, mkdirSync } = require('node:fs');
const { join, basename } = require('node:path');
const {
  normalizeTextOverlays,
  overlayToPptxBox
} = require('./text-overlay-layout.cjs');
function exportPagesFor(project) {
  return require('./editable-production.cjs').buildExportPageArray(project);
}

function fm() {
  return require('./file-manager.cjs');
}

function pptxGen() {
  return require('pptxgenjs');
}

/**
 * Build `[Product]_Editable.pptx` from jobs with blank PNGs + textOverlays.
 */
async function assembleEditablePptx(project, { fileName = null, prototypePages = null } = {}) {
  // Only TextEditableEngine supplies validated prototype pages. This opt-in path
  // returns a buffer and never invokes legacy output-directory/file replacement.

  const jobs = (prototypePages || (Array.isArray(project?.jobs) ? project.jobs : []))
    .slice()
    .sort((a, b) => (Number(a.pageNumber) || 0) - (Number(b.pageNumber) || 0));
  if (!jobs.length) {
    throw Object.assign(new Error('No pages found for Editable PowerPoint.'), {
      code: 'EDITABLE_PAGES_MISSING'
    });
  }

  const { resolvePageSetup, atomicWrite, bookFileCode, pageImageAsPngBuffer } = fm();
  const setup = resolvePageSetup(project.format || 'A4', project.orientation || 'portrait');
  const widthInches = setup.points[0] / 72;
  const heightInches = setup.points[1] / 72;
  const PptxGenJS = pptxGen();
  const pres = new PptxGenJS();
  const productName = project.name || bookFileCode(project);
  pres.title = `${productName} — Editable`;
  pres.subject = 'Blank template backgrounds + native editable text boxes from textOverlays JSON.';
  pres.defineLayout({ name: 'CUSTOM', width: widthInches, height: heightInches });
  pres.layout = 'CUSTOM';

  const exportPages = prototypePages ? null : exportPagesFor(project);
  let slideCount = 0;
  const walk = prototypePages
    ? jobs.map((job) => ({ job, blankPath: job.backgroundPath }))
    : exportPages.map((page) => ({ job: page.job, blankPath: page.path }));
  for (const { job, blankPath } of walk) {
    if (!prototypePages && (!blankPath || !existsSync(blankPath))) {
      throw Object.assign(new Error(`Missing blank master for page ${job.pageNumber}: expected ${blankPath || 'page_N_blank.png'}`), {
        code: 'EDITABLE_BG_MISSING',
        pageNumber: job.pageNumber
      });
    }
    const overlays = prototypePages ? job.textBoxes : normalizeTextOverlays(job.textOverlays);
    if (!prototypePages && overlays.length) {
      const { assertBlankMasterClean } = require('./text-inpaint-bridge.cjs');
      await assertBlankMasterClean(blankPath, job);
    }
    const pngBuffer = prototypePages ? job.backgroundPng : await pageImageAsPngBuffer(blankPath);
    const slide = pres.addSlide();
    slide.addImage({
      data: `data:image/png;base64,${pngBuffer.toString('base64')}`,
      x: 0,
      y: 0,
      w: widthInches,
      h: heightInches
    });

    for (const overlay of overlays) {
      if (prototypePages) {
        const { text, ...options } = overlay;
        // PptxGenJS interpolates typeface attributes without XML escaping.
        // Escape once, only at this prototype serialization boundary. Numeric
        // references preserve attribute whitespace through XML normalization.
        options.fontFace = options.fontFace.replace(/[&<>"'\t\n\r]/g, (character) => ({
          '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
          '\t': '&#9;', '\n': '&#10;', '\r': '&#13;'
        }[character]));
        slide.addText(text, options);
        continue;
      }
      const box = overlayToPptxBox(overlay, widthInches, heightInches);
      slide.addText(box.text, {
        x: box.x,
        y: box.y,
        w: box.w,
        h: box.h,
        fontSize: box.fontSize,
        fontFace: box.fontFace,
        color: box.color,
        align: box.align,
        valign: box.valign,
        bold: box.bold
      });
    }
    slide.addNotes(
      `Page ${job.pageNumber}\n`
      + `Blank art: ${basename(blankPath)}\n`
      + `${overlays.length} native text box(es) from textOverlays JSON.\n`
    );
    slideCount += 1;
  }

  if (prototypePages) {
    return { buffer: await pres.write({ outputType: 'nodebuffer' }), slideCount };
  }
  mkdirSync(project.outputDir, { recursive: true });
  const pptxName = fileName || `${bookFileCode(project)}_Editable.pptx`;
  const pptxPath = join(project.outputDir, pptxName);
  const buffer = await pres.write({ outputType: 'nodebuffer' });
  await atomicWrite(pptxPath, buffer);
  return { pptxPath, pptxName, slideCount };
}

module.exports = {
  assembleEditablePptx
};
