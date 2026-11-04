/* The visual system remains a passive presenter over real Open Doc commands. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const rootDir=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(rootDir,name),'utf8');

function setup(t){
 const html=read('apps/open_doc/templates/base.html')
  .replace(/{{ (menus|toolbar|sidebar|editor|home) }}/g,(_,name)=>read('apps/open_doc/templates/'+name+'.html'));
 const dom=new JSDOM(html,{url:'http://localhost',runScripts:'outside-only'});
 const w=dom.window,root=w.document.querySelector('[data-app]');
 w.eval(read('apps/open_doc/static/js/design_system.js'));
 const events=[],abort=new w.AbortController();
 const ui=w.OpenDocDesign.create({root,action:name=>events.push(name),signal:abort.signal});
 t.after(()=>{abort.abort();ui.destroy();w.close();});
 return {w,root,ui,events};
}

function addRow(w,selector,label,format){
 const list=w.document.querySelector(selector),row=w.document.createElement('li');
 row.className='library-row';row.dataset.fileFormat=format;
 row.innerHTML='<span class="library-file-icon">'+format.toUpperCase()+'</span>'
 +'<div class="library-file-main"><button class="library-file-title"></button></div>'
 +'<span class="library-file-kind"></span>';
 row.querySelector('.library-file-title').textContent=label;
 list.append(row);return row;
}

test('library uses actual rows for document filters, search and type icons',t=>{
 const s=setup(t);
 const pdf=addRow(s.w,'[data-files]','Pesquisa_amazonica.pdf','pdf');
 const doc=addRow(s.w,'[data-documents]','Artigo de arqueologia','docx');
 const slides=addRow(s.w,'[data-files]','Seminario.pptx','pptx');
 s.ui.refreshLibrary();
 assert.equal(s.root.querySelector('[data-library-count]').textContent,'3');
 assert.equal(pdf.querySelector('.library-file-icon').dataset.format,'pdf');
 assert.equal(pdf.querySelector('.library-file-icon use').getAttribute('href').endsWith('#pdf'),true);
 s.root.querySelector('[data-library-filter=pdf]').click();
 assert.equal(pdf.hidden,false);assert.equal(doc.hidden,true);assert.equal(slides.hidden,true);
 assert.equal(s.root.querySelector('[data-library-filter=pdf]').getAttribute('aria-pressed'),'true');
 s.root.querySelector('[data-library-filter=all]').click();
 const input=s.root.querySelector('[data-library-search]');
 input.value='arqueologia';input.dispatchEvent(new s.w.Event('input',{bubbles:true}));
 assert.equal(doc.hidden,false);assert.equal(pdf.hidden,true);
 s.root.querySelector('[data-search-clear]').click();
 assert.equal(input.value,'');assert.equal(pdf.hidden,false);
});

test('empty matches announce no results, without hiding originally empty library',t=>{
 const s=setup(t);
 addRow(s.w,'[data-files]','Um arquivo.pdf','pdf');
 s.ui.refreshLibrary();
 const input=s.root.querySelector('[data-library-search]');
 input.value='sem correspondencia';input.dispatchEvent(new s.w.Event('input'));
 assert.equal(s.root.querySelector('[data-filter-empty]').hidden,false);
 input.value='';input.dispatchEvent(new s.w.Event('input'));
 assert.equal(s.root.querySelector('[data-filter-empty]').hidden,true);
});

test('quick create popover is accessible, dismissible, and reuses real app actions',t=>{
 const s=setup(t),trigger=s.root.querySelector('[data-create-trigger]');
 assert.equal(s.root.querySelector('[data-create-menu]').hidden,true);
 trigger.click();assert.equal(trigger.getAttribute('aria-expanded'),'true');
 assert.equal(s.root.querySelector('[data-create-menu]').hidden,false);
 s.root.dispatchEvent(new s.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
 assert.equal(trigger.getAttribute('aria-expanded'),'false');
 trigger.click();s.root.querySelector('[data-create-menu] [data-new]').click();
 assert.equal(s.root.querySelector('[data-create-menu]').hidden,true);
 assert.equal(s.root.querySelector('[data-new]').disabled,false);
});

test('desktop document quickbar follows page mode and source kind',t=>{
 const s=setup(t);
 s.root.dataset.documentKind='rich';s.root.dataset.pageMode='pages';s.ui.sync();
 assert.equal(s.root.querySelector('[data-view-shortcut=pages]').getAttribute('aria-pressed'),'true');
 s.root.dataset.pageMode='continuous';s.ui.sync();
 assert.equal(s.root.querySelector('[data-view-shortcut=continuous]').getAttribute('aria-pressed'),'true');
 s.root.dataset.documentKind='fixed';s.root.dataset.sourceKind='pdf';s.ui.sync();
 assert.equal(s.root.querySelector('[data-quickbar-rich]').hidden,true);
 assert.equal(s.root.querySelector('[data-export-shortcut=docx]').hidden,true);
 assert.match(s.root.querySelector('[data-quickbar-caption]').textContent,/PDF/);
 s.root.dataset.sourceKind='pptx';s.ui.sync();
 assert.equal(s.root.querySelector('[data-export-shortcut=pdf]').hidden,true);
 assert.match(s.root.querySelector('[data-quickbar-caption]').textContent,/PPTX/);
});

test('global header search finds library at home, document text inside editor',t=>{
 const s=setup(t),button=s.root.querySelector('[data-header-search]');
 s.root.dataset.homeView='true';button.click();
 assert.equal(s.w.document.activeElement,s.root.querySelector('[data-library-search]'));
 s.root.dataset.homeView='false';button.click();
 assert.equal(s.events.at(-1),'find');
});

test('ink and fixed-reader commands gain icons without duplicating controls',t=>{
 const s=setup(t);
 const toolbar=s.w.document.createElement('div');toolbar.className='ink-toolbar';
 toolbar.innerHTML='<button data-ink-mode="pen">Caneta</button><button data-ink-mode="eraser-partial">Borracha parcial</button>';
 s.root.append(toolbar);
 const fixed=s.w.document.createElement('div');fixed.className='fixed-controls';fixed.innerHTML='<button>Anterior</button><button>Buscar</button>';
 s.root.append(fixed);
 s.ui.sync();s.ui.sync();
 assert.equal(toolbar.querySelectorAll('svg').length,2);
 assert.equal(fixed.querySelectorAll('svg').length,2);
 assert.equal(toolbar.querySelector('[data-ink-mode=pen] use').getAttribute('href').endsWith('#pen'),true);
});
