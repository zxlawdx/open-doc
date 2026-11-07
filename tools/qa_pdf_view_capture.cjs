/* Capture the PDF viewport after the native-edit and annotation regression. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const port = process.argv[2];
  const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  const endpoint = targets.find(target => target.type === 'page')?.webSocketDebuggerUrl;
  assert.ok(endpoint, 'QtWebEngine CDP page');
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  };
  function send(method, params = {}) {
    const sequence = ++id;
    return new Promise((resolve, reject) => {
      pending.set(sequence, {resolve, reject});
      socket.send(JSON.stringify({id: sequence, method, params}));
    });
  }
  const output = path.resolve(process.env.OPEN_DOC_PDF_CAPTURES || 'docs/images/stabilization');
  fs.mkdirSync(output, {recursive: true});
  try {
    for (const [width, height] of [[1366, 768], [1920, 1080]]) {
      await send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: false});
      await new Promise(resolve => setTimeout(resolve, 500));
      const shot = await send('Page.captureScreenshot', {format: 'png'});
      const png = Buffer.from(shot.data, 'base64');
      assert.equal(png.readUInt32BE(16), width);
      assert.equal(png.readUInt32BE(20), height);
      fs.writeFileSync(path.join(output, 'pdf-reading-position-' + width + 'x' + height + '.png'), png);
    }
  } finally {
    socket.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
