/* ============ RECOVERY STORAGE NAMESPACE MIGRATION ============ */
"use strict";
(() => {
  const key = id => "open-doc-recovery:" + id;
  const legacy = id => "vela-writer-recovery:" + id;
  function read(id) {
    try {
      const current = localStorage.getItem(key(id));
      if (current) return JSON.parse(current);
      const old = localStorage.getItem(legacy(id));
      if (!old) return null;
      const value = JSON.parse(old);
      localStorage.setItem(key(id), old);
      localStorage.removeItem(legacy(id));
      return value;
    } catch { return null; }
  }
  function write(snapshot) {
    try { localStorage.setItem(key(snapshot.id), JSON.stringify(snapshot)); }
    catch { /* Persistent SQLite recovery is independent of WebView storage. */ }
  }
  function clear(id) {
    try { localStorage.removeItem(key(id)); localStorage.removeItem(legacy(id)); }
    catch { /* Failure must not interrupt document persistence. */ }
  }
  window.OpenDocRecovery = {read, write, clear};
})();
