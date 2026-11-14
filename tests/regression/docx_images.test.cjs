const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');const base=path.resolve(__dirname,'../..');
const url='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
async function setup(t){
 const html=fs.readFileSync(path.join(base,'apps/home/templates/base.html'),'utf8').replace(/{{ (menus|toolbar|sidebar|editor|home|workbook|data) }}/g,(_,n)=>fs.readFileSync(require('./template_path.cjs')(n),'utf8'));
 const dom=new JSDOM(html,{url:'http://localhost',runScripts:'outside-only'}),w=dom.window,root=w.document.querySelector('[data-app]');
 w.HTMLCanvasElement.prototype.getContext=()=>({});w.IntersectionObserver=class{observe(){}disconnect(){}};
 for(const f of ['compat.js','vendor/marked.js','vendor/purify.js','vendor/turndown.js','document_model.js','rich_renderer.js','rich_serializer.js','formatting.js','tables.js','editor_commands.js','history.js','recovery.js','pagination.js','logical_transactions.js','editor.js'])w.eval(fs.readFileSync(require('./asset_path.cjs')(f),'utf8'));
 const model=w.OpenDocModel.empty();model.blocks=[{id:'p1',type:'paragraph',style:{},children:[{id:'text1',type:'text',text:'Texto que deve permanecer.',style:{}}]}];
 const note={id:'document-1',title:'Teste',revision:1,markdown:'Texto que deve permanecer.',content:model,content_format:model.version};
 let saved,resolveUpload,delayed=false;const requests=[];
 const request=async(route,data)=>{requests.push({route,data});if(route==='document/image-asset'){
   if(delayed)await new Promise(resolve=>{resolveUpload=resolve;});
   return {node:{id:'image-'+requests.length,type:'image',media_id:'a'.repeat(64),width_pt:120,height_pt:80,placement:'floating',x_pt:72,y_pt:72,alt_text:data.alt_text,geometry_edited:true},media:{part:'word/media/new.png',size:68},url};}
   if(route==='document/media')return {url};if(route==='document/save'){saved=JSON.parse(JSON.stringify(data));return {...data,revision:data.revision+1};}return {};};
 const editor=w.OpenDocEditor.create({root,request,status:()=>{},autosaveSeconds:3600,document:note});
 const rich=root.querySelector('[data-rich]');
 t.after(()=>{editor.destroy();w.close();});
 function select(){rich.focus();const range=w.document.createRange();range.selectNodeContents(rich.querySelector('[data-node-id=text1]'));w.getSelection().removeAllRanges();w.getSelection().addRange(range);editor.capture();}
 function picture(){return rich.querySelector('.rich-image');}
 function geometry(){return editor.snapshot().content.blocks.flatMap(b=>b.children||[]).filter(n=>n.type==='image');}
 function mockBounds(){const page=picture().closest('[data-page-index]')||rich;
   const scale=.75;page.getBoundingClientRect=()=>({left:100,top:40,width:595.28/scale,height:841.89/scale});
   picture().getBoundingClientRect=()=>{const node=JSON.parse(picture().dataset.imageNode);return {left:100+node.x_pt/scale,top:40+node.y_pt/scale,width:node.width_pt/scale,height:node.height_pt/scale};};}
 function pointer(target,type,x,y){const event=new w.MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:x,clientY:y});Object.defineProperty(event,'pointerId',{value:1});target.dispatchEvent(event);}
 function key(key,shiftKey=false){picture().dispatchEvent(new w.KeyboardEvent('keydown',{bubbles:true,cancelable:true,key,shiftKey}));}
 return {w,root,rich,editor,note,select,picture,geometry,mockBounds,pointer,key,saved:()=>saved,
   delayUpload:()=>{delayed=true;},resolveUpload:()=>resolveUpload()};
}
test('DOCX picture insertion keeps selected text; undo/redo and save/reopen retain native geometry',async t=>{
 const s=await setup(t);s.select();assert.equal(await s.editor.insertImage(url,'Cerâmica'),true);
 assert.equal(s.rich.textContent,'Texto que deve permanecer.');assert.equal(s.geometry().length,1);
 const before=JSON.stringify(s.editor.snapshot().content);s.editor.format('undo');assert.equal(s.geometry().length,0);
 s.editor.format('redo');assert.equal(JSON.stringify(s.editor.snapshot().content),before);
 await s.editor.flush();s.editor.load({...s.saved(),revision:2});assert.equal(JSON.stringify(s.editor.snapshot().content),before);
 assert.equal(s.picture().querySelector('img').alt,'Cerâmica');
});
test('drag at zoom is one undo operation and clamps within the physical page',async t=>{
 const s=await setup(t);s.select();await s.editor.insertImage(url);s.mockBounds();const before=JSON.stringify(s.geometry());
 s.pointer(s.picture(),'pointerdown',200,200);
 for(let i=0;i<10;i++)s.pointer(s.picture(),'pointermove',200+i*30,200+i*20);
 s.pointer(s.picture(),'pointerup',470,380);
 const after=JSON.stringify(s.geometry());assert.notEqual(after,before);s.editor.format('undo');assert.equal(JSON.stringify(s.geometry()),before);
 s.editor.format('redo');assert.equal(JSON.stringify(s.geometry()),after);s.mockBounds();
 s.pointer(s.picture(),'pointerdown',200,200);s.pointer(s.picture(),'pointermove',10000,10000);s.pointer(s.picture(),'pointerup',10000,10000);
 const node=s.geometry()[0];assert.ok(node.x_pt+node.width_pt<=595.28+.001);assert.ok(node.y_pt+node.height_pt<=841.89+.001);
});
test('resize preserves aspect ratio; cancelled gesture has no history entry; Delete is reversible',async t=>{
 const s=await setup(t);s.select();await s.editor.insertImage(url);s.mockBounds();const before=JSON.stringify(s.geometry());
 s.pointer(s.picture(),'pointerdown',200,200);s.pointer(s.picture(),'pointermove',300,300);s.pointer(s.picture(),'pointercancel',300,300);
 assert.equal(JSON.stringify(s.geometry()),before);
 const handle=s.picture().querySelector('[data-image-resize]');s.pointer(handle,'pointerdown',200,200);
 s.pointer(s.picture(),'pointermove',280,240);s.pointer(s.picture(),'pointerup',280,240);
 assert.equal(s.geometry()[0].width_pt/s.geometry()[0].height_pt,1.5);
 assert.ok(s.geometry()[0].width_pt>120);s.key('Delete');assert.equal(s.geometry().length,0);
 s.editor.format('undo');assert.equal(s.geometry().length,1);assert.equal(s.rich.textContent,'Texto que deve permanecer.');
});
test('keyboard nudges and Shift movement preserve the picture dimensions',async t=>{
 const s=await setup(t);s.select();await s.editor.insertImage(url);s.mockBounds();const x=s.geometry()[0].x_pt;
 s.key('ArrowRight');assert.equal(s.geometry()[0].x_pt,x+1);s.key('ArrowRight',true);assert.equal(s.geometry()[0].x_pt,x+11);
 assert.equal(s.geometry()[0].width_pt,120);
});
test('pending image upload cannot insert into a different document',async t=>{
 const s=await setup(t);s.select();s.delayUpload();const operation=s.editor.insertImage(url);
 s.editor.load({...s.note,id:'other-document'});s.resolveUpload();assert.equal(await operation,false);assert.equal(s.geometry().length,0);
});

test('an image can move between pages and undo restores its original text anchor',async t=>{
 const s=await setup(t);
 const content=JSON.parse(JSON.stringify(s.note.content));
 content.blocks.push({id:'page-break',type:'page_break'},{id:'p2',type:'paragraph',style:{},children:[{id:'text2',type:'text',text:'Segunda página',style:{}}]});
 s.editor.load({...s.note,content});s.select();await s.editor.insertImage(url);
 const pages=s.rich.querySelectorAll('[data-page-index]');assert.equal(pages.length,2);
 const a=pages[0],b=pages[1];a.getBoundingClientRect=()=>({left:100,top:40,width:595.28/.75,height:841.89/.75});
 b.getBoundingClientRect=()=>({left:100,top:1200,width:595.28/.75,height:841.89/.75});
 s.picture().getBoundingClientRect=()=>({left:110,top:60,width:160,height:106.67});
 s.w.document.elementFromPoint=()=>b.querySelector('[data-page-content]');
 s.pointer(s.picture(),'pointerdown',150,100);s.pointer(s.picture(),'pointermove',250,1400);s.pointer(s.picture(),'pointerup',250,1400);
 let model=s.editor.snapshot().content;
 assert.ok(model.blocks.find(n=>n.id==='p2').children.some(n=>n.type==='image'));
 assert.ok(!model.blocks[0].children.some(n=>n.type==='image'));
 s.editor.format('undo');model=s.editor.snapshot().content;assert.ok(model.blocks[0].children.some(n=>n.type==='image'));
 s.editor.format('redo');model=s.editor.snapshot().content;assert.ok(model.blocks.find(n=>n.id==='p2').children.some(n=>n.type==='image'));
 assert.ok(s.rich.textContent.includes('Texto que deve permanecer.'));assert.ok(s.rich.textContent.includes('Segunda página'));
});

test('Alt and arrow keys resize proportionally without moving the anchor',async t=>{
 const s=await setup(t);s.select();await s.editor.insertImage(url);s.mockBounds();const before=s.geometry()[0];
 s.picture().dispatchEvent(new s.w.KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'ArrowRight',altKey:true}));
 const after=s.geometry()[0];assert.equal(after.width_pt,121);assert.equal(after.width_pt/after.height_pt,1.5);assert.equal(after.x_pt,before.x_pt);
});

test('new Markdown-backed documents can undo the first image insertion and redo it',async t=>{
 const s=await setup(t);s.editor.load({...s.note,content:undefined,content_format:'markdown',markdown:'Texto inicial'});
 const paragraph=s.rich.querySelector('p');s.rich.focus();const range=s.w.document.createRange();range.selectNodeContents(paragraph);
 s.w.getSelection().removeAllRanges();s.w.getSelection().addRange(range);s.editor.capture();
 assert.equal(await s.editor.insertImage(url),true);assert.equal(s.geometry().length,1);
 s.editor.format('undo');assert.equal(s.rich.querySelectorAll('.rich-image').length,0);assert.equal(s.rich.textContent,'Texto inicial');
 s.editor.format('redo');assert.equal(s.geometry().length,1);assert.equal(s.rich.textContent,'Texto inicial');
});
