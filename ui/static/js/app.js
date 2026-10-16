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
  let dialogResolver = null, dialogFocus = null;

  function status(text) {
    if (!destroyed) root.querySelector('[data-status]').textContent = text;
  }
  async function request(path, data) {
    const options = data === undefined ? {} : {
      method: 'POST', headers: {'Content-Type': 'application/json', 'X-Open-Doc-Token': token},
      body: JSON.stringify(data)
    };
    const response = await fetch('/api/open_doc/' + path, options);
    let result;
    try { result = await response.json(); } catch { throw Error('O servidor não respondeu corretamente. Seu texto foi mantido.'); }
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
    root.querySelector('[data-document-body]').hidden = home;
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
        const empty = document.createElement('li'); empty.textContent = notes ? 'Nenhum documento salvo.' : 'Nenhum arquivo importado.'; list.append(empty);
      }
      for (const file of items) {
        const row = document.createElement('li');
        const icon = document.createElement('span'); icon.className = 'file-icon'; icon.textContent = notes ? 'DOC' : file.type.toUpperCase();
        const info = document.createElement('div');
        const editable = notes || ['md', 'txt'].includes(file.type);
        const name = document.createElement(editable ? 'button' : 'span'); name.textContent = notes ? file.title : file.name;
        if (editable) name.addEventListener('click', () => operate(async () => {
          await editor.flush();
          editor.load(await request('document/open', notes ? {id: file.id} : {path: file.path}));
          showView(false);
        }), {signal});
        const date = document.createElement('small');
        date.textContent = notes ? new Date(file.updated_at).toLocaleString('pt-BR') : editable ? 'Abrir como novo documento' : 'Arquivo importado · leitura ainda não disponível';
        info.append(name, date);
        const kind = document.createElement('span'); kind.className = 'file-kind'; kind.textContent = notes ? 'Documento local' : file.type.toUpperCase();
        row.append(icon, info, kind); list.append(row);
      }
    }
  }
  async function newDocument() {
    await editor.flush(); editor.load(await request('document/new', {title: 'Documento sem título'}));
    showView(false); root.querySelector('[data-title]').focus(); root.querySelector('[data-title]').select();
  }
  async function importDocument() {
    await editor.flush();
    const result = await window.pywebview.api.import_document();
    if (result.error) throw Error(result.error);
    if (result.cancelled) return;
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
  async function action(name) {
    if (!editor) return;
    const operations = {
      new: () => operate(newDocument), import: () => operate(importDocument),
      home: () => { showView(true); }, save: () => operate(() => editor.flush()),
      copy: () => operate(() => editor.copy()),
      navigator: () => toggleNavigator(),
      'zoom-reset': () => layout.set(100),
      find: async () => { showView(false); await toggleNavigator(true); navigation.focus(); },
      link: async () => {
        const value = await dialog('Inserir link', 'Selecione o texto e informe um endereço. São aceitos HTTPS, HTTP e e-mail.', true);
        if (!value) return;
        if (!/^(https?:\/\/|mailto:)/i.test(value)) { status('Endereço inválido. Use https://, http:// ou mailto:.'); return; }
        editor.format('link', value);
      },
      theme: async () => {
        const value = await dialog('Aparência', 'O papel permanece branco nos temas claro e escuro.', false, theme.preference());
        if (value) await theme.set(value);
      },
      shortcuts: () => dialog('Atalhos de teclado', 'Ctrl+N: novo · Ctrl+O: importar · Ctrl+S: salvar · Ctrl+B: negrito · Ctrl+I: itálico · Ctrl+Z: desfazer · Ctrl+Y ou Ctrl+Shift+Z: refazer · Ctrl+F: localizar. Copiar, recortar e colar usam os atalhos do sistema.'),
      about: () => dialog('Open Doc', 'Editor desktop local construído com o Vela Framework. Documento visual contínuo de largura A4. Exporta PDF, DOCX e Markdown. Não oferece paginação fiel ao Word nem edição direta de DOCX nesta versão.')
    };
    try { await operations[name]?.(); } catch (error) { status(error.message); }
  }
  function updateToolbar() {
    const state = editor?.commandState() || {};
    for (const name of ['bold', 'italic']) root.querySelectorAll('[data-command="' + name + '"][aria-pressed]').forEach(button => button.setAttribute('aria-pressed', String(Boolean(state[name]))));
    const select = root.querySelector('[data-paragraph]');
    if (select && state.paragraph) select.value = state.paragraph;
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
      editor?.destroy(); destroyed = true; controller.abort();
      if (dialogResolver) closeDialog();
    },
    action, showHome: () => showView(true), editor: () => editor,
    theme: () => theme, layout: () => layout, refresh, status
  };
  window.OpenDocApp = page;
  window.VelaPage = {beforeUnmount: () => page.destroy()};

  async function mount() {
    for (const [global, file] of [
      ['OpenDocCompat', 'compat.js'], ['marked', 'vendor/marked.js'], ['DOMPurify', 'vendor/purify.js'],
      ['TurndownService', 'vendor/turndown.js'], ['OpenDocCommands', 'editor_commands.js'],
      ['OpenDocHistory', 'history.js'], ['OpenDocRecovery', 'recovery.js'],
      ['OpenDocEditor', 'editor.js'], ['OpenDocMenus', 'menus.js'],
      ['OpenDocTheme', 'theme.js'], ['OpenDocPaperLayout', 'paper_layout.js'],
      ['OpenDocNavigation', 'navigation.js']
    ]) if (!window[global]) await loadScript(file);
    if (destroyed) return;
    const bootstrap = await window.pywebview.api.get_bootstrap();
    if (destroyed) return;
    if (bootstrap.error) throw Error(bootstrap.error);
    token = bootstrap.token; settings = bootstrap.settings;
    collapsed(settings.sidebar_collapsed);
    editor = window.OpenDocEditor.create({root, request, status, document: bootstrap.document, autosaveSeconds: bootstrap.autosave_seconds});
    theme = window.OpenDocTheme.create(root, settings, persist, signal);
    layout = window.OpenDocPaperLayout.create(root, settings, persist, signal);
    navigation = window.OpenDocNavigation.create(root, editor, signal);
    menus = window.OpenDocMenus.create(root, editor.capture, signal);
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
      if (name) { event.preventDefault(); action(name); }
    }, {signal});
    showView(false);
  }
  mount().catch(error => status(error.message));
})();
