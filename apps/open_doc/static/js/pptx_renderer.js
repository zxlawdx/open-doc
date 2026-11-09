/* Local MIT PPTX renderer adapter. The source is validated before it reaches here. */
"use strict";
(() => {
 async function load(id,token){
  if(!window.OpenDocPptxVendor)throw Error('Renderer PPTX local indisponível. Execute npm run build.');
  const response=await fetch('/api/open_doc/artifact/content?id='+encodeURIComponent(id),{headers:{'X-Open-Doc-Token':token}});
  if(!response.ok)throw Error('Não foi possível ler a apresentação (HTTP '+response.status+').');
  return loadBytes(await response.arrayBuffer());
 }
 async function loadBytes(bytes){
  const signature=new Uint8Array(bytes,0,Math.min(2,bytes.byteLength));
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
 async function loadFidelity(id,token,asset,expectedCount){
  const pdfjs=window.OpenDocPdf;
  pdfjs.GlobalWorkerOptions.workerSrc=asset('vendor/pdf.worker.bundle.js');
  const task=pdfjs.getDocument({
    url:'/api/open_doc/artifact/content?id='+encodeURIComponent(id)+'&preview=1',
    httpHeaders:{'X-Open-Doc-Token':token},
    standardFontDataUrl:asset('../pdfjs/standard_fonts/'),
    cMapUrl:asset('../pdfjs/cmaps/'),cMapPacked:true,isEvalSupported:false,
  });
  let pdf;
  try{
    pdf=await task.promise;
    if(pdf.numPages!==expectedCount)throw Error('Quantidade de slides difere da origem.');
  }catch(error){await task.destroy();throw error;}
  let closed=false;
  async function render(index,node,width,height,thumbnail=false){
    const content=document.createElement('div');
    content.className=thumbnail?'pptx-thumbnail':'pptx-content';
    content.dataset.slideIndex=index;
    const canvas=document.createElement('canvas');
    canvas.style.width=width+'px';canvas.style.height=height+'px';
    canvas.style.display='block';canvas.setAttribute('aria-label','Slide '+(index+1));
    content.append(canvas);node.prepend(content);
    try{
      const page=await pdf.getPage(index+1);
      if(closed || !content.isConnected)return;
      const original=page.getViewport({scale:1});
      const scale=Math.min(width/original.width,height/original.height)*Math.min(devicePixelRatio || 1,2);
      const viewport=page.getViewport({scale});
      canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
    }catch(error){
      if(!closed && content.isConnected)content.textContent='Não foi possível exibir este slide.';
    }
  }
  async function find(query){
    const needle=query.toLocaleLowerCase();
    const matches=[];
    for(let i=0;i<pdf.numPages && !closed;i++){
      const page=await pdf.getPage(i+1),text=await page.getTextContent();
      if(text.items.map(item=>item.str || '').join(' ').toLocaleLowerCase().includes(needle))matches.push(i);
    }
    return matches;
  }
  return {count:pdf.numPages,render,find,destroy:()=>{closed=true;return task.destroy();},fidelity:true};
 }
 window.OpenDocPptx={load,loadBytes,loadFidelity};
})();
