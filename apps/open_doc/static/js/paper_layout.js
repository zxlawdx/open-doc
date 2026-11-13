/* ============ PAPER MEASUREMENT / REAL ZOOM ============ */
"use strict";
(() => {
  const WIDTH = 794, MIN_HEIGHT = 1123;
  function create(root, settings, persist, signal, editor) {
    const paper = root.querySelector('[data-surface]');
    const layout = root.querySelector('[data-paper-layout]');
    const ruler = root.querySelector('[data-ruler]');
    const canvas = root.querySelector('[data-canvas]');
    let zoom = settings.zoom || 100;
    const handles=new Map();let dragging=null;
    const section=()=>editor?.snapshot()?.content?.sections?.[0]||window.OpenDocPagination?.defaults||{};
    function paragraph(){const node=getSelection()?.anchorNode;return(node?.nodeType===1?node:node?.parentElement)?.closest?.('p,h1,h2,h3,h4,li,[data-node-type=paragraph]');}
    function metrics(){const current=section(),width=current.page_width_pt||595.28,left=current.margin_left_pt??72,right=current.margin_right_pt??72;return{current,width,left,right};}
    function handleValue(name){const m=metrics();return name==='left'?m.left:name==='right'?m.width-m.right:m.left+(parseFloat(paragraph()?.style.textIndent)||0)*.75;}
    function commitHandle(name,value){const m=metrics();if(name==='left')editor.pageSetup({margin_left_pt:Math.max(0,Math.min(m.width-m.right-30,value))});else if(name==='right')editor.pageSetup({margin_right_pt:Math.max(0,Math.min(m.width-m.left-30,m.width-value))});else editor.style('paragraph',{first_line_indent_pt:Math.max(-m.left,Math.min(m.width-m.right-m.left-20,value-m.left))});measure();}
    function rulerHandles(){if(!editor)return;for(const [name,label]of [['left','Margem esquerda'],['right','Margem direita'],['indent','Recuo de primeira linha']]){
      let handle=handles.get(name);if(!handle){handle=document.createElement('button');handle.type='button';handle.className='ruler-handle';handle.dataset.rulerHandle=name;handle.setAttribute('role','slider');handle.setAttribute('aria-label',label);handle.title=label+' · arraste ou use as setas (0,1 cm; Shift: 1 cm)';
       handle.addEventListener('pointerdown',event=>{event.preventDefault();editor.capture();dragging={name,start:event.clientX,value:handleValue(name),pointer:event.pointerId};},{signal});
       handle.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();editor.capture();commitHandle(name,handleValue(name)+(event.key==='ArrowRight'?1:-1)*(event.shiftKey?1:.1)*72/2.54);},{signal});handles.set(name,handle);}
      if(handle.parentNode!==ruler)ruler.append(handle);const value=handleValue(name);handle.style.left=value*4/3+'px';handle.style.top=name==='indent'?'14px':'0px';handle.style.height=name==='indent'?'9px':'14px';handle.setAttribute('aria-valuemin','0');handle.setAttribute('aria-valuemax',String(metrics().width*2.54/72));handle.setAttribute('aria-valuenow',(value*2.54/72).toFixed(2));handle.setAttribute('aria-valuetext',(value*2.54/72).toFixed(2)+' centímetros');
     }root.querySelector('[data-ruler-band]')?.setAttribute('aria-label','Régua interativa em centímetros: margens e recuo de primeira linha.');}
    window.addEventListener('pointermove',event=>{if(!dragging||dragging.pointer!==event.pointerId)return;const value=dragging.value+(event.clientX-dragging.start)*.75/(zoom/100);handles.get(dragging.name).style.left=value*4/3+'px';dragging.next=value;},{signal});
    function stop(event){if(!dragging||dragging.pointer!==event.pointerId)return;const previous=dragging;dragging=null;if(event.type!=='pointercancel'&&previous.next!==undefined)commitHandle(previous.name,previous.next);else measure();}
    window.addEventListener('pointerup',stop,{signal});window.addEventListener('pointercancel',stop,{signal});

    for (let cm = 0; cm <= 21; cm++) {
      const marker = document.createElement('span');
      marker.textContent = cm; marker.style.left = (cm * WIDTH / 21) + 'px';
      ruler.append(marker);
    }
    function measure() {
      if(root.dataset.documentKind==='fixed')return;
      const scale = zoom / 100;
      rulerHandles();
      const width=parseFloat(paper.style.width) || Number(paper.dataset.pageWidth) || WIDTH;
      const minimum=Number(paper.dataset.pageHeight) || MIN_HEIGHT;
      const height=Math.max(minimum,paper.scrollHeight || minimum);
      if(ruler.dataset.rulerWidth!==String(width)){ruler.replaceChildren();for(let cm=0;cm<=Math.floor(width/(96/2.54));cm++){const marker=document.createElement('span');marker.textContent=cm;marker.style.left=cm*(96/2.54)+'px';ruler.appendChild(marker);}ruler.dataset.rulerWidth=String(width);rulerHandles();}
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
    document.addEventListener('selectionchange',()=>{if(!dragging&&root.contains(getSelection()?.anchorNode))rulerHandles();},{signal});
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
