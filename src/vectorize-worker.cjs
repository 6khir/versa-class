'use strict';

/**
 * Worker-thread entry for imagetracerjs.
 * Keeps ImageTracer.imagedataToSVG (CPU-heavy, sync) off Electron's main/UI process.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { parentPort, workerData } = require('node:worker_threads');
const sharp = require('sharp');
const ImageTracer = require('imagetracerjs');

async function loadImageData(imagePath) {
  const image = sharp(imagePath).ensureAlpha().raw();
  const { data, info } = await image.toBuffer({ resolveWithObject: true });
  if (!info?.width || !info?.height || !data?.length) {
    throw Object.assign(new Error(`Could not decode image for vectorization: ${imagePath}`), {
      code: 'VECTORIZE_DECODE_FAILED'
    });
  }
  return {
    width: info.width,
    height: info.height,
    data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength)
  };
}

async function run() {
  const imagePath = String(workerData?.imagePath || '').trim();
  const outputPath = String(workerData?.outputPath || '').trim();
  const traceOptions = workerData?.traceOptions && typeof workerData.traceOptions === 'object'
    ? workerData.traceOptions
    : {};

  if (!imagePath || !fs.existsSync(imagePath)) {
    throw Object.assign(new Error(`Raster image not found for vectorization: ${imagePath || '(empty)'}`), {
      code: 'VECTORIZE_SOURCE_MISSING'
    });
  }
  if (!outputPath) {
    throw Object.assign(new Error('SVG output path is required.'), { code: 'VECTORIZE_DEST_MISSING' });
  }

  const imgd = await loadImageData(imagePath);
  const svgString = ImageTracer.imagedataToSVG(imgd, { ...traceOptions });
  if (!svgString || typeof svgString !== 'string' || !svgString.includes('<svg')) {
    throw Object.assign(new Error('ImageTracer returned an empty or invalid SVG.'), {
      code: 'VECTORIZE_EMPTY_SVG'
    });
  }

  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  await fsp.writeFile(outputPath, svgString, 'utf8');
  parentPort.postMessage({
    ok: true,
    svgPath: outputPath,
    bytes: Buffer.byteLength(svgString, 'utf8')
  });
}

run().catch((error) => {
  parentPort.postMessage({
    ok: false,
    error: error?.message || String(error),
    code: error?.code || 'VECTORIZE_WORKER_FAILED'
  });
});
