const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const source=fs.readFileSync(require('./asset_path.cjs')('workspace.js'),'utf8');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('workspace restores active tab, publishes with revision and protects unsaved close',async t=>{
 const dom=new JSDOM('<main data-app><nav class="menubar"></nav></main>',{runScripts:'outside-only'}),w=dom.window;
 const controller=new w.AbortController(),root=w.document.querySelector('main'),requests=[],activated=[],messages=[];
 t.after(()=>{controller.abort();w.close();});w.eval(source);
 const api=w.OpenDocWorkspace.create({root,signal:controller.signal,snapshot:()=>({app:'documents',id:'next',title:'Próximo'}),activate:async tab=>activated.push(tab.id),status:text=>messages.push(text),request:async(path,data)=>{
   requests.push(data);return data.operation==='load'?{revision:3,tabs:[{app:'documents',id:'old',title:'Anterior'}],settings:{active:'old'},modules:{}}:{revision:4};
 }});
 await api.loaded;assert.deepEqual(activated,['old']);
 root.dataset.globalDirty='true';root.querySelector('[aria-label="Fechar Anterior"]').click();
 assert.equal(root.querySelectorAll('.workspace-global-tabs span').length,1);assert.match(messages.at(-1),/Salve/);
 root.dataset.globalDirty='false';root.dispatchEvent(new w.CustomEvent('open-doc:workspace'));await wait(350);
 assert.equal(root.querySelector('button[aria-current="true"]').textContent,'Próximo','dataset completion updates the active tab without changing view attributes');
 assert.equal(requests.find(value=>value.operation==='save').expected_revision,3);
 assert.equal(root.querySelectorAll('.workspace-global-tabs span').length,2);
});
test('session conflict preserves local tab and reloads remote revision',async t=>{
 const dom=new JSDOM('<main><nav class="menubar"></nav></main>',{runScripts:'outside-only'}),w=dom.window,root=w.document.querySelector('main');
 const abort=new w.AbortController(),messages=[];let loads=0;
 t.after(()=>{abort.abort();w.close();});w.eval(source);
 const api=w.OpenDocWorkspace.create({root,signal:abort.signal,snapshot:()=>({app:'data',id:'local',title:'Local'}),activate:async()=>{},status:value=>messages.push(value),request:async(path,data)=>{
  if(data.operation==='load'){loads++;return {revision:loads,tabs:loads>1?[{app:'pdf',id:'remote',title:'Remoto'}]:[],settings:{}};}
  const error=Error('revisão alterada');error.conflict=true;throw error;
 }});
 await api.loaded;await wait(350);assert.equal(loads,2);
 assert.match(root.querySelector('.workspace-global-tabs').textContent,/Local/);assert.match(root.querySelector('.workspace-global-tabs').textContent,/Remoto/);
 assert.match(messages.at(-1),/Sessão não salva/);
});
