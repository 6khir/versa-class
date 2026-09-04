const { createHash } = require('node:crypto');
const { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } = require('node:fs');
const { basename, dirname, extname, join } = require('node:path');
const archiver = require('archiver');
const CRC32 = require('crc-32');
const sharp = require('sharp');
const { Jimp, ResizeStrategy } = require('jimp');
const { PDFDocument, PDFName, PDFString } = require('pdf-lib');

const { calculateSaddleStitchSpreads } = require('./imposition.cjs');

const TPT_THUMBNAIL_MAX_BYTES = 4 * 1024 * 1024;
const THUMBNAIL_PAGE_MAX_EDGE = 1400;
const CANVA_IMPORT_MAX_BYTES = 20 * 1024 * 1024;
const PRINT_PDF_JPEG = {
  quality: 90,
  mozjpeg: true,
  chromaSubsampling: '4:4:4',
  trellisQuantisation: true,
  overshootDeringing: true
};
/** High-quality JPEG for PPTX / DOCX embeds — readable, much smaller than raw PNG. */
const EXPORT_EMBED_JPEG = {
  quality: 85,
  mozjpeg: true,
  chromaSubsampling: '4:4:4'
};
/** ~150–180 dpi visual for letter/A4 slides & Word pages (vs 300 dpi masters). */
const EXPORT_EMBED_MAX_EDGE = 1800;
const LISTING_THUMB_JPEG_QUALITY = [88, 82, 74, 66];
const LISTING_THUMB_MAX_EDGE = 1600;

async function encodePrintPdfJpeg(source, width, height) {
  return sharp(source, { failOn: 'none' })
    .rotate()
    .resize(width, height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .jpeg(PRINT_PDF_JPEG)
    .toBuffer();
}

async function addCompressedPdfPage(pdf, source, pagePoints, pixelWidth, pixelHeight) {
  const jpeg = await encodePrintPdfJpeg(source, pixelWidth, pixelHeight);
  const image = await pdf.embedJpg(jpeg);
  const page = pdf.addPage(pagePoints);
  page.drawImage(image, {
    x: 0,
    y: 0,
    width: pagePoints[0],
    height: pagePoints[1]
  });
}

const PAGE_SETUPS = {
  A4: {
    label: 'A4',
    portrait: { width: 2480, height: 3508, points: [595.28, 841.89], aspectRatioLabel: '1:1.414' },
    landscape: { width: 3508, height: 2480, points: [841.89, 595.28], aspectRatioLabel: '1.414:1' }
  },
  LETTER: {
    label: 'US Letter',
    portrait: { width: 2550, height: 3300, points: [612, 792], aspectRatioLabel: '8.5:11' },
    landscape: { width: 3300, height: 2550, points: [792, 612], aspectRatioLabel: '11:8.5' }
  },
  SQUARE: {
    label: 'Square',
    portrait: { width: 3000, height: 3000, points: [720, 720], aspectRatioLabel: '1:1' },
    landscape: { width: 3000, height: 3000, points: [720, 720], aspectRatioLabel: '1:1' }
  }
};

function resolvePageSetup(format = 'A4', orientation = 'portrait') {
  const pageFormat = PAGE_SETUPS[format] ? format : 'A4';
  const pageOrientation = orientation === 'landscape' ? 'landscape' : 'portrait';
  return {
    format: pageFormat,
    orientation: pageOrientation,
    orientationLabel: pageOrientation === 'landscape' ? 'Landscape' : 'Portrait',
    label: PAGE_SETUPS[pageFormat].label,
    ...PAGE_SETUPS[pageFormat][pageOrientation]
  };
}

async function atomicWrite(filePath, buffer) {
  const fs = require('fs/promises');
  await fs.mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.part`;
  await fs.writeFile(temporaryPath, buffer);
  try { await fs.rm(filePath, { force: true }); } catch {}
  await fs.rename(temporaryPath, filePath);
}

function addPngResolution(png, dpi = 300) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (png.length < 33 || !png.subarray(0, 8).equals(signature) || png.toString('ascii', 12, 16) !== 'IHDR') {
    throw Object.assign(new Error('The normalized image is not a valid PNG.'), { code: 'PNG_CONVERSION_FAILED' });
  }
  const ihdrLength = png.readUInt32BE(8);
  const insertionOffset = 8 + 12 + ihdrLength;
  const pixelsPerMeter = Math.round(dpi / 0.0254);
  const data = Buffer.alloc(9);
  data.writeUInt32BE(pixelsPerMeter, 0);
  data.writeUInt32BE(pixelsPerMeter, 4);
  data.writeUInt8(1, 8);
  const type = Buffer.from('pHYs');
  const chunk = Buffer.alloc(4 + 4 + data.length + 4);
  chunk.writeUInt32BE(data.length, 0);
  type.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(CRC32.buf(Buffer.concat([type, data])) >>> 0, 8 + data.length);
  return Buffer.concat([png.subarray(0, insertionOffset), chunk, png.subarray(insertionOffset)]);
}

async function normalizePngToPage(png, format = 'A4', orientation = 'portrait', zoom = 1.0, offsetX = 0.0, offsetY = 0.0) {
  const setup = resolvePageSetup(format, orientation);
  let image;
  try {
    image = await Jimp.read(png);
  } catch (error) {
    throw Object.assign(new Error(`The image could not be normalized: ${error.message}`), { code: 'IMAGE_NORMALIZE_FAILED' });
  }

  const parsedZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1.0;
  const parsedOffsetX = Number.isFinite(offsetX) ? offsetX : 0.0;
  const parsedOffsetY = Number.isFinite(offsetY) ? offsetY : 0.0;

  if (parsedZoom !== 1.0 || parsedOffsetX !== 0.0 || parsedOffsetY !== 0.0) {
    const scale = Math.max(setup.width / image.width, setup.height / image.height) * parsedZoom;
    image.resize({
      w: Math.round(image.width * scale),
      h: Math.round(image.height * scale),
      mode: ResizeStrategy.BICUBIC
    });

    const maxShiftX = image.width - setup.width;
    const maxShiftY = image.height - setup.height;
    const centerX = (image.width - setup.width) / 2;
    const centerY = (image.height - setup.height) / 2;

    const cropX = Math.max(0, Math.min(image.width - setup.width, Math.round(centerX - (parsedOffsetX * maxShiftX / 2))));
    const cropY = Math.max(0, Math.min(image.height - setup.height, Math.round(centerY - (parsedOffsetY * maxShiftY / 2))));

    image.crop({ x: cropX, y: cropY, w: setup.width, h: setup.height });
  } else {
    image.cover({ w: setup.width, h: setup.height, mode: ResizeStrategy.BICUBIC });
  }

  const normalized = addPngResolution(await image.getBuffer('image/png'), 300);
  if (normalized.length < 10_000) {
    throw Object.assign(new Error('The image could not be converted into a valid print-ready PNG.'), { code: 'PNG_CONVERSION_FAILED' });
  }
  return { png: normalized, width: setup.width, height: setup.height, dpi: 300 };
}

async function createSpreadPng({ leftPng, rightPng, format = 'A4', orientation = 'portrait' }) {
  const setup = resolvePageSetup(format, orientation);
  const spreadWidth = setup.width * 2;
  const spreadHeight = setup.height;

  const leftImage = leftPng
    ? await Jimp.read(leftPng)
    : new Jimp({ width: setup.width, height: setup.height, color: 0xFFFFFFFF });

  const rightImage = rightPng
    ? await Jimp.read(rightPng)
    : new Jimp({ width: setup.width, height: setup.height, color: 0xFFFFFFFF });

  const canvas = new Jimp({ width: spreadWidth, height: spreadHeight, color: 0xFFFFFFFF });
  canvas.composite(leftImage, 0, 0);
  canvas.composite(rightImage, setup.width, 0);

  const png = await canvas.getBuffer('image/png');
  return addPngResolution(png, 300);
}

const RASTER_PAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

function isRasterImagePath(filePath) {
  return RASTER_PAGE_EXTENSIONS.has(extname(String(filePath || '')).toLowerCase());
}

function isSvgImagePath(filePath) {
  return extname(String(filePath || '')).toLowerCase() === '.svg';
}

/**
 * Load a page artifact as PNG bytes for compositing / intermediate work.
 * When masters are SVG, rasterize in memory only — never writes a flat PNG master back to disk.
 */
async function pageImageAsPngBuffer(filePath) {
  const path = String(filePath || '');
  if (!path || !existsSync(path)) {
    throw Object.assign(new Error(`Page image missing: ${path || '(empty)'}`), {
      code: 'PAGE_IMAGE_MISSING'
    });
  }
  if (isSvgImagePath(path)) {
    return sharp(path, { density: 150, failOn: 'none' }).png().toBuffer();
  }
  if (extname(path).toLowerCase() === '.png') {
    return require('fs/promises').readFile(path);
  }
  return sharp(path, { failOn: 'none' }).png().toBuffer();
}

/**
 * Encode a page (or in-memory PNG buffer) as compressed JPEG for PPTX / DOCX embeds.
 */
async function pageImageAsExportJpeg(source, { maxEdge = EXPORT_EMBED_MAX_EDGE } = {}) {
  const input = Buffer.isBuffer(source)
    ? source
    : await pageImageAsPngBuffer(source);
  let pipeline = sharp(input, { failOn: 'none' }).rotate();
  const meta = await pipeline.metadata();
  const width = Number(meta.width) || 1;
  const height = Number(meta.height) || 1;
  if (Math.max(width, height) > maxEdge) {
    pipeline = pipeline.resize({
      width: width >= height ? maxEdge : undefined,
      height: height > width ? maxEdge : undefined,
      fit: 'inside',
      withoutEnlargement: true,
      kernel: sharp.kernel.lanczos3
    });
  }
  return pipeline.jpeg(EXPORT_EMBED_JPEG).toBuffer();
}

function resolveExportPackPdfPath(project) {
  const compressed = project?.compressedPdfPath && existsSync(project.compressedPdfPath)
    ? project.compressedPdfPath
    : (project?.printPdfJson?.compressedPdfPath && existsSync(project.printPdfJson.compressedPdfPath)
      ? project.printPdfJson.compressedPdfPath
      : null);
  if (compressed) return compressed;
  if (project?.productPdfPath && existsSync(project.productPdfPath)) return project.productPdfPath;
  const dest = project?.outputDir ? compressedPrintPdfDest(project.outputDir, project) : null;
  return dest && existsSync(dest) ? dest : null;
}

function collectProductPageImagePaths(jobs = []) {
  return [...new Set((Array.isArray(jobs) ? jobs : [])
    .slice()
    .sort((left, right) => (Number(left?.pageNumber) || 0) - (Number(right?.pageNumber) || 0))
    .map((job) => job?.outputPath)
    .filter((filePath) => filePath && existsSync(filePath) && isRasterImagePath(filePath)))];
}

function editableVectorFolderName(projectOrName = null) {
  return `${bookFileCode(projectOrName)}_Editable_Vector_Files`;
}

function collectProductPageSvgPaths(jobs = []) {
  const { svgPathForRaster } = require('./local-vectorizer.cjs');
  return [...new Set((Array.isArray(jobs) ? jobs : [])
    .slice()
    .sort((left, right) => (Number(left?.pageNumber) || 0) - (Number(right?.pageNumber) || 0))
    .map((job) => {
      const out = String(job?.outputPath || '');
      if (!out) return null;
      if (/\.svg$/i.test(out) && existsSync(out)) return out;
      const svg = svgPathForRaster(out);
      return svg && existsSync(svg) ? svg : null;
    })
    .filter(Boolean))];
}

/**
 * Package editable PowerPoint from blank masters + textOverlays JSON.
 */
async function packageEditableVectorFiles(project, { includePrintPdf = true } = {}) {
  const { assembleEditablePptx } = require('./pptx-assembler.cjs');
  const { buildShowcasesForProject } = require('./showcase-builder.cjs');
  const { blankPathForJob, blankFileName } = require('./text-overlay-layout.cjs');
  const jobs = (Array.isArray(project?.jobs) ? project.jobs : [])
    .slice()
    .sort((a, b) => (Number(a.pageNumber) || 0) - (Number(b.pageNumber) || 0));
  if (!jobs.length) {
    throw Object.assign(new Error('No page jobs found to package for Editable PowerPoint.'), {
      code: 'EDITABLE_PAGES_MISSING'
    });
  }

  // Ensure showcase stamps exist for Mockup GPT / packaging.
  await buildShowcasesForProject(project).catch(() => []);

  const folderName = editableVectorFolderName(project);
  const folderPath = join(project.outputDir, folderName);
  mkdirSync(folderPath, { recursive: true });

  const editablePptx = await assembleEditablePptx(project);
  const pptxInFolder = join(folderPath, editablePptx.pptxName);
  writeFileSync(pptxInFolder, readFileSync(editablePptx.pptxPath));
  writeFileSync(join(folderPath, 'HOW_TO_EDIT.txt'), [
    'VERSA CLASS — Editable PowerPoint',
    '=================================',
    '',
    `Open ${editablePptx.pptxName} in Microsoft PowerPoint.`,
    'Each slide uses a text-free blank template as the background.',
    'All titles / name fields / instructions are native PowerPoint text boxes from textOverlays.',
    'Click any text box to edit, move, or recolor it.',
    ''
  ].join('\n'), 'utf8');

  const copiedBackgrounds = [];
  for (const job of jobs) {
    const bg = blankPathForJob(job, project.outputDir);
    if (!bg || !existsSync(bg)) continue;
    const destPath = join(folderPath, blankFileName(job.pageNumber));
    writeFileSync(destPath, readFileSync(bg));
    copiedBackgrounds.push(destPath);
  }

  const zipPath = join(project.outputDir, `${folderName}.zip`);
  await new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    archive.file(pptxInFolder, { name: join(folderName, editablePptx.pptxName) });
    archive.file(join(folderPath, 'HOW_TO_EDIT.txt'), { name: join(folderName, 'HOW_TO_EDIT.txt') });
    archive.file(editablePptx.pptxPath, { name: editablePptx.pptxName });
    for (const filePath of copiedBackgrounds) {
      archive.file(filePath, { name: join(folderName, basename(filePath)) });
    }
    if (includePrintPdf) {
      const printPdf = project.compressedPdfPath && existsSync(project.compressedPdfPath)
        ? project.compressedPdfPath
        : (project.productPdfPath && existsSync(project.productPdfPath) ? project.productPdfPath : null);
      if (printPdf) {
        archive.file(printPdf, { name: join(folderName, `print-${basename(printPdf)}`) });
      }
    }
    archive.finalize();
  });
  return {
    folderPath,
    zipPath,
    svgCount: 0,
    pageCount: editablePptx.slideCount,
    folderName,
    pptxPath: editablePptx.pptxPath,
    pptxName: editablePptx.pptxName,
    slideCount: editablePptx.slideCount
  };
}

function formatPrintPdfBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function bookFileCode(projectOrName = null) {
  if (!projectOrName) return 'book';
  const listingTitle = typeof projectOrName === 'object'
    ? (projectOrName.tptListing?.title || projectOrName.tptListing?.productTitle || '')
    : '';
  const raw = typeof projectOrName === 'string'
    ? projectOrName
    : (listingTitle || projectOrName.name || '');
  const slug = String(raw)
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'book';
}

function compressedPrintPdfDest(outputDir, projectOrName = null) {
  return join(outputDir, 'canva-import', `${bookFileCode(projectOrName)}.pdf`);
}

function defaultThankYouTemplatePath() {
  return join(__dirname, '..', 'assets', 'templates', 'thank-you-page.pdf');
}

function thankYouPdfDest(outputDir, projectOrName = null) {
  return join(outputDir, `${bookFileCode(projectOrName)}-thank-you.pdf`);
}

async function stampThankYouTemplateLink(sourcePath, destPath, templateLink) {
  const href = String(templateLink || '').trim();
  if (!href) {
    throw Object.assign(new Error('A Canva template link is required before stamping the thank-you PDF.'), {
      code: 'THANK_YOU_LINK_MISSING'
    });
  }
  if (!sourcePath || !existsSync(sourcePath)) {
    throw Object.assign(new Error('The default thank-you PDF is missing from the app assets.'), {
      code: 'THANK_YOU_TEMPLATE_MISSING'
    });
  }
  const pdf = await PDFDocument.load(readFileSync(sourcePath), { ignoreEncryption: true });
  let stamped = 0;
  for (const page of pdf.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    const list = pdf.context.lookup(annots);
    const refs = typeof list?.asArray === 'function' ? list.asArray() : [];
    for (const ref of refs) {
      const dict = pdf.context.lookup(ref);
      if (!dict || typeof dict.get !== 'function') continue;
      const actionRef = dict.get(PDFName.of('A'));
      if (!actionRef) continue;
      const action = pdf.context.lookup(actionRef);
      if (!action || typeof action.get !== 'function') continue;
      if (String(action.get(PDFName.of('S')) || '') !== '/URI') continue;
      action.set(PDFName.of('URI'), PDFString.of(href));
      stamped += 1;
    }
  }
  if (!stamped) {
    throw Object.assign(new Error('The thank-you PDF has no Click here link to update.'), {
      code: 'THANK_YOU_LINK_MISSING'
    });
  }
  mkdirSync(dirname(destPath), { recursive: true });
  await atomicWrite(destPath, Buffer.from(await pdf.save({ useObjectStreams: true })));
  return destPath;
}

function allInteriorPagesComplete(project) {
  const jobs = Array.isArray(project?.jobs) ? project.jobs : [];
  const total = Number(project?.stats?.total);
  const complete = Number(project?.stats?.complete);
  if (Number.isFinite(total) && total > 0 && Number.isFinite(complete) && complete !== total) {
    return false;
  }
  const expected = Number.isFinite(total) && total > 0 ? total : jobs.length;
  if (!expected) return false;
  if (jobs.length && jobs.length !== expected) return false;
  const pages = jobs.length ? jobs : [];
  if (!pages.length) return false;
  return pages.every((job) => (
    job?.status === 'complete'
    && job?.outputPath
    && existsSync(job.outputPath)
    && isRasterImagePath(job.outputPath)
  ));
}

function printPdfPageChecksum(jobs = []) {
  const hash = createHash('sha256');
  const pages = [...(Array.isArray(jobs) ? jobs : [])]
    .sort((left, right) => (Number(left?.pageNumber) || 0) - (Number(right?.pageNumber) || 0));
  for (const job of pages) {
    const filePath = String(job?.outputPath || '');
    let size = 0;
    let mtime = 0;
    if (filePath && existsSync(filePath)) {
      const info = statSync(filePath);
      size = Number(info.size) || 0;
      mtime = Math.floor(Number(info.mtimeMs) || 0);
    }
    hash.update(`${Number(job?.pageNumber) || 0}|${filePath}|${size}|${mtime}\n`);
  }
  return hash.digest('hex');
}

async function pdfFilePageCount(filePath) {
  const pdf = await PDFDocument.load(readFileSync(filePath), { ignoreEncryption: true });
  return pdf.getPageCount();
}

function printPdfPackageIsCurrent(project) {
  if (!allInteriorPagesComplete(project)) return false;
  const meta = project?.printPdfJson && typeof project.printPdfJson === 'object' ? project.printPdfJson : {};
  const checksum = printPdfPageChecksum(project.jobs);
  const productPath = project.productPdfPath || meta.productPdfPath;
  const compressedPath = project.compressedPdfPath || meta.compressedPdfPath;
  return meta.stage === 'ready'
    && meta.checksum === checksum
    && productPath
    && existsSync(productPath)
    && compressedPath
    && existsSync(compressedPath);
}

function appendThankYouPdfToArchive(archive, project) {
  const thankYouPath = (project?.thankYouPdfPath && existsSync(project.thankYouPdfPath) && project.thankYouPdfPath)
    || (project?.printPdfJson?.thankYouPdfPath && existsSync(project.printPdfJson.thankYouPdfPath) && project.printPdfJson.thankYouPdfPath)
    || thankYouPdfDest(project?.outputDir, project);
  if (thankYouPath && existsSync(thankYouPath)) {
    archive.file(thankYouPath, { name: basename(thankYouPath) });
  }
}

async function persistPreparedPdf(sourcePath, destPath) {
  mkdirSync(dirname(destPath), { recursive: true });
  const bytes = readFileSync(sourcePath);
  if (sourcePath !== destPath) {
    await atomicWrite(destPath, bytes);
  }
  return { destPath, bytes: bytes.length };
}

/**
 * Copy an already-built print PDF into canva-import/<book-code>.pdf.
 * Does not rasterize pages and does not call compressPdf — Interior already did that.
 */
async function prepareCanvaImportPdf(
  pdfPath,
  outputDir,
  format = 'A4',
  orientation = 'portrait',
  expectedPages = 0,
  pageImagePaths = []
) {
  void format;
  void orientation;
  void pageImagePaths;
  if (!pdfPath || !existsSync(pdfPath)) {
    throw Object.assign(new Error('Export the print PDF before sending it to Canva.'), { code: 'CANVA_PDF_MISSING' });
  }
  const destPath = join(outputDir, 'canva-import', basename(pdfPath) || `${bookFileCode()}.pdf`);
  const want = Number(expectedPages) || 0;
  let sourceCount = 0;
  try {
    sourceCount = await pdfFilePageCount(pdfPath);
  } catch (error) {
    throw Object.assign(
      new Error(`The Canva import PDF could not be read (${error?.message || error}).`),
      { code: 'CANVA_PDF_PAGE_COUNT_MISMATCH' }
    );
  }
  if (want && sourceCount !== want) {
    throw Object.assign(
      new Error(`Print PDF has ${sourceCount} pages but this book has ${want} interior pages. Export the print PDF again, then retry Canva.`),
      { code: 'CANVA_PDF_PAGE_COUNT_MISMATCH' }
    );
  }
  if (existsSync(destPath)) {
    try {
      const destCount = await pdfFilePageCount(destPath);
      if (!want || destCount === want) return destPath;
    } catch {
      // Fall through and recopy the prepared file.
    }
  }
  if (destPath !== pdfPath) {
    await persistPreparedPdf(pdfPath, destPath);
  }
  let destCount = sourceCount;
  try {
    destCount = destPath === pdfPath ? sourceCount : await pdfFilePageCount(destPath);
  } catch (error) {
    throw Object.assign(
      new Error(`The Canva import PDF could not be read after save (${error?.message || error}).`),
      { code: 'CANVA_PDF_PAGE_COUNT_MISMATCH' }
    );
  }
  if (want && destCount !== want) {
    throw Object.assign(
      new Error(`Canva import PDF has ${destCount} pages but this book has ${want} interior pages. The original print PDF was kept instead of a damaged file.`),
      { code: 'CANVA_PDF_PAGE_COUNT_MISMATCH' }
    );
  }
  return destPath;
}

async function prepareCanvaUploadImages(pagePaths = [], outputDir, format = 'A4', orientation = 'portrait') {
  const setup = resolvePageSetup(format, orientation);
  const destDir = join(outputDir, 'canva-pages');
  mkdirSync(destDir, { recursive: true });
  let width = setup.width;
  let height = setup.height;
  const maxEdge = 3000;
  if (Math.max(width, height) > maxEdge) {
    const scale = maxEdge / Math.max(width, height);
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
  }
  const prepared = [];
  for (let index = 0; index < pagePaths.length; index += 1) {
    const source = pagePaths[index];
    if (!source || !existsSync(source)) continue;
    const destPath = join(destDir, `page-${String(index + 1).padStart(3, '0')}.jpg`);
    try {
      await sharp(source)
        .rotate()
        .resize(width, height, { fit: 'fill' })
        .jpeg({ quality: 82, mozjpeg: true })
        .toFile(destPath);
      prepared.push(destPath);
    } catch {
      prepared.push(source);
    }
  }
  return prepared;
}

function selectThumbnailPagePaths(pagePaths, thumbnailIndex = 0, count = 4) {
  const available = (Array.isArray(pagePaths) ? pagePaths : []).filter(Boolean);
  if (!available.length) return [];
  const startIndex = (Number(thumbnailIndex) * count) % available.length;
  return Array.from({ length: count }, (_, offset) => available[(startIndex + offset) % available.length]);
}


function selectPreviewAttachmentPaths({ jobs = [], thumbnailPaths = [], maxCount = 8 } = {}) {
  const thumbs = [...new Set((Array.isArray(thumbnailPaths) ? thumbnailPaths : [])
    .filter((filePath) => filePath && existsSync(filePath) && isRasterImagePath(filePath)))];
  const pages = collectProductPageImagePaths(jobs);
  const pageSet = new Set();
  if (pages.length) {
    pageSet.add(pages[0]);
    if (pages.length > 1) pageSet.add(pages[pages.length - 1]);
    const interiors = pages.slice(1, pages.length > 1 ? -1 : pages.length);
    const extraSlots = Math.max(0, maxCount - thumbs.length - pageSet.size);
    if (interiors.length && extraSlots > 0) {
      if (interiors.length <= extraSlots) {
        for (const filePath of interiors) pageSet.add(filePath);
      } else {
        for (let index = 0; index < extraSlots; index += 1) {
          const position = Math.round((index + 1) * (interiors.length / (extraSlots + 1))) - 1;
          pageSet.add(interiors[Math.max(0, Math.min(interiors.length - 1, position))]);
        }
      }
    }
  }
  const combined = [];
  for (const filePath of [...thumbs, ...pageSet]) {
    if (filePath && !combined.includes(filePath)) combined.push(filePath);
    if (combined.length >= maxCount) break;
  }
  return combined;
}

async function writePageContactSheet(pagePaths, destPath) {
  const cellW = 640;
  const cellH = 860;
  const gap = 12;
  const canvas = new Jimp({
    width: cellW * 2 + gap * 3,
    height: cellH * 2 + gap * 3,
    color: 0xFFF7F1E8
  });
  for (let index = 0; index < 4; index += 1) {
    const sourcePath = pagePaths[index];
    if (!sourcePath || !existsSync(sourcePath)) continue;
    const image = await Jimp.read(sourcePath);
    image.cover({ w: cellW, h: cellH, mode: ResizeStrategy.BICUBIC });
    const x = gap + (index % 2) * (cellW + gap);
    const y = gap + Math.floor(index / 2) * (cellH + gap);
    canvas.composite(image, x, y);
  }
  await atomicWrite(destPath, await canvas.getBuffer('image/png'));
  return destPath;
}

// Gemini's image editor only accepts real image files as edit targets, so every
// page that must appear inside a mockup is re-encoded as a standalone PNG.
async function stageThumbnailPageTargets({ pagePaths, destDir, thumbnailIndex = 0 }) {
  const selected = selectThumbnailPagePaths(pagePaths, thumbnailIndex, 4);
  if (!selected.length) {
    throw Object.assign(new Error('No page images are available to attach for this thumbnail.'), {
      code: 'THUMBNAIL_PAGES_MISSING'
    });
  }
  const fs = require('fs/promises');
  await fs.mkdir(destDir, { recursive: true });
  const pageFiles = [];
  for (let index = 0; index < selected.length; index += 1) {
    const image = await Jimp.read(selected[index]);
    if (Math.max(image.bitmap.width, image.bitmap.height) > THUMBNAIL_PAGE_MAX_EDGE) {
      image.scaleToFit({ w: THUMBNAIL_PAGE_MAX_EDGE, h: THUMBNAIL_PAGE_MAX_EDGE });
    }
    const destPath = join(destDir, `Thumbnail-${Number(thumbnailIndex) + 1}-page-0${index + 1}.png`);
    await atomicWrite(destPath, await image.getBuffer('image/png'));
    pageFiles.push(destPath);
  }
  const contactSheetPath = join(destDir, `Thumbnail-${Number(thumbnailIndex) + 1}-contact-sheet.png`);
  await writePageContactSheet(pageFiles, contactSheetPath);
  return {
    pageFiles,
    contactSheetPath,
    // Contact sheets caused Gemini to collage random pages. Attach only real pages.
    attachmentPaths: [...pageFiles]
  };
}

function isPdfPath(filePath) {
  return extname(String(filePath || '')).toLowerCase() === '.pdf';
}

function isRejectedMockupAttachment(filePath) {
  const value = String(filePath || '');
  return isPdfPath(value) || /contact-sheet/i.test(value);
}

function findExistingBookDocument(outputDir) {
  if (!outputDir || !existsSync(outputDir)) return null;
  let names = [];
  try {
    names = readdirSync(outputDir);
  } catch {
    return null;
  }
  const pick = (ext) => names.find((name) => {
    const lower = String(name || '').toLowerCase();
    return lower.endsWith(ext) && !/booklet/i.test(lower);
  });
  const docx = pick('.docx');
  if (docx) return join(outputDir, docx);
  const pptx = pick('.pptx');
  if (pptx) return join(outputDir, pptx);
  return null;
}

function selectMockupAttachmentPaths({ jobs = [], outputDir = '', thumbnailIndex = 0, maxImages = 4 } = {}) {
  const pages = collectProductPageImagePaths(jobs);
  if (pages.length) {
    return [...new Set(selectThumbnailPagePaths(pages, thumbnailIndex, Math.min(4, maxImages)))]
      .filter((filePath) => filePath && existsSync(filePath) && !isRejectedMockupAttachment(filePath));
  }
  const documentPath = findExistingBookDocument(outputDir);
  if (documentPath && existsSync(documentPath) && !isRejectedMockupAttachment(documentPath)) {
    return [documentPath];
  }
  return [];
}

function xmlEscape(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function writeImagesDocx(pagePaths, destPath) {
  const files = (Array.isArray(pagePaths) ? pagePaths : [])
    .filter((filePath) => (
      filePath
      && existsSync(filePath)
      && (isRasterImagePath(filePath) || isSvgImagePath(filePath))
      && !isRejectedMockupAttachment(filePath)
    ));
  if (!files.length) {
    throw Object.assign(new Error('No page images are available to write a Word document for mockups.'), {
      code: 'THUMBNAIL_PAGES_MISSING'
    });
  }
  mkdirSync(dirname(destPath), { recursive: true });
  const media = [];
  for (let index = 0; index < files.length; index += 1) {
    // Compressed JPEG embeds — readable quality, much smaller than raw PNG masters.
    const jpegBuffer = await pageImageAsExportJpeg(files[index], { maxEdge: THUMBNAIL_PAGE_MAX_EDGE });
    const meta = await sharp(jpegBuffer, { failOn: 'none' }).metadata();
    const width = Number(meta.width) || 1;
    const height = Number(meta.height) || 1;
    const maxCx = 5943600;
    const maxCy = 8229600;
    const ratio = width / height;
    let cx = maxCx;
    let cy = Math.round(cx / ratio);
    if (cy > maxCy) {
      cy = maxCy;
      cx = Math.round(cy * ratio);
    }
    media.push({
      name: `image${index + 1}.jpg`,
      buffer: jpegBuffer,
      cx,
      cy
    });
  }

  const contentTypes = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Default Extension="jpg" ContentType="image/jpeg"/>',
    '<Default Extension="jpeg" ContentType="image/jpeg"/>',
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    '</Types>'
  ].join('');

  const rootRels = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
    '</Relationships>'
  ].join('');

  const documentRels = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    ...media.map((item, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${item.name}"/>`),
    '</Relationships>'
  ].join('');

  const drawings = media.map((item, index) => [
    '<w:p>',
    '<w:r>',
    '<w:drawing>',
    '<wp:inline distT="0" distB="0" distL="0" distR="0">',
    `<wp:extent cx="${item.cx}" cy="${item.cy}"/>`,
    `<wp:docPr id="${index + 1}" name="Picture ${index + 1}"/>`,
    '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>',
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">',
    '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">',
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">',
    '<pic:nvPicPr>',
    `<pic:cNvPr id="${index}" name="${xmlEscape(item.name)}"/>`,
    '<pic:cNvPicPr/>',
    '</pic:nvPicPr>',
    '<pic:blipFill>',
    `<a:blip r:embed="rId${index + 1}"/>`,
    '<a:stretch><a:fillRect/></a:stretch>',
    '</pic:blipFill>',
    '<pic:spPr>',
    '<a:xfrm>',
    '<a:off x="0" y="0"/>',
    `<a:ext cx="${item.cx}" cy="${item.cy}"/>`,
    '</a:xfrm>',
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>',
    '</pic:spPr>',
    '</pic:pic>',
    '</a:graphicData>',
    '</a:graphic>',
    '</wp:inline>',
    '</w:drawing>',
    '</w:r>',
    '</w:p>',
    index < media.length - 1 ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : ''
  ].join('')).join('');

  const documentXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    '<w:body>',
    drawings,
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr>',
    '</w:body>',
    '</w:document>'
  ].join('');

  await new Promise((resolve, reject) => {
    const output = createWriteStream(destPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    archive.append(contentTypes, { name: '[Content_Types].xml' });
    archive.append(rootRels, { name: '_rels/.rels' });
    archive.append(documentXml, { name: 'word/document.xml' });
    archive.append(documentRels, { name: 'word/_rels/document.xml.rels' });
    for (const item of media) {
      archive.append(item.buffer, { name: `word/media/${item.name}` });
    }
    archive.finalize();
  });
  return destPath;
}

class FileManager {
  constructor({ nativeImage }) {
    this.nativeImage = nativeImage;
    this.normalizationQueue = Promise.resolve();
  }

  validateSource(buffer) {
    const image = this.nativeImage.createFromBuffer(buffer);
    if (!image || image.isEmpty()) {
      throw Object.assign(new Error('The downloaded image could not be opened.'), { code: 'IMAGE_DECODE_FAILED' });
    }
    const { width, height } = image.getSize();
    if (width < 256 || height < 256) {
      throw Object.assign(new Error(`The image is too small (${width}×${height}).`), { code: 'IMAGE_TOO_SMALL' });
    }
    const png = image.toPNG();
    if (!png || png.length < 10_000) {
      throw Object.assign(new Error('The image could not be converted into a valid PNG.'), { code: 'PNG_CONVERSION_FAILED' });
    }
    return png;
  }

  async validateAndConvert(buffer, format = 'A4', orientation = 'portrait', zoom = 1.0, offsetX = 0.0, offsetY = 0.0) {
    const png = this.validateSource(buffer);
    const operation = this.normalizationQueue.then(() => normalizePngToPage(png, format, orientation, zoom, offsetX, offsetY));
    this.normalizationQueue = operation.catch(() => {});
    return operation;
  }

  async saveGeneratedImage({ buffer, job, outputDir, format = 'A4', orientation = 'portrait', zoom = 1.0, offsetX = 0.0, offsetY = 0.0 }) {
    mkdirSync(outputDir, { recursive: true });
    const rawPath = join(outputDir, job.fileName.replace(/\.png$/, '.raw.png'));
    if (!existsSync(rawPath)) {
      await atomicWrite(rawPath, buffer);
    }
    const result = await this.validateAndConvert(buffer, format, orientation, zoom, offsetX, offsetY);
    const outputPath = join(outputDir, job.fileName);
    await atomicWrite(outputPath, result.png);
    return { outputPath, width: result.width, height: result.height, dpi: result.dpi };
  }

  async saveGeneratedThumbnail({ buffer, fileName, outputDir }) {
    const png = this.validateSource(buffer);
    const metadata = await sharp(png, { failOn: 'none' }).metadata();
    const width = Number(metadata.width) || 1;
    const height = Number(metadata.height) || 1;
    const scale = Math.min(
      1,
      LISTING_THUMB_MAX_EDGE / Math.max(width, height),
      1600 / width,
      1200 / height
    );
    const newWidth = Math.max(1, Math.round(width * scale));
    const newHeight = Math.max(1, Math.round(height * scale));
    const resized = await sharp(png, { failOn: 'none' })
      .resize(newWidth, newHeight, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
      .toBuffer();

    let payload = null;
    for (const quality of LISTING_THUMB_JPEG_QUALITY) {
      payload = await sharp(resized, { failOn: 'none' })
        .jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:4:4' })
        .toBuffer();
      if (payload.length <= TPT_THUMBNAIL_MAX_BYTES) break;
    }
    if (!payload || payload.length > TPT_THUMBNAIL_MAX_BYTES) {
      throw Object.assign(new Error('The generated thumbnail could not be reduced below TPT\'s 4 MB limit.'), { code: 'TPT_THUMBNAIL_TOO_LARGE' });
    }
    const safeFileName = String(fileName).replace(/\.[^.]+$/, '') + '.jpg';
    const outputPath = join(outputDir, 'tpt-thumbnails', safeFileName);
    await atomicWrite(outputPath, payload);
    return outputPath;
  }


  async saveGeneratedPreviewVideo({ buffer, outputDir, fileName = 'tpt-preview.mp4', contentType = '' } = {}) {
    const payload = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
    if (payload.length < 8_000) {
      throw Object.assign(new Error('The generated preview video is too small to be a valid MP4.'), { code: 'INVALID_PREVIEW_VIDEO' });
    }
    const header = payload.subarray(0, 12);
    const ascii = header.toString('latin1');
    const looksLikeMp4 = ascii.includes('ftyp') || ascii.includes('moov');
    const looksLikeWebm = payload[0] === 0x1A && payload[1] === 0x45;
    const type = String(contentType || '').toLowerCase();
    const looksLikeVideo = looksLikeMp4 || looksLikeWebm || type.startsWith('video/');
    if (!looksLikeVideo) {
      throw Object.assign(new Error('The Veo 3 gem did not return a video file.'), { code: 'INVALID_PREVIEW_VIDEO' });
    }
    let safeName = fileName;
    if (looksLikeWebm && !/\.webm$/i.test(safeName)) safeName = 'tpt-preview.webm';
    const outputPath = join(outputDir, 'tpt-preview', safeName);
    await atomicWrite(outputPath, payload);
    return outputPath;
  }

  async importImage({ sourcePath, job, outputDir, format = 'A4', orientation = 'portrait' }) {
    return this.saveGeneratedImage({ buffer: await require('fs/promises').readFile(sourcePath), job, outputDir, format, orientation });
  }

  async exportZip(project, options = {}) {
    if (project.stats.complete !== project.stats.total) {
      throw Object.assign(new Error('ZIP export is locked until every page is complete.'), { code: 'BOOK_INCOMPLETE' });
    }
    const mode = typeof options === 'string'
      ? options
      : (options && options.exportMode) ? options.exportMode : 'STANDARD_SEQUENTIAL';
    const isBooklet = mode === 'BOOKLET_SADDLE_STITCH';

    const slug = bookFileCode(project);
    const zipName = isBooklet ? `${slug}-booklet.zip` : `${slug}.zip`;
    const zipPath = join(project.outputDir, zipName);
    mkdirSync(project.outputDir, { recursive: true });

    // TPT pack contents only: print PDF, listing mockups/thumbnails, PowerPoint, DOCX.
    // Exclude per-page PNGs, competitor mockups, SVG packs, prompts.txt, giant manifests.
    let pdfPath = resolveExportPackPdfPath(project);
    if (!pdfPath) {
      pdfPath = await this.exportPdf(project, options);
      // Prefer the Interior compressed print PDF when freshly built above left only product PDF.
      const refreshed = resolveExportPackPdfPath(project);
      if (refreshed) pdfPath = refreshed;
    }
    const pptxPath = await this.exportPptx(project, options);
    const docxPath = await this.exportDocx(project);

    const listingThumbs = [...new Set((Array.isArray(project?.tptListing?.thumbnailPaths)
      ? project.tptListing.thumbnailPaths
      : [])
      .filter((filePath) => filePath && existsSync(filePath)))];
    let mockupPaths = listingThumbs;
    if (!mockupPaths.length) {
      const thumbDir = join(project.outputDir, 'tpt-thumbnails');
      if (existsSync(thumbDir)) {
        mockupPaths = readdirSync(thumbDir)
          .filter((name) => /\.(png|jpe?g|webp)$/i.test(name))
          .map((name) => join(thumbDir, name))
          .filter((filePath) => existsSync(filePath));
      }
    }

    await new Promise((resolve, reject) => {
      const output = createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });
      output.on('close', resolve);
      output.on('error', reject);
      archive.on('error', reject);
      archive.pipe(output);

      if (pdfPath && existsSync(pdfPath)) {
        archive.file(pdfPath, { name: basename(pdfPath) });
      }
      if (pptxPath && existsSync(pptxPath)) {
        archive.file(pptxPath, { name: basename(pptxPath) });
      }
      if (docxPath && existsSync(docxPath)) {
        archive.file(docxPath, { name: basename(docxPath) });
      }
      mockupPaths.forEach((filePath, index) => {
        const ext = extname(filePath) || '.jpg';
        archive.file(filePath, { name: join('listing-mockups', `mockup_${index + 1}${ext}`) });
      });

      archive.finalize();
    });

    return zipPath;
  }

  async exportPdf(project, options = {}) {
    if (project.stats.complete !== project.stats.total) {
      throw Object.assign(new Error('PDF export is locked until every page is complete.'), { code: 'BOOK_INCOMPLETE' });
    }
    // If raster page files are missing, reuse the print PDF built during Interior.
    const existingPrint = project.productPdfPath && existsSync(project.productPdfPath)
      ? project.productPdfPath
      : (project.compressedPdfPath && existsSync(project.compressedPdfPath) ? project.compressedPdfPath : null);
    const jobsHaveRaster = (project.jobs || []).some((job) => job?.outputPath && existsSync(job.outputPath) && isRasterImagePath(job.outputPath));
    if (!jobsHaveRaster && existingPrint) {
      return existingPrint;
    }
    const mode = typeof options === 'string'
      ? options
      : (options && options.exportMode) ? options.exportMode : 'STANDARD_SEQUENTIAL';
    const isBooklet = mode === 'BOOKLET_SADDLE_STITCH';

    const setup = resolvePageSetup(project.format, project.orientation);
    const pdf = await PDFDocument.create();
    pdf.setTitle(project.name);
    pdf.setSubject(project.theme);

    const slug = bookFileCode(project);
    const pdfName = isBooklet ? `${slug}-booklet.pdf` : `${slug}.pdf`;
    const outputPath = join(project.outputDir, pdfName);

    if (isBooklet) {
      const imposition = calculateSaddleStitchSpreads(project.jobs.length);
      const spreadPoints = [setup.points[0] * 2, setup.points[1]];

      for (const spread of imposition.spreads) {
        const leftJob = project.jobs[spread.leftPage - 1];
        const rightJob = project.jobs[spread.rightPage - 1];

        const leftPng = leftJob && existsSync(leftJob.outputPath) ? await require('fs/promises').readFile(leftJob.outputPath) : null;
        const rightPng = rightJob && existsSync(rightJob.outputPath) ? await require('fs/promises').readFile(rightJob.outputPath) : null;

        const spreadPng = await createSpreadPng({
          leftPng,
          rightPng,
          format: project.format,
          orientation: project.orientation
        });

        await addCompressedPdfPage(
          pdf,
          spreadPng,
          spreadPoints,
          setup.width * 2,
          setup.height
        );
      }
    } else {
      for (const job of project.jobs) {
        await addCompressedPdfPage(pdf, job.outputPath, setup.points, setup.width, setup.height);
      }
    }

    await atomicWrite(outputPath, Buffer.from(await pdf.save({ useObjectStreams: true })));
    return outputPath;
  }

  async exportPptx(project, options = {}) {
    if (project.stats.complete !== project.stats.total) {
      throw Object.assign(new Error('PPTX export is locked until every page is complete.'), { code: 'BOOK_INCOMPLETE' });
    }
    const jobs = Array.isArray(project.jobs) ? project.jobs : [];
    if (!jobs.length || !jobs.every((job) => job?.outputPath && existsSync(job.outputPath))) {
      throw Object.assign(new Error('PPTX export needs every page file on disk (PNG or SVG).'), {
        code: 'PAGE_IMAGE_MISSING'
      });
    }
    const mode = typeof options === 'string'
      ? options
      : (options && options.exportMode) ? options.exportMode : 'STANDARD_SEQUENTIAL';
    const isBooklet = mode === 'BOOKLET_SADDLE_STITCH';

    const PptxGenJS = require('pptxgenjs');
    const pres = new PptxGenJS();
    pres.title = project.name;
    pres.subject = project.theme;

    const setup = resolvePageSetup(project.format, project.orientation);
    
    const widthInches = (isBooklet ? setup.points[0] * 2 : setup.points[0]) / 72;
    const heightInches = setup.points[1] / 72;
    
    pres.defineLayout({
      name: 'CUSTOM',
      width: widthInches,
      height: heightInches
    });
    pres.layout = 'CUSTOM';

    const slug = bookFileCode(project);
    const pptxName = isBooklet ? `${slug}-booklet.pptx` : `${slug}.pptx`;
    const outputPath = require('node:path').join(project.outputDir, pptxName);

    if (isBooklet) {
      const imposition = calculateSaddleStitchSpreads(jobs.length);
      for (const spread of imposition.spreads) {
        const leftJob = jobs[spread.leftPage - 1];
        const rightJob = jobs[spread.rightPage - 1];

        const leftPng = leftJob?.outputPath && existsSync(leftJob.outputPath)
          ? await pageImageAsPngBuffer(leftJob.outputPath)
          : null;
        const rightPng = rightJob?.outputPath && existsSync(rightJob.outputPath)
          ? await pageImageAsPngBuffer(rightJob.outputPath)
          : null;

        const spreadPng = await createSpreadPng({
          leftPng,
          rightPng,
          format: project.format,
          orientation: project.orientation
        });
        const jpegBuffer = await pageImageAsExportJpeg(spreadPng, {
          maxEdge: Math.round(EXPORT_EMBED_MAX_EDGE * 1.5)
        });

        const slide = pres.addSlide();
        slide.addImage({
          data: `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`,
          x: 0,
          y: 0,
          w: widthInches,
          h: heightInches
        });

        let notes = [];
        if (leftJob && leftJob.storyText) notes.push(`Left Page (${leftJob.pageLabel}): ${leftJob.storyText}`);
        if (rightJob && rightJob.storyText) notes.push(`Right Page (${rightJob.pageLabel}): ${rightJob.storyText}`);
        if (notes.length > 0) slide.addNotes(notes.join('\n\n'));
      }
    } else {
      for (const job of jobs) {
        const slide = pres.addSlide();
        const pagePath = String(job.outputPath || '');
        // JPEG embeds keep visual quality while shrinking PPTX vs raw PNG masters.
        const jpegBuffer = await pageImageAsExportJpeg(pagePath);
        slide.addImage({
          data: `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`,
          x: 0,
          y: 0,
          w: widthInches,
          h: heightInches
        });
        if (job.storyText) {
          slide.addNotes(job.storyText);
        }
      }
    }
    
    const buffer = await pres.write({ outputType: 'nodebuffer' });
    await atomicWrite(outputPath, buffer);
    return outputPath;
  }

  async exportDocx(project) {
    if (project.stats.complete !== project.stats.total) {
      throw Object.assign(new Error('DOCX export is locked until every page is complete.'), { code: 'BOOK_INCOMPLETE' });
    }
    const jobs = Array.isArray(project.jobs) ? project.jobs : [];
    if (!jobs.length || !jobs.every((job) => job?.outputPath && existsSync(job.outputPath))) {
      throw Object.assign(new Error('DOCX export needs every page file on disk (PNG or SVG).'), {
        code: 'PAGE_IMAGE_MISSING'
      });
    }
    const pages = jobs
      .slice()
      .sort((left, right) => (Number(left?.pageNumber) || 0) - (Number(right?.pageNumber) || 0))
      .map((job) => job.outputPath);
    const slug = bookFileCode(project);
    const outputPath = join(project.outputDir, `${slug}.docx`);
    // writeImagesDocx embeds compressed JPEG page images (SVG→raster in memory if needed).
    return writeImagesDocx(pages, outputPath);
  }

  async exportThankYouPdf(project, templateLink) {
    const source = defaultThankYouTemplatePath();
    const destPath = thankYouPdfDest(project.outputDir, project);
    return stampThankYouTemplateLink(source, destPath, templateLink);
  }

  /**
   * After every interior page exists: convert to a print PDF, then compress it.
   * The compressed file is written to canva-import/<book-code>.pdf for Canva to reuse.
   */
  async buildPrintPdfPackage(project, options = {}) {
    if (!allInteriorPagesComplete(project)) {
      throw Object.assign(new Error('PDF export is locked until every page is complete.'), { code: 'BOOK_INCOMPLETE' });
    }
    const checksum = printPdfPageChecksum(project.jobs);
    const expectedPages = (project.jobs || []).length;
    if (typeof options.onProgress === 'function') {
      await options.onProgress({
        stage: 'converting',
        checksum,
        pageCount: expectedPages,
        message: 'Converting pages to PDF…'
      });
    }
    const productPdfPath = await this.exportPdf(project);
    const originalBytes = existsSync(productPdfPath) ? statSync(productPdfPath).size : 0;
    if (typeof options.onProgress === 'function') {
      await options.onProgress({
        stage: 'compressing',
        checksum,
        productPdfPath,
        originalBytes,
        pageCount: expectedPages,
        message: `Compressing print PDF (${formatPrintPdfBytes(originalBytes)})…`
      });
    }
    const compress = options.compressPdf || (await import('./compress-pdf.mjs')).compressPdf;
    const compression = await compress(productPdfPath);
    const fromPath = (compression && compression.path) || productPdfPath;
    const destPath = compressedPrintPdfDest(project.outputDir, project);
    await persistPreparedPdf(fromPath, destPath);
    if (fromPath !== productPdfPath && fromPath !== destPath) {
      try { rmSync(fromPath, { force: true }); } catch {}
    }
    const outputBytes = existsSync(destPath) ? statSync(destPath).size : (Number(compression?.outputBytes) || originalBytes);
    const skipped = Boolean(compression?.skipped || fromPath === productPdfPath);
    if (typeof options.onProgress === 'function') {
      const sizeLine = skipped
        ? `Print PDF ready (${formatPrintPdfBytes(originalBytes)}).`
        : `Print PDF ready (${formatPrintPdfBytes(compression?.originalBytes || originalBytes)} → ${formatPrintPdfBytes(outputBytes)}).`;
      await options.onProgress({
        stage: 'ready',
        checksum,
        productPdfPath,
        compressedPdfPath: destPath,
        originalBytes: Number(compression?.originalBytes) || originalBytes,
        outputBytes,
        skipped,
        reason: compression?.reason || null,
        pageCount: compression?.outputPageCount || expectedPages,
        message: sizeLine
      });
    }
    return {
      productPdfPath,
      compressedPdfPath: destPath,
      checksum,
      originalBytes: Number(compression?.originalBytes) || originalBytes,
      outputBytes,
      skipped,
      reason: compression?.reason || null,
      pageCount: compression?.outputPageCount || compression?.inputPageCount || expectedPages,
      imagesReplaced: Number(compression?.imagesReplaced) || 0
    };
  }
}

module.exports = {
  PAGE_SETUPS,
  PRINT_PDF_JPEG,
  EXPORT_EMBED_JPEG,
  EXPORT_EMBED_MAX_EDGE,
  FileManager,
  addPngResolution,
  addCompressedPdfPage,
  allInteriorPagesComplete,
  atomicWrite,
  collectProductPageImagePaths,
  collectProductPageSvgPaths,
  editableVectorFolderName,
  packageEditableVectorFiles,
  bookFileCode,
  compressedPrintPdfDest,
  defaultThankYouTemplatePath,
  thankYouPdfDest,
  stampThankYouTemplateLink,
  encodePrintPdfJpeg,
  formatPrintPdfBytes,
  pageImageAsPngBuffer,
  pageImageAsExportJpeg,
  resolveExportPackPdfPath,
  persistPreparedPdf,
  prepareCanvaImportPdf,
  prepareCanvaUploadImages,
  printPdfPackageIsCurrent,
  printPdfPageChecksum,
  createSpreadPng,
  normalizePngToPage,
  resolvePageSetup,
  selectThumbnailPagePaths,
  selectPreviewAttachmentPaths,
  selectMockupAttachmentPaths,
  findExistingBookDocument,
  isRejectedMockupAttachment,
  isRasterImagePath,
  isSvgImagePath,
  writeImagesDocx,
  stageThumbnailPageTargets
};
