'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {mkdtempSync,rmSync,writeFileSync,mkdirSync}=require('node:fs');const {tmpdir}=require('node:os');const {join}=require('node:path');
const sharp=require('sharp');
const {ProjectStore}=require('../src/store.cjs');
const {generateEditablePageText,readCachedPageText,normalizePageText}=require('../src/editable-page-text.cjs');
const {runEditableProject}=require('../src/editable-production.cjs');
const {assertPromptIsSafe}=require('../src/editable-prompts.cjs');

const ANSWER={title:'Counting Stars',instruction:'Count each star and write the number.',sections:['How many stars?','Draw two more.'],footer:'Name: ______ Date: ______'};
function provider(overrides={}){return {async generatePageText(){return JSON.stringify(ANSWER);},...overrides};}

async function setup(t,count=1){
 const dir=mkdtempSync(join(tmpdir(),'versa-text-'));const store=new ProjectStore(join(dir,'store.sqlite'));
 t.after(()=>{store.db.close();rmSync(dir,{recursive:true,force:true});});
 store.createProject({id:'p1',name:'Stars',theme:'Counting stars',niche:'math',format:'LETTER',orientation:'portrait',style:'simple',activityCount:1,outputDir:dir},
  Array.from({length:count},(_,i)=>({id:`job${i+1}`,pageNumber:i+1,pageLabel:`A0${i+1}`,kind:'page',title:'Stars',prompt:'Count five stars.',fileName:`A0${i+1}.png`})));
 // Page text is the only source of slide text now. job.title and job.prompt describe
 // how the artwork was requested and must never reach a slide, so the fixture supplies
 // what the vision pass would have read off the page.

 store.updateProject('p1',{productFormat:'editable'});
 mkdirSync(join(dir,'jobs'),{recursive:true});
 const png=await sharp({create:{width:612,height:792,channels:3,background:'white'}}).png().toBuffer();
 for(let i=1;i<=count;i++)writeFileSync(join(dir,'jobs',`job${i}.png`),png);
 return {store,dir};
}

test('writes and caches page text, sending the artwork and a safe prompt',async t=>{
 const {store}=await setup(t);
 let sawArtwork=null,sawPrompt=null;
 const r=await generateEditablePageText({store,projectId:'p1',provider:provider({async generatePageText(art,prompt){sawArtwork=art;sawPrompt=prompt;return JSON.stringify(ANSWER);}})});
 assert.equal(r.pages.length,1);
 assert.ok(Buffer.isBuffer(sawArtwork)&&sawArtwork.length>0);
 assert.doesNotThrow(()=>assertPromptIsSafe(sawPrompt));
 assert.deepEqual(readCachedPageText(store,store.getProject('p1'),store.getProject('p1').jobs[0]),ANSWER);
});

test('cached pages are not regenerated unless forced',async t=>{
 const {store}=await setup(t);
 let calls=0;const p=provider({async generatePageText(){calls++;return JSON.stringify(ANSWER);}});
 await generateEditablePageText({store,projectId:'p1',provider:p});
 await generateEditablePageText({store,projectId:'p1',provider:p});
 assert.equal(calls,1);
 await generateEditablePageText({store,projectId:'p1',provider:p,force:true});
 assert.equal(calls,2);
});

test('editing the page invalidates its cached text',async t=>{
 const {store}=await setup(t);
 await generateEditablePageText({store,projectId:'p1',provider:provider()});
 store.updateJob('job1',{imagePrompt:'Count six stars.'});
 assert.equal(readCachedPageText(store,store.getProject('p1'),store.getProject('p1').jobs[0]),null);
});

test('malformed and empty answers are rejected',async t=>{
 const {store}=await setup(t);
 await assert.rejects(generateEditablePageText({store,projectId:'p1',provider:provider({generatePageText:async()=>'not json'})}));
 await assert.rejects(generateEditablePageText({store,projectId:'p1',provider:provider({generatePageText:async()=>JSON.stringify({sections:[]})})}),{code:'EDITABLE_PAGE_TEXT_EMPTY'});
 assert.throws(()=>normalizePageText(null),{code:'EDITABLE_PAGE_TEXT_INVALID'});
});

test('a provider without vision is refused',async t=>{
 const {store}=await setup(t);
 await assert.rejects(generateEditablePageText({store,projectId:'p1',provider:{}}),{code:'EDITABLE_TEXT_PROVIDER_MISSING'});
});

test('cancellation stops before writing any text',async t=>{
 const {store}=await setup(t);
 const c=new AbortController();c.abort();
 await assert.rejects(generateEditablePageText({store,projectId:'p1',provider:provider(),signal:c.signal}),{code:'STEP_ABORTED'});
 assert.equal(readCachedPageText(store,store.getProject('p1'),store.getProject('p1').jobs[0]),null);
});

test('assembly uses Stage 2 text and still makes no provider calls',async t=>{
 const {store}=await setup(t);
 await generateEditablePageText({store,projectId:'p1',provider:provider()});
 const manifest=await runEditableProject({store,projectId:'p1'});
 const zip=await require('jszip').loadAsync(require('node:fs').readFileSync(manifest.pptxPath));
 const xml=await zip.file('ppt/slides/slide1.xml').async('string');
 assert.match(xml,/<a:t>Counting Stars<\/a:t>/);
 assert.match(xml,/<a:t>Count each star and write the number\.<\/a:t>/);
 assert.match(xml,/<a:t>How many stars\?<\/a:t>/);
 assert.match(xml,/<a:t>Draw two more\.<\/a:t>/);
});

test('a page with no page text ships as artwork, never as the generation prompt',async t=>{
 // This used to fall back to job.title, job.prompt and job.imagePrompt. Those describe
 // how the artwork was requested, not what is on it, so real books shipped with slides
 // reading "Prompt 2: @image A RACES writing strategy anchor chart poster page, 2480 x
 // 3508 px, rendered in the crayon-box visual style...". A customer must never see that.
 const {store}=await setup(t);
 const project=store.getProject('p1');
 store.updateJob(project.jobs[0].id,{imagePrompt:'@image A vibrant colorful cover page, 2480 x 3508 px'});
 const manifest=await runEditableProject({store,projectId:'p1'});
 const zip=await require('jszip').loadAsync(require('node:fs').readFileSync(manifest.pptxPath));
 const xml=await zip.file('ppt/slides/slide1.xml').async('string');
 // The artwork is still there.
 assert.match(xml,/<p:pic>/);
 // Nothing from the request leaked onto the slide.
 assert.doesNotMatch(xml,/@image/);
 assert.doesNotMatch(xml,/2480/);
 assert.doesNotMatch(xml,/Prompt \d/i);
 assert.doesNotMatch(xml,/Count five stars/);
 assert.doesNotMatch(xml,/<a:t>Stars<\/a:t>/);
});

test('written page text survives a later artwork run', async t => {
 const {store}=await setup(t,2);
 await generateEditablePageText({store,projectId:'p1',provider:provider()});
 const before=store.getProject('p1').jobs.map(j=>readCachedPageText(store,store.getProject('p1'),j));
 assert.ok(before.every(Boolean));
 // A completed page must keep its prompt, or its fingerprint changes and text is lost.
 store.updateJob('job1',{status:'complete'});
 const p=store.getProject('p1');
 for(const job of p.jobs) if(job.status==='complete') assert.ok(readCachedPageText(store,p,job));
});

test('changing a page brief does invalidate only that page', async t => {
 const {store}=await setup(t,2);
 await generateEditablePageText({store,projectId:'p1',provider:provider()});
 store.updateJob('job1',{imagePrompt:'A different page brief'});
 const p=store.getProject('p1');
 assert.equal(readCachedPageText(store,p,p.jobs.find(j=>j.id==='job1')),null);
 assert.ok(readCachedPageText(store,p,p.jobs.find(j=>j.id==='job2')));
});

test('gem replies wrapped in labels or prose still parse', () => {
 const {parseJsonResponse}=require('../src/editable-generation-adapters.cjs');
 const expected={title:'A',sections:['q']};
 // Shapes seen from the live gem, including the "JSON { ..." label that failed.
 for(const raw of [
  JSON.stringify(expected),
  `JSON ${JSON.stringify(expected)}`,
  '```json\n'+JSON.stringify(expected)+'\n```',
  `Here is the text:\n${JSON.stringify(expected)}`,
  `${JSON.stringify(expected)}\nLet me know if you want changes.`
 ]) assert.deepEqual(parseJsonResponse(raw),expected);
 assert.deepEqual(parseJsonResponse('JSON {"title":"Use { and } braces"}'),{title:'Use { and } braces'});
 assert.throws(()=>parseJsonResponse('no json at all'));
});
