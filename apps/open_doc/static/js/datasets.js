"use strict";
(() => {
  function create({host,request,signal}) {
    const $=selector=>host.querySelector(selector);
    const list=$("[data-dataset-list]"), table=$("[data-dataset-table]");
    const status=$("[data-dataset-status]"), pagination=$("[data-dataset-pagination]");
    const rowInput=$("[data-dataset-row]"), columnInput=$("[data-dataset-column]");
    const code=$("[data-dataset-code]"), output=$("[data-dataset-output]");
    let row=0, column=0, current, busy=false, querying=false;
    const sqlField=$("[data-dataset-sql]");
    const pythonEditor=window.OpenDocCodeEditor.create({field:code,language:"python",request,signal,
      signature:$("[data-dataset-signature]"),run:()=>run(executePython)});
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
      $("[data-dataset-query]").hidden=!current;
      $("[data-dataset-command=reset]").disabled=busy || !querying;
      $("[data-dataset-command=previous]").disabled=busy || row===0;
      $("[data-dataset-command=next]").disabled=busy || !current || row+50>=current.row_count;
    }
    function draw(result, preview=true) {
      const head=document.createElement("thead"), body=document.createElement("tbody");
      function add(target, text, kind) {
        const cell=document.createElement(kind);
        cell.textContent=text;
        target.append(cell);
      }
      const headings=head.insertRow();
      if(preview)add(headings,"Linha","th");
      for (const name of result.columns) add(headings,name,"th");
      result.rows.forEach((cells,index)=>{
        const line=body.insertRow();
        if(preview)add(line,(row+index+1).toLocaleString("pt-BR"),"th");
        for (const value of cells) add(line,value ?? "NULL","td");
      });
      table.replaceChildren(head,body);
    }
    async function showPage(nextRow=0,nextColumn=0) {
      if(!list.value){
        current=null;table.replaceChildren();status.textContent="Importe um ou mais CSVs com cabeçalho para começar.";
        return;
      }
      const result=await request("dataset",{operation:"page",id:list.value,row:nextRow,column:nextColumn});
      if(current?.id!==result.id){
        output.textContent="";
        const schema=await request("dataset",{operation:"columns",id:result.id});
        sqlEditor.columns(schema.columns);
      }
      current=result;row=nextRow;column=nextColumn;querying=false;
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
      querying=true;
      draw(result,false);
      status.textContent=result.rows.length+" linhas de resultado"+(result.limited?" · prévia limitada a 100 linhas":"");
    }
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
      if(command==="reset")run(()=>showPage(row,column));
      if(command==="go")run(()=>{
        if(!/^[1-9]\d*$/.test(rowInput.value) || !/^[1-9]\d*$/.test(columnInput.value))throw Error("Informe linha e coluna a partir de 1.");
        return showPage(Number(rowInput.value)-1,Number(columnInput.value)-1);
      });
    },{signal});
    list.addEventListener("change",()=>run(async()=>{
      current=null;table.replaceChildren();await showPage();
    }),{signal});
    return {load:()=>run(()=>load())};
  }
  window.OpenDocDatasets={create};
})();
