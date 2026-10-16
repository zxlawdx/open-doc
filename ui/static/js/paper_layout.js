/* ============ PAPER MEASUREMENT / REAL ZOOM ============ */
"use strict";
(() => {
  const WIDTH = 794, MIN_HEIGHT = 1123;
  function create(root, settings, persist, signal) {
    const paper = root.querySelector('[data-surface]');
    const layout = root.querySelector('[data-paper-layout]');
    const ruler = root.querySelector('[data-ruler]');
    const slider = root.querySelector('[data-zoom]');
    const canvas = root.querySelector('[data-canvas]');
    let zoom = settings.zoom || 100, timer;
    for (let cm = 0; cm <= 21; cm++) {
      const marker = document.createElement('span');
      marker.textContent = cm; marker.style.left = (cm * WIDTH / 21) + 'px';
      ruler.append(marker);
    }
    function measure() {
      const scale = zoom / 100;
      const height = Math.max(MIN_HEIGHT, paper.scrollHeight || MIN_HEIGHT);
      layout.style.width = WIDTH * scale + 'px';
      layout.style.height = height * scale + 'px';
      layout.style.minHeight = height * scale + 'px';
      paper.style.transform = 'scale(' + scale + ')';
      ruler.style.transform = 'scale(' + scale + ')';
      const band = root.querySelector('[data-ruler-band]');
      if (band) band.style.paddingRight = 24 + Math.max(0, canvas.offsetWidth - canvas.clientWidth) + 'px';
      slider.value = zoom;
      root.querySelector('[data-zoom-value]').textContent = zoom + '%';
    }
    function set(value) {
      zoom = Math.max(50, Math.min(150, Math.round(Number(value) / 10) * 10));
      measure();
      clearTimeout(timer); timer = setTimeout(() => persist({zoom}).catch(() => {}), 250);
    }
    slider.addEventListener('input', event => set(event.target.value), {signal});
    root.querySelectorAll('[data-zoom-step]').forEach(button => button.addEventListener('click', () => set(zoom + Number(button.dataset.zoomStep)), {signal}));
    root.addEventListener('open-doc:content', measure, {signal});
    window.addEventListener('resize', measure, {signal});
    canvas.addEventListener('scroll', () => { ruler.style.left = -canvas.scrollLeft + 'px'; }, {signal});
    const observer = window.ResizeObserver ? new ResizeObserver(measure) : null;
    observer?.observe(paper);
    signal.addEventListener('abort', () => { observer?.disconnect(); clearTimeout(timer); }, {once: true});
    measure(); return {set, measure, value: () => zoom};
  }
  window.OpenDocPaperLayout = {create};
})();
