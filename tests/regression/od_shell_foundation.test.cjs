const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const read=path=>fs.readFileSync(path,"utf8");
test("approved local SVG sprite retains exactly the 23 stage-1 symbols",()=>{
  const xml=read("apps/home/static/approved-icons.svg");
  const original=["home","doc","slides","pdf","sheet","data","code","set","sun",
    "play","stop","rs","plus","x","search","more","up","dn","cp","tr","pn","gr","ls"];
  for(const id of original)assert.ok(xml.includes('<symbol id="i-'+id+'"'),id);
  assert.equal((xml.match(/<symbol id="i-/g)||[]).length,62);
  assert.match(xml,/<symbol id="i-home" viewBox="0 0 24 24"><path d="M3 11l9-8 9 8"/);
  assert.match(xml,/<symbol id="i-doc" viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14/);
});
test("real Open Doc shell routes and command attributes are preserved",()=>{
  const template=read("apps/home/templates/base.html");
  for(const route of ["documents","presentations","pdf","spreadsheets","data","code"])
    assert.ok(template.includes('href="/'+route+'" data-vela-link'),route);
  for(const marker of ["data-action=\"home\"","data-action=\"theme\"","data-od-density-toggle",
    "home/approved-icons.svg","home/css/od_shell.css"])
    assert.ok(template.includes(marker),marker);
  const runtime=read("apps/home/static/js/app.js");
  assert.match(runtime,/OpenDocShell.*od_shell\.js/);
  assert.match(runtime,/OpenDocWorkspace.*workspace\.js/);
});
test("density uses persistent settings rather than display-only local mock",()=>{
  const shell=read("apps/home/static/js/od_shell.js");
  const settings=read("shared/services/preferences_service.py");
  assert.match(shell,/await persist\(\{density:next\}\)/);
  assert.match(shell,/MutationObserver/);
  assert.match(settings,/"density": "comfortable"/);
  assert.match(settings,/Densidade inválida/);
});
