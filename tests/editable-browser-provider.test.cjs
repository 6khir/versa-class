'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createEditableBrowserProvider}=require('../src/editable-browser-provider.cjs');
test('browser provider uses Gemini text and image generation with response baselines',async()=>{const calls=[];const browser={withEngine:async(engine,fn)=>{assert.equal(engine,'gemini');return fn();},launch:async()=>{},submitPrompt:async(prompt,opts)=>{calls.push(opts.promptKind);return{baseline:['before']};},ensurePage:async()=>({}),waitForAssistantTextResponse:async b=>{assert.deepEqual(b,['before']);return'{"elements":[]}';},waitForNewImage:async b=>{assert.deepEqual(b,['before']);return{src:'image'};},fetchImage:async src=>({buffer:Buffer.from(src)})};const p=createEditableBrowserProvider(browser);assert.equal(await p.generateText('contract'),'{"elements":[]}');assert.deepEqual(await p.generateImage('artwork'),Buffer.from('image'));assert.deepEqual(calls,['generate-prompts','page']);});
test('native browser generation can pause even when submit never resolves',async()=>{
 const controller=new AbortController();let entered=false;
 const browser={withEngine:async(_e,fn)=>fn(),launch:async()=>{},submitPrompt:()=>{entered=true;return new Promise(()=>{});},cancelWaits(){},abortJob:async()=>{}};
 const p=createEditableBrowserProvider(browser,{signal:controller.signal,jobId:'j1'}).generateImage('art');while(!entered)await new Promise(r=>setImmediate(r));controller.abort();await assert.rejects(p,{code:'QUEUE_PAUSED'});
});
