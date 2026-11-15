/* Logical, model-first editing across visual page boundaries.
 * Physical <section> pages are never the targets of delete operations.
 * All commands produce one immutable model change and one logical caret.
 */
"use strict";
(() => {
  const textLength=children=>(children||[]).reduce((n,run)=>
    n+(run.type==="text"?String(run.text||"").length:
      run.type==="hyperlink"?textLength(run.children):(run.type==="break"||run.type==="tab")?1:0),0);
  function joinBackward(model,blockId) {
    if(!model?.blocks?.length || !blockId)return null;
    const index=model.blocks.findIndex(x=>x.id===blockId);
    if(index<=0)return null;
    const current=model.blocks[index],previous=model.blocks[index-1];
    if(current.type!=="paragraph"||previous.type!=="paragraph")return null;
    const emptyAfterList=!current.list_info&&!current.children?.length&&previous.list_info;
    // An empty paragraph created by leaving a list can be removed while
    // keeping the preceding item's numbering and paragraph properties.
    if(current.section_end_id||previous.section_end_id||
      (!emptyAfterList&&JSON.stringify(current.list_info||null)!==JSON.stringify(previous.list_info||null)))return null;
    if(emptyAfterList&&model.ink_layers?.some(layer=>layer.anchor_block_id===current.id))return null;
    const offset=textLength(previous.children);
    const blocks=model.blocks.slice();
    const children=[...(previous.children||[]),...(current.children||[])];
    blocks.splice(index-1,2,{...previous,children});
    return {model:{...model,blocks},kind:"join-backward",
      changedIds:[previous.id,current.id],removedId:current.id,
      caret:{blockId:previous.id,blockIndex:index-1,textOffset:offset}};
  }
  function inlineText(runs) {
    return runs.map(run=>{
      if(run.type==="text")return run.text;
      if(run.type==="tab")return "\t";
      if(run.type==="hyperlink")return inlineText(run.children);
      return null;
    }).reduce((text,part)=>text===null||part===null?null:text+part,"");
  }
  function visibleText(node){
    node.querySelectorAll("[data-list-marker]").forEach(marker=>marker.remove());
    return node.textContent;
  }
  function rangeEndpoint(pieces,model,node,offset){
    const element=node.nodeType===1?node:node.parentElement;
    const piece=element?.closest('[data-page-content] > [data-node-type="paragraph"]');
    if(!piece||piece.contains(element.closest('[contenteditable="false"]'))||!pieces.includes(piece))return null;
    const id=piece.dataset.fragmentOf||piece.dataset.nodeId;
    const index=model.blocks.findIndex(block=>block.id===id);
    const block=model.blocks[index];
    if(block?.type!=="paragraph")return null;
    const expected=inlineText(block.children||[]);
    if(expected===null)return null;
    const fragments=pieces.filter(part=>(part.dataset.fragmentOf||part.dataset.nodeId)===id);
    const texts=fragments.map(part=>visibleText(part.cloneNode(true)));
    if(texts.join("")!==expected)return null;
    const head=document.createRange();
    head.selectNodeContents(piece);
    head.setEnd(node,offset);
    const preceding=texts.slice(0,fragments.indexOf(piece)).join("");
    return {index,offset:preceding.length+visibleText(head.cloneContents()).length,length:expected.length};
  }
  function sliceRuns(runs,start,end,ids){
    const result=[];
    let offset=0;
    for(const run of runs){
      const length=textLength([run]),from=Math.max(0,start-offset),to=Math.min(length,end-offset);
      offset+=length;
      if(from>=to)continue;
      let kept=run;
      if(run.type==="hyperlink")kept={...run,children:sliceRuns(run.children,from,to,ids)};
      else if(run.type==="text"&&(from!==0||to!==length))kept={...run,text:run.text.slice(from,to)};
      if(ids.has(run.id))kept={...kept,id:window.OpenDocModel.id()};
      ids.add(kept.id);
      result.push(kept);
    }
    return result;
  }
  function deleteAcrossPages(rich,range,model){
    const pieces=Array.from(rich.querySelectorAll('[data-page-content] > [data-node-type="paragraph"]'));
    const from=rangeEndpoint(pieces,model,range.startContainer,range.startOffset);
    const to=rangeEndpoint(pieces,model,range.endContainer,range.endOffset);
    if(!from||!to||from.index>to.index||(from.index===to.index&&from.offset>=to.offset))return null;
    const selected=model.blocks.slice(from.index,to.index+1);
    if(selected.some(block=>block.section_end_id||!["paragraph","page_break"].includes(block.type)))return null;
    const changedIds=selected.map(block=>block.id);
    if(model.ink_layers?.some(layer=>changedIds.includes(layer.anchor_block_id)))return null;
    const first=selected[0],last=selected[selected.length-1],ids=new Set();
    const children=[...sliceRuns(first.children,0,from.offset,ids),
      ...sliceRuns(last.children,to.offset,to.length,ids)];
    const blocks=model.blocks.slice();
    blocks.splice(from.index,selected.length,{...first,children});
    return {model:{...model,blocks},changedIds,
      caret:{blockId:first.id,blockIndex:from.index,textOffset:from.offset,rangeDeletion:true}};
  }
  function deleteAll(model){
    if(!model?.blocks?.length)return null;
    const first=model.blocks[0];
    // One paragraph is the simplest valid logical document. Keep identity
    // stable if possible to preserve selection/history, never copy opaque data.
    const id=first.type==="paragraph"?first.id:window.OpenDocModel.id();
    const blocks=[{id,type:"paragraph",style:{},children:[]}];
    return {model:{...model,blocks},kind:"delete-all",
      changedIds:model.blocks.map(b=>b.id),caret:{blockId:id,blockIndex:0,textOffset:0}};
  }
  function currentBlock(rich,selection){
    const node=selection?.anchorNode,element=node?.nodeType===3?node.parentElement:node;
    const block=element?.closest?.("[data-node-id], [data-fragment-of]");
    if(!block||!rich.contains(block))return null;
    return {block,element,id:block.dataset.fragmentOf||block.dataset.nodeId};
  }
  function atBeginning(block,selection) {
    if(!selection?.isCollapsed||!selection.rangeCount)return false;
    const range=document.createRange(),caret=selection.getRangeAt(0);
    if(!block.contains(caret.startContainer)&&block!==caret.startContainer)return false;
    range.selectNodeContents(block);
    try{range.setEnd(caret.startContainer,caret.startOffset);}
    catch(_){return false;}
    // A caret just after an inline element must not be mistaken for zero.
    return range.toString().length===0 &&
      (caret.startOffset===0 || !block.textContent.length);
  }
  function inspectBackspace(rich,selection,model){
    if(!model||!selection?.isCollapsed)return null;
    const current=currentBlock(rich,selection);
    if(!current || !atBeginning(current.block,selection))return null;
    // The document model owns ordering and identities. A physical page
    // boundary is NOT necessarily the first DOM child of the page: a long
    // paragraph can be split into fragments or page balance can move a block.
    // Treat every paragraph-start Backspace consistently as a model join.
    // This avoids Chromium attempting to merge DOM page shells indirectly.
    const index=model.blocks.findIndex(block=>block.id===current.id);
    if(index<=0 || model.blocks[index].type!=="paragraph"
      || model.blocks[index-1].type!=="paragraph")return null;
    const page=current.block.closest(".document-page");
    const previousId=model.blocks[index-1].id;
    const previousElement=Array.from(rich.querySelectorAll("[data-node-id]"))
      .find(node=>node.dataset.nodeId===previousId ||
        node.dataset.fragmentOf===previousId);
    const previousPage=previousElement?.closest(".document-page");
    return {currentId:current.id,previousId,
      fromPage:page?.dataset.pageIndex??null,
      toPage:previousPage?.dataset.pageIndex??null,
      crossesPage:Boolean(page&&previousPage&&page!==previousPage)};
  }
  function isEntireDocumentSelected(rich,selection){
    if(!selection?.rangeCount||selection.isCollapsed)return false;
    const range=selection.getRangeAt(0);
    const first=rich.querySelector("[data-page-content] > *")||rich.firstElementChild;
    const last=rich.querySelector("[data-page-index]:last-child [data-page-content] > :last-child")
      ||rich.lastElementChild;
    if(!first||!last)return false;
    const all=document.createRange();all.selectNodeContents(rich);
    // Selecting all often anchors inside the first/last paragraph in Qt.
    return range.compareBoundaryPoints(Range.START_TO_START,all)===0 &&
      range.compareBoundaryPoints(Range.END_TO_END,all)===0;
  }
  window.OpenDocLogicalTransactions={
    joinBackward,deleteAll,deleteAcrossPages,inspectBackspace,isEntireDocumentSelected,textLength
  };
})();
