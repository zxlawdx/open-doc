/* Capture the actual editable multi-page document in the Qt WebEngine. */
const fs=require('node:fs'),path=require('node:path');
(async()=>{
 const tabs=await(await fetch('http://127.0.0.1:'+(process.argv[2]||9234)+'/json/list')).json(),ws=new WebSocket(tabs.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});let id=0;const pending=new Map();ws.onmessage=e=>{const data=JSON.parse(e.data);if(pending.has(data.id)){const [r,j]=pending.get(data.id);pending.delete(data.id);data.error?j(Error(data.error.message)):r(data.result);}};const send=(method,params={})=>new Promise((r,j)=>{pending.set(++id,[r,j]);ws.send(JSON.stringify({id,method,params}));});
 await send('Emulation.setDeviceMetricsOverride',{width:1366,height:900,deviceScaleFactor:1,mobile:false});
 await send('Runtime.evaluate',{expression:"window.OpenDocApp.layout().set(60);document.querySelector('[data-canvas]').scrollTop=450;document.querySelector('[data-canvas]').dispatchEvent(new Event('scroll'))"});await new Promise(r=>setTimeout(r,300));
 const image=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.resolve(__dirname,'../docs/images/open-doc/editor-pages-1366.png'),Buffer.from(image.data,'base64'));
 await send('Runtime.evaluate',{expression:"window.OpenDocApp.layout().set(100);document.querySelector('[data-canvas]').scrollTop=0"});ws.close();console.log('QT_EDITABLE_PAGES_CAPTURE_OK');
})().catch(e=>{console.error(e);process.exit(1);});
