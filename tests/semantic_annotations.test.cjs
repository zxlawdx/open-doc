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
  const textarea=sidebar.querySelector('textarea');
  textarea.value='Passagem de referência';
  textarea.dispatchEvent(new w.Event('change',{bubbles:true}));
  assert.equal(model.annotations[0].comment,'Passagem de referência');
  assert.equal(changes,2);
});
