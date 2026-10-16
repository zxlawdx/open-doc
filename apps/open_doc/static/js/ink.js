/* Shared normalized vector ink. No bridge traffic during pointer sampling. */
"use strict";
(() => {
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
 function create({root,editor,status,signal}){
  let mode='cursor',color='#202124',size=2,active=null,scheduled=false,conversion=false,suppressClickUntil=0,phase='idle',capable=false;
  const bar=document.createElement('div');bar.className='ink-toolbar';bar.setAttribute('role','toolbar');bar.setAttribute('aria-label','Tinta e escrita');
  for(const [value,label] of [['cursor','Selecionar'],['pen','Caneta'],['highlighter','Marca-texto'],['eraser','Borracha'],['handwriting','Escrita']]){const b=document.createElement('button');b.textContent=label;b.dataset.inkMode=value;b.setAttribute('aria-pressed',String(value===mode));b.addEventListener('click',()=>setMode(value),{signal});bar.append(b);}
  const c=document.createElement('input');c.type='color';c.value=color;c.setAttribute('aria-label','Cor da tinta');c.oninput=()=>{color=c.value;};bar.append(c);
  const s=document.createElement('input');s.type='number';s.min='.5';s.max='30';s.step='.5';s.value=size;s.setAttribute('aria-label','Espessura em pontos');s.onchange=()=>{size=Math.max(.5,Math.min(30,Number(s.value)||2));};bar.append(s);
  for(const [label,action] of [['Desfazer',()=>editor.format('undo')],['Refazer',()=>editor.format('redo')],['Converter escrita',convert]]){const b=document.createElement('button');b.textContent=label;b.addEventListener('click',action,{signal});bar.append(b);}
  const convertButton=Array.from(bar.querySelectorAll('button')).find(b=>b.textContent==='Converter escrita');
  convertButton.disabled=true;convertButton.title='Reconhecimento manuscrito local não instalado.';
  const availability=document.createElement('span');availability.dataset.handwritingStatus='';availability.textContent='Escrita local: verificando…';bar.append(availability);
  async function capabilities(){
    try{const result=await window.pywebview.api.handwriting_capabilities?.();if(signal.aborted)return;const backends=result?.backends || [];const backend=backends.find(b=>b.available);
      capable=Boolean(backend);convertButton.disabled=!capable;availability.textContent=backend?backend.backend+' · '+(backend.language || 'pt-BR'):'Escrita local: indisponível';convertButton.title=backend?'Converter escrita com revisão':backends.map(b=>b.reason).filter(Boolean).join(' ') || 'Reconhecimento manuscrito local não instalado.';
      if(!capable)availability.textContent='Escrita local indisponível: '+convertButton.title;
    }catch(error){capable=false;convertButton.disabled=true;availability.textContent='Escrita local indisponível: '+error.message;convertButton.title=error.message;}
  }
  capabilities();root.addEventListener('open-doc:handwriting-capabilities',capabilities,{signal});
  const family=document.createElement('select');family.dataset.inkFont='';family.setAttribute('aria-label','Fonte do texto reconhecido');for(const name of ['Arial','Inter']){const option=document.createElement('option');option.value=name;option.textContent=name;family.append(option);}bar.append(family);
  function refreshFonts(){if(window.pywebview.api.get_font_catalog)window.pywebview.api.get_font_catalog().then(catalog=>{if(signal.aborted)return;for(const name of catalog.fonts || [])if(!Array.from(family.options).some(o=>o.value===name)){const option=document.createElement('option');option.value=name;option.textContent=name;family.append(option);}}).catch(e=>status(e.message));}
  refreshFonts();root.addEventListener('open-doc:fonts',refreshFonts,{signal});
  const fontSize=document.createElement('input');fontSize.type='number';fontSize.min='1';fontSize.max='512';fontSize.value='12';fontSize.dataset.inkFontSize='';fontSize.setAttribute('aria-label','Tamanho do texto reconhecido');bar.append(fontSize);
  root.querySelector('.toolbar')?.after(bar);
  function setMode(value){mode=value;root.dataset.inkMode=mode;bar.querySelectorAll('[data-ink-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.inkMode===mode)));refresh();}
  function layers(){return editor.inkLayers?.() || [];}
  function commit(layer){const next=window.OpenDocCompat.cloneJson(layers()),at=next.findIndex(l=>l.surface_index===layer.surface_index);if(at<0)next.push(layer);else next[at]=layer;editor.setInkLayers(next);refresh();}
  function refresh(){scheduled=false;if(signal.aborted)return;const values=layers();for(const surface of root.querySelectorAll('.document-page, .fixed-surface')){
   if(!surface.querySelector('[data-page-content]') && !surface.classList.contains('fixed-surface'))continue;
   if(root.dataset.documentKind==='fixed' && !surface.classList.contains('fixed-surface'))continue;
   const index=Number(surface.dataset.pageIndex),layer=values.find(l=>l.surface_index===index);let svg=surface.querySelector(':scope > .ink-overlay');
   if(!svg){svg=document.createElementNS(NS,'svg');svg.classList.add('ink-overlay');svg.setAttribute('contenteditable','false');svg.setAttribute('focusable','false');svg.setAttribute('viewBox','0 0 1 1');svg.setAttribute('preserveAspectRatio','none');svg.setAttribute('aria-label','Camada de tinta');surface.append(svg);svg.addEventListener('pointerdown',e=>down(e,surface),{signal});svg.addEventListener('pointermove',move,{signal});svg.addEventListener('pointerup',up,{signal});svg.addEventListener('pointercancel',cancel,{signal});svg.addEventListener('lostpointercapture',e=>{if(active?.id===e.pointerId && phase==='drawing')cancel();},{signal});
    for(const type of ['click','auxclick','contextmenu'])svg.addEventListener(type,e=>{if(mode!=='cursor' && (performance.now()<suppressClickUntil || type==='contextmenu')){e.preventDefault();e.stopPropagation();}},{capture:true,signal});}
   svg.style.pointerEvents=mode==='cursor'?'none':'auto';
   if(active?.svg===svg)continue;
   svg.replaceChildren();for(const stroke of layer?.strokes || []){const p=document.createElementNS(NS,'path');p.setAttribute('d',path(stroke));p.setAttribute('fill',stroke.color);p.setAttribute('opacity',stroke.opacity);svg.append(p);}
  }}
  function queue(){if(!scheduled){scheduled=true;requestAnimationFrame(refresh);}}
  function sample(event,rect){return {x:clamp((event.clientX-rect.left)/rect.width),y:clamp((event.clientY-rect.top)/rect.height),pressure:event.pointerType==='mouse' && !(event.pressure>0)?.5:Number.isFinite(event.pressure)?clamp(event.pressure):.5,tilt_x:event.tiltX || 0,tilt_y:event.tiltY || 0,timestamp_ms:Math.max(0,event.timeStamp)};}
  function down(e,surface){if(active && e.pointerType==='touch'){e.preventDefault();e.stopPropagation();return;}if(root.dataset.readerState==='error' && root.dataset.documentKind==='fixed')return;
   if(root.querySelector('[data-title]')?.disabled || root.dataset.homeView==='true' || mode==='cursor' || active || e.pointerType==='touch' || (e.button!==0 && e.button!==2 && e.button!==5))return;e.preventDefault();e.stopPropagation();const svg=e.currentTarget,rect=svg.getBoundingClientRect(),index=Number(surface.dataset.pageIndex),layer=window.OpenDocCompat.cloneJson(layers().find(l=>l.surface_index===index) || {surface_index:index,width_pt:Number(surface.dataset.widthPt)||rect.width*.75,height_pt:Number(surface.dataset.heightPt)||rect.height*.75,strokes:[],text_overlays:[],anchor_block_id:surface.querySelector('[data-node-id]')?.dataset.nodeId});
   if(rect.width<=0 || rect.height<=0)return;
   phase='drawing';active={svg,rect,layer,id:e.pointerId,erase:mode==='eraser' || e.button===2 || e.button===5 || !!(e.buttons&32),points:[sample(e,rect)],stroke:{id:window.OpenDocModel.id(),tool:mode==='highlighter'?'highlighter':'pen',color,size,opacity:mode==='highlighter'?.32:1,handwriting:mode==='handwriting'}};try{svg.setPointerCapture(e.pointerId);}catch{};active.preview=document.createElementNS(NS,'path');active.preview.setAttribute('fill',color);active.preview.setAttribute('opacity',active.stroke.opacity);svg.append(active.preview);draw();}
  function draw(){if(!active || active.erase)return;const a=active,w=a.layer.width_pt,h=a.layer.height_pt;a.stroke.outline=window.OpenDocFreehand.getStroke(a.points.map(p=>[p.x*w,p.y*h,p.pressure]),{size:a.stroke.size,simulatePressure:false,thinning:.5}).map(p=>[clamp(p[0]/w),clamp(p[1]/h)]);a.preview.setAttribute('d',path(a.stroke));}
  function move(e){if(!active || active.id!==e.pointerId)return;e.preventDefault();e.stopPropagation();const coalesced=e.getCoalescedEvents?.();for(const v of coalesced?.length?coalesced:[e])if(active.points.length<20000)active.points.push(sample(v,active.rect));draw();}
  function up(e){if(!active || active.id!==e.pointerId)return;move(e);const a=active;active=null;phase='committed';suppressClickUntil=performance.now()+350;try{a.svg.releasePointerCapture(e.pointerId);}catch{};if(a.erase){const p=a.points.at(-1),r=12/a.rect.width;a.layer.strokes=a.layer.strokes.filter(s=>!s.points.some(q=>a.points.some(p=>(q.x-p.x)**2+(q.y-p.y)**2<r*r)));}else{a.stroke.points=simplify(a.points);a.layer.strokes.push(a.stroke);}commit(a.layer);}
  function cancel(){if(active){const a=active;active=null;phase='idle';try{a.svg.releasePointerCapture(a.id);}catch{};refresh();}}
  async function convert(){if(conversion || !capable){if(!capable)status(convertButton.title);return;}const layer=layers().findLast?.(l=>l.strokes.some(s=>s.handwriting)) || layers().slice().reverse().find(l=>l.strokes.some(s=>s.handwriting));if(!layer){status('Use Escrita para escrever antes de converter.');return;}const strokes=layer.strokes.filter(s=>s.handwriting),note=editor.snapshot();conversion=true;status('Reconhecendo escrita localmente…');try{const result=await window.pywebview.api.recognize_handwriting(strokes,'pt-BR');if(result.error)throw Error(result.error);if(!result.text?.trim())throw Error('O reconhecedor não retornou texto. Sua tinta foi mantida.');if(editor.snapshot().id!==note.id)throw Error('O documento mudou. A tinta foi mantida.');
    const backdrop=document.createElement('div');backdrop.className='modal-backdrop';const box=document.createElement('section');box.className='dialog';box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');const title=document.createElement('h2');title.textContent='Revisar escrita reconhecida';const text=document.createElement('textarea');text.value=result.text;text.setAttribute('aria-label','Texto reconhecido, editável');const info=document.createElement('p');info.textContent=result.backend+(result.confidence==null?' · confiança não informada':' · confiança '+Math.round(result.confidence*100)+'%');box.append(title,info,text);
    for(const [label,insert] of [['Manter tinta',false],['Cancelar',false],['Inserir texto',true]]){const b=document.createElement('button');b.textContent=label;b.onclick=()=>{if(insert && text.value.trim() && editor.snapshot().id===note.id){const style={font_family:family.value||'Arial',font_size_pt:Math.max(1,Math.min(512,Number(fontSize.value)||12)),color:root.querySelector('[data-text-color]')?.value||color};editor.insertRecognized(text.value,style,layer.surface_index,strokes.map(s=>s.id));}backdrop.remove();refresh();};box.append(b);}backdrop.append(box);root.append(backdrop);text.focus();
   }catch(e){status(e.message);}finally{conversion=false;}}
  document.addEventListener('pointermove',move,{signal});document.addEventListener('pointerup',up,{signal});
  for(const type of ['click','auxclick'])root.addEventListener(type,e=>{if(mode!=='cursor' && performance.now()<suppressClickUntil && (e.detail>0 || e.pointerType==='pen')){e.preventDefault();e.stopPropagation();}},{capture:true,signal});
  root.addEventListener('open-doc:ink-mode',event=>setMode(event.detail),{signal});
  root.addEventListener('open-doc:ink-changed',queue,{signal});
  root.addEventListener('open-doc:layout',queue,{signal});root.addEventListener('open-doc:content',queue,{signal});root.addEventListener('open-doc:changed',queue,{signal});const observer=new MutationObserver(records=>{if(records.some(r=>Array.from(r.addedNodes).some(n=>n.nodeType===1 && (n.matches('.document-page,.fixed-surface') || n.querySelector('.document-page,.fixed-surface')))))queue();});observer.observe(root,{subtree:true,childList:true});signal.addEventListener('abort',()=>{observer.disconnect();bar.remove();},{once:true});setMode('cursor');return {refresh,setMode};
 }
 window.OpenDocInk={create,simplify,path};
})();
