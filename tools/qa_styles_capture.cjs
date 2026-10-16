/* Measure/capture the actual Qt87 renderer, including native editing surfaces. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const port=process.argv[2] || '9234',destination=path.resolve(__dirname,'../docs/images/open-doc');
(async()=>{
 const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
 const ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
 await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});let sequence=0;const pending=new Map();
 ws.onmessage=e=>{const d=JSON.parse(e.data);if(!pending.has(d.id))return;const [r,j]=pending.get(d.id);pending.delete(d.id);d.error?j(Error(JSON.stringify(d.error))):r(d.result);};
 const send=(method,params={})=>new Promise((r,j)=>{pending.set(++sequence,[r,j]);ws.send(JSON.stringify({id:sequence,method,params}));});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const pause=()=>new Promise(r=>setTimeout(r,200));
 const click=async selector=>{const p=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest',inline:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p});await pause();};
 const shot=async name=>{const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(destination,name+'.png'),Buffer.from(r.data,'base64'));};
 const inside=async selector=>assert.ok(await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e || e.hidden)return false;const r=e.getBoundingClientRect();return r.left>=0 && r.top>=0 && r.right<=innerWidth+1 && r.bottom<=innerHeight+1;})()`),selector+' outside viewport');
 async function noOverflow(){const value=await evaluate(`JSON.stringify({body:document.body.scrollWidth,root:document.documentElement.scrollWidth,width:innerWidth,bodyHeight:document.body.scrollHeight,height:innerHeight})`);const r=JSON.parse(value);assert.ok(r.body<=r.width && r.root<=r.width && r.bodyHeight<=r.height,value);}
 fs.mkdirSync(destination,{recursive:true});
 for(const [width,height] of [[720,600],[900,650],[1280,720],[1366,768],[1600,900],[1920,1080]]){
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await pause();
  await evaluate("window.OpenDocApp.theme().set('light');window.OpenDocApp.action('home')");await pause();await noOverflow();
  assert.ok(await evaluate("Array.from(document.querySelectorAll('.library-file-title')).some(e=>e.scrollWidth>e.clientWidth)"));
  await shot('styles-home-'+width);
  await click('.library-file-actions summary');await inside('.library-file-actions[open] .document-action-menu');await shot('styles-home-menu-'+width);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.document-action-menu')).position"),'fixed');
  await evaluate("document.querySelector('.library-file-actions[open]').open=false");
  await click('[data-documents] .library-file-title');await pause();
  // Return to the long document via the actual recent-document list.
  await evaluate("window.OpenDocApp.action('home')");await pause();
  await evaluate("Array.from(document.querySelectorAll('[data-documents] .library-file-title')).find(e=>e.textContent==='Documento de validação visual').click()");await pause();
  await noOverflow();await inside('[data-title]');await inside('[data-position]');await inside('[data-zoom-value]');
  assert.ok(await evaluate("document.querySelector('.toolbar').getBoundingClientRect().height<70"));
  assert.ok(await evaluate("document.querySelectorAll('[data-page-index]').length>1"));
  const logical=await evaluate("parseFloat(document.querySelector('[data-page-index]').style.width)");assert.ok(Math.abs(logical-595.28)<.1);
  await shot('styles-editor-'+width);
  await click('[data-menu=file]');await inside('[data-menu-panel=file]');await shot('styles-file-menu-'+width);
  await click('[data-menu-panel=file] [data-action=page-setup]');await inside('.dialog');await shot('styles-dialog-'+width);await click('[data-dialog-cancel]');
  await evaluate("window.OpenDocApp.theme().set('dark')");await pause();await shot('styles-dark-editor-'+width);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.document-page')).backgroundColor"),'rgb(255, 255, 255)');
  await click('[data-menu=tools]');await inside('[data-menu-panel=tools]');await shot('styles-dark-menu-'+width);await click('[data-menu=tools]');
  await evaluate("window.OpenDocApp.action('home')");await pause();await click('.library-file-actions summary');await inside('.library-file-actions[open] .document-action-menu');await shot('styles-dark-home-menu-'+width);
  console.log('QT_STYLES_MATRIX_OK',width,height);
 }
 // Verify document actions still execute through existing handlers and API.
 await evaluate("document.querySelector('.library-file-actions[open]').open=false");await click('[data-documents] .library-row:nth-child(2) .library-file-actions summary');await click('.library-file-actions[open] button');
 await inside('.dialog');await evaluate("document.querySelector('[data-dialog-input]').value='Documento renomeado no QA'");await click('[data-dialog-confirm]');
 assert.ok(await evaluate("Array.from(document.querySelectorAll('.library-file-title')).some(e=>e.textContent==='Documento renomeado no QA')"));
 await click('.library-file-actions summary');await click('.library-file-actions[open] button:nth-of-type(2)');
 assert.ok(await evaluate("Array.from(document.querySelectorAll('.library-file-title')).some(e=>e.textContent.includes('(cópia)'))"));
 await click('.library-file-actions summary');await click('.library-file-actions[open] .danger-action');await inside('.dialog');await click('[data-dialog-confirm]');
 // Exercise the page/table popovers without changing document business logic.
 await evaluate("Array.from(document.querySelectorAll('[data-documents] .library-file-title')).find(e=>e.textContent==='Documento de validação visual').click()");await pause();
 await send('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false});
 await evaluate("window.OpenDocApp.layout().set(60);document.querySelector('[data-canvas]').scrollTop=420");await pause();await shot('styles-editor-pages');await evaluate("window.OpenDocApp.layout().set(100);document.querySelector('[data-canvas]').scrollTop=0");await pause();
 await evaluate("document.querySelector('[data-page-index]').dispatchEvent(new MouseEvent('click',{button:0,bubbles:true,clientX:innerWidth-10,clientY:innerHeight-20}))");await inside('[data-page-menu]');await shot('styles-page-menu');
 await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));const p=document.querySelector('[data-rich] p');const r=document.createRange();r.selectNodeContents(p);r.collapse(true);getSelection().removeAllRanges();getSelection().addRange(r);window.OpenDocApp.editor().capture();window.OpenDocApp.editor().tableOperation('insert',2,2)");await pause();
 await evaluate("document.querySelector('[data-rich] td').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:innerWidth-8,clientY:innerHeight-8}))");await inside('[data-table-menu]');await shot('styles-table-menu');
 await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));window.OpenDocApp.editor().flush()");await pause();
 for(const width of [480,640]){await send('Emulation.setDeviceMetricsOverride',{width,height:600,deviceScaleFactor:1,mobile:false});await pause();await noOverflow();await inside('[data-title]');await inside('[data-zoom-value]');}
 console.log('QT_STYLES_ACTIONS_AND_POPOVERS_OK');ws.close();
})().catch(e=>{console.error(e.stack);process.exit(1);});
