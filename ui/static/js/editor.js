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
    let mode = "markdown";
    let chain = Promise.resolve();
    let destroyed = false;
    let recoveryTimer = null;
    let recovered = null;
    let copying = false;

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
        revision: documentState.revision
      };
    }

    function signature(snapshot) {
      return JSON.stringify([snapshot.title, snapshot.markdown]);
    }

    function isClean() {
      return !documentState || signature(buffer()) === saved;
    }

    function cacheKey() {
      return "vela-writer-recovery:" + documentState.id;
    }

    function cache() {
      if (!documentState) return;
      try {
        if (isClean()) localStorage.removeItem(cacheKey());
        else localStorage.setItem(cacheKey(), JSON.stringify(buffer()));
      } catch {
        // SQLite recovery still works if WebView storage is unavailable.
      }
    }

    function render() {
      preview.innerHTML = cleanHtml(source.value);
      const text = preview.textContent.trim();
      const count = text ? text.split(/\s+/u).length : 0;
      root.querySelector("[data-count]").textContent =
        count + (count === 1 ? " palavra" : " palavras");
      root.dataset.dirty = String(!isClean());
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

    function changed() {
      if (mode === "rich") source.value = converter.turndown(rich.innerHTML);
      render();
      cache();
      scheduleRecovery();
      status("Alterações pendentes · salvamento automático em até 30s");
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
      root.querySelector("[data-save-copy]").hidden = true;
      root.querySelector("[data-export-result]").textContent = "";
      rich.innerHTML = cleanHtml(note.markdown);
      recovered = note.recovery || null;
      try {
        const cached = JSON.parse(localStorage.getItem(cacheKey()));
        if (cached && signature(cached) !== saved) recovered = cached;
      } catch { /* Invalid WebView cache does not affect persisted notes. */ }
      root.querySelector("[data-recovery]").hidden =
        !recovered || signature(recovered) === saved;
      render();
      status("Documento salvo · revisão " + note.revision);
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
          status(isClean() ? "Salvo · revisão " + result.revision : "Novas alterações pendentes");
        } catch (error) {
          root.querySelector("[data-save-copy]").hidden = !error.conflict;
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
        try { localStorage.removeItem(cacheKey()); } catch {}
        load(note);
        status("Cópia salva.");
      } catch (error) { status(error.message); }
      finally { copying = false; setLocked(false); }
    }

    function setMode(next) {
      if (next === mode) return;
      if (next === "rich") rich.innerHTML = cleanHtml(source.value);
      // source is updated on each rich input, preserving unedited Markdown.
      mode = next;
      surface.dataset.editorMode = mode;
      source.hidden = mode === "rich";
      rich.hidden = mode !== "rich";
      root.querySelectorAll("[data-mode]").forEach(button => {
        button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
      });
      (mode === "rich" ? rich : source).focus();
    }

    function format(kind) {
      if (mode === "rich") {
        rich.focus();
        const commands = {
          bold: ["bold"], italic: ["italic"], heading: ["formatBlock", "h2"],
          list: ["insertUnorderedList"], quote: ["formatBlock", "blockquote"],
          code: ["formatBlock", "pre"]
        };
        const [command, argument] = commands[kind];
        document.execCommand(command, false, argument || null);
        changed();
        return;
      }
      const start = source.selectionStart;
      const end = source.selectionEnd;
      const selected = source.value.slice(start, end) || "texto";
      const wrappers = {
        bold: ["**", "**"], italic: ["*", "*"], heading: ["\n## ", "\n"],
        list: ["\n- ", "\n"], quote: ["\n> ", "\n"], code: ["\n\x60\x60\x60\n", "\n\x60\x60\x60\n"]
      };
      const [before, after] = wrappers[kind];
      source.setRangeText(before + selected + after, start, end, "select");
      source.focus();
      changed();
    }

    function setLocked(locked) {
      source.disabled = locked;
      title.disabled = locked;
      rich.contentEditable = String(!locked);
      root.querySelectorAll("[data-format], [data-mode], [data-save], [data-export], [data-save-copy], [data-recover]").forEach(button => {
        button.disabled = locked;
      });
    }

    function destroy() {
      cache();
      clearInterval(timer);
      clearTimeout(recoveryTimer);
      if (!isClean()) {
        enqueue(() => request("document/recovery", buffer())).catch(() => {});
      }
      destroyed = true;
      controller.abort();
    }

    source.addEventListener("input", changed, listeners);
    rich.addEventListener("input", changed, listeners);
    title.addEventListener("input", changed, listeners);
    rich.addEventListener("paste", event => {
      event.preventDefault();
      const plain = event.clipboardData.getData("text/plain");
      document.execCommand("insertText", false, plain);
      changed();
    }, listeners);
    root.querySelectorAll("[data-format]").forEach(button => {
      button.addEventListener("mousedown", event => event.preventDefault(), listeners);
      button.addEventListener("click", () => format(button.dataset.format), listeners);
    });
    root.querySelectorAll("[data-mode]").forEach(button => {
      button.addEventListener("click", () => setMode(button.dataset.mode), listeners);
    });
    root.querySelector("[data-preview-toggle]").addEventListener("change", event => {
      surface.dataset.preview = String(event.target.checked);
    }, listeners);
    root.querySelector("[data-save]").addEventListener("click", () => {
      flush().catch(() => {});
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
        localStorage.removeItem(cacheKey());
        recovered = null;
        root.querySelector("[data-recovery]").hidden = true;
      } catch (error) { status(error.message); }
    }, listeners);
    root.querySelectorAll("[data-export]").forEach(button => {
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          await flush();
          const result = await request("document/export", {
            id: documentState.id, revision: documentState.revision,
            format: button.dataset.export
          });
          root.querySelector("[data-export-result]").textContent =
            "Exportado para: " + result.path;
          status("Exportação concluída.");
        } catch (error) { status(error.message); }
        finally { button.disabled = false; }
      }, listeners);
    });
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
      if (["b", "i"].includes(key)) {
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
    const instance = {load, flush, destroy, isClean, setLocked};
    active = instance;
    load(options.document);
    return instance;
  }

  window.WriterEditor = {
    create,
    isClean: () => active ? active.isClean() : true
  };
})();

