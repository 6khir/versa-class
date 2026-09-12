'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { existsSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { buildTptPreviewVideoPrompt } = require('../src/prompt-builder.cjs');
const { generateStitchedPreviewVideo } = require('../src/preview-video-engine.cjs');
const {
  PREVIEW_CLIP_COUNT,
  resolveFfmpegPath,
  stitchPreviewClips,
  unlinkPreviewSlices
} = require('../src/preview-video-stitch.cjs');

function workDir() {
  return mkdtempSync(join(tmpdir(), 'versa-preview-stitch-'));
}

function makeClip(ffmpegPath, outputPath, color) {
  const result = spawnSync(ffmpegPath, [
    '-y',
    '-f', 'lavfi',
    '-i', `color=c=${color}:s=320x180:d=0.25`,
    '-pix_fmt', 'yuv420p',
    outputPath
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || 'ffmpeg clip failed');
}

test('three 8-second clip prompts are distinct and keep the default single-clip wording', () => {
  const single = buildTptPreviewVideoPrompt({
    title: 'Fractions Practice Pack',
    description: 'Printable fraction worksheets for grade 3.',
    attachmentCount: 5
  });
  assert.match(single, /^generate a preview video for this tpt product, best seller preview$/i);
  assert.doesNotMatch(single, /Segment 1 of 3/);

  const prompts = [0, 1, 2].map((clipIndex) => buildTptPreviewVideoPrompt({
    title: 'Fractions Practice Pack',
    attachmentCount: 5,
    clipIndex,
    clipCount: 3,
    clipSeconds: 8
  }));
  assert.equal(new Set(prompts).size, 3);
  for (const prompt of prompts) {
    assert.match(prompt, /Veo 3/);
    assert.match(prompt, /exactly 8 seconds/i);
    assert.match(prompt, /Generate the preview video now/i);
  }
  assert.match(prompts[0], /front cover/i);
  assert.match(prompts[1], /interior pages/i);
  assert.match(prompts[2], /back page/i);
});

test('fluent-ffmpeg concatenates three clips and unlinkPreviewSlices removes them', async () => {
  const ffmpegPath = resolveFfmpegPath();
  if (!existsSync(ffmpegPath) && ffmpegPath !== 'ffmpeg') {
    assert.ok(true, 'ffmpeg missing; stitch runtime skipped');
    return;
  }
  const dir = workDir();
  try {
    const clips = [
      join(dir, 'preview_clip_1.mp4'),
      join(dir, 'preview_clip_2.mp4'),
      join(dir, 'preview_clip_3.mp4')
    ];
    makeClip(ffmpegPath, clips[0], 'red');
    makeClip(ffmpegPath, clips[1], 'green');
    makeClip(ffmpegPath, clips[2], 'blue');
    const finalPath = join(dir, 'preview_final.mp4');
    await stitchPreviewClips(clips, finalPath, { tmpDir: dir, ffmpegPath });
    assert.equal(existsSync(finalPath), true);
    unlinkPreviewSlices(clips);
    assert.equal(existsSync(clips[0]), false);
    assert.equal(existsSync(clips[1]), false);
    assert.equal(existsSync(clips[2]), false);
    assert.equal(existsSync(finalPath), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('preview engine writes three clips, stitches preview_final.mp4, then unlinks slices', async () => {
  const dir = workDir();
  try {
    const calls = [];
    const fakeMp4 = Buffer.alloc(12_000, 0);
    fakeMp4.writeUInt32BE(24, 0);
    fakeMp4.write('ftyp', 4);
    fakeMp4.write('isom', 8);
    const browser = {
      async generateTptPreviewVideoWithGpt(args) {
        calls.push(args);
        return { buffer: fakeMp4, contentType: 'video/mp4', conversationUrl: `https://gemini.example/clip-${args.clipIndex}` };
      }
    };
    const generated = await generateStitchedPreviewVideo({
      browser,
      project: { id: 'book-1', name: 'Fractions' },
      listing: { title: 'Fractions Practice Pack' },
      tempDir: dir,
      stitch: async (clipPaths, outputPath) => {
        assert.equal(clipPaths.length, PREVIEW_CLIP_COUNT);
        for (const clipPath of clipPaths) assert.equal(existsSync(clipPath), true);
        writeFileSync(outputPath, fakeMp4);
        return outputPath;
      }
    });
    assert.equal(calls.length, 3);
    assert.deepEqual(calls.map((item) => item.clipIndex), [0, 1, 2]);
    assert.equal(calls[0].clipCount, 3);
    assert.equal(calls[0].clipSeconds, 8);
    assert.equal(existsSync(join(dir, 'preview_clip_1.mp4')), false);
    assert.equal(existsSync(join(dir, 'preview_clip_2.mp4')), false);
    assert.equal(existsSync(join(dir, 'preview_clip_3.mp4')), false);
    assert.equal(existsSync(join(dir, 'preview_final.mp4')), true);
    assert.equal(generated.conversationUrl, 'https://gemini.example/clip-2');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('main saves the stitched file as preview_final.mp4', () => {
  const main = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'main.cjs'), 'utf8');
  const stitch = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'preview-video-stitch.cjs'), 'utf8');
  assert.match(main, /generateStitchedPreviewVideo/);
  assert.match(main, /fileName: 'preview_final\.mp4'/);
  assert.match(main, /app\.getPath\('temp'\)/);
  assert.match(stitch, /\.input\(inputs\[0\]\)/);
  assert.match(stitch, /\.mergeToFile\(outputPath, workDir\)/);
  assert.match(stitch, /unlinkSync/);
});
