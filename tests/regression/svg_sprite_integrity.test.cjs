const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const {JSDOM}=require("jsdom");
const read=path=>fs.readFileSync(path,"utf8");

test("spreadsheet and data templates reference only existing offline SVG symbols",()=>{
  const normal=new Set([...read("apps/home/static/icons.svg").matchAll(/<symbol\s+id="([^"]+)"/g)].map(x=>x[1]));
  const approved=new Set([...read("apps/home/static/approved-icons.svg").matchAll(/<symbol\s+id="([^"]+)"/g)].map(x=>x[1]));
  for(const file of ["apps/spreadsheets/templates/workbook.html","apps/data/templates/data.html",
    "apps/home/templates/base.html","apps/home/templates/home.html","apps/home/templates/toolbar.html"]){
    const html=read(file);
    const refs=[...html.matchAll(/<use[^>]*href="[^"]*?(icons|approved-icons)\.svg[^"]*?#([^"]+)"/g)];
    assert.ok(refs.length>0,file+" must contain sprite references");
    for(const [,sprite,id] of refs)assert.ok((sprite==="icons"?normal:approved).has(id),file+" references missing "+id);
  }
});

test("generated grid SVG uses correct sprite even when approved icons precede it",t=>{
  const dom=new JSDOM('<section><svg><use href="/static/home/approved-icons.svg#i-code"></use></svg><svg><use href="/static/home/icons.svg#edit"></use></svg></section>',
    {runScripts:"outside-only"}),w=dom.window;
  t.after(()=>w.close());
  w.eval(read("apps/home/static/js/grid_workspace.js"));
  const node=w.OpenDocGridWorkspace.icon(w.document.querySelector("section"),"edit");
  assert.equal(node.getAttribute("viewBox"),"0 0 24 24");
  assert.equal(node.querySelector("use").getAttribute("href"),"/static/home/icons.svg#edit");
});

test("local SVG sprite includes visible geometry for every registered symbol",()=>{
  for(const name of ["icons.svg","approved-icons.svg"]){
    const xml=read("apps/home/static/"+name);
    const document=new JSDOM(xml,{contentType:"image/svg+xml"}).window.document;
    for(const symbol of document.querySelectorAll("symbol")){
      assert.ok(symbol.getAttribute("viewBox"),name+":"+symbol.id+" has no viewBox");
      assert.ok(symbol.querySelector("path,rect,circle,line,polyline,polygon,ellipse,g,text"),
        name+":"+symbol.id+" has no visible SVG geometry");
    }
  }
});
