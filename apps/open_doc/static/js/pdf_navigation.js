/* PDF navigation keeps source order and hierarchy, independently of page rendering. */
'use strict';
(() => {
  function create({host, sidebar, controls, signal, navigate, thumbnail, status}) {
    let state = null, preferred = 'outline', width = 280;
    const toggle = document.createElement('button');
    toggle.type = 'button';toggle.textContent = 'Navegação';toggle.hidden = true;
    toggle.dataset.pdfSidebarToggle = '';
    toggle.setAttribute('aria-label', 'Mostrar ou ocultar navegação do PDF');
    controls.prepend(toggle);
    function open(value) {
      if (!state) return;
      host.dataset.pdfSidebar = value ? 'open' : 'closed';sidebar.hidden = !value;
      toggle.setAttribute('aria-expanded', String(value));
      if (value && state.mode === 'thumbnails') revealThumbnail(state);
    }
    toggle.addEventListener('click', () => open(host.dataset.pdfSidebar !== 'open'), {signal});
    function reset() {
      state?.abort.abort();state?.observer?.disconnect();state = null;
      toggle.hidden = true;sidebar.hidden = false;sidebar.replaceChildren();
      delete host.dataset.pdfNavigation;delete host.dataset.pdfSidebar;
    }
    function setWidth(value) {
      width = Math.max(180, Math.min(value, 480, window.innerWidth * .45));
      host.style.setProperty('--pdf-sidebar-width', width + 'px');
      state?.separator?.setAttribute('aria-valuenow', String(Math.round(width)));
    }
    window.addEventListener('resize', () => {if (state) setWidth(width);}, {signal});
    function setDocument({outline, surfaces, resolve}) {
      reset();
      const abort = new AbortController(), listen = {signal: abort.signal};
      const doc = state = {abort, surfaces, resolve, records: [], current: -1, selected: null,
        resolved: [], indexReady:false, pageDestinations: new Map(), thumbnails: [], visible: new Set(), queued: new Set(),
        pending: [], running: 0, cache: [], mode: null};
      host.dataset.pdfNavigation = 'true';toggle.hidden = false;setWidth(width);open(true);
      const heading = document.createElement('div');heading.className = 'pdf-navigation-heading';
      const title = document.createElement('strong');title.textContent = 'Estrutura do documento';
      const close = document.createElement('button');close.textContent = '×';close.type = 'button';
      close.setAttribute('aria-label', 'Recolher navegação do PDF');
      close.addEventListener('click', () => {open(false);toggle.focus();}, listen);heading.append(title, close);
      const tabs = document.createElement('div');tabs.className = 'pdf-navigation-tabs';tabs.setAttribute('role', 'tablist');
      tabs.setAttribute('aria-label', 'Navegação do PDF');
      doc.panes = {};doc.tabs = {};
      for (const [name, label] of [['outline','Índice'], ['thumbnails','Miniaturas'], ['results','Busca']]) {
        const tab = document.createElement('button');tab.type = 'button';tab.textContent = label;tab.dataset.pdfNavTab = name;
        tab.id = 'pdf-nav-tab-' + name;tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-controls', 'pdf-nav-panel-' + name);
        const pane = document.createElement('div');pane.className = 'pdf-navigation-panel';pane.dataset.pdfNavPanel = name;
        pane.id = 'pdf-nav-panel-' + name;pane.setAttribute('role', 'tabpanel');pane.setAttribute('aria-labelledby', tab.id);
        tab.hidden = name === 'results';tab.addEventListener('click', () => select(doc, name, true), listen);
        tab.addEventListener('keydown', event => {
          if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
          event.preventDefault();const list = Object.values(doc.tabs).filter(item => !item.hidden && !item.disabled);
          const at = list.indexOf(tab), next = event.key === 'Home' ? 0 : event.key === 'End' ? list.length-1 :
            (at + (event.key === 'ArrowRight' ? 1 : list.length-1)) % list.length;
          select(doc, list[next].dataset.pdfNavTab, true);list[next].focus();
        }, listen);
        doc.tabs[name] = tab;doc.panes[name] = pane;tabs.append(tab);
      }
      const actions = document.createElement('div');actions.className = 'pdf-outline-actions';doc.actions = actions;
      const expand = document.createElement('button');doc.expandButton=expand;expand.textContent = 'Expandir tudo';expand.type = 'button';expand.dataset.pdfOutlineExpand = '';
      expand.addEventListener('click', () => {
        const value = doc.records.some(record => record.children.length && !record.expanded);
        for (const record of doc.records) if (record.children.length) expandRecord(record, value);
        updateExpandLabel(doc);updateCurrent(doc);
      }, listen);
      const locate = document.createElement('button');locate.textContent = 'Seção atual';locate.type = 'button';locate.dataset.pdfOutlineCurrent = '';
      locate.disabled=true;locate.addEventListener('click', () => {
        const record = currentRecord(doc);if (!record) return;
        for (let parent = record.parent; parent; parent = parent.parent) expandRecord(parent, true);
        highlight(doc, record);updateExpandLabel(doc);record.node.scrollIntoView?.({block:'nearest'});record.node.focus();
      }, listen);actions.append(expand, locate);
      const tree = document.createElement('ul');tree.className = 'pdf-outline-tree';tree.setAttribute('role', 'tree');
      tree.setAttribute('aria-label', 'Estrutura do documento');tree.dataset.outlineState='resolving';doc.tree = tree;doc.panes.outline.append(tree);
      // Iterative DFS avoids stack overflow and append preserves the file's order.
      const pending = [...(outline || [])].reverse().map(item => ({item, parent:null, group:tree, depth:1}));
      while (pending.length) {
        const {item, parent, group, depth} = pending.pop();
        const node = document.createElement('li');node.setAttribute('role', 'treeitem');node.tabIndex = doc.records.length ? -1 : 0;
        const label = String(item.title || '').replace(/\0/g, '').trim() || 'Seção sem título';
        node.setAttribute('aria-label', label);node.setAttribute('aria-level', String(depth));
        const row = document.createElement('div');row.className = 'pdf-outline-row';
        const disclosure = document.createElement('button');disclosure.type = 'button';disclosure.tabIndex = -1;
        disclosure.className = 'pdf-outline-disclosure';disclosure.setAttribute('aria-label', 'Expandir ' + label);
        const link = document.createElement('button');link.type = 'button';link.tabIndex = -1;link.className = 'pdf-outline-title';
        link.textContent = label;link.title = label;if (item.bold) link.style.fontWeight = '700';if (item.italic) link.style.fontStyle = 'italic';
        row.append(disclosure, link);node.append(row);group.append(node);
        const record = {order:doc.records.length, item, node, row, disclosure, parent, depth, children:[], expanded:false, page:null, label};
        doc.records.push(record);if (parent) parent.children.push(record);
        if (item.items?.length) {
          const children = document.createElement('ul');children.setAttribute('role','group');node.append(children);record.group = children;
          expandRecord(record, item.count > 0);
          for (let i=item.items.length-1;i>=0;i--) pending.push({item:item.items[i], parent:record, group:children, depth:depth+1});
        } else {disclosure.disabled = true;disclosure.setAttribute('aria-hidden','true');}
        disclosure.addEventListener('click', event => {event.stopPropagation();expandRecord(record, !record.expanded);updateExpandLabel(doc);updateCurrent(doc);focus(doc, record);}, listen);
        const activate = () => {focus(doc, record);highlight(doc, record);Promise.resolve(navigate(item.dest)).catch(error => status(error.message));};
        link.addEventListener('click', activate, listen);
        node.addEventListener('keydown', event => {
          if (event.target !== node) return;
          const visible = doc.records.filter(isVisible), at = visible.indexOf(record);
          if (['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End','Enter',' '].includes(event.key)) {
            event.preventDefault();event.stopPropagation();
            if (event.key === 'ArrowDown') focus(doc, visible[Math.min(visible.length-1,at+1)]);
            else if (event.key === 'ArrowUp') focus(doc, visible[Math.max(0,at-1)]);
            else if (event.key === 'Home') focus(doc, visible[0]);
            else if (event.key === 'End') focus(doc, visible[visible.length-1]);
            else if (event.key === 'ArrowRight') {if (record.group && !record.expanded) expandRecord(record,true);else if (record.children[0]) focus(doc,record.children[0]);}
            else if (event.key === 'ArrowLeft') {if (record.expanded) expandRecord(record,false);else if (record.parent) focus(doc,record.parent);}
            else activate();
            if(event.key==='ArrowLeft'||event.key==='ArrowRight'){updateExpandLabel(doc);updateCurrent(doc);}
          }
        }, listen);
      }
      if (!doc.records.length) {
        const empty = document.createElement('p');empty.className = 'pdf-navigation-empty';empty.textContent = 'Este PDF não contém um índice de capítulos.';
        doc.panes.outline.append(empty);doc.tabs.outline.disabled = true;actions.hidden = true;
      }
      doc.separator = document.createElement('div');doc.separator.className = 'pdf-navigation-resizer';
      doc.separator.tabIndex = 0;doc.separator.setAttribute('role','separator');doc.separator.setAttribute('aria-orientation','vertical');
      doc.separator.setAttribute('aria-label','Largura da navegação do PDF');doc.separator.setAttribute('aria-valuemin','180');doc.separator.setAttribute('aria-valuemax','480');
      let drag = null;
      doc.separator.addEventListener('pointerdown', event => {event.preventDefault();drag={id:event.pointerId,x:event.clientX,width};try{doc.separator.setPointerCapture?.(event.pointerId);}catch{}}, listen);
      doc.separator.addEventListener('pointermove', event => {if (drag?.id === event.pointerId) setWidth(drag.width + event.clientX-drag.x);}, listen);
      const stop = () => {drag=null;};doc.separator.addEventListener('pointerup',stop,listen);doc.separator.addEventListener('pointercancel',stop,listen);
      doc.separator.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();setWidth(width+(event.key==='ArrowRight'?1:-1)*(event.shiftKey?40:10));},listen);
      updateExpandLabel(doc);sidebar.append(heading, tabs, actions, doc.panes.outline, doc.panes.thumbnails, doc.panes.results, doc.separator);
      setWidth(width);select(doc, doc.records.length ? preferred : 'thumbnails');
      // Resolve navigation metadata in bounded batches, never render PDF pages here.
      (async () => {
        let cursor=0;
        const worker=async()=>{while(state===doc && cursor<doc.records.length){const record=doc.records[cursor++];
          try {record.page=await resolve(record.item.dest);} catch {continue;}
          if(state!==doc)return;
          if(Number.isInteger(record.page)&&record.page>=0&&record.page<surfaces.length){
            const old=doc.pageDestinations.get(record.page);
            if(!old||record.depth>old.depth||(record.depth===old.depth&&record.order<old.order))doc.pageDestinations.set(record.page,record);
          }
        }};
        await Promise.all(Array.from({length:Math.min(4,doc.records.length)},worker));
        if(state!==doc)return;doc.resolved=[...doc.pageDestinations.keys()].sort((a,b)=>a-b);doc.indexReady=true;tree.dataset.outlineState='ready';tree.dataset.outlineResolved=String(doc.resolved.length);locate.disabled=!doc.resolved.length;updateCurrent(doc);
      })().catch(error=>{if(state===doc)status(error.message);});
    }
    function expandRecord(record, expanded) {
      if (!record.group) return;
      record.expanded = expanded;record.group.hidden = !expanded;
      record.node.setAttribute('aria-expanded',String(expanded));
      record.disclosure.setAttribute('aria-label',(expanded?'Recolher ':'Expandir ')+record.label);
      record.disclosure.textContent = expanded ? '▾' : '▸';
    }
    function updateExpandLabel(doc){const branches=doc.records.filter(record=>record.group);doc.expandButton.disabled=!branches.length;doc.expandButton.textContent=branches.some(record=>!record.expanded)?'Expandir tudo':'Recolher tudo';}
    function isVisible(record) {for(let parent=record.parent;parent;parent=parent.parent)if(!parent.expanded)return false;return true;}
    function focus(doc, record) {if(!record)return;for(const item of doc.records)item.node.tabIndex=item===record?0:-1;record.node.focus();}
    function highlight(doc, record) {
      if(doc.selected===record)return;
      doc.selected?.node.removeAttribute('aria-current');doc.selected=record;
      record?.node.setAttribute('aria-current','location');
    }
    function currentRecord(doc) {
      let lo=0,hi=doc.resolved.length;
      while(lo<hi){const mid=(lo+hi)>>>1;if(doc.resolved[mid]<=doc.current)lo=mid+1;else hi=mid;}
      return lo ? doc.pageDestinations.get(doc.resolved[lo-1]) : null;
    }
    function updateCurrent(doc) {
      if(!doc.indexReady)return;
      let record=currentRecord(doc);
      while(record&&!isVisible(record))record=record.parent;
      highlight(doc,record);
    }
    function select(doc, mode, user=false) {
      if(state!==doc)return;
      if(mode==='outline'&&!doc.records.length)mode='thumbnails';
      doc.mode=mode;doc.actions.hidden=mode!=='outline'||!doc.records.length;if(user&&mode!=='results')preferred=mode;
      for(const name of Object.keys(doc.tabs)) {
        doc.tabs[name].setAttribute('aria-selected',String(name===mode));doc.tabs[name].tabIndex=name===mode?0:-1;
        doc.panes[name].hidden=name!==mode;
      }
      if(mode==='thumbnails'){makeThumbnails(doc);revealThumbnail(doc);}
    }
    function makeThumbnails(doc) {
      if(doc.thumbnails.length)return;
      const fragment=document.createDocumentFragment();
      for(const surface of doc.surfaces){const index=surface.index,button=document.createElement('button');
        button.type='button';button.className='pdf-thumbnail';button.dataset.thumbnailIndex=String(index);
        button.setAttribute('aria-label','Página '+(index+1));
        const blank=document.createElement('span');blank.className='pdf-thumbnail-placeholder';blank.style.height=(110*surface.height_pt/surface.width_pt)+'px';
        const label=document.createElement('span');label.textContent='Página '+(index+1);button.append(blank,label);
        button.addEventListener('click',()=>{Promise.resolve(navigate([index])).catch(error=>status(error.message));},{signal:doc.abort.signal});
        doc.thumbnails.push(button);fragment.append(button);
      }
      doc.panes.thumbnails.append(fragment);
      if(typeof IntersectionObserver==='function') {
        doc.observer=new IntersectionObserver(entries=>{for(const entry of entries){const index=Number(entry.target.dataset.thumbnailIndex);
          if(entry.isIntersecting){doc.visible.add(index);if(!entry.target.querySelector('canvas')&&!doc.queued.has(index)){doc.queued.add(index);doc.pending.push(index);}}
          else doc.visible.delete(index);
        }pump(doc);},{root:doc.panes.thumbnails,rootMargin:'150px'});
        doc.thumbnails.forEach(button=>doc.observer.observe(button));
      }
    }
    function pump(doc) {
      while(state===doc && doc.mode==='thumbnails' && host.dataset.pdfSidebar==='open' && doc.running<2 && doc.pending.length){
        const index=doc.pending.shift();if(!doc.visible.has(index)){doc.queued.delete(index);continue;}
        doc.running++;
        Promise.resolve(thumbnail(index,doc.thumbnails[index])).then(()=>{
          if(state!==doc)return;
          if(doc.thumbnails[index].querySelector('canvas'))doc.cache.push(index);
          while(doc.cache.length>24){const old=doc.cache.findIndex(value=>!doc.visible.has(value));if(old<0)break;const [evicted]=doc.cache.splice(old,1);doc.thumbnails[evicted].querySelector('canvas')?.remove();}
        }).catch(()=>{}).finally(()=>{doc.running--;doc.queued.delete(index);if(state===doc)pump(doc);});
      }
    }
    function revealThumbnail(doc) {
      const index=Math.max(0,doc.current),button=doc.thumbnails[index];
      for(const item of doc.thumbnails){if(item===button)item.setAttribute('aria-current','page');else item.removeAttribute('aria-current');}
      button?.scrollIntoView?.({block:'nearest'});pump(doc);
    }
    function setPage(index) {
      const doc=state;if(!doc||index===doc.current)return;doc.current=index;updateCurrent(doc);
      if(doc.mode==='thumbnails' && host.dataset.pdfSidebar==='open')revealThumbnail(doc);
    }
    function showResults() {if(!state)return sidebar;state.tabs.results.hidden=false;open(true);select(state,'results');return state.panes.results;}
    signal.addEventListener('abort',reset,{once:true});
    return {setDocument,reset,setPage,showResults,get results(){return state?.panes.results;}};
  }
  window.OpenDocPdfNavigation={create};
})();
