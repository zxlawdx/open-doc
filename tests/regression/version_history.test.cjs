const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {test} = require('node:test');
const {JSDOM} = require('jsdom');

test('version panel filters, compares, and restores the selected revision', async () => {
  const {window} = new JSDOM(`
    <div data-dialog><div class="dialog"><div data-dialog-body></div>
    <button data-dialog-cancel></button><button data-dialog-confirm></button></div></div>
  `, {runScripts: 'outside-only'});
  const {document} = window;
  const version = {id: 'saved', name: 'Primeira versão', created_at: '2026-01-01T12:00:00Z'};
  const current = {id: 'note', revision: 3, markdown: 'Atual'};
  const restored = {...current, revision: 4, markdown: 'Antes'};
  let finish, loaded, message, flushed;
  window.confirm = () => true;
  window.eval(readFileSync('apps/documents/static/js/version_history.js', 'utf8'));
  const opening = window.OpenDocVersionHistory.open({
    root: document.body,
    editor: {flush: async () => { flushed = true; }, snapshot: () => current, load: note => { loaded = note; }},
    request: async (path, data) => {
      assert.equal(path, 'document/versions');
      assert.equal(data.revision, 3);
      assert.ok(flushed);
      if (data.operation === 'list') return {versions: [version]};
      assert.equal(data.version_id, version.id);
      if (data.operation === 'restore') return {document: restored};
      assert.equal(data.operation, 'inspect');
      return {selected: {title: 'A', markdown: 'Antes'}, current: {title: 'A', markdown: 'Atual'}};
    },
    dialog: () => new Promise(resolve => { finish = resolve; }),
    close: () => finish(),
    status: text => { message = text; },
    iconUrl: '/icons.svg'
  });
  const tick = () => new Promise(resolve => setImmediate(resolve));
  await tick();
  const search = document.querySelector('input[type=search]');
  const restore = document.querySelector('button[title=Restaurar]');
  search.value = 'inexistente';
  search.dispatchEvent(new window.Event('input'));
  assert.equal(restore.disabled, true);
  search.value = 'primeira';
  search.dispatchEvent(new window.Event('input'));
  assert.equal(restore.disabled, false);
  document.querySelector('button[title=Comparar]').click();
  await tick();
  assert.deepEqual([...document.querySelectorAll('mark')].map(mark => mark.textContent), ['Antes', 'Atual']);
  restore.click();
  await opening;
  assert.equal(loaded, restored);
  assert.match(message, /restaurada/);
  window.close();
});

test('compares and restores only the selected slide position', async () => {
  const {window} = new JSDOM(`
    <div data-dialog><div class="dialog"><div data-dialog-body></div>
    <button data-dialog-cancel></button><button data-dialog-confirm></button></div></div>
  `, {runScripts: 'outside-only'});
  const {document} = window;
  const makeSnapshot = (first, second) => ({
    title: 'Apresentação', markdown: null, content_json: JSON.stringify({
      source_kind: 'pptx', editable_deck: true,
      surfaces: [first, second].map(text => ({width_pt: 100, height_pt: 100, elements: [{text}]}))
    })
  });
  let finish, loaded;
  window.confirm = () => true;
  window.eval(readFileSync('apps/documents/static/js/version_history.js', 'utf8'));
  const opening = window.OpenDocVersionHistory.open({
    root: document.body,
    editor: {
      flush: async () => {},
      snapshot: () => ({id: 'deck', revision: 3, content: {editable_deck: true}}),
      load: note => { loaded = note; }
    },
    request: async (_path, data) => {
      if (data.operation === 'list') return {versions: [{id: 'old', name: 'Versão anterior'}]};
      if (data.operation === 'inspect') return {
        selected: makeSnapshot('Antigo', 'Fora da seleção'),
        current: makeSnapshot('Atual', 'Também fora da seleção')
      };
      assert.equal(data.operation, 'restore_slide');
      assert.equal(data.slide_index, 0);
      assert.equal(data.revision, 3);
      return {document: {id: 'deck', revision: 4}};
    },
    dialog: () => new Promise(resolve => { finish = resolve; }),
    close: () => finish(),
    status: () => {},
    iconUrl: '/icons.svg'
  });
  const tick = () => new Promise(resolve => setImmediate(resolve));
  await tick();
  document.querySelector('button[title=Comparar]').click();
  await tick();
  const select = document.querySelectorAll('select')[1];
  select.value = '0';
  select.dispatchEvent(new window.Event('change'));
  const preview = document.querySelector('.version-history-comparison');
  assert.match(preview.textContent, /Antigo/);
  assert.doesNotMatch(preview.textContent, /Fora da seleção/);
  document.querySelector('button[title="Restaurar este slide"]').click();
  await opening;
  assert.equal(loaded.revision, 4);
  window.close();
});
