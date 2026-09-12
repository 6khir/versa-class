'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {planEditablePage,generateStructuredLayout,generateTextFreeArtwork,parseJsonResponse}=require('../src/editable-generation-adapters.cjs');
const {buildDeterministicPageLayout}=require('../src/editable-layout-engine.cjs');
const {ARTWORK_PROMPT,assertPromptIsSafe}=require('../src/editable-prompts.cjs');
const {contract,provider}=require('./fixtures/editable-generation.cjs');

test('planning preserves ownership and keeps the supplied text',async()=>{const c=await planEditablePage(contract(),'stars',provider());assert.equal(c.elements[0].content.text,'Count the stars');assert.equal(c.revisionId,'rev-1');});
test('planning seeds a title from the brief when the template has no elements',async()=>{const t=contract();t.elements=[];const c=await planEditablePage(t,'Count the stars\nmore',provider());assert.equal(c.elements[0].role,'title');assert.equal(c.elements[0].content.text,'Count the stars');});
test('planning rejects roles the engine cannot lay out',async()=>{const t=contract();t.textRegions[0].roles.push('table');t.elements=[{id:'t1',role:'table',regionId:'body',content:{rows:[['a']]}}];await assert.rejects(planEditablePage(t,'stars',provider()),/ROLE_UNSUPPORTED/);});
test('layout is deterministic and ignores any provider',()=>assert.deepEqual(generateStructuredLayout(contract()),buildDeterministicPageLayout(contract())));
test('layout keeps every element inside its text region',()=>{const c=contract();const r=c.textRegions[0];for(const el of generateStructuredLayout(c).elements){assert.ok(el.x>=r.x&&el.y>=r.y);assert.ok(el.x+el.width<=r.x+r.width);assert.ok(el.y+el.height<=r.y+r.height);}});
test('artwork is decoded and validated',async()=>assert.ok(Buffer.isBuffer((await generateTextFreeArtwork(contract(),provider())).buffer)));
test('artwork uses the refusal-proof wrapper and no banned words',async()=>{let seen=null;await generateTextFreeArtwork(contract(),provider({generateImage:async p=>{seen=p;return require('sharp')({create:{width:612,height:792,channels:3,background:'white'}}).png().toBuffer();}}));assert.equal(seen,ARTWORK_PROMPT);assert.doesNotThrow(()=>assertPromptIsSafe(seen));});
test('artwork text or unavailable validation fails closed',async()=>{for(const evidence of [null,{textFree:false},{}])await assert.rejects(generateTextFreeArtwork(contract(),provider({validateArtwork:async()=>evidence})),/ARTWORK_TEXT/);});
test('invalid contract and malformed responses rejected',async()=>{assert.throws(()=>generateStructuredLayout(null));assert.throws(()=>parseJsonResponse('not json'));assert.deepEqual(parseJsonResponse('```json\n{}\n```'),{});});
