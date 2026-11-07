"use strict";
(() => {
  const reasons = {
    automatic: "Automática", named: "Nomeada", copied: "Cópia de versão",
    before_restore: "Antes da restauração", restored: "Restauração"
  };

  function describe(snapshot, slideIndex) {
    const model = snapshot.content_json ? JSON.parse(snapshot.content_json) : null;
    const lines = [snapshot.title];
    if (snapshot.markdown !== null) lines.push(...snapshot.markdown.split("\n"));
    if (model?.surfaces) {
      for (const [index, surface] of model.surfaces.entries()) {
        if (slideIndex !== undefined && index !== slideIndex) continue;
        const label = model.source_kind === "pptx" ? "Slide" : "Página";
        const context = label + " " + (index + 1);
        const details = [surface.width_pt + " × " + surface.height_pt + " pt"];
        if (surface.background) details.push("fundo " + surface.background);
        if (surface.transition) details.push("transição " + surface.transition);
        if (surface.strokes?.length) details.push(surface.strokes.length + " traços");
        lines.push(context + " • " + details.join(" • "));
        for (const [order, object] of (surface.elements || []).entries()) {
          const text = (object.text || "").replace(/\s+/g, " ").trim();
          const geometry = [object.x, object.y, object.width, object.height];
          const style = [object.font_family, object.font_size_pt, object.color, object.fill].filter(Boolean);
          lines.push([context + " / " + (order + 1), object.name || object.type,
            text, geometry.some(value => value !== undefined) ? geometry.join(", ") : "",
            ...style].filter(Boolean).join(" • "));
        }
        for (const overlay of surface.text_overlays || []) {
          lines.push(context + " • Texto sobreposto • " + overlay.text);
        }
      }
      const annotations = model.annotations || [];
      if (model.source_kind === "pdf") lines.push("Camada de anotações • " + annotations.length);
      for (const annotation of annotations) {
        lines.push(["Página " + (annotation.page_index + 1), annotation.kind,
          annotation.selected_text, annotation.comment].filter(Boolean).join(" • "));
      }
    }
    return lines;
  }

  function compare(container, selected, current, slideIndex) {
    const before = describe(selected, slideIndex);
    const after = describe(current, slideIndex);
    container.replaceChildren();
    for (const [title, lines, other] of [
      ["Versão selecionada", before, after], ["Documento atual", after, before]
    ]) {
      const column = document.createElement("section");
      const heading = document.createElement("h3");
      const preview = document.createElement("pre");
      const remaining = new Map();
      for (const line of other) remaining.set(line, (remaining.get(line) || 0) + 1);
      heading.textContent = title;
      preview.tabIndex = 0;
      preview.setAttribute("aria-label", title);
      for (const line of lines) {
        const count = remaining.get(line) || 0;
        if (count) {
          preview.append(line + "\n");
          remaining.set(line, count - 1);
        } else {
          const mark = document.createElement("mark");
          mark.textContent = line;
          preview.append(mark, "\n");
        }
      }
      column.append(heading, preview);
      container.append(column);
    }
    const summary = document.createElement("p");
    summary.textContent = selected.content_json === current.content_json &&
      selected.markdown === current.markdown && selected.title === current.title
      ? "Conteúdo idêntico."
      : "Há alterações. O destaque compara linhas do resumo. Formatação e geometria podem mudar sem alterar essas linhas.";
    container.prepend(summary);
  }

  async function open({root, editor, request, dialog, close, status, iconUrl}) {
    await editor.flush();
    const {id, revision} = editor.snapshot();
    const call = (operation, fields = {}) => request("document/versions", {id, revision, operation, ...fields});
    let {versions} = await call("list");
    const pending = dialog("Histórico de versões", "As versões ficam salvas neste dispositivo.");
    root.querySelector("[data-dialog] .dialog").classList.add("dialog-history");
    const modal = root.querySelector("[data-dialog]");
    const body = root.querySelector("[data-dialog-body]");
    const picker = document.createElement("select");
    const search = document.createElement("input");
    const name = document.createElement("input");
    const notice = document.createElement("p");
    const preview = document.createElement("div");
    const actions = document.createElement("div");
    const slidePicker = document.createElement("select");
    const slideField = field("Slide para comparar e restaurar", slidePicker);
    slideField.style.display = "none";
    let comparison = null;
    const controls = [];
    let busy = false;
    preview.className = "version-history-comparison";
    actions.className = "version-history-actions";
    notice.setAttribute("role", "status");
    search.type = "search";
    name.maxLength = 180;

    function field(label, input) {
      const element = document.createElement("label");
      element.textContent = label;
      element.append(input);
      return element;
    }
    function button(label, symbol, action, available = () => true) {
      const control = document.createElement("button");
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      const use = document.createElementNS(svg.namespaceURI, "use");
      control.type = "button";
      control.title = label;
      svg.setAttribute("aria-hidden", "true");
      use.setAttribute("href", iconUrl + "#" + symbol);
      svg.append(use);
      control.append(svg, label);
      controls.push({control, available});
      control.addEventListener("click", () => run(action));
      actions.append(control);
    }
    function updateControls() {
      modal.dataset.historyBusy = String(busy);
      modal.querySelector("[data-dialog-cancel]").disabled = busy;
      modal.querySelector("[data-dialog-confirm]").disabled = busy;
      picker.disabled = search.disabled = name.disabled = slidePicker.disabled = busy;
      for (const {control, available} of controls) control.disabled = busy || !available();
    }
    async function run(action) {
      if (busy) return;
      busy = true;
      updateControls();
      notice.textContent = "";
      try { await action(); }
      catch (error) { notice.textContent = error.message; }
      finally { busy = false; updateControls(); }
    }
    function clearComparison() {
      comparison = null;
      slideField.style.display = "none";
      slidePicker.replaceChildren();
      preview.replaceChildren();
    }
    function refresh(preferred = picker.value) {
      const query = search.value.trim().toLocaleLowerCase();
      picker.replaceChildren();
      for (const version of versions) {
        const option = document.createElement("option");
        const date = new Date(version.created_at).toLocaleString("pt-BR");
        const label = (version.name || reasons[version.reason]) + " • " + date;
        if (!label.toLocaleLowerCase().includes(query)) continue;
        option.value = version.id;
        option.textContent = label;
        picker.append(option);
      }
      if ([...picker.options].some(option => option.value === preferred)) picker.value = preferred;
      clearComparison();
      updateControls();
    }

    async function change(operation) {
      const selected = picker.value;
      ({versions} = await call(operation, {version_id: selected, name: name.value}));
      if (operation === "create" || operation === "duplicate") search.value = "";
      refresh(operation === "rename" ? selected : versions[0]?.id);
      name.value = "";
    }
    const hasSelection = () => Boolean(picker.value);
    button("Salvar versão nomeada", "add-circle", () => change("create"));
    button("Renomear", "edit", () => change("rename"), hasSelection);
    button("Duplicar versão", "copy", () => change("duplicate"), hasSelection);
    button("Comparar", "layers", async () => {
      clearComparison();
      comparison = await call("inspect", {version_id: picker.value});
      const {selected, current} = comparison;
      if (editor.snapshot().content?.editable_deck) {
        const oldModel = JSON.parse(selected.content_json);
        const model = JSON.parse(current.content_json);
        if (oldModel.editable_deck && model.editable_deck) {
          slidePicker.add(new Option("Todos os slides", ""));
          for (let i = 0; i < Math.min(oldModel.surfaces.length, model.surfaces.length); i++) {
            slidePicker.add(new Option("Slide " + (i + 1), String(i)));
          }
          if (slidePicker.options.length > 1) slideField.style.display = "";
        }
      }
      compare(preview, selected, current);
    }, hasSelection);
    button("Restaurar", "undo", async () => {
      if (!window.confirm("Restaurar a versão selecionada? O estado atual será guardado no histórico.")) return;
      const result = await call("restore", {version_id: picker.value});
      editor.load(result.document);
      close();
      status("Versão restaurada. O estado anterior foi preservado.");
    }, hasSelection);
    button("Restaurar este slide", "undo", async () => {
      const slideIndex = Number(slidePicker.value);
      if (!window.confirm("Restaurar somente o slide " + (slideIndex + 1) + "? O estado atual será guardado no histórico.")) return;
      const result = await call("restore_slide", {version_id: picker.value, slide_index: slideIndex});
      editor.load(result.document);
      close();
      status("Slide " + (slideIndex + 1) + " restaurado.");
    }, () => Boolean(comparison && slidePicker.value));
    button("Excluir versão", "trash", async () => {
      if (window.confirm("Excluir a versão mais recente do histórico?")) await change("delete");
    }, () => hasSelection() && versions[0]?.id === picker.value);

    search.addEventListener("input", () => refresh());
    picker.addEventListener("change", () => { clearComparison(); updateControls(); });
    slidePicker.addEventListener("change", () => {
      if (!comparison) return;
      const index = slidePicker.value ? Number(slidePicker.value) : undefined;
      compare(preview, comparison.selected, comparison.current, index);
      updateControls();
    });
    body.append(field("Pesquisar versões", search), field("Versão", picker),
      field("Nome da versão", name), slideField, actions, notice, preview);
    refresh();
    search.focus();
    await pending;
  }

  window.OpenDocVersionHistory = {open};
})();
