/* ============ WORKSPACE ============ */
"use strict";

(() => {
  const app = document.querySelector("[data-app]");
  const status = document.querySelector("[data-status]");
  const draft = document.querySelector("[data-draft]");
  const token = document.querySelector('meta[name="writer-token"]').content;
  let busy = false;

  function showStatus(message) {
    status.textContent = message;
  }

  async function requestJson(path, options = {}) {
    const response = await fetch(path, options);
    if (!response.ok) throw new Error("Não foi possível concluir a operação.");
    return response.json();
  }

  function applyCollapsed(collapsed) {
    // Data attributes drive documented CSS states; no class mutations.
    app.dataset.collapsed = String(collapsed);
    const toggle = document.querySelector("[data-toggle]");
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute("aria-label", collapsed ? "Expandir navegação" : "Recolher navegação");
  }

  async function toggleSidebar() {
    if (busy) return;
    busy = true;
    const previous = app.dataset.collapsed === "true";
    applyCollapsed(!previous);
    try {
      await requestJson("/writer/settings", {
        method: "POST",
        headers: {"Content-Type": "application/json", "X-Writer-Token": token},
        body: JSON.stringify({sidebar_collapsed: !previous})
      });
    } catch (error) {
      applyCollapsed(previous);
      showStatus(error.message);
    } finally {
      busy = false;
    }
  }

  async function refreshFiles() {
    const data = await requestJson("/writer/files");
    const list = document.querySelector("[data-files]");
    list.replaceChildren();
    if (!data.files.length) {
      const empty = document.createElement("li");
      empty.textContent = "Nenhum documento importado. Sua próxima ideia cabe aqui.";
      list.append(empty);
    }
    for (const file of data.files) {
      const item = document.createElement("li");
      const name = document.createElement("strong");
      const type = document.createElement("span");
      name.textContent = file.name;
      type.textContent = file.type.toUpperCase();
      item.append(name, type);
      list.append(item);
    }
  }

  function switchView(view) {
    document.querySelector("[data-home]").hidden = view !== "home";
    document.querySelector("[data-library]").hidden = view !== "library";
    for (const button of document.querySelectorAll("[data-view]")) {
      if (button.dataset.view === view) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
    if (view === "library") refreshFiles().catch(error => showStatus(error.message));
  }

  async function importDocument() {
    if (!window.pywebview?.api) {
      showStatus("A importação usa o seletor da aplicação desktop.");
      return;
    }
    const buttons = document.querySelectorAll("[data-import]");
    buttons.forEach(button => { button.disabled = true; });
    try {
      const result = await window.pywebview.api.import_document();
      if (result.error) throw new Error(result.error);
      if (!result.cancelled) {
        switchView("library");
        await refreshFiles();
        showStatus("Arquivo importado: " + result.name);
      }
    } catch (error) {
      showStatus(error.message);
    } finally {
      buttons.forEach(button => { button.disabled = false; });
    }
  }

  function updateWordCount() {
    const text = draft.value.trim();
    const count = text ? text.split(/\s+/u).length : 0;
    document.querySelector("[data-count]").textContent =
      count + (count === 1 ? " palavra" : " palavras");
    showStatus("Rascunho temporário · não salvo");
  }

  document.querySelector("[data-toggle]").addEventListener("click", toggleSidebar);
  document.querySelectorAll("[data-view]").forEach(button => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });
  document.querySelectorAll("[data-import]").forEach(button => {
    button.addEventListener("click", importDocument);
  });
  draft.addEventListener("input", updateWordCount);
  window.addEventListener("beforeunload", event => {
    if (!draft.value) return;
    event.preventDefault();
    event.returnValue = "";
  });
  requestJson("/writer/settings")
    .then(settings => applyCollapsed(settings.sidebar_collapsed))
    .catch(error => showStatus(error.message));
})();
