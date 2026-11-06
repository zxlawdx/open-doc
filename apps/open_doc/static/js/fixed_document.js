/* Fixed surfaces: immutable originals, bounded PDF rendering, editable annotations. */
"use strict";
(() => {
 const clone=v=>JSON.parse(JSON.stringify(v));
 function create({root,request,status,token,asset,signal}){
  const host=document.createElement('section');host.className='fixed-document';host.hidden=true;root.querySelector('[data-document-body]').after(host);
  const controls=document.createElement('div');controls.className='fixed-controls';const sidebar=document.createElement('aside');sidebar.className='fixed-sidebar';sidebar.setAttribute('aria-label','Páginas e marcadores');const scroller=document.createElement('div');scroller.className='fixed-scroll';scroller.tabIndex=0;host.append(controls,sidebar,scroller);
  let note=null,model=null,saved='',pdf=null,pptx=null,epoch=0,queue=Promise.resolve(),timer=null,recoveryTimer=null,searchTimer=null,zoom=1,locked=false,rendering=new Set(),renderTasks=new Map(),renderedPages=new Map(),searchingPages=new Set(),pageNodes=[],active=false,searchEpoch=0,thumbObserver=null,slideFitMode=null;
  const history=window.OpenDocHistory.create(),title=root.querySelector('[data-title]');
  const semantic=window.OpenDocSemanticAnnotations?.create({host,root,scroller,sidebar,signal,getModel:()=>model,getPage:index=>renderedPages.get(index),getZoom:()=>zoom,go,status,update:items=>{model=clone(model);model.annotations=items;changed();}});
  const slidesEditor=window.OpenDocSlidesEditor?.create({
    host,root,controls,scroller,sidebar,signal,getModel:()=>model,getZoom:()=>zoom,status,
    update:next=>{model=next;changed();},go,undo:()=>format('undo'),redo:()=>format('redo'),
    exportSlide:async index=>{
      if(!model?.editable_deck)throw Error('Abra uma apresentação editável.');
      await flush();
      const result=await window.pywebview.api.export_slide(note.id,note.revision,index);
      if(result.error)throw Error(result.error);
      if(!result.cancelled){status('Salvo em: '+result.path);return result;}
    },
    onViewportResize:()=>{if(slideFitMode && model?.editable_deck)fit(slideFitMode==='page');},
    onRender:()=>{
      pageNodes=Array.from(scroller.querySelectorAll('.fixed-surface'));
      pageField.max=model.surfaces.length;
      texts();
    }
  });
  const pageField=document.createElement('input');pageField.type='number';pageField.min='1';pageField.value='1';pageField.setAttribute('aria-label','Ir para página');
  function button(label,fn){const b=document.createElement('button');b.textContent=label;b.addEventListener('click',()=>Promise.resolve(fn()).catch(e=>status(e.message)),{signal});controls.append(b);return b;}
  button('Anterior',()=>go(Number(pageField.value)-2));controls.append(pageField);pageField.addEventListener('change',()=>go(Number(pageField.value)-1),{signal});button('Próxima',()=>go(Number(pageField.value)));
  button('Ajustar largura',()=>fit(false));button('Página inteira',()=>fit(true));button('−',()=>scale(zoom/1.2));button('+',()=>scale(zoom*1.2));
  const search=document.createElement('input');search.type='search';search.placeholder='Localizar no PDF';search.setAttribute('aria-label','Localizar no PDF');controls.append(search);button('Buscar',find);const extractButton=button('Extrair páginas',()=>extractPages().catch(error=>status(error.message)));
  const pdfButton=button('Salvar PDF',()=>exportDocument('pdf'));const pptxButton=button('Salvar PPTX',()=>exportDocument('pptx'));
  const nativeTextButton=button('Editar texto do PDF',()=>{
    nativeTextPanel.hidden=!nativeTextPanel.hidden;
    if(!nativeTextPanel.hidden){
      const selected=window.getSelection()?.toString().trim()||'';
      if(selected && selected.length<=1000)nativeOriginal.value=selected;
      nativeOriginal.focus();
    }
  });
  nativeTextButton.title='Substituir texto original em PDFs com fonte simples. Salva uma cópia, não anotações.';
  const nativeTextPanel=document.createElement('form');
  nativeTextPanel.className='pdf-native-edit-panel';
  nativeTextPanel.setAttribute('aria-label','Substituição de texto original do PDF');
  nativeTextPanel.hidden=true;
  const nativeHelp=document.createElement('p');
  nativeHelp.textContent='Edição nativa experimental: somente texto ASCII em fonte simples, em um único operador PDF. O original é preservado.';
  const nativeOriginal=document.createElement('input');
  nativeOriginal.type='text';nativeOriginal.placeholder='Texto original exato';
  nativeOriginal.setAttribute('aria-label','Texto original do PDF');
  nativeOriginal.maxLength=1000;
  const nativeReplacement=document.createElement('input');
  nativeReplacement.type='text';nativeReplacement.placeholder='Novo texto';
  nativeReplacement.setAttribute('aria-label','Novo texto para o PDF');
  nativeReplacement.maxLength=1000;
  const nativeSubmit=document.createElement('button');
  nativeSubmit.type='submit';nativeSubmit.textContent='Salvar cópia editada';
  const nativeClose=document.createElement('button');
  nativeClose.type='button';nativeClose.textContent='Cancelar';
  nativeClose.addEventListener('click',()=>{nativeTextPanel.hidden=true;},{signal});
  nativeTextPanel.append(nativeHelp,nativeOriginal,nativeReplacement,nativeSubmit,nativeClose);
  controls.append(nativeTextPanel);
  nativeTextPanel.addEventListener('submit',async event=>{
    event.preventDefault();
    if(!note || note.source_kind!=='pdf')return;
    const original=nativeOriginal.value,replacement=nativeReplacement.value;
    if(!original || !replacement){status('Informe o texto original e o novo texto.');return;}
    nativeSubmit.disabled=true;
    try{
      await flush();
      const api=window.pywebview?.api;
      if(!api?.export_native_pdf_edit)throw Error('Instale a versão com edição nativa de PDF.');
      const result=await api.export_native_pdf_edit(note.id,note.revision,{
        kind:'replace_literal_text',page:Math.max(0,Number(pageField.value)-1),
        target:original,replacement
      });
      if(result?.error)throw Error(result.error);
      if(!result?.cancelled){
        status('Nova cópia com texto original modificado: '+result.path);
        nativeTextPanel.hidden=true;
      }
    }catch(error){status(error.message);}
    finally{nativeSubmit.disabled=false;}
  },{signal});
  const noteButton=button('Nota adesiva',()=>{inkMode('cursor');semantic?.setNoteMode(!semantic.noteActive());});
  semantic?.bindNoteButton(noteButton);
  const recover=button('Recuperar alterações',async()=>{if(!note.recovery)return;const n=clone(note);n.content=note.recovery.content;load(n);saved='';await flush();recover.hidden=true;});recover.hidden=true;
  function snapshot(){return {id:note.id,title:title.value.trim()||'Sem título',revision:note.revision,content_format:'opendoc-fixed-v1',content:model,markdown:''};}
  function signature(){return JSON.stringify([title.value,model]);}
  function changed(){window.OpenDocRecovery.write(snapshot());window.pywebview.api.set_dirty?.(true);history.record(snapshot(),'ink');clearTimeout(timer);timer=setTimeout(()=>flush().catch(e=>status(e.message)),800);clearTimeout(recoveryTimer);recoveryTimer=setTimeout(()=>{if(!active || signature()===saved)return;const b=snapshot();window.OpenDocRecovery.write?.(b);request('document/recovery',b).catch(e=>status(e.message));},250);root.dispatchEvent(new CustomEvent('open-doc:content'));}
  function setInkLayers(layers){model=clone(model);for(const s of model.surfaces){const l=layers.find(l=>l.surface_index===s.index);s.strokes=l?.strokes || [];s.text_overlays=l?.text_overlays || [];}changed();texts();}
  function inkLayers(){return model?.surfaces.map(s=>({...s,surface_index:s.index})) || [];}
  function insertRecognized(text,style,index,ids){const layers=inkLayers(),l=layers.find(l=>l.surface_index===index);if(!l)return;const points=l.strokes.filter(s=>ids.includes(s.id)).flatMap(s=>s.points),x=Math.min(...points.map(p=>p.x)),y=Math.min(...points.map(p=>p.y));l.text_overlays.push({id:window.OpenDocModel.id(),text,x,y,width:Math.max(.1,1-x),height:Math.min(.2,1-y),...style});l.strokes=l.strokes.filter(s=>!ids.includes(s.id));setInkLayers(layers);}
  function texts(){pageNodes.forEach(node=>{const index=Number(node.dataset.pageIndex||0);node.querySelectorAll('.fixed-text-overlay').forEach(n=>n.remove());for(const text of model.surfaces[index]?.text_overlays || []){const div=document.createElement('div');div.className='fixed-text-overlay';div.textContent=text.text;Object.assign(div.style,{left:text.x*100+'%',top:text.y*100+'%',width:text.width*100+'%',fontFamily:JSON.stringify(text.font_family)+', Inter, sans-serif',fontSize:text.font_size_pt*4/3*zoom+'px',color:text.color});node.append(div);}});}
  async function flush(){if(!active)return note;if(!note || signature()===saved)return note;const b=snapshot(),sig=signature();queue=queue.catch(()=>{}).then(async()=>{b.revision=note.revision;const result=await request('document/save',b);note.revision=result.revision;saved=sig;if(signature()===saved)window.OpenDocRecovery.clear(note.id);window.pywebview.api.set_dirty?.(signature()!==saved);status(model?.editable_deck?'Apresentação salva.':'Anotações salvas.');return result;});return queue;}
  function go(index){
    const total=model?.surfaces?.length||0;
    if(!total)return;
    index=Math.max(0,Math.min(total-1,index));
    pageField.value=index+1;
    if(model?.editable_deck){
      slidesEditor?.goTo(index);
      scroller.scrollLeft=0;scroller.scrollTop=0;
      return;
    }
    pageNodes[index]?.scrollIntoView({block:'start'});
    lazy();
  }
  // Highlight exact occurrences in the PDF text layer, including matches
  // crossing adjacent spans. Pure overlays preserve original text selection.
  function highlightSearch(index){
    const surface=pageNodes[index],layer=surface?.querySelector('.textLayer');
    surface?.querySelector('.pdf-search-overlays')?.remove();
    const query=search.value.trim().toLocaleLowerCase();
    if(!pdf||!layer||!query)return;
    const parts=[],spans=Array.from(layer.querySelectorAll('span'));
    let all='';
    for(const span of spans){
      const node=span.firstChild;
      if(!node||node.nodeType!==3||!node.textContent)continue;
      if(all)all+=' ';
      const start=all.length;all+=node.textContent;
      parts.push({node,start,end:all.length});
    }
    if(!parts.length)return;
    const overlay=document.createElement('div');overlay.className='pdf-search-overlays';
    const lower=all.toLocaleLowerCase();let offset=0,count=0;
    while(count<200){
      const at=lower.indexOf(query,offset);if(at<0)break;
      offset=at+Math.max(1,query.length);count++;
      const first=parts.find(part=>part.end>at),last=parts.find(part=>part.end>=at+query.length);
      if(!first||!last)continue;
      const range=document.createRange();
      try{
        range.setStart(first.node,Math.max(0,at-first.start));
        range.setEnd(last.node,Math.min(last.node.length,at+query.length-last.start));
        const origin=surface.getBoundingClientRect();
        for(const rect of range.getClientRects()){
          if(!rect.width||!rect.height)continue;
          const hit=document.createElement('span');hit.className='pdf-search-hit';
          Object.assign(hit.style,{left:(rect.left-origin.left)+'px',top:(rect.top-origin.top)+'px',
            width:rect.width+'px',height:rect.height+'px'});
          overlay.append(hit);
        }
      }catch(error){console.warn('PDF: intervalo de busca não desenhável',error);}
    }
    if(overlay.childElementCount)surface.append(overlay);
  }
  function scale(value,keepFit=false){
    zoom=Math.max(.25,Math.min(3,value));
    if(model?.editable_deck&&!keepFit)slideFitMode=null;
    root.querySelector('[data-zoom]').value=Math.round(zoom*100);
    root.querySelector('[data-zoom-value]').textContent=Math.round(zoom*100)+'%';
    if(model?.editable_deck){
      slidesEditor?.render();
      root.dispatchEvent(new CustomEvent('open-doc:layout'));
      return;
    }
    pageNodes.forEach((node,index)=>{
      const s=model.surfaces[index];
      node.style.width=s.width_pt*4/3*zoom+'px';
      node.style.height=s.height_pt*4/3*zoom+'px';
      node.querySelectorAll('canvas,.textLayer,.pdf-links,.pptx-content,.semantic-overlays').forEach(n=>n.remove());
    });
    semantic?.hide();for(const t of renderTasks.values())t.cancel();
    renderTasks.clear();rendering.clear();texts();
    root.dispatchEvent(new CustomEvent('open-doc:layout'));lazy();
  }
  function fit(whole){
    if(!model)return;
    const s=model.surfaces[Number(pageField.value)-1]||model.surfaces[0];
    if(!s)return;
    const width=(scroller.clientWidth-(model.editable_deck?72:48))/(s.width_pt*4/3);
    const height=(scroller.clientHeight-(model.editable_deck?72:32))/(s.height_pt*4/3);
    if(model.editable_deck)slideFitMode=whole?'page':'width';
    scale(Math.max(.25,Math.min(width,whole?height:3)),Boolean(model.editable_deck));
  }
  function pageError(node,index,stage,error){
    console.error('Open Doc PDF',{id:note.id,version:window.OpenDocPdf?.version,page:index+1,stage},error);
    const message=document.createElement('p');message.className='fixed-page-error';message.dataset.errorStage=stage;message.setAttribute('role','status');message.textContent=(stage==='canvas'?'Falha ao renderizar página '+(index+1):'Página '+(index+1)+' — '+stage+' indisponível')+': '+String(error.message).slice(0,180);node.append(message);status('PDF carregado; '+stage+' indisponível na página '+(index+1)+'.');
  }
  async function render(index,generation){
    if(pptx){const node=pageNodes[index];if(!node.querySelector('.pptx-content')){try{pptx.render(index,node,node.clientWidth,node.clientHeight);}catch(error){pageError(node,index,'slide',error);}}return;}
    if(!pdf || rendering.has(index) || pageNodes[index].querySelector('canvas'))return;
    rendering.add(index);const node=pageNodes[index];let page,canvas;
    node.querySelectorAll('.fixed-page-error').forEach(n=>n.remove());
    try{
      page=await pdf.getPage(index+1);if(generation!==epoch || !active)return;
      renderedPages.set(index,page);const viewport=page.getViewport({scale:4/3*zoom}),ratio=Math.min(window.devicePixelRatio||1,2,Math.sqrt(16000000/(viewport.width*viewport.height)));
      canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width*ratio);canvas.height=Math.ceil(viewport.height*ratio);canvas.style.width=viewport.width+'px';canvas.style.height=viewport.height+'px';node.prepend(canvas);
      const task=page.render({canvasContext:canvas.getContext('2d'),viewport,transform:ratio===1?null:[ratio,0,0,ratio,0,0]});renderTasks.set(index,task);await task.promise;
      if(generation!==epoch)return;canvas.dataset.renderComplete='true';
      try{
        const text=document.createElement('div');text.className='textLayer';text.style.setProperty('--scale-factor',String(viewport.scale));node.append(text);
        const content=await page.getTextContent();if(generation!==epoch)return;
        await new window.OpenDocPdf.TextLayer({textContentSource:content,container:text,viewport}).render();
        if(generation===epoch)highlightSearch(index);
      }catch(error){if(generation===epoch)pageError(node,index,'texto selecionável',error);}
      try{
        const links=document.createElement('div');links.className='pdf-links';node.append(links);
        for(const a of await page.getAnnotations()){
          if(a.subtype!=='Link')continue;const link=document.createElement('a'),r=viewport.convertToViewportRectangle(a.rect);
          Object.assign(link.style,{left:Math.min(r[0],r[2])+'px',top:Math.min(r[1],r[3])+'px',width:Math.abs(r[2]-r[0])+'px',height:Math.abs(r[3]-r[1])+'px'});
          link.setAttribute('aria-label','Link do documento');link.href='#';link.onclick=e=>{e.preventDefault();if(a.dest)destination(a.dest);else if(a.url && /^(https?:|mailto:)/i.test(a.url))status('Link: '+a.url);};links.append(link);
        }
      }catch(error){if(generation===epoch)pageError(node,index,'links',error);}
       if(generation===epoch)semantic?.renderPage(index,page);
    }catch(error){if(canvas?.dataset.renderComplete!=='true')canvas?.remove();if(error.name!=='RenderingCancelledException' && generation===epoch)pageError(node,index,'canvas',error);}
    finally{rendering.delete(index);renderTasks.delete(index);if(page && !node.querySelector('canvas') && !searchingPages.has(index)){page.cleanup();if(renderedPages.get(index)===page)renderedPages.delete(index);}}
  }
  function lazy(){if((!pdf && !pptx) || !active)return;const viewport=scroller.getBoundingClientRect();let first=pageNodes.findIndex(n=>n.getBoundingClientRect().bottom>viewport.top);first=Math.max(0,first);pageField.value=first+1;root.querySelector('[data-position]').textContent='Página '+(first+1)+' de '+pageNodes.length;for(let i=0;i<pageNodes.length;i++){if(Math.abs(i-first)<=2)render(i,epoch).catch(e=>status(e.message));else if(Math.abs(i-first)>4){renderTasks.get(i)?.cancel();pageNodes[i].querySelectorAll('canvas,.textLayer,.pdf-links,.pptx-content').forEach(n=>n.remove());if(!rendering.has(i) && !searchingPages.has(i) && renderedPages.has(i)){renderedPages.get(i).cleanup();renderedPages.delete(i);}}}}
  async function destination(dest){if(typeof dest==='string')dest=await pdf.getDestination(dest);if(!dest)return;go(typeof dest[0]==='number'?dest[0]:await pdf.getPageIndex(dest[0]));}
  async function find(){
    if(model?.editable_deck){
      const term=search.value.trim().toLocaleLowerCase();
      sidebar.querySelectorAll('[data-search-result]').forEach(node=>node.remove());
      if(!term){status('Digite o texto que deseja localizar.');return;}
      const matches=[];
      model.surfaces.forEach((slide,index)=>{
        (slide.elements||[]).forEach(obj=>{
          const text=String(obj.text||'');
          if(text.toLocaleLowerCase().includes(term))matches.push({index,id:obj.id,text});
        });
      });
      const focus=match=>{
        go(match.index);
        slidesEditor?.selectSearchResult(match.index,match.id);
      };
      for(const match of matches){
        const result=document.createElement('button');
        result.dataset.searchResult='';result.dataset.searchPage=String(match.index);
        result.className='slide-search-result';
        result.textContent='Slide '+(match.index+1)+' · '+match.text.slice(0,70);
        result.title='Ir ao texto encontrado no slide '+(match.index+1);
        result.addEventListener('click',()=>focus(match),{signal});
        sidebar.append(result);
      }
      if(matches.length)focus(matches[0]);
      status(matches.length+' ocorrência(s) localizada(s) nos slides.');
      return;
    }
    if(pptx){const matches=pptx.find(search.value);status(matches.length+' slides com resultados.');if(matches.length)go(matches[0]);return;}
    const query=search.value.trim();
    if(!pdf || !query)return;
    const generation=++searchEpoch,q=query.toLocaleLowerCase(),matches=[];
    const total=pdf.numPages;
    sidebar.querySelectorAll('[data-search-result]').forEach(node=>node.remove());
    status('Pesquisando em '+total+' páginas…');
    // Search from both ends so a distant match is not withheld behind hundreds
    // of sequential PDF.js text extractions. Limit concurrent worker tasks.
    const order=[];
    for(let first=0,last=total-1;first<=last;first++,last--){
      order.push(first);
      if(first!==last)order.push(last);
    }
    let cursor=0,failures=0,navigated=false;
    const valid=()=>generation===searchEpoch && active;
    const worker=async()=>{
      while(valid()){
        const slot=cursor++;
        if(slot>=order.length)return;
        const index=order[slot];
        searchingPages.add(index);
        try{
          const page=await pdf.getPage(index+1);
          if(!valid())return;
          let extracted;
          try{extracted=await page.getTextContent();}
          catch(error){
            if(!valid())return;
            // A concurrent PDF.js canvas cleanup can transiently invalidate
            // text internals. Retry once while this page is protected.
            await new Promise(resolve=>setTimeout(resolve,45));
            extracted=await page.getTextContent();
          }
          if(!valid())return;
          const items=Array.isArray(extracted?.items)?extracted.items:[];
          const text=items.map(item=>String(item?.str||'')).join(' ').toLocaleLowerCase();
          if(!text.includes(q))continue;
          matches.push(index);
          const button=document.createElement('button');
          button.dataset.searchResult='';
          button.dataset.searchPage=String(index);
          button.textContent='Resultado · página '+(index+1);
          button.onclick=()=>{go(index);highlightSearch(index);};
          const successor=Array.from(sidebar.querySelectorAll('[data-search-result]'))
            .find(node=>Number(node.dataset.searchPage)>index);
          if(successor)sidebar.insertBefore(button,successor);
          else sidebar.append(button);
          if(!navigated){navigated=true;go(index);highlightSearch(index);}
          status(matches.length+' páginas com resultados (pesquisando…).');
        }catch(error){
          if(!valid())return;
          failures++;
          console.error('Open Doc: falha ao pesquisar página '+(index+1),error);
        }finally{searchingPages.delete(index);}
      }
    };
    await Promise.all(Array.from({length:Math.min(4,total)},()=>worker()));
    if(!valid())return;
    if(matches.length){const first=Math.min(...matches);go(first);highlightSearch(first);}
    status(matches.length+' páginas com resultados.'+(failures?' '+failures+' páginas não puderam ser examinadas.':''));
  }
  search.addEventListener('input',()=>{
    clearTimeout(searchTimer);
    searchEpoch++;
    sidebar.querySelectorAll('[data-search-result]').forEach(node=>node.remove());
    pageNodes.forEach(node=>node.querySelector('.pdf-search-overlays')?.remove());
    if(search.value.trim())searchTimer=setTimeout(()=>find().catch(error=>status(error.message)),260);
  },{signal});
  search.addEventListener('keydown',event=>{
    if(event.key==='Enter'){
      event.preventDefault();clearTimeout(searchTimer);
      find().catch(error=>status(error.message));
    }
  },{signal});
  async function load(value){slidesEditor?.deactivate();thumbObserver?.disconnect();const generation=++epoch;searchEpoch++;for(const t of renderTasks.values())t.cancel();renderTasks.clear();rendering.clear();renderedPages.clear();pdf?.destroy();pdf=null;pptx?.destroy();pptx=null;note=clone(value);const local=window.OpenDocRecovery.read(note.id);if(local && local.content?.source_sha256===note.content.source_sha256 && local.revision>=note.revision && JSON.stringify(local.content)!==JSON.stringify(note.content))note.recovery=local;model=clone(note.content);saved=JSON.stringify([note.title,model]);title.value=note.title;active=true;root.dataset.readerState='loading';host.hidden=false;pptxButton.hidden=note.source_kind!=='pptx';pdfButton.hidden=note.source_kind==='pptx';nativeTextButton.hidden=note.source_kind!=='pdf';nativeTextPanel.hidden=true;noteButton.hidden=note.source_kind!=='pdf';extractButton.hidden=note.source_kind!=='pdf';semantic?.setNoteMode(false);search.placeholder=note.source_kind==='pptx'?'Localizar nos slides':'Localizar no PDF';recover.hidden=!note.recovery;history.reset(snapshot());slideFitMode=null;scroller.replaceChildren();sidebar.replaceChildren();semantic?.reset();pageNodes=[];pageField.max=model.surfaces.length;pageField.value='1';
   if(!note.capabilities.preview){const message=document.createElement('p');message.textContent='O leitor deste formato não está disponível. O arquivo original foi preservado.';scroller.append(message);return;}
   if(note.source_kind==='pptx' && model.editable_deck){
     root.dataset.readerState='ready';
     root.querySelector('[data-mode-label]').textContent='Apresentação';
     slidesEditor?.load();
     if(scroller.clientWidth>80 && scroller.clientHeight>80)fit(true);
     root.dispatchEvent(new CustomEvent('open-doc:content'));
     return;
   }
   for(const s of model.surfaces){const node=document.createElement('div');node.className='fixed-surface';node.dataset.pageIndex=s.index;node.dataset.widthPt=s.width_pt;node.dataset.heightPt=s.height_pt;node.style.width=s.width_pt*4/3+'px';node.style.height=s.height_pt*4/3+'px';scroller.append(node);pageNodes.push(node);const b=document.createElement('button');b.textContent='Página '+(s.index+1);b.dataset.thumbnailIndex=s.index;b.onclick=()=>go(s.index);sidebar.append(b);}
   root.querySelector('[data-mode-label]').textContent=note.source_kind==='pdf'?'Leitor PDF':'Apresentação';root.querySelector('[data-count]').textContent=model.surfaces.length+' páginas';texts();root.dispatchEvent(new CustomEvent('open-doc:content'));
   if(note.source_kind==='pptx'){
     try{const loaded=await window.OpenDocPptx.load(note.id,token);if(generation!==epoch){loaded.destroy();return;}pptx=loaded;if(pptx.count!==model.surfaces.length)throw Error('Quantidade de slides difere da origem.');root.dataset.readerState='ready';const warning=document.createElement('p');warning.className='pptx-fidelity-warning';warning.textContent='Prévia local PPTX: fontes, animações, mídia e efeitos avançados podem diferir do PowerPoint.';scroller.prepend(warning);fit(false);lazy();thumbObserver=new IntersectionObserver(entries=>{for(const entry of entries){if(!entry.isIntersecting || entry.target.querySelector('.pptx-thumbnail'))continue;const index=Number(entry.target.dataset.thumbnailIndex),surface=model.surfaces[index];pptx.render(index,entry.target,110,110*surface.height_pt/surface.width_pt,true);}},{root:sidebar,rootMargin:'100px'});sidebar.querySelectorAll('[data-thumbnail-index]').forEach(b=>thumbObserver.observe(b));}
     catch(error){console.error('Open Doc PPTX',error);root.dataset.readerState='error';note.capabilities.preview=false;note.capabilities.ink=false;const warning=document.createElement('p');warning.className='fixed-load-error';warning.textContent='Não foi possível inicializar o leitor PPTX: '+error.message;warning.setAttribute('role','alert');scroller.prepend(warning);status(warning.textContent);}return;
   }
   try{window.OpenDocPdf.GlobalWorkerOptions.workerSrc=asset('vendor/pdf.worker.bundle.js');const task=window.OpenDocPdf.getDocument({url:'/api/open_doc/artifact/content?id='+encodeURIComponent(note.id)+(note.source_kind==='pptx'?'&preview=1':''),httpHeaders:{'X-Open-Doc-Token':token},standardFontDataUrl:asset('../pdfjs/standard_fonts/'),cMapUrl:asset('../pdfjs/cmaps/'),cMapPacked:true,useSystemFonts:false,isEvalSupported:false,disableAutoFetch:true,disableStream:true});const loaded=await task.promise;if(generation!==epoch){loaded.destroy();return;}pdf=loaded;root.dataset.readerState='ready';console.info('Open Doc PDF carregado',{version:window.OpenDocPdf.version,id:note.id,pages:pdf.numPages});if(pdf.numPages!==model.surfaces.length)throw Error('Quantidade de páginas difere da origem.');const outline=await pdf.getOutline();function bookmarks(items,depth=0){for(const item of items || []){const b=document.createElement('button');b.textContent='  '.repeat(depth)+item.title;b.onclick=()=>destination(item.dest);sidebar.prepend(b);bookmarks(item.items,depth+1);}}bookmarks(outline);
    thumbObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting && !entry.target.querySelector('canvas')){const index=Number(entry.target.dataset.thumbnailIndex);thumbnail(index,entry.target,generation).catch(()=>{});}},{root:sidebar,rootMargin:'100px'});sidebar.querySelectorAll('[data-thumbnail-index]').forEach(b=>thumbObserver.observe(b));fit(false);lazy();}catch(e){if(generation===epoch){root.dataset.readerState='error';console.error('Open Doc: falha no leitor PDF',e);const warning=document.createElement('p');warning.className='fixed-load-error';warning.setAttribute('role','alert');warning.textContent='Não foi possível inicializar o leitor PDF: '+e.message;scroller.prepend(warning);status(warning.textContent);}}
  }
  async function thumbnail(index,button,generation){if(!pdf)return;const page=await pdf.getPage(index+1);if(generation!==epoch)return;const viewport=page.getViewport({scale:110/page.getViewport({scale:1}).width}),canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);button.prepend(canvas);try{await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;}catch(e){canvas.remove();}finally{if(!rendering.has(index) && !pageNodes[index]?.querySelector('canvas'))page.cleanup();}}
  const context=document.createElement('div');context.className='page-menu';context.hidden=true;context.setAttribute('role','menu');host.append(context);
  for(const [label,fn] of [['Página anterior',()=>go(Number(pageField.value)-2)],['Próxima página',()=>go(Number(pageField.value))],['Ajustar largura',()=>fit(false)],['Página inteira',()=>fit(true)],['Selecionar texto',()=>inkMode('cursor')],['Caneta',()=>inkMode('pen')],['Marca-texto',()=>inkMode('highlighter')],['Nota adesiva',()=>{inkMode('cursor');semantic?.setNoteMode(!semantic.noteActive());}],['Borracha',()=>inkMode('eraser')],['Escrita',()=>inkMode('handwriting')]]){const b=document.createElement('button');b.textContent=label;b.setAttribute('role','menuitem');b.onclick=()=>{context.hidden=true;fn();};context.append(b);}
  function inkMode(mode){root.dispatchEvent(new CustomEvent('open-doc:ink-mode',{detail:mode}));}
  scroller.addEventListener('contextmenu',e=>{if(e.target.closest('.textLayer span,.pdf-links a'))return;e.preventDefault();context.hidden=false;window.OpenDocPopovers.position(context,{left:e.clientX,top:e.clientY,bottom:e.clientY});context.querySelector('button').focus();},{signal});
  root.addEventListener('click',e=>{if(!context.contains(e.target))context.hidden=true;},{signal});root.addEventListener('keydown',e=>{if(e.key==='Escape')context.hidden=true;if(!context.hidden && ['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();const buttons=Array.from(context.querySelectorAll('button')),at=buttons.indexOf(document.activeElement);buttons[(at+(e.key==='ArrowDown'?1:buttons.length-1))%buttons.length].focus();}},{signal});
  async function extractPages(){
    if(!active || note?.source_kind!=='pdf')return;
    const total=model.surfaces.length;
    const firstText=window.prompt('Página inicial para extrair (1 a '+total+')','1');
    if(firstText===null)return;
    const lastText=window.prompt('Página final para extrair (1 a '+total+')',String(total));
    if(lastText===null)return;
    const parse=value=>/^[0-9]+$/.test(String(value).trim())?Number(value):NaN;
    const first=parse(firstText),last=parse(lastText);
    if(!Number.isInteger(first)||!Number.isInteger(last)||first<1||last<first||last>total)
      throw Error('Informe um intervalo de páginas válido.');
    await flush();
    const result=await window.pywebview.api.extract_pdf_pages(note.id,note.revision,first,last);
    if(result.error)throw Error(result.error);
    if(!result.cancelled)status('PDF extraído: '+result.path);
    return result;
  }
  async function exportDocument(format){
    await flush();
    status('Exportando '+format.toUpperCase()+'…');
    const result=await window.pywebview.api.export_document(note.id,note.revision,format);
    if(result.error)throw Error(result.error);
    if(result.cancelled){status('Exportação cancelada.');return result;}
    const confirmation=root.querySelector('[data-export-result]');
    if(confirmation){
      confirmation.replaceChildren();
      const label=document.createElement('span');label.textContent='Salvo em: '+result.path;
      const close=document.createElement('button');close.type='button';close.textContent='';
      close.setAttribute('aria-label','Fechar confirmação de exportação');
      close.addEventListener('click',()=>confirmation.replaceChildren());
      confirmation.append(label,close);
    }
    status('Salvo em: '+result.path);
    return result;
  }
  root.addEventListener('open-doc:fixed-zoom',event=>{if(active)scale(event.detail/100);},{signal});
  root.addEventListener('open-doc:view-ready',()=>{
    if(active && model?.editable_deck && host.dataset.slideEditor==='true' &&
       scroller.clientWidth>80 && scroller.clientHeight>80)fit(true);
  },{signal});
  title.addEventListener('input',()=>{if(active)changed();},{signal});scroller.addEventListener('scroll',lazy,{signal});
  function format(command){if(locked)return;if(command==='undo' || command==='redo'){const value=history[command]();if(value){model=clone(value.content);title.value=value.title;clearTimeout(timer);timer=setTimeout(()=>flush().catch(e=>status(e.message)),800);texts();semantic?.refresh();slidesEditor?.render();root.dispatchEvent(new CustomEvent('open-doc:content'));}}}
  window.addEventListener('keydown',e=>{if(!active || !(e.ctrlKey || e.metaKey))return;
    if(e.key.toLowerCase()==='f' && (note?.source_kind==='pdf'||note?.source_kind==='pptx')){
      e.preventDefault();search.focus();search.select();return;
    }
    if(e.key.toLowerCase()==='s'){e.preventDefault();flush().catch(e=>status(e.message));}if(['z','y'].includes(e.key.toLowerCase())){e.preventDefault();format(e.shiftKey || e.key==='y'?'redo':'undo');}},{signal});
  window.addEventListener('beforeunload',e=>{if(active && signature()!==saved){request('document/recovery',snapshot()).catch(()=>{});e.preventDefault();e.returnValue='';}},{signal});
  signal.addEventListener('abort',()=>{clearTimeout(timer);clearTimeout(recoveryTimer);epoch++;thumbObserver?.disconnect();pdf?.destroy();pptx?.destroy();host.remove();},{once:true});
  return {load,flush,snapshot,inkLayers,setInkLayers,insertRecognized,format,export:exportDocument,isClean:()=>!note || signature()===saved,setLocked:v=>{locked=v;title.disabled=v;},setMode:()=>{},capture:()=>{},refresh:lazy,style:()=>{},textState:()=>({}),commandState:()=>false,pagination:()=>null,pageView:()=>{},copy:async()=>{await flush();const duplicate=await request('document/duplicate',{id:note.id});load(duplicate);return duplicate;},deactivate:()=>{slidesEditor?.deactivate();active=false;epoch++;searchEpoch++;searchingPages.clear();clearTimeout(timer);clearTimeout(recoveryTimer);clearTimeout(searchTimer);thumbObserver?.disconnect();for(const task of renderTasks.values())task.cancel();renderTasks.clear();renderedPages.clear();rendering.clear();pdf?.destroy();pdf=null;pptx?.destroy();pptx=null;pageNodes=[];scroller.replaceChildren();host.hidden=true;},find:()=>search.focus()};
 }
 window.OpenDocFixedDocument={create};
})();
