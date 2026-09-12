'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

// Queue lifecycle tests do not exercise these collaborators. Replacing only the
// imports made directly by queue-engine keeps this unit test deterministic and
// avoids launching browser or image-processing dependencies.
const originalLoad = Module._load;
Module._load = function loadQueueDependency(request, parent, isMain) {
  if (parent?.filename?.endsWith(`${path.sep}src${path.sep}queue-engine.cjs`)) {
    if (request === './browser-controller.cjs') return { isPersistedConversationUrl: () => true };
    if (request === './ai-engine.cjs') {
      return {
        getJobStartUrl: () => 'about:blank',
        normalizeEngine: (value) => value || 'chatgpt',
        withEngineImagePrefix: (value) => value,
        engineDisplayName: (value) => value || 'chatgpt',
        isBrowserEngine: () => true,
        isMetaLocalUrl: () => false,
        conversationMatchesEngine: () => true,
        jobRouteKind: () => 'pages'
      };
    }
    if (request === './file-manager.cjs') {
      return { resolvePageSetup: () => ({ width: 2550, height: 3300, label: 'US Letter', orientationLabel: 'Portrait', aspectRatioLabel: '8.5:11' }) };
    }
    if (request === './prompt-builder.cjs') return { looksLikePageImagePrompt: () => true };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { QueueEngine } = require('../src/queue-engine.cjs');
Module._load = originalLoad;

function createHarness() {
  const browser = new EventEmitter();
  let rejectAuthentication = null;
  browser.beginWork = () => {};
  browser.endWork = () => {};
  browser.launch = async () => {};
  browser.assertAuthenticated = () => new Promise((_resolve, reject) => { rejectAuthentication = reject; });
  browser.cancelWaits = () => {
    rejectAuthentication?.(Object.assign(new Error('Waiting was paused.'), { code: 'QUEUE_PAUSED' }));
  };

  const project = {
    id: 'p1',
    name: 'Queue Book',
    format: 'letter',
    orientation: 'portrait',
    jobs: [{id:"j1",projectId:"p1",pageNumber:1,status:"pending",attempts:0}],
    stats: { total: 1, complete: 0 }
  };
  const events = [];
  const store = {
    getProject: (id) => id === project.id ? project : null,
    getSetting: (_key, fallback) => fallback,
    setSetting: () => {},
    listEvents: () => [],
    updateProject: (_id, patch) => Object.assign(project, patch),
    getJob: () => project.jobs[0],
    updateJob: (_id,patch) => Object.assign(project.jobs[0],patch),
    getNextIncompleteBatch: () => project.jobs,
    appendEvent: (event) => events.push(event)
  };
  const queue = new QueueEngine({ store, browser, fileManager: {} });
  return { queue, project, events };
}

test('QueueEngine enforces one active project and treats same-project start as idempotent', async () => {
  const { queue } = createHarness();
  queue.start('p1');

  assert.equal(queue.start('p1').running, true);
  assert.throws(() => queue.start('p2'), { code: 'QUEUE_BUSY' });

  await new Promise((resolve) => setImmediate(resolve));
  const stopped = await queue.pauseAndWait({ timeoutMs: 100 });
  assert.equal(stopped.settled, true);
  assert.equal(queue.running, false);
});

test('pauseAndWait cancels even an unresponsive authentication call', async () => {
  const { queue } = createHarness();
  queue.browser.cancelWaits = () => {};
  queue.start('p1');

  await new Promise((resolve) => setImmediate(resolve));
  const stopped = await queue.pauseAndWait({ timeoutMs: 20 });
  assert.equal(stopped.settled, true);
  assert.equal(queue.running, false);
  assert.equal(queue.pauseRequested, false);
});

test('the shared queue runner never restarts a stopped queue behind the retry fence', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8');
  // The interior and interior_artwork steps both drive the queue through this helper.
  const start = source.indexOf('function runQueueToCompletion(projectId, onProgress)');
  const end = source.indexOf('\nfunction ', start + 1);
  assert.ok(start > -1 && end > start, 'runQueueToCompletion should be present');

  const runner = source.slice(start, end);
  const queueStarts = runner.match(/queue\.start\(projectId\)/g) || [];
  assert.equal(queueStarts.length, 1, 'only the initial queue start is allowed inside the runner');
  assert.match(runner, /automation\?\.getStatus\(\)\?\.paused\) return/);
  assert.match(runner, /code: 'QUEUE_STOPPED'/);
  assert.doesNotMatch(runner, /lastRestartAt/);
  assert.match(runner, /queue\.on\('heartbeat', keepAlive\)/);
  assert.match(runner, /queue\.removeListener\('heartbeat', keepAlive\)/);

  // Neither step may start the queue itself; both must go through the helper.
  for (const step of ['interior: async (projectId, onProgress) =>', 'interior_artwork: async (projectId, onProgress) =>']) {
    const stepStart = source.indexOf(step);
    assert.ok(stepStart > -1, `${step} should be present`);
    const body = source.slice(stepStart, source.indexOf('\n      },', stepStart));
    assert.doesNotMatch(body, /queue\.start\(/);
    assert.match(body, /runQueueToCompletion\(projectId, onProgress\)/);
  }
});

function generationHarness(t,{count=2,...options}={}) {
  const dir=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'versa-recovery-'));
  const jobs=Array.from({length:count},(_,i)=>({id:`j${i+1}`,projectId:'p1',pageNumber:i+1,status:'pending',attempts:0,prompt:'Draw a counting activity',fileName:`A0${i+1}.png`,baseline:[]}));
  const project={id:'p1',name:'Recovery',format:'LETTER',orientation:'portrait',outputDir:dir,jobs};
  const events=[];const calls=[];const settings=new Map();
  const store={getProject:()=>({...project,stats:{total:jobs.length,complete:jobs.filter(j=>j.status==='complete').length}}),getJob:id=>jobs.find(j=>j.id===id),getSetting:(k,f)=>settings.has(k)?settings.get(k):f,setSetting:(k,v)=>settings.set(k,v),listEvents:()=>[],appendEvent:e=>events.push(e),updateProject:(_id,p)=>Object.assign(project,p),updateJob:(id,p)=>{const j=jobs.find(j=>j.id===id);Object.assign(j,p);if(p.baselineJson!==undefined)j.baseline=p.baselineJson || [];return {...j};},getNextIncompleteBatch:()=>jobs.filter(j=>j.status!=='complete'),resetJob:id=>store.updateJob(id,{status:'pending',attempts:0}),resetIncomplete:()=>jobs.forEach(j=>{if(j.status!=='complete')store.resetJob(j.id);})};
  const browser=new EventEmitter();
  Object.assign(browser,{beginWork(){},endWork(){},cancelWaits(){},abortJob:async()=>{},releaseJob:async()=>{},launch:async()=>{},assertAuthenticated:async()=>{},submitPrompt:async(_p,{jobId})=>{calls.push(jobId);return{baseline:['before'],conversationUrl:'https://chatgpt.com/c/one'};},waitForNewImage:async()=>({src:'image'}),fetchImage:async()=>({buffer:Buffer.from('image')}),checkRequestAccess:async()=>({available:true})});
  const fm={saveGeneratedImage:async({job})=>{const outputPath=path.join(dir,job.fileName);fs.writeFileSync(outputPath,'image');return{outputPath,width:2550,height:3300};}};
  const queue=new QueueEngine({store,browser,fileManager:fm,retryDelayMs:1,retryReloadDelayMs:0,submissionSpacingMs:0,submissionJitterMs:0,requestCooldownMs:2,operationTimeoutMs:30,generationTimeoutMs:30,heartbeatMs:2,maxAttempts:2,...options});
  t.after(async()=>{await queue.pauseAndWait({timeoutMs:100});fs.rmSync(dir,{recursive:true,force:true});});
  const start=(opts)=>{queue.start('p1',opts);queue.submissionJitterMs=0;return queue.runPromise;};
  return {queue,store,browser,project,jobs,events,calls,start,fm,settings};
}
test('transient failures recover beyond maxAttempts without skipping the failed image',async t=>{
 const h=generationHarness(t);let attempts=0;h.browser.waitForNewImage=async()=>{if(++attempts<=3)throw Error('Temporary generation failure');return{src:'image'};};
 await h.start();assert.deepEqual(h.calls,['j1','j1','j1','j1','j2']);assert.ok(h.jobs.every(j=>j.status==='complete'));assert.equal(h.jobs[0].attempts,4);
});
test('stuck image wait times out, emits activity and regenerates automatically',async t=>{
 const h=generationHarness(t,{count:1});let n=0,heartbeats=0,recovered=0;h.browser.waitForNewImage=()=>++n===1?new Promise(()=>{}):Promise.resolve({src:'image'});h.browser.abortJob=async()=>{recovered++;};h.queue.on('heartbeat',()=>heartbeats++);
 await h.start();assert.equal(n,2);assert.ok(recovered>0);assert.ok(heartbeats>2);assert.equal(h.jobs[0].status,'complete');
});
test('Pause is bounded while submission hangs, late results cannot complete a page, Start resumes it',async t=>{
 const h=generationHarness(t,{count:1,operationTimeoutMs:1000});let resolveOld;h.browser.submitPrompt=()=>new Promise(r=>{resolveOld=r;});const run=h.start();
 while(!resolveOld)await new Promise(r=>setImmediate(r));
 await h.queue.pauseAndWait({timeoutMs:100});assert.equal(h.queue.running,false);assert.notEqual(h.jobs[0].status,'complete');
 resolveOld({baseline:[],conversationUrl:'old'});await new Promise(r=>setImmediate(r));assert.notEqual(h.jobs[0].conversationUrl,'old');
 h.browser.submitPrompt=async()=>({baseline:[],conversationUrl:'new'});await h.start();assert.equal(h.jobs[0].status,'complete');await run;
});
test('Start during Pause resumes after the old run has released control',async t=>{
 const h=generationHarness(t,{count:1});let pauseOnce=true;h.browser.waitForNewImage=async()=>{if(pauseOnce){pauseOnce=false;h.queue.pause();h.queue.start('p1');throw Object.assign(Error('paused'),{code:'QUEUE_PAUSED'});}return{src:'image'};};
 await h.start();while(h.queue.runPromise)await h.queue.runPromise;assert.equal(h.jobs[0].status,'complete');
});
test('Generate starts only the selected image; full Start later completes remaining images',async t=>{
 const h=generationHarness(t,{count:3});h.queue.generate('j2');h.queue.submissionJitterMs=0;await h.queue.runPromise;assert.deepEqual(h.calls,['j2']);assert.equal(h.jobs[0].status,'pending');await h.start();assert.deepEqual(h.calls,['j2','j1','j3']);
});
test('missing saved output is regenerated, good images are preserved',async t=>{
 const h=generationHarness(t);h.jobs[0].status='complete';h.jobs[0].outputPath=path.join(h.project.outputDir,'missing.png');await h.start();assert.deepEqual(h.calls,['j1','j2']);const outputs=h.jobs.map(j=>j.outputPath);await h.start();assert.deepEqual(h.jobs.map(j=>j.outputPath),outputs);assert.equal(h.calls.length,2);
});
test('old exhausted jobs and temporary request limits recover automatically',async t=>{
 const h=generationHarness(t,{count:1});Object.assign(h.jobs[0],{status:'needs_user_action',lastErrorCode:'IMAGE_TIMEOUT',attempts:5});let n=0;h.browser.waitForNewImage=async()=>{if(++n===1)throw Object.assign(Error('Slow down'),{code:'RATE_LIMIT'});return{src:'image'};};await h.start();assert.equal(h.jobs[0].status,'complete');assert.equal(n,2);
});
test('baked pages submit the text-rebuild source control lines first', async t => {
  const h = generationHarness(t, { count: 1 });
  let seen = '';
  h.jobs[0].imagePrompt = '@image A classroom page titled "Count to 5" with large icons and safe print margins on A4 portrait 2480 × 3508 px.';
  h.jobs[0].prompt = h.jobs[0].imagePrompt;
  h.browser.submitPrompt = async (prompt) => {
    seen = String(prompt || '');
    return { baseline: ['before'], conversationUrl: 'https://chatgpt.com/c/one' };
  };
  await h.start();
  assert.match(seen, /TEXT-REBUILD SOURCE\./);
  assert.match(seen, /KEEP BAKED TEXT\./);
  assert.match(seen, /ERASABLE PRINT\./);
  assert.match(seen, /sequence_index: 1/);
  assert.match(seen, /sequence_total: 1/);
  assert.match(seen, /page_role: front-cover/);
  assert.match(seen, /Count to 5/);
  assert.doesNotMatch(seen, /\beditable\b/i);
  assert.ok(seen.indexOf('TEXT-REBUILD SOURCE.') < seen.indexOf('Count to 5'));
});

test('queue prompt wrapping and master validation stay behind an explicit editable mode',()=>{
 const source=fs.readFileSync(path.join(__dirname,'..','src','queue-engine.cjs'),'utf8');
 assert.match(source,/applyEditableMasterPrompt/);
 assert.match(source,/applyTextRebuildSourcePrompt/);
 assert.match(source,/shouldApplyTextRebuildSource/);
 assert.match(source,/resolveStoredGenerationMode/);
 assert.match(source,/assertTextFreeMaster/);
 assert.match(source,/This request is page \$\{pageNumber\} of \$\{total\}/);
 assert.match(source,/Not regenerated/);
 assert.match(source,/cleanBlankMaster/);
 assert.ok(source.indexOf('editableRequested') < source.indexOf('cleanBlankMaster'));
});
