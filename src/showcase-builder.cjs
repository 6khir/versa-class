/**
 * Showcase builder — stamp textOverlays onto blank masters for Mockup GPT.
 */
const { existsSync, mkdirSync, appendFileSync } = require('node:fs');
const { join, basename } = require('node:path');
const sharp = require('sharp');
const {
  normalizeTextOverlays,
  overlayToPptxBox,
  blankPathForJob,
  showcasePathForJob,
  showcaseFileName
} = require('./text-overlay-layout.cjs');

function fm() {
  return require('./file-manager.cjs');
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function debugLog(message, data = {}, hypothesisId = 'SHOW') {
  // #region agent log
  try {
    appendFileSync(
      '/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )/.cursor/debug-2f6f56.log',
      `${JSON.stringify({
        sessionId: '2f6f56',
        runId: 'blank-text-pipeline',
        hypothesisId,
        location: 'showcase-builder.cjs',
        message,
        data,
        timestamp: Date.now()
      })}\n`
    );
  } catch {}
  // #endregion
}

function buildTextSvg({ widthPx, heightPx, widthInches, heightInches, overlays }) {
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">`
  ];
  for (const overlay of overlays) {
    const box = overlayToPptxBox(overlay, widthInches, heightInches);
    const xPx = (box.x / widthInches) * widthPx;
    const yPx = (box.y / heightInches) * heightPx;
    const wPx = (box.w / widthInches) * widthPx;
    const hPx = (box.h / heightInches) * heightPx;
    const fontPx = Math.max(12, Math.round((box.fontSize / 72) * (widthPx / widthInches)));
    const anchor = box.align === 'left' ? 'start' : box.align === 'right' ? 'end' : 'middle';
    const textX = box.align === 'left' ? xPx : box.align === 'right' ? xPx + wPx : xPx + (wPx / 2);
    const textY = yPx + (hPx / 2) + (fontPx * 0.35);
    parts.push(
      `<text x="${textX.toFixed(1)}" y="${textY.toFixed(1)}" text-anchor="${anchor}" `
      + `font-family="${escapeXml(box.fontFace)}, Comic Sans MS, sans-serif" `
      + `font-size="${fontPx}" fill="#${escapeXml(box.color)}" `
      + `${box.bold ? 'font-weight="700" ' : ''}`
      + `>${escapeXml(box.text)}</text>`
    );
  }
  parts.push('</svg>');
  return Buffer.from(parts.join(''), 'utf8');
}

/**
 * Stamp overlays onto blank → page_N_showcase.png
 */
async function buildShowcaseForJob(project, job) {
  const { resolvePageSetup, atomicWrite, pageImageAsPngBuffer } = fm();
  const blankPath = blankPathForJob(job, project.outputDir);
  if (!blankPath || !existsSync(blankPath)) {
    throw Object.assign(new Error(`Blank master missing for showcase page ${job?.pageNumber}`), {
      code: 'SHOWCASE_BLANK_MISSING',
      pageNumber: job?.pageNumber
    });
  }
  const setup = resolvePageSetup(project.format || 'A4', project.orientation || 'portrait');
  const widthInches = setup.points[0] / 72;
  const heightInches = setup.points[1] / 72;
  const blankPng = await pageImageAsPngBuffer(blankPath);
  const meta = await sharp(blankPng).metadata();
  const widthPx = meta.width || setup.width;
  const heightPx = meta.height || setup.height;
  const overlays = normalizeTextOverlays(job.textOverlays);
  const outPath = showcasePathForJob(job, project.outputDir);
  mkdirSync(project.outputDir, { recursive: true });

  if (!overlays.length) {
    await atomicWrite(outPath, blankPng);
    debugLog('showcase copied blank (no overlays)', { pageNumber: job.pageNumber, out: basename(outPath) }, 'B');
    return outPath;
  }

  const svg = buildTextSvg({ widthPx, heightPx, widthInches, heightInches, overlays });
  const stamped = await sharp(blankPng)
    .composite([{ input: svg, top: 0, left: 0 }])
    .png()
    .toBuffer();
  await atomicWrite(outPath, stamped);
  debugLog('showcase stamped', {
    pageNumber: job.pageNumber,
    blank: basename(blankPath),
    out: basename(outPath),
    overlayCount: overlays.length,
    bytes: stamped.length
  }, 'B');
  return outPath;
}

async function buildShowcasesForProject(project) {
  const jobs = (Array.isArray(project?.jobs) ? project.jobs : [])
    .slice()
    .sort((a, b) => (Number(a.pageNumber) || 0) - (Number(b.pageNumber) || 0));
  const paths = [];
  for (const job of jobs) {
    const out = String(job.outputPath || '');
    if (!out || !existsSync(out)) continue;
    try {
      paths.push(await buildShowcaseForJob(project, job));
    } catch (error) {
      debugLog('showcase failed', { pageNumber: job.pageNumber, error: String(error.message || error).slice(0, 160) }, 'B');
    }
  }
  return paths;
}

/**
 * Prefer showcase PNGs for Mockup GPT; fall back to blanks / outputPath.
 */
function collectShowcaseImagePaths(jobs = [], outputDir = '') {
  const { existsSync } = require('node:fs');
  const list = (Array.isArray(jobs) ? jobs : [])
    .slice()
    .sort((a, b) => (Number(a.pageNumber) || 0) - (Number(b.pageNumber) || 0));
  const paths = [];
  for (const job of list) {
    const showcase = showcasePathForJob(job, outputDir || '');
    if (showcase && existsSync(showcase)) {
      paths.push(showcase);
      continue;
    }
    const blank = blankPathForJob(job, outputDir || '');
    if (blank && existsSync(blank)) {
      paths.push(blank);
      continue;
    }
    const out = String(job?.outputPath || '');
    if (out && existsSync(out)) paths.push(out);
  }
  return [...new Set(paths)];
}

module.exports = {
  buildShowcaseForJob,
  buildShowcasesForProject,
  collectShowcaseImagePaths,
  showcaseFileName
};
