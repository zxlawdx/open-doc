/* ============ PERSISTENT LIGHT / DARK / SYSTEM ============ */
"use strict";
(() => {
  function create(root, settings, persist, signal) {
    const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : {matches: false};
    let preference = settings.theme || 'system';
    function apply() {
      root.dataset.theme = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
      root.dataset.themePreference = preference;
    }
    async function set(value) {
      if (!['light', 'dark', 'system'].includes(value)) throw new Error('Tema inválido.');
      const previous = preference;
      preference = value; apply();
      try { await persist({theme: value}); }
      catch (error) { preference = previous; apply(); throw error; }
    }
    if (media.addEventListener) {
      media.addEventListener('change', apply);
      signal.addEventListener('abort', () => media.removeEventListener('change', apply), {once: true});
    } else if (media.addListener) {
      media.addListener(apply);
      signal.addEventListener('abort', () => media.removeListener(apply), {once: true});
    }
    apply();
    return {set, preference: () => preference};
  }
  window.OpenDocTheme = {create};
})();
