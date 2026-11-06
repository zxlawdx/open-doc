/* PDF text markup: selection geometry in PDF points, never zoom coordinates. */
"use strict";
(() => {
  function create({host,scroller,sidebar,root,signal,getModel,getPage,getZoom,update,go,status}) {
    const menu=document.createElement('div');
    menu.className='semantic-selection-menu';menu.hidden=true;
    menu.setAttribute('role','toolbar');menu.setAttribute('aria-label','Anotar texto selecionado');
    host.append(menu);
    // Page thumbnails stay at the left; the annotation workspace owns its
    // own right rail, independent of the thumbnail list.
    const rail=document.createElement('aside');
    rail.className='semantic-notes-rail';rail.setAttribute('aria-label','Anotações do PDF');
    rail.hidden=true;host.append(rail);
    const balloon=document.createElement('section');balloon.className='semantic-note-balloon';
    balloon.hidden=true;balloon.setAttribute('role','dialog');
    balloon.setAttribute('aria-label','Comentário da marcação');
    host.append(balloon);
    const color=document.createElement('input');
    color.type='color';color.value='#f5cc54';color.setAttribute('aria-label','Cor do destaque');
    let pending=null,chosen=null,panel=null,list=null,editor=null,filter='all',query='',noteMode=false,noteButton=null;
    async function copyText(value){
      if(navigator.clipboard?.writeText){try{await navigator.clipboard.writeText(value);return true;}catch{}}
      const field=document.createElement('textarea');field.value=value;field.style.position='fixed';field.style.left='-9999px';
      document.body.append(field);field.select();
      try{return document.execCommand('copy');}catch{return false;}finally{field.remove();}
    }
    function summary(){
      return annotations().slice().sort((a,b)=>a.page_index-b.page_index).map(a=>{
        const category={highlight:'Destaque',underline:'Sublinhado',strikeout:'Tachado',note:'Nota'}[a.kind]||a.kind;
        const quote=a.kind==='note'?'':'> '+a.selected_text.replace(/\r?\n/g,' ')+'\n';
        return '### Página '+(a.page_index+1)+' · '+category+'\n'+quote+(a.comment||'(sem comentário)');
      }).join('\n\n');
    }
    const actions=[['highlight','Destacar'],['underline','Sublinhar'],['strikeout','Tachar']];
    function hide(){menu.hidden=true;pending=null;}
    function noteActive(){return noteMode;}
    function setNoteMode(value){noteMode=Boolean(value);if(noteButton)noteButton.setAttribute('aria-pressed',String(noteMode));hide();return noteMode;}
    function bindNoteButton(button){noteButton=button;button.setAttribute('aria-pressed',String(noteMode));}
    function annotations(){return getModel()?.annotations || [];}
    function replace(next){update(next);refresh();}
    function makeButton(label,fn,container=menu){
      const b=document.createElement('button');b.type='button';b.textContent=label;
      b.addEventListener('click',fn,{signal});container.append(b);return b;
    }
    for(const [kind,label] of actions)makeButton(label,()=>add(kind));
    makeButton('Comentar',()=>add('highlight',true));
    makeButton('Copiar',async()=>{if(!pending)return;const text=pending.text;hide();if(!await copyText(text))status('Não foi possível copiar o trecho.');});
    menu.append(color);
    // Keep the selected range intact when clicking the contextual toolbar.
    menu.addEventListener('mousedown',event=>{if(event.target!==color)event.preventDefault();},{signal});
    function capture(){
      if(host.hidden || root.dataset.sourceKind!=='pdf')return hide();
      const sel=window.getSelection();
      if(!sel || sel.isCollapsed || !sel.rangeCount)return hide();
      const range=sel.getRangeAt(0),text=sel.toString().trim();
      if(!text || text.length>20000)return hide();
      const element=n=>n?.nodeType===1?n:n?.parentElement;
      const start=element(range.startContainer)?.closest('.fixed-surface');
      const end=element(range.endContainer)?.closest('.fixed-surface');
      if(!start || start!==end || !start.querySelector('.textLayer'))return hide();
      const index=Number(start.dataset.pageIndex),page=getPage(index);
      if(!page)return hide();
      const viewport=page.getViewport({scale:4/3*getZoom()});
      const pageBox=start.getBoundingClientRect(),quads=[];
      for(const rect of range.getClientRects()){
        if(rect.width<=1 || rect.height<=1)continue;
        // A selection may have small rounding overflows; clip only within one page.
        const x1=Math.max(0,rect.left-pageBox.left),x2=Math.min(viewport.width,rect.right-pageBox.left);
        const y1=Math.max(0,rect.top-pageBox.top),y2=Math.min(viewport.height,rect.bottom-pageBox.top);
        if(x2<=x1 || y2<=y1)continue;
        const tl=viewport.convertToPdfPoint(x1,y1),tr=viewport.convertToPdfPoint(x2,y1);
        const bl=viewport.convertToPdfPoint(x1,y2),br=viewport.convertToPdfPoint(x2,y2);
        quads.push([...tl,...tr,...bl,...br]);
        if(quads.length>2048)return hide();
      }
      if(!quads.length)return hide();
      pending={index,text,quads};
      const bounds=range.getBoundingClientRect();
      menu.hidden=false;
      const width=menu.offsetWidth || 350;
      menu.style.left=Math.max(8,Math.min(window.innerWidth-width-8,bounds.left))+'px';
      menu.style.top=Math.max(8,Math.min(window.innerHeight-48,bounds.bottom+8))+'px';
    }
    function add(kind,comment=false){
      if(!pending)return;
      const a={
        id:window.OpenDocModel.id(),kind,page_index:pending.index,
        selected_text:pending.text,quad_points:pending.quads,
        color:color.value,opacity:0.35,comment:''
      };
      replace([...annotations(),a]);hide();window.getSelection()?.removeAllRanges();
      select(a.id,comment);status('Trecho anotado; alterações em salvamento automático.');
    }
    function placeNote(event){
      if(!noteMode || host.hidden || root.dataset.sourceKind!=='pdf' || event.button!==0)return;
      if(event.target.closest('.semantic-note-pin,.semantic-selection-menu,.semantic-annotation-panel'))return;
      const surface=event.target.closest('.fixed-surface');
      if(!surface)return;
      const index=Number(surface.dataset.pageIndex),page=getPage(index);
      if(!page)return status('Aguarde o carregamento da página para adicionar uma nota.');
      const box=surface.getBoundingClientRect();
      if(!box.width||!box.height)return;
      const viewport=page.getViewport({scale:4/3*getZoom()});
      const x=Math.max(0,Math.min(viewport.width-18,(event.clientX-box.left)*viewport.width/box.width));
      const y=Math.max(0,Math.min(viewport.height-18,(event.clientY-box.top)*viewport.height/box.height));
      const tl=viewport.convertToPdfPoint(x,y),tr=viewport.convertToPdfPoint(x+18,y),
            bl=viewport.convertToPdfPoint(x,y+18),br=viewport.convertToPdfPoint(x+18,y+18);
      const annotation={id:window.OpenDocModel.id(),kind:'note',page_index:index,
        selected_text:'Nota na página '+(index+1),quad_points:[[...tl,...tr,...bl,...br]],
        color:color.value,opacity:1,comment:''};
      replace([...annotations(),annotation]);
      setNoteMode(false);window.getSelection()?.removeAllRanges();
      select(annotation.id,true);status('Nota adicionada: escreva o comentário no painel lateral.');
    }
    function renderPage(index,page){
      const surface=scroller.querySelector('.fixed-surface[data-page-index="'+index+'"]');
      if(!surface || !page)return;
      surface.querySelector('.semantic-overlays')?.remove();
      const values=annotations().filter(a=>a.page_index===index);
      if(!values.length)return;
      const overlay=document.createElement('div');overlay.className='semantic-overlays';
      const viewport=page.getViewport({scale:4/3*getZoom()});
      for(const a of values)for(const quad of a.quad_points){
        const points=[];
        for(let i=0;i<8;i+=2)points.push(viewport.convertToViewportPoint(quad[i],quad[i+1]));
        const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
        const left=Math.max(0,Math.min(...xs)),top=Math.max(0,Math.min(...ys));
        const right=Math.min(viewport.width,Math.max(...xs)),bottom=Math.min(viewport.height,Math.max(...ys));
        if(right<=left || bottom<=top)continue;
        const fragment=document.createElement('div');fragment.className='semantic-fragment '+a.kind;
        fragment.dataset.annotationId=a.id;
        Object.assign(fragment.style,{left:left+'px',top:top+'px',width:(right-left)+'px',
          height:(bottom-top)+'px',backgroundColor:a.kind==='highlight'?a.color:'transparent',
          opacity:String(a.opacity??0.35),borderColor:a.color});
        if(a.kind==='note'){
          const pin=document.createElement('button');pin.type='button';pin.className='semantic-note-pin';
          pin.style.left=left+'px';pin.style.top=top+'px';
          pin.style.backgroundColor=a.color;pin.textContent='✎';
          pin.setAttribute('aria-label','Abrir nota na página '+(index+1));
          pin.title=a.comment||'Nota sem comentário';
          pin.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();setNoteMode(false);select(a.id,true);},{signal});
          overlay.append(pin);continue;
        }
        overlay.append(fragment);
      }
      surface.append(overlay);
    }
    function refresh(){
      for(const node of scroller.querySelectorAll('.fixed-surface')){
        const i=Number(node.dataset.pageIndex),page=getPage(i);
        if(page)renderPage(i,page);
        else node.querySelector('.semantic-overlays')?.remove();
      }
      redrawList();
    }
    function reset(){
      hide();hideBalloon();chosen=null;
      panel?.remove();panel=document.createElement('section');panel.className='semantic-annotation-panel';
      const heading=document.createElement('h3');heading.textContent='Anotações e comentários';
      const tools=document.createElement('div');tools.className='semantic-annotation-tools';
      const search=document.createElement('input');search.type='search';search.placeholder='Buscar nas anotações…';search.setAttribute('aria-label','Buscar em anotações e comentários');search.value=query;
      search.addEventListener('input',()=>{query=search.value.toLocaleLowerCase('pt-BR').trim();redrawList();},{signal});
      const select=document.createElement('select');select.setAttribute('aria-label','Filtrar tipo de anotação');
      for(const [value,label] of [['all','Todos os tipos'],['highlight','Destaques'],['note','Notas'],['underline','Sublinhados'],['strikeout','Tachados']]){
        const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option);
      }
      select.value=filter;select.addEventListener('change',()=>{filter=select.value;redrawList();},{signal});
      const report=makeButton('Copiar resumo',async()=>{
        const value=summary();if(!value)return status('Nenhuma anotação para resumir.');
        status(await copyText(value)?'Resumo das anotações copiado em Markdown.':'Não foi possível copiar o resumo.');
      },tools);
      report.className='semantic-summary';
      tools.prepend(search,select);
      list=document.createElement('div');list.className='semantic-annotation-list';
      editor=document.createElement('div');editor.className='semantic-annotation-editor';
      panel.append(heading,tools,list,editor);
      rail.hidden=root.dataset.sourceKind!=='pdf';
      panel.hidden=rail.hidden;rail.replaceChildren(panel);redrawList();
    }
    function redrawList(){
      if(!list)return;
      list.replaceChildren();
      const matches=annotations().slice().sort((a,b)=>a.page_index-b.page_index).filter(a=>
        (filter==='all'||a.kind===filter) &&
        (!query||(a.selected_text+' '+a.comment).toLocaleLowerCase('pt-BR').includes(query)));
      for(const a of matches){
        const title=a.kind==='note'?'Nota':{highlight:'Destaque',underline:'Sublinhado',strikeout:'Tachado'}[a.kind];
        const button=makeButton('P. '+(a.page_index+1)+' · '+title+' · '+(a.kind==='note'?(a.comment||'Sem comentário'):a.selected_text).slice(0,76),()=>select(a.id,false,true),list);
        button.title=a.comment || a.selected_text;
        button.style.borderLeft='4px solid '+a.color;
        button.setAttribute('aria-pressed',String(chosen===a.id));
      }
      if(!matches.length){const empty=document.createElement('p');empty.className='semantic-empty';empty.textContent='Nenhuma anotação corresponde ao filtro.';list.append(empty);}
      if(chosen && !annotations().some(a=>a.id===chosen)){chosen=null;editor?.replaceChildren();}
    }
    function select(id,focus=false,navigate=false){
      chosen=id;redrawList();
      const a=annotations().find(item=>item.id===id);
      if(!a || !editor)return;
      editor.replaceChildren();
      const quote=document.createElement('p');quote.textContent=a.kind==='note'?'Nota adesiva na página '+(a.page_index+1):'“'+a.selected_text.slice(0,300)+'”';
      const label=document.createElement('label');label.textContent='Comentário';
      const textarea=document.createElement('textarea');
      textarea.value=a.comment || '';textarea.rows=4;textarea.maxLength=20000;
      textarea.setAttribute('aria-label','Comentário da anotação');
      // One logical comment edit = one undo history entry on blur/change.
      textarea.addEventListener('change',()=>{
        const next=annotations().map(item=>item.id===id?{...item,comment:textarea.value}:item);
        replace(next);
      },{signal});
      label.append(textarea);
      const palette=document.createElement('input');palette.type='color';palette.value=a.color;
      palette.setAttribute('aria-label','Alterar cor da anotação');
      palette.addEventListener('change',()=>{
        replace(annotations().map(item=>item.id===id?{...item,color:palette.value}:item));
      },{signal});
      const opacityLabel=document.createElement('label');opacityLabel.textContent='Intensidade do destaque';
      const opacity=document.createElement('input');opacity.type='range';opacity.min='0.1';opacity.max='1';opacity.step='0.05';opacity.value=String(a.opacity??.35);
      opacity.setAttribute('aria-label','Intensidade da anotação');
      opacity.addEventListener('change',()=>{
        replace(annotations().map(item=>item.id===id?{...item,opacity:Number(opacity.value)}:item));
      },{signal});opacityLabel.append(opacity);
      makeButton('Excluir anotação',()=>{replace(annotations().filter(item=>item.id!==id));},editor);
      if(a.kind!=='note')editor.prepend(opacityLabel);
      editor.prepend(quote,label,palette);
      // Editing the comment must never send the reader back to page one.
      // Navigation happens only when clicking a result in the annotation rail.
      if(navigate && a.page_index>=0)go(a.page_index);
      if(focus)textarea.focus();
    }
    function hideBalloon(){balloon.hidden=true;balloon.replaceChildren();}
    function annotationAt(event){
      const surface=event.target.closest('.fixed-surface');
      if(!surface)return null;
      const pageIndex=Number(surface.dataset.pageIndex),page=getPage(pageIndex);
      if(!page)return null;
      const box=surface.getBoundingClientRect();
      const viewport=page.getViewport({scale:4/3*getZoom()});
      const x=(event.clientX-box.left)*viewport.width/box.width;
      const y=(event.clientY-box.top)*viewport.height/box.height;
      return annotations().find(a=>a.page_index===pageIndex&&a.quad_points.some(quad=>{
        const points=[];
        for(let i=0;i<8;i+=2)points.push(viewport.convertToViewportPoint(quad[i],quad[i+1]));
        return x>=Math.min(...points.map(p=>p[0]))-2&&x<=Math.max(...points.map(p=>p[0]))+2
          &&y>=Math.min(...points.map(p=>p[1]))-2&&y<=Math.max(...points.map(p=>p[1]))+2;
      }))||null;
    }
    function showBalloon(a,event){
      hideBalloon();balloon.hidden=false;chosen=a.id;redrawList();
      const heading=document.createElement('strong');
      heading.textContent='Anotação · página '+(a.page_index+1);
      const quote=document.createElement('p');quote.className='semantic-balloon-quote';
      quote.textContent=a.kind==='note'?'Nota adesiva':a.selected_text.slice(0,250);
      const label=document.createElement('label');label.textContent='Seu comentário';
      const input=document.createElement('textarea');
      input.value=a.comment||'';input.maxLength=20000;input.rows=3;
      input.setAttribute('aria-label','Editar comentário da marcação');
      input.addEventListener('change',()=>replace(annotations().map(value=>
        value.id===a.id?{...value,comment:input.value}:value)),{signal});
      label.append(input);
      const actions=document.createElement('div');actions.className='semantic-balloon-actions';
      makeButton('Ver no painel',()=>{hideBalloon();select(a.id,true,false);},actions);
      makeButton('Fechar',hideBalloon,actions);
      balloon.append(heading,quote,label,actions);
      const width=Math.max(260,Math.min(350,window.innerWidth-24));
      balloon.style.width=width+'px';
      const left=Math.max(12,Math.min(window.innerWidth-width-12,event.clientX+12));
      const top=Math.max(12,Math.min(window.innerHeight-240,event.clientY+12));
      balloon.style.left=left+'px';balloon.style.top=top+'px';
      input.focus();
    }
    // Ctrl+click consults saved PDF quads. Highlight overlays remain
    // pointer-events:none so ordinary text selection continues working.
    scroller.addEventListener('click',event=>{
      if(!event.ctrlKey&&!event.metaKey)return;
      const selected=annotationAt(event);
      if(!selected)return;
      event.preventDefault();event.stopPropagation();
      showBalloon(selected,event);
    },{signal});
    scroller.addEventListener('pointerup',placeNote,{signal});
    scroller.addEventListener('mouseup',()=>setTimeout(capture,0),{signal});
    scroller.addEventListener('keyup',event=>{if(event.key==='Shift' || event.key.startsWith('Arrow'))setTimeout(capture,0);},{signal});
    scroller.addEventListener('scroll',()=>{hide();hideBalloon();},{signal});
    root.addEventListener('keydown',event=>{if(event.key==='Escape'){hide();hideBalloon();}},{signal});
    return {renderPage,refresh,reset,hide,setNoteMode,noteActive,bindNoteButton,summary};
  }
  window.OpenDocSemanticAnnotations={create};
})();
