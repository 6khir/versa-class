import { readFile, writeFile, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRef,
  decodePDFRawStream
} from 'pdf-lib';

const TARGET_DPI = 150;
const JPEG_QUALITY = 75;
const POINTS_PER_INCH = 72;

function asNumber(value) {
  if (value == null) return 0;
  if (typeof value.asNumber === 'function') {
    const n = value.asNumber();
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isTrue(value) {
  return value === PDFBool.True || value === true || (value && typeof value.asBoolean === 'function' && value.asBoolean());
}

function listFilters(dict) {
  const filter = dict.lookup(PDFName.of('Filter'));
  if (!filter) return [];
  if (filter instanceof PDFName) return [filter];
  if (filter instanceof PDFArray) {
    const names = [];
    for (let index = 0; index < filter.size(); index += 1) {
      names.push(filter.lookup(index));
    }
    return names;
  }
  return [];
}

function streamDict(obj) {
  const dict = obj?.dict;
  return dict && typeof dict.lookup === 'function' ? dict : null;
}

function isImageXObject(obj) {
  const dict = streamDict(obj);
  return Boolean(dict) && typeof obj.getContents === 'function' && dict.lookup(PDFName.of('Subtype')) === PDFName.of('Image');
}

function isFormXObject(obj) {
  const dict = streamDict(obj);
  return Boolean(dict) && dict.lookup(PDFName.of('Subtype')) === PDFName.of('Form');
}

function skipImage(dict) {
  if (!dict) return true;
  if (isTrue(dict.lookup(PDFName.of('ImageMask')))) return true;
  const bits = asNumber(dict.lookup(PDFName.of('BitsPerComponent')));
  if (bits === 1) return true;
  const filters = listFilters(dict);
  if (filters.includes(PDFName.of('CCITTFaxDecode')) || filters.includes(PDFName.of('JBIG2Decode'))) return true;
  return false;
}

function colorChannels(colorSpace, context) {
  if (!colorSpace) return 3;
  if (colorSpace === PDFName.of('DeviceGray') || colorSpace === PDFName.of('CalGray')) return 1;
  if (colorSpace === PDFName.of('DeviceRGB') || colorSpace === PDFName.of('CalRGB') || colorSpace === PDFName.of('Lab')) return 3;
  if (colorSpace === PDFName.of('DeviceCMYK')) return 4;
  if (colorSpace instanceof PDFArray && colorSpace.size() >= 2) {
    const family = colorSpace.lookup(0);
    if (family === PDFName.of('Indexed')) return null;
    if (family === PDFName.of('DeviceN') || family === PDFName.of('Separation')) return null;
    if (family === PDFName.of('ICCBased')) {
      const profile = context.lookup(colorSpace.get(1));
      return asNumber(profile?.dict?.lookup(PDFName.of('N'))) || 3;
    }
  }
  return 3;
}

function maxPixelsForPage(widthPt, heightPt) {
  return {
    maxWidth: Math.max(1, Math.ceil((widthPt / POINTS_PER_INCH) * TARGET_DPI)),
    maxHeight: Math.max(1, Math.ceil((heightPt / POINTS_PER_INCH) * TARGET_DPI))
  };
}

function visitXObjectDict(pdf, dict, widthPt, heightPt, pageSizes, seen) {
  if (!(dict instanceof PDFDict)) return;
  for (const [, value] of dict.entries()) {
    const key = value?.toString?.();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const obj = pdf.context.lookup(value);
    if (isImageXObject(obj) && value instanceof PDFRef) {
      const prev = pageSizes.get(key);
      if (!prev || prev.widthPt * prev.heightPt < widthPt * heightPt) {
        pageSizes.set(key, { widthPt, heightPt, ref: value });
      }
    } else if (isFormXObject(obj)) {
      const resources = obj.dict.lookup(PDFName.of('Resources'));
      const nested = resources instanceof PDFDict ? resources.lookup(PDFName.of('XObject')) : null;
      visitXObjectDict(pdf, nested, widthPt, heightPt, pageSizes, seen);
    }
  }
}

function collectImagePageSizes(pdf) {
  const pageSizes = new Map();
  for (const page of pdf.getPages()) {
    const resources = page.node.Resources();
    const xObject = resources instanceof PDFDict ? resources.lookup(PDFName.of('XObject')) : null;
    visitXObjectDict(pdf, xObject, page.getWidth(), page.getHeight(), pageSizes, new Set());
  }
  return pageSizes;
}

function collectSMaskKeys(pdf) {
  const keys = new Set();
  for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
    if (!isImageXObject(obj)) continue;
    const smask = streamDict(obj)?.get(PDFName.of('SMask'));
    if (smask) keys.add(smask.toString());
  }
  return keys;
}

async function extractImageBytes(stream, context) {
  const dict = stream.dict;
  const filters = listFilters(dict);
  const contents = Buffer.from(stream.getContents());
  if (filters.includes(PDFName.of('DCTDecode')) || filters.includes(PDFName.of('JPXDecode'))) {
    return contents;
  }

  let decoded = contents;
  try {
    decoded = Buffer.from(decodePDFRawStream(stream).decode());
  } catch {
    decoded = contents;
  }

  try {
    const meta = await sharp(decoded, { failOn: 'none' }).metadata();
    if (meta.width && meta.height) return decoded;
  } catch {
    // Fall through to raw pixel reconstruction.
  }

  const width = asNumber(dict.lookup(PDFName.of('Width')));
  const height = asNumber(dict.lookup(PDFName.of('Height')));
  const bits = asNumber(dict.lookup(PDFName.of('BitsPerComponent'))) || 8;
  const channels = colorChannels(dict.lookup(PDFName.of('ColorSpace')), context);
  if (!width || !height || bits !== 8 || !channels) {
    throw new Error('unsupported PDF image encoding');
  }
  const needed = width * height * channels;
  if (decoded.length < needed) {
    throw new Error(`decoded PDF image is ${decoded.length} bytes, expected at least ${needed}`);
  }
  return sharp(decoded.subarray(0, needed), {
    failOn: 'none',
    raw: { width, height, channels }
  }).png().toBuffer();
}

async function recompressImage(bytes, maxWidth, maxHeight) {
  const meta = await sharp(bytes, { failOn: 'none' }).metadata();
  const srcWidth = meta.width || maxWidth;
  const srcHeight = meta.height || maxHeight;
  const scale = Math.min(1, maxWidth / srcWidth, maxHeight / srcHeight);
  let pipeline = sharp(bytes, { failOn: 'none' }).rotate();
  if (scale < 0.999) {
    pipeline = pipeline.resize(Math.max(1, Math.round(srcWidth * scale)), Math.max(1, Math.round(srcHeight * scale)), {
      fit: 'fill',
      kernel: sharp.kernel.lanczos3
    });
  }
  const jpeg = await pipeline
    .removeAlpha()
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true, chromaSubsampling: '4:2:0' })
    .toBuffer();
  const out = await sharp(jpeg).metadata();
  return {
    jpeg,
    width: out.width || Math.max(1, Math.round(srcWidth * scale)),
    height: out.height || Math.max(1, Math.round(srcHeight * scale))
  };
}

function replaceImage(pdf, ref, jpeg, width, height, originalDict) {
  const stream = pdf.context.stream(jpeg, {
    Type: 'XObject',
    Subtype: 'Image',
    BitsPerComponent: 8,
    Width: width,
    Height: height,
    ColorSpace: 'DeviceRGB',
    Filter: 'DCTDecode'
  });
  const smask = originalDict.get(PDFName.of('SMask'));
  if (smask) stream.dict.set(PDFName.of('SMask'), smask);
  const interpolate = originalDict.get(PDFName.of('Interpolate'));
  if (interpolate) stream.dict.set(PDFName.of('Interpolate'), interpolate);
  pdf.context.assign(ref, stream);
}

function compressionResult(inputPath, originalBytes, extra = {}) {
  const outputPath = extra.path || inputPath;
  const outputBytes = Number.isFinite(Number(extra.outputBytes)) ? Number(extra.outputBytes) : originalBytes;
  return {
    path: outputPath,
    originalBytes,
    outputBytes,
    skipped: outputPath === inputPath,
    reason: extra.reason || null,
    imagesReplaced: extra.imagesReplaced || 0,
    inputPageCount: extra.inputPageCount ?? null,
    outputPageCount: extra.outputPageCount ?? extra.inputPageCount ?? null
  };
}

export async function pdfPageCount(inputPathOrBytes) {
  const bytes = Buffer.isBuffer(inputPathOrBytes) ? inputPathOrBytes : await readFile(inputPathOrBytes);
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  return pdf.getPageCount();
}

/**
 * Downsample every embedded PDF image to ≤ 150 dpi and re-encode as JPEG ~75%.
 * Returns `{ path, originalBytes, outputBytes, skipped, reason, imagesReplaced }`.
 * `path` is a temp file on success, or the original path if compression is a no-op / fails.
 */
export async function compressPdf(inputPath) {
  if (!inputPath) {
    return compressionResult(inputPath, 0, { reason: 'no file path' });
  }
  let originalSize = 0;
  try {
    originalSize = (await stat(inputPath)).size;
    const sourceBytes = await readFile(inputPath);
    const pdf = await PDFDocument.load(sourceBytes, { ignoreEncryption: true, updateMetadata: false });
    const pageCount = pdf.getPageCount();
    const pages = pdf.getPages();
    let fallbackWidth = 612;
    let fallbackHeight = 792;
    for (const page of pages) {
      if (page.getWidth() * page.getHeight() > fallbackWidth * fallbackHeight) {
        fallbackWidth = page.getWidth();
        fallbackHeight = page.getHeight();
      }
    }

    const pageSizes = collectImagePageSizes(pdf);
    const smaskKeys = collectSMaskKeys(pdf);
    let replaced = 0;

    for (const [ref, obj] of pdf.context.enumerateIndirectObjects()) {
      if (!(ref instanceof PDFRef) || !isImageXObject(obj)) continue;
      const dict = streamDict(obj);
      if (!dict || smaskKeys.has(ref.toString()) || skipImage(dict)) continue;
      const placed = pageSizes.get(ref.toString());
      const widthPt = placed?.widthPt || fallbackWidth;
      const heightPt = placed?.heightPt || fallbackHeight;
      const { maxWidth, maxHeight } = maxPixelsForPage(widthPt, heightPt);
      try {
        const extracted = await extractImageBytes(obj, pdf.context);
        const compressed = await recompressImage(extracted, maxWidth, maxHeight);
        replaceImage(pdf, ref, compressed.jpeg, compressed.width, compressed.height, dict);
        replaced += 1;
      } catch (error) {
        console.warn('[compress-pdf] skipped an embedded image:', error?.message || error);
      }
    }

    if (!replaced) {
      console.log('[compress-pdf] no raster images to recompress; using original PDF');
      return compressionResult(inputPath, originalSize, {
        reason: 'no raster images to recompress',
        imagesReplaced: 0,
        inputPageCount: pageCount,
        outputPageCount: pageCount
      });
    }

    const saved = Buffer.from(await pdf.save({ useObjectStreams: false }));
    let savedCount = -1;
    try {
      savedCount = await pdfPageCount(saved);
    } catch (error) {
      console.warn('[compress-pdf] could not re-open compressed PDF; using original:', error?.message || error);
      return compressionResult(inputPath, originalSize, {
        reason: 'compressed PDF could not be re-opened',
        imagesReplaced: replaced,
        inputPageCount: pageCount,
        outputPageCount: savedCount
      });
    }
    if (savedCount !== pageCount) {
      console.warn(`[compress-pdf] page count changed after save (${pageCount} → ${savedCount}); using original PDF`);
      return compressionResult(inputPath, originalSize, {
        reason: `page count changed after save (${pageCount} → ${savedCount})`,
        imagesReplaced: replaced,
        inputPageCount: pageCount,
        outputPageCount: savedCount
      });
    }
    if (saved.length >= originalSize) {
      console.log('[compress-pdf] recompressed PDF was not smaller; using original');
      return compressionResult(inputPath, originalSize, {
        reason: 'recompressed PDF was not smaller',
        imagesReplaced: replaced,
        outputBytes: saved.length,
        inputPageCount: pageCount,
        outputPageCount: pageCount
      });
    }

    const outputPath = join(tmpdir(), `compressed-${Date.now()}.pdf`);
    await writeFile(outputPath, saved);
    const writtenCount = await pdfPageCount(outputPath).catch(() => -1);
    if (writtenCount !== pageCount) {
      console.warn(`[compress-pdf] written file has ${writtenCount} pages, source had ${pageCount}; using original PDF`);
      try { await unlink(outputPath); } catch {}
      return compressionResult(inputPath, originalSize, {
        reason: `written page count changed (${pageCount} → ${writtenCount})`,
        imagesReplaced: replaced,
        inputPageCount: pageCount,
        outputPageCount: writtenCount
      });
    }
    console.log(
      `[compress-pdf] wrote ${outputPath} (${replaced} image${replaced === 1 ? '' : 's'}, ${pageCount} pages, ${originalSize} → ${saved.length} bytes)`
    );
    return compressionResult(inputPath, originalSize, {
      path: outputPath,
      outputBytes: saved.length,
      imagesReplaced: replaced,
      inputPageCount: pageCount,
      outputPageCount: writtenCount
    });
  } catch (error) {
    console.warn('[compress-pdf] failed, using original PDF:', error?.message || error);
    return compressionResult(inputPath, originalSize, {
      reason: error?.message || 'compression failed'
    });
  }
}
