const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const source=fs.readFileSync("apps/spreadsheets/static/js/workbook.js","utf8");
const start=source.indexOf("    function worksheetSnapshot(includeRows=true) {");
const end=source.indexOf("    function updateSchema()",start);
assert.ok(start!==-1&&end>start,"worksheetSnapshot must be available");
const snapshotSource=source.slice(start,end);

function runSnapshot(cells,merges,bounds) {
  const sheet=()=>({layout:{merges}});
  const evalCell=(_,r,c)=>Object.prototype.hasOwnProperty.call(cells,r+","+c)?cells[r+","+c]:"";
  const factory=new Function("usedBounds","evaluate","book","sheet","index","column","typesUI",
    snapshotSource+"; return worksheetSnapshot;");
  const snapshot=factory(()=>bounds,()=>evalCell,{sheets:[]},sheet,0,c=>"ABC"[c],{
    typeFor:()=> "auto",analysisValue:v=>v
  });
  return snapshot();
}

test("SQL extracts actual headers beneath merged XLSX financial title",()=>{
  const cells={
    "0,0":"PREMISSAS • edite os valores azuis",
    "2,0":"Item","2,1":"Valor (R$)","2,2":"Observação",
    "3,0":"Gazin mensal","3,1":487,"3,2":"Recorrente",
    "4,0":"Aluguel","4,1":350,"4,2":"Recorrente"
  };
  const result=runSnapshot(cells,[[0,0,0,2]],[0,0,4,2]);
  assert.deepEqual(result.columns,["Item","Valor (R$)","Observação"]);
  assert.deepEqual(result.rows,[["Gazin mensal",487,"Recorrente"],["Aluguel",350,"Recorrente"]]);
});
test("SQL preserves first row headers for ordinary imported tables",()=>{
  const cells={"0,0":"Item","0,1":"Valor","1,0":"Cafe","1,1":12};
  const result=runSnapshot(cells,[],[0,0,1,1]);
  assert.deepEqual(result.columns,["Item","Valor"]);
  assert.deepEqual(result.rows,[["Cafe",12]]);
});
