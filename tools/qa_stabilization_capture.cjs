/* ============ REAL QTWEBENGINE CAPTURES / LAYOUT ASSERTIONS ============ */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const port = process.argv[2] || '9234';
const destination = path.resolve(__dirname, '../docs/images/stabilization');
(async () => {
  const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  const ws = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  ws.onmessage = event => {
    const data = JSON.parse(event.data);
    if (!pending.has(data.id)) return;
    const [resolve, reject] = pending.get(data.id); pending.delete(data.id);
    data.error ? reject(Error(JSON.stringify(data.error))) : resolve(data.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, [resolve, reject]); ws.send(JSON.stringify({id, method, params}));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const pause = () => new Promise(resolve => setTimeout(resolve, 260));
  const shot = async name => {
    await pause(); const image = await send('Page.captureScreenshot', {format: 'png'});
    fs.writeFileSync(path.join(destination, name + '.png'), Buffer.from(image.data, 'base64'));
  };
  const click = async selector => {
    const point = await evaluate(`(() => {const b=document.querySelector(${JSON.stringify(selector)});b.scrollIntoView({block:'nearest'});const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await send('Input.dispatchMouseEvent', {type:'mousePressed', button:'left', clickCount:1, ...point});
    await send('Input.dispatchMouseEvent', {type:'mouseReleased', button:'left', clickCount:1, ...point});
    await pause();
  };


  fs.mkdirSync(destination,{recursive:true});
  await evaluate(`(() => {window.structuredClone=undefined;window.__fullRenders=0;window.__layouts=0;const render=OpenDocRichRenderer.render;OpenDocRichRenderer.render=(...args)=>{if(args[1].matches('[data-rich]'))__fullRenders++;return render(...args);};document.querySelector('[data-app]').addEventListener('open-doc:layout',()=>__layouts++);window.__firstPage=document.querySelector('.document-page');})()`);
  await pause();await evaluate('__fullRenders=0;__layouts=0');
  await click('[data-ink-mode=pen]');
  for(let i=0;i<20;i++)await evaluate(`(() => {const svg=document.querySelector('.document-page .ink-overlay'),r=svg.getBoundingClientRect();svg.setPointerCapture=()=>{};for(const [type,x] of [['pointerdown',.15],['pointermove',.2],['pointerup',.25]])svg.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:77,pointerType:'pen',button:0,buttons:1,pressure:.5,clientX:r.left+r.width*x,clientY:r.top+r.height*(.1+${i}*.02)}));})()`);
  await pause();
  const inkDiagnostics=await evaluate(`(()=>{
    const root=document.querySelector('[data-app]'),page=document.querySelector('.document-page'),
          svg=page?.querySelector('.ink-overlay'),rect=svg?.getBoundingClientRect();
    return {mode:root.dataset.inkMode,home:root.dataset.homeView,kind:root.dataset.documentKind,
      titleDisabled:document.querySelector('[data-title]')?.disabled,
      pageSize:[page?.offsetWidth,page?.offsetHeight],
      inkSize:[rect?.width,rect?.height],
      pointerEvents:svg?getComputedStyle(svg).pointerEvents:null,
      layers:OpenDocApp.editor().inkLayers().map(l=>({index:l.surface_index,strokes:l.strokes.length}))};
  })()`);
  console.log('QT_DOCX_INK_DIAGNOSTIC',JSON.stringify(inkDiagnostics));
  assert.equal(inkDiagnostics.layers[0]?.strokes,20,'DOCX ink geometry: '+JSON.stringify(inkDiagnostics));assert.equal(await evaluate('__fullRenders'),0);assert.equal(await evaluate('__layouts'),0);assert.equal(await evaluate("document.querySelector('.document-page')===__firstPage"),true);
  await evaluate("OpenDocApp.editor().format('undo')");await pause();assert.equal(await evaluate('OpenDocApp.editor().inkLayers()[0].strokes.length'),19);assert.equal(await evaluate('__fullRenders'),0);assert.equal(await evaluate('__layouts'),0);
  await evaluate("OpenDocApp.editor().format('redo')");await evaluate('OpenDocApp.editor().flush()');
  await evaluate(`(async()=>{const s=OpenDocApp.editor().snapshot();const result=await fetch('/api/open_doc/document/open',{method:'POST',headers:{'Content-Type':'application/json','X-Open-Doc-Token':(await pywebview.api.get_bootstrap()).token},body:JSON.stringify({id:s.id})});OpenDocApp.editor().load(await result.json());})()`);
  await pause();assert.equal(await evaluate('OpenDocApp.editor().inkLayers()[0].strokes.length'),20);
  console.log('QT_DOCX_20_STROKES_WITHOUT_STRUCTUREDCLONE_NO_FULL_RENDER_SAVE_REOPEN_OK');
  await click('[data-ink-mode=cursor]');
  await send('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false});
  const gap=await evaluate(`(()=>{
    const rich=document.querySelector('[data-rich]'),canvas=document.querySelector('[data-canvas]');
    const [first,second]=rich.querySelectorAll('.document-page');
    const paragraphs=[first,second].map(page=>page.querySelector('[data-page-content] p'));
    const walker=document.createTreeWalker(paragraphs[0],NodeFilter.SHOW_TEXT);
    const left=walker.nextNode();
    const right=document.createTreeWalker(paragraphs[1],NodeFilter.SHOW_TEXT).nextNode();
    rich.focus();
    getSelection().setBaseAndExtent(left,left.length-5,right,5);
    canvas.scrollTop+=first.getBoundingClientRect().bottom-canvas.getBoundingClientRect().top-canvas.clientHeight/2;
    return {outline:getComputedStyle(rich).outlineStyle,selected:getSelection().toString().length,focused:document.activeElement===rich};
  })()`);
  await shot('docx-page-gap-selection');
  assert.ok(gap.focused&&gap.selected>=10,'Cross-page selection must stay focused: '+JSON.stringify(gap));
  assert.equal(gap.outline,'none','The editor focus outline must not paint the space between pages');
  console.log('QT_DOCX_NO_FOCUS_OUTLINE_IN_PAGE_GAP_OK',JSON.stringify(gap));

  await evaluate(`(() => {const page=document.querySelector('[data-page-index="7"]'),p=page.querySelector('p[data-node-id]');p.scrollIntoView();const range=document.createRange();range.selectNodeContents(p);range.collapse(false);p.focus();const rich=document.querySelector('[data-rich]');rich.focus();getSelection().removeAllRanges();getSelection().addRange(range);OpenDocApp.editor().capture();window.__prefix=Array.from(document.querySelectorAll('.document-page')).slice(0,7);window.__beforeText=p.textContent;window.__editedId=p.dataset.nodeId;__fullRenders=0;})()`);
  await send('Input.insertText',{text:'x'});await pause();await pause();
  const top=await evaluate("document.querySelector('[data-canvas]').scrollTop");
  await evaluate("OpenDocApp.editor().format('undo')");await pause();await pause();
  assert.equal(await evaluate('__fullRenders'),0);assert.equal(await evaluate("__prefix.every((n,i)=>n===document.querySelector('[data-page-index=\"'+i+'\"]'))"),true);
  assert.ok(Math.abs(await evaluate("document.querySelector('[data-canvas]').scrollTop")-top)<3);
  assert.equal(await evaluate("document.querySelector('[data-node-id=\"'+__editedId+'\"]').textContent"),await evaluate('__beforeText'));
  await evaluate("OpenDocApp.editor().format('redo')");await pause();assert.equal(await evaluate('__fullRenders'),0);
  await evaluate('OpenDocApp.editor().flush()');
  for(const [w,h] of [[1366,768],[1600,900],[1920,1080]]){await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:false});await shot('docx-undo-'+w);}
  console.log('QT_PAGE8_TYPING_UNDO_REDO_PREFIX_SCROLL_PRESERVED_OK');
  ws.close();
})().catch(error=>{console.error(error);process.exit(1);});
