/* Logical, model-first editing across visual page boundaries.
 * Physical <section> pages are never the targets of delete operations.
 * All commands produce one immutable model change and one logical caret.
 */
"use strict";
(() => {
  const clone=value=>JSON.parse(JSON.stringify(value));
  const textLength=children=>(children||[]).reduce((n,run)=>
    n+(run.type==="text"?String(run.text||"").length:
      run.type==="hyperlink"?textLength(run.children):run.type==="break"?1:0),0);
  function joinBackward(model,blockId) {
    if(!model?.blocks?.length || !blockId)return null;
    const index=model.blocks.findIndex(x=>x.id===blockId);
    if(index<=0)return null;
    const current=model.blocks[index],previous=model.blocks[index-1];
    if(current.type!=="paragraph"||previous.type!=="paragraph")return null;
    // Crossing lists, table boundaries, section boundaries, or opaque OOXML
    // may silently corrupt a document. Refuse rather than invent a merge.
    if(current.section_end_id||previous.section_end_id
      ||JSON.stringify(current.list_info||null)!==JSON.stringify(previous.list_info||null)
      ||current.raw_xml||previous.raw_xml)return null;
    const next=clone(model);
    const prev=next.blocks[index-1],right=next.blocks[index];
    const offset=textLength(prev.children);
    prev.children=clone([...(prev.children||[]),...(right.children||[])]);
    delete prev.raw_xml;
    next.blocks.splice(index,1);
    return {model:next,kind:"join-backward",
      changedIds:[previous.id,current.id],removedId:current.id,
      caret:{blockId:previous.id,blockIndex:index-1,textOffset:offset}};
  }
  function deleteAll(model){
    if(!model?.blocks?.length)return null;
    const first=model.blocks[0],next=clone(model);
    // One paragraph is the simplest valid logical document. Keep identity
    // stable if possible to preserve selection/history, never copy opaque data.
    const id=first.type==="paragraph"?first.id:window.OpenDocModel.id();
    next.blocks=[{id,type:"paragraph",style:{},children:[]}];
    return {model:next,kind:"delete-all",
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
    const box=current.block.closest("[data-page-content]");
    const page=box?.closest(".document-page");
    if(!page || box.firstElementChild!==current.block)return null;
    const earlier=page.previousElementSibling;
    if(!earlier?.matches(".document-page"))return null;
    const prior=earlier.querySelector("[data-page-content] > :last-child");
    if(!prior)return null;
    // The page boundary is purely presentational. The operation is computed
    // against the logical model, not by moving/deleting DOM sections.
    return {currentId:current.id,previousId:prior.dataset.fragmentOf||prior.dataset.nodeId,
      fromPage:page.dataset.pageIndex, toPage:earlier.dataset.pageIndex};
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
    joinBackward,deleteAll,inspectBackspace,isEntireDocumentSelected,textLength
  };
})();
