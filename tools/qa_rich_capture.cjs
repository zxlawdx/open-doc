const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const port=process.argv[2] || '9234',destination=path.resolve(__dirname,'../docs/images/open-doc');
(async()=>{
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
  for(const [width,height] of [[1366,768],[1600,900],[1920,1080]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await evaluate("document.querySelector('[data-canvas]').scrollTop=0;window.OpenDocApp.layout().measure()");await pause();
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
    assert.ok(await evaluate("document.querySelectorAll('[data-rich] table td').length>0"));await shot('editor-rich-'+width);
  }
  await send('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false});
  await evaluate("document.querySelector('[data-rich] table').scrollIntoView({block:'center'})");await shot('editor-rich-table-1366');
  console.log('QT_RICH_CAPTURE_1366_1600_1920_TABLE_OK');ws.close();
})().catch(error=>{console.error(error.stack);process.exit(1);});
