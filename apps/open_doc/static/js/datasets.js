"use strict";
(() => {
  function create({host,request,signal,onOpenWorkbook}) {
    const $=selector=>host.querySelector(selector);
    const list=$("[data-dataset-list]"), table=$("[data-dataset-table]");
    const status=$("[data-dataset-status]"), pagination=$("[data-dataset-pagination]");
    const rowInput=$("[data-dataset-row]"), columnInput=$("[data-dataset-column]");
    const code=$("[data-dataset-code]"), output=$("[data-dataset-output]");
    let row=0, column=0, current, busy=false, querying=false, selected=null, anchor=null, editing=null, menu=null;
    let conversion=null,lastQuery=null;
    const pythonPackages=window.OpenDocPythonPackages.create({host:$("[data-python-packages]"),request,project:()=>list.value,signal});
    const sqlField=$("[data-dataset-sql]");
    const pythonEditor=window.OpenDocCodeEditor.create({field:code,language:"python",request,signal,
      signature:$("[data-dataset-signature]"),run:()=>run(executePython),project:()=>list.value});
    const sqlEditor=window.OpenDocCodeEditor.create({field:sqlField,language:"sql",request,signal,
      run:()=>run(executeQuery)});
    const tools=$("[data-dataset-tools]"), toolsButton=$("[data-dataset-command=tools]");
    let toolsOpen=!window.matchMedia("(max-width: 760px)").matches;
    function showTools() {
      tools.hidden=!current || !toolsOpen;
      toolsButton.disabled=busy || !current;
      toolsButton.setAttribute("aria-expanded",String(!tools.hidden));
    }
    function controls() {
      for (const control of host.querySelectorAll("input,select,button,textarea")) control.disabled=busy;
      $("[data-dataset-command=append]").disabled=busy || !list.value;
      $("[data-dataset-command=export]").disabled=busy || !current;
      $("[data-dataset-python]").hidden=!current;
      pythonEditor.lock(busy);sqlEditor.lock(busy);
      showTools();
      $("[data-dataset-empty]").hidden=Boolean(current);
      pagination.hidden=!current || querying;
      const toBook=$("[data-dataset-command=sql-to-workbook]");
      toBook.hidden=!querying;
      toBook.disabled=busy || !lastQuery;
      $("[data-dataset-command=confirm-conversion]").disabled=busy ||
        (!!conversion?.result.invalid&&!$("[data-conversion-keep-invalid]").checked);
      $("[data-dataset-query]").hidden=!current;
      $("[data-dataset-command=reset]").disabled=busy || !querying;
      $("[data-dataset-command=previous]").disabled=busy || row===0;
      $("[data-dataset-command=next]").disabled=busy || !current || row+50>=current.row_count;
    }
    const typeNames=[["auto","Automático"],["text","Texto"],["integer","Inteiro"],["decimal","Número decimal"],
      ["currency","Moeda (R$)"],["percent","Porcentagem"],["date","Data"],["time","Hora"],
      ["datetime","Data e hora"],["boolean","Booleano"]];
    function kindFor(r,c){
      return current?.types?.cells?.[r+","+c]||current?.types?.columns?.[String(c)]||"auto";
    }
    function bounds(){
      if(!selected)return null;
      const other=anchor||selected;
      return [Math.min(selected[0],other[0]),Math.min(selected[1],other[1]),
        Math.max(selected[0],other[0]),Math.max(selected[1],other[1])];
    }
    function paintSelection(){
      const extent=bounds();
      for(const td of table.querySelectorAll("[data-dataset-cell]")){
        const r=Number(td.dataset.datasetRow),c=Number(td.dataset.datasetCol);
        td.classList.toggle("dataset-selected",!!extent&&r>=extent[0]&&r<=extent[2]&&c>=extent[1]&&c<=extent[3]);
        td.classList.toggle("dataset-active",!!selected&&r===selected[0]&&c===selected[1]);
      }
    }
    function draw(result, preview=true) {
      const head=document.createElement("thead"),body=document.createElement("tbody");
      const headings=head.insertRow();
      const cell=(tr,value,tag,r,c)=>{
        const el=document.createElement(tag);el.textContent=value ?? "";
        if(preview&&Number.isInteger(c)){
          el.dataset.datasetCol=String(c);
          if(tag==="td"){
            el.dataset.datasetRow=String(r);el.dataset.datasetCell="true";
            el.tabIndex=0;
            const kind=kindFor(r,c);
            const shown=window.OpenDocWorkbookTypes.show(value,kind);
            el.textContent=shown.text;el.title=shown.valid?"Tipo: "+kind+" · original: "+String(value??""):
              "Valor incompatível com "+kind+" · original: "+String(value??"");
            if(!shown.valid)el.classList.add("dataset-type-error");
          }else{
            const kind=current.types?.columns?.[String(c)]||"auto";
            if(kind!=="auto"){el.classList.add("dataset-typed");el.title="Tipo de coluna: "+kind;}
            el.tabIndex=0;
          }
        }
        tr.append(el);return el;
      };
      if(preview)cell(headings,"Linha","th");
      for(let c=0;c<result.columns.length;c++)
        cell(headings,result.columns[c],"th",null,preview?column+c:null);
      result.rows.forEach((cells,index)=>{
        const line=body.insertRow();
        if(preview)cell(line,(row+index+1).toLocaleString("pt-BR"),"th");
        cells.forEach((value,c)=>{
          cell(line,value??"NULL","td",preview?row+index+1:null,preview?column+c:null);
        });
      });
      table.replaceChildren(head,body);paintSelection();
    }
    async function showPage(nextRow=0,nextColumn=0) {
      if(!list.value){
        current=null;table.replaceChildren();status.textContent="Importe um ou mais CSVs com cabeçalho para começar.";
        return;
      }
      const result=await request("dataset",{operation:"page",id:list.value,row:nextRow,column:nextColumn});
      if(current?.id!==result.id){
        selected=null;anchor=null;conversion=null;
        output.textContent="";
        const schema=await request("dataset",{operation:"columns",id:result.id});
        sqlEditor.columns(schema.columns);
      }
      current=result;row=nextRow;column=nextColumn;querying=false;lastQuery=null;
      rowInput.value=row+1;columnInput.value=column+1;
      draw(result);
      const number=value=>value.toLocaleString("pt-BR");
      status.textContent=number(result.row_count)+" linhas · "+number(result.column_count)+" colunas · "+
        number(result.source_count)+" arquivos · linhas exibidas "+number(result.rows.length ? row+1 : 0)+"–"+number(row+result.rows.length);
    }
    async function load(identifier=list.value) {
      const data=await request("dataset",{operation:"list"});
      list.replaceChildren(...data.datasets.map(item=>new Option(item.title,item.id)));
      if(data.datasets.some(item=>item.id===identifier)) list.value=identifier;
      await showPage();
    }
    async function run(operation) {
      if(busy)return;
      busy=true;controls();
      try {await operation();} catch(error){status.textContent=error.message;}
      finally{busy=false;controls();}
    }
    async function ingest(append) {
      status.textContent="Selecione arquivos CSV ou TSV…";
      const result=await window.pywebview.api.import_dataset(
        append ? list.value : null, $("[data-dataset-encoding]").value, $("[data-dataset-delimiter]").value
      );
      if(result.error)throw Error(result.error);
      if(result.cancelled)return showPage(row,column);
      const first=result.added ? result.row_count-result.added : 0;
      await load(result.id);
      if(first)await showPage(first);
      status.textContent=result.added.toLocaleString("pt-BR")+" linhas acrescentadas. "+status.textContent;
    }
    async function executePython() {
      output.textContent="";
      status.textContent="Aguardando confirmação para executar Python…";
      const result=await window.pywebview.api.run_dataset_python(list.value,pythonEditor.value());
      if(result.error)throw Error(result.error);
      if(result.cancelled){status.textContent="Execução cancelada.";return;}
      output.textContent=result.output;
      status.textContent=result.stopped==="timeout" ? "Execução encerrada após 15 segundos." :
        result.stopped==="output" ? "Saída limitada a 64 KiB." :
        result.returncode===0 ? "Python concluído." : "Python terminou com código "+result.returncode+".";
    }
    async function executeQuery(){
      const result=await request("dataset",{operation:"query",id:list.value,sql:sqlEditor.value()});
      querying=true;lastQuery=result;
      draw(result,false);
      status.textContent=result.rows.length+" linhas de resultado"+(result.limited?" · prévia limitada a 100 linhas":"");
    }
    function selectCell(r,c,extend=false) {
      if(!extend||!anchor)anchor=[r,c];
      selected=[r,c];paintSelection();
    }
    async function persistCell(datasetId,r,c,value){
      await request("dataset",{operation:"edit",id:datasetId,row:r,column:c,value});
      if(list.value===datasetId&&!querying)await showPage(row,column);
      status.textContent="Célula atualizada: linha "+r+", coluna "+(c+1)+".";
    }
    async function undoEdit(reverse=false){
      if(!current||querying)return;
      const result=await request("dataset",{operation:reverse?"redo":"undo",id:list.value});
      if(result.changed){await showPage(row,column);
        status.textContent=(reverse?"Refazida: ":"Desfeita: ")+result.operation+".";}
      else status.textContent=result.message;
    }
    async function openHistory(){
      const result=await request("dataset",{operation:"history",id:list.value});
      const listUI=$("[data-dataset-history-list]");
      listUI.replaceChildren(...result.entries.map(item=>{
        const entry=document.createElement("li");
        entry.textContent=new Date(item.created_at+"Z").toLocaleString("pt-BR")+
          " · "+({edit:"Edição de célula",type:"Alteração de tipo",
            conversion:"Conversão confirmada"}[item.operation]||item.operation)+
          (item.undone?" (desfeita)":"");
        return entry;
      }));
      $("[data-dataset-history]").hidden=false;
    }
    function showConversionPreview(result,data){
      conversion={result,data};
      $("[data-conversion-summary]").textContent=
        result.count.toLocaleString("pt-BR")+" células analisadas · "+
        result.changed.toLocaleString("pt-BR")+" alterações propostas · "+
        result.invalid.toLocaleString("pt-BR")+" incompatíveis · "+
        result.exceptions.toLocaleString("pt-BR")+" exceções individuais preservadas.";
      const samples=$("[data-conversion-samples]"),fragment=document.createDocumentFragment();
      for(const example of result.sample){
        const p=document.createElement("p");
        p.textContent="Linha "+example.row+", coluna "+(example.column+1)+
          ": "+example.before+" → "+example.after;fragment.append(p);
      }
      for(const error of result.invalid_sample){
        const p=document.createElement("p");p.className="dataset-invalid-example";
        p.textContent="Linha "+error.row+", coluna "+(error.column+1)+
          ": "+error.value+" — "+error.reason;fragment.append(p);
      }
      if(!fragment.childNodes.length){
        const p=document.createElement("p");p.textContent="Nenhuma alteração necessária.";fragment.append(p);
      }
      samples.replaceChildren(fragment);
      const checkbox=$("[data-conversion-keep-invalid]");
      checkbox.checked=false;checkbox.disabled=result.invalid===0;
      $("[data-dataset-command=confirm-conversion]").disabled=result.invalid>0;
      $("[data-dataset-conversion]").hidden=false;
      $("[data-dataset-command=cancel-conversion]").focus();
    }
    async function confirmConversion(){
      if(!conversion)return;
      const {result,data}=conversion;
      const keep=$("[data-conversion-keep-invalid]").checked;
      if(result.invalid&&!keep)throw Error("Marque a preservação dos incompatíveis ou cancele.");
      const answer=await request("dataset",{...data,operation:"conversion-commit",
        token:result.token,confirm:true,on_invalid:keep?"keep":"abort"});
      $("[data-dataset-conversion]").hidden=true;conversion=null;
      await showPage(row,column);
      status.textContent=answer.converted+" valores convertidos; "+
        answer.invalid+" incompatíveis preservados; alterações reversíveis no Histórico.";
    }
    function editCell(target) {
      if(busy||querying||!current||editing)return;
      const r=Number(target.dataset.datasetRow),c=Number(target.dataset.datasetCol);
      selectCell(r,c);
      editing={r,c,closed:false};
      const item=editing,datasetId=list.value;
      (async()=>{
        try {
          const result=await request("dataset",{operation:"cell",id:datasetId,row:r,column:c});
          if(editing!==item||list.value!==datasetId)return;
          const input=document.createElement("input");input.type="text";
          input.className="dataset-inline-editor";input.value=result.value;
          input.setAttribute("aria-label","Editar linha "+r+", coluna "+(c+1));
          target.replaceChildren(input);input.focus();input.select();
          function done(accept){
            if(item.closed)return;
            item.closed=true;editing=null;
            input.remove();
            if(!accept||input.value===result.value){draw(current);return;}
            run(()=>persistCell(datasetId,r,c,input.value));
          }
          input.addEventListener("keydown",event=>{
            if(!["Enter","Escape","Tab"].includes(event.key))return;
            event.preventDefault();event.stopPropagation();
            done(event.key!=="Escape");
          });
          input.addEventListener("blur",()=>done(true),{once:true});
        }catch(error){editing=null;status.textContent=error.message;draw(current);}
      })();
    }
    function closeMenu(){menu?.remove();menu=null;}
    function showTypeMenu(event,{r,c,header=false}) {
      if(busy||querying||!current)return;
      event.preventDefault();closeMenu();
      if(!header){
        const range=bounds();
        if(!range||r<range[0]||r>range[2]||c<range[1]||c>range[3])selectCell(r,c);
      }
      const origin=bounds()||[r,c,r,c];
      const container=document.createElement("div");container.className="book-context-menu";
      container.setAttribute("role","menu");container.setAttribute("aria-label","Tipo de dado");
      const title=document.createElement("strong");
      title.textContent=header?"Alterar tipo da coluna":"Alterar tipo da célula ou seleção";
      container.append(title);
      const scopes=document.createElement("div");scopes.style.display="flex";scopes.style.gap="3px";
      scopes.style.flexWrap="wrap";
      let scope=header?"column":"cell";
      for(const [id,label] of [["cell","Célula"],["selection","Seleção"],["column","Coluna"]]){
        if(header&&id!=="column")continue;
        const button=document.createElement("button");button.type="button";
        button.textContent=label;button.style.width="auto";button.style.fontWeight=id===scope?"bold":"normal";
        button.addEventListener("click",()=>{
          scope=id;
          for(const b of scopes.querySelectorAll("button"))b.style.fontWeight=b===button?"bold":"normal";
        });
        scopes.append(button);
      }
      container.append(scopes);
      for(const [kind,label] of typeNames){
        const button=document.createElement("button");button.type="button";button.textContent=label;
        button.addEventListener("click",()=>{
          const data={operation:"type",id:list.value,scope,kind,column:scope==="selection"?origin[1]:c};
          if(scope==="cell")data.row=r;
          if(scope==="selection"){data.row=origin[0];data.last_row=origin[2];data.last_column=origin[3];}
          closeMenu();
          run(async()=>{
            const result=await request("dataset",data);
            await showPage(row,column);
            status.textContent=result.updated+" célula(s) ou coluna(s) com tipo "+label+". Valores originais preservados.";
          });
        });
        container.append(button);
      }
      const convertLabel=document.createElement("label");
      convertLabel.textContent="Conversão explícita · tipo de destino";
      convertLabel.style.display="block";convertLabel.style.marginTop="8px";
      const convertChoice=document.createElement("select");
      convertChoice.style.width="100%";convertChoice.setAttribute("aria-label","Tipo para converter");
      for(const [kind,label] of typeNames){
        const option=document.createElement("option");option.value=kind;option.textContent=label;
        convertChoice.append(option);
      }
      convertChoice.value=kindFor(r,c)==="auto"?"decimal":kindFor(r,c);
      convertLabel.append(convertChoice);container.append(convertLabel);
      const preview=document.createElement("button");
      preview.type="button";preview.textContent="Prévia e conversão…";
      preview.title="Analisar todos os valores antes de alterar. Não faz mudanças até confirmar.";
      preview.addEventListener("click",()=>{
        const kind=convertChoice.value,datasetId=list.value;
        const data={operation:"conversion-preview",id:datasetId,scope,kind,
          column:scope==="selection"?origin[1]:c};
        if(scope==="cell")data.row=r;
        if(scope==="selection"){data.row=origin[0];data.last_row=origin[2];data.last_column=origin[3];}
        closeMenu();
        run(async()=>showConversionPreview(await request("dataset",data),data));
      });
      container.append(preview);
      const hint=document.createElement("small");
      hint.textContent="Tipo sem conversão destrutiva · dados inválidos recebem indicação.";
      container.append(hint);host.append(container);menu=container;
      container.style.left=Math.max(7,Math.min(event.clientX||250,window.innerWidth-container.offsetWidth-8))+"px";
      container.style.top=Math.max(7,Math.min(event.clientY||150,window.innerHeight-container.offsetHeight-8))+"px";
      container.querySelector("button")?.focus();
    }
    table.addEventListener("click",event=>{
      const cell=event.target.closest("[data-dataset-cell]");
      if(cell&&!editing)selectCell(Number(cell.dataset.datasetRow),Number(cell.dataset.datasetCol),event.shiftKey);
    },{signal});
    table.addEventListener("dblclick",event=>{
      const cell=event.target.closest("[data-dataset-cell]");
      if(cell)editCell(cell);
    },{signal});
    table.addEventListener("contextmenu",event=>{
      const header=event.target.closest("thead [data-dataset-col]"),
        cell=event.target.closest("[data-dataset-cell]");
      if(header)showTypeMenu(event,{r:row+1,c:Number(header.dataset.datasetCol),header:true});
      else if(cell)showTypeMenu(event,{r:Number(cell.dataset.datasetRow),c:Number(cell.dataset.datasetCol)});
    },{signal});
    table.addEventListener("keydown",event=>{
      const cell=event.target.closest("[data-dataset-cell]"),header=event.target.closest("thead [data-dataset-col]");
      if(!cell&&!header)return;
      const r=cell?Number(cell.dataset.datasetRow):row+1;
      const c=Number((cell||header).dataset.datasetCol);
      if(event.key==="F2"&&cell){event.preventDefault();editCell(cell);}
      if(event.key==="ContextMenu"||(event.shiftKey&&event.key==="F10")){
        event.preventDefault();showTypeMenu(event,{r,c,header:!!header});
      }
      if((event.ctrlKey||event.metaKey)&&["z","y"].includes(event.key.toLowerCase())){
        event.preventDefault();run(()=>undoEdit(event.key.toLowerCase()==="y"));
      }
    },{signal});
    document.addEventListener("pointerdown",event=>{
      if(menu&&!menu.contains(event.target))closeMenu();
    },{signal});
    host.addEventListener("keydown",event=>{
      if(menu&&event.key==="Escape"){event.preventDefault();closeMenu();}
    },{signal});
    host.addEventListener("click",event=>{
      const command=event.target.closest("[data-dataset-command]")?.dataset.datasetCommand;
      if(command==="new" || command==="append")run(()=>ingest(command==="append"));
      if(command==="tools"){toolsOpen=!toolsOpen;showTools();}
      if(command==="python")run(executePython);
      if(command==="export")run(async()=>{
        const result=await window.pywebview.api.export_dataset(list.value,current.title);
        if(result.error)throw Error(result.error);
        status.textContent=result.cancelled ? "Exportação cancelada." :
          result.rows.toLocaleString("pt-BR")+" linhas exportadas para "+result.name+".";
      });
      if(command==="previous")run(()=>showPage(Math.max(0,row-50),column));
      if(command==="next")run(()=>showPage(row+50,column));
      if(command==="query")run(executeQuery);
      if(command==="sql-to-workbook")run(async()=>{
        if(!lastQuery)throw Error("Execute uma consulta SQL antes.");
        const sheets=await request("workbook",{operation:"from-query",
          columns:lastQuery.columns,rows:lastQuery.rows.map(line=>line.map(v=>v??""))});
        if(typeof onOpenWorkbook!=="function")throw Error("Abertura de planilha indisponível.");
        await onOpenWorkbook(sheets);
      });
      if(command==="undo")run(()=>undoEdit(false));
      if(command==="redo")run(()=>undoEdit(true));
      if(command==="history")run(openHistory);
      if(command==="close-history")$("[data-dataset-history]").hidden=true;
      if(command==="cancel-conversion"){$("[data-dataset-conversion]").hidden=true;conversion=null;}
      if(command==="confirm-conversion")run(confirmConversion);
      if(command==="reset")run(()=>showPage(row,column));
      if(command==="go")run(()=>{
        if(!/^[1-9]\d*$/.test(rowInput.value) || !/^[1-9]\d*$/.test(columnInput.value))throw Error("Informe linha e coluna a partir de 1.");
        return showPage(Number(rowInput.value)-1,Number(columnInput.value)-1);
      });
    },{signal});
    $("[data-conversion-keep-invalid]").addEventListener("change",event=>{
      $("[data-dataset-command=confirm-conversion]").disabled=
        !!conversion?.result.invalid&&!event.target.checked;
    },{signal});
    list.addEventListener("change",()=>run(async()=>{
      current=null;table.replaceChildren();await showPage();
    }),{signal});
    return {load:()=>run(()=>load())};
  }
  window.OpenDocDatasets={create};
})();
