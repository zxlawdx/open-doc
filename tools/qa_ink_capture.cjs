/* ============ REAL QTWEBENGINE CAPTURES / LAYOUT ASSERTIONS ============ */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const port = process.argv[2] || '9234';
const destination = path.resolve(__dirname, '../docs/images/ink');
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
  assert.equal(await evaluate("fetch('/__vela__/static/open_doc/pdfjs/standard_fonts/LiberationSans-Regular.ttf').then(r=>r.status)"),200);
  assert.equal(await evaluate("fetch('/__vela__/static/open_doc/pdfjs/cmaps/Adobe-Japan1-UCS2.bcmap').then(r=>r.status)"),200);
  assert.equal(await evaluate("(() => {const c=document.querySelector('.fixed-surface canvas');if(c.dataset.renderComplete!=='true')return false;const p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;for(let i=0;i<p.length;i+=256)if(p[i]<80 && p[i+1]<80 && p[i+2]<80 && p[i+3]>200)return true;return false;})()"),true);
  console.log('QT_READY_LOCAL_STANDARD_FONTS_AND_NONWHITE_PIXELS');
  assert.equal(await evaluate("document.querySelectorAll('.fixed-surface').length"),300);
  assert.ok(await evaluate("document.querySelectorAll('.fixed-surface canvas').length")<=5);
  assert.equal(await evaluate("(() => {const p=document.querySelector('.fixed-surface').getBoundingClientRect(),r=document.querySelector('.fixed-surface .ink-overlay').getBoundingClientRect();return Math.abs(r.width-p.width)<2 && Math.abs(r.height-p.height)<2;})()"),true);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.textLayer span')).color"),'rgba(0, 0, 0, 0)');
  console.log('QT_PDF_300_PAGES_BOUNDED_RENDER_AND_OVERLAY_GEOMETRY_OK');
  assert.match(await evaluate(`(() => {const layer=document.querySelector('.textLayer'),range=document.createRange();range.selectNodeContents(layer);getSelection().removeAllRanges();getSelection().addRange(range);const text=getSelection().toString();getSelection().removeAllRanges();return text;})()`),/Pagina 1 texto pesquisavel/);
  await evaluate("document.querySelector('.fixed-controls input[type=search]').value='Pagina 299 texto';Array.from(document.querySelectorAll('.fixed-controls button')).find(b=>b.textContent==='Buscar').click()");
  for(let i=0;i<80;i++){if(await evaluate("!!document.querySelector('[data-search-result]')"))break;await pause();}
  assert.match(await evaluate("document.querySelector('[data-search-result]')?.textContent"),/299/);
  await evaluate("const page=document.querySelector('.fixed-controls input[type=number]');page.value=1;page.dispatchEvent(new Event('change'));document.querySelector('.fixed-controls input[type=search]').value=''");await pause();await pause();
  console.log('QT_PDF_TEXT_SELECTION_AND_SEARCH_PAGE_299_OK');
  await click('[data-ink-mode=handwriting]');
  await evaluate(`(() => {const svg=document.querySelector('.fixed-surface .ink-overlay'),r=svg.getBoundingClientRect();svg.setPointerCapture=()=>{};for(const [type,x,y,p] of [['pointerdown',.15,.2,.2],['pointermove',.22,.25,.7],['pointermove',.3,.2,.9],['pointerup',.35,.25,.5]])svg.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:77,pointerType:'pen',button:0,buttons:1,pressure:p,tiltX:12,tiltY:-8,clientX:r.left+r.width*x,clientY:r.top+r.height*y}));})()`);
  console.log('QT_STROKE');
  assert.equal(await evaluate("OpenDocApp.editor().snapshot().content.surfaces[0].strokes.length"),1);
  await evaluate("OpenDocApp.editor().format('undo')");assert.equal(await evaluate("OpenDocApp.editor().snapshot().content.surfaces[0].strokes.length"),0);
  await evaluate("OpenDocApp.editor().format('redo')");assert.equal(await evaluate("OpenDocApp.editor().snapshot().content.surfaces[0].strokes.length"),1);
  await evaluate("Array.from(document.querySelectorAll('.ink-toolbar button')).find(b=>b.textContent==='Converter escrita').click()");
  for(let i=0;i<60;i++){if(await evaluate("!!document.querySelector('.dialog textarea')"))break;await pause();}
  assert.equal(await evaluate("document.querySelector('.dialog textarea')?.value"),'Texto convertido localmente');
  await evaluate("Array.from(document.querySelectorAll('.dialog button')).find(b=>b.textContent==='Inserir texto').click()");
  assert.equal(await evaluate("OpenDocApp.editor().snapshot().content.surfaces[0].strokes.length"),0);
  assert.equal(await evaluate("OpenDocApp.editor().snapshot().content.surfaces[0].text_overlays[0].text"),'Texto convertido localmente');
  console.log('QT_RECOGNIZED');
  await evaluate("OpenDocApp.editor().flush()");
  console.log('QT_FLUSHED');
  await evaluate("document.querySelector('.fixed-scroll').scrollTop=90000");await pause();await pause();
  assert.ok(await evaluate("document.querySelectorAll('.fixed-surface canvas').length")<=9);
  await evaluate("document.querySelector('.fixed-scroll').scrollTop=0");await pause();
  for(const [w,h] of [[1366,768],[1600,900],[1920,1080]]){await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:false});await pause();await shot('pdf-ink-'+w);assert.ok(await evaluate("document.documentElement.scrollWidth<=innerWidth+1"));}
  await evaluate(`(async()=>{await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='/__vela__/static/open_doc/js/vendor/pdf.worker.bundle.js';s.onload=resolve;s.onerror=reject;document.head.appendChild(s);});const boot=await pywebview.api.get_bootstrap(),id=OpenDocApp.editor().snapshot().id;const response=await fetch('/api/open_doc/artifact/content?id='+encodeURIComponent(id),{headers:{'X-Open-Doc-Token':boot.token}});if(!response.ok)throw Error('fake worker endpoint '+response.status);const data=new Uint8Array(await response.arrayBuffer());const task=OpenDocPdf.getDocument({data,isEvalSupported:false,standardFontDataUrl:'/__vela__/static/open_doc/pdfjs/standard_fonts/'});const doc=await task.promise,page=await doc.getPage(1),viewport=page.getViewport({scale:1}),canvas=document.createElement('canvas');canvas.width=viewport.width;canvas.height=viewport.height;await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let dark=false;for(let i=0;i<pixels.length;i+=256)if(pixels[i]<80&&pixels[i+1]<80&&pixels[i+2]<80&&pixels[i+3]>200){dark=true;break;}await doc.destroy();if(!dark)throw Error('fake worker blank pixels');})()`);
  console.log('QT_PDF_FAKE_WORKER_LOCAL_BUNDLE_NONWHITE_PIXELS_OK');
  await evaluate("window.__pdfOriginal=OpenDocPdf;window.OpenDocPdf={...OpenDocPdf,TextLayer:class {constructor(){throw Error('QA text layer failure');}}};document.querySelector('.fixed-scroll').scrollTop=26000");await pause();await pause();await pause();
  assert.equal(await evaluate("!!document.querySelector('[data-error-stage=\"texto selecionável\"]')"),true);
  assert.ok(await evaluate("Array.from(document.querySelectorAll('.fixed-surface')).some(n=>n.querySelector('[data-error-stage]') && n.querySelector('canvas[data-render-complete=true]'))"));
  await evaluate('window.OpenDocPdf=__pdfOriginal');
  console.log('QT_TEXT_LAYER_FAILURE_KEEPS_RENDERED_CANVAS_OK');
  console.log('QT_SYNTHETIC_PEN_HISTORY_REVIEW_NATIVE_TEXT_3_RESOLUTIONS_OK');
  ws.close();
})().catch(error=>{console.error(error);process.exit(1);});
