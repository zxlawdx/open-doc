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
      return element?.closest?.('[data-node-id],p,li,h1,h2,h3,blockquote,pre')||null;
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
              range.setStart(textNode,remaining);placed=true;break;
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
    return {capture, restore, execute, state, bookmark, restoreBookmark};
  }
  window.OpenDocCommands = {create};
})();
