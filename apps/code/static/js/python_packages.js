"use strict";
(() => {
  function create({host,request,project,signal}) {
    const $=selector=>host.querySelector(selector);
    const body=$("[data-python-env-body]"),status=$("[data-python-env-status]");
    const submit=$('[data-python-env-command="install"]');
    const modal=document.createElement("dialog");modal.className="code-package-dialog";
    const heading=document.createElement("h2");heading.textContent="Bibliotecas do projeto";
    const close=document.createElement("button");close.type="button";close.textContent="Fechar";
    close.onclick=()=>{if(modal.close)modal.close();else modal.removeAttribute("open");};
    modal.append(heading,body,close);host.append(modal);
    const progress=document.createElement("progress");progress.hidden=true;progress.setAttribute("aria-label","Instalando bibliotecas");status.before(progress);
    const open=()=>{body.hidden=false;if(modal.showModal){if(!modal.open)modal.showModal();}else modal.setAttribute("open","");};
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
      else message(installed.length+" pacotes presentes neste projeto."+(
        installed.some(pkg=>pkg.name.toLowerCase()==="jedi")?" Autocomplete Python preparado.":" Autocomplete indisponível: ative o Jedi abaixo."));
    }
    async function inspect() {
      const id=project();
      if(!id)return message("Abra um dataset ou planilha antes de gerenciar bibliotecas.");
      const result=await request("dataset",{operation:"python-env-status",id});
      if(project()===id)showDetails(result);
    }
    async function install(remove=false, presetNames=null) {
      const id=project();
      if(!id)throw Error("Nenhum projeto ativo.");
      const names=presetNames||$("[data-python-env-names]").value.split(",").map(t=>t.trim()).filter(Boolean);
      if(!names.length)throw Error("Informe o nome de uma biblioteca Python.");
      if(names.length>5)throw Error("Instale até 5 pacotes por operação.");

      message(remove?"Removendo bibliotecas do ambiente do projeto…":"Instalando em ambiente virtual exclusivo do projeto…");
      const result=await request("dataset",{operation:remove?"python-env-remove":"python-env-install",
        id,packages:names,confirm:true});
      if(project()!==id){message("Operação concluída no projeto anterior. Atualize a lista de bibliotecas do projeto atual.");return;}
      $("[data-python-env-log]").textContent=result.log||"";
      if($("[data-python-env-agree]"))$("[data-python-env-agree]").checked=false;
      $("[data-python-env-names]").value="";
      await inspect();
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
        else if(action==="install"||action==="remove"||action==="editor")await install(action==="remove",action==="editor"?["jedi==0.19.2"]:null);
      }catch(error){message(error.message||String(error));}
      finally{working=false;submit.disabled=false;autocomplete.disabled=false;progress.hidden=true;modal.setAttribute("aria-busy","false");}
    },{signal});
    return {inspect};
  }
  window.OpenDocPythonPackages={create};
})();
