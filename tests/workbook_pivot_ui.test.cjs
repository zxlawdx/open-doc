const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const root=__dirname+'/../apps/open_doc/';
function setup(count=60){
  const dom=new JSDOM(fs.readFileSync(root+'templates/workbook.html','utf8'),{runScripts:'outside-only'});
  const w=dom.window,doc=w.document,panel=doc.querySelector('[data-book-sidebar]');
  panel.showModal=()=>panel.open=true;panel.close=()=>panel.open=false;
  w.OpenDocGridWorkspace={icon:()=>doc.createElement('span')};
  for(const name of ['workbook_formula','workbook_pivot','workbook_pivot_ui'])w.eval(fs.readFileSync(root+'static/js/'+name+'.js','utf8'));
  const cells={'0,0':'Categoria','0,1':'Valor'};
  for(let r=1;r<=count;r++){cells[r+',0']='Grupo '+r;cells[r+',1']='1';}
  const sheets=[{name:'Dados',cells,bold:[]}];let output,message;
  const ui=w.OpenDocWorkbookPivotUI.create({host:doc,onApply:value=>output=value,onReport:value=>message=value,onCancel:()=>ui.close(),signal:new w.AbortController().signal});
  ui.open({sheets,index:0,calc:(s,r,c)=>cells[r+','+c]??'',...w.OpenDocWorkbookFormula,rangeText:'A1:B'+(count+1)});
  function add(field,zone){doc.querySelector('[data-pivot-choice="'+field+'"]').value=zone;doc.querySelector('[data-pivot-add="'+field+'"]').click();}
  function move(from,to){
    const event=new w.Event('drop',{bubbles:true,cancelable:true});
    event.dataTransfer={getData:()=>'move:'+from};
    doc.querySelector('[data-pivot-zone="'+to+'"]').dispatchEvent(event);
  }
  return {w,doc,ui,add,move,output:()=>output,message:()=>message,close:()=>dom.window.close()};
}
test('filter lists all source categories and excludes only unchecked records',()=>{
  const t=setup();
  try{
    t.add(0,'rows');t.add(1,'values');t.add(0,'filters');
    const choices=t.doc.querySelectorAll('[data-pivot-filter]');assert.equal(choices.length,60);
    choices[0].checked=false;choices[0].dispatchEvent(new t.w.Event('change',{bubbles:true}));
    t.ui.apply();assert.equal(t.output().sourceRows,59);
    assert.equal(t.output().rows.at(-1)[1],'59');
    assert.ok(t.output().rows.some(row=>row[0]==='Grupo 60'));
  }finally{t.close();}
});
test('moving a field to a full Values area retains its original position',()=>{
  const t=setup(2);
  try{
    t.add(0,'rows');for(let i=0;i<12;i++)t.add(1,'values');
    t.move('rows:0','values');
    assert.match(t.message(),/12 métricas/);
    assert.equal(t.doc.querySelectorAll('[data-pivot-chips=rows] .pivot-v2-chip').length,1);
    t.ui.apply();assert.deepEqual(Array.from(t.output().pivot.config.rows),[0]);
    assert.equal(t.output().pivot.config.values.length,12);
  }finally{t.close();}
});
