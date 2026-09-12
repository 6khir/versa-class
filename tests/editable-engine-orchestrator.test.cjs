'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const sharp=require('sharp');
const {runEditablePagePipeline,assertEditableLayoutMatchesContract}=require('../src/editable-engine-orchestrator.cjs');
const {contract,layout,provider}=require('./fixtures/editable-generation.cjs');
const {buildDeterministicPageLayout}=require('../src/editable-layout-engine.cjs');

test('full page pipeline returns matching artwork, native layout and composite',async()=>{const r=await runEditablePagePipeline(contract(),provider());assert.equal(r.resolvedLayout.elements[0].text,'Count the stars');assert.equal((await sharp(r.compositedPng).metadata()).width,612);assert.equal(r.evidence.textFree,true);assert.notDeepEqual(r.backgroundPng,r.compositedPng);});
test('layout is computed locally, so no text provider is consulted',async()=>{
 const calls=[];
 const p=provider({
  async generateText(){calls.push('text');throw new Error('layout must not call a text provider');},
  async generateTextLayout(){calls.push('layout');throw new Error('layout must not call a vision provider');},
  async generateImage(){calls.push('artwork');return sharp({create:{width:612,height:792,channels:3,background:'white'}}).png().toBuffer();}
 });
 const r=await runEditablePagePipeline(contract(),p);
 assert.deepEqual(calls,['artwork']);
 assert.deepEqual(r.resolvedLayout,buildDeterministicPageLayout(contract()));
});
test('missing provider rejected',async()=>assert.rejects(runEditablePagePipeline(contract()),/ORCHESTRATOR_INVALID_INPUT/));

// The validator is the gate every layout must pass, so exercise it directly now
// that the deterministic engine — not a provider — produces the geometry.
for(const [name,edit,expected] of [
 ['text',l=>l.elements[0].text='wrong',/PAIRING/],
 ['duplicate',l=>l.elements.push({...l.elements[0]}),/PAIRING/],
 ['missing',l=>l.elements=[],/PAIRING/],
 ['bounds',l=>l.elements[0].x=0,/BOUNDS/],
 ['style',l=>l.elements[0].fontSize=500,/STYLE/],
 ['rotation',l=>l.elements[0].rotation=90,/ROTATION/]
]) test(`validator rejects invalid ${name}`,()=>{const l=layout();edit(l);assert.throws(()=>assertEditableLayoutMatchesContract(contract(),l),expected);});

test('validator accepts the deterministic engine output',()=>{const c=contract();assert.doesNotThrow(()=>assertEditableLayoutMatchesContract(c,buildDeterministicPageLayout(c)));});
