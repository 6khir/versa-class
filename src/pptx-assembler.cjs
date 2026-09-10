/**
 * Editable PowerPoint assembler — blank page art + native textOverlays.
 * No Canva. No SVG-on-slide embeds.
 */
const { existsSync, mkdirSync, appendFileSync } = require('node:fs');
const { join, basename } = require('node:path');
const PptxGenJS = require('pptxgenjs');
const {
  normalizeTextOverlays,
  overlayToPptxBox
} = require('./text-overlay-layout.cjs');
const { buildExportPageArray } = require('./editable-production.cjs');

function fm() {
  return require('./file-manager.cjs');
}

function debugLog(message, data = {}, hypothesisId = 'PPTX') {
  // #region agent log
  try {
    appendFileSync(
      '/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )/.cursor/debug-2f6f56.log',
      `${JSON.stringify({
        sessionId: '2f6f56',
        runId: 'blank-text-pipeline',
        hypothesisId,
        location: 'pptx-assembler.cjs',
        message,
        data,
        timestamp: Date.now()
      })}\n`
    );
  } catch {}
  // #endregion
}

/**
 * Build `[Product]_Editable.pptx` from jobs with blank PNGs + textOverlays.
 */
async function assembleEditablePptx(project, { fileName = null } = {}) {
  const jobs = (Array.isArray(project?.jobs) ? project.jobs : [])
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
  const pres = new PptxGenJS();
  const productName = project.name || bookFileCode(project);
  pres.title = `${productName} — Editable`;
  pres.subject = 'Blank template backgrounds + native editable text boxes from textOverlays JSON.';
  pres.defineLayout({ name: 'CUSTOM', width: widthInches, height: heightInches });
  pres.layout = 'CUSTOM';

  const exportPages = buildExportPageArray(project);
  let slideCount = 0;
  for (const page of exportPages) {
    const job = page.job;
    const blankPath = page.path;
    if (!blankPath || !existsSync(blankPath)) {
      throw Object.assign(new Error(`Missing blank master for page ${job.pageNumber}: expected ${blankPath || 'page_N_blank.png'}`), {
        code: 'EDITABLE_BG_MISSING',
        pageNumber: job.pageNumber
      });
    }
    const overlays = normalizeTextOverlays(job.textOverlays);
    if (overlays.length) {
      const { assertBlankMasterClean } = require('./text-inpaint-bridge.cjs');
      await assertBlankMasterClean(blankPath, job);
    }
    const pngBuffer = await pageImageAsPngBuffer(blankPath);
    const slide = pres.addSlide();
    slide.addImage({
      data: `data:image/png;base64,${pngBuffer.toString('base64')}`,
      x: 0,
      y: 0,
      w: widthInches,
      h: heightInches
    });
    for (const overlay of overlays) {
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
    // #region agent log
    debugLog('slide assembled', {
      pageNumber: job.pageNumber,
      blank: basename(blankPath),
      overlayCount: overlays.length,
      texts: overlays.map((o) => o.text.slice(0, 40))
    }, 'A');
    // #endregion
    slide.addNotes(
      `Page ${job.pageNumber}\n`
      + `Blank art: ${basename(blankPath)}\n`
      + `${overlays.length} native text box(es) from textOverlays JSON.\n`
    );
    slideCount += 1;
  }

  mkdirSync(project.outputDir, { recursive: true });
  const pptxName = fileName || `${bookFileCode(project)}_Editable.pptx`;
  const pptxPath = join(project.outputDir, pptxName);
  const buffer = await pres.write({ outputType: 'nodebuffer' });
  await atomicWrite(pptxPath, buffer);
  // #region agent log
  debugLog('pptx written', { pptxName, slideCount, bytes: buffer.length }, 'C');
  // #endregion
  return { pptxPath, pptxName, slideCount };
}

module.exports = {
  assembleEditablePptx
};
