/* Real QtWebEngine keyboard/reflow stress: 100 / 500 / 1,000 operations.
 * No DOM-only claims. Bounded CDP request watchdog prevents silent white hangs.
 */
"use strict";
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const port=process.argv[2]||'9234';
const dest=path.resolve(__dirname,'../docs/images/stabilization');
(async()=>{
 const tabs=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
 const ws=new WebSocket(tabs.find(tab=>tab.type==='page').webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
 let seq=0;const pending=new Map();
 ws.onmessage=event=>{
   const data=JSON.parse(event.data);
   if(!pending.has(data.id))return;
   const {resolve,reject,alarm}=pending.get(data.id);
   clearTimeout(alarm);pending.delete(data.id);
   data.error?reject(Error(JSON.stringify(data.error))):resolve(data.result);
 };
 const send=(method,params={},ms=15000)=>new Promise((resolve,reject)=>{
   const id=++seq;
   const alarm=setTimeout(()=>{
     pending.delete(id);reject(Error('Qt renderer did not respond to '+method+' within '+ms+'ms'));
   },ms);
   pending.set(id,{resolve,reject,alarm});
   ws.send(JSON.stringify({id,method,params}));
 });
 const evaluate=async expression=>{
   const reply=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},45000);
   if(reply.exceptionDetails)throw Error(JSON.stringify(reply.exceptionDetails));
   return reply.result.value;
 };
 const pause=ms=>new Promise(done=>setTimeout(done,ms));
 const key=async(key,code,virtual,modifiers=0)=>{
   for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',
     {type,key,code,windowsVirtualKeyCode:virtual,modifiers},10000);
 };
 const capture=async name=>{
   const data=await send('Page.captureScreenshot',{format:'png'},10000);
   fs.mkdirSync(dest,{recursive:true});
   fs.writeFileSync(path.join(dest,name+'.png'),Buffer.from(data.data,'base64'));
 };
 await evaluate(`(()=>{
   window.__docxStressErrors=[];
   window.addEventListener('error',event=>__docxStressErrors.push(event.message));
   window.addEventListener('unhandledrejection',event=>
     __docxStressErrors.push(String(event.reason)));
   return true;
 })()`);
 await send('Performance.enable');
 for(const total of [100,500,1000]){
   console.log('QT_DOCX_STRESS_BEGIN',total);
   const initial=await evaluate(`(()=>{
     const rich=document.querySelector('[data-rich]');
     if(!rich||!rich.isContentEditable)throw Error('DOCX contenteditable missing');
     rich.focus();const selection=getSelection(),range=document.createRange();
     range.selectNodeContents(rich);range.collapse(false);
     selection.removeAllRanges();selection.addRange(range);
     return {kind:document.querySelector('[data-app]').dataset.documentKind,
       editable:rich.isContentEditable};
   })()`);
   assert.equal(initial.editable,true);
   const started=Date.now();
   for(let left=total;left>0;left-=20){
     const count=Math.min(left,20);
     const result=await evaluate(`(()=>{
       let successes=0;
       for(let i=0;i<${count};i++)
         if(document.execCommand('insertParagraph'))successes++;
       return successes;
     })()`);
     assert.equal(result,count,'Native Chromium rejected Enter editing command');
     await pause(8);
   }
   console.log('QT_DOCX_STRESS_ENTERS_DISPATCHED',total);
   await pause(650);
   const writing=await evaluate(`(()=>{
     const pages=document.querySelectorAll('.document-page');
     const note=OpenDocApp.editor().snapshot();
     return {pages:pages.length,blocks:note.content?.blocks?.length,
       plainChars:document.querySelector('[data-rich]').textContent.length,
       errors:window.__docxStressErrors.slice(),
       white:!document.querySelector('.document-page'),
       storage:document.querySelector('[data-app]').dataset.dirty};
   })()`);
   assert.ok(writing.pages>0&&!writing.white,'The DOCX editor turned white after Enter');
   assert.ok(writing.blocks>0,'The model lost all blocks');
   assert.deepEqual(writing.errors,[],'Unexpected errors during DOCX insertion');
   await capture('docx-stress-'+total+'-enters');
   console.log('QT_DOCX_STRESS_ENTER_METRICS',JSON.stringify(writing));
   // Real native keyboard Backspace (not a synthetic event with no default action).
   for(let i=0;i<total;i++){
     if(i%25===0)console.log('QT_DOCX_STRESS_BACKSPACE_PROGRESS',total,i);
     await key('Backspace','Backspace',8);
     if(i%50===49)await pause(6);
   }
   await pause(650);
   const deleting=await evaluate(`(()=>{
     const pages=document.querySelectorAll('.document-page');
     const note=OpenDocApp.editor().snapshot();
     return {pages:pages.length,blocks:note.content?.blocks?.length,
       errors:window.__docxStressErrors.slice(),
       focused:document.activeElement===document.querySelector('[data-rich]')};
   })()`);
   assert.ok(deleting.pages>0&&deleting.blocks>0,'DOCX crashed on repeated Backspace');
   assert.deepEqual(deleting.errors,[],'Unexpected JS errors in DOCX deletion');
   // Ctrl+A + Backspace tests cross-page large deletion and recovery from it.
   await key('a','KeyA',65,2);
   await key('Backspace','Backspace',8);
   await pause(650);
   const emptied=await evaluate(`(()=>{
     const rich=document.querySelector('[data-rich]');
     const note=OpenDocApp.editor().snapshot();
     return {pages:document.querySelectorAll('.document-page').length,
       blocks:note.content?.blocks?.length,errors:window.__docxStressErrors.slice(),
       stillEditable:rich.isContentEditable};
   })()`);
   assert.ok(emptied.stillEditable&&emptied.pages>0&&emptied.blocks>0,
     'Large deletion lost the editable page surface');
   assert.deepEqual(emptied.errors,[],'Exception after Ctrl+A and Backspace');
   await evaluate('OpenDocApp.editor().flush()');
   await capture('docx-stress-'+total+'-after-delete');
   const metrics=await send('Performance.getMetrics');
   const memory=metrics.metrics.find(x=>x.name==='JSHeapUsedSize')?.value??null;
   console.log('QT_DOCX_STRESS_OK',JSON.stringify({total,elapsedMs:Date.now()-started,
     enter:writing,afterBackspace:deleting,afterBulkDelete:emptied,jsHeapBytes:memory}));
 }
 ws.close();
})().catch(error=>{console.error(error);process.exit(1);});
