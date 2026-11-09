const {test}=require('node:test');
const assert=require('node:assert/strict');
const pivot=require('../apps/open_doc/static/js/workbook_pivot.js');
const types=require('../apps/open_doc/static/js/workbook_types.js');

function source(){
  return {name:'Medições',cells:{
    '0,0':'Grupo','0,1':'Categoria','0,2':'Valor','0,3':'Identificador',
    '1,0':'A','1,1':'X','1,2':'10','1,3':'001',
    '2,0':'A','2,1':'Y','2,2':'20','2,3':'001',
    '3,0':'B','3,1':'X','3,2':'30','3,3':'002',
  },bold:[]};
}
const range=[0,0,3,3];
const config=(values,additional={})=>({rows:[0],columns:[1],values,filters:[],totals:true,...additional});
const metric=(field,operation='sum',show='value')=>({field,operation,show,decimals:2});

test('two independent metrics, grouped columns, accurate average and totals',()=>{
  const data=source();
  const before=JSON.stringify(data);
  const result=pivot.build({source:data,sourceIndex:0,range,
    config:config([metric(2),metric(2,'average')])});
  assert.deepEqual(result.rows[0],['A','10','10','20','20','30','15']);
  assert.deepEqual(result.rows[1],['B','30','30','','','30','30']);
  assert.deepEqual(result.rows[2],['Total geral','40','20','20','20','60','20']);
  assert.deepEqual(result.drillCells['1,1'],[1]);
  assert.deepEqual(result.pivot.config.values,[metric(2),metric(2,'average')]);
  assert.equal(JSON.stringify(data),before,'aggregation must never alter source data');
});

test('filters, distinct counts, percent denominators, and blank categories',()=>{
  const result=pivot.build({source:source(),range,
    config:config([metric(2,'sum','grand_pct'),metric(3,'distinct')],{
      filters:[{field:1,values:['X']}]
    })});
  assert.equal(result.sourceRows,2);
  assert.equal(result.rows[0][1],'25.00%');
  assert.equal(result.rows[1][1],'75.00%');
  assert.equal(result.rows[2][1],'100.00%');
  assert.equal(result.rows[2][2],'2');
  assert.throws(()=>pivot.build({source:source(),range,
    config:config([metric(2)],{filters:[{field:1,values:['unknown']} ]})}),/Nenhum registro/);
});

test('median and sample standard deviation are based on raw rows',()=>{
  const src=source();
  const result=pivot.build({source:src,range,
    config:{rows:[],columns:[],values:[metric(2,'median'),metric(2,'stdev')],filters:[],totals:false}});
  assert.equal(result.rows[0][1],'20');
  assert.ok(Math.abs(Number(result.rows[0][2])-10)<1e-9);
});

test('pt-BR parsing and invalid numeric values fail safely',()=>{
  assert.equal(pivot.number('R$ 1.234,56'),1234.56);
  assert.equal(pivot.number('12,5%'),0.125);
  assert.equal(pivot.number('1.234'),1234);
  assert.equal(pivot.number('2.5'),2.5);
  assert.ok(Number.isNaN(pivot.number('abc')));
  const src=source();src.cells['2,2']='sem medição';
  assert.throws(()=>pivot.build({source:src,range,config:config([metric(2)])}),/não numérico/);
});

test('typed display does not mutate raw values; exceptions override column',()=>{
  const sheet={types:{columns:{'1':'currency'},cells:{'4,1':'text','5,1':'auto'}}};
  assert.equal(types.typeFor(sheet,4,1),'text');
  assert.equal(types.typeFor(sheet,3,1),'currency');
  assert.equal(types.typeFor(sheet,5,1),'auto');
  assert.equal(types.show('00123','text').text,'00123');
  assert.equal(types.show('R$ 1.234,56','currency').valid,true);
  assert.equal(types.show('1.234,56','integer').valid,false);
  assert.equal(types.show('18/08/2026','date').valid,true);
  assert.equal(types.show('31/02/2026','date').valid,false);
  assert.equal(types.show('15:17','time').valid,true);
  assert.equal(types.show('25:12','time').valid,false);
});


test('explicit typed SQL/Python snapshots normalize data without mutating source',()=>{
  const raw='R$ 1.234,56';
  assert.equal(types.analysisValue(raw,'currency'),'1234.56');
  assert.equal(types.analysisValue('12,5%','percent'),'0.125');
  assert.equal(types.analysisValue('18/08/2026','date'),'2026-08-18');
  assert.equal(types.analysisValue('sim','boolean'),'1');
  assert.equal(types.analysisValue('00123','text'),'00123');
  assert.equal(types.analysisValue('abc','decimal'),'abc');
  assert.equal(raw,'R$ 1.234,56');
});

test('month/year grouping accepts pt-BR and ISO, preserving source and identifiers',()=>{
  const src={name:'Observações',cells:{
    '0,0':'Data','0,1':'Valor','0,2':'Categoria',
    '1,0':'18/08/2026','1,1':'2','1,2':'X',
    '2,0':'2026-08-19','2,1':'3','2,2':'Y',
    '3,0':'2026-09-01','3,1':'5','3,2':'X',
  }};
  const before=JSON.stringify(src);
  const result=pivot.build({source:src,range:[0,0,3,2],
    config:{rows:[0],columns:[],grouping:{'0':'month'},sort:{rows:'asc'},
      values:[{field:1,operation:'sum',decimals:0}],filters:[],totals:true}});
  assert.deepEqual(result.rows,[['08/2026','5'],['09/2026','5'],['Total geral','10']]);
  assert.equal(JSON.stringify(src),before);
  assert.equal(pivot.dateGroup('2026-09-01','year'),'2026');
  assert.equal(pivot.dateGroup('18/08/2026','day'),'18/08/2026');
  assert.throws(()=>pivot.dateGroup('31/02/2026','month'),/Data inválida/);
});

test('product, numeric sort, and decimal/currency precision',()=>{
  const data=source();
  const product=pivot.build({source:data,range,
    config:config([{field:2,operation:'product',decimals:0,format:'number'}],{sort:{rows:'value_desc'}})});
  assert.equal(product.rows[0][0],'B');
  assert.equal(product.rows[1][0],'A');
  assert.equal(product.rows[1].at(-1),'200');
  const money=pivot.build({source:data,range,
    config:config([{field:2,operation:'sum',decimals:2,format:'currency'}])});
  assert.match(money.rows[0].at(-1),/R\$\s*30,00/);
  const zero=pivot.build({source:data,range,
    config:config([{field:2,operation:'sum',decimals:0,format:'decimal'}])});
  assert.equal(zero.rows[0].at(-1),'30');
});
