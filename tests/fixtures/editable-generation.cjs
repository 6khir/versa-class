'use strict';
const sharp = require('sharp');
const {templateFor}=require('../../src/editable-production.cjs');
function contract() {
 const c=templateFor({id:'p1',editableRunId:'run-1',format:'LETTER',orientation:'portrait'}, {pageNumber:1},'A01','rev-1');
 c.elements=[{id:'title',role:'title',regionId:'body',content:{text:'Count the stars'}}]; return c;
}
function layout(c=contract()) { return {elements:c.elements.map(el=>({id:el.id,text:el.content.text,font:'Nunito',fontSize:20,x:54,y:54,width:400,height:60,bold:true,italic:false,color:'#123456',alignment:'left',verticalAlignment:'top',rotation:0}))}; }
function provider(overrides={}) {return {
 async generateText(prompt){const c=JSON.parse(prompt.split('\n').at(-1)); if(prompt.includes('PAGE BRIEF:')) {c.elements=contract().elements;return JSON.stringify(c);}return JSON.stringify(layout(c));},
 async generateImage(){return sharp({create:{width:612,height:792,channels:3,background:'white'}}).png().toBuffer();},
 async validateArtwork(){return {textFree:true,method:'test-validator'};}, ...overrides
};}
module.exports={contract,layout,provider};
