/* Apply formatting only to selected text nodes; normalize the affected blocks. */
"use strict";
(() => {
  function apply(surface,range,patch){if(!range || range.collapsed || !surface.contains(range.commonAncestorContainer))return false;
    const walker=document.createTreeWalker(surface,NodeFilter.SHOW_TEXT),selected=[];let n;
    while((n=walker.nextNode())){const locked=n.parentElement.closest('[contenteditable=false]');if(locked && locked!==surface && surface.contains(locked))continue;if(range.intersectsNode(n)){const start=n===range.startContainer?range.startOffset:0,end=n===range.endContainer?range.endOffset:n.length;if(end>start)selected.push({n,start,end});}}
    const spans=[];for(const item of selected){let text=item.n;if(item.end<text.length)text.splitText(item.end);if(item.start>0)text=text.splitText(item.start);const span=document.createElement('span');span.dataset.stylePatch=JSON.stringify(patch);text.parentNode.insertBefore(span,text);span.appendChild(text);window.OpenDocRichRenderer.textStyle(span,patch);spans.push(span);}
    if(spans.length){const r=document.createRange();r.setStartBefore(spans[0]);r.setEndAfter(spans[spans.length-1]);getSelection().removeAllRanges();getSelection().addRange(r);}return Boolean(spans.length);
  }
  function paragraph(surface,range,patch){const blocks=Array.from(surface.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,blockquote,pre')).filter(p=>range && range.intersectsNode(p));blocks.forEach(p=>window.OpenDocRichRenderer.paragraphStyle(p,patch));return Boolean(blocks.length);}
  window.OpenDocFormatting={apply,paragraph};
})();
