/* Native editable charts: semantic data + SVG preview; never a chart screenshot.
 * The server exports the same categories/values to OOXML chart + embedded XLSX.
 */
"use strict";
(() => {
  const SVG="http://www.w3.org/2000/svg";
  const PALETTES={
    blue:["#004AC6","#6A9EFF","#90C2FF","#274F98","#AFCBFF"],
    green:["#2B886A","#72C3A0","#A2DEC5","#14634B","#D0F0DD"],
    orange:["#F07938","#FFC16D","#BE4F2E","#EACB90","#F9DFCA"],
    contrast:["#004AC6","#B64264","#267D4D","#D18919","#784FC5"]
  };
  const TITLES={bar:"Barras",line:"Linhas",pie:"Pizza"};
  function valid(kind,categories,values){
    if(!TITLES[kind])throw Error("Tipo de gráfico inválido.");
    if(!Array.isArray(categories)||!Array.isArray(values)
      ||categories.length<1||categories.length>24||categories.length!==values.length)
      throw Error("Use de 1 a 24 linhas de dados no gráfico.");
    if(categories.some(value=>typeof value!=="string"||!value.trim()||value.length>60))
      throw Error("Informe rótulos de categoria com até 60 caracteres.");
    if(values.some(value=>typeof value!=="number"||!Number.isFinite(value)||Math.abs(value)>100000000))
      throw Error("Valores numéricos devem estar entre -100 milhões e 100 milhões.");
    if(kind==="pie"&&(values.some(value=>value<0)||!values.some(value=>value>0)))
      throw Error("Gráficos de pizza exigem valores não negativos e pelo menos um positivo.");
  }
  function node(tag,attrs,text){
    const el=document.createElementNS(SVG,tag);
    for(const [key,value] of Object.entries(attrs||{}))el.setAttribute(key,String(value));
    if(text!=null)el.textContent=String(text);
    return el;
  }
  function text(svg,x,y,value,options={}){
    const el=node("text",{x,y,"font-size":options.size||11,fill:options.fill||"#43546B",
      "text-anchor":options.anchor||"middle","font-family":"Arial, sans-serif"},value);
    svg.append(el);return el;
  }
  class ChartPreview{
    static render(chart){
      const el=node("svg",{viewBox:"0 0 420 240",role:"img",
        "aria-label":"Gráfico "+TITLES[chart.chart_type||"bar"]+": "+(chart.chart_title||"sem título")});
      el.classList.add("slide-chart-preview");
      const cats=chart.chart_categories||[],vals=chart.chart_values||[];
      const kind=chart.chart_type||"bar";
      const colors=PALETTES[chart.chart_palette]||PALETTES.blue;
      el.append(node("rect",{x:0,y:0,width:420,height:240,fill:"#FFFFFF"}));
      if(chart.chart_title)text(el,210,19,chart.chart_title,{size:14,fill:"#192B40"});
      if(!cats.length)return el;
      const bottom=205,top=38,left=45,right=398,plotH=bottom-top,plotW=right-left;
      if(kind==="pie"){
        const total=vals.reduce((a,b)=>a+b,0);
        if(total<=0)return el;
        let angle=-Math.PI/2;const cx=167,cy=122,r=75;
        vals.forEach((v,i)=>{
          if(v<=0)return;
          const sweep=2*Math.PI*v/total,finish=angle+sweep;
          const x1=cx+r*Math.cos(angle),y1=cy+r*Math.sin(angle);
          const x2=cx+r*Math.cos(finish),y2=cy+r*Math.sin(finish);
          const d=v===total
            ? "M "+cx+" "+(cy-r)+" A "+r+" "+r+" 0 1 1 "+cx+" "+(cy+r)
              +" A "+r+" "+r+" 0 1 1 "+cx+" "+(cy-r)+" Z"
            : "M "+cx+" "+cy+" L "+x1+" "+y1+" A "+r+" "+r+" 0 "
              +(sweep>Math.PI?1:0)+" 1 "+x2+" "+y2+" Z";
          el.append(node("path",{d,fill:colors[i%colors.length],stroke:"#FFF","stroke-width":1.5}));
          angle=finish;
        });
        cats.slice(0,9).forEach((label,i)=>{
          el.append(node("rect",{x:263,y:47+i*19,width:10,height:10,fill:colors[i%colors.length]}));
          text(el,279,56+i*19,label.slice(0,18),{size:11,anchor:"start"});
        });
        return el;
      }
      const min=Math.min(0,...vals),max=Math.max(0,...vals);
      const span=Math.max(1,max-min),axisY=top+(max/span)*plotH;
      for(let tick=0;tick<=4;tick++){
        const y=top+(tick/4)*plotH;
        el.append(node("line",{x1:left,y1:y,x2:right,y2:y,stroke:"#E0E7EF","stroke-width":1}));
        const amount=max-span*tick/4;
        text(el,left-6,y+4,Number(amount.toFixed(1)).toLocaleString("pt-BR"),{
          size:9,anchor:"end"
        });
      }
      el.append(node("line",{x1:left,y1:axisY,x2:right,y2:axisY,stroke:"#8697A9","stroke-width":1.4}));
      const toY=value=>top+(max-value)/span*plotH;
      const centers=cats.map((_,i)=>left+(i+.5)*plotW/cats.length);
      if(kind==="bar"){
        const barW=Math.max(3,Math.min(42,(plotW/cats.length)*.58));
        vals.forEach((v,i)=>{
          const y=toY(v);
          el.append(node("rect",{x:centers[i]-barW/2,y:Math.min(y,axisY),
            width:barW,height:Math.max(1,Math.abs(axisY-y)),fill:colors[i%colors.length]}));
        });
      }else{
        const d=vals.map((v,i)=>(i?"L ":"M ")+centers[i]+" "+toY(v)).join(" ");
        el.append(node("path",{d,stroke:colors[0],fill:"none",
          "stroke-linejoin":"round","stroke-linecap":"round","stroke-width":3}));
        vals.forEach((v,i)=>el.append(node("circle",{
          cx:centers[i],cy:toY(v),r:4,fill:colors[0],stroke:"#FFF","stroke-width":1.5
        })));
      }
      cats.forEach((label,i)=>text(el,centers[i],227,label.slice(0,9),{size:10}));
      return el;
    }
  }
  class ChartInspector{
    static mount(container,chart,commit,status,signal){
      const section=document.createElement("section");section.className="slide-chart-data";
      section.setAttribute("aria-label","Editar dados do gráfico");
      const title=document.createElement("h4");title.textContent="Dados editáveis do gráfico";section.append(title);
      const controls=document.createElement("div");controls.className="slide-chart-options";
      const choice=(label,entries,current,action)=>{
        const wrapper=document.createElement("label");wrapper.textContent=label;
        const select=document.createElement("select");
        select.setAttribute("aria-label",label);
        for(const [value,text] of entries){
          const option=document.createElement("option");option.value=value;option.textContent=text;select.append(option);
        }
        select.value=current;select.addEventListener("change",()=>action(select.value),{signal});
        wrapper.append(select);controls.append(wrapper);
      };
      choice("Tipo de gráfico",Object.entries(TITLES),chart.chart_type||"bar",type=>{
        try{valid(type,chart.chart_categories,chart.chart_values);
          commit({chart_type:type});}catch(error){status(error.message);}
      });
      choice("Paleta do gráfico",[
        ["blue","Azul"],["green","Verde"],["orange","Laranja"],["contrast","Contraste"]
      ],chart.chart_palette||"blue",value=>commit({chart_palette:value}));
      const name=document.createElement("label");name.textContent="Título do gráfico";
      const input=document.createElement("input");input.type="text";input.maxLength=160;
      input.value=chart.chart_title||"";input.setAttribute("aria-label","Título do gráfico");
      input.addEventListener("change",()=>commit({chart_title:input.value}),{signal});
      name.append(input);controls.append(name);section.append(controls);
      const caption=document.createElement("p");caption.className="slide-chart-hint";
      caption.textContent="Edite cada categoria e seu valor. Os dados são exportados como gráfico e planilha editáveis no PPTX.";
      section.append(caption);
      const table=document.createElement("table");table.className="slide-chart-grid";
      table.setAttribute("aria-label","Tabela dos dados do gráfico");
      const head=document.createElement("thead");head.innerHTML="<tr><th>Categoria</th><th>Valor</th><th></th></tr>";
      const body=document.createElement("tbody");table.append(head,body);
      chart.chart_categories.forEach((category,index)=>{
        const tr=document.createElement("tr"),catTd=document.createElement("td"),valTd=document.createElement("td"),
          delTd=document.createElement("td");
        const cat=document.createElement("input");cat.type="text";cat.maxLength=60;cat.value=category;
        cat.setAttribute("aria-label","Categoria "+(index+1));
        const val=document.createElement("input");val.type="number";val.step="any";
        val.min=chart.chart_type==="pie"?"0":"-100000000";val.max="100000000";
        val.value=String(chart.chart_values[index]);
        val.setAttribute("aria-label","Valor da categoria "+(index+1));
        const save=()=>{
          const cats=chart.chart_categories.slice(),values=chart.chart_values.slice();
          const numeric=Number(val.value);
          cats[index]=cat.value.trim();values[index]=numeric;
          try{valid(chart.chart_type,cats,values);
            commit({chart_categories:cats,chart_values:values});
          }catch(error){status(error.message);}
        };
        cat.addEventListener("change",save,{signal});val.addEventListener("change",save,{signal});
        const remove=document.createElement("button");remove.type="button";remove.textContent="×";
        remove.setAttribute("aria-label","Remover linha "+(index+1));remove.disabled=chart.chart_categories.length<=1;
        remove.addEventListener("click",()=>{
          const cats=chart.chart_categories.filter((_,i)=>i!==index);
          const vals=chart.chart_values.filter((_,i)=>i!==index);
          try{valid(chart.chart_type,cats,vals);
            commit({chart_categories:cats,chart_values:vals});}
          catch(error){status(error.message);}
        },{signal});
        catTd.append(cat);valTd.append(val);delTd.append(remove);
        tr.append(catTd,valTd,delTd);body.append(tr);
      });
      section.append(table);
      const add=document.createElement("button");add.type="button";add.textContent="+ Adicionar categoria";
      add.disabled=chart.chart_categories.length>=24;
      add.addEventListener("click",()=>{
        if(chart.chart_categories.length>=24)return status("Limite de 24 categorias por gráfico.");
        const categories=chart.chart_categories.concat(["Nova categoria"]);
        const values=chart.chart_values.concat([chart.chart_type==="pie"?1:0]);
        commit({chart_categories:categories,chart_values:values});
      },{signal});section.append(add);
      container.append(section);return section;
    }
  }
  window.OpenDocSlideCharts={ChartPreview,ChartInspector,valid,PALETTES};
})();
