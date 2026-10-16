/* ============ PERSISTENT MARKDOWN / RICH EDITOR ============ */
"use strict";
(() => {
  const AUTOSAVE_MS = 1000;
  const RECOVERY_DELAY = 600;
  let active = null;

  function create(options) {
    const {root, request, status, autosaveSeconds} = options;
    const source = root.querySelector("[data-source]");
    const rich = root.querySelector("[data-rich]");
    const title = root.querySelector("[data-title]");
    const preview = root.querySelector("[data-preview-pane]");
    const surface = root.querySelector("[data-surface]");
    const controller = new AbortController();
    const listeners = {signal: controller.signal};
    const converter = new window.TurndownService({
      headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-"
    });
    // Preserve tables when moving from rich text back to Markdown.
    converter.addRule("tables", {
      filter: "table",
      replacement(content, node) {
        const rows = Array.from(node.rows).map(row =>
          Array.from(row.cells).map(cell =>
            converter.turndown(cell.innerHTML).replace(/\n/g, " ").replace(/\|/g, "\\|")
          )
        );
        if (!rows.length) return "";
        const line = cells => "| " + cells.join(" | ") + " |";
        return "\n\n" + [
          line(rows[0]), line(rows[0].map(() => "---")), ...rows.slice(1).map(line)
        ].join("\n") + "\n\n";
      }
    });

    let documentState = null;
    let saved = "";
    let mode = "rich";
    let chain = Promise.resolve();
    let destroyed = false;
    let recoveryTimer = null;
    let recovered = null;
    let copying = false;
    let lockedState = false;
    let renderTimer = null;
    let nextKind = "typing";
    const history = window.OpenDocHistory.create();
    const commands = window.OpenDocCommands.create(rich, kind => changed(kind), controller.signal);

    function cleanHtml(markdown) {
      return window.DOMPurify.sanitize(window.marked.parse(markdown, {async: false}), {
        USE_PROFILES: {html: true},
        FORBID_TAGS: ["img", "style", "iframe", "object", "form", "input", "button"],
        FORBID_ATTR: ["style", "src", "srcset"]
      });
    }

    function buffer() {
      return {
        id: documentState.id,
        title: title.value.trim() || "Sem título",
        markdown: source.value,
        revision: documentState.revision,
        selection: mode === "rich" ? commands.bookmark() : {start: source.selectionStart, length: source.selectionEnd - source.selectionStart}
      };
    }

    function signature(snapshot) {
      return JSON.stringify([snapshot.title, snapshot.markdown]);
    }

    function isClean() {
      return !documentState || signature(buffer()) === saved;
    }

    function cache() {
      if (!documentState) return;
      if (isClean()) window.OpenDocRecovery.clear(documentState.id);
      else window.OpenDocRecovery.write(buffer());
    }

    function render() {
      preview.innerHTML = cleanHtml(source.value);
      if (mode === "markdown") {
        source.style.height = "auto";
        source.style.height = Math.max(1123, source.scrollHeight) + "px";
      }
      const text = preview.textContent.trim();
      const count = text ? text.split(/\s+/u).length : 0;
      root.querySelector("[data-count]").textContent =
        count + (count === 1 ? " palavra" : " palavras");
      root.dataset.dirty = String(!isClean());
      root.dispatchEvent(new CustomEvent("open-doc:content", {detail: {mode}}));
      root.querySelectorAll('[data-command="undo"]').forEach(button => { button.disabled = !history.canUndo(); });
      root.querySelectorAll('[data-command="redo"]').forEach(button => { button.disabled = !history.canRedo(); });
      if (window.pywebview?.api?.set_dirty) {
        window.pywebview.api.set_dirty(!isClean()).catch(() => {});
      }
    }

    function enqueue(operation) {
      const task = chain.then(operation);
      chain = task.catch(() => {});
      return task;
    }

    function scheduleRecovery() {
      clearTimeout(recoveryTimer);
      recoveryTimer = setTimeout(() => {
        enqueue(async () => {
          if (destroyed || isClean()) return;
          await request("document/recovery", buffer());
        }).catch(error => status(error.message));
      }, RECOVERY_DELAY);
    }

    function changed(kind = nextKind, origin = rich) {
      if (mode === "rich" && origin === rich) source.value = converter.turndown(rich.innerHTML);
      history.record(buffer(), kind);
      cache();
      clearTimeout(renderTimer);
      renderTimer = setTimeout(render, 100);
      scheduleRecovery();
      root.dataset.dirty = String(!isClean());
      if (window.pywebview?.api?.set_dirty) window.pywebview.api.set_dirty(!isClean()).catch(() => {});
      status("Alterações não salvas");
      root.dispatchEvent(new CustomEvent("open-doc:changed"));
    }

    function load(note) {
      clearTimeout(recoveryTimer);
      documentState = {...note};
      source.value = note.markdown;
      title.value = note.title;
      saved = signature(note);
      source.disabled = false;
      title.disabled = false;
      rich.contentEditable = "true";
      root.querySelectorAll("[data-save], [data-export]").forEach(button => {
        button.disabled = false;
      });
      root.querySelector("[data-conflict]").hidden = true;
      root.querySelector("[data-export-result]").textContent = "";
      rich.innerHTML = cleanHtml(note.markdown);
      recovered = note.recovery || null;
      const cached = window.OpenDocRecovery.read(documentState.id);
      if (cached && signature(cached) !== saved) recovered = cached;
      history.reset(buffer());
      root.querySelector("[data-recovery]").hidden =
        !recovered || signature(recovered) === saved;
      render();
      status(recovered && signature(recovered) !== saved ? "Recuperação disponível" : "Salvo no dispositivo");
    }

    function flush() {
      return enqueue(async () => {
        if (isClean()) return documentState;
        let result;
        while (!isClean()) {
        const snapshot = buffer();
        cache();
        status("Salvando…");
        root.dataset.saving = "true";
        try {
          result = await request("document/save", snapshot);
          documentState.revision = result.revision;
          saved = signature(snapshot);
          cache();
          render();
          if (!isClean()) scheduleRecovery();
          status(isClean() ? "Salvo no dispositivo" : "Alterações não salvas");
        } catch (error) {
          root.querySelector("[data-conflict]").hidden = !error.conflict;
          status(error.message);
          throw error;
        } finally {
          root.dataset.saving = "false";
        }
        }
        return result;
      });
    }

    async function copyDocument(snapshot = buffer(), discardRecovery = false) {
      if (copying) return;
      copying = true;
      setLocked(true);
      try {
        await chain;
        const note = await request("document/new", {
          title: snapshot.title + " (cópia)", markdown: snapshot.markdown
        });
        if (discardRecovery) {
          await request("document/recovery", {id: documentState.id, discard: true});
        }
        window.OpenDocRecovery.clear(documentState.id);
        load(note);
        status("Cópia salva.");
      } catch (error) { status(error.message); }
      finally { copying = false; setLocked(false); }
    }

    function setMode(next) {
      if (!["rich", "markdown", "preview"].includes(next)) return;
      if (next === "rich") rich.innerHTML = cleanHtml(source.value);
      mode = next;
      surface.dataset.editorMode = mode;
      source.hidden = mode !== "markdown";
      rich.hidden = mode !== "rich";
      preview.hidden = mode !== "preview";
      root.querySelectorAll("[data-mode]").forEach(button => {
        button.setAttribute("aria-checked", String(button.dataset.mode === mode));
      });
      const label = root.querySelector("[data-mode-label]");
      if (label) label.textContent = {rich: "Editor visual", markdown: "Código Markdown", preview: "Visualização"}[mode];
      render();
      if (mode !== "preview") (mode === "rich" ? rich : source).focus();
    }

    function restoreSnapshot(snapshot) {
      if (!snapshot) return;
      title.value = snapshot.title;
      source.value = snapshot.markdown;
      rich.innerHTML = cleanHtml(snapshot.markdown);
      cache(); scheduleRecovery(); render();
      status(isClean() ? "Salvo no dispositivo" : "Alterações não salvas");
      if (mode === "rich") commands.restoreBookmark(snapshot.selection);
      else { source.focus(); source.setSelectionRange(snapshot.selection?.start || 0, (snapshot.selection?.start || 0) + (snapshot.selection?.length || 0)); }
    }

    function format(kind, value) {
      if (lockedState) return;
      history.checkpoint(buffer());
      if (kind === "undo") { restoreSnapshot(history.undo()); return; }
      if (kind === "redo") { restoreSnapshot(history.redo()); return; }
      if (mode === "preview") setMode("rich");
      if (kind === "selectAll" && mode === "markdown") { source.focus(); source.select(); return; }
      if (mode === "rich") {
        const mapping = {
          bold: ["bold"], italic: ["italic"], paragraph: ["formatBlock", "p"],
          h1: ["formatBlock", "h1"], heading: ["formatBlock", "h2"], h3: ["formatBlock", "h3"],
          list: ["insertUnorderedList"], ordered: ["insertOrderedList"],
          quote: ["formatBlock", "blockquote"], code: ["formatBlock", "pre"],
          link: ["createLink", value], selectAll: ["selectAll"]
        };
        if (!mapping[kind]) return;
        nextKind = "format";
        commands.execute(...mapping[kind]);
        nextKind = "typing";
        return;
      }
      const start = source.selectionStart, end = source.selectionEnd;
      const selected = source.value.slice(start, end) || "texto";
      const wrappers = {
        bold: ["**", "**"], italic: ["*", "*"], h1: ["\n# ", "\n"],
        heading: ["\n## ", "\n"], h3: ["\n### ", "\n"], paragraph: ["\n", "\n"],
        list: ["\n- ", "\n"], ordered: ["\n1. ", "\n"], quote: ["\n> ", "\n"],
        code: ["\n\x60\x60\x60\n", "\n\x60\x60\x60\n"], link: ["[", "](" + value + ")"]
      };
      if (!wrappers[kind]) return;
      const [before, after] = wrappers[kind];
      source.setRangeText(before + selected + after, start, end, "select");
      source.focus(); changed("format", source);
    }

    async function exportDocument(extension) {
      await flush();
      const result = await request("document/export", {
        id: documentState.id, revision: documentState.revision, format: extension
      });
      root.querySelector("[data-export-result]").textContent = "Exportado para: " + result.path;
      status("Exportação concluída");
      return result;
    }

    function setLocked(locked) {
      lockedState = locked;
      source.disabled = locked;
      title.disabled = locked;
      rich.contentEditable = String(!locked);
      root.querySelectorAll("[data-command], [data-mode], [data-save], [data-export], [data-save-copy], [data-recover]").forEach(button => {
        button.disabled = locked;
      });
      if (!locked) render();
    }

    function destroy() {
      cache();
      clearInterval(timer);
      clearTimeout(recoveryTimer);
      clearTimeout(renderTimer);
      if (!isClean()) {
        enqueue(() => request("document/recovery", buffer())).catch(() => {});
      }
      destroyed = true;
      controller.abort();
    }

    source.addEventListener("beforeinput", () => history.checkpoint(buffer()), listeners);
    rich.addEventListener("beforeinput", () => { commands.capture(); history.checkpoint(buffer()); }, listeners);
    source.addEventListener("input", () => changed("typing", source), listeners);
    rich.addEventListener("input", () => changed(), listeners);
    title.addEventListener("input", () => changed("typing", title), listeners);
    rich.addEventListener("paste", event => {
      event.preventDefault();
      const plain = event.clipboardData.getData("text/plain");
      commands.execute("insertText", plain);
    }, listeners);
    root.querySelector("[data-save-copy]").addEventListener("click", () => {
      copyDocument();
    }, listeners);
    root.querySelector("[data-recover]").addEventListener("click", () => {
      if (recovered) copyDocument(recovered, true);
    }, listeners);
    root.querySelector("[data-discard-recovery]").addEventListener("click", async () => {
      try {
        await request("document/recovery", {id: documentState.id, discard: true});
        window.OpenDocRecovery.clear(documentState.id);
        recovered = null;
        root.querySelector("[data-recovery]").hidden = true;
      } catch (error) { status(error.message); }
    }, listeners);
    root.addEventListener("click", event => {
      const anchor = event.target.closest("[data-preview-pane] a, [data-rich] a");
      if (anchor) {
        event.preventDefault();
        status("Link: " + anchor.getAttribute("href"));
      }
    }, listeners);
    window.addEventListener("keydown", event => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "s") { event.preventDefault(); flush().catch(() => {}); }
      if (key === "z" || key === "y") {
        if ([source, rich].some(element => element === document.activeElement || element.contains(document.activeElement))) {
          event.preventDefault(); format(key === "y" || event.shiftKey ? "redo" : "undo");
        }
      }
      if (["b", "i"].includes(key) && document.activeElement !== title) {
        event.preventDefault();
        format(key === "b" ? "bold" : "italic");
      }
    }, listeners);
    window.addEventListener("beforeunload", event => {
      cache();
      if (isClean()) return;
      event.preventDefault();
      event.returnValue = "";
    }, listeners);

    const timer = setInterval(() => {
      if (!copying && !isClean()) flush().catch(() => {});
    }, autosaveSeconds * AUTOSAVE_MS);
    const instance = {load, flush, destroy, isClean, setLocked, setMode, format, copy: copyDocument, export: exportDocument, capture: commands.capture, commandState: commands.state, refresh: render, snapshot: buffer};
    active = instance;
    load(options.document);
    setMode("rich");
    return instance;
  }

  window.OpenDocEditor = {
    create,
    isClean: () => active ? active.isClean() : true
  };
})();

