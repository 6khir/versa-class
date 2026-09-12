'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {mkdtempSync,rmSync,writeFileSync,mkdirSync,existsSync}=require('node:fs');const {tmpdir}=require('node:os');const {join}=require('node:path');
const sharp=require('sharp');
const {ProjectStore}=require('../src/store.cjs');const {runEditableProject,verifyEditableOutput,ProductFileManager}=require('../src/editable-production.cjs');const {EditableRepository}=require('../src/editable-repository.cjs');

// The deterministic engine consumes the queue engine's own page images; these
// stand in for what queue-engine.cjs writes to <outputDir>/jobs/<jobId>.png.
async function pageImage(){return sharp({create:{width:612,height:792,channels:3,background:'white'}}).png().toBuffer();}
async function setup(t,count=1,{images=true}={}){
 const dir=mkdtempSync(join(tmpdir(),'versa-native-'));const store=new ProjectStore(join(dir,'store.sqlite'));
 t.after(()=>{store.db.close();rmSync(dir,{recursive:true,force:true});});
 store.createProject({id:'p1',name:'Stars',theme:'Counting stars',niche:'math',format:'LETTER',orientation:'portrait',style:'simple',activityCount:1,outputDir:dir},
  Array.from({length:count},(_,i)=>({id:`job${i+1}`,pageNumber:i+1,pageLabel:`A0${i+1}`,kind:'page',title:'Stars',prompt:'Count five stars.',fileName:`A0${i+1}.png`})));
 // Page text is the only source of slide text now. job.title and job.prompt describe
 // how the artwork was requested and must never reach a slide, so the fixture supplies
 // what the vision pass would have read off the page.
 const {jobFingerprint}=require('../src/editable-page-text.cjs');
 const seeded=store.getProject('p1');
 for (const job of seeded.jobs) {
  store.setSetting(`editable-page-text:p1:${job.id}`, {
   fingerprint:jobFingerprint(seeded,job),
   text:{title:'Stars',instruction:'Count five stars.',sections:[],footer:''}
  });
 }
 store.updateProject('p1',{productFormat:'editable'});
 if(images){mkdirSync(join(dir,'jobs'),{recursive:true});const png=await pageImage();
  for(let i=1;i<=count;i++)writeFileSync(join(dir,'jobs',`job${i}.png`),png);}
 return {store,dir};
}

test('publishes complete native output, loadable revision, and reuses verified cache',async t=>{
 const {store}=await setup(t);
 const result=await runEditableProject({store,projectId:'p1'});
 const p=store.getProject('p1');
 assert.equal(p.jobs[0].status,'complete');
 assert.deepEqual(verifyEditableOutput(p),result);
 assert.equal(new EditableRepository(store).load('p1',p.editableRunId,'A01').state.revisions[0].state,'VALIDATED');
 assert.ok((await new ProductFileManager({}).exportPptx(p)).endsWith('.pptx'));
 assert.deepEqual(await runEditableProject({store,projectId:'p1'}),result);
 assert.throws(()=>store.updateProject('p1',{productFormat:'static'}),/locked/i);
 writeFileSync(result.pages[0].layoutPath,'tampered');
 assert.throws(()=>verifyEditableOutput(store.getProject('p1')),/STALE/);
});

test('reuses the queue image as the slide background instead of regenerating it',async t=>{
 const {store,dir}=await setup(t);
 const manifest=await runEditableProject({store,projectId:'p1'});
 assert.equal(manifest.pages[0].backgroundPath,join(dir,'jobs','job1.png'));
 assert.equal(manifest.pages[0].outputPath,manifest.pages[0].backgroundPath);
 assert.equal(store.getProject('p1').jobs[0].outputPath,join(dir,'jobs','job1.png'));
});

test('a page with no generated image fails with a clear error and publishes nothing',async t=>{
 const {store}=await setup(t,1,{images:false});
 await assert.rejects(runEditableProject({store,projectId:'p1'}),{code:'EDITABLE_PAGE_IMAGE_MISSING'});
 assert.equal(store.getProject('p1').editableOutputJson,null);
});

test('generation performs no provider calls at all',async t=>{
 const {store}=await setup(t,3);
 const provider=new Proxy({},{get(){throw new Error('provider must not be used');}});
 await runEditableProject({store,projectId:'p1',provider});
 verifyEditableOutput(store.getProject('p1'));
});

test('assembles a five page editable deck well under the interactive budget',async t=>{
 const {store}=await setup(t,5);
 const startedAt=Date.now();
 const manifest=await runEditableProject({store,projectId:'p1'});
 const elapsed=Date.now()-startedAt;
 assert.equal(manifest.pages.length,5);
 assert.ok(elapsed<3000,`expected under 3000ms, took ${elapsed}ms`);
});

test('cancelled generation cannot publish',async t=>{
 const {store}=await setup(t);
 const c=new AbortController();c.abort();
 await assert.rejects(runEditableProject({store,projectId:'p1',signal:c.signal}),{code:'STEP_ABORTED'});
 assert.equal(store.getProject('p1').editableOutputJson,null);
});

test('source edits while generating reject publication',async t=>{
 const {store}=await setup(t);
 const original=store.setSetting.bind(store);
 let edited=false;
 store.setSetting=(key,value)=>{
  const result=original(key,value);
  if(!edited&&key.startsWith('editable-page-output:')){edited=true;store.updateProject('p1',{name:'Changed brief'});}
  return result;
 };
 await assert.rejects(runEditableProject({store,projectId:'p1'}),/SOURCE_CHANGED/);
 store.setSetting=original;
 assert.equal(store.getProject('p1').editableOutputJson,null);
});

test('native export contains real text shapes and the separate artwork',async t=>{
 const {store}=await setup(t);
 const m=await runEditableProject({store,projectId:'p1'});
 const zip=await require('jszip').loadAsync(require('node:fs').readFileSync(m.pptxPath));
 const xml=await zip.file('ppt/slides/slide1.xml').async('string');
 assert.match(xml,/<a:t>Stars<\/a:t>/);
 assert.match(xml,/<a:t>Count five stars\.<\/a:t>/);
 assert.match(xml,/Name: _+/);
 assert.match(xml,/<p:pic>/);
 assert.match(xml,/<p:sp>/);
});

test('per-image generation publishes only that page, then a full run completes the rest',async t=>{
 const {store}=await setup(t,2);
 const first=await runEditableProject({store,projectId:'p1',jobIds:['job2']});
 assert.equal(first.partial,true);
 assert.equal(store.getProject('p1').jobs[0].status,'pending');
 const manifest=await runEditableProject({store,projectId:'p1'});
 assert.equal(manifest.pages.length,2);
 verifyEditableOutput(store.getProject('p1'));
});

test('every page emits a completion activity before the deck is assembled',async t=>{
 const {store}=await setup(t,2);
 const phases=[];
 await runEditableProject({store,projectId:'p1',onActivity:info=>phases.push(`${info.jobId}:${info.phase}`)});
 assert.deepEqual(phases,['job1:preparing','job1:complete','job2:preparing','job2:complete']);
});
