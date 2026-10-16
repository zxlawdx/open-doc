/* ============ BOUNDED DOCUMENT HISTORY ============ */
"use strict";
(() => {
  const MAX_ENTRIES = 50;
  const MAX_BYTES = 8 * 1024 * 1024;
  const GROUP_MS = 500;
  function create() {
    let entries = [], index = -1, lastTime = 0, lastKind = "";
    // Rich snapshots are immutable, as required by the model fingerprint cache.
    // Budget each content object once instead of encoding every old snapshot per key.
    const sizes=new WeakMap();
    function bytesOf(item){if(!item.content)return (item.markdown || '').length*2;if(!sizes.has(item.content))sizes.set(item.content,JSON.stringify(item.content).length*2);return sizes.get(item.content);}
    const equal = (a, b) => a?.title === b?.title && (a?.content?window.OpenDocModel.fingerprint(a.content):a?.markdown) === (b?.content?window.OpenDocModel.fingerprint(b.content):b?.markdown);
    function reset(snapshot) { entries = [{...snapshot}]; index = 0; lastKind = ""; }
    function record(snapshot, kind = "typing", affected={}) {
      if (equal(entries[index], snapshot)) return;
      const now = Date.now();
      entries.splice(index + 1);
      if (kind === "typing" && lastKind === kind && index > 0 && now - lastTime < GROUP_MS) {
        const previous=entries[index].affected || {};
        entries[index] = {...snapshot,kind,affected:{blockIds:[...new Set([...(previous.blockIds || []),...(affected.blockIds || [])])],inkSurfaces:[...new Set([...(previous.inkSurfaces || []),...(affected.inkSurfaces || [])])],structural:Boolean(previous.structural || affected.structural)}};
      } else { entries.push({...snapshot,kind,affected}); index++; }
      let bytes = entries.reduce((sum, item) => sum + bytesOf(item), 0);
      while (entries.length > 2 && (entries.length > MAX_ENTRIES || bytes > MAX_BYTES)) {
        bytes -= bytesOf(entries[0]); entries.shift(); index--;
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
  window.OpenDocHistory = {create};
})();
