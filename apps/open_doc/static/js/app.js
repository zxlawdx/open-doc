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
  let editor, theme, layout, navigation, menus, token = '', destroyed = false, busy = false;
  let settings = {}, preferenceChain = Promise.resolve();
  let dialogResolver = null, dialogFocus = null, noticeTimer;
  let lastStatus = '';
  const failures = [];

  function status(text) {
    lastStatus = text;
    clearTimeout(noticeTimer);
    if (!destroyed) root.querySelector('[data-status]').textContent = text;
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
    const options = data === undefined ? {} : {
      method: 'POST', headers: {'Content-Type': 'application/json', 'X-Open-Doc-Token': token},
      body: JSON.stringify(data)
    };
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
  function showView(home = false) {
    root.dataset.homeView = String(home);
    root.querySelector('[data-library]').hidden = !home;
    root.querySelector('[data-document-body]').hidden = home || root.dataset.documentKind==='fixed';
    if (home) refresh().catch(error => status(error.message));
    else { layout?.measure(); editor?.refresh(); }
  }
  async function operate(operation) {
    if (busy || !editor || destroyed) return;
    busy = true; editor.setLocked(true);
    try { await operation(); } catch (error) { status(error.message); }
    finally { busy = false; if (!destroyed) editor.setLocked(false); }
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
        const icon = document.createElement('span'); icon.className = 'library-file-icon'; icon.textContent = notes ? 'DOC' : file.type.toUpperCase();
        const info = document.createElement('div'); info.className='library-file-main';
        const editable=notes || Boolean(file.capabilities?.open);
        const name = document.createElement(editable ? 'button' : 'span'); name.className='library-file-title'; name.textContent = notes ? file.title : file.name; name.title=name.textContent;
        if (editable) name.addEventListener('click', () => operate(async () => {
          await editor.flush();
          editor.load(await request('document/open', notes ? {id: file.id} : {path: file.path}));
          showView(false);
        }), {signal});
        const date = document.createElement('small'); date.className='library-file-meta';
        date.textContent = notes ? new Date(file.updated_at).toLocaleString('pt-BR') : editable ? 'Abrir como novo documento' : 'Arquivo importado · leitura ainda não disponível';
        info.append(name, date);
        const kind = document.createElement('span'); kind.className = 'library-file-kind'; kind.textContent = notes ? 'Documento local' : file.type.toUpperCase();
        row.append(icon, info, kind);
        if(notes){const details=document.createElement('details'),summary=document.createElement('summary');details.className='library-file-actions';summary.textContent='⋯';summary.setAttribute('aria-haspopup','menu');summary.setAttribute('aria-expanded','false');summary.setAttribute('aria-label','Ações de '+file.title);details.appendChild(summary);const menu=document.createElement('div');menu.className='document-action-menu';menu.setAttribute('role','menu');details.appendChild(menu);
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
  }
  async function newDocument() {
    await editor.flush(); editor.load(await request('document/new', {title: 'Documento sem título'}));
    showView(false); root.querySelector('[data-title]').focus(); root.querySelector('[data-title]').select();
  }
  async function importDocument() {
    await editor.flush();
    status("Abrindo documento…");
    const result = await window.pywebview.api.import_document();
    if (result.error) throw Error(result.error);
    if (result.cancelled) return;
    if(result.document){editor.load(result.document);editor.setMode('rich');showView(false);status('Documento importado.');return;}
    showView(true); status('Arquivo importado: ' + result.name);
  }
  function closeDialog(value = null) {
    root.querySelector('[data-dialog]').hidden = true;
    const resolve = dialogResolver; dialogResolver = null;
    dialogFocus?.focus(); resolve?.(value);
  }
  function dialog(title, text, input = false, selection = null) {
    if (dialogResolver) closeDialog();
    editor.capture(); dialogFocus = document.activeElement;
    root.querySelector('[data-dialog-title]').textContent = title;
    const body = root.querySelector('[data-dialog-body]'); body.replaceChildren();
    const paragraph = document.createElement('p'); paragraph.textContent = text; body.append(paragraph);
    root.querySelector('[data-dialog-label]').hidden = !input;
    const field = root.querySelector('[data-dialog-input]'); field.value = '';
    if (selection) {
      const label = document.createElement('label'); label.textContent = 'Tema da interface';
      const select = document.createElement('select'); select.dataset.dialogSelect = '';
      for (const [value, text] of [['light', 'Claro'], ['dark', 'Escuro'], ['system', 'Usar tema do sistema']]) {
        const option = document.createElement('option'); option.value = value; option.textContent = text; select.append(option);
      }
      select.value = selection; label.append(select); body.append(label);
    }
    root.querySelector('[data-dialog]').hidden = false;
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
  async function action(name) {
    if (!editor) return;
    const operations = {
      'page-break':()=>editor.insertPage('break'), 'blank-page':()=>editor.insertPage('below'),
      'page-setup':pageSetupDialog,
      pages:async()=>{editor.pageView('pages');await persist({view_mode:'pages'});},
      continuous:async()=>{editor.pageView('continuous');await persist({view_mode:'continuous'});},
      replace:async()=>{showView(false);await toggleNavigator(true);root.querySelector('[data-replacement]')?.focus();},
      'font-import':async()=>{const result=await window.pywebview.api.import_font();if(result.error)throw Error(result.error);if(!result.cancelled){await refreshFonts();status('Fontes importadas.');}},
      'font-refresh':refreshFonts,
      'font-manage':fontManager,
      'table-insert':async()=>{const value=await dialog('Inserir tabela','Informe linhas × colunas (por exemplo, 3x4).',true);if(!value)return;const m=value.match(/^(\d+)\s*[x×]\s*(\d+)$/i);if(!m || +m[1]<1 || +m[2]<1 || +m[1]>100 || +m[2]>30)throw Error('Use de 1 a 100 linhas e de 1 a 30 colunas.');editor.tableOperation('insert',+m[1],+m[2]);},

      new: () => operate(newDocument), import: () => operate(importDocument),
      home: () => { showView(true); }, save: () => operate(() => editor.flush()),
      copy: () => operate(() => editor.copy()),
      navigator: () => toggleNavigator(),
      'zoom-reset': () => layout?.set(100),
      find: async () => { showView(false); if(editor.find?.())return;await toggleNavigator(true); navigation?.focus(); },
      link: async () => {
        editor.capture();const selection=editor.snapshot().selection;
        const value = await dialog('Inserir link', 'Selecione o texto e informe um endereço. São aceitos HTTPS, HTTP e e-mail.', true);
        if (!value) return;
        if (!/^(https?:\/\/|mailto:)/i.test(value)) { status('Endereço inválido. Use https://, http:// ou mailto:.'); return; }
        editor.restoreSelection(selection);editor.format('link', value);
      },
      theme: async () => {
        const value = await dialog('Aparência', 'O papel permanece branco nos temas claro e escuro.', false, theme?.preference() || 'system');
        if (value) await theme?.set(value);
      },
      shortcuts: () => dialog('Atalhos de teclado', 'Ctrl+N: novo · Ctrl+O: importar · Ctrl+S: salvar · Ctrl+B: negrito · Ctrl+I: itálico · Ctrl+Z: desfazer · Ctrl+Y ou Ctrl+Shift+Z: refazer · Ctrl+F: localizar. Copiar, recortar e colar usam os atalhos do sistema.'),
      about: () => dialog('Open Doc', 'Editor desktop local construído com o Vela Framework. Edição rica, páginas e exportação nativa. O layout pode diferir do Microsoft Word.')
    };
    try { await operations[name]?.(); } catch (error) { status(error.message); }
  }
  function updateToolbar() {
    const state = editor?.commandState() || {};
    for (const name of ['bold', 'italic']) root.querySelectorAll('[data-command="' + name + '"][aria-pressed]').forEach(button => button.setAttribute('aria-pressed', String(Boolean(state[name]))));
    if(editor?.textState){const state=editor.textState();for(const control of root.querySelectorAll('[data-inline-style]')){
      if(document.activeElement===control)continue;const value=state[control.dataset.inlineStyle];if(value==null)continue;
      if(control.hasAttribute('data-font-family') && !Array.from(control.options).some(o=>o.value===value)){const option=document.createElement('option');option.value=value;option.textContent=value+' (não instalada)';control.appendChild(option);}
      control.value=control.type==='color'?'#'+value:value;
    }}
    const select = root.querySelector('[data-paragraph]');
    if (select && document.activeElement !== select && state.paragraph) select.value = state.paragraph;
  }
  async function loadScript(name) {
    if (destroyed) return;
    const script = document.createElement('script'); script.src = new URL(name, scriptUrl).href;
    await new Promise((resolve, reject) => {
      script.onload = resolve; script.onerror = () => reject(Error('Não foi possível carregar os recursos locais.'));
      document.body.append(script);
    }); script.remove();
  }
  const page = {
    destroy() {
      editor?.destroy(); destroyed = true; controller.abort(); clearTimeout(noticeTimer);
      if (dialogResolver) closeDialog();
    },
    action, showHome: () => showView(true), editor: () => editor,
    failures, theme: () => theme, layout: () => layout, refresh, status
  };
  window.OpenDocApp = page;
  window.VelaPage = {beforeUnmount: () => page.destroy()};

  async function mount() {
    for (const [global, file] of [
      ['OpenDocCompat', 'compat.js'], ['marked', 'vendor/marked.js'], ['DOMPurify', 'vendor/purify.js'],
      ['TurndownService', 'vendor/turndown.js'], ['OpenDocCommands', 'editor_commands.js'],
      ['OpenDocHistory', 'history.js'], ['OpenDocRecovery', 'recovery.js'],
      ['OpenDocModel','document_model.js'],['OpenDocRichRenderer','rich_renderer.js'],['OpenDocRichSerializer','rich_serializer.js'],['OpenDocFormatting','formatting.js'],['OpenDocTables','tables.js'],['OpenDocPopovers','popovers.js'],['OpenDocPagination','pagination.js'],['OpenDocPageMenu','page_menu.js'],['OpenDocEditor','editor.js'],['OpenDocFreehand','vendor/freehand.bundle.js'],['OpenDocPdf','vendor/pdf.bundle.js'],['OpenDocPptxVendor','vendor/pptx.bundle.js'],['OpenDocPptx','pptx_renderer.js'],['OpenDocFixedDocument','fixed_document.js'],['OpenDocDocumentKinds','document_kinds.js'],['OpenDocInk','ink.js']
    ]) if (!window[global]) await loadScript(file);
    if (destroyed) return;
    const bootstrap = await window.pywebview.api.get_bootstrap();
    if (destroyed) return;
    if (bootstrap.error) throw Error(bootstrap.error);
    if(bootstrap.assets){const response=await fetch(new URL('vendor/vendor-manifest.json',scriptUrl));if(!response.ok)throw Error('Manifesto local ausente. Execute npm run build.');const manifest=await response.json();if(manifest.build_hash!==bootstrap.assets.build_hash || window.OpenDocPdf?.version!==manifest.versions['pdfjs-dist'])throw Error('Recursos locais desatualizados. Execute npm run build.');console.info('Open Doc runtime',{ua:navigator.userAgent,pdfjs:window.OpenDocPdf.version,vendor:manifest.build_hash,structuredClone:typeof window.structuredClone,pointerEvents:typeof window.PointerEvent});}
    token = bootstrap.token; settings = bootstrap.settings;
    collapsed(settings.sidebar_collapsed);
    editor = window.OpenDocDocumentKinds.create({root, request, status, token, signal, asset:name=>new URL(name,scriptUrl).href, document: bootstrap.document, viewMode: settings.view_mode, autosaveSeconds: bootstrap.autosave_seconds});
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
      else if (button.hasAttribute('data-toggle')) toggleNavigator();
    }, {signal});
    root.querySelectorAll('[data-inline-style],[data-paragraph-style]').forEach(control=>control.addEventListener('change',()=>{
      const key=control.dataset.inlineStyle || control.dataset.paragraphStyle;let value=control.value;
      if(['font_size_pt','line_spacing','left_indent_pt','space_after_pt'].includes(key))value=Number(value);
      if(['color','highlight'].includes(key))value=value.replace('#','').toUpperCase();
      editor.style(control.hasAttribute('data-inline-style')?'inline':'paragraph',{[key]:value});
    },{signal}));
    root.querySelector('[data-paragraph]').addEventListener('change', event => { editor.format(event.target.value); updateToolbar(); }, {signal});
    document.addEventListener('selectionchange', updateToolbar, {signal});
    root.addEventListener('open-doc:content', updateToolbar, {signal});
    root.querySelector('[data-dialog-cancel]').addEventListener('click', () => closeDialog(), {signal});
    root.querySelector('[data-dialog-confirm]').addEventListener('click', () => {
      const value = root.querySelector('[data-dialog-select]')?.value || (root.querySelector('[data-dialog-label]').hidden ? true : root.querySelector('[data-dialog-input]').value.trim());
      closeDialog(value);
    }, {signal});
    root.addEventListener('keydown', event => {
      if (root.querySelector('[data-dialog]').hidden) return;
      if (event.key === 'Escape') { event.preventDefault(); closeDialog(); }
      if (event.key === 'Tab') {
        const list = Array.from(root.querySelector('[data-dialog]').querySelectorAll('button,input,select')).filter(element => !element.closest('[hidden]'));
        const index = list.indexOf(document.activeElement);
        if (event.shiftKey && index <= 0) { event.preventDefault(); list[list.length - 1]?.focus(); }
        else if (!event.shiftKey && index === list.length - 1) { event.preventDefault(); list[0]?.focus(); }
      }
    }, {signal});
    window.addEventListener('keydown', event => {
      if (!(event.ctrlKey || event.metaKey) || !root.querySelector('[data-dialog]').hidden) return;
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
    layout = await auxiliary('zoom', 'OpenDocPaperLayout', 'paper_layout.js', module => module.create(root, settings, persist, signal));
    navigation = await auxiliary('navegação', 'OpenDocNavigation', 'navigation.js', module => module.create(root, editor, signal));
    showView(false);
    root.dataset.ready = 'true';
  }
  mount().catch(error => { console.error('Open Doc: inicialização', error); status(error.message); });
})();
