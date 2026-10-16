/* ============ EDITOR BEHAVIOR TESTS ============ */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {JSDOM} = require("jsdom");
const rootPath = path.resolve(__dirname, "..");

function setup(t, options = {}) {
  const template = fs.readFileSync(path.join(rootPath, "ui/templates/base.html"), "utf8")
    .replace(/{{ (menus|toolbar|sidebar|editor|home) }}/g, (_, name) => fs.readFileSync(path.join(rootPath, "ui/templates/" + name + ".html"), "utf8"));
  const dom = new JSDOM(
    template,
    {url: "http://127.0.0.1:8000", runScripts: "outside-only"}
  );
  const window = dom.window;
  for (const file of ["vendor/marked.js", "vendor/purify.js", "vendor/turndown.js", "editor_commands.js", "history.js", "recovery.js", "editor.js"]) {
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
  const editor = window.OpenDocEditor.create({
    root, request, status: text => { root.querySelector("[data-status]").textContent = text; },
    document: {...note, recovery: options.recovery || null}, autosaveSeconds: 30
  });
  editor.setMode("markdown");
  root.querySelectorAll("[data-mode]").forEach(button => button.addEventListener("click", () => editor.setMode(button.dataset.mode)));
  t.after(() => { editor.destroy(); dom.window.close(); });
  const source = root.querySelector("[data-source]");
  function input(text) {
    source.value = text;
    source.dispatchEvent(new window.Event("input", {bubbles: true}));
    editor.refresh();
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
  assert.equal(root.querySelector("[data-conflict]").hidden, false);
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



test("undo e redo restauram documento sem destruir revisão", t => {
  const {editor, input, source} = setup(t);
  input("Primeira edição");
  editor.format("undo"); assert.equal(source.value, "");
  editor.format("redo"); assert.equal(source.value, "Primeira edição");
});

test("recuperação lê chave antiga e migra para namespace Open Doc", t => {
  const {window} = setup(t);
  const value = {id: "legacy", title: "Antiga", markdown: "Conteúdo"};
  window.localStorage.setItem("vela-writer-recovery:legacy", JSON.stringify(value));
  assert.equal(window.OpenDocRecovery.read("legacy").markdown, "Conteúdo");
  assert.equal(window.localStorage.getItem("vela-writer-recovery:legacy"), null);
  assert.equal(JSON.parse(window.localStorage.getItem("open-doc-recovery:legacy")).title, "Antiga");
});

test("menu Arquivo funciona com teclado, Escape e clique externo", t => {
  const {window, root} = setup(t);
  window.eval(fs.readFileSync(path.join(rootPath, "ui/static/js/menus.js"), "utf8"));
  const controller = new window.AbortController();
  window.OpenDocMenus.create(root, () => {}, controller.signal);
  const trigger = root.querySelector('[data-menu="file"]');
  trigger.dispatchEvent(new window.KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true}));
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.equal(window.document.activeElement.dataset.action, "new");
  window.document.activeElement.dispatchEvent(new window.KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(window.document.activeElement, trigger);
  trigger.click();
  window.document.body.dispatchEvent(new window.Event("pointerdown", {bubbles: true}));
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  controller.abort();
});

test("tema claro escuro sistema persiste sem listener duplicado", async t => {
  const {window, root} = setup(t);
  window.eval(fs.readFileSync(path.join(rootPath, "ui/static/js/theme.js"), "utf8"));
  const controller = new window.AbortController(), calls = [];
  const theme = window.OpenDocTheme.create(root, {theme: "light"}, async data => calls.push(data), controller.signal);
  assert.equal(root.dataset.theme, "light");
  await theme.set("dark"); assert.equal(root.dataset.theme, "dark");
  assert.equal(calls[0].theme, "dark");
  await theme.set("system"); assert.equal(root.dataset.themePreference, "system");
  controller.abort();
});

test("zoom modifica medidas reais e limites da folha", t => {
  const {window, root} = setup(t);
  window.eval(fs.readFileSync(path.join(rootPath, "ui/static/js/paper_layout.js"), "utf8"));
  const controller = new window.AbortController();
  const layout = window.OpenDocPaperLayout.create(root, {zoom: 100}, async () => {}, controller.signal);
  layout.set(120);
  assert.equal(root.querySelector('[data-surface]').style.transform, 'scale(1.2)');
  assert.equal(parseFloat(root.querySelector('[data-paper-layout]').style.width), 952.8);
  layout.set(999); assert.equal(layout.value(), 150);
  controller.abort();
});

test("outline real atualiza headings e navega sem inventar páginas", t => {
  const {window, root, editor, input} = setup(t);
  input("# Introdução\n\n## Desenvolvimento\n\nTexto.");
  window.eval(fs.readFileSync(path.join(rootPath, "ui/static/js/navigation.js"), "utf8"));
  const controller = new window.AbortController();
  window.HTMLElement.prototype.scrollIntoView = function () {};
  const navigation = window.OpenDocNavigation.create(root, editor, controller.signal);
  navigation.update();
  const buttons = root.querySelectorAll('[data-outline] button');
  assert.equal(buttons.length, 2); assert.equal(buttons[1].textContent, "Desenvolvimento");
  buttons[1].click(); assert.equal(root.querySelector('[data-rich]').hidden, false);
  controller.abort();
});

test("documento grande produz outline real em tempo limitado", t => {
  const {window, root, input, editor} = setup(t);
  const text = Array.from({length: 150}, (_, index) => "## Seção " + index + "\n\n" + "Conteúdo de estudo. ".repeat(40)).join("\n\n");
  const started = Date.now(); input(text);
  window.eval(fs.readFileSync(path.join(rootPath, "ui/static/js/navigation.js"), "utf8"));
  const controller = new window.AbortController();
  window.OpenDocNavigation.create(root, editor, controller.signal);
  assert.equal(root.querySelectorAll('[data-outline] button').length, 150);
  assert.ok(Date.now() - started < 5000);
  controller.abort();
});
