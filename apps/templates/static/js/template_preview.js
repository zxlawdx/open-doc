"use strict";
(() => {
  function renderBytes(data) {
    return Uint8Array.from(atob(data.bytes), char=>char.charCodeAt(0));
  }
  async function render(target,data,{request,asset,width}) {
    target.replaceChildren();
    if(data.format==="pdf"){
      const api=window.OpenDocPdf;
      api.GlobalWorkerOptions.workerSrc=asset("vendor/pdf.worker.bundle.js");
      const task=api.getDocument({data:renderBytes(data),isEvalSupported:false,useSystemFonts:false,
        standardFontDataUrl:asset("../pdfjs/standard_fonts/"),cMapUrl:asset("../pdfjs/cmaps/"),cMapPacked:true});
      try{
        const document=await task.promise, page=await document.getPage(1);
        const viewport=page.getViewport({scale:width/page.getViewport({scale:1}).width});
        const canvas=target.ownerDocument.createElement("canvas");
        canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
        await page.render({canvasContext:canvas.getContext("2d"),viewport}).promise;
        target.append(canvas);
      } finally {await task.destroy();}
      return;
    }
    if(data.format==="pptx"){
      const deck=await window.OpenDocPptx.loadBytes(renderBytes(data).buffer);
      try {
        const surface=deck.render(0,target,width,width*data.height/data.width,true);
        surface.style.width=width+"px";
        surface.style.maxWidth="100%";
        return ()=>deck.destroy();
      } catch(error){deck.destroy();throw error;}
    }
    if(data.format==="xlsx"){
      const table=document.createElement("table"), sheet=data.sheets[0];
      const {evaluate,column}=window.OpenDocWorkbookFormula;
      const calc=evaluate(data.sheets), bold=new Set(sheet.bold);
      const heading=table.insertRow();heading.append(document.createElement("th"));
      const columns=width>300 ? 7 : 4;
      for(let col=0;col<columns;col++){
        const cell=document.createElement("th");cell.textContent=column(col);heading.append(cell);
      }
      for(let row=0;row<(width>300 ? 10 : 5);row++){
        const line=table.insertRow(), number=document.createElement("th");
        number.textContent=row+1;line.append(number);
        for(let col=0;col<columns;col++){
          const cell=line.insertCell();
          cell.textContent=calc(0,row,col);
          if(bold.has(row+","+col))cell.style.fontWeight="bold";
        }
      }
      target.append(table);
      return;
    }
    const paper=document.createElement("div"), content=document.createElement("article");
    const section=data.content?.sections?.[0] || {};
    const w=(section.page_width_pt || 595.28)*4/3, h=(section.page_height_pt || 841.89)*4/3;
    const scale=width/w;
    paper.className="template-paper paper";
    paper.style.width=w+"px";paper.style.height=h+"px";
    paper.style.padding=["top","right","bottom","left"].map(side=>(section["margin_"+side+"_pt"] ?? 72)+"pt").join(" ");
    paper.style.transform="scale("+scale+")";
    paper.append(content);
    const frame=document.createElement("div");
    frame.style.width=width+"px";frame.style.height=h*scale+"px";
    frame.append(paper);target.append(frame);
    if(data.content)window.OpenDocRichRenderer.render(data.content,content,id=>
      request("document/media",{id:data.id,media_id:id}).then(result=>result.url)
    );
    else content.innerHTML=window.DOMPurify.sanitize(window.marked.parse(data.markdown || ""));
    for(const link of content.querySelectorAll("a"))link.removeAttribute("href");
  }
  window.OpenDocTemplatePreview={render};
})();
