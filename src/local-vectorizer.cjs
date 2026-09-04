'use strict';

/**
 * Local raster → SVG vectorization via imagetracerjs (Node).
 * Replaces Canva Magic Layers with a free offline auto-trace pipeline.
 *
 * Heavy tracing runs in a worker_thread so Electron's main/UI process stays responsive.
 */

const fs = require('node:fs');
const path = require('node:path');
const { Worker } = require('node:worker_threads');

const TRACE_OPTIONS = Object.freeze({
  ltres: 1,
  qtres: 1,
  pathomit: 8,
  colorsampling: 2
});

const WORKER_PATH = path.join(__dirname, 'vectorize-worker.cjs');

/**
 * Yield to the event loop so progress UI / IPC can flush between heavy pages.
 * @returns {Promise<void>}
 */
function yieldEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

function svgPathForRaster(rasterPath) {
  const ext = path.extname(String(rasterPath || ''));
  if (!ext) return `${rasterPath}.svg`;
  return String(rasterPath).replace(new RegExp(`${ext.replace('.', '\\.')}$`, 'i'), '.svg');
}

/**
 * Trace a flat raster image to SVG and write it to disk (off the main thread).
 *
 * @param {string} imagePath  Absolute path to PNG/JPG on disk
 * @param {string} [outputPath] Destination SVG path (defaults to same stem .svg)
 * @returns {Promise<{ svgPath: string, bytes: number }>}
 */
async function convertImageToSVG(imagePath, outputPath) {
  const source = String(imagePath || '').trim();
  if (!source || !fs.existsSync(source)) {
    throw Object.assign(new Error(`Raster image not found for vectorization: ${source || '(empty)'}`), {
      code: 'VECTORIZE_SOURCE_MISSING'
    });
  }
  const dest = String(outputPath || svgPathForRaster(source)).trim();
  if (!dest) {
    throw Object.assign(new Error('SVG output path is required.'), { code: 'VECTORIZE_DEST_MISSING' });
  }

  // Let any pending UI/progress paint before spawning the worker.
  await yieldEventLoop();

  return new Promise((resolve, reject) => {
    let settled = false;
    const worker = new Worker(WORKER_PATH, {
      workerData: {
        imagePath: source,
        outputPath: dest,
        traceOptions: { ...TRACE_OPTIONS }
      }
    });

    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      try { worker.terminate(); } catch {}
      if (err) reject(err);
      else resolve(result);
    };

    worker.on('message', (msg) => {
      if (msg?.ok) {
        finish(null, { svgPath: msg.svgPath, bytes: Number(msg.bytes) || 0 });
        return;
      }
      finish(Object.assign(new Error(msg?.error || 'Vectorize worker failed.'), {
        code: msg?.code || 'VECTORIZE_WORKER_FAILED'
      }));
    });
    worker.on('error', (error) => {
      finish(Object.assign(error instanceof Error ? error : new Error(String(error)), {
        code: 'VECTORIZE_WORKER_FAILED'
      }));
    });
    worker.on('exit', (code) => {
      if (!settled && code !== 0) {
        finish(Object.assign(new Error(`Vectorize worker exited with code ${code}.`), {
          code: 'VECTORIZE_WORKER_EXIT'
        }));
      }
    });
  });
}

module.exports = {
  convertImageToSVG,
  svgPathForRaster,
  yieldEventLoop,
  TRACE_OPTIONS
};
