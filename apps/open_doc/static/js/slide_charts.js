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
  const TITLES={bar:"Colunas",hbar:"Barras horizontais",line:"Linhas",area:"Áreas",pie:"Pizza",combo:"Combinado"};
  function valid(kind,categories,values){
    if(!TITLES[kind])throw Error("Tipo de gráfico inválido.");
    if(!Array.isArray(categories)||!Array.isArray(values)
      ||categories.length<1||categories.length>24||categories.length!==values.length)
      throw Error("Use de 1 a 24 linhas de dados no gráfico.");
    if(categories.some(value=>typeof value!=="string"||!value.trim()||value.length>240))
      throw Error("Informe rótulos de categoria com até 240 caracteres.");
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

  /* Data and geometry stay separate: the SVG is a view of the original labels.
   * Never slice, truncate or reinterpret category strings as calendar years. */
  class ChartLayoutEngine{
    static font(chart){
      return {
        family:chart.chart_label_font||"Arial",
        size:Math.max(7,Math.min(24,Number(chart.chart_label_font_size)||12)),
        spacing:Number(chart.chart_label_letter_spacing)||0,
        color:chart.chart_label_color||"#43546B",
        bold:Boolean(chart.chart_label_bold),italic:Boolean(chart.chart_label_italic),
        align:chart.chart_label_align||"center",
        rotation:Number(chart.chart_label_rotation)||0,
        wrap:chart.chart_label_wrap!==false
      };
    }
    static measure(value,font){
      return Array.from(String(value)).reduce((w,ch)=>{
        if("ilI.,:;!| '".includes(ch))return w+font.size*.30;
        if("MW@#%".includes(ch))return w+font.size*.84;
        return w+font.size*.57;
      },0)+Math.max(0,String(value).length-1)*font.spacing;
    }
    static lines(label,width,font){
      // Respect user newlines, and split long unbreakable words without
      // throwing away letters. Break decisions are deterministic in Qt/JSDOM.
      if(!font.wrap)return String(label).split("\n");
      const lines=[];
      for(const raw of String(label).split("\n")){
        if(!raw){lines.push("");continue;}
        const words=raw.split(/(\s+)/u);
        let current="";
        const flush=()=>{if(current){lines.push(current);current="";}};
        for(const token of words){
          if(!token)continue;
          if(this.measure(current+token,font)<=width || !current){
            if(this.measure(token,font)<=width){current+=token;continue;}
            if(current)flush();
            for(const character of Array.from(token)){
              if(current&&this.measure(current+character,font)>width)flush();
              current+=character;
            }
          }else{
            flush();current=token.trimStart();
          }
        }
        flush();
      }
      return lines.length?lines:[""];
    }
    static series(chart){
      if(Array.isArray(chart.chart_series)&&chart.chart_series.length)
        return chart.chart_series.map((s,i)=>({name:s.name||"Série "+(i+1),values:s.values}));
      return [{name:"Valores",values:chart.chart_values||[]}];
    }
    static colors(chart,count){
      const pal=PALETTES[chart.chart_palette]||PALETTES.blue;
      return Array.from({length:count},(_,i)=>
        chart.chart_color_mode==="custom"&&chart.chart_item_colors?.[i]
          ?chart.chart_item_colors[i]:pal[i%pal.length]);
    }
    static format(value){
      return Number(value).toLocaleString("pt-BR",{maximumFractionDigits:2});
    }
    static percent(value,values,chart){
      if(chart.chart_percent_mode==="provided")return this.format(value)+"%";
      const sum=values.filter(n=>n>0).reduce((a,b)=>a+b,0);
      return sum>0&&value>=0?this.format(value/sum*100)+"%":"—";
    }
    static valueLabel(value,values,chart){
      const mode=chart.chart_data_labels??"percent";
      if(mode==="none")return "";
      const number=this.format(value)+(chart.chart_unit||"");
      const percent=this.percent(value,values,chart);
      return mode==="value"?number:mode==="both"?number+" ("+percent+")":percent;
    }
    static text(svg,x,y,string,font,options={}){
      const lines=Array.isArray(string)?string:[String(string)];
      const size=options.size||font.size;
      const attrs={x,y,fill:options.color||font.color,
        "font-family":font.family+", sans-serif","font-size":size,
        "font-weight":font.bold?"700":"400","font-style":font.italic?"italic":"normal",
        "letter-spacing":font.spacing,"text-anchor":options.anchor||"middle"};
      if(options.rotation)attrs.transform="rotate("+options.rotation+" "+x+" "+y+")";
      const el=node("text",attrs);
      const leading=size*1.2;
      lines.forEach((line,i)=>{
        el.append(node("tspan",{x,dy:i?leading:0},line));
      });
      const tip=node("title",{},lines.join("\n"));el.append(tip);svg.append(el);
      return el;
    }
    static make(chart,dimensions={}){
      const font=this.font(chart);
      const width=Math.max(250,Math.min(1800,Number(dimensions.width)||420));
      const originalHeight=Math.max(160,Math.min(1300,Number(dimensions.height)||240));
      const cats=chart.chart_categories||[];
      const all=this.series(chart);
      const kind=chart.chart_type||"bar";
      const palette=this.colors(chart,cats.length);
      const top=chart.chart_title?Math.max(36,font.size*2.5):15;
      const subtitle=chart.chart_subtitle||"";
      const subTop=subtitle?font.size*1.6:0;
      const titleFont={...font,size:Math.max(14,font.size*1.2),bold:true};
      const root=node("svg",{role:"img","aria-label":"Gráfico: "+(chart.chart_title||"sem título")});
      root.classList.add("slide-chart-preview");
      const background=chart.chart_background||"solid";
      root.dataset.background=background;
      if(background!=="transparent")root.append(node("rect",{
        x:0,y:0,width:"100%",height:"100%",fill:chart.chart_background_color||"#FFFFFF"}));
      if(!cats.length)return root;
      const n=cats.length;
      const margin=chart.chart_margin_mode==="custom"?Math.max(0,Number(chart.chart_margin)||0):0;
      const labelHeight=font.size*1.25;
      const numericWidth=Math.max(32,this.measure(this.format(Math.max(...all.flatMap(s=>s.values),0)),{...font,size:font.size*.83})+14);
      const left=Math.max(20+margin,numericWidth+16+margin);
      const right=16+margin;
      const isPie=kind==="pie",horizontal=kind==="hbar",scatter=kind==="scatter";
      let rotation=font.rotation;
      if(chart.chart_layout_auto!==false && !rotation &&
         !horizontal && !isPie && !scatter && n>=8)rotation=n>=14?90:45;
      const maxW=Math.max(15,(width-left-right)/n-5);
      const catLines=cats.map(c=>this.lines(c,rotation?Math.max(50,maxW*1.5):maxW,font));
      const maxLines=Math.max(1,...catLines.map(lines=>lines.length));
      const labelReserve=rotation===90?Math.min(width*.48,Math.max(...cats.map(c=>this.measure(c,font)))+18):
        rotation>0?Math.min(width*.44,maxLines*labelHeight+maxW*.7):
          maxLines*labelHeight+16;
      const legendBelow=chart.chart_legend_position==="bottom";
      const legendRight=chart.chart_legend_position==="right";
      const titleSpace=top+subTop+(chart.chart_title?14:0);
      let height=originalHeight;
      if(isPie)height=Math.max(height,Math.min(1600,titleSpace+Math.max(190,n*labelHeight*2)+20));
      else if(horizontal)height=Math.max(height,titleSpace+n*Math.max(30,maxLines*labelHeight+9)+38);
      else height=Math.max(height,titleSpace+Math.max(90,originalHeight*.33)+labelReserve+36);
      root.setAttribute("viewBox","0 0 "+width+" "+height);
      root.setAttribute("preserveAspectRatio","xMidYMid meet");
      if(chart.chart_title)this.text(root,width/2,top*.58,chart.chart_title,titleFont);
      if(subtitle)this.text(root,width/2,top+font.size*.8,subtitle,font,{size:font.size*.93});
      const colors=palette;
      if(isPie){
        const total=all[0].values.reduce((a,b)=>a+Math.max(0,b),0);
        const legendWidth=Math.min(width*.48,Math.max(120,...cats.map(c=>this.measure(c,font)+35)));
        const sideLegend=(chart.chart_legend_position||"right")!=="bottom"&&width>360;
        const radius=Math.max(40,Math.min((sideLegend?width-legendWidth:width)/2-25,(height-titleSpace)/2-18,155));
        const cx=sideLegend?(width-legendWidth)/2:width/2;
        const cy=titleSpace+Math.max(radius+12,(height-titleSpace-(sideLegend?0:n*labelHeight))/2);
        let angle=-Math.PI/2;
        all[0].values.forEach((v,i)=>{
          if(v<=0||total<=0)return;
          const sweep=v/total*Math.PI*2,next=angle+sweep;
          const x1=cx+radius*Math.cos(angle),y1=cy+radius*Math.sin(angle);
          const x2=cx+radius*Math.cos(next),y2=cy+radius*Math.sin(next);
          const path=v===total?"M "+cx+" "+(cy-radius)+" A "+radius+" "+radius+" 0 1 1 "+cx+" "+(cy+radius)+" A "+radius+" "+radius+" 0 1 1 "+cx+" "+(cy-radius)+" Z":
            "M "+cx+" "+cy+" L "+x1+" "+y1+" A "+radius+" "+radius+" 0 "+(sweep>Math.PI?1:0)+" 1 "+x2+" "+y2+" Z";
          root.append(node("path",{d:path,fill:colors[i],stroke:background==="transparent"?"none":"#FFFFFF","stroke-width":1}));
          if(chart.chart_data_labels!=="none"){
            const m=angle+sweep/2;
            this.text(root,cx+radius*.65*Math.cos(m),cy+radius*.65*Math.sin(m),
              this.valueLabel(v,all[0].values,chart),{...font,color:"#172C43",bold:true},
              {size:Math.max(8,font.size*.9)});
          }
          angle=next;
        });
        if(chart.chart_label_visible!==false){
          const x=sideLegend?width-legendWidth+18:Math.max(15,width*.08);
          let y=sideLegend?titleSpace+25:cy+radius+25;
          cats.forEach((category,i)=>{
            const lines=this.lines(category,(sideLegend?legendWidth:width*.8)-25,font);
            root.append(node("rect",{x,y:y-font.size,width:10,height:10,fill:colors[i]}));
            this.text(root,x+16,y,lines,font,{anchor:"start"});
            y+=Math.max(labelHeight,lines.length*labelHeight)+10;
          });
          if(y+12>height)root.setAttribute("viewBox","0 0 "+width+" "+(y+12));
        }
        return root;
      }
      const allValues=all.flatMap(s=>s.values);
      const min=Math.min(0,...allValues),max=Math.max(0,...allValues);
      const span=Math.max(1,max-min);
      const bottom=horizontal?height-30:height-labelReserve-14;
      const plotTop=titleSpace+10;
      const plotBottom=Math.max(plotTop+60,bottom);
      const plotLeft=horizontal?Math.min(width*.55,Math.max(left,...cats.map(c=>Math.min(width*.5,this.measure(c,font)+18)))):left;
      const plotRight=width-right-(legendRight?Math.min(110,width*.22):0);
      const pw=Math.max(50,plotRight-plotLeft),ph=Math.max(40,plotBottom-plotTop);
      if(horizontal){
        const step=ph/n;
        const barH=Math.max(4,Math.min(30,step*.70));
        const baseline=plotLeft+(0-min)/span*pw;
        all.forEach((series,s)=>{
          series.values.forEach((value,i)=>{
            const x=plotLeft+(value-min)/span*pw;
            const h=barH/all.length;
            root.append(node("rect",{x:Math.min(x,baseline),y:plotTop+(i+.5)*step-barH/2+s*h,
              width:Math.max(1,Math.abs(x-baseline)),height:h,fill:colors[i]}));
            const label=this.valueLabel(value,series.values,chart);
            if(label)this.text(root,Math.max(x,baseline)+4,plotTop+(i+.5)*step+font.size*.32,
              label,font,{size:Math.max(8,font.size*.85),anchor:"start"});
          });
        });
        if(chart.chart_label_visible!==false)cats.forEach((cat,i)=>{
          const lines=this.lines(cat,Math.max(65,plotLeft-25),font);
          const y=plotTop+(i+.5)*step-(lines.length-1)*labelHeight/2;
          this.text(root,plotLeft-9,y,lines,font,{anchor:"end"});
        });
        return root;
      }
      const baseline=plotTop+(max/span)*ph;
      const toY=value=>plotTop+(max-value)/span*ph;
      for(let tick=0;tick<=4;tick++){
        const y=plotTop+tick/4*ph;
        root.append(node("line",{x1:plotLeft,y1:y,x2:plotRight,y2:y,stroke:"#C6D0D9","stroke-width":.8}));
        this.text(root,plotLeft-5,y+font.size*.3,this.format(max-span*tick/4),font,
          {anchor:"end",size:Math.max(8,font.size*.82)});
      }
      root.append(node("line",{x1:plotLeft,y1:baseline,x2:plotRight,y2:baseline,
        stroke:"#8697A9","stroke-width":1.2}));
      const centers=cats.map((_,i)=>plotLeft+(i+.5)*pw/n);
      const seriesCount=all.length;
      all.forEach((series,s)=>{
        const points=series.values.map((v,i)=>[centers[i],toY(v)]);
        const color=seriesCount===1?colors[0]:colors[s%colors.length];
        if(kind==="bar"||kind==="combo"&&s===0){
          const widthForBar=Math.max(2,Math.min(52,pw/n*.67)/seriesCount);
          series.values.forEach((v,i)=>{
            const y=toY(v),x=centers[i]-(widthForBar*seriesCount)/2+s*widthForBar;
            root.append(node("rect",{x,y:Math.min(y,baseline),width:widthForBar*.95,
              height:Math.max(1,Math.abs(y-baseline)),fill:seriesCount===1?colors[i]:color}));
          });
        }else{
          const d=points.map(([x,y],i)=>(i?"L":"M")+x+" "+y).join(" ");
          if(kind==="area"){
            root.append(node("path",{d:d+" L"+points[points.length-1][0]+" "+baseline+
              " L"+points[0][0]+" "+baseline+" Z",fill:color,"fill-opacity":.22}));
          }
          root.append(node("path",{d,fill:"none",stroke:color,"stroke-width":2.5}));
          points.forEach(([x,y])=>root.append(node("circle",{cx:x,cy:y,r:3.3,fill:color})));
        }
        series.values.forEach((value,i)=>{
          const label=this.valueLabel(value,series.values,chart);
          if(label)this.text(root,centers[i],toY(value)-8-s*font.size*1.1,
            label,font,{size:Math.max(8,font.size*.84)});
        });
      });
      if(chart.chart_label_visible!==false)catLines.forEach((lines,i)=>{
        const x=centers[i],y=plotBottom+font.size*1.25;
        this.text(root,x,y,lines,font,{rotation});
      });
      if(seriesCount>1||legendBelow||legendRight){
        let lx=legendRight?plotRight+5:plotLeft,ly=legendRight?plotTop+12:height-9;
        all.forEach((s,i)=>{
          root.append(node("rect",{x:lx,y:ly-font.size*.8,width:9,height:9,
            fill:colors[i%colors.length]}));
          this.text(root,lx+14,ly,s.name,font,{size:Math.max(8,font.size*.82),anchor:"start"});
          if(legendRight)ly+=font.size*1.5;else lx+=this.measure(s.name,font)+31;
        });
      }
      return root;
    }
  }
  class ChartPreview{
    static render(chart,dimensions={}){
      return ChartLayoutEngine.make(chart,dimensions);
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
      const head=document.createElement("thead");head.innerHTML="<tr><th>Categoria</th><th>Valor</th><th>Cor</th><th></th></tr>";
      const body=document.createElement("tbody");table.append(head,body);
      chart.chart_categories.forEach((category,index)=>{
        const tr=document.createElement("tr"),catTd=document.createElement("td"),valTd=document.createElement("td"),
          colorTd=document.createElement("td"),delTd=document.createElement("td");
        const cat=document.createElement("textarea");cat.rows=2;cat.maxLength=240;cat.value=category;
        cat.setAttribute("aria-label","Categoria "+(index+1));
        const val=document.createElement("input");val.type="number";val.step="any";
        val.min=chart.chart_type==="pie"?"0":"-100000000";val.max="100000000";
        val.value=String(chart.chart_values[index]);
        val.setAttribute("aria-label","Valor da categoria "+(index+1));
        const save=()=>{
          const cats=chart.chart_categories.slice(),values=chart.chart_values.slice();
          const numeric=Number(val.value);
          cats[index]=cat.value.trim();values[index]=numeric;
          try{
            valid(chart.chart_type,cats,values);
            const patch={chart_categories:cats,chart_values:values};
            if(chart.chart_series?.length){
              patch.chart_series=chart.chart_series.map((series,at)=>({
                ...series,values:at===0?values.slice():series.values.slice()
              }));
            }
            commit(patch);
          }catch(error){status(error.message);}
        };
        cat.addEventListener("change",save,{signal});val.addEventListener("change",save,{signal});
        if(chart.chart_series?.length>1){
          for(let seriesIndex=1;seriesIndex<chart.chart_series.length;seriesIndex++){
            const series=chart.chart_series[seriesIndex];
            const extra=document.createElement("input");extra.type="number";
            extra.step="any";extra.value=String(series.values[index]);
            extra.setAttribute("aria-label",series.name+" — categoria "+(index+1));
            extra.title=series.name;
            extra.addEventListener("change",()=>{
              const numeric=Number(extra.value);
              if(!Number.isFinite(numeric))return status("Valor numérico inválido.");
              const next=chart.chart_series.map((item,s)=>({
                ...item,values:item.values.slice()
              }));
              next[seriesIndex].values[index]=numeric;
              commit({chart_series:next});
            },{signal});
            valTd.append(extra);
          }
        }
        const remove=document.createElement("button");remove.type="button";remove.textContent="×";
        remove.setAttribute("aria-label","Remover linha "+(index+1));remove.disabled=chart.chart_categories.length<=1;
        remove.addEventListener("click",()=>{
          const cats=chart.chart_categories.filter((_,i)=>i!==index);
          const vals=chart.chart_values.filter((_,i)=>i!==index);
          try{
            valid(chart.chart_type,cats,vals);
            const patch={chart_categories:cats,chart_values:vals};
            if(chart.chart_series?.length)patch.chart_series=chart.chart_series.map(s=>({
              ...s,values:s.values.filter((_,i)=>i!==index)
            }));
            const colors=(chart.chart_item_colors||[]).filter((_,i)=>i!==index);
            if(colors.length)patch.chart_item_colors=colors;
            commit(patch);
          }
          catch(error){status(error.message);}
        },{signal});
        const color=document.createElement("input");color.type="color";
        color.value=ChartLayoutEngine.colors(chart,chart.chart_categories.length)[index];
        color.setAttribute("aria-label","Cor da categoria "+(index+1));
        color.title="Cor individual de "+category;
        color.addEventListener("change",()=>{
          const colors=ChartLayoutEngine.colors(chart,chart.chart_categories.length);
          colors[index]=color.value.toUpperCase();
          commit({chart_color_mode:"custom",chart_item_colors:colors});
        },{signal});
        catTd.append(cat);valTd.append(val);colorTd.append(color);delTd.append(remove);
        tr.append(catTd,valTd,colorTd,delTd);body.append(tr);
      });
      section.append(table);
      const add=document.createElement("button");add.type="button";add.textContent="+ Adicionar categoria";
      add.className="slide-chart-add-category";
      add.disabled=chart.chart_categories.length>=24;
      add.addEventListener("click",()=>{
        if(chart.chart_categories.length>=24)return status("Limite de 24 categorias por gráfico.");
        const categories=chart.chart_categories.concat(["Nova categoria"]);
        const values=chart.chart_values.concat([chart.chart_type==="pie"?1:0]);
        const patch={chart_categories:categories,chart_values:values};
        if(chart.chart_series?.length)patch.chart_series=chart.chart_series.map(s=>({
          ...s,values:s.values.concat([0])
        }));
        if(chart.chart_item_colors?.length)patch.chart_item_colors=chart.chart_item_colors.concat(
          [ChartLayoutEngine.colors(chart,categories.length)[categories.length-1]]
        );
        commit(patch);
      },{signal});section.append(add);

      // Progressive disclosure: the frequently used data editor stays open.
      // Advanced controls are grouped, rather than scrolling through one
      // very long unstructured sidebar (recognition, consistency, control).
      const makeGroup=(title,open=false)=>{
        const group=document.createElement("details");group.className="slide-chart-settings";
        group.open=open;const summary=document.createElement("summary");summary.textContent=title;
        group.append(summary);return group;
      };
      const data=makeGroup("Dados e categorias",true);
      const bodyNodes=Array.from(section.children);
      for(const child of bodyNodes)data.append(child);
      section.append(data);
      const format=makeGroup("Rótulos e tipografia",true);
      const appearance=makeGroup("Cores e fundo",false);
      const layout=makeGroup("Layout e apresentação",false);
      const groupLabel=(group,caption,input)=>{
        const label=document.createElement("label");label.className="slide-chart-setting";
        label.textContent=caption;label.append(input);group.append(label);return input;
      };
      const choose=(group,caption,key,items,defaultValue)=>{
        const input=document.createElement("select");input.setAttribute("aria-label",caption);
        for(const [value,label] of items){
          const option=document.createElement("option");option.value=value;option.textContent=label;
          input.append(option);
        }
        input.value=String(chart[key]??defaultValue);
        input.addEventListener("change",()=>{
          commit({[key]:key==="chart_label_rotation"?Number(input.value):input.value});
        },{signal});return groupLabel(group,caption,input);
      };
      const numeric=(group,caption,key,min,max,step,initial)=>{
        const input=document.createElement("input");input.type="number";
        input.min=String(min);input.max=String(max);input.step=String(step);
        input.value=String(chart[key]??initial);input.setAttribute("aria-label",caption);
        input.addEventListener("change",()=>{
          const value=Number(input.value);
          if(!Number.isFinite(value)||value<min||value>max){
            status(caption+": informe um valor entre "+min+" e "+max+".");return;
          }
          commit({[key]:value});
        },{signal});return groupLabel(group,caption,input);
      };
      const toggle=(group,caption,key,defaultValue)=>{
        const input=document.createElement("input");input.type="checkbox";
        input.checked=Boolean(chart[key]??defaultValue);
        input.setAttribute("aria-label",caption);
        input.addEventListener("change",()=>commit({[key]:input.checked}),{signal});
        return groupLabel(group,caption,input);
      };
      const colorField=(group,caption,key,initial)=>{
        const input=document.createElement("input");input.type="color";
        input.value=chart[key]||initial;input.setAttribute("aria-label",caption);
        input.addEventListener("change",()=>commit({[key]:input.value.toUpperCase()}),{signal});
        return groupLabel(group,caption,input);
      };
      const font=document.createElement("input");font.type="text";font.maxLength=80;
      font.value=chart.chart_label_font||"Arial";font.setAttribute("list","slide-chart-fonts");
      font.setAttribute("aria-label","Família da fonte dos rótulos");
      const fonts=document.createElement("datalist");fonts.id="slide-chart-fonts";
      for(const family of ["Arial","Calibri","Inter","Liberation Sans","Liberation Serif",
        "DejaVu Sans","DejaVu Serif","Verdana","Times New Roman"]){
        const opt=document.createElement("option");opt.value=family;fonts.append(opt);
      }
      font.addEventListener("change",()=>{
        if(font.value.trim())commit({chart_label_font:font.value.trim()});
      },{signal});
      groupLabel(format,"Família da fonte",font);format.append(fonts);
      numeric(format,"Tamanho da fonte (pt)","chart_label_font_size",7,24,1,12);
      numeric(format,"Espaçamento entre letras (pt)","chart_label_letter_spacing",-2,8,.1,0);
      colorField(format,"Cor dos rótulos","chart_label_color","#43546B");
      toggle(format,"Negrito","chart_label_bold",false);
      toggle(format,"Itálico","chart_label_italic",false);
      toggle(format,"Quebra automática de linha","chart_label_wrap",true);
      toggle(format,"Mostrar rótulos das categorias","chart_label_visible",true);
      choose(format,"Rotação dos rótulos","chart_label_rotation",
        [[0,"Automático / 0°"],[30,"30°"],[45,"45°"],[60,"60°"],[90,"90°"]],"0");
      choose(format,"Alinhamento dos rótulos","chart_label_align",
        [["left","Esquerda"],["center","Centro"],["right","Direita"]],"center");
      choose(format,"Rótulos de valores","chart_data_labels",[
        ["none","Ocultar"],["value","Valores"],["percent","Percentuais"],
        ["both","Valores e percentuais"]],"percent");
      choose(format,"Interpretação dos percentuais","chart_percent_mode",[
        ["share","Participação no total (calculado)"],
        ["provided","Valores já estão em porcentagem"]],"share");
      choose(appearance,"Distribuição das cores","chart_color_mode",[
        ["palette","Automática pela paleta"],["custom","Uma cor para cada categoria"]],"palette");
      colorField(appearance,"Cor do fundo","chart_background_color","#FFFFFF");
      choose(appearance,"Fundo do gráfico","chart_background",[
        ["solid","Cor sólida"],["transparent","Transparente — mostrar o slide"]],"solid");
      numeric(layout,"Margem extra (px)","chart_margin",0,80,1,0);
      choose(layout,"Tipo de margem","chart_margin_mode",[
        ["auto","Automática"],["custom","Personalizada"]],"auto");
      choose(layout,"Posição da legenda","chart_legend_position",[
        ["auto","Automática"],["right","Direita"],["bottom","Inferior"]],"auto");
      toggle(layout,"Layout automático","chart_layout_auto",true);
      const note=document.createElement("p");note.className="slide-chart-hint";
      note.textContent="Os percentuais calculados não modificam os valores originais. "+
        "Cada alteração gera uma etapa de desfazer. Os rótulos completos permanecem editáveis.";
      format.append(note);
      section.append(format,appearance,layout);
      if(chart.chart_type!=="pie"){
        const addSeries=document.createElement("button");addSeries.type="button";
        addSeries.textContent="+ Adicionar série de dados";
        addSeries.className="slide-chart-add-series";
        addSeries.disabled=(chart.chart_series?.length||1)>=5;
        addSeries.title="A legenda identifica cada série; os valores permanecem editáveis.";
        addSeries.addEventListener("click",()=>{
          const current=ChartLayoutEngine.series(chart);
          if(current.length>=5)return status("Limite de 5 séries por gráfico.");
          const additional={name:"Série "+(current.length+1),
            values:chart.chart_categories.map(()=>0)};
          commit({chart_series:[...current.map(s=>({
            name:s.name,values:s.values.slice()
          })),additional]});
        },{signal});
        data.append(addSeries);
      }
      if(chart.chart_series?.length>1){
        const seriesGroup=document.createElement("div");
        seriesGroup.className="slide-chart-series";
        chart.chart_series.forEach((entry,index)=>{
          const line=document.createElement("label");
          line.textContent="Nome da série "+(index+1);
          const input=document.createElement("input");input.type="text";
          input.maxLength=80;input.value=entry.name;
          input.setAttribute("aria-label","Nome da série "+(index+1));
          input.addEventListener("change",()=>{
            const next=chart.chart_series.map(s=>({...s,values:s.values.slice()}));
            next[index].name=input.value.trim()||entry.name;
            commit({chart_series:next});
          },{signal});
          line.append(input);seriesGroup.append(line);
        });
        data.append(seriesGroup);
      }
      container.append(section);return section;
    }
  }
  window.OpenDocSlideCharts={ChartLayoutEngine,ChartPreview,ChartInspector,valid,PALETTES};
})();
