/* ============ REAL QTWEBENGINE CAPTURES / LAYOUT ASSERTIONS ============ */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const port = process.argv[2] || '9234';
const destination = path.resolve(__dirname, '../docs/images/open-doc');
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
  fs.mkdirSync(destination, {recursive: true});
  for (const theme of ['light', 'dark']) {
    await evaluate("window.OpenDocApp.theme().set('" + theme + "')");
    for (const [width, height] of [[1366, 768], [1600, 900], [1920, 1080]]) {
      await send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: false});
      await evaluate('window.OpenDocApp.layout().measure()'); await pause();
      const geometry = JSON.parse(await evaluate(`JSON.stringify({
        width: innerWidth, height: innerHeight, globalOverflow: document.documentElement.scrollWidth > innerWidth,
        app: document.querySelector('[data-app]').getBoundingClientRect().width,
        page: document.querySelector('[data-surface]').getBoundingClientRect().width,
        paper: getComputedStyle(document.querySelector('[data-rich]')).backgroundColor,
        theme: document.querySelector('[data-app]').dataset.theme,
        outline: document.querySelectorAll('[data-outline] button').length
      })`));
      assert.equal(geometry.globalOverflow, false);
      assert.equal(geometry.app, width); assert.equal(geometry.page, 794);
      assert.equal(geometry.paper, 'rgb(255, 255, 255)'); assert.equal(geometry.theme, theme);
      assert.ok(geometry.outline >= 3);
      console.log('QT_LAYOUT_OK', theme, width, height, JSON.stringify(geometry));
      await shot('editor-' + theme + '-' + width);
    }
  }
  await send('Emulation.setDeviceMetricsOverride', {width: 1366, height: 768, deviceScaleFactor: 1, mobile: false});
  await evaluate("window.OpenDocApp.theme().set('light')");
  await evaluate("document.querySelector('[data-menu=file]').click()");
  assert.equal(await evaluate("document.querySelector('[data-menu=file]').getAttribute('aria-expanded')"), 'true');
  await shot('file-menu-1366');
  await evaluate("document.querySelector('[data-menu=file]').click()");
  await evaluate('window.OpenDocApp.layout().set(150)'); await pause();
  assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'), false);
  await evaluate('window.OpenDocApp.layout().set(100)');
  await evaluate('window.OpenDocApp.showHome()'); await pause();
  await shot('home-light-1366');
  ws.close();
})().catch(error => { console.error(error.stack); process.exit(1); });
