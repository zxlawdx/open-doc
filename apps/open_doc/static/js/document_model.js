/* Versioned structured state; snapshots reference media IDs, never binary data. */
"use strict";
(() => {
  let sequence=0;const lengths=new WeakMap();
  const id=()=> 'node-'+Date.now().toString(36)+'-'+(++sequence).toString(36);
  const clone=v=>JSON.parse(JSON.stringify(v));
  function empty(){return {version:'opendoc-rich-v1',blocks:[],styles:{},numbering:{},media:{},sections:[],headers:{},footers:{},footnotes:{},endnotes:{},comments:{},metadata:{},preserved_parts:[]};}
  function index(model){const map=new Map();function visit(v){if(!v || typeof v!=='object')return;if(v.id)map.set(v.id,v);for(const k of Object.keys(v))if(Array.isArray(v[k]))v[k].forEach(visit);}visit(model);return map;}
  // Editor snapshots share immutable subtrees. In particular, editing text
  // keeps the ink layers and their potentially large point arrays by reference.
  function sameContent(left,right){
    if(left===right)return true;
    if(!left||!right||typeof left!=='object'||typeof right!=='object'||
      Array.isArray(left)!==Array.isArray(right))return false;
    if(Array.isArray(left))return left.length===right.length&&left.every((value,i)=>sameContent(value,right[i]));
    const keys=Object.keys(left).filter(key=>left[key]!==undefined);
    const other=Object.keys(right).filter(key=>right[key]!==undefined);
    return keys.length===other.length&&keys.every((key,i)=>key===other[i]&&sameContent(left[key],right[key]));
  }
  function sameSnapshot(left,right){
    return left?.title===right?.title&&(left?.content||right?.content
      ?sameContent(left?.content,right?.content):left?.markdown===right?.markdown);
  }
  function cachedLength(value,measure){
    if(!value||typeof value!=='object')return measure(value);
    if(!lengths.has(value))lengths.set(value,measure(value));
    return lengths.get(value);
  }
  const jsonLength=value=>cachedLength(value,item=>JSON.stringify(item)?.length??0);
  function arrayLength(value,itemLength){
    return cachedLength(value,items=>2+Math.max(0,items.length-1)+items.reduce((sum,item)=>sum+itemLength(item),0));
  }
  function recordLength(value,fieldLength){
    return cachedLength(value,record=>{
      let size=2,comma=0;
      for(const [key,item] of Object.entries(record)){
        if(item===undefined)continue;
        size+=comma+JSON.stringify(key).length+1+fieldLength(key,item);
        comma=1;
      }
      return size;
    });
  }
  function snapshotSize(content){
    return recordLength(content,(key,value)=>{
      if(key==='blocks')return arrayLength(value,jsonLength);
      if(key==='ink_layers')return arrayLength(value,layer=>recordLength(layer,(field,item)=>
        field==='strokes'?arrayLength(item,jsonLength):jsonLength(item)));
      return jsonLength(value);
    });
  }
  const styleKey=s=>JSON.stringify(Object.keys(s || {}).sort().map(k=>[k,s[k]]));
  function normalizeRuns(children){const out=[];for(const n of children){const p=out[out.length-1];if(p && n.type==='text' && p.type==='text' && styleKey(p.style)===styleKey(n.style) && p.raw_properties===n.raw_properties)p.text+=n.text;else out.push(n);}return out;}
  function markdown(model){
    const mathValue=value=>Array.isArray(value)?value.map(mathNode).join(''):String(value??'');
    function mathNode(n){
      const v=key=>mathValue(n[key]);
      switch(n.kind){
        case 'bold':
        case 'text':return v('value');
        case 'fraction':return '('+v('numerator')+')/('+v('denominator')+')';
        case 'nary':return n.operator+'_('+v('lower')+')^('+v('upper')+')'+v('body');
        case 'superscript':return v('base')+'^('+v('power')+')';
        case 'subscript':return v('base')+'_('+v('sub')+')';
        case 'sqrt':return '√('+v('radicand')+')';
        case 'root':return 'root('+v('index')+','+v('radicand')+')';
        case 'limit':return v('base')+'_('+v('lower')+')';
        case 'matrix':return '['+n.rows.map(row=>row.map(mathValue).join(', ')).join('; ')+']';
        default:return '';
      }
    }
    function inline(values){return values.map(n=>{if(n.type==='math')return mathValue(n.math_blocks||[]);if(n.type==='hyperlink')return '['+inline(n.children)+']('+n.href+')';if(n.type==='break')return '\n';if(n.type==='tab')return '\t';let v=n.text || '',s=n.style || {};if(s.bold)v='**'+v+'**';if(s.italic)v='_'+v+'_';return v;}).join('');}
    function blocks(values){return values.map(n=>{if(n.type==='table'){const rows=n.rows.map(r=>'| '+r.cells.filter(c=>!c.merge_continue).map(c=>blocks(c.blocks).replace(/\n/g,' ')).join(' | ')+' |');if(rows.length)rows.splice(1,0,'| '+n.rows[0].cells.filter(c=>!c.merge_continue).map(()=>'---').join(' | ')+' |');return rows.join('\n');}if(n.type!=='paragraph')return '';let v=inline(n.children || []),s=n.style || {};if(typeof s.outline_level==='number' && s.outline_level>=0 && s.outline_level<6)v='#'.repeat(s.outline_level+1)+' '+v;if(n.list_info)v='  '.repeat(n.list_info.level || 0)+(n.list_info.format==='bullet'?'- ':'1. ')+v;if(n.block_kind==='quote')v='> '+v;if(n.block_kind==='code'){const f='`'.repeat(Math.max(3,...(v.match(/`+/g) || []).map(r=>r.length+1)));v=f+'\n'+v+'\n'+f;}return v;}).filter(Boolean).join('\n\n');}return blocks(model.blocks);
  }
  window.OpenDocModel={id,clone,empty,index,sameSnapshot,snapshotSize,jsonLength,normalizeRuns,markdown};
})();
