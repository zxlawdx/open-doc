/* Real QtWebEngine shape visibility proof, not a JSDOM approximation. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const port=process.argv[2]||'9234';
const destination=path.resolve(__dirname,'../docs/images/ink');
(async()=>{
 const targets=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
 const ws=new WebSocket(targets.find(item=>item.type==='page').webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
 const pending=new Map();let sequence=0;
 ws.onmessage=event=>{
  const data=JSON.parse(event.data);
  if(!pending.has(data.id))return;
  const [resolve,reject]=pending.get(data.id);pending.delete(data.id);
  data.error?reject(Error(JSON.stringify(data.error))):resolve(data.result);
 };
 const send=(method,params={})=>new Promise((resolve,reject)=>{
  const id=++sequence;pending.set(id,[resolve,reject]);ws.send(JSON.stringify({id,method,params}));
 });
 const evaluate=async expression=>{
  const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
 };
 const result=await evaluate(`(()=>{
  const page=document.querySelector('.fixed-surface[data-page-index="0"]');
  const rect=page?.querySelector('.slide-object-rect');
  const ellipse=page?.querySelector('.slide-object-ellipse');
  if(!page||!rect||!ellipse)return {error:'Missing vector objects in slide DOM'};
  const b=page.getBoundingClientRect();
  const r=rect.getBoundingClientRect();
  const e=ellipse.getBoundingClientRect();
  const x=e.left+e.width/2,y=e.top+e.height/2;
  const hit=document.elementFromPoint(x,y)?.closest('[data-slide-element]')?.dataset.slideElement;
  const info=node=>({display:getComputedStyle(node).display,
   visibility:getComputedStyle(node).visibility,
   opacity:getComputedStyle(node).opacity});
  return {
   page:{x:b.left,y:b.top,width:b.width,height:b.height},
   rect:{x:r.left,y:r.top,width:r.width,height:r.height,
     fill:rect.querySelector('svg rect')?.getAttribute('fill'),...info(rect)},
   ellipse:{x:e.left,y:e.top,width:e.width,height:e.height,
     fill:ellipse.querySelector('svg ellipse')?.getAttribute('fill'),...info(ellipse)},
   hit,ellipseId:ellipse.dataset.slideElement,
   viewport:{width:innerWidth,height:innerHeight}
  };
 })()`);
 assert.ok(!result.error,JSON.stringify(result));
 for(const name of ['rect','ellipse']){
  const b=result[name];
  assert.ok(b.width>15&&b.height>15&&b.display!=='none'&&b.visibility!=='hidden'&&Number(b.opacity)>0,JSON.stringify(result));
  assert.ok(b.x>=result.page.x-1&&b.y>=result.page.y-1&&b.x+b.width<=result.page.x+result.page.width+1&&b.y+b.height<=result.page.y+result.page.height+1,JSON.stringify(result));
 }
 assert.equal(result.hit,result.ellipseId,'Top SVG shape must be selectable');
 assert.equal(result.rect.fill,'#DAE2FD');
 assert.equal(result.ellipse.fill,'#F4B183');
 fs.mkdirSync(destination,{recursive:true});
 const png=await send('Page.captureScreenshot',{format:'png'});
 const file=path.join(destination,'slide-svg-shapes.png');
 const geometry=path.join(destination,'slide-svg-shapes.json');
 fs.writeFileSync(file,Buffer.from(png.data,'base64'));
 fs.writeFileSync(geometry,JSON.stringify(result,null,2));
 console.log('QT_SLIDE_SVG_DOM_AND_HIT_TEST_OK',geometry);
 ws.close();
})().catch(error=>{console.error(error);process.exit(1);});
