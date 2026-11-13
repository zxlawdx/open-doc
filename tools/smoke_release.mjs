// Verify a packaged desktop process by inspecting its actual Qt WebEngine page.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {pptxCompatibilityFixture} from "./pptx_compat_fixture.mjs";
const pptxBytes = Array.from(pptxCompatibilityFixture());
const binary = resolve(process.argv[2]);
const server = createServer();
await new Promise((done, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", done);
});
const { port } = server.address();
await new Promise(done => server.close(done));
const launchEnv={...process.env,QTWEBENGINE_REMOTE_DEBUGGING:String(port)};
if(process.env.OPEN_DOC_SMOKE_DEFAULT_LINUX==='1'){
  for(const name of ['QT_QPA_PLATFORM','QT_XCB_GL_INTEGRATION','QT_OPENGL',
    'QT_QUICK_BACKEND','LIBGL_ALWAYS_SOFTWARE','QTWEBENGINE_CHROMIUM_FLAGS',
    'QTWEBENGINE_DISABLE_SANDBOX','VELA_HARDWARE_ACCELERATION','VELA_LINUX_COMPATIBILITY','LD_PRELOAD'])delete launchEnv[name];
}
const child = spawn(binary, [], {
  cwd: dirname(binary),
  env: launchEnv,
  stdio: "inherit",
});
let startError;
child.once("error", error => { startError = error; });
let ws;
let lastPage;
let debuggerUrl;
try {
  const deadline = Date.now() + 45_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (startError) throw startError;
    if (child.exitCode !== null || child.signalCode !== null)
      throw Error(`Open Doc encerrou durante a inicialização (${child.exitCode ?? child.signalCode}).`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(2000),
      });
      const pages = await response.json();
      const page = pages.find(item => item.type === "page" && item.webSocketDebuggerUrl);
      if (!page) lastPage = { pages: pages.map(item => ({ type: item.type, url: item.url })) };
      if (page) {
        debuggerUrl = page.webSocketDebuggerUrl;
        ws = new WebSocket(page.webSocketDebuggerUrl);
        ready = await new Promise(done => {
          const timer = setTimeout(() => done(false), 2000);
          const finish = value => { clearTimeout(timer); done(value); };
          ws.onopen = () => ws.send(JSON.stringify({
            id: 1, method: "Runtime.evaluate", params: {
              expression: `({
                url: location.href, state: document.readyState,
                ready: document.querySelector('[data-app]')?.dataset.ready === 'true',
                message: document.body?.innerText.slice(0, 400),
                bridge: Boolean(window.pywebview?.api),
                scripts: Array.from(document.scripts, item => item.src).filter(Boolean)
              })`,
              returnByValue: true,
            },
          }));
          ws.onmessage = event => {
            const message = JSON.parse(event.data);
            if (message.id === 1) {
              lastPage = message.result?.result?.value ?? message.error ?? message.result?.exceptionDetails;
              finish(lastPage?.ready === true);
            }
          };
          ws.onerror = () => finish(false);
        });
        ws.close();
        ws = undefined;
        if (ready) break;
      }
    } catch (error) {
      if (error.name !== "TypeError" && error.name !== "TimeoutError") throw error;
    }
    await delay(500);
  }
  if (!ready) throw Error(`A interface do Open Doc empacotado não ficou pronta. Estado: ${JSON.stringify(lastPage)}`);
  // Exercise the new Python asset module and its JS adapter inside the frozen app.
  ws = new WebSocket(debuggerUrl);
  const imageCheck = await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(Error('DOCX image smoke timed out.')), 30000);
    ws.onerror = () => { clearTimeout(timer); reject(Error('DOCX image CDP connection failed.')); };
    ws.onopen = () => ws.send(JSON.stringify({id: 2, method: 'Runtime.evaluate', params: {
      awaitPromise: true, returnByValue: true,
      expression: `(async () => {
        const pptx = await OpenDocPptx.loadBytes(new Uint8Array(${JSON.stringify(pptxBytes)}).buffer);
        const surface = document.createElement('div');
        document.body.appendChild(surface);
        try {
          const content = pptx.render(0, surface, 960, 540);
          const title = [...content.querySelectorAll('span')].find(n => n.textContent === 'Packaged PPTX QA' && n.style.fontSize);
          const curves = [...content.querySelectorAll('path')].filter(n => (n.getAttribute('d') || '').includes(' C '));
          if (!title || getComputedStyle(title).fontSize !== '40px' || getComputedStyle(title).color !== 'rgb(255, 255, 255)' || curves.length !== 1)
            throw Error('Packaged PPTX paragraph inheritance or wave geometry failed.');
        } finally {surface.remove(); pptx.destroy();}
        await OpenDocApp.action('new');
        const editor = OpenDocApp.editor();
        if (!await editor.insertImage('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAMCAIAAADtbgqsAAAAGUlEQVR4nGNcoZTGQC5gIlvnqOZRzTTXDACIewFIN82hKgAAAABJRU5ErkJggg==', 'Packaged image QA')) throw Error('Image insertion failed.');
        await editor.flush();
        const saved = editor.snapshot();
        const recovery = {...saved, id: 'packaged-worker-probe'};
        await OpenDocRecovery.write(recovery);
        const recovered = await OpenDocRecovery.readAsync(recovery.id);
        if (!recovered?.content?.blocks.some(block => block.children?.some(node => node.type === 'image')))
          throw Error('Packaged persistence worker or IndexedDB recovery is unavailable.');
        await OpenDocRecovery.clear(recovery.id);
        const images = () => (editor.snapshot().content?.blocks || []).flatMap(block => block.children || []).filter(node => node.type === 'image');
        if (images().length !== 1) throw Error('Image missing from saved model.');
        editor.format('undo');
        if (images().length) throw Error('Image insertion cannot be undone.');
        editor.format('redo');
        if (images().length !== 1) throw Error('Image insertion cannot be redone.');
        await editor.flush();
        editor.load({...saved, revision: editor.snapshot().revision});
        for (let i = 0; i < 40; i++) {
          if (document.querySelector('[data-rich] .rich-image img')?.naturalWidth > 0) return {ok: true, media: images()[0].media_id};
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw Error('Saved image could not be rendered after reopening.');
      })()`
    }}));
    ws.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.id !== 2) return;
      clearTimeout(timer);
      if (message.error || message.result?.exceptionDetails) reject(Error(JSON.stringify(message.error || message.result.exceptionDetails)));
      else done(message.result?.result?.value);
    };
  });
  if (!imageCheck?.ok) throw Error('DOCX image validation failed.');
  console.log(`OPEN_DOC_FROZEN_PPTX_COMPAT_OK ${binary}`);
  console.log(`OPEN_DOC_FROZEN_DOCX_IMAGE_OK ${binary} ${imageCheck.media}`);
  console.log(`OPEN_DOC_FROZEN_UI_OK ${binary}`);
  if(process.env.OPEN_DOC_NATIVE_PIXELS==='1'){
    const run=(command,args)=>{
      const result=spawnSync(command,args,{encoding:'utf8',timeout:10000});
      if(result.error||result.status!==0)throw Error(`${command}: ${result.error||result.stderr}`);
      return result.stdout.trim();
    };
    const ids=run('xdotool',['search','--onlyvisible','--name','Open Doc|Open-Doc']).split(/\s+/);
    const directory=resolve(process.env.OPEN_DOC_NATIVE_OUTPUT||'artifacts');mkdirSync(directory,{recursive:true});
    for(const id of ids)run('import',['-window',id,resolve(directory,`ui-window-${id}.png`)]);
    ws.close();ws=new WebSocket(debuggerUrl);
    await new Promise((done,reject)=>{
      const timer=setTimeout(()=>reject(Error('Native paint marker timed out.')),5000);
      ws.onerror=()=>{clearTimeout(timer);reject(Error('Native paint CDP connection failed.'));};
      ws.onopen=()=>ws.send(JSON.stringify({id:3,method:'Runtime.evaluate',params:{
        expression:`(()=>{const marker=document.createElement('div');marker.style.cssText='position:fixed;left:0;right:0;top:0;bottom:0;z-index:2147483647;background:rgb(22,199,132)';document.body.append(marker);return true;})()`,returnByValue:true}}));
      ws.onmessage=event=>{const response=JSON.parse(event.data);if(response.id!==3)return;
        clearTimeout(timer);if(response.error||response.result?.exceptionDetails)reject(Error(JSON.stringify(response)));else done();};
    });
    await delay(1000);
    let painted=false;
    for(const id of ids){
      const file=resolve(directory,`native-window-${id}.png`);
      run('import',['-window',id,file]);
      const raw=run('convert',[file,'-gravity','center','-crop','1x1+0+0','-depth','8','txt:-']);
      if(/\(22,199,132(?:,255)?\)/.test(raw)){painted=true;break;}
    }
    if(!painted)throw Error('DOM loaded but native X11 window did not paint the expected pixels.');
    console.log(`OPEN_DOC_FROZEN_NATIVE_PIXELS_OK ${binary}`);
  }
} finally {
  ws?.close();
  child.kill();
}
