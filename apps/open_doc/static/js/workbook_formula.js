"use strict";
(() => {
  const FUNCTIONS = {SUM:"SUM", SOMA:"SUM", AVERAGE:"AVERAGE", "MÉDIA":"AVERAGE",
    MIN:"MIN", "MÍNIMO":"MIN", MAX:"MAX", "MÁXIMO":"MAX"};
  const token = /^(?:\d+(?:\.\d+)?|(?:'[\w À-ÿ]+'|[\wÀ-ÿ]+)!|\$?[A-Za-z]{1,3}\$?[1-9]\d*\b|[A-Za-zÀ-ÿ]+|[+*/():;,-])/;
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
        if (tokens[pos]?.endsWith("!")) {
          const name=tokens[pos++].slice(0,-1).replace(/^'|'$/g,"").toUpperCase();
          sheet=names.get(name);
          if (sheet===undefined) fail("#REF!");
        }
        const cell=address(tokens[pos++] || "");
        if (!cell) fail("#REF!");
        return [sheet,...cell];
      }
      function argument() {
        const end=pos+(tokens[pos]?.endsWith("!") ? 2 : 1);
        if (tokens[end]!==":") return [sum()];
        const [sheet,row,col]=reference();
        pos++;
        const next=pos;
        const [target,lastRow,lastCol]=reference();
        if ((tokens[next]?.endsWith("!") && target!==sheet) || lastRow<row || lastCol<col) fail("#REF!");
        const values=[];
        for (let r=row;r<=lastRow;r++) {
          for (let c=col;c<=lastCol;c++) {
            if (--remaining<0) fail("#LIMITE!");
            const value=get(sheet,r,c);
            if (typeof value==="number") values.push(value);
          }
        }
        return values;
      }
      function atom() {
        if (take("-")) return -numeric(atom());
        if (take("+")) return numeric(atom());
        if (take("(")) {
          const value=sum();
          if (!take(")")) fail();
          return value;
        }
        const word=tokens[pos];
        if (!word) fail();
        if (tokens[pos+1]==="(") {
          const name=FUNCTIONS[word.toUpperCase()];
          if (!name) fail("#NOME?");
          pos+=2;
          const values=argument();
          while (take(";") || take(",")) {
            for (const value of argument()) values.push(value);
          }
          if (!take(")")) fail();
          const nums=values.filter(value=>typeof value==="number");
          if (name==="MIN") return nums.length ? nums.reduce((a,b)=>Math.min(a,b)) : 0;
          if (name==="MAX") return nums.length ? nums.reduce((a,b)=>Math.max(a,b)) : 0;
          const total=nums.reduce((a,b)=>a+b,0);
          if (name==="SUM") return total;
          if (!nums.length) fail("#DIV/0!");
          return total/nums.length;
        }
        if (/^\d/.test(word) && !word.endsWith("!")) {pos++;return Number(word);}
        return get(...reference());
      }
      function product() {
        let result=atom();
        while (tokens[pos]==="*" || tokens[pos]==="/") {
          const operator=tokens[pos++], next=numeric(atom());
          if (operator==="/" && next===0) fail("#DIV/0!");
          result=operator==="*" ? numeric(result)*next : numeric(result)/next;
        }
        return result;
      }
      function sum() {
        let result=product();
        while (tokens[pos]==="+" || tokens[pos]==="-") {
          const operator=tokens[pos++], next=numeric(product());
          result=operator==="+" ? numeric(result)+next : numeric(result)-next;
        }
        return result;
      }
      const value=sum();
      if (pos!==tokens.length) fail();
      return typeof value==="number" ? numeric(value) : value;
    }
    return (index,row,col)=>{
      try {return get(index,row,col);} catch (error) {return error.message;}
    };
  }
  window.OpenDocWorkbookFormula={address,column,evaluate};
})();
