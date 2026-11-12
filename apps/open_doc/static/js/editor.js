/* ============ PERSISTENT MARKDOWN / RICH EDITOR ============ */
"use strict";
(() => {
  const AUTOSAVE_MS = 1000;
  const RECOVERY_DELAY = 600;
  let active = null;
  window.OpenDocDebug=window.OpenDocDebug || {input:false};

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
    let saved = null;
    let mode = "rich", typingStyle=null, deletionStyle=null;
    let chain = Promise.resolve();
    let destroyed = false, suspended = false;
    let recoveryTimer = null;
    let recovered = null;
    let copying = false;
    let lockedState = false;
    let renderTimer = null, cacheTimer=null, markdownStale=false;
    let nextKind = "typing",beforeInputBlockId=null,beforeInputCrossPage=false;
    let beforeParagraphSplit=null, pendingTextInsertion=null;
    function syncMarkdown(){
      if(model&&markdownStale){source.value=window.OpenDocModel.markdown(model);markdownStale=false;}
    }
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
    function renderRich(){
      const rebuild=()=>{
        if(model && window.OpenDocRichRenderer)window.OpenDocRichRenderer.render(model,rich,mediaUrl);
        else {
          rich.innerHTML=cleanHtml(source.value) || '<p><br></p>';
          for(const node of Array.from(rich.childNodes))if(node.nodeType===3&&!node.textContent.trim())node.remove();
        }
      };
      // Publish the rebuilt document and its page shells in the same task.
      if(pagination&&!rich.hidden)pagination.rebuild(rebuild);
      else {rebuild();pagination?.invalidate();}
    }
    function updateModel(dirty=null,affected=null){if(window.OpenDocRichSerializer)model=window.OpenDocRichSerializer.serialize(rich,model,dirty,affected);}
    const currentTitle=()=>title.value.trim() || "Sem título";

    function buffer() {
      const selection=mode==='rich'?commands.bookmark():{start:source.selectionStart,length:source.selectionEnd-source.selectionStart};
      const image=rich.contains(document.activeElement)&&document.activeElement.closest?.('.rich-image');
      return {
        id: documentState.id,
        title: currentTitle(),
        markdown: source.value,
        ...(model?{content_format:"opendoc-rich-v1",content:model}:{}),
        revision: documentState.revision,
        selection: image?{...selection,imageId:image.dataset.nodeId}:selection
      };
    }

    function isClean() {
      if(suspended)return true;
      return !documentState || window.OpenDocHistory.sameSnapshot(
        {title:currentTitle(),content:model,markdown:source.value},saved);
    }

    function cache() {
      if(suspended||!documentState)return;
      // JSON.stringify + synchronous localStorage on every Enter/Backspace
      // blocks Qt's UI thread. Keep SQLite recovery scheduled independently.
      clearTimeout(cacheTimer);
      cacheTimer=setTimeout(()=>{
        if(destroyed||!documentState)return;
        if(isClean())window.OpenDocRecovery.clear(documentState.id);
        else window.OpenDocRecovery.write(buffer());
      },400);
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
      const dirtyState=!isClean();
      root.dataset.dirty = String(dirtyState);
      root.dispatchEvent(new CustomEvent("open-doc:content", {detail: {mode}}));
      updateHistoryControls();
      if (window.pywebview?.api?.set_dirty) {
        window.pywebview.api.set_dirty(dirtyState).catch(() => {});
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

    function planTextInsertion(event, selection, paragraph) {
      if(event.inputType!=='insertText'||event.isComposing||!event.data||!selection?.isCollapsed||
         !paragraph?.matches('p[data-node-id]:not([data-fragment-of]):not([data-list-info])'))return null;
      const node=selection.anchorNode, span=node?.parentElement;
      if(node?.nodeType!==3||!span?.matches('span[data-node-type=text][data-node-id]:not([data-style-patch])')||
         span.parentElement!==paragraph||span.childNodes.length!==1)return null;
      const blockIndex=model?.blocks.findIndex(block=>block.id===paragraph.dataset.nodeId);
      const block=model?.blocks[blockIndex];
      if(block?.type!=='paragraph')return null;
      const runIndex=block.children.findIndex(run=>run.id===span.dataset.nodeId);
      const run=block.children[runIndex];
      if(run?.type!=='text'||run.text!==node.data)return null;
      const offset=selection.anchorOffset;
      const text=node.data.slice(0,offset)+event.data+node.data.slice(offset);
      return {model,paragraph,span,node,blockIndex,runIndex,text,offset:offset+event.data.length};
    }
    function applyTextInsertion(event) {
      const edit=pendingTextInsertion;
      pendingTextInsertion=null;
      if(!edit||event?.inputType!=='insertText'||model!==edit.model)return null;
      const selection=getSelection();
      if(!selection?.isCollapsed||selection.anchorNode!==edit.node||selection.anchorOffset!==edit.offset||
         edit.node.parentElement!==edit.span||edit.span.childNodes.length!==1||
         edit.span.parentElement!==edit.paragraph||!rich.contains(edit.paragraph))return null;
      const text=edit.node.data;
      // Native contenteditable may swap spaces and NBSPs to preserve wrapping.
      if(text!==edit.text&&text.replace(/\u00a0/g,' ')!==edit.text.replace(/\u00a0/g,' '))return null;
      const blocks=model.blocks.slice(),block=blocks[edit.blockIndex],children=block.children.slice();
      children[edit.runIndex]={...children[edit.runIndex],text};
      blocks[edit.blockIndex]={...block,children};
      model={...model,blocks};
      markdownStale=true;
      commands.capture();
      return edit.paragraph;
    }

    function changed(kind = nextKind, origin = rich, inputEvent=null) {
      if(inputEvent?.isComposing)return;
      let dirty=mode==='rich'&&origin===rich&&kind==='typing'?applyTextInsertion(inputEvent):null;
      let structural=false;
      const beforeDom=window.OpenDocDebug.input?rich.textContent:null;
      if (mode === 'rich' && origin === rich && !dirty){
        commands.capture();const bookmark=commands.bookmark();
        let normalized=false;for(const box of rich.querySelectorAll('[data-page-content]'))normalized=window.OpenDocPagination.normalize(box) || normalized;
        if(normalized && bookmark)commands.restoreBookmark(bookmark);
        if(model){let node=getSelection()?.anchorNode;node=node?.nodeType===3?node.parentElement:node;
          while(node && node!==rich){if(node.tagName==='LI' || node.parentElement?.matches('[data-page-content],[data-rich]')){dirty=node;break;}node=node.parentElement;}
          const focus=getSelection()?.focusNode,focusElement=focus?.nodeType===3?focus.parentElement:focus;
          if(dirty && focusElement && !dirty.contains(focusElement))dirty=null;
        }
        const inputType=inputEvent?.inputType || '',dirtyId=dirty?.dataset.fragmentOf || dirty?.dataset.nodeId;
        const inputStructural=/^(insertParagraph|insertLineBreak|deleteByCut|insertFromPaste)$/.test(inputType) || (/^deleteContent(Backward|Forward)$/.test(inputType) && (!dirtyId || dirtyId!==beforeInputBlockId));
        if(inputEvent?.inputType==='insertParagraph' && dirty){
          const oldId=dirty.dataset.fragmentOf || dirty.dataset.nodeId;
          const siblings=Array.from(rich.querySelectorAll('[data-page-content] > *,[data-page-content] li'));
          if(siblings.some(n=>n!==dirty && n.dataset.nodeId===oldId)){
            dirty.dataset.nodeId=window.OpenDocModel.id();delete dirty.dataset.fragmentOf;
            for(const n of siblings.slice(siblings.indexOf(dirty)+1))if(n.dataset.fragmentOf===oldId){n.dataset.fragmentOf=dirty.dataset.nodeId;n.dataset.nodeId=dirty.dataset.nodeId;}
          }
        }
        if(dirty && !dirty.dataset.nodeId){dirty.dataset.nodeId=window.OpenDocModel.id();structural=true;}
        if(kind==='typing' && inputEvent && !inputEvent.inputType && dirty && model){const old=model.blocks.find(b=>b.id===(dirty.dataset.fragmentOf || dirty.dataset.nodeId));const text=v=>!v || typeof v!=='object'?'':typeof v.text==='string'?v.text:Object.values(v).map(text).join('');if(old && dirty.textContent===text(old))dirty=null;}
        const ids=model?.blocks.map(b=>b.id).join('|');
        const split=beforeParagraphSplit;
        beforeParagraphSplit=null;
        const incremental=inputType==='insertParagraph' && split && dirty &&
          split.block===dirty.previousElementSibling && split.container===dirty.parentElement &&
          split.container.childElementCount===split.count+1 &&
          window.OpenDocRichSerializer.serializeParagraphSplit(rich,split.block,dirty,model);
        if(incremental)model=incremental;
        else updateModel(dirty,inputStructural?[beforeInputBlockId,dirty?.dataset.fragmentOf || dirty?.dataset.nodeId].filter(Boolean):null);
        structural=structural || ids!==model?.blocks.map(b=>b.id).join('|');
        // Markdown is a *secondary read-only view* for rich documents.
        // Serializing the whole document for each keystroke is O(N) work.
        if(model){
          if(kind==='typing' && inputEvent)markdownStale=true;
          else {source.value=window.OpenDocModel.markdown(model);markdownStale=false;}
        }else source.value=converter.turndown(rich.innerHTML);
      }
      const blockId=dirty?.dataset.fragmentOf || dirty?.dataset.nodeId || null;
      if(window.OpenDocDebug.input)console.debug('[OpenDoc input]',{beforeDom:beforeDom?.slice(-240),afterDom:rich.textContent.slice(-240),modelText:source.value.slice(-240),blockId,pageIndex:dirty?.closest('[data-page-index]')?.dataset.pageIndex,selection:commands.bookmark()});
      if(origin===rich)root.dispatchEvent(new CustomEvent('open-doc:text-layout-changed',
        {detail:{blockId,reason:kind,structural,full:beforeInputCrossPage}}));
      beforeInputCrossPage=false;
      history.record(buffer(), kind,{blockIds:Array.from(new Set([blockId,...(structural?[beforeInputBlockId]:[])].filter(Boolean))),structural});
      updateHistoryControls();
      cache();
      clearTimeout(renderTimer);
      renderTimer = setTimeout(render, 100);
      scheduleRecovery();
      const dirtyState=!isClean();
      root.dataset.dirty = String(dirtyState);
      if (window.pywebview?.api?.set_dirty) window.pywebview.api.set_dirty(dirtyState).catch(() => {});
      status("Alterações não salvas");
      root.dispatchEvent(new CustomEvent("open-doc:changed"));
    }

    function load(note) {
      finishLogicalTransaction();
      imageDrag=null;
      clearTimeout(recoveryTimer);clearTimeout(cacheTimer);markdownStale=false;
      typingStyle=null;deletionStyle=null;
      documentState = {...note};
      model=note.content?window.OpenDocModel.clone(note.content):null;mediaCache.clear();
      const warning=root.querySelector('[data-rich-warning]'),list=root.querySelector('[data-rich-warnings]');
      if(warning && list){const warnings=[...new Set(model?.metadata?.warnings || [])].filter(message=>!/^PRESERVED_OPAQUE: (bookmarkStart|bookmarkEnd|proofErr|lastRenderedPageBreak)$/.test(message));warning.hidden=!warnings.length;list.replaceChildren();for(const message of warnings.slice(0,30)){const li=document.createElement('li');li.textContent=message;list.appendChild(li);}}
      const section=model?.sections?.[0];surface.style.width=section?section.page_width_pt*4/3+'px':'';surface.style.minHeight=section?section.page_height_pt+'pt':'';surface.dataset.pageWidth=section?section.page_width_pt*4/3:'';surface.dataset.pageHeight=section?section.page_height_pt*4/3:'';
      for(const pane of [rich,preview]){pane.style.minHeight=section?section.page_height_pt+'pt':'';pane.style.padding=section?[section.margin_top_pt,section.margin_right_pt,section.margin_bottom_pt,section.margin_left_pt].map(n=>n+'pt').join(' '):'';}
      for(const [kind,selector] of [['headers','[data-rich-header]'],['footers','[data-rich-footer]']]){const pane=root.querySelector(selector);if(!pane)continue;const values=model?Object.values(model[kind] || {}):[];pane.hidden=!values.length;if(values.length)window.OpenDocRichRenderer.render({...model,blocks:values[0]},pane,mediaUrl);}

      source.value = note.markdown;
      title.value = note.title;
      saved = {title:note.title,content:model,markdown:note.markdown};
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
      if (cached && !window.OpenDocHistory.sameSnapshot(cached,saved)) recovered = cached;
      history.reset(buffer());
      root.querySelector("[data-recovery]").hidden =
        !recovered || window.OpenDocHistory.sameSnapshot(recovered,saved);
      render();
      status(recovered && !window.OpenDocHistory.sameSnapshot(recovered,saved) ? "Recuperação disponível" : "Salvo no dispositivo");
    }

    function flush() {
      finishLogicalTransaction();
      clearTimeout(cacheTimer); clearTimeout(recoveryTimer);
      if(suspended)return Promise.resolve();
      return enqueue(async () => {
        if (isClean()) return documentState;
        let result;
        while (!isClean()) {
        clearTimeout(cacheTimer); clearTimeout(recoveryTimer);
        const snapshot = buffer();
        status("Salvando…");
        root.dataset.saving = "true";
        try {
          result = await request("document/save", snapshot);
          documentState.revision = result.revision;
          saved = snapshot;
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
      finishLogicalTransaction();
      if (!["rich", "markdown", "preview"].includes(next)) return;
      if(model && next==='markdown'){
        syncMarkdown();source.readOnly=true;
        status('Markdown simplificado: somente leitura para preservar a formatação.');
      }
      mode = next;
      surface.dataset.editorMode = mode;
      source.hidden = mode !== "markdown";
      rich.hidden = mode !== "rich";
      preview.hidden = mode !== "preview";
      if (next === "rich") renderRich();
      root.querySelectorAll("[data-mode]").forEach(button => {
        button.setAttribute("aria-checked", String(button.dataset.mode === mode));
      });
      const label = root.querySelector("[data-mode-label]");
      if (label) label.textContent = {rich: "Editor visual", markdown: "Código Markdown", preview: "Visualização"}[mode];
      render();
      if (mode !== "preview") (mode === "rich" ? rich : source).focus();
    }

    function restoreSnapshot(snapshot) {
      finishLogicalTransaction();
      if (!snapshot) return;
      typingStyle=null;deletionStyle=null;
      if(snapshot.historyChange?.affected?.inkOnly&&snapshot.content&&model?.blocks===snapshot.content.blocks){
        model=snapshot.content;
        cache();scheduleRecovery();updateHistoryControls();
        const dirty=!isClean();
        root.dataset.dirty=String(dirty);
        window.pywebview?.api?.set_dirty?.(dirty)?.catch?.(()=>{});
        root.dispatchEvent(new CustomEvent('open-doc:ink-changed'));
        status(dirty?'Alterações não salvas':'Salvo no dispositivo');
        return;
      }
      title.value = snapshot.title;
      source.value = snapshot.markdown;
      const before=model,after=snapshot.content || null,canvas=root.querySelector('[data-canvas]'),top=canvas?.scrollTop || 0,left=canvas?.scrollLeft || 0;
      if(!window.OpenDocModel){model=after;renderRich();cache();scheduleRecovery();render();commands.restoreBookmark(snapshot.selection);return;}
      let target=after;
      if(!target){const temp=document.createElement('div');temp.innerHTML=cleanHtml(snapshot.markdown) || '<p><br></p>';target=window.OpenDocRichSerializer.serialize(temp,window.OpenDocModel.empty());}
      const previous=before || window.OpenDocModel.empty();
      const changed=target.blocks.filter(b=>JSON.stringify(b)!==JSON.stringify(previous.blocks.find(v=>v.id===b.id))).map(b=>b.id);
      const removed=previous.blocks.filter(b=>!target.blocks.some(v=>v.id===b.id)).map(b=>b.id),affected=[...changed,...removed];
      const firstNode=Array.from(rich.querySelectorAll('[data-node-id]')).find(n=>affected.includes(n.dataset.nodeId));
      const pageIndex=Number(firstNode?.closest('[data-page-index]')?.dataset.pageIndex || 0);
      model=after;source.readOnly=Boolean(model);
      if(!before||!after)renderRich();
      else if(!affected.length){root.dispatchEvent(new CustomEvent('open-doc:ink-changed'));}
      else if(JSON.stringify(previous.sections || [])===JSON.stringify(target.sections || []) && window.OpenDocRichRenderer.reconcile(previous,target,rich,mediaUrl)){
        if(JSON.stringify(previous.blocks.map(b=>b.id))!==JSON.stringify(target.blocks.map(b=>b.id)) || changed.some(id=>!pagination?.fits(id)))pagination?.invalidate(changed[0],{preserveScroll:true,pageIndex});
      }else renderRich();
      cache(); scheduleRecovery(); render();
      status(isClean() ? "Salvo no dispositivo" : "Alterações não salvas");
      if (mode === "rich") {
        commands.restoreBookmark(snapshot.selection);
        if(snapshot.selection?.imageId)selectImage(Array.from(rich.querySelectorAll('.rich-image'))
          .find(element=>element.dataset.nodeId===snapshot.selection.imageId));
      }
      else { source.focus(); source.setSelectionRange(snapshot.selection?.start || 0, (snapshot.selection?.start || 0) + (snapshot.selection?.length || 0)); }
      if(canvas){canvas.scrollTop=top;canvas.scrollLeft=left;}
    }

    function format(kind, value) {
      finishLogicalTransaction();
      if (lockedState) return;
      history.checkpoint(buffer());
      if (kind === "undo" || kind === "redo") {
        root.dispatchEvent(new CustomEvent('open-doc:cancel-ink'));
        restoreSnapshot(history[kind]());return;
      }
      if (mode === "preview") setMode("rich");
      if(mode==='rich'&&['bold','italic','underline','strike','superscript','subscript'].includes(kind)){
        commands.restore();
        const current=textState();
        const patch=kind==='underline'?{underline:current.underline&&current.underline!=='none'?'none':'single'}
          :kind==='superscript'||kind==='subscript'?{vertical_align:current.vertical_align===kind?'baseline':kind}
          :{[kind]:!((kind==='strike'||getSelection()?.isCollapsed)?current[kind]:
            window.OpenDocFormatting.selectionHasStyle(rich,getSelection()?.rangeCount?getSelection().getRangeAt(0):null,kind))};
        style('inline',patch);return;
      }
      if(kind==='table'){if(mode!=='rich')setMode('rich');commands.restore();if(window.OpenDocTables?.insert(rich,getSelection().rangeCount?getSelection().getRangeAt(0):null))changed('format');return;}
      if(model && mode==='markdown' && kind!=='selectAll'){status('Edite este documento no modo visual.');return;}
      if (kind === "selectAll" && mode === "markdown") { source.focus(); source.select(); return; }
      if (mode === "rich") {
        if((kind==='list'||kind==='ordered')&&toggleList(kind==='list'?'bullet':'decimal'))return;
        const mapping = {
          paragraph: ["formatBlock", "p"],
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

    let selectedMathId=null;
    rich.addEventListener("click",event=>{
      const el=event.target?.closest?.('[data-node-type="math"]');
      selectedMathId=el?.dataset.nodeId||null;
    },{signal:controller.signal});
    function selectedMath(){
      if(!selectedMathId)return null;
      const el=Array.from(rich.querySelectorAll('[data-node-type="math"]'))
        .find(n=>n.dataset.nodeId===selectedMathId);
      if(!el)return null;
      try{return {id:selectedMathId,math_blocks:JSON.parse(el.dataset.mathBlocks)};}
      catch{return null;}
    }
    // Binary assets are uploaded once. Image gestures commit one model snapshot.
    function imageBounds(element){
      const page=element?.closest('[data-page-index]');
      const section=model?.sections?.[0]||{};
      const width=Number(page?.dataset.widthPt)||section.page_width_pt||595.28;
      const height=Number(page?.dataset.heightPt)||section.page_height_pt||841.89;
      const host=page||rich,rect=host.getBoundingClientRect();
      return {host,rect,width,height,scale:rect.width>0?width/rect.width:.75};
    }
    function imageNode(element){return JSON.parse(element.dataset.imageNode);}
    function fitImage(value,bounds){
      const node={...value,placement:'floating',geometry_edited:true};
      node.width_pt=Number(node.width_pt)||72;node.height_pt=Number(node.height_pt)||72;
      const factor=Math.min(1,bounds.width/node.width_pt,bounds.height/node.height_pt);
      node.width_pt*=factor;node.height_pt*=factor;
      node.x_pt=Math.max(0,Math.min(bounds.width-node.width_pt,Number(node.x_pt)||0));
      node.y_pt=Math.max(0,Math.min(bounds.height-node.height_pt,Number(node.y_pt)||0));
      return node;
    }
    function imageChanged(before){
      history.checkpoint(before);
      updateModel();
      source.value=window.OpenDocModel.markdown(model);markdownStale=false;
      history.record(buffer(),'image',{structural:true});
      cache();scheduleRecovery();render();
      root.dispatchEvent(new CustomEvent('open-doc:text-layout-changed',{detail:{full:true,reason:'image'}}));
      root.dispatchEvent(new CustomEvent('open-doc:changed'));
      status('Imagem atualizada. Arraste para mover; alça para redimensionar; setas para ajustar.');
    }
    function selectImage(element){
      rich.querySelectorAll('.rich-image.is-selected').forEach(n=>n.classList.remove('is-selected'));
      if(element){element.classList.add('is-selected');element.focus({preventScroll:true});}
    }
    async function insertImage(dataUrl,altText=''){
      finishLogicalTransaction();
      if(lockedState||suspended||destroyed)return false;
      if(mode!=='rich')setMode('rich');
      commands.restore();
      const selectionMark=commands.bookmark(),documentId=documentState.id;
      const result=await request('document/image-asset',{id:documentId,data_url:dataUrl,alt_text:altText});
      if(destroyed||suspended||lockedState||documentState.id!==documentId)return false;
      commands.restoreBookmark(selectionMark);
      if(!model)updateModel();
      const before=buffer();
      const selection=getSelection();
      let range=selection?.rangeCount?selection.getRangeAt(0):null;
      if(!range||!rich.contains(range.commonAncestorContainer)){
        const box=rich.querySelector('[data-page-content]')||rich;
        const paragraph=document.createElement('p');paragraph.dataset.nodeId=window.OpenDocModel.id();
        paragraph.dataset.nodeType='paragraph';paragraph.appendChild(document.createElement('br'));box.appendChild(paragraph);
        range=document.createRange();range.selectNodeContents(paragraph);range.collapse(true);
      }
      const anchor=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement;
      const bounds=imageBounds(anchor),rect=anchor.getBoundingClientRect();
      const node=fitImage({...result.node,
        x_pt:Math.max(0,(rect.left-bounds.rect.left)*bounds.scale),
        y_pt:Math.max(0,(rect.top-bounds.rect.top)*bounds.scale)},bounds);
      const temp=document.createElement('div');
      window.OpenDocRichRenderer.render({blocks:[{id:window.OpenDocModel.id(),type:'paragraph',style:{},children:[node]}]},temp);
      const element=temp.querySelector('[data-node-type=image]');
      model={...model,media:{...model.media,[node.media_id]:result.media}};
      mediaCache.set(node.media_id,Promise.resolve(result.url));
      element.querySelector('img').src=result.url;
      // Insert at the caret without deleting a selected text passage.
      range.collapse(true);range.insertNode(element);
      selectImage(element);imageChanged(before);
      return true;
    }
    let imageDrag=null;
    rich.addEventListener('pointerdown',event=>{
      const element=event.target.closest?.('.rich-image');
      if(!element){selectImage(null);return;}
      if(lockedState||suspended||mode!=='rich'||event.button!==0)return;
      event.preventDefault();event.stopPropagation();finishLogicalTransaction();
      selectImage(element);
      const bounds=imageBounds(element),node=imageNode(element);
      const rect=element.getBoundingClientRect();
      const geometry=fitImage({...node,
        x_pt:(rect.left-bounds.rect.left)*bounds.scale,
        y_pt:(rect.top-bounds.rect.top)*bounds.scale},bounds);
      imageDrag={element,bounds,node,geometry,before:buffer(),x:event.clientX,y:event.clientY,
        pointerId:event.pointerId,resize:Boolean(event.target.closest('[data-image-resize]')),changed:false,
        parent:element.parentNode,next:element.nextSibling,created:[],
        grabX:(event.clientX-rect.left)*bounds.scale,grabY:(event.clientY-rect.top)*bounds.scale};
      element.setPointerCapture?.(event.pointerId);
    },{signal:controller.signal});
    rich.addEventListener('pointermove',event=>{
      const drag=imageDrag;if(!drag||event.pointerId!==drag.pointerId)return;
      event.preventDefault();
      const dx=(event.clientX-drag.x)*drag.bounds.scale,dy=(event.clientY-drag.y)*drag.bounds.scale;
      if(!drag.resize){
        const page=document.elementFromPoint?.(event.clientX,event.clientY)?.closest('[data-page-index]');
        if(page&&rich.contains(page)&&page!==drag.element.closest('[data-page-index]')){
          const box=page.querySelector('[data-page-content]');
          let paragraph=Array.from(box.children).filter(n=>n.matches('p,h1,h2,h3,h4,h5,h6,blockquote,pre'))
            .sort((a,b)=>Math.abs(a.getBoundingClientRect().top-event.clientY)-Math.abs(b.getBoundingClientRect().top-event.clientY))[0];
          if(!paragraph){paragraph=document.createElement('p');paragraph.dataset.nodeId=window.OpenDocModel.id();
            paragraph.dataset.nodeType='paragraph';box.appendChild(paragraph);drag.created.push(paragraph);}
          paragraph.appendChild(drag.element);drag.element.setPointerCapture?.(event.pointerId);
        }
      }
      drag.bounds=imageBounds(drag.element);
      let value={...drag.geometry};
      if(drag.resize){
        const ratio=value.width_pt/value.height_pt;
        const delta=Math.abs(dx)>=Math.abs(dy*ratio)?dx:dy*ratio;
        const width=Math.min(drag.bounds.width-value.x_pt,
          (drag.bounds.height-value.y_pt)*ratio,Math.max(4,value.width_pt+delta));
        value.width_pt=width;value.height_pt=width/ratio;
      }else{value.x_pt=(event.clientX-drag.bounds.rect.left)*drag.bounds.scale-drag.grabX;
        value.y_pt=(event.clientY-drag.bounds.rect.top)*drag.bounds.scale-drag.grabY;}
      value=fitImage(value,drag.bounds);
      drag.changed=Math.abs(dx)+Math.abs(dy)>1;
      window.OpenDocRichRenderer.imageGeometry(drag.element,value);
    },{signal:controller.signal});
    function finishImageDrag(event,cancel=false){
      const drag=imageDrag;if(!drag||event.pointerId!==drag.pointerId)return;
      imageDrag=null;
      drag.element.releasePointerCapture?.(event.pointerId);
      if(cancel||!drag.changed){
        drag.parent.insertBefore(drag.element,drag.next?.parentNode===drag.parent?drag.next:null);
        drag.created.filter(p=>!p.childNodes.length).forEach(p=>p.remove());
        window.OpenDocRichRenderer.imageGeometry(drag.element,drag.node);return;
      }
      if(!drag.parent.childNodes.length)drag.parent.appendChild(document.createElement('br'));
      drag.created.filter(p=>!p.childNodes.length).forEach(p=>p.remove());
      imageChanged(drag.before);selectImage(drag.element);
    }
    rich.addEventListener('pointerup',event=>finishImageDrag(event),{signal:controller.signal});
    rich.addEventListener('pointercancel',event=>finishImageDrag(event,true),{signal:controller.signal});
    rich.addEventListener('keydown',event=>{
      const element=event.target.closest?.('.rich-image');
      if(!element||lockedState||suspended||mode!=='rich'||event.ctrlKey||event.metaKey)return;
      if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();selectImage(null);rich.focus();return;}
      if(!['Delete','Backspace','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
      event.preventDefault();event.stopImmediatePropagation();finishLogicalTransaction();
      const before=buffer();
      if(['Delete','Backspace'].includes(event.key)){
        const paragraph=element.parentElement;element.remove();
        if(!paragraph.childNodes.length)paragraph.appendChild(document.createElement('br'));
        imageChanged(before);rich.focus();return;
      }
      const bounds=imageBounds(element),node=imageNode(element),rect=element.getBoundingClientRect();
      const step=event.shiftKey?10:1;
      let value=fitImage({...node,
        x_pt:(node.placement==='floating'&&Number.isFinite(node.x_pt)?node.x_pt:(rect.left-bounds.rect.left)*bounds.scale)+(event.key==='ArrowRight'?step:event.key==='ArrowLeft'?-step:0),
        y_pt:(node.placement==='floating'&&Number.isFinite(node.y_pt)?node.y_pt:(rect.top-bounds.rect.top)*bounds.scale)+(event.key==='ArrowDown'?step:event.key==='ArrowUp'?-step:0)},bounds);
      if(event.altKey){
        const ratio=node.width_pt/node.height_pt;
        const width=Math.min(bounds.width-(node.x_pt||0),(bounds.height-(node.y_pt||0))*ratio,
          Math.max(4,node.width_pt+(['ArrowRight','ArrowDown'].includes(event.key)?step:-step)));
        value=fitImage({...node,width_pt:width,height_pt:width/ratio},bounds);
      }
      window.OpenDocRichRenderer.imageGeometry(element,value);imageChanged(before);selectImage(element);
    },{capture:true,signal:controller.signal});

    function insertMath(blocks){
      if(lockedState||suspended||!Array.isArray(blocks)||!blocks.length)return false;
      if(mode!=="rich")setMode("rich");
      const M=window.OpenDocModel;
      const active=selectedMath();
      const id=active?.id||M.id();
      const temporary=document.createElement("div");
      window.OpenDocRichRenderer.render({
        blocks:[{id:M.id(),type:"paragraph",style:{},
          children:[{id,type:"math",math_blocks:M.clone(blocks)}]}]
      },temporary);
      const object=temporary.querySelector('[data-node-type="math"]');
      if(!object)return false;
      history.checkpoint(buffer());
      if(active){
        const existing=Array.from(rich.querySelectorAll('[data-node-type="math"]'))
          .find(n=>n.dataset.nodeId===active.id);
        if(!existing)return false;
        existing.replaceWith(object);
      }else{
        commands.restore();
        const selection=getSelection();
        if(!selection?.rangeCount)return false;
        const range=selection.getRangeAt(0);
        if(!rich.contains(range.commonAncestorContainer))return false;
        range.deleteContents();range.insertNode(object);
        range.setStartAfter(object);range.collapse(true);
        selection.removeAllRanges();selection.addRange(range);
      }
      selectedMathId=id;
      changed("format");
      return true;
    }
    function insertPlainText(value){
      // Preserve the editor selection captured before the dialog.
      // Browser editing commands integrate with undo and the rich serializer.
      if(lockedState||suspended||typeof value!=="string"||!value||value.length>1024)return false;
      if(mode!=="rich")setMode("rich");
      history.checkpoint(buffer());
      nextKind="format";
      let applied=false;
      try{applied=commands.execute("insertText",value);}
      finally{nextKind="typing";}
      return Boolean(applied);
    }

    function toggleList(format){
      commands.restore();
      const selection=getSelection();
      if(!selection?.rangeCount||!rich.contains(selection.anchorNode))return;
      const range=selection.getRangeAt(0);
      if(!model)updateModel();
      const ids=new Set(Array.from(rich.querySelectorAll('[data-page-content] > [data-node-id], [data-rich] > [data-node-id], li[data-node-id]'))
        .filter(node=>range.collapsed?node.contains(range.startContainer):range.intersectsNode(node))
        .map(node=>node.dataset.fragmentOf||node.dataset.nodeId));
      const targets=model.blocks.filter(block=>block.type==='paragraph'&&ids.has(block.id));
      if(!targets.length)return;
      const bookmark=commands.bookmark(),remove=targets.every(block=>block.list_info?.format===format);
      const blocks=model.blocks.map(block=>{
        if(!targets.includes(block))return block;
        const list_info=remove?null:block.list_info?.format===format?block.list_info:{format,level:0};
        return {...block,list_info};
      });
      commitModel({...model,blocks},'format',null,bookmark);
      return true;
    }
    function activeTypingStyle(){
      if(!typingStyle?.caret)return null;
      const caret=commands.bookmark();
      const anchor=typingStyle.caret;
      return caret?.length===0&&caret.blockId===anchor.blockId&&
        (caret.blockId||caret.blockIndex===anchor.blockIndex)&&
        caret.blockOffset===anchor.blockOffset&&caret.start===anchor.start
        ?typingStyle.patch:null;
    }

    function textState(includeTyping=true){
      const selection=getSelection();let node=selection.anchorNode;
      if(selection.rangeCount&&!selection.isCollapsed)
        node=window.OpenDocFormatting?.firstSelectedText(rich,selection.getRangeAt(0))||node;
      if(node?.nodeType===1){node=node.childNodes[Math.min(selection.anchorOffset,node.childNodes.length-1)] || node;while(node.firstChild)node=node.firstChild;}
      let e=node && (node.nodeType===1?node:node.parentElement);const ancestors=[],map=model && window.OpenDocModel?window.OpenDocModel.index(model):new Map(),out={};
      while(e && rich.contains(e)){ancestors.unshift(e);e=e.parentElement;}
      for(const element of ancestors){Object.assign(out,map.get(element.dataset.nodeId)?.style || {});if(window.OpenDocRichSerializer)Object.assign(out,window.OpenDocRichSerializer.readStyle(element,out));}
      if(ancestors.length&&(out.bold==null||out.italic==null||out.font_size_pt==null)){
        const computed=getComputedStyle(ancestors[ancestors.length-1]);
        if(out.bold==null)out.bold=computed.fontWeight==='bold'||Number(computed.fontWeight)>=600;
        if(out.italic==null)out.italic=computed.fontStyle==='italic';
        if(out.font_size_pt==null&&computed.fontSize.endsWith('px'))out.font_size_pt=Math.round(parseFloat(computed.fontSize)*75)/100;
      }
      return includeTyping?{...out,...activeTypingStyle()}:out;
    }
    function resetInlineEffects(){
      const bookmark=commands.bookmark();
      renderRich();commands.restoreBookmark(bookmark);
    }
    function cancelsInlineEffects(patch,current){
      return (patch.underline==='none'&&current.underline&&current.underline!=='none')||
        (patch.strike===false&&current.strike)||
        (patch.vertical_align&&current.vertical_align&&current.vertical_align!=='baseline'&&
          patch.vertical_align!==current.vertical_align);
    }
    function style(scope,patch){
      if(lockedState || !window.OpenDocFormatting)return;
      if(patch.line_spacing!==undefined)patch.line_spacing_rule='auto';
      if(patch.font_size_pt!==undefined && (!Number.isFinite(patch.font_size_pt) || patch.font_size_pt<1 || patch.font_size_pt>512)){status('Tamanho válido: 1 a 512 pt.');return;}
      if(mode!=='rich')setMode('rich');history.checkpoint(buffer());commands.restore();const selection=getSelection(),range=selection.rangeCount?selection.getRangeAt(0):null;
      if(scope==='inline'&&range?.collapsed&&rich.contains(range.startContainer)){
        const caret=commands.bookmark();
        if(caret){
          typingStyle={caret,patch:{...activeTypingStyle(),...patch}};
          root.dispatchEvent(new CustomEvent('open-doc:content'));
        }
        return;
      }
      typingStyle=null;
      const reset=scope==='inline'&&(patch.underline==='none'||patch.strike===false||patch.vertical_align);
      const applied=scope==='inline'?window.OpenDocFormatting.apply(rich,range,patch):window.OpenDocFormatting.paragraph(rich,range,patch);
      if(applied){
        // Formatting mutates the selected text in place. Serialize the live
        // selection once; replacing fragments here can replace a physical
        // page fragment with the entire logical paragraph.
        changed('format');
        if(reset)resetInlineEffects();
        root.dispatchEvent(new CustomEvent('open-doc:content'));
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
      const confirmation=root.querySelector("[data-export-result]");
      confirmation.replaceChildren();
      const message=document.createElement("span");
      message.textContent="Salvo em: "+result.path+
        (result.lossy?" · Verifique a formatação no programa de destino.":"");
      const dismiss=document.createElement("button");dismiss.type="button";
      dismiss.textContent="";dismiss.setAttribute("aria-label","Fechar confirmação de exportação");
      dismiss.addEventListener("click",()=>confirmation.replaceChildren());
      confirmation.append(message,dismiss);
      status(result.lossy?"Exportação concluída com avisos.":"Exportação concluída: "+(result.name||extension.toUpperCase()));
      return result;
    }


    function restoreLogicalCaret(caret) {
      if(!caret)return;
      const blocks=Array.from(rich.querySelectorAll(
        '[data-page-content] > [data-node-id], [data-rich] > [data-node-id]'));
      const block=blocks.find(node=>node.dataset.nodeId===caret.blockId
        ||node.dataset.fragmentOf===caret.blockId);
      if(!block)return;
      const range=document.createRange(),offset=Math.max(0,caret.textOffset||0);
      let remaining=offset,placed=false;
      const walker=document.createTreeWalker(block,NodeFilter.SHOW_TEXT);
      let node;
      while((node=walker.nextNode())){
        if(node.parentElement.closest('[data-list-marker]'))continue;
        if(remaining<=node.textContent.length){
          const tab=node.parentElement.closest('[data-node-type="tab"]');
          if(tab){
            if(remaining===0)range.setStartBefore(tab);
            else range.setStartAfter(tab);
          }else range.setStart(node,remaining);
          placed=true;break;
        }
        remaining-=node.textContent.length;
      }
      if(!placed)range.setStart(block,offset===0?0:block.childNodes.length);
      range.collapse(true);
      rich.focus();
      const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
      commands.capture();
    }
    function commitModel(next, kind='format', caret=null, bookmark=null) {
      const previous=model,oldBlocks=previous?.blocks || [],newBlocks=next.blocks || [],blockIds=Array.from(new Set([...oldBlocks,...newBlocks].map(b=>b.id))).filter(id=>JSON.stringify(oldBlocks.find(b=>b.id===id))!==JSON.stringify(newBlocks.find(b=>b.id===id))),structural=JSON.stringify(oldBlocks.map(b=>b.id))!==JSON.stringify(newBlocks.map(b=>b.id));
      history.checkpoint(buffer());model=next;source.value=window.OpenDocModel.markdown(model);source.readOnly=true;
      renderRich();if(caret)restoreLogicalCaret(caret);else if(bookmark)commands.restoreBookmark(bookmark);
      history.record(buffer(),kind,{blockIds,structural});
      cache();scheduleRecovery();render();
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
    function tableOperation(action,rows=2,cols=2,options={}){
      if(action==='insert'){commands.restore();const range=getSelection()?.rangeCount?getSelection().getRangeAt(0):null;if(window.OpenDocTables.insert(rich,range,rows,cols,options))changed('format');return;}
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
      finishLogicalTransaction();
      cache();
      pagination?.destroy();
      clearInterval(timer);
      clearTimeout(recoveryTimer);
      clearTimeout(renderTimer);clearTimeout(cacheTimer);
      if (!isClean()) {
        enqueue(() => request("document/recovery", buffer())).catch(() => {});
      }
      destroyed = true;
      controller.abort();
    }

    // One command contract for both keyboard and beforeinput deletion.
    // The model is the authority; page sections are disposable layout only.
    function traceDeletion(stage,details=null){
      if(window.OpenDocDebug?.traceDelete)
        console.warn('OPEN_DOC_DELETE_TRACE',stage,
          details?JSON.stringify(details):'');
    }
    // Logical transactions update the model immediately; DOM presentation is
    // committed in the next task, *after* Chromium finishes dispatching the
    // native keyboard event. Replacing the selected DOM subtree synchronously
    // inside keydown causes QtWebEngine 5.15 to stall on repeated Backspace.
    let pendingLogicalCaret=null,logicalRenderTimer=null;
    function finishLogicalTransaction(){
      if(!pendingLogicalCaret)return;
      const caret=pendingLogicalCaret;
      pendingLogicalCaret=null;
      clearTimeout(logicalRenderTimer);logicalRenderTimer=null;
      traceDeletion('render-start');
      renderRich();
      if(caret.listEnter||caret.rangeDeletion){
        commands.restoreBookmark(logicalBookmark(caret));
        if(caret.typingPatch)typingStyle={patch:caret.typingPatch,caret:commands.bookmark()};
        if(caret.rangeDeletion)restoreDeletionStyle();
      }else {restoreLogicalCaret(caret);restoreDeletionStyle();}
      cache();scheduleRecovery();render();
      traceDeletion('render-complete');
    }
    function commitLogicalTransaction(op){
      if(!pendingLogicalCaret)history.checkpoint(buffer());
      model=op.model;
      source.value=window.OpenDocModel.markdown(model);
      markdownStale=false;source.readOnly=true;
      pendingLogicalCaret=op.caret;
      const snapshot=buffer();
      snapshot.selection=(op.caret.listEnter||op.caret.rangeDeletion)?logicalBookmark(op.caret):{start:0,length:0,blockIndex:op.caret.blockIndex,
        blockId:op.caret.blockId,blockOffset:op.caret.textOffset,editableBlockOffset:true};
      history.record(snapshot,'transaction',
        {blockIds:op.changedIds||[],structural:true});
      clearTimeout(logicalRenderTimer);
      logicalRenderTimer=setTimeout(finishLogicalTransaction,32);
      root.dataset.dirty='true';status('Alterações não salvas');
    }
    function logicalBookmark(caret){
      const offset=caret.textOffset??0;
      return {start:0,length:0,blockIndex:caret.blockIndex,blockId:caret.blockId,
        blockOffset:offset,logicalBlockOffset:offset,editableBlockOffset:true};
    }
    function enterList(event){
      if(mode!=='rich'||lockedState||suspended||!model||event.defaultPrevented||event.isComposing||!event.cancelable)return false;
      if(pendingLogicalCaret)finishLogicalTransaction();
      const selection=getSelection();
      if(!selection?.rangeCount)return false;
      const range=selection.getRangeAt(0);
      const paragraph=node=>(node.nodeType===1?node:node.parentElement)?.closest('[data-list-info]');
      const first=paragraph(range.startContainer),last=paragraph(range.endContainer);
      const idOf=node=>node?.dataset.fragmentOf||node?.dataset.nodeId;
      const id=idOf(first),index=model.blocks.findIndex(block=>block.id===id);
      const block=model.blocks[index];
      if(!block?.list_info||id!==idOf(last)||!rich.contains(first))return false;
      event.preventDefault();
      const style=textState();
      const keys=['font_family','font_size_pt','bold','italic','underline','strike','color','highlight','vertical_align','character_spacing_pt','small_caps','all_caps'];
      const typingPatch=Object.fromEntries(keys.filter(key=>style[key]!=null).map(key=>[key,style[key]]));
      const blocks=model.blocks.slice();
      let target=block.id,changedIds=[block.id];
      if(range.collapsed&&!block.children.some(run=>run.type!=='text'||run.text.trim())){
        blocks[index]={...block,list_info:null};
      }else{
        const holder=document.createElement('div'),left=first.cloneNode(false),right=first.cloneNode(false);
        right.dataset.nodeId=window.OpenDocModel.id();
        const pieces=Array.from(rich.querySelectorAll('[data-list-info]')).filter(node=>idOf(node)===id);
        for(const node of pieces.slice(0,pieces.indexOf(first)))for(const child of node.childNodes)left.appendChild(child.cloneNode(true));
        const head=document.createRange();head.selectNodeContents(first);head.setEnd(range.startContainer,range.startOffset);
        left.appendChild(head.cloneContents());
        const tail=document.createRange();tail.selectNodeContents(last);tail.setStart(range.endContainer,range.endOffset);
        right.appendChild(tail.cloneContents());
        for(const node of pieces.slice(pieces.indexOf(last)+1))for(const child of node.childNodes)right.appendChild(child.cloneNode(true));
        holder.append(left,right);
        holder.querySelectorAll('[data-list-marker]').forEach(marker=>marker.remove());
        const [before,after]=window.OpenDocRichSerializer.serialize(holder,model).blocks;
        const {raw_xml,section_end_id,style:paragraphStyle,...paragraphProperties}=block;
        blocks.splice(index,1,{...before,section_end_id:undefined},{
          ...paragraphProperties,...after,style:{...paragraphStyle,page_break_before:undefined},
          section_end_id
        });
        target=after.id;changedIds.push(target);
      }
      typingStyle=null;
      commitLogicalTransaction({model:{...model,blocks},changedIds,
        caret:{listEnter:true,blockId:target,blockIndex:index+Number(target!==block.id),typingPatch}});
      return true;
    }
    function changeListLevel(event){
      const bookmark=commands.bookmark();
      if(bookmark?.length!==0||bookmark.logicalBlockOffset!==0)return false;
      const index=model?.blocks.findIndex(block=>block.id===bookmark.blockId)??-1;
      const block=model?.blocks[index],info=block?.list_info;
      if(!info)return false;
      event.preventDefault();
      const level=(info.level??0)+(event.shiftKey?-1:1);
      if(level<0||level>8)return true;
      const catalog=model.numbering?.[info.num_id]?.levels;
      const definition=catalog?.[String(level)];
      if(catalog&&!definition)return true;
      const list_info={...info,...definition,level};
      const blocks=model.blocks.slice();
      blocks[index]={...block,list_info};
      commitLogicalTransaction({model:{...model,blocks},changedIds:[block.id],
        caret:{listEnter:true,blockId:block.id,blockIndex:index,typingPatch:activeTypingStyle()}});
      return true;
    }
    function applyLogicalDeletion(event,inputType){
      traceDeletion('received',{type:event.type,inputType,cancelled:event.defaultPrevented});
      if(mode!=='rich'||lockedState||!model||root.dataset.documentKind==='fixed'
        ||event.defaultPrevented || window.getSelection()?.isComposing)return false;
      const transactions=window.OpenDocLogicalTransactions;
      if(!transactions)return false;
      const selection=getSelection();
      if(inputType==='deleteContentBackward' || inputType==='deleteContentForward'){
        if(!selection?.isCollapsed && transactions.isEntireDocumentSelected(rich,selection)){
          event.preventDefault();
          const op=transactions.deleteAll(model);
          if(op)commitLogicalTransaction(op);
          return true;
        }
        if(!selection?.isCollapsed){
          const first=(selection?.anchorNode?.nodeType===3?
            selection.anchorNode.parentElement:selection?.anchorNode)?.closest?.('.document-page');
          const last=(selection?.focusNode?.nodeType===3?
            selection.focusNode.parentElement:selection?.focusNode)?.closest?.('.document-page');
          if(first && last && first!==last){
            event.preventDefault();
            const op=transactions.deleteAcrossPages(rich,selection.getRangeAt(0),model);
            if(op)commitLogicalTransaction(op);
            else status('Esta seleção atravessa uma estrutura que não pode ser excluída em conjunto.');
            return true;
          }
        }
      }
      if(inputType!=='deleteContentBackward'||!selection?.isCollapsed)return false;
      // A deferred render can leave the DOM caret in a removed paragraph.
      // Only a caret at offset zero can continue joining from the model.
      if(pendingLogicalCaret?.textOffset){
        finishLogicalTransaction();
      }
      const boundary=pendingLogicalCaret
        ?{currentId:pendingLogicalCaret.blockId,fromPage:null,toPage:null}
        :transactions.inspectBackspace(rich,selection,model);
      traceDeletion('inspected',boundary||{matched:false,blocks:model.blocks.length});
      if(!boundary)return false;
      event.preventDefault();
      traceDeletion('cancelled-native');
      const op=transactions.joinBackward(model,boundary.currentId);
      if(!op){
        // At the start of the first logical block no deletion is possible.
        // Prevent the browser from deleting the physical page wrapper.
        status('Não é possível unir estes blocos sem alterar a estrutura do documento.');
        return true;
      }
      beforeInputCrossPage=true;
      beforeInputBlockId=op.caret.blockId;
      traceDeletion('before-commit',{blocks:op.model.blocks.length});
      commitLogicalTransaction(op);
      traceDeletion('after-commit');
      beforeInputCrossPage=false;
      return true;
    }
    rich.addEventListener('keydown',event=>{
      if(pendingLogicalCaret&&(pendingLogicalCaret.listEnter||pendingLogicalCaret.rangeDeletion||event.key!=='Backspace'||event.ctrlKey||
        event.altKey||event.metaKey||event.isComposing))finishLogicalTransaction();
      if(event.key==='Enter'&&!event.shiftKey&&!event.ctrlKey&&!event.altKey&&!event.metaKey&&enterList(event))return;
      if(mode==='rich'&&!lockedState&&model&&root.dataset.documentKind!=='fixed'&&
        (event.ctrlKey||event.metaKey)&&!event.altKey&&!event.shiftKey&&
        event.key.toLowerCase()==='a'){
        event.preventDefault();
        const range=document.createRange();range.selectNodeContents(rich);
        const selection=getSelection();
        selection.removeAllRanges();selection.addRange(range);
        return;
      }
      if(event.key==='Tab'&&!event.ctrlKey&&!event.altKey&&!event.metaKey&&
        !event.isComposing&&!event.defaultPrevented&&mode==='rich'&&!lockedState&&!suspended&&
        root.dataset.documentKind!=='fixed'&&document.activeElement===rich){
        if(changeListLevel(event)||event.shiftKey)return;
        const selection=getSelection();
        const paragraph=node=>(node?.nodeType===1?node:node?.parentElement)
          ?.closest('p,h1,h2,h3,h4,h5,h6,blockquote,pre,li,[data-page-content] > div,[data-rich] > div');
        const start=paragraph(selection?.anchorNode);
        if(start&&rich.contains(start)&&start===paragraph(selection.focusNode)&&!start.closest('td,th')){
          event.preventDefault();
          history.checkpoint(buffer());
          const patch=activeTypingStyle();
          // Tab is spacing. Collapse the range before inserting so even a
          // browser selection next to a previous tab cannot replace text.
          const range=selection.getRangeAt(0).cloneRange();
          range.collapse(true);
          const container=range.startContainer;
          const previousTab=(container.nodeType===1?container:container.parentElement)
            ?.closest('[data-node-type="tab"],[data-list-marker]');
          if(previousTab)range.setStartAfter(previousTab);
          const placeholder=start.childNodes.length===1&&start.firstChild.nodeName==='BR'
            &&!start.firstChild.dataset.nodeType?start.firstChild:null;
          const tab=document.createElement('span');
          tab.dataset.nodeType='tab';
          tab.dataset.nodeId=window.OpenDocModel.id();
          tab.contentEditable='false';
          tab.style.whiteSpace='pre';
          tab.textContent='\t';
          range.insertNode(tab);
          placeholder?.remove();
          range.setStartAfter(tab);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
          if(patch)typingStyle={patch,caret:commands.bookmark()};
          changed('format',rich);
          return;
        }
      }
      if(event.key==='Backspace')traceDeletion('keydown-entry');
      if(event.key!=='Backspace'&&event.key!=='Delete')return;
      if(event.ctrlKey||event.altKey||event.metaKey||event.isComposing)return;
      const patch=deletionStyle||activeTypingStyle();
      if(applyLogicalDeletion(event,event.key==='Backspace'
        ?'deleteContentBackward':'deleteContentForward'))deletionStyle=patch;
    },{...listeners,capture:true});
    function restoreDeletionStyle(){
      if(!deletionStyle)return;
      const caret=commands.bookmark();
      typingStyle=caret?.length===0?{patch:deletionStyle,caret}:null;
      deletionStyle=null;
    }
    source.addEventListener("beforeinput", () => history.checkpoint(buffer()), listeners);
    rich.addEventListener("beforeinput", event => {
      beforeParagraphSplit=null;pendingTextInsertion=null;
      if(pendingLogicalCaret?.listEnter||pendingLogicalCaret?.rangeDeletion)finishLogicalTransaction();
      if(event.inputType==='insertParagraph'&&enterList(event))return;
      deletionStyle=event.inputType?.startsWith('delete')?activeTypingStyle():null;
      if(applyLogicalDeletion(event,event.inputType))return;
      if(event.inputType==='insertText'&&!event.isComposing&&event.cancelable&&event.data){
        const patch=activeTypingStyle(),selection=getSelection();
        const range=selection?.rangeCount?selection.getRangeAt(0):null;
        if(patch&&range?.collapsed&&rich.contains(range.startContainer)){
          event.preventDefault();
          history.checkpoint(buffer());
          const reset=(patch.underline==='none'||patch.strike===false||patch.vertical_align)&&
            cancelsInlineEffects(patch,textState(false));
          const node=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement;
          const run=node.closest('[data-style-patch]');
          const stylePatch=JSON.stringify(patch);
          if(run?.dataset.stylePatch===stylePatch&&range.startContainer.nodeType===3){
            const text=range.startContainer,offset=range.startOffset;
            text.insertData(offset,event.data);
            range.setStart(text,offset+event.data.length);
          }else{
            const span=document.createElement('span');
            span.dataset.stylePatch=stylePatch;
            window.OpenDocRichRenderer.textStyle(span,patch);
            span.textContent=event.data;
            const block=node.closest('p,h1,h2,h3,h4,h5,h6,li');
            const placeholder=block?.lastChild;
            range.insertNode(span);range.setStart(span.firstChild,span.firstChild.length);
            if(placeholder?.nodeName==='BR'&&!placeholder.dataset.nodeType&&
              !Array.from(block.childNodes).some(child=>child!==span&&child!==placeholder&&!child.hasAttribute?.('data-list-marker')&&child.textContent.trim()))placeholder.remove();
          }
          range.collapse(true);
          selection.removeAllRanges();selection.addRange(range);
          typingStyle={patch,caret:commands.bookmark()};
          changed('typing',rich,event);
          if(reset)resetInlineEffects();
          const caret=commands.bookmark();
          if(caret)typingStyle={patch,caret};
          return;
        }
      }
      typingStyle=null;
      commands.capture();history.checkpoint(buffer());
      const selection=getSelection();
      const anchorNode=selection?.anchorNode,focusNode=selection?.focusNode;
      const anchorPage=(anchorNode?.nodeType===3?anchorNode.parentElement:anchorNode)?.closest?.('[data-page-index]');
      const focusPage=(focusNode?.nodeType===3?focusNode.parentElement:focusNode)?.closest?.('[data-page-index]');
      beforeInputCrossPage=Boolean(anchorPage&&focusPage&&anchorPage!==focusPage)
        || (event.inputType?.startsWith('delete') &&
          selection && !selection.isCollapsed && (!anchorPage||!focusPage));
      let n=anchorNode;n=n?.nodeType===3?n.parentElement:n;
      while(n && n!==rich && n.tagName!=='LI' && !n.parentElement?.matches('[data-page-content],[data-rich]'))n=n.parentElement;
      beforeInputBlockId=n?.dataset.fragmentOf || n?.dataset.nodeId || null;
      pendingTextInsertion=planTextInsertion(event,selection,n);
      if(event.inputType==='insertParagraph' && selection?.isCollapsed &&
        n?.parentElement?.matches('[data-page-content]')){
        beforeParagraphSplit={block:n,container:n.parentElement,count:n.parentElement.childElementCount};
      }
    }, listeners);
    source.addEventListener("input", () => changed("typing", source), listeners);
    rich.addEventListener("input",event=>{
      restoreDeletionStyle();
      changed(nextKind,rich,event);
    },listeners);
    rich.addEventListener('compositionend',()=>changed('typing',rich,{inputType:'insertCompositionText'}),listeners);
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
      if(root.dataset.documentKind==='fixed' || root.dataset.homeView==='true' ||
         root.querySelector('[data-dialog]:not([hidden])') || event.defaultPrevented ||
         !(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if(key === "enter" && mode === "rich" && rich.contains(getSelection()?.anchorNode)){event.preventDefault();insertPage("break");return;}
      if (key === "z" || key === "y") {
        const focused=document.activeElement;
        const editingInk=root.dataset.inkMode&&root.dataset.inkMode!=='cursor'&&
          !focused?.closest('input,textarea,select,[role="dialog"]');
        if ([source, rich].some(element => element === focused || element.contains(focused)) || editingInk) {
          event.preventDefault(); format(key === "y" || event.shiftKey ? "redo" : "undo");
        }
      }
      const focused=document.activeElement;
      const richSelection=rich.contains(getSelection()?.anchorNode)&&
        !focused?.closest('input,textarea,select,[role="dialog"]');
      if (["b", "i"].includes(key) && !event.altKey &&
          (richSelection||focused===source)) {
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
    function setInkLayers(layers){
      if(lockedState)return;
      history.checkpoint(buffer());
      if(!model)updateModel();
      // Ink commits replace layers and strokes instead of mutating snapshots.
      model={...model,ink_layers:layers.slice()};
      source.readOnly=true;
      const draft=buffer();
      history.record(draft,'ink',{inkSurfaces:layers.map(l=>l.surface_index),structural:false,inkOnly:true});
      cache();scheduleRecovery();updateHistoryControls();
      if(root.dataset.dirty!=='true'){
        root.dataset.dirty='true';
        window.pywebview?.api?.set_dirty?.(true)?.catch?.(()=>{});
      }
      status('Alterações não salvas');root.dispatchEvent(new CustomEvent('open-doc:ink-changed'));
    }
    function insertRecognized(text,style,index,strokeIds){const next=ensureModel(),layer=(next.ink_layers || []).find(l=>l.surface_index===index);if(!layer)return;const at=next.blocks.findIndex(b=>b.id===layer.anchor_block_id);next.blocks.splice(at<0?next.blocks.length:at+1,0,{id:window.OpenDocModel.id(),type:'paragraph',style:{},children:[{id:window.OpenDocModel.id(),type:'text',text,style:{...style,color:style.color.replace('#','')}}]});layer.strokes=layer.strokes.filter(s=>!strokeIds.includes(s.id));commitModel(next,'recognition');}
    const instance = {suspend:value=>{suspended=value;},inkLayers,setInkLayers,insertRecognized,load, flush, destroy, isClean, setLocked, setMode, format, insertPlainText, insertImage, insertMath, selectedMath, insertPage, pageSetup, replaceText, tableOperation, pageView: value=>pagination?.setMode(value), pagination:()=>pagination, copy: copyDocument, export: exportDocument, capture: commands.capture, restoreSelection: commands.restoreBookmark, style, textState, commandState: commands.state, refresh: render, snapshot: buffer};
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

