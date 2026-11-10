"use strict";
(() => {
  function create({host,onApply,onReport,onCancel,signal}) {
    const panel=host.querySelector("[data-book-sidebar]");
    const $=q=>panel.querySelector(q);
    function tool(button,glyph,label){
      button.type="button";button.title=label;button.setAttribute("aria-label",label);
      button.append(window.OpenDocGridWorkspace.icon(host,glyph));
    }
    const names={rows:"Linhas",columns:"Colunas",values:"Valores",filters:"Filtros"};
    const operations=[["sum","Soma"],["average","Média"],["count","Contagem"],["distinct","Contagem distinta"],
      ["min","Mínimo"],["max","Máximo"],["median","Mediana"],["stdev","Desvio padrão"],["product","Produto"]];
    const shows=[["value","Valor"],["grand_pct","% total geral"],["row_pct","% da linha"],["col_pct","% da coluna"]];
    let context=null,settings=null,latest=null,fields=[],returnFocus;
    const empty=()=>({rows:[],columns:[],values:[],filters:[],totals:true,grouping:{},sort:{rows:"none"},chart:"table"});
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
      settings.grouping=settings.grouping||{};
      for(const k of Object.keys(settings.grouping))if(!allowed.has(Number(k)))delete settings.grouping[k];
    }
    function reload() {
      try{
        fields=engine.getFields(source(),range(),read);
        safeFields();render();
        onReport("Campos carregados: "+fields.length+".");
      }catch(error){
        latest=null;fields=[];
        $("[data-pivot-available]").replaceChildren();
        $("[data-pivot-field-count]").textContent="(0)";
        onReport(error.message);message(error.message);
      }
    }
    function message(value) {
      $("[data-book-command=pivot-create]").disabled=true;
      $("[data-book-command=pivot-refresh]").disabled=true;
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
        settings.values.push({field:f,operation:count&&numeric?"sum":"count",show:"value",decimals:2,format:"number"});
      }else if(zone==="filters"){
        if(!settings.filters.some(v=>v.field===f))settings.filters.push({field:f,values:[]});
      }else if(zone==="rows"||zone==="columns"){
        if(!settings[zone].includes(f))settings[zone].push(f);
      }
      render();
    }
    function render() {
      if(!context)return;
      const focused=document.activeElement;
      const attribute=focused?.getAttributeNames().find(name=>name.startsWith("data-pivot-"));
      const previous=attribute&&panel.contains(focused) ? focused.getAttribute(attribute) : null;
      const focusedValue=focused?.value;
      $("[data-pivot-source]").textContent="Fonte: "+source().name+" · mantenha os dados originais";
      $("[data-pivot-field-count]").textContent="("+fields.length+")";
      const list=$("[data-pivot-available]"),search=$("[data-pivot-search]").value.toLocaleLowerCase("pt-BR");
      const choicesByField=new Map(Array.from(list.querySelectorAll("[data-pivot-choice]"),
        input=>[input.dataset.pivotChoice,input.value]));
      const scrollTop=list.scrollTop,available=document.createDocumentFragment();
      for(const field of fields) {
        if(!field.label.toLocaleLowerCase("pt-BR").includes(search))continue;
        const item=document.createElement("div");item.className="pivot-v2-field";
        item.draggable=true;item.dataset.pivotField=String(field.index);item.title=field.label;
        const name=document.createElement("span");name.textContent=field.label;
        const kind=document.createElement("em");kind.textContent=field.type==="auto"?"ABC/123":field.type;
        const zone=document.createElement("select");zone.dataset.pivotChoice=String(field.index);
        zone.setAttribute("aria-label","Escolher área para "+field.label);
        choose(zone,Object.entries(names),choicesByField.get(String(field.index))||"rows");
        const button=document.createElement("button");tool(button,"add-circle","Adicionar "+field.label);
        button.dataset.pivotAdd=String(field.index);
        item.append(name,kind,zone,button);available.append(item);
      }
      list.replaceChildren(available);list.scrollTop=scrollTop;
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
          if(zone==="rows"||zone==="columns"){
            const grouping=document.createElement("select");
            grouping.dataset.pivotGroup=String(field);
            grouping.setAttribute("aria-label","Agrupar "+label(field)+" por período");
            choose(grouping,[["none","Sem agrupar"],["day","Por dia"],["month","Por mês"],["year","Por ano"]],
              settings.grouping?.[String(field)]||"none");
            chip.append(grouping);
          }
          if(zone==="values"){
            const operator=document.createElement("select");operator.dataset.pivotOp=String(i);
            operator.setAttribute("aria-label","Agregação de "+label(field));choose(operator,operations,v.operation);
            const show=document.createElement("select");show.dataset.pivotShow=String(i);
            show.setAttribute("aria-label","Mostrar como "+label(field));choose(show,shows,v.show);
            chip.append(operator,show);
            const format=document.createElement("select");
            format.dataset.pivotFormat=String(i);
            format.setAttribute("aria-label","Formato da métrica "+label(field));
            choose(format,[["number","Número original"],["decimal","Número pt-BR"],["currency","Moeda R$"]],v.format||"number");
            const decimals=document.createElement("input");
            decimals.type="number";decimals.min="0";decimals.max="8";decimals.step="1";
            decimals.value=String(v.decimals??2);
            decimals.dataset.pivotDecimals=String(i);decimals.setAttribute("aria-label","Casas decimais de "+label(field));
            decimals.title="Casas decimais (0 a 8)";
            chip.append(format,decimals);
          }
          if(zone==="filters"){
            const choices=document.createElement("div");choices.className="pivot-v2-filter-choices";
            const all=distinct(field);
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
          if(values.length>1){
            const up=document.createElement("button");tool(up,"arrow-up","Subir "+label(field));
            up.dataset.pivotMoveUp=zone+":"+i;up.disabled=i===0;
            const down=document.createElement("button");tool(down,"arrow-down","Descer "+label(field));
            down.dataset.pivotMoveDown=zone+":"+i;down.disabled=i===values.length-1;chip.append(up,down);
          }
          const remove=document.createElement("button");tool(remove,"close","Remover "+label(field));
          remove.dataset.pivotRemove=zone+":"+i;
          chip.append(remove);items.append(chip);
        });
        chips.replaceChildren(items);
      }
      $("[data-pivot-totals]").checked=settings.totals!==false;
      const subtotals=$("[data-pivot-subtotals]");
      subtotals.disabled=settings.rows.length<2;subtotals.checked=!subtotals.disabled&&settings.subtotals===true;
      $("[data-pivot-sort-rows]").value=settings.sort?.rows||"none";
      $("[data-pivot-chart]").value=settings.chart||"table";
      $("[data-book-command=pivot-refresh]").hidden=context.target===null;
      $("[data-pivot-apply-label]").textContent=context.target===null?"Criar tabela":"Aplicar alterações";
      preview();
      if(previous!==null&&!focused.isConnected){
        const replacement=Array.from(panel.querySelectorAll("["+attribute+"]")).find(el=>
          el.getAttribute(attribute)===previous&&!el.disabled&&
          (attribute!=="data-pivot-filter"||el.value===focusedValue));
        (replacement||$("[data-pivot-search]")).focus({preventScroll:true});
      }
    }
    function preview() {
      try {
        latest=engine.build({source:source(),sourceIndex:context.source,range:range(),config:settings,read});
        $("[data-book-command=pivot-create]").disabled=false;
        $("[data-book-command=pivot-refresh]").disabled=false;
        $("[data-pivot-record-count]").textContent=latest.sourceRows.toLocaleString("pt-BR")+" registros";
        if(settings.chart&&settings.chart!=="table"){
          const chart=chartOf(latest,settings.chart);
          $("[data-pivot-preview]").replaceChildren(chart);return;
        }
        const table=document.createElement("table");table.className="pivot-v2-table";
        const head=table.createTHead().insertRow();
        latest.headers.forEach(value=>{
          const th=document.createElement("th");th.textContent=value;th.title=value;head.append(th);
        });
        const body=table.createTBody();
        latest.rows.slice(0,40).forEach((cells,r)=>{
          const tr=body.insertRow();
          if(latest.summaryRows.includes(r))tr.classList.add("pivot-summary-row");
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

    function chartOf(pivot,mode){
      const box=document.createElement("div");box.className="pivot-v2-chart";
      box.setAttribute("role","img");box.setAttribute("aria-label","Gráfico "+mode+" da primeira métrica");
      const rows=pivot.rows.filter((_,index)=>!pivot.summaryRows.includes(index)).slice(0,15);
      const values=rows.map(row=>engine.number(row[1]));
      if(!rows.length||values.some(v=>!Number.isFinite(v))){
        box.textContent="Escolha uma métrica numérica para o gráfico.";return box;
      }
      const width=860,height=310,padLeft=62,padRight=20,padTop=30,padBottom=76;
      const plotW=width-padLeft-padRight,plotH=height-padTop-padBottom;
      const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
      svg.setAttribute("viewBox","0 0 "+width+" "+height);
      svg.setAttribute("role","img");svg.setAttribute("aria-label",pivot.headers[1]+" por grupo");
      const make=(tag,attributes={},value)=>{
        const node=document.createElementNS("http://www.w3.org/2000/svg",tag);
        for(const [key,val] of Object.entries(attributes))node.setAttribute(key,String(val));
        if(value!==undefined)node.textContent=value;
        svg.append(node);return node;
      };
      make("title",{},pivot.headers[1]+" — "+mode);
      make("desc",{},"Primeiros "+rows.length+" grupos; valores da primeira métrica, excluindo total geral.");
      const palette=["#2774bd","#10a7a2","#dd8f32","#7561ba","#c05e7c","#549a47"];
      const max=Math.max(0,...values),min=Math.min(0,...values),span=max-min||1;
      const y=value=>padTop+plotH-(value-min)/span*plotH;
      const numberText=n=>new Intl.NumberFormat("pt-BR",{maximumFractionDigits:2}).format(n);
      if(mode==="pie"){
        const positive=values.map(v=>Math.max(0,v)),total=positive.reduce((a,b)=>a+b,0);
        if(!total){box.textContent="Gráfico de pizza requer valores positivos.";return box;}
        const cx=width*.33,cy=height*.49,r=110;let start=-Math.PI/2;
        positive.forEach((value,i)=>{
          if(!value)return;
          const angle=(value/total)*Math.PI*2,end=start+angle;
          const startPoint=[cx+r*Math.cos(start),cy+r*Math.sin(start)];
          const endPoint=[cx+r*Math.cos(end),cy+r*Math.sin(end)];
          const full=angle>=Math.PI*2-1e-8;
          const d=full?
            "M "+cx+" "+(cy-r)+" A "+r+" "+r+" 0 1 1 "+(cx-.01)+" "+(cy-r)+" Z":
            "M "+cx+" "+cy+" L "+startPoint.join(" ")+" A "+r+" "+r+" 0 "+(angle>Math.PI?1:0)+" 1 "+endPoint.join(" ")+" Z";
          const path=make("path",{d,fill:palette[i%palette.length],stroke:"var(--color-panel)", "stroke-width":2});
          const tooltip=document.createElementNS(svg.namespaceURI,"title");tooltip.textContent=rows[i][0]+": "+numberText(value);path.append(tooltip);
          make("rect",{x:width*.6,y:30+i*21,width:12,height:12,fill:palette[i%palette.length]});
          make("text",{x:width*.6+18,y:41+i*21,"font-size":13,fill:"var(--color-text-primary)"},
            String(rows[i][0]).slice(0,32)+" — "+numberText(value));
          start=end;
        });
      }else{
        make("line",{x1:padLeft,y1:y(0),x2:width-padRight,y2:y(0),
          stroke:"var(--color-border)","stroke-width":1.3});
        const slots=plotW/rows.length,points=[];
        values.forEach((value,i)=>{
          const x=padLeft+slots*(i+.5),top=y(value);
          const label=String(rows[i][0]);
          if(mode==="bar"){
            make("rect",{x:x-slots*.32,y:Math.min(top,y(0)),width:Math.max(slots*.64,1),
              height:Math.max(1,Math.abs(y(0)-top)),fill:palette[i%palette.length],rx:2});
          }else points.push([x,top]);
          make("text",{x,y:height-padBottom+16,"font-size":10,
            "text-anchor":"middle",fill:"var(--color-text-secondary)"},label.slice(0,Math.max(8,Math.floor(70/rows.length))));
          make("text",{x,y:top-7,"font-size":10,"text-anchor":"middle",fill:"var(--color-text-primary)"},numberText(value));
        });
        if(mode==="line"&&points.length){
          make("polyline",{points:points.map(p=>p.join(",")).join(" "),fill:"none",
            stroke:palette[0],"stroke-width":2.5});
          for(const [cx,cy] of points)make("circle",{cx,cy,r:3,fill:palette[0]});
        }
        for(let j=0;j<=4;j++){
          const v=min+span*j/4;
          make("text",{x:padLeft-8,y:y(v)+4,"text-anchor":"end",
            "font-size":11,fill:"var(--color-text-secondary)"},numberText(v));
        }
      }
      box.append(svg);
      if(pivot.rows.length>16){
        const hint=document.createElement("p");hint.className="pivot-v2-message";
        hint.textContent="Exibidos os primeiros 15 grupos. A tabela preserva todos.";box.append(hint);
      }
      return box;
    }
    function drill(key) {
      const records=latest?.drillCells?.[key]||[];
      if(!records.length)return;
      const fragment=document.createDocumentFragment();
      const back=document.createElement("button");back.type="button";back.dataset.pivotBack="true";
      tool(back,"arrow-left","Voltar à prévia");back.append(document.createTextNode("Voltar à prévia"));fragment.append(back);
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
      settings.grouping=settings.grouping||{};
      settings.sort=settings.sort||{rows:"none"};
      settings.chart=settings.chart||"table";
      $("[data-pivot-range]").value=previous?
        addressString(previous.range):rangeText||"";
      $("[data-pivot-search]").value="";
      returnFocus=document.activeElement;panel.showModal();reload();$("[data-pivot-search]").focus();
    }
    function addressString(bounds){
      return context.colName(bounds[1])+(bounds[0]+1)+":"+context.colName(bounds[3])+(bounds[2]+1);
    }
    function apply(){
      if(!context||!latest)throw Error("Configure os campos e confira a prévia antes de criar.");
      const output=engine.build({source:source(),sourceIndex:context.source,range:range(),config:settings,read});
      onApply(output,context.target,source().name);
    }
    function close(){
      if(panel.open){
        panel.close();
        if(returnFocus?.isConnected) returnFocus.focus({preventScroll:true});
      }
      returnFocus=null;context=null;settings=null;latest=null;
    }
    panel.addEventListener("click",event=>{
      if(!context)return;
      const addField=event.target.closest("[data-pivot-add]");
      const remove=event.target.closest("[data-pivot-remove]");
      const up=event.target.closest("[data-pivot-move-up]");
      const down=event.target.closest("[data-pivot-move-down]");
      const movement=up||down;
      if(addField){
        const zone=panel.querySelector('[data-pivot-choice="'+addField.dataset.pivotAdd+'"]').value;
        try{add(zone,addField.dataset.pivotAdd)}catch(error){onReport(error.message);}
      }
      if(remove){
        const [zone,i]=remove.dataset.pivotRemove.split(":");
        settings[zone].splice(Number(i),1);render();
      }
      if(movement){
        const [zone,indexText]=movement.dataset[up?"pivotMoveUp":"pivotMoveDown"].split(":");
        const i=Number(indexText),j=i+(up?-1:1),items=settings[zone];
        if(j>=0&&j<items.length){[items[i],items[j]]=[items[j],items[i]];render();}
      }
      if(event.target.closest("[data-pivot-back]"))preview();
    },{signal});
    panel.addEventListener("change",event=>{
      if(!context)return;
      const el=event.target;
      if(el.matches("[data-pivot-op]"))settings.values[Number(el.dataset.pivotOp)].operation=el.value;
      else if(el.matches("[data-pivot-show]"))settings.values[Number(el.dataset.pivotShow)].show=el.value;
      else if(el.matches("[data-pivot-format]"))settings.values[Number(el.dataset.pivotFormat)].format=el.value;
      else if(el.matches("[data-pivot-decimals]")){
        const precision=Number(el.value);
        if(!Number.isInteger(precision)||precision<0||precision>8){onReport("Casas decimais: de 0 a 8.");return;}
        settings.values[Number(el.dataset.pivotDecimals)].decimals=precision;
      }else if(el.matches("[data-pivot-group]")){
        settings.grouping[String(el.dataset.pivotGroup)]=el.value;
      }else if(el.matches("[data-pivot-sort-rows]")){
        settings.sort=settings.sort||{};settings.sort.rows=el.value;
      }else if(el.matches("[data-pivot-chart]"))settings.chart=el.value;
      else if(el.matches("[data-pivot-filter]")){
        const i=Number(el.dataset.pivotFilter);
        const checks=[...panel.querySelectorAll('[data-pivot-filter="'+i+'"]')];
        const selected=checks.filter(input=>input.checked).map(input=>input.value);
        settings.filters[i].values=selected.length===checks.length?[]:
          selected.length?selected:["__OPEN_DOC_NONE_SELECTED__"];
      }else if(el.matches("[data-pivot-totals]"))settings.totals=el.checked;
      else if(el.matches("[data-pivot-subtotals]"))settings.subtotals=el.checked;
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
      if(event.key!=="Tab")return;
      const focusable=Array.from(panel.querySelectorAll("button,input,select,[tabindex]"))
        .filter(element=>!element.disabled&&element.tabIndex>=0&&element.getClientRects().length);
      const first=focusable[0],last=focusable[focusable.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    },{signal});
    panel.addEventListener("cancel",event=>{
      event.preventDefault();onCancel();
    },{signal});
    return {open,close,reload,apply,drillAt:drill,isOpen:()=>panel.open};
  }
  window.OpenDocWorkbookPivotUI={create};
})();
