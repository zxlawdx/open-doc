/* ============ BOUNDED DOCUMENT HISTORY ============ */
"use strict";
(() => {
  const MAX_ENTRIES = 50;
  const MAX_BYTES = 8 * 1024 * 1024;
  const GROUP_MS = 500;
  function sameSnapshot(left,right){
    if(left?.title!==right?.title)return false;
    return left?.content||right?.content
      ?window.OpenDocModel.sameContent(left?.content,right?.content)
      :left?.markdown===right?.markdown;
  }
  function create() {
    let entries = [], index = -1, lastTime = 0, lastKind = "";
    const bytesOf=item=>2*(item.content?window.OpenDocModel.snapshotSize(item.content):(item.markdown || '').length);
    // Pen snapshots share immutable text and previously drawn strokes. Charge
    // the history budget for retained changes and array references, not a
    // full copy of the illustrated document for every stroke.
    function inkCost(previous, current){
      const before=new Map((previous?.ink_layers||[]).map(layer=>[layer.surface_index,layer]));
      const after=new Map((current.ink_layers||[]).map(layer=>[layer.surface_index,layer]));
      let bytes=0;
      for(const index of new Set([...before.keys(),...after.keys()])){
        const oldLayer=before.get(index),newLayer=after.get(index);
        if(oldLayer===newLayer)continue;
        const oldStrokes=oldLayer?.strokes||[],newStrokes=newLayer?.strokes||[];
        bytes+=128+8*(oldStrokes.length+newStrokes.length);
        if(newStrokes.length===oldStrokes.length+1&&oldStrokes.every((stroke,i)=>newStrokes[i]===stroke)){
          bytes+=2*window.OpenDocModel.jsonLength(newStrokes[newStrokes.length-1]);
          continue;
        }
        const oldSet=new Set(oldStrokes),newSet=new Set(newStrokes);
        for(const stroke of oldStrokes)if(!newSet.has(stroke))bytes+=2*window.OpenDocModel.jsonLength(stroke);
        for(const stroke of newStrokes)if(!oldSet.has(stroke))bytes+=2*window.OpenDocModel.jsonLength(stroke);
      }
      return bytes;
    }
    function sizeOf(item,at){
      if(at===0&&(item.affected?.inkOnly||entries[1]?.affected?.inkOnly))return 0;
      return item.affected?.inkOnly?item.inkBytes:bytesOf(item);
    }
    function reset(snapshot) { entries = [{...snapshot}]; index = 0; lastKind = ""; }
    function record(snapshot, kind = "typing", affected={}) {
      const previous=entries[index];
      const inkOnly=affected.inkOnly&&previous?.content&&snapshot.content;
      if (inkOnly ? previous.content===snapshot.content : sameSnapshot(previous,snapshot)) return;
      const now = Date.now();
      entries.splice(index + 1);
      if (kind === "typing" && lastKind === kind && index > 0 && now - lastTime < GROUP_MS) {
        const previous=entries[index].affected || {};
        entries[index] = {...snapshot,kind,affected:{blockIds:[...new Set([...(previous.blockIds || []),...(affected.blockIds || [])])],inkSurfaces:[...new Set([...(previous.inkSurfaces || []),...(affected.inkSurfaces || [])])],structural:Boolean(previous.structural || affected.structural)}};
      } else { entries.push({...snapshot,kind,affected,inkBytes:inkOnly?inkCost(previous.content,snapshot.content):0}); index++; }
      let bytes = entries.reduce((sum, item, at) => sum + sizeOf(item,at), 0);
      while (entries.length > 2 && (entries.length > MAX_ENTRIES || bytes > MAX_BYTES)) {
        bytes -= sizeOf(entries[0],0)+sizeOf(entries[1],1);
        entries.shift(); index--;
        bytes += sizeOf(entries[0],0);
      }
      lastKind = kind; lastTime = now;
    }
    function move(delta) {
      const next = index + delta;
      if (next < 0 || next >= entries.length) return null;
      const change=entries[delta<0?index:next];index = next; lastKind = "";
      return {...entries[index],historyChange:{kind:change.kind,affected:change.affected}};
    }
    function checkpoint(snapshot) { if (entries[index]) entries[index].selection = snapshot.selection; }
    return {reset, record, checkpoint, undo: () => move(-1), redo: () => move(1), canUndo: () => index > 0, canRedo: () => index < entries.length - 1};
  }
  window.OpenDocHistory = {create,sameSnapshot};
})();
