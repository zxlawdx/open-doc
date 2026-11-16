/* Canonical SVG shell presentation; never owns editor state or Vela routes. */
"use strict";
(() => {
  const ICONS = {documents:"i-doc",presentations:"i-slides",pdf:"i-pdf",
    spreadsheets:"i-sheet",data:"i-data",code:"i-code"};
  const SVG_NS = "http://www.w3.org/2000/svg";
  function create({root,settings,persist,status,signal}) {
    const toggle = root.querySelector("[data-od-density-toggle]");
    const source = root.querySelector(".od-app-rail .od-rail-home use")?.getAttribute("href")?.split("#")[0];
    let persisted = settings.density === "compact" ? "compact" : "comfortable";
    let change = 0;
    function density(value) {
      root.dataset.odDensity = value;
      toggle?.setAttribute("aria-pressed",String(value === "compact"));
      toggle?.setAttribute("aria-label",value === "compact" ?
        "Ativar modo confortável" : "Ativar modo compacto");
      toggle?.setAttribute("title",value === "compact" ?
        "Densidade: compacta" : "Densidade: confortável");
    }
    density(persisted);
    toggle?.addEventListener("click", async () => {
      const current = root.dataset.odDensity;
      const next = current === "compact" ? "comfortable" : "compact";
      const id = ++change;
      density(next);
      toggle.disabled = true;
      try { await persist({density:next}); persisted = next; }
      catch (error) {
        if(id===change)density(persisted);
        status("Não foi possível salvar a densidade: " + error.message);
      } finally { if(id===change)toggle.disabled=false; }
    },{signal});
    const home = root.querySelector(".od-rail-home");
    const links = [...root.querySelectorAll(".od-app-rail [data-suite-app]")];
    function syncRail(){
      const library=root.dataset.homeView === "true" &&
        root.dataset.datasetView !== "true" && root.dataset.workbookView !== "true";
      const app=root.dataset.datasetView==="true"
        ? (root.dataset.entryApp==="code" ? "code" : "data")
        : root.dataset.workbookView==="true" ? "spreadsheets" : root.dataset.entryApp;
      home?.setAttribute("aria-current",library?"page":"false");
      for(const link of [...links,...root.querySelectorAll(".suite-launcher [data-suite-app]")]) {
        const selected=!library && link.dataset.suiteApp===app;
        link.setAttribute("aria-current",selected?"page":"false");
      }
    }
    // Decorate only the existing session tab DOM; the workspace controller
    // continues to own activate, close, save, restore and errors.
    function decorateTabs(bar) {
      for(const entry of bar.children) {
        const button = entry.querySelector?.("button:first-child");
        if(!button || button.hasAttribute("data-workspace-retry"))continue;
        const name = button.querySelector(".workspace-tab-name, .od-tab-label");
        const oldText = !name ? button.textContent : "";
        if(!name && oldText) {
          const label=document.createElement("span");
          label.className="od-tab-label";
          label.textContent=oldText;
          button.replaceChildren(label);
          button.title=oldText;
        }
        const type = button.dataset.fileType ||
          (/\.pdf$/i.test(button.title)?"pdf":/\.pptx?$/i.test(button.title)?"presentations":
          /\.xlsx?$/i.test(button.title)?"spreadsheets":/\.csv$/i.test(button.title)?"data":"documents");
        button.dataset.fileType = type;
        entry.classList.toggle("od-tab-active",button.getAttribute("aria-current")==="true");
        let icon=button.querySelector("svg");
        if(!icon) { icon=document.createElementNS(SVG_NS,"svg"); button.prepend(icon); }
        icon.classList.add("od-icon","od-tab-icon");
        icon.setAttribute("aria-hidden","true");
        let use=icon.querySelector("use");
        if(!use) { use=document.createElementNS(SVG_NS,"use"); icon.replaceChildren(use); }
        const href=source+"#"+(ICONS[type]||"i-doc");
        if(source && use.getAttribute("href")!==href)use.setAttribute("href",href);
        if(source)use.setAttributeNS("http://www.w3.org/1999/xlink","xlink:href",href);
      }
    }
    let observedBar=null, barObserver=null;
    function attachTabs(){
      const bar=root.querySelector(".workspace-global-tabs");
      if(!bar || observedBar===bar)return;
      barObserver?.disconnect();
      observedBar=bar;
      decorateTabs(bar);
      barObserver=new MutationObserver(()=>decorateTabs(bar));
      barObserver.observe(bar,{childList:true});
    }
    const rootObserver=new MutationObserver(()=>{attachTabs();syncRail();});
    rootObserver.observe(root,{childList:true,attributes:true,attributeFilter:["data-home-view","data-entry-app"]});
    root.addEventListener("open-doc:workspace",syncRail,{signal});
    root.addEventListener("open-doc:layout",syncRail,{signal});
    signal.addEventListener("abort",()=>{
      rootObserver.disconnect();
      barObserver?.disconnect();
    },{once:true});
    // The deployed QtWebEngine uses an older Chromium SVG implementation.
    // Mirror href into xlink:href for locally bundled external sprite symbols.
    for(const use of root.querySelectorAll(".od-app-rail svg use, .suite-launcher svg use")){
      const href=use.getAttribute("href");
      if(href)use.setAttributeNS("http://www.w3.org/1999/xlink","xlink:href",href);
    }
    attachTabs(); syncRail();
    return {sync:()=>{attachTabs();syncRail();}};
  }
  window.OpenDocShell={create};
})();
