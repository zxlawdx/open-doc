/* Ofício design presentation controllers. No application data or Vela runtime duplicated. */
"use strict";
(() => {
  const ICON_BY_FORMAT={docx:"file-text",pdf:"pdf",pptx:"slides",md:"file-text",txt:"file-text",odt:"file-text",odp:"slides"};
  const GROUP={odt:"docx",odp:"pptx",txt:"md"};
  function normalizedFormat(value){
    const format=String(value||"").toLowerCase().replace(/^\./,"");
    return GROUP[format]||format||"docx";
  }
  function localIcon(root,name){
    const source=root.querySelector(".product use")?.getAttribute("href")||"";
    const icon=document.createElementNS("http://www.w3.org/2000/svg","svg");
    icon.setAttribute("aria-hidden","true");
    const use=document.createElementNS("http://www.w3.org/2000/svg","use");
    use.setAttribute("href",source.split("#")[0]+"#"+name);
    icon.append(use);
    return icon;
  }

  class LibraryView {
    constructor(root,signal) {
      this.root=root;this.signal=signal;this.filter="all";
      this.search=root.querySelector("[data-library-search]");
      this.empty=root.querySelector("[data-filter-empty]");
      this.search?.addEventListener("input",()=>this.refresh(),{signal});
      root.querySelector("[data-search-clear]")?.addEventListener("click",()=>{
        this.search.value="";this.search.focus();this.refresh();
      },{signal});
      root.querySelectorAll("[data-library-filter]").forEach(button=>{
        button.addEventListener("click",()=>{
          this.filter=button.dataset.libraryFilter;
          root.querySelectorAll("[data-library-filter]").forEach(item=>item.setAttribute("aria-pressed",String(item===button)));
          this.refresh();
        },{signal});
      });
      root.querySelectorAll("[data-library-nav]").forEach(button=>{
        button.addEventListener("click",()=>{
          const target=button.dataset.libraryNav;
          const section=target==="recent"?root.querySelector("[data-library-recent]"):
            target==="files"?root.querySelector("[data-library-imports]"):root.querySelector("[data-library]");
          section?.scrollIntoView?.({block:"start",behavior:"smooth"});
          root.querySelectorAll("[data-library-nav]").forEach(item=>{
            if(item===button)item.setAttribute("aria-current","page");
            else item.removeAttribute("aria-current");
          });
        },{signal});
      });
    }
    refresh(){
      const entries=Array.from(this.root.querySelectorAll("[data-documents] > .library-row,[data-files] > .library-row"));
      const query=(this.search?.value||"").trim().toLocaleLowerCase("pt-BR");
      for(const row of entries){
        const format=normalizedFormat(row.dataset.fileFormat);
        const title=row.querySelector(".library-file-title")?.textContent||"";
        const show=(this.filter==="all" || format===this.filter) && (!query||title.toLocaleLowerCase("pt-BR").includes(query));
        row.hidden=!show;
        const icon=row.querySelector(".library-file-icon");
        if(icon&&!icon.dataset.enhanced){
          const mark=icon.textContent.trim();
          icon.replaceChildren(localIcon(this.root,ICON_BY_FORMAT[format]||"file-text"));
          const label=document.createElement("span");label.textContent=mark;
          icon.append(label);icon.dataset.format=format;icon.dataset.enhanced="true";
        }
        const actions=row.querySelector(".library-file-actions > summary");
        if(actions&&!actions.dataset.enhanced){
          actions.textContent="";actions.append(localIcon(this.root,"more"));actions.dataset.enhanced="true";
        }
      }
      const count=this.root.querySelector("[data-library-count]");
      if(count) count.textContent=String(entries.length);
      if(this.empty)this.empty.hidden=!(entries.length>0 && !entries.some(row=>!row.hidden));
      for(const section of [this.root.querySelector("[data-library-recent]"),this.root.querySelector("[data-library-imports]")]){
        if(!section)continue;
        const list=section.querySelector(".document-list");
        const hasEntries=list?.querySelector(".library-row");
        const visible=Array.from(list?.querySelectorAll(".library-row")||[]).some(row=>!row.hidden);
        // Keep the real empty state visible when the library has no records.
        section.hidden=Boolean(hasEntries && !visible);
      }
    }
    focusSearch(){this.search?.focus();}
  }

  class QuickCreateMenu {
    constructor(root,signal){
      this.root=root;this.menu=root.querySelector("[data-create-menu]");this.trigger=root.querySelector("[data-create-trigger]");
      this.trigger?.addEventListener("click",()=>this.setOpen(this.menu.hidden),{signal});
      this.menu?.addEventListener("click",event=>{if(event.target.closest("button"))this.setOpen(false);},{signal});
      root.addEventListener("keydown",event=>{if(event.key==="Escape"&&!this.menu?.hidden)this.setOpen(false);},{signal});
      root.addEventListener("pointerdown",event=>{
        if(this.menu?.hidden||event.target.closest("[data-create-menu],[data-create-trigger]"))return;
        this.setOpen(false);
      },{signal});
    }
    setOpen(visible){
      if(!this.menu||!this.trigger)return;
      this.menu.hidden=!visible;
      this.trigger.setAttribute("aria-expanded",String(visible));
    }
  }

  class DocumentChrome {
    constructor(root,action,signal){
      this.root=root;this.action=action;
      this.search=root.querySelector("[data-header-search]");
      this.search?.addEventListener("click",()=>{
        if(root.dataset.homeView==="true")root.querySelector("[data-library-search]")?.focus();
        else this.action("find");
      },{signal});
      this.observer=new MutationObserver(()=>this.sync());
      this.observer.observe(root,{attributes:true,attributeFilter:["data-home-view","data-page-mode","data-document-kind","data-source-kind"]});
      root.addEventListener("open-doc:layout",()=>this.sync(),{signal});
      root.addEventListener("open-doc:content",()=>this.sync(),{signal});
      signal.addEventListener("abort",()=>this.destroy(),{once:true});
      this.sync();
    }
    decorateTools(){
      const names={cursor:"cursor",pen:"pen",highlighter:"highlighter",
        "eraser-partial":"eraser",eraser:"eraser",handwriting:"handwriting"};
      this.root.querySelectorAll(".ink-toolbar [data-ink-mode]").forEach(button=>{
        if(button.dataset.designIcon)return;
        const name=names[button.dataset.inkMode];
        if(name)button.prepend(localIcon(this.root,name));
        button.dataset.designIcon="true";
      });
      const fixedNames={"Anterior":"chevron-left","Próxima":"chevron-right","Buscar":"search"};
      this.root.querySelectorAll(".fixed-controls button").forEach(button=>{
        if(button.dataset.designIcon)return;
        const name=fixedNames[button.textContent.trim()];
        if(name)button.prepend(localIcon(this.root,name));
        button.dataset.designIcon="true";
      });
    }
    sync(){
      this.decorateTools();
      const kind=this.root.dataset.documentKind,source=this.root.dataset.sourceKind;
      const fixed=kind==="fixed";
      const caption=this.root.querySelector("[data-quickbar-caption]");
      if(caption) caption.textContent=fixed?(source==="pptx"?"Apresentação PPTX":"Leitor e anotações PDF"):"Editor de documento";
      const modes=this.root.querySelector("[data-quickbar-rich]");
      if(modes)modes.hidden=fixed;
      const exportDocx=this.root.querySelector("[data-export-shortcut=docx]");
      const exportMd=this.root.querySelector("[data-export-shortcut=md]");
      const exportPdf=this.root.querySelector("[data-export-shortcut=pdf]");
      if(exportDocx)exportDocx.hidden=fixed;
      if(exportMd)exportMd.hidden=fixed;
      if(exportPdf)exportPdf.hidden=source==="pptx";
      this.root.querySelectorAll("[data-view-shortcut]").forEach(button=>{
        button.dataset.active=String(!fixed&&button.dataset.viewShortcut===(this.root.dataset.pageMode||"pages"));
        button.setAttribute("aria-pressed",button.dataset.active);
      });
    }
    destroy(){this.observer.disconnect();}
  }

  class DesignSystem {
    constructor({root,action,signal}){
      this.root=root;this.library=new LibraryView(root,signal);
      this.quickCreate=new QuickCreateMenu(root,signal);
      this.chrome=new DocumentChrome(root,action,signal);
    }
    refreshLibrary(){this.library.refresh();}
    sync(){this.chrome.sync();}
    destroy(){this.chrome.destroy();}
  }
  window.OpenDocDesign={create:options=>new DesignSystem(options),normalizedFormat};
})();