const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const source=fs.readFileSync(require('./asset_path.cjs')('python_packages.js'),'utf8');
function setup(t,request,project=()=> 'project'){
 const dom=new JSDOM(`<section><button data-python-env-command="toggle"></button><div data-python-env-body><button data-python-env-command="install"></button><input data-python-env-names value="humanize"><input type="checkbox" data-python-env-agree checked><output data-python-env-status></output><ul data-python-env-installed></ul><pre data-python-env-log></pre></div></section>`,{runScripts:'outside-only'}),w=dom.window,host=w.document.querySelector('section'),abort=new w.AbortController();
 t.after(()=>{abort.abort();w.close();});w.eval(source);w.OpenDocPythonPackages.create({host,signal:abort.signal,request,project});return {w,host};
}
const tick=()=>new Promise(r=>setImmediate(r));
test('removing packages reports removal and refreshes the installed list',async t=>{
 const requests=[],{host}=setup(t,async(path,data)=>{requests.push(data);return data.operation==='python-env-remove'?{removed:['humanize'],log:'removed'}:{initialized:true,packages:[]};});
 host.querySelector('[data-python-env-command=remove]').click();await tick();
 assert.match(host.querySelector('output').textContent,/Bibliotecas removidas/);
 assert.equal(host.querySelector('ul').children.length,0);
 assert.equal(requests[0].confirm,true);assert.equal(requests[0].operation,'python-env-remove');
});
test('an installation finishing after switching projects cannot clear the new project inputs',async t=>{
 let id='first',finish;const pending=new Promise(r=>finish=r),{host}=setup(t,()=>pending,()=>id);
 host.querySelector('[data-python-env-command=install]').click();id='second';host.querySelector('[data-python-env-names]').value='numpy';finish({installed:['humanize']});await tick();
 assert.equal(host.querySelector('[data-python-env-names]').value,'numpy');assert.match(host.querySelector('output').textContent,/projeto anterior/);
});

test('activating Python autocomplete installs Jedi into the selected project on explicit click',async t=>{
 const requests=[],{host}=setup(t,async(path,data)=>{
   requests.push(data);
   return data.operation==='python-env-install'?{installed:['jedi==0.19.2'],log:'ok'}:
     {initialized:true,packages:[{name:'jedi',version:'0.19.2'}]};
 });
 host.querySelector('[data-python-env-command=editor]').click();
 await tick();
 assert.equal(requests[0].operation,'python-env-status');
 assert.equal(requests[1].operation,'python-env-install');
 assert.deepEqual(Array.from(requests[1].packages),['jedi==0.19.2']);
 assert.equal(requests[1].confirm,true);
 assert.equal(requests[1].id,'project');
 assert.match(host.querySelector('output').textContent,/Bibliotecas instaladas/);
});

test('autocomplete repair does not replace system Python with a new Jedi-only venv',async t=>{
 const requests=[],{host}=setup(t,async(path,data)=>{
   requests.push(data);
   return {initialized:false,packages:[]};
 });
 host.querySelector('[data-python-env-command=editor]').click();
 await tick();
 assert.deepEqual(requests.map(r=>r.operation),['python-env-status']);
 assert.match(host.querySelector('output').textContent,/Python do sistema/);
});
