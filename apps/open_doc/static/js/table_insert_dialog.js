/* Accessible, modular table creation. No ambiguous URL field or 3x4 shorthand. */
"use strict";
(() => {
  const MAX_ROWS=100,MAX_COLS=30,MAX_CHARS=200000;
  function parseDelimited(text){
    if(typeof text!=="string"||text.length>MAX_CHARS)throw Error("O arquivo CSV é muito grande (limite de 200 mil caracteres).");
    const sample=text.slice(0,1500),separator=sample.includes("\t")?"\t":sample.includes(";")?";":",";
    const rows=[],row=[];let field="",quoted=false;
    const addCell=()=>{row.push(field);field="";};
    const addRow=()=>{addCell();rows.push(row.splice(0));};
    for(let i=0;i<text.length;i++){
      const ch=text[i];
      if(ch==='"'&&quoted&&text[i+1]==='"'){field+='"';i++;continue;}
      if(ch==='"'){quoted=!quoted;continue;}
      if(!quoted&&ch===separator){addCell();continue;}
      if(!quoted&&(ch==='\n'||ch==='\r')){
        addRow();if(ch==='\r'&&text[i+1]==='\n')i++;continue;
      }
      field+=ch;
    }
    if(quoted)throw Error("CSV com aspas não fechadas.");
    if(field||row.length)addRow();
    if(rows.length&&rows[0].length===1&&rows[0][0].charCodeAt(0)===0xFEFF)
      rows[0][0]=rows[0][0].slice(1);
    const filtered=rows.filter(row=>row.some(v=>v.trim()));
    const width=Math.max(0,...filtered.map(row=>row.length));
    if(!filtered.length||width===0)throw Error("O CSV não contém uma tabela.");
    if(filtered.length>MAX_ROWS||width>MAX_COLS)
      throw Error("A tabela pode ter até 100 linhas e 30 colunas.");
    return filtered.map(row=>Array.from({length:width},(_,i)=>row[i]||""));
  }
  function field(label,type,value,min,max){
    const row=document.createElement("label");row.className="table-dialog-field";
    row.textContent=label;
    const input=document.createElement("input");input.type=type;input.value=String(value);
    if(min!=null)input.min=String(min);if(max!=null)input.max=String(max);
    if(type==="number")input.step="1";
    row.append(input);return {row,input};
  }
  function option(label,description,value,state,body){
    const button=document.createElement("button");button.type="button";
    button.className="table-preset";button.dataset.tablePreset=value;
    button.setAttribute("aria-pressed",String(state.value===value));
    const title=document.createElement("strong");title.textContent=label;
    const detail=document.createElement("small");detail.textContent=description;
    button.append(title,detail);
    button.addEventListener("click",()=>{
      state.value=value;
      body.querySelectorAll("[data-table-preset]").forEach(item=>
        item.setAttribute("aria-pressed",String(item===button)));
    });
    return button;
  }
  class TableInsertDialog {
    static async show({dialog,editor,status,root}){
      const decision=dialog("Inserir tabela","Escolha as dimensões e o modelo. Depois, edite as células diretamente no documento.");
      const body=root.querySelector("[data-dialog-body]");
      const dimensions=document.createElement("div");dimensions.className="table-dialog-dimensions";
      const rows=field("Linhas","number",3,1,MAX_ROWS),cols=field("Colunas","number",4,1,MAX_COLS);
      const spacing=field("Espaçamento entre células (pt)","number",0,0,36);
      dimensions.append(rows.row,cols.row,spacing.row);
      const heading=document.createElement("h3");heading.textContent="Modelo da tabela";
      const templates=document.createElement("div");templates.className="table-preset-grid";
      const state={value:"grid"};
      for(const [label,description,value] of [
        ["Grade clássica","Bordas em todas as células","grid"],
        ["Cabeçalho","Primeira linha destacada","header"],
        ["Matriz","Células separadas e editáveis","matrix"],
        ["Simples","Sem destaque visual","plain"]
      ])templates.append(option(label,description,value,state,templates));
      const importTitle=document.createElement("h3");importTitle.textContent="Importar dados";
      const importHint=document.createElement("p");importHint.className="table-dialog-hint";
      importHint.textContent="Você pode importar CSV ou TSV local, colar dados tabulados ou fornecer um link HTTPS de CSV que permita acesso direto.";
      const file=document.createElement("input");file.type="file";file.accept=".csv,.tsv,text/csv,text/tab-separated-values";file.className="table-csv-file";
      file.setAttribute("aria-label","Escolher arquivo CSV ou TSV");
      const paste=document.createElement("textarea");paste.rows=3;paste.maxLength=MAX_CHARS;
      paste.placeholder="Cole os dados: uma linha por registro; colunas separadas por vírgula, ponto e vírgula ou Tab.";
      paste.setAttribute("aria-label","Colar dados de tabela");
      const link=field("Link HTTPS para arquivo CSV","url","https://");
      const importLink=document.createElement("button");importLink.type="button";
      importLink.textContent="Importar link CSV";importLink.className="table-import-link";
      const feedback=document.createElement("p");feedback.className="table-dialog-feedback";feedback.setAttribute("role","status");
      let imported=null;
      function setData(data){
        imported=data;rows.input.value=data.length;cols.input.value=data[0].length;
        feedback.textContent=data.length+" linhas e "+data[0].length+" colunas importadas. Você ainda pode escolher um modelo.";
      }
      file.addEventListener("change",async()=>{
        const value=file.files?.[0];if(!value)return;
        try{
          if(value.size>MAX_CHARS)throw Error("Arquivo maior que o limite permitido.");
          setData(parseDelimited(await value.text()));
        }catch(error){feedback.textContent=error.message;status(error.message);}
      });
      paste.addEventListener("input",()=>{
        if(!paste.value.trim()){imported=null;feedback.textContent="";return;}
        try{setData(parseDelimited(paste.value));}catch(error){feedback.textContent=error.message;imported=null;}
      });
      importLink.addEventListener("click",async()=>{
        try{
          const url=new URL(link.input.value);
          if(url.protocol!=="https:"||!url.hostname||url.username||url.password||
             /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1)/i.test(url.hostname))
            throw Error("Use um endereço HTTPS público de CSV.");
          feedback.textContent="Importando arquivo CSV…";
          const response=await fetch(url.href,{credentials:"omit",mode:"cors",redirect:"error"});
          if(!response.ok)throw Error("O servidor não disponibilizou o CSV.");
          const size=Number(response.headers.get("content-length")||0);
          if(size>MAX_CHARS)throw Error("O CSV é maior que o limite permitido.");
          setData(parseDelimited((await response.text()).slice(0,MAX_CHARS+1)));
        }catch(error){
          feedback.textContent="Não foi possível importar o link. Verifique o CSV e se o site permite compartilhamento (CORS).";
          status(error.message);
        }
      });
      body.append(dimensions,heading,templates,importTitle,importHint,file,paste,link.row,importLink,feedback);
      rows.input.focus();
      if(!await decision)return false;
      const countRows=Number(rows.input.value),countCols=Number(cols.input.value);
      const gap=Number(spacing.input.value);
      if(!Number.isInteger(countRows)||countRows<1||countRows>MAX_ROWS||
         !Number.isInteger(countCols)||countCols<1||countCols>MAX_COLS)
        throw Error("Informe de 1 a 100 linhas e de 1 a 30 colunas.");
      if(!Number.isFinite(gap)||gap<0||gap>36)
        throw Error("O espaçamento entre células deve estar entre 0 e 36 pt.");
      if(imported&&(imported.length!==countRows||imported[0].length!==countCols))
        throw Error("As dimensões importadas não conferem. Reimporte os dados ou mantenha as dimensões detectadas.");
      editor.tableOperation("insert",countRows,countCols,{
        preset:state.value,cellSpacingPt:gap,data:imported
      });
      status("Tabela inserida: "+countRows+" × "+countCols+" células. Digite diretamente nelas.");
      return true;
    }
  }
  window.OpenDocTableInsertDialog={TableInsertDialog,parseDelimited};
})();
