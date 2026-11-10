"use strict";
(() => {
  function create({field,language,request,run,runNext,signature,signal,project}) {
    const {basicSetup,EditorView,keymap,hoverTooltip,EditorState,Compartment,
      python,sql,SQLite,autocompletion,acceptCompletion,linter,HighlightStyle,syntaxHighlighting,tags}=window.OpenDocCodeVendor;
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
      syntaxHighlighting(HighlightStyle.define([
        {tag: [tags.keyword, tags.operatorKeyword, tags.typeName], color: "var(--color-primary)"},
        {tag: [tags.string, tags.regexp], color: "var(--color-success)"},
        {tag: [tags.number, tags.bool, tags.null], color: "var(--color-warning)"},
        {tag: [tags.comment, tags.meta], color: "var(--color-text-secondary)", fontStyle: "italic"},
        {tag: tags.invalid, color: "var(--color-danger)"},
      ])),
      EditorView.contentAttributes.of({"aria-label":field.getAttribute("aria-label") || language,spellcheck:"false"}),
      EditorState.transactionFilter.of(transaction=>
        transaction.newDoc.length>field.maxLength && transaction.docChanged ? [] : transaction),
      keymap.of([
        {key:"Ctrl-Enter",run:()=>{run();return true;}},
        ...(runNext?[{key:"Shift-Enter",run:()=>{runNext();return true;}}]:[]),
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
    const history=document.createElement("select");
    history.className="code-history";history.setAttribute("aria-label","Histórico da sessão · "+language.toUpperCase());
    const entries=new Map();
    const projectId=()=>project?.()||"";
    const renderHistory=()=>history.replaceChildren(new Option("Histórico da sessão",""),
      ...(entries.get(projectId())||[]).map((text,i)=>new Option(text.trim().split("\n")[0].slice(0,64),String(i+1))));
    host.after(history);renderHistory();
    const replace=text=>view.dispatch({changes:{from:0,to:view.state.doc.length,insert:text}});
    history.addEventListener("focus",renderHistory,{signal});
    history.addEventListener("change",()=>{
      const text=entries.get(projectId())?.[Number(history.value)-1];
      if(text!==undefined){replace(text);view.focus();}
    },{signal});
    signal.addEventListener("abort",()=>history.remove(),{once:true});
    let locked=false;
    return {
      value:()=>view.state.doc.toString(),
      focus:()=>view.focus(),
      replace,
      remember(){
        const text=view.state.doc.toString(),id=projectId();
        entries.set(id,[text,...(entries.get(id)||[]).filter(previous=>previous!==text)].slice(0,12));
        renderHistory();
      },
      columns:names=>view.dispatch({effects:dialect.reconfigure(sqlLanguage(names))}),
      lock(value){
        if(locked===value)return;
        locked=value;history.disabled=value;
        view.dispatch({effects:access.reconfigure([EditorState.readOnly.of(value),EditorView.editable.of(!value)])});
      },
    };
  }
  window.OpenDocCodeEditor={create};
})();
