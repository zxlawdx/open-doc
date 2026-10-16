/* ============ VELA PAGE BOOTSTRAP ============ */
"use strict";
(() => {
  // QtWebEngine 5.15 uses an older Chromium without Array.prototype.at.
  if (!Array.prototype.at) {
    Object.defineProperty(Array.prototype, "at", {
      configurable: true, writable: true,
      value(index) {
        const offset = Math.trunc(Number(index)) || 0;
        return this[offset < 0 ? this.length + offset : offset];
      }
    });
  }
  const root = document.querySelector("[data-app]");
  if (!root) return;
  window.WriterApp?.destroy();
  const controller = new AbortController();
  const listeners = {signal: controller.signal};
  let editor = null;
  let token = "";
  let destroyed = false;
  let busy = false;

  function status(message) {
    if (!destroyed) root.querySelector("[data-status]").textContent = message;
  }

  async function request(path, data) {
    const options = data === undefined ? {} : {
      method: "POST",
      headers: {"Content-Type": "application/json", "X-Writer-Token": token},
      body: JSON.stringify(data)
    };
    const response = await fetch("/api/writer/" + path, options);
    let result;
    try { result = await response.json(); }
    catch { throw new Error("Resposta inválida do servidor. Seu texto foi mantido."); }
    if (!response.ok || result.error) {
      const error = new Error(result.error || "Não foi possível concluir a operação.");
      error.conflict = Boolean(result.conflict);
      throw error;
    }
    return result;
  }

  function collapsed(value) {
    root.dataset.collapsed = String(value);
    const toggle = root.querySelector("[data-toggle]");
    toggle.setAttribute("aria-expanded", String(!value));
    toggle.setAttribute("aria-label", value ? "Expandir navegação" : "Recolher navegação");
  }

  async function refresh() {
    const data = await request("files");
    for (const [selector, items, notes] of [
      ["[data-documents]", data.documents, true],
      ["[data-files]", data.files, false]
    ]) {
      const list = root.querySelector(selector);
      list.replaceChildren();
      if (!items.length) {
        const item = document.createElement("li");
        item.textContent = "Nenhum documento por aqui ainda.";
        list.append(item);
      }
      for (const file of items) {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.textContent = notes ? file.title : file.name;
        const editable = notes || ["md", "txt"].includes(file.type);
        button.disabled = !editable;
        if (!editable) button.title = "Leitura disponível na Fase 3.";
        button.addEventListener("click", () => operate(async () => {
          await editor.flush();
          const opened = await request("document/open", notes ? {id: file.id} : {path: file.path});
          editor.load(opened);
          showView("home");
        }), listeners);
        const type = document.createElement("span");
        type.textContent = notes ? "NOTA" : file.type.toUpperCase();
        item.append(button, type);
        list.append(item);
      }
    }
  }

  function showView(view) {
    root.querySelector("[data-home]").hidden = view !== "home";
    root.querySelector("[data-library]").hidden = view !== "library";
    for (const button of root.querySelectorAll("[data-view]")) {
      if (button.dataset.view === view) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
    if (view === "library") refresh().catch(error => status(error.message));
  }

  async function operate(operation) {
    if (busy || !editor) return;
    busy = true;
    editor.setLocked(true);
    try { await operation(); } catch (error) { status(error.message); }
    finally { busy = false; editor.setLocked(false); }
  }

  async function loadScript(name) {
    if (destroyed) return;
    const script = document.createElement("script");
    script.src = new URL(name, currentScript).href;
    await new Promise((resolve, reject) => {
      script.onload = resolve;
      script.onerror = () => reject(new Error("Não foi possível carregar o editor local."));
      document.body.append(script);
    });
    script.remove();
  }

  // Vela inserts the view first; dependencies must load sequentially.
  const currentScript = document.currentScript.src;
  const page = {
    destroy() {
      destroyed = true;
      editor?.destroy();
      controller.abort();
    }
  };
  window.WriterApp = page;
  window.VelaPage = {beforeUnmount: () => page.destroy()};

  async function mount() {
    if (!window.marked) await loadScript("vendor/marked.js");
    if (!window.DOMPurify) await loadScript("vendor/purify.js");
    if (!window.TurndownService) await loadScript("vendor/turndown.js");
    if (!window.WriterEditor) await loadScript("editor.js");
    if (destroyed) return;
    const bootstrap = await window.pywebview.api.get_bootstrap();
    if (bootstrap.error) throw new Error(bootstrap.error);
    if (destroyed) return;
    token = bootstrap.token;
    collapsed(bootstrap.settings.sidebar_collapsed);
    editor = window.WriterEditor.create({
      root, request, status, document: bootstrap.document,
      autosaveSeconds: bootstrap.autosave_seconds
    });
    root.querySelector("[data-toggle]").addEventListener("click", () => operate(async () => {
      const previous = root.dataset.collapsed === "true";
      collapsed(!previous);
      try {
        await request("settings", {settings: {sidebar_collapsed: !previous}});
      } catch (error) { collapsed(previous); throw error; }
    }), listeners);
    root.querySelectorAll("[data-view]").forEach(button => {
      button.addEventListener("click", () => showView(button.dataset.view), listeners);
    });
    root.querySelector("[data-new]").addEventListener("click", () => operate(async () => {
      await editor.flush();
      editor.load(await request("document/new", {title: "Sem título"}));
      showView("home");
      root.querySelector("[data-title]").focus();
    }), listeners);
    root.querySelector("[data-import]").addEventListener("click", () => operate(async () => {
      const result = await window.pywebview.api.import_document();
      if (result.error) throw new Error(result.error);
      if (!result.cancelled) {
        showView("library");
        status("Arquivo importado: " + result.name);
      }
    }), listeners);
  }

  mount().catch(error => status(error.message));
})();
