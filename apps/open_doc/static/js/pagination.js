/* Editable pages move the original nodes. Automatic boundaries never enter the model. */
"use strict";
(() => {
  const defaults={page_width_pt:595.28,page_height_pt:841.89,margin_top_pt:56.7,margin_bottom_pt:56.7,margin_left_pt:56.7,margin_right_pt:56.7};
  function contents(surface,clone=false){
    const out=[];
    for(const child of Array.from(surface.children)){
      const values=child.matches('[data-page-index]')?Array.from(child.querySelector('[data-page-content]').children):[child];
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
    let mode='pages',timer=null,frame=null,destroyed=false,dirtyPage=0,last=null,signature='',preservedScroll=null;
    function metrics(){return {...defaults,...(typeof pageMetrics==='function'?pageMetrics():pageMetrics)};}
    function active(){const node=getSelection()?.anchorNode,element=node?.nodeType===1?node:node?.parentElement;return Number(element?.closest('[data-page-index]')?.dataset.pageIndex || 0);}
    function status(index=null){if(root.dataset.documentKind==='fixed')return;if(typeof index!=='number')index=null;const count=surface.querySelectorAll('[data-page-index]').length || 1,out=root.querySelector('[data-position]');if(out)out.textContent=mode==='continuous'?'Fluxo contínuo':'Página '+((index===null?active():index)+1)+' de '+count;}
    function paginate(){
      if(destroyed || root.dataset.documentKind==='fixed')return;const m=metrics(),key=JSON.stringify(m)+mode;
      if(signature!==key)dirtyPage=0;signature=key;
      const selected=surface.contains(getSelection()?.anchorNode),saved=selected && capture?capture():null;
      // Preserve the unchanged prefix; reflow starts at the first edited page.
      const old=Array.from(surface.children),prefix=mode==='pages'?old.filter(n=>n.matches('[data-page-index]') && Number(n.dataset.pageIndex)<dirtyPage):[];
      const tail=document.createElement('div');old.filter(n=>!prefix.includes(n)).forEach(n=>tail.appendChild(n));
      const nodes=contents(tail);tail.remove();
      if(mode==='continuous'){surface.replaceChildren();nodes.forEach(n=>surface.appendChild(n));surface.style.padding=[m.margin_top_pt,m.margin_right_pt,m.margin_bottom_pt,m.margin_left_pt].map(n=>n+'pt').join(' ');surface.style.minHeight=m.page_height_pt+'pt';status();if(saved && restore)restore(saved);root.dispatchEvent(new CustomEvent("open-doc:layout"));return;}
      surface.style.padding='0';surface.style.minHeight='0';
      let section=m,index=prefix.length,page,box,capacity;const documentModel=typeof model==='function'?model():model,blockMap=new Map((documentModel?.blocks || []).map(b=>[b.id,b]));let sectionIndex=0;
      function next(){page=document.createElement('section');page.className='document-page';page.dataset.pageIndex=index++;page.dataset.widthPt=section.page_width_pt;page.dataset.heightPt=section.page_height_pt;page.style.width=section.page_width_pt+'pt';page.style.height=section.page_height_pt+'pt';page.style.padding=[section.margin_top_pt,section.margin_right_pt,section.margin_bottom_pt,section.margin_left_pt].map(n=>n+'pt').join(' ');box=document.createElement('div');box.dataset.pageContent='';box.className='page-content';page.appendChild(box);surface.appendChild(page);capacity=(section.page_height_pt-section.margin_top_pt-section.margin_bottom_pt)*4/3;}
      function height(){return box.getBoundingClientRect().height || box.scrollHeight;}
      function overflow(){return height()>capacity+1;}
      next();
      for(let i=0;i<nodes.length;i++){
        let node=nodes[i];
        if(node.dataset.nodeType==='page_break') {box.appendChild(node);next();continue;}
        if(node.style.breakBefore==='page' && box.children.length)next();
        const marker=node.querySelector?.('[data-node-type="break"].rich-page-break');if(marker){const split=document.createRange();split.setStartAfter(marker);split.setEnd(node,node.childNodes.length);const rest=node.cloneNode(false);rest.dataset.fragmentOf=node.dataset.fragmentOf || node.dataset.nodeId;rest.appendChild(split.extractContents());if(rest.textContent || rest.querySelector('img,br'))nodes.splice(i+1,0,rest);}
        box.appendChild(node);
        if(overflow() && box.children.length>1){node.remove();next();box.appendChild(node);}
        if(overflow() && node.tagName==='TABLE' && node.rows.length>1 && !node.querySelector('[rowspan]:not([rowspan="1"])')){
          const rest=node.cloneNode(false),body=document.createElement('tbody');rest.appendChild(body);rest.dataset.fragmentOf=node.dataset.fragmentOf || node.dataset.nodeId;
          while(overflow() && node.rows.length>1)body.insertBefore(node.rows[node.rows.length-1],body.firstChild);
          if(body.children.length)nodes.splice(i+1,0,rest);
        }else if(overflow() && /^(P|H[1-6]|BLOCKQUOTE|PRE)$/.test(node.tagName) && node.textContent.length>1){
          // Split at the last word boundary which fits; Range retains inline formatting.
          const text=node.textContent,walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT),texts=[];let t;while((t=walker.nextNode()))texts.push(t);
          function point(offset){for(const t of texts){if(offset<=t.length)return [t,offset];offset-=t.length;}return [texts[texts.length-1],texts[texts.length-1].length];}
          const range=document.createRange();range.setStartBefore(node);let low=1,high=text.length-1,best=0;
          while(low<=high){const mid=(low+high)>>1,[t,pos]=point(mid);range.setEnd(t,pos);const rects=Array.from(range.getClientRects());const bottom=Math.max(...rects.filter(r=>r.height>0 && r.height<capacity).map(r=>r.bottom));if(bottom<=box.getBoundingClientRect().top+capacity-(parseFloat(getComputedStyle(node).marginBottom)||0)-(parseFloat(getComputedStyle(node).lineHeight)||24)/2){best=mid;low=mid+1;}else high=mid-1;}
          if(best>0 && best<text.length){const boundary=text.lastIndexOf(' ',best);if(boundary>best/2)best=boundary+1;const [t,pos]=point(best),split=document.createRange();split.setStart(t,pos);split.setEnd(node,node.childNodes.length);const rest=node.cloneNode(false);rest.dataset.fragmentOf=node.dataset.fragmentOf || node.dataset.nodeId;rest.appendChild(split.extractContents());nodes.splice(i+1,0,rest);}
        }
        // Imported inline Word page breaks retain their OOXML nodes.
        if(node.querySelector('[data-node-type="break"].rich-page-break'))next();
        const value=blockMap.get(node.dataset.nodeId);
        if(value?.section_end_id){sectionIndex++;section={...defaults,...documentModel.sections[sectionIndex]};next();}
      }
      host.style.width=Math.max(...Array.from(surface.querySelectorAll('[data-page-index]')).map(p=>parseFloat(p.style.width)*4/3))+'px';last=page;dirtyPage=Math.max(0,index-1);status();if(saved && restore)restore(saved);root.dispatchEvent(new CustomEvent('open-doc:layout'));if(preservedScroll){const canvas=root.querySelector('[data-canvas]');canvas.scrollTop=preservedScroll.top;canvas.scrollLeft=preservedScroll.left;preservedScroll=null;}
    }
    function invalidate(blockId,options={}){if(options.preserveScroll){const canvas=root.querySelector('[data-canvas]');preservedScroll={top:canvas.scrollTop,left:canvas.scrollLeft};}const node=blockId && Array.from(surface.querySelectorAll('[data-node-id]')).find(n=>n.dataset.nodeId===blockId),page=node?.closest('[data-page-index]');dirtyPage=Math.min(dirtyPage,Number(page?.dataset.pageIndex || 0));clearTimeout(timer);timer=setTimeout(()=>{frame=(window.requestAnimationFrame || window.setTimeout)(paginate);},100);}
    function setMode(value){mode=value==='continuous'?'continuous':'pages';root.dataset.pageMode=mode;dirtyPage=0;paginate();}
    const change=()=>{const n=getSelection()?.anchorNode,e=n?.nodeType===1?n:n?.parentElement;invalidate(e?.closest('[data-node-id]')?.dataset.nodeId);};
    const canvas=root.querySelector('[data-canvas]');const scroll=()=>{const pages=Array.from(surface.querySelectorAll('[data-page-index]')),top=canvas.getBoundingClientRect().top;const page=pages.find(p=>p.getBoundingClientRect().bottom>top+50);if(page)status(Number(page.dataset.pageIndex));};canvas?.addEventListener('scroll',scroll);
    surface.addEventListener('input',change);document.addEventListener('selectionchange',status);root.addEventListener('open-doc:text-layout-changed',change);
    function destroy(){destroyed=true;clearTimeout(timer);(window.cancelAnimationFrame || window.clearTimeout)(frame);canvas?.removeEventListener('scroll',scroll);surface.removeEventListener('input',change);document.removeEventListener('selectionchange',status);root.removeEventListener('open-doc:text-layout-changed',change);}
    return {paginate,invalidate,destroy,setMode,active,metrics,logical:()=>logical(surface)};
  }
  window.OpenDocPagination={create,logical,defaults};
})();
