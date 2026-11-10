"use strict";
(() => {
  const LABELS={python:"Python",sql:"SQL",text:"Texto"};
  const LIMIT=20;

  function create({panel,signal,project,request,execute,onLayout}) {
    const shell=panel.parentElement;
    const workbooks=new Map();
    let key, cells=[], columns=[], busy=false, stop=false;
    const icon=name=>window.OpenDocGridWorkspace.icon(panel,name);
    function element(tag,className,text) {
      const node=document.createElement(tag);
      if(className)node.className=className;
      if(text)node.textContent=text;
      return node;
    }
    function button(label,glyph,action) {
      const node=element("button");
      node.type="button";node.title=label;
      node.append(icon(glyph),document.createTextNode(label));
      node.addEventListener("click",action);
      return node;
    }
    const notebook=element("section","code-notebook");
    notebook.setAttribute("aria-label","Caderno de código");
    const toolbar=element("div","code-notebook-tools");
    const list=element("div","code-notebook-cells");
    const notice=element("p","code-notebook-status");
    notice.setAttribute("role","status");
    const addButtons=Object.entries(LABELS).map(([language,label])=>
      button(label, "file-plus",()=>add(language)));
    const runAll=button("Executar todas","play",()=>run(cells));
    const stopAll=button("Parar sequência","close",()=>{
      stop=true;notice.textContent="A sequência será interrompida após a célula atual.";
    });
    const split=button("Tela dividida","sidebar",()=>layout(false));
    const full=button("Tela inteira","code",()=>layout(true));
    const picker=element("input");
    picker.type="file";picker.accept=".ipynb";picker.hidden=true;
    const openFile=button("Importar .ipynb","file-plus",()=>picker.click());
    const saveFile=button("Exportar .ipynb","download",exportNotebook);
    picker.addEventListener("change",importNotebook,{signal});
    toolbar.append(...addButtons,runAll,stopAll,openFile,saveFile,split,full,picker);
    notebook.append(toolbar,notice,list);
    panel.querySelector(".workbook-sidebar-title").after(notebook);
    function layout(expanded) {
      shell.classList.toggle("code-notebook-full",expanded);
      split.setAttribute("aria-pressed",String(!expanded));
      full.setAttribute("aria-pressed",String(expanded));
      onLayout();
    }
    panel.addEventListener("keydown",event=>{
      if(event.key==="Escape"&&shell.classList.contains("code-notebook-full")){
        event.preventDefault();layout(false);full.focus();
      }
    },{signal});
    function refresh() {
      runAll.disabled=busy||!cells.some(cell=>cell.language!=="text");
      stopAll.hidden=!busy;
      openFile.disabled=busy||!key||cells.length>=LIMIT;
      saveFile.disabled=busy||!cells.length;
      addButtons.forEach(button=>button.disabled=busy||!key||cells.length>=LIMIT);
      for(const [index,cell] of cells.entries()){
        cell.title.textContent=(index+1)+" · "+LABELS[cell.language];
        cell.controls.forEach(control=>control.disabled=busy);
        cell.up.disabled=busy||index===0;
        cell.down.disabled=busy||index===cells.length-1;
        cell.editor?.lock(busy);
        if(cell.language==="text")cell.field.readOnly=busy;
      }
    }
    function add(language,source="",at=cells.length) {
      if(busy||!key||cells.length>=LIMIT)return;
      const controller=new AbortController();
      const node=element("article","code-notebook-cell");
      node.dataset.codeCell=language;
      const heading=element("div","code-notebook-cell-tools");
      const title=element("strong");
      const field=element("textarea");
      field.maxLength=language==="python"?24000:12000;
      field.value=source;
      field.setAttribute("aria-label","Célula "+LABELS[language]);
      const signature=element("output");
      const output=element("div","code-notebook-output");
      output.hidden=true;output.setAttribute("aria-live","polite");
      const cell={language,node,title,field,output,controller};
      function move(offset) {
        const index=cells.indexOf(cell);
        const target=cells[index+offset];
        if(!target||busy)return;
        cells.splice(index,1);cells.splice(index+offset,0,cell);
        if(offset<0)target.node.before(node);else target.node.after(node);
        refresh();
      }
      const value=()=>cell.editor?.value()??field.value;
      const up=button("Subir","arrow-up",()=>move(-1));
      const down=button("Descer","arrow-down",()=>move(1));
      const duplicate=button("Duplicar","file-plus",()=>add(language,value(),cells.indexOf(cell)+1));
      const remove=button("Excluir","close",()=>{
        if(busy)return;
        cells.splice(cells.indexOf(cell),1);controller.abort();node.remove();refresh();
      });
      const clear=button("Limpar saída","close",()=>{output.replaceChildren();output.hidden=true;});
      cell.up=up;cell.down=down;
      cell.controls=[up,down,duplicate,remove];
      heading.append(title);
      if(language!=="text"){
        const play=button("Executar","play",()=>run([cell]));
        heading.append(play,clear);cell.controls.push(play,clear);
      }
      heading.append(up,down,duplicate,remove);
      node.append(heading,field,signature,output);
      list.insertBefore(node,cells[at]?.node??null);
      cells.splice(at,0,cell);
      if(language!=="text"){
        cell.editor=window.OpenDocCodeEditor.create({field,language,request,signature,
          signal:controller.signal,project,run:()=>run([cell]),runNext:async()=>{
            if(await run([cell])){
              const next=cells[cells.indexOf(cell)+1];
              if(next)(next.editor||next.field).focus();else add(language);
            }
          }});
        if(language==="sql")cell.editor.columns(columns);
      }
      refresh();(cell.editor||field).focus();
    }
    async function exportNotebook() {
      const payload={nbformat:4,nbformat_minor:4,metadata:{kernelspec:{
        name:"python3",display_name:"Python 3",language:"python"
      }},cells:cells.map(cell=>{
        const source=cell.editor?.value()??cell.field.value;
        const metadata={open_doc_language:cell.language};
        if(cell.language==="text")return {cell_type:"markdown",source,metadata};
        if(cell.language==="sql")return {cell_type:"raw",source,metadata};
        return {cell_type:"code",source,metadata,execution_count:null,outputs:[]};
      })};
      try{
        const result=await window.pywebview.api.export_code_notebook(payload);
        if(result.error)throw Error(result.error);
        if(!result.cancelled)notice.textContent="Caderno exportado: "+result.name;
      }catch(error){notice.textContent=error.message;}
    }
    async function importNotebook() {
      const file=picker.files[0],active=key;
      picker.value="";
      if(!file||busy||!active)return;
      try{
        if(file.size>2_000_000)throw Error("O caderno excede o limite de 2 MB.");
        const payload=JSON.parse(await file.text());
        if(payload?.nbformat!==4||!Array.isArray(payload.cells))throw Error("Formato .ipynb inválido.");
        if(active!==key||busy)return;
        const imported=payload.cells.map(cell=>{
          if(!cell||!["code","markdown","raw"].includes(cell.cell_type))throw Error("Tipo de célula inválido.");
          const language=cell.metadata?.open_doc_language==="sql"?"sql":cell.cell_type==="code"?"python":"text";
          const source=Array.isArray(cell.source)?cell.source.join(""):cell.source;
          if(typeof source!=="string"||source.length>(language==="python"?24000:12000))
            throw Error("Uma célula excede o limite de texto.");
          return [language,source];
        });
        if(cells.length+imported.length>LIMIT)throw Error("Limite de "+LIMIT+" células por caderno.");
        for(const [language,source] of imported)add(language,source);
        notice.textContent=imported.length+" células importadas. Execute apenas código que você conhece.";
      }catch(error){notice.textContent=error.message;}
    }
    function display(cell,result) {
      const output=cell.output;
      output.replaceChildren();output.hidden=false;
      if(result.columns){
        const table=element("table");
        const headers=table.createTHead().insertRow();
        for(const column of result.columns)headers.append(element("th",null,String(column)));
        const body=table.createTBody();
        for(const values of result.rows){
          const row=body.insertRow();
          for(const value of values)row.insertCell().textContent=value??"NULL";
        }
        output.append(element("p",null,result.rows.length+" linhas"+(result.limited?" · prévia limitada":"")),table);
      }else output.append(element("pre",null,result.output||result.message||"Sem saída."));
    }
    async function run(queue) {
      if(busy||!key||key!==project())return false;
      const active=key;
      busy=true;stop=false;refresh();
      try{
        for(const cell of queue){
          if(stop||active!==project())return false;
          if(cell.language==="text"||!cell.editor.value().trim())continue;
          cell.editor.remember();
          notice.textContent="Executando "+cell.title.textContent+"…";
          try{
            const result=await execute(cell.language,cell.editor.value());
            if(result.error)throw Error(result.error);
            if(active!==project())return false;
            display(cell,result);
            if(result.cancelled||result.stopped||result.returncode){
              notice.textContent=result.message||"A sequência foi interrompida.";
              return false;
            }
          }catch(error){
            display(cell,{message:error.message});
            notice.textContent="Falha em "+cell.title.textContent+".";
            return false;
          }
        }
        notice.textContent="Execução concluída.";
        return true;
      }finally{busy=false;refresh();}
    }
    function activate(names=columns) {
      columns=names;
      const next=project();
      if(key!==next){
        key=next;
        if(!workbooks.has(key))workbooks.set(key,[]);
        cells=workbooks.get(key);
        list.replaceChildren(...cells.map(cell=>cell.node));
        notice.textContent="Adicione células Python, SQL ou de texto. Cada execução Python é isolada.";
      }
      for(const cell of cells)if(cell.language==="sql")cell.editor.columns(columns);
      refresh();
    }
    signal.addEventListener("abort",()=>{
      for(const cells of workbooks.values())for(const cell of cells)cell.controller.abort();
    },{once:true});
    layout(false);activate();
    return {activate,collapse:()=>layout(false)};
  }
  window.OpenDocCodeNotebook={create};
})();
