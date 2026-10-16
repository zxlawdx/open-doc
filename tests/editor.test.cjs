/* ============ EDITOR BEHAVIOR TESTS ============ */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {JSDOM} = require("jsdom");
const rootPath = path.resolve(__dirname, "..");

function setup(t, options = {}) {
  const template = fs.readFileSync(path.join(rootPath, "ui/templates/editor.html"), "utf8");
  const dom = new JSDOM(
    '<div data-app><span data-status></span><span data-count></span>' + template + '</div>',
    {url: "http://127.0.0.1:8000", runScripts: "outside-only"}
  );
  const window = dom.window;
  for (const file of ["vendor/marked.js", "vendor/purify.js", "vendor/turndown.js", "editor.js"]) {
    window.eval(fs.readFileSync(path.join(rootPath, "ui/static/js", file), "utf8"));
  }
  const intervals = [];
  window.setInterval = (callback, delay) => { intervals.push({callback, delay}); return intervals.length; };
  window.clearInterval = () => {};
  const note = {id: "note-1", title: "Nota", markdown: options.markdown || "", revision: 1};
  const calls = [];
  const request = options.request || (async (route, data) => {
    calls.push({route, data});
    return {...data, id: data.id || "note-2", revision: (data.revision || 0) + 1};
  });
  const root = window.document.querySelector("[data-app]");
  const editor = window.WriterEditor.create({
    root, request, status: text => { root.querySelector("[data-status]").textContent = text; },
    document: {...note, recovery: options.recovery || null}, autosaveSeconds: 30
  });
  t.after(() => { editor.destroy(); dom.window.close(); });
  const source = root.querySelector("[data-source]");
  function input(text) {
    source.value = text;
    source.dispatchEvent(new window.Event("input", {bubbles: true}));
  }
  return {window, root, editor, input, source, calls, intervals};
}

test("preview Markdown bloqueia scripts e imagens externas", t => {
  const {root, input} = setup(t);
  input('# Olá\n\n**forte** <script>window.hacked=true</script> ![x](https://evil.test/x)');
  assert.equal(root.querySelector("[data-preview-pane] h1").textContent, "Olá");
  assert.equal(root.querySelector("[data-preview-pane] strong").textContent, "forte");
  assert.equal(root.querySelector("[data-preview-pane] script"), null);
  assert.equal(root.querySelector("[data-preview-pane] img"), null);
});

test("salva e reconhece revisão sem manter estado sujo", async t => {
  const {editor, input, calls} = setup(t);
  input("Texto salvo");
  assert.equal(editor.isClean(), false);
  await editor.flush();
  assert.equal(editor.isClean(), true);
  assert.equal(calls[0].data.markdown, "Texto salvo");
  assert.equal(calls[0].data.revision, 1);
});

test("autosave usa 30 segundos e salva conteúdo alterado", async t => {
  const {intervals, input, calls, editor} = setup(t);
  assert.equal(intervals[0].delay, 30000);
  input("Automático");
  intervals[0].callback();
  await editor.flush();
  assert.equal(calls.filter(call => call.route === "document/save").length, 1);
});

test("edição durante salvamento preserva texto e faz novo snapshot", async t => {
  let release;
  const calls = [];
  const pending = new Promise(resolve => { release = resolve; });
  const {editor, input} = setup(t, {
    request: async (route, data) => {
      calls.push({...data});
      if (calls.length === 1) await pending;
      return {...data, revision: data.revision + 1};
    }
  });
  input("Primeiro");
  const saving = editor.flush();
  await Promise.resolve();
  input("Mais recente");
  release();
  await saving;
  assert.equal(calls.length, 2);
  assert.equal(calls[1].markdown, "Mais recente");
  assert.equal(calls[1].revision, 2);
  assert.equal(editor.isClean(), true);
});

test("conflito mantém buffer e oferece salvar cópia", async t => {
  const error = new Error("Conflito");
  error.conflict = true;
  const {editor, input, source, root} = setup(t, {
    request: async () => { throw error; }
  });
  input("Não perder");
  await assert.rejects(editor.flush(), /Conflito/);
  assert.equal(source.value, "Não perder");
  assert.equal(editor.isClean(), false);
  assert.equal(root.querySelector("[data-save-copy]").hidden, false);
});

test("texto rico retorna negrito e títulos para Markdown", t => {
  const {root, source, window} = setup(t);
  root.querySelector('[data-mode="rich"]').click();
  const rich = root.querySelector("[data-rich]");
  rich.innerHTML = "<h2>Estudo</h2><p>Texto <strong>forte</strong></p>";
  rich.dispatchEvent(new window.Event("input", {bubbles: true}));
  root.querySelector('[data-mode="markdown"]').click();
  assert.match(source.value, /## Estudo/);
  assert.match(source.value, /\*\*forte\*\*/);
});

test("texto rico preserva tabelas Markdown", t => {
  const {root, source, window} = setup(t, {markdown: "| A | B |\n| --- | --- |\n| 1 | 2 |"});
  root.querySelector('[data-mode="rich"]').click();
  root.querySelector("[data-rich]").dispatchEvent(new window.Event("input", {bubbles: true}));
  assert.match(source.value, /\| A \| B \|/);
  assert.match(source.value, /\| 1 \| 2 \|/);
});

test("troca para nota carregada atualiza conteúdo e estado", t => {
  const {editor, input, source, root} = setup(t);
  input("Editado");
  editor.load({id: "note-3", title: "Outra nota", markdown: "Outro", revision: 4});
  assert.equal(source.value, "Outro");
  assert.equal(root.querySelector("[data-title]").value, "Outra nota");
  assert.equal(editor.isClean(), true);
});

test("recuperação é oferecida sem sobrescrever nota persistida", t => {
  const {root, source} = setup(t, {
    markdown: "Original",
    recovery: {title: "Recuperado", markdown: "Rascunho", revision: 1}
  });
  assert.equal(root.querySelector("[data-recovery]").hidden, false);
  assert.equal(source.value, "Original");
});

test("destruir editor remove atalho de teclado", t => {
  const {window, editor, input, calls} = setup(t);
  editor.destroy();
  input("Depois");
  window.dispatchEvent(new window.KeyboardEvent("keydown", {key: "s", ctrlKey: true}));
  assert.equal(calls.length, 0);
});

