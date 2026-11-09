"use strict";
(() => {
  function create({host,onApply,onReport,signal}) {
    const panel=host.querySelector("[data-book-sidebar]");
    const $=q=>panel.querySelector(q);
    const names={rows:"Linhas",columns:"Colunas",values:"Valores",filters:"Filtros"};
    const operations=[["sum","Soma"],["average","Média"],["count","Contagem"],["distinct","Contagem distinta"],
      ["min","Mínimo"],["max","Máximo"],["median","Mediana"],["stdev","Desvio padrão"]];
    const shows=[["value","Valor"],["grand_pct","% total geral"],["row_pct","% da linha"],["col_pct","% da coluna"]];
    let context=null,settings=null,latest=null,fields=[],visibleFilters=new Map();
    const empty=()=>({rows:[],columns:[],values:[],filters:[],totals:true});
    const clone=value=>JSON.parse(JSON.stringify(value));
    const engine=window.OpenDocWorkbookPivot;
    function range() {
      const value=$("[data-pivot-range]").value.trim();
      const parsed=value.split(":").map(t=>context.address(t.trim()));
      if(parsed.length!==2||parsed.some(x=>!x))throw Error("Informe um intervalo com cabeçalho (A1:D100).");
      const [start,end]=parsed;
      if(start[0]>=end[0]||start[1]>end[1])throw Error("O intervalo precisa ter cabeçalho e dados.");
      return [start[0],start[1],end[0],end[1]];
    }
    function source(){return context.sheets[context.source];}
    function read(r,c){return context.calc(context.source,r,c);}
    function choose(select,items,current) {
      for(const [value,label] of items){
        const option=document.createElement("option");option.value=value;option.textContent=label;
        select.append(option);
      }
      select.value=String(current);
    }
    function label(field){return fields.find(f=>f.index===Number(field))?.label||"Campo "+field;}
    function safeFields(){
      const allowed=new Set(fields.map(f=>f.index));
      settings.rows=settings.rows.filter(x=>allowed.has(x));
      settings.columns=settings.columns.filter(x=>allowed.has(x));
      settings.values=settings.values.filter(x=>allowed.has(x.field));
      settings.filters=settings.filters.filter(x=>allowed.has(x.field));
    }
    function reload() {
      try{
        fields=engine.getFields(source(),range(),read);
        safeFields();render();
        onReport("Campos carregados: "+fields.length+".");
      }catch(error){latest=null;onReport(error.message);message(error.message);}
    }
    function message(value) {
      const el=document.createElement("p");el.className="pivot-v2-message";el.textContent=value;
      $("[data-pivot-preview]").replaceChildren(el);
      $("[data-pivot-record-count]").textContent="Prévia indisponível";
    }
    function distinct(columnIndex) {
      const found=new Set(),values=[],bounds=range();
      for(let r=bounds[0]+1;r<=bounds[2];r++){
        const v=String(read(r,columnIndex)??"");
        if(!found.has(v)){found.add(v);values.push(v);}
        if(values.length===250)break;
      }
      return values;
    }
    function add(zone,field) {
      const f=Number(field);
      if(!fields.some(item=>item.index===f))return;
      if(zone==="values"){
        if(settings.values.length>=12)throw Error("Use no máximo 12 métricas.");
        let numeric=true,count=0;
        const limits=range();
        for(let r=limits[0]+1;r<=limits[2]&&count<25;r++){
          const value=read(r,f);
          if(value===""||value===null||value===undefined)continue;
          count++;
          if(!Number.isFinite(engine.number(value)))numeric=false;
        }
        settings.values.push({field:f,operation:count&&numeric?"sum":"count",show:"value",decimals:2});
      }else if(zone==="filters"){
        if(!settings.filters.some(v=>v.field===f))settings.filters.push({field:f,values:[]});
      }else if(zone==="rows"||zone==="columns"){
        if(!settings[zone].includes(f))settings[zone].push(f);
      }
      render();
    }
    function render() {
      if(!context)return;
      $("[data-pivot-source]").textContent="Fonte: "+source().name+" · mantenha os dados originais";
      $("[data-pivot-field-count]").textContent="("+fields.length+")";
      const list=$("[data-pivot-available]"),search=$("[data-pivot-search]").value.toLocaleLowerCase("pt-BR");
      const available=document.createDocumentFragment();
      for(const field of fields) {
        if(!field.label.toLocaleLowerCase("pt-BR").includes(search))continue;
        const item=document.createElement("div");item.className="pivot-v2-field";
        item.draggable=true;item.dataset.pivotField=String(field.index);item.title=field.label;
        const name=document.createElement("span");name.textContent=field.label;
        const kind=document.createElement("em");kind.textContent=field.type==="auto"?"ABC/123":field.type;
        const zone=document.createElement("select");zone.dataset.pivotChoice=String(field.index);
        zone.setAttribute("aria-label","Escolher área para "+field.label);
        choose(zone,Object.entries(names),"rows");
        const button=document.createElement("button");button.type="button";button.textContent="+";
        button.dataset.pivotAdd=String(field.index);button.title="Adicionar "+field.label;
        item.append(name,kind,zone,button);available.append(item);
      }
      list.replaceChildren(available);
      for(const zone of Object.keys(names)){
        const chips=$('[data-pivot-chips="'+zone+'"]'),values=settings[zone],items=document.createDocumentFragment();
        $('[data-pivot-count="'+zone+'"]').textContent=String(values.length);
        if(!values.length){
          const blank=document.createElement("div");blank.className="pivot-v2-empty";
          blank.textContent="Arraste um campo ou use o botão +.";items.append(blank);
        }
        values.forEach((v,i)=>{
          const field=typeof v==="number"?v:v.field;
          const chip=document.createElement("div");chip.className="pivot-v2-chip";
          chip.draggable=true;chip.dataset.pivotMove=zone+":"+i;
          const name=document.createElement("span");name.textContent=label(field);name.title=label(field);chip.append(name);
          if(zone==="values"){
            const operator=document.createElement("select");operator.dataset.pivotOp=String(i);
            operator.setAttribute("aria-label","Agregação de "+label(field));choose(operator,operations,v.operation);
            const show=document.createElement("select");show.dataset.pivotShow=String(i);
            show.setAttribute("aria-label","Mostrar como "+label(field));choose(show,shows,v.show);
            chip.append(operator,show);
          }
          if(zone==="filters"){
            const choices=document.createElement("div");choices.className="pivot-v2-filter-choices";
            const all=distinct(field);visibleFilters.set(i,all);
            for(const value of all.slice(0,40)){
              const entry=document.createElement("label");
              const checkbox=document.createElement("input");checkbox.type="checkbox";
              checkbox.dataset.pivotFilter=String(i);checkbox.value=value;
              checkbox.checked=!v.values.length||v.values.includes(value);
              entry.append(checkbox,document.createTextNode(value||"(vazio)"));choices.append(entry);
            }
            if(all.length>40){
              const note=document.createElement("small");note.textContent="Primeiras 40 de "+all.length+" categorias";
              choices.append(note);
            }
            chip.append(choices);
          }
          const remove=document.createElement("button");remove.type="button";remove.textContent="×";
          remove.dataset.pivotRemove=zone+":"+i;remove.title="Remover campo";
          chip.append(remove);items.append(chip);
        });
        chips.replaceChildren(items);
      }
      $("[data-pivot-totals]").checked=settings.totals!==false;
      $("[data-book-command=pivot-refresh]").hidden=context.target===null;
      $("[data-book-command=pivot-create]").textContent=context.target===null?"Criar tabela":"Aplicar alterações";
      preview();
    }
    function preview() {
      try {
        latest=engine.build({source:source(),sourceIndex:context.source,range:range(),config:settings,read});
        $("[data-pivot-record-count]").textContent=latest.sourceRows.toLocaleString("pt-BR")+" registros";
        const table=document.createElement("table");table.className="pivot-v2-table";
        const head=table.createTHead().insertRow();
        latest.headers.forEach(value=>{
          const th=document.createElement("th");th.textContent=value;th.title=value;head.append(th);
        });
        const body=table.createTBody();
        latest.rows.slice(0,40).forEach((cells,r)=>{
          const tr=body.insertRow();
          cells.forEach((value,c)=>{
            const td=document.createElement(c===0?"th":"td");td.textContent=value;td.title=String(value);
            if(c>0&&latest.drillCells[(r+1)+","+c]){
              td.dataset.pivotDrill=(r+1)+","+c;td.title="Duplo clique: registros da origem";
            }
            tr.append(td);
          });
        });
        const container=$("[data-pivot-preview]");
        container.replaceChildren(table);
        if(latest.rows.length>40){
          const more=document.createElement("p");more.className="pivot-v2-message";
          more.textContent="Prévia limitada a 40 linhas. O resultado contém todos os grupos.";
          container.append(more);
        }
      }catch(error){latest=null;message(error.message);}
    }
    function drill(key) {
      const records=latest?.drillCells?.[key]||[];
      if(!records.length)return;
      const fragment=document.createDocumentFragment();
      const back=document.createElement("button");back.type="button";back.dataset.pivotBack="true";
      back.textContent="← Voltar à prévia";fragment.append(back);
      const table=document.createElement("table");table.className="pivot-v2-table";
      const th=table.createTHead().insertRow();
      for(const field of fields){const cell=document.createElement("th");cell.textContent=field.label;th.append(cell);}
      const body=table.createTBody();
      for(const r of records.slice(0,100)){
        const tr=body.insertRow();for(const field of fields)tr.insertCell().textContent=String(read(r,field.index)??"");
      }
      fragment.append(table);$("[data-pivot-preview]").replaceChildren(fragment);
      onReport("Detalhamento: "+records.length+" registros de origem.");
    }
    function open({sheets,index,calc,address,column,rangeText}) {
      const previous=sheets[index].pivot;
      context={sheets,index,calc,address,colName:column,source:previous?.source??index,target:previous?index:null};
      settings=previous?clone(previous.config):empty();
      $("[data-pivot-range]").value=previous?
        addressString(previous.range):rangeText||"";
      $("[data-pivot-search]").value="";
      panel.hidden=false;reload();$("[data-pivot-search]").focus();
    }
    function addressString(bounds){
      return context.colName(bounds[1])+(bounds[0]+1)+":"+context.colName(bounds[3])+(bounds[2]+1);
    }
    function apply(){
      if(!context||!latest)throw Error("Configure os campos e confira a prévia antes de criar.");
      const output=engine.build({source:source(),sourceIndex:context.source,range:range(),config:settings,read});
      onApply(output,context.target,source().name);
    }
    function close(){panel.hidden=true;context=null;settings=null;latest=null;visibleFilters.clear();}
    panel.addEventListener("click",event=>{
      if(!context)return;
      const addField=event.target.closest("[data-pivot-add]");
      const remove=event.target.closest("[data-pivot-remove]");
      if(addField){
        const zone=panel.querySelector('[data-pivot-choice="'+addField.dataset.pivotAdd+'"]').value;
        try{add(zone,addField.dataset.pivotAdd)}catch(error){onReport(error.message);}
      }
      if(remove){
        const [zone,i]=remove.dataset.pivotRemove.split(":");
        settings[zone].splice(Number(i),1);render();
      }
      if(event.target.closest("[data-pivot-back]"))preview();
    },{signal});
    panel.addEventListener("change",event=>{
      if(!context)return;
      const el=event.target;
      if(el.matches("[data-pivot-op]"))settings.values[Number(el.dataset.pivotOp)].operation=el.value;
      else if(el.matches("[data-pivot-show]"))settings.values[Number(el.dataset.pivotShow)].show=el.value;
      else if(el.matches("[data-pivot-filter]")){
        const i=Number(el.dataset.pivotFilter);
        const visible=visibleFilters.get(i)||[];
        const checks=[...panel.querySelectorAll('[data-pivot-filter="'+i+'"]')];
        const selected=checks.filter(input=>input.checked).map(input=>input.value);
        settings.filters[i].values=selected.length===checks.length?[]:
          selected.length?selected:["__OPEN_DOC_NONE_SELECTED__"];
      }else if(el.matches("[data-pivot-totals]"))settings.totals=el.checked;
      else if(el.matches("[data-pivot-range]"))return reload();
      else return;
      render();
    },{signal});
    panel.addEventListener("input",event=>{
      if(event.target.matches("[data-pivot-search]"))render();
    },{signal});
    panel.addEventListener("dragstart",event=>{
      const field=event.target.closest("[data-pivot-field]");
      const move=event.target.closest("[data-pivot-move]");
      if(!field&&!move)return;
      event.dataTransfer.setData("text/plain",field?"field:"+field.dataset.pivotField:"move:"+move.dataset.pivotMove);
      event.dataTransfer.effectAllowed="move";
    },{signal});
    panel.addEventListener("dragover",event=>{
      const zone=event.target.closest("[data-pivot-zone]");
      if(zone){event.preventDefault();zone.dataset.dragover="true";}
    },{signal});
    panel.addEventListener("dragleave",event=>{
      const zone=event.target.closest("[data-pivot-zone]");
      if(zone&&!zone.contains(event.relatedTarget))delete zone.dataset.dragover;
    },{signal});
    panel.addEventListener("drop",event=>{
      const target=event.target.closest("[data-pivot-zone]");
      if(!target)return;
      event.preventDefault();delete target.dataset.dragover;
      const value=event.dataTransfer.getData("text/plain"),zone=target.dataset.pivotZone;
      try{
        if(value.startsWith("field:"))add(zone,value.slice(6));
        else if(value.startsWith("move:")){
          const [from,i]=value.slice(5).split(":");
          if(!settings[from])return;
          const item=settings[from].splice(Number(i),1)[0];
          if(item===undefined)return;
          const field=typeof item==="number"?item:item.field;
          if(from===zone){settings[zone].push(item);render();}
          else{add(zone,field);}
        }
      }catch(error){onReport(error.message);}
    },{signal});
    panel.addEventListener("dblclick",event=>{
      const target=event.target.closest("[data-pivot-drill]");
      if(target)drill(target.dataset.pivotDrill);
    },{signal});
    panel.addEventListener("keydown",event=>{
      if(event.key==="Escape"){event.stopPropagation();close();}
    },{signal});
    return {open,close,reload,apply,drillAt:drill,isOpen:()=>!panel.hidden};
  }
  window.OpenDocWorkbookPivotUI={create};
})();
