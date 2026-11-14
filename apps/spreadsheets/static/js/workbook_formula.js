"use strict";
(() => {
  const FUNCTIONS = {SUM:"SUM", SOMA:"SUM", AVERAGE:"AVERAGE", "MÉDIA":"AVERAGE",
    MIN:"MIN", "MÍNIMO":"MIN", MAX:"MAX", "MÁXIMO":"MAX", IF:"IF", SE:"IF", COUNT:"COUNT", COUNTA:"COUNTA", IFERROR:"IFERROR", SEERRO:"IFERROR"};
  const token = /^(?:"(?:[^"]|"")*"|\d+(?:\.\d+)?|(?:'[\w À-ÿ]+'|[\wÀ-ÿ]+)!|\$?[A-Za-z]{1,3}\$?[1-9]\d*\b|[A-Za-zÀ-ÿ]+|<=|>=|<>|[=<>%+*/():;,&-])/;
  const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
  function column(index) {
    let label = "";
    for (let value=index+1; value>0; value=Math.floor((value-1)/26)) {
      label=String.fromCharCode(65+(value-1)%26)+label;
    }
    return label;
  }
  function address(text) {
    const parts=/^\$?([A-Z]{1,3})\$?([1-9]\d*)$/i.exec(text);
    if (!parts) return null;
    let col=0;
    for (const letter of parts[1].toUpperCase()) col=col*26+letter.charCodeAt(0)-64;
    const row=Number(parts[2]);
    return row<=10000 && col<=100 ? [row-1,col-1] : null;
  }
  function evaluate(sheets) {
    const cache=new Map(), active=new Set();
    const names=new Map(sheets.map((sheet,index)=>[sheet.name.toUpperCase(),index]));
    let remaining=100000;
    function fail(code="#FÓRMULA!") {throw Error(code);}
    function numeric(value) {
      if (typeof value==="number" && Number.isFinite(value)) return value;
      if (value==="") return 0;
      fail("#VALOR!");
    }
    function get(index,row,col) {
      const key=index+":"+row+","+col;
      if (active.has(key)) fail("#CICLO!");
      if (cache.has(key)) return cache.get(key);
      const raw=sheets[index].cells[row+","+col] || "";
      if (!raw.startsWith("=")) return raw.startsWith("'") ? raw.slice(1) : number.test(raw) ? Number(raw) : raw;
      if (--remaining<0 || active.size>=150) fail("#LIMITE!");
      active.add(key);
      try {
        const result=parse(raw.slice(1),index);
        cache.set(key,result);
        return result;
      } finally {active.delete(key);}
    }
    function parse(input,index) {
      let tail=input.trim();
      const tokens=[];
      while (tail) {
        const matched=token.exec(tail);
        if (!matched || tokens.length>=256) fail();
        tokens.push(matched[0]);
        tail=tail.slice(matched[0].length).trimStart();
      }
      let pos=0;
      const take=text=>tokens[pos]===text && Boolean(++pos);
      function reference() {
        let sheet=index;
        if(tokens[pos]?.endsWith("!")){
          sheet=names.get(tokens[pos++].slice(0,-1).replace(/^'|'$/g,"").toUpperCase());
          if(sheet===undefined)fail("#REF!");
        }
        const cell=address(tokens[pos++]||"");if(!cell)fail("#REF!");
        return [sheet,...cell];
      }
      function atom(){
        if(take("-"))return {op:"neg",a:atom()};
        if(take("+"))return {op:"pos",a:atom()};
        if(take("(")){const value=comparison();if(!take(")"))fail();return value;}
        const word=tokens[pos];if(!word)fail();
        if(tokens[pos+1]==="("){
          const name=FUNCTIONS[word.toUpperCase()];if(!name)fail("#NOME?");pos+=2;
          const args=[];
          if(!take(")")){do{args.push(comparison());}while(take(";")||take(","));if(!take(")"))fail();}
          return {fn:name,args};
        }
        if(word.startsWith('"')){pos++;return {value:word.slice(1,-1).replace(/""/g,'"')};}
        if(/^\d/.test(word)&&!word.endsWith("!")){pos++;return {value:Number(word)};}
        const ref=reference();
        if(take(":")){
          const explicit=tokens[pos]?.endsWith("!"),end=reference();if(!explicit)end[0]=ref[0];
          if(end[0]!==ref[0]||end[1]<ref[1]||end[2]<ref[2])fail("#REF!");
          return {range:[...ref,end[1],end[2]]};
        }
        return {ref};
      }
      function percent(){let value=atom();while(take("%"))value={op:"/",a:value,b:{value:100}};return value;}
      function product(){let value=percent();while(["*","/"].includes(tokens[pos])){const op=tokens[pos++];value={op,a:value,b:percent()};}return value;}
      function sum(){let value=product();while(["+","-","&"].includes(tokens[pos])){const op=tokens[pos++];value={op,a:value,b:product()};}return value;}
      function comparison(){let value=sum();if(["=","<>","<",">","<=",">="].includes(tokens[pos])){const op=tokens[pos++];value={op,a:value,b:sum()};}return value;}
      function run(node){
        if(--remaining<0)fail("#LIMITE!");
        if("value" in node)return node.value;
        if(node.ref)return get(...node.ref);
        if(node.range){const [s,r,c,lastRow,lastCol]=node.range,values=[];
          for(let y=r;y<=lastRow;y++)for(let x=c;x<=lastCol;x++){if(--remaining<0)fail("#LIMITE!");values.push(get(s,y,x));}return values;}
        if(node.fn){
          const args=node.args;
          if(node.fn==="IF"){if(args.length<2||args.length>3)fail();return run(args[0])?run(args[1]):args[2]?run(args[2]):false;}
          if(node.fn==="IFERROR"){if(args.length!==2)fail();try{return run(args[0]);}catch(error){if(error.message==="#LIMITE!")throw error;return run(args[1]);}}
          const values=args.flatMap(arg=>run(arg)),nums=values.filter(v=>typeof v==="number");
          if(node.fn==="COUNT")return nums.length;
          if(node.fn==="COUNTA")return values.filter(v=>v!=="").length;
          if(node.fn==="MIN")return nums.length?Math.min(...nums):0;
          if(node.fn==="MAX")return nums.length?Math.max(...nums):0;
          const total=nums.reduce((a,b)=>a+b,0);if(node.fn==="SUM")return total;
          if(!nums.length)fail("#DIV/0!");return total/nums.length;
        }
        const a=run(node.a);if(node.op==="neg")return -numeric(a);if(node.op==="pos")return numeric(a);
        const b=run(node.b);
        if(node.op==="&")return String(a)+String(b);
        if(node.op==="=")return a===b;if(node.op==="<>")return a!==b;
        if(node.op==="<")return a<b;if(node.op===">")return a>b;
        if(node.op==="<=")return a<=b;if(node.op===">=")return a>=b;
        if(node.op==="+")return numeric(a)+numeric(b);if(node.op==="-")return numeric(a)-numeric(b);
        if(node.op==="*")return numeric(a)*numeric(b);if(b===0)fail("#DIV/0!");return numeric(a)/numeric(b);
      }
      const tree=comparison();if(pos!==tokens.length)fail();
      const value=run(tree);return typeof value==="number"?numeric(value):value;
    }

    return (index,row,col)=>{
      try {return get(index,row,col);} catch (error) {return error.message;}
    };
  }
  window.OpenDocWorkbookFormula={address,column,evaluate};
})();
