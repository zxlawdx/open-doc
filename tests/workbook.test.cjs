const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = {window:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../apps/open_doc/static/js/workbook_formula.js'),'utf8'),context);
const {evaluate, column, address}=context.window.OpenDocWorkbookFormula;

test('workbook formulas support arithmetic, ranges, absolute references and other sheets',()=>{
  const sheets=[
    {name:'Dados',cells:{'0,0':'2','1,0':'4','2,0':'0004','0,1':'=SOMA(A1:A3)*2','1,1':'=MÉDIA($A$1:$A$2)'}},
    {name:'Resumo',cells:{'0,0':'=Dados!B1+Dados!B2','1,0':'=1/0','2,0':'=A4','3,0':'=A3','4,0':'=WEBSERVICE(A1)'}},
  ];
  const calc=evaluate(sheets);
  assert.equal(calc(0,2,0),'0004');
  assert.equal(calc(1,0,0),15);
  assert.equal(calc(1,1,0),'#DIV/0!');
  assert.equal(calc(1,2,0),'#CICLO!');
  assert.equal(calc(1,4,0),'#NOME?');
  assert.equal(column(99),'CV');
  assert.equal(address('CV10000').join(','),'9999,99');
  assert.equal(address('CW10000'),null);
});
