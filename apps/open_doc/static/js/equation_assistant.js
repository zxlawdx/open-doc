/* Local and safe equation helper for the rich editor.
 * Formulas insert as editable Unicode text; this is NOT yet OOXML OMML.
 * The calculator interprets a narrow arithmetic grammar without eval/Function.
 */
"use strict";
(() => {
  class ArithmeticCalculator{
    static compute(expression){
      if(typeof expression!=="string"||expression.length>256)
        throw Error("A expressão deve ter até 256 caracteres.");
      const source=expression.replace(/,/g,"."),tokens=[];
      for(let index=0;index<source.length;){
        if(/\s/.test(source[index])){index++;continue;}
        const match=source.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+|[+\-*/^()])/);
        if(!match)throw Error("Use somente números, parênteses e + − × ÷ ^.");
        tokens.push(match[0]);index+=match[0].length;
        if(tokens.length>150)throw Error("A expressão é complexa demais.");
      }
      if(!tokens.length)throw Error("Digite uma expressão para calcular.");
      let at=0;
      const peek=()=>tokens[at];
      const guard=n=>{
        if(!Number.isFinite(n)||Math.abs(n)>1e15)
          throw Error("O resultado não é finito ou ultrapassa o limite permitido.");
        return n;
      };
      function atom(){
        if(peek()==="("){
          at++;const value=sum();
          if(peek()!==")")throw Error("Feche os parênteses da expressão.");
          at++;return value;
        }
        const token=tokens[at++];
        if(!token||!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(token))
          throw Error("Número ou parêntese esperado.");
        return guard(Number(token));
      }
      function power(){
        let left=atom();
        if(peek()==="^"){
          at++;left=guard(Math.pow(left,unary()));
        }
        return left;
      }
      function unary(){
        if(peek()==="+"){at++;return unary();}
        if(peek()==="-"){at++;return guard(-unary());}
        return power();
      }
      function product(){
        let left=unary();
        while(peek()==="*"||peek()==="/"){
          const op=tokens[at++],right=unary();
          if(op==="/"&&right===0)throw Error("Não é possível dividir por zero.");
          left=guard(op==="*"?left*right:left/right);
        }
        return left;
      }
      function sum(){
        let left=product();
        while(peek()==="+"||peek()==="-"){
          const op=tokens[at++],right=product();
          left=guard(op==="+"?left+right:left-right);
        }
        return left;
      }
      const value=sum();
      if(at!==tokens.length)throw Error("Há caracteres ou operadores fora de ordem.");
      return value;
    }
  }
  const SYMBOLS=[
    ["Fração","(a)/(b)"],["Potência","x²"],["Expoente","xⁿ"],
    ["Raiz","√(x)"],["Soma","∑"],["Integral","∫"],
    ["Pi","π"],["Alfa","α"],["Beta","β"],["Delta","Δ"],
    ["Aproximação","≈"],["Diferente","≠"],["Maior ou igual","≥"],
    ["Menor ou igual","≤"],["Multiplicação","×"],["Divisão","÷"]
  ];
  class EquationAssistant{
    static async open({dialog,root,editor,status}){
      if(root.dataset.documentKind==="fixed")
        throw Error("Equações estão disponíveis no editor de documentos, não no leitor PDF ou nos slides.");
      const pending=dialog("Inserir equação e calculadora",
        "Escreva uma fórmula e insira-a exatamente na posição do cursor.");
      const body=root.querySelector("[data-dialog-body]");
      root.querySelector("[data-dialog] .dialog")?.classList.add("dialog-equation");
      const note=document.createElement("p");note.className="equation-format-note";
      note.textContent="Esta versão insere matemática como texto Unicode editável. Equações OMML estruturadas do Word ainda não são suportadas.";
      const label=document.createElement("label");label.textContent="Expressão que será inserida";
      const expression=document.createElement("textarea");
      expression.className="equation-expression";expression.rows=3;expression.maxLength=1024;
      expression.setAttribute("aria-label","Expressão matemática para inserir");
      expression.placeholder="Ex.: E = mc² ou ∑ xᵢ / n";
      const preview=document.createElement("output");preview.className="equation-preview";
      preview.setAttribute("aria-live","polite");
      const refresh=()=>{preview.textContent=expression.value||"A prévia aparecerá aqui.";};
      expression.addEventListener("input",refresh);
      label.append(expression);
      const symbols=document.createElement("div");symbols.className="equation-symbols";
      symbols.setAttribute("role","group");symbols.setAttribute("aria-label","Símbolos e modelos de equação");
      for(const [name,value] of SYMBOLS){
        const button=document.createElement("button");button.type="button";
        button.textContent=value;button.title=name;
        button.setAttribute("aria-label","Inserir "+name);
        button.addEventListener("click",()=>{
          const start=expression.selectionStart,end=expression.selectionEnd;
          expression.setRangeText(value,start,end,"end");
          expression.focus();refresh();
        });
        symbols.append(button);
      }
      const calc=document.createElement("section");calc.className="equation-calculator";
      const heading=document.createElement("h3");heading.textContent="Calculadora";
      const hint=document.createElement("p");
      hint.textContent="Operações: +, −, × (*), ÷ (/), potências (^) e parênteses. Exemplo: (12+8)/4.";
      const cfield=document.createElement("label");cfield.textContent="Cálculo";
      const calcInput=document.createElement("input");calcInput.type="text";
      calcInput.maxLength=256;calcInput.placeholder="(12+8)/4";
      calcInput.setAttribute("aria-label","Expressão da calculadora");
      cfield.append(calcInput);
      const row=document.createElement("div");row.className="equation-calc-actions";
      const calculate=document.createElement("button");calculate.type="button";
      calculate.textContent="Calcular";
      const use=document.createElement("button");use.type="button";
      use.textContent="Usar resultado";use.disabled=true;
      const result=document.createElement("output");result.className="equation-calc-result";
      result.setAttribute("aria-live","polite");
      let last=null;
      calculate.addEventListener("click",()=>{
        try{
          last=ArithmeticCalculator.compute(calcInput.value);
          result.textContent="Resultado: "+String(Number(last.toPrecision(12)));
          use.disabled=false;
        }catch(error){last=null;use.disabled=true;result.textContent=error.message;}
      });
      use.addEventListener("click",()=>{
        if(last===null)return;
        const text=String(Number(last.toPrecision(12)));
        expression.setRangeText(text,expression.selectionStart,expression.selectionEnd,"end");
        expression.focus();refresh();
      });
      row.append(calculate,use);calc.append(heading,hint,cfield,row,result);
      body.append(note,label,symbols,preview,calc);
      expression.focus();refresh();
      const accepted=await pending;
      if(!accepted)return false;
      const value=expression.value.trim();
      if(!value)throw Error("Digite uma expressão antes de inserir.");
      if(value.length>1024)throw Error("A expressão pode ter até 1024 caracteres.");
      if(!editor.insertPlainText?.(value))
        throw Error("Não foi possível inserir a expressão na posição do cursor.");
      status("Expressão inserida como texto matemático editável.");
      return true;
    }
  }
  window.OpenDocEquationAssistant={EquationAssistant,ArithmeticCalculator,SYMBOLS};
})();
