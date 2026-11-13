/* ============ OPEN DOC / VELA PAGE LIFECYCLE ============ */
"use strict";
(() => {
  if (!Array.prototype.at) Object.defineProperty(Array.prototype, 'at', {
    configurable: true, writable: true,
    value(index) { const offset = Math.trunc(Number(index)) || 0; return this[offset < 0 ? this.length + offset : offset]; }
  });
  const root = document.querySelector('[data-app]');
  if (!root) return;
  window.OpenDocApp?.destroy();
  const scriptUrl = document.currentScript.src;
  const controller = new AbortController(), signal = controller.signal;
  let workbook, datasets;
  let editor, theme, layout, zoom, navigation, menus, design, token = '', destroyed = false;
  let operationChain = Promise.resolve(), pendingOperations = 0;
  const scriptLoads = new Map(), dirtyModules = new Map();
  let backgroundSave, navigationEpoch=0, moduleChain=Promise.resolve(), modulePending=0;
  const currentNavigation=ticket=>ticket===undefined || ticket===navigationEpoch;
  let settings = {}, preferenceChain = Promise.resolve();
  let dialogResolver = null, dialogFocus = null, noticeTimer;
  let lastStatus = '';
  const failures = [];

  function status(text) {
    lastStatus = text;
    clearTimeout(noticeTimer);
    if (!destroyed) root.querySelector('[data-status]').textContent = text;
  }
  // Delegated tooltip layer also covers buttons created later by PDF/slide editors.
  function installTooltips(){
    const tip=document.createElement('div');tip.className='opendoc-tooltip';
    tip.setAttribute('role','tooltip');tip.hidden=true;root.append(tip);
    let current=null,timer=null;
    const hide=()=>{clearTimeout(timer);timer=null;current=null;tip.hidden=true;};
    const control=element=>element?.closest?.('button,[role="button"],summary,select,input[type="color"]');
    const message=element=>{
      const value=element.getAttribute('data-tooltip')||element.getAttribute('aria-label')
        ||element.getAttribute('title')||element.textContent||'';
      return value.replace(/\s+/g,' ').trim().slice(0,220);
    };
    function schedule(element){
      if(!element||element.disabled||element.closest('[hidden]')){hide();return;}
      const value=message(element);
      if(!value){hide();return;}
      if(current===element)return;
      hide();current=element;
      timer=setTimeout(()=>{
        if(signal.aborted||!current?.isConnected)return;
        tip.textContent=value;tip.hidden=false;
        const scale=Number(root.style.getPropertyValue('--interface-zoom'))||1;
        const rect=element.getBoundingClientRect();
        const bounds=root.getBoundingClientRect();
        // Legacy Qt reports CSS zoom rectangles in layout pixels. Compare
        // relative positions within the app in either coordinate system.
        const ratio=root.clientWidth/(bounds.width || root.clientWidth || 1);
        const width=tip.offsetWidth,height=tip.offsetHeight;
        const left=Math.max(8,Math.min(window.innerWidth/scale-width-8,(rect.left-bounds.left+rect.width/2)*ratio-width/2));
        const bottom=(rect.bottom-bounds.top)*ratio;
        const top=bottom+height+10>window.innerHeight/scale
          ?Math.max(8,(rect.top-bounds.top)*ratio-height-8):bottom+8;
        tip.style.left=left+'px';tip.style.top=top+'px';
      },500);
    }
    root.addEventListener('pointerover',event=>schedule(control(event.target)),{signal});
    root.addEventListener('pointerout',event=>{
      if(current && (!event.relatedTarget||!current.contains(event.relatedTarget)))hide();
    },{signal});
    root.addEventListener('focusin',event=>schedule(control(event.target)),{signal});
    root.addEventListener('focusout',hide,{signal});
    root.addEventListener('pointerdown',hide,{signal});
    root.addEventListener('scroll',hide,{capture:true,signal});
    signal.addEventListener('abort',()=>{hide();tip.remove();},{once:true});
  }
  function report(name, error) {
    console.error('Open Doc: ' + name, error);
    failures.push({module: name, message: error.message});
    root.querySelector('[data-status]').textContent = 'Recurso indisponível: ' + name + '.';
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      if (!destroyed) root.querySelector('[data-status]').textContent = lastStatus;
    }, 4000);
  }
  async function auxiliary(name, global, file, create) {
    try {
      if (!window[global]) await loadScript(file);
      if (!destroyed) return create(window[global]);
    } catch (error) { report(name, error); }
  }
  async function request(path, data) {
    if(destroyed)throw Error('Janela encerrada.');
    if(data!==undefined){
      const result=await window.OpenDocRecovery.sendRequest?.(path,data,token);
      if(result?.handled)return result.value;
      if(destroyed)throw Error('Janela encerrada.');
    }
    const options = {headers: {'X-Open-Doc-Token': token}};
    if (data !== undefined) {
      options.method = 'POST';
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(data);
    }
    const response = await fetch('/api/open_doc/' + path, options);
    let result;
    try { result = await response.json(); } catch { console.error('Open Doc: resposta inválida',path,response.status); throw Error('Falha no servidor (HTTP '+response.status+'). Seu texto foi mantido.'); }
    if (!response.ok || result.error) {
      const error = Error(result.error || 'Não foi possível concluir a operação.');
      error.conflict = Boolean(result.conflict); throw error;
    }
    return result;
  }
  function persist(partial) {
    const task = preferenceChain.then(async () => {
      await request('settings', {settings: partial}); settings = {...settings, ...partial};
    });
    preferenceChain = task.catch(() => {}); return task;
  }
  function collapsed(value) {
    root.dataset.collapsed = String(value);
    root.querySelectorAll('[data-toggle]').forEach(button => {
      button.setAttribute('aria-expanded', String(!value));
      button.setAttribute('aria-label', value ? 'Expandir navegador' : 'Recolher navegador');
    });
  }
  async function toggleNavigator(force) {
    const previous = root.dataset.collapsed === 'true';
    const next = force === undefined ? !previous : !force;
    collapsed(next);
    try { await persist({sidebar_collapsed: next}); }
    catch (error) { collapsed(previous); status(error.message); }
  }
  function showView(home = false, refreshLibrary = true) {
    const wasHome = root.dataset.homeView === 'true' && root.dataset.workbookView !== 'true' && root.dataset.datasetView !== 'true';
    root.dataset.workbookView = 'false';
    root.dataset.datasetView = 'false';
    root.querySelector('[data-dataset]').hidden = true;
    root.querySelector('[data-workbook]').hidden = true;
    root.dataset.homeView = String(home);
    root.querySelector('[data-library]').hidden = !home;
    root.querySelector('[data-document-body]').hidden = home || root.dataset.documentKind==='fixed';
    design?.sync();
    zoom?.sync();
    if (home && !wasHome && refreshLibrary) refresh().catch(error => status(error.message));
    else if (!home) {
      layout?.measure(); editor?.refresh();
      // The view was hidden during document.load(). Fixed slides must only
      // compute fit-to-window once this canvas has measurable dimensions.
      root.dispatchEvent(new CustomEvent('open-doc:view-ready'));
    }
  }
  function operate(operation) {
    // Preserve clicks received while a save/import is awaiting I/O. Serialize
    // mutations so a late response cannot overwrite the next document.
    const run = async () => {
      if (!editor || destroyed) return;
      root.dataset.busy = 'true'; editor.setLocked(true);
      try { return await operation(); } catch (error) { status(error.message); }
      finally {
        pendingOperations--; root.dataset.busy = 'false';
        if (!destroyed) editor.setLocked(false);
      }
    };
    const immediate = pendingOperations++ === 0;
    const task = immediate ? run() : operationChain.then(run);
    operationChain = task.catch(() => {});
    return task;
  }
  function operateModule(operation) {
    const run=async()=>{
      try {if(!destroyed)return await operation();}
      catch(error){status(error.message);}
      finally {modulePending--;}
    };
    const immediate=modulePending++===0;
    const task=immediate?run():moduleChain.then(run);
    moduleChain=task.catch(()=>{});return task;
  }
  async function refresh() {
    const data = await request('files');
    if (destroyed) return;
    for (const [selector, items, notes] of [
      ['[data-documents]', data.documents, true], ['[data-files]', data.files, false]
    ]) {
      const list = root.querySelector(selector); list.replaceChildren();
      if (!items.length) {
        const empty = document.createElement('li'); empty.className='library-empty'; empty.textContent = notes ? 'Nenhum documento salvo.' : 'Nenhum arquivo importado.'; list.append(empty);
      }
      for (const file of items) {
        const row = document.createElement('li'); row.className='library-row';
        row.dataset.fileFormat = notes ? String(file.source_kind || 'docx').toLowerCase() : String(file.type || file.name?.split('.').pop() || 'docx').toLowerCase();
        const icon = document.createElement('span'); icon.className = 'library-file-icon'; icon.textContent = row.dataset.fileFormat.toUpperCase();
        const info = document.createElement('div'); info.className='library-file-main';
        const editable=notes || Boolean(file.capabilities?.open);
        const name = document.createElement(editable ? 'button' : 'span'); name.className='library-file-title'; name.textContent = notes ? file.title : file.name; name.title=name.textContent;
        if (editable) name.addEventListener('click', () => {
          const ticket=++navigationEpoch;
          if(file.source_kind==='xlsx' || file.workbook)return operateModule(async()=>{
            if(root.dataset.workbookView==='true')await workbook.save();
            return openWorkbook({operation:'open',id:file.id},null,ticket);
          });
          return operate(async()=>{
            await editor.flush();
            const opened=await request('document/open',notes?{id:file.id}:{path:file.path});
            if(opened.workbook){await openWorkbook(null,opened.workbook,ticket);return;}editor.load(opened);
            if(currentNavigation(ticket))showView(false);
          });
        }, {signal});
        const date = document.createElement('small'); date.className='library-file-meta';
        date.textContent = notes ? new Date(file.updated_at).toLocaleString('pt-BR') : editable ? 'Abrir como novo documento' : 'Arquivo importado · leitura ainda não disponível';
        info.append(name, date);
        const kind = document.createElement('span'); kind.className = 'library-file-kind'; kind.textContent = notes ? (file.source_kind==='pptx'?'Apresentação local':file.source_kind==='pdf'?'PDF local':file.source_kind==='xlsx'?'Planilha local':'Documento local') : file.type.toUpperCase();
        row.append(icon, info, kind);
        if(notes && file.source_kind !== 'xlsx'){const details=document.createElement('details'),summary=document.createElement('summary');details.className='library-file-actions';summary.textContent='⋯';summary.setAttribute('aria-haspopup','menu');summary.setAttribute('aria-expanded','false');summary.setAttribute('aria-label','Ações de '+file.title);details.appendChild(summary);const menu=document.createElement('div');menu.className='document-action-menu';menu.setAttribute('role','menu');details.appendChild(menu);
          for(const [operation,label] of [['rename','Renomear'],['duplicate','Duplicar'],['delete','Excluir']]){const button=document.createElement('button');button.textContent=label;button.setAttribute('role','menuitem');if(operation==='delete'){button.className='danger-action';menu.appendChild(document.createElement('hr'));}button.addEventListener('click',()=>operate(async()=>{
            await editor.flush();let payload={id:file.id,revision:file.id===editor.snapshot().id?editor.snapshot().revision:file.revision};
            if(operation==='rename'){const value=await dialog('Renomear documento','Informe o novo título.',true);if(!value)return;payload.title=value;}
            if(operation==='delete'){if(!await dialog('Excluir documento','Excluir “'+file.title+'”? O arquivo importado original será preservado.'))return;payload.confirmed=true;}
            const result=await request('document/'+operation,payload);
            if(operation==='duplicate' || file.id===editor.snapshot().id){if(operation==='delete')editor.load(await request('document/new',{title:'Sem título'}));else editor.load(result);}
            await refresh();status(operation==='delete'?'Documento excluído.':'Documento atualizado.');
          }),{signal});menu.appendChild(button);}row.appendChild(details);}
        list.append(row);
      }
    }
    renderTemplates(data.templates || []);
    design?.refreshLibrary();
  }
  let previewObserver, previewDisposers = [], previewScript, previewRequests = new Map();
  async function paintTemplate(target, template, width) {
    try {
      if (!previewScript) previewScript = (async()=>{
        if (!window.OpenDocTemplatePreview) await loadScript('template_preview.js');
        if (!window.OpenDocWorkbookFormula) await loadScript('workbook_formula.js');
      })().catch(error=>{previewScript=null;throw error;});
      await previewScript;
      if (!previewRequests.has(template.id)) {
        previewRequests.set(template.id, request('template/preview',{id:template.id})
          .finally(()=>previewRequests.delete(template.id)));
      }
      const value = await previewRequests.get(template.id);
      if (!target.isConnected || destroyed) return;
      const dispose = await window.OpenDocTemplatePreview.render(target,value,{
        width,request,asset:name=>new URL(name,scriptUrl).href
      });
      if (dispose) {
        if (target.isConnected && !destroyed) previewDisposers.push(dispose);
        else dispose();
      }
    } catch (error) {
      target.textContent = 'Prévia indisponível. '+error.message;
    }
  }
  function renderTemplates(templates) {
    const grid = root.querySelector('[data-templates]');
    previewObserver?.disconnect();
    for (const dispose of previewDisposers.splice(0)) dispose();
    previewObserver = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries=>{
      for (const entry of entries) if (entry.isIntersecting) {
        previewObserver.unobserve(entry.target);
        const card=entry.target.closest('[data-template-id]');
        paintTemplate(entry.target,{id:card.dataset.templateId}, Number(entry.target.dataset.previewWidth));
      }
    }) : null;
    grid.replaceChildren();
    const categories = root.querySelector('[data-template-category]');
    const previous = categories.value;
    categories.replaceChildren(new Option('Todas', ''));
    for (const category of [...new Set(templates.map(template => template.category))].sort((a,b) => a.localeCompare(b, 'pt-BR'))) {
      categories.add(new Option(category, category));
    }
    categories.value = [...categories.options].some(option => option.value === previous) ? previous : '';
    for (const template of templates) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'template-card';
      card.dataset.templateId = template.id;
      card.dataset.fileFormat = template.format;
      card.dataset.category = template.category;
      card.dataset.search = [template.title, template.category, template.format, ...template.sections.flat()].join(' ');
      const preview = document.createElement('span');
      preview.className = 'template-preview';
      preview.setAttribute('aria-hidden', 'true');
      preview.textContent = 'Prévia visual';
      preview.dataset.previewWidth = ['docx','pdf'].includes(template.format) ? '100' : '220';
      const title = document.createElement('strong');
      title.textContent = template.title;
      const meta = document.createElement('small');
      meta.textContent = template.format.toUpperCase() + ' · ' + template.category;
      card.append(preview, title, meta);
      card.addEventListener('click', () => operate(async () => {
        const confirm = root.querySelector('[data-dialog-confirm]');
        const label = confirm.textContent;
        const decision = dialog(template.title, meta.textContent);
        const visual = document.createElement('div');
        visual.className = 'template-preview template-preview-expanded';
        visual.textContent = 'Renderizando prévia…';
        root.querySelector('[data-dialog-body]').append(visual);
        if (typeof IntersectionObserver === 'function') paintTemplate(visual,template,360);
        else visual.textContent = template.sections.map(([,text])=>text).join(' · ');
        confirm.textContent = 'Usar template';
        const accepted = await decision;
        confirm.textContent = label;
        if (!accepted) return;
        const ticket=++navigationEpoch;
        if(template.format==='xlsx')saveDocumentInBackground();else await editor.flush();
        if (template.format === 'xlsx' && template.id.startsWith('sheet-')) return openWorkbook({operation:'template', template:template.id},null,ticket);
        const copy = await request('document/template', {id: template.id});
        if (template.format === 'xlsx') return openWorkbook(null,copy,ticket);
        editor.load(copy);
        if(currentNavigation(ticket))showView(false);
        status('Cópia criada a partir do template.');
      }), {signal});
      grid.append(card);
      previewObserver?.observe(preview);
    }
  }
  function libraryRoute(route = 'home', section) {
    showView(true);
    design?.navigateLibrary(route, section);
  }
  function moduleDirty(name,value) {
    dirtyModules.set(name,Boolean(value));
    const dirty=[...dirtyModules.values()].some(Boolean);
    if(root.dataset.globalDirty===String(dirty))return;
    root.dataset.globalDirty=String(dirty);
    window.pywebview?.api?.set_dirty?.(dirty)?.catch?.(()=>{});
  }
  function saveDocumentInBackground() {
    if(!backgroundSave)backgroundSave=Promise.resolve().then(()=>editor.flush())
      .catch(error=>status('Documento com alterações pendentes: '+error.message))
      .finally(()=>{backgroundSave=null;});
  }
  function loadResources(resources) {
    return Promise.all(resources.map(([global, file]) => window[global] ? null : loadScript(file)));
  }
  function loadCodeEditors() {
    return loadResources([
      ['OpenDocCodeVendor','vendor/code-editor.bundle.js'],
      ['OpenDocCodeEditor','code_editor.js'],['OpenDocCodeNotebook','code_notebook.js']
    ]);
  }
  const gridResources = [
    ['OpenDocGridWorkspace','grid_workspace.js'],
    ['OpenDocWorkbookPivot','workbook_pivot.js'],
    ['OpenDocWorkbookTypes','workbook_types.js'],
    ['OpenDocPythonPackages','python_packages.js']
  ];
  async function openDatasets(ticket) {
    const host = root.querySelector('[data-dataset]');
    saveDocumentInBackground();
    await Promise.all([!datasets && Promise.all([
      loadResources([...gridResources,['OpenDocDatasets','datasets.js']]), loadCodeEditors()
    ])]);
    if (!datasets) datasets = window.OpenDocDatasets.create({host,request,signal,
      onOpenWorkbook:value=>{const ticket=++navigationEpoch;return operateModule(()=>openWorkbook(null,value,ticket));}});
    if(!currentNavigation(ticket))return;
    showView(true, false);
    root.dataset.datasetView = 'true';
    root.querySelector('[data-library]').hidden = true;
    host.hidden = false;
    zoom?.sync();
    await datasets.load();
  }
  async function openWorkbook(data, existing, ticket) {
    const host = root.querySelector('[data-workbook]');
    saveDocumentInBackground();
    await Promise.all([!workbook && loadResources([...gridResources,
      ['OpenDocWorkbookFormula','workbook_formula.js'],
      ['OpenDocWorkbookPivotUI','workbook_pivot_ui.js'],['OpenDocWorkbookObjects','workbook_objects.js'],['OpenDocWorkbook','workbook.js']
    ])]);
    if (!workbook) workbook = window.OpenDocWorkbook.create({host,request,dialog,signal,loadCodeEditors,settings,persist,onDirty:value=>moduleDirty('workbook',value)});
    const value = existing || (data ? await request('workbook',data) : await window.pywebview.api.import_workbook());
    if (value.error) throw Error(value.error);
    if (value.cancelled) return;
    if(!currentNavigation(ticket)){workbook.load(value);return;}
    showView(true, false);
    root.dataset.workbookView = 'true';
    root.querySelector('[data-library]').hidden = true;
    host.hidden = false;
    workbook.load(value);
    zoom?.sync();
  }
  async function saveTemplate(fromWorkbook=false) {
    if (fromWorkbook) await workbook.save();
    else await editor.flush();
    const title=await dialog('Salvar como template','Informe o nome do modelo pessoal.',true);
    if (!title) return;
    await request('template/save',{id:fromWorkbook ? workbook.id() : editor.snapshot().id,
      title,workbook:fromWorkbook});
    if (fromWorkbook) workbook.report('Template salvo em Meus templates.');
    else status('Template salvo em Meus templates.');
  }
  async function leaveWorkbook() {
    try {
      await workbook.save();
      libraryRoute('xlsx','recent');
    } catch (error) {
      workbook.report(error.message);
    }
  }
  async function newDocument(ticket) {
    await editor.flush(); editor.load(await request('document/new', {title: 'Documento sem título'}));
    if(!currentNavigation(ticket))return;
    showView(false); root.querySelector('[data-title]').focus(); root.querySelector('[data-title]').select();
  }
  async function newPresentation(ticket) {
    await editor.flush();
    const document=await request('document/new',{content_format:'opendoc-presentation-v1',title:'Nova apresentação'});
    editor.load(document);if(!currentNavigation(ticket))return;showView(false);status('Apresentação criada. Adicione textos e formas aos slides.');
  }
  async function importDocument(ticket) {
    await editor.flush();
    status("Abrindo documento…");
    const result = await window.pywebview.api.import_document();
    if (result.error) throw Error(result.error);
    if (result.cancelled) return;
    if(result.workbook){await openWorkbook(null,result.workbook,ticket);return;}
    if(result.document){editor.load(result.document);editor.setMode('rich');if(!currentNavigation(ticket))return;showView(false);status(result.document.conversion_warnings?.join(' ')||'Documento importado.');return;}
    showView(true); status('Arquivo importado: ' + result.name);
  }
  function closeDialog(value = null) {
    const backdrop = root.querySelector('[data-dialog]');
    backdrop.querySelector('.dialog')?.classList.remove('dialog-table','dialog-help','dialog-equation','dialog-history');
    // QtWebEngine (Chromium 83) must not rely solely on the [hidden]
    // attribute when a component stylesheet sets display:grid.
    backdrop.hidden = true;
    backdrop.style.display = 'none';
    const resolve = dialogResolver; dialogResolver = null;
    const previousFocus = dialogFocus; dialogFocus = null;
    if(previousFocus?.isConnected)previousFocus.focus();
    resolve?.(value);
  }
  function dialog(title, text, input = false, selection = null, options = {}) {
    if (dialogResolver) closeDialog();
    editor.capture(); dialogFocus = document.activeElement;
    root.querySelector('[data-dialog-title]').textContent = title;
    const body = root.querySelector('[data-dialog-body]'); body.replaceChildren();
    const paragraph = document.createElement('p'); paragraph.textContent = text; body.append(paragraph);
    root.querySelector('[data-dialog-label]').hidden = !input;
    const field = root.querySelector('[data-dialog-input]'); field.value = options.initial || '';
    field.type = options.type || 'url';
    root.querySelector('[data-dialog-label]').firstChild.textContent = options.label || 'Endereço ';
    if (selection) {
      const label = document.createElement('label'); label.textContent = 'Tema da interface';
      const select = document.createElement('select'); select.dataset.dialogSelect = '';
      for (const [value, text] of [['light', 'Claro'], ['dark', 'Escuro'], ['system', 'Automático (tema do sistema)']]) {
        const option = document.createElement('option'); option.value = value; option.textContent = text; select.append(option);
      }
      select.value = selection; label.append(select); body.append(label);
    }
    const backdrop = root.querySelector('[data-dialog]');
    backdrop.style.display = 'grid';
    backdrop.hidden = false;
    (input ? field : body.querySelector('select') || root.querySelector('[data-dialog-confirm]')).focus();
    return new Promise(resolve => { dialogResolver = resolve; });
  }
  async function refreshFonts(){
    const catalog=await window.pywebview.api.get_font_catalog(),select=root.querySelector('[data-font-family]'),value=select.value;
    select.replaceChildren();for(const family of catalog.fonts){const option=document.createElement('option');option.value=family;option.textContent=family;select.appendChild(option);}select.value=value;updateToolbar();root.dispatchEvent(new CustomEvent('open-doc:fonts'));return catalog;
  }
  async function fontManager(){
    const catalog=await refreshFonts(),promise=dialog('Fontes importadas','A remoção afeta somente fontes importadas no Open Doc.');const body=root.querySelector('[data-dialog-body]');
    for(const font of catalog.imported || []){const row=document.createElement('p'),button=document.createElement('button');row.textContent=font.family+' — '+font.style+' ';button.textContent='Remover';button.addEventListener('click',async()=>{const result=await window.pywebview.api.remove_font(font.id);if(result.error)status(result.error);else{row.remove();await refreshFonts();}},{signal});row.appendChild(button);body.appendChild(row);}await promise;
  }
  async function pageSetupDialog(){
    const metrics=editor.pagination()?.metrics() || window.OpenDocPagination.defaults,promise=dialog('Configuração da página','Dimensões e margens em centímetros.');const body=root.querySelector('[data-dialog-body]');
    const fields={};
    function select(label,name,options,value){const row=document.createElement('label'),field=document.createElement('select');row.textContent=label+' ';for(const [v,l] of options){const option=document.createElement('option');option.value=v;option.textContent=l;field.appendChild(option);}field.value=value;fields[name]=field;row.appendChild(field);body.appendChild(row);return field;}
    const size=select('Tamanho','size',[['a4','A4'],['letter','Carta'],['legal','Ofício'],['custom','Personalizado']],'custom');
    const orientation=select('Orientação','orientation',[['portrait','Retrato'],['landscape','Paisagem']],metrics.page_width_pt>metrics.page_height_pt?'landscape':'portrait');
    for(const [key,label] of [['page_width_pt','Largura'],['page_height_pt','Altura'],['margin_top_pt','Margem superior'],['margin_bottom_pt','Margem inferior'],['margin_left_pt','Margem esquerda'],['margin_right_pt','Margem direita']]){const row=document.createElement('label'),input=document.createElement('input');row.textContent=label+' ';input.type='number';input.min='0';input.step='0.1';input.value=(metrics[key]*2.54/72).toFixed(2);fields[key]=input;row.appendChild(input);body.appendChild(row);}
    function dimensions(){const preset={a4:[595.28,841.89],letter:[612,792],legal:[612,1008]}[size.value];if(preset){const values=orientation.value==='landscape'?preset.slice().reverse():preset;fields.page_width_pt.value=(values[0]*2.54/72).toFixed(2);fields.page_height_pt.value=(values[1]*2.54/72).toFixed(2);}else{const w=Number(fields.page_width_pt.value),h=Number(fields.page_height_pt.value);if((orientation.value==='landscape')!==(w>h)){fields.page_width_pt.value=h;fields.page_height_pt.value=w;}}}
    size.addEventListener('change',dimensions,{signal});orientation.addEventListener('change',dimensions,{signal});
    if(await promise){const values={orientation:orientation.value};for(const key of Object.keys(fields).filter(k=>k.endsWith('_pt')))values[key]=Number(fields[key].value)*72/2.54;editor.pageSetup(values);}
  }
  async function mathDialog(){
    const decision=dialog('Editar equação nativa','Digite a expressão LaTeX que substituirá a fórmula selecionada.');
    const body=root.querySelector('[data-dialog-body]');
    const input=document.createElement('textarea');
    input.rows=4;input.maxLength=2048;input.setAttribute('aria-label','Nova fórmula LaTeX');
    body.append(input);input.focus();
    if(!await decision)return null;
    return window.OpenDocMathParser.parseLatex(input.value);
  }
  async function tableDialog(options){
    if(!window.OpenDocTableInsertDialog)await loadScript('table_insert_dialog.js');
    const pending=window.OpenDocTableInsertDialog.TableInsertDialog.show({
      dialog,editor,status,root,...options
    });
    root.querySelector('[data-dialog] .dialog')?.classList.add('dialog-table');
    return pending;
  }
  async function action(name) {
    if (!editor) return;
    if (name === 'theme') {
      const value = await dialog('Configurações · Aparência', 'Escolha o tema da interface do Open Doc.', false, theme?.preference() || 'system');
      if (value) await theme?.set(value).catch(error => status(error.message));
      return;
    }
    const moduleNavigation = {
      home:ticket=>{if(currentNavigation(ticket))libraryRoute();}, new:newDocument, 'presentation-new':newPresentation,
      import:importDocument, datasets:openDatasets,
      'workbook-new':ticket=>openWorkbook({operation:'new'},null,ticket),
      'workbook-import':ticket=>openWorkbook(null,null,ticket),
      'library-recent':ticket=>{if(currentNavigation(ticket))libraryRoute('home','recent');},
      'library-files':ticket=>{if(currentNavigation(ticket))libraryRoute('home','imports');},
      'resume-editor':ticket=>{if(currentNavigation(ticket))showView(false);}
    };
    if (moduleNavigation[name]) {
      const ticket=++navigationEpoch;
      const run=async()=>{
        if (root.dataset.workbookView === 'true') await workbook.save();
        if(name==='home' || name==='library-recent' || name==='library-files')saveDocumentInBackground();
        return moduleNavigation[name](ticket);
      };
      return ['new','presentation-new','import'].includes(name)?operate(run):operateModule(run);
    }
    if (root.dataset.datasetView === 'true' || root.dataset.workbookView === 'true') {
      if (root.dataset.workbookView === 'true') {
        if (name === 'template-save') return operate(()=>saveTemplate(true));
        if (name === 'save') return workbook.save().catch(error=>workbook.report(error.message));
      }
      return;
    }
    const operations = {
      'page-break':()=>editor.insertPage('break'), 'blank-page':()=>editor.insertPage('below'),
      'page-setup':pageSetupDialog,
      pages:async()=>{editor.pageView('pages');await persist({view_mode:'pages'});},
      continuous:async()=>{editor.pageView('continuous');await persist({view_mode:'continuous'});},
      replace:async()=>{showView(false);await toggleNavigator(true);root.querySelector('[data-replacement]')?.focus();},
      'font-import':async()=>{const result=await window.pywebview.api.import_font();if(result.error)throw Error(result.error);if(!result.cancelled){await refreshFonts();status('Fontes importadas.');}},
      'font-refresh':refreshFonts,
      'font-manage':fontManager,
      'equation-insert':async()=>{
        if(root.dataset.documentKind==="fixed")
          return status("Abra um documento de texto para inserir uma equação.");
        if(!window.OpenDocEquationAssistant)await loadScript('equation_assistant.js');
        return window.OpenDocEquationAssistant.EquationAssistant.open({dialog,root,editor,status});
      },
      'image-insert':()=>{
        if(root.dataset.documentKind==='fixed')return status('Abra um documento de texto para inserir uma imagem.');
        editor.capture();
        const imageDocumentId=editor.snapshot().id;
        let input=root.querySelector('[data-docx-image-input]');
        if(!input){input=document.createElement('input');input.type='file';input.hidden=true;
          input.accept='image/png,image/jpeg,image/webp';input.dataset.docxImageInput='';root.appendChild(input);}
        input.value='';
        input.onchange=async()=>{
          const file=input.files?.[0];if(!file)return;
          try{
            status('Inserindo imagem…');
            if(file.size>4*1024*1024)throw Error('A imagem deve ter no máximo 4 MB.');
            const data=await new Promise((resolve,reject)=>{const reader=new FileReader();
              reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Não foi possível ler a imagem.'));
              reader.readAsDataURL(file);});
            if(editor.snapshot().id!==imageDocumentId)return status('O documento mudou; insira a imagem novamente.');
            await editor.insertImage(data,file.name);
          }catch(error){status(error.message);}
        };
        input.click();
      },
      'table-insert':()=>root.dataset.documentKind==='fixed'
        ? editor.insertTable() : tableDialog(),

      new: () => operate(newDocument), 'presentation-new': () => operate(newPresentation), import: () => operate(importDocument),
      home: () => operate(()=>libraryRoute()),
      datasets: () => operate(openDatasets),
      'template-save': () => operate(()=>saveTemplate()),
      'workbook-new': () => operate(()=>openWorkbook({operation:'new'})),
      'workbook-import': () => operate(()=>openWorkbook()),
      'resume-editor': () => operate(()=>showView(false)),
      'library-recent':()=>operate(()=>libraryRoute('home','recent')),
      'library-files':()=>operate(()=>libraryRoute('home','imports')),
      save: async()=>{
        status('Salvando…');
        try{
          await editor.flush();
          status('Documento salvo na biblioteca local. Use Arquivo > Exportar para escolher a pasta e o formato.');
        }catch(error){
          status('Falha ao salvar: '+error.message);
        }
      },
      'default-apps': () => operate(async () => {
        const result = await window.pywebview.api.default_apps();
        if (result.error) throw Error(result.error);
        if (result.opened) {
          status('Nas Configurações do Windows, escolha Open Doc para PDF, DOCX ou PPTX.');
          return;
        }
        const answer = dialog('Aplicativo padrão', 'Escolha o formato que deve abrir com o Open Doc.');
        const label = document.createElement('label');
        label.textContent = 'Formato';
        const select = document.createElement('select');
        select.dataset.dialogSelect = '';
        const placeholder = new Option('Selecione um formato', '');
        placeholder.disabled = true;
        placeholder.selected = true;
        select.append(placeholder);
        for (const extension of result.extensions) select.add(new Option(extension.toUpperCase(), extension));
        label.append(select);
        root.querySelector('[data-dialog-body]').append(label);
        select.focus();
        if (!(await answer) || !select.value) return;
        const selected = await window.pywebview.api.default_apps(select.value);
        if (selected.error) throw Error(selected.error);
        status('Open Doc definido como padrão para ' + selected.selected.toUpperCase() + '.');
      }),
      'version-history': () => operate(async () => {
        if (!window.OpenDocVersionHistory) await loadScript('version_history.js');
        await window.OpenDocVersionHistory.open({
          root, editor, request, dialog, close: closeDialog, status,
          iconUrl: new URL('../icons.svg', scriptUrl).href
        });
      }),
      copy: () => operate(() => editor.copy()),
      navigator: () => toggleNavigator(),
      'zoom-reset': () => zoom?.reset(),
      find: async () => {
        if (root.dataset.homeView === 'true') {
          root.querySelector('[data-library-search]')?.focus();
          return;
        }
        if (editor.find?.()) return;
        await toggleNavigator(true);
        navigation?.focus();
      },
      link: async () => {
        editor.capture();const selection=editor.snapshot().selection;
        const value = await dialog('Inserir link', 'Selecione o texto e informe um endereço. São aceitos HTTPS, HTTP e e-mail.', true);
        if (!value) return;
        if (!/^(https?:\/\/|mailto:)/i.test(value)) { status('Endereço inválido. Use https://, http:// ou mailto:.'); return; }
        editor.restoreSelection(selection);editor.format('link', value);
      },
      'help-center':async()=>{
        if(!window.OpenDocHelpCenter)await loadScript('help_center.js');
        return window.OpenDocHelpCenter.HelpCenter.open({
          dialog,root,kind:root.dataset.sourceKind
        });
      },
      shortcuts: () => dialog('Atalhos de teclado', 'Ctrl+N: novo · Ctrl+O: importar · Ctrl+S: salvar · Ctrl+B: negrito · Ctrl+I: itálico · Ctrl+Z: desfazer · Ctrl+Y ou Ctrl+Shift+Z: refazer · Ctrl+F: localizar · Ctrl++: aumentar zoom · Ctrl+-: reduzir zoom · Ctrl+0: restaurar zoom. Copiar, recortar e colar usam os atalhos do sistema.'),
      about: () => dialog('Open Doc', 'Editor desktop local construído com o Vela Framework. Edição rica, páginas e exportação nativa. O layout pode diferir do Microsoft Word.')
    };
    try { await operations[name]?.(); } catch (error) { status(error.message); }
  }
  function updateToolbar() {
    const state = editor?.commandState() || {};
    const text=editor?.textState()||{};
    const pressed={bold:text.bold,italic:text.italic,underline:text.underline&&text.underline!=='none',
      strike:text.strike,superscript:text.vertical_align==='superscript',subscript:text.vertical_align==='subscript'};
    for(const [name,value] of Object.entries(pressed))
      root.querySelectorAll('[data-command="'+name+'"][aria-pressed]').forEach(button=>
        button.setAttribute('aria-pressed',String(Boolean(value))));
    if(editor?.textState){for(const control of root.querySelectorAll('[data-inline-style]')){
      if(document.activeElement===control)continue;const value=text[control.dataset.inlineStyle];if(value==null)continue;
      if(control.hasAttribute('data-font-family') && !Array.from(control.options).some(o=>o.value===value)){const option=document.createElement('option');option.value=value;option.textContent=value+' (não instalada)';control.appendChild(option);}
      control.value=control.type==='color'?'#'+value:value;
    }}
    const select = root.querySelector('[data-paragraph]');
    if (select && document.activeElement !== select && state.paragraph) select.value = state.paragraph;
  }
  function loadScript(name) {
    if (destroyed) return Promise.resolve();
    if (scriptLoads.has(name)) return scriptLoads.get(name);
    const script = document.createElement('script'); script.src = new URL(name, scriptUrl).href;
    const task = new Promise((resolve, reject) => {
      script.onload = () => { script.remove(); resolve(); };
      script.onerror = () => {
        script.remove(); scriptLoads.delete(name);
        reject(Error('Não foi possível carregar os recursos locais.'));
      };
      document.body.append(script);
    });
    scriptLoads.set(name, task);
    return task;
  }
  const page = {
    destroy() {
      previewObserver?.disconnect();
      for (const dispose of previewDisposers.splice(0)) dispose();
      editor?.destroy(); window.OpenDocRecovery.destroy?.(); design?.destroy(); destroyed = true; controller.abort(); clearTimeout(noticeTimer);
      if (dialogResolver) closeDialog();
    },
    action, showHome: () => action('home'), editor: () => editor,
    failures, theme: () => theme, layout: () => layout, refresh, status
  };
  window.OpenDocApp = page;
  window.VelaPage = {beforeUnmount: () => page.destroy()};

  async function mount() {
    for (const [global, file] of [
      ['OpenDocCompat', 'compat.js'], ['marked', 'vendor/marked.js'], ['DOMPurify', 'vendor/purify.js'],
      ['TurndownService', 'vendor/turndown.js'], ['OpenDocCommands', 'editor_commands.js'],
      ['OpenDocHistory', 'history.js'], ['OpenDocRecovery', 'recovery.js'],
      ['OpenDocModel','document_model.js'],['OpenDocRichRenderer','rich_renderer.js'],['OpenDocRichSerializer','rich_serializer.js'],['OpenDocFormatting','formatting.js'],['OpenDocTables','tables.js'],['OpenDocPopovers','popovers.js'],['OpenDocPagination','pagination.js'],['OpenDocLogicalTransactions','logical_transactions.js'],['OpenDocPageMenu','page_menu.js'],['OpenDocEditor','editor.js'],['OpenDocFreehand','vendor/freehand.bundle.js'],['OpenDocPdf','vendor/pdf.bundle.js'],['OpenDocPptxVendor','vendor/pptx.bundle.js'],['OpenDocPptx','pptx_renderer.js'],['OpenDocSemanticAnnotations','semantic_annotations.js'],['OpenDocSlideCharts','slide_charts.js'],['OpenDocMathParser','native_math_parser.js'],['OpenDocMathGallery','math_gallery.js'],['OpenDocSlidesEditor','slide_editor.js'],['OpenDocFixedDocument','fixed_document.js'],['OpenDocDocumentKinds','document_kinds.js'],['OpenDocInkEngine','ink_engine.js'],['OpenDocOfficeWorkspace','office_workspace.js'],['OpenDocInk','ink.js']
    ]) if (!window[global]) await loadScript(file);
    if (destroyed) return;
    const bootstrap = await window.pywebview.api.get_bootstrap();
    if (destroyed) return;
    if (bootstrap.error) throw Error(bootstrap.error);
    if(bootstrap.assets){const response=await fetch(new URL('vendor/vendor-manifest.json',scriptUrl));if(!response.ok)throw Error('Manifesto local ausente. Execute npm run build.');const manifest=await response.json();if(manifest.build_hash!==bootstrap.assets.build_hash || window.OpenDocPdf?.version!==manifest.versions['pdfjs-dist'])throw Error('Recursos locais desatualizados. Execute npm run build.');console.info('Open Doc runtime',{ua:navigator.userAgent,pdfjs:window.OpenDocPdf.version,vendor:manifest.build_hash,structuredClone:typeof window.structuredClone,pointerEvents:typeof window.PointerEvent});}
    token = bootstrap.token; settings = bootstrap.settings;
    collapsed(settings.sidebar_collapsed);
    window.OpenDocRecovery.configure?.(new URL('persistence_worker.js',scriptUrl).href);
    editor = window.OpenDocDocumentKinds.create({root, request, status, token, signal, tableDialog, mathDialog, onDirty:value=>moduleDirty('document',value), asset:name=>new URL(name,scriptUrl).href, document: bootstrap.document, viewMode: settings.view_mode, autosaveSeconds: bootstrap.autosave_seconds});
    window.OpenDocInk.create({root,editor,status,signal});
    root.addEventListener('open-doc:page-setup',()=>action('page-setup'),{signal});
    root.querySelectorAll('[data-table-op]').forEach(button=>button.addEventListener('click',()=>{try{editor.tableOperation(button.dataset.tableOp);}catch(error){status(error.message);}},{signal}));
    window.OpenDocPopovers.bind(root, signal);
    // Selection and command bindings are essential, independent of side panels.
    function preserveSelection(event) {
      if (event.target.closest('[data-menu], [data-command], [data-action="link"], .toolbar select, .toolbar input, .toolbar button')) editor.capture();
      if (event.type === 'mousedown' && event.target.closest('.toolbar button')) event.preventDefault();
    }
    root.addEventListener('pointerdown', preserveSelection, {signal});
    root.addEventListener('mousedown', preserveSelection, {signal});
    root.addEventListener('click', event => {
      const button = event.target.closest('button'); if (!button || button.disabled) return;
      if (button.hasAttribute('data-action')) action(button.dataset.action);
      else if (button.hasAttribute('data-command')) { editor.format(button.dataset.command); updateToolbar(); }
      else if (button.hasAttribute('data-mode')) editor.setMode(button.dataset.mode);
      else if (button.hasAttribute('data-export')) operate(() => editor.export(button.dataset.export));
      else if (button.hasAttribute('data-new')) action('new');
      else if (button.hasAttribute('data-import')) action('import');
      else if (button.hasAttribute('data-new-presentation')) action('presentation-new');
      else if (button.hasAttribute('data-toggle')) toggleNavigator();
    }, {signal});
    function applyStyleControl(control) {
      const key=control.dataset.inlineStyle || control.dataset.paragraphStyle;let value=control.value;
      if(['font_size_pt','line_spacing','left_indent_pt','space_after_pt'].includes(key))value=Number(value);
      if(['color','highlight'].includes(key))value=value.replace('#','').toUpperCase();
      editor.style(control.hasAttribute('data-inline-style')?'inline':'paragraph',{[key]:value});
    }
    const fontSize=root.querySelector('[data-font-size]');
    let committedSize=null;
    fontSize.addEventListener('focus',()=>{
      editor.capture();
      committedSize=fontSize.value;
      fontSize.select();
    },{signal});
    function commitSize(){
      if(fontSize.value===committedSize)return;
      if(fontSize.value===''||fontSize.validity.rangeUnderflow||fontSize.validity.rangeOverflow){
        fontSize.value=committedSize??'12';
        return;
      }
      committedSize=fontSize.value;
      applyStyleControl(fontSize);
    }
    fontSize.addEventListener('keydown',event=>{
      if(event.key!=='Enter'||event.isComposing)return;
      event.preventDefault();
      commitSize();
    },{signal});
    root.querySelectorAll('[data-inline-style],[data-paragraph-style]').forEach(control=>
      control.addEventListener('change',()=>control===fontSize?commitSize():applyStyleControl(control),{signal}));
    root.querySelector('[data-paragraph]').addEventListener('change', event => { editor.format(event.target.value); updateToolbar(); }, {signal});
    document.addEventListener('selectionchange', updateToolbar, {signal});
    root.addEventListener('open-doc:content', updateToolbar, {signal});
    root.querySelector('[data-dialog-cancel]').addEventListener('click', event => {
      event.preventDefault();event.stopPropagation();closeDialog();
    }, {signal});
    root.querySelector('[data-dialog-confirm]').addEventListener('click', event => {
      event.preventDefault();event.stopPropagation();
      const value = root.querySelector('[data-dialog-select]')?.value || (root.querySelector('[data-dialog-label]').hidden ? true : root.querySelector('[data-dialog-input]').value.trim());
      closeDialog(value);
    }, {signal});
    root.addEventListener('keydown', event => {
      if (root.querySelector('[data-dialog]').hidden) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (root.querySelector('[data-dialog]').dataset.historyBusy !== 'true') closeDialog();
      }
      if (event.key === 'Tab') {
        const list = Array.from(root.querySelector('[data-dialog]').querySelectorAll('button,input,select')).filter(element => !element.disabled && !element.closest('[hidden]'));
        const index = list.indexOf(document.activeElement);
        if (event.shiftKey && index <= 0) { event.preventDefault(); list[list.length - 1]?.focus(); }
        else if (!event.shiftKey && index === list.length - 1) { event.preventDefault(); list[0]?.focus(); }
      }
    }, {signal});
    window.addEventListener('keydown',event=>{
      if(!(event.ctrlKey||event.metaKey)||event.altKey||event.shiftKey||
        event.key.toLowerCase()!=='s'||root.querySelector('[data-book-sidebar][open]')||!root.querySelector('[data-dialog]').hidden)return;
      event.preventDefault();
      event.stopPropagation();
      if(!event.repeat)action('save');
    },{capture:true,signal});
    window.addEventListener('keydown', event => {
      if (event.defaultPrevented || root.dataset.datasetView === 'true' || root.dataset.workbookView === 'true' || !(event.ctrlKey || event.metaKey) || !root.querySelector('[data-dialog]').hidden) return;
      const name = ({n: 'new', o: 'import', f: 'find'})[event.key.toLowerCase()];
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase()==='h') {event.preventDefault();action('replace');return;}
      if (name) { event.preventDefault(); action(name); }
    }, {signal});
    try{
      const catalog=await window.pywebview.api.get_font_catalog?.(),select=root.querySelector('[data-font-family]');
      if(catalog && select)for(const family of catalog.fonts){const option=document.createElement('option');option.value=family;option.textContent=family;option.style.fontFamily=JSON.stringify(family);select.appendChild(option);}
    }catch(error){console.error('Open Doc: fontes',error);}
    menus = await auxiliary('menus', 'OpenDocMenus', 'menus.js', module => module.create(root, editor.capture, signal));
    theme = await auxiliary('aparência', 'OpenDocTheme', 'theme.js', module => module.create(root, settings, persist, signal));
    layout = await auxiliary('zoom', 'OpenDocPaperLayout', 'paper_layout.js', module => module.create(root, settings, persist, signal, editor));
    if (layout) zoom = await auxiliary('controles de zoom', 'OpenDocZoom', 'zoom.js',
      module => module.create({root, settings, persist, status, paper: layout, editor, workbook: () => workbook, signal}));
    navigation = await auxiliary('navegação', 'OpenDocNavigation', 'navigation.js', module => module.create(root, editor, signal));
    design = await auxiliary('interface de documentos', 'OpenDocDesign', 'design_system.js', module => module.create({root,action,signal}));
    if (bootstrap.start_in_library) libraryRoute();
    else showView(false);
    window.OpenDocOfficeWorkspace.create({root,editor,signal,formats:bootstrap.formats||[],profiles:bootstrap.academic_profiles||[],action,status,dialog});
    installTooltips();
    if (bootstrap.startup_error) status(bootstrap.startup_error);
    root.dataset.ready = 'true';
  }
  mount().catch(error => { console.error('Open Doc: inicialização', error); status(error.message); });
})();
