/* Versioned structured state; snapshots reference media IDs, never binary data. */
"use strict";
(() => {
  let sequence=0;const fingerprints=new WeakMap();
  const id=()=> 'node-'+Date.now().toString(36)+'-'+(++sequence).toString(36);
  const clone=v=>JSON.parse(JSON.stringify(v));
  function empty(){return {version:'opendoc-rich-v1',blocks:[],styles:{},numbering:{},media:{},sections:[],headers:{},footers:{},footnotes:{},endnotes:{},comments:{},metadata:{},preserved_parts:[]};}
  function index(model){const map=new Map();function visit(v){if(!v || typeof v!=='object')return;if(v.id)map.set(v.id,v);for(const k of Object.keys(v))if(Array.isArray(v[k]))v[k].forEach(visit);}visit(model);return map;}
  function fingerprint(model){if(!fingerprints.has(model))fingerprints.set(model,JSON.stringify(model));return fingerprints.get(model);}
  const styleKey=s=>JSON.stringify(Object.keys(s || {}).sort().map(k=>[k,s[k]]));
  function normalizeRuns(children){const out=[];for(const n of children){const p=out[out.length-1];if(p && n.type==='text' && p.type==='text' && styleKey(p.style)===styleKey(n.style) && p.raw_properties===n.raw_properties)p.text+=n.text;else out.push(n);}return out;}
  function markdown(model){
    function inline(values){return values.map(n=>{if(n.type==='hyperlink')return '['+inline(n.children)+']('+n.href+')';if(n.type==='break')return '\n';if(n.type==='tab')return '\t';let v=n.text || '',s=n.style || {};if(s.bold)v='**'+v+'**';if(s.italic)v='_'+v+'_';return v;}).join('');}
    function blocks(values){return values.map(n=>{if(n.type==='table'){const rows=n.rows.map(r=>'| '+r.cells.filter(c=>!c.merge_continue).map(c=>blocks(c.blocks).replace(/\n/g,' ')).join(' | ')+' |');if(rows.length)rows.splice(1,0,'| '+n.rows[0].cells.filter(c=>!c.merge_continue).map(()=>'---').join(' | ')+' |');return rows.join('\n');}if(n.type!=='paragraph')return '';let v=inline(n.children || []),s=n.style || {};if(typeof s.outline_level==='number' && s.outline_level>=0 && s.outline_level<6)v='#'.repeat(s.outline_level+1)+' '+v;if(n.list_info)v='  '.repeat(n.list_info.level || 0)+(n.list_info.format==='bullet'?'- ':'1. ')+v;if(n.block_kind==='quote')v='> '+v;if(n.block_kind==='code'){const f='`'.repeat(Math.max(3,...(v.match(/`+/g) || []).map(r=>r.length+1)));v=f+'\n'+v+'\n'+f;}return v;}).filter(Boolean).join('\n\n');}return blocks(model.blocks);
  }
  window.OpenDocModel={id,clone,empty,index,fingerprint,normalizeRuns,markdown};
})();
