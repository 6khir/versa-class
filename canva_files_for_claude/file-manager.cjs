const { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } = require('node:fs');
const { dirname, extname, join } = require('node:path');
const archiver = require('archiver');
const CRC32 = require('crc-32');
const sharp = require('sharp');
const { Jimp, ResizeStrategy } = require('jimp');
const { PDFDocument } = require('pdf-lib');

const { calculateSaddleStitchSpreads } = require('./imposition.cjs');

const TPT_THUMBNAIL_MAX_BYTES = 4 * 1024 * 1024;
const THUMBNAIL_PAGE_MAX_EDGE = 1400;

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

function collectProductPageImagePaths(jobs = []) {
  return [...new Set((Array.isArray(jobs) ? jobs : [])
    .slice()
    .sort((left, right) => (Number(left?.pageNumber) || 0) - (Number(right?.pageNumber) || 0))
    .map((job) => job?.outputPath)
    .filter((filePath) => filePath && existsSync(filePath) && isRasterImagePath(filePath)))];
}

const CANVA_IMPORT_MAX_BYTES = 80 * 1024 * 1024;

async function prepareCanvaImportPdf(
  pdfPath,
  outputDir,
  format = 'A4',
  orientation = 'portrait',
  expectedPages = 0,
  pageImagePaths = []
) {
  if (!pdfPath || !existsSync(pdfPath)) {
    throw Object.assign(new Error('Export the print PDF before sending it to Canva.'), { code: 'CANVA_PDF_MISSING' });
  }
  const destDir = join(outputDir, 'canva-import');
  mkdirSync(destDir, { recursive: true });
  const destPath = join(destDir, 'book.pdf');
  const sourceBytes = readFileSync(pdfPath);
  const sourcePdf = await PDFDocument.load(sourceBytes);
  const pdfPages = sourcePdf.getPageCount();
  const want = Number(expectedPages) || 0;
  if (want && pdfPages !== want) {
    throw Object.assign(
      new Error(`Print PDF has ${pdfPages} pages but this book has ${want} interior pages. Export the print PDF again, then retry Canva.`),
      { code: 'CANVA_PDF_PAGE_COUNT_MISMATCH' }
    );
  }
  const setup = resolvePageSetup(format, orientation);
  const fileBytes = statSync(pdfPath).size;
  const first = sourcePdf.getPage(0);
  const sizeOk = Math.abs(first.getWidth() - setup.points[0]) < 3
    && Math.abs(first.getHeight() - setup.points[1]) < 3;
  if (fileBytes <= CANVA_IMPORT_MAX_BYTES && sizeOk) {
    await atomicWrite(destPath, sourceBytes);
    return destPath;
  }
  const images = (Array.isArray(pageImagePaths) ? pageImagePaths : [])
    .filter((item) => item && existsSync(item));
  if (want && images.length && images.length !== want) {
    throw Object.assign(
      new Error(`Cannot compress the print PDF: found ${images.length} page images but this book has ${want} pages.`),
      { code: 'CANVA_PDF_PAGE_COUNT_MISMATCH' }
    );
  }
  if (!images.length) {
    const pdf = await PDFDocument.create();
    const copied = await pdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
    for (const page of copied) pdf.addPage(page);
    await atomicWrite(destPath, Buffer.from(await pdf.save({ useObjectStreams: true })));
    return destPath;
  }
  const pdf = await PDFDocument.create();
  pdf.setTitle('Canva import');
  for (const source of images) {
    const jpeg = await sharp(source)
      .rotate()
      .resize(setup.width, setup.height, { fit: 'fill' })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();
    const image = await pdf.embedJpg(jpeg);
    const page = pdf.addPage(setup.points);
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: setup.points[0],
      height: setup.points[1]
    });
  }
  await atomicWrite(destPath, Buffer.from(await pdf.save({ useObjectStreams: true })));
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
    attachmentPaths: [contactSheetPath, ...pageFiles]
  };
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
    let payload = png;
    let safeFileName = fileName;
    if (payload.length > TPT_THUMBNAIL_MAX_BYTES) {
      let image = sharp(png);
      const metadata = await image.metadata();
      const scale = Math.min(1, 1600 / metadata.width, 1200 / metadata.height);
      const newWidth = Math.max(1, Math.round(metadata.width * scale));
      const newHeight = Math.max(1, Math.round(metadata.height * scale));
      
      const resized = await image.resize(newWidth, newHeight).toBuffer();
      
      for (const quality of [90, 82, 74, 66]) {
        payload = await sharp(resized).jpeg({ quality }).toBuffer();
        if (payload.length <= TPT_THUMBNAIL_MAX_BYTES) break;
      }
      safeFileName = String(fileName).replace(/\.[^.]+$/, '') + '.jpg';
    }
    if (payload.length > TPT_THUMBNAIL_MAX_BYTES) {
      throw Object.assign(new Error('The generated thumbnail could not be reduced below TPT\'s 4 MB limit.'), { code: 'TPT_THUMBNAIL_TOO_LARGE' });
    }
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

    const setup = resolvePageSetup(project.format, project.orientation);
    const slug = project.name.replace(/[^a-z0-9_-]+/gi, '-') || 'pod-network-book';
    const zipName = isBooklet ? `${slug}-booklet.zip` : `${slug}.zip`;
    const zipPath = join(project.outputDir, zipName);
    mkdirSync(project.outputDir, { recursive: true });

    if (isBooklet) {
      const imposition = calculateSaddleStitchSpreads(project.jobs.length);
      await new Promise((resolve, reject) => {
        const output = createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });
        output.on('close', resolve);
        output.on('error', reject);
        archive.on('error', reject);
        archive.pipe(output);

        (async () => {
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

            archive.append(spreadPng, { name: spread.fileName });
          }

          archive.append(JSON.stringify({
            name: project.name,
            theme: project.theme,
            format: project.format,
            orientation: project.orientation,
            exportMode: 'BOOKLET_SADDLE_STITCH',
            width: setup.width * 2,
            height: setup.height,
            dpi: 300,
            inputPageCount: project.jobs.length,
            paddedPageCount: imposition.paddedPageCount,
            padCount: imposition.padCount,
            totalSpreads: imposition.totalSpreads,
            spreads: imposition.spreads
          }, null, 2), { name: 'booklet-manifest.json' });

          archive.append(project.jobs.map((job) => `# ${job.pageLabel} — ${job.title}\n${job.prompt}`).join('\n\n---\n\n'), {
            name: 'prompts.txt'
          });

          archive.finalize();
        })().catch(reject);
      });
    } else {
      await new Promise((resolve, reject) => {
        const output = createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });
        output.on('close', resolve);
        output.on('error', reject);
        archive.on('error', reject);
        archive.pipe(output);

        for (const job of project.jobs) archive.file(job.outputPath, { name: job.fileName });
        archive.append(JSON.stringify({
          name: project.name,
          theme: project.theme,
          format: project.format,
          orientation: project.orientation,
          exportMode: 'STANDARD_SEQUENTIAL',
          width: setup.width,
          height: setup.height,
          dpi: 300,
          projectType: project.projectType,
          storyBlueprint: project.storyBlueprint,
          storyExactText: project.storyExactText,
          frontCoverPrompt: project.frontCoverPrompt,
          backCoverPrompt: project.backCoverPrompt,
          characters: project.highlights?.characters ?? [],
          pages: project.jobs.map((job) => ({
            pageNumber: job.pageNumber,
            pageLabel: job.pageLabel,
            title: job.title,
            fileName: job.fileName,
            prompt: job.prompt,
            storyText: job.storyText || '',
            imagePrompt: job.imagePrompt || job.prompt
          }))
        }, null, 2), { name: 'book-manifest.json' });
        archive.append(project.jobs.map((job) => `# ${job.pageLabel} — ${job.title}\n${job.prompt}`).join('\n\n---\n\n'), {
          name: 'prompts.txt'
        });
        archive.finalize();
      });
    }

    return zipPath;
  }

  async exportPdf(project, options = {}) {
    if (project.stats.complete !== project.stats.total) {
      throw Object.assign(new Error('PDF export is locked until every page is complete.'), { code: 'BOOK_INCOMPLETE' });
    }
    const mode = typeof options === 'string'
      ? options
      : (options && options.exportMode) ? options.exportMode : 'STANDARD_SEQUENTIAL';
    const isBooklet = mode === 'BOOKLET_SADDLE_STITCH';

    const setup = resolvePageSetup(project.format, project.orientation);
    const pdf = await PDFDocument.create();
    pdf.setTitle(project.name);
    pdf.setSubject(project.theme);

    const slug = project.name.replace(/[^a-z0-9_-]+/gi, '-') || 'pod-network-book';
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

        const spreadImage = this.nativeImage.createFromBuffer(spreadPng);
        const png = await pdf.embedJpg(spreadImage.toJPEG(98));
        const page = pdf.addPage(spreadPoints);
        page.drawImage(png, {
          x: 0,
          y: 0,
          width: spreadPoints[0],
          height: spreadPoints[1]
        });
      }
    } else {
      for (const job of project.jobs) {
        const image = this.nativeImage.createFromPath(job.outputPath);
        const png = await pdf.embedJpg(image.toJPEG(98));
        const page = pdf.addPage(setup.points);
        page.drawImage(png, {
          x: 0,
          y: 0,
          width: setup.points[0],
          height: setup.points[1]
        });
      }
    }

    await atomicWrite(outputPath, Buffer.from(await pdf.save({ useObjectStreams: true })));
    return outputPath;
  }

  async exportPptx(project, options = {}) {
    if (project.stats.complete !== project.stats.total) {
      throw Object.assign(new Error('PPTX export is locked until every page is complete.'), { code: 'BOOK_INCOMPLETE' });
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

    const slug = project.name.replace(/[^a-z0-9_-]+/gi, '-') || 'pod-network-book';
    const pptxName = isBooklet ? `${slug}-booklet.pptx` : `${slug}.pptx`;
    const outputPath = require('node:path').join(project.outputDir, pptxName);

    if (isBooklet) {
      const imposition = calculateSaddleStitchSpreads(project.jobs.length);
      for (const spread of imposition.spreads) {
        const leftJob = project.jobs[spread.leftPage - 1];
        const rightJob = project.jobs[spread.rightPage - 1];

        const leftPng = leftJob && require('node:fs').existsSync(leftJob.outputPath) ? await require('node:fs/promises').readFile(leftJob.outputPath) : null;
        const rightPng = rightJob && require('node:fs').existsSync(rightJob.outputPath) ? await require('node:fs/promises').readFile(rightJob.outputPath) : null;

        const spreadPng = await createSpreadPng({
          leftPng,
          rightPng,
          format: project.format,
          orientation: project.orientation
        });

        const slide = pres.addSlide();
        const base64 = `data:image/png;base64,${spreadPng.toString('base64')}`;
        slide.addImage({ data: base64, x: 0, y: 0, w: widthInches, h: heightInches });

        let notes = [];
        if (leftJob && leftJob.storyText) notes.push(`Left Page (${leftJob.pageLabel}): ${leftJob.storyText}`);
        if (rightJob && rightJob.storyText) notes.push(`Right Page (${rightJob.pageLabel}): ${rightJob.storyText}`);
        if (notes.length > 0) slide.addNotes(notes.join('\n\n'));
      }
    } else {
      for (const job of project.jobs) {
        const slide = pres.addSlide();
        
        const pngBuffer = await require('node:fs/promises').readFile(job.outputPath);
        const base64 = `data:image/png;base64,${pngBuffer.toString('base64')}`;
        
        slide.addImage({
          data: base64,
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
}

module.exports = {
  PAGE_SETUPS,
  FileManager,
  addPngResolution,
  atomicWrite,
  collectProductPageImagePaths,
  prepareCanvaImportPdf,
  prepareCanvaUploadImages,
  createSpreadPng,
  normalizePngToPage,
  resolvePageSetup,
  selectThumbnailPagePaths,
  selectPreviewAttachmentPaths,
  stageThumbnailPageTargets
};
