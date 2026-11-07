/* Real QtWebEngine import regression: 36-slide user-like dark PPTX. */
"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const port=process.argv[2]||"9234";
(async()=>{
 const pages=await(await fetch("http://127.0.0.1:"+port+"/json/list")).json();
 const ws=new WebSocket(pages.find(p=>p.type==="page").webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
 const pending=new Map();let n=0;
 ws.onmessage=e=>{
  const msg=JSON.parse(e.data),entry=pending.get(msg.id);if(!entry)return;
  pending.delete(msg.id);msg.error?entry[1](Error(JSON.stringify(msg.error))):entry[0](msg.result);
 };
 const send=(method,params={})=>new Promise((resolve,reject)=>{
  let id=++n;pending.set(id,[resolve,reject]);ws.send(JSON.stringify({id,method,params}));
 });
 const evalJS=async expression=>{
  let res=await send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});
  if(res.exceptionDetails)throw Error(JSON.stringify(res.exceptionDetails));
  return res.result.value;
 };
 const dest=path.resolve(__dirname,"../docs/images/ink");fs.mkdirSync(dest,{recursive:true});
 for(const [w,h] of [[1366,768],[1920,1080]]){
  await send("Emulation.setDeviceMetricsOverride",{width:w,height:h,deviceScaleFactor:1,mobile:false});
  await new Promise(resolve=>setTimeout(resolve,500));
  const evidence=await evalJS(`(()=>{
   const root=document.querySelector('.fixed-document');
   const stage=document.querySelector('.fixed-scroll .fixed-surface');
   const title=Array.from(stage?.querySelectorAll('.slide-object-text')||[])
    .find(n=>n.textContent.includes('QUEM PRODUZ'));
   const box=title?.getBoundingClientRect();
   const page=stage?.getBoundingClientRect();
   const style=title?getComputedStyle(title):null;
   return {editable:root?.dataset.slideEditor,
     title:title?.textContent, fontPx:parseFloat(style?.fontSize||'0'),
     textColor:style?.color,
     titleBox:box?{x:box.x,y:box.y,w:box.width,h:box.height}:null,
     page:page?{x:page.x,y:page.y,w:page.width,h:page.height}:null,
     thumbCount:document.querySelectorAll('.fixed-sidebar [data-thumbnail-index]').length,
     editorButtons:document.querySelectorAll('.slide-studio-toolbar button').length};
  })()`);
  assert.equal(evidence.editable,"true","Imported fixture must open editable studio");
  assert.equal(evidence.thumbCount,36,"All slides must have thumbnails");
  assert.ok(evidence.title&&evidence.title.includes("QUEM PRODUZ"),"Title missing");
  assert.ok(evidence.fontPx>=40,"Inherited 51pt title rendered too small: "+JSON.stringify(evidence));
  assert.ok(evidence.titleBox?.w>200&&evidence.page?.w>400,"Title or canvas collapsed");
  assert.ok(evidence.editorButtons>10,"Imported file opened read-only instead");
  const png=await send("Page.captureScreenshot",{format:"png"});
  const prefix="pptx-user-like-36-editable-"+w;
  fs.writeFileSync(path.join(dest,prefix+".png"),Buffer.from(png.data,"base64"));
  fs.writeFileSync(path.join(dest,prefix+".json"),JSON.stringify(evidence,null,2));
  console.log("QA_IMPORT_36_PPTX_EDITABLE",prefix,evidence.fontPx);
 }
 ws.close();
})().catch(e=>{console.error(e);process.exit(1)});
