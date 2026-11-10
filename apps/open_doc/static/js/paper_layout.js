/* ============ PAPER MEASUREMENT / REAL ZOOM ============ */
"use strict";
(() => {
  const WIDTH = 794, MIN_HEIGHT = 1123;
  function create(root, settings, persist, signal) {
    const paper = root.querySelector('[data-surface]');
    const layout = root.querySelector('[data-paper-layout]');
    const ruler = root.querySelector('[data-ruler]');
    const canvas = root.querySelector('[data-canvas]');
    let zoom = settings.zoom || 100;
    for (let cm = 0; cm <= 21; cm++) {
      const marker = document.createElement('span');
      marker.textContent = cm; marker.style.left = (cm * WIDTH / 21) + 'px';
      ruler.append(marker);
    }
    function measure() {
      if(root.dataset.documentKind==='fixed')return;
      const scale = zoom / 100;
      const width=parseFloat(paper.style.width) || Number(paper.dataset.pageWidth) || WIDTH;
      const minimum=Number(paper.dataset.pageHeight) || MIN_HEIGHT;
      const height=Math.max(minimum,paper.scrollHeight || minimum);
      if(ruler.dataset.rulerWidth!==String(width)){ruler.replaceChildren();for(let cm=0;cm<=Math.floor(width/(96/2.54));cm++){const marker=document.createElement('span');marker.textContent=cm;marker.style.left=cm*(96/2.54)+'px';ruler.appendChild(marker);}ruler.dataset.rulerWidth=String(width);}
      layout.style.width = width * scale + 'px';
      layout.style.height = height * scale + 'px';
      layout.style.minHeight = height * scale + 'px';
      paper.style.transform = 'scale(' + scale + ')';
      ruler.style.width=width+'px';
      if(Number(paper.dataset.pageWidth)>0){const style=getComputedStyle(root.querySelector('[data-rich]'));ruler.style.background='linear-gradient(90deg,var(--color-border-soft) 0 '+style.paddingLeft+',var(--color-paper) '+style.paddingLeft+' calc(100% - '+style.paddingRight+'),var(--color-border-soft) calc(100% - '+style.paddingRight+'))';}else ruler.style.background='';
      ruler.style.transform = 'scale(' + scale + ')';
      const band = root.querySelector('[data-ruler-band]');
      if (band) band.style.paddingRight = 24 + Math.max(0, canvas.offsetWidth - canvas.clientWidth) + 'px';
    }
    function set(value) {
      zoom = Math.max(50, Math.min(150, Math.round(value)));
      measure();
      root.dispatchEvent(new CustomEvent('open-doc:paper-zoom'));
      persist({zoom}).catch(() => {});
    }
    root.addEventListener('open-doc:content', measure, {signal});
    root.addEventListener('open-doc:layout', measure, {signal});
    window.addEventListener('resize', measure, {signal});
    canvas.addEventListener('scroll', () => { ruler.style.left = -canvas.scrollLeft + 'px'; }, {signal});
    const observer = window.ResizeObserver ? new ResizeObserver(measure) : null;
    observer?.observe(paper);
    signal.addEventListener('abort', () => { observer?.disconnect(); }, {once: true});
    measure(); return {set, measure, value: () => zoom};
  }
  window.OpenDocPaperLayout = {create};
})();
