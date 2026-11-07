const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function main() {
  const [port, directory, identifier] = process.argv.slice(2);
  const targets = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json();
  const endpoint = targets.find(target => target.type === "page")?.webSocketDebuggerUrl;
  assert.ok(endpoint, "QtWebEngine CDP page");
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let sequence = 0;
  const pending = new Map();
  socket.onmessage = event => {
    const {id, result, error} = JSON.parse(event.data);
    if (!pending.has(id)) return;
    const [resolve, reject] = pending.get(id);
    pending.delete(id);
    if (error) reject(Error(JSON.stringify(error)));
    else resolve(result);
  };
  function send(method, params = {}) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      pending.set(id, [resolve, reject]);
      socket.send(JSON.stringify({id, method, params}));
    });
  }
  try {
    for (const [width, height] of [[1366, 768], [1920, 1080]]) {
      await send("Emulation.setDeviceMetricsOverride", {width, height, deviceScaleFactor: 1, mobile: false});
      const comparison = await send("Runtime.evaluate", {
        expression: "document.querySelectorAll('.version-history-comparison mark').length",
        returnByValue: true
      });
      assert.ok(comparison.result.value >= 2, "Changed lines must be visible");
      const screenshot = await send("Page.captureScreenshot", {format: "png"});
      const png = Buffer.from(screenshot.data, "base64");
      assert.equal(png.readUInt32BE(16), width);
      assert.equal(png.readUInt32BE(20), height);
      const output = path.join(directory, "version-history-" + identifier + "-" + width + "x" + height + ".png");
      fs.writeFileSync(output, png);
      console.log(output);
    }
  } finally {
    socket.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
