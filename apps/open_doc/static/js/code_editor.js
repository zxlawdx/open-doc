"use strict";
(() => {
  function create({field,language,request,run,signature,signal,project}) {
    const {basicSetup,EditorView,keymap,hoverTooltip,EditorState,Compartment,
      python,sql,SQLite,autocompletion,acceptCompletion,linter}=window.OpenDocCodeVendor;
    const dialect=new Compartment(), access=new Compartment();
    const host=document.createElement("div");
    host.className="dataset-code-editor";
    field.after(host);
    function analyze(operation, state, pos) {
      const line=state.doc.lineAt(pos);
      return request("dataset/python-analysis",{operation,code:state.doc.toString(),
        line:line.number,column:Array.from(line.text.slice(0,pos-line.from)).length,
        project:typeof project==="function"?project():null});
    }
    const sqlLanguage=columns=>sql({dialect:SQLite,schema:{dados:columns},defaultTable:"dados"});
    const extensions=[
      basicSetup,
      EditorView.contentAttributes.of({"aria-label":field.getAttribute("aria-label") || language,spellcheck:"false"}),
      EditorState.transactionFilter.of(transaction=>
        transaction.newDoc.length>field.maxLength && transaction.docChanged ? [] : transaction),
      keymap.of([
        {key:"Ctrl-Enter",run:()=>{run();return true;}},
        {key:"Tab",run:acceptCompletion},
      ]),
      access.of([]),
    ];
    let pendingSignature;
    if(language==="python"){
      extensions.push(python(),autocompletion({override:[async context=>{
        const prefix=context.matchBefore(/[\p{L}\p{N}_]+/u);
        const previous=context.state.sliceDoc(Math.max(0,context.pos-1),context.pos);
        if(!context.explicit&&!prefix&&previous!==".")return null;
        try{
          const result=await analyze("complete",context.state,context.pos);
          if(context.aborted||!result.items.length)return null;
          return {from:prefix?.from ?? context.pos, options:result.items};
        } catch{return null;}
      }]}),linter(async view=>{
        try{
          const state=view.state;
          const result=await analyze("diagnostics",state,0);
          return result.items.map(item=>{
            const line=state.doc.line(Math.max(1,Math.min(state.doc.lines,item.line)));
            const offset=Array.from(line.text).slice(0,item.column).join("").length;
            const from=Math.min(line.to,line.from+offset);
            return {from,to:Math.min(line.to,from+1),severity:"error",message:item.message};
          });
        }catch{return [];}
      },{delay:550}),hoverTooltip(async (view,pos)=>{
        const state=view.state;
        if(!state.wordAt(pos))return null;
        try{
          const result=await analyze("inspect",state,pos);
          const content=[result.signature,result.documentation].filter(Boolean).join("\n\n");
          if(!content||view.state.doc!==state.doc)return null;
          return {pos,above:true,create(){
            const dom=document.createElement("pre");
            dom.className="dataset-code-documentation";
            dom.textContent=content;
            return {dom};
          }};
        }catch{return null;}
      }),EditorView.updateListener.of(update=>{
        if(!update.docChanged&&!update.selectionSet)return;
        clearTimeout(pendingSignature);
        signature.textContent="";
        const {state}=update;
        const pos=state.selection.main.head;
        const line=state.doc.lineAt(pos);
        if(!/[,(]\s*$/.test(state.sliceDoc(line.from,pos)))return;
        pendingSignature=setTimeout(async()=>{
          try{
            const result=await analyze("inspect",state,pos);
            if(!signal.aborted&&view.state.doc===state.doc&&view.state.selection.main.head===pos)
              signature.textContent=result.signature;
          }catch{}
        },350);
      }));
    } else extensions.push(dialect.of(sqlLanguage([])));
    const view=new EditorView({doc:field.value,parent:host,extensions});
    field.hidden=true;
    signal.addEventListener("abort",()=>{clearTimeout(pendingSignature);view.destroy();host.remove();},{once:true});
    let locked=false;
    return {
      value:()=>view.state.doc.toString(),
      columns:names=>view.dispatch({effects:dialect.reconfigure(sqlLanguage(names))}),
      lock(value){
        if(locked===value)return;
        locked=value;
        view.dispatch({effects:access.reconfigure([EditorState.readOnly.of(value),EditorView.editable.of(!value)])});
      },
    };
  }
  window.OpenDocCodeEditor={create};
})();
