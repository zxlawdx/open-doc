"use strict";
(() => {
  const ROWS=10000, COLS=100, WIDTH=112, HEIGHT=28, GUTTER=52;
  const key=(r,c)=>r+","+c;
  function create({host,request,dialog,signal}) {
    const {address,column,evaluate}=window.OpenDocWorkbookFormula;
    const $=selector=>host.querySelector(selector);
    const viewport=$("[data-book-scroll]"), space=$("[data-book-space]");
    const title=$("[data-book-title]"), formula=$("[data-book-formula]");
    const coord=$("[data-book-address]"), tabs=$("[data-book-tabs]"), status=$("[data-book-status]");
    const undo=[], redo=[];
    let book, lastClick, index=0, row=0, col=0, anchor=[0,0], calc, frame, dirty=false, pending, importing=false;
    const sheet=()=>book.sheets[index];
    const raw=()=>sheet().cells[key(row,col)] || "";
    const native=()=>window.pywebview.api;
    function mark() {
      dirty=true;
      native().set_dirty?.(true);
      report("Alterações pendentes");
    }
    function report(message) {status.textContent=message;}
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
          const cell=item("book-cell",GUTTER+c*WIDTH,(r+1)*HEIGHT,WIDTH,calc(index,r,c));
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
      for(let c=firstCol;c<endCol;c++)fragment.append(item("book-heading",GUTTER+c*WIDTH,top,WIDTH,column(c)));
      fragment.append(item("book-heading book-corner",left,top,GUTTER,""));
      space.replaceChildren(fragment);
    }
    function schedule() {if(frame===undefined)frame=requestAnimationFrame(draw);}
    function update(recalculate=true) {
      if(recalculate)calc=evaluate(book.sheets);
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
      select(0,0);update();viewport.focus();
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
    function load(value) {
      book=value;title.value=value.title;
      undo.length=0;redo.length=0;dirty=false;
      renderTabs();choose(0);report("Salvo neste dispositivo");
    }
    async function save() {
      if(importing)throw Error("Aguarde a importação terminar.");
      if(pending)return pending;
      if(!book)return;
      commit();
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
      if(tab)choose(Number(tab.dataset.index));
      if(cell){
        const id=cell.dataset.cell;
        const now=Date.now(), double=lastClick?.id===id && now-lastClick.time<350;
        lastClick=double ? null : {id,time:now};
        select(...id.split(",").map(Number),event.shiftKey);viewport.focus();
        if(double){formula.focus();formula.select();}
      }
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
    viewport.addEventListener("keydown",event=>{
      if(event.isComposing||pending||importing)return;
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
        try {applyCells(rectangle().flat().map(id=>[id,""]));} catch(error){report(error.message);}
      } else if(event.key==="F2"){formula.focus();formula.select();}
      else if(!event.altKey&&event.key.length===1){event.preventDefault();formula.focus();formula.value=event.key;mark();}
    },{signal});
    for(const type of ["copy","cut","paste"]) viewport.addEventListener(type,event=>{
      if(!event.clipboardData||pending||importing)return;
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
