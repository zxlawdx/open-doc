/* Local MIT PPTX renderer adapter. The source is validated before it reaches here. */
"use strict";
(() => {
 async function load(id,token){
  if(!window.OpenDocPptxVendor)throw Error('Renderer PPTX local indisponível. Execute npm run build.');
  const response=await fetch('/api/open_doc/artifact/content?id='+encodeURIComponent(id),{headers:{'X-Open-Doc-Token':token}});
  if(!response.ok)throw Error('Não foi possível ler a apresentação (HTTP '+response.status+').');
  const bytes=await response.arrayBuffer(),signature=new Uint8Array(bytes,0,Math.min(2,bytes.byteLength));
  if(signature[0]!==80 || signature[1]!==75)throw Error('A origem não é um pacote PPTX.');
  const presentation=await window.OpenDocPptxVendor.loadPresentation(bytes);
  function render(index,node,width,height,thumbnail=false){
    const detached=document.createElement('div');window.OpenDocPptxVendor.renderSlideToElement(presentation,index,detached,{width,height});
    const fragment=window.DOMPurify.sanitize(detached.innerHTML,{USE_PROFILES:{html:true,svg:true,svgFilters:true},ADD_TAGS:['foreignObject'],HTML_INTEGRATION_POINTS:{foreignobject:true},FORBID_TAGS:['script','iframe','object','embed','style','link','form','input','button','audio','video'],ALLOWED_URI_REGEXP:/^(?:(?:blob|https?|mailto):|data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,RETURN_DOM_FRAGMENT:true});
    for(const element of fragment.querySelectorAll('*')){
      for(const name of ['src','href','xlink:href']){const value=element.getAttribute(name);if(value && !/^(?:blob:|data:image\/|#)/i.test(value))element.removeAttribute(name);}
      if(/url\s*\(\s*["']?(?!#|blob:|data:image\/)/i.test(element.getAttribute('style') || ''))element.removeAttribute('style');
    }
    const content=document.createElement('div');content.className=thumbnail?'pptx-thumbnail':'pptx-content';content.dataset.slideIndex=index;content.append(fragment);node.prepend(content);return content;
  }
  function text(value){if(!value || typeof value!=='object')return '';return Object.entries(value).map(([key,v])=>typeof v==='string' && (key==='text' || key==='content')?v:typeof v==='object'?text(v):'').join(' ');}
  return {count:presentation.slides.length,render,find:q=>presentation.slides.map((s,i)=>text(s).toLocaleLowerCase().includes(q.toLocaleLowerCase())?i:-1).filter(i=>i>=0),destroy:()=>presentation.cleanup()};
 }
 window.OpenDocPptx={load};
})();
