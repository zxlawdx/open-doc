"use strict";
(() => {
  const ROWS=10000, COLS=100;
  const key=(r,c)=>r+","+c;
  function create({host,request,dialog,signal,loadCodeEditors,settings,persist,onDirty}) {
    const {address,column,evaluate}=window.OpenDocWorkbookFormula;
    const $=selector=>host.querySelector(selector);
    const viewport=$("[data-book-scroll]"), space=$("[data-book-space]");
    const title=$("[data-book-title]"), formula=$("[data-book-formula]");
    const coord=$("[data-book-address]"), tabs=$("[data-book-tabs]"), status=$("[data-book-status]");
    const inline=$("[data-book-inline]");
    const analysis=$("[data-book-analysis]"), analysisButton=$("[data-book-command=analysis]");
    let WIDTH=112, HEIGHT=28, GUTTER=52, zoom=settings.workbook_zoom ?? 100;
    const workspace=window.OpenDocGridWorkspace;
    workspace.ribbon(host,signal,tab=>{if(tab==="code"&&analysis.hidden)run("analysis");});
    const syncSplitter=workspace.splitter(analysis,signal,schedule);
    let sqlEditor, pythonEditor, notebook, analysisLoading, analysisBusy=false, lastSchema,lastSqlQuery=null,analysisGeneration=0;
    const undo=[], redo=[], pivotExtents=new WeakMap();
    let book, lastClick, index=0, row=0, col=0, anchor=[0,0], calc, frame, dirty=false, pending, importing=false;
    const pythonPackages=window.OpenDocPythonPackages.create({host:$("[data-python-packages]"),request,project:()=>book?.id,signal});
    const sheet=()=>book.sheets[index];
    const raw=()=>sheet().cells[key(row,col)] || "";
    const native=()=>window.pywebview.api;
    const notifyDirty=value=>onDirty?onDirty(value):native().set_dirty?.(value);
    function mark() {
      dirty=true;
      notifyDirty(true);
      report("Alterações pendentes");
    }
    function report(message) {status.textContent=message;}
    function applyPivot(output,target,sourceName){
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
    }
    const pivotUI=window.OpenDocWorkbookPivotUI.create({host,signal,onReport:report,
      onCancel:()=>togglePivot(false),onApply:applyPivot});

    const typesUI=window.OpenDocWorkbookTypes.create({host,signal,
      getState:()=>({sheet:sheet(),bounds:bounds(),rangeLabel:rangeAddress(bounds()),report}),
      change:(target,before,after)=>change(()=>{target.types=before;},()=>{target.types=after;}),
      onCommand:(name,position)=>{
        if(name.endsWith("row"))select(position.row,col);
        if(name.endsWith("column"))select(row,position.col);
        viewport.focus();run(name);
      }

    });
    const drawings=window.OpenDocWorkbookObjects.create({host,viewport,signal,request,dialog,report,
      getState:()=>({sheet:sheet(),bookId:book.id,index,row,col,bounds:bounds(),calc,scale:WIDTH/112,gutter:GUTTER,cellHeight:HEIGHT,busy:Boolean(pending||importing),idle:async()=>{if(pending)await pending;}}),
      change:(target,before,after)=>change(()=>{if(before===undefined)delete target.objects;else target.objects=before;},()=>{target.objects=after;})});
    function controls() {
      coord.value=anchor[0]===row&&anchor[1]===col?column(col)+(row+1):rangeAddress(bounds());
      if(document.activeElement!==formula) formula.value=raw();
      $("[data-book-command=undo]").disabled=!undo.length;
      $("[data-book-command=redo]").disabled=!redo.length;
      const style=sheet().styles?.[key(row,col)]||{};
      for(const button of host.querySelectorAll("[data-book-command][aria-pressed]")){
        const name=button.dataset.bookCommand;
        if(["italic","underline","strike","border","wrap"].includes(name))button.setAttribute("aria-pressed",String(Boolean(style[name])));
        if(name.startsWith("align-"))button.setAttribute("aria-pressed",String(style.align===name.slice(6)));
      }
      for(const field of host.querySelectorAll("select[data-book-style]"))
        field.value=style[field.dataset.bookStyle]??"";
      $("[data-book-command=bold]").setAttribute("aria-pressed",String(sheet().bold.includes(key(row,col))));
      for(const button of tabs.children) button.setAttribute("aria-pressed",String(+button.dataset.index===index));
    }
    function draw() {
      frame=undefined;
      if (!book || host.hidden) return;
      drawings.sync();
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
      const pivot=sheet().pivot;
      let extent=pivotExtents.get(sheet().cells);
      if(pivot&&!extent){
        extent=[-1,-1];
        for(const id of Object.keys(sheet().cells)){
          const [r,c]=id.split(",").map(Number);
          extent[0]=Math.max(extent[0],r);extent[1]=Math.max(extent[1],c);
        }
        pivotExtents.set(sheet().cells,extent);
      }
      const [pivotBottom,pivotRight]=extent||[-1,-1];
      for(let r=firstRow;r<endRow;r++) {
        const line=document.createElement("div");
        line.setAttribute("role","row");
        line.setAttribute("aria-rowindex",String(r+1));
        const heading=item("book-heading",left,(r+1)*HEIGHT,GUTTER,r+1);
        if(r>=selection[0]&&r<=selection[2])heading.classList.add("book-heading-selected");
        heading.dataset.bookRow=String(r);heading.setAttribute("role","rowheader");
        line.append(heading);
        for(let c=firstCol;c<endCol;c++) {
          const id=key(r,c);
          const kind=typesUI.typeFor(sheet(),r,c),formatted=typesUI.show(calc(index,r,c),kind);
          const cell=item("book-cell",GUTTER+c*WIDTH,(r+1)*HEIGHT,WIDTH,formatted.text);
          if(!formatted.valid){cell.classList.add("book-type-error");
            cell.title="Valor incompatível com "+kind+" · original: "+(sheet().cells[id]||"");}
          else if(kind!=="auto")cell.title="Tipo: "+kind+" · original: "+(sheet().cells[id]||"");
          if(pivot&&r<=pivotBottom&&c<=pivotRight){
            cell.classList.add("book-pivot-cell");cell.title=formatted.text;
            if(r===0)cell.classList.add("book-pivot-header");
            else if(bold.has(key(r,1)))cell.classList.add("book-pivot-total");
            if(c===0)cell.classList.add("book-pivot-label");
            if(r===pivotBottom)cell.classList.add("book-pivot-bottom");
            if(c===pivotRight)cell.classList.add("book-pivot-right");
          }
          cell.dataset.cell=id;
          cell.setAttribute("role","gridcell");
          cell.setAttribute("aria-colindex",String(c+1));
          const style=sheet().styles?.[id];
          if(style){
            cell.style.fontFamily=style.family||"";
            cell.style.fontSize=style.size ? style.size*(HEIGHT/28)+"pt" : "";
            cell.style.fontStyle=style.italic?"italic":"";
            cell.style.textDecoration=[style.underline?"underline":"",style.strike?"line-through":""].join(" ");
            if(style.color || style.fill){
              cell.classList.add("book-authored-color");
              cell.style.color=style.color||"var(--color-paper-ink)";
              cell.style.backgroundColor=style.fill||"var(--color-paper)";
            }
            cell.style.textAlign=style.align||"";
            if(style.border)cell.classList.add("book-bordered");
            if(style.wrap)cell.classList.add("book-wrapped");
          }
          if(bold.has(id))cell.classList.add("bold");
          if(r===row&&c===col)cell.classList.add("active");
          if(r>=selection[0]&&r<=selection[2]&&c>=selection[1]&&c<=selection[3]){
            cell.classList.add("selected");
            cell.setAttribute("aria-selected","true");
          }
          const tool=sheet().cell_tools?.[id];
          if(tool){
            if(tool.comment){cell.classList.add('book-commented');cell.title=(cell.title||formatted.text)+' — '+tool.comment;}
            if(tool.hyperlink){const link=document.createElement('a');link.href=tool.hyperlink;link.target='_blank';link.rel='noopener noreferrer';link.textContent=formatted.text||tool.hyperlink;cell.replaceChildren(link);}
            if(tool.checkbox){const input=document.createElement('input');input.type='checkbox';input.dataset.bookCheckbox=id;input.checked=['true','1','sim'].includes(String(calc(index,r,c)).toLowerCase());input.setAttribute('aria-label','Marcar '+column(c)+(r+1));cell.replaceChildren(input);}
            if(tool.sparkline)cell.replaceChildren(window.OpenDocWorkbookObjects.sparklineSvg(tool.sparkline,{calc,index}));
            if(tool.choices){const select=document.createElement('select');select.dataset.bookChoice=id;select.setAttribute('aria-label','Opções de '+column(c)+(r+1));
              const current=String(calc(index,r,c));
              for(const value of [...new Set(['',...tool.choices,...(tool.choices.includes(current)?[]:[current])])]){const option=document.createElement('option');option.value=value;option.textContent=value;select.append(option);}
              select.value=current;cell.replaceChildren(select);}
          }
          line.append(cell);
        }
        fragment.append(line);
      }
      for(let c=firstCol;c<endCol;c++){
        const heading=item("book-heading",GUTTER+c*WIDTH,top,WIDTH,column(c));
        if(c>=selection[1]&&c<=selection[3])heading.classList.add("book-heading-selected");
        heading.setAttribute("role","columnheader");
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
      if(recalculate){
        pivotExtents.delete(sheet().cells);
        calc=evaluate(book.sheets);updateSchema();analysisGeneration++;
        if(lastSqlQuery){
          lastSqlQuery=null;$("[data-book-query-results]").replaceChildren();
          $("[data-book-command=sql-to-sheet]").disabled=true;
        }
      }
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
      index=next;lastClick=null;
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
      notifyDirty(dirty);
    }
    function positionInline() {
      inline.style.left=GUTTER+col*WIDTH+"px";
      inline.style.top=(row+1)*HEIGHT+"px";
      inline.style.width=WIDTH+"px";
    }
    function resizeGrid(value) {
      const scale=value/100;
      const left=viewport.scrollLeft/WIDTH, top=viewport.scrollTop/HEIGHT;
      WIDTH=Math.round(112*scale);HEIGHT=Math.round(28*scale);GUTTER=Math.round(52*scale);
      viewport.style.setProperty("--book-cell-height",HEIGHT+"px");
      viewport.style.setProperty("--book-grid-font",Math.round(13*scale)+"px");
      space.style.width=GUTTER+COLS*WIDTH+"px";
      space.style.height=(ROWS+1)*HEIGHT+"px";
      viewport.scrollLeft=left*WIDTH;
      viewport.scrollTop=top*HEIGHT;
      if(!inline.hidden)positionInline();
      schedule();
    }
    function editInline(initial=raw()) {
      if(!inline.hidden||pending||importing)return;
      select(row,col,false,true);
      positionInline();
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
        notebook?.activate(columns);
      }
    }
    async function toggleAnalysis(open) {
      analysis.hidden=!open;
      if(!open)notebook?.collapse();
      syncSplitter();
      analysisButton.setAttribute("aria-expanded",String(open));
      schedule();
      if(!open)return;
      togglePivot(false);
      if(!analysisLoading)analysisLoading=(async()=>{
        await loadCodeEditors();
        const createEditor=window.OpenDocCodeEditor.create;
        sqlEditor=createEditor({field:$("#book-sql"),language:"sql",request,signal,project:()=>book?.id,run:()=>run("run-sql")});
        pythonEditor=createEditor({field:$("#book-python"),language:"python",request,signal,
          signature:$("[data-book-signature]"),run:()=>run("run-python"),project:()=>book?.id});
        notebook=window.OpenDocCodeNotebook.create({panel:analysis,signal,request,
          project:()=>book?.id,onLayout:syncSplitter,execute:async(language,code)=>{
            if(analysisBusy)throw Error("Já existe uma execução em andamento.");
            finishInline();commit();
            const snapshot=worksheetSnapshot(),generation=analysisGeneration;
            analysisBusy=true;
            try{
              const result=language==="python"
                ?await native().run_workbook_python(snapshot.columns,snapshot.rows,code,book.id)
                :await request("workbook",{operation:"query",...snapshot,sql:code});
              if(generation!==analysisGeneration)throw Error("A origem mudou durante a execução.");
              return result;
            }finally{analysisBusy=false;}
          }});
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
      const source=sheet(),generation=analysisGeneration;
      analysisBusy=true;
      try{
        report("Executando "+language+" na aba "+source.name+"…");
        if(language==="Python"){
          pythonEditor.remember();
          const result=await native().run_workbook_python(snapshot.columns,snapshot.rows,pythonEditor.value(),book.id);
          if(result.error)throw Error(result.error);
          if(result.cancelled)return report("Execução cancelada.");
          if(generation!==analysisGeneration)return report("A origem mudou durante a execução. Execute novamente.");
          $("[data-book-python-output]").textContent=result.output;
          report(result.stopped==="timeout" ? "Execução encerrada após 15 segundos." :
            result.stopped==="output" ? "Saída limitada a 64 KiB." :
            result.returncode===0 ? "Python concluído." : "Python terminou com código "+result.returncode+".");
        }else{
          sqlEditor.remember();
          const result=await request("workbook",{operation:"query",...snapshot,sql:sqlEditor.value()});
          if(generation!==analysisGeneration)return report("A origem mudou durante a execução. Execute novamente.");
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
      if(open&&pivotUI.isOpen())return;
      if(!open){
        pivotUI.close();
        $("[data-book-command=pivot]").setAttribute("aria-expanded","false");
        schedule();return;
      }
      finishInline();commit();typesUI.close();
      toggleAnalysis(false);
      const selected=bounds();
      const target=sheet().pivot;
      const range=target?.range||((selected[0]===selected[2]&&selected[1]===selected[3])?usedBounds():selected);
      const rangeText=range&&range[0]<range[2]?rangeAddress(range):"";
      pivotUI.open({sheets:book.sheets,index,calc,address,column,rangeText});
      $("[data-book-command=pivot]").setAttribute("aria-expanded","true");
      schedule();
    }
    function rangeAddress([top,left,bottom,right]) {
      return column(left)+(top+1)+":"+column(right)+(bottom+1);
    }
    function createPivot() {pivotUI.apply();}
    function quickPivot() {
      finishInline();commit();
      const source=sheet(),sourceIndex=index,range=bounds();
      const output=window.OpenDocWorkbookPivot.quickBuild({source,sourceIndex,range,
        read:(r,c)=>calc(sourceIndex,r,c)});
      applyPivot(output,null,source.name);
      report("Tabela dinâmica criada de "+rangeAddress(range)+" em nova aba. Use Tabela dinâmica para ajustar os campos.");
    }
    function clearSelection() {
      applyCells(rectangle().flat().map(id=>[id,""]));
    }
    function load(value) {
      inline.hidden=true;pivotUI.close();
      $("[data-book-command=pivot]").setAttribute("aria-expanded","false");
      book=value;title.value=value.title;
      undo.length=0;redo.length=0;dirty=false;notifyDirty(false);
      resizeGrid(zoom);renderTabs();choose(0);report("Salvo neste dispositivo");
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
        notifyDirty(false);
        report("Salvo neste dispositivo");
      } finally {
        pending=null;
        for(const input of controls)input.disabled=false;
      }
    }
    function insertSparklines(){
      const target=sheet(),[top,left,bottom,right]=bounds();
      if(top===bottom&&left===right||right+1>=COLS)throw Error('Selecione ao menos dois valores e deixe uma coluna livre à direita.');
      const before=target.cell_tools,after={...before},kind=$('[data-book-spark-kind]').value;
      const groups=left===right?[[top,left,bottom,right]]:Array.from({length:bottom-top+1},(_,i)=>[top+i,left,top+i,right]);
      for(const range of groups){const id=key(range[0],right+1);
        if(target.cells[id]||before?.[id]?.checkbox||before?.[id]?.choices||before?.[id]?.hyperlink)throw Error('As células à direita precisam estar vazias, sem outro controle.');
        after[id]={...before?.[id],sparkline:{kind,range}};
      }
      change(()=>{if(before===undefined)delete target.cell_tools;else target.cell_tools=before;},()=>{target.cell_tools=after;});
      select(top,right+1,false,true);
    }
    async function configureCellTools(name){
      const target=sheet(),ids=rectangle().flat(),before=target.cell_tools,after={...before};
      if(name==='clear-tools'){
        for(const id of ids)delete after[id];
        change(()=>{if(before===undefined)delete target.cell_tools;else target.cell_tools=before;},()=>{target.cell_tools=after;});return;
      }
      let value;
      if(name==='checkbox')value=!ids.every(id=>before?.[id]?.checkbox);
      else{
        const labels={choices:'Opções separadas por ponto e vírgula',comment:'Comentário',hyperlink:'Endereço HTTP, HTTPS ou mailto'};
        const current=before?.[ids[0]]?.[name];
        value=await dialog(labels[name],name==='choices'?'Exemplo: Pendente; Em andamento; Concluído. Esvazie para remover.':'Esvazie o campo para remover.',true,null,{label:labels[name]+' ',type:'text',initial:Array.isArray(current)?current.join('; '):current||''});
        if(value===null||value===false||target!==sheet())return;
        if(name==='choices'&&value){value=value.split(';').map(v=>v.trim()).filter(Boolean);
          if(!value.length||value.length>50||new Set(value).size!==value.length||value.some(v=>/[",\r\n]/.test(v))||value.join(',').length>250)throw Error('Use até 50 opções únicas sem vírgulas ou aspas, com até 250 caracteres no total.');}
        if(name==='hyperlink'&&value){const url=new URL(value);if(!['http:','https:','mailto:'].includes(url.protocol))throw Error('Use HTTP, HTTPS ou mailto.');}
        if(name==='comment'&&value.length>4000)throw Error('Comentário deve ter até 4.000 caracteres.');
      }
      const oldCells=target.cells,newCells={...oldCells};
      for(const id of ids){
        const entry={...before?.[id]};
        if(value&&(!Array.isArray(value)||value.length))entry[name]=value;else delete entry[name];
        if(name==='checkbox'&&value){
          if(oldCells[id]&&!['true','false','1','0','sim','não'].includes(oldCells[id].toLowerCase()))throw Error('Caixas de seleção exigem células vazias ou valores booleanos.');
          delete entry.choices;delete entry.sparkline;if(!oldCells[id])newCells[id]='FALSE';
        }
        if(name==='choices'&&value){delete entry.checkbox;delete entry.sparkline;}
        if(Object.keys(entry).length)after[id]=entry;else delete after[id];
      }
      change(()=>{if(before===undefined)delete target.cell_tools;else target.cell_tools=before;target.cells=oldCells;},()=>{target.cell_tools=after;target.cells=newCells;});
    }
    async function command(name) {
      if(!book||pending||importing)return;
      if(name==='sparkline')return insertSparklines();
      if(['checkbox','choices','comment','hyperlink','clear-tools'].includes(name))return configureCellTools(name);
      if(name==="image"||name==="chart"||name==="shape")return drawings.command(name);
      if(name==="save") return save();
      if(name==="add-tab"||name==="rename-tab")return command(name.slice(0,-4));
      if(["copy","cut","paste","paste-values"].includes(name))return transfer(name);
      if(name==="types")return typesUI.open({row,col});
      if(["insert-row","delete-row","insert-column","delete-column"].includes(name))
        return changeStructure(name);
      if(name==="sort-asc"||name==="sort-desc")return sortSelection(name==="sort-desc");
      if(name==="fill-down")return fillValues();
      if(name==="pivot-builder"||name==="pivot-chart"){
        togglePivot(true);
        if(name==="pivot-chart"){
          const mode=$("[data-pivot-chart]");mode.value="bar";mode.dispatchEvent(new Event("change",{bubbles:true}));
        }
        return;
      }
      if(name==="grid"){
        const enabled=viewport.classList.toggle("book-no-grid");
        $("[data-book-command=grid]").setAttribute("aria-pressed",String(!enabled));
        return;
      }
      if(name==="find"){
        const target=sheet();
        const search=await dialog("Localizar na aba","Informe o texto a localizar.",true);
        if(!search||target!==sheet())return;
        const matches=Object.keys(target.cells).map(id=>id.split(",").map(Number)).sort((a,b)=>a[0]-b[0]||a[1]-b[1])
          .filter(([r,c])=>String(calc(index,r,c)).toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR")));
        const next=matches.find(([r,c])=>r>row||(r===row&&c>col))||matches[0];
        if(!next)return report("Nenhuma correspondência.");
        select(...next,false,true);viewport.focus();return;
      }
      if(name.startsWith("function-")){
        const fn=name.slice(9).toUpperCase();
        const [r,c,r1,c1]=bounds();
        const range=column(c)+(r+1)+":"+column(c1)+(r1+1);
        if(r!==r1||c!==c1){
          if(r1+1>=ROWS)throw Error("Não há linha livre abaixo da seleção.");
          select(r1+1,c,false,true);editInline("="+fn+"("+range+")");
        }else editInline("="+fn+"(");
        return;
      }
      if(name.startsWith("align-"))return styleSelection("align",name.slice(6));
      if(["italic","underline","strike","border","wrap"].includes(name))return styleSelection(name);
      if(name==="clear-style")return styleSelection(null);
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
      if(name==="pivot-quick")return quickPivot();
      if(name==="pivot")return togglePivot(!pivotUI.isOpen());
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
      if(command)run(command.dataset.bookCommand);
      if(tab){finishInline();choose(Number(tab.dataset.index));}
      const rowHeading=event.target.closest("[data-book-row]"),colHeading=event.target.closest("[data-book-col]");
      if(rowHeading||colHeading){
        finishInline();commit();
        if(rowHeading){
          const r=Number(rowHeading.dataset.bookRow),start=event.shiftKey?anchor[0]:r;
          select(start,0);select(r,COLS-1,true);
        }else{
          const c=Number(colHeading.dataset.bookCol),start=event.shiftKey?anchor[1]:c;
          select(0,start);select(ROWS-1,c,true);
        }
        viewport.focus();
      }
      if(event.target.matches('[data-book-checkbox],[data-book-choice]'))return;
      if(cell){
        if(skipClick){skipClick=false;return;}
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
    let drag=null,skipClick=false;
    viewport.addEventListener("pointerdown",event=>{
      const cell=event.target.closest("[data-cell]");
      if(event.button!==0||!cell||pending||importing)return;
      skipClick=false;
      drag={id:cell.dataset.cell,pointer:event.pointerId,extend:event.shiftKey,moved:false};
    },{signal});
    window.addEventListener("pointermove",event=>{
      if(!drag||drag.pointer!==event.pointerId)return;
      const cell=document.elementFromPoint(event.clientX,event.clientY)?.closest("[data-cell]");
      if(!cell||!viewport.contains(cell)||(!drag.moved&&cell.dataset.cell===drag.id))return;
      if(!drag.moved){
        finishInline();commit();select(...drag.id.split(",").map(Number),drag.extend);
        drag.moved=true;viewport.focus();
      }
      select(...cell.dataset.cell.split(",").map(Number),true);
    },{signal});
    function stopDrag(event){
      if(drag?.pointer===event.pointerId){skipClick=drag.moved;drag=null;}
    }
    window.addEventListener("pointerup",stopDrag,{signal});
    window.addEventListener("pointercancel",stopDrag,{signal});
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
    host.addEventListener('change',event=>{
      const field=event.target,id=field.dataset.bookCheckbox||field.dataset.bookChoice;
      if(!id||pending||importing)return;
      const value=field.dataset.bookCheckbox?(field.checked?'TRUE':'FALSE'):field.value;
      select(...id.split(',').map(Number));applyCells([[id,value]]);
    },{signal});
    inline.addEventListener("blur",()=>finishInline(),{signal});
    inline.addEventListener("input",()=>notifyDirty(true),{signal});
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
      lastClick=null;finishInline();commit();
      const targets=coord.value.trim().split(":").map(address);
      if(targets.length>2||targets.some(target=>!target))return report("Endereço ou intervalo inválido.");
      select(...targets[0],false,true);
      if(targets[1])select(...targets[1],true,true);
      viewport.focus();
    },{signal});
    viewport.addEventListener("contextmenu",event=>{
      const cell=event.target.closest("[data-cell]"),heading=event.target.closest("[data-book-col]");
      const rowHeading=event.target.closest("[data-book-row]");
      if(!cell&&!heading&&!rowHeading)return;
      event.preventDefault();finishInline();commit();
      let r=row,c=col;
      if(cell){
        [r,c]=cell.dataset.cell.split(",").map(Number);
        const extent=bounds();
        if(r<extent[0]||r>extent[2]||c<extent[1]||c>extent[3])select(r,c);
      }
      if(heading){c=Number(heading.dataset.bookCol);select(r,c);}
      if(rowHeading){
        r=Number(rowHeading.dataset.bookRow);select(r,0);select(r,COLS-1,true);
      }
      typesUI.open({event,row:r,col:c,header:!!heading,rowHeader:!!rowHeading});
    },{signal});
    viewport.addEventListener("keydown",event=>{
      if(event.isComposing||pending||importing||event.target.matches('[data-book-checkbox],[data-book-choice]'))return;
      lastClick=null;
      if(event.key==="ContextMenu"||(event.shiftKey&&event.key==="F10")){
        event.preventDefault();typesUI.open({event,row,col,header:false});return;
      }
      const move={ArrowUp:[-1,0],ArrowDown:[1,0],ArrowLeft:[0,-1],ArrowRight:[0,1],
        Enter:[event.shiftKey?-1:1,0],Tab:[0,event.shiftKey?-1:1]}[event.key];
      if(event.ctrlKey||event.metaKey){
        const name=event.key.toLowerCase();
        if(name==="a"){event.preventDefault();select(0,0);select(ROWS-1,COLS-1,true);return;}
        if(move&&event.key.startsWith("Arrow")){
          event.preventDefault();
          const [dr,dc]=move;
          const occupied=(r,c)=>Boolean(sheet().cells[key(r,c)]);
          let r=row,c=col;
          const inside=(r,c)=>r>=0&&r<ROWS&&c>=0&&c<COLS;
          const contiguous=inside(r+dr,c+dc)&&occupied(r,c)&&occupied(r+dr,c+dc);
          while(inside(r+dr,c+dc)){
            r+=dr;c+=dc;
            if(contiguous){if(!inside(r+dr,c+dc)||!occupied(r+dr,c+dc))break;}
            else if(occupied(r,c))break;
          }
          select(r,c,event.shiftKey,true);return;
        }
        if(name==="f"){event.preventDefault();run("find");}
        if(name==="z"||name==="y"){event.preventDefault();run(name==="y"||event.shiftKey?"redo":"undo");}
        return;
      }
      if(event.key==="Escape"){formula.focus();return;}
      if(move){event.preventDefault();select(row+move[0],col+move[1],event.shiftKey&&event.key.startsWith("Arrow"),true);}
      else if(event.key==="Delete"||event.key==="Backspace"){
        event.preventDefault();
        try {clearSelection();} catch(error){report(error.message);}
      } else if(event.key==="F2"){event.preventDefault();editInline();}
      else if(!event.altKey&&event.key.length===1){event.preventDefault();editInline(event.key);}
    },{signal});
    function changeStructure(name) {
      const isColumn=name.endsWith("column"),insert=name.startsWith("insert");
      const target=sheet(),position=isColumn?col:row,limit=isColumn?COLS:ROWS;
      // Moving a reference without migrating its formula or pivot metadata could
      // silently change a result. Allow this operation on plain workbooks only.
      if(book.sheets.some(item=>item.pivot||item.objects?.some(obj=>obj.type==='chart')||Object.values(item.cell_tools||{}).some(tool=>tool.sparkline)||Object.values(item.cells).some(value=>value.startsWith("="))))
        throw Error("A estrutura só pode ser alterada em pastas sem fórmulas e sem tabelas dinâmicas.");
      const move=index=>{
        if(index<position)return index;
        if(!insert&&index===position)return null;
        const next=index+(insert?1:-1);
        if(next>=limit)throw Error("A última posição está em uso. Remova o conteúdo antes de inserir.");
        return next;
      };
      const cellAddress=id=>{
        const [r,c]=id.split(",").map(Number),next=move(isColumn?c:r);
        return next===null?null:isColumn?key(r,next):key(next,c);
      };
      const remap=(values,addressOf)=>Object.fromEntries(Object.entries(values||{}).flatMap(([id,value])=>{
        const next=addressOf(id);
        return next===null?[]:[[next,value]];
      }));
      const before={cells:target.cells,bold:target.bold,styles:target.styles,types:target.types,cell_tools:target.cell_tools};
      const after={
        cells:remap(target.cells,cellAddress),
        bold:target.bold.map(cellAddress).filter(id=>id!==null),
        styles:target.styles&&remap(target.styles,cellAddress),
        cell_tools:target.cell_tools&&remap(target.cell_tools,cellAddress),
        types:target.types&&{cells:remap(target.types.cells,cellAddress),
          columns:isColumn?remap(target.types.columns,id=>move(Number(id))):target.types.columns},
      };
      change(()=>Object.assign(target,before),()=>Object.assign(target,after));
      report((isColumn?"Coluna":"Linha")+(insert?" inserida.":" excluída.")+" Ctrl+Z para desfazer.");
    }
    function fillValues() {
      const range=rectangle(),source=range[0].map(id=>{
        const [r,c]=id.split(",").map(Number);
        const value=String(calc(index,r,c)??"");
        if(/^#(?:REF|CICLO|FÓRMULA|LIMITE|VALOR|DIV)/.test(value))throw Error("Corrija o erro na célula de origem.");
        return /^[=']/.test(value)?"'"+value:value;
      });
      applyCells(range.slice(1).flatMap(line=>line.map((id,c)=>[id,source[c]])));
    }
    function sortSelection(descending) {
      const range=rectangle(),target=sheet();
      if(range.length<2)throw Error("Selecione pelo menos duas linhas de dados, sem o cabeçalho.");
      if(range.some(line=>line.some(id=>target.cells[id]?.startsWith("="))))
        throw Error("A ordenação de células com fórmulas ainda não está disponível.");
      const sortColumn=col-bounds()[1];
      const compare=new Intl.Collator("pt-BR",{numeric:true,sensitivity:"base"}).compare;
      const sorted=range.map(line=>{
        const [r,c]=line[sortColumn].split(",").map(Number);
        return {line,value:calc(index,r,c)};
      }).sort((a,b)=>{
        if(a.value===""||b.value==="")return Number(a.value==="")-Number(b.value==="");
        const order=typeof a.value==="number"&&typeof b.value==="number"?a.value-b.value:compare(String(a.value),String(b.value));
        return descending?-order:order;
      });
      const before={cells:target.cells,bold:target.bold,styles:target.styles,types:target.types,cell_tools:target.cell_tools};
      const bold=new Set(target.bold),nextBold=new Set(bold);
      const cells={...target.cells},styles=target.styles&&{...target.styles};
      const cellTypes=target.types&&{...target.types.cells},cellTools=target.cell_tools&&{...target.cell_tools};
      const copy=(to,from,dest,origin)=>{
        if(!dest)return;
        if(Object.prototype.hasOwnProperty.call(origin||{},from))dest[to]=origin[from];
        else delete dest[to];
      };
      range.forEach((line,r)=>line.forEach((to,c)=>{
        const from=sorted[r].line[c];
        copy(to,from,cells,target.cells);copy(to,from,styles,target.styles);
        copy(to,from,cellTypes,target.types?.cells);copy(to,from,cellTools,target.cell_tools);
        const spark=cellTools?.[to]?.sparkline,sourceRow=Number(from.split(',')[0]);
        if(spark&&spark.range[0]===sourceRow&&spark.range[2]===sourceRow&&spark.range[1]>=bounds()[1]&&spark.range[3]<=bounds()[3]){
          const destinationRow=Number(to.split(',')[0]);
          cellTools[to]={...cellTools[to],sparkline:{...spark,range:[destinationRow,spark.range[1],destinationRow,spark.range[3]]}};
        }
        if(bold.has(from))nextBold.add(to);else nextBold.delete(to);
      }));
      const after={cells,bold:[...nextBold],styles,cell_tools:cellTools,types:target.types&&{...target.types,cells:cellTypes}};
      change(()=>Object.assign(target,before),()=>Object.assign(target,after));
    }
    let copiedRange;
    function selectionText(calculated=false) {
      return rectangle().map(line=>line.map(id=>{
        if(!calculated)return sheet().cells[id]||"";
        const [r,c]=id.split(",").map(Number),value=String(calc(index,r,c)??"");
        return value.startsWith("=")||value.startsWith("'")?"'"+value:value;
      }).join("\t")).join("\n");
    }
    function pasteText(text,valuesOnly=false) {
      if(text.length>1000000)throw Error("A colagem ultrapassa 1 MB.");
      const entries=text.replace(/\r\n/g,"\n").replace(/\n$/,"").split("\n").flatMap((line,r)=>
        line.split("\t").map((value,c)=>{
          if(valuesOnly&&value.startsWith("="))value="'"+value;
          if(row+r>=ROWS||col+c>=COLS||value.length>8192)throw Error("A colagem ultrapassa os limites da planilha.");
          return [key(row+r,col+c),value];
        }));
      if(entries.length>50000)throw Error("A colagem ultrapassa 50 mil células.");
      applyCells(entries);
    }
    function remember(text) {
      copiedRange={text,values:selectionText(true)};
    }
    async function transfer(name) {
      finishInline();commit();
      if(name==="cut"||name==="copy"){
        const source=sheet(),entries=rectangle().flat(),text=selectionText();
        remember(text);
        if(navigator.clipboard?.writeText){
          try {await navigator.clipboard.writeText(text);}
          catch {report("Copiado para a área de transferência do Open Doc.");}
        }
        if(name==="cut"&&source===sheet())applyCells(entries.map(id=>[id,""]));
        return;
      }
      const source=sheet(),position=key(row,col);
      let text;
      try {text=await navigator.clipboard?.readText();} catch { /* Use the local clipboard if denied. */ }
      if(source!==sheet()||position!==key(row,col)||host.hidden)return;
      text=text??copiedRange?.text;
      if(text===undefined)return report("Use Ctrl+V para colar da área de transferência do sistema.");
      const valuesOnly=name==="paste-values";
      pasteText(valuesOnly&&copiedRange?.text===text?copiedRange.values:text,valuesOnly);
    }
    for(const type of ["copy","cut","paste"])viewport.addEventListener(type,event=>{
      if(event.target===inline||!event.clipboardData||pending||importing)return;
      event.preventDefault();
      try{
        if(type==="paste"){
          const image=Array.from(event.clipboardData.files||[]).find(file=>/^image\/(png|jpeg|jpg|webp)$/.test(file.type));
          if(image){drawings.addImage(image).catch(error=>report(error.message));return;}
          pasteText(event.clipboardData.getData("text/plain"));
        }
        else{
          const text=selectionText();remember(text);
          event.clipboardData.setData("text/plain",text);
          if(type==="cut")clearSelection();
        }
      }catch(error){report(error.message);}
    },{signal});
    viewport.addEventListener('dragover',event=>{if(Array.from(event.dataTransfer?.types||[]).includes('Files'))event.preventDefault();},{signal});
    viewport.addEventListener('drop',event=>{
      const files=Array.from(event.dataTransfer?.files||[]).filter(file=>/^image\/(png|jpeg|jpg|webp)$/.test(file.type)||/\.(png|jpe?g|webp)$/i.test(file.name));
      if(!files.length)return;event.preventDefault();
      if(pending||importing)return;
      const cell=event.target.closest('[data-cell]');if(cell)select(...cell.dataset.cell.split(',').map(Number));
      (async()=>{for(const file of files)await drawings.addImage(file);})().catch(error=>report(error.message));
    },{signal});
    function styleSelection(property,value) {
      const target=sheet(),before=target.styles,oldBold=target.bold;
      const after={...before},ids=rectangle().flat();
      const next=value??!ids.every(id=>after[id]?.[property]);
      for(const id of ids){
        const style={...after[id]};
        if(!property)delete after[id];
        else{
          if(next)style[property]=next;else delete style[property];
          if(Object.keys(style).length)after[id]=style;else delete after[id];
        }
      }
      const remove=new Set(ids);
      change(()=>{target.styles=before;target.bold=oldBold;},()=>{
        target.styles=after;
        if(!property)target.bold=oldBold.filter(id=>!remove.has(id));
      });
    }
    host.addEventListener("change",event=>{
      const field=event.target;
      try{
        if(field.dataset.bookStyle){
          styleSelection(field.dataset.bookStyle,field.dataset.bookStyle==="size"?Number(field.value):field.value);
        }
      }catch(error){report(error.message);}
    },{signal});
    signal.addEventListener("abort",()=>cancelAnimationFrame(frame),{once:true});
    return {load,save,report,id:()=>book.id,value:()=>zoom,set(value){
      zoom=value;
      resizeGrid(value);
      persist({workbook_zoom:value}).catch(error=>report(error.message));
    }};
  }
  window.OpenDocWorkbook={create};
})();
