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
 const slide=q.scroller.querySelector('.fixed-surface');
 const shape=q.scroller.querySelector('.slide-object-rect');
 assert.equal(shape.parentElement,slide,'shapes must attach directly to slide');
 assert.equal(shape.style.position,'absolute');
 assert.equal(shape.style.left,'307.2px');
 assert.equal(shape.style.width,'345.6px');
 assert.equal(shape.style.zIndex,'3');
 const layer=q.scroller.querySelector('.slide-object-layer');
 assert.equal(layer.style.width,'100%','Windows Qt/Chromium 83 must have nonzero shape parent width');
 assert.equal(layer.style.height,'100%','Windows Qt/Chromium 83 must have nonzero shape parent height');
 assert.equal(layer.style.left,'0px');
 assert.equal(layer.style.top,'0px');
 assert.equal(q.scroller.querySelectorAll('.slide-vector-shape rect').length,1);
 assert.equal(q.scroller.querySelectorAll('.slide-vector-shape ellipse').length,1);
 assert.equal(q.scroller.querySelector('.slide-vector-shape rect').getAttribute('fill'),'#DAE2FD');
 assert.equal(q.sidebar.querySelectorAll('[data-thumbnail-index]').length,1);
 assert.equal(q.root.querySelector('[data-count]').textContent,'1 slides');
 const ids=q.model().surfaces[0].elements.map(o=>o.id);
 assert.equal(new Set(ids).size,3);
 const props=Array.from(q.host.querySelectorAll('.slide-inspector label'));
 const label=props.find(x=>x.textContent.startsWith('Preenchimento'));
 assert.equal(props.some(x=>x.textContent.startsWith('Cor do texto')),false);
 assert.ok(label);
 const input=label.querySelector('input');input.value='#224466';input.dispatchEvent(new q.w.Event('change'));
 assert.equal(q.model().surfaces[0].elements[2].fill,'#224466');
 assert.equal(q.scroller.querySelector('.slide-vector-shape ellipse').getAttribute('fill'),'#224466');
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

test('shape insertion returns to selection rather than leaving ink interception active',t=>{
 const q=setup(t),modes=[];
 q.root.addEventListener('open-doc:ink-mode',event=>modes.push(event.detail));
 clickLabel(q.controls,'Retângulo');
 assert.deepEqual(modes,['cursor']);
 const shape=q.scroller.querySelector('.slide-object-rect');
 assert.equal(shape.dataset.selected,'true');
 assert.equal(shape.querySelector('svg rect').getAttribute('stroke'),'#004AC6');
 assert.ok(shape.querySelector('[data-resize]'));
});

test('local SVG toolbar icons, expanded shape catalog and editable layer names',t=>{
 const q=setup(t);
 for(const label of ['Arredondado','Linha','Seta','Triângulo','Losango'])
   clickLabel(q.controls,label);
 const shapes=q.model().surfaces[0].elements;
 assert.deepEqual(shapes.map(s=>s.type),['round_rect','line','arrow','triangle','diamond']);
 const surface=q.scroller.querySelector('.fixed-surface');
 assert.equal(surface.querySelectorAll(':scope > .slide-object').length,5);
 assert.equal(surface.querySelectorAll('.slide-vector-shape').length,5);
 assert.ok(surface.querySelector('.slide-object-round_rect rect[rx]'));
 assert.ok(surface.querySelector('.slide-object-line line'));
 assert.ok(surface.querySelector('.slide-object-arrow path'));
 assert.equal(surface.querySelectorAll('.slide-object polygon').length,2);
 for(const label of ['Retângulo','Elipse','Linha','Seta']){
   const button=Array.from(q.controls.querySelectorAll('.slide-studio-toolbar button'))
      .find(b=>b.textContent===label);
   assert.ok(button.querySelector('svg use'),'SVG icon for '+label);
 }
 assert.ok(q.host.querySelector('.slide-layer-list').textContent.includes('Losango 1'));
 const name=Array.from(q.host.querySelectorAll('.slide-inspector label'))
   .find(x=>x.textContent.startsWith('Nome')).querySelector('input');
 name.value='Formação regional';name.dispatchEvent(new q.w.Event('change'));
 assert.equal(q.model().surfaces[0].elements[4].name,'Formação regional');
 assert.ok(q.host.querySelector('.slide-layer-list').textContent.includes('Formação regional'));
 const duplicate=Array.from(q.host.querySelectorAll('.slide-layer-actions button'))
   .find(b=>b.textContent==='Duplicar objeto');
 duplicate.click();
 assert.equal(q.model().surfaces[0].elements.length,6);
 assert.notEqual(q.model().surfaces[0].elements[4].id,q.model().surfaces[0].elements[5].id);
});
