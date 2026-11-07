/* Real QtWebEngine CDP captures: formula diagrams in PPTX, DOCX, PDF. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const port=process.argv[2]||'9234',kind=process.argv[3];
if(!['pptx','docx','pdf'].includes(kind))throw Error('Specify format');
const out=path.resolve(__dirname,'../docs/images/math');
(async()=>{
 const tabs=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
 const target=tabs.find(t=>t.type==='page');
 assert.ok(target?.webSocketDebuggerUrl,'No QtWebEngine CDP page');
 const ws=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((ok,err)=>{ws.onopen=ok;ws.onerror=err;});
 let seq=0;const pending=new Map();
 ws.onmessage=event=>{
  const r=JSON.parse(event.data),p=pending.get(r.id);
  if(!p)return;pending.delete(r.id);r.error?p[1](Error(JSON.stringify(r.error))):p[0](r.result);
 };
 const send=(method,params={})=>new Promise((ok,err)=>{
  const id=++seq;pending.set(id,[ok,err]);ws.send(JSON.stringify({id,method,params}));
 });
 const read=async script=>{
  const r=await send('Runtime.evaluate',{expression:script,returnByValue:true,awaitPromise:true});
  if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
 };
 await send('Emulation.setDeviceMetricsOverride',
   {width:1440,height:900,deviceScaleFactor:1,mobile:false});
 await new Promise(r=>setTimeout(r,700));
 const script=[
  '(()=>{',
  'const rich=document.querySelector("[data-rich]");',
  'const slide=document.querySelector("[data-slide-editor=true] .fixed-surface");',
  'const rendered=Array.from(document.querySelectorAll(".fixed-document .fixed-scroll .fixed-surface canvas[data-render-complete=true]"))',
   '.find(c=>{const r=c.getBoundingClientRect();return r.width>80&&r.height>30});',
  'const media='+JSON.stringify(kind)+'==="pptx" ? slide?.querySelector(".slide-object-image img") : ',
  JSON.stringify(kind)+'==="docx" ? document.querySelector("[data-rich] img") : rendered;',
  'const rect=media?.getBoundingClientRect();',
  'return {title:document.querySelector("[data-title]")?.value||"",',
   'mode:document.querySelector("[data-slide-editor]")?.dataset.slideEditor,',
   'slideCount:document.querySelectorAll("[data-thumbnail-index]").length,',
   'richText:!!rich,mediaVisible:!!media,',
   'imageRect:rect?{width:rect.width,height:rect.height,x:rect.x,y:rect.y}:null,',
   'status:document.querySelector("[data-status]")?.textContent||""};',
  '})()'
 ].join('');
 const metrics=await read(script);
 if(kind==='pdf')assert.equal(metrics.mode,'false','PDF cannot be in native slide editing mode');
 assert.ok(metrics.mediaVisible,'No fraction or page visible: '+JSON.stringify(metrics));
 assert.ok(metrics.imageRect?.width>80&&metrics.imageRect?.height>30,
   'Formula too small/collapsed: '+JSON.stringify(metrics));
 if(kind==='pptx')assert.ok(metrics.slideCount>=5,'Missing slide thumbnails');
 fs.mkdirSync(out,{recursive:true});
 const png=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync(path.join(out,'math-fractions-'+kind+'-qt.png'),Buffer.from(png.data,'base64'));
 fs.writeFileSync(path.join(out,'math-fractions-'+kind+'-qt.json'),JSON.stringify(metrics,null,2));
 console.log('QT_MATH_CAPTURE',kind,JSON.stringify(metrics));
 ws.close();
})().catch(error=>{console.error(error);process.exit(1)});
