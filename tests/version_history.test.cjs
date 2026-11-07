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
  window.eval(readFileSync('apps/open_doc/static/js/version_history.js', 'utf8'));
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
