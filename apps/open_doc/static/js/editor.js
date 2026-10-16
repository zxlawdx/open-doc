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
    // execCommand(formatBlock, pre) creates a bare pre, unlike marked's pre/code.
    converter.addRule("nativeCodeBlock", {
      filter: node => node.nodeName === "PRE" && !node.querySelector("code"),
      replacement(content, node) {
        const text = node.textContent.replace(/\n$/, "");
        const runs = text.match(/`+/g) || [];
        const fence = "`".repeat(Math.max(3, ...runs.map(run => run.length + 1)));
        return "\n\n" + fence + "\n" + text + "\n" + fence + "\n\n";
      }
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

    let documentState = null, model = null;
    let pagination=null;
    const mediaCache=new Map();
    let saved = "";
    let mode = "rich";
    let chain = Promise.resolve();
    let destroyed = false, suspended = false;
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

    function mediaUrl(mid){
      if(!mediaCache.has(mid))mediaCache.set(mid,request('document/media',{id:documentState.id,media_id:mid}).then(r=>r.url));
      return mediaCache.get(mid);
    }
    function renderRich(){if(model && window.OpenDocRichRenderer)window.OpenDocRichRenderer.render(model,rich,mediaUrl);else {rich.innerHTML=cleanHtml(source.value);for(const node of Array.from(rich.childNodes))if(node.nodeType===3 && !node.textContent.trim())node.remove();}pagination?.invalidate();}
    function updateModel(dirty=null){if(window.OpenDocRichSerializer)model=window.OpenDocRichSerializer.serialize(rich,model,dirty);}
    function buffer() {
      return {
        id: documentState.id,
        title: title.value.trim() || "Sem título",
        markdown: source.value,
        ...(model?{content_format:"opendoc-rich-v1",content:model}:{}),
        revision: documentState.revision,
        selection: mode === "rich" ? commands.bookmark() : {start: source.selectionStart, length: source.selectionEnd - source.selectionStart}
      };
    }

    function signature(snapshot) {
      return JSON.stringify([snapshot.title,snapshot.content?window.OpenDocModel.fingerprint(snapshot.content):snapshot.markdown]);
    }

    function isClean() {
      if(suspended)return true;
      return !documentState || signature(buffer()) === saved;
    }

    function cache() {
      if(suspended)return;
      if (!documentState) return;
      if (isClean()) window.OpenDocRecovery.clear(documentState.id);
      else window.OpenDocRecovery.write(buffer());
    }

    function updateHistoryControls() {
      root.querySelectorAll('[data-command="undo"]').forEach(button => { button.disabled = !history.canUndo(); });
      root.querySelectorAll('[data-command="redo"]').forEach(button => { button.disabled = !history.canRedo(); });
    }

    function render() {
      if(suspended)return;
      if(model && mode==='preview')window.OpenDocRichRenderer.render(model,preview,mediaUrl);else if(!model)preview.innerHTML = cleanHtml(source.value);
      if (mode === "markdown") {
        source.style.height = "auto";
        source.style.height = Math.max(1123, source.scrollHeight) + "px";
      }
      const text = (model?rich:preview).textContent.trim();
      const count = text ? text.split(/\s+/u).length : 0;
      root.querySelector("[data-count]").textContent =
        count + (count === 1 ? " palavra" : " palavras");
      root.dataset.dirty = String(!isClean());
      root.dispatchEvent(new CustomEvent("open-doc:content", {detail: {mode}}));
      updateHistoryControls();
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

    function changed(kind = nextKind, origin = rich, inputEvent=null) {
      if (mode === 'rich' && origin === rich){
        let dirty=null;if(kind==='typing' && inputEvent?.isTrusted && model){dirty=getSelection().anchorNode;if(dirty?.nodeType===3)dirty=dirty.parentElement;while(dirty && dirty.parentNode!==rich)dirty=dirty.parentElement;}
        updateModel(dirty);source.value=model?window.OpenDocModel.markdown(model):converter.turndown(rich.innerHTML);
      }
      history.record(buffer(), kind);
      updateHistoryControls();
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
      model=note.content?window.OpenDocModel.clone(note.content):null;mediaCache.clear();
      const warning=root.querySelector('[data-rich-warning]'),list=root.querySelector('[data-rich-warnings]');
      if(warning && list){const warnings=model?.metadata?.warnings || [];warning.hidden=!warnings.length;list.replaceChildren();for(const message of warnings.slice(0,30)){const li=document.createElement('li');li.textContent=message;list.appendChild(li);}}
      const section=model?.sections?.[0];surface.style.width=section?section.page_width_pt*4/3+'px':'';surface.style.minHeight=section?section.page_height_pt+'pt':'';surface.dataset.pageWidth=section?section.page_width_pt*4/3:'';surface.dataset.pageHeight=section?section.page_height_pt*4/3:'';
      for(const pane of [rich,preview]){pane.style.minHeight=section?section.page_height_pt+'pt':'';pane.style.padding=section?[section.margin_top_pt,section.margin_right_pt,section.margin_bottom_pt,section.margin_left_pt].map(n=>n+'pt').join(' '):'';}
      for(const [kind,selector] of [['headers','[data-rich-header]'],['footers','[data-rich-footer]']]){const pane=root.querySelector(selector);if(!pane)continue;const values=model?Object.values(model[kind] || {}):[];pane.hidden=!values.length;if(values.length)window.OpenDocRichRenderer.render({...model,blocks:values[0]},pane,mediaUrl);}

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
      renderRich();source.readOnly=Boolean(model);
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
      if(suspended)return Promise.resolve();
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
          title: snapshot.title + " (cópia)", markdown: snapshot.markdown,
          ...(snapshot.content?{content_format:"opendoc-rich-v1",content:snapshot.content,source_id:documentState.id}:{})
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
      if(model && next==='markdown'){source.readOnly=true;status('Markdown simplificado: somente leitura para preservar a formatação.');}
      if (next === "rich") renderRich();
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
      model=snapshot.content?window.OpenDocModel.clone(snapshot.content):null;source.readOnly=Boolean(model);renderRich();
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
      if(['underline','strike','superscript','subscript'].includes(kind)){
        const current=textState(),patch=kind==='underline'?{underline:current.underline && current.underline!=='none'?'none':'single'}:kind==='strike'?{strike:!current.strike}:{vertical_align:current.vertical_align===kind?'baseline':kind};style('inline',patch);return;
      }
      if(kind==='table'){if(mode!=='rich')setMode('rich');commands.restore();if(window.OpenDocTables?.insert(rich,getSelection().rangeCount?getSelection().getRangeAt(0):null))changed('format');return;}
      if(model && mode==='markdown' && kind!=='selectAll'){status('Edite este documento no modo visual.');return;}
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

    function textState(){
      const selection=getSelection();let node=selection.anchorNode;
      if(node?.nodeType===1){node=node.childNodes[Math.min(selection.anchorOffset,node.childNodes.length-1)] || node;while(node.firstChild)node=node.firstChild;}
      let e=node && (node.nodeType===1?node:node.parentElement);const ancestors=[],map=model && window.OpenDocModel?window.OpenDocModel.index(model):new Map(),out={};
      while(e && rich.contains(e)){ancestors.unshift(e);e=e.parentElement;}
      for(const element of ancestors){Object.assign(out,map.get(element.dataset.nodeId)?.style || {});if(window.OpenDocRichSerializer)Object.assign(out,window.OpenDocRichSerializer.readStyle(element,out));}
      return out;
    }
    function style(scope,patch){
      if(lockedState || !window.OpenDocFormatting)return;
      if(patch.line_spacing!==undefined)patch.line_spacing_rule='auto';
      if(patch.font_size_pt!==undefined && (!Number.isFinite(patch.font_size_pt) || patch.font_size_pt<1 || patch.font_size_pt>512)){status('Tamanho válido: 1 a 512 pt.');return;}
      if(mode!=='rich')setMode('rich');history.checkpoint(buffer());commands.restore();const selection=getSelection(),range=selection.rangeCount?selection.getRangeAt(0):null;
      const applied=scope==='inline'?window.OpenDocFormatting.apply(rich,range,patch):window.OpenDocFormatting.paragraph(rich,range,patch);
      if(applied){commands.capture();const bookmark=commands.bookmark(),affected=Array.from(rich.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,blockquote,pre')).filter(p=>range && range.intersectsNode(p));updateModel();const map=window.OpenDocModel.index(model);
        for(const block of affected){const value=map.get(block.dataset.nodeId);if(!value)continue;const temp=document.createElement('div');window.OpenDocRichRenderer.render({...model,blocks:[value]},temp,mediaUrl);block.parentNode.replaceChild(temp.firstChild,block);}
        commands.restoreBookmark(bookmark);changed('format');root.dispatchEvent(new CustomEvent('open-doc:content'));
      }else status('Selecione o texto a formatar.');
    }

    async function exportDocument(extension) {
      await flush();
      status("Preparando exportação…");
      const bridge = window.pywebview?.api;
      if (!bridge?.export_document) throw Error("Exportação requer a janela nativa do Vela.");
      const result = await bridge.export_document(documentState.id, documentState.revision, extension);
      if (result.cancelled) { status("Exportação cancelada."); return result; }
      if (result.error) throw Error(result.error);
      root.querySelector("[data-export-result]").textContent = "Salvo em: " + result.path;
      status(result.lossy ? "Arquivo exportado com avisos de compatibilidade." : "Arquivo exportado.");
      return result;
    }


    function commitModel(next, kind='format') {
      history.checkpoint(buffer());model=next;source.value=window.OpenDocModel.markdown(model);source.readOnly=true;
      renderRich();history.record(buffer(),kind);cache();scheduleRecovery();render();
    }
    function ensureModel(){if(!model)updateModel();return window.OpenDocModel.clone(model);}
    function insertPage(where='break',pageIndex=null){
      if(lockedState)return;const next=ensureModel();if(!next)return;
      let node=getSelection()?.anchorNode;node=node?.nodeType===1?node:node?.parentElement;
      let block=node?.closest('[data-node-id][data-node-type="paragraph"],table[data-node-id]');
      if(pageIndex!==null){const page=rich.querySelector('[data-page-index="'+pageIndex+'"]'),blocks=page?.querySelector('[data-page-content]')?.children;block=blocks?.[where==='above'?0:blocks.length-1];}
      let index=next.blocks.findIndex(b=>b.id===(block?.dataset.fragmentOf || block?.dataset.nodeId));
      if(index<0)index=next.blocks.length-1;
      const M=window.OpenDocModel,br=()=>({id:M.id(),type:'page_break',manual:true}),empty=()=>({id:M.id(),type:'paragraph',style:{},children:[]});
      const at=where==='above'?Math.max(0,index):index+1;
      let following=empty();
      if(where==='break' && pageIndex===null && block && next.blocks[index]?.type==='paragraph' && getSelection()?.rangeCount){
        const caret=getSelection().getRangeAt(0),before=document.createRange();before.selectNodeContents(block);before.setEnd(caret.startContainer,caret.startOffset);let offset=before.cloneContents().textContent.length;
        if(block.dataset.fragmentOf)for(const part of rich.querySelectorAll('[data-node-id="'+block.dataset.fragmentOf+'"]')){if(part===block)break;offset+=part.textContent.length;}
        function split(children){const left=[],right=[];for(const run of children){if(run.type==='text'){if(offset>=run.text.length){left.push(run);offset-=run.text.length;}else{if(offset>0)left.push({...run,text:run.text.slice(0,offset)});right.push({...run,id:M.id(),text:run.text.slice(offset)});offset=0;}}else if(run.type==='hyperlink'){const [a,b]=split(run.children);if(a.length)left.push({...run,children:a});if(b.length)right.push({...run,id:M.id(),children:b});}else if(offset>0)left.push(run);else right.push(run);}return [left,right];}
        const original=next.blocks[index],[left,right]=split(original.children || []);next.blocks[index]={...original,children:left};following={...original,id:M.id(),children:right};delete following.raw_xml;delete following.section_end_id;
      }
      const inserted=where==='break'?[br(),following]:at>=next.blocks.length?[br(),empty()]:[br(),empty(),br()];
      // A break at the beginning creates the requested blank first page.
      if(where==='above' && at===0)inserted.shift();
      next.blocks.splice(at,0,...inserted);commitModel(next);
      const target=rich.querySelector('[data-node-id="'+inserted.find(n=>n.type==='paragraph').id+'"]');
      if(target){const range=document.createRange();range.selectNodeContents(target);range.collapse(true);rich.focus();getSelection().removeAllRanges();getSelection().addRange(range);commands.capture();}
    }
    function pageSetup(values){
      const next=ensureModel();const previous=next.sections?.[0] || {};
      const section={...window.OpenDocPagination.defaults,...previous,...values,type:'section',id:previous.id || window.OpenDocModel.id()};
      if(![section.page_width_pt,section.page_height_pt].every(n=>Number.isFinite(n)&&n>=100&&n<=4000))throw Error('Dimensões de página inválidas.');
      for(const key of ['margin_top_pt','margin_bottom_pt','margin_left_pt','margin_right_pt'])if(!Number.isFinite(section[key])||section[key]<0)throw Error('Margens inválidas.');
      if(section.margin_left_pt+section.margin_right_pt>=section.page_width_pt-20 || section.margin_top_pt+section.margin_bottom_pt>=section.page_height_pt-20)throw Error('As margens precisam deixar espaço para o conteúdo.');
      next.sections=[section,...(next.sections || []).slice(1)];commitModel(next);surface.dataset.pageWidth=section.page_width_pt*4/3;surface.dataset.pageHeight=section.page_height_pt*4/3;surface.style.width=section.page_width_pt+'pt';pagination?.invalidate();
    }
    function replaceText(query,replacement,all=false,occurrence=0){
      if(!query)return 0;const next=ensureModel();let count=0,seen=0;
      function visit(blocks){for(const block of blocks){if(block.type==='table'){for(const row of block.rows)for(const cell of row.cells)visit(cell.blocks);continue;}
        if(block.type!=='paragraph')continue;
        // Offsets are model text offsets; replacements may span differently styled runs.
        const runs=[];function collect(children){for(const run of children || []){if(run.type==='text')runs.push(run);else if(run.type==='hyperlink')collect(run.children);}}collect(block.children);
        const text=runs.map(r=>r.text).join(''),matches=[];let at=0;
        while((at=text.indexOf(query,at))>=0){if(all || seen===occurrence)matches.push(at);seen++;at+=query.length;}
        for(const start of matches.reverse()){const end=start+query.length;let offset=0,inserted=false;for(const run of runs){const length=run.text.length,lo=Math.max(0,start-offset),hi=Math.min(length,end-offset);if(hi>lo){run.text=run.text.slice(0,lo)+(inserted?'':replacement)+run.text.slice(hi);inserted=true;}offset+=length;}count++;}
      }}visit(next.blocks);if(count)commitModel(next);return count;
    }
    function tableOperation(action,rows=2,cols=2){
      if(action==='insert'){commands.restore();const range=getSelection()?.rangeCount?getSelection().getRangeAt(0):null;if(window.OpenDocTables.insert(rich,range,rows,cols))changed('format');return;}
      const n=getSelection()?.anchorNode,e=n?.nodeType===1?n:n?.parentElement,cell=e?.closest('td,th'),table=cell?.closest('table');
      if(!table)return status('Selecione uma célula da tabela.');
      history.checkpoint(buffer());window.OpenDocTables.operate(table,cell,action);changed('format');
    }
    function setLocked(locked) {
      lockedState = locked;
      source.disabled = locked;
      title.disabled = locked;
      rich.contentEditable = String(!locked);
      root.querySelectorAll("[data-command], [data-inline-style], [data-paragraph-style], [data-mode], [data-save], [data-export], [data-save-copy], [data-recover]").forEach(button => {
        button.disabled = locked;
      });
      if (!locked) render();
    }

    function destroy() {
      cache();
      pagination?.destroy();
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
    rich.addEventListener("input", event => changed(nextKind,rich,event), listeners);
    title.addEventListener("input", () => {if(root.dataset.documentKind!=='fixed')changed("typing", title);}, listeners);
    window.OpenDocTables?.bind(rich,controller.signal,action=>{try{tableOperation(action);}catch(error){status(error.message);}});
    rich.addEventListener('click',event=>{const marker=event.target.closest('[data-note-id]');if(marker && model){const notes=model[marker.dataset.noteKind]?.[marker.dataset.noteId];if(notes)status('Nota '+marker.dataset.noteId+': '+notes.map(p=>(p.children || []).map(r=>r.text || '').join('')).join(' '));}},listeners);
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
      if(root.dataset.documentKind==='fixed' || !(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if(key === "enter" && mode === "rich" && rich.contains(getSelection()?.anchorNode)){event.preventDefault();insertPage("break");return;}
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
    function inkLayers(){return model?.ink_layers || [];}
    function setInkLayers(layers){const next=ensureModel();next.ink_layers=layers;commitModel(next,'ink');root.dispatchEvent(new CustomEvent('open-doc:content'));}
    function insertRecognized(text,style,index,strokeIds){const next=ensureModel(),layer=(next.ink_layers || []).find(l=>l.surface_index===index);if(!layer)return;const at=next.blocks.findIndex(b=>b.id===layer.anchor_block_id);next.blocks.splice(at<0?next.blocks.length:at+1,0,{id:window.OpenDocModel.id(),type:'paragraph',style:{},children:[{id:window.OpenDocModel.id(),type:'text',text,style:{...style,color:style.color.replace('#','')}}]});layer.strokes=layer.strokes.filter(s=>!strokeIds.includes(s.id));commitModel(next,'recognition');}
    const instance = {suspend:value=>{suspended=value;},inkLayers,setInkLayers,insertRecognized,load, flush, destroy, isClean, setLocked, setMode, format, insertPage, pageSetup, replaceText, tableOperation, pageView: value=>pagination?.setMode(value), pagination:()=>pagination, copy: copyDocument, export: exportDocument, capture: commands.capture, style, textState, commandState: commands.state, refresh: render, snapshot: buffer};
    active = instance;
    if(window.OpenDocPagination)pagination=window.OpenDocPagination.create({root,model:()=>model,pageMetrics:()=>model?.sections?.[0],capture:()=>{commands.capture();return commands.bookmark();},restore:b=>commands.restoreBookmark(b)});
    if(window.OpenDocPageMenu)window.OpenDocPageMenu.create(root,instance,controller.signal);
    load(options.document);
    pagination?.setMode(options.viewMode || "pages");
    setMode("rich");
    return instance;
  }

  window.OpenDocEditor = {
    create,
    isClean: () => active ? active.isClean() : true
  };
})();

