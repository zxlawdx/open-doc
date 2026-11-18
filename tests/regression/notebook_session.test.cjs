const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const source=fs.readFileSync(require('./asset_path.cjs')('code_notebook.js'),'utf8');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('notebook executes cell languages, keeps project drafts and persists source',async t=>{
 const dom=new JSDOM('<section><aside><h2 class="workbook-sidebar-title">Código</h2></aside></section>',{runScripts:'outside-only'}),w=dom.window,panel=w.document.querySelector('aside'),signal=new w.AbortController();
 let project='first';const executions=[],requests=[];
 t.after(()=>{signal.abort();w.close();});
 w.OpenDocGridWorkspace={icon:()=>w.document.createElement('i')};
 w.OpenDocCodeEditor={create:({field})=>({value:()=>field.value,focus:()=>{},lock:()=>{},remember:()=>{},columns:()=>{}})};
 w.eval(source);
 const api=w.OpenDocCodeNotebook.create({panel,signal:signal.signal,project:()=>project,onLayout:()=>{},request:async(path,data)=>{requests.push(data);return {cells:[]};},execute:async(language,code)=>{executions.push([language,code]);return {output:'42',returncode:0};}});
 await wait(0);
 const click=label=>[...panel.querySelectorAll('button')].find(button=>button.textContent===label).click();
 click('Python');panel.querySelector('[data-code-cell=python] textarea').value='answer=41';click('Executar');await wait(0);
 assert.deepEqual(executions,[['python','answer=41']]);assert.match(panel.textContent,/42/);
 project='second';api.activate();project='first';api.activate();
 assert.equal(panel.querySelector('[data-code-cell=python] textarea').value,'answer=41');
 panel.querySelector('textarea').dispatchEvent(new w.FocusEvent('focusout',{bubbles:true}));await wait(450);
 assert.ok(requests.some(item=>item.operation==='save-cells'&&item.cells[0]?.source==='answer=41'));
});

test('Python completion receives earlier notebook imports without executing them',async t=>{
 const dom=new JSDOM('<section><aside><h2 class="workbook-sidebar-title">Código</h2></aside></section>',{runScripts:'outside-only'});
 const w=dom.window,panel=w.document.querySelector('aside'),signal=new w.AbortController(),editors=[];
 t.after(()=>{signal.abort();w.close();});
 w.OpenDocGridWorkspace={icon:()=>w.document.createElement('i')};
 w.OpenDocCodeEditor={create:options=>{
   editors.push(options);
   return {value:()=>options.field.value,focus:()=>{},lock:()=>{},remember:()=>{},columns:()=>{}};
 }};
 w.eval(source);
 const api=w.OpenDocCodeNotebook.create({panel,signal:signal.signal,project:()=> 'project',
   onLayout:()=>{},request:async()=>({cells:[]}),execute:async()=>({returncode:0})});
 await wait(0);
 api.add('python','import pandas as pd');
 await wait(0);
 api.add('python','pd.DataF');
 await wait(0);
 assert.equal(editors.length,2);
 assert.match(editors[1].context(),/import pandas as pd/);
 assert.equal(editors[0].context(),'');
 // Notebook-only magics must not poison the static Jedi source.
 api.add('python','!pip install humanize');
 await wait(0);
 api.add('python','humanize.');
 await wait(0);
 assert.match(editors[3].context(),/pass/);
 assert.doesNotMatch(editors[3].context(),/!pip/);
});

test('cell insertion uses the selected gap and only the executing cell shows a spinner',async t=>{
 const dom=new JSDOM('<section><aside><h2 class="workbook-sidebar-title">Código</h2></aside></section>',{runScripts:'outside-only'});
 const w=dom.window,panel=w.document.querySelector('aside'),signal=new w.AbortController(),pending=[];
 t.after(()=>{signal.abort();w.close();});
 w.OpenDocGridWorkspace={icon:()=>w.document.createElement('i')};
 w.OpenDocCodeEditor={create:({field})=>({value:()=>field.value,focus:()=>{},lock:()=>{},remember:()=>{},columns:()=>{}})};
 w.eval(source);
 const api=w.OpenDocCodeNotebook.create({panel,signal:signal.signal,project:()=> 'project',
   onLayout:()=>{},request:async()=>({cells:[]}),execute:()=>new Promise(resolve=>pending.push(resolve))});
 await api.add('python','print(1)');
 await api.add('python','print(2)');
 panel.querySelectorAll('.code-notebook-insert')[1].querySelector('[title=Texto]').click();
 const cells=[...panel.querySelectorAll('.code-notebook-cell')];
 assert.deepEqual(cells.map(cell=>cell.dataset.codeCell),['python','text','python']);
 assert.equal(panel.querySelectorAll('.code-notebook-insert').length,4);
 const visible=()=>cells.filter(cell=>cell.querySelector('.code-cell-spinner:not([hidden])'));
 panel.querySelector('[title="Executar todas"]').click();
 assert.deepEqual(visible(),[cells[0]]);
 pending.shift()({output:'1'});
 await wait(0);
 assert.deepEqual(visible(),[cells[2]]);
 pending.shift()({output:'2'});
 await wait(0);
 assert.deepEqual(visible(),[]);
});
