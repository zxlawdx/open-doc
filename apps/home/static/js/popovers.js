/* Visual placement only. Document commands remain owned by app/editor. */
"use strict";
(() => {
  const EDGE = 8;
  function position(panel, anchor) {
    const rect = anchor instanceof Element ? anchor.getBoundingClientRect() : anchor;
    panel.style.left = EDGE + 'px';
    panel.style.top = EDGE + 'px';
    const box = panel.getBoundingClientRect();
    const left = Math.max(EDGE, Math.min(rect.left, innerWidth - box.width - EDGE));
    let top = rect.bottom;
    if (top + box.height > innerHeight - EDGE) top = Math.max(EDGE, rect.top - box.height);
    panel.style.left = left + 'px';
    panel.style.top = Math.min(top, Math.max(EDGE, innerHeight - box.height - EDGE)) + 'px';
    panel.dataset.align = left < rect.left ? 'end' : 'start';
  }
  function bind(root, signal) {
    const close = except => root.querySelectorAll('.library-file-actions[open]').forEach(details => {
      if (details !== except) details.open = false;
    });
    root.addEventListener('toggle', event => {
      const details = event.target;
      if (!details.matches?.('.library-file-actions')) return;
      details.querySelector('summary').setAttribute('aria-expanded', String(details.open));
      if (details.open) {
        close(details);
        position(details.querySelector('.document-action-menu'), details.querySelector('summary'));
      }
    }, {capture: true, signal});
    document.addEventListener('pointerdown', event => close(event.target.closest('.library-file-actions')), {signal});
    root.addEventListener('click', event => {
      if (event.target.closest('.document-action-menu button')) close();
    }, {signal});
    root.addEventListener('keydown', event => {
      const details = event.target.closest('.library-file-actions');
      if (!details?.open) return;
      const buttons = Array.from(details.querySelectorAll('[role=menuitem]'));
      if (event.key === 'Escape') {
        event.preventDefault(); details.open = false; details.querySelector('summary').focus();
      }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const index = buttons.indexOf(document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : index < 0 ? (event.key === 'ArrowDown' ? 0 : buttons.length - 1) : (index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length;
        buttons[next]?.focus();
      }
    }, {signal});
    const layout = () => {
      close();
      root.querySelectorAll('.dropdown:not([hidden]),.page-menu:not([hidden])').forEach(panel => {
        position(panel, {left: parseFloat(panel.style.left) || EDGE, top: parseFloat(panel.style.top) || EDGE, bottom: parseFloat(panel.style.top) || EDGE});
      });
    };
    window.addEventListener('resize', layout, {signal});
    root.querySelector('[data-library]')?.addEventListener('scroll', () => close(), {signal});
    signal.addEventListener('abort', () => close(), {once: true});
    return {position, close};
  }
  window.OpenDocPopovers = {position, bind};
})();
