/* Shared normalized vector ink. No bridge traffic during pointer sampling. */
"use strict";
(() => {
 window.OpenDocDebug=Object.assign({input:false,pagination:false,ink:false},window.OpenDocDebug || {});
 const NS='http://www.w3.org/2000/svg', clamp=v=>Math.max(0,Math.min(1,v));
 function simplify(points,tolerance=.0006){
  if(points.length<3)return points;
  const keep=new Set([0,points.length-1]),stack=[[0,points.length-1]],limit=tolerance*tolerance;
  while(stack.length){const [start,end]=stack.pop(),a=points[start],b=points[end],dx=b.x-a.x,dy=b.y-a.y,d=dx*dx+dy*dy;let max=limit,at=-1;
   for(let i=start+1;i<end;i++){const p=points[i],t=d?clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/d):0,dist=(p.x-a.x-t*dx)**2+(p.y-a.y-t*dy)**2;if(dist>max){max=dist;at=i;}}
   if(at>=0){keep.add(at);stack.push([start,at],[at,end]);}
  }return points.filter((_,i)=>keep.has(i));
 }
 function path(stroke){return (stroke.outline || []).map((p,i)=>(i?'L':'M')+p[0]+','+p[1]).join(' ')+' Z';}
 const MAX_PREVIEW_POINTS=1024;
 function shouldErase(mode){return mode==='eraser' || mode==='eraser-partial';}
 // Eraser geometry is measured in the visible page's CSS pixels, not in
 // normalized coordinates; that keeps the brush round on A4, PDFs and slides.
 const square=x=>x*x;
 function distanceToSegment(x,y,a,b,rect){
  const ax=a.x*rect.width,ay=a.y*rect.height,bx=b.x*rect.width,by=b.y*rect.height;
  const dx=bx-ax,dy=by-ay,den=dx*dx+dy*dy;
  const t=den?Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/den)):0;
  return square(x-ax-t*dx)+square(y-ay-t*dy);
 }
 function underEraser(point,eraser,rect,radius){
  const x=point.x*rect.width,y=point.y*rect.height,limit=radius*radius;
  if(eraser.length===1)return distanceToSegment(x,y,eraser[0],eraser[0],rect)<=limit;
  for(let i=1;i<eraser.length;i++)if(distanceToSegment(x,y,eraser[i-1],eraser[i],rect)<=limit)return true;
  return false;
 }
 function interpolatePoint(a,b,t){
  const p={...a};for(const k of ['x','y','pressure','tilt_x','tilt_y','timestamp_ms'])
   p[k]=(a[k]??0)+((b[k]??0)-(a[k]??0))*t;
  return p;
 }
 function denseStrokePoints(points,rect,radius){
  if(!points?.length)return [];
  const result=[points[0]],step=Math.max(2,radius/3);
  // Typical pen sampling is already dense. Only interpolate long segments
  // so that a fast eraser crossing can cut a line with just two saved points.
  for(let i=1;i<points.length;i++){
   const a=points[i-1],b=points[i];
   const length=Math.hypot((b.x-a.x)*rect.width,(b.y-a.y)*rect.height);
   const count=Math.max(1,Math.ceil(length/step));
   for(let j=1;j<=count;j++)result.push(interpolatePoint(a,b,j/count));
  }
  return result;
 }
 function fragmentStroke(stroke,points,dimensions,first){
  // Recompute the outline: reusing the original outline would visibly
  // reconnect the erased gap and would export the old (untrimmed) polygon.
  const w=dimensions.width_pt,h=dimensions.height_pt;
  const retained=simplify(points,.00015);
  const outline=window.OpenDocFreehand.getStroke(
   retained.map(p=>[p.x*w,p.y*h,p.pressure]),
   {size:stroke.size,simulatePressure:false,thinning:.5}
  ).map(p=>[clamp(p[0]/w),clamp(p[1]/h)]);
  return {...stroke,id:first?stroke.id:window.OpenDocModel.id(),points:retained,outline};
 }
 function nearStroke(stroke,eraser,rect,threshold){
  const points=stroke.points || [];
  if(!points.length||!eraser.length)return false;
  let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
  for(const p of eraser){const x=p.x*rect.width,y=p.y*rect.height;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
  left-=threshold;right+=threshold;top-=threshold;bottom+=threshold;
  // Bounding the original control points is sufficient for the full line:
  // all interpolated points lie inside their stroke's bounding rectangle.
  let sx=Infinity,ex=-Infinity,sy=Infinity,ey=-Infinity;
  for(const p of points){const x=p.x*rect.width,y=p.y*rect.height;sx=Math.min(sx,x);ex=Math.max(ex,x);sy=Math.min(sy,y);ey=Math.max(ey,y);}
  return ex>=left&&sx<=right&&ey>=top&&sy<=bottom;
 }
 function erasePartialStroke(stroke,eraser,rect,dimensions,radius){
  const width=(stroke.size||2)*rect.width/(dimensions.width_pt||rect.width);
  const threshold=radius+Math.min(6,width/2);
  if(!nearStroke(stroke,eraser,rect,threshold))return {changed:false,fragments:[stroke]};
  const points=denseStrokePoints(stroke.points,rect,radius);
  if(!points.length)return {changed:false,fragments:[stroke]};
  // Quick rectangle rejection for distant strokes, avoiding processing all
  // saved points on every move when writing over a long document.
  const xs=eraser.map(p=>p.x*rect.width),ys=eraser.map(p=>p.y*rect.height);
  const minX=Math.min(...xs)-threshold,maxX=Math.max(...xs)+threshold;
  const minY=Math.min(...ys)-threshold,maxY=Math.max(...ys)+threshold;
  if(!points.some(p=>p.x*rect.width>=minX&&p.x*rect.width<=maxX&&p.y*rect.height>=minY&&p.y*rect.height<=maxY))
   return {changed:false,fragments:[stroke]};
  const kept=[],fragments=[];let changed=false;
  function finish(){
   if(kept.length)fragments.push(fragmentStroke(stroke,kept,dimensions,fragments.length===0));
   kept.length=0;
  }
  for(const p of points){
   if(underEraser(p,eraser,rect,threshold)){changed=true;finish();}
   else kept.push(p);
  }
  finish();
  return {changed,fragments:changed?fragments:[stroke]};
 }
 function touchesStroke(stroke,eraser,rect,dimensions,radius){
  const width=(stroke.size||2)*rect.width/(dimensions.width_pt||rect.width);
  const threshold=radius+Math.min(6,width/2);
  if(!nearStroke(stroke,eraser,rect,threshold))return false;
  const pts=denseStrokePoints(stroke.points,rect,radius);
  return pts.some(p=>underEraser(p,eraser,rect,threshold));
 }
 function eraseStrokes(strokes,eraser,rect,dimensions,radius,whole){
  const result=[];let changed=false;
  for(const stroke of strokes){
   if(whole){
    if(touchesStroke(stroke,eraser,rect,dimensions,radius)){changed=true;continue;}
    result.push(stroke);
   }else{
    const cut=erasePartialStroke(stroke,eraser,rect,dimensions,radius);
    if(cut.changed)changed=true;
    result.push(...cut.fragments);
   }
  }
  return {strokes:result,changed};
 }
 function create({root,editor,status,signal}){
  let mode='cursor',color='#202124',size=2,active=null,scheduled=false,conversion=false,suppressClickUntil=0,phase='idle',capable=false;
  const debugPointer=event=>{if(!window.OpenDocDebug.ink)return;console.debug('[OpenDoc ink]',{type:event.type,pointerId:event.pointerId ?? null,pointerType:event.pointerType || null,button:Number.isFinite(event.button)?event.button:null,buttons:Number.isFinite(event.buttons)?event.buttons:null,pressure:Number.isFinite(event.pressure)?event.pressure:null,tiltX:Number.isFinite(event.tiltX)?event.tiltX:null,tiltY:Number.isFinite(event.tiltY)?event.tiltY:null,twist:Number.isFinite(event.twist)?event.twist:null,width:Number.isFinite(event.width)?event.width:null,height:Number.isFinite(event.height)?event.height:null,isPrimary:event.isPrimary ?? null,timestamp:event.timeStamp});};
  const stopInkEvent=event=>{event.preventDefault();event.stopPropagation();};
  const isInkSurfaceEvent=event=>Boolean(event.target?.closest?.('.ink-overlay,.document-page,.fixed-surface'));
  function suppressSyntheticClick(event,force=false){if(mode==='cursor' || (!force && performance.now()>=suppressClickUntil))return;event.preventDefault();event.stopPropagation();event.stopImmediatePropagation?.();}
  function releaseCapture(svg,pointerId){try{if(svg.hasPointerCapture?.(pointerId)===false)return;svg.releasePointerCapture?.(pointerId);}catch{}}
  const bar=document.createElement('div');bar.className='ink-toolbar';bar.setAttribute('role','toolbar');bar.setAttribute('aria-label','Tinta e escrita');
  for(const [value,label] of [['cursor','Selecionar'],['pen','Caneta'],['highlighter','Marca-texto'],['eraser-partial','Borracha parcial'],['eraser','Apagar traço'],['handwriting','Escrita']]){const b=document.createElement('button');b.textContent=label;b.dataset.inkMode=value;b.title=value==='eraser-partial'?'Apaga somente a área percorrida, preservando o restante do traço':value==='eraser'?'Apaga o traço inteiro ao tocá-lo':'';b.setAttribute('aria-pressed',String(value===mode));b.addEventListener('click',()=>setMode(value),{signal});bar.append(b);}
  const c=document.createElement('input');c.type='color';c.value=color;c.setAttribute('aria-label','Cor da tinta');c.oninput=()=>{color=c.value;};bar.append(c);
  const s=document.createElement('input');s.type='number';s.min='.5';s.max='30';s.step='.5';s.value=size;s.setAttribute('aria-label','Espessura em pontos');s.onchange=()=>{size=Math.max(.5,Math.min(30,Number(s.value)||2));};bar.append(s);
  for(const [label,action] of [['Desfazer',()=>editor.format('undo')],['Refazer',()=>editor.format('redo')],['Converter escrita',convert]]){const b=document.createElement('button');b.textContent=label;b.addEventListener('click',action,{signal});bar.append(b);}
  const convertButton=Array.from(bar.querySelectorAll('button')).find(b=>b.textContent==='Converter escrita');
  convertButton.disabled=true;convertButton.title='Reconhecimento manuscrito local não instalado.';
  const availability=document.createElement('span');availability.dataset.handwritingStatus='';availability.textContent='Escrita local: verificando…';bar.append(availability);
  const handwritingDetails=document.createElement('button');
  handwritingDetails.type='button';handwritingDetails.textContent='Detalhes';handwritingDetails.hidden=true;
  handwritingDetails.setAttribute('aria-label','Detalhes do reconhecimento de escrita local');
  handwritingDetails.addEventListener('click',()=>status(convertButton.title),{signal});
  bar.append(handwritingDetails);
  async function capabilities(){
    try{const result=await window.pywebview.api.handwriting_capabilities?.();if(signal.aborted)return;const backends=result?.backends || [];const backend=backends.find(b=>b.available);
      capable=Boolean(backend);convertButton.disabled=!capable;availability.textContent=backend?backend.backend+' · '+(backend.language || 'pt-BR'):'Escrita local: indisponível';convertButton.title=backend?'Converter escrita com revisão':backends.map(b=>b.reason).filter(Boolean).join(' ') || 'Reconhecimento manuscrito local não instalado.';
      if(!capable)availability.textContent='Escrita local indisponível';
      handwritingDetails.hidden=capable;
      if(!capable)console.info('Open Doc: backends de escrita indisponíveis',convertButton.title);
    }catch(error){capable=false;convertButton.disabled=true;availability.textContent='Escrita local indisponível';convertButton.title=error.message;handwritingDetails.hidden=false;console.warn('Open Doc: falha na verificação de escrita local',error);}
  }
  capabilities();root.addEventListener('open-doc:handwriting-capabilities',capabilities,{signal});
  const family=document.createElement('select');family.dataset.inkFont='';family.setAttribute('aria-label','Fonte do texto reconhecido');for(const name of ['Arial','Inter']){const option=document.createElement('option');option.value=name;option.textContent=name;family.append(option);}bar.append(family);
  function refreshFonts(){if(window.pywebview.api.get_font_catalog)window.pywebview.api.get_font_catalog().then(catalog=>{if(signal.aborted)return;for(const name of catalog.fonts || [])if(!Array.from(family.options).some(o=>o.value===name)){const option=document.createElement('option');option.value=name;option.textContent=name;family.append(option);}}).catch(e=>status(e.message));}
  refreshFonts();root.addEventListener('open-doc:fonts',refreshFonts,{signal});
  const fontSize=document.createElement('input');fontSize.type='number';fontSize.min='1';fontSize.max='512';fontSize.value='12';fontSize.dataset.inkFontSize='';fontSize.setAttribute('aria-label','Tamanho do texto reconhecido');bar.append(fontSize);
  root.querySelector('.toolbar')?.after(bar);
  function setMode(value){mode=value;root.dataset.inkMode=mode;bar.querySelectorAll('[data-ink-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.inkMode===mode)));refresh();}
  function layers(){return editor.inkLayers?.() || [];}
  const rendered=new WeakMap();
  function commit(layer){
   const next=layers().slice(),at=next.findIndex(l=>l.surface_index===layer.surface_index);
   if(at<0)next.push(layer);else next[at]=layer;
   editor.setInkLayers(next);queue();
  }
  function paintStrokes(svg,strokes){
   const previous=rendered.get(svg);
   if(previous?.strokes===strokes)return;
   const nodes=new Map();
   let cursor=svg.firstChild;
   for(const stroke of strokes){
    let entry=previous?.nodes.get(stroke.id);
    if(!entry||entry.stroke!==stroke){
     const node=entry?.node||document.createElementNS(NS,'path');
     node.setAttribute('d',path(stroke));node.setAttribute('fill',stroke.color);
     node.setAttribute('opacity',stroke.opacity);entry={node,stroke};
    }
    if(entry.node!==cursor)svg.insertBefore(entry.node,cursor);
    cursor=entry.node.nextSibling;
    nodes.set(stroke.id,entry);
   }
   while(cursor){const next=cursor.nextSibling;cursor.remove();cursor=next;}
   rendered.set(svg,{strokes,nodes});
  }
  const emptyStrokes=[];

  function refresh(){scheduled=false;if(signal.aborted)return;const values=new Map(layers().map(layer=>[layer.surface_index,layer]));for(const surface of root.querySelectorAll('.document-page, .fixed-surface')){
   if(!surface.querySelector('[data-page-content]') && !surface.classList.contains('fixed-surface'))continue;
   if(root.dataset.documentKind==='fixed' && !surface.classList.contains('fixed-surface'))continue;
   const index=Number(surface.dataset.pageIndex),layer=values.get(index);let svg=surface.querySelector(':scope > .ink-overlay');
   if(!svg){svg=document.createElementNS(NS,'svg');svg.classList.add('ink-overlay');svg.setAttribute('contenteditable','false');svg.setAttribute('focusable','false');svg.setAttribute('viewBox','0 0 1 1');svg.setAttribute('preserveAspectRatio','none');svg.setAttribute('aria-label','Camada de tinta');surface.append(svg);svg.addEventListener('pointerdown',e=>down(e,surface),{signal});svg.addEventListener('pointermove',move,{signal});svg.addEventListener('pointerup',up,{signal});svg.addEventListener('pointercancel',cancel,{signal});svg.addEventListener('lostpointercapture',e=>{debugPointer(e);if(active?.id===e.pointerId && phase==='drawing')cancel(e);},{signal});
    for(const type of ['click','auxclick','contextmenu'])svg.addEventListener(type,e=>{debugPointer(e);if(mode!=='cursor' && (performance.now()<suppressClickUntil || type==='contextmenu'))suppressSyntheticClick(e,type==='contextmenu');},{capture:true,signal});}
   // Absolutely positioned SVG percentages can include the page's padding
   // differently across QtWebEngine/Chromium versions. Bind the ink viewport
   // to the physical page border box, not to the writable text inset.
   // offsetWidth/Height stay in layout pixels when the page is zoomed.
   // Match the border box, including borders and padding, in *layout* px.
   // CSS transforms/zoom then apply equally to the page and the SVG.
   // Using clientWidth/clientHeight alone underfills bordered pages in Qt.
   svg.style.left=(-surface.clientLeft)+'px';svg.style.top=(-surface.clientTop)+'px';
   svg.style.right='auto';svg.style.bottom='auto';
   svg.style.width=(surface.offsetWidth||surface.clientWidth)+'px';
   svg.style.height=(surface.offsetHeight||surface.clientHeight)+'px';
   svg.style.pointerEvents=mode==='cursor'?'none':'auto';
   if(active?.svg===svg)continue;
   paintStrokes(svg,layer?.strokes || emptyStrokes);
  }}
  function queue(){if(!scheduled){scheduled=true;requestAnimationFrame(refresh);}}
  function sample(event,rect){return {x:clamp((event.clientX-rect.left)/rect.width),y:clamp((event.clientY-rect.top)/rect.height),pressure:event.pointerType==='mouse' && !(event.pressure>0)?.5:Number.isFinite(event.pressure)?clamp(event.pressure):.5,tilt_x:event.tiltX || 0,tilt_y:event.tiltY || 0,timestamp_ms:Math.max(0,event.timeStamp)};}
  function down(e,surface){debugPointer(e);if(active && e.pointerType==='touch'){stopInkEvent(e);return;}if(root.dataset.readerState==='error' && root.dataset.documentKind==='fixed')return;
   if(root.querySelector('[data-title]')?.disabled || root.dataset.homeView==='true' || mode==='cursor' || active || e.pointerType==='touch' || (e.button!==0 && e.button!==2 && e.button!==5))return;stopInkEvent(e);const svg=e.currentTarget,rect=svg.getBoundingClientRect(),index=Number(surface.dataset.pageIndex),previous=layers().find(l=>l.surface_index===index),layer=previous?{...previous}:{surface_index:index,width_pt:Number(surface.dataset.widthPt)||rect.width*.75,height_pt:Number(surface.dataset.heightPt)||rect.height*.75,strokes:[],text_overlays:[],anchor_block_id:surface.querySelector('[data-node-id]')?.dataset.nodeId};
   // The next stroke may begin before the deferred layer refresh.
   paintStrokes(svg,layer.strokes);
   if(rect.width<=0 || rect.height<=0)return;
   const focused=document.activeElement;
   if(root.contains(focused)&&focused?.matches('input,textarea,select'))focused.blur();
   phase='drawing';active={svg,rect,layer,id:e.pointerId,erase:shouldErase(mode),eraseWhole:mode==='eraser',eraseProcessed:0,eraseChanged:false,points:[sample(e,rect)],stroke:{id:window.OpenDocModel.id(),tool:mode==='highlighter'?'highlighter':'pen',color,size,opacity:mode==='highlighter'?.32:1,handwriting:mode==='handwriting'}};try{svg.setPointerCapture(e.pointerId);}catch{};active.preview=document.createElementNS(NS,'path');active.preview.setAttribute('fill',color);active.preview.setAttribute('opacity',active.stroke.opacity);svg.append(active.preview);draw();}
  function draw(final=false){
   if(!active)return;
   const a=active;
   if(a.drawn===a.points.length&&(!final||!a.previewSampled))return;
   a.drawn=a.points.length;
   if(a.erase){
    const pathPoints=a.points.slice(Math.max(0,a.eraseProcessed-1));
    a.eraseProcessed=a.points.length;
    const result=eraseStrokes(a.layer.strokes,pathPoints,a.rect,a.layer,12,a.eraseWhole);
    if(!result.changed)return;
    a.eraseChanged=true;
    a.layer.strokes=result.strokes;
    paintStrokes(a.svg,a.layer.strokes);
    return;
   }
   const w=a.layer.width_pt,h=a.layer.height_pt;
   const stride=final?1:Math.ceil(a.points.length/MAX_PREVIEW_POINTS);
   const input=[];
   for(let i=0;i<a.points.length-1;i+=stride){
    const p=a.points[i];input.push([p.x*w,p.y*h,p.pressure]);
   }
   const end=a.points[a.points.length-1];input.push([end.x*w,end.y*h,end.pressure]);
   a.previewSampled=stride>1;
   a.stroke.outline=window.OpenDocFreehand.getStroke(input,{size:a.stroke.size,simulatePressure:false,thinning:.5}).map(p=>[clamp(p[0]/w),clamp(p[1]/h)]);
   a.preview.setAttribute('d',path(a.stroke));
  }
  function collect(e){
   stopInkEvent(e);
   const coalesced=e.getCoalescedEvents?.();
   for(const v of coalesced?.length?coalesced:[e])
    if(active.points.length<20000)active.points.push(sample(v,active.rect));
  }
  function move(e){
   debugPointer(e);if(!active||active.id!==e.pointerId)return;
   collect(e);
   const stroke=active;
   if(stroke.frame!=null)return;
   stroke.frame=requestAnimationFrame(()=>{
    if(signal.aborted||active!==stroke)return;
    stroke.frame=null;draw();
   });
  }
  function up(e){
   debugPointer(e);
   if(!active||active.id!==e.pointerId)return;
   collect(e);draw(true);
   const a=active;phase='committing';active=null;
   suppressClickUntil=performance.now()+350;releaseCapture(a.svg,e.pointerId);
   if(a.erase){
    a.preview.remove();
    if(a.eraseChanged)commit(a.layer);else refresh();
   }else{
    a.stroke.points=simplify(a.points);
    const previous=rendered.get(a.svg);
    const canAppend=previous?.strokes===a.layer.strokes&&a.preview.parentNode===a.svg;
    a.layer.strokes=[...a.layer.strokes,a.stroke];
    if(canAppend){
     previous.nodes.set(a.stroke.id,{node:a.preview,stroke:a.stroke});
     previous.strokes=a.layer.strokes;
    }else{
     a.preview.remove();paintStrokes(a.svg,a.layer.strokes);
    }
    commit(a.layer);
   }
   phase='committed';
  }
  function cancel(e){if(e)debugPointer(e);if(!active || (e?.pointerId!=null && active.id!==e.pointerId))return;const a=active;phase='cancelled';active=null;a.preview.remove();releaseCapture(a.svg,a.id);refresh();phase='idle';}
  async function convert(){if(conversion || !capable){if(!capable)status(convertButton.title);return;}const layer=layers().findLast?.(l=>l.strokes.some(s=>s.handwriting)) || layers().slice().reverse().find(l=>l.strokes.some(s=>s.handwriting));if(!layer){status('Use Escrita para escrever antes de converter.');return;}const strokes=layer.strokes.filter(s=>s.handwriting),note=editor.snapshot();conversion=true;status('Reconhecendo escrita localmente…');try{const result=await window.pywebview.api.recognize_handwriting(strokes,'pt-BR');if(result.error)throw Error(result.error);if(!result.text?.trim())throw Error('O reconhecedor não retornou texto. Sua tinta foi mantida.');if(editor.snapshot().id!==note.id)throw Error('O documento mudou. A tinta foi mantida.');
    const backdrop=document.createElement('div');backdrop.className='modal-backdrop';const box=document.createElement('section');box.className='dialog';box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');const title=document.createElement('h2');title.textContent='Revisar escrita reconhecida';const text=document.createElement('textarea');text.value=result.text;text.setAttribute('aria-label','Texto reconhecido, editável');const info=document.createElement('p');info.textContent=result.backend+(result.confidence==null?' · confiança não informada':' · confiança '+Math.round(result.confidence*100)+'%');box.append(title,info,text);
    for(const [label,insert] of [['Manter tinta',false],['Cancelar',false],['Inserir texto',true]]){const b=document.createElement('button');b.textContent=label;b.onclick=()=>{if(insert && text.value.trim() && editor.snapshot().id===note.id){const style={font_family:family.value||'Arial',font_size_pt:Math.max(1,Math.min(512,Number(fontSize.value)||12)),color:root.querySelector('[data-text-color]')?.value||color};editor.insertRecognized(text.value,style,layer.surface_index,strokes.map(s=>s.id));}backdrop.remove();refresh();};box.append(b);}backdrop.append(box);root.append(backdrop);text.focus();
   }catch(e){status(e.message);}finally{conversion=false;}}
  document.addEventListener('pointermove',move,{signal});document.addEventListener('pointerup',up,{signal});
  for(const type of ['click','auxclick','contextmenu'])root.addEventListener(type,e=>{if(mode!=='cursor' && isInkSurfaceEvent(e) && performance.now()<suppressClickUntil && (e.detail>0 || e.pointerType==='pen' || type==='contextmenu'))suppressSyntheticClick(e);},{capture:true,signal});
  root.addEventListener('open-doc:ink-mode',event=>setMode(event.detail),{signal});
  root.addEventListener('open-doc:cancel-ink',()=>cancel(),{signal});
  root.addEventListener('open-doc:ink-changed',queue,{signal});
  root.addEventListener('open-doc:layout',queue,{signal});root.addEventListener('open-doc:view-ready',queue,{signal});root.addEventListener('open-doc:content',queue,{signal});const observer=new MutationObserver(records=>{if(records.some(r=>Array.from(r.addedNodes).some(n=>n.nodeType===1 && (n.matches('.document-page,.fixed-surface') || n.querySelector('.document-page,.fixed-surface')))))queue();});observer.observe(root,{subtree:true,childList:true});signal.addEventListener('abort',()=>{observer.disconnect();bar.remove();},{once:true});setMode('cursor');return {refresh,setMode};
 }
 window.OpenDocInk={create,simplify,path,shouldErase,eraseStrokes,erasePartialStroke};
})();
