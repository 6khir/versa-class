const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { Jimp } = require('jimp');

const { FileManager, selectPreviewAttachmentPaths } = require('../src/file-manager.cjs');
const { buildTptPreviewVideoPrompt } = require('../src/prompt-builder.cjs');
const { PIPELINE_STEPS } = require('../src/automation-manager.cjs');

function workDir() {
  return mkdtempSync(join(tmpdir(), 'preview-video-'));
}

async function writePage(dir, name) {
  const image = new Jimp({ width: 400, height: 500, color: 0xFFFFFFFF });
  const path = join(dir, name);
  writeFileSync(path, await image.getBuffer('image/png'));
  return path;
}

function fakeMp4() {
  const buffer = Buffer.alloc(12_000, 0);
  buffer.writeUInt32BE(24, 0);
  buffer.write('ftyp', 4);
  buffer.write('isom', 8);
  return buffer;
}

test('preview sits between thumbnails and export in the pipeline', () => {
  assert.deepEqual(PIPELINE_STEPS, [
    'overview',
    'characters',
    'interior',
    'editable',
    'listing',
    'thumbnails',
    'preview',
    'export'
  ]);
});

test('preview attachments prefer mockups then cover and selected interior pages', async () => {
  const dir = workDir();
  const thumbs = [
    await writePage(dir, 'thumb-1.png'),
    await writePage(dir, 'thumb-2.png')
  ];
  const jobs = [];
  for (let index = 1; index <= 8; index += 1) {
    jobs.push({ outputPath: await writePage(dir, `page-${index}.png`) });
  }
  const selected = selectPreviewAttachmentPaths({ jobs, thumbnailPaths: thumbs, maxCount: 6 });
  assert.equal(selected[0], thumbs[0]);
  assert.equal(selected[1], thumbs[1]);
  assert.ok(selected.includes(jobs[0].outputPath));
  assert.ok(selected.includes(jobs[7].outputPath));
  assert.ok(selected.length <= 6);
  assert.equal(new Set(selected).size, selected.length);
});

test('preview video prompt asks Veo 3 to generate an MP4 now', () => {
  const prompt = buildTptPreviewVideoPrompt({
    title: 'Fractions Practice Pack',
    description: 'Printable fraction worksheets for grade 3.',
    attachmentCount: 5
  });
  assert.match(prompt, /Veo 3/);
  assert.match(prompt, /Fractions Practice Pack/);
  assert.match(prompt, /5 image file/);
  assert.match(prompt, /Generate the preview video now/i);
  assert.doesNotMatch(prompt, /@image/i);
});

test('saves a generated MP4 into the listing preview folder', async () => {
  const dir = workDir();
  const manager = new FileManager({ nativeImage: {} });
  const outputPath = await manager.saveGeneratedPreviewVideo({
    buffer: fakeMp4(),
    outputDir: dir
  });
  assert.ok(existsSync(outputPath));
  assert.match(outputPath, /tpt-preview\/tpt-preview\.mp4$/);
});

test('rejects a non-video buffer as a preview', async () => {
  const dir = workDir();
  const manager = new FileManager({ nativeImage: {} });
  await assert.rejects(
    () => manager.saveGeneratedPreviewVideo({
      buffer: Buffer.alloc(9_000, 0x41),
      outputDir: dir
    }),
    { code: 'INVALID_PREVIEW_VIDEO' }
  );
});
