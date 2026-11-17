"use strict";
(() => {
  function create({host,request,project,signal}) {
    const $=selector=>host.querySelector(selector);
    const body=$("[data-python-env-body]"),status=$("[data-python-env-status]");
    const submit=$('[data-python-env-command="install"]');
    const modal=document.createElement("dialog");modal.className="code-package-dialog";
    const heading=document.createElement("h2");heading.textContent="Ambientes Python · Bibliotecas do projeto";
    const close=document.createElement("button");close.type="button";close.textContent="Fechar";
    close.onclick=()=>{if(modal.close)modal.close();else modal.removeAttribute("open");};
    modal.append(heading,body,close);host.append(modal);
    const progress=document.createElement("progress");progress.hidden=true;progress.setAttribute("aria-label","Instalando bibliotecas");status.before(progress);
    const open=()=>{body.hidden=false;if(modal.showModal){if(!modal.open)modal.showModal();}else modal.setAttribute("open","");};
    const interpreter=document.createElement("input");interpreter.placeholder="Caminho absoluto do Python (opcional)";
    interpreter.setAttribute("aria-label","Interpretador Python");
    const select=document.createElement("button");select.type="button";select.textContent="Selecionar Python";
    const existing=document.createElement("input");existing.type="checkbox";existing.setAttribute("aria-label","Usar como ambiente virtual existente");
    const existingLabel=document.createElement("label");existingLabel.append(existing,document.createTextNode(" Usar venv existente"));
    const internal=document.createElement("button");internal.type="button";internal.textContent="Python interno do Open Doc (padrão)";
    internal.onclick=async()=>{try{await request("dataset",{operation:"python-env-select",id:project(),internal:true});await inspect();message("Python interno selecionado; ambiente anterior preservado.");}catch(error){message(error.message);}};
    select.onclick=async()=>{try{await request("dataset",{operation:"python-env-select",id:project(),python:interpreter.value,existing:existing.checked});message("Interpretador selecionado: "+interpreter.value);}catch(error){message(error.message);}};
    const discover=document.createElement("button");discover.type="button";discover.textContent="Detectar interpretadores";
    discover.onclick=async()=>{try{const result=await request("dataset",{operation:"python-env-discover",id:project()});message(result.interpreters.map(p=>p.path+" · "+p.version+" · "+p.architecture+" bits · venv: "+p.venv+" · pip: "+p.pip).join("\n")||"Nenhum Python encontrado.");}catch(error){message(error.message);}};
    const copy=document.createElement("button");copy.type="button";copy.textContent="Copiar diagnóstico";
    copy.onclick=()=>navigator.clipboard.writeText(status.textContent);
    const cancel=document.createElement("button");cancel.type="button";cancel.textContent="Cancelar instalação";
    cancel.onclick=async()=>{try{const result=await request("dataset",{operation:"python-env-cancel",id:project()});message(result.cancelled?"Instalação cancelada; confira as dependências antes de executar.":"Nenhuma instalação em andamento.");}catch(error){message(error.message);}};
    const requirements=document.createElement("textarea");requirements.setAttribute("aria-label","requirements.txt");requirements.placeholder="requirements.txt: cole nomes e versões, um por linha";
    const requirementFile=document.createElement("input");requirementFile.type="file";requirementFile.accept=".txt";requirementFile.setAttribute("aria-label","Importar arquivo requirements.txt");
    requirementFile.onchange=async()=>{const file=requirementFile.files[0];if(file){if(file.size>64000)return message("requirements.txt deve ter até 64 KB.");requirements.value=await file.text();}};
    const importRequirements=document.createElement("button");importRequirements.type="button";importRequirements.textContent="Instalar requirements.txt";
    importRequirements.onclick=async()=>{try{message("Instalando requirements.txt…");const result=await request("dataset",{operation:"python-env-import",id:project(),text:requirements.value,confirm:true});$("[data-python-env-log]").textContent=result.log;await inspect();window.dispatchEvent(new CustomEvent("open-doc:python-env-updated",{detail:{project:project()}}));}catch(error){message(error.message);}};
    const exportRequirements=document.createElement("button");exportRequirements.type="button";exportRequirements.textContent="Exportar requirements.txt";
    exportRequirements.onclick=async()=>{try{const result=await request("dataset",{operation:"python-env-export",id:project()});requirements.value=result.text;const link=document.createElement("a");link.href=URL.createObjectURL(new Blob([result.text],{type:"text/plain"}));link.download="requirements.txt";link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);}catch(error){message(error.message);}};
    const check=document.createElement("button");check.type="button";check.textContent="Verificar conflitos";
    check.onclick=async()=>{try{const result=await request("dataset",{operation:"python-env-check",id:project()});message((result.compatible?"Dependências compatíveis.\n":"Conflitos encontrados.\n")+result.log);}catch(error){message(error.message);}};
    const update=document.createElement("button");update.type="button";update.textContent="Atualizar bibliotecas informadas";update.dataset.pythonEnvCommand="upgrade";
    body.prepend(internal,interpreter,existingLabel,select,discover,copy,cancel,requirements,requirementFile,importRequirements,exportRequirements,check,update);
    let working=false;
    const message=text=>{status.textContent=text;};
    function showDetails(result) {
      const list=$("[data-python-env-installed]");
      const installed=result.packages||[];
      list.replaceChildren(...installed.map(pkg=>{
        const row=document.createElement("li");
        row.textContent=pkg.name+" "+pkg.version;return row;
      }));
      if(!result.initialized)message("Nenhum venv criado. O ambiente só será criado após autorização.");
      else message(result.python+" · Kernel: "+(result.kernel?.alive?"ativo":"parado")+" · "+installed.length+" pacotes presentes neste projeto."+(
        installed.some(pkg=>pkg.name.toLowerCase()==="jedi")?" Autocomplete Python preparado.":" Autocomplete indisponível: ative o Jedi abaixo."));
    }
    async function inspect() {
      const id=project();
      if(!id)return message("Abra um dataset ou planilha antes de gerenciar bibliotecas.");
      const result=await request("dataset",{operation:"python-env-status",id});
      if(project()===id)showDetails(result);
    }
    async function install(remove=false, presetNames=null, upgrade=false) {
      const id=project();
      if(!id)throw Error("Nenhum projeto ativo.");
      const names=presetNames||$("[data-python-env-names]").value.split(",").map(t=>t.trim()).filter(Boolean);
      if(!names.length)throw Error("Informe o nome de uma biblioteca Python.");
      if(names.length>5)throw Error("Instale até 5 pacotes por operação.");
      if(presetNames){
        // Do not silently switch a system-Python notebook to an empty venv.
        const environment=await request("dataset",{operation:"python-env-status",id});
        if(project()!==id)return message("Projeto alterado; reabra as bibliotecas.");
        if(!environment.initialized)throw Error("Este projeto usa o Python do sistema. Primeiro configure o ambiente do projeto com suas bibliotecas; só depois ative o Jedi.");
      }

      message(remove?"Removendo bibliotecas do ambiente do projeto…":"Instalando em ambiente virtual exclusivo do projeto…");
      const logTimer=setInterval(async()=>{try{const result=await request("dataset",{operation:"python-env-job",id});if(project()===id&&result.log)$("[data-python-env-log]").textContent=result.log;}catch{}},1500);
      let result;
      try{result=await request("dataset",{operation:remove?"python-env-remove":"python-env-install",
        id,packages:names,confirm:true,upgrade});}finally{clearInterval(logTimer);}
      if(project()!==id){message("Operação concluída no projeto anterior. Atualize a lista de bibliotecas do projeto atual.");return;}
      $("[data-python-env-log]").textContent=result.log||"";
      if($("[data-python-env-agree]"))$("[data-python-env-agree]").checked=false;
      $("[data-python-env-names]").value="";
      await inspect();
      // Tell currently open CodeMirror editors to refresh after site-packages
      // changes. The project id prevents unrelated notebooks from refreshing.
      window.dispatchEvent(new CustomEvent("open-doc:python-env-updated",{detail:{project:id}}));
      message("Bibliotecas "+(remove?"removidas":"instaladas")+" no ambiente do projeto: "+(result.installed||result.removed).join(", ")+".");
    }
    const autocomplete=document.createElement("button");autocomplete.type="button";autocomplete.textContent="Ativar autocomplete Python (Jedi)";
    autocomplete.dataset.pythonEnvCommand="editor";
    const preset=document.createElement("button");preset.type="button";preset.textContent="Preparar notebook (Pandas, Arrow, Jupyter e SQL)";
    preset.addEventListener("click",()=>{open();$("[data-python-env-names]").value="pandas, pyarrow, ipykernel, duckdb";message("Confira os pacotes, autorize a instalação e clique em Instalar.");},{signal});
    const remove=document.createElement("button");remove.type="button";remove.textContent="Remover bibliotecas informadas";remove.dataset.pythonEnvCommand="remove";
    body.prepend(autocomplete,preset,remove);
    host.addEventListener("click",async event=>{
      const action=event.target.closest("[data-python-env-command]")?.dataset.pythonEnvCommand;
      if(!action||working)return;
      if(action==="toggle") {
        open();
      }
      working=true;submit.disabled=true;autocomplete.disabled=true;progress.hidden=false;modal.setAttribute("aria-busy","true");
      try {
        if(action==="toggle")await inspect();
        else if(action==="install"||action==="remove"||action==="editor"||action==="upgrade")await install(action==="remove",action==="editor"?["jedi==0.19.2"]:null,action==="upgrade");
      }catch(error){message(error.message||String(error));}
      finally{working=false;submit.disabled=false;autocomplete.disabled=false;progress.hidden=true;modal.setAttribute("aria-busy","false");}
    },{signal});
    return {inspect};
  }
  window.OpenDocPythonPackages={create};
})();
