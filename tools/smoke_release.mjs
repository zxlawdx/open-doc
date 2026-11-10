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
  console.log(`OPEN_DOC_FROZEN_UI_OK ${binary}`);
} finally {
  ws?.close();
  child.kill();
}
