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
  function findElement(index,id){
    function find(items){for(const item of items||[]){if(String(item.id)===String(id))return item;const child=find(item.children);if(child)return child;}return null;}
    return find(presentation.slides[index]?.elements);
  }
  function render(index,node,width,height,thumbnail=false,mode=null){
    const slide=presentation.slides[index],original=slide.elements;
    let element=null;
    if(mode?.object){
      const obj=mode.object,source=findElement(index,obj.source_shape_id);
      const before=obj.source_original||{},changedNative=key=>JSON.stringify(obj[key])!==JSON.stringify(before[key]);
      if(obj.type==='chart'&&Object.keys(obj).some(key=>key.startsWith('chart_')&&changedNative(key)))return null;
      if(obj.type==='image'&&['asset_id','crop_left','crop_right','crop_top','crop_bottom','flip_h','flip_v','image_brightness','image_contrast','image_grayscale','image_opacity','image_tint'].some(changedNative))return null;
      if(obj.type==='math'||obj.type==='table')return null;
      if(!source)return null;
      element={...source,bounds:{x:0,y:0,width:obj.width*presentation.slideSize.width,height:obj.height*presentation.slideSize.height},rotation:0};
      if(obj.type==='image'){element.flipH=false;element.flipV=false;}
      const previous=obj.source_original||{},changed=key=>JSON.stringify(obj[key])!==JSON.stringify(previous[key]);
      if(source.text){
        element.text=JSON.parse(JSON.stringify(source.text));
        if(changed('text_runs')&&obj.text_runs){
          obj.text_runs.forEach((line,p)=>{const target=element.text.paragraphs[p]?.runs.filter(r=>r.text!=='\n')||[];line.forEach((run,r)=>{if(target[r])target[r].text=run.text;});});
        }else if(changed('text')){
          const lines=String(obj.text||'').split('\n'),before=element.text.paragraphs;
          element.text.paragraphs=lines.map((text,i)=>{const paragraph=before[i]||before[0]||{runs:[]};return {...paragraph,runs:[{...(paragraph.runs[0]||{}),text}]};});
        }
        const fields={font_family:'fontFamily',font_size_pt:'fontSize',font_bold:'bold',font_italic:'italic',font_underline:'underline',color:'color'};
        for(const paragraph of element.text.paragraphs){
          if(changed('paragraph_alignment'))paragraph.align=obj.paragraph_alignment;
          for(const run of paragraph.runs)for(const [field,target] of Object.entries(fields))if(changed(field))run[target]=field==='color'?{hex:obj[field],alpha:1}:field==='font_size_pt'?obj[field]*4/3:obj[field];
        }
      }
      if(source.type==='table'&&changed('table_cells')){
        element.rows=JSON.parse(JSON.stringify(source.rows));
        element.rows.forEach((row,r)=>row.cells.forEach((cell,c)=>{
          const value=obj.table_cells?.[r]?.[c];
          if(value===undefined||value===previous.table_cells?.[r]?.[c])return;
          const before=cell.text?.paragraphs||[{runs:[]}];
          cell.text={...(cell.text||{}),paragraphs:String(value).split('\n').map((text,i)=>{
            const paragraph=before[i]||before[0];
            return {...paragraph,runs:[{...(paragraph.runs?.[0]||{}),text}]};
          })};
        }));
      }
      if(changed('fill'))element.fill={type:'solid',color:{hex:obj.fill,alpha:1}};
      if(changed('stroke')||changed('stroke_width'))element.stroke={...element.stroke,color:{hex:obj.stroke,alpha:1},width:obj.stroke_width*4/3};
    }
    const detached=document.createElement('div');
    try{
      if(mode)slide.elements=element?[element]:[];
      window.OpenDocPptxVendor.renderSlideToElement(presentation,index,detached,{width,height});
    }finally{slide.elements=original;}
    if(element){
      const svg=detached.querySelector('svg');
      svg.querySelector('[data-layer="master-shapes"]')?.remove();svg.querySelector('[data-layer="layout-shapes"]')?.remove();
      for(const child of [...svg.children])if(child.localName==='rect')child.remove();
      svg.setAttribute('viewBox',`0 0 ${element.bounds.width} ${element.bounds.height}`);
      svg.setAttribute('preserveAspectRatio','none');
    }
    const fragment=window.DOMPurify.sanitize(detached.innerHTML,{USE_PROFILES:{html:true,svg:true,svgFilters:true},ADD_TAGS:['foreignObject'],HTML_INTEGRATION_POINTS:{foreignobject:true},FORBID_TAGS:['script','iframe','object','embed','style','link','form','input','button','audio','video'],ALLOWED_URI_REGEXP:/^(?:(?:blob|https?|mailto):|data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,RETURN_DOM_FRAGMENT:true});
    for(const element of fragment.querySelectorAll('*')){
      for(const name of ['src','href','xlink:href']){const value=element.getAttribute(name);if(value && !/^(?:blob:|data:image\/|#)/i.test(value))element.removeAttribute(name);}
      if(/url\s*\(\s*["']?(?!#|blob:|data:image\/)/i.test(element.getAttribute('style') || ''))element.removeAttribute('style');
    }
    const content=document.createElement('div');content.className=thumbnail?'pptx-thumbnail':'pptx-content';content.dataset.slideIndex=index;content.append(fragment);node.prepend(content);return content;
  }
  function text(value){if(!value || typeof value!=='object')return '';return Object.entries(value).map(([key,v])=>typeof v==='string' && (key==='text' || key==='content')?v:typeof v==='object'?text(v):'').join(' ');}
  function hydrate(model){
    const fields={font_family:'fontFamily',font_size_pt:'fontSize',font_bold:'bold',font_italic:'italic',color:'color'};
    for(const surface of model.surfaces)for(const obj of surface.elements||[]){
      const source=findElement(surface.source_slide_index,obj.source_shape_id);
      const run=source?.text?.paragraphs.flatMap(p=>p.runs).find(r=>r.text.trim());
      if(!run)continue;
      for(const [key,name] of Object.entries(fields))if(run[name]!==undefined){
        const value=key==='color'?run[name].hex:key==='font_size_pt'?Math.max(6,Math.min(144,run[name]*3/4)):run[name];
        if(!obj.source_original||JSON.stringify(obj[key])===JSON.stringify(obj.source_original[key]))obj[key]=value;
        if(obj.source_original)obj.source_original[key]=value;
      }
    }
  }
  return {count:presentation.slides.length,render,hydrate,
    renderObject:(index,obj,node)=>render(index,node,100,100,false,{object:obj}),
    renderBackground:(index,node)=>render(index,node,100,100,false,{background:true}),
    find:q=>presentation.slides.map((s,i)=>text(s).toLocaleLowerCase().includes(q.toLocaleLowerCase())?i:-1).filter(i=>i>=0),destroy:()=>presentation.cleanup()};
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
