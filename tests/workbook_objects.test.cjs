const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const root=__dirname+'/../apps/open_doc/static/js/';
function setup(t){
 const dom=new JSDOM('<section><select data-book-chart-kind><option value="bar">Colunas</option><option value="line">Linhas</option></select><div id="viewport"></div></section>',{runScripts:'outside-only',url:'http://localhost'});
 const w=dom.window;t.after(()=>w.close());
 w.eval(fs.readFileSync(root+'workbook_pivot.js','utf8'));
 w.eval(fs.readFileSync(root+'workbook_objects.js','utf8'));
 const sheet={cells:{'0,0':'Mês','0,1':'Valor','1,0':'Jan','1,1':'0','2,0':'Fev','2,1':'20'},bold:[],objects:[]};
 const state={sheet,bookId:'book',index:0,row:0,col:0,bounds:[0,0,2,1],scale:1,gutter:52,cellHeight:28,
  calc:(s,r,c)=>sheet.cells[r+','+c]??''};
 const requests=[],versions=[],abort=new w.AbortController();t.after(()=>abort.abort());
 let module;
 module=w.OpenDocWorkbookObjects.create({host:w.document.querySelector('section'),viewport:w.document.querySelector('#viewport'),signal:abort.signal,getState:()=>state,
  change:(target,before,after)=>{versions.push(before);target.objects=after;module.sync();},dialog:async()=> 'Vendas',report:message=>{throw Error(message);},
  request:async(path,body)=>{requests.push(body);return {media_id:'a'.repeat(64),width:80,height:40,url:'data:image/png;base64,AA=='};}});
 module.sync();return {w,module,sheet,state,requests,versions};
}
test('inserted image stores a compact media reference, supports duplicate, move and delete',async t=>{
 const q=setup(t);
 await q.module.addImage(new q.w.File(['test'],'foto.png',{type:'image/png'}));
 assert.equal(q.sheet.objects.length,1);assert.equal(q.requests.length,1);
 assert.equal(q.requests[0].operation,'image-add');
 assert.ok(!JSON.stringify(q.sheet.objects).includes('data:image'));
 assert.equal(q.w.document.querySelector('img').alt,'foto.png');
 const node=q.w.document.querySelector('[data-object-id]');node.dispatchEvent(new q.w.MouseEvent('click',{bubbles:true}));
 node.dispatchEvent(new q.w.KeyboardEvent('keydown',{key:'ArrowRight',shiftKey:true,bubbles:true}));
 assert.equal(q.sheet.objects[0].x,10);
 node.querySelector('[data-object-action=duplicate]').click();assert.equal(q.sheet.objects.length,2);
 assert.notEqual(q.sheet.objects[0].id,q.sheet.objects[1].id);
 q.w.document.querySelectorAll('[data-object-action=remove]')[1].click();assert.equal(q.sheet.objects.length,1);
});
test('chart references cells, retains numeric zero and updates after source editing',async t=>{
 const q=setup(t);await q.module.addChart();
 assert.equal(q.sheet.objects[0].type,'chart');
 assert.deepEqual(Array.from(q.sheet.objects[0].range),[0,0,2,1]);
 let data=q.w.OpenDocWorkbookObjects.chartData(q.sheet.objects[0],q.state);
 assert.deepEqual(Array.from(data.series[0].values),[0,20]);
 const before=q.w.document.querySelector('svg').outerHTML;
 q.sheet.cells['2,1']='40';q.state.calc=(s,r,c)=>q.sheet.cells[r+','+c]??'';q.module.sync();
 data=q.w.OpenDocWorkbookObjects.chartData(q.sheet.objects[0],q.state);
 assert.deepEqual(Array.from(data.series[0].values),[0,40]);
 assert.notEqual(q.w.document.querySelector('svg').outerHTML,before);
 q.state.bounds=[0,0,0,1];await assert.rejects(q.module.addChart(),/Selecione/);
});
test('native-style shapes render literal editable text and minigraphs keep zeros and negatives',t=>{
 const q=setup(t),api=q.w.OpenDocWorkbookObjects;
 const text='<img src=x onerror=alert(1)>';
 const shape=api.shapeSvg({shape_kind:'text',name:'Texto',text,fill:'#FFFFFF',color:'#123456'});
 assert.equal(shape.querySelector('img'),null);
 assert.equal(shape.querySelector('foreignObject div').textContent,text);
 q.sheet.cells={'0,0':'0','0,1':'-2','0,2':'3'};
 const svg=api.sparklineSvg({kind:'column',range:[0,0,0,2]},q.state);
 assert.equal(svg.querySelectorAll('rect').length,3);
 assert.equal(svg.querySelectorAll('rect[fill="#db4437"]').length,1);
});

test('chart insertion preserves objects added while awaiting an in-flight save',async t=>{
 const q=setup(t);let release,entered;
 const started=new Promise(resolve=>{entered=resolve;});
 q.state.idle=()=>{entered();return new Promise(resolve=>{release=resolve;});};
 const adding=q.module.addChart();await started;
 q.sheet.objects=[{id:'existing',type:'shape',shape_kind:'rect',name:'Forma',text:'',fill:'#FFFFFF',color:'#123456',x:0,y:0,width:100,height:100}];
 release();await adding;
 assert.equal(q.sheet.objects.length,2);
 assert.equal(q.sheet.objects[0].id,'existing');
 assert.equal(q.sheet.objects[1].type,'chart');
});
