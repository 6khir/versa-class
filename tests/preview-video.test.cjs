const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { Jimp } = require('jimp');

const { FileManager, selectPreviewAttachmentPaths, selectPreviewFramePaths } = require('../src/file-manager.cjs');
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

test('preview sits between thumbnails and export, which is last', () => {
  assert.deepEqual(PIPELINE_STEPS, [
    'overview',
    'interior',
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

// The preview animates interior pages. The cover and the thank-you page are generated
// as stock images rather than product content, so a preview built from them shows the
// packaging instead of the pack - and the cover already has four mockups of its own.

test('preview frames skip maze cover and back by page role', async () => {
  const dir = workDir();
  const jobs = [
    { pageNumber: 1, kind: 'cover', outputPath: await writePage(dir, 'cover.png') },
    { pageNumber: 2, kind: 'maze_interior', outputPath: await writePage(dir, 'm01.png') },
    { pageNumber: 3, kind: 'maze_interior', outputPath: await writePage(dir, 'm02.png') },
    { pageNumber: 4, kind: 'answer_key', outputPath: await writePage(dir, 'a01.png') },
    { pageNumber: 5, kind: 'answer_key', outputPath: await writePage(dir, 'a02.png') },
    { pageNumber: 6, kind: 'back_cover', outputPath: await writePage(dir, 'back.png') }
  ];
  const selected = selectPreviewFramePaths(jobs);
  assert.deepEqual(selected, [jobs[1].outputPath, jobs[2].outputPath]);
  assert.ok(!selected.includes(jobs[0].outputPath));
  assert.ok(!selected.includes(jobs[5].outputPath));
  assert.ok(!selected.includes(jobs[3].outputPath), 'answer keys are not preview frames');
});

test('preview frames skip the cover and the thank-you page', async () => {
  const dir = workDir();
  const jobs = [];
  for (let index = 1; index <= 20; index += 1) {
    jobs.push({ pageNumber: index, outputPath: await writePage(dir, `page-${index}.png`) });
  }
  const selected = selectPreviewFramePaths(jobs);
  assert.ok(!selected.includes(jobs[0].outputPath), 'the cover must not be animated');
  assert.ok(!selected.includes(jobs[19].outputPath), 'the thank-you page must not be animated');
  // Five to eight, and every frame a different page.
  assert.ok(selected.length >= 5 && selected.length <= 8, `expected 5-8 frames, got ${selected.length}`);
  assert.equal(new Set(selected).size, selected.length);
});

test('preview frames are spread across the book, not the opening pages', async () => {
  const dir = workDir();
  const jobs = [];
  for (let index = 1; index <= 40; index += 1) {
    jobs.push({ pageNumber: index, outputPath: await writePage(dir, `p-${index}.png`) });
  }
  const numbers = selectPreviewFramePaths(jobs)
    .map((filePath) => jobs.findIndex((job) => job.outputPath === filePath) + 1);
  // Reaches the far end of the book. Consecutive opening pages would say nothing about
  // what a 40 page pack actually contains.
  assert.equal(numbers[0], 2, 'starts at the first interior page');
  assert.equal(numbers[numbers.length - 1], 39, 'ends at the last interior page');
  assert.ok(numbers.every((value, index) => index === 0 || value > numbers[index - 1]), 'in page order');
  assert.ok(numbers[1] - numbers[0] > 1, 'sampled, not consecutive');
});

test('a book with no interior pages yields no frames rather than the cover', async () => {
  const dir = workDir();
  const jobs = [
    { pageNumber: 1, outputPath: await writePage(dir, 'cover.png') },
    { pageNumber: 2, outputPath: await writePage(dir, 'thanks.png') }
  ];
  // The controller turns this into PREVIEW_FRAMES_MISSING and fails the step, which is
  // better than a preview video of the cover and a thank-you note.
  assert.deepEqual(selectPreviewFramePaths(jobs), []);
});

test('a short book sends every interior page it has', async () => {
  const dir = workDir();
  const jobs = [];
  for (let index = 1; index <= 5; index += 1) {
    jobs.push({ pageNumber: index, outputPath: await writePage(dir, `s-${index}.png`) });
  }
  const selected = selectPreviewFramePaths(jobs);
  // Three interior pages is below the band, and all three is all there is.
  assert.equal(selected.length, 3);
  assert.deepEqual(selected, jobs.slice(1, 4).map((job) => job.outputPath));
});

test('preview video prompt is one short sentence that asks for the video', () => {
  const prompt = buildTptPreviewVideoPrompt();
  // One sentence, and the builder takes no arguments, so nothing about a particular
  // book can be interpolated into it. The model is not named either: the preview gem is
  // already a video gem, and the shorter the sentence the sooner it generates rather
  // than deliberates.
  assert.equal(prompt.split('\n').length, 1);
  // The watermark is never mentioned. Asking the model to place an image onto a video
  // reads as compositing media and was refused on policy grounds mid-render; the gem's
  // own instructions already apply it from its knowledge base. Naming the attachment
  // does no work either - the gem's instructions cover what to do with it.
  assert.doesNotMatch(prompt, /watermark|attached|document/i);
  // Carries the words the gem classifies on, so it routes straight to generation.
  assert.match(prompt, /preview video/i);
  assert.doesNotMatch(prompt, /Fractions Practice Pack|Product:/);
  assert.doesNotMatch(prompt, /16:9|MP4|seconds/i);
  // Short and imperative. The long version explained the attachments, forbade inventing
  // content and described the audience - and the gem reasoned about all of it instead of
  // generating, which is what made the wait time out.
  assert.ok(prompt.length < 120, `prompt should stay short, got ${prompt.length} chars`);
  // Opens with the instruction, so the gem generates rather than deliberates.
  assert.match(prompt, /^generate a preview video for this tpt product, best seller preview$/i);
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

test('the preview attaches interior page frames and nothing else', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../src/browser-controller.cjs'), 'utf8'
  );
  const start = source.indexOf('async generateTptPreviewVideoWithGpt(');
  const body = source.slice(start, source.indexOf('\n  async ', start + 1));
  // Veo animates frames. Handed only the .docx it has nothing visual to work from and
  // sits analysing; the mockup gem is the opposite and reads the document.
  assert.match(body, /const attachments = \[\.\.\.frames\];/);
  assert.match(body, /selectPreviewFramePaths\(project\?\.jobs\)/);
  assert.match(body, /PREVIEW_FRAMES_MISSING/);
  // The watermark stays in the gem's knowledge base; the document is not smuggled in.
  assert.doesNotMatch(body, /watermarkPath|resolvePreviewWatermarkPath/);
  assert.doesNotMatch(body, /sourceDocument|pdfPath/);
  assert.doesNotMatch(body, /\.\.\.mockups/);
});

test('the wait is governed by inactivity, not a fixed clock', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../src/browser-controller.cjs'), 'utf8'
  );
  // Veo 3 routinely runs past fifteen minutes, which the old fixed timeout treated as
  // failure while the video was still rendering.
  assert.match(source, /const PREVIEW_VIDEO_TIMEOUT_MS = 45 \* 60_000;/);
  assert.match(source, /const PREVIEW_VIDEO_IDLE_TIMEOUT_MS = 10 \* 60_000;/);
  const start = source.indexOf('async waitForNewVideo(');
  const body = source.slice(start, source.indexOf('\n  }\n', start));
  // While the page still reports generating, lastActivityAt is refreshed, so the idle
  // deadline never arrives and the render is left alone.
  assert.match(body, /if \(generationInProgress \|\| newAssistantText !== lastAssistantText\) lastActivityAt = now;/);
  assert.match(body, /Date\.now\(\) - lastActivityAt > idleTimeoutMs/);
  assert.match(body, /VIDEO_STALLED/);
});

test('a video still rendering is never restarted', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../src/browser-controller.cjs'), 'utf8'
  );
  const start = source.indexOf("code: 'VIDEO_TIMEOUT'");
  const body = source.slice(Math.max(0, start - 400), start + 400);
  // A retry opens a fresh tab and re-attaches the prompt, so the second request races
  // the first and the session holds two generations while answering neither.
  assert.match(body, /retryable: !generationInProgress/);
  // The automation manager honours exactly this flag.
  const manager = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../src/automation-manager.cjs'), 'utf8'
  );
  assert.match(manager, /const retryAllowed = error\?\.retryable !== false;/);
});

test('the preview reports moving progress while it renders', () => {
  const main = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../src/main.cjs'), 'utf8'
  );
  // The browser emits preview_video heartbeats but main only listened on the queue, so
  // nothing reached the UI and the card sat still for the whole render.
  assert.match(main, /browser\.on\('heartbeat', onPreviewHeartbeat\)/);
  assert.match(main, /payload\?\.phase !== 'preview_video'/);
  // Veo reports no percentage, so it is derived from elapsed time on a curve that always
  // advances and never reaches 100 - only the finished video completes it.
  assert.match(main, /Math\.min\(96, Math\.round\(8 \+ 88 \* \(1 - Math\.exp\(-minutes \/ 4\)\)\)\)/);
  // One listener per run, removed when the step ends.
  assert.match(main, /browser\.removeListener\('heartbeat', onPreviewHeartbeat\)/);
});

test('the preview card fills while generating', () => {
  const renderer = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../renderer/renderer.js'), 'utf8'
  );
  const css = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../renderer/styles.css'), 'utf8'
  );
  assert.match(renderer, /class="tpt-preview-fill" style="height:\$\{percent\}%"/);
  // Elapsed time is shown because a percentage alone, on a ten minute render, still
  // looks stuck.
  assert.match(renderer, /elapsedLabel/);
  assert.match(css, /\.tpt-preview-empty\.is-generating/);
  assert.match(css, /\.tpt-preview-fill/);
});

test('the hero transport runs the pipeline, not just the page queue', () => {
  const renderer = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../renderer/renderer.js'), 'utf8'
  );
  const start = renderer.indexOf("if (action === 'start')");
  const body = renderer.slice(start, start + 900);
  // It called startQueue while being labelled Start at the top of the book, so there was
  // no visible way to run every stage in order.
  assert.match(body, /api\.startAutomation\(project\.id\)/);
  assert.doesNotMatch(body, /api\.startQueue/);
  // Pausing must stop the pipeline and whatever stage is mid-flight, or the pipeline
  // halts while a queue keeps generating behind it.
  const pause = renderer.slice(renderer.indexOf("if (action === 'pause')"), renderer.indexOf("if (action === 'pause')") + 600);
  assert.match(pause, /api\.pauseAutomation\(\)/);
  assert.match(pause, /api\.pauseQueue\(\)/);
});

test('the preview prompt has exactly one source and one call site', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..');
  const builder = fs.readFileSync(path.join(root, 'src/prompt-builder.cjs'), 'utf8');
  const controller = fs.readFileSync(path.join(root, 'src/browser-controller.cjs'), 'utf8');

  // A retry must send the same prompt as the first attempt. Anything that builds a
  // second one - a nudge, a "please generate" follow-up - is how a run ends up asking
  // for something different the second time round.
  assert.equal((builder.match(/function buildTptPreviewVideoPrompt\(/g) || []).length, 1);
  assert.equal((controller.match(/buildTptPreviewVideoPrompt\(/g) || []).length, 1);

  const start = controller.indexOf('async generateTptPreviewVideoWithGpt(');
  // Bounded by the next method, not a character count: a fixed window silently grows
  // into the following function whenever this one gets shorter.
  const body = controller.slice(start, controller.indexOf('\n  async ', start + 1));
  // One submission definition, sent on both the first attempt and the one retry after a
  // browser crash, so a retry can never ask for something different.
  assert.equal((body.match(/submitPrompt\(prompt,/g) || []).length, 1);
  assert.match(body, /const submit = \(\) => this\.submitPrompt\(prompt,/);
  // No thumbnail retry prompt can leak into the video step.
  assert.doesNotMatch(body, /buildTptThumbnailRetryPrompt/);
  // A fresh isolated page every time, never an inherited conversation.
  assert.match(body, /conversationUrl: null/);
  assert.match(body, /isolatedPage: true/);
});

test('the preview button keeps one appearance and disables only for a real reason', () => {
  const renderer = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../renderer/renderer.js'), 'utf8'
  );
  const line = renderer.split('\n').find((text) => text.includes('data-action="generate-tpt-preview-video"'));
  assert.ok(line, 'the preview button should exist');
  // It switched between button-primary and button-ghost depending on whether a video
  // existed, which read as the control turning dark or blue at random.
  assert.doesNotMatch(line, /button-ghost/);
  assert.match(line, /class="v-btn v-btn-primary"/);
  const start = renderer.indexOf('function tptPreviewHtml(');
  const body = renderer.slice(start, start + 5200);
  // Disabled only when generating or the browser is genuinely busy - and it says which.
  assert.match(body, /const busyReason = generating/);
  assert.match(body, /browserBusyReason\(\)/);
  assert.match(body, /title="\$\{escapeHtml\(busyReason \|\|/);
});

test('a stored "generating" status cannot outlive the run that set it', () => {
  const main = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../src/main.cjs'), 'utf8'
  );
  const start = main.indexOf('async function generatePreviewVideoForProject(');
  const body = main.slice(start, main.indexOf('\n}\n', start));

  // Pausing threw without clearing the status set at the start of the run, so the card
  // reported "Generating…" forever against nothing, and no button could clear it.
  assert.match(body, /isPauseError\(error\)[\s\S]{0,400}status: 'idle', error: null/);

  // And whatever the exit path, the finally refuses to leave it saying generating.
  assert.match(body, /if \(getVideo\(settled\)\.status === 'generating'\)/);
  assert.match(body, /Last line of defence/);
});

test('the card believes the live operation, not the stored status', () => {
  const renderer = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../renderer/renderer.js'), 'utf8'
  );
  // A crash or a pause can leave the stored status behind; the live operation only
  // exists while the step is genuinely running.
  assert.match(renderer, /const generating = status === 'generating' && Boolean\(op\);/);
  // An interrupted run says so instead of pretending to still be working.
  assert.match(renderer, /const staleGenerating = status === 'generating' && !op;/);
  assert.match(renderer, /Previous run was interrupted/);
  assert.match(renderer, /Nothing is running now/);
});

test('no debug instrumentation writes to a shared temp file', () => {
  const main = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../src/main.cjs'), 'utf8'
  );
  // Eight catch blocks wrote their stack to /tmp/tpt-error.log, each overwriting the
  // last, which is neither a log nor useful.
  assert.doesNotMatch(main, /tpt-error\.log/);
});
