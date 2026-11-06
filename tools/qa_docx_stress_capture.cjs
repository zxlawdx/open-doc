/* Real QtWebEngine keyboard/reflow stress: 100 / 500 / 1,000 operations.
 * No DOM-only claims. Bounded CDP request watchdog prevents silent white hangs.
 */
"use strict";
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const readline=require('node:readline/promises');
const port=process.argv[2]||'9234';
const dest=path.resolve(__dirname,'../docs/images/stabilization');
(async()=>{
 const tabs=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
 const ws=new WebSocket(tabs.find(tab=>tab.type==='page').webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
 let seq=0;const pending=new Map();
 ws.onmessage=event=>{
   const data=JSON.parse(event.data);
   if(data.method==='Runtime.consoleAPICalled'){
     const words=(data.params.args||[]).map(x=>x.value===undefined?x.description:x.value);
     if(words.some(x=>String(x).includes('OPEN_DOC_DELETE_TRACE')))
       console.log('QT_DOCX_DELETE_DIAGNOSTIC',words.join(' '));
     return;
   }
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
 const replies=readline.createInterface({input:process.stdin});
 const acknowledgements=replies[Symbol.asyncIterator]();
 const waitForPages=async condition=>{
   const deadline=Date.now()+10000;
   let layout;
   do{
     layout=await evaluate('OpenDocApp.editor().pagination().diagnostics()');
     assert.equal(layout.lastError,null,JSON.stringify(layout));
     if(condition(layout.pages))return;
     await pause(100);
   }while(Date.now()<deadline);
   assert.fail('Pagination did not settle after the keyboard batch: '+JSON.stringify(layout));
 };
 const key=async(name,count=1)=>{
   const observed=name==='Return'?'Enter':name;
   const before=await evaluate(`window.__docxStressKeys[${JSON.stringify(observed)}]||0`);
   console.log('QT_KEY_REQUEST',name,count);
   const reply=await acknowledgements.next();
   assert.equal(reply.value,'OK','QTest did not acknowledge '+name);
   if(name==='SelectAll')return;
   const deadline=Date.now()+10000;
   let received=0;
   do{
     received=await evaluate(`window.__docxStressKeys[${JSON.stringify(observed)}]||0`);
     if(received>=before+count)break;
     await pause(15);
   }while(Date.now()<deadline);
   assert.equal(received-before,count,'QtWebEngine did not dispatch every '+name);

 };
 const capture=async name=>{
   const data=await send('Page.captureScreenshot',{format:'png'},10000);
   fs.mkdirSync(dest,{recursive:true});
   fs.writeFileSync(path.join(dest,name+'.png'),Buffer.from(data.data,'base64'));
 };
 await evaluate(`(()=>{
   window.__docxStressErrors=[];
   window.__docxStressKeys={};
   document.querySelector('[data-rich]').addEventListener('keydown',event=>{
     if(event.isTrusted)window.__docxStressKeys[event.key]=
       (window.__docxStressKeys[event.key]||0)+1;
   },true);
   window.addEventListener('error',event=>__docxStressErrors.push(event.message));
   window.addEventListener('unhandledrejection',event=>
     __docxStressErrors.push(String(event.reason)));
   return true;
 })()`);
 await send('Runtime.enable');
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
     await key('Return',count);
     await pause(8);
   }
   console.log('QT_DOCX_STRESS_ENTERS_DISPATCHED',total);
   await waitForPages(pages=>pages>1);
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
   assert.equal(writing.blocks,total+1,'Every Enter must add one paragraph');
   assert.deepEqual(writing.errors,[],'Unexpected errors during DOCX insertion');
   await capture('docx-stress-'+total+'-enters');
   console.log('QT_DOCX_STRESS_ENTER_METRICS',JSON.stringify(writing));
   const caret=await evaluate(`(()=>{
     const rich=document.querySelector('[data-rich]');
     const s=getSelection(),node=s?.anchorNode;
     const el=node?.nodeType===3?node.parentElement:node;
     const block=el?.closest?.('[data-node-id],p,li');
     const position=el?.closest?.('[data-page-index]')?.dataset.pageIndex;
     const range=s?.rangeCount?s.getRangeAt(0):null;
     const mark=window.OpenDocApp?.editor?.()?.debug?.selection?.()||null;
     return {tag:el?.tagName||'#text',blockId:block?.dataset.nodeId||null,
       pageIndex:position??null,offset:s?.anchorOffset??null,
       collapsed:s?.isCollapsed,focus:document.activeElement?.getAttribute('data-rich')!==null,
       rootAnchor:node===rich,rangeContainer:range?.startContainer?.nodeName,mark};
   })()`);
   console.log('QT_DOCX_STRESS_CARET_BEFORE_BACKSPACE',total,JSON.stringify(caret));
   const probe=await evaluate(`(()=>{
     const app=OpenDocApp.editor(),selection=getSelection(),model=app.snapshot().content;
     const tx=window.OpenDocLogicalTransactions;
     if(!tx)return {module:false};
     const match=tx.inspectBackspace(document.querySelector('[data-rich]'),selection,model);
     const anchor=selection.anchorNode,el=anchor?.nodeType===3?anchor.parentElement:anchor;
     const id=el?.closest('[data-node-id]')?.dataset.nodeId;
     return {module:true,match,modelIndex:model.blocks.findIndex(b=>b.id===id),
       modelBlocks:model.blocks.length};
   })()`);
   console.log('QT_DOCX_STRESS_LOGICAL_PROBE',total,JSON.stringify(probe));
   // Real native keyboard Backspace (not a synthetic event with no default action).
   for(let i=0;i<total;i+=25){
     console.log('QT_DOCX_STRESS_BACKSPACE_PROGRESS',total,i);
     await key('Backspace',Math.min(25,total-i));
     await pause(40);
   }
   await waitForPages(pages=>pages===1);
   const deleting=await evaluate(`(()=>{
     const pages=document.querySelectorAll('.document-page');
     const note=OpenDocApp.editor().snapshot();
     return {pages:pages.length,blocks:note.content?.blocks?.length,
       errors:window.__docxStressErrors.slice(),
       focused:document.activeElement===document.querySelector('[data-rich]')};
   })()`);
   assert.ok(deleting.pages>0&&deleting.blocks>0,'DOCX crashed on repeated Backspace');
   assert.equal(deleting.blocks,1,'Every Backspace must remove one paragraph');
   assert.equal(deleting.pages,1,'Empty pages must be removed');
   assert.ok(deleting.focused,'Deletion lost editor focus');
   assert.deepEqual(deleting.errors,[],'Unexpected JS errors in DOCX deletion');
   // Exercise a real multipage selection after proving every join above.
   await key('Return',40);
   await waitForPages(pages=>pages>1);
   await key('SelectAll');
   await key('Backspace');
   await waitForPages(pages=>pages===1);
   const emptied=await evaluate(`(()=>{
     const rich=document.querySelector('[data-rich]');
     const note=OpenDocApp.editor().snapshot();
     return {pages:document.querySelectorAll('.document-page').length,
       blocks:note.content?.blocks?.length,errors:window.__docxStressErrors.slice(),
       stillEditable:rich.isContentEditable};
   })()`);
   assert.ok(emptied.stillEditable&&emptied.pages>0&&emptied.blocks>0,
     'Large deletion lost the editable page surface');
   assert.equal(emptied.pages,1);
   assert.equal(emptied.blocks,1);
   assert.deepEqual(emptied.errors,[],'Exception after Ctrl+A and Backspace');
   await evaluate('OpenDocApp.editor().flush()');
   await capture('docx-stress-'+total+'-after-delete');
   const metrics=await send('Performance.getMetrics');
   const memory=metrics.metrics.find(x=>x.name==='JSHeapUsedSize')?.value??null;
   console.log('QT_DOCX_STRESS_OK',JSON.stringify({total,elapsedMs:Date.now()-started,
     enter:writing,afterBackspace:deleting,afterBulkDelete:emptied,jsHeapBytes:memory}));
 }
 replies.close();
 ws.close();
})().catch(error=>{console.error(error);process.exit(1);});
