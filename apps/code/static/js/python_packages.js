"use strict";
(() => {
  function create({host,request,project,signal}) {
    const $=selector=>host.querySelector(selector);
    const body=$("[data-python-env-body]"),status=$("[data-python-env-status]");
    const submit=$('[data-python-env-command="install"]');
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
      else message(installed.length+" pacotes presentes neste projeto.");
    }
    async function inspect() {
      const id=project();
      if(!id)return message("Abra um dataset ou planilha antes de gerenciar bibliotecas.");
      showDetails(await request("dataset",{operation:"python-env-status",id}));
    }
    async function install(remove=false) {
      const id=project();
      if(!id)throw Error("Nenhum projeto ativo.");
      const names=$("[data-python-env-names]").value.split(",").map(t=>t.trim()).filter(Boolean);
      if(!names.length)throw Error("Informe o nome de uma biblioteca Python.");
      if(names.length>5)throw Error("Instale até 5 pacotes por operação.");
      if(!$("[data-python-env-agree]").checked)
        throw Error("A instalação só pode acontecer após sua autorização explícita.");
      message("Instalando em ambiente virtual exclusivo do projeto…");
      const result=await request("dataset",{operation:remove?"python-env-remove":"python-env-install",
        id,packages:names,confirm:true});
      $("[data-python-env-log]").textContent=result.log||"";
      $("[data-python-env-agree]").checked=false;
      $("[data-python-env-names]").value="";
      await inspect();
      message("Bibliotecas instaladas no ambiente do projeto: "+(result.installed||result.removed).join(", ")+".");
    }
    const preset=document.createElement("button");preset.type="button";preset.textContent="Preparar notebook (Pandas, Arrow, Jupyter e SQL)";
    preset.addEventListener("click",()=>{body.hidden=false;$("[data-python-env-names]").value="pandas, pyarrow, ipykernel, duckdb";message("Confira os pacotes, autorize a instalação e clique em Instalar.");},{signal});
    const remove=document.createElement("button");remove.type="button";remove.textContent="Remover bibliotecas informadas";remove.dataset.pythonEnvCommand="remove";
    host.prepend(preset,remove);
    host.addEventListener("click",async event=>{
      const action=event.target.closest("[data-python-env-command]")?.dataset.pythonEnvCommand;
      if(!action||working)return;
      if(action==="toggle") {
        body.hidden=!body.hidden;
        if(body.hidden)return;
      }
      working=true;submit.disabled=true;
      try {
        if(action==="toggle")await inspect();
        else if(action==="install"||action==="remove")await install(action==="remove");
      }catch(error){message(error.message||String(error));}
      finally{working=false;submit.disabled=false;}
    },{signal});
    return {inspect};
  }
  window.OpenDocPythonPackages={create};
})();
