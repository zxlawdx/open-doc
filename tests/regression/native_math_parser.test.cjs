const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const parser=fs.readFileSync(path.join(__dirname,
 '../../apps/documents/static/js/native_math_parser.js'),'utf8');
const gallery=fs.readFileSync(path.join(__dirname,
 '../../apps/documents/static/js/math_gallery.js'),'utf8');
function setup(t){
 const dom=new JSDOM('<main id="workspace"></main>',{
  url:'http://localhost',runScripts:'outside-only'
 });
 t.after(()=>dom.window.close());dom.window.eval(parser);dom.window.eval(gallery);
 return dom.window;
}
test('LaTeX nested fraction with root and summation stays structured',t=>{
 const w=setup(t);
 const blocks=w.OpenDocMathParser.parseLatex(
  "\\frac{\\sqrt{x^2+1}}{\\sum_{k=1}^{n}{k}}");
 assert.equal(blocks[0].kind,'fraction');
 assert.equal(blocks[0].numerator[0].kind,'sqrt');
 assert.equal(blocks[0].numerator[0].radicand[0].kind,'superscript');
 assert.equal(blocks[0].denominator[0].kind,'nary');
 assert.equal(blocks[0].denominator[0].operator,'∑');
 const displayed=w.OpenDocMathGallery.renderBlocks(blocks);
 assert.ok(displayed.querySelector('.slide-math-fraction .slide-math-sqrt'));
 assert.ok(displayed.querySelector('.slide-math-nary'));
});
test('line integral, indexed root and matrix render without images',t=>{
 const w=setup(t);
 const samples=[
  ["\\oint_C{\\frac{\\partial y}{\\partial x}}",'nary'],
  ["\\sqrt[3]{x+1}",'root'],
  ["\\begin{matrix}a&b\\\\c&d\\end{matrix}",'matrix']
 ];
 for(const [latex,kind] of samples){
  const blocks=w.OpenDocMathParser.parseLatex(latex);
  assert.equal(blocks[0].kind,kind);
  const el=w.OpenDocMathGallery.renderBlocks(blocks);
  assert.ok(el.querySelector('.slide-math-'+kind));
  assert.equal(el.querySelectorAll('img,script').length,0);
 }
});
test('unsafe, malformed or excessive LaTeX is rejected, not flattened',t=>{
 const w=setup(t);
 for(const value of [
  "\\unknown{data}","\\frac{a}",
  "\\begin{matrix}a&b\\\\c\\end{matrix}",
  "\\sqrt{","\\frac{a}{b}}",
  'x'.repeat(2050)
 ])assert.throws(()=>w.OpenDocMathParser.parseLatex(value));
});
test('gallery LaTeX entry inserts editable formula with no bitmap',t=>{
 const w=setup(t),insertions=[],host=w.document.querySelector('#workspace');
 const gallery=w.OpenDocMathGallery.install(host,v=>insertions.push(v));
 gallery.toggle();
 const source=host.querySelector('.slide-math-latex-input');
 source.value="\\frac{x^{2}}{\\sqrt{1+x}}";
 host.querySelector('.slide-math-latex-add').click();
 assert.equal(insertions.length,1);
 assert.equal(insertions[0].math_blocks[0].kind,'fraction');
 assert.ok(!('mime' in insertions[0])&&!('data' in insertions[0]));
 assert.equal(gallery.panel.hidden,true);
});

test('the required LaTeX corpus stays structured and renders without images',t=>{
 const w=setup(t);
 const samples=require('../fixtures/math_latex_roundtrip.json');
 for(const {latex,blocks} of samples){
  const parsed=w.OpenDocMathParser.parseLatex(latex);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed)),blocks,latex);
  assert.equal(w.OpenDocMathGallery.renderBlocks(parsed).querySelectorAll('img,canvas').length,0,latex);
 }
 assert.equal(w.OpenDocMathGallery.renderBlocks(samples[2].blocks)
  .querySelector('.slide-math-bold').style.fontWeight,'bold');
});
