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
  assert.ok((await evaluate("document.querySelectorAll('.pptx-content')[0].textContent")).includes('Teste Open Doc'));
  assert.ok(await evaluate("document.querySelector('.pptx-content image,.pptx-content img')!==null"));
  assert.ok((await evaluate("document.querySelectorAll('.pptx-content')[1].textContent")).includes('Célula 2/2'));
  await click('[data-ink-mode=pen]');
  await evaluate(`(() => {const svg=document.querySelector('.fixed-surface .ink-overlay'),r=svg.getBoundingClientRect();svg.setPointerCapture=()=>{};for(const [type,x] of [['pointerdown',.1],['pointermove',.3],['pointerup',.5]])svg.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:8,pointerType:'pen',button:0,buttons:1,pressure:.6,clientX:r.left+r.width*x,clientY:r.top+r.height*.4}));})()`);
  assert.equal(await evaluate('OpenDocApp.editor().snapshot().content.surfaces[0].strokes.length'),1);await evaluate('OpenDocApp.editor().flush()');
  await evaluate("window.__pptxNote=OpenDocApp.editor().snapshot();window.__pdf=OpenDocPdf;OpenDocPdf={...OpenDocPdf,getDocument(){throw Error('PPTX must not use PDF.js');}};OpenDocApp.editor().load({...__pptxNote,source_kind:'pptx',capabilities:{preview:true,ink:true}})");
  for(let i=0;i<40;i++){if(await evaluate("!!document.querySelector('.pptx-content svg')"))break;await pause();}
  assert.ok(await evaluate("document.querySelector('.pptx-content svg')!==null"));assert.equal(await evaluate("document.querySelectorAll('.fixed-surface .ink-overlay path').length"),1);await evaluate('OpenDocPdf=__pdf');
  await evaluate("Array.from(document.querySelectorAll('.fixed-controls button')).find(b=>b.textContent==='Salvar PPTX').click()");await pause();await pause();
  for(const [w,h] of [[1366,768],[1600,900],[1920,1080]]){await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:false});await shot('pptx-native-'+w);assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'));}
  await evaluate("Array.from(document.querySelectorAll('.fixed-controls button')).find(b=>b.textContent==='Próxima').click()");await pause();
  console.log('QT_PPTX_NATIVE_TEXT_IMAGE_SHAPES_TABLE_INK_REOPEN_EXPORT_3_RESOLUTIONS_OK');ws.close();
})().catch(error=>{console.error(error);process.exit(1);});
