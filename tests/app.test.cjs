/* Full app.js lifecycle regression. Native editing is verified separately in Qt. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const base = path.resolve(__dirname, '..');
async function mount(t, brokenNavigation = false) {
  const template = fs.readFileSync(path.join(base, 'apps/open_doc/templates/base.html'), 'utf8')
    .replace(/{{ (menus|toolbar|sidebar|editor|home) }}/g, (_, name) => fs.readFileSync(path.join(base, 'apps/open_doc/templates/' + name + '.html'), 'utf8'));
  const dom = new JSDOM(template, {url: 'http://localhost', runScripts: 'outside-only'});
  const w = dom.window, root = w.document.querySelector('[data-app]');
  delete w.Element.prototype.replaceChildren;
  const note = {id: 'note', title: 'Documento', markdown: '# Título\n\nTexto selecionado', revision: 1};
  w.pywebview = {api: {get_bootstrap: async () => ({token: 'test', settings: {theme: 'light', zoom: 100}, document: note, autosave_seconds: 30}), set_dirty: async () => {}}};
  w.fetch = async (_, options) => ({ok: true, json: async () => options?.body ? {...JSON.parse(options.body), revision: 2} : {documents: [note], files: []}});
  for (const file of ['compat.js', 'vendor/marked.js', 'vendor/purify.js', 'vendor/turndown.js', 'document_model.js','rich_renderer.js','rich_serializer.js','formatting.js','tables.js','editor_commands.js', 'history.js', 'recovery.js', 'pagination.js','page_menu.js','editor.js', 'menus.js', 'theme.js', 'paper_layout.js', 'navigation.js']) {
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
  return {w, root, click, select};
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
