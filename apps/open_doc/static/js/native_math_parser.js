/* Offline, strictly bounded LaTeX subset -> structured native OMML nodes.
 * Unsupported constructs fail explicitly. No eval, DOM interpolation or network.
 */
"use strict";
(() => {
  const SYMBOLS={pi:"π",alpha:"α",beta:"β",gamma:"γ",theta:"θ",
    infty:"∞",partial:"∂",nabla:"∇",cdot:"·",times:"×",leq:"≤",geq:"≥",
    neq:"≠",sin:"sen",cos:"cos",tan:"tan",ln:"ln",log:"log",exp:"exp",
    pm:"±",rightarrow:"→",in:"∈",mathbb:"ℝ"};
  const OPERATORS={int:"∫",iint:"∬",oint:"∮",sum:"∑"};
  const asValue=nodes=>nodes.length===1&&nodes[0].kind==="text"?nodes[0].value:nodes;
  class Reader {
    constructor(source){
      if(typeof source!=="string"||!source.trim()||source.length>2048)
        throw Error("LaTeX deve ter entre 1 e 2048 caracteres.");
      this.source=source;this.at=0;this.depth=0;this.count=0;
    }
    peek(str){return this.source.slice(this.at,this.at+str.length)===str;}
    skip(){while(/^[ \t\r\n]$/.test(this.source[this.at]||""))this.at++;}
    require(char){if(this.source[this.at]!==char)throw Error("Esperado '"+char+"' na fórmula.");this.at++;}
    arg(){
      if(++this.depth>6)throw Error("LaTeX aninhado demais.");
      try{
        this.skip();
        if(this.peek("{")){
          this.at++;const nodes=this.sequence("}");this.require("}");
          if(!nodes.length)throw Error("Argumento matemático vazio.");
          return asValue(nodes);
        }
        if(this.at>=this.source.length)throw Error("Argumento matemático ausente.");
        if(this.peek("\\")){
          const part=this.command();
          return part.kind==="text"?part.value:[part];
        }
        return this.source[this.at++];
      }finally{this.depth--;}
    }
    command(){
      this.require("\\");
      if(this.peek("{")||this.peek("}")||this.peek("_")||this.peek("^")){
        return {kind:"text",value:this.source[this.at++]};
      }
      if(this.peek(",")||this.peek(";")||this.peek("!")||this.peek(" ")){
        this.at++;return {kind:"text",value:" "};
      }
      const match=/^[a-zA-Z]+/.exec(this.source.slice(this.at));
      if(!match)throw Error("Comando LaTeX inválido.");
      const name=match[0];this.at+=name.length;
      if(name==="left"||name==="right")return {kind:"text",value:""};
      if(name==="frac")return {kind:"fraction",numerator:this.arg(),denominator:this.arg()};
      if(name==="sqrt"){
        this.skip();
        let index=null;
        if(this.peek("[")){
          this.at++;const start=this.at;
          while(this.at<this.source.length&&!this.peek("]"))this.at++;
          if(!this.peek("]")||this.at===start)throw Error("Índice da raiz inválido.");
          index=this.source.slice(start,this.at);this.at++;
        }
        const radicand=this.arg();
        return index?{kind:"root",index,radicand}:{kind:"sqrt",radicand};
      }
      if(name in OPERATORS){
        let lower="",upper="";
        for(let n=0;n<2;n++){
          this.skip();const op=this.source[this.at];
          if(op!=="_"&&op!=="^")break;
          this.at++;if(op==="_")lower=this.arg();else upper=this.arg();
        }
        this.skip();
        let body="";
        if(this.at<this.source.length&&this.source[this.at]!=="}"){
          const nodes=this.sequence("}");
          body=asValue(nodes);
        }
        if(!body || Array.isArray(body)&&!body.length)body=" ";
        return {kind:"nary",operator:OPERATORS[name],lower,upper,body};
      }
      if(name==="lim"){
        this.skip();let lower="";
        if(this.peek("_")){this.at++;lower=this.arg();}
        return {kind:"limit",base:"lim",lower:lower||" "};
      }
      if(name==="begin"){
        const env=this.arg();
        if(env!=="matrix"&&env!=="pmatrix"&&env!=="bmatrix")
          throw Error("Ambiente LaTeX ainda não suportado.");
        const rows=[];let row=[];
        while(this.at<this.source.length&&!this.peek("\\end{")){
          let segment=this.sequence("&",true);
          if(!segment.length)throw Error("Célula vazia na matriz.");
          row.push(asValue(segment));
          if(row.length>6)throw Error("Matriz muito larga.");
          if(this.peek("&")){this.at++;continue;}
          if(this.peek("\\\\")){this.at+=2;rows.push(row);row=[];if(rows.length>6)throw Error("Matriz muito alta.");continue;}
          if(!this.peek("\\end{"))throw Error("Separador de matriz inválido.");
        }
        if(row.length)rows.push(row);
        if(!rows.length||rows.some(r=>r.length!==rows[0].length))
          throw Error("Matriz irregular.");
        this.at+=5;const end=this.arg();
        if(end!==env)throw Error("Ambiente LaTeX não encerrado.");
        return {kind:"matrix",rows};
      }
      if(name in SYMBOLS)return {kind:"text",value:SYMBOLS[name]};
      throw Error("Comando LaTeX não suportado: \\"+name);
    }
    sequence(stop="",matrix=false){
      if(this.depth>6)throw Error("LaTeX aninhado demais.");
      const parts=[];let plain="";
      const flush=()=>{if(plain){parts.push({kind:"text",value:plain});plain="";}};
      while(this.at<this.source.length){
        if(stop&&this.peek(stop))break;
        if(matrix&&(this.peek("\\\\")||this.peek("\\end{")))break;
        if(this.peek("}")&&!stop)throw Error("Chave LaTeX fechada sem abertura.");
        if(this.peek("{")){
          flush();this.at++;this.depth++;
          const interior=this.sequence("}");this.depth--;this.require("}");
          parts.push(...interior);continue;
        }
        if(this.peek("\\")){
          flush();const cmd=this.command();
          if(cmd.kind==="text")plain+=cmd.value;
          else parts.push(cmd);
        }else if(this.peek("^")||this.peek("_")){
          flush();const isSup=this.source[this.at++]==="^";
          if(!parts.length)throw Error("Expoente ou índice sem base.");
          let base=parts.pop();
          if(base.kind==="text"&&base.value.length>1){
            const letter=base.value.slice(-1);
            parts.push({kind:"text",value:base.value.slice(0,-1)});
            base={kind:"text",value:letter};
          }
          const parameter=this.arg();
          const field=isSup?"power":"sub";
          parts.push({kind:isSup?"superscript":"subscript",
            base:base.kind==="text"?base.value:[base],[field]:parameter});
        }else plain+=this.source[this.at++];
        if(this.at>2048||parts.length>32||++this.count>512)
          throw Error("Fórmula excede os limites de complexidade.");
      }
      flush();return parts.filter(part=>part.kind!=="text"||part.value!=="");
    }
    parse(){
      const blocks=this.sequence();
      this.skip();
      if(this.at!==this.source.length||!blocks.length)throw Error("LaTeX incompleto.");
      return blocks;
    }
  }
  window.OpenDocMathParser={parseLatex:input=>new Reader(input).parse()};
})();
