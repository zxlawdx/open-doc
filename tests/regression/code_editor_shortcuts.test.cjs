const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const {JSDOM}=require("jsdom");
const source=fs.readFileSync(require("./asset_path.cjs")("code_editor.js"),"utf8");

function setup() {
  const dom=new JSDOM('<main><textarea aria-label="SQL" maxlength="12000">SELECT * FROM dados LIMIT 20;</textarea></main>',{runScripts:"outside-only"});
  const w=dom.window,controller=new w.AbortController(),handlers={},bindings=[];
  let view;
  class Compartment {of(value){return value;} reconfigure(value){return value;}}
  const EditorState={transactionFilter:{of:value=>value}};
  class EditorView {
    static theme(value){return value;}
    static contentAttributes={of:value=>value};
    static updateListener={of:value=>value};
    static domEventHandlers=function(value){Object.assign(handlers,value);return value;};
    constructor({doc}) {
      this.doc=doc;
      this.state={doc:{length:doc.length,toString:()=>doc},sliceDoc:(from,to)=>doc.slice(from,to),selection:{main:{from:0,to:0,empty:true}}};
      view=this;
    }
    dispatch({selection}={}) {
      if(selection){
        const from=Math.min(selection.anchor,selection.head),to=Math.max(selection.anchor,selection.head);
        this.state.selection.main={from,to,empty:from===to};
      }
    }
    focus(){this.focused=true;}
    destroy(){}
  }
  w.OpenDocCodeVendor={
    basicSetup:[],EditorView,EditorState,Compartment,
    keymap:{of:entries=>{bindings.push(...entries);return entries;}},
    hoverTooltip:()=>{},python:()=>{},sql:()=>{},SQLite:{},
    autocompletion:()=>{},acceptCompletion:()=>false,startCompletion:()=>{},
    linter:()=>{},HighlightStyle:{define:()=>({})},syntaxHighlighting:()=>{},
    tags:{keyword:1,operatorKeyword:2,typeName:3,string:4,regexp:5,number:6,bool:7,null:8,comment:9,meta:10,invalid:11}
  };
  w.eval(source);
  const field=w.document.querySelector("textarea");
  const api=w.OpenDocCodeEditor.create({field,language:"sql",signal:controller.signal,
    request:async()=>({}),project:()=> "project",run:()=>{}});
  return {dom,w,controller,handlers,bindings,view,api,field};
}
test("Mod+A selects the entire SQL document in one keystroke",t=>{
  const o=setup();t.after(()=>{o.controller.abort();o.w.close();});
  const all=o.bindings.find(binding=>binding.key==="Mod-a");
  assert.ok(all,"CodeMirror must register a platform-independent select-all shortcut");
  assert.equal(all.run(o.view),true);
  assert.deepEqual({...o.view.state.selection.main},{from:0,to:o.view.doc.length,empty:false});
  assert.equal(o.view.focused,true);
});
test("one copy event sends entire selection to Qt native clipboardData",t=>{
  const o=setup();t.after(()=>{o.controller.abort();o.w.close();});
  o.bindings.find(binding=>binding.key==="Mod-a").run(o.view);
  const data=new Map();let prevented=false;
  assert.equal(o.handlers.copy({clipboardData:{setData:(type,value)=>data.set(type,value)},preventDefault(){prevented=true;}},o.view),true);
  assert.equal(data.get("text/plain"),"SELECT * FROM dados LIMIT 20;");
  assert.equal(prevented,true);
});
test("copy without selection leaves clipboard unchanged",t=>{
  const o=setup();t.after(()=>{o.controller.abort();o.w.close();});
  let touched=false;
  assert.equal(o.handlers.copy({clipboardData:{setData(){touched=true;}},preventDefault(){touched=true;}},o.view),false);
  assert.equal(touched,false);
});
