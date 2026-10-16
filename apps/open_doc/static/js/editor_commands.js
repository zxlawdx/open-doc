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
      const result = document.execCommand(command, false, argument);
      capture();
      changed("format");
      return result;
    }
    function bookmark() {
      if (!savedRange || !rich.contains(savedRange.startContainer)) return null;
      const before = document.createRange(); before.selectNodeContents(rich);
      before.setEnd(savedRange.startContainer, savedRange.startOffset);
      return {start: before.cloneContents().textContent.length, length: savedRange.cloneContents().textContent.length};
    }
    function restoreBookmark(value) {
      rich.focus();
      if (!value) return;
      const walker = document.createTreeWalker(rich, NodeFilter.SHOW_TEXT);
      let node, position = 0, startNode, startOffset = 0;
      while ((node = walker.nextNode())) {
        const end = position + node.textContent.length;
        if (!startNode && value.start < end) { startNode = node; startOffset = Math.max(0, value.start - position); }
        if (startNode && value.start + value.length <= end) {
          const range = document.createRange(); range.setStart(startNode, startOffset);
          range.setEnd(node, Math.max(0, value.start + value.length - position));
          savedRange = range; restore(); return;
        }
        position = end;
      }
      if(value.length===0){const range=document.createRange();range.selectNodeContents(rich);range.collapse(false);savedRange=range;restore();}
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
