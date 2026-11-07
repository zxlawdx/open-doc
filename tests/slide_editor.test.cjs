const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const chartScript=fs.readFileSync(path.join(__dirname,'../apps/open_doc/static/js/slide_charts.js'),'utf8');
const script=fs.readFileSync(path.join(__dirname,'../apps/open_doc/static/js/slide_editor.js'),'utf8');

function setup(t, options={}){
 const dom=new JSDOM(
  '<div id="root"><span data-position></span><span data-count></span>'+
  '<section class="fixed-document" id="host"><div class="fixed-controls" id="controls"></div>'+
  '<aside class="fixed-sidebar" id="sidebar"><button data-thumbnail-index="0">Página 1</button></aside>'+
  '<div class="fixed-scroll" id="scroll"><div class="fixed-surface" data-page-index="0"></div></div></section></div>',
  {url:'http://localhost',runScripts:'outside-only'});
 const w=dom.window;t.after(()=>w.close());
 w.OpenDocModel={id:(()=>{let x=0;return()=>'slide-node-'+(++x);})()};
 w.eval(chartScript);
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
   status:()=>{},getZoom:()=>options.zoom??1,go:index=>{selected=index;editor.goTo(index);},
   undo:()=>{},redo:()=>{},onRender:()=>{},onViewportResize:options.onViewportResize,exportSlide:options.exportSlide});
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
 assert.ok(Math.abs(parseFloat(shape.style.left)-307.2)<.001,'pixel positioning within floating-point tolerance');
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
 assert.equal(q.scroller.querySelectorAll('.fixed-surface').length,1,
   'the active editor must not stack a second slide beneath the first');
 assert.equal(q.scroller.querySelector('.fixed-surface').dataset.pageIndex,'1');
 assert.equal(q.sidebar.querySelectorAll('[data-thumbnail-index]').length,2);
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
 assert.equal(JSON.stringify(shapes.map(s=>s.type)),JSON.stringify(['round_rect','line','arrow','triangle','diamond']));
 const surface=q.scroller.querySelector('.fixed-surface');
 assert.equal(surface.querySelectorAll(':scope > .slide-object').length,5);
 assert.equal(surface.querySelectorAll('.slide-vector-shape').length,5);
 assert.ok(surface.querySelector('.slide-object-round_rect rect[rx]'));
 assert.ok(surface.querySelector('.slide-object-line line'));
 assert.ok(surface.querySelector('.slide-object-arrow polygon'));
 assert.equal(surface.querySelectorAll('.slide-object polygon').length,3,'arrow, triangle and diamond are filled polygons');
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
 const rotation=Array.from(q.host.querySelectorAll('.slide-inspector label'))
   .find(x=>x.textContent.startsWith('Rotação')).querySelector('input');
 rotation.value='45';rotation.dispatchEvent(new q.w.Event('change'));
 assert.equal(q.model().surfaces[0].elements[4].rotation,45);
 const strokeWidth=Array.from(q.host.querySelectorAll('.slide-inspector label'))
   .find(x=>x.textContent.startsWith('Espessura')).querySelector('input');
 strokeWidth.value='3';strokeWidth.dispatchEvent(new q.w.Event('change'));
 assert.equal(q.model().surfaces[0].elements[4].stroke_width,3);
 assert.ok(q.host.querySelector('.slide-layer-list').textContent.includes('Formação regional'));
 const duplicate=Array.from(q.host.querySelectorAll('.slide-layer-actions button'))
   .find(b=>b.textContent==='Duplicar objeto');
 duplicate.click();
 assert.equal(q.model().surfaces[0].elements.length,6);
 assert.notEqual(q.model().surfaces[0].elements[4].id,q.model().surfaces[0].elements[5].id);
});


test('middle-mouse and Space drag pan workspace without mutating slide history',t=>{
 const q=setup(t);
 clickLabel(q.controls,'Retângulo');
 const before=q.versions.length;
 q.scroller.scrollLeft=80;q.scroller.scrollTop=60;
 q.scroller.dispatchEvent(new q.w.MouseEvent('pointerdown',
   {bubbles:true,button:1,clientX:100,clientY:100}));
 q.w.dispatchEvent(new q.w.MouseEvent('pointermove',
   {bubbles:true,clientX:120,clientY:130}));
 assert.equal(q.scroller.scrollLeft,60);
 assert.equal(q.scroller.scrollTop,30);
 q.w.dispatchEvent(new q.w.MouseEvent('pointerup',
   {bubbles:true,button:1,clientX:120,clientY:130}));
 assert.equal(q.versions.length,before,'pan must not enter undo history');
 q.root.dispatchEvent(new q.w.KeyboardEvent('keydown',{key:' ',bubbles:true}));
 assert.equal(q.scroller.style.cursor,'grab');
 q.scroller.dispatchEvent(new q.w.MouseEvent('pointerdown',
   {bubbles:true,button:0,clientX:10,clientY:10}));
 q.w.dispatchEvent(new q.w.MouseEvent('pointermove',
   {bubbles:true,clientX:20,clientY:20}));
 q.w.dispatchEvent(new q.w.MouseEvent('pointerup',
   {bubbles:true,button:0,clientX:20,clientY:20}));
 q.root.dispatchEvent(new q.w.KeyboardEvent('keyup',{key:' ',bubbles:true}));
 assert.equal(q.versions.length,before);
 assert.equal(q.scroller.style.cursor,'');
});


test('legacy Qt keeps shape previews contained, while the canvas clips slide edges',t=>{
 const q=setup(t);
 clickLabel(q.controls,'Elipse');
 const page=q.scroller.querySelector('.fixed-surface');
 const thumb=q.sidebar.querySelector('.slide-thumb-preview');
 assert.equal(page.style.overflow,'hidden','slide objects must be clipped to page bounds');
 assert.equal(page.style.position,'relative');
 assert.equal(page.style.isolation,'isolate');
 assert.ok(parseFloat(thumb.style.height)>50,'explicit 16:9 thumbnail height supports legacy Qt without aspect-ratio');
 assert.equal(thumb.style.overflow,'hidden');
 assert.equal(thumb.style.position,'relative');
 assert.equal(page.querySelectorAll(':scope > .slide-object').length,1);
 q.editor.render();
 assert.equal(q.scroller.querySelectorAll('.fixed-surface .slide-object').length,1,
   'rerender must replace the active canvas without duplicate SVGs');
 assert.equal(q.scroller.querySelectorAll('.slide-object').length,1);
});


test('new slide insertions enforce the same 500-object limit as duplication',t=>{
 const q=setup(t);clickLabel(q.controls,'Retângulo');
 const slide=q.model().surfaces[0],first=slide.elements[0];
 for(let i=1;i<500;i++)slide.elements.push({...first,id:'limit-'+i});
 const before=q.versions.length;
 clickLabel(q.controls,'Elipse');
 assert.equal(slide.elements.length,500,'the rejected insertion must not mutate slide data');
 assert.equal(q.versions.length,before,'a rejected insertion must not enter undo history');
});


test('file image insertion renders editable slide picture and reuses one stored asset',async t=>{
 const q=setup(t);
 const button=Array.from(q.controls.querySelectorAll('.slide-studio-toolbar button'))
   .find(b=>b.textContent==='Imagem');
 assert.ok(button&&button.querySelector('svg use'),'picture button has local SVG icon');
 const input=q.controls.querySelector('input[type="file"]');
 assert.equal(input.accept,'image/png,image/jpeg,image/webp');
 const data=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGMUSTnxn4GBgYGJAQoAIXQCQ5eZzjUAAAAASUVORK5CYII=','base64');
 const file=new q.w.File([data],'pesquisa.png',{type:'image/png'});
 Object.defineProperty(input,'files',{configurable:true,value:[file]});
 input.dispatchEvent(new q.w.Event('change',{bubbles:true}));
 await new Promise((resolve,reject)=>{
   const start=Date.now();
   const check=()=>{
     if(q.model().surfaces[0].elements.length)return resolve();
     if(Date.now()-start>1500)return reject(Error('FileReader did not insert image'));
     setTimeout(check,10);
   };
   check();
 });
 const item=q.model().surfaces[0].elements[0];
 assert.equal(item.type,'image');
 const asset=q.model().assets[item.asset_id];
 assert.equal(asset.mime,'image/png');
 assert.equal(asset.data,data.toString('base64'));
 assert.ok(q.scroller.querySelector('.slide-object-image img'));
 assert.ok(q.sidebar.querySelector('.slide-thumb-preview img'));
 const second=q.editor.commands.insertImage(0,{mime:asset.mime,data:asset.data,name:'Cópia'});
 assert.notEqual(second,item.id);
 assert.equal(Object.keys(q.model().assets).length,1,'identical pictures share one deck asset');
 q.editor.render();
 assert.equal(q.scroller.querySelectorAll('.slide-object-image img').length,2);
});

test('replacing a slide picture preserves geometry, layer and undo history entry; mirror flags stay editable',t=>{
 const q=setup(t);
 const first={mime:'image/png',data:'YQ==',name:'Original'};
 const id=q.editor.commands.insertImage(0,first);
 const el=q.model().surfaces[0].elements[0];
 q.editor.commands.updateObject(0,id,{x:.12,y:.13,width:.55,height:.31,rotation:15});
 const before=q.versions.length;
 q.editor.commands.replaceImage(0,id,{mime:'image/png',data:'Yg==',name:'Nova'});
 const updated=q.model().surfaces[0].elements[0];
 assert.equal(updated.id,id);
 assert.equal(updated.name,'Original');
 assert.deepEqual([updated.x,updated.y,updated.width,updated.height,updated.rotation],[.12,.13,.55,.31,15]);
 assert.equal(q.model().assets[updated.asset_id].data,'Yg==');
 assert.equal(q.versions.length,before+1,'replacement is one undo operation');
 q.editor.selected=id;q.editor.render();
 const replaceButton=Array.from(q.host.querySelectorAll('.slide-inspector button')).find(b=>b.textContent==='Substituir imagem');
 assert.ok(replaceButton,'replace image action in inspector');
 const h=Array.from(q.host.querySelectorAll('.slide-inspector label')).find(label=>label.textContent.includes('Espelhar horizontalmente')).querySelector('input');
 h.checked=true;h.dispatchEvent(new q.w.Event('change'));
 assert.equal(q.model().surfaces[0].elements[0].flip_h,true);
 const v=Array.from(q.host.querySelectorAll('.slide-inspector label')).find(label=>label.textContent.includes('Espelhar verticalmente')).querySelector('input');
 v.checked=true;v.dispatchEvent(new q.w.Event('change'));
 assert.equal(q.model().surfaces[0].elements[0].flip_v,true);
 assert.match(q.scroller.querySelector('.fixed-surface .slide-object-image').style.transform,/scale\(-1,-1\)/);
 assert.throws(()=>q.editor.commands.replaceImage(0,'missing',{mime:'image/png',data:'Yw=='}),/Selecione uma imagem/);
});

test('dragging an image onto a slide imports once and regular paste preserves text editing',async t=>{
 const q=setup(t),slide=q.scroller.querySelector('.fixed-surface');
 const image=new q.w.File([Buffer.from('abc')],'dropped.png',{type:'image/png'});
 const over=new q.w.Event('dragover',{bubbles:true,cancelable:true});
 Object.defineProperty(over,'dataTransfer',{value:{types:['Files'],files:[image],dropEffect:'none'}});
 slide.dispatchEvent(over);
 assert.equal(over.defaultPrevented,true,'file drop has copy affordance');
 const before=q.versions.length;
 const drop=new q.w.Event('drop',{bubbles:true,cancelable:true});
 Object.defineProperty(drop,'dataTransfer',{value:{files:[image],items:[]}});
 slide.dispatchEvent(drop);
 assert.equal(drop.defaultPrevented,true);
 for(let i=0;i<150&&q.model().surfaces[0].elements.length===0;i++)
   await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(q.model().surfaces[0].elements.length,1);
 assert.equal(q.versions.length,before+1,'drop enters history exactly once');
 const ignored=new q.w.Event('paste',{bubbles:true,cancelable:true});
 Object.defineProperty(ignored,'clipboardData',{value:{files:[],items:[]}});
 q.root.dispatchEvent(ignored);
 assert.equal(ignored.defaultPrevented,false,'text-only clipboard is not intercepted');
 const pasted=new q.w.Event('paste',{bubbles:true,cancelable:true});
 Object.defineProperty(pasted,'clipboardData',{value:{
   files:[],items:[{kind:'file',type:'image/png',getAsFile:()=>image}]
 }});
 q.root.dispatchEvent(pasted);
 assert.equal(pasted.defaultPrevented,true);
 for(let i=0;i<150&&q.model().surfaces[0].elements.length!==2;i++)
   await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(q.model().surfaces[0].elements.length,2);
 assert.equal(q.versions.length,before+2);
 assert.equal(Object.keys(q.model().assets).length,1,'paste reuses identical assets');
});

test('Shift selection supports batch alignment and one-step deletion without changing object sizes',t=>{
 const q=setup(t);
 clickLabel(q.controls,'Retângulo');clickLabel(q.controls,'Elipse');
 const ids=q.model().surfaces[0].elements.map(o=>o.id);
 q.editor.commands.updateObject(0,ids[0],{x:.10,y:.13,width:.20,height:.17});
 q.editor.commands.updateObject(0,ids[1],{x:.48,y:.37,width:.30,height:.23});
 q.scroller.querySelectorAll('.fixed-surface .slide-object')[0]
   .dispatchEvent(new q.w.MouseEvent('click',{bubbles:true}));
 q.scroller.querySelectorAll('.fixed-surface .slide-object')[1]
   .dispatchEvent(new q.w.MouseEvent('click',{bubbles:true,shiftKey:true}));
 assert.equal(q.scroller.querySelectorAll('.fixed-surface [data-selected=true]').length,2);
 const findButton=(label)=>Array.from(q.host.querySelectorAll('.slide-inspector button')).find(b=>b.textContent===label);
 const align=findButton('Alinhar centros horizontalmente');
 assert.ok(align);
 const before=q.versions.length;
 align.click();
 assert.equal(q.versions.length,before+1,'alignment must commit exactly one history step');
 const objs=q.model().surfaces[0].elements;
 assert.ok(Math.abs(objs[0].x+objs[0].width/2-objs[1].x-objs[1].width/2)<.00001);
 assert.equal(objs[0].width,.20);
 assert.equal(objs[1].width,.30);
 const del=findButton('Excluir selecionados');
 assert.ok(del);
 del.click();
 assert.equal(q.model().surfaces[0].elements.length,0);
 assert.equal(q.versions.length,before+2,'delete selected objects is one history step');
});

test('Inspector non-destructive picture crop preserves geometry, history and image source',t=>{
 const q=setup(t);
 const id=q.editor.commands.insertImage(0,{mime:'image/png',data:'YQ==',name:'Foto'});
 q.editor._selectObject(id);q.editor.render();
 const original=q.model().surfaces[0].elements[0],originalAsset=original.asset_id;
 const before=q.versions.length;
 const inputFor=(label)=>Array.from(q.host.querySelectorAll('.slide-inspector label'))
   .find(el=>el.textContent.includes(label))?.querySelector('input');
 const left=inputFor('Recorte esquerdo (%)');
 assert.ok(left,'crop controls must appear only for selected pictures');
 left.value='25';left.dispatchEvent(new q.w.Event('change'));
 let obj=q.model().surfaces[0].elements[0];
 assert.equal(obj.crop_left,.25);
 assert.equal(q.versions.length,before+1);
 assert.equal(obj.asset_id,originalAsset);
 assert.equal(obj.width,original.width);
 assert.equal(obj.height,original.height);
 const crop=q.scroller.querySelector('.fixed-surface .slide-image-crop');
 const picture=crop.querySelector('img');
 assert.equal(crop.style.overflow,'hidden');
 assert.ok(parseFloat(picture.style.width)>130);
 assert.ok(parseFloat(picture.style.left)<-30,'crop moves original pixels behind viewport');
 const right=inputFor('Recorte direito (%)');
 right.value='90';right.dispatchEvent(new q.w.Event('change'));
 obj=q.model().surfaces[0].elements[0];
 assert.ok(Math.abs(obj.crop_right-.70)<.00001,'opposing crop is capped below 95%');
 assert.ok(obj.crop_left+obj.crop_right<=.95000001);
 assert.equal(q.versions.length,before+2);
 assert.equal(q.scroller.querySelector('.fixed-surface .slide-image-crop img').src,
   'data:image/png;base64,YQ==','original picture data remains intact');
});

test('double-click edits text directly on the slide and Escape cancels',t=>{
 const q=setup(t);clickLabel(q.controls,'Texto');
 const text=q.scroller.querySelector('.slide-object-text');
 assert.equal(text.textContent.includes('Novo texto'),true);
 const before=q.versions.length;
 text.dispatchEvent(new q.w.MouseEvent('dblclick',{bubbles:true,cancelable:true}));
 const input=q.scroller.querySelector('.slide-inline-editor');
 assert.ok(input,'text area is in the canvas, no prompt');
 input.value='Queimadas no Brasil';
 input.dispatchEvent(new q.w.KeyboardEvent('keydown',{bubbles:true,key:'Enter',ctrlKey:true}));
 assert.equal(q.model().surfaces[0].elements[0].text,'Queimadas no Brasil');
 assert.equal(q.versions.length,before+1,'one edit is one undo step');
 const next=q.scroller.querySelector('.slide-object-text');
 next.dispatchEvent(new q.w.MouseEvent('dblclick',{bubbles:true,cancelable:true}));
 const cancel=q.scroller.querySelector('.slide-inline-editor');
 cancel.value='Temporário';
 cancel.dispatchEvent(new q.w.KeyboardEvent('keydown',{bubbles:true,key:'Escape'}));
 assert.equal(q.model().surfaces[0].elements[0].text,'Queimadas no Brasil');
 assert.equal(q.versions.length,before+1);
});

test('shape grips resize on all edges and rotation control commits one change',t=>{
 const q=setup(t);clickLabel(q.controls,'Retângulo');
 const box=q.scroller.querySelector('.fixed-surface');
 box.getBoundingClientRect=()=>({left:10,top:20,width:600,height:300,right:610,bottom:320});
 let node=q.scroller.querySelector('.slide-object-rect');
 assert.equal(node.querySelectorAll('[data-resize]').length,8);
 assert.ok(node.querySelector('[data-rotate]'));
 const before=q.versions.length;
 const handle=node.querySelector('[data-resize="w"]');
 handle.dispatchEvent(new q.w.MouseEvent('pointerdown',
   {bubbles:true,clientX:140,clientY:125,button:0}));
 q.w.dispatchEvent(new q.w.MouseEvent('pointermove',
   {bubbles:true,clientX:80,clientY:125}));
 q.w.dispatchEvent(new q.w.MouseEvent('pointerup',
   {bubbles:true,clientX:80,clientY:125}));
 const shape=q.model().surfaces[0].elements[0];
 assert.ok(Math.abs(shape.x-.10)<.001);
 assert.ok(Math.abs(shape.width-.37)<.001);
 assert.equal(q.versions.length,before+1);
 // The active surface is replaced after a committed resize. Measure its
 // new physical node rather than continuing to use the detached old page.
 q.scroller.querySelector('.fixed-surface').getBoundingClientRect=()=>({left:10,top:20,width:600,height:300,right:610,bottom:320});
 node=q.scroller.querySelector('.slide-object-rect');
 const centerX=10+(shape.x+shape.width/2)*600;
 const centerY=20+(shape.y+shape.height/2)*300;
 const rotate=node.querySelector('[data-rotate]');
 rotate.dispatchEvent(new q.w.MouseEvent('pointerdown',
   {bubbles:true,clientX:centerX,clientY:centerY-45,button:0}));
 q.w.dispatchEvent(new q.w.MouseEvent('pointermove',
   {bubbles:true,clientX:centerX+45,clientY:centerY}));
 q.w.dispatchEvent(new q.w.MouseEvent('pointerup',
   {bubbles:true,clientX:centerX+45,clientY:centerY}));
 assert.equal(q.model().surfaces[0].elements[0].rotation,90);
 assert.equal(q.versions.length,before+2);
 assert.equal(q.scroller.querySelector('.slide-vector-shape rect').getAttribute('width'),'100');
});

test('color bucket paints shapes from ribbon without opening the Inspector',t=>{
 const q=setup(t);
 assert.deepEqual(Array.from(q.controls.querySelectorAll('.slide-ribbon-tab'))
   .filter(tab=>!tab.hidden).map(tab=>tab.textContent),
   ['Slides','Inserir','Formatar','Transições']);
 clickLabel(q.controls,'Retângulo');
 const shape=q.scroller.querySelector('.slide-object-rect');
 const color=q.controls.querySelector('.slide-paint-selector input[type=color]');
 color.value='#ff6600';
 q.controls.querySelector('.slide-ribbon-tab[aria-selected="true"]').textContent;
 Array.from(q.controls.querySelectorAll('.slide-ribbon-tab'))
   .find(b=>b.textContent==='Formatar').click();
 clickLabel(q.controls,'Balde');
 assert.equal(q.editor.paintActive,true);
 shape.dispatchEvent(new q.w.MouseEvent('click',{bubbles:true}));
 assert.equal(q.model().surfaces[0].elements[0].fill,'#ff6600');
 assert.equal(q.scroller.querySelector('.slide-vector-shape rect').getAttribute('fill'),'#ff6600');
 assert.equal(q.editor.paintActive,false,'paint mode should auto-exit after painting');
 clickLabel(q.controls,'Balde');
 assert.equal(q.editor.paintActive,true);
 clickLabel(q.controls,'Balde');
 assert.equal(q.editor.paintActive,false);
});

test('slide transition controls persist per-slide effects and preview without flattening shapes',t=>{
 const q=setup(t);
 clickLabel(q.controls,'Texto');
 const previous=q.versions.length;
 let controls=q.host.querySelectorAll('.slide-inspector select');
 assert.equal(controls.length>=2,true,'transition and speed selectors are visible');
 const effect=Array.from(controls).find(x=>x.getAttribute('aria-label')==='Transição do slide');
 const speed=Array.from(controls).find(x=>x.getAttribute('aria-label')==='Velocidade da transição');
 assert.ok(effect);assert.ok(speed);
 effect.value='wipe-left';effect.dispatchEvent(new q.w.Event('change',{bubbles:true}));
 speed.value='fast';speed.dispatchEvent(new q.w.Event('change',{bubbles:true}));
 assert.equal(q.model().surfaces[0].transition,'wipe-left');
 assert.equal(q.model().surfaces[0].transition_speed,'fast');
 assert.equal(q.versions.length,previous+2);
 const group=Array.from(q.controls.querySelectorAll('.slide-ribbon-tab'))
  .find(b=>b.textContent==='Transições');
 assert.ok(group);group.click();
 const preview=Array.from(q.controls.querySelectorAll('.slide-ribbon-group button'))
  .find(b=>b.textContent==='Prévia');
 assert.ok(preview);preview.click();
 assert.match(q.scroller.querySelector('.fixed-surface').style.animation,/open-doc-transition-wipe-left/);
 assert.equal(q.scroller.querySelectorAll('.slide-object-text').length,1,
   'preview must not flatten or replace editable text');
});


test('native editable chart actions create chart object and SVG without bitmap',t=>{
 const q=setup(t);
 for(const [label,kind] of [
   ['Gráfico: Barras','bar'],['Gráfico: Linhas','line'],['Gráfico: Pizza','pie']
 ]){
   clickLabel(q.controls,label);
   const object=q.model().surfaces[0].elements.slice(-1)[0];
   assert.equal(object.type,'chart');assert.equal(object.chart_type,kind);
   assert.deepEqual(JSON.parse(JSON.stringify(object.chart_categories)),['Categoria A','Categoria B','Categoria C']);
   assert.equal(object.chart_values.length,3);
   const rendered=Array.from(q.scroller.querySelectorAll('.slide-object-chart'))
     .find(n=>n.dataset.slideElement===object.id);
   assert.ok(rendered.querySelector('.slide-chart-preview'));
   assert.equal(rendered.querySelector('canvas, img'),null,'chart uses native vector preview');
   assert.equal(rendered.querySelectorAll('[data-resize]').length,8);
   assert.equal(rendered.querySelector('[data-rotate]'),null,
      'chart rotation is not supported by graphicFrame');
 }
 assert.equal(q.model().surfaces[0].elements.length,3);
});

test('chart data table edits stay linked to native chart object; palettes and undo snapshot',t=>{
 const q=setup(t);clickLabel(q.controls,'Gráfico: Barras');
 const head=q.model().surfaces[0].elements[0];
 assert.equal(head.chart_type,'bar');
 assert.ok(q.host.querySelector('.slide-chart-data'));
 let grid=q.host.querySelector('.slide-chart-grid');
 assert.equal(grid.querySelectorAll('tbody tr').length,3);
 let label=grid.querySelector('tbody tr:first-child textarea');
 label.value='Rondônia';
 const prior=q.versions.length;
 label.dispatchEvent(new q.w.Event('change',{bubbles:true}));
 assert.equal(q.model().surfaces[0].elements[0].chart_categories[0],'Rondônia');
 assert.equal(q.versions.length,prior+1);
 let number=q.host.querySelector('.slide-chart-grid tbody tr:first-child input[type=number]');
 number.value='104';
 number.dispatchEvent(new q.w.Event('change',{bubbles:true}));
 assert.equal(q.model().surfaces[0].elements[0].chart_values[0],104);
 let palette=q.host.querySelector('[aria-label="Paleta do gráfico"]');
 palette.value='green';palette.dispatchEvent(new q.w.Event('change',{bubbles:true}));
 assert.equal(q.model().surfaces[0].elements[0].chart_palette,'green');
 let add=q.host.querySelector('.slide-chart-add-category');
 add.click();
 assert.equal(q.model().surfaces[0].elements[0].chart_categories.length,4);
 assert.equal(q.host.querySelectorAll('.slide-chart-grid tbody tr').length,4);
 let del=q.host.querySelector('.slide-chart-grid tbody tr:last-child button');
 del.click();
 assert.equal(q.model().surfaces[0].elements[0].chart_categories.length,3);
 assert.equal(q.scroller.querySelectorAll('.slide-object-chart').length,1);
});

test('chart validation prevents invalid pie values or wrong number of data cells',t=>{
 const q=setup(t);const C=q.w.OpenDocSlideCharts;
 assert.throws(()=>C.valid('pie',['A','B'],[-1,2]),/pizza/);
 assert.throws(()=>C.valid('pie',['A','B'],[0,0]),/pizza/);
 assert.throws(()=>C.valid('bar',['A'],[1,2]),/24 linhas/);
 assert.throws(()=>C.valid('bar',['A'],[Number.NaN]),/numéricos/);
 assert.doesNotThrow(()=>C.valid('line',['A','B'],[-10,2]));
 clickLabel(q.controls,'Gráfico: Pizza');
 const change=q.host.querySelector('.slide-chart-grid tbody tr:first-child input[type=number]');
 const before=q.versions.length;
 change.value='-2';change.dispatchEvent(new q.w.Event('change',{bubbles:true}));
 assert.equal(q.versions.length,before,'bad values must not mutate presentation');
 assert.equal(q.model().surfaces[0].elements[0].chart_values[0],25);
});

test('double pointer tap edits text in place despite slide DOM replacement',t=>{
 const q=setup(t);
 clickLabel(q.controls,'Texto');
 let obj=q.scroller.querySelector('.slide-object-text');
 obj.dispatchEvent(new q.w.MouseEvent('pointerdown',{bubbles:true,cancelable:true,button:0,clientX:100,clientY:90}));
 q.w.dispatchEvent(new q.w.MouseEvent('pointerup',{bubbles:true,button:0,clientX:100,clientY:90}));
 obj=q.scroller.querySelector('.slide-object-text');
 obj.dispatchEvent(new q.w.MouseEvent('pointerdown',{bubbles:true,cancelable:true,button:0,clientX:100,clientY:90}));
 const input=q.scroller.querySelector('.slide-inline-editor');
 assert.ok(input,'second tap should present editable text on the canvas');
 input.value='Título editado diretamente';
 input.dispatchEvent(new q.w.Event('blur'));
 assert.equal(q.model().surfaces[0].elements[0].text,'Título editado diretamente');
});

test('paint picker has SVG, clears mode after painting, Escape cancels',t=>{
 const q=setup(t);
 clickLabel(q.controls,'Retângulo');
 const picker=q.controls.querySelector('.slide-paint-selector input[type=color]');
 picker.value='#ff8020';
 const bucket=Array.from(q.controls.querySelectorAll('.slide-studio-toolbar button'))
   .find(button=>button.textContent==='Balde');
 assert.ok(bucket.querySelector('svg use[href$="#paint-bucket"]'),'paint control has an SVG');
 bucket.click();
 assert.equal(bucket.getAttribute('aria-pressed'),'true');
 const target=q.scroller.querySelector('.slide-object-rect');
 target.click();
 assert.equal(q.model().surfaces[0].elements[0].fill,'#ff8020');
 assert.equal(bucket.getAttribute('aria-pressed'),'false','paint mode must exit after one edit');
 bucket.click();
 q.root.dispatchEvent(new q.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
 assert.equal(bucket.getAttribute('aria-pressed'),'false','Escape exits paint mode');
});

test('F5 presents slides in a scaled overlay with keyboard navigation and Escape',t=>{
 const q=setup(t);
 clickLabel(q.controls,'Texto');
 clickLabel(q.controls,'+ Slide');
 clickLabel(q.controls,'Retângulo');
 const before=q.versions.length;
 q.root.dispatchEvent(new q.w.KeyboardEvent('keydown',
   {key:'F5',bubbles:true,cancelable:true}));
 const overlay=q.root.querySelector('.slide-presentation');
 assert.ok(overlay,'slide presentation should open on F5');
 assert.equal(overlay.getAttribute('role'),'dialog');
 assert.equal(overlay.getAttribute('aria-modal'),'true');
 assert.equal(overlay.querySelector('output').textContent,'1 / 2');
 overlay.dispatchEvent(new q.w.KeyboardEvent('keydown',
   {key:'ArrowRight',bubbles:true,cancelable:true}));
 assert.equal(overlay.querySelector('output').textContent,'2 / 2');
 assert.ok(overlay.querySelector('.slide-object-rect'),'presentation reuses editable slide source rendering');
 assert.equal(overlay.querySelector('.slide-resize-handle'),null,'authoring handles must be hidden');
 overlay.dispatchEvent(new q.w.KeyboardEvent('keydown',
   {key:'ArrowLeft',bubbles:true,cancelable:true}));
 assert.equal(overlay.querySelector('output').textContent,'1 / 2');
 overlay.dispatchEvent(new q.w.KeyboardEvent('keydown',
   {key:'End',bubbles:true,cancelable:true}));
 assert.equal(overlay.querySelector('output').textContent,'2 / 2');
 overlay.dispatchEvent(new q.w.KeyboardEvent('keydown',
   {key:'Escape',bubbles:true,cancelable:true}));
 assert.equal(q.root.querySelector('.slide-presentation'),null,'Escape closes the slide show');
 assert.equal(q.versions.length,before,'presenting must not modify the deck');
});

test('presentation closes when leaving the slides editor',t=>{
 const q=setup(t);
 clickLabel(q.controls,'Apresentar');
 assert.ok(q.root.querySelector('.slide-presentation'));
 q.editor.deactivate();
 assert.equal(q.root.querySelector('.slide-presentation'),null);
});

test('native fullscreen requests Vela and restores the previous window state',async t=>{
 const q=setup(t);
 const calls=[];
 q.w.Vela={platform:{window:{
   getState:async()=>({fullscreen:false}),
   enterFullscreen:async()=>{calls.push('enter');return {fullscreen:true};},
   exitFullscreen:async()=>{calls.push('exit');return {fullscreen:false};},
   setFullscreen:async value=>{calls.push('set:'+value);return {fullscreen:value};},
   toggleFullscreen:async()=>{calls.push('toggle');return {fullscreen:false};}
 }}};
 q.root.dispatchEvent(new q.w.KeyboardEvent('keydown',{key:'F5',bubbles:true,cancelable:true}));
 await new Promise(resolve=>setTimeout(resolve,1));
 assert.ok(calls.includes('enter'),'F5 delegates real fullscreen to Vela');
 const overlay=q.root.querySelector('.slide-presentation');
 overlay.dispatchEvent(new q.w.KeyboardEvent('keydown',{key:'F11',bubbles:true,cancelable:true}));
 await new Promise(resolve=>setTimeout(resolve,1));
 assert.ok(calls.includes('toggle'),'F11 requests native fullscreen toggle');
 overlay.dispatchEvent(new q.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
 await new Promise(resolve=>setTimeout(resolve,1));
 assert.ok(calls.includes('set:false'),'Escape restores the previous state of the native window');
});

test('slide transition animates the incoming slide and cancels safely on fast navigation',t=>{
 const q=setup(t);
 clickLabel(q.controls,'Texto');
 clickLabel(q.controls,'+ Slide');
 clickLabel(q.controls,'Retângulo');
 q.editor.commands.updateSlide(1,{transition:'push-left',transition_speed:'fast'});
 q.root.dispatchEvent(new q.w.KeyboardEvent('keydown',{key:'F5',bubbles:true}));
 const overlay=q.root.querySelector('.slide-presentation');
 const next=overlay.querySelector('[aria-label^="Próximo slide"]');
 next.click();
 const incoming=overlay.querySelector('.slide-presentation-incoming');
 assert.ok(incoming,'transition creates a distinct incoming slide frame');
 assert.match(incoming.style.transition,/transform/);
 assert.equal(overlay.querySelector('.slide-presentation-stage').children.length,2);
 overlay.querySelector('[aria-label^="Slide anterior"]').click();
 assert.equal(overlay.querySelector('output').textContent,'1 / 2');
 assert.ok(overlay.querySelector('.slide-presentation-stage').children.length<=2,
   'interrupting an effect must not leave duplicate frames');
 q.editor.stopPresentation();
 assert.equal(q.root.querySelector('.slide-presentation'),null);
});

test('Exportar slide is a visible command and delegates selected index to native bridge',t=>{
 const exported=[];
 const q=setup(t,{exportSlide:index=>{exported.push(index);return Promise.resolve();}});
 clickLabel(q.controls,'+ Slide');
 const tab=Array.from(q.controls.querySelectorAll('.slide-ribbon-tab'))
   .find(button=>button.textContent==='Slides');
 tab.click();
 clickLabel(q.controls,'Exportar slide');
 assert.deepEqual(exported,[1]);
 assert.ok(Array.from(q.controls.querySelectorAll('.slide-ribbon-group'))
   .some(group=>!group.hidden&&group.textContent.includes('Exportar slide')));
});

test('presentation does not inherit zoom-scaled object coordinates from authoring canvas',t=>{
 const q=setup(t,{zoom:.75});
 clickLabel(q.controls,'Retângulo');
 const inEditor=q.scroller.querySelector('.slide-object-rect');
 assert.ok(Math.abs(parseFloat(inEditor.style.left)-192)<.01);
 clickLabel(q.controls,'Apresentar');
 const inShow=q.root.querySelector('.slide-presentation .slide-object-rect');
 assert.ok(inShow,'native presentation must contain the shape');
 assert.ok(Math.abs(parseFloat(inShow.style.left)-256)<.01,
   'slide show positions must derive from 960pt model, not 75% editor zoom');
 q.editor.stopPresentation();
});

test('two slide model is navigated with one active page and independent thumbnails',t=>{
 const q=setup(t);
 clickLabel(q.controls,'Texto');
 clickLabel(q.controls,'+ Slide');
 clickLabel(q.controls,'Retângulo');
 assert.equal(q.model().surfaces.length,2);
 assert.equal(q.scroller.querySelectorAll('.fixed-surface').length,1);
 assert.equal(q.scroller.querySelector('.fixed-surface').dataset.pageIndex,'1');
 assert.equal(q.scroller.querySelectorAll('.slide-object-text').length,0);
 assert.equal(q.scroller.querySelectorAll('.slide-object-rect').length,1);
 assert.equal(q.sidebar.querySelectorAll('[data-thumbnail-index]').length,2);
 const first=q.sidebar.querySelector('[data-thumbnail-index="0"]');
 first.click();
 assert.equal(q.scroller.querySelectorAll('.fixed-surface').length,1);
 assert.equal(q.scroller.querySelector('.fixed-surface').dataset.pageIndex,'0');
 assert.equal(q.scroller.querySelectorAll('.slide-object-text').length,1);
 assert.equal(q.scroller.querySelectorAll('.slide-object-rect').length,0);
 assert.equal(q.sidebar.querySelectorAll('[data-thumbnail-index]').length,2);
 assert.equal(first.getAttribute('aria-current'),'true');
 q.sidebar.querySelector('[data-thumbnail-index="1"]').click();
 assert.equal(q.scroller.querySelectorAll('.fixed-surface').length,1);
 assert.equal(q.scroller.querySelector('.fixed-surface').dataset.pageIndex,'1');
 assert.equal(q.scroller.querySelectorAll('.slide-object-rect').length,1);
});

test('workspace centers the one active slide and keeps 4:3 dimensions on navigation',t=>{
 const q=setup(t);
 q.editor.commands.apply(slides=>{
   slides[0].width_pt=720;slides[0].height_pt=540;
 });
 const page=q.scroller.querySelector('.fixed-surface');
 const workspace=q.scroller.querySelector('.slide-active-workspace');
 assert.ok(workspace,'a dedicated slide workspace must exist');
 assert.equal(workspace.children.length,1);
 assert.equal(page.style.width,'960px');
 assert.equal(page.style.height,'720px');
 assert.equal(workspace.style.alignItems,'center');
 assert.equal(workspace.style.justifyContent,'center');
 const preview=q.sidebar.querySelector('.slide-thumb-preview');
 assert.equal(preview.style.aspectRatio,'720/540');
 assert.ok(Math.abs(parseFloat(preview.style.height)/Math.max(100,q.sidebar.clientWidth-38||142)-.75)<.02);
 assert.equal(q.model().surfaces[0].width_pt,720,
   'zoom and visual layout cannot mutate original slide coordinates');
});

test('presenter can navigate to an offscreen slide without creating a second editor canvas',t=>{
 const q=setup(t);
 clickLabel(q.controls,'Texto');
 clickLabel(q.controls,'+ Slide');
 clickLabel(q.controls,'Retângulo');
 q.editor.goTo(0);
 assert.equal(q.scroller.querySelectorAll('.fixed-surface').length,1);
 q.editor.startPresentation(0);
 const overlay=q.root.querySelector('.slide-presentation');
 assert.ok(overlay.querySelector('.slide-object-text'));
 const next=overlay.querySelector('[aria-label^="Próximo slide"]');
 next.click();
 assert.equal(overlay.querySelector('output').textContent,'2 / 2');
 assert.ok(overlay.querySelector('.slide-object-rect'),
   'the offscreen slide should be rendered from the model for presentation');
 assert.equal(q.scroller.querySelectorAll('.fixed-surface').length,1,
   'presenter navigation must not create physical editor pages');
 q.editor.stopPresentation();
});

test('Image color and opacity adjustments affect only the picture and can be reset',t=>{
 const q=setup(t);
 const id=q.editor.commands.insertImage(0,{mime:'image/png',data:'YQ==',name:'Foto'});
 q.editor._selectObject(id);q.editor.render();
 const property=label=>Array.from(q.host.querySelectorAll('.slide-inspector label'))
   .find(element=>element.textContent===label).querySelector('input');
 const change=(label,value)=>{
   const input=property(label);
   if(input.type==='checkbox')input.checked=value;
   else input.value=String(value);
   input.dispatchEvent(new q.w.Event('change'));
 };
 change('Opacidade (%)',40);
 change('Brilho (%)',20);
 change('Contraste (%)',-15);
 change('Preto e branco',true);
 const picture=()=>q.scroller.querySelector('.fixed-surface .slide-image-crop img');
 assert.equal(picture().style.opacity,'0.4');
 assert.equal(picture().style.filter,'brightness(120%) contrast(85%) grayscale(100%)');
 assert.equal(picture().src,'data:image/png;base64,YQ==');
 change('Tom da imagem','#cc0000');
 assert.equal(q.model().surfaces[0].elements[0].image_tint,'#cc0000');
 assert.match(picture().style.filter,/url\(#/);
 const reset=Array.from(q.host.querySelectorAll('.slide-inspector button'))
   .find(button=>button.textContent==='Restaurar ajustes de cor e opacidade');
 assert.ok(reset);reset.click();
 assert.equal(picture().style.opacity,'1');
 assert.equal(picture().style.filter,'');
});

test('Slide typography presets and font family are applied to canvas and inline editor',t=>{
 const q=setup(t);clickLabel(q.controls,'Texto');
 const change=(label,value)=>{
   const field=Array.from(q.host.querySelectorAll('.slide-inspector label'))
     .find(node=>node.firstChild.textContent===label).querySelector('select');
   field.value=value;field.dispatchEvent(new q.w.Event('change'));
 };
 const font=q.host.querySelector('.slide-inspector .slide-font-option[data-family="Times New Roman"]');
 assert.ok(font,'font picker exposes live preview choices');font.click();
 change('Estilo do texto','Título 2');
 const object=q.model().surfaces[0].elements[0];
 assert.equal(object.font_family,'Times New Roman');
 assert.equal(object.font_size_pt,36);
 assert.equal(object.font_bold,true);
 const text=q.scroller.querySelector('.slide-object-text');
 text.dispatchEvent(new q.w.MouseEvent('dblclick',{bubbles:true}));
 const inline=text.querySelector('.slide-inline-editor');
 assert.match(inline.style.fontFamily,/Times New Roman/);
 assert.equal(inline.style.fontWeight,'bold');
});

test('Rapid clicks on a shape without text leave the SVG visible',t=>{
 const q=setup(t);clickLabel(q.controls,'Retângulo');
 const shape=q.scroller.querySelector('.slide-object-rect');
 for(let i=0;i<2;i++)shape.dispatchEvent(new q.w.MouseEvent('pointerdown',
   {bubbles:true,cancelable:true,button:0}));
 assert.ok(shape.querySelector('.slide-vector-shape'));
 assert.equal(q.scroller.querySelector('.slide-inline-editor'),null);
 const id=q.model().surfaces[0].elements[0].id;
 q.editor.commands.updateObject(0,id,{text:'Rótulo'});
 const labeled=q.scroller.querySelector('.slide-object-rect');
 labeled.dispatchEvent(new q.w.MouseEvent('dblclick',{bubbles:true}));
 assert.ok(labeled.querySelector('.slide-vector-shape'));
 assert.equal(labeled.querySelector('.slide-inline-editor').value,'Rótulo');
 assert.equal(labeled.querySelector('.slide-shape-label'),null);
});

test('Hex background and slide eyedropper apply without adding a rectangle',t=>{
 const q=setup(t);
 const label=Array.from(q.host.querySelectorAll('.slide-inspector label'))
   .find(node=>node.textContent==='Cor de fundo (hex)');
 label.querySelector('input').value='#A81710';
 const button=Array.from(q.host.querySelectorAll('.slide-inspector button'))
   .find(node=>node.textContent==='Aplicar fundo');
 button.click();
 assert.equal(q.model().surfaces[0].background,'#A81710');
 assert.equal(q.model().surfaces[0].elements.length,0);
 assert.equal(q.scroller.querySelector('.fixed-surface').style.backgroundColor,'rgb(168, 23, 16)');
 clickLabel(q.controls,'Texto');
 q.host.querySelector('[aria-label="Conta-gotas · Cor do texto"]').click();
 q.scroller.querySelector('.fixed-surface').click();
 assert.equal(q.model().surfaces[0].elements[0].color,'#A81710');
});

test('Text box grows during editing and keeps automatic height across slide views',t=>{
 const q=setup(t,{zoom:.75});
 clickLabel(q.controls,'Texto');
 const box=q.scroller.querySelector('.slide-object-text');
 assert.equal(box.style.height,'auto');
 assert.equal(box.style.minHeight,'102.6px');
 box.dispatchEvent(new q.w.MouseEvent('dblclick',{bubbles:true}));
 const input=box.querySelector('.slide-inline-editor');
 const multiline='Primeira linha\n\nSegunda linha\nTerceira linha';
 input.value=multiline;
 Object.defineProperty(input,'scrollHeight',{value:210});
 input.dispatchEvent(new q.w.Event('input',{bubbles:true}));
 assert.equal(box.style.minHeight,'210px');
 input.dispatchEvent(new q.w.KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true}));
 assert.equal(q.model().surfaces[0].elements[0].text,multiline);
 assert.equal(q.scroller.querySelector('.slide-object-text').style.height,'auto');
 assert.equal(q.sidebar.querySelector('.slide-object-text').style.height,'auto');
 q.editor.startPresentation();
 const presented=q.root.querySelector('.slide-presentation .slide-object-text');
 assert.equal(presented.style.height,'auto');
 assert.equal(presented.style.minHeight,'136.8px');
});

test('Selection shortcuts format text, change layers and scale in one edit',t=>{
 const q=setup(t);
 clickLabel(q.controls,'Texto');clickLabel(q.controls,'Retângulo');
 const text=q.model().surfaces[0].elements[0];
 q.editor.selectSearchResult(0,text.id);
 const bar=q.controls.querySelector('.slide-selection-toolbar');
 const button=label=>Array.from(bar.querySelectorAll('button')).find(node=>node.textContent===label);
 const change=(input,value)=>{
   input.value=value;input.dispatchEvent(new q.w.Event('change',{bubbles:true}));
 };
 assert.equal(bar.hidden,false);
 const font=bar.querySelector('.slide-font-option[data-family="Arial"]');
 assert.ok(font,'Arial present in accessible visual font picker');font.click();
 change(bar.querySelector('input[type=color]'),'#cc1133');
 button('Negrito').click();
 assert.equal(button('Descer camada').disabled,true);
 assert.equal(button('Subir camada').querySelector('use').getAttribute('href'),'#arrow-up');
 button('Subir camada').click();
 assert.equal(q.model().surfaces[0].elements.at(-1).id,text.id);
 button('Descer camada').click();
 const before=q.versions.length;
 const scale=Array.from(bar.querySelectorAll('label')).find(node=>node.textContent==='Escala (%)').querySelector('input');
 scale.value='50';
 button('Aplicar escala').click();
 assert.equal(q.versions.length,before+1);
 const current=q.model().surfaces[0].elements[0];
 assert.equal(current.font_family,'Arial');
 assert.equal(current.color,'#cc1133');
 assert.equal(current.font_bold,true);
 assert.equal(current.font_size_pt,14);
 assert.equal(current.width,text.width/2);
 assert.equal(current.height,text.height/2);
});

test('Apply to all copies transition and speed in one edit and can clear them',t=>{
 const q=setup(t);
 clickLabel(q.controls,'+ Slide');clickLabel(q.controls,'+ Slide');
 q.editor.commands.updateSlide(0,{transition:'fade',transition_speed:'fast'});
 q.editor.commands.updateSlide(1,{transition:'wipe-left',transition_speed:'slow'});
 q.editor.goTo(1);
 const tab=Array.from(q.controls.querySelectorAll('.slide-ribbon-tab'))
   .find(button=>button.textContent==='Transições');
 tab.click();
 const apply=()=>clickLabel(q.controls,'Aplicar a todos os slides');
 const before=q.versions.length;
 apply();
 assert.equal(q.versions.length,before+1);
 assert.ok(q.model().surfaces.every(slide=>slide.transition==='wipe-left'&&slide.transition_speed==='slow'));
 apply();
 assert.equal(q.versions.length,before+1);
 q.editor.commands.updateSlide(1,{transition:'none',transition_speed:'med'});
 apply();
 assert.ok(q.model().surfaces.every(slide=>slide.transition==='none'&&slide.transition_speed==='med'));
});

test('Viewport refit after a double click keeps the inline editor focused and saves the draft',async t=>{
 let refits=0;
 const q=setup(t,{onViewportResize:()=>{refits++;q.editor.render();}});
 clickLabel(q.controls,'Texto');
 const click=type=>q.scroller.querySelector('.slide-object-text').dispatchEvent(
   new q.w.MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:100,clientY:90}));
 click('pointerdown');click('pointerup');click('click');
 click('pointerdown');click('pointerup');click('click');click('dblclick');
 const input=q.scroller.querySelector('.slide-inline-editor');
 assert.ok(input);
 assert.equal(q.w.document.activeElement,input);
 input.value='A Economia Política do Brasil';
 input.dispatchEvent(new q.w.Event('input',{bubbles:true}));
 q.w.dispatchEvent(new q.w.Event('resize'));
 await new Promise(resolve=>setTimeout(resolve,35));
 assert.equal(q.scroller.querySelector('.slide-inline-editor'),input);
 assert.equal(q.w.document.activeElement,input);
 input.dispatchEvent(new q.w.KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true}));
 assert.equal(q.model().surfaces[0].elements[0].text,'A Economia Política do Brasil');
 await new Promise(resolve=>setTimeout(resolve,35));
 assert.equal(refits,1);
 click('dblclick');
 assert.equal(q.w.document.activeElement,q.scroller.querySelector('.slide-inline-editor'));
});

test('PowerPoint ribbon groups every SVG action and keeps new shapes on Insert',t=>{
 const q=setup(t);
 const tabs=Array.from(q.controls.querySelectorAll('.slide-ribbon-tab'));
 assert.deepEqual(tabs.filter(x=>!x.hidden).map(x=>x.textContent),
   ['Slides','Inserir','Formatar','Transições']);
 const toolbar=q.controls.querySelector('.slide-studio-toolbar');
 assert.equal(toolbar.querySelectorAll(':scope > button').length,0,
   'Unclassified ribbon buttons expand vertically and hide the slide');
 const insert=Array.from(toolbar.querySelectorAll('.slide-ribbon-group'))
   .find(group=>group.getAttribute('aria-label')==='Ferramentas de Inserir');
 assert.ok(insert);
 const labels=['Tabela','Chevron','Hexágono','Pentágono','Paralelogramo','Estrela','Nuvem'];
 for(const label of labels){
  const b=Array.from(insert.querySelectorAll('button')).find(x=>x.textContent===label);
  assert.ok(b,'Missing Insert action '+label);
  const use=b.querySelector('svg use');
  assert.ok(use,'Missing SVG icon for '+label);
  assert.ok(use.getAttribute('href')?.includes('#shape-')||label==='Tabela'&&use.getAttribute('href')?.endsWith('#table'),
    'Unexpected SVG icon on '+label);
 }
 assert.equal(insert.hidden,false);
 clickLabel(q.controls,'Tabela');
 clickLabel(q.controls,'Estrela');
 assert.equal(q.scroller.querySelectorAll('.slide-native-table').length,1);
 assert.equal(q.scroller.querySelectorAll('.slide-object-star svg').length,1);
});

test('Qt slide CSS keeps toolbar one row and shapes hit-testable',t=>{
 const source=fs.readFileSync(path.join(__dirname,'../apps/open_doc/styles/slide_editor.css'),'utf8');
 assert.match(source,/\.fixed-surface > \.slide-object\s*\{\s*pointer-events:auto/);
 assert.match(source,/\.slide-ribbon-group\s*\{[\s\S]*?flex-flow:row wrap/);
 assert.match(source,/\.slide-ribbon-body\s*\{[\s\S]*?height:110px/);
 assert.match(source,/\.slide-ribbon-popup\s*\{/);
});

test('arrow keys navigate only when a slide thumbnail in the left sidebar is focused',t=>{
 const q=setup(t);
 clickLabel(q.controls,'+ Slide');
 clickLabel(q.controls,'+ Slide');
 q.editor.goTo(1);
 const thumb=q.sidebar.querySelector('[data-thumbnail-index="1"]');
 thumb.focus();
 assert.equal(q.w.document.activeElement,thumb);
 const press=(target,key)=>target.dispatchEvent(new q.w.KeyboardEvent('keydown',
  {key,bubbles:true,cancelable:true}));
 press(thumb,'ArrowDown');
 assert.equal(q.editor.current,2);
 assert.equal(q.w.document.activeElement.dataset.thumbnailIndex,'2');
 press(q.w.document.activeElement,'ArrowRight');
 assert.equal(q.editor.current,2,'last slide must clamp');
 press(q.w.document.activeElement,'ArrowUp');
 assert.equal(q.editor.current,1);
 press(q.w.document.activeElement,'ArrowLeft');
 assert.equal(q.editor.current,0);
 press(q.w.document.activeElement,'ArrowLeft');
 assert.equal(q.editor.current,0,'first slide must clamp');
 // Other UI contexts must NEVER switch slides on arrow keys.
 const canvas=q.scroller.querySelector('.fixed-surface');
 press(canvas,'ArrowRight');
 assert.equal(q.editor.current,0,'canvas arrows do not navigate slides');
 const other=q.controls.querySelector('.slide-ribbon-tab');
 press(other,'ArrowDown');
 assert.equal(q.editor.current,0,'toolbar arrows do not navigate slides');
 clickLabel(q.controls,'Texto');
 const object=q.model().surfaces[0].elements[0];
 q.editor.selectSearchResult(0,object.id);
 const initialX=q.model().surfaces[0].elements[0].x;
 // selectSearchResult rebuilds the physical canvas; dispatch against the
 // current attached node, never the stale original reference.
 press(q.scroller.querySelector('.fixed-surface'),'ArrowRight');
 assert.equal(q.editor.current,0,'selected shape arrow must not change slide');
 assert.ok(q.model().surfaces[0].elements[0].x>initialX,
   'canvas arrows must still move the selected object');
});

test('smart alignment guides find slide center and nearby object edges at any zoom',t=>{
 const q=setup(t);
 const snap=q.w.OpenDocSlidesEditor.smartSnap;
 const nearCenter={x:.493,y:.492,width:.20,height:.15};
 const centered=snap(nearCenter,[],1000,600,9);
 // The leading edge is near center; snap it exactly, not the rectangle center.
 assert.equal(centered.item.x,.5);
 assert.equal(centered.item.y,.5);
 assert.ok(centered.guides.some(g=>g.axis==='x'&&g.value===.5));
 const aligned=snap({x:.305,y:.51,width:.2,height:.15},
  [{x:.3,y:.1,width:.2,height:.12}],1000,600,8);
 assert.equal(aligned.item.x,.3);
 const outside=snap({x:.35,y:.38,width:.2,height:.15},[],1000,600,7);
 assert.equal(outside.guides.length,0);
});

test('native mathematical object supports inspector edits and proportional scale handle',t=>{
 const q=setup(t);
 const formula={label:'Integral definida',math_blocks:[
   {kind:'nary',operator:'∫',lower:'0',upper:'π',body:'sen(x) dx'},
   {kind:'text',value:' = 2'}
 ]};
 const id=q.editor.commands.insertMath(0,formula);
 q.editor._selectObject(id);q.editor.render();
 const obj=q.model().surfaces[0].elements[0];
 assert.equal(obj.type,'math');
 assert.equal(obj.math_blocks[0].operator,'∫');
 assert.equal(q.scroller.querySelectorAll('.slide-native-equation').length,1);
 assert.ok(q.scroller.querySelector('.slide-scale-handle[data-scale]'));
 assert.ok(!q.model().assets || Object.keys(q.model().assets).length===0,
   'native equation must not insert a bitmap asset');
 const input=Array.from(q.host.querySelectorAll('.slide-math-properties label'))
   .find(n=>n.textContent.startsWith('Integrando'));
 assert.ok(input);
 input.querySelector('input').value='cos(x) dx';
 input.querySelector('input').dispatchEvent(new q.w.Event('change'));
 assert.equal(q.model().surfaces[0].elements[0].math_blocks[0].body,'cos(x) dx');
 q.editor._selectObject(id);q.editor.render();
 const surface=q.scroller.querySelector('.fixed-surface');
 surface.getBoundingClientRect=()=>({left:0,top:0,width:800,height:450,right:800,bottom:450});
 const grip=q.scroller.querySelector('.slide-scale-handle');
 grip.dispatchEvent(new q.w.MouseEvent('pointerdown',
   {button:0,bubbles:true,clientX:200,clientY:120}));
 q.w.dispatchEvent(new q.w.MouseEvent('pointermove',
   {bubbles:true,clientX:240,clientY:140}));
 q.w.dispatchEvent(new q.w.MouseEvent('pointerup',
   {bubbles:true,clientX:240,clientY:140}));
 const next=q.model().surfaces[0].elements[0];
 assert.ok(next.width>obj.width && next.height>obj.height);
 assert.ok(Math.abs(next.width/next.height-obj.width/obj.height)<1e-8);
 assert.ok(next.font_size_pt>obj.font_size_pt);
});

test('unchanged thumbnails keep their DOM identity on object edits',t=>{
 const q=setup(t);
 clickLabel(q.controls,'+ Slide');
 const a=q.sidebar.querySelector('[data-thumbnail-index="0"] .slide-thumb-preview');
 const b=q.sidebar.querySelector('[data-thumbnail-index="1"] .slide-thumb-preview');
 clickLabel(q.controls,'Retângulo');
 assert.equal(q.sidebar.querySelector('[data-thumbnail-index="0"] .slide-thumb-preview'),a);
 assert.notEqual(q.sidebar.querySelector('[data-thumbnail-index="1"] .slide-thumb-preview'),b);
});

test('imported external PPTX rejects unsafe slide-level structural changes before model mutation',t=>{
 const q=setup(t);
 q.model().preserve_source=true;
 const before=JSON.stringify(q.model());
 const commands=q.editor.commands;
 for(const action of [
   ()=>commands.insert(0),()=>commands.duplicate(0),
   ()=>commands.remove(0),()=>commands.move(0,1)
 ])assert.throws(action,/apresentações externas/);
 assert.equal(JSON.stringify(q.model()),before);
});

test('new native equations adapt their initial ink color to dark/light slide backgrounds',t=>{
 const q=setup(t);
 const slide=q.model().surfaces[0],formula={label:'Fração',math_blocks:[
   {kind:'fraction',numerator:'x²+1',denominator:'x+1'}
 ]};
 slide.background='#102437';
 const id=q.editor.commands.insertMath(0,formula);
 let obj=slide.elements.find(o=>o.id===id);
 obj=q.model().surfaces[0].elements.find(o=>o.id===id);
 assert.equal(obj.color,'#F8FAFC');
 assert.equal(obj.font_size_pt,42);
 q.model().surfaces[0].background='#FFFFFF';
 const other=q.editor.commands.insertMath(0,formula);
 const light=q.model().surfaces[0].elements.find(o=>o.id===other);
 assert.equal(light.color,'#192433');
});

test('imported multi-run PPTX edits one segment without flattening styled text',t=>{
 const q=setup(t,{zoom:.5});
 clickLabel(q.controls,'Texto');
 const before=q.model().surfaces[0].elements[0];
 const original={...before,text:'Título vermelho e subtítulo azul',text_runs:[[
  {text:'Título vermelho ',font_family:'Arial',font_size_pt:30,
   font_bold:true,font_italic:false,color:'#BB2222'},
  {text:'e subtítulo azul',font_family:'Georgia',font_size_pt:22,
   font_bold:false,font_italic:true,color:'#2266BB'}
 ]]};
 q.editor.commands.updateObject(0,before.id,{...original,
  source_original:JSON.parse(JSON.stringify(original))});
 q.editor._selectObject(before.id);q.editor.render();
 let spans=Array.from(q.scroller.querySelectorAll('.slide-styled-paragraph span'));
 assert.equal(spans.length,2);
 assert.equal(spans[0].style.fontWeight,'700');
 assert.equal(spans[1].style.fontStyle,'italic');
 assert.equal(spans[1].style.color,'rgb(34, 102, 187)');
 const thumbnail=q.sidebar.querySelector('.slide-styled-paragraph span');
 const scale=(span)=>parseFloat(span.style.fontSize)*parseFloat(span.closest('.slide-object').style.fontSize);
 assert.equal(spans[0].style.fontSize.endsWith('em'),true);
 assert.ok(Math.abs(scale(spans[0])-20)<.001,'30pt run at 50% must render at 20px');
 assert.ok(Math.abs(scale(thumbnail)-6.4)<.001,'the same run must scale to the thumbnail');

 const field=Array.from(q.host.querySelectorAll('.slide-inspector label'))
  .find(x=>x.textContent.startsWith('Parágrafo 1 · Trecho 1'));
 assert.ok(field,'formatted runs must be individually editable');
 const input=field.querySelector('input');
 input.value='Texto atualizado ';
 input.dispatchEvent(new q.w.Event('change'));
 const edited=q.model().surfaces[0].elements[0];
 assert.equal(edited.text,'Texto atualizado e subtítulo azul');
 assert.equal(edited.text_runs[0][0].text,'Texto atualizado ');
 assert.equal(edited.text_runs[0][1].text,'e subtítulo azul');
 assert.equal(edited.text_runs[0][1].color,'#2266BB');
 assert.equal(edited.text_runs[0][1].font_italic,true);
});

test('stress: editing a single object in a 120-slide deck keeps other slides immutable',t=>{
 const q=setup(t);
 const first=q.model().surfaces[0];
 for(let index=1;index<120;index++){
   const slide={index,width_pt:960,height_pt:540,background:'#FFFFFF',
     notes:'',strokes:[],text_overlays:[],elements:[{
       id:'obj-'+index,type:'text',x:.1,y:.1,width:.4,height:.2,
       text:'Página '+index,font_family:'Inter',font_size_pt:28,
       color:'#191C1E',fill:'#FFFFFF',stroke:'#004AC6'
     }]};
   q.model().surfaces.push(slide);
 }
 q.model().assets={sample:{mime:'image/png',data:'AA'.repeat(150000)}};
 const before=q.model().surfaces.slice();
 const asset=q.model().assets.sample;
 const commits=q.versions.length;
 q.editor.commands.insertObject(0,'text');
 const after=q.model().surfaces;
 assert.notEqual(after[0],first,'active slide must be copied');
 for(let index=1;index<120;index++)
   assert.equal(after[index],before[index],
     'untouched slide '+index+' should not be serialized or copied');
 assert.equal(q.model().assets.sample,asset,'assets must be shared, not copied');
 assert.equal(q.versions.length,commits+1,'one user operation is one history update');
 assert.equal(after[0].elements.length,1);
 assert.equal(after[1].elements[0].text,'Página 1');
});

test('two inserted equations avoid each other and nested math receives suitable size',t=>{
 const q=setup(t),first=q.editor.commands.insertMath(0,{
   label:'Integral',math_blocks:[{kind:'nary',operator:'∫',lower:'0',
     upper:'1',body:'x dx'}]
 });
 const second=q.editor.commands.insertMath(0,{label:'Fração aninhada',math_blocks:[
   {kind:'fraction',numerator:[{kind:'sqrt',radicand:[
     {kind:'superscript',base:'x',power:'2'}
   ]}],denominator:[{kind:'nary',operator:'∑',lower:'1',upper:'n',body:'k'}]}
 ]});
 const items=q.model().surfaces[0].elements;
 assert.equal(items.length,2);
 const a=items.find(x=>x.id===first),b=items.find(x=>x.id===second);
 assert.ok(b.y>=a.y+a.height-.01 || b.y+b.height<=a.y+.01 ||
   b.x>=a.x+a.width-.01 || b.x+b.width<=a.x+.01,
   'new native formula should not significantly overlap the existing object');
 assert.equal(b.font_size_pt,34);
 assert.ok(b.y+b.height<=1.00001);
});


test('Delete on a focused thumbnail removes its slide, not an object',t=>{
 const q=setup(t);clickLabel(q.controls,'+ Slide');
 clickLabel(q.controls,'+ Slide');
 assert.equal(q.model().surfaces.length,3);
 const thumb=q.sidebar.querySelector('[data-thumbnail-index="1"]');
 thumb.focus();
 thumb.dispatchEvent(new q.w.KeyboardEvent('keydown',{
   key:'Delete',bubbles:true,cancelable:true
 }));
 assert.equal(q.model().surfaces.length,2);
 assert.equal(q.model().surfaces[1].index,1);
 assert.equal(q.w.document.activeElement.dataset.thumbnailIndex,'1');
 q.sidebar.querySelector('[data-thumbnail-index="0"]').focus();
 q.w.document.activeElement.dispatchEvent(new q.w.KeyboardEvent('keydown',{
   key:'Backspace',bubbles:true,cancelable:true
 }));
 assert.equal(q.model().surfaces.length,1);
 q.sidebar.querySelector('[data-thumbnail-index="0"]').dispatchEvent(
   new q.w.KeyboardEvent('keydown',{key:'Delete',bubbles:true,cancelable:true})
 );
 assert.equal(q.model().surfaces.length,1,'last slide is protected');
});

test('Ctrl+B and Ctrl+I toggle native text styles even during inline editing',t=>{
 const q=setup(t);clickLabel(q.controls,'Texto');
 const style=()=>q.model().surfaces[0].elements[0];
 const press=(target,key)=>target.dispatchEvent(new q.w.KeyboardEvent('keydown',{
   key,ctrlKey:true,bubbles:true,cancelable:true
 }));
 press(q.scroller.querySelector('.fixed-surface'),'b');
 assert.equal(style().font_bold,true);
 press(q.scroller.querySelector('.fixed-surface'),'i');
 assert.equal(style().font_italic,true);
 const text=q.scroller.querySelector('.slide-object-text');
 text.dispatchEvent(new q.w.MouseEvent('dblclick',{bubbles:true}));
 const editor=q.scroller.querySelector('.slide-inline-editor');
 assert.ok(editor);
 editor.value='Novo título';
 press(editor,'b');
 assert.equal(editor.style.fontWeight,'normal','inline toggle previews immediately');
 press(editor,'i');
 assert.equal(editor.style.fontStyle,'normal');
 editor.dispatchEvent(new q.w.KeyboardEvent('keydown',{
   key:'Enter',ctrlKey:true,bubbles:true,cancelable:true
 }));
 assert.equal(style().text,'Novo título');
 assert.equal(style().font_bold,false);
 assert.equal(style().font_italic,false);
});

test('fixed PowerPoint ribbon provides contextual text formatting and font previews',t=>{
 const q=setup(t);clickLabel(q.controls,'Texto');
 assert.ok(q.controls.querySelector('.slide-context-tab:not([hidden])'));
 assert.equal(q.editor._ribbonActive,'context');
 assert.ok(q.controls.querySelector('.slide-ribbon-body .slide-selection-toolbar'),
   'context toolbar is inside the fixed ribbon, not below it');
 const picker=q.controls.querySelector('.slide-context-panel .slide-font-picker');
 assert.ok(picker);
 assert.match(picker.querySelector('.slide-font-preview-name').style.fontFamily,/Inter/);
 const other=picker.querySelector('[data-family="Bitstream Charter"]');
 assert.ok(other);assert.match(other.querySelector('.slide-font-sample').style.fontFamily,/Bitstream Charter/);
 other.click();
 assert.equal(q.model().surfaces[0].elements[0].font_family,'Bitstream Charter');
 const button=label=>Array.from(q.controls.querySelectorAll('.slide-context-panel button'))
   .find(b=>b.textContent===label);
 button('Centralizar').click();
 button('Marcadores').click();
 button('Aumentar recuo').click();
 button('Sublinhado').click();
 const value=q.model().surfaces[0].elements[0];
 assert.equal(value.paragraph_alignment,'center');
 assert.equal(value.list_style,'bullet');
 assert.equal(value.text_indent_pt,12);
 assert.equal(value.font_underline,true);
 const tab=Array.from(q.controls.querySelectorAll('.slide-ribbon-tab'))
   .find(b=>b.textContent==='Inserir');
 tab.click();
 assert.equal(q.editor._ribbonActive,'Inserir');
 assert.equal(q.controls.querySelector('.slide-context-panel').hidden,true);
 assert.equal(q.controls.querySelector('.slide-ribbon-body').children.length,5);
});


test('PPTX chart PIB uses complete economic categories and calculated percentages',t=>{
 const q=setup(t);const charts=q.w.OpenDocSlideCharts;
 const economic=[
  'Remuneração dos empregados',
  'Excedente operacional bruto e rendimento misto bruto',
  'Impostos líquidos de subsídios'
 ];
 const source={chart_type:'bar',chart_title:'Distribuição do PIB pela ótica da renda — Brasil, 2021',
   chart_categories:economic,chart_values:[39.2,45.3,15.5],
   chart_background:'transparent',chart_data_labels:'both',
   chart_label_font_size:13,chart_label_wrap:true};
 charts.valid(source.chart_type,source.chart_categories,source.chart_values);
 const large=charts.ChartPreview.render(source,{width:850,height:480});
 const small=charts.ChartPreview.render(source,{width:420,height:240});
 assert.equal(large.dataset.background,'transparent');
 assert.equal(large.querySelector('rect[fill="#FFFFFF"]'),null,
   'transparent charts may not paint an opaque white rectangle');
 for(const svg of [large,small]){
  const text=Array.from(svg.querySelectorAll('text')).map(n=>n.textContent).join('|');
  for(const title of economic){
   const candidate=Array.from(svg.querySelectorAll('text')).find(n=>
     Array.from(n.querySelectorAll('tspan')).map(t=>t.textContent).join(' ').replace(/\s+/g,' ').trim()===title);
   assert.ok(candidate,'full category text is preserved: '+title);
  }
  assert.match(text,/39,2/);assert.match(text,/45,3/);
  assert.match(text,/15,5/);
  assert.match(text,/39,2%/);assert.match(text,/45,3%/);
  assert.match(text,/15,5%/);
 }
 const lines=charts.ChartLayoutEngine.lines(economic[1],155,charts.ChartLayoutEngine.font(source));
 assert.ok(lines.length>1,'long text wraps to multiple lines');
 assert.equal(lines.join(' ').replace(/\s+/g,' ').trim(),economic[1],
   'a text wrap must preserve all characters, spaces, and punctuation');
});

test('Chart style controls update transparent background, percentages, item colors, tracking and history',t=>{
 const q=setup(t);clickLabel(q.controls,'Gráfico: Barras');
 const control=(label)=>q.host.querySelector('[aria-label="'+label+'"]');
 const changed=(input,value)=>{
  if(input.type==='checkbox')input.checked=value;
  else input.value=value;
  input.dispatchEvent(new q.w.Event('change',{bubbles:true}));
 };
 changed(control('Fundo do gráfico'),'transparent');
 changed(control('Rótulos de valores'),'both');
 changed(control('Espaçamento entre letras (pt)'),'.7');
 changed(control('Rotação dos rótulos'),'45');
 changed(control('Cor da categoria 2'),'#ff6600');
 const chart=q.model().surfaces[0].elements[0];
 assert.equal(chart.chart_background,'transparent');
 assert.equal(chart.chart_data_labels,'both');
 assert.equal(chart.chart_label_letter_spacing,.7);
 assert.equal(chart.chart_label_rotation,45);
 assert.equal(chart.chart_color_mode,'custom');
 assert.equal(chart.chart_item_colors[1],'#FF6600');
 assert.equal(q.scroller.querySelector('.slide-chart-preview').dataset.background,'transparent');
 assert.ok(q.versions.length>=6,'style changes use persistent command history');
});

test('PPTX text letter spacing persists on object and renders on canvas',t=>{
 const q=setup(t);clickLabel(q.controls,'Texto');
 const id=q.model().surfaces[0].elements[0].id;
 const input=q.controls.querySelector('.slide-selection-toolbar label input[type=number][step="0.1"]');
 assert.ok(input,'context text ribbon has character spacing in points');
 input.value='1.5';
 input.dispatchEvent(new q.w.Event('change',{bubbles:true}));
 assert.equal(q.model().surfaces[0].elements[0].font_letter_spacing_pt,1.5);
 const text=q.scroller.querySelector('.slide-object-text');
 assert.ok(parseFloat(text.style.letterSpacing)>0);
 assert.equal(q.model().surfaces[0].elements[0].id,id);
});


test('Adaptive chart labels survive ten categories, manual breaks, resize and multiple series',t=>{
 const q=setup(t),engine=q.w.OpenDocSlideCharts;
 const cats=Array.from({length:12},(_,i)=>
   i===6?'Excedente operacional bruto\nrendimento misto bruto':
   'Categoria econômica '+(i+1)+' com denominação completa');
 const series=[
   {name:'Período inicial',values:cats.map((_,i)=>i+2)},
   {name:'Período seguinte',values:cats.map((_,i)=>(i+3)*2)}
 ];
 const source={chart_type:'bar',chart_categories:cats,chart_values:series[0].values,
   chart_series:series,chart_title:'Comparação temporal',chart_label_font_size:11,
   chart_label_wrap:true,chart_color_mode:'palette'};
 const small=engine.ChartPreview.render(source,{width:420,height:270});
 const big=engine.ChartPreview.render(source,{width:880,height:480});
 assert.notEqual(small.getAttribute('viewBox'),big.getAttribute('viewBox'));
 for(const svg of [small,big]){
   const texts=Array.from(svg.querySelectorAll('text'));
   for(const category of cats){
     const expected=category.replace(/\s+/g,'');
     const matching=texts.find(text=>{
       const title=text.querySelector('title')?.textContent;
       const drawn=Array.from(text.querySelectorAll('tspan'))
         .map(tspan=>tspan.textContent).join('');
       return title===category&&drawn.replace(/\s+/g,'')===expected;
     });
     assert.ok(matching,'Every character must remain visible: '+category);
   }
   assert.equal(svg.querySelector('canvas,img'),null,'chart remains vector');
 }
 clickLabel(q.controls,'Gráfico: Barras');
 const add=q.host.querySelector('.slide-chart-add-series');
 assert.ok(add);add.click();
 assert.equal(q.model().surfaces[0].elements[0].chart_series.length,2);
 let category=q.host.querySelector('.slide-chart-grid tbody tr:first-child textarea');
 category.value='Categoria extensa com\nquebra manual';
 category.dispatchEvent(new q.w.Event('change',{bubbles:true}));
 const value=q.host.querySelector('[aria-label="Série 2 — categoria 1"]');
 assert.ok(value);value.value='72';
 value.dispatchEvent(new q.w.Event('change',{bubbles:true}));
 const chart=q.model().surfaces[0].elements[0];
 assert.equal(chart.chart_series[1].values[0],72);
 assert.equal(chart.chart_categories[0],'Categoria extensa com\nquebra manual');
 assert.equal(chart.chart_series[0].values.length,3);
 assert.equal(chart.chart_series[1].values.length,3);
});


test('PPTX bullet list can be applied, edited and removed without overlaying old text',t=>{
 const q=setup(t);clickLabel(q.controls,'Texto');
 const raw='A economia estuda produção, circulação,\ndistribuição e consumo.\n\nA economia política investiga as relações\nsociais que organizam esses processos.';
 const id=q.model().surfaces[0].elements[0].id;
 q.editor.commands.updateObject(0,id,{text:raw});
 const action=name=>{
   const b=Array.from(q.controls.querySelectorAll('.slide-context-panel button'))
     .find(btn=>btn.textContent===name);
   assert.ok(b,'Context action exists: '+name);
   b.click();
 };
 action('Marcadores');
 assert.equal(q.model().surfaces[0].elements[0].list_style,'bullet');
 let rendered=q.scroller.querySelector('.slide-object-text');
 assert.equal(rendered.querySelectorAll('.slide-text-paragraph').length,5);
 assert.equal(rendered.querySelectorAll('.slide-text-marker').length,4,
   'Empty paragraphs are preserved but must not produce orphan bullets');
 assert.equal(q.model().surfaces[0].elements[0].text,raw,
   'Bullet glyphs must not alter the underlying document text');
 rendered.dispatchEvent(new q.w.MouseEvent('dblclick',{bubbles:true}));
 const editor=q.scroller.querySelector('.slide-inline-editor');
 assert.ok(editor);
 assert.equal(rendered.querySelector('.slide-text-content').style.display,'none',
   'Decorated old paragraphs may not paint underneath textarea');
 editor.value=raw.replace('consumo.','consumo e produção.');
 editor.dispatchEvent(new q.w.KeyboardEvent('keydown',{
   key:'Enter',ctrlKey:true,bubbles:true,cancelable:true
 }));
 assert.equal(q.scroller.querySelectorAll('.slide-inline-editor').length,0);
 assert.equal(q.model().surfaces[0].elements[0].text.includes('produção.'),true);
 assert.equal(q.model().surfaces[0].elements[0].text.includes('•'),false);
 action('Marcadores');
 rendered=q.scroller.querySelector('.slide-object-text');
 assert.equal(rendered.querySelectorAll('.slide-text-marker').length,0);
 assert.equal(rendered.querySelectorAll('.slide-text-content').length,1);
 assert.equal(q.model().surfaces[0].elements[0].list_style,'none');
 assert.ok(q.versions.length>=4,'Each change goes through undoable model commands');
});

test('PPTX import text runs do not overlap list decorations or stale edited contents',t=>{
 const q=setup(t);clickLabel(q.controls,'Texto');
 const id=q.model().surfaces[0].elements[0].id;
 const rows=[['A economia estuda a produção,',' distribuição e consumo.'],
             ['O Estado organiza relações',' econômicas e sociais.']];
 const runs=rows.map(row=>row.map(text=>({
   text,font_family:'Liberation Serif',font_size_pt:28,font_bold:true,
   font_italic:false,color:'#FFFFFF'
 })));
 const source=rows.map(row=>row.join('')).join('\n');
 q.editor.commands.updateObject(0,id,{text:source,text_runs:runs,list_style:'bullet'});
 let node=q.scroller.querySelector('.slide-object-text');
 assert.equal(node.querySelectorAll('.slide-text-paragraph').length,2);
 assert.equal(node.querySelectorAll('.slide-text-list-body span').length,4);
 assert.equal(node.querySelectorAll('.slide-text-marker').length,2);
 node.dispatchEvent(new q.w.MouseEvent('dblclick',{bubbles:true}));
 assert.equal(node.querySelector('.slide-text-content').style.display,'none');
 const edit=q.scroller.querySelector('.slide-inline-editor');
 assert.ok(edit);
 edit.value='Texto substituído sem restos visuais';
 edit.dispatchEvent(new q.w.KeyboardEvent('keydown',{
   key:'Enter',ctrlKey:true,bubbles:true,cancelable:true
 }));
 node=q.scroller.querySelector('.slide-object-text');
 assert.equal(node.querySelectorAll('.slide-text-paragraph').length,1,
   'Stale imported runs cannot reappear over the newly saved text');
 assert.equal(node.querySelector('.slide-text-list-body').textContent,
   'Texto substituído sem restos visuais');
 assert.equal(q.model().surfaces[0].elements[0].text,edit.value);
});

test('Numbered lists skip blank paragraphs and clearing the list preserves all text',t=>{
 const q=setup(t);clickLabel(q.controls,'Texto');
 const id=q.model().surfaces[0].elements[0].id;
 q.editor.commands.updateObject(0,id,{text:'Primeiro\n\nSegundo'});
 const number=()=>Array.from(q.controls.querySelectorAll('.slide-context-panel button'))
   .find(x=>x.textContent==='Numeração').click();
 number();
 assert.deepEqual(
  Array.from(q.scroller.querySelectorAll('.slide-text-marker'),m=>m.textContent),
  ['1.','2.']);
 number();
 assert.equal(q.scroller.querySelectorAll('.slide-text-marker').length,0);
 assert.equal(q.model().surfaces[0].elements[0].text,'Primeiro\n\nSegundo');
});

test('Long chart labels preserve spaces and manual line breaks before and after wrapping',t=>{
 const q=setup(t),engine=q.w.OpenDocSlideCharts.ChartLayoutEngine;
 const font=engine.font({chart_label_font_size:15,chart_label_wrap:true});
 const input='Excedente operacional bruto e rendimento misto bruto';
 for(const width of [12,28,48,92,260]){
  const lines=engine.lines(input,width,font);
  assert.equal(lines.join(''),input,
    'Reflow at '+width+' pixels must not remove even whitespace');
 }
 const manual='Remuneração dos empregados\nExcedente operacional bruto';
 const lines=engine.lines(manual,55,font);
 assert.equal(lines.join('').replace(/\s+/g,''),
   manual.replace(/\s+/g,''));
});
