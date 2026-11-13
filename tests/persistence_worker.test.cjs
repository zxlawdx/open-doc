const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const source=name=>fs.readFileSync(path.join(__dirname,'../apps/open_doc/static/js',name),'utf8');

test('document requests and recovery leave JSON encoding outside the interface thread',async t=>{
 const dom=new JSDOM('',{url:'http://localhost',runScripts:'outside-only'}),w=dom.window;
 const records=new Map();let worker,terminated=false;
 w.Worker=class{
  constructor(){worker=this;queueMicrotask(()=>this.onmessage({data:{ready:true}}));}
  postMessage(message){const copy=structuredClone(message);queueMicrotask(()=>{
   let value=null;const {op,data}=copy;
   if(op==='write')records.set(data.snapshot.id,data.snapshot);
   if(op==='read')value=records.get(data.id)||null;
   if(op==='clear')records.delete(data.id);
   if(op==='request')value={revision:data.snapshot.revision+1};
   this.onmessage({data:{id:copy.id,value}});
  });}
  terminate(){terminated=true;}
 };
 w.eval(source('recovery.js'));const recovery=w.OpenDocRecovery;recovery.configure('worker.js');
 t.after(()=>{recovery.destroy();dom.window.close();});
 w.JSON.stringify=()=>{throw Error('Full document encoding ran on the interface thread');};
 const snapshot={id:'doc',revision:1,content:{ink_layers:[{strokes:[{points:Array.from({length:1000},()=>({x:.5,y:.5}))}]}]}};
 await recovery.write(snapshot);
 assert.equal((await recovery.readAsync('doc')).content.ink_layers[0].strokes[0].points.length,1000);
 assert.equal((await recovery.sendRequest('document/save',snapshot,'token')).value.revision,2);
 await recovery.clear('doc');assert.equal(await recovery.readAsync('doc'),null);
 recovery.destroy();assert.equal(terminated,true);
});

test('worker HTTP transport preserves credentials, response errors and revision conflicts',async()=>{
 const messages=[],requests=[],self={postMessage:message=>messages.push(message)};
 const context=vm.createContext({self,JSON,Error,fetch:async(url,options)=>{
  requests.push({url,options});return {ok:false,status:409,json:async()=>({error:'Revisão alterada',conflict:true})};
 }});
 vm.runInContext(source('persistence_worker.js'),context);
 assert.equal(messages[0].ready,true);
 self.onmessage({data:{id:1,op:'request',data:{path:'document/save',token:'secret',snapshot:{id:'doc',revision:1}}}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(requests[0].url,'/api/open_doc/document/save');
 assert.equal(requests[0].options.headers['X-Open-Doc-Token'],'secret');
 assert.deepEqual(JSON.parse(requests[0].options.body),{id:'doc',revision:1});
 assert.equal(messages[1].error,'Revisão alterada');assert.equal(messages[1].conflict,true);
});

test('a pending document worker cannot block the workbook worker',async t=>{
 const dom=new JSDOM('',{url:'http://localhost',runScripts:'outside-only'}),w=dom.window,workers=[];
 w.Worker=class{
  constructor(url,options){this.name=options.name;workers.push(this);queueMicrotask(()=>this.onmessage({data:{ready:true}}));}
  postMessage(message){if(this.name==='open-doc-workbook')queueMicrotask(()=>this.onmessage({data:{id:message.id,value:{id:'sheet'}}}));}
  terminate(){}
 };
 w.eval(source('recovery.js'));const recovery=w.OpenDocRecovery;recovery.configure('worker.js');
 t.after(()=>{recovery.destroy();w.close();});
 const document=recovery.sendRequest('document/save',{id:'doc'},'token');
 const sheet=await recovery.sendRequest('workbook',{operation:'new'},'token');
 assert.equal(sheet.value.id,'sheet');
 assert.deepEqual(workers.map(worker=>worker.name),['open-doc-document','open-doc-workbook']);
 const rejected=assert.rejects(document,/interrompido/);recovery.destroy();await rejected;
});

test('a worker startup failure retains the legacy recovery path',async t=>{
 const dom=new JSDOM('',{url:'http://localhost',runScripts:'outside-only'}),w=dom.window;
 w.Worker=class{
  constructor(){queueMicrotask(()=>this.onerror());}
  terminate(){}
 };
 w.eval(source('recovery.js'));const recovery=w.OpenDocRecovery;recovery.configure('missing.js');
 t.after(()=>{recovery.destroy();w.close();});
 const snapshot={id:'doc',markdown:'Preservado',revision:1};
 await recovery.write(snapshot);
 assert.equal(recovery.read('doc').markdown,'Preservado');
 assert.equal((await recovery.sendRequest('document/save',snapshot,'token')).handled,false);
});

test('large ink crosses the interface in bounded chunks; worker assembles concurrent snapshots and releases staging',async t=>{
 const dom=new JSDOM('',{url:'http://localhost',runScripts:'outside-only'}),w=dom.window,bodies=[],contexts=[],sizes=[];
 w.Worker=class{
  constructor(){const owner=this;this.context=vm.createContext({self:{postMessage(message){queueMicrotask(()=>owner.onmessage?.({data:structuredClone(message)}));}},JSON,Error,Map,fetch:async(url,options)=>{bodies.push(JSON.parse(options.body));return{ok:true,json:async()=>({revision:2})};}});contexts.push(this.context);vm.runInContext(source('persistence_worker.js'),this.context);}
  postMessage(message){if(message.data.strokes)sizes.push(message.data.strokes.length);if(message.data.snapshot)assert.ok(message.data.snapshot.content.ink_layers[0].strokes.length<=1024);const copy=structuredClone(message);queueMicrotask(()=>this.context.self.onmessage({data:copy}));}
  terminate(){}
 };
 w.eval(source('recovery.js'));w.OpenDocRecovery.configure('worker.js');t.after(()=>{w.OpenDocRecovery.destroy();w.close();});
 w.JSON.stringify=()=>{throw Error('Geometry encoded on interface thread');};
 const snapshot=id=>({id,revision:1,content:{ink_layers:[{strokes:Array.from({length:2049},(_,i)=>({id:id+'-'+i,points:[{x:.1,y:.2}]}))}]}});
 await Promise.all(['one','two'].map(id=>w.OpenDocRecovery.sendRequest('document/save',snapshot(id),'token')));
 assert.equal(bodies.length,2);for(const body of bodies){assert.equal(body.content.ink_layers[0].strokes.length,2049);assert.equal(body.content.ink_layers[0].strokes[2048].id,body.id+'-2048');}
 assert.ok(sizes.every(size=>size<=256));assert.equal(vm.runInContext('stagedInk.size',contexts[0]),0);
});
