// Verify a packaged desktop process by inspecting its actual Qt WebEngine page.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const binary = resolve(process.argv[2]);
const server = createServer();
await new Promise((done, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", done);
});
const { port } = server.address();
await new Promise(done => server.close(done));
const child = spawn(binary, [], {
  cwd: dirname(binary),
  env: { ...process.env, QTWEBENGINE_REMOTE_DEBUGGING: String(port) },
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
        await OpenDocApp.action('new');
        const editor = OpenDocApp.editor();
        if (!await editor.insertImage('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAMCAIAAADtbgqsAAAAGUlEQVR4nGNcoZTGQC5gIlvnqOZRzTTXDACIewFIN82hKgAAAABJRU5ErkJggg==', 'Packaged image QA')) throw Error('Image insertion failed.');
        await editor.flush();
        const saved = editor.snapshot();
        const images = () => editor.snapshot().content.blocks.flatMap(block => block.children || []).filter(node => node.type === 'image');
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
  console.log(`OPEN_DOC_FROZEN_DOCX_IMAGE_OK ${binary} ${imageCheck.media}`);
  console.log(`OPEN_DOC_FROZEN_UI_OK ${binary}`);
} finally {
  ws?.close();
  child.kill();
}
