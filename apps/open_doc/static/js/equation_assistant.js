/* Local and safe native equation helper for the rich editor.
 * Formulas are structured OMML objects, not Unicode text placeholders.
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
      note.textContent="Equações são objetos matemáticos nativos e editáveis (OMML) no DOCX. Escolha uma estrutura ou escreva uma expressão simples.";
      const label=document.createElement("label");label.textContent="Expressão que será inserida";
      const expression=document.createElement("textarea");
      expression.className="equation-expression";expression.rows=3;expression.maxLength=160;
      expression.setAttribute("aria-label","Expressão matemática para inserir");
      expression.placeholder="Ex.: E = mc² ou ∑ xᵢ / n";
      const preview=document.createElement("output");preview.className="equation-preview";
      preview.setAttribute("aria-live","polite");
      const refresh=()=>{if(template.value==="text")preview.textContent=expression.value||"A prévia aparecerá aqui.";};
      expression.addEventListener("input",refresh);
      label.append(expression);
      const selected=editor.selectedMath?.()||null;
      const models=window.OpenDocMathGallery;
      const template=document.createElement("select");
      template.className="equation-native-template";
      template.setAttribute("aria-label","Tipo de equação nativa");
      for(const [value,label] of [
        ["text","Expressão matemática livre"],
        ...(selected?[["selected","Editar objeto selecionado"]]:[]),
        ...((models?.DEFINITIONS||[]).map(item=>[item.id,item.label]))
      ]){
        const opt=document.createElement("option");opt.value=value;opt.textContent=label;template.append(opt);
      }
      template.value=selected?"selected":"text";
      const templateLabel=document.createElement("label");
      templateLabel.textContent="Estrutura matemática";templateLabel.append(template);
      const partsPanel=document.createElement("div");
      partsPanel.className="equation-native-components";
      let activeBlocks=selected?JSON.parse(JSON.stringify(selected.math_blocks)):[];
      const fields={
        text:[["value","Expressão"]],
        fraction:[["numerator","Numerador"],["denominator","Denominador"]],
        nary:[["lower","Limite inferior"],["upper","Limite superior"],["body","Integrando / termo"]],
        superscript:[["base","Base"],["power","Expoente"]],
        sqrt:[["radicand","Radicando"]]
      };
      const drawParts=()=>{
        partsPanel.replaceChildren();
        preview.replaceChildren();
        if(template.value==="text"){
          preview.textContent=expression.value||"A prévia aparecerá aqui.";
          expression.parentElement.hidden=false;
          return;
        }
        expression.parentElement.hidden=true;
        (activeBlocks||[]).forEach((block,index)=>{
          const section=document.createElement("section");
          const heading=document.createElement("strong");heading.textContent="Componente "+(index+1)+" · "+block.kind;
          section.append(heading);
          for(const [key,label] of fields[block.kind]||[]){
            const wrap=document.createElement("label");wrap.textContent=label;
            const inp=document.createElement("input");inp.value=block[key];inp.maxLength=160;
            inp.addEventListener("input",()=>{activeBlocks[index][key]=inp.value;
              if(models?.renderBlocks)preview.replaceChildren(models.renderBlocks(activeBlocks));});
            wrap.append(inp);section.append(wrap);
          }
          partsPanel.append(section);
        });
        if(models?.renderBlocks)preview.append(models.renderBlocks(activeBlocks));
      };
      template.addEventListener("change",()=>{
        activeBlocks=template.value==="selected"?JSON.parse(JSON.stringify(selected.math_blocks)):
          JSON.parse(JSON.stringify(models?.BLOCKS?.[template.value]||[]));
        drawParts();
      });
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
      body.append(note,templateLabel,label,symbols,partsPanel,preview,calc);
      drawParts();
      expression.focus();refresh();
      const accepted=await pending;
      if(!accepted)return false;
      const blocks=template.value==="text"
        ?[{kind:"text",value:expression.value.trim()}]
        :activeBlocks;
      if(!blocks?.length || blocks.some(b=>
        Object.keys(b).filter(k=>k!=="kind"&&k!=="operator"&&
          !["lower","upper"].includes(k)).some(k=>!b[k]?.trim())))
        throw Error("Preencha os componentes obrigatórios da equação.");
      if(blocks.some(b=>Object.values(b).some(v=>typeof v==="string"&&v.length>160)))
        throw Error("Cada campo pode ter até 160 caracteres.");
      if(!editor.insertMath?.(blocks))
        throw Error("Não foi possível inserir o objeto matemático na posição do cursor.");
      status("Equação nativa e editável inserida no documento.");
      return true;
    }
  }
  window.OpenDocEquationAssistant={EquationAssistant,ArithmeticCalculator,SYMBOLS};
})();
