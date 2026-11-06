const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const rootDir=path.resolve(__dirname,'..'),source=n=>fs.readFileSync(path.join(rootDir,'apps/open_doc/static/js',n),'utf8');
function html(){return fs.readFileSync(path.join(rootDir,'apps/open_doc/templates/base.html'),'utf8').replace(/{{ (menus|toolbar|sidebar|editor|home) }}/g,(_,n)=>fs.readFileSync(path.join(rootDir,'apps/open_doc/templates',n+'.html'),'utf8'));}
test('a text layer error never removes the completed PDF canvas',async t=>{
 const dom=new JSDOM(html(),{runScripts:'outside-only'}),w=dom.window,root=w.document.querySelector('[data-app]'),abort=new w.AbortController();t.after(()=>{abort.abort();w.close();});w.console.error=()=>{};w.HTMLCanvasElement.prototype.getContext=()=>({});w.IntersectionObserver=class{observe(){}disconnect(){}};w.eval(source('compat.js'));w.eval(source('document_model.js'));w.eval(source('history.js'));w.eval(source('recovery.js'));w.pywebview={api:{set_dirty:async()=>{}}};
 const page={getViewport:()=>({width:400,height:500,scale:1}),render:()=>({promise:Promise.resolve(),cancel(){}}),getTextContent:async()=>({items:[]}),getAnnotations:async()=>[],cleanup:()=>true},pdf={numPages:1,getPage:async()=>page,getOutline:async()=>[],destroy(){}};
 w.OpenDocPdf={GlobalWorkerOptions:{},version:'test',getDocument:()=>({promise:Promise.resolve(pdf)}),TextLayer:class{constructor(){throw Error('text failure');}}};w.eval(source('fixed_document.js'));const editor=w.OpenDocFixedDocument.create({root,signal:abort.signal,token:'t',asset:s=>'http://localhost/'+s,request:async()=>({}),status:()=>{}});await editor.load({id:'p',title:'PDF',revision:1,source_kind:'pdf',capabilities:{preview:true},content:{source_kind:'pdf',surfaces:[{index:0,width_pt:300,height_pt:400,strokes:[],text_overlays:[]}]}});await new Promise(r=>setTimeout(r,30));assert.ok(root.querySelector('canvas[data-render-complete=true]'));assert.match(root.querySelector('.fixed-page-error').textContent,/text failure/);
});
test('PPTX adapter preserves local images and strips active/external content',async t=>{
 const dom=new JSDOM('<div id="slide"></div>',{runScripts:'outside-only'}),w=dom.window;t.after(()=>w.close());w.eval(source('vendor/purify.js'));w.eval(source('pptx_renderer.js'));let cleaned=false;w.fetch=async()=>({ok:true,arrayBuffer:async()=>new Uint8Array([80,75,1,2]).buffer});w.OpenDocPptxVendor={loadPresentation:async()=>({slides:[{text:'Teste Open Doc'}],cleanup:()=>{cleaned=true;}}),renderSlideToElement:(p,i,node)=>{node.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect x="10" y="10" width="80" height="30"/><foreignObject x="0" y="0" width="100" height="50"><div xmlns="http://www.w3.org/1999/xhtml">Teste Open Doc</div></foreignObject><image href="blob:local-image"/><a href="javascript:alert(1)">link</a></svg>';}};
 const adapter=await w.OpenDocPptx.load('id','token');adapter.render(0,w.document.querySelector('#slide'),500,300);const markup=w.document.querySelector('#slide').innerHTML;assert.ok(markup.includes('Teste Open Doc'));assert.equal(w.document.querySelector('rect').getAttribute('width'),'80');assert.ok(markup.includes('blob:local-image'));assert.ok(!markup.includes('onload'));assert.ok(!markup.includes('javascript:'));assert.equal(adapter.find('teste')[0],0);adapter.destroy();assert.equal(cleaned,true);
});

test('PDF search returns a distant page incrementally with bounded workers and cancels stale results',async t=>{
 const dom=new JSDOM(html(),{runScripts:'outside-only'}),w=dom.window;
 const root=w.document.querySelector('[data-app]'),abort=new w.AbortController();
 t.after(()=>{abort.abort();w.close();});
 w.console.error=()=>{};
 w.HTMLElement.prototype.scrollIntoView=()=>{};
 w.HTMLCanvasElement.prototype.getContext=()=>({});
 w.IntersectionObserver=class{observe(){}disconnect(){}};
 w.eval(source('compat.js'));w.eval(source('document_model.js'));
 w.eval(source('history.js'));w.eval(source('recovery.js'));
 w.pywebview={api:{set_dirty:async()=>{}}};
 let pendingReads=0,maxConcurrent=0,completed=0;
 const pdf={
   numPages:300,
   getPage:async index=>({
     getViewport:()=>({width:400,height:500,scale:1}),
     render:()=>({promise:Promise.resolve(),cancel(){}}),
     getAnnotations:async()=>[],
     cleanup(){},
     getTextContent:async()=>{
       pendingReads++;maxConcurrent=Math.max(maxConcurrent,pendingReads);
       await new Promise(resolve=>setTimeout(resolve,index===299?2:35));
       pendingReads--;completed++;
       return {items:[{str:'Pagina '+index+' texto pesquisavel'}]};
     }
   }),
   getOutline:async()=>[],destroy(){}
 };
 w.OpenDocPdf={GlobalWorkerOptions:{},version:'test',getDocument:()=>({promise:Promise.resolve(pdf)}),
   TextLayer:class{render(){return Promise.resolve();}}};
 // Reproduce the real Open Doc runtime: the PPTX editor is also loaded
 // while viewing a PDF. The inactive slide editor must not inspect PDF elements.
 w.eval(source('slide_editor.js'));
 w.eval(source('fixed_document.js'));
 const statuses=[];
 const editor=w.OpenDocFixedDocument.create({root,signal:abort.signal,token:'t',
   asset:s=>'http://localhost/'+s,request:async()=>({}),status:s=>statuses.push(s)});
 const surfaces=Array.from({length:300},(_,index)=>({index,width_pt:300,height_pt:400,strokes:[],text_overlays:[]}));
 await editor.load({id:'search-test',title:'PDF',revision:1,source_kind:'pdf',
   capabilities:{preview:true},content:{source_kind:'pdf',surfaces}});
 // Settle the viewer's separate initial page rendering before measuring
 // the search worker concurrency. This test still includes any pages
 // lazily rendered by the match's automatic navigation.
 await new Promise(resolve=>setTimeout(resolve,75));
 assert.equal(pendingReads,0,'initial PDF viewer renders should settle before search');
 maxConcurrent=0;completed=0;
 const input=root.querySelector('.fixed-controls input[type=search]');
 const button=Array.from(root.querySelectorAll('.fixed-controls button')).find(b=>b.textContent==='Buscar');
 input.value='Pagina 299 texto';button.click();
 let result=null;
 for(let i=0;i<100;i++){
   result=root.querySelector('[data-search-result]');
   if(result)break;
   await new Promise(resolve=>setTimeout(resolve,5));
 }
 assert.ok(result,'distant page 299 should appear before scanning 300 PDF pages');
 assert.match(result.textContent,/299/);
 assert.ok(completed<300,'result must be progressive, not gated by full-document scan');
 assert.ok(maxConcurrent<=9,'at most four search workers plus five lazily rendered visible pages');
 input.value='';input.dispatchEvent(new w.Event('input',{bubbles:true}));
 assert.equal(root.querySelectorAll('[data-search-result]').length,0);
 await new Promise(resolve=>setTimeout(resolve,70));
 assert.equal(root.querySelectorAll('[data-search-result]').length,0,'old search must not republish after cancellation');
 input.value='Pagina 2 texto';button.click();
 let next=null;
 for(let i=0;i<100;i++){
   next=root.querySelector('[data-search-result]');
   if(next)break;
   await new Promise(resolve=>setTimeout(resolve,5));
 }
 assert.ok(next,'new search must work after aborting prior request');
 assert.match(next.textContent,/página 2/);
 input.value='';input.dispatchEvent(new w.Event('input',{bubbles:true}));
 assert.ok(statuses.some(s=>s.includes('pesquisando')),'user receives incremental progress');
});

test('PDF page extraction UI validates inclusive range and invokes the native bridge',async t=>{
 const dom=new JSDOM(html(),{runScripts:'outside-only'}),w=dom.window;
 const root=w.document.querySelector('[data-app]'),abort=new w.AbortController();
 t.after(()=>{abort.abort();w.close();});
 w.console.error=()=>{};
 w.HTMLElement.prototype.scrollIntoView=()=>{};
 w.HTMLCanvasElement.prototype.getContext=()=>({});
 w.IntersectionObserver=class{observe(){}disconnect(){}};
 w.eval(source('compat.js'));w.eval(source('document_model.js'));
 w.eval(source('history.js'));w.eval(source('recovery.js'));
 let extracted=null;const statuses=[];
 w.pywebview={api:{
   set_dirty:async()=>{},
   extract_pdf_pages:async(...args)=>{
     extracted=args;
     return {path:'/tmp/pages.pdf',pages:2,revision:1};
   }
 }};
 const page={
   getViewport:()=>({width:400,height:500,scale:1}),
   render:()=>({promise:Promise.resolve(),cancel(){}}),
   getTextContent:async()=>({items:[]}),getAnnotations:async()=>[],cleanup(){}
 };
 const pdf={numPages:4,getPage:async()=>page,getOutline:async()=>[],destroy(){}};
 w.OpenDocPdf={GlobalWorkerOptions:{},version:'test',
   getDocument:()=>({promise:Promise.resolve(pdf)}),
   TextLayer:class{render(){return Promise.resolve();}}};
 w.eval(source('fixed_document.js'));
 const editor=w.OpenDocFixedDocument.create({
   root,signal:abort.signal,token:'t',asset:s=>'http://localhost/'+s,
   request:async()=>({}),status:s=>statuses.push(s)
 });
 const surfaces=Array.from({length:4},(_,index)=>({
   index,width_pt:300,height_pt:400,strokes:[],text_overlays:[]
 }));
 await editor.load({id:'pdf-range',title:'PDF',revision:1,source_kind:'pdf',
   capabilities:{preview:true},content:{source_kind:'pdf',surfaces}});
 const button=Array.from(root.querySelectorAll('.fixed-controls button'))
   .find(b=>b.textContent==='Extrair páginas');
 assert.ok(button&&!button.hidden,'PDF extraction is available in PDF reader');
 let answers=['2','3'];w.prompt=()=>answers.shift();
 button.click();
 for(let i=0;i<100&&!extracted;i++)await new Promise(resolve=>setTimeout(resolve,5));
 assert.deepEqual(extracted,['pdf-range',1,2,3]);
 assert.ok(statuses.some(s=>s.includes('pages.pdf')));
 extracted=null;answers=['3','2'];
 button.click();
 await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(extracted,null,'invalid page ranges never enter native bridge');
 assert.ok(statuses.some(s=>s.includes('intervalo de páginas válido')));
});

test('PDF Ctrl+F marks text occurrences without losing the current document',async t=>{
 const dom=new JSDOM(html(),{runScripts:'outside-only'}),w=dom.window;
 const root=w.document.querySelector('[data-app]'),abort=new w.AbortController();
 t.after(()=>{abort.abort();w.close();});
 w.HTMLElement.prototype.scrollIntoView=()=>{};
 w.HTMLCanvasElement.prototype.getContext=()=>({});
 w.Range.prototype.getClientRects=()=>[{left:25,top:40,width:80,height:18,right:105,bottom:58}];
 w.IntersectionObserver=class{observe(){}disconnect(){}};
 for(const file of ['compat.js','document_model.js','history.js','recovery.js'])w.eval(source(file));
 w.pywebview={api:{set_dirty:async()=>{}}};
 const page={
   getViewport:()=>({width:400,height:500,scale:1}),
   render:()=>({promise:Promise.resolve(),cancel(){}}),
   getAnnotations:async()=>[],cleanup(){},
   getTextContent:async()=>({items:[{str:'Porto'},{str:'Velho'}]})
 };
 const pdf={numPages:1,getPage:async()=>page,getOutline:async()=>[],destroy(){}};
 w.OpenDocPdf={GlobalWorkerOptions:{},version:'test',getDocument:()=>({promise:Promise.resolve(pdf)}),
   TextLayer:class{constructor({container}){this.container=container;}
     render(){for(const value of ['Porto','Velho']){const span=w.document.createElement('span');
       span.textContent=value;this.container.append(span);}return Promise.resolve();}}};
 w.eval(source('fixed_document.js'));
 const editor=w.OpenDocFixedDocument.create({root,signal:abort.signal,token:'t',
   asset:s=>'http://localhost/'+s,request:async()=>({}),status:()=>{}});
 await editor.load({id:'search-mark-test',title:'PDF',revision:1,source_kind:'pdf',
   capabilities:{preview:true},content:{source_kind:'pdf',surfaces:[
     {index:0,width_pt:300,height_pt:400,strokes:[],text_overlays:[]}
   ]}});
 await new Promise(resolve=>setTimeout(resolve,25));
 const input=root.querySelector('.fixed-controls input[type=search]');
 w.dispatchEvent(new w.KeyboardEvent('keydown',{key:'f',ctrlKey:true,bubbles:true,cancelable:true}));
 assert.equal(w.document.activeElement,input,'Ctrl+F should focus PDF search');
 input.value='Porto Velho';
 Array.from(root.querySelectorAll('.fixed-controls button')).find(button=>button.textContent==='Buscar').click();
 for(let i=0;i<30&&!root.querySelector('.pdf-search-hit');i++)
   await new Promise(resolve=>setTimeout(resolve,5));
 assert.ok(root.querySelector('.pdf-search-hit'),'result must highlight exact PDF text');
 assert.equal(root.querySelectorAll('.textLayer span').length,2,'text-layer spans remain unmodified');
 input.value='';input.dispatchEvent(new w.Event('input',{bubbles:true}));
 assert.equal(root.querySelector('.pdf-search-hit'),null,'clearing search removes highlights');
});

test('PDF search tolerates missing getTextContent items instead of throwing map error',async t=>{
 const dom=new JSDOM(html(),{runScripts:'outside-only'}),w=dom.window;
 const root=w.document.querySelector('[data-app]'),abort=new w.AbortController();
 t.after(()=>{abort.abort();w.close();});
 w.HTMLElement.prototype.scrollIntoView=()=>{};
 w.HTMLCanvasElement.prototype.getContext=()=>({});
 w.IntersectionObserver=class{observe(){}disconnect(){}};
 for(const file of ['compat.js','document_model.js','history.js','recovery.js'])w.eval(source(file));
 w.pywebview={api:{set_dirty:async()=>{}}};
 const page={getViewport:()=>({width:400,height:500,scale:1}),render:()=>({promise:Promise.resolve(),cancel(){}}),
   getTextContent:async()=>({}),getAnnotations:async()=>[],cleanup(){}};
 w.OpenDocPdf={GlobalWorkerOptions:{},version:'test',
   getDocument:()=>({promise:Promise.resolve({numPages:1,getPage:async()=>page,getOutline:async()=>[],destroy(){}})}),
   TextLayer:class{render(){return Promise.resolve();}}};
 w.eval(source('fixed_document.js'));
 const messages=[];
 const editor=w.OpenDocFixedDocument.create({root,signal:abort.signal,token:'t',asset:s=>'http://localhost/'+s,
   request:async()=>({}),status:value=>messages.push(value)});
 await editor.load({id:'invalid-search-items',title:'PDF',revision:1,source_kind:'pdf',
   capabilities:{preview:true},content:{source_kind:'pdf',
     surfaces:[{index:0,width_pt:300,height_pt:400,strokes:[],text_overlays:[]}]}});
 const input=root.querySelector('.fixed-controls input[type=search]');
 input.value='exemplo';
 Array.from(root.querySelectorAll('.fixed-controls button')).find(button=>button.textContent==='Buscar').click();
 for(let i=0;i<30&&!messages.some(value=>value.includes('páginas com resultados'));i++)
   await new Promise(resolve=>setTimeout(resolve,5));
 assert.ok(messages.some(value=>value.includes('0 páginas com resultados')),'missing item lists are treated as empty');
});

test('editable PPTX Ctrl+F finds and selects actual slide text instead of a missing imported viewer',async t=>{
 const dom=new JSDOM(html(),{runScripts:'outside-only'}),w=dom.window;
 const root=w.document.querySelector('[data-app]'),abort=new w.AbortController();
 t.after(()=>{abort.abort();w.close();});
 w.HTMLElement.prototype.scrollIntoView=()=>{};
 w.IntersectionObserver=class{observe(){}disconnect(){}};
 w.pywebview={api:{set_dirty:async()=>{}}};
 for(const file of ['compat.js','document_model.js','history.js','recovery.js',
   'slide_charts.js','slide_editor.js','fixed_document.js'])w.eval(source(file));
 const statuses=[];
 const editor=w.OpenDocFixedDocument.create({root,signal:abort.signal,token:'t',
   asset:src=>'http://localhost/'+src,request:async()=>({}),status:s=>statuses.push(s)});
 t.after(()=>editor.deactivate());
 await editor.load({id:'editable-search',title:'Pesquisa',revision:1,source_kind:'pptx',
   capabilities:{preview:true},content:{source_kind:'pptx',editable_deck:true,assets:{},
     surfaces:[{index:0,width_pt:960,height_pt:540,background:'#FFFFFF',notes:'',
       strokes:[],text_overlays:[],elements:[{id:'slide-text',name:'Título',
       type:'text',text:'Congresso Acadêmico sobre Defesa',x:.1,y:.2,width:.65,height:.2,
       font_size_pt:24,color:'#222222',fill:'#FFFFFF',stroke:'#444444',rotation:0}]}]}});
 const input=root.querySelector('.fixed-controls input[type=search]');
 w.dispatchEvent(new w.KeyboardEvent('keydown',{key:'f',ctrlKey:true,bubbles:true}));
 assert.equal(w.document.activeElement,input);
 input.value='congresso';
 Array.from(root.querySelectorAll('.fixed-controls button')).find(b=>b.textContent==='Buscar').click();
 const result=root.querySelector('[data-search-result]');
 assert.ok(result,'search should expose a result for editable PPTX text');
 assert.match(result.textContent,/Slide 1/);
 assert.ok(root.querySelector('.slide-search-match'),
   'the matching slide text object must visibly receive focus');
 assert.ok(statuses.some(s=>s.includes('ocorrência(s)')));
});

test('fixed document adapter keeps all PPTX slides in the model but only one editor surface',async t=>{
 const dom=new JSDOM(html(),{runScripts:'outside-only'}),w=dom.window;
 const root=w.document.querySelector('[data-app]'),abort=new w.AbortController();
 t.after(()=>{abort.abort();w.close();});
 w.HTMLElement.prototype.scrollIntoView=()=>{};
 w.IntersectionObserver=class{observe(){}disconnect(){}};
 w.pywebview={api:{set_dirty:async()=>{}}};
 for(const file of ['compat.js','document_model.js','history.js','recovery.js',
   'slide_charts.js','slide_editor.js','fixed_document.js'])w.eval(source(file));
 const editor=w.OpenDocFixedDocument.create({root,signal:abort.signal,token:'t',
   asset:src=>'http://localhost/'+src,request:async()=>({}),status:()=>{}});
 t.after(()=>editor.deactivate());
 const slide=(index,text)=>({
   index,width_pt:960,height_pt:540,background:'#FFFFFF',
   notes:'',strokes:[],text_overlays:[],elements:[{
     id:'text-'+index,type:'text',name:'Texto '+index,text,
     x:.1,y:.2,width:.55,height:.2,font_size_pt:22,
     color:'#191C1E',fill:'#FFFFFF',stroke:'#004AC6',rotation:0
   }]
 });
 await editor.load({id:'two-slides',title:'Dois slides',revision:1,source_kind:'pptx',
   capabilities:{preview:true},content:{source_kind:'pptx',editable_deck:true,assets:{},
     surfaces:[slide(0,'Apenas primeiro'),slide(1,'Apenas segundo')]}});
 const scroll=root.querySelector('.fixed-scroll');
 const sidebar=root.querySelector('.fixed-sidebar');
 assert.equal(scroll.querySelectorAll('.fixed-surface').length,1);
 assert.equal(scroll.querySelector('.fixed-surface').dataset.pageIndex,'0');
 assert.match(scroll.textContent,/Apenas primeiro/);
 assert.doesNotMatch(scroll.textContent,/Apenas segundo/);
 assert.equal(sidebar.querySelectorAll('[data-thumbnail-index]').length,2);
 const field=root.querySelector('.fixed-controls input[type=number]');
 field.value='2';field.dispatchEvent(new w.Event('change'));
 assert.equal(scroll.querySelectorAll('.fixed-surface').length,1);
 assert.equal(scroll.querySelector('.fixed-surface').dataset.pageIndex,'1');
 assert.match(scroll.textContent,/Apenas segundo/);
 assert.doesNotMatch(scroll.textContent,/Apenas primeiro/);
 assert.equal(sidebar.querySelectorAll('[data-thumbnail-index]').length,2);
 assert.equal(Number(field.max),2,'page navigation must keep total model size');
 assert.equal(editor.snapshot().content.surfaces.length,2);
});
