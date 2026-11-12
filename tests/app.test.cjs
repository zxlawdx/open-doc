/* Full app.js lifecycle regression. Native editing is verified separately in Qt. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const base = path.resolve(__dirname, '..');
async function mount(t, brokenNavigation = false, startInLibrary = false, systemTheme = false) {
  const template = fs.readFileSync(path.join(base, 'apps/open_doc/templates/base.html'), 'utf8')
    .replace(/{{ (menus|toolbar|sidebar|editor|home|workbook) }}/g, (_, name) => fs.readFileSync(path.join(base, 'apps/open_doc/templates/' + name + '.html'), 'utf8'));
  const dom = new JSDOM(template, {url: 'http://localhost', runScripts: 'outside-only'});
  const w = dom.window, root = w.document.querySelector('[data-app]');
  const media = new w.EventTarget();
  media.matches = false;
  w.matchMedia = () => media;
  delete w.Element.prototype.replaceChildren;
  w.OpenDocPdf={};w.OpenDocPptxVendor={};w.OpenDocFreehand={};w.requestAnimationFrame=fn=>setTimeout(fn,0);
  const note = {id: 'note', title: 'Documento', markdown: '# Título\n\nTexto selecionado', revision: 1};
  w.pywebview = {api: {get_bootstrap: async () => ({token: 'test', start_in_library: startInLibrary, settings: {theme: systemTheme ? 'system' : 'light', zoom: 100}, document: note, autosave_seconds: 30}), set_dirty: async () => {}}};
  const requests = [];
  w.fetch = async (url, options) => {
    requests.push({url: String(url), body: options?.body});
    const library = {
      documents: [note], files: [],
      templates: [
        {id:'field', format:'docx', title:'Relatório', category:'Pesquisa', sections:[['Método','Descreva a coleta']]},
        {id:'slides', format:'pptx', title:'Projeto', category:'Profissional', sections:[['Plano','Defina o escopo']]},
      ],
    };
    const data = String(url).endsWith('/document/template') ? {...note, id:'copy', title:'Relatório'} :
      options?.body ? {...JSON.parse(options.body), revision:2} : library;
    return {ok:true,json:async()=>data};
  };
  for (const file of ['compat.js', 'vendor/marked.js', 'vendor/purify.js', 'vendor/turndown.js', 'document_model.js','rich_renderer.js','rich_serializer.js','formatting.js','tables.js','editor_commands.js', 'history.js', 'recovery.js', 'popovers.js','pagination.js','logical_transactions.js','page_menu.js','editor.js','pptx_renderer.js','semantic_annotations.js','slide_charts.js','native_math_parser.js','math_gallery.js','slide_editor.js','fixed_document.js','document_kinds.js','ink.js', 'design_system.js', 'menus.js', 'theme.js', 'paper_layout.js', 'zoom.js', 'navigation.js']) {
    w.eval(fs.readFileSync(path.join(base, 'apps/open_doc/static/js', file), 'utf8'));
  }
  if (brokenNavigation) {
    w.console.error = () => {};
    w.OpenDocNavigation.create = () => { throw Error('injected navigation failure'); };
  }
  // JSDOM has no editing engine. Model only adapter effects; Qt QA uses execCommand itself.
  w.document.execCommand = (command, _, value) => {
    const selection = w.getSelection(), range = selection.getRangeAt(0);
    if (command === 'bold') {
      const strong = w.document.createElement('strong'); range.surroundContents(strong);
      root.querySelector('[data-rich]').dispatchEvent(new w.Event('input',{bubbles:true}));
    } else if (command === 'createLink') {
      const link = w.document.createElement('a');link.href=value;range.surroundContents(link);
    } else if (command === 'formatBlock') {
      const block = root.querySelector('[data-rich] p');
      const heading = w.document.createElement(value.replace(/[<>]/g, '')); heading.textContent = block.textContent; block.replaceWith(heading);
    }
    return true;
  };
  Object.defineProperty(w.document, 'currentScript', {value: {src: 'http://localhost/static/open_doc/js/app.js'}});
  w.eval(fs.readFileSync(path.join(base, 'apps/open_doc/static/js/app.js'), 'utf8'));
  for (let i = 0; i < 50 && root.dataset.ready !== 'true'; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(root.dataset.ready, 'true');
  t.after(() => { w.OpenDocApp.destroy(); w.close(); });
  const click = selector => {
    const element = root.querySelector(selector); assert.ok(element, selector);
    element.dispatchEvent(new w.MouseEvent('mousedown', {bubbles: true, cancelable: true})); element.click();
  };
  const select = () => {
    const rich = root.querySelector('[data-rich]'), range = w.document.createRange();
    range.selectNodeContents(rich.querySelector('p')); rich.focus();
    w.getSelection().removeAllRanges(); w.getSelection().addRange(range);
  };
  return {w, root, click, select, requests, media};
}
test('app.js boots without replaceChildren and binds toolbar, select, menus and navigation', async t => {
  const {w, root, click, select} = await mount(t);
  assert.equal(w.OpenDocApp.failures.length, 0);
  assert.equal(root.querySelector('[data-rich]').hidden, false);
  assert.equal(root.querySelectorAll('[data-outline] button').length, 1);
  select(); click('.toolbar [data-command=bold]');
  assert.match(root.querySelector('[data-source]').value, /\*\*Texto selecionado\*\*/);
  click('.toolbar [data-command=undo]'); assert.doesNotMatch(root.querySelector('[data-source]').value, /\*\*/);
  click('.toolbar [data-command=redo]'); assert.match(root.querySelector('[data-source]').value, /\*\*/);
  click('.toolbar [data-command=undo]'); select();
  const paragraph = root.querySelector('[data-paragraph]');
  paragraph.dispatchEvent(new w.MouseEvent('mousedown', {bubbles: true}));
  paragraph.focus(); paragraph.value = 'h3'; paragraph.dispatchEvent(new w.Event('change', {bubbles: true}));
  assert.match(root.querySelector('[data-source]').value, /### Texto selecionado/);
  click('[data-menu=help]'); assert.equal(root.querySelector('[data-menu-panel=help]').hidden, false);
  click('[data-action=about]'); assert.equal(root.querySelector('[data-dialog]').hidden, false);
  click('[data-dialog-cancel]');
  click('[data-action=home]'); await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(root.querySelectorAll('[data-documents] li').length, 1);
  assert.doesNotMatch(root.querySelector('[data-status]').textContent, /TypeError|is not a function|undefined/);
});
test('navigation failure does not prevent mouse commands or menus', async t => {
  const {w, root, click, select} = await mount(t, true);
  assert.equal(w.OpenDocApp.failures[0].module, 'navegação');
  select(); click('.toolbar [data-command=bold]');
  assert.match(root.querySelector('[data-source]').value, /\*\*/);
  click('[data-menu=edit]'); assert.equal(root.querySelector('[data-menu-panel=edit]').hidden, false);
});
test('replaceChildren fallback accepts text, nodes, moved children and empty calls', async t => {
  const {w} = await mount(t);
  const element = w.document.createElement('div'), child = w.document.createElement('b');
  element.appendChild(child); element.replaceChildren('before', child, 42);
  assert.equal(element.textContent, 'before42'); assert.equal(element.children[0], child);
  element.replaceChildren(); assert.equal(element.childNodes.length, 0);
});

test('popover placement clamps both axes and flips above the trigger', async t => {
  const {w} = await mount(t);
  Object.defineProperty(w, 'innerWidth', {value: 720});
  Object.defineProperty(w, 'innerHeight', {value: 600});
  const panel = w.document.createElement('div');
  panel.getBoundingClientRect = () => ({width: 254, height: 240});
  w.OpenDocPopovers.position(panel, {left: 700, top: 570, bottom: 598});
  assert.equal(panel.style.left, '458px');
  assert.equal(panel.style.top, '330px');
  assert.equal(panel.dataset.align, 'end');
});

test('library actions are a menu surface with keyboard dismissal', async t => {
  const {w, root} = await mount(t);
  await w.OpenDocApp.action('home');
  await new Promise(resolve => setTimeout(resolve, 10));
  const details = root.querySelector('.library-file-actions');
  assert.ok(root.querySelector('.library-row .library-file-main .library-file-title'));
  assert.equal(details.querySelectorAll('.document-action-menu [role=menuitem]').length, 3);
  assert.equal(details.querySelector('.danger-action').textContent, 'Excluir');
  details.open = true;
  details.dispatchEvent(new w.Event('toggle'));
  assert.equal(details.querySelector('summary').getAttribute('aria-expanded'), 'true');
  details.querySelector('summary').dispatchEvent(new w.KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true}));
  assert.equal(w.document.activeElement.textContent, 'Renomear');
  details.querySelector('summary').dispatchEvent(new w.KeyboardEvent('keydown', {key: 'ArrowUp', bubbles: true}));
  assert.equal(w.document.activeElement.textContent, 'Excluir');
  w.document.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
  assert.equal(details.open, false);
  assert.equal(w.document.activeElement.tagName, 'SUMMARY');
});

test('link dialog preserves selected text while pending pagination moves nodes', async t => {
  const {w,root,click,select}=await mount(t);
  select();click('.toolbar [data-action=link]');
  await new Promise(resolve=>setTimeout(resolve,180));
  root.querySelector('[data-dialog-input]').value='https://example.com';
  click('[data-dialog-confirm]');await new Promise(resolve=>setTimeout(resolve,10));
  assert.match(root.querySelector('[data-source]').value,/\[Texto selecionado\]\(https:\/\/example.com\)/);
});


test('link modal Cancel and Escape always close and preserve document', async t => {
  const {w,root,click,select}=await mount(t);
  const modal=root.querySelector('[data-dialog]');
  const source=root.querySelector('[data-source]');
  const initial=source.value;
  for(const mode of ['cancel','escape']){
    select();click('.toolbar [data-action=link]');
    await new Promise(resolve=>setTimeout(resolve,15));
    assert.equal(modal.hidden,false,'dialog opens in '+mode+' mode');
    assert.equal(modal.style.display,'grid');
    assert.equal(w.document.activeElement,root.querySelector('[data-dialog-input]'));
    if(mode==='cancel')click('[data-dialog-cancel]');
    else root.querySelector('[data-dialog-input]').dispatchEvent(
      new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    assert.equal(modal.hidden,true,'dialog must be closed by '+mode);
    assert.equal(modal.style.display,'none','the legacy Qt display fallback hides the modal');
    await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(source.value,initial,'cancel must not modify the document');
  }
});

test('the startup library scopes formats and previews a template before creating a copy', async t => {
  const {w, root, click, requests} = await mount(t, false, true);
  const wait = () => new Promise(resolve => setTimeout(resolve, 10));
  await wait();
  assert.equal(root.querySelector('[data-library]').hidden, false);
  assert.equal(root.querySelector('[data-template-section]').hidden, true);
  click('[data-library-route=docx]');
  assert.equal(root.querySelector('[data-template-section]').hidden, false);
  assert.equal(root.querySelector('[data-template-id=slides]').hidden, true);
  click('[data-library-section=recent]');
  assert.equal(root.querySelector('[data-library-recent]').hidden, false);
  assert.equal(root.querySelector('[data-library-imports]').hidden, true);
  click('[data-library-section=imports]');
  assert.equal(root.querySelector('[data-library-imports]').hidden, false);
  click('[data-library-route=templates]');
  const search = root.querySelector('[data-library-search]');
  search.value = 'pesquisa';
  search.dispatchEvent(new w.Event('input'));
  assert.equal(root.querySelector('[data-template-id=slides]').hidden, true);
  click('[data-template-id=field]');
  assert.match(root.querySelector('[data-dialog-body]').textContent, /Descreva a coleta/);
  click('[data-dialog-cancel]');
  await wait();
  assert.equal(requests.filter(item=>item.url.endsWith('/document/template')).length, 0);
  click('[data-template-id=field]');
  click('[data-dialog-confirm]');
  await wait();
  assert.equal(root.querySelector('[data-library]').hidden, true);
  assert.equal(w.OpenDocApp.editor().snapshot().id, 'copy');
  assert.deepEqual(JSON.parse(requests.find(item=>item.url.endsWith('/document/template')).body), {id:'field'});
  assert.equal(requests.filter(item=>item.url.endsWith('/files')).length, 1);
});

test('global zoom separates Central and document, and handles keyboard variants once', async t => {
  const {w, root, click, requests} = await mount(t, false, true);
  const output = () => root.querySelector('[data-zoom-value]').textContent;
  const key = (key, code, modifiers = {}) => {
    const event = new w.KeyboardEvent('keydown', {
      key, code, ctrlKey: true, bubbles: true, cancelable: true, ...modifiers
    });
    root.querySelector('[data-library-search]').dispatchEvent(event);
    return event.defaultPrevented;
  };
  assert.equal(output(), '100%');
  for (const [value, code, modifiers, expected] of [
    ['+', 'Equal', {shiftKey: true}, '110%'],
    ['+', 'Slash', {}, '120%'],
    ['=', 'Equal', {}, '130%'],
    ['Add', 'NumpadAdd', {}, '140%'],
    ['Subtract', 'NumpadSubtract', {}, '130%'],
    ['-', 'Minus', {}, '120%'],
    ['0', 'Numpad0', {}, '100%'],
  ]) {
    assert.equal(key(value, code, modifiers), true);
    assert.equal(output(), expected);
  }
  assert.equal(key('+', 'Equal', {altKey: true}), false);
  assert.equal(key('-', 'Minus', {ctrlKey: false}), false);
  key('z', 'KeyZ');
  assert.equal(output(), '100%');
  const wheel = new w.WheelEvent('wheel', {ctrlKey: true, deltaY: -80, bubbles: true, cancelable: true});
  root.querySelector('[data-library-search]').dispatchEvent(wheel);
  assert.equal(wheel.defaultPrevented, true);
  assert.equal(output(), '110%');
  click('[data-action=resume-editor]');
  assert.equal(output(), '100%');
  click('[data-zoom-step="-10"]');
  assert.equal(output(), '90%');
  click('.product');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(output(), '110%');
  await new Promise(resolve => setTimeout(resolve, 0));
  const persisted = requests.filter(item => item.url.endsWith('/settings')).map(item => JSON.parse(item.body).settings);
  assert.deepEqual(persisted.slice(-2), [{interface_zoom: 110}, {zoom: 90}]);
});

test('appearance can be changed in Central and responds to the system preference', async t => {
  const {w, root, click, requests, media} = await mount(t, false, true, true);
  click('.header-actions [data-action=theme]');
  assert.equal(root.querySelector('[data-dialog]').hidden, false);
  root.querySelector('[data-dialog-select]').value = 'dark';
  click('[data-dialog-confirm]');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(root.dataset.theme, 'dark');
  click('[data-action=resume-editor]');
  assert.equal(root.dataset.theme, 'dark');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(requests.some(item => item.body && JSON.parse(item.body).settings?.theme === 'dark'));
  click('.header-actions [data-action=theme]');
  root.querySelector('[data-dialog-select]').value = 'system';
  click('[data-dialog-confirm]');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(root.dataset.theme, 'light');
  media.matches = true;
  media.dispatchEvent(new w.Event('change'));
  assert.equal(root.dataset.theme, 'dark');
  click('.header-actions [data-action=theme]');
  root.querySelector('[data-dialog-select]').value = 'light';
  click('[data-dialog-confirm]');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(root.dataset.theme, 'light');
});

test('navigation clicks received during a slow document request are executed in order', async t => {
  const {w, root} = await mount(t);
  const fetch=w.fetch; let release, created=0;
  w.fetch=async(url,options)=>{
    if(String(url).endsWith('/document/new')){
      const number=++created;
      if(number===1)await new Promise(resolve=>{release=resolve;});
      return {ok:true,json:async()=>({id:'created-'+number,title:'Novo '+number,markdown:'',revision:1})};
    }
    return fetch(url,options);
  };
  const first=w.OpenDocApp.action('new');
  while(!release)await new Promise(resolve=>setTimeout(resolve,0));
  const second=w.OpenDocApp.action('new');
  assert.equal(created,1,'the second request must wait for the first');
  assert.equal(root.dataset.busy,'true');
  release(); await Promise.all([first,second]);
  assert.equal(created,2,'the second click must not be dropped');
  assert.equal(w.OpenDocApp.editor().snapshot().id,'created-2');
  assert.equal(root.dataset.busy,'false');
});

test('module resources load concurrently, reuse shared scripts and allow direct navigation', async t => {
  const {w,root,requests}=await mount(t);
  const names={
    'grid_workspace.js':'OpenDocGridWorkspace','workbook_formula.js':'OpenDocWorkbookFormula',
    'workbook_pivot.js':'OpenDocWorkbookPivot','workbook_pivot_ui.js':'OpenDocWorkbookPivotUI',
    'workbook_types.js':'OpenDocWorkbookTypes','python_packages.js':'OpenDocPythonPackages',
    'workbook.js':'OpenDocWorkbook','datasets.js':'OpenDocDatasets',
    'code-editor.bundle.js':'OpenDocCodeVendor','code_editor.js':'OpenDocCodeEditor',
    'code_notebook.js':'OpenDocCodeNotebook'
  };
  let saves=0,loads=0; const pending=[],loaded=[];
  const append=w.document.body.append.bind(w.document.body);
  w.document.body.append=(node)=>{
    if(node.tagName!=='SCRIPT')return append(node);
    const file=node.src.split('/').pop();loaded.push(file);
    pending.push(()=>{
      w[names[file]]=file==='workbook.js'?{create:()=>({load:()=>loads++,save:async()=>saves++,value:()=>100})}:
        file==='datasets.js'?{create:()=>({load:async()=>{}})}:{};
      node.onload();
    });
  };
  const filesBefore=requests.filter(r=>r.url.endsWith('/files')).length;
  const opening=w.OpenDocApp.action('workbook-new');
  assert.equal(pending.length,7,'independent resources start together');
  pending.splice(0).forEach(resolve=>resolve());await opening;
  assert.equal(root.dataset.workbookView,'true');assert.equal(loads,1);
  assert.equal(requests.filter(r=>r.url.endsWith('/files')).length,filesBefore,
    'opening a module must not refresh invisible template previews');
  const data=w.OpenDocApp.action('datasets');
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(pending.length,4,'shared grid resources must be reused');
  pending.splice(0).forEach(resolve=>resolve());await data;
  assert.equal(root.dataset.datasetView,'true');assert.equal(saves,1);
  await w.OpenDocApp.action('workbook-new');
  assert.equal(root.dataset.workbookView,'true');assert.equal(loads,2);
  await w.OpenDocApp.action('new');
  assert.equal(root.dataset.homeView,'false');assert.equal(root.dataset.workbookView,'false');
  assert.equal(saves,2);
  assert.equal(new Set(loaded).size,loaded.length,'no script is loaded twice');
});

test('a slow DOCX save cannot block spreadsheets or let a late document steal the view',async t=>{
 const {w,root}=await mount(t);const app=w.OpenDocApp,fetch=w.fetch;
 let releaseSave,releaseNew,newStarted=false;
 const editor=app.editor(),flush=editor.flush;
 editor.setMode('markdown');const source=root.querySelector('[data-source]');
 source.value='Cálculos pendentes';source.dispatchEvent(new w.Event('input',{bubbles:true}));editor.refresh();
 editor.flush=()=>new Promise(resolve=>{releaseSave=resolve;});
 w.OpenDocGridWorkspace={};w.OpenDocWorkbookFormula={};w.OpenDocWorkbookPivot={};
 w.OpenDocWorkbookPivotUI={};w.OpenDocWorkbookTypes={};w.OpenDocPythonPackages={};
 w.OpenDocWorkbook={create:options=>{
  return {load:()=>options.onDirty(false),save:async()=>{},value:()=>100};
 }};
 await app.action('workbook-new');
 assert.equal(root.dataset.workbookView,'true','the sheet opens before DOCX save completes');
 assert.equal(root.dataset.globalDirty,'true','a clean workbook cannot clear the unsaved document warning');
 assert.equal(typeof releaseSave,'function');
 releaseSave();editor.flush=flush;
 await app.action('home');
 w.fetch=async(url,options)=>{
  if(String(url).endsWith('/document/new')){
   newStarted=true;await new Promise(resolve=>{releaseNew=resolve;});
   return {ok:true,json:async()=>({id:'late',title:'Novo',markdown:'',revision:1})};
  }
  return fetch(url,options);
 };
 const pending=app.action('new');
 while(!newStarted)await new Promise(resolve=>setTimeout(resolve,0));
 await app.action('workbook-new');
 assert.equal(root.dataset.workbookView,'true');
 releaseNew();await pending;
 assert.equal(root.dataset.workbookView,'true','a completed DOCX request must not steal the chosen view');
 assert.equal(editor.snapshot().id,'late','the created document remains available behind the sheet');
});
