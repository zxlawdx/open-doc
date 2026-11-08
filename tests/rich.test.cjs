/* Exercise full app lifecycle; native Qt QA separately tests browser commands. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');const base=path.resolve(__dirname,'..');
async function setup(t){
 const html=fs.readFileSync(path.join(base,'apps/open_doc/templates/base.html'),'utf8').replace(/{{ (menus|toolbar|sidebar|editor|home) }}/g,(_,n)=>fs.readFileSync(path.join(base,'apps/open_doc/templates/'+n+'.html'),'utf8'));
 const dom=new JSDOM(html,{url:'http://localhost',runScripts:'outside-only'}),w=dom.window,root=w.document.querySelector('[data-app]');
 const paragraph=(id,rid,text,style={})=>({id,type:'paragraph',style:{},children:[{id:rid,type:'text',text,style}]});
 const content={version:'opendoc-rich-v1',blocks:[paragraph('p1','r1','Texto selecionado',{font_family:'Fonte ausente',font_size_pt:12}),{id:'table',type:'table',rows:[{id:'row',cells:[{id:'cell',col_span:1,row_span:1,blocks:[paragraph('cp','cr','Célula original')]}]}]}],styles:{},media:{},numbering:{},sections:[],headers:{},footers:{},footnotes:{},endnotes:{},metadata:{},preserved_parts:['customXml/item1.xml']};
 w.OpenDocPdf={};w.OpenDocPptxVendor={};w.OpenDocFreehand={};w.requestAnimationFrame=fn=>setTimeout(fn,0);
 const note={id:'test',title:'Rico',markdown:'Texto selecionado',revision:1,content_format:'opendoc-rich-v1',content};let saved;
 w.pywebview={api:{get_bootstrap:async()=>({token:'test',settings:{theme:'light',zoom:100},document:note,autosave_seconds:30}),get_font_catalog:async()=>({fonts:['Arial','DejaVu Serif']}),set_dirty:async()=>{}}};
 w.fetch=async(url,options)=>({ok:true,json:async()=>{const data=options.body?JSON.parse(options.body):{};if(url.endsWith('/document/save'))saved=data;return {...data,revision:2};}});
 for(const f of ['compat.js','vendor/marked.js','vendor/purify.js','vendor/turndown.js','document_model.js','rich_renderer.js','rich_serializer.js','formatting.js','tables.js','editor_commands.js','history.js','recovery.js','popovers.js','pagination.js','logical_transactions.js','page_menu.js','editor.js','pptx_renderer.js','semantic_annotations.js','slide_charts.js','native_math_parser.js','math_gallery.js','slide_editor.js','fixed_document.js','document_kinds.js','ink.js','design_system.js','menus.js','theme.js','paper_layout.js','navigation.js'])w.eval(fs.readFileSync(path.join(base,'apps/open_doc/static/js',f),'utf8'));
 w.document.execCommand=command=>{const range=w.getSelection().getRangeAt(0),span=w.document.createElement(command==='bold'?'b':'i');range.surroundContents(span);return true;};
 Object.defineProperty(w.document,'currentScript',{value:{src:'http://localhost/static/open_doc/js/app.js'}});w.eval(fs.readFileSync(path.join(base,'apps/open_doc/static/js/app.js'),'utf8'));
 for(let i=0;i<50 && root.dataset.ready!=='true';i++)await new Promise(r=>setTimeout(r,5));assert.equal(root.dataset.ready,'true');
 t.after(()=>{w.OpenDocApp.destroy();w.close();});const editor=w.OpenDocApp.editor(),rich=root.querySelector('[data-rich]');
 function select(selector='[data-node-id="p1"]'){rich.focus();const range=w.document.createRange();range.selectNodeContents(rich.querySelector(selector));w.getSelection().removeAllRanges();w.getSelection().addRange(range);editor.capture();w.document.dispatchEvent(new w.Event('selectionchange'));}
 function click(selector){const e=root.querySelector(selector);e.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true,cancelable:true}));e.click();}
 function change(selector,value){const e=root.querySelector(selector);e.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true,cancelable:true}));e.focus();e.value=value;e.dispatchEvent(new w.Event('change',{bubbles:true}));}
 return {w,root,rich,editor,select,click,change,note,saved:()=>saved};
}
test('font, size, underline, strike, colors and alignment persist through save/reopen',async t=>{
 const s=await setup(t);assert.equal(s.editor.isClean(),true);s.select();s.change('[data-font-family]','Arial');s.change('[data-font-size]','18');s.click('.toolbar [data-command=underline]');s.click('.toolbar [data-command=strike]');s.change('[data-inline-style=color]','#ff0000');s.change('[data-inline-style=highlight]','#ffff00');s.change('[data-paragraph-style=alignment]','center');
 const before=s.editor.snapshot().content,runs=before.blocks[0].children;assert.ok(runs.some(r=>r.style.font_family==='Arial' && r.style.font_size_pt===18 && r.style.underline==='single' && r.style.strike && r.style.color==='FF0000' && r.style.highlight==='FFFF00'),JSON.stringify(runs));assert.equal(before.blocks[0].style.alignment,'center');
 s.click('.toolbar [data-command=undo]');assert.notEqual(s.editor.snapshot().content.blocks[0].style.alignment,'center');s.click('.toolbar [data-command=redo]');assert.equal(s.editor.snapshot().content.blocks[0].style.alignment,'center');await s.editor.flush();assert.equal(s.editor.isClean(),true);s.editor.load({...s.note,...s.saved(),revision:2});assert.equal(JSON.stringify(s.editor.snapshot().content),JSON.stringify(before));assert.ok(s.rich.querySelector('table'));assert.equal(s.root.querySelector('[data-font-family] option[value="Fonte ausente"]').textContent,'Fonte ausente (não instalada)');
});
test('cell editing preserves table metadata and stable IDs',async t=>{const s=await setup(t);s.rich.querySelector('td span').textContent='Célula editada';s.rich.dispatchEvent(new s.w.Event('input',{bubbles:true}));const first=JSON.stringify(s.editor.snapshot().content);assert.equal(JSON.stringify(s.editor.snapshot().content),first);assert.equal(s.editor.snapshot().content.blocks[1].rows[0].cells[0].blocks[0].children[0].text,'Célula editada');assert.deepEqual(Array.from(s.editor.snapshot().content.preserved_parts),['customXml/item1.xml']);await s.editor.flush();assert.equal(s.editor.isClean(),true);});
test('rich Markdown mode remains read-only without losing typography',async t=>{const s=await setup(t),before=JSON.stringify(s.editor.snapshot().content);s.click('[data-mode=markdown]');assert.equal(s.root.querySelector('[data-source]').readOnly,true);s.w.pywebview.api.import_document=async()=>({name:'fixture.docx',document:s.note,opened:true});s.click('[data-action=import]');for(let i=0;i<20 && s.rich.hidden;i++)await new Promise(r=>setTimeout(r,5));assert.equal(s.rich.hidden,false);assert.equal(s.root.querySelector('[data-surface]').dataset.editorMode,'rich');assert.equal(JSON.stringify(s.editor.snapshot().content),before);});
test('renderer makes hostile document content inert',async t=>{const s=await setup(t),m=s.w.OpenDocModel.empty();m.blocks=[{id:'x',type:'paragraph',style:{},children:[{id:'t',type:'text',text:'<script>bad()</script>',style:{color:'url(https://evil.test)'}},{id:'o',type:'opaque-ooxml',xml:'<script>alert(1)</script>'}]}];s.w.OpenDocRichRenderer.render(m,s.rich);assert.equal(s.rich.querySelector('script'),null);assert.equal(s.rich.querySelector('img'),null);});
test('incremental serializer keeps untouched blocks; normalization merges equivalent runs',async t=>{const s=await setup(t),M=s.w.OpenDocModel,m=M.empty();m.blocks=Array.from({length:1200},(_,i)=>({id:'p-'+i,type:'paragraph',style:{},children:[{id:'r-'+i,type:'text',text:'Parágrafo '+i+' com texto de validação.',style:{}}]}));s.w.OpenDocRichRenderer.render(m,s.rich);const last=s.rich.lastElementChild;last.querySelector('span').textContent+=' Edição';const start=performance.now(),updated=s.w.OpenDocRichSerializer.serialize(s.rich,m,last);assert.equal(updated.blocks[0],m.blocks[0]);assert.notEqual(updated.blocks[1199],m.blocks[1199]);assert.ok(performance.now()-start<1500);const merged=M.normalizeRuns(Array.from({length:3000},(_,i)=>({id:'m-'+i,type:'text',text:'a',style:i%2?{bold:true,font_size_pt:12}:{font_size_pt:12,bold:true}})));assert.equal(merged.length,1);assert.equal(merged[0].text.length,3000);});

test('manual page break, blank page, undo/redo and native cancellation',async t=>{
 const s=await setup(t);s.select();s.editor.insertPage('break');let m=s.editor.snapshot().content;assert.equal(m.blocks.filter(b=>b.type==='page_break').length,1);
 s.editor.format('undo');assert.equal(s.editor.snapshot().content.blocks.filter(b=>b.type==='page_break').length,0);s.editor.format('redo');assert.equal(s.editor.snapshot().content.blocks.filter(b=>b.type==='page_break').length,1);
 s.editor.insertPage('below');assert.equal(s.editor.snapshot().content.blocks.filter(b=>b.type==='page_break').length,3);
 let args;s.w.pywebview.api.export_document=async(...values)=>{args=values;return {cancelled:true};};assert.equal((await s.editor.export('docx')).cancelled,true);assert.equal(args[2],'docx');
});
test('page setup and continuous/pages views preserve the model',async t=>{
 const s=await setup(t);s.editor.pageSetup({page_width_pt:792,page_height_pt:612,orientation:'landscape',margin_left_pt:40});
 const before=JSON.stringify(s.editor.snapshot().content);assert.equal(s.editor.snapshot().content.sections[0].page_width_pt,792);
 s.editor.pageView('continuous');assert.equal(s.root.dataset.pageMode,'continuous');s.editor.pageView('pages');assert.ok(s.rich.querySelector('[data-page-index]'));assert.equal(JSON.stringify(s.editor.snapshot().content),before);
 assert.throws(()=>s.editor.pageSetup({margin_left_pt:10000}));
});
test('literal replacement spans styled runs and supports undo',async t=>{
 const s=await setup(t),m=s.w.OpenDocModel.empty();m.blocks=[{id:'p',type:'paragraph',style:{},children:[{id:'a',type:'text',text:'Ola',style:{bold:true}},{id:'b',type:'text',text:' mundo Ola mundo',style:{italic:true}}]}];s.editor.load({...s.note,content:m});
 assert.equal(s.editor.replaceText('Ola mundo','Novo',true),2);assert.equal(s.editor.snapshot().content.blocks[0].children.map(r=>r.text).join(''),'Novo Novo');s.editor.format('undo');assert.equal(s.editor.snapshot().content.blocks[0].children.map(r=>r.text).join(''),'Ola mundo Ola mundo');
});
test('automatic overflow and table row fragments serialize as logical blocks',async t=>{
 const s=await setup(t);s.w.HTMLElement.prototype.getBoundingClientRect=function(){const height=this.matches('[data-page-content]')?Array.from(this.children).reduce((sum,n)=>sum+(n.tagName==='TABLE'?n.rows.length*55:60),0):0;return {top:0,bottom:height,height,width:600,left:0,right:600};};
 const M=s.w.OpenDocModel,m=M.empty();m.sections=[{...s.w.OpenDocPagination.defaults,page_height_pt:220,margin_top_pt:20,margin_bottom_pt:20}];m.blocks=Array.from({length:6},(_,i)=>({id:'p'+i,type:'paragraph',style:{},children:[{id:'r'+i,type:'text',text:'Paragrafo '+i,style:{}}]}));
 m.blocks.push({id:'table-long',type:'table',rows:Array.from({length:8},(_,i)=>({id:'row'+i,cells:[{id:'cell'+i,col_span:1,row_span:1,blocks:[{id:'cp'+i,type:'paragraph',style:{},children:[{id:'cr'+i,type:'text',text:'Linha '+i,style:{}}]}]}]}))});s.editor.load({...s.note,content:m});s.editor.pagination().paginate();
 assert.ok(s.rich.querySelectorAll('[data-page-index]').length>=4);const serialized=s.w.OpenDocRichSerializer.serialize(s.rich,m);assert.equal(serialized.blocks.length,7);assert.equal(serialized.blocks[6].rows.length,8);assert.equal(new Set(serialized.blocks.map(b=>b.id)).size,7);
});
test('table rows, columns, merge/split, deletion and chosen dimensions',async t=>{
 const s=await setup(t);function cell(){const td=s.rich.querySelector('td'),r=s.w.document.createRange();r.selectNodeContents(td);r.collapse(true);s.w.getSelection().removeAllRanges();s.w.getSelection().addRange(r);s.editor.capture();}
 cell();s.editor.tableOperation('row-below');assert.equal(s.editor.snapshot().content.blocks[1].rows.length,2);
 cell();s.editor.tableOperation('column-right');assert.equal(s.rich.querySelector('tr').cells.length,2);
 cell();s.editor.tableOperation('merge');assert.equal(s.rich.querySelector('td').colSpan,2);
 cell();s.editor.tableOperation('split');assert.equal(s.rich.querySelector('tr').cells.length,2);
 cell();s.editor.tableOperation('delete-column');assert.equal(s.rich.querySelector('tr').cells.length,1);
 cell();s.editor.tableOperation('delete-row');assert.equal(s.rich.querySelector('table').rows.length,1);
 cell();s.editor.tableOperation('delete-table');assert.equal(s.editor.snapshot().content.blocks.filter(b=>b.type==='table').length,0);
 s.select();s.editor.tableOperation('insert',3,4);assert.equal(s.rich.querySelector('table').rows.length,3);assert.equal(s.rich.querySelector('tr').cells.length,4);
});

test('page position stays numeric after selectionchange',async t=>{const s=await setup(t);s.editor.pagination().paginate();s.w.document.dispatchEvent(new s.w.Event('selectionchange'));assert.match(s.root.querySelector('[data-position]').textContent,/^Página \d+ de \d+$/);});

test('rich ink survives history/save/reopen and reviewed text becomes a native styled run',async t=>{
 const s=await setup(t),layer={surface_index:0,width_pt:595,height_pt:842,anchor_block_id:'p1',strokes:[{id:'ink1',tool:'pen',color:'#102030',size:2,opacity:1,points:[{x:.1,y:.2,pressure:.7}],outline:[[.1,.2],[.11,.2],[.11,.21]],handwriting:true}],text_overlays:[]};
 s.editor.setInkLayers([layer]);assert.equal(s.editor.inkLayers()[0].strokes.length,1);s.editor.format('undo');assert.equal(s.editor.inkLayers().length,0);s.editor.format('redo');assert.equal(s.editor.inkLayers()[0].strokes.length,1);
 s.editor.insertRecognized('Minha escrita',{font_family:'Arial',font_size_pt:18,color:'#102030'},0,['ink1']);assert.equal(s.editor.inkLayers()[0].strokes.length,0);const run=s.editor.snapshot().content.blocks[1].children[0];assert.equal(run.text,'Minha escrita');assert.equal(run.style.font_family,'Arial');assert.equal(run.style.font_size_pt,18);
 await s.editor.flush();assert.equal(s.saved().content.blocks[1].children[0].style.font_family,'Arial');s.editor.load({...s.editor.snapshot(),revision:3});assert.equal(s.editor.snapshot().content.blocks[1].children[0].text,'Minha escrita');
});

test('ink commits and undo do not render text, paginate or replace page nodes',async t=>{
 const s=await setup(t);delete s.w.structuredClone;await new Promise(r=>setTimeout(r,150));let renders=0,layouts=0;const original=s.w.OpenDocRichRenderer.render;s.w.OpenDocRichRenderer.render=(...args)=>{if(args[1]===s.rich)renders++;return original(...args);};s.root.addEventListener('open-doc:layout',()=>layouts++);const page=s.rich.querySelector('[data-page-index]'),paragraph=s.rich.querySelector('[data-node-id=p1]');
 for(let i=0;i<20;i++){const layers=JSON.parse(JSON.stringify(s.editor.inkLayers()));if(!layers.length)layers.push({surface_index:0,width_pt:595,height_pt:842,strokes:[],text_overlays:[]});layers[0].strokes.push({id:'stroke'+i,tool:'pen',color:'#000000',size:2,opacity:1,points:[{x:.1,y:.2}],outline:[[.1,.2],[.11,.2],[.11,.21]]});s.editor.setInkLayers(layers);}
 s.editor.format('undo');s.editor.format('redo');await s.editor.flush();await new Promise(r=>setTimeout(r,180));assert.equal(renders,0);assert.equal(layouts,0);assert.equal(s.rich.querySelector('[data-node-id=p1]'),paragraph);assert.equal(s.rich.querySelector('[data-page-index]'),page);assert.equal(s.saved().content.ink_layers[0].strokes.length,20);
});

test('typing undo patches one paragraph and keeps unrelated nodes and scroll',async t=>{
 const s=await setup(t);await new Promise(r=>setTimeout(r,150));const table=s.rich.querySelector('table'),p=s.rich.querySelector('[data-node-id=p1]'),canvas=s.root.querySelector('[data-canvas]');let renders=0;const original=s.w.OpenDocRichRenderer.render;s.w.OpenDocRichRenderer.render=(...args)=>{if(args[1]===s.rich)renders++;return original(...args);};s.select();p.append('x');p.dispatchEvent(new s.w.Event('input',{bubbles:true}));canvas.scrollTop=1000;s.editor.format('undo');assert.equal(renders,0);assert.equal(s.rich.querySelector('table'),table);assert.equal(canvas.scrollTop,1000);assert.equal(s.rich.querySelector('[data-node-id=p1]').textContent,'Texto selecionado');s.editor.format('redo');assert.ok(s.rich.querySelector('[data-node-id=p1]').textContent.endsWith('x'));
});

test('list typing undo preserves numbering without a full render',async t=>{const s=await setup(t),note=JSON.parse(JSON.stringify(s.note));note.content.blocks[0].list_info={num_id:'list',format:'decimal',level:0,start:7};s.editor.load(note);await new Promise(r=>setTimeout(r,150));s.select();const p=s.rich.querySelector('[data-node-id=p1]'),marker=p.querySelector('[data-list-marker]').textContent;let renders=0;const render=s.w.OpenDocRichRenderer.render;s.w.OpenDocRichRenderer.render=(...a)=>{if(a[1]===s.rich)renders++;return render(...a);};p.append('x');p.dispatchEvent(new s.w.Event('input',{bubbles:true}));s.editor.format('undo');assert.equal(renders,0);assert.equal(s.rich.querySelector('[data-list-marker]').textContent,marker);});

test('keyboard_first_input_new_document survives serializer and idle pagination',async t=>{const s=await setup(t);s.editor.load({...s.note,markdown:'',content:null});s.editor.pagination().paginate();const box=s.rich.querySelector('[data-page-content]');box.replaceChildren(s.w.document.createTextNode('Open Doc teclado 123'));const range=s.w.document.createRange();range.selectNodeContents(box);range.collapse(false);s.w.getSelection().removeAllRanges();s.w.getSelection().addRange(range);s.rich.dispatchEvent(new s.w.InputEvent('input',{bubbles:true,inputType:'insertText',data:'Open Doc teclado 123'}));assert.ok(s.editor.snapshot().content.blocks.some(b=>JSON.stringify(b).includes('Open Doc teclado 123')));await new Promise(r=>setTimeout(r,650));assert.match(s.rich.textContent,/Open Doc teclado 123/);await s.editor.flush();s.editor.load({...s.note,...s.saved(),revision:3});assert.match(s.rich.textContent,/Open Doc teclado 123/);});
test('keyboard_fragmented_paragraph fast serializer clones only the affected logical block',async t=>{const s=await setup(t);s.editor.pagination().paginate();const p=s.rich.querySelector('[data-node-id=p1]'),page=s.w.document.createElement('section'),box=s.w.document.createElement('div');page.dataset.pageIndex=1;box.dataset.pageContent='';const fragment=p.cloneNode(false);fragment.dataset.fragmentOf='p1';fragment.textContent=' persistente áéíóú ç.';box.append(fragment);page.append(box);s.rich.append(page);const table=s.rich.querySelector('table');table.cloneNode=()=>{throw Error('Unrelated table cloned');};const m=s.w.OpenDocRichSerializer.serializeLogicalBlock(s.rich,'p1',s.editor.snapshot().content);assert.match(m.blocks[0].children.map(r=>r.text).join(''),/persistente áéíóú ç/);assert.equal(m.blocks[1],s.editor.snapshot().content.blocks[1]);});
test('undo_complex_doc_table_incremental preserves unrelated paragraphs and image nodes',async t=>{const s=await setup(t);s.editor.pagination().paginate();const p=s.rich.querySelector('[data-node-id=p1]');let full=0;const render=s.w.OpenDocRichRenderer.render;s.w.OpenDocRichRenderer.render=(...a)=>{if(a[1]===s.rich)full++;return render(...a);};s.select('td p');s.rich.querySelector('td span').textContent='Célula persistente';s.rich.dispatchEvent(new s.w.InputEvent('input',{bubbles:true,inputType:'insertText'}));assert.match(JSON.stringify(s.editor.snapshot().content),/Célula persistente/);s.editor.format('undo');assert.match(s.rich.querySelector('table').textContent,/Célula original/);assert.equal(s.rich.querySelector('[data-node-id=p1]'),p);assert.equal(full,0);});
test('composition defers pagination mutations until committed',async t=>{const s=await setup(t);s.editor.pagination().paginate();let layouts=0;s.root.addEventListener('open-doc:layout',()=>layouts++);s.rich.dispatchEvent(new s.w.CompositionEvent('compositionstart',{bubbles:true}));s.root.dispatchEvent(new s.w.CustomEvent('open-doc:text-layout-changed',{detail:{blockId:'p1',reason:'typing'}}));await new Promise(r=>setTimeout(r,600));assert.equal(layouts,0);s.rich.dispatchEvent(new s.w.CompositionEvent('compositionend',{bubbles:true}));await new Promise(r=>setTimeout(r,600));assert.ok(layouts>=1);});

test('keyboard_text_survives_inflight_save_response',async t=>{const s=await setup(t);s.editor.pagination().paginate();s.select();s.rich.querySelector('[data-node-id=r1]').textContent='save A';s.rich.dispatchEvent(new s.w.InputEvent('input',{bubbles:true,inputType:'insertText'}));let release,started=false;const original=s.w.fetch;s.w.fetch=async(url,options)=>{if(url.endsWith('/document/save') && !started){started=true;await new Promise(r=>release=r);}return original(url,options);};const saving=s.editor.flush();for(let i=0;i<20&&!started;i++)await new Promise(r=>setTimeout(r,5));s.rich.querySelector('[data-node-id=r1]').textContent='save AB';s.rich.dispatchEvent(new s.w.InputEvent('input',{bubbles:true,inputType:'insertText'}));release();await saving;assert.match(s.rich.textContent,/save AB/);assert.match(JSON.stringify(s.saved().content),/save AB/);});

test('local Backspace keeps the paginated block serializer fast path',async t=>{const s=await setup(t);s.editor.pagination().paginate();s.select();s.w.Range.prototype.cloneContents=()=>{throw Error('Bookmark cloned the document prefix');};s.rich.dispatchEvent(new s.w.InputEvent('beforeinput',{bubbles:true,inputType:'deleteContentBackward'}));s.rich.querySelector('table').cloneNode=()=>{throw Error('Backspace cloned an unrelated table');};s.rich.querySelector('[data-node-id=r1]').textContent='Texto selecionad';s.rich.dispatchEvent(new s.w.InputEvent('input',{bubbles:true,inputType:'deleteContentBackward'}));assert.equal(s.editor.snapshot().content.blocks[0].children.map(r=>r.text).join(''),'Texto selecionad');});

test('native paragraph split IDs cannot collide with untouched blocks on the next input',async t=>{const s=await setup(t);s.editor.pagination().paginate();const first=s.rich.querySelector('[data-node-id=p1]'),second=first.cloneNode(true);second.dataset.nodeId='split-p';first.parentNode.insertBefore(second,first.nextSibling);const structural=s.w.OpenDocRichSerializer.serialize(s.rich,s.editor.snapshot().content,null,['p1','split-p']);assert.equal(second.querySelector('[data-node-type=text]').dataset.nodeId,'r1');second.querySelector('[data-node-type=text]').textContent='Nova linha persistente';const next=s.w.OpenDocRichSerializer.serializeLogicalBlock(s.rich,'split-p',structural),ids=[];function visit(n){if(!n||typeof n!=='object')return;if(n.id)ids.push(n.id);for(const v of Object.values(n))if(Array.isArray(v))v.forEach(visit);}next.blocks.forEach(visit);assert.equal(new Set(ids).size,ids.length);assert.equal(next.blocks[0],structural.blocks[0]);assert.equal(next.blocks[0].children[0].id,'r1');assert.match(JSON.stringify(next.blocks[1]),/Nova linha persistente/);});


test('equation insertion replaces the captured selection without moving to document start',async t=>{
 const s=await setup(t);
 s.select('[data-node-id="p1"]');
 const original=s.editor.snapshot().content.blocks[0].children[0].text;
 assert.equal(original,'Texto selecionado');
 const originalCmd=s.w.document.execCommand;
 s.w.document.execCommand=(command,show,value)=>{
   if(command!=='insertText')return originalCmd(command,show,value);
   const selection=s.w.getSelection(),range=selection.getRangeAt(0);
   range.deleteContents();
   const inserted=s.w.document.createTextNode(value);
   range.insertNode(inserted);range.setStartAfter(inserted);range.collapse(true);
   selection.removeAllRanges();selection.addRange(range);
   return true;
 };
 const count=s.editor.snapshot().content.blocks.length;
 assert.equal(s.editor.insertPlainText('E = mc²'),true);
 const next=s.editor.snapshot().content;
 assert.equal(next.blocks.length,count);
 assert.equal(next.blocks[0].children.map(r=>r.text).join(''),'E = mc²');
 assert.equal(next.blocks[1].type,'table','insertion should not alter unrelated table');
 s.editor.format('undo');
 assert.equal(s.editor.snapshot().content.blocks[0].children[0].text,original);
});

test('long runs of blank Enter breaks paginate rather than overflowing one sheet',async t=>{
 const s=await setup(t);
 s.editor.pagination().paginate();
 const box=s.rich.querySelector('[data-page-content]');
 box.replaceChildren();
 const paragraph=s.w.document.createElement('p');
 paragraph.dataset.nodeId='long-empty-paragraph';
 for(let n=0;n<90;n++)paragraph.append(s.w.document.createElement('br'));
 box.append(paragraph);
 const measure=s.w.HTMLElement.prototype.getBoundingClientRect;
 s.w.HTMLElement.prototype.getBoundingClientRect=function(){
   if(this.matches('[data-page-content]')){
     const height=Array.from(this.children).reduce((total,node)=>
       total+Math.max(1,node.querySelectorAll('br').length)*32,0);
     return {top:0,bottom:height,left:0,right:600,height,width:600};
   }
   return measure.call(this);
 };
 s.editor.pagination().setMode('pages');
 const pages=Array.from(s.rich.querySelectorAll('[data-page-index]'));
 assert.ok(pages.length>=3,'blank lines must create additional pages');
 assert.equal(pages.reduce((total,node)=>total+node.querySelectorAll('[data-page-content] br').length,0),90,
   'pagination must not lose blank lines');
});

test('1000 empty line breaks reflow with bounded height measurements and no data loss',async t=>{
 const s=await setup(t);
 s.editor.pagination().paginate();
 const box=s.rich.querySelector('[data-page-content]');
 box.replaceChildren();
 const paragraph=s.w.document.createElement('p');
 paragraph.dataset.nodeId='stress-enter';
 for(let n=0;n<1000;n++)paragraph.append(s.w.document.createElement('br'));
 box.append(paragraph);
 const original=s.w.HTMLElement.prototype.getBoundingClientRect;
 let measurements=0;
 s.w.HTMLElement.prototype.getBoundingClientRect=function(){
   if(this.matches('[data-page-content]')){
     measurements++;
     const height=Array.from(this.children).reduce((sum,node)=>
       sum+Math.max(1,node.querySelectorAll('br').length)*32,0);
     return {top:0,bottom:height,left:0,right:600,height,width:600};
   }
   return original.call(this);
 };
 const start=Date.now();
 s.editor.pagination().setMode('pages');
 const pages=Array.from(s.rich.querySelectorAll('[data-page-index]'));
 const total=pages.reduce((n,node)=>n+node.querySelectorAll('[data-page-content] br').length,0);
 assert.equal(total,1000,'no empty input lines are discarded');
 assert.ok(pages.length>5,'oversized input must spill to additional pages');
 assert.ok(measurements<850,'height reflows must not be linear in BR count per page');
 assert.ok(Date.now()-start<7000,'regression must not enter a long main-thread loop');
});

const tabText='Texto selecionado';

function pressTab(w,target,options={}){
 return target.dispatchEvent(new w.KeyboardEvent('keydown',
   {key:'Tab',bubbles:true,cancelable:true,...options}));
}

function tabRuns(editor){
 const runs=editor.snapshot().content.blocks[0].children;
 return runs.map(run=>run.type==='tab'?'\t':run.text).join('');
}

for(const offset of [0,5,tabText.length]){
 test('repeated Tab preserves styled paragraph text at offset '+offset,async t=>{
   const s=await setup(t),{w,rich,editor}=s;
   const selection=w.getSelection();
   s.select();
   selection.collapse(rich.querySelector('[data-node-id="r1"]').firstChild,offset);
   w.document.execCommand=()=>assert.fail('Tab must not replace a browser selection');
   const expected=count=>tabText.slice(0,offset)+'\t'.repeat(count)+tabText.slice(offset);
   for(let count=1;count<=3;count++){
     assert.equal(pressTab(w,rich),false);
     assert.equal(w.document.activeElement,rich);
     assert.equal(selection.isCollapsed,true);
     assert.equal(tabRuns(editor),expected(count));
   }
   const runs=editor.snapshot().content.blocks[0].children;
   assert.ok(runs.filter(run=>run.type==='text').every(run=>run.style.font_family==='Fonte ausente'));
   editor.format('undo');
   assert.equal(tabRuns(editor),expected(2));
   editor.format('redo');
   assert.equal(tabRuns(editor),expected(3));
   editor.pagination().paginate();
   assert.equal(pressTab(w,rich),false);
   assert.equal(tabRuns(editor),expected(4));
   await editor.flush();
   editor.load({...s.note,...s.saved()});
   assert.equal(tabRuns(editor),expected(4));
   assert.equal(rich.querySelectorAll('[data-node-type="tab"]').length,4);
 });
}

for(const [anchor,focus] of [[0,5],[5,0]]){
 test('Tab preserves a selected word with anchor at '+anchor,async t=>{
   const s=await setup(t),{w,rich,editor}=s;
   s.select();
   const text=rich.querySelector('[data-node-id="r1"]').firstChild;
   w.getSelection().setBaseAndExtent(text,anchor,text,focus);
   assert.equal(pressTab(w,rich),false);
   assert.equal(pressTab(w,rich),false);
   assert.equal(tabRuns(editor),'\t\t'+tabText);
 });
}

test('Tab works in a browser-created DIV paragraph before repagination',async t=>{
 const s=await setup(t),{w,rich,editor}=s;
 const paragraph=rich.querySelector('[data-node-id="p1"]');
 const block=w.document.createElement('div');
 block.dataset.nodeId='p1';
 block.append(...paragraph.childNodes);
 paragraph.replaceWith(block);
 rich.focus();
 w.getSelection().collapse(block,0);
 assert.equal(pressTab(w,rich),false);
 assert.equal(pressTab(w,rich),false);
 assert.equal(tabRuns(editor),'\t\t'+tabText);
});

test('Tab on a blank paragraph preserves the caret without creating a line break',async t=>{
 const s=await setup(t),{w,rich,editor}=s;
 const note=JSON.parse(JSON.stringify(s.note));
 note.content.blocks[0].children=[];
 editor.load(note);
 s.select();
 w.getSelection().collapseToStart();
 assert.equal(pressTab(w,rich),false);
 assert.equal(pressTab(w,rich),false);
 assert.equal(tabRuns(editor),'\t\t');
 assert.deepEqual(Array.from(editor.snapshot().content.blocks[0].children,run=>run.type),['tab','tab']);
});

test('Tab keeps navigation in tables and outside editable paragraphs',async t=>{
 const s=await setup(t),{w,root,rich,editor}=s;
 const note=JSON.parse(JSON.stringify(s.note));
 const second=note.content.blocks[1].rows[0].cells[0];
 note.content.blocks[1].rows[0].cells.push({
   ...second,id:'cell2',blocks:[{...second.blocks[0],id:'cp2',children:[]}]
 });
 editor.load(note);
 s.select();
 const selection=w.getSelection();
 selection.collapseToStart();
 for(const options of [{shiftKey:true},{ctrlKey:true},{altKey:true},{metaKey:true},{isComposing:true}]){
   assert.equal(pressTab(w,rich,options),true);
 }
 assert.equal(tabRuns(editor),tabText);
 const button=root.querySelector('.toolbar button');
 button.focus();
 assert.equal(pressTab(w,button),true);
 s.select('td');
 const cells=rich.querySelectorAll('td');
 assert.equal(pressTab(w,rich),false);
 assert.ok(cells[1].contains(selection.anchorNode));
 assert.equal(pressTab(w,rich,{shiftKey:true}),false);
 assert.ok(cells[0].contains(selection.anchorNode));
 assert.equal(rich.querySelectorAll('[data-node-type="tab"]').length,0);
});

test('Ctrl+Z and redo retain recent ink history when the existing page is large',async t=>{
 const q=await setup(t);
 const outline=Array.from({length:35000},(_,i)=>[i/35001,(i%997)/997]);
 const base={id:'existing-ink',tool:'pen',color:'#222222',size:2,opacity:1,points:[],outline};
 const existing={surface_index:0,width_pt:595,height_pt:842,strokes:[base],text_overlays:[]};
 q.editor.load({...q.note,content:{...q.note.content,ink_layers:[existing]}});
 q.root.dataset.inkMode='pen';
 const baseline=q.editor.inkLayers()[0];
 const fingerprint=q.w.OpenDocModel.fingerprint;
 let fullModels=0;
 q.w.OpenDocModel.fingerprint=model=>{
   if(model.ink_layers)fullModels++;
   return fingerprint(model);
 };
 for(let i=0;i<18;i++){
   const layer=q.editor.inkLayers()[0];
   const stroke={...base,id:'stroke'+i,outline:[[.1,.1],[.11,.1],[.11,.11]]};
   q.editor.setInkLayers([{...layer,strokes:[...layer.strokes,stroke]}]);
 }
 assert.equal(fullModels,0,'pen-up does not serialize the accumulated page');
 function shortcut(key,shiftKey=false){
   const event=new q.w.KeyboardEvent('keydown',{key,ctrlKey:true,shiftKey,cancelable:true,bubbles:true});
   q.w.document.body.dispatchEvent(event);
   assert.equal(event.defaultPrevented,true);
 }
 for(let i=0;i<18;i++)shortcut('z');
 assert.equal(q.editor.inkLayers()[0],baseline);
 for(let i=0;i<18;i++)shortcut('z',true);
 assert.equal(q.editor.inkLayers()[0].strokes.length,19);
 assert.equal(q.editor.inkLayers()[0].strokes[0],baseline.strokes[0]);
});

test('DOCX list uses the same marker and indent through text undo and redo',async t=>{
 const q=await setup(t);
 const place=()=>{
   const run=q.rich.querySelector('[data-node-id=p1] span[data-node-type=text]');
   const selection=q.w.getSelection();selection.collapse(run.firstChild,run.textContent.length);
   q.editor.capture();
 };
 place();q.editor.format('list');
 const marker=()=>q.rich.querySelector('[data-node-id=p1] [data-list-marker]');
 const layout=()=>[marker().textContent,marker().parentElement.style.paddingLeft];
 const before=layout();assert.equal(before[0],'•');assert.ok(before[1]);
 place();
 const run=q.rich.querySelector('[data-node-id=p1] span[data-node-type=text]');
 run.firstChild.appendData(' mais');
 q.rich.dispatchEvent(new q.w.InputEvent('input',{bubbles:true,inputType:'insertText',data:' mais'}));
 q.editor.format('undo');assert.deepEqual(layout(),before);
 q.editor.format('redo');assert.deepEqual(layout(),before);
 assert.match(q.rich.querySelector('[data-node-id=p1]').textContent,/mais/);
 q.editor.format('undo');q.editor.format('undo');
 assert.equal(marker(),null);
 q.editor.format('redo');assert.deepEqual(layout(),before);
});

test('caret-only font changes format new typing without restyling existing text',async t=>{
 const q=await setup(t),text=q.rich.querySelector('[data-node-id=r1]').firstChild;
 q.rich.focus();q.w.getSelection().collapse(text,0);q.editor.capture();
 q.change('[data-font-family]','Arial');
 const input=data=>q.rich.dispatchEvent(new q.w.InputEvent('beforeinput',{
   bubbles:true,cancelable:true,inputType:'insertText',data
 }));
 assert.equal(input('A'),false);assert.equal(input('B'),false);
 const runs=q.editor.snapshot().content.blocks[0].children;
 assert.equal(runs[0].text,'AB');assert.equal(runs[0].style.font_family,'Arial');
 assert.equal(runs[1].text,'Texto selecionado');
 assert.equal(runs[1].style.font_family,'Fonte ausente');
 await q.editor.flush();
 assert.equal(q.saved().content.blocks[0].children[0].style.font_family,'Arial');
});

test('Tab inside a heading stays in that heading after undo and redo',async t=>{
 const q=await setup(t),note=JSON.parse(JSON.stringify(q.note));
 note.content.blocks[0].style.outline_level=0;q.editor.load(note);q.editor.pagination().paginate();
 const heading=()=>q.rich.querySelector('h1[data-node-id=p1]');
 const selection=q.w.getSelection();
 q.rich.focus();selection.collapse(heading().querySelector('span').firstChild,5);
 const tab=()=>{
   const event=new q.w.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true});
   q.rich.dispatchEvent(event);assert.equal(event.defaultPrevented,true);
 };
 tab();q.editor.format('undo');q.editor.format('redo');tab();
 assert.equal(heading().querySelectorAll('[data-node-type=tab]').length,2);
 assert.equal(heading().textContent,'Texto\t\t selecionado');
 assert.ok(heading().contains(selection.anchorNode));
 assert.equal(q.editor.snapshot().content.blocks[0].style.outline_level,0);
});

test('font changes keep text and selection across page fragments of one paragraph',async t=>{
 const q=await setup(t);
 q.editor.pagination().paginate();
 const first=q.rich.querySelector('[data-node-id=p1]');
 first.querySelector('[data-node-id=r1]').textContent='Texto ';
 const secondPage=first.closest('.document-page').cloneNode(false);
 secondPage.dataset.pageIndex='1';
 const content=q.w.document.createElement('div');content.dataset.pageContent='';
 secondPage.append(content);
 const second=first.cloneNode(true);second.dataset.fragmentOf='p1';
 second.querySelector('[data-node-id=r1]').textContent='selecionado';
 content.append(second);
 content.append(q.rich.querySelector("[data-node-id=table]"));
 first.closest('.document-page').after(secondPage);

 const start=first.querySelector('span').firstChild,end=second.querySelector('span').firstChild;
 const range=q.w.document.createRange();range.setStart(start,2);range.setEnd(end,5);
 const selection=q.w.getSelection();q.rich.focus();selection.removeAllRanges();selection.addRange(range);
 q.editor.capture();
 const chosen=selection.toString();
 q.change('[data-font-family]','Arial');
 const runs=()=>q.editor.snapshot().content.blocks[0].children;
 const text=()=>runs().map(run=>run.text).join('');
 assert.equal(text(),'Texto selecionado');
 assert.equal(selection.toString(),chosen);
 assert.equal(runs().filter(run=>run.style.font_family==='Arial').map(run=>run.text).join(''),chosen);
 assert.equal(q.rich.querySelector('[data-node-id=table]').textContent,'Célula original');
 q.editor.format('undo');
 assert.equal(text(),'Texto selecionado');
 q.editor.format('redo');
 assert.equal(text(),'Texto selecionado');
 await q.editor.flush();
 assert.equal(q.saved().content.blocks[0].children.map(run=>run.text).join(''),'Texto selecionado');
});

test('Ctrl+B and Ctrl+I turn typing styles on and off and update the toolbar',async t=>{
 const q=await setup(t);
 const text=q.rich.querySelector('[data-node-id=r1]').firstChild;
 q.rich.focus();q.w.getSelection().collapse(text,0);q.editor.capture();
 const key=name=>q.rich.dispatchEvent(new q.w.KeyboardEvent('keydown',{
   key:name,ctrlKey:true,bubbles:true,cancelable:true
 }));
 const pressed=name=>q.root.querySelector('.toolbar [data-command='+name+']').getAttribute('aria-pressed');
 const type=data=>q.rich.dispatchEvent(new q.w.InputEvent('beforeinput',{
   bubbles:true,cancelable:true,inputType:'insertText',data
 }));
 assert.equal(key('b'),false);assert.equal(pressed('bold'),'true');
 type('A');
 assert.equal(key('b'),false);assert.equal(pressed('bold'),'false');
 assert.equal(key('i'),false);assert.equal(pressed('italic'),'true');
 type('B');
 assert.equal(key('i'),false);assert.equal(pressed('italic'),'false');
 type('C');
 const runs=q.editor.snapshot().content.blocks[0].children;
 assert.equal(runs[0].text,'A');assert.equal(runs[0].style.bold,true);
 assert.equal(runs[1].text,'B');assert.equal(runs[1].style.bold,false);assert.equal(runs[1].style.italic,true);
 assert.equal(runs[2].text,'C');assert.equal(runs[2].style.italic,false);
});

test('all six inline buttons toggle selected text and leave the wording intact',async t=>{
 const q=await setup(t);
 const buttons=['bold','italic','underline','strike','superscript','subscript'];
 for(const name of buttons){
   q.select();
   const selector='.toolbar [data-command='+name+']';
   const button=q.root.querySelector(selector);
   q.click(selector);assert.equal(button.getAttribute('aria-pressed'),'true',name);
   q.click(selector);assert.equal(button.getAttribute('aria-pressed'),'false',name);
   const runs=q.editor.snapshot().content.blocks[0].children;
   assert.equal(runs.map(run=>run.text).join(''),'Texto selecionado');
   const style=runs[0].style;
   if(name==='superscript'||name==='subscript')assert.equal(style.vertical_align,'baseline');
   else if(name==='underline')assert.equal(style.underline,'none');
   else assert.equal(style[name],false);
 }
});
