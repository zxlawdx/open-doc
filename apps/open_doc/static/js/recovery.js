/* ============ RECOVERY STORAGE NAMESPACE MIGRATION ============ */
"use strict";
(() => {
  const key = id => "open-doc-recovery:" + id;
  const legacy = id => "vela-writer-recovery:" + id;
  function read(id) {
    try {
      const current = localStorage.getItem(key(id));
      if (current) return JSON.parse(current);
      const old = localStorage.getItem(legacy(id));
      if (!old) return null;
      const value = JSON.parse(old);
      localStorage.setItem(key(id), old);
      localStorage.removeItem(legacy(id));
      return value;
    } catch { return null; }
  }
  function legacyWrite(snapshot) {
    try { localStorage.setItem(key(snapshot.id), JSON.stringify(snapshot)); }
    catch { /* Persistent SQLite recovery is independent of WebView storage. */ }
  }
  function legacyClear(id) {
    try { localStorage.removeItem(key(id)); localStorage.removeItem(legacy(id)); }
    catch { /* Failure must not interrupt document persistence. */ }
  }
  let client=null,workerUrl=null,generation=0;
  const clients=new Map();
  const epochs=new Map();
  function createClient(channel) {
    if(typeof Worker!=='function' || !workerUrl)return null;
    let worker;
    try {worker=new Worker(workerUrl,{name:'open-doc-'+channel});}catch{return null;}
    const pending=new Map();let next=0,settled=false,available=false,readyResolve;
    const ready=new Promise(resolve=>{readyResolve=resolve;});
    const finish=value=>{if(settled)return;settled=true;available=value;clearTimeout(timer);readyResolve(value);};
    const fail=()=>{
      finish(false);available=false;
      for(const task of pending.values())task.reject(Error('O salvamento em segundo plano foi interrompido. Seu documento foi mantido.'));
      pending.clear();worker.terminate();
    };
    const timer=setTimeout(fail,3000);
    worker.onmessage=event=>{
      const message=event.data;
      if(message.ready){finish(true);return;}
      const task=pending.get(message.id);if(!task)return;pending.delete(message.id);
      if(message.error){const error=Error(message.error);error.conflict=Boolean(message.conflict);task.reject(error);}
      else task.resolve({handled:true,value:message.value});
    };
    worker.onerror=fail;
    async function send(op,data){
      if(!await ready || !available)return {handled:false};
      return new Promise((resolve,reject)=>{
        const id=++next;pending.set(id,{resolve,reject});
        try{worker.postMessage({id,op,data});}catch(error){pending.delete(id);reject(error);}
      });
    }
    let staging=0;
    return {
      async call(op,data){
        const layers=data.snapshot?.content?.ink_layers;
        if(!layers?.some(layer=>layer.strokes?.length>1024))return send(op,data);
        if(!await ready || !available)return {handled:false};
        // Structured cloning a whole illustrated document can also block the
        // interface. Stage bounded chunks and assemble them only in the worker.
        const refs=[],copy=layers.slice();
        try{
          for(let at=0;at<layers.length;at++){
            const strokes=layers[at].strokes;if(!strokes||strokes.length<=1024)continue;
            const key='ink-'+(++staging);refs.push({at,key});
            await send('stage-begin',{key});
            for(let offset=0;offset<strokes.length;offset+=256)await send('stage-append',{key,strokes:strokes.slice(offset,offset+256)});
            copy[at]={...layers[at],strokes:[]};
          }
          return await send(op,{...data,stagedInk:refs,snapshot:{...data.snapshot,content:{...data.snapshot.content,ink_layers:copy}}});
        }finally{if(available)await send('stage-discard',{keys:refs.map(ref=>ref.key)});}
      },
      destroy:fail
    };
  }
  function configure(url) {
    destroy();workerUrl=url;client=createClient('document');clients.set('document',client);
  }
  function write(snapshot) {
    const version=generation;
    const epoch=epochs.get(snapshot.id) || 0;
    if(!client)return legacyWrite(snapshot);
    const fallback=()=>{if(generation===version && (epochs.get(snapshot.id)||0)===epoch)legacyWrite(snapshot);};
    return client.call('write',{snapshot}).then(result=>{if(!result.handled)fallback();},fallback);
  }
  function clear(id) {
    epochs.set(id,(epochs.get(id)||0)+1);legacyClear(id);
    return client?.call('clear',{id}).catch(()=>{});
  }
  async function readAsync(id) {
    if(!client)return null;
    try {const result=await client.call('read',{id});return result.handled?result.value:null;}catch{return null;}
  }
  async function sendRequest(path,snapshot,token) {
    const channel=path.startsWith('document/')?'document':path==='workbook'?'workbook':path.startsWith('dataset')?'dataset':'metadata';
    if(!clients.has(channel))clients.set(channel,createClient(channel));
    const transport=clients.get(channel);
    if(!transport)return {handled:false};
    return transport.call('request',{path,snapshot,token});
  }
  function destroy(){generation++;for(const transport of clients.values())transport?.destroy();clients.clear();client=null;workerUrl=null;epochs.clear();}
  window.OpenDocRecovery = {read, readAsync, write, clear, configure, sendRequest, destroy};
})();
