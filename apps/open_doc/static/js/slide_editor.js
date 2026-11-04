/* Native Open Doc slide studio: object-oriented visual editor over the existing
 * Vela fixed-document persistence. No framework, CDN or HTML execution.
 */
"use strict";
(() => {
  const clone=value=>JSON.parse(JSON.stringify(value));
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
  const labelFor=type=>({text:"Texto",rect:"Retângulo",ellipse:"Elipse",
    round_rect:"Arredondado",line:"Linha",arrow:"Seta",image:"Imagem",
    triangle:"Triângulo",diamond:"Losango"})[type]||"Objeto";
  const SVG_NS="http://www.w3.org/2000/svg";
  const ACTION_ICONS={
    "+ Slide":"add-circle",Duplicar:"duplicate","Excluir slide":"trash",
    "↑ Slide":"arrow-up","↓ Slide":"arrow-down",
    Texto:"type-text",Retângulo:"shape-rectangle",Elipse:"shape-ellipse",
    Arredondado:"shape-rounded",Linha:"shape-line",Seta:"shape-arrow",
    Triângulo:"shape-triangle",Losango:"shape-diamond",Imagem:"image",
    Desfazer:"undo",Refazer:"redo"
  };
  // A compact SVG shape renderer, backed by the existing slide model.
  class SlideSvgRenderer {
    create(obj){
      const svg=document.createElementNS(SVG_NS,"svg");
      svg.classList.add("slide-vector-shape");
      Object.assign(svg.style,{position:"absolute",left:"0px",top:"0px",
        width:"100%",height:"100%",display:"block",pointerEvents:"none"});
      svg.setAttribute("viewBox","0 0 100 100");
      svg.setAttribute("preserveAspectRatio","none");
      svg.setAttribute("aria-hidden","true");
      const tag=({rect:"rect",round_rect:"rect",ellipse:"ellipse",
        line:"line",arrow:"polygon",triangle:"polygon",diamond:"polygon"})[obj.type];
      if(!tag)return null;
      const shape=document.createElementNS(SVG_NS,tag);
      const geometry=({
        rect:{x:1,y:1,width:98,height:98},
        round_rect:{x:1,y:1,width:98,height:98,rx:16,ry:16},
        ellipse:{cx:50,cy:50,rx:49,ry:49},
        line:{x1:5,y1:95,x2:95,y2:5},
        arrow:{points:"4,38 62,38 62,14 98,50 62,86 62,62 4,62"},
        triangle:{points:"50,2 98,98 2,98"},
        diamond:{points:"50,2 98,50 50,98 2,50"}
      })[obj.type];
      for(const [key,value] of Object.entries(geometry))
        shape.setAttribute(key,String(value));
      const open=obj.type==="line";
      shape.setAttribute("fill",open?"none":obj.fill||"#DAE2FD");
      shape.setAttribute("stroke",obj.stroke||"#004AC6");
      shape.setAttribute("stroke-width",String(obj.stroke_width||1.5));
      shape.setAttribute("stroke-linecap","round");
      shape.setAttribute("stroke-linejoin","round");
      shape.setAttribute("vector-effect","non-scaling-stroke");
      svg.append(shape);return svg;
    }
  }
  const fields=[
    ["x","Posição X (%)"],["y","Posição Y (%)"],
    ["width","Largura (%)"],["height","Altura (%)"]
  ];

  class SlideDeckCommands {
    constructor(getModel,commit){this.getModel=getModel;this.commit=commit;}
    apply(mutator){
      const next=clone(this.getModel());
      mutator(next.surfaces,next);
      next.surfaces.forEach((s,index)=>s.index=index);
      this.commit(next);
      return next;
    }
    insert(after){
      return this.apply(slides=>{
        if(slides.length>=200)throw Error("Limite de 200 slides atingido.");
        const base=slides[0];
        slides.splice(after+1,0,{index:0,preview_kind:"pptx-native",
          width_pt:base.width_pt,height_pt:base.height_pt,strokes:[],text_overlays:[],
          elements:[],background:"#FFFFFF",notes:""});
      });
    }
    duplicate(index){
      return this.apply(slides=>{
        if(slides.length>=200)throw Error("Limite de 200 slides atingido.");
        const copy=clone(slides[index]);
        for(const item of copy.elements||[])item.id=window.OpenDocModel.id();
        for(const item of [...(copy.strokes||[]),...(copy.text_overlays||[])])
          item.id=window.OpenDocModel.id();
        slides.splice(index+1,0,copy);
      });
    }
    remove(index){
      return this.apply(slides=>{
        if(slides.length<=1)throw Error("É necessário manter pelo menos um slide.");
        slides.splice(index,1);
      });
    }
    move(index,offset){
      const dest=index+offset,slides=this.getModel().surfaces;
      if(dest<0||dest>=slides.length)return;
      this.apply(items=>{const [slide]=items.splice(index,1);items.splice(dest,0,slide);});
    }
    insertObject(index,type){
      const count=this.getModel().surfaces[index].elements.length;
      if(count>=500)throw Error("Limite de 500 objetos por slide atingido.");
      const offset=(count%8)*.04;
      const obj={id:window.OpenDocModel.id(),type,
        x:.2+offset,y:.24+offset,width:type==="text"?.5:.27,height:type==="text"?.19:.22,
        text:type==="text"?"Novo texto":"",color:"#191C1E",
        fill:"#DAE2FD",stroke:"#004AC6",font_family:"Inter",
        font_size_pt:type==="text"?28:20,stroke_width:1.5,rotation:0};
      this.apply(slides=>slides[index].elements.push(obj));
      return obj.id;
    }
    _storeImageAsset(deck,image){
      const assets=deck.assets||(deck.assets={});
      let assetId=Object.keys(assets).find(key=>
        assets[key].mime===image.mime&&assets[key].data===image.data);
      if(!assetId){
        if(Object.keys(assets).length>=128)throw Error("Limite de 128 imagens atingido.");
        assetId=window.OpenDocModel.id();
        assets[assetId]={mime:image.mime,data:image.data};
      }
      return assetId;
    }
    insertImage(index,image){
      const id=window.OpenDocModel.id();
      this.apply((slides,deck)=>{
        const elements=slides[index].elements;
        if(elements.length>=500)throw Error("Limite de 500 objetos por slide atingido.");
        const assetId=this._storeImageAsset(deck,image);
        const offset=(elements.length%8)*.04;
        elements.push({id,type:"image",asset_id:assetId,name:image.name||"Imagem",
          x:.2+offset,y:.24+offset,width:.36,height:.30,text:"",
          color:"#191C1E",fill:"#DAE2FD",stroke:"#004AC6",
          font_family:"Inter",font_size_pt:20,stroke_width:1.5,rotation:0,
          flip_h:false,flip_v:false});
      });
      return id;
    }
    replaceImage(index,id,image){
      // Keep the same shape ID, layer position, geometry and all non-image properties.
      this.apply((slides,deck)=>{
        const target=slides[index]?.elements.find(obj=>obj.id===id);
        if(!target||target.type!=="image")throw Error("Selecione uma imagem existente.");
        target.asset_id=this._storeImageAsset(deck,image);
      });
      return id;
    }
    duplicateObject(index,id){
      const newId=window.OpenDocModel.id();
      this.apply(slides=>{
        const elements=slides[index].elements;
        const at=elements.findIndex(o=>o.id===id);
        if(at<0)throw Error("Objeto não encontrado.");
        if(elements.length>=500)throw Error("Limite de objetos atingido.");
        const copy=clone(elements[at]);
        copy.id=newId;
        copy.x=clamp(copy.x+.03,0,1-copy.width);
        copy.y=clamp(copy.y+.03,0,1-copy.height);
        if(copy.name)copy.name=copy.name.slice(0,65)+" (cópia)";
        elements.splice(at+1,0,copy);
      });
      return newId;
    }
    updateObject(index,id,patch){
      this.apply(slides=>{
        const obj=slides[index].elements.find(o=>o.id===id);
        if(!obj)throw Error("O objeto selecionado não existe.");
        Object.assign(obj,patch);
      });
    }
    deleteObject(index,id){
      this.apply(slides=>{
        slides[index].elements=slides[index].elements.filter(o=>o.id!==id);
      });
    }
    deleteObjects(index,ids){
      const set=new Set(ids);
      if(!set.size)return;
      this.apply(slides=>{
        slides[index].elements=slides[index].elements.filter(obj=>!set.has(obj.id));
      });
    }
    alignObjects(index,ids,axis){
      const set=new Set(ids);
      this.apply(slides=>{
        const selected=slides[index].elements.filter(obj=>set.has(obj.id));
        if(selected.length<2)throw Error("Selecione dois ou mais objetos para alinhar.");
        const sizeKey=axis==="x"?"width":axis==="y"?"height":null;
        if(!sizeKey)throw Error("Eixo de alinhamento inválido.");
        const center=selected.reduce((sum,obj)=>sum+obj[axis]+obj[sizeKey]/2,0)/selected.length;
        for(const obj of selected)obj[axis]=clamp(center-obj[sizeKey]/2,0,1-obj[sizeKey]);
      });
    }
    shiftLayer(index,id,delta){
      this.apply(slides=>{
        const objects=slides[index].elements,from=objects.findIndex(o=>o.id===id),to=from+delta;
        if(from<0||to<0||to>=objects.length)return;
        const [obj]=objects.splice(from,1);objects.splice(to,0,obj);
      });
    }
    updateSlide(index,patch){this.apply(slides=>Object.assign(slides[index],patch));}
  }

  class SlideStudio {
    constructor({host,root,controls,scroller,sidebar,signal,getModel,update,status,getZoom,go,undo,redo,onRender}){
      Object.assign(this,{host,root,controls,scroller,sidebar,signal,getModel,update,status,getZoom,go,undo,redo,onRender});
      this.commands=new SlideDeckCommands(getModel,next=>{update(next);this.render();});
      this.shapeRenderer=new SlideSvgRenderer();
      this.active=false;this.selected=null;this.selectedIds=new Set();this.current=0;this.drag=null;
      this.pan=null;this.spacePressed=false;this.imageReplacement=null;
      this.toolbar=document.createElement("div");this.toolbar.className="slide-studio-toolbar";this.toolbar.hidden=true;
      this.imageInput=document.createElement("input");this.imageInput.type="file";
      this.imageInput.accept="image/png,image/jpeg,image/webp";this.imageInput.hidden=true;
      this.toolbar.append(this.imageInput);
      this.imageInput.addEventListener("change",()=>{
        const file=this.imageInput.files&&this.imageInput.files[0];
        this.imageInput.value="";
        const replacement=this.imageReplacement;
        this.imageReplacement=null;
        this.importImage(file,replacement).catch(error=>this.status(error.message));
      },{signal:this.signal});
      this.inspector=document.createElement("aside");this.inspector.className="slide-inspector";this.inspector.hidden=true;
      this.inspector.setAttribute("aria-label","Propriedades e camadas dos slides");
      host.append(this.inspector);controls.append(this.toolbar);
      this._buildToolbar();
      this._bindEvents();
    }
    _button(label,action,title=label){
      const button=document.createElement("button");button.type="button";button.textContent=label;
      if(ACTION_ICONS[label]){
        const svg=document.createElementNS(SVG_NS,"svg");
        svg.classList.add("slide-action-icon");svg.setAttribute("aria-hidden","true");
        Object.assign(svg.style,{width:"17px",height:"17px",display:"inline-block",
          flex:"none",pointerEvents:"none"});
        const use=document.createElementNS(SVG_NS,"use");
        const base=this.root.querySelector(".brand-mark use")?.getAttribute("href")?.split("#")[0]||"";
        use.setAttribute("href",base+"#"+ACTION_ICONS[label]);svg.append(use);button.prepend(svg);
      }
      button.title=title;button.addEventListener("click",()=>{
        if(!this.active)return;
        try{action();}catch(error){this.status(error.message);}
      },{signal:this.signal});this.toolbar.append(button);return button;
    }
    _buildToolbar(){
      this._button("+ Slide",()=>{this.commands.insert(this.current);this.current++;this.selected=null;this.go(this.current);});
      this._button("Duplicar",()=>{this.commands.duplicate(this.current);this.current++;this.selected=null;this.go(this.current);});
      this._button("Excluir slide",()=>{this.commands.remove(this.current);this.current=clamp(this.current,0,this.getModel().surfaces.length-1);this.selected=null;});
      this._button("↑ Slide",()=>{this.commands.move(this.current,-1);this.current=clamp(this.current-1,0,this.getModel().surfaces.length-1);this.selected=null;});
      this._button("↓ Slide",()=>{this.commands.move(this.current,1);this.current=clamp(this.current+1,0,this.getModel().surfaces.length-1);this.selected=null;});
      this._button("Texto",()=>this.add("text"));
      this._button("Retângulo",()=>this.add("rect"));
      this._button("Elipse",()=>this.add("ellipse"));
      this._button("Arredondado",()=>this.add("round_rect"));
      this._button("Linha",()=>this.add("line"));
      this._button("Seta",()=>this.add("arrow"));
      this._button("Triângulo",()=>this.add("triangle"));
      this._button("Losango",()=>this.add("diamond"));
      this._button("Imagem",()=>{this.imageReplacement=null;this.imageInput.click();},"Inserir PNG, JPEG ou WebP");
      this._button("Desfazer",()=>this.undo());
      this._button("Refazer",()=>this.redo());
    }
    _transferImage(data){
      if(!data)return null;
      for(const file of Array.from(data.files||[])){
        if(file&&/^image\/(png|jpeg|webp)$/.test(file.type))return file;
      }
      for(const item of Array.from(data.items||[])){
        if(item.kind==="file"&&/^image\/(png|jpeg|webp)$/.test(item.type)){
          const file=item.getAsFile?.();
          if(file)return file;
        }
      }
      return null;
    }
    _selectObject(id,additive=false){
      if(!additive)this.selectedIds.clear();
      if(id){
        if(additive&&this.selectedIds.has(id))this.selectedIds.delete(id);
        else this.selectedIds.add(id);
      }
      this.selected=Array.from(this.selectedIds).pop()||null;
    }
    _bindEvents(){
      // Scope drop handling to a real slide: dropping on toolbar/sidebar never
      // imports a file or overwrites another object.
      this.scroller.addEventListener("dragover",event=>{
        if(!this.active||!event.target.closest(".fixed-surface"))return;
        const types=Array.from(event.dataTransfer?.types||[]);
        if(!types.includes("Files"))return;
        event.preventDefault();
        if(event.dataTransfer)event.dataTransfer.dropEffect="copy";
      },{signal:this.signal});
      this.scroller.addEventListener("drop",event=>{
        if(!this.active)return;
        const surface=event.target.closest(".fixed-surface");
        if(!surface)return;
        const file=this._transferImage(event.dataTransfer);
        if(!file)return;
        event.preventDefault();
        this.current=Number(surface.dataset.pageIndex);
        this.importImage(file).catch(error=>this.status(error.message));
      },{signal:this.signal});
      this.root.addEventListener("paste",event=>{
        if(!this.active||event.target.closest("input,textarea,[contenteditable=true]"))return;
        const file=this._transferImage(event.clipboardData);
        if(!file)return;
        event.preventDefault();
        this.importImage(file).catch(error=>this.status(error.message));
      },{signal:this.signal});
      this.scroller.addEventListener("pointerdown",event=>{
        if(this._beginPan(event))return;
        this._start(event);
      },{signal:this.signal});
      window.addEventListener("pointermove",event=>{
        if(this._movePan(event))return;
        this._drag(event);
      },{signal:this.signal});
      window.addEventListener("pointerup",event=>{
        if(this._endPan(event))return;
        this._finish(event);
      },{signal:this.signal});
      window.addEventListener("pointercancel",()=>{
        this._endPan();this.drag=null;this.render();
      },{signal:this.signal});
      this.root.addEventListener("keyup",event=>{
        if(event.key===" "){this.spacePressed=false;
          if(!this.pan)this.scroller.style.cursor="";}
      },{signal:this.signal});
      this.scroller.addEventListener("click",event=>{
        if(!this.active)return;
        const surface=event.target.closest(".fixed-surface");
        if(!surface)return;
        const targetIndex=Number(surface.dataset.pageIndex);
        const changedSlide=targetIndex!==this.current;
        this.current=targetIndex;
        const item=event.target.closest("[data-slide-element]");
        this._selectObject(item?item.dataset.slideElement:null,!changedSlide&&event.shiftKey);
        this.render();
      },{signal:this.signal});
      this.scroller.addEventListener("dblclick",event=>{
        if(!this.active)return;
        const item=event.target.closest('[data-slide-element][data-kind="text"]');
        if(!item)return;
        event.preventDefault();
        const index=Number(item.closest(".fixed-surface").dataset.pageIndex),id=item.dataset.slideElement;
        const next=window.prompt?.("Editar texto do slide",item.textContent.trim());
        if(next===null||next===undefined)return;
        this.commands.updateObject(index,id,{text:next.slice(0,10000)});
      },{signal:this.signal});
      this.root.addEventListener("keydown",event=>{
        if(!this.active)return;
        if(event.target.closest("input,textarea,[contenteditable=true]"))return;
        if(event.key===" "){event.preventDefault();this.spacePressed=true;
          if(!this.pan)this.scroller.style.cursor="grab";return;}
        if(event.key==="Escape"){this._selectObject(null);this.render();return;}
        if(!this.selected)return;
        if(event.key==="Delete"||event.key==="Backspace"){
          event.preventDefault();
          this.commands.deleteObjects(this.current,this.selectedIds);
          this._selectObject(null);this.render();return;
        }
        if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="d"){
          event.preventDefault();
          this.selected=this.commands.duplicateObject(this.current,this.selected);this.render();return;
        }
        if(event.key.startsWith("Arrow")){
          const obj=this.getModel().surfaces[this.current].elements.find(o=>o.id===this.selected);
          if(!obj)return;
          const step=event.shiftKey?.05:.01;
          const dx=event.key==="ArrowRight"?step:event.key==="ArrowLeft"?-step:0;
          const dy=event.key==="ArrowDown"?step:event.key==="ArrowUp"?-step:0;
          event.preventDefault();
          this.commands.updateObject(this.current,this.selected,{
            x:clamp(obj.x+dx,0,1-obj.width),y:clamp(obj.y+dy,0,1-obj.height)
          });
        }
      },{signal:this.signal});
    }
    load(){
      this.active=true;this.host.dataset.slideEditor="true";this.toolbar.hidden=false;this.inspector.hidden=false;
      this.current=0;this._selectObject(null);
      // An ink tool left active in PDF must never intercept slide selection.
      this.root.dispatchEvent(new CustomEvent("open-doc:ink-mode",{detail:"cursor"}));
      this.render();
    }
    deactivate(){
      this.active=false;this.host.dataset.slideEditor="false";this.toolbar.hidden=true;this.inspector.hidden=true;
      this._selectObject(null);this.drag=null;this.pan=null;
      this.spacePressed=false;this.scroller.style.cursor="";this.inspector.replaceChildren();
    }
    onPageChange(index){
      if(index!==this.current)this._selectObject(null);
      this.current=index;
      const ids=new Set(this.getModel().surfaces[index].elements.map(obj=>obj.id));
      this.selectedIds=new Set(Array.from(this.selectedIds).filter(id=>ids.has(id)));
      if(!ids.has(this.selected))this.selected=Array.from(this.selectedIds).pop()||null;
      if(this.active)this._properties();
    }
    add(type){
      // Insertions activate selection; otherwise the full-page ink SVG wins
      // hit-testing when the user previously selected Pen/Highlighter.
      this.root.dispatchEvent(new CustomEvent("open-doc:ink-mode",{detail:"cursor"}));
      const id=this.commands.insertObject(this.current,type);this._selectObject(id);this.render();
    }
    async importImage(file,replacement=null){
      if(!file||!this.active)return;
      const targetIndex=this.current;
      if(!["image/png","image/jpeg","image/webp"].includes(file.type))
        throw Error("Selecione uma imagem PNG, JPEG ou WebP.");
      if(!file.size||file.size>4*1024*1024)
        throw Error("A imagem deve ter no máximo 4 MB.");
      const encoded=await new Promise((resolve,reject)=>{
        const reader=new FileReader();
        reader.onload=()=>resolve(String(reader.result||""));
        reader.onerror=()=>reject(Error("Não foi possível ler a imagem."));
        reader.readAsDataURL(file);
      });
      if(!this.active)return;
      const prefix="data:"+file.type+";base64,";
      if(!encoded.startsWith(prefix))throw Error("Formato de imagem inválido.");
      const image={mime:file.type,data:encoded.slice(prefix.length),name:file.name.slice(0,80)};
      const id=replacement
        ? this.commands.replaceImage(replacement.index,replacement.id,image)
        : this.commands.insertImage(targetIndex,image);
      this.root.dispatchEvent(new CustomEvent("open-doc:ink-mode",{detail:"cursor"}));
      this.current=replacement?replacement.index:targetIndex;
      this._selectObject(id);this.render();
    }
    _surface(index){return this.scroller.querySelector('.fixed-surface[data-page-index="'+index+'"]');}
    _makeObject(obj,index,thumb=false){
      const node=document.createElement("div");node.className="slide-object slide-object-"+obj.type;
      node.dataset.slideElement=obj.id;node.dataset.kind=obj.type;
      if(!thumb&&this.selectedIds.has(obj.id)&&index===this.current)node.dataset.selected="true";
      this._styleObject(node,obj,index,thumb);
      const vector=this.shapeRenderer.create(obj);
      if(vector)node.append(vector);
      if(obj.type==="image"){
        const asset=(this.getModel().assets||{})[obj.asset_id];
        if(asset){
          const picture=document.createElement("img");picture.alt=obj.name||"Imagem";
          picture.draggable=false;
          picture.src="data:"+asset.mime+";base64,"+asset.data;
          Object.assign(picture.style,{width:"100%",height:"100%",display:"block",
            objectFit:"fill",pointerEvents:"none"});
          node.append(picture);
        }
      }else if(obj.type==="text")node.textContent=obj.text||"";
      else if(obj.text){const label=document.createElement("span");label.textContent=obj.text;node.append(label);}
      if(!thumb&&this.selected===obj.id&&index===this.current){
        const handle=document.createElement("span");handle.className="slide-resize-handle";handle.dataset.resize="true";
        handle.setAttribute("aria-label","Redimensionar objeto");node.append(handle);
      }
      return node;
    }
    _styleObject(node,obj,index=0,thumb=false){
      // Render directly relative to the physical slide, never to the
      // computed percentage size of an intermediate absolutely positioned
      // layer. In QtWebEngine/Chromium 83 that layer may collapse to 0x0.
      const surface=this.getModel().surfaces[index];
      const zoom=thumb?1:this.getZoom();
      const pxWidth=surface.width_pt*4/3*zoom;
      const pxHeight=surface.height_pt*4/3*zoom;
      const bounds=thumb
        ? {left:obj.x*100+"%",top:obj.y*100+"%",
           width:obj.width*100+"%",height:obj.height*100+"%"}
        : {left:obj.x*pxWidth+"px",top:obj.y*pxHeight+"px",
           width:obj.width*pxWidth+"px",height:obj.height*pxHeight+"px"};
      Object.assign(node.style,{
        position:"absolute",boxSizing:"border-box",zIndex:"3",
        ...bounds,
        color:obj.color,backgroundColor:"transparent",
        borderColor:"transparent",
        transform:"rotate("+Number(obj.rotation||0)+"deg) scale("+(obj.flip_h?-1:1)+","+(obj.flip_v?-1:1)+")",
        fontSize:(obj.font_size_pt||28)*4/3*zoom*(thumb?.16:1)+"px",
        fontFamily:JSON.stringify(obj.font_family||"Inter")+",sans-serif"
      });
    }
    _thumb(button,surface,index){
      button.replaceChildren();
      const preview=document.createElement("span");preview.className="slide-thumb-preview";
      // Chromium 83 predates aspect-ratio support. Without an explicit
      // minimum height, the absolutely positioned preview shapes escape the
      // thumbnail's intended layout and may render as oversized ghosts.
      Object.assign(preview.style,{display:"block",position:"relative",
        overflow:"hidden",width:"100%",minHeight:"62px"});
      preview.style.backgroundColor=surface.background||"#FFFFFF";
      for(const obj of surface.elements||[])preview.append(this._makeObject(obj,index,true));
      const title=document.createElement("span");title.textContent="Slide "+(index+1);
      button.append(preview,title);button.dataset.thumbnailIndex=String(index);
      button.onclick=()=>this.go(index);
      button.setAttribute("aria-label","Ir para slide "+(index+1));
    }
    render(){
      if(!this.active)return;
      const slides=this.getModel().surfaces;
      // Remove detached drawing nodes outside pages left by an interrupted
      // render/zoom transition before painting the current slide.
      this.scroller.querySelectorAll(".slide-object").forEach(node=>{
        if(!node.closest(".fixed-surface"))node.remove();
      });
      // After reordering/adding slides, use the existing physical surface
      // containers, not a second canvas or document lifecycle.
      const containers=Array.from(this.scroller.querySelectorAll(".fixed-surface"));
      while(containers.length<slides.length){
        const node=document.createElement("div");node.className="fixed-surface";
        this.scroller.append(node);containers.push(node);
      }
      while(containers.length>slides.length)containers.pop().remove();
      const buttons=Array.from(this.sidebar.querySelectorAll("[data-thumbnail-index]"));
      while(buttons.length<slides.length){const b=document.createElement("button");this.sidebar.append(b);buttons.push(b);}
      while(buttons.length>slides.length)buttons.pop().remove();
      slides.forEach((slide,index)=>{
        const surface=containers[index];surface.dataset.pageIndex=String(index);
        surface.dataset.widthPt=String(slide.width_pt);surface.dataset.heightPt=String(slide.height_pt);
        surface.style.width=slide.width_pt*4/3*this.getZoom()+"px";
        surface.style.height=slide.height_pt*4/3*this.getZoom()+"px";
        surface.style.position="relative";
        surface.style.overflow="hidden";
        surface.style.isolation="isolate";
        surface.querySelector(".slide-object-layer")?.remove();
        const layer=document.createElement("div");layer.className="slide-object-layer";
        // QtWebEngine on Windows embeds Chromium 83, where the CSS "inset"
        // shorthand is ignored. Use explicit physical dimensions so that
        // percentage-positioned SVG shapes never collapse to zero size.
        Object.assign(layer.style,{position:"absolute",top:"0px",left:"0px",
          right:"0px",bottom:"0px",width:"100%",height:"100%"});
        layer.style.zIndex="1";layer.style.pointerEvents="none";
        layer.style.backgroundColor=slide.background||"#FFFFFF";
        surface.prepend(layer);
        // Shapes are direct slide children so percentages on the layer
        // cannot collapse their bounds to zero in legacy QtWebEngine.
        surface.querySelectorAll(":scope > .slide-object").forEach(n=>n.remove());
        for(const obj of slide.elements||[])surface.append(this._makeObject(obj,index));
        this._thumb(buttons[index],slide,index);
      });
      this.root.querySelector("[data-position]").textContent="Slide "+(this.current+1)+" de "+slides.length;
      this.root.querySelector("[data-count]").textContent=slides.length+" slides";
      this.onRender?.(slides);
      this._properties();
    }
    _property(label,value,kind,onChange){
      const wrapper=document.createElement("label");wrapper.textContent=label;
      const input=document.createElement(kind==="textarea"?"textarea":"input");
      if(kind!=="textarea")input.type=kind;
      if(kind==="number"){input.min="0";input.max="100";input.step="1";}
      input.value=String(value);
      input.addEventListener("change",()=>onChange(input.value),{signal:this.signal});
      wrapper.append(input);this.inspector.append(wrapper);return input;
    }
    _toggleProperty(label,checked,onChange){
      const wrapper=document.createElement("label");
      const input=document.createElement("input");
      input.type="checkbox";input.checked=Boolean(checked);
      input.addEventListener("change",()=>onChange(input.checked),{signal:this.signal});
      wrapper.append(input,document.createTextNode(label));
      this.inspector.append(wrapper);return input;
    }
    _properties(){
      this.inspector.replaceChildren();
      const slides=this.getModel().surfaces;
      if(!slides?.length)return;
      this.current=clamp(this.current,0,slides.length-1);
      const slide=slides[this.current],title=document.createElement("h3");title.textContent="Propriedades · Slide "+(this.current+1);
      this.inspector.append(title);
      this._property("Cor de fundo",slide.background||"#FFFFFF","color",value=>this.commands.updateSlide(this.current,{background:value}));
      const subtitle=document.createElement("h4");subtitle.textContent="Camadas";this.inspector.append(subtitle);
      const list=document.createElement("div");list.className="slide-layer-list";
      (slide.elements||[]).slice().reverse().forEach(obj=>{
        const peers=slide.elements.filter(e=>e.type===obj.type);
        const fallback=labelFor(obj.type)+" "+(peers.indexOf(obj)+1);
        const button=document.createElement("button");button.textContent=obj.name||fallback;
        button.setAttribute("aria-pressed",String(this.selectedIds.has(obj.id)));
        button.addEventListener("click",event=>{this._selectObject(obj.id,event.shiftKey);this.render();},{signal:this.signal});
        list.append(button);
      });this.inspector.append(list);
      if(this.selectedIds.size>1){
        const groupActions=document.createElement("div");groupActions.className="slide-layer-actions";
        for(const [label,task] of [
          ["Alinhar centros horizontalmente",()=>this.commands.alignObjects(this.current,this.selectedIds,"x")],
          ["Alinhar centros verticalmente",()=>this.commands.alignObjects(this.current,this.selectedIds,"y")],
          ["Excluir selecionados",()=>{
            this.commands.deleteObjects(this.current,this.selectedIds);
            this._selectObject(null);this.render();
          }]
        ]){
          const button=document.createElement("button");button.type="button";button.textContent=label;
          button.addEventListener("click",task,{signal:this.signal});groupActions.append(button);
        }
        this.inspector.append(groupActions);
      }
      const selected=slide.elements?.find(e=>e.id===this.selected);
      if(selected){
        const heading=document.createElement("h4");heading.textContent="Editar "+labelFor(selected.type);this.inspector.append(heading);
        const sameType=slide.elements.filter(obj=>obj.type===selected.type);
        this._property("Nome",selected.name||labelFor(selected.type)+" "+(sameType.indexOf(selected)+1),"text",value=>{
          const name=value.trim().slice(0,80);
          if(name)this.commands.updateObject(this.current,selected.id,{name});
        });
        if(selected.type==="image"){
          const replaceButton=document.createElement("button");
          replaceButton.type="button";replaceButton.textContent="Substituir imagem";
          replaceButton.addEventListener("click",()=>{
            this.imageReplacement={index:this.current,id:selected.id};
            this.imageInput.click();
          },{signal:this.signal});
          this.inspector.append(replaceButton);
          this._toggleProperty("Espelhar horizontalmente",selected.flip_h||false,
            checked=>this.commands.updateObject(this.current,selected.id,{flip_h:checked}));
          this._toggleProperty("Espelhar verticalmente",selected.flip_v||false,
            checked=>this.commands.updateObject(this.current,selected.id,{flip_v:checked}));
        }
        if(selected.type==="text"||selected.text)this._property("Texto",selected.text||"","textarea",value=>this.commands.updateObject(this.current,selected.id,{text:value.slice(0,10000)}));
        if(selected.type==="text"||selected.text)
          this._property("Cor do texto",selected.color,"color",value=>this.commands.updateObject(this.current,selected.id,{color:value}));
        if(selected.type!=="text"&&selected.type!=="image"){
          if(selected.type!=="line"&&selected.type!=="arrow")
            this._property("Preenchimento",selected.fill,"color",value=>this.commands.updateObject(this.current,selected.id,{fill:value}));
          this._property("Contorno",selected.stroke,"color",value=>this.commands.updateObject(this.current,selected.id,{stroke:value}));
          const strokeField=this._property("Espessura do contorno (pt)",selected.stroke_width||1.5,"number",value=>this.commands.updateObject(this.current,selected.id,{stroke_width:clamp(Number(value)||1.5,.5,20)}));
          strokeField.min=".5";strokeField.max="20";strokeField.step=".5";
        }
        if(selected.type==="text"||selected.text)
          this._property("Fonte (pt)",selected.font_size_pt||28,"number",value=>this.commands.updateObject(this.current,selected.id,{font_size_pt:clamp(Number(value)||28,6,144)}));
        const rotationField=this._property("Rotação (°)",selected.rotation||0,"number",value=>this.commands.updateObject(this.current,selected.id,{rotation:clamp(Number(value)||0,-360,360)}));
        rotationField.min="-360";rotationField.max="360";
        for(const [key,label] of fields)this._property(label,Math.round(selected[key]*100),"number",value=>{
          const amount=clamp(Number(value)/100,0,key==="x"||key==="y"?1:1);
          const patch={[key]:amount};
          const next={...selected,...patch};
          next.x=clamp(next.x,0,1-next.width);
          next.y=clamp(next.y,0,1-next.height);
          next.width=clamp(next.width,.01,1-next.x);
          next.height=clamp(next.height,.01,1-next.y);
          this.commands.updateObject(this.current,selected.id,{
            x:next.x,y:next.y,width:next.width,height:next.height
          });
        });
        const actions=document.createElement("div");actions.className="slide-layer-actions";
        for(const [label,task] of [["Duplicar objeto",()=>{this.selected=this.commands.duplicateObject(this.current,selected.id);this.render();}],
          ["Subir camada",()=>this.commands.shiftLayer(this.current,selected.id,1)],
          ["Descer camada",()=>this.commands.shiftLayer(this.current,selected.id,-1)],
          ["Excluir objeto",()=>{this.commands.deleteObject(this.current,selected.id);this.selected=null;this.render();}]]){
          const b=document.createElement("button");b.textContent=label;
          b.addEventListener("click",task,{signal:this.signal});actions.append(b);
        }this.inspector.append(actions);
      }
      const notes=document.createElement("h4");notes.textContent="Notas do apresentador";this.inspector.append(notes);
      this._property("Notas",slide.notes||"","textarea",value=>this.commands.updateSlide(this.current,{notes:value.slice(0,5000)}));
    }
    _beginPan(event){
      if(!this.active||!(event.button===1||(event.button===0&&this.spacePressed)))return false;
      this.pan={startX:event.clientX,startY:event.clientY,
        left:this.scroller.scrollLeft,top:this.scroller.scrollTop};
      this.scroller.style.cursor="grabbing";
      event.preventDefault();event.stopPropagation();
      return true;
    }
    _movePan(event){
      if(!this.pan||!this.active)return false;
      this.scroller.scrollLeft=this.pan.left-(event.clientX-this.pan.startX);
      this.scroller.scrollTop=this.pan.top-(event.clientY-this.pan.startY);
      event.preventDefault();return true;
    }
    _endPan(event){
      if(!this.pan)return false;
      this.pan=null;
      this.scroller.style.cursor=this.spacePressed?"grab":"";
      event?.preventDefault();return true;
    }
    _start(event){
      if(!this.active||event.button!==0||event.shiftKey)return;
      const node=event.target.closest("[data-slide-element]");
      if(!node)return;
      const surface=node.closest(".fixed-surface"),index=Number(surface.dataset.pageIndex);
      if(index!==this.current)this.current=index;
      const obj=this.getModel().surfaces[index].elements.find(e=>e.id===node.dataset.slideElement);
      if(!obj)return;
      if(!this.selectedIds.has(obj.id))this._selectObject(obj.id);
      this._properties();
      const box=surface.getBoundingClientRect();
      if(!box.width||!box.height)return;
      this.drag={index,id:obj.id,startX:event.clientX,startY:event.clientY,
        initial:clone(obj),box,node,resizing:Boolean(event.target.closest("[data-resize]")),value:null};
      event.preventDefault();event.stopPropagation();
    }
    _drag(event){
      const state=this.drag;if(!state||!this.active)return;
      const dx=(event.clientX-state.startX)/state.box.width,dy=(event.clientY-state.startY)/state.box.height;
      const item={...state.initial};
      if(state.resizing){
        item.width=clamp(state.initial.width+dx,.01,1-state.initial.x);
        item.height=clamp(state.initial.height+dy,.01,1-state.initial.y);
      }else{
        item.x=clamp(state.initial.x+dx,0,1-state.initial.width);
        item.y=clamp(state.initial.y+dy,0,1-state.initial.height);
      }
      state.value=item;
      this._styleObject(state.node,item,state.index);
    }
    _finish(event){
      const drag=this.drag;if(!drag)return;
      this.drag=null;
      if(!drag.value){this.render();return;}
      const patch={x:drag.value.x,y:drag.value.y,width:drag.value.width,height:drag.value.height};
      if(JSON.stringify(patch)===JSON.stringify({x:drag.initial.x,y:drag.initial.y,width:drag.initial.width,height:drag.initial.height}))return;
      this.commands.updateObject(drag.index,drag.id,patch);
      event.preventDefault();
    }
  }

  window.OpenDocSlidesEditor={create:options=>new SlideStudio(options),SlideDeckCommands,SlideSvgRenderer};
})();
