const { createHash } = require('node:crypto');
const {
  copyFileSync,
  cpSync,
  createWriteStream,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} = require('node:fs');
const { basename, dirname, extname, join } = require('node:path');
const CRC32 = require('crc-32');
function createZipArchive() {
  return require('archiver')('zip', { zlib: { level: 9 } });
}
let sharpLib = null;
function getSharp() {
  if (!sharpLib) {
    sharpLib = require('sharp');
  }
  return sharpLib;
}

const { calculateSaddleStitchSpreads } = require('./imposition.cjs');
const { getPdf, hasValidPdfFile } = require('./pdf-state.cjs');
const { getMockups } = require('./mockups-state.cjs');
const { getVideo } = require('./video-state.cjs');
const { getSeo } = require('./seo-state.cjs');

const TPT_THUMBNAIL_MAX_BYTES = 4 * 1024 * 1024;
const THUMBNAIL_PAGE_MAX_EDGE = 1400;
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
  return getSharp()(source, { failOn: 'none' })
    .rotate()
    .resize(width, height, { fit: 'fill', kernel: getSharp().kernel.lanczos3 })
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

const CARD_PREVIEW_MAX_EDGE = 720;

function cardPreviewPathFor(outputPath) {
  const value = String(outputPath || '');
  if (!value) return '';
  return value.replace(/\.(png|jpe?g|webp)$/i, '.card.jpg');
}

async function ensureCardPreview(sourcePath, destPath = cardPreviewPathFor(sourcePath)) {
  if (!sourcePath || !destPath || !existsSync(sourcePath)) return null;
  if (existsSync(destPath)) return destPath;
  const jpeg = await getSharp()(sourcePath, { failOn: 'none' })
    .rotate()
    .resize({
      width: CARD_PREVIEW_MAX_EDGE,
      height: CARD_PREVIEW_MAX_EDGE,
      fit: 'inside',
      withoutEnlargement: true
    })
    .jpeg({ quality: 72, mozjpeg: true })
    .toBuffer();
  await atomicWrite(destPath, jpeg);
  return destPath;
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
  let input;
  try {
    const meta = await getSharp()(png).metadata();
    const srcW = Number(meta.width) || 0;
    const srcH = Number(meta.height) || 0;
    const parsedZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1.0;
    const parsedOffsetX = Number.isFinite(offsetX) ? offsetX : 0.0;
    const parsedOffsetY = Number.isFinite(offsetY) ? offsetY : 0.0;

    if (parsedZoom !== 1.0 || parsedOffsetX !== 0.0 || parsedOffsetY !== 0.0) {
      const scale = Math.max(setup.width / srcW, setup.height / srcH) * parsedZoom;
      const newW = Math.max(setup.width, Math.round(srcW * scale));
      const newH = Math.max(setup.height, Math.round(srcH * scale));
      const resized = await getSharp()(png).resize(newW, newH).png().toBuffer();
      const maxShiftX = newW - setup.width;
      const maxShiftY = newH - setup.height;
      const centerX = (newW - setup.width) / 2;
      const centerY = (newH - setup.height) / 2;
      const cropX = Math.max(0, Math.min(newW - setup.width, Math.round(centerX - (parsedOffsetX * maxShiftX / 2))));
      const cropY = Math.max(0, Math.min(newH - setup.height, Math.round(centerY - (parsedOffsetY * maxShiftY / 2))));
      input = await getSharp()(resized).extract({ left: cropX, top: cropY, width: setup.width, height: setup.height }).png().toBuffer();
    } else {
      input = await getSharp()(png).resize(setup.width, setup.height, { fit: 'cover', position: 'centre' }).png().toBuffer();
    }
  } catch (error) {
    throw Object.assign(new Error(`The image could not be normalized: ${error.message}`), { code: 'IMAGE_NORMALIZE_FAILED' });
  }

  const normalized = addPngResolution(input, 300);
  if (normalized.length < 10_000) {
    throw Object.assign(new Error('The image could not be converted into a valid print-ready PNG.'), { code: 'PNG_CONVERSION_FAILED' });
  }
  return { png: normalized, width: setup.width, height: setup.height, dpi: 300 };
}

async function blankPng(width, height, background = { r: 255, g: 255, b: 255, alpha: 1 }) {
  return getSharp()({
    create: { width, height, channels: 4, background }
  }).png().toBuffer();
}

async function createSpreadPng({ leftPng, rightPng, format = 'A4', orientation = 'portrait' }) {
  const setup = resolvePageSetup(format, orientation);
  const spreadWidth = setup.width * 2;
  const spreadHeight = setup.height;
  const leftImage = leftPng ? await getSharp()(leftPng).png().toBuffer() : await blankPng(setup.width, setup.height);
  const rightImage = rightPng ? await getSharp()(rightPng).png().toBuffer() : await blankPng(setup.width, setup.height);
  const png = await getSharp()({
    create: { width: spreadWidth, height: spreadHeight, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } }
  }).composite([
    { input: leftImage, left: 0, top: 0 },
    { input: rightImage, left: setup.width, top: 0 }
  ]).png().toBuffer();
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
    return getSharp()(path, { density: 150, failOn: 'none' }).png().toBuffer();
  }
  if (extname(path).toLowerCase() === '.png') {
    return require('fs/promises').readFile(path);
  }
  return getSharp()(path, { failOn: 'none' }).png().toBuffer();
}

/**
 * Encode a page (or in-memory PNG buffer) as compressed JPEG for PPTX / DOCX embeds.
 */
async function pageImageAsExportJpeg(source, { maxEdge = EXPORT_EMBED_MAX_EDGE } = {}) {
  const input = Buffer.isBuffer(source)
    ? source
    : await pageImageAsPngBuffer(source);
  let pipeline = getSharp()(input, { failOn: 'none' }).rotate();
  const meta = await pipeline.metadata();
  const width = Number(meta.width) || 1;
  const height = Number(meta.height) || 1;
  if (Math.max(width, height) > maxEdge) {
    pipeline = pipeline.resize({
      width: width >= height ? maxEdge : undefined,
      height: height > width ? maxEdge : undefined,
      fit: 'inside',
      withoutEnlargement: true,
      kernel: getSharp().kernel.lanczos3
    });
  }
  return pipeline.jpeg(EXPORT_EMBED_JPEG).toBuffer();
}

function resolveExportPackPdfPath(project) {
  const pdf = getPdf(project);
  const compressed = hasValidPdfFile(pdf.compressedPath) ? pdf.compressedPath : null;
  if (compressed) return compressed;
  if (hasValidPdfFile(pdf.productPath)) return pdf.productPath;
  const dest = project?.outputDir ? compressedPrintPdfDest(project.outputDir, project) : null;
  return dest && hasValidPdfFile(dest) ? dest : null;
}

function isValidExportFile(filePath, { minBytes = 1 } = {}) {
  if (!filePath || !existsSync(filePath)) return false;
  try {
    const info = statSync(filePath);
    return info.isFile() && Number(info.size) >= minBytes;
  } catch {
    return false;
  }
}

function collectFinalMockupPaths(project) {
  // Phase 3A: read via getMockups (new nested state + legacy thumbnailPaths fallback).
  const mockups = getMockups(project);
  const fromListing = [...new Set((Array.isArray(mockups.paths) ? mockups.paths : [])
    .filter((filePath) => isValidExportFile(filePath)))];
  if (fromListing.length) return fromListing;
  const thumbDir = project?.outputDir ? join(project.outputDir, 'tpt-thumbnails') : null;
  if (!thumbDir || !existsSync(thumbDir)) return [];
  try {
    return readdirSync(thumbDir)
      .filter((name) => /\.(png|jpe?g|webp)$/i.test(name))
      .map((name) => join(thumbDir, name))
      .filter((filePath) => isValidExportFile(filePath))
      .sort((left, right) => basename(left).localeCompare(basename(right)));
  } catch {
    return [];
  }
}

function resolveFinalExportSeoText(project) {
  const seo = getSeo(project);
  if (isValidExportFile(seo.listingDetailsPath)) {
    try {
      const fromFile = readFileSync(seo.listingDetailsPath, 'utf8').trim();
      if (fromFile) return fromFile;
    } catch {}
  }
  const text = typeof seo.seoText === 'string' ? seo.seoText.trim() : '';
  return text || '';
}

function resolveFinalExportVideoPath(project) {
  // Phase 3B: read via getVideo (new nested state + legacy videoPreviewPath fallback).
  // Filesystem authority: only an existing file is exportable.
  const videoPath = getVideo(project).path;
  return isValidExportFile(videoPath, { minBytes: 8_000 }) ? videoPath : null;
}

// TPT listing images are square. Gemini returns whatever it returns, so every mockup
// is normalised to exactly this before it ships - a listing built from four different
// sizes looks unfinished on the storefront grid.
const MOCKUP_EXPORT_EDGE = 2000;

/**
 * Write each mockup out at exactly 2000x2000.
 *
 * `contain` on a white ground rather than `cover`: these are product mockups, and
 * cropping one to fill a square silently cuts the edges off the very thing being sold.
 */
async function normalizeMockupsForExport(paths, destDir) {
  mkdirSync(destDir, { recursive: true });
  const written = [];
  for (const [index, source] of paths.entries()) {
    // Keep the source extension. Rewriting a .jpg as a .png would change the entry
    // name every consumer of the manifest already expects, for no benefit the buyer
    // can see - the size is what matters, not the container.
    const ext = (extname(source) || '.jpg').toLowerCase();
    const target = join(destDir, `mockup_${String(index + 1).padStart(2, '0')}${ext}`);
    try {
      const pipeline = getSharp()(source, { failOn: 'none' }).resize(
        MOCKUP_EXPORT_EDGE, MOCKUP_EXPORT_EDGE,
        { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } }
      );
      await (ext === '.png' ? pipeline.png({ compressionLevel: 9 }) : pipeline.jpeg({ quality: 92 }))
        .toFile(target);
      written.push(isValidExportFile(target) ? target : source);
    } catch {
      // A mockup that will not decode ships exactly as it arrived rather than not at all.
      written.push(source);
    }
  }
  return written;
}

/**
 * Guarantee the preview ships as a real .mp4.
 *
 * Renaming a container would be a lie that only shows up when the buyer tries to play
 * it, so a non-mp4 source is transcoded with ffmpeg. H.264 + AAC in a faststart mp4 is
 * what plays everywhere without a codec pack. If ffmpeg is unavailable the original
 * file is returned untouched and the manifest keeps its true extension.
 */
async function ensureMp4Preview(videoPath, destDir) {
  if (!videoPath) return null;
  if (extname(videoPath).toLowerCase() === '.mp4') return videoPath;
  const { execFile } = require('node:child_process');
  const target = join(destDir, `${basename(videoPath, extname(videoPath))}.mp4`);
  mkdirSync(destDir, { recursive: true });
  try {
    await new Promise((resolve, reject) => {
      execFile('ffmpeg', [
        '-y', '-i', videoPath,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        target
      ], { timeout: 180_000 }, (error) => (error ? reject(error) : resolve()));
    });
    return isValidExportFile(target, { minBytes: 8_000 }) ? target : videoPath;
  } catch {
    return videoPath;
  }
}

/**
 * Deterministic final-export manifest. Does not invent files.
 * Required: pdf, pptx, docx and video. Exactly four mockups when they exist.
 *
 * SEO is deliberately not required. The listing copy is written to be read in the app
 * and pasted into TPT; a buyer never receives it, so a missing one must not be able to
 * block a finished book from exporting.
 */
function buildFinalExportManifest(project, sources = {}) {
  const code = bookFileCode(project);
  const booklet = sources.exportMode === 'BOOKLET_SADDLE_STITCH';
  const pdfPath = sources.pdfPath || null;
  const pptxPath = sources.pptxPath || null;
  const docxPath = sources.docxPath || null;
  const videoPath = sources.videoPath !== undefined ? sources.videoPath : resolveFinalExportVideoPath(project);
  const seoText = sources.seoText !== undefined ? sources.seoText : resolveFinalExportSeoText(project);
  const mockupPaths = Array.isArray(sources.mockupPaths) ? sources.mockupPaths : collectFinalMockupPaths(project);

  const artifact = (type, {
    required = false,
    sourcePath = null,
    finalName,
    valid = null,
    reason = null
  }) => {
    const exists = valid == null ? isValidExportFile(sourcePath) : Boolean(valid);
    const status = exists ? 'included' : 'missing';
    return {
      type,
      required: Boolean(required),
      sourcePath: sourcePath || null,
      finalName,
      status,
      included: status === 'included',
      reason: status === 'missing'
        ? (reason || (required ? `Required ${type} is missing.` : `Optional ${type} was not generated.`))
        : null
    };
  };

  const videoExt = videoPath ? (extname(videoPath).toLowerCase() || '.mp4') : '.mp4';
  const artifacts = [
    artifact('pdf', {
      // Editable products ship as .pptx/.docx and never build a print PDF.
      required: String(project?.productFormat || '').toLowerCase() !== 'editable',
      sourcePath: pdfPath,
      finalName: booklet ? `${code}-booklet.pdf` : `${code}.pdf`,
      reason: 'Required PDF is missing.'
    }),
    artifact('pptx', {
      required: true,
      sourcePath: pptxPath,
      finalName: booklet ? `${code}-booklet.pptx` : `${code}.pptx`,
      reason: 'Required PowerPoint is missing.'
    }),
    artifact('docx', {
      required: true,
      sourcePath: docxPath,
      finalName: `${code}.docx`,
      reason: 'Required document is missing.'
    }),
    artifact('video', {
      required: true,
      sourcePath: videoPath,
      finalName: `${code}_video${videoExt}`,
      reason: 'Video Preview was not generated.'
    }),
    artifact('seo', {
      // Convenience copy only - the listing copy lives in the app, not in the buyer's
      // download, so its absence is not a reason to fail the export.
      required: false,
      sourcePath: null,
      finalName: 'listing_details.txt',
      valid: Boolean(seoText),
      reason: 'SEO text was not generated.'
    })
  ];

  const mockups = mockupPaths.slice(0, 4).map((filePath, index) => {
    const ext = extname(filePath) || '.jpg';
    const finalName = join('mockups', `mockup_${String(index + 1).padStart(2, '0')}${ext}`);
    return {
      type: 'mockup',
      required: false,
      sourcePath: filePath,
      finalName,
      status: 'included',
      included: true,
      reason: null,
      index: index + 1
    };
  });
  if (!mockups.length) {
    artifacts.push(artifact('mockups', {
      required: true,
      sourcePath: null,
      finalName: 'mockups/',
      valid: false,
      reason: 'Mockups were not generated.'
    }));
  } else {
    artifacts.push({
      type: 'mockups',
      required: true,
      sourcePath: null,
      finalName: 'mockups/',
      status: mockups.length === 4 ? 'included' : 'missing',
      included: mockups.length === 4,
      reason: mockups.length === 4 ? null : `Only ${mockups.length} of 4 mockups were generated.`,
      count: mockups.length
    });
  }

  const included = [
    ...artifacts.filter((item) => item.included && item.type !== 'mockups'),
    ...mockups
  ];
  const missing = artifacts.filter((item) => !item.included);
  const requiredMissing = missing.filter((item) => item.required);

  return {
    productCode: code,
    exportMode: booklet ? 'BOOKLET_SADDLE_STITCH' : 'STANDARD_SEQUENTIAL',
    seoText: seoText || '',
    artifacts,
    mockups,
    included,
    missing,
    requiredMissing,
    complete: requiredMissing.length === 0,
    expectedZipEntries: included.map((item) => item.finalName.replace(/\\/g, '/'))
  };
}

function assertFinalExportManifestComplete(manifest) {
  if (manifest?.complete) return manifest;
  const missing = (manifest?.requiredMissing || [])
    .map((item) => item.type.toUpperCase())
    .join(', ');
  throw Object.assign(
    new Error(`Final export is incomplete. Missing required artifact(s): ${missing || 'unknown'}.`),
    {
      code: 'EXPORT_MANIFEST_INCOMPLETE',
      manifest,
      missing: manifest?.requiredMissing || []
    }
  );
}

const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;
const ZIP_MAX_END_RECORD_SIZE = 65_557;

function readZipRange(fd, length, position) {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const bytesRead = readSync(fd, buffer, offset, length - offset, position + offset);
    if (bytesRead === 0) {
      throw Object.assign(new Error('Final export ZIP ended unexpectedly.'), { code: 'EXPORT_ZIP_CORRUPT' });
    }
    offset += bytesRead;
  }
  return buffer;
}

/**
 * Read and validate the ZIP directory without extracting files or invoking an
 * operating-system command. VERSA exports regular, single-disk, non-ZIP64 ZIPs.
 */
function inspectFinalExportZip(zipPath) {
  let info;
  try {
    info = statSync(zipPath);
  } catch {
    throw Object.assign(new Error('Final export ZIP is missing.'), { code: 'EXPORT_ZIP_MISSING' });
  }
  if (!info.isFile()) {
    throw Object.assign(new Error('Final export ZIP path is not a file.'), { code: 'EXPORT_ZIP_INVALID' });
  }
  if (info.size === 0) {
    throw Object.assign(new Error('Final export ZIP is empty.'), { code: 'EXPORT_ZIP_EMPTY' });
  }

  const fd = openSync(zipPath, 'r');
  try {
    const tailLength = Math.min(info.size, ZIP_MAX_END_RECORD_SIZE);
    const tailPosition = info.size - tailLength;
    const tail = readZipRange(fd, tailLength, tailPosition);
    let endOffset = -1;
    for (let offset = tail.length - 22; offset >= 0; offset -= 1) {
      if (tail.readUInt32LE(offset) === ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
        endOffset = offset;
        break;
      }
    }
    if (endOffset < 0) {
      throw Object.assign(new Error('Final export ZIP has no valid central directory.'), { code: 'EXPORT_ZIP_CORRUPT' });
    }

    const absoluteEndOffset = tailPosition + endOffset;
    const diskNumber = tail.readUInt16LE(endOffset + 4);
    const centralDisk = tail.readUInt16LE(endOffset + 6);
    const entriesOnDisk = tail.readUInt16LE(endOffset + 8);
    const totalEntries = tail.readUInt16LE(endOffset + 10);
    const centralSize = tail.readUInt32LE(endOffset + 12);
    const centralOffset = tail.readUInt32LE(endOffset + 16);
    const commentLength = tail.readUInt16LE(endOffset + 20);
    if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== totalEntries
      || totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
      throw Object.assign(new Error('Final export ZIP uses an unsupported multi-disk or ZIP64 structure.'), { code: 'EXPORT_ZIP_CORRUPT' });
    }
    if (absoluteEndOffset + 22 + commentLength !== info.size
      || centralOffset + centralSize !== absoluteEndOffset) {
      throw Object.assign(new Error('Final export ZIP central-directory bounds are invalid.'), { code: 'EXPORT_ZIP_CORRUPT' });
    }

    const central = readZipRange(fd, centralSize, centralOffset);
    const entries = [];
    const seen = new Set();
    let cursor = 0;
    for (let index = 0; index < totalEntries; index += 1) {
      if (cursor + 46 > central.length || central.readUInt32LE(cursor) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
        throw Object.assign(new Error('Final export ZIP central directory is malformed.'), { code: 'EXPORT_ZIP_CORRUPT' });
      }
      const flags = central.readUInt16LE(cursor + 8);
      const compressedSize = central.readUInt32LE(cursor + 20);
      const uncompressedSize = central.readUInt32LE(cursor + 24);
      const nameLength = central.readUInt16LE(cursor + 28);
      const extraLength = central.readUInt16LE(cursor + 30);
      const entryCommentLength = central.readUInt16LE(cursor + 32);
      const localOffset = central.readUInt32LE(cursor + 42);
      const recordLength = 46 + nameLength + extraLength + entryCommentLength;
      if ((flags & 0x0001) !== 0 || cursor + recordLength > central.length
        || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
        throw Object.assign(new Error('Final export ZIP contains an invalid or unsupported entry.'), { code: 'EXPORT_ZIP_CORRUPT' });
      }
      const name = central.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8').replace(/\\/g, '/');
      if (!name || name.startsWith('/') || name.split('/').includes('..') || seen.has(name)) {
        throw Object.assign(new Error('Final export ZIP contains an unsafe or duplicate entry.'), { code: 'EXPORT_ZIP_CORRUPT' });
      }

      const local = readZipRange(fd, 30, localOffset);
      if (local.readUInt32LE(0) !== ZIP_LOCAL_FILE_SIGNATURE) {
        throw Object.assign(new Error('Final export ZIP contains an invalid local file record.'), { code: 'EXPORT_ZIP_CORRUPT' });
      }
      const localNameLength = local.readUInt16LE(26);
      const localExtraLength = local.readUInt16LE(28);
      const localName = readZipRange(fd, localNameLength, localOffset + 30).toString('utf8').replace(/\\/g, '/');
      const dataEnd = localOffset + 30 + localNameLength + localExtraLength + compressedSize;
      if (localName !== name || dataEnd > centralOffset) {
        throw Object.assign(new Error('Final export ZIP entry bounds are invalid.'), { code: 'EXPORT_ZIP_CORRUPT' });
      }
      seen.add(name);
      entries.push(name);
      cursor += recordLength;
    }
    if (cursor !== central.length) {
      throw Object.assign(new Error('Final export ZIP central directory contains trailing data.'), { code: 'EXPORT_ZIP_CORRUPT' });
    }
    return entries;
  } finally {
    closeSync(fd);
  }
}

function materializeFinalExportSeoFile(manifest, stagingDir) {
  if (!manifest?.seoText) return null;
  const seoEntry = (manifest.artifacts || []).find((item) => item.type === 'seo' && item.included);
  if (!seoEntry) return null;
  mkdirSync(stagingDir, { recursive: true });
  const dest = join(stagingDir, basename(seoEntry.finalName));
  writeFileSync(dest, `${manifest.seoText.trim()}\n`, 'utf8');
  return dest;
}

function writeFinalExportPackageFromManifest(manifest, destDir, { seoFilePath = null } = {}) {
  assertFinalExportManifestComplete(manifest);
  mkdirSync(destDir, { recursive: true });
  const written = [];
  for (const item of manifest.artifacts) {
    if (!item.included || item.type === 'mockups' || item.type === 'mockup') continue;
    if (item.type === 'seo') {
      const source = seoFilePath || materializeFinalExportSeoFile(manifest, destDir);
      if (!source || !existsSync(source)) {
        throw Object.assign(new Error('SEO TXT could not be written for final export.'), {
          code: 'EXPORT_SEO_WRITE_FAILED'
        });
      }
      const dest = join(destDir, item.finalName);
      if (source !== dest) copyFileSync(source, dest);
      written.push(item.finalName.replace(/\\/g, '/'));
      continue;
    }
    if (!item.sourcePath || !existsSync(item.sourcePath)) {
      throw Object.assign(new Error(`Final export source missing for ${item.type}.`), {
        code: 'EXPORT_SOURCE_MISSING',
        artifact: item
      });
    }
    const dest = join(destDir, item.finalName);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(item.sourcePath, dest);
    written.push(item.finalName.replace(/\\/g, '/'));
  }
  for (const item of manifest.mockups) {
    const dest = join(destDir, item.finalName);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(item.sourcePath, dest);
    written.push(item.finalName.replace(/\\/g, '/'));
  }
  const expected = [...manifest.expectedZipEntries].sort();
  const actual = [...written].sort();
  if (expected.length !== actual.length || expected.some((name, index) => name !== actual[index])) {
    throw Object.assign(new Error('Final export package contents do not match the manifest.'), {
      code: 'EXPORT_MANIFEST_MISMATCH',
      expected,
      actual
    });
  }
  return { destDir, written: actual, manifest };
}

function collectProductPageImagePaths(jobs = []) {
  return [...new Set((Array.isArray(jobs) ? jobs : [])
    .slice()
    .sort((left, right) => (Number(left?.pageNumber) || 0) - (Number(right?.pageNumber) || 0))
    .map((job) => job?.outputPath)
    .filter((filePath) => filePath && existsSync(filePath) && isRasterImagePath(filePath)))];
}

function resolvedExportPages(project) {
  const { isMazeProduct, buildMazeExportPageArray } = require('./maze-export.cjs');
  if (isMazeProduct(project)) return buildMazeExportPageArray(project);
  const { buildExportPageArray } = require('./editable-production.cjs');
  return buildExportPageArray(project);
}

// Interior pages the preview video is given to animate.
//
// Gemini's video model cannot read a Word document: handed only the compiled .docx it
// has nothing visual to work from and sits in analysis until the step times out. The
// mockup generator is the opposite - it reads the document and draws from it - which is
// why the two stages are fed differently.
//
// Five to eight. Enough for the model to cut between pages and show what the pack
// contains; few enough that a 200 page book cannot blow the context, which is exactly
// what attaching every page used to do.
const PREVIEW_PAGE_FRAME_MIN = 5;
const PREVIEW_PAGE_FRAME_MAX = 8;
const PREVIEW_PAGE_FRAME_COUNT = 6;

/**
 * Interior pages to animate in the preview video, spread across the middle of the book.
 *
 * The first and last pages are excluded. The first is the cover and the last is the
 * thank-you page: both are generated as stock images rather than product content, so a
 * preview built from them advertises the packaging instead of the pack - and the cover
 * already has four mockups of its own.
 *
 * What is left is sampled evenly from the first interior page to the last, so a buyer
 * sees the shape of the whole book rather than a run of consecutive pages.
 */
function selectPreviewFramePaths(jobs = [], limit = PREVIEW_PAGE_FRAME_COUNT) {
  const { isMazeExportRole, selectMazePreviewFramePaths } = require('./maze-export.cjs');
  if ((Array.isArray(jobs) ? jobs : []).some((job) => isMazeExportRole(job?.kind))) {
    return selectMazePreviewFramePaths(jobs, limit);
  }
  const pages = collectProductPageImagePaths(jobs);
  // Drop the cover and the thank-you page. A book with nothing between them has no
  // interior to preview, and this correctly yields nothing.
  const interior = pages.slice(1, -1);
  const cap = Math.min(
    PREVIEW_PAGE_FRAME_MAX,
    Math.max(PREVIEW_PAGE_FRAME_MIN, Math.round(limit) || PREVIEW_PAGE_FRAME_COUNT)
  );
  // A short book sends every interior page it has: below the band is all there is.
  if (interior.length <= cap) return interior;
  const picked = [];
  for (let index = 0; index < cap; index += 1) {
    picked.push(interior[Math.round((index * (interior.length - 1)) / (cap - 1))]);
  }
  return [...new Set(picked)];
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
    const archive = createZipArchive();
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
      const pdf = getPdf(project);
      const printPdf = hasValidPdfFile(pdf.compressedPath) ? pdf.compressedPath : (hasValidPdfFile(pdf.productPath) ? pdf.productPath : null);
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
  return join(outputDir, 'product-reference', `${bookFileCode(projectOrName)}.pdf`);
}




function allInteriorPagesComplete(project) {
  const { isMazeProduct, mazePagesComplete } = require('./maze-export.cjs');
  if (isMazeProduct(project) && project.mazeProject) return mazePagesComplete(project);
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
    && isValidExportFile(job.outputPath, { minBytes: 1_000 })
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

function pdfLib() {
  return require('pdf-lib');
}

async function pdfFilePageCount(filePath) {
  const { PDFDocument } = pdfLib();
  const pdf = await PDFDocument.load(readFileSync(filePath), { ignoreEncryption: true });
  return pdf.getPageCount();
}

function printPdfPackageIsCurrent(project) {
  if (!allInteriorPagesComplete(project)) return false;
  const meta = project?.printPdfJson && typeof project.printPdfJson === 'object' ? project.printPdfJson : {};
  const checksum = printPdfPageChecksum(project.jobs);
  const pdfState = getPdf(project);
  const productPath = pdfState.productPath;
  const compressedPath = pdfState.compressedPath;
  return meta.stage === 'ready'
    && meta.checksum === checksum
    && productPath
    && hasValidPdfFile(productPath)
    && compressedPath
    && hasValidPdfFile(compressedPath);
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
 * Copy an already-built print PDF into product-reference/<book-code>.pdf.
 * Does not rasterize pages and does not call compressPdf — Interior already did that.
 */
async function prepareProductReferencePdf(
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
    throw Object.assign(new Error('Export the print PDF before preparing the product reference.'), { code: 'PRODUCT_REFERENCE_PDF_MISSING' });
  }
  const destPath = join(outputDir, 'product-reference', basename(pdfPath) || `${bookFileCode()}.pdf`);
  const want = Number(expectedPages) || 0;
  let sourceCount = 0;
  try {
    sourceCount = await pdfFilePageCount(pdfPath);
  } catch (error) {
    throw Object.assign(
      new Error(`The product reference PDF could not be read (${error?.message || error}).`),
      { code: 'PRODUCT_REFERENCE_PDF_PAGE_COUNT_MISMATCH' }
    );
  }
  if (want && sourceCount !== want) {
    throw Object.assign(
      new Error(`Print PDF has ${sourceCount} pages but this book has ${want} interior pages. Export the print PDF again, then retry editable generation.`),
      { code: 'PRODUCT_REFERENCE_PDF_PAGE_COUNT_MISMATCH' }
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
      new Error(`The product reference PDF could not be read after save (${error?.message || error}).`),
      { code: 'PRODUCT_REFERENCE_PDF_PAGE_COUNT_MISMATCH' }
    );
  }
  if (want && destCount !== want) {
    throw Object.assign(
      new Error(`Product reference PDF has ${destCount} pages but this book has ${want} interior pages. The original print PDF was kept instead of a damaged file.`),
      { code: 'PRODUCT_REFERENCE_PDF_PAGE_COUNT_MISMATCH' }
    );
  }
  return destPath;
}

async function prepareEditablePageImages(pagePaths = [], outputDir, format = 'A4', orientation = 'portrait') {
  const setup = resolvePageSetup(format, orientation);
  const destDir = join(outputDir, 'editable-pages');
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
      await getSharp()(source)
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


/**
 * The branding overlay attached to every preview video.
 *
 * Resolved from the app bundle rather than a user folder: a path under Downloads does
 * not survive packaging, and a preview that silently loses its watermark is a public
 * asset anyone can reuse.
 */
function resolvePreviewWatermarkPath() {
  const candidate = join(__dirname, '..', 'assets', 'branding', 'preview-watermark.png');
  return existsSync(candidate) ? candidate : null;
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
  const composites = [];
  for (let index = 0; index < 4; index += 1) {
    const sourcePath = pagePaths[index];
    if (!sourcePath || !existsSync(sourcePath)) continue;
    const tile = await getSharp()(sourcePath).resize(cellW, cellH, { fit: 'cover', position: 'centre' }).png().toBuffer();
    composites.push({
      input: tile,
      left: gap + (index % 2) * (cellW + gap),
      top: gap + Math.floor(index / 2) * (cellH + gap)
    });
  }
  const png = await getSharp()({
    create: {
      width: cellW * 2 + gap * 3,
      height: cellH * 2 + gap * 3,
      channels: 4,
      background: { r: 247, g: 241, b: 232, alpha: 1 }
    }
  }).composite(composites).png().toBuffer();
  await atomicWrite(destPath, png);
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
    const meta = await getSharp()(selected[index]).metadata();
    const maxEdge = Math.max(Number(meta.width) || 0, Number(meta.height) || 0);
    let pipeline = getSharp()(selected[index]);
    if (maxEdge > THUMBNAIL_PAGE_MAX_EDGE) {
      pipeline = pipeline.resize({
        width: THUMBNAIL_PAGE_MAX_EDGE,
        height: THUMBNAIL_PAGE_MAX_EDGE,
        fit: 'inside'
      });
    }
    const destPath = join(destDir, `Thumbnail-${Number(thumbnailIndex) + 1}-page-0${index + 1}.png`);
    await atomicWrite(destPath, await pipeline.png().toBuffer());
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
  // Only a .docx. This used to fall back to the .pptx, which is how the marketing
  // stage ended up being handed book-editable.pptx and rejecting it - the fallback hid
  // the real problem, which was that no document had been built at all.
  const docx = pick('.docx');
  return docx ? join(outputDir, docx) : null;
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
    const meta = await getSharp()(jpegBuffer, { failOn: 'none' }).metadata();
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
    const archive = createZipArchive();
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
    // #region agent log
    fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'702e49'},body:JSON.stringify({sessionId:'702e49',runId:'post-fix',hypothesisId:'C',location:'file-manager.cjs:saveGeneratedImage',message:'page image save path',data:{fileName:job?.fileName||null,outputDir,inWorkspace:String(outputDir||'').includes('/workspace/')},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    const rawPath = join(outputDir, job.fileName.replace(/\.png$/, '.raw.png'));
    if (!existsSync(rawPath)) {
      await atomicWrite(rawPath, buffer);
    }
    const result = await this.validateAndConvert(buffer, format, orientation, zoom, offsetX, offsetY);
    const outputPath = join(outputDir, job.fileName);
    await atomicWrite(outputPath, result.png);
    try { await ensureCardPreview(outputPath); } catch { /* card preview is display-only */ }
    return { outputPath, width: result.width, height: result.height, dpi: result.dpi };
  }

  async saveGeneratedThumbnail({ buffer, fileName, outputDir }) {
    const png = this.validateSource(buffer);
    const metadata = await getSharp()(png, { failOn: 'none' }).metadata();
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
    const resized = await getSharp()(png, { failOn: 'none' })
      .resize(newWidth, newHeight, { fit: 'fill', kernel: getSharp().kernel.lanczos3 })
      .toBuffer();

    let payload = null;
    for (const quality of LISTING_THUMB_JPEG_QUALITY) {
      payload = await getSharp()(resized, { failOn: 'none' })
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
    const opts = typeof options === 'string' ? { exportMode: options } : (options || {});
    const { isMazeProduct, prepareMazeProject } = require('./maze-export.cjs');
    if (isMazeProduct(project)) project = await prepareMazeProject(project, opts.store);
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

    let pdfPath = resolveExportPackPdfPath(project);
    if (!pdfPath) {
      pdfPath = await this.exportPdf(project, opts);
      const refreshed = resolveExportPackPdfPath(project);
      if (refreshed) pdfPath = refreshed;
    }
    const pptxPath = await this.exportPptx(project, opts);
    const docxPath = await this.exportDocx(project, opts);

    const manifest = buildFinalExportManifest(project, {
      exportMode: mode,
      pdfPath,
      pptxPath,
      docxPath
    });
    assertFinalExportManifestComplete(manifest);

    const stagingDir = join(project.outputDir, '.final-export-staging');
    rmSync(stagingDir, { recursive: true, force: true });
    mkdirSync(stagingDir, { recursive: true });

    // Marketing artefacts are normalised at export time, not at generation time: the
    // buyer's copy has to be uniform even when the source images arrived at whatever
    // size the model produced.
    if (manifest.mockups.length) {
      const normalized = await normalizeMockupsForExport(
        manifest.mockups.map((item) => item.sourcePath),
        join(stagingDir, 'mockups-2000')
      );
      manifest.mockups.forEach((item, index) => {
        if (normalized[index]) item.sourcePath = normalized[index];
      });
    }
    const videoArtifact = manifest.artifacts.find((item) => item.type === 'video' && item.included);
    if (videoArtifact) {
      const mp4 = await ensureMp4Preview(videoArtifact.sourcePath, join(stagingDir, 'preview'));
      if (mp4 && mp4 !== videoArtifact.sourcePath) {
        videoArtifact.sourcePath = mp4;
        videoArtifact.finalName = `${bookFileCode(project)}_video.mp4`;
      }
    }
    // Transcoding the preview is the one step that can change an entry name, so the
    // expected list is rebuilt after it rather than before.
    manifest.expectedZipEntries = [
      ...manifest.artifacts.filter((item) => item.included && item.type !== 'mockups'),
      ...manifest.mockups
    ].map((item) => item.finalName.replace(/\\/g, '/'));
    const seoFilePath = materializeFinalExportSeoFile(manifest, stagingDir);
    if (seoFilePath) {
      const durableSeo = join(project.outputDir, basename(seoFilePath));
      copyFileSync(seoFilePath, durableSeo);
    }

    const writtenEntries = [];
    await new Promise((resolve, reject) => {
      const output = createWriteStream(zipPath);
      const archive = createZipArchive();
      output.on('close', resolve);
      output.on('error', reject);
      archive.on('error', reject);
      archive.pipe(output);

      for (const item of manifest.artifacts) {
        if (!item.included || item.type === 'mockups') continue;
        const entryName = item.finalName.replace(/\\/g, '/');
        if (item.type === 'seo') {
          if (!seoFilePath || !existsSync(seoFilePath)) {
            reject(Object.assign(new Error('SEO TXT could not be written for final export.'), {
              code: 'EXPORT_SEO_WRITE_FAILED'
            }));
            return;
          }
          archive.file(seoFilePath, { name: entryName });
          writtenEntries.push(entryName);
          continue;
        }
        if (!item.sourcePath || !existsSync(item.sourcePath)) {
          reject(Object.assign(new Error(`Final export source missing for ${item.type}.`), {
            code: 'EXPORT_SOURCE_MISSING',
            artifact: item
          }));
          return;
        }
        archive.file(item.sourcePath, { name: entryName });
        writtenEntries.push(entryName);
      }
      for (const item of manifest.mockups) {
        const entryName = item.finalName.replace(/\\/g, '/');
        archive.file(item.sourcePath, { name: entryName });
        writtenEntries.push(entryName);
      }

      archive.finalize();
    });

    const expected = [...manifest.expectedZipEntries].sort();
    const actual = [...writtenEntries].sort();
    if (expected.length !== actual.length || expected.some((name, index) => name !== actual[index])) {
      throw Object.assign(new Error('Final export ZIP contents do not match the manifest.'), {
        code: 'EXPORT_MANIFEST_MISMATCH',
        expected,
        actual,
        missing: manifest.missing
      });
    }

    rmSync(stagingDir, { recursive: true, force: true });
    return zipPath;
  }

  /**
   * Product final-export folder: manifest artifacts only (never an outputDir dump).
   */
  async exportFinalPackageDirectory(project, destDir, options = {}) {
    const opts = typeof options === 'string' ? { exportMode: options } : (options || {});
    const { isMazeProduct, prepareMazeProject } = require('./maze-export.cjs');
    if (isMazeProduct(project)) project = await prepareMazeProject(project, opts.store);
    if (project.stats.complete !== project.stats.total) {
      throw Object.assign(new Error('Export is locked until every page is complete.'), { code: 'BOOK_INCOMPLETE' });
    }
    const mode = typeof options === 'string'
      ? options
      : (options && options.exportMode) ? options.exportMode : 'STANDARD_SEQUENTIAL';

    let pdfPath = resolveExportPackPdfPath(project);
    if (!pdfPath) {
      pdfPath = await this.exportPdf(project, opts);
      const refreshed = resolveExportPackPdfPath(project);
      if (refreshed) pdfPath = refreshed;
    }
    const pptxPath = await this.exportPptx(project, opts);
    const docxPath = await this.exportDocx(project, opts);
    const manifest = buildFinalExportManifest(project, {
      exportMode: mode,
      pdfPath,
      pptxPath,
      docxPath
    });
    const seoFilePath = materializeFinalExportSeoFile(manifest, destDir);
    if (seoFilePath && project.outputDir) {
      copyFileSync(seoFilePath, join(project.outputDir, basename(seoFilePath)));
    }
    return writeFinalExportPackageFromManifest(manifest, destDir, { seoFilePath });
  }

  /**
   * Debug/internal: full workspace dump. Not used by product final export.
   */
  exportOutputDirDump(project, destDir) {
    if (!project?.outputDir || !existsSync(project.outputDir)) {
      throw Object.assign(new Error('Project output directory is missing.'), { code: 'OUTPUT_DIR_MISSING' });
    }
    mkdirSync(dirname(destDir), { recursive: true });
    cpSync(project.outputDir, destDir, {
      recursive: true,
      errorOnExist: true,
      filter: (src) => !String(src).endsWith('.raw.png')
    });
    return destDir;
  }

  async exportPdf(project, options = {}) {
    const opts = typeof options === 'string' ? { exportMode: options } : (options || {});
    const { isMazeProduct, prepareMazeProject, exportMazePdf } = require('./maze-export.cjs');
    if (isMazeProduct(project)) {
      project = await prepareMazeProject(project, opts.store);
      return exportMazePdf(project, opts);
    }
    if (project.stats.complete !== project.stats.total) {
      throw Object.assign(new Error('PDF export is locked until every page is complete.'), { code: 'BOOK_INCOMPLETE' });
    }
    // If raster page files are missing, reuse the print PDF built during Interior.
    const pdfState = getPdf(project);
    const existingPrint = hasValidPdfFile(pdfState.productPath) ? pdfState.productPath : (hasValidPdfFile(pdfState.compressedPath) ? pdfState.compressedPath : null);
    const jobsHaveRaster = (project.jobs || []).some((job) => job?.outputPath && existsSync(job.outputPath) && isRasterImagePath(job.outputPath));
    if (!jobsHaveRaster && existingPrint) {
      return existingPrint;
    }
    const mode = typeof options === 'string'
      ? options
      : (options && options.exportMode) ? options.exportMode : 'STANDARD_SEQUENTIAL';
    const isBooklet = mode === 'BOOKLET_SADDLE_STITCH';

    const setup = resolvePageSetup(project.format, project.orientation);
    const { PDFDocument } = pdfLib();
    const pdf = await PDFDocument.create();
    pdf.setTitle(project.name);
    pdf.setSubject(project.theme);

    const slug = bookFileCode(project);
    const pdfName = isBooklet ? `${slug}-booklet.pdf` : `${slug}.pdf`;
    const outputPath = join(project.outputDir, pdfName);

    const exportPages = resolvedExportPages(project);
    if (isBooklet) {
      const imposition = calculateSaddleStitchSpreads(exportPages.length);
      const spreadPoints = [setup.points[0] * 2, setup.points[1]];

      for (const spread of imposition.spreads) {
        const leftPage = exportPages[spread.leftPage - 1];
        const rightPage = exportPages[spread.rightPage - 1];

        const leftPng = leftPage?.path && existsSync(leftPage.path) ? await require('fs/promises').readFile(leftPage.path) : null;
        const rightPng = rightPage?.path && existsSync(rightPage.path) ? await require('fs/promises').readFile(rightPage.path) : null;

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
      for (const page of exportPages) {
        await addCompressedPdfPage(pdf, page.path, setup.points, setup.width, setup.height);
      }
    }

    await atomicWrite(outputPath, Buffer.from(await pdf.save({ useObjectStreams: true })));
    return outputPath;
  }

  async exportPptx(project, options = {}) {
    const opts = typeof options === 'string' ? { exportMode: options } : (options || {});
    const { isMazeProduct, prepareMazeProject, exportMazePptx } = require('./maze-export.cjs');
    if (isMazeProduct(project)) {
      project = await prepareMazeProject(project, opts.store);
      return exportMazePptx(project, opts);
    }
    if (project.stats.complete !== project.stats.total) {
      throw Object.assign(new Error('PPTX export is locked until every page is complete.'), { code: 'BOOK_INCOMPLETE' });
    }
    const jobs = Array.isArray(project.jobs) ? project.jobs : [];
    if (!jobs.length) {
      throw Object.assign(new Error('PPTX export needs every page file on disk (PNG or SVG).'), {
        code: 'PAGE_IMAGE_MISSING'
      });
    }
    const exportPages = resolvedExportPages(project);
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
      const imposition = calculateSaddleStitchSpreads(exportPages.length);
      for (const spread of imposition.spreads) {
        const leftPage = exportPages[spread.leftPage - 1];
        const rightPage = exportPages[spread.rightPage - 1];
        const leftJob = leftPage?.job;
        const rightJob = rightPage?.job;

        const leftPng = leftPage?.path && existsSync(leftPage.path)
          ? await pageImageAsPngBuffer(leftPage.path)
          : null;
        const rightPng = rightPage?.path && existsSync(rightPage.path)
          ? await pageImageAsPngBuffer(rightPage.path)
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
      for (const page of exportPages) {
        const job = page.job;
        const slide = pres.addSlide();
        const pagePath = String(page.path || '');
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

  async exportDocx(project, options = {}) {
    const { isMazeProduct, prepareMazeProject } = require('./maze-export.cjs');
    if (isMazeProduct(project)) project = await prepareMazeProject(project, options.store);
    if (project.stats.complete !== project.stats.total) {
      throw Object.assign(new Error('DOCX export is locked until every page is complete.'), { code: 'BOOK_INCOMPLETE' });
    }
    const jobs = Array.isArray(project.jobs) ? project.jobs : [];
    if (!jobs.length) {
      throw Object.assign(new Error('DOCX export needs every page file on disk (PNG or SVG).'), {
        code: 'PAGE_IMAGE_MISSING'
      });
    }
    const pages = resolvedExportPages(project).map((page) => page.path);
    const slug = bookFileCode(project);
    const outputPath = join(project.outputDir, `${slug}.docx`);
    // writeImagesDocx embeds compressed JPEG page images (SVG→raster in memory if needed).
    return writeImagesDocx(pages, outputPath);
  }


  /**
   * After every interior page exists: convert to a print PDF, then compress it.
   * The compressed file is written to product-reference/<book-code>.pdf for downstream stages.
   */
  async buildPrintPdfPackage(project, options = {}) {
    const { isMazeProduct, prepareMazeProject } = require('./maze-export.cjs');
    if (isMazeProduct(project)) project = await prepareMazeProject(project, options.store);
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



function verifyOverview(project) {
  if (!project) {
    throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });
  }
  if (!String(project.name || '').trim() || !String(project.theme || '').trim()) {
    throw Object.assign(new Error('The saved project overview is incomplete.'), { code: 'PROJECT_OVERVIEW_INCOMPLETE' });
  }
  return true;
}

function verifyExportZip(project) {
  if (!project) {
    throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });
  }
  if (!project.outputDir) {
    throw Object.assign(new Error('Project output directory is missing.'), { code: 'OUTPUT_DIR_MISSING' });
  }
  const slug = bookFileCode(project);
  const zipName = `${slug}.zip`;
  const zipPath = join(project.outputDir, zipName);
  const actual = inspectFinalExportZip(zipPath).sort();
  const manifest = buildFinalExportManifest(project, {
    exportMode: 'STANDARD_SEQUENTIAL',
    pdfPath: resolveExportPackPdfPath(project),
    pptxPath: join(project.outputDir, `${slug}.pptx`),
    docxPath: join(project.outputDir, `${slug}.docx`)
  });
  assertFinalExportManifestComplete(manifest);

  const expected = [...manifest.expectedZipEntries].sort();
  if (expected.length !== actual.length || expected.some((name, index) => name !== actual[index])) {
    throw Object.assign(new Error('Final export ZIP contents do not match the manifest.'), {
      code: 'EXPORT_MANIFEST_MISMATCH',
      expected,
      actual
    });
  }
  return zipPath;
}

module.exports = {
  verifyOverview,
  verifyExportZip,
  PAGE_SETUPS,
  PRINT_PDF_JPEG,
  EXPORT_EMBED_JPEG,
  EXPORT_EMBED_MAX_EDGE,
  FileManager,
  addPngResolution,
  addCompressedPdfPage,
  allInteriorPagesComplete,
  atomicWrite,
  cardPreviewPathFor,
  ensureCardPreview,
  collectProductPageImagePaths,
  selectPreviewFramePaths,
  PREVIEW_PAGE_FRAME_MIN,
  PREVIEW_PAGE_FRAME_MAX,
  PREVIEW_PAGE_FRAME_COUNT,
  collectProductPageSvgPaths,
  editableVectorFolderName,
  packageEditableVectorFiles,
  bookFileCode,
  compressedPrintPdfDest,



  encodePrintPdfJpeg,
  formatPrintPdfBytes,
  pageImageAsPngBuffer,
  pageImageAsExportJpeg,
  resolveExportPackPdfPath,
  persistPreparedPdf,
  prepareProductReferencePdf,
  prepareEditablePageImages,
  printPdfPackageIsCurrent,
  printPdfPageChecksum,
  createSpreadPng,
  normalizePngToPage,
  resolvePageSetup,
  selectThumbnailPagePaths,
  selectPreviewAttachmentPaths,
  resolvePreviewWatermarkPath,
  selectMockupAttachmentPaths,
  findExistingBookDocument,
  isRejectedMockupAttachment,
  isRasterImagePath,
  isSvgImagePath,
  writeImagesDocx,
  stageThumbnailPageTargets,
  buildFinalExportManifest,
  assertFinalExportManifestComplete,
  collectFinalMockupPaths,
  resolveFinalExportSeoText,
  resolveFinalExportVideoPath,
  materializeFinalExportSeoFile,
  writeFinalExportPackageFromManifest
};
