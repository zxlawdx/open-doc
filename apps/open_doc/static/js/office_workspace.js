/* Shared commands, discovery and academic tools; editors retain their models. */
'use strict';
(()=>{
 function create({root,editor,signal,formats=[],profiles=[],action,status,dialog}){
  const header=document.createElement('div');header.className='office-command-strip';header.setAttribute('role','toolbar');header.setAttribute('aria-label','Comandos do documento');
  const search=document.createElement('button');search.type='button';search.textContent='Comandos';search.title='Pesquisar comandos (Ctrl+Shift+P)';search.dataset.officeSearch='';
  const compatibility=document.createElement('button');compatibility.type='button';compatibility.textContent='Compatibilidade';compatibility.dataset.officeCompatibility='';
  header.append(search,compatibility);root.querySelector('.menubar')?.append(header);
  const tabs=document.createElement('div');tabs.className='office-document-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Ferramentas de texto');
  const panel=document.createElement('div');panel.className='office-document-panel';panel.setAttribute('role','tabpanel');
  const groups={
   'Início':[['Negrito','[data-command=bold]'],['Itálico','[data-command=italic]'],['Título 1','[data-command=h1]'],['Título 2','[data-command=heading]'],['Justificar',()=>editor.style('paragraph',{alignment:'justify'})]],
   'Inserir':[['Imagem','[data-action=image-insert]'],['Tabela','[data-action=table-insert]'],['Equação','[data-action=equation-insert]'],['Link','[data-action=link]']],
   'Layout':[['Configurar página','[data-action=page-setup]'],['Com páginas','[data-action=pages]'],['Fluxo contínuo','[data-action=continuous]']],
   'Referências':profiles.map(profile=>[profile.title,()=>{editor.applyProfile(profile);status(profile.note);}]),
   'Revisão':[['Localizar','[data-action=find]'],['Substituir','[data-action=replace]'],['Histórico','[data-action=version-history]']],
   'Exibir':[['Aparência','[data-action=theme]'],['Compatibilidade',()=>showCompatibility()]]
  };
  function invoke(target){if(typeof target==='function')return target();const control=root.querySelector('.menubar '+target)||root.querySelector('.toolbar '+target)||root.querySelector(target);if(!control||control.disabled)throw Error('Comando indisponível neste editor.');control.click();}
  const run=target=>{try{const result=invoke(target);result?.catch?.(error=>status(error.message));}catch(error){status(error.message);}};
  let selectedName='Início';const nativeToolbar=root.querySelector('.toolbar');
  function choose(name){selectedName=name;if(nativeToolbar)nativeToolbar.hidden=name!=='Início';panel.hidden=name==='Início';for(const tab of tabs.children){const active=tab.textContent===name;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;}panel.replaceChildren();
   for(const [label,target]of groups[name]){const button=document.createElement('button');button.type='button';button.textContent=label;
    if(typeof target==='string'&&!root.querySelector('.menubar '+target)&&!root.querySelector('.toolbar '+target))button.disabled=true;
    button.addEventListener('pointerdown',()=>editor.capture(),{signal});button.addEventListener('click',()=>run(target),{signal});panel.append(button);}
  }
  for(const name of Object.keys(groups)){const tab=document.createElement('button');tab.type='button';tab.setAttribute('role','tab');tab.textContent=name;tab.addEventListener('click',()=>choose(name),{signal});tab.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const list=[...tabs.children],at=list.indexOf(tab),next=event.key==='Home'?0:event.key==='End'?list.length-1:(at+(event.key==='ArrowRight'?1:list.length-1))%list.length;choose(list[next].textContent);list[next].focus();},{signal});tabs.append(tab);}
  nativeToolbar?.before(tabs);nativeToolbar?.after(panel);choose('Início');
  function sync(){const rich=root.dataset.documentKind!=='fixed'&&root.dataset.homeView!=='true'&&root.dataset.workbookView!=='true'&&root.dataset.datasetView!=='true';tabs.hidden=!rich;panel.hidden=!rich||selectedName==='Início';if(nativeToolbar)nativeToolbar.hidden=!rich||selectedName!=='Início';
   const kind=root.dataset.sourceKind;for(const format of ['odt','odp'])for(const button of root.querySelectorAll('[data-export='+format+']')){const entry=formats.find(item=>item.extension===format);button.hidden=format==='odt'?!rich:kind!=='pptx';button.disabled=!entry?.available;button.title=entry?.available?'Conversão OpenDocument: revise a fidelidade.':'Requer LibreOffice instalado.';}
  }
  const observer=new MutationObserver(sync);observer.observe(root,{attributes:true,attributeFilter:['data-document-kind','data-source-kind','data-home-view','data-workbook-view','data-dataset-view']});sync();
  function showCompatibility(){
   const pending=dialog('Compatibilidade dos formatos','O suporte depende do recurso, não apenas da extensão. O original é preservado.');
   const table=document.createElement('table');table.className='office-compatibility-table';const head=table.createTHead().insertRow();for(const title of ['Formato','Edição','Disponibilidade','Limites']){const cell=document.createElement('th');cell.textContent=title;head.append(cell);}
   for(const item of formats){const row=table.createTBody().insertRow();for(const value of [item.extension.toUpperCase(),({editable:'Editável',annotatable:'Anotações e edição limitada',tabular:'Valores tabulares',converted:'Conversão editável'})[item.level]||item.level,item.available?'Disponível':('Requer '+item.dependency),item.limitations.join(' ')]){const cell=row.insertCell();cell.textContent=value;}}
   root.querySelector('[data-dialog-body]').append(table);return pending;
  }
  let palette=null,returning=null;
  function close(){palette?.remove();palette=null;if(returning?.isConnected)returning.focus();}
  function commands(){const results=[],seen=new Set(),book=root.dataset.workbookView==='true',data=root.dataset.datasetView==='true';
   const scopes=book?['[data-workbook]']:data?['[data-dataset]']:root.dataset.documentKind==='fixed'?['.fixed-document','.menubar']:['.menubar','.toolbar'];
   for(const scope of scopes)for(const button of root.querySelectorAll(scope+' button')){const label=(button.getAttribute('aria-label')||button.textContent).replace(/\s+/g,' ').trim();if(!label||label.length>100||button.disabled||button.hidden||seen.has(label))continue;seen.add(label);results.push({label,run:()=>button.click()});}
   if(!book&&!data&&root.dataset.documentKind!=='fixed')for(const profile of profiles)results.push({label:profile.title,run:()=>{editor.applyProfile(profile);status(profile.note);}});
   results.push({label:'Compatibilidade dos formatos',run:showCompatibility});return results;
  }
  function open(){close();editor.capture();returning=document.activeElement;palette=document.createElement('div');palette.className='office-command-backdrop';const box=document.createElement('section');box.className='office-command-palette';box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');box.setAttribute('aria-label','Pesquisar comandos');
   const input=document.createElement('input');input.placeholder='Digite uma ação, ferramenta ou formato…';input.setAttribute('aria-label','Nome do comando');const list=document.createElement('div');list.setAttribute('role','listbox');const all=commands();
   let shown=[],selected=0;function paint(){shown=all.filter(item=>item.label.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().includes(input.value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()));selected=Math.min(selected,Math.max(0,shown.length-1));list.replaceChildren();shown.slice(0,60).forEach((item,i)=>{const button=document.createElement('button');button.type='button';button.textContent=item.label;button.setAttribute('role','option');button.setAttribute('aria-selected',String(i===selected));button.onclick=()=>{close();run(item.run);};list.append(button);});if(!shown.length){const empty=document.createElement('p');empty.textContent='Nenhum comando encontrado.';list.append(empty);}}
   input.addEventListener('input',()=>{selected=0;paint();},{signal});input.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close();}if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();selected=(selected+(event.key==='ArrowDown'?1:shown.length-1))%Math.max(1,shown.length);selected=Math.min(59,selected);paint();list.querySelector('[aria-selected=true]')?.scrollIntoView?.({block:'nearest'});}if(event.key==='Enter'&&shown[selected]){event.preventDefault();const item=shown[selected];close();run(item.run);}},{signal});
   const dismiss=document.createElement('button');dismiss.textContent='Fechar';dismiss.onclick=close;box.append(input,list,dismiss);box.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close();}if(event.key==='Tab'){const controls=[...box.querySelectorAll('input,button:not(:disabled)')],at=controls.indexOf(document.activeElement);if(event.shiftKey&&at===0){event.preventDefault();controls.at(-1).focus();}else if(!event.shiftKey&&at===controls.length-1){event.preventDefault();controls[0].focus();}}},{signal});palette.append(box);palette.addEventListener('click',event=>{if(event.target===palette)close();},{signal});root.append(palette);paint();input.focus();
  }
  search.addEventListener('click',open,{signal});compatibility.addEventListener('click',showCompatibility,{signal});window.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.shiftKey&&event.key.toLowerCase()==='p'){event.preventDefault();open();}},{signal});
  signal.addEventListener('abort',()=>{observer.disconnect();close();header.remove();tabs.remove();panel.remove();},{once:true});
  return {open,commands,sync,showCompatibility};
 }
 window.OpenDocOfficeWorkspace={create};
})();
