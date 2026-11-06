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
    // Keep section boundaries and list identities intact. Paragraph raw XML
    // supplies the survivor's properties at export; the inline model holds
    // the content, including opaque children from either paragraph.
    if(current.section_end_id||previous.section_end_id
      ||JSON.stringify(current.list_info||null)!==JSON.stringify(previous.list_info||null))return null;
    const next=clone(model);
    const prev=next.blocks[index-1],right=next.blocks[index];
    const offset=textLength(prev.children);
    prev.children=clone([...(prev.children||[]),...(right.children||[])]);
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
    joinBackward,deleteAll,inspectBackspace,isEntireDocumentSelected,textLength
  };
})();
