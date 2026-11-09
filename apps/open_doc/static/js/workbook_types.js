"use strict";
(() => {
  const OPTIONS=[["auto","Automático"],["text","Texto"],["integer","Inteiro"],
    ["decimal","Número decimal"],["currency","Moeda (R$)"],["percent","Porcentagem"],
    ["date","Data"],["time","Hora"],["datetime","Data e hora"],["boolean","Booleano"]];
  const symbols={auto:"",text:"T",integer:"123",decimal:"1,2",currency:"R$",percent:"%",
    date:"D",time:"H",datetime:"DH",boolean:"☑"};
  function typeFor(sheet,row,col) {
    return sheet.types?.cells?.[row+","+col]||sheet.types?.columns?.[String(col)]||"auto";
  }
  function show(raw,type) {
    const value=String(raw??"");
    if(value===""||type==="auto"||type==="text")return {text:value,valid:true};
    if(type==="integer"||type==="decimal"||type==="currency"||type==="percent"){
      const engine=typeof window!=="undefined"?window.OpenDocWorkbookPivot:require("./workbook_pivot.js");
      const n=engine.number(raw);
      if(!Number.isFinite(n)||(type==="integer"&&!Number.isInteger(n)))
        return {text:value,valid:false};
      const args=type==="currency"?{style:"currency",currency:"BRL"}:
        type==="percent"?{style:"percent",maximumFractionDigits:2}:
          type==="integer"?{maximumFractionDigits:0}:{maximumFractionDigits:8};
      return {text:new Intl.NumberFormat("pt-BR",args).format(n),valid:true};
    }
    if(type==="boolean"){
      const low=value.trim().toLocaleLowerCase("pt-BR");
      if(["sim","true","1","verdadeiro"].includes(low))return {text:"Sim",valid:true};
      if(["não","nao","false","0","falso"].includes(low))return {text:"Não",valid:true};
      return {text:value,valid:false};
    }
    if(type==="date"||type==="datetime"){
      const match=value.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
      if(match){
        const [,day,month,year,h="00",m="00",sec="00"]=match;
        const dt=new Date(+year,+month-1,+day,+h,+m,+sec);
        if(dt.getFullYear()===+year&&dt.getMonth()+1===+month&&dt.getDate()===+day&&
          +h<=23&&+m<=59&&+sec<=59&&(type==="datetime"||!match[4]))
          return {text:value,valid:true};
      }
      const iso=value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:Z|[+-]\d{2}:\d{2})?)?$/);
      if(iso){
        const [,year,month,day,h="00",m="00",sec="00"]=iso;
        const dt=new Date(+year,+month-1,+day,+h,+m,+sec);
        if(dt.getFullYear()===+year&&dt.getMonth()+1===+month&&dt.getDate()===+day&&
          +h<=23&&+m<=59&&+sec<=59&&(type==="datetime"||!iso[4]))
          return {text:day+"/"+month+"/"+year+(type==="datetime"?" "+h+":"+m:""),valid:true};
      }
      return {text:value,valid:false};
    }
    if(type==="time"){
      const match=value.match(/^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
      return {text:value,valid:!!match};
    }
    return {text:value,valid:true};
  }
  function create({host,signal,getState,change}) {
    let menu=null,selection=null,mode="cell";
    const close=()=>{
      if(!menu)return;
      menu.remove();menu=null;selection=null;
    };
    function apply(type) {
      if(!selection)return;
      const {sheet,row,col,bounds}=selection;
      const before=JSON.parse(JSON.stringify(sheet.types||{columns:{},cells:{}}));
      const after=JSON.parse(JSON.stringify(before));
      after.columns=after.columns||{};after.cells=after.cells||{};
      const update=(scope,id)=>{
        const group=after[scope];
        if(type==="auto"&&scope==="columns")delete group[id];else group[id]=type;
      };
      if(mode==="column")update("columns",String(col));
      else if(mode==="selection"){
        const [r0,c0,r1,c1]=bounds;
        if((r1-r0+1)*(c1-c0+1)>50000)throw Error("Selecione até 50 mil células.");
        for(let r=r0;r<=r1;r++)for(let c=c0;c<=c1;c++)update("cells",r+","+c);
      }else update("cells",row+","+col);
      if(JSON.stringify(before)!==JSON.stringify(after))
        change(sheet,before,after);
      close();
    }
    function open({event,row,col,header=false}) {
      close();
      const context=getState();
      selection={sheet:context.sheet,row,col,bounds:context.bounds};
      mode=header?"column":"cell";
      const box=document.createElement("div");box.className="book-context-menu";box.setAttribute("role","menu");
      box.setAttribute("aria-label","Alterar tipo de dado");
      const title=document.createElement("strong");title.textContent=header?"Tipo da coluna":"Tipo da célula ou seleção";
      box.append(title);
      const scope=document.createElement("div");
      scope.style.display="flex";scope.style.gap="4px";scope.style.flexWrap="wrap";
      for(const [id,label] of [["cell","Célula"],["selection","Seleção"],["column","Coluna"]]){
        if(header&&id!=="column")continue;
        const button=document.createElement("button");button.type="button";button.textContent=label;
        button.dataset.typeScope=id;button.style.width="auto";button.style.fontWeight=id===mode?"bold":"normal";
        scope.append(button);
      }
      box.append(scope);
      for(const [id,label] of OPTIONS){
        const button=document.createElement("button");button.type="button";button.dataset.typeChoose=id;
        button.textContent=label;
        if(typeFor(context.sheet,row,col)===id){
          const check=document.createElement("span");check.textContent="✓";button.append(check);
        }
        box.append(button);
      }
      const hint=document.createElement("small");
      hint.textContent="Os valores originais são preservados; valores inválidos ficam marcados.";
      box.append(hint);host.append(box);menu=box;
      const x=event?.clientX??Math.min(window.innerWidth/2,500),y=event?.clientY??110;
      box.style.left=Math.max(7,Math.min(x,window.innerWidth-box.offsetWidth-8))+"px";
      box.style.top=Math.max(7,Math.min(y,window.innerHeight-box.offsetHeight-8))+"px";
      box.querySelector("button").focus();
    }
    host.addEventListener("click",event=>{
      if(!menu)return;
      const scope=event.target.closest("[data-type-scope]");
      const choose=event.target.closest("[data-type-choose]");
      if(scope){
        mode=scope.dataset.typeScope;
        for(const el of menu.querySelectorAll("[data-type-scope]"))
          el.style.fontWeight=el.dataset.typeScope===mode?"bold":"normal";
      }
      if(choose){
        try{apply(choose.dataset.typeChoose);}catch(error){close();getState().report(error.message);}
      }
    },{signal});
    document.addEventListener("pointerdown",event=>{
      if(menu&&!menu.contains(event.target))close();
    },{signal});
    host.addEventListener("keydown",event=>{if(event.key==="Escape"&&menu){event.stopPropagation();close();}},{signal});
    return {open,close,typeFor,show,symbols};
  }
  const api={create,typeFor,show,symbols};
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
  if(typeof window!=="undefined")window.OpenDocWorkbookTypes=api;
})();
