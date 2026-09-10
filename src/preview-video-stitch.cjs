'use strict';

const { existsSync, unlinkSync } = require('node:fs');
const { dirname } = require('node:path');

const PREVIEW_CLIP_COUNT = 3;
const PREVIEW_CLIP_SECONDS = 8;
const PREVIEW_FINAL_NAME = 'preview_final.mp4';

function resolveFfmpegPath() {
  const candidates = [
    process.env.FFMPEG_PATH,
    process.env.FFMPEG,
    '/usr/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/opt/homebrew/bin/ffmpeg'
  ].filter(Boolean);
  return candidates.find((filePath) => existsSync(filePath)) || 'ffmpeg';
}

function unlinkPreviewSlices(clipPaths) {
  const paths = Array.isArray(clipPaths) ? clipPaths : [];
  for (const filePath of paths) {
    if (!filePath) continue;
    try {
      unlinkSync(filePath);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

/**
 * Concatenate three 8-second Veo slices into preview_final.mp4.
 * Chain: .input(file1).input(file2).input(file3).mergeToFile(final_output)
 */
function stitchPreviewClips(clipPaths, outputPath, { tmpDir = null, ffmpegPath = null } = {}) {
  const inputs = (Array.isArray(clipPaths) ? clipPaths : []).filter(Boolean);
  if (inputs.length !== PREVIEW_CLIP_COUNT) {
    throw Object.assign(new Error(`Preview stitch needs exactly ${PREVIEW_CLIP_COUNT} clips.`), {
      code: 'PREVIEW_STITCH_INPUTS'
    });
  }
  for (const filePath of inputs) {
    if (!existsSync(filePath)) {
      throw Object.assign(new Error(`Preview clip is missing: ${filePath}`), {
        code: 'PREVIEW_CLIP_MISSING'
      });
    }
  }
  const ffmpeg = require('fluent-ffmpeg');
  const bin = ffmpegPath || resolveFfmpegPath();
  if (bin && bin !== 'ffmpeg') ffmpeg.setFfmpegPath(bin);
  const workDir = tmpDir || dirname(outputPath);
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(inputs[0])
      .input(inputs[1])
      .input(inputs[2])
      .on('error', (error) => {
        reject(Object.assign(error instanceof Error ? error : new Error(String(error)), {
          code: 'PREVIEW_STITCH_FAILED'
        }));
      })
      .on('end', () => resolve(outputPath))
      .mergeToFile(outputPath, workDir);
  });
}

module.exports = {
  PREVIEW_CLIP_COUNT,
  PREVIEW_CLIP_SECONDS,
  PREVIEW_FINAL_NAME,
  resolveFfmpegPath,
  stitchPreviewClips,
  unlinkPreviewSlices
};
