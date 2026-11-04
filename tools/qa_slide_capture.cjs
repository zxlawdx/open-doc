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
 assert.equal(result.ellipse.fill.toUpperCase(),'#F4B183');
 fs.mkdirSync(destination,{recursive:true});
 const png=await send('Page.captureScreenshot',{format:'png'});
 const file=path.join(destination,'slide-svg-shapes.png');
 const geometry=path.join(destination,'slide-svg-shapes.json');
 fs.writeFileSync(file,Buffer.from(png.data,'base64'));
 fs.writeFileSync(geometry,JSON.stringify(result,null,2));
 console.log('QT_SLIDE_SVG_DOM_AND_HIT_TEST_OK',geometry);
 // Regression reported by Windows users: the "Endereço" dialog was placed
 // outside the clickable region because Chromium 83 ignores CSS inset:0.
 await evaluate('(()=>{OpenDocApp.action("link");return true})()');
 let dialogOpen=false;
 for(let i=0;i<24;i++){
  dialogOpen=await evaluate("document.querySelector('[data-dialog]')?.hidden===false");
  if(dialogOpen)break;
  await new Promise(resolve=>setTimeout(resolve,125));
 }
 assert.ok(dialogOpen,'The link dialog must open before Cancel can be tested');
 const dialog=await evaluate(`(()=>{
   const overlay=document.querySelector('[data-dialog]');
   const cancel=document.querySelector('[data-dialog-cancel]');
   const back=overlay.getBoundingClientRect(),c=cancel.getBoundingClientRect();
   const x=c.x+c.width/2,y=c.y+c.height/2;
   return {back:{x:back.x,y:back.y,width:back.width,height:back.height},
     cancel:{x,y,width:c.width,height:c.height},
     hit:document.elementFromPoint(x,y)?.closest('[data-dialog-cancel]')===cancel,
     hidden:overlay.hidden,display:getComputedStyle(overlay).display,
     viewport:{width:innerWidth,height:innerHeight}};
 })()`);
 assert.ok(dialog.back.width>=dialog.viewport.width-2 &&
   dialog.back.height>=dialog.viewport.height-2,
   'Modal backdrop does not cover legacy Qt viewport: '+JSON.stringify(dialog));
 assert.ok(dialog.hit,'Cancel must receive actual pointer input: '+JSON.stringify(dialog));
 const dialogShot=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync(path.join(destination,'slide-link-dialog.png'),Buffer.from(dialogShot.data,'base64'));
 for(const type of ['mousePressed','mouseReleased'])
   await send('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,
     x:dialog.cancel.x,y:dialog.cancel.y});
 const cancelled=await evaluate(`(()=>{
   const el=document.querySelector('[data-dialog]');
   return {hidden:el.hidden,display:getComputedStyle(el).display,
     inlineDisplay:el.style.display};
 })()`);
 assert.equal(cancelled.hidden,true,'Cancel should hide link dialog');
 assert.equal(cancelled.display,'none','Dialog should not remain on screen after Cancel');
 console.log('QT_DIALOG_CANCEL_POINTER_AND_VISIBILITY_OK');

 const added=await evaluate("(()=>{const input=document.querySelector('.slide-studio-toolbar input[type=file]');if(!input)return false;const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGMUSTnxn4GBgYGJAQoAIXQCQ5eZzjUAAAAASUVORK5CYII='),c=>c.charCodeAt(0));const file=new File([bytes],'qt-pixel.png',{type:'image/png'});Object.defineProperty(input,'files',{configurable:true,value:[file]});input.dispatchEvent(new Event('change',{bubbles:true}));return true;})()");
 assert.ok(added,'Qt file input for slide images missing');
 let decoded=false;
 for(let attempt=0;attempt<40;attempt++){
   decoded=await evaluate("(()=>{const img=document.querySelector('.slide-object-image img');return !!img&&img.complete&&img.naturalWidth===2&&img.naturalHeight===2;})()");
   if(decoded)break;
   await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.ok(decoded,'Qt did not decode slide image after FileReader input');
 const imageGeometry=await evaluate("(()=>{const item=document.querySelector('.slide-object-image');const pic=item.querySelector('img');const box=pic.getBoundingClientRect();const x=box.left+box.width/2,y=box.top+box.height/2;return {x:box.x,y:box.y,width:box.width,height:box.height,hit:document.elementFromPoint(x,y)?.closest('[data-slide-element]')?.dataset.slideElement,imageId:item.dataset.slideElement,viewport:{width:innerWidth,height:innerHeight}};})()");
 assert.ok(imageGeometry.width>20&&imageGeometry.height>20,'Qt slide image has zero size');
 assert.equal(imageGeometry.hit,imageGeometry.imageId,'Qt slide image not selectable');
 const imageShot=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync(path.join(destination,'slide-native-image.png'),Buffer.from(imageShot.data,'base64'));
 fs.writeFileSync(path.join(destination,'slide-native-image.json'),JSON.stringify(imageGeometry,null,2));
 console.log('QT_SLIDE_NATIVE_IMAGE_VISIBLE_AND_SELECTABLE_OK');
 ws.close();
})().catch(error=>{console.error(error);process.exit(1);});
