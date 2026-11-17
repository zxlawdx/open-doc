"use strict";
(() => {
  const FUNCTIONS = {SUM:"SUM", SOMA:"SUM", AVERAGE:"AVERAGE", "MÉDIA":"AVERAGE",
    MIN:"MIN", "MÍNIMO":"MIN", MAX:"MAX", "MÁXIMO":"MAX", IF:"IF", SE:"IF", COUNT:"COUNT", COUNTA:"COUNTA", IFERROR:"IFERROR", SEERRO:"IFERROR"};
  const token = /^(?:"(?:[^"]|"")*"|\d+(?:[.,]\d+)?|(?:'[\w À-ÿ]+'|[\wÀ-ÿ]+)!|\$?[A-Za-z]{1,3}\$?[1-9]\d*\b|[A-Za-zÀ-ÿ]+|#REF!|<=|>=|<>|\*\*|[=<>%^+*/():;,&-])/;
  const number = /^-?(?:0|[1-9]\d*)(?:[.,]\d+)?$/;
  const parseNumber = value => Number(String(value).replace(",", "."));
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
      if (typeof value==="string" && number.test(value.trim())) return parseNumber(value.trim());
      fail("#VALOR!");
    }
    function get(index,row,col) {
      const key=index+":"+row+","+col;
      if (active.has(key)) fail("#CICLO!");
      if (cache.has(key)) return cache.get(key);
      const raw=sheets[index].cells[row+","+col] || "";
      if (!raw.startsWith("=")) return raw.startsWith("'") ? raw.slice(1) : number.test(raw) ? parseNumber(raw) : raw;
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
        if(take("(")){const value=comparison();if(!take(")"))fail();return value;}
        const word=tokens[pos];if(!word)fail();
        if(take("#REF!"))return {error:"#REF!"};
        if(word.endsWith("!")&&tokens[pos+1]==="#REF!"){pos+=2;return {error:"#REF!"};}
        if(tokens[pos+1]==="("){
          const name=FUNCTIONS[word.toUpperCase()];if(!name)fail("#NOME?");pos+=2;
          const args=[];
          if(!take(")")){do{args.push(comparison());}while(take(";")||take(","));if(!take(")"))fail();}
          return {fn:name,args};
        }
        if(word.startsWith('"')){pos++;return {value:word.slice(1,-1).replace(/""/g,'"')};}
        if(/^\d/.test(word)&&!word.endsWith("!")){pos++;return {value:parseNumber(word)};}
        const ref=reference();
        if(take(":")){
          const explicit=tokens[pos]?.endsWith("!"),end=reference();if(!explicit)end[0]=ref[0];
          if(end[0]!==ref[0]||end[1]<ref[1]||end[2]<ref[2])fail("#REF!");
          return {range:[...ref,end[1],end[2]]};
        }
        return {ref};
      }
      function power(){let value=atom();if(["^","**"].includes(tokens[pos])){pos++;value={op:"^",a:value,b:unary()};}return value;}
      function unary(){if(take("-"))return {op:"neg",a:unary()};if(take("+"))return {op:"pos",a:unary()};return power();}
      function percent(){let value=unary();while(take("%"))value={op:"/",a:value,b:{value:100}};return value;}
      function product(){let value=percent();while(["*","/"].includes(tokens[pos])){const op=tokens[pos++];value={op,a:value,b:percent()};}return value;}
      function sum(){let value=product();while(["+","-","&"].includes(tokens[pos])){const op=tokens[pos++];value={op,a:value,b:product()};}return value;}
      function comparison(){let value=sum();if(["=","<>","<",">","<=",">="].includes(tokens[pos])){const op=tokens[pos++];value={op,a:value,b:sum()};}return value;}
      function run(node){
        if(--remaining<0)fail("#LIMITE!");
        if(node.error)fail(node.error);
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
        if(node.op==="*")return numeric(a)*numeric(b);if(node.op==="^")return Math.pow(numeric(a),numeric(b));if(numeric(b)===0)fail("#DIV/0!");return numeric(a)/numeric(b);
      }
      const tree=comparison();if(pos!==tokens.length)fail();
      const value=run(tree);return typeof value==="number"?numeric(value):value;
    }

    return (index,row,col)=>{
      try {return get(index,row,col);} catch (error) {return error.message;}
    };
  }

  // Preserve spreadsheet references when the user inserts or removes a row/column.
  // Formulas in other sheets are updated only when they explicitly name this sheet.
  function shiftStructure(sheets, sheetIndex, axis, position, insert) {
    const limit=axis==="row"?10000:100;
    if(!["row","column"].includes(axis)||!Number.isInteger(position)||position<0||position>=limit)
      throw Error("Posição inválida para alterar a estrutura da planilha.");
    const source=sheets[sheetIndex];
    if(!source)throw Error("A aba não existe.");
    if(source.pivot || (source.objects||[]).length || source.external_resource)
      throw Error("Esta aba contém gráficos, desenhos, tabela dinâmica ou recurso externo. Remova esses objetos antes de alterar sua estrutura.");
    if(sheets.some((other,i)=>i!==sheetIndex&&other.pivot?.source===sheetIndex))
      throw Error("Atualize ou remova a tabela dinâmica vinculada a esta aba antes de inserir ou excluir linhas e colunas.");
    const step=value=>{
      if(value<position)return value;
      if(!insert&&value===position)return null;
      const shifted=value+(insert?1:-1);
      if(shifted>=limit)throw Error("A última linha ou coluna contém dados que seriam perdidos.");
      return shifted;
    };
    function cellKey(id){
      const parts=/^(\d+),(\d+)$/.exec(id);if(!parts)throw Error("Coordenada inválida: "+id);
      const r=Number(parts[1]),c=Number(parts[2]),next=step(axis==="row"?r:c);
      return next===null?null:axis==="row"?next+","+c:r+","+next;
    }
    function remap(record,mapper){
      if(!record)return record;
      const result={};
      for(const [id,value] of Object.entries(record)){
        const target=mapper(id);
        if(target!==null)result[target]=value;
      }
      return result;
    }
    function refPoint(text) {
      const m=/^(\$?)([A-Z]{1,3})(\$?)([1-9]\d*)$/i.exec(text);
      if(!m)return null;
      let c=0;
      for(const ch of m[2].toUpperCase())c=c*26+ch.charCodeAt(0)-64;
      return {row:Number(m[4])-1,col:c-1,absCol:m[1],absRow:m[3]};
    }
    function makePoint(p) {
      if(p.row<0||p.row>=10000||p.col<0||p.col>=100)return "#REF!";
      return p.absCol+column(p.col)+p.absRow+(p.row+1);
    }
    function shiftPoint(text){
      const p=refPoint(text);
      if(!p)return text;
      const next=step(axis==="row"?p.row:p.col);
      if(next===null)return "#REF!";
      if(axis==="row")p.row=next;else p.col=next;
      return makePoint(p);
    }
    function shiftRange(first,second){
      const a=refPoint(first),b=refPoint(second);
      if(!a||!b)return first+":"+second;
      const prop=axis==="row"?"row":"col";
      const start=a[prop],end=b[prop];
      if(start>end)return shiftPoint(first)+":"+shiftPoint(second);
      if(insert) {
        // Inserting inside the range expands it; inserting at its start moves it.
        if(position<=start){a[prop]++;b[prop]++;}
        else if(position<=end)b[prop]++;
      } else {
        if(position<start){a[prop]--;b[prop]--;}
        else if(position<=end){
          if(start===end)return "#REF!";
          b[prop]--;
        }
      }
      if(a[prop]>=limit||b[prop]>=limit)throw Error("Intervalo ultrapassaria o tamanho máximo da planilha.");
      return makePoint(a)+":"+makePoint(b);
    }
    function rewriteFormula(formula, owner) {
      if(typeof formula!=="string"||!formula.startsWith("="))return formula;
      // Do not change quoted string literals or formula function names.
      return formula.replace(/"(?:[^"]|"")*"|(?<![\wÀ-ÿ.])((?:'[^']+'|[A-Za-zÀ-ÿ_][\wÀ-ÿ_]*)!)?(\$?[A-Za-z]{1,3}\$?[1-9]\d*)(?::(\$?[A-Za-z]{1,3}\$?[1-9]\d*))?(?![\wÀ-ÿ])/g,(match,qualifier,first,last)=>{
        if(match.startsWith('"'))return match;
        const named=qualifier?qualifier.slice(0,-1).replace(/^'|'$/g,"").replace(/''/g,"'"):null;
        const applies=named?named.toUpperCase()===source.name.toUpperCase():owner===sheetIndex;
        if(!applies)return match;
        const mapped=last?shiftRange(first,last):shiftPoint(first);
        return (qualifier||"")+mapped;
      });
    }
    function shiftRect(rect){
      if(!Array.isArray(rect)||rect.length!==4)return rect;
      let [top,left,bottom,right]=rect;
      const start=axis==="row"?top:left,end=axis==="row"?bottom:right;
      let lo=start,hi=end;
      if(insert){if(position<=lo){lo++;hi++;}else if(position<=hi)hi++;}
      else if(position<lo){lo--;hi--;}
      else if(position<=hi){if(lo===hi)return null;hi--;}
      if(hi>=limit)throw Error("Mesclagem ultrapassaria o limite da planilha.");
      return axis==="row"?[lo,left,hi,right]:[top,lo,bottom,hi];
    }
    function shiftFreeze(freeze){
      if(!Array.isArray(freeze))return freeze;
      const out=[...freeze],i=axis==="row"?0:1;
      if(position<out[i])out[i]=Math.max(0,out[i]+(insert?1:-1));
      return out;
    }
    // Preflight the entire workbook: an error cannot leave a half-edited sheet.
    const updated=sheets.map((original,owner)=>{
      if(owner!==sheetIndex){
        const cells={...original.cells};
        for(const [id,v] of Object.entries(cells))cells[id]=rewriteFormula(v,owner);
        return {...original,cells};
      }
      const cells=remap(original.cells,cellKey);
      for(const [id,v] of Object.entries(cells))cells[id]=rewriteFormula(v,owner);
      const layout=original.layout?{...original.layout}:undefined;
      if(layout){
        const dimension=axis==="row"?"rows":"columns";
        layout[dimension]=remap(layout[dimension],id=>{
          const next=step(Number(id));return next===null?null:String(next);
        });
        if(layout.merges)layout.merges=layout.merges.map(shiftRect).filter(Boolean);
        if(layout.freeze)layout.freeze=shiftFreeze(layout.freeze);
      }
      const cell_tools=remap(original.cell_tools,cellKey);
      if(cell_tools)for(const [id,existing] of Object.entries(cell_tools)){
        const tool={...existing};cell_tools[id]=tool;
        if(tool?.sparkline?.range){
          const span=shiftRect(tool.sparkline.range);
          if(span)tool.sparkline={...tool.sparkline,range:span};
          else delete tool.sparkline;
        }
      }
      return {...original,cells,
        bold:(original.bold||[]).map(cellKey).filter(x=>x!==null),
        styles:remap(original.styles,cellKey),
        cell_tools,layout,
        types:original.types?{...original.types,
          cells:remap(original.types.cells,cellKey),
          columns:axis==="column"?remap(original.types.columns,id=>{
            const next=step(Number(id));return next===null?null:String(next);
          }):original.types.columns}:original.types
      };
    });
    return updated;
  }

  window.OpenDocWorkbookFormula={address,column,evaluate,shiftStructure};
})();
