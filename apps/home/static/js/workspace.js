"use strict";
(() => {
  function create({root,request,signal,snapshot,activate,status}) {
    let revision=0,tabs=[],modules={},chain=Promise.resolve(),timer,ready=false,active;
    const bar=document.createElement('nav');bar.className='workspace-global-tabs';bar.setAttribute('aria-label','Arquivos abertos');
    root.querySelector('.menubar')?.after(bar);
    function render(){
      bar.replaceChildren();
      for(const tab of tabs){
        const entry=document.createElement('span'),button=document.createElement('button'),close=document.createElement('button');
        button.type=close.type='button';button.textContent=tab.title;button.setAttribute('aria-current',String(tab.id===active));
        button.onclick=()=>activate(tab).catch(error=>status(error.message));
        close.textContent='×';close.setAttribute('aria-label','Fechar '+tab.title);
        close.onclick=async()=>{
          if(root.dataset.globalDirty==='true'){status('Salve as alterações antes de fechar a aba.');return;}
          const previous=tabs,wasActive=tab.id===active;tabs=tabs.filter(item=>item!==tab);
          if(wasActive){
            const next=tabs[tabs.length-1];active=next?.id;
            try{await activate(next||null);}catch(error){tabs=previous;active=tab.id;render();status(error.message);return;}
          }
          render();persist();
        };
        entry.append(button,close);bar.append(entry);
      }
    }
    function persist(){
      if(!ready)return;
      const state={tabs:[...tabs],settings:{active},modules:{...modules}};
      chain=chain.then(async()=>{
        try{const saved=await request('workspace',{operation:'save',expected_revision:revision,...state});revision=saved.revision;}
        catch(error){
          if(error.conflict){const latest=await request('workspace',{operation:'load'});revision=latest.revision;tabs=[...new Map([...(latest.tabs||[]),...tabs].map(tab=>[tab.app+':'+tab.id,tab])).values()];render();}
          status('Sessão não salva: '+error.message);
        }
      });
    }
    function capture(){
      if(!ready)return;
      const tab=snapshot();if(!tab?.id)return;
      active=tab.id;
      const found=tabs.findIndex(item=>item.app===tab.app&&item.id===tab.id);
      if(found<0)tabs.push(tab);else tabs[found]=tab;
      if(tabs.length>50)tabs.shift();render();clearTimeout(timer);timer=setTimeout(persist,300);
    }
    root.addEventListener('open-doc:workspace',capture,{signal});
    const observer=new MutationObserver(capture);observer.observe(root,{attributes:true,attributeFilter:['data-home-view','data-workbook-view','data-dataset-view','data-document-kind']});
    root.addEventListener('open-doc:content',()=>{clearTimeout(timer);timer=setTimeout(capture,1000);},{signal});
    const loaded=request('workspace',{operation:'load'}).then(async state=>{
      revision=state.revision||0;tabs=state.tabs||[];modules=state.modules||{};active=state.settings?.active;ready=true;render();
      const previous=tabs.find(tab=>tab.id===active);if(previous)await activate(previous);else capture();
    }).catch(error=>{ready=true;status('Não foi possível recuperar a sessão: '+error.message);});
    signal.addEventListener('abort',()=>{observer.disconnect();clearTimeout(timer);bar.remove();},{once:true});
    return {loaded,capture};
  }
  window.OpenDocWorkspace={create};
})();
