"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {JSDOM}=require("jsdom");

test("CSV import preview automatically rechecks edited column types before enabling Confirm",async t=>{
  const dom=new JSDOM('<div data-app></div>',{url:"http://localhost",runScripts:"outside-only"});
  const w=dom.window;
  t.after(()=>w.close());
  w.eval(fs.readFileSync(path.resolve(__dirname,"../../apps/data/static/js/import_preview.js"),"utf8"));
  const options={encoding:"auto",delimiter:"auto",decimal:"auto",thousands:"",header:1,date_format:"iso",types:{}};
  const profile={
    token:"preview-1",files:["titanic.csv"],row_count:2,rows:[[35,"male"],[null,"female"]],
    schema:[{name:"Age",dtype:"Float64",kind:"decimal",nullable:true},{name:"Sex",dtype:"string",kind:"text",nullable:true}],
    options,errors:[],sampled:false
  };
  const sent=[];
  const request=async (_route,body)=>{
    sent.push(body);
    if(body.operation==="import-preview")return {...profile,options:body.options};
    if(body.operation==="import-cancel")return {};
    throw Error("Unexpected "+body.operation);
  };
  const controller=new w.AbortController();
  const pending=w.OpenDocImportPreview.show({
    host:w.document.querySelector('[data-app]'),request,initial:profile,signal:controller.signal
  });
  const modal=w.document.querySelector(".dataset-import-preview");
  const confirm=modal.querySelector("[data-import-confirm]");
  assert.equal(confirm.disabled,false);
  const select=modal.querySelector('[data-import-type="Age"]');
  select.value="integer";select.dispatchEvent(new w.Event("change",{bubbles:true}));
  assert.equal(confirm.disabled,true);
  await new Promise(resolve=>setTimeout(resolve,400));
  assert.equal(sent.length,1);
  assert.equal(sent[0].operation,"import-preview");
  assert.equal(sent[0].options.types.Age,"integer");
  assert.equal(confirm.disabled,false,"valid preview should unlock confirmation automatically");
  assert.equal(modal.querySelector('[data-import-type="Age"]').value,"integer");
  modal.querySelector("[data-import-cancel]").click();
  assert.equal((await pending).cancelled,true);
  controller.abort();
});
