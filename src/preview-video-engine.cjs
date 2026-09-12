'use strict';

const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const {
  PREVIEW_CLIP_COUNT,
  PREVIEW_CLIP_SECONDS,
  PREVIEW_FINAL_NAME,
  stitchPreviewClips,
  unlinkPreviewSlices
} = require('./preview-video-stitch.cjs');

function clipFileName(index) {
  return `preview_clip_${index + 1}.mp4`;
}

/**
 * Dispatch 3 distinct 8-second Veo prompts, stitch with fluent-ffmpeg,
 * then unlink the temporary slices.
 */
async function generateStitchedPreviewVideo({
  browser,
  project,
  listing,
  pdfPath = null,
  tempDir,
  stitch = stitchPreviewClips,
  onProgress = null
} = {}) {
  if (!browser || typeof browser.generateTptPreviewVideoWithGpt !== 'function') {
    throw Object.assign(new Error('Preview video browser is not available.'), {
      code: 'PREVIEW_BROWSER_MISSING'
    });
  }
  if (!tempDir) {
    throw Object.assign(new Error('Preview stitch temp directory is required.'), {
      code: 'PREVIEW_TEMP_REQUIRED'
    });
  }
  mkdirSync(tempDir, { recursive: true });
  const clipPaths = [];
  let conversationUrl = null;
  try {
    for (let clipIndex = 0; clipIndex < PREVIEW_CLIP_COUNT; clipIndex += 1) {
      const percent = 12 + Math.round((clipIndex / PREVIEW_CLIP_COUNT) * 55);
      onProgress?.(percent);
      const generated = await browser.generateTptPreviewVideoWithGpt({
        project,
        listing,
        pdfPath,
        clipIndex,
        clipCount: PREVIEW_CLIP_COUNT,
        clipSeconds: PREVIEW_CLIP_SECONDS
      });
      const clipPath = join(tempDir, clipFileName(clipIndex));
      writeFileSync(clipPath, generated.buffer);
      clipPaths.push(clipPath);
      conversationUrl = generated.conversationUrl || conversationUrl;
    }
    const finalPath = join(tempDir, PREVIEW_FINAL_NAME);
    await stitch(clipPaths, finalPath, { tmpDir: tempDir });
    if (!existsSync(finalPath)) {
      throw Object.assign(new Error('fluent-ffmpeg did not write preview_final.mp4.'), {
        code: 'PREVIEW_STITCH_FAILED'
      });
    }
    const buffer = readFileSync(finalPath);
    unlinkPreviewSlices(clipPaths);
    return {
      buffer,
      contentType: 'video/mp4',
      conversationUrl,
      outputPath: finalPath,
      clipPaths
    };
  } catch (error) {
    throw error;
  }
}

module.exports = {
  clipFileName,
  generateStitchedPreviewVideo
};
