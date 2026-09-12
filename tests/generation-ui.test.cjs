'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../renderer/renderer.js'),'utf8');
test('heartbeat updates the active image fill without rebuilding controls, including existing images',()=>{
 const a=source.indexOf('function updateLiveImageFill()');const b=source.indexOf('\napi.onHeartbeat(',a);assert.ok(a>=0&&b>a);
 let fill;const label={textContent:''};const classes=new Set();const attrs=new Map();
 const card={dataset:{jobId:'j1'},classList:{add:c=>classes.add(c),remove:c=>classes.delete(c)},setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k),querySelector:selector=>selector==='.page-visual'?{style:{setProperty:(_k,v)=>{fill=v;}}}:label};
 const activity=new Map([['j1',{phase:'generating',generating:true,elapsedMs:1000,receivedAt:Date.now()}]]);
 const state={queue:{activeJobId:'j1'}};
 const context={activeProject:()=>({id:'p1'}),isGeneratingThisProject:()=>true,generationActivity:activity,state,elements:{jobsTable:{querySelectorAll:()=>[card]}}};
 vm.createContext(context);vm.runInContext(source.slice(a,b),context);context.updateLiveImageFill();const first=parseFloat(fill);assert.ok(classes.has('is-live'));assert.match(label.textContent,/generating/);assert.doesNotMatch(label.textContent,/%/);
 activity.set('j1',{phase:'generating',generating:true,elapsedMs:100000,receivedAt:Date.now()});context.updateLiveImageFill();assert.ok(parseFloat(fill)>first);assert.ok(parseFloat(fill)<100);
 state.queue.pauseRequested=true;const paused=fill;context.updateLiveImageFill();assert.equal(fill,paused);
});
test('observer image_ready clears the live glow without waiting for a store refresh',()=>{
 const a=source.indexOf('function updateLiveImageFill()');const b=source.indexOf('\napi.onHeartbeat(',a);
 let fill;const label={textContent:''};const classes=new Set(['is-live']);
 const card={dataset:{jobId:'j1'},classList:{add:c=>classes.add(c),remove:c=>classes.delete(c)},setAttribute(){},removeAttribute(){},querySelector:selector=>selector==='.page-visual'?{style:{setProperty:(_k,v)=>{fill=v;}}}:label};
 const activity=new Map([['j1',{phase:'image_ready',generating:false,elapsedMs:12000,receivedAt:Date.now()}]]);
 const context={activeProject:()=>({id:'p1'}),isGeneratingThisProject:()=>true,generationActivity:activity,state:{queue:{activeJobId:'j1'}},elements:{jobsTable:{querySelectorAll:()=>[card]}}};
 vm.createContext(context);vm.runInContext(source.slice(a,b),context);context.updateLiveImageFill();
 assert.equal(classes.has('is-live'),false);assert.match(label.textContent,/Almost there/);assert.equal(fill,'96%');
});
test('renderer stores the observer generating flag from queue:heartbeat',()=>{
 assert.match(source,/generating: typeof generating === 'boolean' \? generating : prev\.generating/);
 assert.match(source,/function observerGenerating\(activity\)/);
 assert.match(source,/activity\.generating === false/);
 assert.match(source,/isLive = observerGenerating\(generationActivity\.get\(job\.id\)\)/);
});
test('Generate does not require a saved conversation or a manual queue reset',()=>{
 assert.match(source,/data-action="generate-job"/);assert.match(source,/api\.generateJob\(jobId\)/);assert.match(source,/retryJobButton\.textContent = job\?\.outputPath \? 'Regenerate' : 'Generate'/);
 const main=fs.readFileSync(path.join(__dirname,'../src/main.cjs'),'utf8');assert.match(main,/ipcMain.handle\('queue:generate-job'/);assert.match(main,/queue.generate\(jobId\)/);assert.doesNotMatch(main,/browser: await browser.status\(\)/);
});
