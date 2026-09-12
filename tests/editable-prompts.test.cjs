'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {ARTWORK_PROMPT,assertPromptIsSafe,scrubPrompt,buildArtworkPrompt,buildPageTextPrompt}=require('../src/editable-prompts.cjs');

test('the artwork wrapper carries no refusal-triggering words',()=>{assert.doesNotThrow(()=>assertPromptIsSafe(ARTWORK_PROMPT));});
test('banned words are detected',()=>{
 for(const bad of ['please render this','Render mode on','make it editable','rendering a page','RENDERED output']){
  assert.throws(()=>assertPromptIsSafe(bad),{code:'EDITABLE_PROMPT_BANNED_WORD'});
 }
});
test('safe lookalikes are not flagged',()=>{
 for(const ok of ['surrender the flag','render_mode_disabled','a tender moment']){
  assert.doesNotThrow(()=>assertPromptIsSafe(ok));
 }
});
test('scrubbing removes banned words from author text',()=>{
 assert.equal(scrubPrompt('Render mode for an editable page'),'layout style for a reusable page');
 assert.doesNotThrow(()=>assertPromptIsSafe(scrubPrompt('render the editable rendering')));
});
test('artwork prompt embeds the page topic and stays safe',()=>{
 const p=buildArtworkPrompt({pageNumber:3,pageTitle:'Counting',pageVisualDescription:'five stars'});
 assert.ok(p.startsWith(ARTWORK_PROMPT));
 assert.match(p,/PAGE TOPIC & THEME:\n03A: Counting - five stars/);
 assert.doesNotThrow(()=>assertPromptIsSafe(p));
});
test('artwork prompt scrubs banned words out of the topic',()=>{
 assert.doesNotThrow(()=>assertPromptIsSafe(buildArtworkPrompt({pageNumber:1,pageTitle:'An editable render'})));
});
test('artwork prompt falls back when no topic is supplied',()=>{
 assert.match(buildArtworkPrompt({}),/01A: General practice page/);
});
test('page text prompt asks for the four JSON keys and stays safe',()=>{
 const p=buildPageTextPrompt({topic:'Counting to five',pageNumber:1});
 for(const key of ['title:','instruction:','sections:','footer:'])assert.ok(p.includes(key),`missing ${key}`);
 assert.match(p,/^01T: /);assert.match(p,/PAGE TOPIC & THEME: Counting to five/);
 assert.doesNotThrow(()=>assertPromptIsSafe(p));
});

test('stage 1 sends the page brief unwrapped, as the static engine does', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'main.cjs'), 'utf8');
  // The wrapper demanded text-free artwork with empty frames, because the old pipeline
  // generated the text separately and needed somewhere to put it. Interior Text now
  // reads the words off the finished page, erases them and redraws them live, so the
  // artwork must arrive complete - the same page the static Interior section draws.
  assert.doesNotMatch(source, /buildArtworkPrompt\(/);
  assert.match(source, /function restoreDefaultArtworkPrompts/);
  const runner = source.slice(source.indexOf('interior_artwork: async (projectId, onProgress)'));
  assert.match(runner.slice(0, 700), /restoreDefaultArtworkPrompts\(projectId\)/);
  assert.ok(runner.indexOf('restoreDefaultArtworkPrompts(projectId)') < runner.indexOf('runQueueToCompletion'),
    'prompts must be settled before the queue starts');
});

test('stage 2 sends the finished artwork with the text prompt', () => {
  const engine = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'editable-page-text.cjs'), 'utf8');
  assert.match(engine, /const imagePath = locateJobImage\(project, job\)/);
  assert.match(engine, /readFileSync\(imagePath\)/);
  // Local vision runs first; the gem turn is the fallback.
  assert.match(engine, /if \(useVision\) \{/);
  assert.match(engine, /visionResultToPageText\(vision\)/);
  assert.match(engine, /generatePageText\(artwork, buildPageTextPrompt\(\{ topic, pageNumber: job\.pageNumber \}\)\)/);
  const provider = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'editable-browser-provider.cjs'), 'utf8');
  // The artwork is attached to the Gemini turn and routed to the editable gem.
  assert.match(provider, /generatePageText\(artworkBuffer, prompt\)/);
  assert.match(provider, /getJobStartUrl\(\{kind:'editable'\},'gemini'\)/);
});

test('every generation entry point restores the default prompt', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'main.cjs'), 'utf8');
  // Manual Start, single-page Generate and the automated stage all go through the same
  // helper, so a book created under the old behaviour recovers its default prompt
  // whichever way the user regenerates it.
  const start = source.slice(source.indexOf("ipcMain.handle('queue:start'"));
  assert.match(start.slice(0, 400), /restoreDefaultArtworkPrompts\(projectId\)/);
  const single = source.slice(source.indexOf("ipcMain.handle('queue:generate-job'"));
  assert.match(single.slice(0, 400), /restoreDefaultArtworkPrompts\(existing\.projectId, \[jobId\]\)/);
  assert.match(source, /function artworkBrief/);
});

test('re-wrapping a page never nests the wrapper or repeats the title', () => {
  const { buildArtworkPrompt, ARTWORK_PROMPT } = require('../src/editable-prompts.cjs');
  const brief = (job) => {
    const current = String(job.imagePrompt || '').trim();
    if (current.startsWith(ARTWORK_PROMPT)) {
      const m = current.match(/PAGE TOPIC & THEME:\s*\n\s*\d+[AT]?:\s*([\s\S]*)$/);
      return (m ? m[1] : '').trim() || String(job.prompt || '').trim();
    }
    return current || String(job.prompt || '').trim();
  };
  const job = { pageNumber: 1, title: 'RACES', imagePrompt: 'A writing strategy poster', prompt: 'orig' };
  for (let i = 0; i < 4; i += 1) {
    const rewrapping = String(job.imagePrompt || '').trim().startsWith(ARTWORK_PROMPT);
    job.imagePrompt = buildArtworkPrompt({
      pageNumber: job.pageNumber,
      pageTitle: rewrapping ? null : job.title,
      pageVisualDescription: brief(job)
    });
  }
  assert.equal(job.imagePrompt.split(ARTWORK_PROMPT).length - 1, 1);
  assert.equal(job.imagePrompt.split('\n').pop(), '01A: RACES - A writing strategy poster');
  assert.ok(job.imagePrompt.startsWith(ARTWORK_PROMPT));
});

test('completed pages keep their prompt so caches are not invalidated', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'main.cjs'), 'utf8');
  const fn = source.slice(source.indexOf('function restoreDefaultArtworkPrompts'));
  assert.match(fn.slice(0, 700), /wanted \? !wanted\.has\(job\.id\) : job\.status === 'complete'/);
});
