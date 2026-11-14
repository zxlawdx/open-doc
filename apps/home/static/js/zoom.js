/* One set of controls and shortcuts for the active view. */
"use strict";
(() => {
  function shortcut(event) {
    if (!event.ctrlKey || event.altKey || event.metaKey || event.isComposing ||
        event.getModifierState?.('AltGraph')) return null;
    if (event.key === '+' || event.key === '=' || event.code === 'NumpadAdd') return 10;
    if (event.key === '-' || event.code === 'NumpadSubtract') return -10;
    if (event.key === '0') return 0;
    return null;
  }

  function create({root, settings, persist, status, paper, editor, workbook, signal}) {
    const slider = root.querySelector('[data-zoom]');
    const label = root.querySelector('[data-zoom-label]');
    const output = root.querySelector('[data-zoom-value]');
    let interfaceZoom = settings.interface_zoom ?? 100;
    let wheelDelta = 0, lastWheel = 0, lastContext;
    const ui = {
      value: () => interfaceZoom,
      set(value) {
        interfaceZoom = value;
        persist({interface_zoom: value}).catch(error => status(error.message));
      }
    };
    const fixed = {value: editor.zoomValue, set: editor.setZoom};
    function context() {
      if (root.dataset.workbookView === 'true' &&
          !root.querySelector('[data-workbook] .code-notebook-full')) {
        return {adapter: workbook(), name: 'da planilha', min: 50, max: 200};
      }
      if (root.dataset.homeView === 'true') {
        return {adapter: ui, name: 'da interface', min: 50, max: 200};
      }
      if (root.dataset.documentKind === 'fixed') {
        return {adapter: fixed, name: 'do documento', min: 25, max: 300};
      }
      return {adapter: paper, name: 'do documento', min: 50, max: 150};
    }
    function sync() {
      const {adapter, name, min, max} = context();
      const value = adapter.value();
      slider.min = min;
      slider.max = max;
      slider.value = value;
      slider.setAttribute('aria-valuetext', value + '%');
      label.textContent = 'Zoom ' + name;
      output.textContent = value + '%';

      const scale = adapter === ui ? interfaceZoom / 100 : 1;
      root.style.setProperty('--interface-zoom', scale);
      root.style.setProperty('--interface-height', (100 / scale) + 'vh');
      root.style.setProperty('--interface-width', (100 / scale) + 'vw');
      root.dataset.compactInterface = String(adapter === ui && window.innerWidth / scale <= 760);
    }
    function set(value) {
      const {adapter, min, max} = context();
      const next = Math.max(min, Math.min(max, Number(value)));
      if (next !== adapter.value()) adapter.set(next);
      sync();
    }
    function step(delta) {
      set(delta === 0 ? 100 : context().adapter.value() + delta);
    }
    slider.addEventListener('input', () => set(slider.value), {signal});
    root.querySelectorAll('[data-zoom-step]').forEach(button =>
      button.addEventListener('click', () => step(Number(button.dataset.zoomStep)), {signal}));
    window.addEventListener('keydown', event => {
      const delta = shortcut(event);
      if (delta === null || event.defaultPrevented || !(event.target === document.body || event.target === document.documentElement || (event.target instanceof Node && root.contains(event.target)))) return;
      event.preventDefault();
      event.stopPropagation();
      step(delta);
    }, {capture: true, signal});
    root.addEventListener('wheel', event => {
      if (!event.ctrlKey || event.altKey || event.shiftKey || event.metaKey ||
          !event.deltaY || event.defaultPrevented) return;
      event.preventDefault();
      const adapter = context().adapter;
      if (adapter !== lastContext || event.timeStamp - lastWheel > 180) wheelDelta = 0;
      lastContext = adapter;
      lastWheel = event.timeStamp;
      wheelDelta += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 80 : 1);
      if (Math.abs(wheelDelta) < 40) return;
      step(wheelDelta < 0 ? 10 : -10);
      wheelDelta = 0;
    }, {passive: false, signal});
    root.addEventListener('open-doc:layout', sync, {signal});
    window.addEventListener('resize', sync, {signal});
    sync();
    return {sync, reset: () => step(0)};
  }
  window.OpenDocZoom = {create};
})();
