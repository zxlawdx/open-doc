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
