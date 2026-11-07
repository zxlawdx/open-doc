/* ============ NATIVE EDITING ADAPTER ============ */
"use strict";
(() => {
  function create(rich, changed, signal) {
    let savedRange = null;
    function capture() {
      const selection = window.getSelection();
      if (selection?.rangeCount && rich.contains(selection.anchorNode) && rich.contains(selection.focusNode)) {
        savedRange = selection.getRangeAt(0).cloneRange();
      }
    }
    function restore() {
      rich.focus();
      if (!savedRange || !rich.contains(savedRange.startContainer)) return;
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(savedRange.cloneRange());
    }
    function execute(command, argument = null) {
      restore();
      // All legacy browser commands are contained in this adapter.
      if (typeof document.execCommand !== "function") return false;
      let emitted=false;const observed=()=>{emitted=true;};
      rich.addEventListener('input',observed);
      let result;
      try{result=document.execCommand(command,false,argument);}
      finally{rich.removeEventListener('input',observed);}
      capture();
      if(!emitted)changed("format");
      return result;
    }
    // Pagination moves live blocks between physical pages. Text offsets alone
    // cannot identify a caret inside blank paragraphs: 100 empty Enter blocks
    // all have the same text offset. Never restore such a caret at the root
    // of the contenteditable, where native Backspace may remove a page shell.
    const blocks=()=>Array.from(rich.querySelectorAll(
      '[data-page-content] > [data-node-id],[data-rich] > [data-node-id],[data-page-content] > p,[data-page-content] > div,[data-page-content] > li'
    ));
    function caretBlock(node){
      const element=node?.nodeType===3?node.parentElement:node;
      return element?.closest?.('[data-node-type="paragraph"],p,li,h1,h2,h3,h4,h5,h6,blockquote,pre')||null;
    }
    function bookmark() {
      const selection=window.getSelection();
      if(!selection?.rangeCount || !rich.contains(selection.anchorNode))return null;
      const range=selection.getRangeAt(0);
      const before=document.createRange();before.selectNodeContents(rich);
      before.setEnd(range.startContainer,range.startOffset);
      const result={start:before.toString().length,length:range.toString().length};
      if(range.collapsed){
        const all=blocks(),block=caretBlock(range.startContainer);
        const index=all.indexOf(block);
        if(index>=0){
          const within=document.createRange();
          within.selectNodeContents(block);
          try{within.setEnd(range.startContainer,range.startOffset);}
          catch(_){within.collapse(false);}
          result.blockIndex=index;
          result.blockId=block.dataset.nodeId||null;
          result.blockOffset=within.toString().length;
          result.childOffset=range.startContainer===block?range.startOffset:null;
        }
      }
      return result;
    }
    function restoreBookmark(value) {
      rich.focus();
      if(!value)return;
      if(value.length===0 && Number.isInteger(value.blockIndex)){
        const all=blocks();
        const found=all[value.blockIndex];
        const block=found || (value.blockId
          ?all.find(el=>el.dataset.nodeId===value.blockId):null);
        if(block){
          const range=document.createRange();
          const wanted=Math.max(0,value.blockOffset||0);
          const walker=document.createTreeWalker(block,NodeFilter.SHOW_TEXT);
          let textNode,remaining=wanted,placed=false;
          while((textNode=walker.nextNode())){
            const length=textNode.textContent.length;
            if(remaining<=length){
              const tab=textNode.parentElement.closest('[data-node-type="tab"]');
              if(tab){
                if(remaining===0)range.setStartBefore(tab);
                else range.setStartAfter(tab);
              }else range.setStart(textNode,remaining);
              placed=true;break;
            }
            remaining-=length;
          }
          if(!placed){
            range.selectNodeContents(block);
            // Empty blocks require an element caret, not root selection.
            if(Number.isInteger(value.childOffset))
              range.setStart(block,Math.min(value.childOffset,block.childNodes.length));
            else range.collapse(false);
          }
          range.collapse(true);
          savedRange=range;restore();return;
        }
      }
      // Backwards compatibility: bookmarks created before this change lack
      // block coordinates. Preserve the existing text-based selection logic.
      const walker=document.createTreeWalker(rich,NodeFilter.SHOW_TEXT);
      let node,position=0,startNode,startOffset=0;
      while((node=walker.nextNode())){
        const end=position+node.textContent.length;
        if(!startNode && value.start<end){
          startNode=node;startOffset=Math.max(0,value.start-position);
        }
        if(startNode && value.start+value.length<=end){
          const range=document.createRange();range.setStart(startNode,startOffset);
          range.setEnd(node,Math.max(0,value.start+value.length-position));
          savedRange=range;restore();return;
        }
        position=end;
      }
      if(value.length===0){
        const all=blocks(),target=all[all.length-1];
        const range=document.createRange();
        range.selectNodeContents(target||rich);
        range.collapse(false);
        savedRange=range;restore();
      }
    }
    // Pure structured-model transaction plan. Physical .document-page nodes
    // are views: deleting across blocks must never mutate their wrappers.
    // This operation is used for BOTH keyboard and beforeinput deletion, so
    // undo, selection and pagination have a single source of truth.
    function planLogicalBackward(model){
      const selection=window.getSelection();
      if(!model?.blocks || !selection?.rangeCount ||
         !rich.contains(selection.anchorNode))return null;
      const range=selection.getRangeAt(0);
      const blocks=model.blocks;
      const element=n=>n?.nodeType===3?n.parentElement:n;
      if(!selection.isCollapsed){
        const visible=Array.from(rich.querySelectorAll('[data-page-content] > [data-node-id], [data-rich] > [data-node-id]'));
        if(!visible.length)return null;
        let first=visible[0],last=visible[visible.length-1];
        // Only whole-document range deletion is handled here. Partial complex
        // selections retain the browser's current editing behavior.
        try{
          if(!range.intersectsNode(first)||!range.intersectsNode(last))return null;
        }catch(_){return null;}
        const preserved=blocks[0]&&blocks[0].type==='paragraph'?blocks[0]:
          {id:window.OpenDocModel.id(),type:'paragraph',style:{},children:[]};
        return {
          model:{...model,blocks:[{...preserved,children:[]}]},
          caret:{blockId:preserved.id,blockIndex:0,blockOffset:0,
            childOffset:0,start:0,length:0},
          affected:blocks.map(b=>b.id),kind:'replace-all'
        };
      }
      const anchor=selection.anchorNode,host=element(anchor);
      const node=host?.closest?.('[data-node-id][data-node-type="paragraph"],p[data-node-id],p[data-fragment-of],blockquote[data-node-id],pre[data-node-id]');
      if(!node)return null;
      const id=node.dataset.fragmentOf||node.dataset.nodeId;
      const index=blocks.findIndex(b=>b.id===id);
      if(index<0 || blocks[index].type!=='paragraph')return null;
      // At the start of a paragraph, only a transactional merge is permitted.
      // A text offset of zero across blank paragraphs is not a global
      // document cursor: the stable block ID above disambiguates it.
      const before=document.createRange();
      before.selectNodeContents(node);
      try{before.setEnd(anchor,selection.anchorOffset);}
      catch(_){return null;}
      if(before.toString().length>0)return null;
      // A caret inside a nested inline node may be at the start of a span
      // even when preceding inline images/tabs exist: don't delete them.
      if(node.querySelector('img,table,[contenteditable="false"]'))return null;
      if(index===0)return {noop:true};
      const previous=blocks[index-1],current=blocks[index];
      if(previous.type!=='paragraph')return null;
      const prefix=(previous.children||[]).reduce((n,v)=>
        n+(v.type==='text'?v.text.length:v.type==='break'?1:0),0);
      const next=window.OpenDocModel.clone(model);
      next.blocks[index-1].children=[
        ...(next.blocks[index-1].children||[]),
        ...(next.blocks[index].children||[])
      ];
      next.blocks.splice(index,1);
      return {
        model:next,
        caret:{blockId:previous.id,blockIndex:index-1,blockOffset:prefix,
          childOffset:null,start:prefix,length:0},
        affected:[previous.id,current.id],kind:'merge-paragraph'
      };
    }
    function state() {
      const selection = window.getSelection();
      if (!selection?.rangeCount || !rich.contains(selection.anchorNode)) return {};
      const element = selection.anchorNode.nodeType === 1 ? selection.anchorNode : selection.anchorNode.parentElement;
      const block = element.closest("h1,h2,h3,p,li,blockquote,pre");
      return {
        bold: Boolean(element.closest("strong,b")),
        italic: Boolean(element.closest("em,i")),
        paragraph: ({h1: "h1", h2: "heading", h3: "h3"})[block?.tagName.toLowerCase()] || "paragraph"
      };
    }
    document.addEventListener("selectionchange", capture, {signal});
    return {capture, restore, execute, state, bookmark, restoreBookmark, planLogicalBackward};
  }
  window.OpenDocCommands = {create};
})();
