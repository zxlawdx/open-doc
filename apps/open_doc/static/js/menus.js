/* ============ CLASSIC MENUS / KEYBOARD LIFECYCLE ============ */
"use strict";
(() => {
  function create(root, capture, signal) {
    let current = null;
    const triggers = Array.from(root.querySelectorAll('[data-menu]'));
    const items = panel => Array.from(panel.querySelectorAll('[role^="menuitem"]')).filter(item => !item.disabled);
    function close(restore = false) {
      if (!current) return;
      const trigger = current;
      root.querySelector('[data-menu-panel="' + trigger.dataset.menu + '"]').hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      current = null;
      if (restore) trigger.focus();
    }
    function open(trigger, focus = false) {
      capture(); close(); current = trigger;
      trigger.setAttribute('aria-expanded', 'true');
      const panel = root.querySelector('[data-menu-panel="' + trigger.dataset.menu + '"]');
      panel.hidden = false;
      window.OpenDocPopovers?.position(panel, trigger);
      if (focus) items(panel)[0]?.focus();
    }
    root.addEventListener('click', event => {
      const trigger = event.target.closest('[data-menu]');
      if (trigger) { current === trigger ? close() : open(trigger); return; }
      if (event.target.closest('[data-menu-panel] button')) close();
    }, {signal});
    document.addEventListener('pointerdown', event => {
      if (!event.target.closest('.menu-group')) close();
    }, {signal});
    root.addEventListener('keydown', event => {
      const trigger = event.target.closest('[data-menu]');
      if (trigger && ['ArrowDown', 'Enter', ' '].includes(event.key)) {
        event.preventDefault(); open(trigger, true); return;
      }
      if (!current) return;
      const panel = root.querySelector('[data-menu-panel="' + current.dataset.menu + '"]');
      const list = items(panel), index = list.indexOf(document.activeElement);
      if (event.key === 'Escape') { event.preventDefault(); close(true); }
      if (event.key === 'Tab') close();
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
        list[next]?.focus();
      }
      if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault();
        const next = (triggers.indexOf(current) + (event.key === 'ArrowRight' ? 1 : -1) + triggers.length) % triggers.length;
        open(triggers[next], true);
      }
    }, {signal});
    signal.addEventListener('abort', () => close(), {once: true});
    return {open, close};
  }
  window.OpenDocMenus = {create};
})();
