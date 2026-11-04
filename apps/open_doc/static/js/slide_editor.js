/* Native Open Doc slide studio: object-oriented visual editor over the existing
 * Vela fixed-document persistence. No framework, CDN or HTML execution.
 */
"use strict";
(() => {
  const clone=value=>JSON.parse(JSON.stringify(value));
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
  const labelFor=type=>({text:"Texto",rect:"Retângulo",ellipse:"Elipse",
    round_rect:"Arredondado",line:"Linha",arrow:"Seta",
    triangle:"Triângulo",diamond:"Losango"})[type]||"Objeto";
  const SVG_NS="http://www.w3.org/2000/svg";
  const ACTION_ICONS={
    "+ Slide":"add-circle",Duplicar:"duplicate","Excluir slide":"trash",
    "↑ Slide":"arrow-up","↓ Slide":"arrow-down",
    Texto:"type-text",Retângulo:"shape-rectangle",Elipse:"shape-ellipse",
    Arredondado:"shape-rounded",Linha:"shape-line",Seta:"shape-arrow",
    Triângulo:"shape-triangle",Losango:"shape-diamond",
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
        line:"line",arrow:"path",triangle:"polygon",diamond:"polygon"})[obj.type];
      if(!tag)return null;
      const shape=document.createElementNS(SVG_NS,tag);
      const geometry=({
        rect:{x:1,y:1,width:98,height:98},
        round_rect:{x:1,y:1,width:98,height:98,rx:16,ry:16},
        ellipse:{cx:50,cy:50,rx:49,ry:49},
        line:{x1:5,y1:95,x2:95,y2:5},
        arrow:{d:"M 5 95 L 92 8 M 65 8 L 92 8 L 92 35"},
        triangle:{points:"50,2 98,98 2,98"},
        diamond:{points:"50,2 98,50 50,98 2,50"}
      })[obj.type];
      for(const [key,value] of Object.entries(geometry))
        shape.setAttribute(key,String(value));
      const open=obj.type==="line"||obj.type==="arrow";
      shape.setAttribute("fill",open?"none":obj.fill||"#DAE2FD");
      shape.setAttribute("stroke",obj.stroke||"#004AC6");
      shape.setAttribute("stroke-width",open?"3":"1.5");
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
      mutator(next.surfaces);
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
      const offset=(count%8)*.04;
      const obj={id:window.OpenDocModel.id(),type,
        x:.2+offset,y:.24+offset,width:type==="text"?.5:.27,height:type==="text"?.19:.22,
        text:type==="text"?"Novo texto":"",color:"#191C1E",
        fill:"#DAE2FD",stroke:"#004AC6",font_family:"Inter",
        font_size_pt:type==="text"?28:20};
      this.apply(slides=>slides[index].elements.push(obj));
      return obj.id;
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
      this.active=false;this.selected=null;this.current=0;this.drag=null;
      this.toolbar=document.createElement("div");this.toolbar.className="slide-studio-toolbar";this.toolbar.hidden=true;
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
      this._button("Desfazer",()=>this.undo());
      this._button("Refazer",()=>this.redo());
    }
    _bindEvents(){
      this.scroller.addEventListener("pointerdown",event=>this._start(event),{signal:this.signal});
      window.addEventListener("pointermove",event=>this._drag(event),{signal:this.signal});
      window.addEventListener("pointerup",event=>this._finish(event),{signal:this.signal});
      window.addEventListener("pointercancel",()=>{this.drag=null;this.render();},{signal:this.signal});
      this.scroller.addEventListener("click",event=>{
        if(!this.active)return;
        const surface=event.target.closest(".fixed-surface");
        if(!surface)return;
        this.current=Number(surface.dataset.pageIndex);
        const item=event.target.closest("[data-slide-element]");
        this.selected=item?item.dataset.slideElement:null;
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
        if(event.key==="Escape"){this.selected=null;this.render();return;}
        if(!this.selected)return;
        if(event.key==="Delete"||event.key==="Backspace"){
          event.preventDefault();this.commands.deleteObject(this.current,this.selected);
          this.selected=null;this.render();return;
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
      this.current=0;this.selected=null;
      // An ink tool left active in PDF must never intercept slide selection.
      this.root.dispatchEvent(new CustomEvent("open-doc:ink-mode",{detail:"cursor"}));
      this.render();
    }
    deactivate(){
      this.active=false;this.host.dataset.slideEditor="false";this.toolbar.hidden=true;this.inspector.hidden=true;
      this.selected=null;this.drag=null;this.inspector.replaceChildren();
    }
    onPageChange(index){
      this.current=index;if(this.selected&&!this.getModel().surfaces[index].elements.some(o=>o.id===this.selected))this.selected=null;
      if(this.active)this._properties();
    }
    add(type){
      // Insertions activate selection; otherwise the full-page ink SVG wins
      // hit-testing when the user previously selected Pen/Highlighter.
      this.root.dispatchEvent(new CustomEvent("open-doc:ink-mode",{detail:"cursor"}));
      const id=this.commands.insertObject(this.current,type);this.selected=id;this.render();
    }
    _surface(index){return this.scroller.querySelector('.fixed-surface[data-page-index="'+index+'"]');}
    _makeObject(obj,index,thumb=false){
      const node=document.createElement("div");node.className="slide-object slide-object-"+obj.type;
      node.dataset.slideElement=obj.id;node.dataset.kind=obj.type;
      if(!thumb&&this.selected===obj.id&&index===this.current)node.dataset.selected="true";
      this._styleObject(node,obj,index,thumb);
      const vector=this.shapeRenderer.create(obj);
      if(vector)node.append(vector);
      if(obj.type==="text")node.textContent=obj.text||"";
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
        fontSize:(obj.font_size_pt||28)*4/3*zoom*(thumb?.16:1)+"px",
        fontFamily:JSON.stringify(obj.font_family||"Inter")+",sans-serif"
      });
    }
    _thumb(button,surface,index){
      button.replaceChildren();
      const preview=document.createElement("span");preview.className="slide-thumb-preview";
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
        button.setAttribute("aria-pressed",String(this.selected===obj.id));
        button.addEventListener("click",()=>{this.selected=obj.id;this.render();},{signal:this.signal});
        list.append(button);
      });this.inspector.append(list);
      const selected=slide.elements?.find(e=>e.id===this.selected);
      if(selected){
        const heading=document.createElement("h4");heading.textContent="Editar "+labelFor(selected.type);this.inspector.append(heading);
        const sameType=slide.elements.filter(obj=>obj.type===selected.type);
        this._property("Nome",selected.name||labelFor(selected.type)+" "+(sameType.indexOf(selected)+1),"text",value=>{
          const name=value.trim().slice(0,80);
          if(name)this.commands.updateObject(this.current,selected.id,{name});
        });
        if(selected.type==="text"||selected.text)this._property("Texto",selected.text||"","textarea",value=>this.commands.updateObject(this.current,selected.id,{text:value.slice(0,10000)}));
        if(selected.type==="text"||selected.text)
          this._property("Cor do texto",selected.color,"color",value=>this.commands.updateObject(this.current,selected.id,{color:value}));
        if(selected.type!=="text"){
          if(selected.type!=="line"&&selected.type!=="arrow")
            this._property("Preenchimento",selected.fill,"color",value=>this.commands.updateObject(this.current,selected.id,{fill:value}));
          this._property("Contorno",selected.stroke,"color",value=>this.commands.updateObject(this.current,selected.id,{stroke:value}));
        }
        if(selected.type==="text"||selected.text)
          this._property("Fonte (pt)",selected.font_size_pt||28,"number",value=>this.commands.updateObject(this.current,selected.id,{font_size_pt:clamp(Number(value)||28,6,144)}));
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
    _start(event){
      if(!this.active||event.button!==0)return;
      const node=event.target.closest("[data-slide-element]");
      if(!node)return;
      const surface=node.closest(".fixed-surface"),index=Number(surface.dataset.pageIndex);
      if(index!==this.current)this.current=index;
      const obj=this.getModel().surfaces[index].elements.find(e=>e.id===node.dataset.slideElement);
      if(!obj)return;
      this.selected=obj.id;this._properties();
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
