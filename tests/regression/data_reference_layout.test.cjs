const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const read=path=>fs.readFileSync(path,"utf8");

test("data reference layout retains the real Open Doc ribbon and functional components",()=>{
  const html=read("apps/data/templates/data.html");
  for(const tab of ["import","transform","clean","filter","types","analysis","sql","python","export"])
    assert.match(html,new RegExp('data-ribbon-tab="'+tab+'"'));
  for(const item of ["data-dataset-table","data-dataset-tools","data-dataset-list",
    "data-dataset-advanced","data-dataset-query","data-sql-target"])
    assert.ok(html.includes(item),item);
  assert.match(html,/Editores avulsos \(modo avançado\)/);
});

test("data notebook uses real execution, scoped run gutter, and a status indicator",()=>{
  const source=read("apps/code/static/js/code_notebook.js");
  assert.match(source,/datasetMode=Boolean\(panel.closest\("\[data-dataset\]"\)\)/);
  assert.match(source,/data-notebook-gutter/);
  assert.match(source,/data-notebook-run/);
  assert.match(source,/code-notebook-kernel-status/);
  assert.match(source,/const result=await execute\(cell.language,cell.editor.value\(\)\)/);
  assert.match(source,/np\\\./);
});

test("dataset restores notebook split on import while preserving explicit editor commands",()=>{
  const source=read("apps/data/static/js/datasets.js");
  assert.match(source,/toolsOpen=true;\s*selected=null/);
  assert.match(source,/\$\("\[data-dataset-advanced\]"\)\.open=true/);
  assert.match(source,/el.dataset.columnType/);
});

test("real application tabs use its SVG sprite, not a detached HTML prototype",()=>{
  const source=read("apps/home/static/js/workspace.js");
  assert.match(source,/workspace-tab-icon/);
  assert.match(source,/root.querySelector\('svg use'\)/);
  assert.match(source,/button.onclick=\(\)=>activate\(tab\)/);
});
