/* ============ BOUNDED DOCUMENT HISTORY ============ */
"use strict";
(() => {
  const MAX_ENTRIES = 50;
  const MAX_BYTES = 8 * 1024 * 1024;
  const GROUP_MS = 500;
  function create() {
    let entries = [], index = -1, lastTime = 0, lastKind = "";
    const equal = (a, b) => a?.title === b?.title && (a?.content?window.OpenDocModel.fingerprint(a.content):a?.markdown) === (b?.content?window.OpenDocModel.fingerprint(b.content):b?.markdown);
    function reset(snapshot) { entries = [{...snapshot}]; index = 0; lastKind = ""; }
    function record(snapshot, kind = "typing") {
      if (equal(entries[index], snapshot)) return;
      const now = Date.now();
      entries.splice(index + 1);
      if (kind === "typing" && lastKind === kind && index > 0 && now - lastTime < GROUP_MS) {
        entries[index] = {...snapshot};
      } else { entries.push({...snapshot}); index++; }
      let bytes = entries.reduce((sum, item) => sum + JSON.stringify(item.content || item.markdown).length * 2, 0);
      while (entries.length > 2 && (entries.length > MAX_ENTRIES || bytes > MAX_BYTES)) {
        bytes -= JSON.stringify(entries[0].content || entries[0].markdown).length * 2; entries.shift(); index--;
      }
      lastKind = kind; lastTime = now;
    }
    function move(delta) {
      const next = index + delta;
      if (next < 0 || next >= entries.length) return null;
      index = next; lastKind = "";
      return {...entries[index]};
    }
    function checkpoint(snapshot) { if (entries[index]) entries[index].selection = snapshot.selection; }
    return {reset, record, checkpoint, undo: () => move(-1), redo: () => move(1), canUndo: () => index > 0, canRedo: () => index < entries.length - 1};
  }
  window.OpenDocHistory = {create};
})();
