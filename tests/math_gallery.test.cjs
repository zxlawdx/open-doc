const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const gallery=fs.readFileSync(path.join(__dirname,
 '../apps/open_doc/static/js/math_gallery.js'),'utf8');
function setup(t){
 const dom=new JSDOM('<main id="workspace"></main>',{
  url:'http://localhost',runScripts:'outside-only'
 });
 t.after(()=>dom.window.close());
 dom.window.eval(gallery);
 return {w:dom.window,host:dom.window.document.querySelector('#workspace')};
}
test('offline math gallery contains fraction, integral, trig, line, sum and double integral',t=>{
 const {w}=setup(t),math=w.OpenDocMathGallery;
 assert.equal(math.DEFINITIONS.length,7);
 assert.equal(new Set(math.DEFINITIONS.map(d=>d.id)).size,7);
 for(const def of math.DEFINITIONS){
  assert.ok(def.tex.startsWith('\\'),'LaTeX source missing: '+def.id);
  const svg=math.svg(def.id);
  assert.match(svg,/<svg/);assert.match(svg,/<text/);
  assert.match(svg,/viewBox="0 0 1024 256"/);
  assert.ok(!svg.includes('<script'),'No active SVG content');
 }
 assert.match(math.svg('fraction'),/M407 107h320/);
 assert.match(math.svg('sum'),/∑/);
 assert.match(math.svg('line'),/∮/);
 assert.match(math.svg('trig'),/sen\(x\)/);
 assert.throws(()=>math.svg('script'),/desconhecida/);
});
test('SVG gallery buttons use accessible labels, previews and do not insert before click',t=>{
 const {w,host}=setup(t),insertions=[],statuses=[];
 const gallery=w.OpenDocMathGallery.install(host,x=>insertions.push(x),
  text=>statuses.push(text));
 assert.ok(gallery.panel.hidden);
 gallery.toggle();assert.equal(gallery.panel.hidden,false);
 assert.equal(host.querySelectorAll('button[data-math-id]').length,7);
 for(const button of host.querySelectorAll('button[data-math-id]')){
  assert.match(button.getAttribute('aria-label'),/^Inserir /);
  assert.ok(button.querySelector('img[src^="data:image/svg+xml"]'));
  assert.ok(button.querySelector('img').alt.includes('\\'));
 }
 gallery.close();assert.equal(gallery.panel.hidden,true);
 assert.equal(insertions.length,0);assert.equal(statuses.length,0);
});

test('math gallery inserts semantic editable blocks and never a PNG asset',t=>{
 const {w,host}=setup(t),insertions=[];
 const gallery=w.OpenDocMathGallery.install(host,item=>insertions.push(item));
 gallery.toggle();
 for(const button of host.querySelectorAll('button[data-math-id]')){
   button.click();
   gallery.toggle();
 }
 assert.equal(insertions.length,7);
 assert.ok(insertions.every(item=>item.kind==='math'));
 assert.ok(insertions.every(item=>Array.isArray(item.math_blocks) && item.math_blocks.length));
 assert.ok(insertions.every(item=>!('data' in item) && !('mime' in item)));
 assert.equal(insertions[0].math_blocks.filter(b=>b.kind==='fraction').length,2);
 assert.equal(insertions[5].math_blocks[0].operator,'∑');
});
