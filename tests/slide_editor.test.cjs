const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const script=fs.readFileSync(path.join(__dirname,'../apps/open_doc/static/js/slide_editor.js'),'utf8');

function setup(t){
 const dom=new JSDOM(
  '<div id="root"><span data-position></span><span data-count></span>'+
  '<section class="fixed-document" id="host"><div class="fixed-controls" id="controls"></div>'+
  '<aside class="fixed-sidebar" id="sidebar"><button data-thumbnail-index="0">Página 1</button></aside>'+
  '<div class="fixed-scroll" id="scroll"><div class="fixed-surface" data-page-index="0"></div></div></section></div>',
  {url:'http://localhost',runScripts:'outside-only'});
 const w=dom.window;t.after(()=>w.close());
 w.OpenDocModel={id:(()=>{let x=0;return()=>'slide-node-'+(++x);})()};
 w.eval(script);
 const root=w.document.querySelector('#root'),host=w.document.querySelector('#host'),
   controls=w.document.querySelector('#controls'),scroller=w.document.querySelector('#scroll'),
   sidebar=w.document.querySelector('#sidebar');
 let model={editable_deck:true,surfaces:[{index:0,width_pt:960,height_pt:540,background:'#FFFFFF',
   strokes:[],text_overlays:[],elements:[],notes:''}]};
 const versions=[],abort=new w.AbortController();
 t.after(()=>abort.abort());
 let selected=0;
 const editor=w.OpenDocSlidesEditor.create({root,host,controls,scroller,sidebar,signal:abort.signal,
   getModel:()=>model,update:value=>{model=value;versions.push(JSON.stringify(value));},
   status:()=>{},getZoom:()=>1,go:index=>{selected=index;editor.onPageChange(index);},
   undo:()=>{},redo:()=>{},onRender:()=>{}});
 editor.load();
 return {w,root,host,controls,scroller,sidebar,editor,model:()=>model,versions,selected:()=>selected};
}
function clickLabel(root,text){
 const button=Array.from(root.querySelectorAll('.slide-studio-toolbar button')).find(b=>b.textContent===text);
 assert.ok(button,'toolbar action exists: '+text);button.click();
}

test('new slides support text and native shape objects with editable properties',t=>{
 const q=setup(t);
 clickLabel(q.controls,'Texto');clickLabel(q.controls,'Retângulo');clickLabel(q.controls,'Elipse');
 assert.equal(q.model().surfaces[0].elements.length,3);
 assert.equal(q.scroller.querySelectorAll('.slide-object').length,3);
 assert.equal(q.sidebar.querySelectorAll('[data-thumbnail-index]').length,1);
 assert.equal(q.root.querySelector('[data-count]').textContent,'1 slides');
 const ids=q.model().surfaces[0].elements.map(o=>o.id);
 assert.equal(new Set(ids).size,3);
 const props=Array.from(q.host.querySelectorAll('.slide-inspector label'));
 const label=props.find(x=>x.textContent.startsWith('Cor do texto'));
 assert.ok(label);
 const input=label.querySelector('input');input.value='#224466';input.dispatchEvent(new q.w.Event('change'));
 assert.equal(q.model().surfaces[0].elements[2].color,'#224466');
 clickLabel(q.controls,'+ Slide');
 assert.equal(q.model().surfaces.length,2);
 assert.equal(q.model().surfaces[1].index,1);
 assert.equal(q.scroller.querySelectorAll('.fixed-surface').length,2);
 clickLabel(q.controls,'Duplicar');
 assert.equal(q.model().surfaces.length,3);
 assert.equal(q.model().surfaces.map(s=>s.index).join(','),'0,1,2');
 clickLabel(q.controls,'↑ Slide');
 assert.equal(q.model().surfaces.length,3);
 clickLabel(q.controls,'Excluir slide');
 assert.equal(q.model().surfaces.length,2);
});

test('dragging commits one normalized edit, preserving slide boundaries',t=>{
 const q=setup(t);clickLabel(q.controls,'Texto');
 const box=q.scroller.querySelector('.fixed-surface');
 box.getBoundingClientRect=()=>({left:10,top:20,width:600,height:300,right:610,bottom:320});
 const obj=q.scroller.querySelector('.slide-object'),before=q.versions.length;
 obj.dispatchEvent(new q.w.MouseEvent('pointerdown',{bubbles:true,clientX:100,clientY:100,button:0}));
 q.w.dispatchEvent(new q.w.MouseEvent('pointermove',{clientX:190,clientY:130,bubbles:true}));
 assert.equal(q.versions.length,before,'history must not update per pointer sample');
 q.w.dispatchEvent(new q.w.MouseEvent('pointerup',{clientX:190,clientY:130,bubbles:true}));
 assert.equal(q.versions.length,before+1);
 const updated=q.model().surfaces[0].elements[0];
 assert.ok(updated.x>.2);assert.ok(updated.y>.24);
 assert.ok(updated.x+updated.width<=1);
});

test('inspector edits text/notes and layer deletion affects saved model',t=>{
 const q=setup(t);clickLabel(q.controls,'Texto');
 const obj=q.scroller.querySelector('.slide-object');
 obj.click();
 const textarea=Array.from(q.host.querySelectorAll('.slide-inspector textarea')).find(x=>x.parentElement.textContent.startsWith('Texto'));
 assert.ok(textarea);
 textarea.value='Conclusões da pesquisa';
 textarea.dispatchEvent(new q.w.Event('change'));
 assert.equal(q.model().surfaces[0].elements[0].text,'Conclusões da pesquisa');
 const note=Array.from(q.host.querySelectorAll('.slide-inspector textarea')).find(x=>x.parentElement.textContent.startsWith('Notas'));
 note.value='Apresentação no evento';note.dispatchEvent(new q.w.Event('change'));
 assert.equal(q.model().surfaces[0].notes,'Apresentação no evento');
 const del=Array.from(q.host.querySelectorAll('.slide-layer-actions button')).find(x=>x.textContent==='Excluir objeto');
 del.click();assert.equal(q.model().surfaces[0].elements.length,0);
});
