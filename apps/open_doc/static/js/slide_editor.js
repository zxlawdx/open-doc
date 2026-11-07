/* Native Open Doc slide studio: object-oriented visual editor over the existing
 * Vela fixed-document persistence. No framework, CDN or HTML execution.
 */
"use strict";
(() => {
  const clone=value=>JSON.parse(JSON.stringify(value));
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
  const labelFor=type=>({text:"Texto",rect:"Retângulo",ellipse:"Elipse",
    round_rect:"Arredondado",line:"Linha",arrow:"Seta",image:"Imagem",
    triangle:"Triângulo",diamond:"Losango",chart:"Gráfico"})[type]||"Objeto";
  const SVG_NS="http://www.w3.org/2000/svg";
  const ACTION_ICONS={
    "+ Slide":"add-circle",Duplicar:"duplicate","Excluir slide":"trash",
    "↑ Slide":"arrow-up","↓ Slide":"arrow-down",
    "Gráfico: Barras":"chart-bar","Gráfico: Linhas":"chart-line",
    "Gráfico: Pizza":"chart-pie",
    Texto:"type-text",Retângulo:"shape-rectangle",Elipse:"shape-ellipse",
    Arredondado:"shape-rounded",Linha:"shape-line",Seta:"shape-arrow",
    Triângulo:"shape-triangle",Losango:"shape-diamond",Imagem:"image",
    Balde:"paint-bucket","Pintar seleção":"palette",Prévia:"play",Apresentar:"play",
    "Exportar slide":"download",Desfazer:"undo",Refazer:"redo"
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
        rect:{x:0,y:0,width:100,height:100},
        round_rect:{x:0,y:0,width:100,height:100,rx:16,ry:16},
        ellipse:{cx:50,cy:50,rx:50,ry:50},
        line:{x1:0,y1:100,x2:100,y2:0},
        arrow:{points:"4,38 62,38 62,14 98,50 62,86 62,62 4,62"},
        triangle:{points:"50,0 100,100 0,100"},
        diamond:{points:"50,0 100,50 50,100 0,50"}
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
    insertChart(index,kind="bar"){
      if(!["bar","line","pie"].includes(kind))throw Error("Tipo de gráfico inválido.");
      const id=window.OpenDocModel.id();
      this.apply(slides=>{
        const elements=slides[index].elements;
        if(elements.length>=500)throw Error("Limite de 500 objetos por slide atingido.");
        elements.push({
          id,type:"chart",name:"Gráfico de "+({bar:"barras",line:"linhas",pie:"pizza"}[kind]),
          x:.14,y:.2,width:.72,height:.58,rotation:0,stroke_width:1.5,
          color:"#191C1E",fill:"#DAE2FD",stroke:"#004AC6",
          chart_type:kind,chart_title:"Resultados",chart_palette:"blue",
          chart_categories:["2024","2025","2026"],chart_values:[18,25,32]
        });
      });
      return id;
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
          flip_h:false,flip_v:false,
          crop_left:0,crop_right:0,crop_top:0,crop_bottom:0});
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
    constructor({host,root,controls,scroller,sidebar,signal,getModel,update,status,getZoom,go,undo,redo,onRender,exportSlide,onViewportResize}){
      Object.assign(this,{host,root,controls,scroller,sidebar,signal,getModel,update,status,getZoom,go,undo,redo,onRender,exportSlide,onViewportResize});
      this.commands=new SlideDeckCommands(getModel,next=>{update(next);this.render();});
      this.shapeRenderer=new SlideSvgRenderer();
      this.active=false;this.selected=null;this.selectedIds=new Set();this.current=0;this.drag=null;
      this.pan=null;this.spacePressed=false;this.imageReplacement=null;
      this.paintActive=false;this.inlineEditing=null;
      // The active workspace owns one physical slide only. The complete deck
      // and independent thumbnail views stay in the document model/sidebar.
      this.workspace=document.createElement("div");
      this.workspace.className="slide-active-workspace";
      this.workspace.setAttribute("role","region");
      this.workspace.setAttribute("aria-label","Slide ativo");
      this.activeCanvas=null;
      this._resizePending=false;
      this._onWorkspaceResize=()=>{
        if(!this.active||this._resizePending)return;
        this._resizePending=true;
        (window.requestAnimationFrame||window.setTimeout)(()=>{
          this._resizePending=false;
          if(!this.active)return;
          this._sizeWorkspace();
          this.onViewportResize?.();
        });
      };
      window.addEventListener("resize",this._onWorkspaceResize,{signal:this.signal});
      if(window.ResizeObserver){
        this.workspaceObserver=new window.ResizeObserver(this._onWorkspaceResize);
        this.workspaceObserver.observe(scroller);
        this.signal.addEventListener("abort",()=>this.workspaceObserver.disconnect(),{once:true});
      }
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
        try{
          if(this.paintActive&&label!=="Balde"&&this.paintButton){
            this.paintActive=false;this.paintButton.setAttribute("aria-pressed","false");
          }
          const result=action();
          if(result&&typeof result.catch==="function")result.catch(error=>this.status(error.message));
        }catch(error){this.status(error.message);}
      },{signal:this.signal});this.toolbar.append(button);return button;
    }
    _buildToolbar(){
      this._button("+ Slide",()=>{this.commands.insert(this.current);this.current++;this._selectObject(null);this.go(this.current);});
      this._button("Duplicar",()=>{this.commands.duplicate(this.current);this.current++;this._selectObject(null);this.go(this.current);});
      this._button("Excluir slide",()=>{this.commands.remove(this.current);this.current=clamp(this.current,0,this.getModel().surfaces.length-1);this._selectObject(null);});
      this._button("↑ Slide",()=>{this.commands.move(this.current,-1);this.current=clamp(this.current-1,0,this.getModel().surfaces.length-1);this._selectObject(null);});
      this._button("↓ Slide",()=>{this.commands.move(this.current,1);this.current=clamp(this.current+1,0,this.getModel().surfaces.length-1);this._selectObject(null);});
      this._button("Exportar slide",()=>this.exportSlide?.(this.current)||
        this.status("Exportação de slide indisponível."),
        "Exportar o slide selecionado como PPTX editável");
      this._button("Texto",()=>this.add("text"));
      this._button("Retângulo",()=>this.add("rect"));
      this._button("Elipse",()=>this.add("ellipse"));
      this._button("Arredondado",()=>this.add("round_rect"));
      this._button("Linha",()=>this.add("line"));
      this._button("Seta",()=>this.add("arrow"));
      this._button("Triângulo",()=>this.add("triangle"));
      this._button("Losango",()=>this.add("diamond"));
      this._button("Imagem",()=>{this.imageReplacement=null;this.imageInput.click();},"Inserir PNG, JPEG ou WebP");
      for(const [label,kind] of [
        ["Gráfico: Barras","bar"],["Gráfico: Linhas","line"],["Gráfico: Pizza","pie"]
      ])this._button(label,()=>this.insertChart(kind),"Inserir gráfico PPTX nativo e editável");
      this._button("Desfazer",()=>this.undo());
      this._button("Refazer",()=>this.redo());
      this._button("Prévia",()=>this.previewTransition(),"Prévia da transição no slide atual");
      this.presentButton=this._button("Apresentar",()=>this.startPresentation(this.current),"Apresentar a partir do slide selecionado (Shift+F5); F5 inicia no primeiro.");
      const paintLabel=document.createElement("label");paintLabel.className="slide-paint-selector";
      paintLabel.textContent="Cor";
      this.paintColor=document.createElement("input");this.paintColor.type="color";
      this.paintColor.value="#DAE2FD";this.paintColor.setAttribute("aria-label","Cor do balde");
      paintLabel.append(this.paintColor);this.toolbar.append(paintLabel);
      this.paintButton=this._button("Balde",()=>{
        this.paintActive=!this.paintActive;
        this.paintButton.setAttribute("aria-pressed",String(this.paintActive));
        if(this.paintActive)this.paintColor.click();
        this.status(this.paintActive
          ?"Balde ativo: clique em uma forma para aplicar a cor."
          :"Balde desativado.");
      },"Pintar formas clicando diretamente no slide");
      this.paintButton.setAttribute("aria-pressed","false");
      this._button("Pintar seleção",()=>{
        if(!this.selectedIds.size)return this.status("Selecione uma forma para colorir.");
        const ids=new Set(this.selectedIds),color=this.paintColor.value;
        this.commands.apply(slides=>{
          for(const obj of slides[this.current].elements){
            if(!ids.has(obj.id)||obj.type==="image"||obj.type==="chart")continue;
            obj[obj.type==="text"?"color":obj.type==="line"?"stroke":"fill"]=color;
          }
        });
        this.status("Cor aplicada aos objetos selecionados.");
      });
      this._organizeRibbon();
    }
    _organizeRibbon(){
      const actions=Array.from(this.toolbar.querySelectorAll("button"));
      const tabs=document.createElement("div");tabs.className="slide-ribbon-tabs";
      const body=document.createElement("div");body.className="slide-ribbon-body";
      const categories=[
        {label:"Slides",labels:["+ Slide","Duplicar","Excluir slide","↑ Slide","↓ Slide","Exportar slide"]},
        {label:"Inserir",labels:["Texto","Retângulo","Elipse","Arredondado","Linha","Seta","Triângulo","Losango","Imagem","Gráfico: Barras","Gráfico: Linhas","Gráfico: Pizza"]},
        {label:"Formatar",labels:["Balde","Pintar seleção","Desfazer","Refazer"]},
        {label:"Transições",labels:["Prévia","Apresentar"]}
      ];
      const panels=[];
      for(const item of categories){
        const tab=document.createElement("button");tab.type="button";tab.textContent=item.label;
        tab.className="slide-ribbon-tab";tabs.append(tab);
        const group=document.createElement("div");group.className="slide-ribbon-group";group.hidden=true;
        group.setAttribute("aria-label","Ferramentas de "+item.label);
        for(const action of actions){
          if(item.labels.includes(action.textContent))group.append(action);
        }
        if(item.label==="Formatar")group.prepend(this.toolbar.querySelector(".slide-paint-selector"));
        body.append(group);panels.push([tab,group]);
        tab.addEventListener("click",()=>activate(item.label),{signal:this.signal});
      }
      const activate=label=>{
        panels.forEach(([tab,panel],i)=>{
          const enabled=categories[i].label===label;
          tab.setAttribute("aria-selected",String(enabled));panel.hidden=!enabled;
        });
      };
      this.toolbar.prepend(tabs,body);activate("Inserir");
    }
    insertChart(kind){
      const id=this.commands.insertChart(this.current,kind);
      this.root.dispatchEvent(new CustomEvent("open-doc:ink-mode",{detail:"cursor"}));
      this._selectObject(id);this.render();
      this.status("Gráfico editável criado. Altere os dados nas propriedades.");
    }
    _paintObject(index,id){
      const obj=this.getModel().surfaces[index].elements.find(item=>item.id===id);
      if(!obj)return;
      if(obj.type==="image"||obj.type==="chart")
        return this.status(obj.type==="chart"
          ?"Para colorir o gráfico, escolha uma paleta nas propriedades."
          :"O balde não altera os pixels de uma imagem.");
      const property=obj.type==="text"?"color":obj.type==="line"?"stroke":"fill";
      this.commands.updateObject(index,id,{[property]:this.paintColor.value});
      this._selectObject(id);
      this.paintActive=false;
      this.paintButton.setAttribute("aria-pressed","false");
      this.status("Cor aplicada a "+(obj.name||labelFor(obj.type))+".");
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
        if(!this.active||this.inlineEditing)return;
        const surface=event.target.closest(".fixed-surface");
        if(!surface)return;
        const targetIndex=Number(surface.dataset.pageIndex);
        const changedSlide=targetIndex!==this.current;
        this.current=targetIndex;
        const item=event.target.closest("[data-slide-element]");
        if(event.target.closest(".slide-inline-editor"))return;
        if(this.paintActive&&item){
          this._paintObject(targetIndex,item.dataset.slideElement);this.render();return;
        }
        this._selectObject(item?item.dataset.slideElement:null,!changedSlide&&event.shiftKey);
        this.render();
      },{signal:this.signal});
      this.scroller.addEventListener("dblclick",event=>{
        if(!this.active||this.paintActive)return;
        const item=event.target.closest('[data-slide-element]');
        if(!item)return;
        const index=Number(item.closest(".fixed-surface").dataset.pageIndex),id=item.dataset.slideElement;
        const obj=this.getModel().surfaces[index].elements.find(e=>e.id===id);
        if(!obj||(obj.type!=="text"&&!obj.text))return;
        event.preventDefault();event.stopPropagation();
        this._editText(index,id,item,obj.text);
      },{signal:this.signal});
      this.root.addEventListener("keydown",event=>{
        if(!this.active)return;
        if(event.target.closest("input,textarea,[contenteditable=true]"))return;
        if(event.key===" "){event.preventDefault();this.spacePressed=true;
          if(!this.pan)this.scroller.style.cursor="grab";return;}
        if(event.key==="F5"){
          event.preventDefault();this.startPresentation(event.shiftKey?this.current:0);return;
        }
        if(event.key==="F11"){
          event.preventDefault();
          window.Vela?.platform?.window?.toggleFullscreen()
            .catch(error=>this.status(error.message));return;
        }
        if(event.key==="Escape"){
          if(this.paintActive){this.paintActive=false;this.paintButton.setAttribute("aria-pressed","false");}
          this.lastTextTap=null;this._selectObject(null);this.render();return;
        }
        if(!this.selected)return;
        if(event.key==="Delete"||event.key==="Backspace"){
          event.preventDefault();
          this.commands.deleteObjects(this.current,this.selectedIds);
          this._selectObject(null);this.render();return;
        }
        if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="d"){
          event.preventDefault();
          this._selectObject(this.commands.duplicateObject(this.current,this.selected));this.render();return;
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
      this.scroller.replaceChildren(this.workspace);
      this.current=0;this._selectObject(null);
      // An ink tool left active in PDF must never intercept slide selection.
      this.root.dispatchEvent(new CustomEvent("open-doc:ink-mode",{detail:"cursor"}));
      this.render();
    }
    deactivate(){
      this.stopPresentation();
      this.active=false;this.host.dataset.slideEditor="false";this.toolbar.hidden=true;this.inspector.hidden=true;
      this._selectObject(null);this.drag=null;this.pan=null;
      this.spacePressed=false;this.scroller.style.cursor="";this.inspector.replaceChildren();
      this.activeCanvas=null;this.workspace.replaceChildren();this.workspace.remove();
    }
    selectSearchResult(index,id){
      if(!this.active)return;
      const slide=this.getModel().surfaces[index];
      if(!slide?.elements?.some(object=>object.id===id))return;
      this.current=index;
      this._selectObject(id);
      this.render();
      const object=this._surface(index)?.querySelector('[data-slide-element="'+id+'"]');
      if(object){
        object.classList.add("slide-search-match");
        object.scrollIntoView?.({block:"center",inline:"nearest"});
      }
    }
    goTo(index){
      if(!this.active || !this.getModel().surfaces[index])return;
      this.onPageChange(index);
      this.render();
    }
    onPageChange(index){
      if(!this.active || !this.getModel().surfaces[index]?.elements)return;
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
    _editText(index,id,node,value){
      if(this.inlineEditing)return;
      const editor=document.createElement("textarea");
      editor.className="slide-inline-editor";editor.value=value||"";
      editor.maxLength=10000;editor.setAttribute("aria-label","Editar texto diretamente no slide");
      const previous=node.style.overflow;
      node.replaceChildren(editor);node.style.overflow="hidden";
      this.inlineEditing=editor;
      let finished=false;
      const finish=save=>{
        if(finished)return;finished=true;
        this.inlineEditing=null;node.style.overflow=previous;
        if(save&&editor.value!==value)
          this.commands.updateObject(index,id,{text:editor.value.slice(0,10000)});
        else this.render();
      };
      editor.addEventListener("keydown",event=>{
        if(event.key==="Escape"){event.preventDefault();finish(false);}
        if((event.ctrlKey||event.metaKey)&&event.key==="Enter"){
          event.preventDefault();finish(true);
        }
      },{signal:this.signal});
      editor.addEventListener("blur",()=>finish(true),{signal:this.signal});
      editor.focus();editor.select();
    }
    startPresentation(startIndex=this.current){
      if(!this.active||this.presentation)return;
      if(this.inlineEditing)this.inlineEditing.blur();
      const slides=this.getModel().surfaces;
      if(!slides?.length)return;
      const overlay=document.createElement("section");
      overlay.className="slide-presentation";overlay.tabIndex=-1;
      overlay.setAttribute("role","dialog");overlay.setAttribute("aria-modal","true");
      overlay.setAttribute("aria-label","Apresentação de slides");
      const viewport=document.createElement("div");viewport.className="slide-presentation-viewport";
      const stage=document.createElement("div");stage.className="slide-presentation-stage";
      viewport.append(stage);
      const footer=document.createElement("nav");footer.className="slide-presentation-controls";
      footer.setAttribute("aria-label","Controle da apresentação");
      const control=(label,path)=>{
        const button=document.createElement("button");button.type="button";
        button.title=label;button.setAttribute("aria-label",label);
        const svg=document.createElementNS(SVG_NS,"svg");
        svg.setAttribute("viewBox","0 0 24 24");svg.setAttribute("aria-hidden","true");
        svg.setAttribute("fill","none");svg.setAttribute("stroke","currentColor");
        svg.setAttribute("stroke-width","1.8");svg.setAttribute("stroke-linecap","round");
        svg.setAttribute("stroke-linejoin","round");
        const shape=document.createElementNS(SVG_NS,"path");shape.setAttribute("d",path);
        svg.append(shape);button.append(svg);return button;
      };
      const previous=control("Slide anterior (←)","m14 6-6 6 6 6");
      const next=control("Próximo slide (→)","m10 6 6 6-6 6");
      const close=control("Encerrar apresentação (Esc)","M6 6 18 18 M18 6 6 18");
      const count=document.createElement("output");count.setAttribute("aria-live","polite");
      footer.append(previous,count,next,close);overlay.append(viewport,footer);
      this.root.append(overlay);
      const state={overlay,viewport,stage,previous,next,count,
        index:clamp(startIndex,0,slides.length-1),returning:document.activeElement,
        render:null,resize:null,controlTimer:null,animationTimer:null,animationId:0,
        nativeWindow:window.Vela?.platform?.window||null,wasFullscreen:null};
      this.presentation=state;
      if(!window.requestAnimationFrame)window.requestAnimationFrame=callback=>setTimeout(callback,16);
      const raiseControls=()=>{
        overlay.classList.add("show-controls");
        clearTimeout(state.controlTimer);
        state.controlTimer=setTimeout(()=>{
          if(this.presentation===state && !footer.matches(":hover")
            && !footer.contains(document.activeElement))
            overlay.classList.remove("show-controls");
        },1900);
      };
      const slideFrame=index=>{
        const surface=slides[index],source=this._surface(index)||this._buildSurface(index);
        if(!surface||!source)return null;
        const frame=document.createElement("div");frame.className="slide-presentation-frame";
        const page=source.cloneNode(true);
        page.querySelectorAll(".slide-resize-handle,.slide-rotate-handle,.slide-inline-editor,.ink-overlay").forEach(node=>node.remove());
        page.querySelectorAll("[data-selected]").forEach(node=>node.removeAttribute("data-selected"));
        const width=surface.width_pt*4/3,height=surface.height_pt*4/3;
        // The authoring canvas stores CSS-pixel positions at the editor zoom.
        // Recompute show geometry from normalized model coordinates, otherwise
        // slides at 84% editor zoom are incorrectly scaled in full-screen mode.
        for(const element of surface.elements||[]){
          const object=page.querySelector('[data-slide-element="'+element.id+'"]');
          if(!object)continue;
          Object.assign(object.style,{
            left:element.x*width+"px",top:element.y*height+"px",
            width:element.width*width+"px",height:element.height*height+"px",
            fontSize:(element.font_size_pt||28)*4/3+"px"
          });
        }
        Object.assign(page.style,{width:width+"px",height:height+"px",left:"0px",top:"0px",
          position:"absolute",margin:"0",border:"0",boxShadow:"none",
          transformOrigin:"0 0",transform:"scale("+state.scale+")"});
        frame.append(page);return frame;
      };
      const dimensions=()=>{
        const slide=slides[state.index];
        if(!slide)return;
        const width=slide.width_pt*4/3,height=slide.height_pt*4/3;
        state.scale=Math.min(window.innerWidth/width,window.innerHeight/height);
        Object.assign(stage.style,{width:(width*state.scale)+"px",
          height:(height*state.scale)+"px"});
      };
      const indicators=()=>{
        count.textContent=(state.index+1)+" / "+slides.length;
        previous.disabled=state.index===0;
        next.disabled=state.index===slides.length-1;
      };
      const cancelAnimation=()=>{
        state.animationId++;
        clearTimeout(state.animationTimer);
        if(state.render)state.stage.replaceChildren(state.render);
        else state.stage.replaceChildren();
        if(state.render){
          state.render.style.transition="";
          state.render.style.transform="";
          state.render.style.opacity="";
          state.render.style.clipPath="";
        }
      };
      const draw=()=>{
        if(this.presentation!==state)return;
        cancelAnimation();dimensions();
        state.render=slideFrame(state.index);
        stage.replaceChildren(state.render||[]);
        indicators();
      };
      const navigate=(index,immediate=false)=>{
        if(this.presentation!==state)return;
        const target=clamp(index,0,slides.length-1);
        if(target===state.index)return;
        cancelAnimation();
        const origin=state.render;
        state.index=target;
        dimensions();
        const incoming=slideFrame(target);
        const transition=slides[target]?.transition||"none";
        const direction=transition.endsWith("right")?"right":"left";
        const speed=slides[target]?.transition_speed||"med";
        const duration={fast:260,med:520,slow:900}[speed]||520;
        state.render=incoming;
        indicators();
        if(!origin||!incoming||immediate||transition==="none"){
          stage.replaceChildren(incoming||[]);
          return;
        }
        const token=++state.animationId;
        origin.classList.add("slide-presentation-outgoing");
        incoming.classList.add("slide-presentation-incoming");
        stage.replaceChildren(origin,incoming);
        const offset=direction==="right"?"100%":"-100%";
        const inverse=direction==="right"?"-100%":"100%";
        if(transition==="fade"){
          incoming.style.opacity="0";
        }else if(transition.startsWith("push")){
          incoming.style.transform="translateX("+inverse+")";
        }else if(transition.startsWith("wipe")){
          incoming.style.clipPath=direction==="right"
            ?"inset(0 0 0 100%)":"inset(0 100% 0 0)";
        }
        // Force layout once before applying transitions. Invalidated by token
        // on repeated arrow presses so stale callbacks cannot mix slide frames.
        incoming.getBoundingClientRect();
        const property=transition==="fade"?"opacity":
          transition.startsWith("wipe")?"clip-path":"transform";
        incoming.style.transition=property+" "+duration+"ms ease";
        if(transition.startsWith("push"))origin.style.transition="transform "+duration+"ms ease";
        window.requestAnimationFrame(()=>{
          if(this.presentation!==state||token!==state.animationId)return;
          if(transition==="fade")incoming.style.opacity="1";
          else if(transition.startsWith("push")){
            incoming.style.transform="translateX(0)";
            origin.style.transform="translateX("+offset+")";
          }else if(transition.startsWith("wipe"))incoming.style.clipPath="inset(0 0 0 0)";
        });
        state.animationTimer=setTimeout(()=>{
          if(this.presentation===state&&token===state.animationId){
            incoming.style.transition="";incoming.style.transform="";
            incoming.style.opacity="";incoming.style.clipPath="";
            stage.replaceChildren(incoming);
          }
        },duration+50);
      };
      state.resize=draw;
      window.addEventListener("resize",draw);
      overlay.addEventListener("pointermove",raiseControls);
      footer.addEventListener("pointerenter",raiseControls);
      previous.addEventListener("click",()=>navigate(state.index-1));
      next.addEventListener("click",()=>navigate(state.index+1));
      close.addEventListener("click",()=>this.stopPresentation());
      overlay.addEventListener("keydown",event=>{
        if(event.key==="Escape"){event.preventDefault();event.stopPropagation();this.stopPresentation();return;}
        if(event.key==="F11"){
          event.preventDefault();event.stopPropagation();
          state.nativeWindow?.toggleFullscreen().catch(error=>this.status(error.message));return;
        }
        if(event.target.closest("button")&&(event.key===" "||event.key==="Enter"))return;
        const forward=["ArrowRight","ArrowDown","PageDown"," ","Enter"];
        const backward=["ArrowLeft","ArrowUp","PageUp"];
        if(forward.includes(event.key)||backward.includes(event.key)){
          event.preventDefault();event.stopPropagation();
          navigate(state.index+(forward.includes(event.key)?1:-1));
        }else if(event.key==="Home"||event.key==="End"){
          event.preventDefault();event.stopPropagation();
          navigate(event.key==="Home"?0:slides.length-1,true);
        }
      });
      // Window state is platform infrastructure, not slide editor business logic.
      // The JS fullscreen request resolves only after the bridge processes it.
      if(state.nativeWindow){
        state.nativeWindow.getState().then(result=>{
          state.wasFullscreen=Boolean(result.fullscreen);
          if(this.presentation===state)return state.nativeWindow.enterFullscreen();
        }).then(()=>{if(this.presentation===state)draw();})
          .catch(error=>this.status("Tela cheia indisponível: "+error.message));
      }else this.status("Apresentação em janela; atualize o Vela para tela cheia nativa.");
      state.render=null;
      draw();overlay.focus();raiseControls();
    }
    stopPresentation(){
      if(!this.presentation)return;
      const state=this.presentation;this.presentation=null;
      clearTimeout(state.controlTimer);clearTimeout(state.animationTimer);
      state.animationId++;
      window.removeEventListener("resize",state.resize);
      state.overlay.remove();
      if(state.nativeWindow && state.wasFullscreen!==null)
        state.nativeWindow.setFullscreen(state.wasFullscreen)
          .catch(error=>this.status("Falha ao restaurar janela: "+error.message));
      if(state.returning?.isConnected)state.returning.focus();
    }
    previewTransition(){
      const effect=this.getModel().surfaces[this.current]?.transition||"none";
      if(effect==="none")return this.status("Selecione uma transição nas propriedades do slide.");
      const node=this._surface(this.current);
      if(!node)return;
      const key={"fade":"open-doc-transition-fade",
        "push-left":"open-doc-transition-push-left","push-right":"open-doc-transition-push-right",
        "wipe-left":"open-doc-transition-wipe-left","wipe-right":"open-doc-transition-wipe-right"}[effect];
      if(!key)return;
      const speed=this.getModel().surfaces[this.current]?.transition_speed||"med";
      const ms={slow:1200,med:700,fast:400}[speed]||700;
      node.style.animation="none";
      // Force restart without removing the slide or the text editing model.
      void node.offsetWidth;
      node.style.animation=key+" "+ms+"ms ease both";
      node.addEventListener("animationend",()=>{node.style.animation="";},{once:true,signal:this.signal});
      this.status("Prévia da transição: "+effect+".");
    }
    _surface(index){return this.scroller.querySelector('.fixed-surface[data-page-index="'+index+'"]');}
    _makeObject(obj,index,thumb=false){
      const node=document.createElement("div");node.className="slide-object slide-object-"+obj.type;
      node.dataset.slideElement=obj.id;node.dataset.kind=obj.type;
      if(!thumb&&this.selectedIds.has(obj.id)&&index===this.current)node.dataset.selected="true";
      this._styleObject(node,obj,index,thumb);
      const vector=this.shapeRenderer.create(obj);
      if(vector)node.append(vector);
      if(obj.type==="chart"){
        if(window.OpenDocSlideCharts?.ChartPreview)
          node.append(window.OpenDocSlideCharts.ChartPreview.render(obj));
        else {
          const placeholder=document.createElement("span");
          placeholder.textContent="Gráfico · "+(obj.chart_title||"Sem título");
          node.append(placeholder);
        }
      }else if(obj.type==="image"){
        const asset=(this.getModel().assets||{})[obj.asset_id];
        if(asset){
          // Keep picture pixels behind an independent clipping viewport: the
          // outer object retains its resize handle, rotation and selection.
          const crop={left:Number(obj.crop_left)||0,right:Number(obj.crop_right)||0,
            top:Number(obj.crop_top)||0,bottom:Number(obj.crop_bottom)||0};
          const visibleWidth=Math.max(.05,1-crop.left-crop.right);
          const visibleHeight=Math.max(.05,1-crop.top-crop.bottom);
          const viewport=document.createElement("span");
          viewport.className="slide-image-crop";
          Object.assign(viewport.style,{position:"absolute",top:"0px",left:"0px",
            width:"100%",height:"100%",overflow:"hidden",pointerEvents:"none"});
          const picture=document.createElement("img");picture.alt=obj.name||"Imagem";
          picture.draggable=false;
          picture.src="data:"+asset.mime+";base64,"+asset.data;
          Object.assign(picture.style,{position:"absolute",display:"block",
            width:(100/visibleWidth)+"%",height:(100/visibleHeight)+"%",
            left:(-100*crop.left/visibleWidth)+"%",
            top:(-100*crop.top/visibleHeight)+"%",
            objectFit:"fill",pointerEvents:"none",
            opacity:String((obj.image_opacity??100)/100)});
          if(obj.image_brightness||obj.image_contrast||obj.image_grayscale){
            picture.style.filter="brightness("+(100+(obj.image_brightness??0))+"%) contrast("+
              (100+(obj.image_contrast??0))+"%) grayscale("+(obj.image_grayscale?100:0)+"%)";
          }
          viewport.append(picture);node.append(viewport);
        }
      }else if(obj.type==="text")node.textContent=obj.text||"";
      else if(obj.text){const label=document.createElement("span");label.textContent=obj.text;node.append(label);}
      if(!thumb&&this.selected===obj.id&&index===this.current){
        for(const direction of ["nw","n","ne","e","se","s","sw","w"]){
          const handle=document.createElement("span");
          handle.className="slide-resize-handle slide-handle-"+direction;
          handle.dataset.resize=direction;
          handle.setAttribute("aria-label","Redimensionar: "+direction);node.append(handle);
        }
        if(obj.type!=="chart"){
          const rotate=document.createElement("span");
          rotate.className="slide-rotate-handle";rotate.dataset.rotate="true";
          rotate.setAttribute("aria-label","Girar objeto");
          node.append(rotate);
        }
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
      const preview=document.createElement("span");
      preview.className="slide-thumb-preview";
      // QtWebEngine on Windows may lack the CSS aspect-ratio property.
      // Physical height follows each presentation's original dimensions.
      const sidebarWidth=Math.max(100,this.sidebar.clientWidth-38||142);
      const ratio=surface.height_pt/surface.width_pt;
      Object.assign(preview.style,{display:"block",position:"relative",
        overflow:"hidden",width:"100%",minHeight:"0px",
        height:Math.round(sidebarWidth*ratio)+"px",
        aspectRatio:String(surface.width_pt)+"/"+String(surface.height_pt)});
      preview.style.backgroundColor=surface.background||"#FFFFFF";
      for(const obj of surface.elements||[])preview.append(this._makeObject(obj,index,true));
      const title=document.createElement("span");
      title.textContent="Slide "+(index+1);
      button.append(preview,title);
      button.dataset.thumbnailIndex=String(index);
      button.setAttribute("aria-label","Ir para slide "+(index+1));
      button.setAttribute("aria-current",String(index===this.current));
      button.onclick=()=>this.go(index);
    }
    _buildSurface(index){
      const slide=this.getModel().surfaces[index];
      if(!slide)return null;
      const surface=document.createElement("div");
      surface.className="fixed-surface slide-active-canvas";
      surface.dataset.pageIndex=String(index);
      surface.dataset.widthPt=String(slide.width_pt);
      surface.dataset.heightPt=String(slide.height_pt);
      Object.assign(surface.style,{
        position:"relative",overflow:"hidden",isolation:"isolate",
        flex:"0 0 auto",margin:"0",backgroundColor:slide.background||"#FFFFFF",
        width:slide.width_pt*4/3*this.getZoom()+"px",
        height:slide.height_pt*4/3*this.getZoom()+"px"
      });
      const background=document.createElement("div");
      background.className="slide-object-layer";
      Object.assign(background.style,{
        position:"absolute",top:"0px",left:"0px",right:"0px",bottom:"0px",
        width:"100%",height:"100%",zIndex:"1",pointerEvents:"none",
        backgroundColor:slide.background||"#FFFFFF"
      });
      surface.append(background);
      for(const obj of slide.elements||[])surface.append(this._makeObject(obj,index));
      return surface;
    }
    _sizeWorkspace(){
      if(!this.active||!this.activeCanvas)return;
      const width=parseFloat(this.activeCanvas.style.width)||0;
      const height=parseFloat(this.activeCanvas.style.height)||0;
      // Give the slide breathing room without squeezing it when zoom > fit.
      // The scrollable workspace grows around this ONE slide, not around a
      // vertical list of physical document pages.
      Object.assign(this.workspace.style,{
        boxSizing:"border-box",display:"flex",alignItems:"center",
        justifyContent:"center",padding:"32px",
        width:Math.max(this.scroller.clientWidth,width+64)+"px",
        height:Math.max(this.scroller.clientHeight,height+64)+"px"
      });
    }
    render(){
      if(!this.active)return;
      const slides=this.getModel().surfaces;
      if(!slides?.length)return;
      this.current=clamp(this.current,0,slides.length-1);
      // Use one editable physical canvas, replacing it on selection changes.
      // Unlike a PDF reader, this viewport never stacks slide page elements.
      const canvas=this._buildSurface(this.current);
      this.activeCanvas=canvas;
      if(this.scroller.firstChild!==this.workspace)
        this.scroller.replaceChildren(this.workspace);
      this.workspace.replaceChildren(canvas);
      this._sizeWorkspace();
      const buttons=Array.from(this.sidebar.querySelectorAll("[data-thumbnail-index]"));
      while(buttons.length<slides.length){
        const button=document.createElement("button");
        this.sidebar.append(button);buttons.push(button);
      }
      while(buttons.length>slides.length)buttons.pop().remove();
      slides.forEach((slide,index)=>this._thumb(buttons[index],slide,index));
      this.root.querySelector("[data-position]").textContent=
        "Slide "+(this.current+1)+" de "+slides.length;
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
      const transitionTitle=document.createElement("h4");transitionTitle.textContent="Transição de entrada deste slide";
      this.inspector.append(transitionTitle);
      const transitionLabel=document.createElement("label");transitionLabel.textContent="Efeito";
      const transitionSelect=document.createElement("select");transitionSelect.setAttribute("aria-label","Transição do slide");
      for(const [value,label] of [
        ["none","Nenhuma"],["fade","Desvanecer"],
        ["push-left","Empurrar para esquerda"],["push-right","Empurrar para direita"],
        ["wipe-left","Revelar à esquerda"],["wipe-right","Revelar à direita"]
      ]){
        const option=document.createElement("option");option.value=value;option.textContent=label;transitionSelect.append(option);
      }
      transitionSelect.value=slide.transition||"none";
      transitionSelect.addEventListener("change",()=>this.commands.updateSlide(this.current,{transition:transitionSelect.value}),{signal:this.signal});
      transitionLabel.append(transitionSelect);this.inspector.append(transitionLabel);
      const speedLabel=document.createElement("label");speedLabel.textContent="Velocidade";
      const speedSelect=document.createElement("select");speedSelect.setAttribute("aria-label","Velocidade da transição");
      for(const [value,label] of [["fast","Rápida"],["med","Normal"],["slow","Lenta"]]){
        const option=document.createElement("option");option.value=value;option.textContent=label;speedSelect.append(option);
      }
      speedSelect.value=slide.transition_speed||"med";
      speedSelect.addEventListener("change",()=>this.commands.updateSlide(this.current,{transition_speed:speedSelect.value}),{signal:this.signal});
      speedLabel.append(speedSelect);this.inspector.append(speedLabel);
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
        if(selected.type==="chart"&&window.OpenDocSlideCharts?.ChartInspector){
          window.OpenDocSlideCharts.ChartInspector.mount(
            this.inspector,selected,
            patch=>this.commands.updateObject(this.current,selected.id,patch),
            this.status,this.signal
          );
        }
        if(selected.type==="image"){
          const replaceButton=document.createElement("button");
          replaceButton.type="button";replaceButton.textContent="Substituir imagem";
          replaceButton.addEventListener("click",()=>{
            this.imageReplacement={index:this.current,id:selected.id};
            this.imageInput.click();
          },{signal:this.signal});
          this.inspector.append(replaceButton);
          for(const [key,label,minimum,initial] of [
            ["image_opacity","Opacidade (%)",0,100],
            ["image_brightness","Brilho (%)",-100,0],
            ["image_contrast","Contraste (%)",-100,0]
          ]){
            const input=this._property(label,selected[key]??initial,"number",value=>{
              const amount=value===""?initial:clamp(Number(value),minimum,100);
              this.commands.updateObject(this.current,selected.id,{[key]:amount});
            });
            input.min=String(minimum);
          }
          this._toggleProperty("Preto e branco",selected.image_grayscale,
            checked=>this.commands.updateObject(this.current,selected.id,{image_grayscale:checked}));
          const reset=document.createElement("button");
          reset.type="button";reset.textContent="Restaurar ajustes de cor e opacidade";
          reset.addEventListener("click",()=>this.commands.updateObject(this.current,selected.id,{
            image_opacity:100,image_brightness:0,image_contrast:0,image_grayscale:false
          }),{signal:this.signal});
          this.inspector.append(reset);
          this._toggleProperty("Espelhar horizontalmente",selected.flip_h||false,
            checked=>this.commands.updateObject(this.current,selected.id,{flip_h:checked}));
          this._toggleProperty("Espelhar verticalmente",selected.flip_v||false,
            checked=>this.commands.updateObject(this.current,selected.id,{flip_v:checked}));
          for(const [key,opposite,label] of [
            ["crop_left","crop_right","Recorte esquerdo (%)"],
            ["crop_right","crop_left","Recorte direito (%)"],
            ["crop_top","crop_bottom","Recorte superior (%)"],
            ["crop_bottom","crop_top","Recorte inferior (%)"]
          ]){
            const input=this._property(label,Math.round((selected[key]||0)*100),"number",value=>{
              const maximum=Math.max(0,.95-(selected[opposite]||0));
              const amount=clamp((Number(value)||0)/100,0,maximum);
              this.commands.updateObject(this.current,selected.id,{[key]:amount});
            });
            input.min="0";input.max="95";input.step="1";
          }
        }
        if(selected.type==="text"||selected.text)this._property("Texto",selected.text||"","textarea",value=>this.commands.updateObject(this.current,selected.id,{text:value.slice(0,10000)}));
        if(selected.type==="text"||selected.text)
          this._property("Cor do texto",selected.color,"color",value=>this.commands.updateObject(this.current,selected.id,{color:value}));
        if(selected.type!=="text"&&selected.type!=="image"&&selected.type!=="chart"){
          if(selected.type!=="line"&&selected.type!=="arrow")
            this._property("Preenchimento",selected.fill,"color",value=>this.commands.updateObject(this.current,selected.id,{fill:value}));
          this._property("Contorno",selected.stroke,"color",value=>this.commands.updateObject(this.current,selected.id,{stroke:value}));
          const strokeField=this._property("Espessura do contorno (pt)",selected.stroke_width||1.5,"number",value=>this.commands.updateObject(this.current,selected.id,{stroke_width:clamp(Number(value)||1.5,.5,20)}));
          strokeField.min=".5";strokeField.max="20";strokeField.step=".5";
        }
        if(selected.type==="text"||selected.text)
          this._property("Fonte (pt)",selected.font_size_pt||28,"number",value=>this.commands.updateObject(this.current,selected.id,{font_size_pt:clamp(Number(value)||28,6,144)}));
        if(selected.type!=="chart"){
          const rotationField=this._property("Rotação (°)",selected.rotation||0,"number",value=>this.commands.updateObject(this.current,selected.id,{rotation:clamp(Number(value)||0,-360,360)}));
          rotationField.min="-360";rotationField.max="360";
        }
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
        for(const [label,task] of [["Duplicar objeto",()=>{this._selectObject(this.commands.duplicateObject(this.current,selected.id));this.render();}],
          ["Subir camada",()=>this.commands.shiftLayer(this.current,selected.id,1)],
          ["Descer camada",()=>this.commands.shiftLayer(this.current,selected.id,-1)],
          ["Excluir objeto",()=>{this.commands.deleteObject(this.current,selected.id);this._selectObject(null);this.render();}]]){
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
      if(!this.active||event.button!==0||event.shiftKey||this.paintActive)return;
      if(event.target.closest(".slide-inline-editor"))return;
      const node=event.target.closest("[data-slide-element]");
      if(!node)return;
      const surface=node.closest(".fixed-surface"),index=Number(surface.dataset.pageIndex);
      if(index!==this.current)this.current=index;
      const obj=this.getModel().surfaces[index].elements.find(e=>e.id===node.dataset.slideElement);
      if(!obj)return;
      // DOM nodes can be replaced after the first pointer-up. Match stable IDs
      // so two taps activate inline text editing even on legacy QtWebEngine.
      const now=Date.now(),previous=this.lastTextTap;
      const editable=obj.type==="text"||typeof obj.text==="string";
      if(editable&&previous?.id===obj.id&&previous.index===index&&now-previous.time<650
        &&!event.target.closest("[data-resize],[data-rotate]")){
        this.lastTextTap=null;this.drag=null;this._selectObject(obj.id);
        event.preventDefault();event.stopPropagation();
        this._editText(index,obj.id,node,obj.text||"");return;
      }
      this.lastTextTap=editable?{id:obj.id,index,time:now}:null;
      if(!this.selectedIds.has(obj.id))this._selectObject(obj.id);
      this._properties();
      const box=surface.getBoundingClientRect();
      if(!box.width||!box.height)return;
      const handle=event.target.closest("[data-resize]")?.dataset.resize||null;
      const rotating=Boolean(event.target.closest("[data-rotate]"));
      const centerX=box.left+(obj.x+obj.width/2)*box.width;
      const centerY=box.top+(obj.y+obj.height/2)*box.height;
      this.drag={index,id:obj.id,startX:event.clientX,startY:event.clientY,
        initial:clone(obj),box,node,handle,rotating,centerX,centerY,
        startingAngle:Math.atan2(event.clientY-centerY,event.clientX-centerX),value:null};
      event.preventDefault();event.stopPropagation();
    }
    _drag(event){
      const state=this.drag;if(!state||!this.active)return;
      const dx=(event.clientX-state.startX)/state.box.width,dy=(event.clientY-state.startY)/state.box.height;
      const item={...state.initial};
      if(state.rotating){
        const angle=Math.atan2(event.clientY-state.centerY,event.clientX-state.centerX);
        item.rotation=clamp(Math.round((state.initial.rotation||0)
          +(angle-state.startingAngle)*180/Math.PI),-360,360);
      }else if(state.handle){
        const h=state.handle;
        const left=state.initial.x,right=left+state.initial.width;
        const top=state.initial.y,bottom=top+state.initial.height;
        if(h.includes("w"))item.x=clamp(left+dx,0,right-.01);
        if(h.includes("n"))item.y=clamp(top+dy,0,bottom-.01);
        if(h.includes("e"))item.width=clamp(right+dx-item.x,.01,1-item.x);
        else item.width=right-item.x;
        if(h.includes("s"))item.height=clamp(bottom+dy-item.y,.01,1-item.y);
        else item.height=bottom-item.y;
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
      if(!drag.value){
        if(drag.node.dataset.selected!=="true")this.render();
        return;
      }
      const patch={x:drag.value.x,y:drag.value.y,width:drag.value.width,
        height:drag.value.height,rotation:drag.value.rotation};
      if(JSON.stringify(patch)===JSON.stringify({x:drag.initial.x,y:drag.initial.y,
        width:drag.initial.width,height:drag.initial.height,rotation:drag.initial.rotation}))return;
      this.commands.updateObject(drag.index,drag.id,patch);
      event.preventDefault();
    }
  }

  window.OpenDocSlidesEditor={create:options=>new SlideStudio(options),SlideDeckCommands,SlideSvgRenderer};
})();
