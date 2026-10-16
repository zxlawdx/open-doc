/* DOM -> structured state, keeping opaque metadata through stable node IDs. */
"use strict";
(() => {
  const textIds=new WeakMap();
  function textId(n){if(!textIds.has(n))textIds.set(n,window.OpenDocModel.id());return textIds.get(n);}
  function readStyle(e,inherited={}){const style={...inherited},s=e.style || {},tag=e.tagName;
    if(['B','STRONG'].includes(tag))style.bold=true;if(['I','EM'].includes(tag))style.italic=true;if(tag==='U')style.underline='single';if(['S','STRIKE','DEL'].includes(tag))style.strike=true;
    if(tag==='SUP')style.vertical_align='superscript';if(tag==='SUB')style.vertical_align='subscript';
    if(s.fontFamily)style.font_family=s.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g,'');
    if(s.fontSize && !e.hasAttribute('data-script-size')){const n=parseFloat(s.fontSize);if(n>0)style.font_size_pt=s.fontSize.endsWith('px')?n*.75:n;}
    if(s.fontWeight)style.bold=s.fontWeight==='bold' || Number(s.fontWeight)>=600;if(s.fontStyle)style.italic=s.fontStyle==='italic';
    if(s.textDecorationLine.includes('underline') && (!style.underline || style.underline==='none'))style.underline='single';if(s.textDecorationLine.includes('line-through'))style.strike=true;
    function hex(v){const c=v.match(/\d+/g);return v.startsWith('#')?v.slice(1).toUpperCase():c && c.length>=3?c.slice(0,3).map(v=>Number(v).toString(16).padStart(2,'0')).join('').toUpperCase():null;}
    if(s.color)style.color=hex(s.color);if(s.backgroundColor){const v=hex(s.backgroundColor);if(window.OpenDocRichRenderer.color(style.highlight).toUpperCase()!=='#'+v)style.highlight=v;}
    if(s.verticalAlign)style.vertical_align=({super:'superscript',sub:'subscript'})[s.verticalAlign] || 'baseline';
    if(e.dataset.stylePatch){try{Object.assign(style,JSON.parse(e.dataset.stylePatch));}catch{}}
    return style;
  }
  function serialize(surface,original,dirty=null){const M=window.OpenDocModel,base=original || M.empty();
    const fast=dirty && original && dirty.parentNode===surface && surface.children.length===base.blocks.length && Array.from(surface.children).every((e,i)=>e.dataset.nodeId===base.blocks[i].id);
    const oldBlock=fast?base.blocks.find(b=>b.id===dirty.dataset.nodeId):null,map=M.index(fast?{blocks:[oldBlock]}:base),used=new Set();
    const previous=e=>map.get(e.dataset && e.dataset.nodeId) || {};
    function identity(e){let id=e.dataset && e.dataset.nodeId;if(!id || used.has(id))id=M.id();used.add(id);if(e.dataset)e.dataset.nodeId=id;return id;}
    function inline(parent,inherited={},rawProperties=null){const out=[];for(const c of parent.childNodes){
      if(c.nodeType===3){if(c.textContent)out.push({id:textId(c),type:'text',text:c.textContent,style:{...inherited},...(rawProperties?{raw_properties:rawProperties}:{})});continue;}
      if(c.nodeType!==1 || c.hasAttribute('data-list-marker') || ['UL','OL'].includes(c.tagName))continue;
      const old=previous(c),kind=c.dataset.nodeType;
      if(['opaque-ooxml','image','note-reference','field','tab','break'].includes(kind) && old.type){out.push({...M.clone(old),id:identity(c)});continue;}
      if(c.tagName==='BR'){if(parent.childNodes.length>1)out.push({id:identity(c),type:'break',break_type:'line'});continue;}
      const style=readStyle(c,{...inherited,...(old.style || {})});
      if(c.tagName==='A' && /^(https?:\/\/|mailto:|#)/i.test(c.getAttribute('href') || ''))out.push({...old,id:identity(c),type:'hyperlink',href:c.getAttribute('href'),children:inline(c,style,old.raw_properties || rawProperties)});
      else if(kind==='text' && Array.from(c.childNodes).every(n=>n.nodeType===3))out.push({...old,id:identity(c),type:'text',text:c.textContent,style});
      else out.push(...inline(c,style,old.raw_properties || rawProperties));
    }return M.normalizeRuns(out);}
    function blocks(parent,listInfo=null){const out=[];let pending=[];
      function flush(){if(!pending.length)return;const div=document.createElement('div');pending.forEach(n=>div.appendChild(n.cloneNode(true)));out.push({id:M.id(),type:'paragraph',style:{},children:inline(div)});pending=[];}
      for(const e of parent.childNodes){if(e.nodeType===3 && !e.textContent.trim())continue;if(e.nodeType!==1){pending.push(e);continue;}
        const old=previous(e);
        if(['opaque-ooxml','page_break'].includes(e.dataset.nodeType)){flush();out.push({...M.clone(old),id:identity(e)});continue;}
        if(['UL','OL'].includes(e.tagName)){flush();out.push(...blocks(e,{format:e.tagName==='UL'?'bullet':'decimal',level:listInfo?listInfo.level+1:0}));continue;}
        if(e.tagName==='TABLE'){flush();const table={...old,id:identity(e),type:'table',rows:[]};for(const row of Array.from(e.rows)){
          const oldRow=(old.rows || []).find(r=>r.id===row.dataset.rowId) || {};
          const cells=Array.from(row.cells).map(cell=>{const oldCell=(oldRow.cells || []).find(c=>c.id===cell.dataset.cellId) || {};return {...oldCell,id:cell.dataset.cellId || M.id(),col_span:cell.colSpan,row_span:cell.rowSpan,blocks:blocks(cell)};});
          if(oldRow.cells){let i=0;table.rows.push({...oldRow,cells:oldRow.cells.map(c=>c.merge_continue?M.clone(c):cells[i++]).filter(Boolean)});}else table.rows.push({id:M.id(),cells});
        }out.push(table);continue;}
        if(['P','DIV','H1','H2','H3','H4','H5','H6','LI','BLOCKQUOTE','PRE'].includes(e.tagName)){
          flush();const style={...(old.style || {})},s=e.style;
          if(/^H[1-6]$/.test(e.tagName))style.outline_level=Number(e.tagName[1])-1;else{delete style.outline_level;if(/^Heading\d$/i.test(style.style_id || ''))delete style.style_id;}
          if(s.textAlign)style.alignment=s.textAlign;
          for(const [key,prop] of [['space_before_pt','marginTop'],['space_after_pt','marginBottom'],['left_indent_pt','marginLeft'],['right_indent_pt','marginRight']])if(s[prop])style[key]=parseFloat(s[prop])*(s[prop].endsWith('px')?.75:1);
          if(s.textIndent){style.first_line_indent_pt=Math.max(0,parseFloat(s.textIndent));style.hanging_indent_pt=Math.max(0,-parseFloat(s.textIndent));}
          if(s.lineHeight){style.line_spacing=parseFloat(s.lineHeight);style.line_spacing_rule=/pt|px/.test(s.lineHeight)?'exact':'auto';}
          e.dataset.nodeType='paragraph';const item={...old,id:identity(e),type:'paragraph',style,children:inline(e)};
          if(e.tagName==='PRE')item.block_kind='code';else if(e.tagName==='BLOCKQUOTE')item.block_kind='quote';else delete item.block_kind;
          if(e.dataset.listInfo){try{item.list_info=JSON.parse(e.dataset.listInfo);}catch{item.list_info=null;}}else item.list_info=e.tagName==='LI'?listInfo:null;
          out.push(item);for(const nested of Array.from(e.children).filter(n=>['UL','OL'].includes(n.tagName)))out.push(...blocks(nested,{format:nested.tagName==='UL'?'bullet':'decimal',level:(listInfo?listInfo.level:0)+1}));
        }else pending.push(e);
      }flush();return out;
    }
    if(surface.querySelector?.("[data-page-index]")){const logical=window.OpenDocPagination.logical(surface),id=dirty?.dataset.fragmentOf || dirty?.dataset.nodeId;return serialize(logical,base,id?Array.from(logical.children).find(n=>n.dataset.nodeId===id):null);}
    if(fast){const replacement=blocks({childNodes:[dirty]});return {...base,blocks:base.blocks.map(b=>b.id===oldBlock.id?replacement[0]:b)};}
    return {...base,blocks:blocks(surface)};
  }
  window.OpenDocRichSerializer={serialize,readStyle};
})();
