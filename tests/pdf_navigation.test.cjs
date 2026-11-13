const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const source=fs.readFileSync('apps/open_doc/static/js/pdf_navigation.js','utf8');
function setup(t,options={}){
 const dom=new JSDOM('<main><div class="fixed-controls"></div><aside></aside></main>',{runScripts:'outside-only'}),w=dom.window,host=w.document.querySelector('main'),sidebar=host.querySelector('aside'),abort=new w.AbortController(),calls=[],observed=[];
 delete w.Array.prototype.at;w.HTMLElement.prototype.scrollIntoView=function(){this.dataset.revealed='true';};
 w.IntersectionObserver=class{constructor(callback){this.callback=callback;observed.push(this);}observe(){}disconnect(){this.disconnected=true;}};
 w.eval(source);const controller=w.OpenDocPdfNavigation.create({host,sidebar,controls:host.querySelector('.fixed-controls'),signal:abort.signal,navigate:dest=>calls.push(dest),thumbnail:options.thumbnail||((index,button)=>button.prepend(w.document.createElement('canvas'))),status:()=>{}});
 const surfaces=Array.from({length:options.pages||1000},(_,index)=>({index,width_pt:595,height_pt:842}));
 const load=(outline,resolve=async dest=>dest?.[0])=>controller.setDocument({outline,surfaces,resolve});
 t.after(()=>{abort.abort();w.close();});return{w,host,sidebar,controller,calls,load,observed};
}
const outline=()=>[{title:'Prefácio',dest:[0]},{title:'Introdução',dest:[2],count:-2,items:[{title:'Objetivos',dest:[3]},{title:'Método',dest:[4]}]},{title:'Conclusão',dest:[900]}];
const rows=s=>[...s.sidebar.querySelectorAll('[role=treeitem]')];
const key=(s,node,key)=>node.dispatchEvent(new s.w.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('outline preserves file order and hierarchy; disclosure never navigates and titles remain plain text',async t=>{
 const s=setup(t);s.load(outline());await settle();const nodes=rows(s);assert.deepEqual(nodes.map(n=>n.getAttribute('aria-label')),['Prefácio','Introdução','Objetivos','Método','Conclusão']);assert.equal(nodes[1].getAttribute('aria-expanded'),'false');assert.equal(nodes[1].querySelector('[role=group]').hidden,true);assert.equal(s.sidebar.querySelectorAll('[data-thumbnail-index]').length,0);
 nodes[1].querySelector('.pdf-outline-disclosure').click();assert.equal(nodes[1].getAttribute('aria-expanded'),'true');assert.equal(s.calls.length,0);nodes[2].querySelector('.pdf-outline-title').click();assert.deepEqual(Array.from(s.calls[0]),[3]);
 s.load([{title:'<img src=x onerror=alert(1)>',dest:[0]}]);assert.equal(s.sidebar.querySelector('img'),null);assert.match(s.sidebar.textContent,/<img/);
});
test('tree keyboard skips collapsed descendants and supports expand, parent, Home, End and activation',t=>{
 const s=setup(t);s.load(outline());const nodes=rows(s);nodes[0].focus();key(s,nodes[0],'ArrowDown');assert.equal(s.w.document.activeElement,nodes[1]);key(s,nodes[1],'ArrowDown');assert.equal(s.w.document.activeElement,nodes[4]);key(s,nodes[4],'Home');assert.equal(s.w.document.activeElement,nodes[0]);key(s,nodes[1],'ArrowRight');assert.equal(nodes[1].getAttribute('aria-expanded'),'true');key(s,nodes[1],'ArrowRight');assert.equal(s.w.document.activeElement,nodes[2]);key(s,nodes[2],'ArrowLeft');assert.equal(s.w.document.activeElement,nodes[1]);key(s,nodes[1],'ArrowLeft');assert.equal(nodes[1].getAttribute('aria-expanded'),'false');key(s,nodes[1],'End');assert.equal(s.w.document.activeElement,nodes[4]);key(s,nodes[4],'Enter');assert.equal(s.calls.length,1);
});
test('current section uses destination order, deepest entry per page, and reveals ancestors on demand',async t=>{
 const s=setup(t);s.load(outline());await settle();s.controller.setPage(4);const nodes=rows(s);assert.equal(nodes[1].getAttribute('aria-current'),'location');s.sidebar.querySelector('[data-pdf-outline-current]').click();assert.equal(nodes[1].getAttribute('aria-expanded'),'true');assert.equal(nodes[3].getAttribute('aria-current'),'location');assert.equal(s.w.document.activeElement,nodes[3]);s.controller.setPage(974);assert.equal(nodes[4].getAttribute('aria-current'),'location');assert.equal(s.sidebar.querySelectorAll('[aria-current=location]').length,1);
});
test('thumbnails are a separate lazy view, highlight the current page and render at most two concurrently',async t=>{
 const gates=[];const s=setup(t,{thumbnail:(index,button)=>new Promise(resolve=>gates.push(()=>{button.prepend(s.w.document.createElement('canvas'));resolve();}))});s.load(outline());assert.equal(s.observed.length,0);s.controller.setPage(974);s.sidebar.querySelector('[data-pdf-nav-tab=thumbnails]').click();const buttons=[...s.sidebar.querySelectorAll('[data-thumbnail-index]')];assert.equal(buttons.length,1000);assert.equal(buttons[974].getAttribute('aria-current'),'page');assert.equal(buttons[974].dataset.revealed,'true');assert.equal(s.sidebar.querySelector('[data-pdf-nav-panel=outline]').hidden,true);
 s.observed[0].callback(buttons.slice(970,980).map(target=>({target,isIntersecting:true})));assert.equal(gates.length,2);gates[0]();await settle();assert.equal(gates.length,3);s.host.querySelector('[data-pdf-sidebar-toggle]').click();gates[1]();gates[2]();await settle();assert.equal(gates.length,3);assert.equal(s.host.dataset.pdfSidebar,'closed');
});
test('reset cancels stale outline resolution and restores other document sidebars',async t=>{
 const s=setup(t);let finish;s.load([{title:'Antigo',dest:[10]}],()=>new Promise(resolve=>finish=resolve));s.load([{title:'Novo',dest:[0]}]);await settle();finish(10);await settle();s.controller.setPage(100);assert.equal(s.sidebar.querySelector('[aria-current=location]').getAttribute('aria-label'),'Novo');s.controller.reset();assert.equal(s.sidebar.children.length,0);assert.equal(s.host.dataset.pdfNavigation,undefined);assert.equal(s.host.querySelector('[data-pdf-sidebar-toggle]').hidden,true);assert.ok(s.observed.every(item=>item.disconnected));
});
test('empty outline uses thumbnails and pane width is keyboard adjustable without modern Array.at',t=>{
 const s=setup(t,{pages:3});s.load([]);assert.equal(s.sidebar.querySelector('[data-pdf-nav-tab=outline]').disabled,true);assert.equal(s.sidebar.querySelectorAll('[data-thumbnail-index]').length,3);const separator=s.sidebar.querySelector('[role=separator]');key(s,separator,'ArrowRight');assert.equal(s.host.style.getPropertyValue('--pdf-sidebar-width'),'290px');for(let i=0;i<40;i++)key(s,separator,'ArrowLeft');assert.equal(s.host.style.getPropertyValue('--pdf-sidebar-width'),'180px');
});
test('same-page destination selection stays in file order even when references resolve out of order',async t=>{
 const s=setup(t),pending=[];s.load([{title:'Primeiro',dest:[20]},{title:'Segundo',dest:[20]}],()=>new Promise(resolve=>pending.push(resolve)));
 pending[1](20);await settle();pending[0](20);await settle();s.controller.setPage(20);assert.equal(s.sidebar.querySelector('[aria-current=location]').getAttribute('aria-label'),'Primeiro');
});
