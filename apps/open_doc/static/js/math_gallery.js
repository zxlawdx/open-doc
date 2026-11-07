/* Offline equation gallery. Formulas are inserted as high-resolution PNG images.
 * This is not a native OMML equation editor: original TeX stays in object name.
 */
"use strict";
(() => {
 const DEFINITIONS=[
  {id:"fraction",label:"Derivada de fração",tex:"\\frac{d}{dx}\\frac{x^2+1}{x+1}=\\frac{x^2+2x-1}{(x+1)^2}",op:"d/dx",upper:"x² + 1",lower:"x + 1",resultUpper:"x² + 2x − 1",resultLower:"(x + 1)²",note:"Regra do quociente; x ≠ −1"},
  {id:"integral",label:"Integral simples",tex:"\\int x^2\\,dx=\\frac{x^3}{3}+C",op:"∫",operand:"x² dx =",resultUpper:"x³",resultLower:"3",tail:"+ C",note:"Regra da potência"},
  {id:"trig",label:"Integral trigonométrica",tex:"\\int\\sin(x)\\,dx=-\\cos(x)+C",op:"∫",operand:"sen(x) dx = −cos(x) + C",note:"Integral do seno"},
  {id:"definite",label:"Integral definida",tex:"\\int_0^\\pi\\sin(x)\\,dx=2",op:"∫",top:"π",bottom:"0",operand:"sen(x) dx = 2",note:"Teorema fundamental do cálculo"},
  {id:"line",label:"Integral de linha",tex:"\\oint_C(x\\,dy-y\\,dx)=2\\pi",op:"∮",bottom:"C",operand:"(x dy − y dx) = 2π",note:"C: circunferência unitária, sentido anti-horário"},
  {id:"sum",label:"Somatório",tex:"\\sum_{k=1}^{n}k=\\frac{n(n+1)}{2}",op:"∑",top:"n",bottom:"k = 1",operand:"k =",resultUpper:"n(n + 1)",resultLower:"2",note:"Soma dos n primeiros inteiros positivos"},
  {id:"double",label:"Integral dupla",tex:"\\iint_D(x+y)\\,dA",op:"∬",bottom:"D",operand:"(x + y) dA",note:"Integral sobre uma região D"}
 ];
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const label=(x,y,s,size=38,anchor="start")=>'<text x="'+x+'" y="'+y+'" text-anchor="'+anchor+'" fill="#17365c" font-family="Cambria Math,STIX Two Math,DejaVu Serif,Georgia,serif" font-size="'+size+'">'+esc(s)+'</text>';
 function svg(id){
  const d=DEFINITIONS.find(x=>x.id===id);if(!d)throw Error("Equação desconhecida.");
  let body="";
  if(d.op==="d/dx"){
   body+=label(42,101,"d",32)+'<path d="M40 113h57" stroke="#17365c" stroke-width="3"/>'+label(45,156,"dx",31);
   body+=label(130,124,"(",50)+label(232,92,d.upper,35,"middle")+
    '<path d="M162 107h146" stroke="#17365c" stroke-width="3"/>'+label(232,153,d.lower,35,"middle")+
    label(315,124,") =",45)+label(567,92,d.resultUpper,35,"middle")+
    '<path d="M407 107h320" stroke="#17365c" stroke-width="3"/>'+label(567,153,d.resultLower,35,"middle");
  }else{
   body+=label(55,133,d.op,84);
   if(d.top)body+=label(105,58,d.top,28,"middle");
   if(d.bottom)body+=label(104,178,d.bottom,25,"middle");
   body+=label(155,126,d.operand||"",38);
   if(d.resultUpper){
    const rx=d.op==="∑"?430:485;
    body+=label(rx,91,d.resultUpper,37,"middle")+
      '<path d="M'+(rx-125)+' 108h250" stroke="#17365c" stroke-width="3"/>'+
      label(rx,154,d.resultLower,37,"middle");
    if(d.tail)body+=label(rx+150,124,d.tail,37);
   }
  }
  body+=label(45,229,d.note,21);
  return '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="256" viewBox="0 0 1024 256" role="img" aria-label="'+esc(d.label)+'"><rect width="1024" height="256" fill="white"/>'+body+'</svg>';
 }
 // Rasterize the same SVG primitives directly onto Canvas2D. QtWebEngine
 // may mark data:image/svg+xml loaded in an Image as tainted or fail its
 // asynchronous decode; direct drawing works offline on Chromium 83.
 const toPng=id=>{
  const root=new DOMParser().parseFromString(svg(id),"image/svg+xml");
  if(root.querySelector("parsererror"))return Promise.reject(Error("SVG matemático inválido."));
  try{
   const canvas=document.createElement("canvas");
   canvas.width=2048;canvas.height=512;
   const ctx=canvas.getContext("2d");
   if(!ctx)throw Error("Canvas 2D indisponível.");
   ctx.scale(2,2);
   for(const item of root.querySelectorAll("rect,path,text")){
    if(item.tagName==="rect"){
     ctx.fillStyle=item.getAttribute("fill")||"#fff";
     ctx.fillRect(Number(item.getAttribute("x")||0),Number(item.getAttribute("y")||0),
      Number(item.getAttribute("width")||1024),Number(item.getAttribute("height")||256));
    }else if(item.tagName==="path"){
     const match=/^M([0-9.]+) ([0-9.]+)h([0-9.]+)$/.exec(item.getAttribute("d")||"");
     if(!match)throw Error("Traçado matemático não suportado.");
     ctx.beginPath();ctx.moveTo(Number(match[1]),Number(match[2]));
     ctx.lineTo(Number(match[1])+Number(match[3]),Number(match[2]));
     ctx.strokeStyle=item.getAttribute("stroke")||"#17365c";
     ctx.lineWidth=Number(item.getAttribute("stroke-width")||3);ctx.stroke();
    }else{
     const size=Number(item.getAttribute("font-size")||38);
     ctx.font=size+"px 'DejaVu Serif', Georgia, serif";
     ctx.textAlign=({middle:"center",end:"right"})[item.getAttribute("text-anchor")]||"left";
     ctx.textBaseline="alphabetic";
     ctx.fillStyle=item.getAttribute("fill")||"#17365c";
     ctx.fillText(item.textContent||"",Number(item.getAttribute("x")),Number(item.getAttribute("y")));
    }
   }
   const data=canvas.toDataURL("image/png");
   if(!data.startsWith("data:image/png;base64,"))throw Error("Falha ao rasterizar equação.");
   return Promise.resolve(data.substring(22));
  }catch(error){return Promise.reject(error);}
 };
 function install(host,insert,status){
  const panel=document.createElement("section");panel.className="slide-math-gallery";panel.hidden=true;
  panel.setAttribute("aria-label","Modelos de equações");
  const heading=document.createElement("h3");heading.textContent="Equações matemáticas";
  const hint=document.createElement("p");
  hint.textContent="Fórmulas diagramadas e inseridas como imagens. Edição matemática nativa ainda não disponível.";
  panel.append(heading,hint);
  for(const def of DEFINITIONS){
   const button=document.createElement("button");button.type="button";
   button.className="slide-math-template";button.dataset.mathId=def.id;
   button.setAttribute("aria-label","Inserir "+def.label);
   const name=document.createElement("span");name.textContent=def.label;
   const preview=document.createElement("img");preview.alt=def.tex;
   preview.src="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(svg(def.id));
   button.append(name,preview);
   button.addEventListener("click",async()=>{
    button.disabled=true;
    try{
     const data=await toPng(def.id);
     insert({mime:"image/png",data,name:"Equação: "+def.tex});
     panel.hidden=true;status?.("Equação diagramada inserida como imagem.");
    }catch(error){status?.(error.message);}
    finally{button.disabled=false;}
   });
   panel.append(button);
  }
  host.append(panel);
  return {panel,toggle:()=>{panel.hidden=!panel.hidden;},close:()=>{panel.hidden=true;}};
 }
 window.OpenDocMathGallery={DEFINITIONS,svg,toPng,install};
})();