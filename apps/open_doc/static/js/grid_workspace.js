"use strict";
(() => {
  function ribbon(host, signal, onTab) {
    const nav=host.querySelector(".workbook-ribbon-tabs");
    const bar=host.querySelector(".workbook-ribbon");
    const more=host.querySelector("[data-ribbon-overflow]");
    const shell=bar.parentElement;
    const groups=bar.querySelectorAll("[data-ribbon-group]");
    const tabs=Array.from(nav.querySelectorAll("[data-ribbon-tab]"));
    function expanded(value) {
      bar.classList.toggle("ribbon-expanded",value);
      more.setAttribute("aria-expanded",String(value));
    }
    function measure() {
      if(host.hidden)return;
      more.hidden=!bar.classList.contains("ribbon-expanded")&&bar.scrollWidth<=shell.clientWidth+1;
    }
    nav.addEventListener("click",event=>{
      const button=event.target.closest("[data-ribbon-tab]");
      if(!button)return;
      for(const tab of tabs)tab.setAttribute("aria-pressed",String(tab===button));
      for(const group of groups)group.hidden=!group.dataset.ribbonGroup.split(" ").includes(button.dataset.ribbonTab);
      expanded(false);bar.scrollLeft=0;measure();
      onTab?.(button.dataset.ribbonTab);
    },{signal});
    nav.addEventListener("keydown",event=>{
      const index=tabs.indexOf(event.target);
      if(index<0||!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
      event.preventDefault();
      const next={ArrowLeft:(index+tabs.length-1)%tabs.length,ArrowRight:(index+1)%tabs.length,Home:0,End:tabs.length-1}[event.key];
      tabs[next].focus();tabs[next].click();
    },{signal});
    more.addEventListener("click",()=>{expanded(more.getAttribute("aria-expanded")!=="true");measure();},{signal});
    bar.addEventListener("keydown",event=>{
      if(event.key==="Escape"&&bar.classList.contains("ribbon-expanded")){
        expanded(false);measure();more.focus();
      }
    },{signal});
    let frame;
    const observer=new ResizeObserver(()=>{
      cancelAnimationFrame(frame);frame=requestAnimationFrame(measure);
    });
    observer.observe(shell);
    signal.addEventListener("abort",()=>{cancelAnimationFrame(frame);observer.disconnect();},{once:true});
  }

  function splitter(panel, signal, onResize) {
    const handle=panel.previousElementSibling, shell=panel.parentElement;
    const minimum=240, gridMinimum=270;
    function update(width) {
      const maximum=Math.max(minimum,shell.clientWidth-gridMinimum-handle.offsetWidth);
      const next=Math.min(maximum,Math.max(minimum,width));
      shell.style.setProperty("--code-width",next+"px");
      handle.setAttribute("aria-valuemin",String(minimum));
      handle.setAttribute("aria-valuemax",String(maximum));
      handle.setAttribute("aria-valuenow",String(Math.round(next)));
      onResize?.();
    }
    function sync() {
      handle.hidden=panel.hidden;
      if(!panel.hidden&&handle.offsetWidth)update(panel.offsetWidth);
    }
    handle.addEventListener("pointerdown",event=>{
      if(event.button!==0)return;
      handle.focus();handle.setPointerCapture(event.pointerId);event.preventDefault();
    },{signal});
    handle.addEventListener("pointermove",event=>{
      if(handle.hasPointerCapture(event.pointerId))
        update(shell.getBoundingClientRect().right-event.clientX);
    },{signal});
    handle.addEventListener("keydown",event=>{
      if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
      event.preventDefault();
      update({ArrowLeft:panel.offsetWidth+32,ArrowRight:panel.offsetWidth-32,Home:minimum,End:shell.clientWidth}[event.key]);
    },{signal});
    window.addEventListener("resize",sync,{signal});
    return sync;
  }

  function icon(host,name) {
    const ns="http://www.w3.org/2000/svg";
    const source=host.querySelector("use").getAttribute("href").split("#")[0];
    const svg=document.createElementNS(ns,"svg"),use=document.createElementNS(ns,"use");
    svg.setAttribute("aria-hidden","true");use.setAttribute("href",source+"#"+name);
    svg.append(use);return svg;
  }

  window.OpenDocGridWorkspace={ribbon,splitter,icon};
})();
