const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(path.join(__dirname,'../../apps/documents/static/js/table_insert_dialog.js'),'utf8');

function setup(t){
 const dom=new JSDOM('<div id="root"><div data-dialog hidden><div class="dialog"><h2 data-dialog-title></h2><div data-dialog-body></div></div></div></div>',
   {url:'http://localhost',runScripts:'outside-only'});
 const w=dom.window;t.after(()=>w.close());w.eval(source);
 const root=w.document.querySelector('#root');
 let resolve;
 const dialog=()=>{root.querySelector('[data-dialog-body]').replaceChildren();
   return new Promise(r=>resolve=r);};
 const commits=[];
 const editor={tableOperation:(...args)=>commits.push(args)};
 const errors=[];
 const launch=options=>w.OpenDocTableInsertDialog.TableInsertDialog.show({
   dialog,root,editor,status:value=>errors.push(value),...options
 });
 return {w,root,launch,commits,errors,confirm:()=>resolve(true),cancel:()=>resolve(null)};
}

test('table CSV/TSV parser handles quotes, delimiters and rejects oversized data',t=>{
 const q=setup(t),parse=q.w.OpenDocTableInsertDialog.parseDelimited;
 assert.deepEqual(JSON.parse(JSON.stringify(parse('A;B\n1;"valor; de pesquisa"\n2;4'))),
   [['A','B'],['1','valor; de pesquisa'],['2','4']]);
 assert.deepEqual(JSON.parse(JSON.stringify(parse('X\tY\n3\t4'))),
   [['X','Y'],['3','4']]);
 assert.throws(()=>parse('"not closed'),/aspas/);
 assert.throws(()=>parse('X'.repeat(200001)),/grande/);
 assert.throws(()=>parse(''),/contém/);
});

test('table dialog has clear row/column/spacing controls, four editable presets and confirms',async t=>{
 const q=setup(t);
 const waiting=q.launch(),box=q.root.querySelector('[data-dialog-body]');
 assert.equal(box.querySelectorAll('[data-table-preset]').length,4);
 const fields=Array.from(box.querySelectorAll('.table-dialog-field'));
 assert.equal(fields.length,4);
 const inputs=fields.map(row=>row.querySelector('input'));
 assert.deepEqual(inputs.map(input=>input.value),['3','4','0','https://']);
 assert.ok(inputs.slice(0,3).every(input=>input.type==='number'));
 inputs[0].value='5';inputs[1].value='6';inputs[2].value='12';
 box.querySelector('[data-table-preset=matrix]').click();
 q.confirm();await waiting;
 assert.equal(q.commits.length,1);
 const [command,rows,cols,options]=q.commits[0];
 assert.equal(command,'insert');assert.equal(rows,5);assert.equal(cols,6);
 assert.equal(options.preset,'matrix');assert.equal(options.cellSpacingPt,12);
 assert.equal(options.data,null);
});

test('table dialog cancel does not insert and invalid dimensions are rejected',async t=>{
 const q=setup(t);const waiting=q.launch();q.cancel();assert.equal(await waiting,false);
 assert.equal(q.commits.length,0);
 const next=q.launch(),box=q.root.querySelector('[data-dialog-body]');
 box.querySelector('.table-dialog-field input').value='0';
 q.confirm();await assert.rejects(next,/1 a 100 linhas/);
 assert.equal(q.commits.length,0);
});

test('slide table dialog retains quoted CSV, bounds, dimensions, template and transparency',async t=>{
 const q=setup(t);
 const waiting=q.launch({slide:true,onInsert:(...args)=>q.commits.push(args)});
 const body=q.root.querySelector('[data-dialog-body]');
 const paste=body.querySelector('textarea');
 paste.value='\uFEFF"Descrição; total",Valor\n"Pesquisa, 2021","39,2"';
 paste.dispatchEvent(new q.w.Event('input'));
 body.querySelector('[data-table-preset=plain]').click();
 body.querySelector('input[type=checkbox]').checked=true;
 q.confirm();
 await waiting;
 assert.deepEqual(JSON.parse(JSON.stringify(q.commits)),[[2,2,{
   preset:'plain',cellSpacingPt:4,data:[['Descrição; total','Valor'],['Pesquisa, 2021','39,2']],
   width:.55,height:.3,transparent:true
 }]]);
});
