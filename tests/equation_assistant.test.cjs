const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const script=fs.readFileSync(path.join(__dirname,'../apps/open_doc/static/js/equation_assistant.js'),'utf8');

function setup(t,kind='rich'){
 const dom=new JSDOM('<div id="app" data-document-kind="'+kind+'"><div data-dialog hidden><section class="dialog"><div data-dialog-body></div></section></div></div>',{
   url:'http://localhost',runScripts:'outside-only'
 });
 const w=dom.window;t.after(()=>w.close());
 w.eval(fs.readFileSync(path.join(__dirname,'../apps/open_doc/static/js/math_gallery.js'),'utf8'));
 Object.assign(w.OpenDocMathGallery,{
   DEFINITIONS:[{id:'fraction',label:'Fração'}],
   BLOCKS:{fraction:[{kind:'fraction',numerator:'a',denominator:'b'}]},
   renderBlocks:blocks=>{const span=w.document.createElement('span');span.textContent=JSON.stringify(blocks);return span;}
 });
 w.eval(script);
 const root=w.document.querySelector('#app'),inserts=[],statuses=[];
 let resolve;
 const dialog=()=>{
   root.querySelector('[data-dialog-body]').replaceChildren();
   return new Promise(r=>{resolve=r;});
 };
 const editor={insertMath:blocks=>{inserts.push(blocks);return true;},selectedMath:()=>null};
 const launch=()=>w.OpenDocEquationAssistant.EquationAssistant.open({
   dialog,root,editor,status:msg=>statuses.push(msg)
 });
 return {w,root,inserts,statuses,launch,resolve:value=>resolve(value)};
}

test('numeric calculator respects precedence, parentheses, fractions and power',t=>{
 const q=setup(t),calc=q.w.OpenDocEquationAssistant.ArithmeticCalculator.compute;
 assert.equal(calc('2+3*4'),14);
 assert.equal(calc('(2+3)*4'),20);
 assert.equal(calc('2^3^2'),512);
 assert.equal(calc('-2^2'),-4);
 assert.equal(calc('2^-2'),.25);
 assert.equal(calc('12,5/2'),6.25);
 assert.equal(calc('5--3'),8);
});

test('calculator rejects code, division by zero and nonfinite results',t=>{
 const calc=setup(t).w.OpenDocEquationAssistant.ArithmeticCalculator.compute;
 for(const unsafe of ['globalThis','process.exit(0)','1/0','0/0','(2+3',
   '1e309','3*','2**3','1 '.repeat(300)]){
   assert.throws(()=>calc(unsafe),/números|zero|parênteses|Número|limite|fora de ordem|complexa|expressão|finito/,unsafe);
 }
});

test('formula modal previews Unicode, computes a value, inserts only on confirmation',async t=>{
 const q=setup(t);
 const pending=q.launch();const box=q.root.querySelector('[data-dialog-body]');
 const input=box.querySelector('.equation-expression');
 assert.ok(input);assert.equal(box.querySelectorAll('.equation-symbols button').length,16);
 const fraction=Array.from(box.querySelectorAll('.equation-symbols button'))
   .find(el=>el.getAttribute('aria-label')==='Inserir Fração');
 assert.ok(fraction);fraction.click();
 assert.equal(input.value,'(a)/(b)');
 input.value='E = mc²';
 input.dispatchEvent(new q.w.Event('input',{bubbles:true}));
 assert.equal(box.querySelector('.equation-preview').textContent,'E = mc²');
 const calc=box.querySelector('.equation-calculator input');
 calc.value='(12+8)/4';
 Array.from(box.querySelectorAll('.equation-calc-actions button'))
   .find(el=>el.textContent==='Calcular').click();
 assert.equal(box.querySelector('.equation-calc-result').textContent,'Resultado: 5');
 q.resolve(true);await pending;
 assert.equal(q.inserts.length,1);
 assert.deepEqual(JSON.stringify(q.inserts[0]),JSON.stringify([{kind:'text',value:'E = mc²'}]));
 assert.equal(q.statuses.length,1);
});

test('cancelled dialog and fixed-format use never insert any formula',async t=>{
 const q=setup(t);const pending=q.launch();
 q.resolve(null);
 assert.equal(await pending,false);assert.equal(q.inserts.length,0);
 const fixed=setup(t,'fixed');
 await assert.rejects(fixed.launch(),/disponíveis no editor de documentos/);
 assert.equal(fixed.inserts.length,0);
});

test('DOCX equation dialog inserts native fraction template with editable fields',async t=>{
 const q=setup(t);const pending=q.launch();
 const box=q.root.querySelector('[data-dialog-body]');
 const select=box.querySelector('.equation-native-template');
 select.value='fraction';select.dispatchEvent(new q.w.Event('change'));
 const inputs=box.querySelectorAll('.equation-native-components input');
 assert.equal(inputs.length,2);
 inputs[0].value='x²+1';inputs[0].dispatchEvent(new q.w.Event('input'));
 inputs[1].value='x+1';inputs[1].dispatchEvent(new q.w.Event('input'));
 q.resolve(true);await pending;
 assert.equal(q.inserts.length,1);
 assert.deepEqual(JSON.stringify(q.inserts[0]),JSON.stringify([
  {kind:'fraction',numerator:'x²+1',denominator:'x+1'}
 ]));
});
