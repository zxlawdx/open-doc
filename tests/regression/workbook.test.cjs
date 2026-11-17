const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = {window:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../apps/spreadsheets/static/js/workbook_formula.js'),'utf8'),context);
const {evaluate, column, address, shiftStructure:windowShift}=context.window.OpenDocWorkbookFormula;

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


test('imported tracker IF COUNT and AVERAGE recalculate with lazy empty branches',()=>{
 const sheet={name:'Tracker',cells:{'3,1':'74','3,3':'1.6','4,1':'=B4*D4','7,4':'=IF(COUNT(B8:D8)=0,"",AVERAGE(B8:D8))','8,4':'=IFERROR(1/0,"Sem valor")'}};
 let calc=evaluate([sheet]);assert.equal(calc(0,4,1),118.4);assert.equal(calc(0,7,4),'');assert.equal(calc(0,8,4),'Sem valor');
 sheet.cells['7,1']='70';sheet.cells['7,2']='72';sheet.cells['7,3']='0';calc=evaluate([sheet]);assert.equal(calc(0,7,4),142/3);
 sheet.cells['0,0']='=IF(1=1,"texto, com; separador",1/0)';calc=evaluate([sheet]);assert.equal(calc(0,0,0),'texto, com; separador');
});

test('Brazilian decimal arithmetic, precedence and power are evaluated consistently',()=>{
 const formulas=[
  ['=2*19,32',38.64],['=2*19.32',38.64],['=2^3',8],['=2**3',8],
  ['=2^3^2',512],['=-2^2',-4],['=(-2)^2',4],['=2^-2',0.25],
  ['=2+3*4',14],['=(2+3)*4',20],['=10/4',2.5],
  ['=20%',0.2],['=1,25+2.75',4],['=3-5',-2],
  ['=A1*2',38.64],['=B1/2',9.66],['=10/0','#DIV/0!']
 ];
 const cells={'0,0':'19,32','0,1':'19.32'};
 formulas.forEach(([formula],i)=>cells[(i+1)+',0']=formula);
 const calc=evaluate([{name:'Calculos',cells}]);
 assert.equal(calc(0,0,0),19.32);
 assert.equal(calc(0,0,1),19.32);
 formulas.forEach(([formula,expected],i)=>assert.equal(calc(0,i+1,0),expected,formula));
 assert.equal(evaluate([{name:'Calculos',cells:{'0,0':'texto','0,1':'=A1*2'}}])(0,0,1),'#VALOR!');
});

test('inserting row or column shifts cells, styles, merges and references across sheets',()=>{
  const initial=[
    {name:'Dados',cells:{'0,0':'2','1,0':'4','2,0':'6','1,1':'=SOMA(A1:A3)','2,2':'=A3*2'},
      bold:['1,0'],styles:{'1,0':{fill:'#ff0000'}},types:{cells:{'1,0':'number'},columns:{'0':'number'}},
      layout:{rows:{'1':44},columns:{'1':210},merges:[[3,0,3,1]],freeze:[2,1]}},
    {name:'Resumo',cells:{'0,0':'=Dados!A3','1,0':'=SOMA(Dados!A1:A3)','2,0':'="A3"'}},
  ];
  const shifted=windowShift(initial,0,'row',1,true);
  assert.equal(shifted[0].cells['2,0'],'4');
  assert.equal(shifted[0].cells['2,1'],'=SOMA(A1:A4)');
  assert.equal(shifted[0].cells['3,2'],'=A4*2');
  assert.equal(shifted[1].cells['0,0'],'=Dados!A4');
  assert.equal(shifted[1].cells['1,0'],'=SOMA(Dados!A1:A4)');
  assert.equal(shifted[1].cells['2,0'],'="A3"');
  assert.deepEqual([...shifted[0].bold],['2,0']);
  assert.equal(shifted[0].styles['2,0'].fill,'#ff0000');
  assert.equal(shifted[0].types.cells['2,0'],'number');
  assert.equal(shifted[0].layout.rows['2'],44);
  assert.deepEqual([...shifted[0].layout.merges[0]],[4,0,4,1]);
  assert.deepEqual([...shifted[0].layout.freeze],[3,1]);
  assert.equal(initial[0].cells['1,0'],'4');
  assert.equal(evaluate(shifted)(1,0,0),6);
  const insertedColumn=windowShift(shifted,0,'column',1,true);
  assert.equal(insertedColumn[0].cells['2,2'],'=SOMA(A1:A4)');
  assert.equal(insertedColumn[0].layout.columns['2'],210);
  assert.deepEqual([...insertedColumn[0].layout.merges[0]],[4,0,4,2]);
  assert.equal(insertedColumn[1].cells['0,0'],'=Dados!A4');
  assert.equal(evaluate(insertedColumn)(0,2,2),12);
});

test('deleting row or column retains ranges and reports deleted references',()=>{
  const initial=[
    {name:'Dados',cells:{'0,0':'2','1,0':'4','2,0':'6','0,1':'=SOMA(A1:A3)','1,1':'=A2','2,1':'=$A$2'}},
    {name:'Resumo',cells:{'0,0':'=Dados!A2','1,0':'=Dados!A3','2,0':'=SEERRO(Dados!A2;0)'}},
  ];
  const next=windowShift(initial,0,'row',1,false);
  assert.equal(next[0].cells['0,1'],'=SOMA(A1:A2)');
  assert.equal(next[0].cells['1,1'],'=$A$2');
  assert.equal(next[1].cells['0,0'],'=Dados!#REF!');
  assert.equal(next[1].cells['1,0'],'=Dados!A2');
  assert.equal(evaluate(next)(1,0,0),'#REF!');
  assert.equal(evaluate(next)(1,2,0),0);
  assert.equal(evaluate(next)(0,0,1),8);
  const col=windowShift([{name:'Dados',cells:{'0,0':'5','0,1':'2','0,2':'=B1','1,0':'=SOMA(A1:C1)'}}],0,'column',1,false);
  assert.equal(col[0].cells['0,1'],'=#REF!');
  assert.equal(col[0].cells['1,0'],'=SOMA(A1:B1)');
  assert.equal(evaluate(col)(0,0,1),'#REF!');
});

test('structural edits fail atomically on truncated occupied edge or unsupported objects',()=>{
  const initial=[{name:'Dados',cells:{'9999,0':'last'}}];
  assert.throws(()=>windowShift(initial,0,'row',0,true),/última linha/);
  assert.equal(initial[0].cells['9999,0'],'last');
  assert.throws(()=>windowShift([{name:'Dados',cells:{},objects:[{type:'chart'}]}],0,'row',0,true),/gráficos/);
  const other=[{name:'Dados',cells:{'0,0':'1'}},{name:'Resumo',cells:{'0,0':'=Dados!A1'}}];
  const next=windowShift(other,0,'row',0,true);
  assert.equal(next[1].cells['0,0'],'=Dados!A2');
  assert.equal(other[1].cells['0,0'],'=Dados!A1');
});
