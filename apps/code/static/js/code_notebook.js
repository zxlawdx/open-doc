"use strict";
(() => {
  const LABELS={python:"Python",sql:"SQL",text:"Texto"};
  const LIMIT=20;

  function create({panel,signal,project,request,execute,onLayout}) {
    const shell=panel.parentElement;
    const workbooks=new Map();
    let restoration=Promise.resolve();
    let key, cells=[], columns=[], busy=false, stop=false, saveTimer;
    const sources=()=>cells.map(cell=>({language:cell.language,source:cell.editor?.value()??cell.field.value}));
    function persist(){if(!key)return;const id=key,payload=sources();clearTimeout(saveTimer);saveTimer=setTimeout(()=>request("notebook",{operation:"save-cells",id,cells:payload}).catch(error=>{notice.textContent="Caderno não salvo: "+error.message;}),400);}
    async function restore(id){try{const saved=await request("notebook",{operation:"load-cells",id});if(key!==id||cells.length)return;for(const cell of saved.cells||[])if(Object.prototype.hasOwnProperty.call(LABELS,cell.language))add(cell.language,cell.source);}catch(error){notice.textContent="Recuperação do caderno: "+error.message;}}
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
    const datasetMode=Boolean(panel.closest("[data-dataset]"));
    const notebook=element("section","code-notebook");
    notebook.setAttribute("aria-label","Caderno de código");
    const toolbar=element("div","code-notebook-tools");
    const kernelStatus=element("span","code-notebook-kernel-status","● Kernel ocioso");
    kernelStatus.setAttribute("role","status");
    kernelStatus.setAttribute("aria-live","polite");
    const list=element("div","code-notebook-cells");
    const notice=element("p","code-notebook-status");
    const progress=element("progress");progress.setAttribute("aria-label","Executando célula");progress.hidden=true;
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
    if(datasetMode)toolbar.append(kernelStatus);
    toolbar.append(...addButtons,runAll,stopAll,openFile,saveFile,split,full,picker);
    notebook.append(toolbar,progress,notice,list);
    notebook.addEventListener("focusout",persist,{signal});
    notebook.addEventListener("change",persist,{signal});
    panel.querySelector(".workbook-sidebar-title").after(notebook);
    function layout(expanded) {
      shell.classList.toggle("code-notebook-full",expanded);
      split.setAttribute("aria-pressed",String(!expanded));
      full.setAttribute("aria-pressed",String(expanded));
      onLayout();
      shell.dispatchEvent(new CustomEvent("open-doc:layout",{bubbles:true}));
    }
    panel.addEventListener("keydown",event=>{
      if(event.key==="Escape"&&shell.classList.contains("code-notebook-full")){
        event.preventDefault();layout(false);full.focus();
      }
    },{signal});
    function refresh() {
      progress.hidden=!busy;notebook.setAttribute("aria-busy",String(busy));
      runAll.disabled=busy||!cells.some(cell=>cell.language!=="text");
      stopAll.hidden=!busy;
      if(datasetMode){
        kernelStatus.textContent=busy?"● Executando…":"● Kernel ocioso";
        kernelStatus.dataset.running=String(busy);
      }
      openFile.disabled=busy||!key||cells.length>=LIMIT;
      saveFile.disabled=busy||!cells.length;
      addButtons.forEach(button=>button.disabled=busy||!key||cells.length>=LIMIT);
      for(const [index,cell] of cells.entries()){
        cell.title.textContent=(index+1)+" · "+LABELS[cell.language];
        if(cell.counter)cell.counter.textContent="["+(index+1)+"]";
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
      if(datasetMode)node.classList.add("data-notebook-cell");
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
      const gutter=datasetMode?element("div","data-notebook-gutter"):null;
      if(datasetMode){
        const counter=element("span","data-notebook-count","[ ]");
        cell.counter=counter;gutter.append(counter);
        const kind=element("span","data-notebook-kind",LABELS[language]);
        heading.append(title,kind);
      }else heading.append(title);
      const actions=datasetMode?element("div","data-notebook-actions"):heading;
      if(language!=="text"){
        const play=button("Executar","play",()=>run([cell]));
        if(datasetMode){
          play.classList.add("data-notebook-run");
          play.replaceChildren(icon("play"));
          gutter.prepend(play);
        }else actions.append(play);
        actions.append(clear);cell.controls.push(play,clear);
      }
      actions.append(up,down,duplicate,remove);
      if(datasetMode){
        heading.append(actions);
        node.append(gutter);
        const main=element("div","data-notebook-main");
        main.append(heading,field,signature,output);
        node.append(main);
      }else node.append(heading,field,signature,output);
      list.insertBefore(node,cells[at]?.node??null);
      cells.splice(at,0,cell);
      if(language!=="text"){
        cell.editor=window.OpenDocCodeEditor.create({field,language,request,signature,
          // Jedi must see imports/definitions from preceding notebook cells.
          // Never evaluate them; only submit a bounded static source prefix.
          context:()=>{
            const budget=Math.max(0,24000-value().length-2);
            const parts=[];let length=0;
            for(const previous of cells.slice(0,cells.indexOf(cell)).reverse()){
              if(previous.language!=="python")continue;
              const source=(previous.editor?.value()??previous.field.value)
                .split("\n").map(line=>/^\s*[!%]/.test(line)?"pass":line).join("\n");
              if(!source.trim()||length+source.length+2>budget)continue;
              parts.unshift(source);length+=source.length+2;
            }
            return parts.join("\n\n");
          },
          signal:controller.signal,project,run:()=>run([cell]),runNext:async()=>{
            if(await run([cell])){
              const next=cells[cells.indexOf(cell)+1];
              if(next)(next.editor||next.field).focus();else add(language);
            }
          }});
        if(language==="sql")cell.editor.columns(columns);
      }
      if(language==="text"){
        const preview=()=>{output.hidden=false;const markdown=window.marked?.parse(field.value)||field.value;output.innerHTML=window.DOMPurify?.sanitize(markdown)||"";if(!window.DOMPurify)output.textContent=field.value;};
        field.addEventListener("input",preview,{signal:controller.signal});preview();
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
      }else if(result.outputs?.length){
        for(const item of result.outputs){
          if(item.data){
            if(item.data["image/png"]||item.data["image/jpeg"]){const image=document.createElement("img");const mime=item.data["image/png"]?"image/png":"image/jpeg";image.src="data:"+mime+";base64,"+item.data[mime];image.alt="Visualização da célula";image.style.maxWidth="100%";output.append(image);}
            else if(item.data["text/html"]&&window.DOMPurify){const html=element("div");html.innerHTML=window.DOMPurify.sanitize(item.data["text/html"]);output.append(html);}
            else {
              const plain=String(item.data["text/plain"]||"");
              // A numeric NumPy scalar should read as a number, not np.int64(0).
              // Only normalize a complete numeric repr, never arbitrary output.
              const numeric=plain.match(/^np\.(?:u?int(?:8|16|32|64)|float(?:16|32|64))\((-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\)$/i);
              output.append(element("pre",null,datasetMode&&numeric?numeric[1]:plain));
            }
          }else output.append(element("pre",null,item.text||""));
        }
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
      }finally{busy=false;refresh();persist();}
    }
    function activate(names=columns) {
      columns=names;
      const next=project();
      if(key!==next){
        key=next;
        if(!workbooks.has(key))workbooks.set(key,[]);
        cells=workbooks.get(key);
        list.replaceChildren(...cells.map(cell=>cell.node));
        notice.textContent="Células Python e SQL compartilham o kernel deste projeto. df permanece isolado até publicar.";
        if(key)restoration=restore(key);
      }
      for(const cell of cells)if(cell.language==="sql")cell.editor.columns(columns);
      refresh();
    }
    signal.addEventListener("abort",()=>{
      clearTimeout(saveTimer);
      for(const cells of workbooks.values())for(const cell of cells)cell.controller.abort();
    },{once:true});
    layout(false);activate();
    return {activate,add:(language,source)=>restoration.then(()=>add(language,source)),flush:async()=>{clearTimeout(saveTimer);await restoration;if(key)await request("notebook",{operation:"save-cells",id:key,cells:sources()});},collapse:()=>layout(false)};
  }
  window.OpenDocCodeNotebook={create};
})();
