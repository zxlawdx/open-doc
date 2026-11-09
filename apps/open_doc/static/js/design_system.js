/* Ofício design presentation controllers. No application data or Vela runtime duplicated. */
"use strict";
(() => {
  const ICON_BY_FORMAT={xlsx:"file-text",docx:"file-text",pdf:"pdf",pptx:"slides",md:"file-text",txt:"file-text",odt:"file-text",odp:"slides"};
  const GROUP={csv:"xlsx",tsv:"xlsx",odt:"docx",odp:"pptx",txt:"md"};
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

  const ROUTE_TITLES = {docx:"Documentos", pptx:"Apresentações", pdf:"PDFs", templates:"Templates",xlsx:"Planilhas"};
  const fileSections = {recent:"[data-library-recent]", imports:"[data-library-imports]"};

  class LibraryView {
    constructor(root,signal) {
      this.root=root;this.signal=signal;this.filter="all";this.route="home";this.section="all";
      this.search=root.querySelector("[data-library-search]");
      this.empty=root.querySelector("[data-filter-empty]");
      this.category=root.querySelector("[data-template-category]");
      this.category.addEventListener("change",()=>this.refresh(),{signal});
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
      root.querySelectorAll("[data-library-route],[data-library-section],[data-library-nav]").forEach(button=>{
        button.addEventListener("click",()=>{
          const {libraryRoute, librarySection, libraryNav} = button.dataset;
          if (libraryRoute) this.navigate(libraryRoute);
          else if (librarySection) this.navigate(this.route, librarySection);
          else this.navigate("home", {recent:"recent",files:"imports"}[libraryNav]);
        },{signal});
      });
    }
    navigate(route, section = route === "home" ? "all" : "templates"){
      this.route=route;
      this.section=section;
      this.filter="all";
      this.category.value="";
      const scoped=route in ICON_BY_FORMAT;
      const root=this.root;
      root.querySelector("[data-library]").dataset.route=route;
      const heading=root.querySelector("[data-library-heading]");
      heading.textContent=ROUTE_TITLES[route] || "Seus documentos, seu espaço.";
      const primary=root.querySelector("[data-library-primary]");
      primary.hidden=route==="templates";
      primary.dataset.action={pdf:"import",pptx:"presentation-new",xlsx:"workbook-new"}[route] || "new";
      primary.lastChild.textContent={pdf:" Abrir ou importar PDF",pptx:" Nova apresentação",xlsx:" Nova planilha"}[route] || " Novo documento";
      root.querySelector("[data-module-import]").dataset.action=route==="xlsx"?"workbook-import":"import";
      root.querySelector("[data-module-nav]").hidden=!scoped;
      root.querySelector(".home-filters").hidden=scoped;
      const overview=route==="home" && section==="all";
      root.querySelector("[data-library-quick]").hidden=!overview;
      root.querySelector("[data-library-privacy]").hidden=!overview;
      for(const button of root.querySelectorAll("[data-library-route],[data-library-section],[data-library-nav],.home-side-nav [data-action]")){
        const {libraryRoute,librarySection,libraryNav,action}=button.dataset;
        const homeSection=libraryNav || {"library-recent":"recent","library-files":"files",home:"home"}[action];
        const current=libraryRoute===route || librarySection===section ||
          (route==="home" && homeSection==={recent:"recent",imports:"files",all:"home"}[section]);
        if(current) button.setAttribute("aria-current","page");
        else button.removeAttribute("aria-current");
      }
      for(const button of root.querySelectorAll("[data-library-filter]")){
        button.setAttribute("aria-pressed",String(button.dataset.libraryFilter==="all"));
        button.hidden=route==="templates" && button.dataset.libraryFilter==="md";
      }
      root.querySelector("[data-library]").scrollTop=0;
      this.refresh();
    }
    refresh(){
      const filter=this.route in ICON_BY_FORMAT ? this.route : this.filter;
      const query=(this.search?.value||"").trim().toLocaleLowerCase("pt-BR");
      const matches=(format,text)=>(filter==="all" || format===filter) &&
        (!query || text.toLocaleLowerCase("pt-BR").includes(query));
      const entries=Array.from(this.root.querySelectorAll("[data-documents] > .library-row,[data-files] > .library-row"));
      for(const row of entries){
        const format=normalizedFormat(row.dataset.fileFormat);
        const title=row.querySelector(".library-file-title")?.textContent||"";
        row.hidden=!matches(format,title+" "+row.dataset.fileFormat+" "+format);
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
      const cards=Array.from(this.root.querySelectorAll("[data-template-id]"));
      for(const card of cards){
        card.hidden=!matches(card.dataset.fileFormat,card.dataset.search) ||
          (this.category.value!=="" && this.category.value!==card.dataset.category);
      }
      const gallery=this.root.querySelector("[data-template-section]");
      gallery.hidden=this.section!=="templates";
      this.search.placeholder=gallery.hidden ? "Buscar arquivos por nome ou formato…" : "Buscar templates por nome, formato ou categoria…";
      const count=this.root.querySelector("[data-library-count]");
      if(count) count.textContent=String(gallery.hidden ? entries.length : cards.length);
      let visible=gallery.hidden ? 0 : cards.filter(card=>!card.hidden).length;
      let total=gallery.hidden ? 0 : cards.length;
      for(const [name,selector] of Object.entries(fileSections)){
        const section=this.root.querySelector(selector);
        if(!section)continue;
        const active=this.section==="all" || this.section===name;
        const rows=Array.from(section.querySelectorAll(".library-row"));
        const found=rows.filter(row=>!row.hidden).length;
        section.hidden=!active || (rows.length>0 && found===0);
        if(active){visible+=found;total+=rows.length;}
      }
      if(this.empty){
        this.empty.textContent=gallery.hidden ? "Nenhum arquivo corresponde à pesquisa." : "Nenhum template corresponde à pesquisa.";
        this.empty.hidden=!(total>0 && visible===0);
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
      const fixedNames={"Anterior":"chevron-left","Próxima":"chevron-right","Buscar":"search","Nota adesiva":"comment"};
      this.root.querySelectorAll(".fixed-controls button").forEach(button=>{
        if(button.dataset.designIcon)return;
        const name=fixedNames[button.textContent.trim()];
        if(name)button.prepend(localIcon(this.root,name));
        button.dataset.designIcon="true";
      });
      const semanticIcons={"Destacar":"highlighter","Sublinhar":"underline",
        "Tachar":"strike","Comentar":"comment","Copiar":"copy"};
      this.root.querySelectorAll(".semantic-selection-menu button").forEach(button=>{
        if(button.dataset.designIcon)return;
        const name=semanticIcons[button.textContent.trim()];
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
      const exportPptx=this.root.querySelector("[data-export-shortcut=pptx]");
      if(exportDocx)exportDocx.hidden=fixed;
      if(exportMd)exportMd.hidden=fixed;
      if(exportPdf)exportPdf.hidden=source==="pptx";
      if(exportPptx)exportPptx.hidden=source!=="pptx";
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
    navigateLibrary(route,section){this.library.navigate(route,section);}
    refreshLibrary(){this.library.refresh();}
    sync(){this.chrome.sync();}
    destroy(){this.chrome.destroy();}
  }
  window.OpenDocDesign={create:options=>new DesignSystem(options),normalizedFormat};
})();