/* ============ QTWEBENGINE LIFECYCLE COMPATIBILITY ============ */
"use strict";
(() => {
  function install(prototype = EventTarget.prototype, createTarget = () => new EventTarget()) {
    if (prototype.__openDocAbortCompat) return false;
    const add = prototype.addEventListener, remove = prototype.removeEventListener;
    const probe = createTarget(), controller = new AbortController();
    let called = false;
    const listener = () => { called = true; };
    add.call(probe, 'open-doc-probe', listener, {signal: controller.signal});
    controller.abort(); probe.dispatchEvent(new Event('open-doc-probe'));
    remove.call(probe, 'open-doc-probe', listener);
    if (!called) return true;
    // Chromium 87 in Qt 5.15 ignores EventListenerOptions.signal.
    // Remove listeners explicitly when the view's controller aborts.
    prototype.addEventListener = function (type, callback, options) {
      const signal = options && typeof options === 'object' ? options.signal : null;
      if (!signal) return add.call(this, type, callback, options);
      if (signal.aborted || !callback) return;
      add.call(this, type, callback, options);
      const target = this;
      signal.addEventListener('abort', () => remove.call(target, type, callback, options), {once: true});
    };
    Object.defineProperty(prototype, '__openDocAbortCompat', {value: true});
    return false;
  }
  // Some Qt deployments lack replaceChildren(); detect the actual DOM API.
  // Use a fragment so nodes, text and empty calls follow the DOM contract.
  function installDOM(prototype = Element.prototype) {
    if (typeof prototype.replaceChildren === 'function') return true;
    Object.defineProperty(prototype, 'replaceChildren', {
      configurable: true, writable: true,
      value(...items) {
        const fragment = this.ownerDocument.createDocumentFragment();
        for (const item of items) fragment.appendChild(
          item instanceof Node ? item : this.ownerDocument.createTextNode(String(item))
        );
        while (this.firstChild) this.removeChild(this.firstChild);
        this.appendChild(fragment);
      }
    });
    return false;
  }
  // Deliberately limited to the JSON model; not a generic structured-clone polyfill.
  function cloneJson(value) {
    if(value===undefined)return undefined;
    return JSON.parse(JSON.stringify(value));
  }
  const nativeDOMSupport = installDOM();
  const nativeSupport = install();
  window.OpenDocCompat = {install, installDOM, nativeSupport, nativeDOMSupport, cloneJson};
})();
