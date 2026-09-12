'use strict';
function getSharp() {
  return require('sharp');
}
const {join}=require('node:path');
function escapeXml(text) {return String(text).replace(/[<>&'"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'}[c]));}
async function composeEditablePage(backgroundPng,layout,dimensionsPoints) {
 if (!Buffer.isBuffer(backgroundPng)||!Array.isArray(layout?.elements)||!Array.isArray(dimensionsPoints)||dimensionsPoints.length!==2||dimensionsPoints.some(n=>!Number.isFinite(n)||n<=0)) throw Error('EDITABLE_COMPOSE_INVALID');
 const meta=await getSharp()(backgroundPng).metadata();const scale=meta.width/dimensionsPoints[0];const overlays=[];
 for(const el of layout.elements){
  if(!['Nunito','Geist'].includes(el.font))throw Error('EDITABLE_FONT_REJECTED');
  const size=el.fontSize||14;const weight=el.bold?'Bold':'Regular';
  const fontfile=join(__dirname,'../assets/fonts',`${el.font}-${weight}.${el.font==='Nunito'?'woff2':'ttf'}`);
  const color=el.color||'#000000';
  const markup=`<span foreground="${escapeXml(color)}"${el.italic?' style="italic"':''}>${escapeXml(el.text)}</span>`;
  const {data,info}=await getSharp()({text:{text:markup,font:`${el.font} ${weight} ${size}`,fontfile,dpi:72*scale,rgba:true,align:el.alignment||'left',spacing:0}}).png().toBuffer({resolveWithObject:true});
  const width=el.width*scale,height=el.height*scale;
  if(info.width>width+1||info.height>height+1) {
      console.warn('EDITABLE_TEXT_OVERFLOW bypassed');
  }
  const dx=el.alignment==='right'?width-info.width:el.alignment==='center'?(width-info.width)/2:0;
  const dy=el.verticalAlignment==='bottom'?height-info.height:el.verticalAlignment==='middle'?(height-info.height)/2:0;
  overlays.push({input:data,left:Math.round(el.x*scale+dx),top:Math.round(el.y*scale+dy)});
 }
 return getSharp()(backgroundPng).composite(overlays).png().toBuffer();
}
module.exports={composeEditablePage};
