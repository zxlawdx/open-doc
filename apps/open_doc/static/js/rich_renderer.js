/* Model-to-DOM without HTML interpolation or arbitrary CSS properties. */
"use strict";
(() => {
  const highlights={yellow:'FFFF00',green:'00FF00',cyan:'00FFFF',magenta:'FF00FF',blue:'0000FF',red:'FF0000',darkBlue:'000080',darkCyan:'008080',darkGreen:'008000',darkMagenta:'800080',darkRed:'800000',darkYellow:'808000',darkGray:'808080',lightGray:'C0C0C0',black:'000000',white:'FFFFFF'};
  const nonvisualMarkers=new Set(['bookmarkStart','bookmarkEnd','proofErr','lastRenderedPageBreak']);
  function isNonvisualMarker(node){
    if(node.type!=='opaque-ooxml' || typeof node.xml!=='string' ||
       !/^<(?:[\w.-]+:)?(?:bookmarkStart|bookmarkEnd|proofErr|lastRenderedPageBreak)(?=[\s/>])/.test(node.xml))return false;
    const element=new DOMParser().parseFromString(node.xml,'application/xml').documentElement;
    return element.namespaceURI==='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
      && nonvisualMarkers.has(element.localName);
  }
  function color(v){v=highlights[v] || v;return /^[a-f\d]{6}$/i.test(v || '')?'#'+v:'';}
  function textStyle(e,style){const s=e.style;style=style || {};
    if(typeof style.font_family==='string' && style.font_family.length<=200)s.fontFamily=JSON.stringify(style.font_family)+', var(--font-document-default)';
    if(style.font_size_pt>=1 && style.font_size_pt<=512)s.fontSize=style.font_size_pt+'pt';
    if(style.bold!=null)s.fontWeight=style.bold?'700':'400';if(style.italic!=null)s.fontStyle=style.italic?'italic':'normal';
    const decorations=[];if(style.underline && style.underline!=='none')decorations.push('underline');if(style.strike)decorations.push('line-through');s.textDecorationLine=decorations.join(' ');
    if(style.color)s.color=color(style.color);if(style.highlight)s.backgroundColor=color(style.highlight);
    if(['superscript','subscript'].includes(style.vertical_align)){s.verticalAlign=style.vertical_align==='superscript'?'super':'sub';s.fontSize='0.75em';e.dataset.scriptSize='true';}
    if(style.small_caps)s.fontVariant='small-caps';if(style.all_caps)s.textTransform='uppercase';
    if(style.character_spacing_pt!=null && Math.abs(style.character_spacing_pt)<100)s.letterSpacing=style.character_spacing_pt+'pt';
  }
  function paragraphStyle(e,style){const s=e.style;
    if(['left','right','center','justify'].includes(style.alignment))s.textAlign=style.alignment;
    for(const [key,css] of [['space_before_pt','marginTop'],['space_after_pt','marginBottom'],['left_indent_pt','marginLeft'],['right_indent_pt','marginRight']])if(Number.isFinite(style[key]))s[css]=style[key]+'pt';
    if(style.first_line_indent_pt || style.hanging_indent_pt)s.textIndent=((style.first_line_indent_pt || 0)-(style.hanging_indent_pt || 0))+'pt';
    if(style.line_spacing>0 && style.line_spacing<1000)s.lineHeight=style.line_spacing+(style.line_spacing_rule==='auto'?'':'pt');
    if(style.page_break_before)s.breakBefore='page';
  }
  function applyBorders(e,values){for(const side of ['top','right','bottom','left']){const b=values && values[side];if(!b)continue;const css='border'+side[0].toUpperCase()+side.slice(1);if(['none','nil'].includes(b.style)){e.style[css]='none';continue;}e.style[css]=Math.max(0,Math.min(20,Number(b.size_pt) || .5))+'pt '+({double:'double',dotted:'dotted',dashed:'dashed',dashSmallGap:'dashed'}[b.style] || 'solid')+' '+(color(b.color)||'#666');}}
  function imageGeometry(element,node){
    element.dataset.imageNode=JSON.stringify(node);
    element.style.width=(node.width_pt||72)+'pt';element.style.height=(node.height_pt||72)+'pt';
    const floating=node.placement==='floating'&&Number.isFinite(node.x_pt)&&Number.isFinite(node.y_pt);
    element.style.position=floating?'absolute':'relative';
    element.style.left=floating?node.x_pt+'pt':'';element.style.top=floating?node.y_pt+'pt':'';
  }
  function renderNodes(model,surface,mediaRequest){surface.replaceChildren();const counters={};
    function label(value,format){if(format==='bullet')return '•';if(['lowerLetter','upperLetter'].includes(format)){let out='';while(value>0){value--;out=String.fromCharCode(97+value%26)+out;value=Math.floor(value/26);}return format==='upperLetter'?out.toUpperCase():out;}if(['lowerRoman','upperRoman'].includes(format)){let out='';for(const [n,s] of [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']])while(value>=n){out+=s;value-=n;}return format==='lowerRoman'?out.toLowerCase():out;}return String(value);}
    function build(n){const kind=n.type;let e;
      if(kind==='paragraph'){const level=n.style && n.style.outline_level;e=document.createElement(n.block_kind==='code'?'pre':n.block_kind==='quote'?'blockquote':typeof level==='number' && level>=0 && level<6?'h'+(level+1):'p');paragraphStyle(e,n.style || {});
        if(n.list_info){const li=n.list_info,key=li.num_id || li.format || 'list',level=li.level || 0;if(!counters[key])counters[key]=[];counters[key][level]=counters[key][level]===undefined?(li.start||1):counters[key][level]+1;counters[key].splice(level+1);
          const marker=document.createElement('span');marker.dataset.listMarker='';marker.contentEditable='false';marker.style.marginRight='8pt';marker.textContent=li.format==='bullet'?(li.text_pattern || '•').replace(/[\uE000-\uF8FF]/g,'•'):(li.text_pattern || '%'+(level+1)+'.').replace(/%([1-9])/g,(_,k)=>label(counters[key][Number(k)-1] || 1,model.numbering?.[li.num_id]?.levels?.[String(Number(k)-1)]?.format || li.format));e.style.paddingLeft=(level*24+24)+'pt';e.appendChild(marker);e.dataset.listInfo=JSON.stringify(li);}
        (n.children || []).forEach(c=>e.appendChild(build(c)));if(!n.children?.length)e.appendChild(document.createElement('br'));
      }else if(kind==='page_break'){e=document.createElement('div');e.contentEditable='false';e.className='manual-page-break';e.setAttribute('aria-label','Quebra de página');}
      else if(kind==='math'){
        e=document.createElement('span');e.className='rich-native-equation';
        e.contentEditable='false';e.tabIndex=0;
        e.setAttribute('role','math');e.setAttribute('aria-label','Equação matemática editável');
        e.dataset.mathBlocks=JSON.stringify(n.math_blocks||[]);
        if(window.OpenDocMathGallery?.renderBlocks)
          e.append(window.OpenDocMathGallery.renderBlocks(n.math_blocks||[]));
        else e.textContent='[Equação matemática]';
      }
      else if(kind==='text'){e=document.createElement('span');e.textContent=n.text;textStyle(e,n.style);}
      else if(kind==='hyperlink'){e=document.createElement('a');if(/^(https?:\/\/|mailto:|#)/i.test(n.href))e.href=n.href;n.children.forEach(c=>e.appendChild(build(c)));}
      else if(kind==='tab'){e=document.createElement('span');e.contentEditable='false';e.textContent='\t';e.style.whiteSpace='pre';}
      else if(kind==='break'){e=document.createElement('br');if(n.break_type==='page'){e=document.createElement('span');e.textContent='— Quebra de página —';e.contentEditable='false';e.className='rich-page-break';}}
      else if(kind==='image'){
        e=document.createElement('span');e.className='rich-image';e.contentEditable='false';
        e.tabIndex=0;e.setAttribute('role','group');
        e.setAttribute('aria-label',(n.alt_text||'Imagem')+'. Arraste para mover; setas movem, Alt+setas redimensionam, Delete exclui.');
        e.title='Arraste para mover, inclusive entre páginas. Setas movem; Alt+setas redimensionam; Shift aumenta o passo; Delete exclui.';
        e.dataset.imageNode=JSON.stringify(n);
        const picture=document.createElement('img');picture.alt=n.alt_text||'';picture.draggable=false;
        picture.style.width='100%';picture.style.height='100%';picture.style.display='block';
        e.appendChild(picture);
        imageGeometry(e,n);
        const handle=document.createElement('span');handle.dataset.imageResize='';
        handle.className='rich-image-resize';handle.setAttribute('aria-hidden','true');e.appendChild(handle);
        if(mediaRequest)mediaRequest(n.media_id).then(url=>{
          if(e.isConnected && /^data:image\/(png|jpeg|gif|webp);base64,/i.test(url))picture.src=url;
        }).catch(()=>{picture.alt='Imagem preservada; preview indisponível';});
      }
      else if(kind==='table'){e=document.createElement('table');applyBorders(e,n.borders);
        if(n.style_preset)e.dataset.tablePreset=n.style_preset;
        if(Number.isFinite(n.cell_spacing_pt)){
          e.dataset.cellSpacingPt=String(n.cell_spacing_pt);
          e.style.borderCollapse=n.cell_spacing_pt>0||n.style_preset==='matrix'?'separate':'collapse';
          e.style.borderSpacing=n.cell_spacing_pt*4/3+'px';
        }
        const widths=n.column_widths_pt || [];
        const total=widths.reduce((sum,width)=>sum+width,0);
        const useGrid=widths.length>0 && widths.every(width=>Number.isFinite(width)&&width>0) && Number.isFinite(total)
          && n.rows.every(row=>row.cells.reduce((count,cell)=>count+(cell.col_span || 1),0)===widths.length);
        if(useGrid){
          const group=document.createElement('colgroup');
          for(const width of widths){
            const col=document.createElement('col');
            col.style.width=(width/total*100)+'%';
            group.appendChild(col);
          }
          e.appendChild(group);
        }
        const body=document.createElement('tbody');for(let rowIndex=0;rowIndex<n.rows.length;rowIndex++){const row=n.rows[rowIndex],tr=document.createElement('tr');tr.dataset.rowId=row.id;for(const c of row.cells){if(c.merge_continue)continue;const td=document.createElement('td');td.dataset.cellId=c.id;td.colSpan=c.col_span || 1;td.rowSpan=c.row_span || 1;applyBorders(td,c.borders);if(c.shading)td.style.backgroundColor=color(c.shading);
          else if(n.style_preset==='header'&&rowIndex===0)td.style.backgroundColor='#DAE2FD';if(!useGrid && c.width_pt>0)td.style.width=c.width_pt+'pt';if(['top','center','bottom'].includes(c.vertical_align))td.style.verticalAlign=c.vertical_align==='center'?'middle':c.vertical_align;c.blocks.forEach(b=>td.appendChild(build(b)));tr.appendChild(td);}body.appendChild(tr);}e.appendChild(body);}
      else if(isNonvisualMarker(n)){
        e=document.createElement('span');
        e.hidden=true;
        e.contentEditable='false';
      }
      else{e=document.createElement('span');e.contentEditable='false';e.className='rich-opaque';if(kind==='note-reference'){e.textContent='['+n.note_id+']';e.tabIndex=0;e.setAttribute('role','button');e.dataset.noteKind=n.note_kind;e.dataset.noteId=n.note_id;}else e.textContent=kind==='field'?(n.display || '[Campo Word]'):'[Conteúdo Word preservado]'+(n.display?' '+n.display.slice(0,200):'');}
      e.dataset.nodeId=n.id;e.dataset.nodeType=kind;return e;
    }
    model.blocks.forEach(b=>surface.appendChild(build(b)));if(!surface.childNodes.length)surface.appendChild(document.createElement('p'));
  }
  function render(model,surface,mediaRequest){renderNodes(model,surface,mediaRequest);}
  function patch(model,surface,ids,mediaRequest){
    const blocks=new Map(model.blocks.map(block=>[block.id,block])), fragments=new Map();
    for(const node of surface.querySelectorAll('[data-node-id]')){
      for(const id of new Set([node.dataset.nodeId,node.dataset.fragmentOf])){
        if(!id)continue;
        if(!fragments.has(id))fragments.set(id,[]);
        fragments.get(id).push(node);
      }
    }
    for(const id of ids){const block=blocks.get(id);if(!block)continue;
      const nodes=fragments.get(id) || [];
      if(!nodes.length)continue;const temporary=document.createElement('div');renderNodes({...model,blocks:[block]},temporary,mediaRequest);
      for(const image of Array.from(temporary.querySelectorAll('img[data-node-id]'))){const oldImage=nodes.flatMap(n=>Array.from(n.querySelectorAll('img[data-node-id]'))).find(n=>n.dataset.nodeId===image.dataset.nodeId);if(oldImage)image.replaceWith(oldImage);}
      const oldMarker=nodes[0].querySelector('[data-list-marker]'),newMarker=temporary.querySelector('[data-list-marker]');if(oldMarker && newMarker)newMarker.textContent=oldMarker.textContent;
      nodes[0].replaceWith(temporary.firstChild);nodes.slice(1).forEach(n=>n.remove());
    }
  }
  function reconcile(before,after,surface,mediaRequest){
    const listStructure=blocks=>blocks.filter(b=>b.list_info).map(b=>[b.id,b.list_info]);
    if(JSON.stringify(listStructure(before?.blocks||[]))!==JSON.stringify(listStructure(after.blocks)))return false;
    const oldBlocks=new Map((before?.blocks || []).map(block=>[block.id,block]));
    const newIds=new Set(after.blocks.map(block=>block.id));
    const shared=[...oldBlocks.keys()].filter(id=>newIds.has(id));
    const ordered=after.blocks.filter(block=>oldBlocks.has(block.id));
    if(shared.some((id,index)=>id!==ordered[index].id))return false;
    const removed=new Set([...oldBlocks.keys()].filter(id=>!newIds.has(id)));
    for(const node of surface.querySelectorAll('[data-node-id]'))
      if(removed.has(node.dataset.nodeId) || removed.has(node.dataset.fragmentOf))node.remove();
    const changed=ordered.filter(block=>{
      const previous=oldBlocks.get(block.id);
      return block!==previous && JSON.stringify(block)!==JSON.stringify(previous);
    }).map(block=>block.id);
    patch(after,surface,changed,mediaRequest);
    // Index the remaining nodes once, then insert backwards using the next
    // existing anchor. Avoid repeated full DOM scans for each new paragraph.
    const nodes=new Map();
    for(const node of surface.querySelectorAll('[data-node-id]'))
      if(!nodes.has(node.dataset.nodeId))nodes.set(node.dataset.nodeId,node);
    const fallback=Array.from(surface.querySelectorAll('[data-page-content]')).pop() || surface;
    let next=null;
    for(let i=after.blocks.length-1;i>=0;i--){
      const block=after.blocks[i];
      if(oldBlocks.has(block.id)){next=nodes.get(block.id) || next;continue;}
      const temp=document.createElement('div');renderNodes({...after,blocks:[block]},temp,mediaRequest);
      const container=next?.parentNode || fallback;
      if(!container.matches('[data-page-content],[data-rich],ul,ol'))return false;
      const added=temp.firstChild;
      container.insertBefore(added,next); next=added;
    }
    return true;
  }
  window.OpenDocRichRenderer={imageGeometry,render,patch,reconcile,textStyle,paragraphStyle,color};
})();
