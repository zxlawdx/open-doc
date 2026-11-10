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
  const data=source();data.cells['3,2']='300';
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


test('value ordering uses the chosen metric, not a hard-coded sum',()=>{
  const src=source();src.cells['3,2']='50';
  const settings=operation=>config([{field:2,operation}],{sort:{rows:'value_desc'}});
  const product=pivot.build({source:src,range,config:settings('product')});
  const sum=pivot.build({source:src,range,config:settings('sum')});
  assert.equal(product.rows[0][0],'A'); // product 10*20=200 outranks B=50
  assert.equal(sum.rows[0][0],'B'); // sum A=30 < B=50
});

test('subtotals aggregate raw records and retain accurate drill coordinates',()=>{
  const src=source();
  src.cells['4,0']='A';src.cells['4,1']='Y';src.cells['4,2']='40';
  const result=pivot.build({source:src,range:[0,0,4,3],
    config:config([metric(2,'average'),metric(2,'count')],{rows:[0,1],columns:[],subtotals:true})});
  assert.deepEqual(result.rows,[
    ['A / X','10','1'],['A / Y','30','2'],['A · Subtotal','23.3333333333','3'],
    ['B / X','30','1'],['B · Subtotal','30','1'],['Total geral','25','4'],
  ]);
  assert.deepEqual(result.summaryRows,[2,4,5]);
  assert.deepEqual(result.drillCells['4,1'],[3]);
  assert.equal(result.pivot.config.subtotals,true);
});

for(const size of [5,100,9999])test('pivot agrees with array reductions across '+size+' records',()=>{
  const records=Array.from({length:size},(_,i)=>({group:'G'+i%4,value:i%13===0?null:i%29-12}));
  const cells={'0,0':'Grupo','0,1':'Valor'};
  for(const [i,{group,value}] of records.entries()){
    cells[(i+1)+',0']=group;
    if(value!==null)cells[(i+1)+',1']=String(value);
  }
  const result=pivot.build({source:{cells},range:[0,0,size,1],config:{
    rows:[0],columns:[],values:['sum','count','average','min','max'].map(op=>metric(1,op)),totals:true,
  }});
  assert.equal(result.sourceRows,size);
  for(const [group,sum,count,mean,min,max] of result.rows){
    const values=records.filter(item=>group==='Total geral'||item.group===group).map(item=>item.value).filter(v=>v!==null);
    const total=values.reduce((a,b)=>a+b,0);
    assert.equal(Number(count),values.length);
    if(!values.length){assert.deepEqual([sum,mean,min,max],['','','','']);continue;}
    assert.equal(Number(sum),total);
    assert.ok(Math.abs(Number(mean)-total/values.length)<1e-9);
    assert.equal(Number(min),Math.min(...values));
    assert.equal(Number(max),Math.max(...values));
  }
});

test('quick pivot uses only the selected offset range and sums numeric columns',()=>{
  const source={cells:{"1,1":"Categoria","1,2":"Previsto","1,3":"Real",
    "2,1":"Moradia","2,2":100,"2,3":80,"3,1":"Moradia","3,2":50,"4,1":"Fora","4,2":500}};
  const range=[1,1,3,3];
  const result=pivot.quickBuild({source,sourceIndex:2,range,read:(r,c)=>source.cells[r+","+c]});
  assert.deepEqual(result.pivot.range,range);
  assert.equal(result.pivot.source,2);
  assert.deepEqual(result.pivot.config.rows,[1]);
  assert.deepEqual(result.rows[0],["Moradia","150","80"]);
});

test('quick pivot counts text without treating explicitly typed identifiers as sums',()=>{
  const source={cells:{"0,0":"Código","1,0":123,"2,0":123},
    types:{columns:{"0":"text"}}};
  const result=pivot.quickBuild({source,sourceIndex:0,range:[0,0,2,0],read:(r,c)=>source.cells[r+","+c]});
  assert.deepEqual(result.rows[0],["123","2"]);
  assert.throws(()=>pivot.quickBuild({source,sourceIndex:0,range:[0,0,0,0],read:()=>""}),/Shift/);
});
