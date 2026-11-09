"use strict";
(() => {
  const MAX_ROWS=10000, MAX_COLS=100, MAX_CELLS=50000;
  const key=(r,c)=>r+","+c;
  const blank=value=>value===null||value===undefined||String(value).trim()==="";
  const text=value=>blank(value)?"(vazio)":String(value);
  function dateGroup(value,unit){
    if(!unit||unit==="none"||blank(value))return text(value);
    let year,month,day;
    const raw=String(value).trim(),br=raw.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s|$)/),
      iso=raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:T|\s|$)/);
    if(br){[,day,month,year]=br;}else if(iso){[,year,month,day]=iso;}
    else throw Error("Agrupamento por data exige DD/MM/AAAA ou ISO 8601: "+raw.slice(0,50));
    const dt=new Date(Number(year),Number(month)-1,Number(day));
    if(dt.getFullYear()!==Number(year)||dt.getMonth()+1!==Number(month)||dt.getDate()!==Number(day))
      throw Error("Data inválida no agrupamento: "+raw.slice(0,50));
    if(unit==="year")return year;
    if(unit==="month")return month+"/"+year;
    return day+"/"+month+"/"+year;
  }
  function number(value) {
    if(typeof value==="number")return Number.isFinite(value)?value:NaN;
    if(blank(value))return NaN;
    let s=String(value).trim().replace(/[\s\u00a0]/g,"").replace(/^R\$/i,"");
    const negative=/^\(.*\)$/.test(s);
    if(negative)s=s.slice(1,-1);
    const percent=s.endsWith("%");if(percent)s=s.slice(0,-1);
    if(!/^[+-]?[\d.,]+$/.test(s))return NaN;
    if(s.includes(",")&&s.includes("."))s=s.lastIndexOf(",")>s.lastIndexOf(".")?s.replace(/\./g,"").replace(",","."):s.replace(/,/g,"");
    else if(s.includes(","))s=s.replace(",",".");
    else if(/^\d{1,3}(\.\d{3})+$/.test(s))s=s.replace(/\./g,"");
    const n=Number(s);
    return Number.isFinite(n)?(negative?-n:n)/(percent?100:1):NaN;
  }
  function getFields(source,range,read) {
    const [top,left,,right]=range;
    return Array.from({length:right-left+1},(_,i)=>{
      const c=left+i;
      return {index:c,label:String(read(top,c)||"Coluna "+(c+1)).trim(),type:source.types?.columns?.[c]||"auto"};
    });
  }
  function check(range,config,fields) {
    if(!Array.isArray(range)||range.length!==4||range.some(n=>!Number.isInteger(n))||
      range[0]<0||range[1]<0||range[2]>=MAX_ROWS||range[3]>=MAX_COLS||
      range[0]>=range[2]||range[1]>range[3]||
      (range[2]-range[0]+1)*(range[3]-range[1]+1)>MAX_CELLS)
      throw Error("Intervalo inválido: inclua cabeçalho e até 50 mil células.");
    if(!config||!Array.isArray(config.values)||!config.values.length)throw Error("Adicione pelo menos uma métrica em Valores.");
    const known=new Set(fields.map(f=>f.index));
    for(const field of [...(config.rows||[]),...(config.columns||[]),...config.values.map(v=>v.field),...(config.filters||[]).map(f=>f.field)])
      if(!known.has(Number(field)))throw Error("Um campo da tabela dinâmica não pertence à fonte.");
    if(config.values.length>12)throw Error("Use até 12 métricas por tabela.");
  }
  const allowed=new Set(["sum","average","count","distinct","min","max","median","stdev","product"]);
  function accumulator(){return {count:0,numeric:0,sum:0,product:1,min:Infinity,max:-Infinity,values:[],distinct:new Set()};}
  function add(a,value,operation,field) {
    if(blank(value))return;
    a.count++;
    const valueText=String(value);
    a.distinct.add(valueText);
    const n=number(value);
    if(!Number.isFinite(n)){
      if(["sum","average","min","max","median","stdev","product"].includes(operation))
        throw Error("O campo "+field+" contém valor não numérico: "+valueText.slice(0,70));
      return;
    }
    a.numeric++;a.sum+=n;a.product*=n;a.min=Math.min(a.min,n);a.max=Math.max(a.max,n);
    if(operation==="median"||operation==="stdev")a.values.push(n);
  }
  function result(a,operation) {
    if(!a)return null;
    if(operation==="count")return a.count;
    if(operation==="distinct")return a.distinct.size;
    if(!a.numeric)return null;
    if(operation==="sum")return a.sum;
    if(operation==="product")return a.product;
    if(operation==="average")return a.sum/a.numeric;
    if(operation==="min")return a.min;
    if(operation==="max")return a.max;
    if(operation==="median"){
      const sorted=a.values.slice().sort((x,y)=>x-y);const mid=Math.floor(sorted.length/2);
      return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;
    }
    if(operation==="stdev"){
      if(a.values.length<2)return null;
      const mean=a.sum/a.values.length;
      return Math.sqrt(a.values.reduce((sum,v)=>sum+(v-mean)**2,0)/(a.values.length-1));
    }
    throw Error("Agregação não reconhecida: "+operation);
  }
  function build({source,sourceIndex=0,range,config,read}) {
    read=read||((r,c)=>source.cells[key(r,c)]||"");
    const fields=getFields(source,range,read);
    check(range,config,fields);
    const metrics=config.values.map(v=>{
      const op=v.operation||"sum";
      if(!allowed.has(op))throw Error("Agregação inválida: "+op);
      return {field:Number(v.field),operation:op,show:v.show||"value",
        label:fields.find(f=>f.index===Number(v.field)).label,decimals:Math.max(0,Math.min(8,v.decimals===undefined?2:Number(v.decimals))),format:v.format||"number"};
    });
    const rowFields=(config.rows||[]).map(Number), colFields=(config.columns||[]).map(Number);
    const headers=fields.map(f=>f.label);
    const filters=config.filters||[],grouping=config.grouping||{},sort=config.sort||{};
    const groupValue=(r,c)=>dateGroup(read(r,c),grouping[String(c)]||"none");
    const rowKeys=new Map(),colKeys=new Map(),matrix=new Map(),rowStats=new Map(),colStats=new Map(),
      allStats=metrics.map(()=>accumulator()),drill=new Map();
    const makeStats=()=>metrics.map(()=>accumulator());
    const getStats=(map,id)=>{if(!map.has(id))map.set(id,makeStats());return map.get(id);};
    const group=ranges=>JSON.stringify(ranges.map(c=>text(read(currentRow,c))));
    let currentRow=range[0]+1,accepted=0;
    for(;currentRow<=range[2];currentRow++){
      const present=fields.some(f=>!blank(source.cells[key(currentRow,f.index)]));
      if(!present)continue;
      if(filters.some(f=>{
        const value=String(read(currentRow,Number(f.field))??"");
        return Array.isArray(f.values)&&f.values.length>0&&!f.values.includes(value);
      }))continue;
      const rvalues=rowFields.map(c=>groupValue(currentRow,c));
      const cvalues=colFields.map(c=>groupValue(currentRow,c));
      const rk=JSON.stringify(rvalues),ck=JSON.stringify(cvalues);
      if(!rowKeys.has(rk))rowKeys.set(rk,rvalues.join(" / ")||"Todos os registros");
      if(!colKeys.has(ck))colKeys.set(ck,cvalues.join(" / ")||"Total");
      const id=JSON.stringify([rk,ck]);
      if(!matrix.has(id))matrix.set(id,makeStats());
      if(!drill.has(id))drill.set(id,[]);
      drill.get(id).push(currentRow);
      const a=matrix.get(id), b=getStats(rowStats,rk), c=getStats(colStats,ck);
      metrics.forEach((v,i)=>{
        const value=read(currentRow,v.field);
        for(const target of [a[i],b[i],c[i],allStats[i]])add(target,value,v.operation,v.label);
      });
      accepted++;
    }
    if(!accepted)throw Error("Nenhum registro corresponde aos campos e filtros.");
    const columns=[...colKeys.keys()],rows=[...rowKeys.keys()];
    const collator=new Intl.Collator("pt-BR",{numeric:true,sensitivity:"base"});
    const sorter=(keys,labels,order,stats)=>{
      if(!["asc","desc","value_asc","value_desc"].includes(order))return;
      const byValue=order.startsWith("value_"),direction=order.endsWith("desc")?-1:1;
      keys.sort((a,b)=>{
        const va=byValue?result(stats.get(a)?.[0],"sum"):labels.get(a);
        const vb=byValue?result(stats.get(b)?.[0],"sum"):labels.get(b);
        const comparison=byValue ? (Number(va)||0)-(Number(vb)||0) :
          collator.compare(String(va),String(vb));
        return direction*comparison;
      });
    };
    sorter(rows,rowKeys,sort.rows,rowStats);sorter(columns,colKeys,sort.columns,colStats);
    const addTotals=colFields.length>0 && config.totals!==false;
    const width=1+columns.length*metrics.length+(addTotals?metrics.length:0);
    const height=1+rows.length+(config.totals===false?0:1);
    if(width>MAX_COLS||width*height>MAX_CELLS||height>MAX_ROWS)
      throw Error("O resultado excede 100 colunas ou 50 mil células. Reduza os campos.");
    const cells={},bold=[],dataRows=[],drillCells={};
    const labelFor=v=>v.operation==="average"?"Média":v.operation==="distinct"?"Distintos":v.operation==="sum"?"Soma":v.operation==="count"?"Contagem":v.operation==="min"?"Mín":v.operation==="max"?"Máx":v.operation==="median"?"Mediana" :v.operation==="product"?"Produto":"Desvio";
    const columnLabels=[rowFields.map(c=>fields.find(f=>f.index===c).label).join(" / ")||"Grupo"];
    for(const ck of columns)for(const m of metrics){
      columnLabels.push((colFields.length?colKeys.get(ck)+" · ":"")+labelFor(m)+" de "+m.label);
    }
    if(addTotals)for(const m of metrics)columnLabels.push("Total · "+labelFor(m)+" de "+m.label);
    function format(value,m,stats,rt,ct,gt) {
      if(value===null||!Number.isFinite(value))return "";
      if(m.show!=="value"){
        const denominator=m.show==="row_pct"?rt:m.show==="col_pct"?ct:gt;
        if(denominator===null||!Number.isFinite(denominator)||denominator===0)return "";
        return (100*value/denominator).toFixed(m.decimals)+"%";
      }
      if(m.format==="currency")return new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL",
        minimumFractionDigits:m.decimals,maximumFractionDigits:m.decimals}).format(value);
      if(m.format==="decimal")return new Intl.NumberFormat("pt-BR",{minimumFractionDigits:m.decimals,
        maximumFractionDigits:m.decimals}).format(value);
      return String(Math.round(value*1e10)/1e10);
    }
    function statText(a,m,ri,rt,ct,gt) {
      const v=result(a?.[ri],m.operation);
      return format(v,m,a,result(rt?.[ri],m.operation),result(ct?.[ri],m.operation),result(gt?.[ri],m.operation));
    }
    function write(r,c,value,emphasis=false){
      if(value!=="")cells[key(r,c)]=String(value).startsWith("=")?"'"+String(value):String(value);
      if(emphasis)bold.push(key(r,c));
    }
    columnLabels.forEach((label,c)=>write(0,c,label,true));
    for(let i=0;i<rows.length;i++){
      const rk=rows[i], values=[rowKeys.get(rk)];
      for(const ck of columns){
        const id=JSON.stringify([rk,ck]),a=matrix.get(id);
        for(let j=0;j<metrics.length;j++){
          values.push(statText(a,metrics[j],j,rowStats.get(rk),colStats.get(ck),allStats));
          drillCells[key(i+1,values.length-1)]=(drill.get(id)||[]).slice();
        }
      }
      if(addTotals)for(let j=0;j<metrics.length;j++)
        values.push(statText(rowStats.get(rk),metrics[j],j,rowStats.get(rk),null,allStats));
      values.forEach((v,c)=>write(i+1,c,v,c===0));
      dataRows.push(values);
    }
    if(config.totals!==false){
      const last=rows.length+1,total=["Total geral"];
      for(const ck of columns)for(let i=0;i<metrics.length;i++)
        total.push(statText(colStats.get(ck),metrics[i],i,null,colStats.get(ck),allStats));
      if(addTotals)for(let i=0;i<metrics.length;i++)total.push(statText(allStats,metrics[i],i,null,null,allStats));
      total.forEach((v,c)=>write(last,c,v,true));
      dataRows.push(total);
    }
    return {cells,bold,headers:columnLabels,rows:dataRows,drillCells,sourceRows:accepted,
      pivot:{source:sourceIndex,range:range.slice(),config:JSON.parse(JSON.stringify(config))}};
  }
  const api={build,getFields,number,dateGroup};
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
  if(typeof window!=="undefined")window.OpenDocWorkbookPivot=api;
})();
