/* Real Qt math gallery + inserted formula screenshot. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const port=process.argv[2]||'9234';
(async()=>{
 const tabs=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
 const page=tabs.find(t=>t.type==='page');
 assert.ok(page?.webSocketDebuggerUrl);
 const ws=new WebSocket(page.webSocketDebuggerUrl);
 await new Promise((ok,err)=>{ws.onopen=ok;ws.onerror=err;});
 let id=0;const pending=new Map();
 ws.onmessage=e=>{
  const r=JSON.parse(e.data),p=pending.get(r.id);if(!p)return;
  pending.delete(r.id);r.error?p[1](Error(JSON.stringify(r.error))):p[0](r.result);
 };
 const send=(method,params={})=>new Promise((ok,err)=>{
  const n=++id;pending.set(n,[ok,err]);ws.send(JSON.stringify({id:n,method,params}));
 });
 const evalJS=async script=>{
  const r=await send('Runtime.evaluate',{expression:script,returnByValue:true,awaitPromise:true});
  if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
 };
 await send('Emulation.setDeviceMetricsOverride',
  {width:1600,height:900,deviceScaleFactor:1,mobile:false});
 const output=path.resolve(__dirname,'../docs/images/math');
 fs.mkdirSync(output,{recursive:true});
 const click=async css=>evalJS('(()=>{const el=document.querySelector('+JSON.stringify(css)+');if(!el)return false;el.click();return true})()');
 assert.ok(await click('.slide-studio-toolbar button[title^="Inserir integrais"]'),
  'Math gallery SVG toolbar action missing');
 const state=await evalJS('(()=>{const p=document.querySelector(".slide-math-gallery");return {visible:!!p&&!p.hidden,count:p?.querySelectorAll("button[data-math-id]").length,icon:!!Array.from(document.querySelectorAll(".slide-studio-toolbar button")).find(x=>x.textContent==="Equações")?.querySelector("svg use")}})()');
 assert.ok(state.visible&&state.count>=7&&state.icon,JSON.stringify(state));
 const before=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync(path.join(output,'math-equations-gallery-qt.png'),Buffer.from(before.data,'base64'));
 assert.ok(await click('.slide-math-gallery button[data-math-id="line"]'));
 for(let count=0;count<70;count++){
  await new Promise(ok=>setTimeout(ok,150));
  const ready=await evalJS('(()=>{const el=Array.from(document.querySelectorAll(".fixed-scroll .fixed-surface .slide-object-image img")).find(x=>x.alt.includes("Equação:"));const r=el?.closest(".slide-object-image")?.getBoundingClientRect();return !!r&&r.width>60&&r.height>25&&el.complete&&el.naturalWidth>100})()');
  if(ready)break;
  if(count===69){
   const diag=await evalJS('(()=>({status:document.querySelector("[data-status]")?.textContent,templateDisabled:document.querySelector(".slide-math-gallery button[data-math-id=line]")?.disabled,panelHidden:document.querySelector(".slide-math-gallery")?.hidden,imageNames:Array.from(document.querySelectorAll(".slide-object-image img")).map(x=>x.alt),errorText:document.body.innerText.slice(-350)}))()');
   throw Error('Equation did not insert into slide: '+JSON.stringify(diag));
  }
 }
 const metrics=await evalJS('(()=>{const img=Array.from(document.querySelectorAll(".fixed-scroll .fixed-surface .slide-object-image img")).find(x=>x.alt.includes("Equação:"));const r=img?.closest(".slide-object-image")?.getBoundingClientRect();return {name:img?.alt,decoded:img?.naturalWidth,box:r?{width:r.width,height:r.height}:null,count:document.querySelectorAll(".fixed-scroll .slide-object-image").length,slides:document.querySelectorAll("[data-thumbnail-index]").length}})()');
 assert.ok(metrics.box?.width>60&&metrics.slides===36,JSON.stringify(metrics));
 const after=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync(path.join(output,'math-line-integral-slide-qt.png'),Buffer.from(after.data,'base64'));
 fs.writeFileSync(path.join(output,'math-gallery-qt.json'),JSON.stringify({state,metrics},null,2));
 console.log('QT_PPTX_MATH_GALLERY_LINE_INTEGRAL_SCREENSHOTS_OK',JSON.stringify(metrics));
 ws.close();
})().catch(err=>{console.error(err);process.exit(1)});
