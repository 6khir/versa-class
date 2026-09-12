'use strict';
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { createHash } = require('node:crypto');
const { runOperation } = require('./generation-control.cjs');
const { getJobStartUrl } = require('./ai-engine.cjs');
const exec = promisify(execFile);
async function validateArtwork(buffer) {
  if (process.platform !== 'darwin') throw Object.assign(new Error('Artwork text validation requires macOS Vision.'), { code: 'EDITABLE_VALIDATOR_UNAVAILABLE' });
  const dir = await mkdtemp(join(tmpdir(), 'versa-text-check-'));
  try {
    const file = join(dir, 'art.png');
    await writeFile(file, buffer);
    const { stdout } = await exec('/usr/bin/swift', ['-module-cache-path', join(dir,'modules'), join(__dirname, 'detect-artwork-text.swift'), file], { timeout: 120000, maxBuffer: 1024 * 1024 });
    return { ...JSON.parse(stdout), hash: createHash('sha256').update(buffer).digest('hex') };
  } finally { await rm(dir, { recursive: true, force: true }); }
}
function createEditableBrowserProvider(browser, {signal, onActivity = () => {}, jobId = null, operationTimeoutMs = 120000} = {}) {
  const call = async (phase, work, timeoutMs = operationTimeoutMs) => {
    const startedAt=Date.now();
    const tick=()=>onActivity({jobId,phase,elapsedMs:Date.now()-startedAt,timeoutMs});
    tick();const timer=setInterval(tick,1000);
    const abort=()=>{browser.cancelWaits(); Promise.resolve(browser.abortJob?.(jobId)).catch(()=>{});};
    signal?.addEventListener('abort',abort,{once:true});
    try{return await runOperation(work,{signal,phase,timeoutMs,onTimeout:abort});}
    finally{clearInterval(timer);signal?.removeEventListener('abort',abort);}
  };
  const askWithArtwork = (artworkBuffer, prompt, gptUrl, prefix) => browser.withEngine('gemini', async () => {
    await call('connecting',()=>browser.launch({ headless: true }));
    const attachmentPaths = [];
    let dir = null;
    try {
      if (Buffer.isBuffer(artworkBuffer) && artworkBuffer.length) {
        dir = await mkdtemp(join(tmpdir(), prefix));
        const file = join(dir, 'artwork.png');
        await writeFile(file, artworkBuffer);
        attachmentPaths.push(file);
      }
      const submission = await call('submitting',()=>browser.submitPrompt(prompt, {
        jobId, promptKind:'generate-prompts', gptUrl, attachmentPaths
      }));
      const page = browser.jobPages?.get(jobId) || await call('connecting',()=>browser.ensurePage());
      return await call('planning',()=>browser.waitForAssistantTextResponse(submission.baseline,240000,page),240000);
    } finally {
      if (dir) await rm(dir, { recursive: true, force: true }).catch(()=>{});
    }
  });
  return {
    forJob: id => createEditableBrowserProvider(browser,{signal,onActivity,jobId:id,operationTimeoutMs}),
    async recover(id) {
      browser.cancelWaits();
      await runOperation(()=>browser.abortJob?.(id),{timeoutMs:2000,phase:'recover page'}).catch(()=>{});
      if (!signal?.aborted) browser.beginWork?.();
    },
    validateArtwork: buffer => call('validating',()=>validateArtwork(buffer)),
    async generateText(prompt) {
      return browser.withEngine('gemini', async () => {
        await call('connecting',()=>browser.launch({ headless: true }));
        const submission = await call('submitting',()=>browser.submitPrompt(prompt, {jobId, promptKind:'generate-prompts', gptUrl:getJobStartUrl({kind:'planning'},'gemini')}));
        const page = browser.jobPages?.get(jobId) || await call('connecting',()=>browser.ensurePage());
        return call('planning',()=>browser.waitForAssistantTextResponse(submission.baseline,240000,page),240000);
      });
    },
    generateTextLayout(artworkBuffer, prompt) {
      return askWithArtwork(artworkBuffer, prompt, getJobStartUrl({kind:'planning'},'gemini'), 'versa-layout-artwork-');
    },
    // Stage 2: read the finished artwork and write the page's text. Routed to the
    // editable gem, which is trained on worksheet copy.
    generatePageText(artworkBuffer, prompt) {
      return askWithArtwork(artworkBuffer, prompt, getJobStartUrl({kind:'editable'},'gemini'), 'versa-page-text-');
    },
    async generateImage(prompt, options = {}) {
      return browser.withEngine('gemini', async () => {
        await call('connecting',()=>browser.launch({ headless: true }));
        const submission = await call('submitting',()=>browser.submitPrompt(prompt, {promptKind:'page',gptUrl:getJobStartUrl({ kind:'page', purpose:'image' }, 'gemini'),jobId:jobId || options.jobId,conversationUrl:options.conversationUrl}));
        const image = await call('generating',()=>browser.waitForNewImage(submission.baseline,600000,{jobId:jobId || options.jobId,idleTimeoutMs:120000}),600000);
        return (await call('downloading',()=>browser.fetchImage(image.src,{jobId:jobId || options.jobId}))).buffer;
      });
    }
  };
}
module.exports = { createEditableBrowserProvider, validateArtwork };
