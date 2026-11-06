const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');

const script=fs.readFileSync(path.join(__dirname,'../apps/open_doc/static/js/semantic_annotations.js'),'utf8');

test('PDF text selection records line-precise PDF coordinates and comments',async t=>{
  const dom=new JSDOM('<div id="root"><section id="host"><aside id="side"></aside><div id="scroll"><div class="fixed-surface" data-page-index="0"><div class="textLayer"><span>Texto selecionavel</span></div></div></div></section></div>',{runScripts:'outside-only'});
  const w=dom.window;t.after(()=>w.close());
  w.eval(script);
  w.OpenDocModel={id:()=> 'semantic-1'};
  const root=w.document.querySelector('#root'),host=w.document.querySelector('#host'),scroller=w.document.querySelector('#scroll'),sidebar=w.document.querySelector('#side'),surface=w.document.querySelector('.fixed-surface');
  root.dataset.sourceKind='pdf';
  const page={getViewport:()=>({
    width:400,height:500,
    convertToPdfPoint:(x,y)=>[x,500-y],
    convertToViewportPoint:(x,y)=>[x,500-y],
  })};
  surface.getBoundingClientRect=()=>({left:0,top:0,right:400,bottom:500,width:400,height:500});
  let model={annotations:[]},changes=0;
  const selection={
    isCollapsed:false,rangeCount:1,
    toString:()=> 'Texto selecionavel',removeAllRanges:()=>{},
    getRangeAt:()=>({
      startContainer:surface.querySelector('span').firstChild,
      endContainer:surface.querySelector('span').firstChild,
      getClientRects:()=>[{left:10,top:20,right:110,bottom:40,width:100,height:20}],
      getBoundingClientRect:()=>({left:10,top:20,right:110,bottom:40})
    }),
  };
  w.getSelection=()=>selection;
  const controller=new w.AbortController();
  t.after(()=>controller.abort());
  const reader=w.OpenDocSemanticAnnotations.create({
    root,host,scroller,sidebar,signal:controller.signal,
    getModel:()=>model,getPage:()=>page,getZoom:()=>1,
    update:next=>{model={annotations:next};changes++;},
    go:()=>{},status:()=>{}
  });
  reader.reset();
  scroller.dispatchEvent(new w.MouseEvent('mouseup',{bubbles:true}));
  await new Promise(resolve=>setTimeout(resolve,10));
  const mark=[...host.querySelectorAll('button')].find(x=>x.textContent==='Destacar');
  mark.click();
  assert.equal(changes,1);
  assert.equal(model.annotations.length,1);
  assert.deepEqual(Array.from(model.annotations[0].quad_points[0]),[10,480,110,480,10,460,110,460]);
  assert.equal(model.annotations[0].selected_text,'Texto selecionavel');
  reader.renderPage(0,page);
  assert.equal(surface.querySelectorAll('.semantic-fragment').length,1);
  const textarea=host.querySelector('.semantic-notes-rail textarea');
  textarea.value='Passagem de referência';
  textarea.dispatchEvent(new w.Event('change',{bubbles:true}));
  assert.equal(model.annotations[0].comment,'Passagem de referência');
  assert.equal(changes,2);
});


test('sticky notes add page-anchored native-ready geometry, search and Markdown summary',t=>{
 const dom=new JSDOM('<div id="root" data-source-kind="pdf"><section id="host"><aside id="side"></aside><div id="scroll"><div class="fixed-surface" data-page-index="0"></div></div></section></div>',{runScripts:'outside-only'});
 const w=dom.window;t.after(()=>w.close());w.eval(script);
 w.OpenDocModel={id:(()=>{let i=0;return()=>'note-'+(++i);})()};
 const root=w.document.querySelector('#root'),host=w.document.querySelector('#host'),scroller=w.document.querySelector('#scroll'),sidebar=w.document.querySelector('#side'),surface=w.document.querySelector('.fixed-surface');
 surface.getBoundingClientRect=()=>({left:100,top:50,width:400,height:500,right:500,bottom:550});
 const page={getViewport:()=>({width:400,height:500,
   convertToPdfPoint:(x,y)=>[x,500-y],convertToViewportPoint:(x,y)=>[x,500-y]})};
 let model={annotations:[]},updates=0;const controller=new w.AbortController();t.after(()=>controller.abort());
 const reader=w.OpenDocSemanticAnnotations.create({root,host,scroller,sidebar,signal:controller.signal,
   getModel:()=>model,getPage:()=>page,getZoom:()=>1,update:next=>{model={annotations:next};updates++;},
   go:()=>{},status:()=>{}});
 reader.reset();
 const toggle=w.document.createElement('button');reader.bindNoteButton(toggle);
 reader.setNoteMode(true);assert.equal(toggle.getAttribute('aria-pressed'),'true');
 const click=new w.MouseEvent('pointerup',{bubbles:true,button:0,clientX:200,clientY:180});
 surface.dispatchEvent(click);
 assert.equal(updates,1);assert.equal(model.annotations.length,1);
 const annotation=model.annotations[0];
 assert.equal(annotation.kind,'note');assert.equal(annotation.page_index,0);
 assert.equal(annotation.quad_points[0].length,8);
 assert.equal(reader.noteActive(),false);assert.equal(toggle.getAttribute('aria-pressed'),'false');
 const note=surface.querySelector('.semantic-note-pin');
 assert.ok(note);assert.match(note.getAttribute('aria-label'),/nota/i);
 const textarea=host.querySelector('.semantic-notes-rail textarea');textarea.value='Conferir referência bibliográfica';
 textarea.dispatchEvent(new w.Event('change',{bubbles:true}));
 assert.equal(model.annotations[0].comment,'Conferir referência bibliográfica');
 assert.match(reader.summary(),/Conferir referência bibliográfica/);
 const search=host.querySelector('.semantic-notes-rail input[type=search]');search.value='sem resultado';
 search.dispatchEvent(new w.Event('input'));assert.ok(host.querySelector('.semantic-notes-rail .semantic-empty'));
 search.value='bibliográfica';search.dispatchEvent(new w.Event('input'));
 assert.equal(host.querySelectorAll('.semantic-notes-rail .semantic-annotation-list button').length,1);
 reader.setNoteMode(true);note.click();
 assert.equal(reader.noteActive(),false);
});

test('Ctrl+click markup opens an editable floating comment without navigating away',t=>{
 const dom=new JSDOM('<div id="root" data-source-kind="pdf"><section class="fixed-document" id="host"><div class="fixed-controls"></div><aside id="side"><button>Página 1</button></aside><div id="scroll"><div class="fixed-surface" data-page-index="7"><span>Trecho</span></div></div></section></div>',
   {runScripts:'outside-only',url:'http://localhost'});
 const w=dom.window;t.after(()=>w.close());w.eval(script);
 const root=w.document.querySelector('#root'),host=w.document.querySelector('#host'),
       scroller=w.document.querySelector('#scroll'),sidebar=w.document.querySelector('#side'),
       surface=w.document.querySelector('.fixed-surface');
 root.dataset.sourceKind='pdf';
 const page={getViewport:()=>({width:400,height:500,
   convertToViewportPoint:(x,y)=>[x,500-y]})};
 surface.getBoundingClientRect=()=>({left:100,top:50,width:400,height:500,right:500,bottom:550});
 let model={annotations:[{id:'a-1',kind:'highlight',page_index:7,
   selected_text:'Texto importante',quad_points:[[20,450,150,450,20,430,150,430]],
   color:'#DDFF88',opacity:.4,comment:'Comentário antigo'}]};
 let nav=0,changes=0,controller=new w.AbortController();
 t.after(()=>controller.abort());
 const semantic=w.OpenDocSemanticAnnotations.create({root,host,scroller,sidebar,
   signal:controller.signal,getModel:()=>model,getPage:()=>page,getZoom:()=>1,
   update:annotations=>{model={annotations};changes++;},go:()=>nav++,status:()=>{}});
 semantic.reset();
 assert.equal(sidebar.querySelector('.semantic-annotation-panel'),null);
 assert.ok(host.querySelector('.semantic-notes-rail .semantic-annotation-panel'));
 assert.equal(host.dataset.annotationPane,'true');
 semantic.renderPage(7,page);
 const mark=surface.querySelector('.semantic-fragment');
 assert.equal(mark.dataset.annotationId,'a-1');
 const click=new w.MouseEvent('click',{bubbles:true,cancelable:true,ctrlKey:true,
   clientX:170,clientY:110});
 surface.querySelector('span').dispatchEvent(click);
 const balloon=host.querySelector('.semantic-note-balloon');
 assert.equal(balloon.hidden,false);
 assert.match(balloon.textContent,/Texto importante/);
 assert.equal(nav,0,'Ctrl+click must not move the PDF');
 const input=balloon.querySelector('textarea');input.value='Comentário novo';
 input.dispatchEvent(new w.Event('change',{bubbles:true}));
 assert.equal(model.annotations[0].comment,'Comentário novo');
 assert.equal(changes,1);assert.equal(nav,0,'Editing text must not navigate');
 balloon.querySelector('button:last-child').click();
 assert.equal(balloon.hidden,true);
 const toggle=host.querySelector('.semantic-rail-toggle');
 toggle.click();assert.equal(host.dataset.annotationPane,'false');
 toggle.click();assert.equal(host.dataset.annotationPane,'true');
 // Selecting a card must preserve the reader position; navigation is explicit.
 host.querySelector('.semantic-annotation-list button').click();
 assert.equal(nav,0,'Selecting a comment must not jump to the beginning of the PDF');
 const goButton=[...host.querySelectorAll('.semantic-annotation-editor button')]
   .find(button=>button.textContent.includes('Ir para página do comentário'));
 assert.ok(goButton,'Explicit navigation button must be visible after choosing the comment');
 goButton.click();
 assert.equal(nav,1,'Only the explicit action navigates to the comment page');
});
