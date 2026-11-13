/* Real Qt CDP screenshot transport; no document data leaves localhost. */
const fs=require('node:fs');
(async()=>{
 const pages=await(await fetch('http://127.0.0.1:'+process.argv[2]+'/json/list')).json();
 const ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
 let id=0;const pending=new Map();
 ws.onmessage=event=>{const value=JSON.parse(event.data),entry=pending.get(value.id);if(entry){pending.delete(value.id);value.error?entry[1](Error(JSON.stringify(value.error))):entry[0](value.result);}};
 const send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,[resolve,reject]);ws.send(JSON.stringify({id:key,method,params}));});
 await send('Runtime.evaluate',{expression:'document.fonts.ready',awaitPromise:true});
 const width=Number(process.argv[4]),height=Number(process.argv[5]);
 if(Number.isInteger(width)&&width>0&&Number.isInteger(height)&&height>0){
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  const result=await send('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:`(async()=>{
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const root=document.querySelector('[data-app]');
    if(root?.dataset.sourceKind==='pdf'){
      [...document.querySelectorAll('.fixed-controls button')].find(button=>button.textContent==='Ajustar largura')?.click();
      for(let i=0;i<200;i++){
        const index=Number(document.querySelector('.fixed-controls input[type=number]').value)-1;
        if(document.querySelector('.fixed-surface[data-page-index="'+index+'"] canvas[data-render-complete=true]'))return true;
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      throw Error('PDF canvas did not settle after resizing');
    }
    return true;
  })()`});
  if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));
 }
 const shot=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync(process.argv[3],Buffer.from(shot.data,'base64'));ws.close();
})().catch(error=>{console.error(error);process.exitCode=1;});
