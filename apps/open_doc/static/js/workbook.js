"use strict";
(() => {
  const ROWS=10000, COLS=100, WIDTH=112, HEIGHT=28, GUTTER=52;
  const key=(r,c)=>r+","+c;
  function create({host,request,dialog,signal,loadCodeEditors}) {
    const {address,column,evaluate}=window.OpenDocWorkbookFormula;
    const $=selector=>host.querySelector(selector);
    const viewport=$("[data-book-scroll]"), space=$("[data-book-space]");
    const title=$("[data-book-title]"), formula=$("[data-book-formula]");
    const coord=$("[data-book-address]"), tabs=$("[data-book-tabs]"), status=$("[data-book-status]");
    const inline=$("[data-book-inline]"), sidebar=$("[data-book-sidebar]");
    const analysis=$("[data-book-analysis]"), analysisButton=$("[data-book-command=analysis]");
    let sqlEditor, pythonEditor, analysisLoading, analysisBusy=false, lastSchema,lastSqlQuery=null;
    const undo=[], redo=[];
    let book, lastClick, index=0, row=0, col=0, anchor=[0,0], calc, frame, dirty=false, pending, importing=false;
    const pythonPackages=window.OpenDocPythonPackages.create({host:$("[data-python-packages]"),request,project:()=>book?.id,signal});
    const sheet=()=>book.sheets[index];
    const raw=()=>sheet().cells[key(row,col)] || "";
    const native=()=>window.pywebview.api;
    function mark() {
      dirty=true;
      native().set_dirty?.(true);
      report("Alterações pendentes");
    }
    function report(message) {status.textContent=message;}
    const pivotUI=window.OpenDocWorkbookPivotUI.create({host,signal,onReport:report,
      onApply:(output,target,sourceName)=>{
        if(target!==null){
          const before=book.sheets[target],after={...before,cells:output.cells,bold:output.bold,pivot:output.pivot};
          change(()=>{book.sheets[target]=before;renderTabs();choose(target);},
            ()=>{book.sheets[target]=after;renderTabs();choose(target);});
          togglePivot(false);report("Tabela dinâmica atualizada da aba "+sourceName+".");
        }else{
          if(book.sheets.length>=20)throw Error("Limite de 20 abas.");
          let name="Tabela dinâmica",suffix=2;
          while(book.sheets.some(sh=>sh.name.toLowerCase()===name.toLowerCase()))name="Tabela dinâmica "+suffix++;
          const previous=index,result={name,cells:output.cells,bold:output.bold,pivot:output.pivot};
          change(()=>{book.sheets.pop();renderTabs();choose(previous);},
            ()=>{book.sheets.push(result);renderTabs();choose(book.sheets.length-1);});
          togglePivot(false);report("Tabela dinâmica criada: "+name+" (fonte: "+sourceName+").");
        }
      }});

    const typesUI=window.OpenDocWorkbookTypes.create({host,signal,
      getState:()=>({sheet:sheet(),bounds:bounds(),report}),
      change:(target,before,after)=>change(()=>{target.types=before;},()=>{target.types=after;})
    });
    function controls() {
      coord.value=column(col)+(row+1);
      if(document.activeElement!==formula) formula.value=raw();
      $("[data-book-command=undo]").disabled=!undo.length;
      $("[data-book-command=redo]").disabled=!redo.length;
      $("[data-book-command=bold]").setAttribute("aria-pressed",String(sheet().bold.includes(key(row,col))));
      for(const button of tabs.children) button.setAttribute("aria-pressed",String(+button.dataset.index===index));
    }
    function draw() {
      frame=undefined;
      if (!book || host.hidden) return;
      const left=viewport.scrollLeft, top=viewport.scrollTop;
      const firstRow=Math.max(0,Math.floor(top/HEIGHT)), firstCol=Math.max(0,Math.floor(left/WIDTH));
      const endRow=Math.min(ROWS,firstRow+Math.ceil(viewport.clientHeight/HEIGHT)+1);
      const endCol=Math.min(COLS,firstCol+Math.ceil(viewport.clientWidth/WIDTH)+1);
      const bold=new Set(sheet().bold);
      const fragment=document.createDocumentFragment();
      function item(className,x,y,w,text) {
        const cell=document.createElement("div");
        cell.className=className;
        cell.style.left=x+"px";cell.style.top=y+"px";cell.style.width=w+"px";
        cell.textContent=text;
        return cell;
      }
      const selection=bounds();
      for(let r=firstRow;r<endRow;r++) {
        const line=document.createElement("div");
        line.setAttribute("role","row");
        line.setAttribute("aria-rowindex",String(r+1));
        line.append(item("book-heading",left,(r+1)*HEIGHT,GUTTER,r+1));
        for(let c=firstCol;c<endCol;c++) {
          const id=key(r,c);
          const kind=typesUI.typeFor(sheet(),r,c),formatted=typesUI.show(calc(index,r,c),kind);
          const cell=item("book-cell",GUTTER+c*WIDTH,(r+1)*HEIGHT,WIDTH,formatted.text);
          if(!formatted.valid){cell.classList.add("book-type-error");
            cell.title="Valor incompatível com "+kind+" · original: "+(sheet().cells[id]||"");}
          else if(kind!=="auto")cell.title="Tipo: "+kind+" · original: "+(sheet().cells[id]||"");
          cell.dataset.cell=id;
          cell.setAttribute("role","gridcell");
          cell.setAttribute("aria-colindex",String(c+1));
          if(bold.has(id))cell.classList.add("bold");
          if(r===row&&c===col)cell.classList.add("active");
          if(r>=selection[0]&&r<=selection[2]&&c>=selection[1]&&c<=selection[3]){
            cell.classList.add("selected");
            cell.setAttribute("aria-selected","true");
          }
          line.append(cell);
        }
        fragment.append(line);
      }
      for(let c=firstCol;c<endCol;c++){
        const heading=item("book-heading",GUTTER+c*WIDTH,top,WIDTH,column(c));
        heading.dataset.bookCol=String(c);
        const kind=sheet().types?.columns?.[String(c)]||"auto";
        if(kind!=="auto"){heading.classList.add("book-typed");
          heading.textContent+=" · "+(typesUI.symbols[kind]||kind);
          heading.title="Tipo da coluna: "+kind;}
        fragment.append(heading);
      }
      fragment.append(item("book-heading book-corner",left,top,GUTTER,""));
      space.replaceChildren(fragment);
    }
    function schedule() {if(frame===undefined)frame=requestAnimationFrame(draw);}
    function update(recalculate=true) {
      if(recalculate){calc=evaluate(book.sheets);updateSchema();}
      controls();schedule();
    }
    function select(r,c,extend=false,reveal=false) {
      row=Math.min(ROWS-1,Math.max(0,r));col=Math.min(COLS-1,Math.max(0,c));
      if(!extend)anchor=[row,col];
      if(reveal) {
        const y=(row+1)*HEIGHT, x=GUTTER+col*WIDTH;
        if(y<viewport.scrollTop+HEIGHT)viewport.scrollTop=y-HEIGHT;
        else if(y+HEIGHT>viewport.scrollTop+viewport.clientHeight)viewport.scrollTop=y+HEIGHT-viewport.clientHeight;
        if(x<viewport.scrollLeft+GUTTER)viewport.scrollLeft=x-GUTTER;
        else if(x+WIDTH>viewport.scrollLeft+viewport.clientWidth)viewport.scrollLeft=x+WIDTH-viewport.clientWidth;
      }
      formula.value=raw();update(false);
    }
    function bounds() {
      return [Math.min(row,anchor[0]),Math.min(col,anchor[1]),Math.max(row,anchor[0]),Math.max(col,anchor[1])];
    }
    function renderTabs() {
      tabs.replaceChildren(...book.sheets.map(({name},i)=>{
        const button=document.createElement("button");
        button.type="button";button.dataset.index=i;button.textContent=name;
        return button;
      }));
    }
    function choose(next) {
      index=next;
      viewport.scrollTop=0;viewport.scrollLeft=0;
      select(0,0);update();
      $("[data-book-query-results]").replaceChildren();lastSqlQuery=null;
      $("[data-book-command=sql-to-sheet]").disabled=true;
      $("[data-book-python-output]").textContent="";viewport.focus();
    }
    function change(back, forward) {
      if(pending || importing)return;
      forward();
      undo.push({back,forward});
      if(undo.length>40)undo.shift();
      redo.length=0;
      mark();update();
    }
    function applyCells(entries) {
      const cells=sheet().cells;
      const edits=entries.map(([id,value])=>[id,cells[id] || "",value]).filter(([,old,value])=>old!==value);
      if(!edits.length)return;
      const apply=side=>{for(const edit of edits)if(edit[side]) cells[edit[0]]=edit[side];else delete cells[edit[0]];};
      change(()=>apply(1),()=>apply(2));
    }
    function commit() {
      if(book && formula.value!==raw()) applyCells([[key(row,col),formula.value]]);
    }
    function rectangle() {
      const [top,left,bottom,right]=bounds();
      if((bottom-top+1)*(right-left+1)>50000)throw Error("Selecione até 50 mil células.");
      const rows=[];
      for(let r=top;r<=bottom;r++) {
        const cells=[];
        for(let c=left;c<=right;c++)cells.push(key(r,c));
        rows.push(cells);
      }
      return rows;
    }
    function finishInline(accept=true) {
      if(inline.hidden)return;
      const value=inline.value;
      inline.hidden=true;
      if(accept)applyCells([[key(row,col),value]]);
      native().set_dirty?.(dirty);
    }
    function editInline(initial=raw()) {
      if(!inline.hidden||pending||importing)return;
      select(row,col,false,true);
      inline.style.left=GUTTER+col*WIDTH+"px";
      inline.style.top=(row+1)*HEIGHT+"px";
      inline.style.width=WIDTH+"px";
      inline.value=initial;inline.hidden=false;
      inline.focus();inline.setSelectionRange(initial.length,initial.length);
    }
    function pivotBounds() {
      const values=$("[data-pivot-range]").value.split(":").map(value=>address(value.trim()));
      if(values.length!==2||values.some(value=>!value))throw Error("Informe um intervalo como A1:D10.");
      const [[top,left],[bottom,right]]=values;
      if(top>=bottom||left>right||(bottom-top+1)*(right-left+1)>50000)
        throw Error("Selecione cabeçalho e dados em até 50 mil células.");
      return [top,left,bottom,right];
    }
    function pivotFields() {
      const [top,left,,right]=pivotBounds();
      for(const [selector,optional] of [["row",false],["column",true],["value",false]]){
        const menu=$("[data-pivot-"+selector+"]"), old=menu.value;
        const options=optional ? [new Option("Sem agrupamento em colunas","")] : [];
        for(let c=left;c<=right;c++)options.push(new Option(
          String(calc(index,top,c) || column(c)),String(c)));
        menu.replaceChildren(...options);
        if(options.some(option=>option.value===old))menu.value=old;
        else if(selector==="value")menu.selectedIndex=options.length-1;
      }
    }
    function usedBounds() {
      let top=ROWS,left=COLS,bottom=0,right=0;
      for(const cell of Object.keys(sheet().cells)){
        const [r,c]=cell.split(",").map(Number);
        top=Math.min(top,r);left=Math.min(left,c);
        bottom=Math.max(bottom,r);right=Math.max(right,c);
      }
      return top===ROWS ? null : [top,left,bottom,right];
    }
    function worksheetSnapshot(includeRows=true) {
      const used=usedBounds();
      if(!used)throw Error("A aba está vazia.");
      const [top,left,bottom,right]=used;
      if((bottom-top+1)*(right-left+1)>50000)
        throw Error("A análise da planilha aceita até 50 mil células.");
      const evaluateCell=evaluate(book.sheets);
      const columns=[], seen=new Set(), rows=[];
      for(let c=left;c<=right;c++){
        const label=String(evaluateCell(index,top,c)).trim() || column(c);
        let name=label, suffix=2;
        while(seen.has(name.toLowerCase()))name=label+"_"+suffix++;
        seen.add(name.toLowerCase());columns.push(name);
      }
      for(let r=top+1;includeRows&&r<=bottom;r++){
        const values=[];
        for(let c=left;c<=right;c++){
          const rawValue=evaluateCell(index,r,c);
          const kind=typesUI.typeFor(sheet(),r,c);
          values.push(typesUI.analysisValue(rawValue,kind));
        }
        rows.push(values);
      }
      return {columns,rows};
    }
    function updateSchema(){
      if(sqlEditor && !analysis.hidden){
        let columns;
        try{columns=worksheetSnapshot(false).columns;}
        catch{columns=[];}
        const signature=JSON.stringify(columns);
        if(signature!==lastSchema){sqlEditor.columns(columns);lastSchema=signature;}
      }
    }
    async function toggleAnalysis(open) {
      analysis.hidden=!open;
      analysisButton.setAttribute("aria-expanded",String(open));
      schedule();
      if(!open)return;
      togglePivot(false);
      if(!analysisLoading)analysisLoading=(async()=>{
        await loadCodeEditors();
        const createEditor=window.OpenDocCodeEditor.create;
        sqlEditor=createEditor({field:$("#book-sql"),language:"sql",request,signal,run:()=>run("run-sql")});
        pythonEditor=createEditor({field:$("#book-python"),language:"python",request,signal,
          signature:$("[data-book-signature]"),run:()=>run("run-python"),project:()=>book?.id});
      })().catch(error=>{analysisLoading=null;throw error;});
      await analysisLoading;
      updateSchema();
    }
    async function analyzeWorkbook(language){
      if(analysisBusy)return;
      await analysisLoading;
      if(analysisBusy||!sqlEditor||!pythonEditor)return;
      finishInline();commit();
      const snapshot=worksheetSnapshot();
      const source=sheet();
      analysisBusy=true;
      try{
        report("Executando "+language+" na aba "+source.name+"…");
        if(language==="Python"){
          const result=await native().run_workbook_python(snapshot.columns,snapshot.rows,pythonEditor.value(),book.id);
          if(result.error)throw Error(result.error);
          if(result.cancelled)return report("Execução cancelada.");
          if(sheet()!==source)return;
          $("[data-book-python-output]").textContent=result.output;
          report(result.stopped==="timeout" ? "Execução encerrada após 15 segundos." :
            result.stopped==="output" ? "Saída limitada a 64 KiB." :
            result.returncode===0 ? "Python concluído." : "Python terminou com código "+result.returncode+".");
        }else{
          const result=await request("workbook",{operation:"query",...snapshot,sql:sqlEditor.value()});
          if(sheet()!==source)return;
          const table=document.createElement("table");
          const headers=table.createTHead().insertRow();
          for(const name of result.columns){
            const th=document.createElement("th");th.textContent=name;headers.append(th);
          }
          const body=table.createTBody();
          for(const values of result.rows){
            const line=body.insertRow();
            for(const value of values)line.insertCell().textContent=value ?? "NULL";
          }
          $("[data-book-query-results]").replaceChildren(table);
          lastSqlQuery=result;$("[data-book-command=sql-to-sheet]").disabled=false;
          report(result.rows.length+" linhas de resultado"+(result.limited?" · prévia limitada":""));
        }
      }finally{analysisBusy=false;}
    }
    function togglePivot(open) {
      if(!open){pivotUI.close();$("[data-book-command=pivot]").setAttribute("aria-expanded","false");schedule();return;}
      toggleAnalysis(false);
      const selected=bounds();
      const target=sheet().pivot;
      const range=target?.range||((selected[0]===selected[2]&&selected[1]===selected[3])?usedBounds():selected);
      const rangeText=range&&range[0]<range[2]?
        column(range[1])+(range[0]+1)+":"+column(range[3])+(range[2]+1):"";
      pivotUI.open({sheets:book.sheets,index,calc,address,column,rangeText});
      $("[data-book-command=pivot]").setAttribute("aria-expanded","true");
      schedule();
    }
    function createPivot() {pivotUI.apply();}
    function clearSelection() {
      applyCells(rectangle().flat().map(id=>[id,""]));
    }
    function load(value) {
      inline.hidden=true;pivotUI.close();sidebar.hidden=true;
      $("[data-book-command=pivot]").setAttribute("aria-expanded","false");
      book=value;title.value=value.title;
      undo.length=0;redo.length=0;dirty=false;
      renderTabs();choose(0);report("Salvo neste dispositivo");
    }
    async function save() {
      if(importing)throw Error("Aguarde a importação terminar.");
      if(pending)return pending;
      if(!book)return;
      finishInline();commit();
      if(!dirty)return;
      const id=book.id;
      const controls=Array.from(host.querySelectorAll("button,input,select")).filter(input=>!input.disabled);
      for(const input of controls)input.disabled=true;
      pending=request("workbook",{operation:"save",id,revision:book.revision,title:title.value,sheets:book.sheets});
      try {
        const result=await pending;
        book.revision=result.revision;book.title=result.title;title.value=result.title;dirty=false;
        native().set_dirty?.(false);
        report("Salvo neste dispositivo");
      } finally {
        pending=null;
        for(const input of controls)input.disabled=false;
      }
    }
    async function command(name) {
      if(!book||pending||importing)return;
      if(name==="save") return save();
      if(name==="edit")return editInline();
      if(name==="clear")return clearSelection();
      if(name==="select-used"){
        const used=usedBounds();
        if(!used)return report("A aba está vazia.");
        select(used[0],used[1],false,true);
        select(used[2],used[3],true);
        viewport.focus();
        return;
      }
      if(name==="pivot")return togglePivot(sidebar.hidden);
      if(name==="analysis")return toggleAnalysis(analysis.hidden);
      if(name==="close-analysis")return toggleAnalysis(false);
      if(name==="run-sql")return analyzeWorkbook("SQL");
      if(name==="run-python")return analyzeWorkbook("Python");
      if(name==="sql-to-sheet"){
        if(!lastSqlQuery)throw Error("Execute uma consulta SQL antes de criar a aba.");
        if(book.sheets.length>=20)throw Error("A pasta chegou ao limite de 20 abas.");
        const result=lastSqlQuery;
        let nameSheet="Consulta SQL",suffix=2;
        while(book.sheets.some(item=>item.name.toLowerCase()===nameSheet.toLowerCase()))
          nameSheet="Consulta SQL "+suffix++;
        const cells={},bold=[];
        const put=(r,c,value)=>{
          const raw=String(value??"");
          if(raw)cells[key(r,c)]=raw.startsWith(("="))||raw.startsWith("'")?"'"+raw:raw;
        };
        result.columns.forEach((name,c)=>{put(0,c,name);bold.push(key(0,c));});
        result.rows.forEach((values,r)=>values.forEach((value,c)=>put(r+1,c,value)));
        const previous=index,next={name:nameSheet,cells,bold};
        change(()=>{book.sheets.pop();renderTabs();choose(previous);},
          ()=>{book.sheets.push(next);renderTabs();choose(book.sheets.length-1);});
        report("Resultado SQL enviado à aba "+nameSheet+(result.limited?" (100 linhas de prévia).":"."));return;
      }
      if(name==="close-pivot")return togglePivot(false);
      if(name==="pivot-fields")return pivotUI.reload();
      if(name==="pivot-create"||name==="pivot-refresh")return createPivot();
      if(name==="undo"||name==="redo"){
        const stack=name==="undo"?undo:redo, other=name==="undo"?redo:undo;
        const item=stack.pop();
        if(item){item[name==="undo"?"back":"forward"]();other.push(item);formula.value=raw();mark();update();}
      }
      if(name==="bold"){
        const target=sheet(), before=target.bold, after=new Set(before);
        const ids=rectangle().flat();
        const remove=ids.every(id=>after.has(id));
        for(const id of ids)if(remove)after.delete(id);else after.add(id);
        change(()=>target.bold=before,()=>target.bold=[...after]);
      }
      if(name==="add"){
        if(book.sheets.length>=20)throw Error("Limite de 20 abas.");
        let n=1;
        while(book.sheets.some(item=>item.name.toUpperCase()==="PLANILHA"+n))n++;
        const previous=index, newSheet={name:"Planilha"+n,cells:{},bold:[]};
        change(()=>{book.sheets.pop();renderTabs();choose(previous);},()=>{
          book.sheets.push(newSheet);renderTabs();choose(book.sheets.length-1);
        });
      }
      if(name==="rename"){
        const target=sheet(), old=target.name;
        const next=await dialog("Renomear aba","As fórmulas que usam o nome antigo precisam ser atualizadas.",true);
        if(!next||next===old)return;
        if(next.length>31 || /[\[\]:*?/\\]/.test(next) || /^'|'$/.test(next) ||
          book.sheets.some(item=>item.name.toUpperCase()===next.toUpperCase()))throw Error("Informe um nome válido e único de até 31 caracteres.");
        const rename=value=>{target.name=value;renderTabs();};
        change(()=>rename(old),()=>rename(next));
      }
      if(name==="append"){
        commit();
        importing=true;
        let result;
        try {
          report("Importando CSV/TSV na aba atual…");
          result=await native().append_workbook_csv(book.sheets,index);
        } finally {importing=false;}
        if(result.error)throw Error(result.error);
        if(result.cancelled)return report(dirty ? "Alterações pendentes" : "Salvo neste dispositivo");
        applyCells(Object.entries(result.entries));
        report(result.added.toLocaleString("pt-BR")+" linhas lidas. Salve para manter as alterações.");
      }
      if(name==="export"){
        await save();
        const result=await native().export_workbook(book.id,book.revision,$("[data-book-format]").value.toLowerCase(),index);
        if(result.error)throw Error(result.error);
        if(result.name)report("Exportado: "+result.name);
      }
      if(name==="versions"){
        await save();
        const {versions}=await request("workbook",{operation:"versions",id:book.id});
        if(versions.length<2)return report("Apenas uma versão foi salva.");
        const selection=versions.slice(1).map((item,i)=>(i+1)+" · "+new Date(item.created_at).toLocaleString("pt-BR")).join("\n");
        const answer=await dialog("Restaurar versão","Informe o número da versão: "+selection,true);
        if(!answer)return;
        const target=versions[Number(answer)];
        if(!target || Number(answer)<1)throw Error("Número de versão inválido.");
        load(await request("workbook",{operation:"restore",id:book.id,revision:book.revision,version:target.id}));
      }
    }
    const run=name=>command(name).catch(error=>report(error.message));
    host.addEventListener("click",event=>{
      if(importing)return;
      const command=event.target.closest("[data-book-command]");
      const tab=event.target.closest("[data-index]");
      const cell=event.target.closest("[data-cell]");
      const ribbon=event.target.closest("[data-ribbon-tab]");
      if(ribbon){
        const active=ribbon.dataset.ribbonTab;
        for(const tab of host.querySelectorAll("[data-ribbon-tab]"))tab.setAttribute("aria-pressed",String(tab===ribbon));
        for(const group of host.querySelectorAll("[data-ribbon-group]"))group.hidden=active!=="home"&&active!==group.dataset.ribbonGroup;
        if(active==="analysis"&&analysis.hidden)run("analysis");
      }
      if(command)run(command.dataset.bookCommand);
      if(tab){finishInline();choose(Number(tab.dataset.index));}
      if(cell){
        finishInline();
        const id=cell.dataset.cell;
        const now=Date.now(), double=lastClick?.id===id && now-lastClick.time<350;
        lastClick=double ? null : {id,time:now};
        select(...id.split(",").map(Number),event.shiftKey);viewport.focus();
        if(double){
          if(sheet().pivot&&Number(id.split(",")[0])>0&&Number(id.split(",")[1])>0) {
            togglePivot(true);pivotUI.drillAt(id);
          }else editInline();
        }
      }
    },{signal});
    viewport.addEventListener("dblclick",event=>{
      const cell=event.target.closest("[data-cell]");
      if(cell&&inline.hidden){
        select(...cell.dataset.cell.split(",").map(Number));
        if(sheet().pivot){
          const [r,c]=cell.dataset.cell.split(",").map(Number);
          if(r>0&&c>0) {
            if(!pivotUI.isOpen())togglePivot(true);
            pivotUI.drillAt(cell.dataset.cell);return;
          }
        }
        editInline();
      }
    },{signal});
    inline.addEventListener("blur",()=>finishInline(),{signal});
    inline.addEventListener("input",()=>native().set_dirty?.(true),{signal});
    inline.addEventListener("keydown",event=>{
      event.stopPropagation();
      if(event.isComposing||!["Escape","Enter","Tab"].includes(event.key))return;
      event.preventDefault();
      finishInline(event.key!=="Escape");
      viewport.focus();
      if(event.key==="Enter")select(row+(event.shiftKey?-1:1),col,false,true);
      if(event.key==="Tab")select(row,col+(event.shiftKey?-1:1),false,true);
    },{signal});
    viewport.addEventListener("scroll",schedule,{signal,passive:true});
    window.addEventListener("resize",schedule,{signal});
    title.addEventListener("input",mark,{signal});
    formula.addEventListener("input",mark,{signal});
    formula.addEventListener("blur",commit,{signal});
    formula.addEventListener("keydown",event=>{
      if(event.isComposing || !["Enter","Tab","Escape"].includes(event.key))return;
      event.preventDefault();
      if(event.key==="Escape")formula.value=raw();
      else commit();
      viewport.focus();
      if(event.key==="Enter")select(row+1,col,false,true);
      if(event.key==="Tab")select(row,col+(event.shiftKey?-1:1),false,true);
    },{signal});
    coord.addEventListener("keydown",event=>{
      if(event.key!=="Enter")return;
      const target=address(coord.value.trim());
      if(!target)return report("Endereço inválido.");
      select(...target,false,true);viewport.focus();
    },{signal});
    viewport.addEventListener("contextmenu",event=>{
      const cell=event.target.closest("[data-cell]"),heading=event.target.closest("[data-book-col]");
      if(!cell&&!heading)return;
      event.preventDefault();finishInline();commit();
      let r=row,c=col;
      if(cell){
        [r,c]=cell.dataset.cell.split(",").map(Number);
        const extent=bounds();
        if(r<extent[0]||r>extent[2]||c<extent[1]||c>extent[3])select(r,c);
      }
      if(heading)c=Number(heading.dataset.bookCol);
      typesUI.open({event,row:r,col:c,header:!!heading});
    },{signal});
    viewport.addEventListener("keydown",event=>{
      if(event.isComposing||pending||importing)return;
      if(event.key==="ContextMenu"||(event.shiftKey&&event.key==="F10")){
        event.preventDefault();typesUI.open({event,row,col,header:false});return;
      }
      const move={ArrowUp:[-1,0],ArrowDown:[1,0],ArrowLeft:[0,-1],ArrowRight:[0,1],
        Enter:[event.shiftKey?-1:1,0],Tab:[0,event.shiftKey?-1:1]}[event.key];
      if(event.ctrlKey||event.metaKey){
        const name=event.key.toLowerCase();
        if(name==="z"||name==="y"){event.preventDefault();run(name==="y"||event.shiftKey?"redo":"undo");}
        return;
      }
      if(move){event.preventDefault();select(row+move[0],col+move[1],event.shiftKey&&event.key.startsWith("Arrow"),true);}
      else if(event.key==="Delete"||event.key==="Backspace"){
        event.preventDefault();
        try {clearSelection();} catch(error){report(error.message);}
      } else if(event.key==="F2"){event.preventDefault();editInline();}
      else if(!event.altKey&&event.key.length===1){event.preventDefault();editInline(event.key);}
    },{signal});
    for(const type of ["copy","cut","paste"]) viewport.addEventListener(type,event=>{
      if(event.target===inline||!event.clipboardData||pending||importing)return;
      event.preventDefault();
      try {
        if(type==="paste"){
          const text=event.clipboardData.getData("text/plain");
          if(text.length>1000000)throw Error("A colagem ultrapassa 1 MB.");
          const rows=text.replace(/\r\n/g,"\n").replace(/\n$/,"").split("\n");
          const entries=rows.flatMap((line,r)=>line.split("\t").map((value,c)=>{
            if(row+r>=ROWS||col+c>=COLS||value.length>8192)throw Error("A colagem ultrapassa os limites da planilha.");
            return [key(row+r,col+c),value];
          }));
          if(entries.length>50000)throw Error("A colagem ultrapassa 50 mil células.");
          applyCells(entries);
        }else{
          const rows=rectangle();
          event.clipboardData.setData("text/plain",rows.map(line=>line.map(id=>sheet().cells[id] || "").join("\t")).join("\n"));
          if(type==="cut")applyCells(rows.flat().map(id=>[id,""]));
        }
      }catch(error){report(error.message);}
    },{signal});
    signal.addEventListener("abort",()=>cancelAnimationFrame(frame),{once:true});
    return {load,save,report,id:()=>book.id};
  }
  window.OpenDocWorkbook={create};
})();
