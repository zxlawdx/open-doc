/* Editable pages move the original nodes. Automatic boundaries never enter the model. */
"use strict";
(() => {
  const defaults={page_width_pt:595.28,page_height_pt:841.89,margin_top_pt:56.7,margin_bottom_pt:56.7,margin_left_pt:56.7,margin_right_pt:56.7};
  function normalize(container){
    let paragraph=null,changed=false;
    for(const node of Array.from(container.childNodes)){
      if(node.nodeType===3 || (node.nodeType===1 && /^(SPAN|A|B|I|STRONG|EM|BR)$/.test(node.tagName) && !node.dataset.nodeType)){
        if(!paragraph){changed=true;paragraph=document.createElement('p');container.insertBefore(paragraph,node);}
        paragraph.appendChild(node);
      }else paragraph=null;
    }
    for(const node of [...container.children,...container.querySelectorAll('li')])if(!node.dataset.nodeId && window.OpenDocModel)node.dataset.nodeId=window.OpenDocModel.id();
    if(!container.childNodes.length){changed=true;const p=document.createElement('p');p.appendChild(document.createElement('br'));container.appendChild(p);}
    return changed;
  }
  function contents(surface,clone=false){
    const out=[];
    for(const child of Array.from(surface.children)){
      const container=child.matches('[data-page-index]')?child.querySelector('[data-page-content]'):null;
      if(container)normalize(container);
      const values=container?Array.from(container.children):[child];
      for(const node of values){const item=clone?node.cloneNode(true):node,previous=out[out.length-1];
        if(item.dataset.fragmentOf && previous?.dataset.nodeId===item.dataset.fragmentOf){
          if(item.tagName==='TABLE'){const body=previous.tBodies[0] || previous;Array.from(item.rows).forEach(row=>body.appendChild(row));}
          else while(item.firstChild)previous.appendChild(item.firstChild);
          if(!clone)item.remove();
        }else out.push(item);
      }
    }
    return out;
  }
  function logical(surface){const container=document.createElement('div');contents(surface,true).forEach(n=>container.appendChild(n));return container;}
  function create({root,model,pageMetrics,capture,restore}){
    const surface=root.querySelector('[data-rich]'),host=root.querySelector('[data-surface]');
    let mode='pages',timer=null,epoch=0,destroyed=false,dirtyPage=0,last=null,signature='',preserveScroll=false,composing=false,pendingComposition=false,runCount=0,lastRunMs=0,reflowing=false,lastError=null,abortedPasses=0,workUnits=0;
    let waitingForView=false;
    function metrics(){return {...defaults,...(typeof pageMetrics==='function'?pageMetrics():pageMetrics)};}
    function active(){const node=getSelection()?.anchorNode,element=node?.nodeType===1?node:node?.parentElement;return Number(element?.closest('[data-page-index]')?.dataset.pageIndex || 0);}
    function status(index=null){if(root.dataset.documentKind==='fixed')return;if(typeof index!=='number')index=null;const count=surface.querySelectorAll('[data-page-index]').length || 1,out=root.querySelector('[data-position]');if(out)out.textContent=mode==='continuous'?'Fluxo contínuo':'Página '+((index===null?active():index)+1)+' de '+count;}
    function paginate(){
      if(destroyed || root.dataset.documentKind==='fixed')return;if(composing){pendingComposition=true;return;}
      let work=0;
      const maxWork=Math.max(700,surface.querySelectorAll('[data-node-id]').length*36);
      const tick=()=>{workUnits++;if(++work>maxWork)
        throw Error('Reflow abortado: limite de operações excedido.');};
      const started=Date.now();runCount++;
      const m=metrics(),key=JSON.stringify(m)+mode;
      if(signature!==key)dirtyPage=0;signature=key;
      const selected=surface.contains(getSelection()?.anchorNode),saved=selected && capture?capture():null;
      // Preserve the unchanged prefix; reflow starts at the first edited page.
      const old=Array.from(surface.children),prefix=mode==='pages'?old.filter(n=>n.matches('[data-page-index]') && Number(n.dataset.pageIndex)<dirtyPage):[];
      const tail=document.createElement('div');old.filter(n=>!prefix.includes(n)).forEach(n=>tail.appendChild(n));
      const nodes=contents(tail);tail.remove();
      if(mode==='continuous'){surface.replaceChildren();nodes.forEach(n=>surface.appendChild(n));surface.style.padding=[m.margin_top_pt,m.margin_right_pt,m.margin_bottom_pt,m.margin_left_pt].map(n=>n+'pt').join(' ');surface.style.minHeight=m.page_height_pt+'pt';status();if(saved && restore)restore(saved);root.dispatchEvent(new CustomEvent("open-doc:layout"));return;}
      surface.style.padding='0';surface.style.minHeight='0';
      let section=m,index=prefix.length,page,box,capacity;const documentModel=typeof model==='function'?model():model,blockMap=new Map((documentModel?.blocks || []).map(b=>[b.id,b]));let sectionIndex=0;
      function next(){page=document.createElement('section');page.className='document-page';page.dataset.pageIndex=index++;page.dataset.widthPt=section.page_width_pt;page.dataset.heightPt=section.page_height_pt;page.style.width=section.page_width_pt+'pt';page.style.height=section.page_height_pt+'pt';page.style.padding=[section.margin_top_pt,section.margin_right_pt,section.margin_bottom_pt,section.margin_left_pt].map(n=>n+'pt').join(' ');box=document.createElement('div');box.dataset.pageContent='';box.className='page-content';page.appendChild(box);surface.appendChild(page);const style=getComputedStyle(page);capacity=page.clientHeight>0?Math.max(1,page.clientHeight-(parseFloat(style.paddingTop)||0)-(parseFloat(style.paddingBottom)||0)):(section.page_height_pt-section.margin_top_pt-section.margin_bottom_pt)*4/3;}
      function height(){return Math.max(box.scrollHeight,box.offsetHeight) || box.getBoundingClientRect().height;}
      function overflow(){return height()>capacity+1;}
      next();
      for(let i=0;i<nodes.length;i++){
        tick();
        let node=nodes[i];
        if(node.dataset.nodeType==='page_break') {box.appendChild(node);next();continue;}
        if(node.style.breakBefore==='page' && box.children.length)next();
        const marker=node.querySelector?.('[data-node-type="break"].rich-page-break');if(marker){const split=document.createRange();split.setStartAfter(marker);split.setEnd(node,node.childNodes.length);const rest=node.cloneNode(false);rest.dataset.fragmentOf=node.dataset.fragmentOf || node.dataset.nodeId;rest.appendChild(split.extractContents());if(rest.textContent || rest.querySelector('img,br'))nodes.splice(i+1,0,rest);}
        box.appendChild(node);
        if(overflow() && box.children.length>1){node.remove();next();box.appendChild(node);}
        if(overflow() && node.tagName==='TABLE' && node.rows.length>1 && !node.querySelector('[rowspan]:not([rowspan="1"])')){
          const rest=node.cloneNode(false),body=document.createElement('tbody');
          const columns=node.querySelector(':scope > colgroup');
          if(columns)rest.appendChild(columns.cloneNode(true));
          rest.appendChild(body);rest.dataset.fragmentOf=node.dataset.fragmentOf || node.dataset.nodeId;
          while(overflow() && node.rows.length>1 && (tick(),true))body.insertBefore(node.rows[node.rows.length-1],body.firstChild);
          if(body.children.length)nodes.splice(i+1,0,rest);
        }else if(overflow() && /^(P|DIV|BLOCKQUOTE|PRE)$/.test(node.tagName)
          && !node.textContent.trim()
          && Array.from(node.childNodes).filter(child=>child.nodeType===1&&child.tagName==='BR').length>1){
          // A long chain of blank Enter lines has no text nodes. Without
          // splitting BR nodes, one paragraph grows beyond the paper boundary.
          const rest=node.cloneNode(false);
          rest.dataset.fragmentOf=node.dataset.fragmentOf || node.dataset.nodeId;
          // Move chunks, not individual BRs. Re-measuring layout once per
          // empty line was quadratic and froze Qt for large Enter sequences.
          while(overflow() && (tick(),true)){
            const breaks=Array.from(node.children).filter(child=>child.tagName==='BR');
            if(breaks.length<=1)break;
            const count=Math.max(1,Math.floor(breaks.length/2));
            for(let step=0;step<count;step++)
              rest.prepend(breaks[breaks.length-1-step]);
          }
          if(rest.childNodes.length)nodes.splice(i+1,0,rest);
        }else if(overflow() && /^(P|H[1-6]|BLOCKQUOTE|PRE)$/.test(node.tagName) && node.textContent.length>1){
          // Split at the last word boundary which fits; Range retains inline formatting.
          const text=node.textContent,walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT),texts=[];let t;while((t=walker.nextNode()))texts.push(t);
          function point(offset){for(const t of texts){if(offset<=t.length)return [t,offset];offset-=t.length;}return [texts[texts.length-1],texts[texts.length-1].length];}
          const range=document.createRange();range.setStartBefore(node);let low=1,high=text.length-1,best=0;
          // getClientRects() is transformed by paper zoom; capacity and scrollHeight
          // are layout pixels. Convert the threshold to the same visual coordinate
          // space as the range, otherwise 50%/150% zoom changes page breaks.
          const pageRect=page.getBoundingClientRect(),boxRect=box.getBoundingClientRect();
          const scale=page.offsetHeight>0?pageRect.height/page.offsetHeight:1;
          const nodeStyle=getComputedStyle(node);
          const reserve=(parseFloat(nodeStyle.marginBottom)||0)+(parseFloat(nodeStyle.lineHeight)||24)/2;
          const bottomLimit=boxRect.top+Math.max(1,capacity-reserve)*scale;
          while(low<=high){const mid=(low+high)>>1,[t,pos]=point(mid);range.setEnd(t,pos);const rects=Array.from(range.getClientRects());const bottom=Math.max(...rects.filter(r=>r.height>0 && r.height<capacity).map(r=>r.bottom));if(Number.isFinite(bottom) && bottom<=bottomLimit){best=mid;low=mid+1;}else high=mid-1;}
          if(best>0 && best<text.length){const boundary=text.lastIndexOf(' ',best);if(boundary>best/2)best=boundary+1;const [t,pos]=point(best),split=document.createRange();split.setStart(t,pos);split.setEnd(node,node.childNodes.length);const rest=node.cloneNode(false);rest.dataset.fragmentOf=node.dataset.fragmentOf || node.dataset.nodeId;rest.appendChild(split.extractContents());nodes.splice(i+1,0,rest);}
        }
        // Imported inline Word page breaks retain their OOXML nodes.
        if(node.querySelector('[data-node-type="break"].rich-page-break'))next();
        const value=blockMap.get(node.dataset.nodeId);
        if(value?.section_end_id){sectionIndex++;section={...defaults,...documentModel.sections[sectionIndex]};next();}
      }
      const widths=Array.from(surface.querySelectorAll('[data-page-index]')).map(p=>parseFloat(p.style.width)*4/3).filter(Number.isFinite);
      host.style.width=(widths.length?Math.max(...widths):m.page_width_pt*4/3)+'px';
      last=page;dirtyPage=Math.max(0,index-1);status();lastRunMs=Date.now()-started;if(saved && restore)restore(saved);root.dispatchEvent(new CustomEvent('open-doc:layout'));
    }
    function safePaginate(rebuild=null){
      if(reflowing || destroyed)return;
      const keepPosition=rebuild||preserveScroll;
      const top=keepPosition?canvas?.scrollTop:null,left=keepPosition?canvas?.scrollLeft:null;
      preserveScroll=false;
      reflowing=true;
      const documentModel=typeof model==='function'?model():model;
      try{
        if(rebuild){clearTimeout(timer);epoch++;dirtyPage=0;rebuild();}
        // Imports can render while the Central still hides the editor.
        // Measuring there returns zero for the page and all its rows.
        if(mode==='pages' && (root.dataset.homeView==='true' || surface.closest('[hidden]'))){
          waitingForView=true;
          dirtyPage=0;
          return;
        }
        waitingForView=false;
        paginate();
        lastError=null;
      }catch(error){
        abortedPasses++;lastError=String(error.message||error);
        console.error('Open Doc: repaginação abortada',error);
        // The document model is the last committed state. Recover it instead
        // of leaving partly moved DOM fragments or triggering another reflow.
        try{
          mode='continuous';root.dataset.pageMode='continuous';
          if(documentModel?.blocks && window.OpenDocRichRenderer)
            window.OpenDocRichRenderer.render(documentModel,surface,()=>Promise.resolve(''));
          else{
            const holder=logical(surface);surface.replaceChildren(...Array.from(holder.childNodes));
          }
        }catch(recoveryError){console.error('Falha de recuperação de layout',recoveryError);}
        root.dispatchEvent(new CustomEvent('open-doc:layout-error',
          {detail:{message:'Paginação interrompida para preservar o documento. Visualização contínua ativada.',
            error:lastError}}));
      }finally{
        if(keepPosition&&canvas){canvas.scrollTop=top;canvas.scrollLeft=left;}
        reflowing=false;
      }
    }
    function invalidate(blockId,options={}){
      if(options.preserveScroll)preserveScroll=true;
      const node=blockId && Array.from(surface.querySelectorAll('[data-node-id]')).find(n=>n.dataset.nodeId===blockId || n.dataset.fragmentOf===blockId);
      const selected=getSelection()?.anchorNode,element=selected?.nodeType===1?selected:selected?.parentElement;
      const page=node?.closest('[data-page-index]') || element?.closest('[data-page-index]') || surface.querySelector('[data-page-index="'+active()+'"]');
      const index=options.full?0:Number.isInteger(options.pageIndex)?options.pageIndex:page?Number(page.dataset.pageIndex):dirtyPage;
      dirtyPage=Math.min(dirtyPage,index);
      clearTimeout(timer);
      const generation=++epoch;
      if(composing){pendingComposition=true;return;}
      // QtWebEngine can suspend animation frames while the native window
      // is offscreen or the compositor is backlogged. Document layout still
      // has to finish so the next edit targets the current physical pages.
      timer=setTimeout(()=>{
        if(destroyed||generation!==epoch)return;
        safePaginate();
      },options.reason==='typing'?450:120);
    }
    function fits(blockId){
      const node=Array.from(surface.querySelectorAll('[data-node-id]')).find(n=>n.dataset.nodeId===blockId || n.dataset.fragmentOf===blockId),page=node?.closest('[data-page-index]'),box=page?.querySelector('[data-page-content]');
      if(!box)return false;
      const style=getComputedStyle(page),capacity=page.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom);
      const height=Math.max(box.scrollHeight,box.offsetHeight);
      // Existing fragments may need rebalancing even after deleting text.
      return capacity>0 && height<=capacity+1 && !surface.querySelector('[data-fragment-of="'+blockId+'"]');
    }
    function setMode(value){
      clearTimeout(timer);epoch++;
      mode=value==='continuous'?'continuous':'pages';root.dataset.pageMode=mode;dirtyPage=0;safePaginate();
    }
    const change=event=>{
      const {blockId,reason,structural,full}=event.detail || {};
      if(reason==='typing' && !full && !structural && blockId && fits(blockId))return;
      invalidate(blockId,{reason,full:Boolean(full),preserveScroll:true});
    };
    const startComposition=()=>{composing=true;clearTimeout(timer);};
    const endComposition=()=>{composing=false;if(pendingComposition){pendingComposition=false;change({detail:{reason:'typing'}});}};
    surface.addEventListener('compositionstart',startComposition);surface.addEventListener('compositionend',endComposition);
    const canvas=root.querySelector('[data-canvas]');const scroll=()=>{const pages=Array.from(surface.querySelectorAll('[data-page-index]')),top=canvas.getBoundingClientRect().top;const page=pages.find(p=>p.getBoundingClientRect().bottom>top+50);if(page)status(Number(page.dataset.pageIndex));};canvas?.addEventListener('scroll',scroll);
    const viewReady=()=>{if(waitingForView)safePaginate();};
    root.addEventListener('open-doc:view-ready',viewReady);
    document.addEventListener('selectionchange',status);root.addEventListener('open-doc:text-layout-changed',change);
    function destroy(){destroyed=true;clearTimeout(timer);epoch++;canvas?.removeEventListener('scroll',scroll);surface.removeEventListener('compositionstart',startComposition);surface.removeEventListener('compositionend',endComposition);document.removeEventListener('selectionchange',status);root.removeEventListener('open-doc:text-layout-changed',change);root.removeEventListener('open-doc:view-ready',viewReady);}
    return {paginate:()=>safePaginate(),rebuild:render=>safePaginate(render),invalidate,fits,destroy,setMode,active,metrics,
      diagnostics:()=>({runCount,lastRunMs,abortedPasses,workUnits,lastError,
        pages:surface.querySelectorAll('[data-page-index]').length}),
      logical:()=>logical(surface)};
  }
  window.OpenDocPagination={create,logical,contents,normalize,defaults};
})();
