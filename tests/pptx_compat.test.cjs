const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..');
let deck;
test.before(async()=>{({pptxCompatibilityFixture:deck}=await import('../tools/pptx_compat_fixture.mjs'));});
async function load(t,bytes){
 const w=new JSDOM('<div id="slide"></div>',{runScripts:'outside-only'}).window;
 w.TextDecoder=TextDecoder;w.TextEncoder=TextEncoder;w.URL.createObjectURL=()=> 'blob:local';w.URL.revokeObjectURL=()=>{};
 w.eval(fs.readFileSync(path.join(root,'apps/open_doc/static/js/vendor/pptx.bundle.js'),'utf8'));
 const presentation=await w.OpenDocPptxVendor.loadPresentation(w.Uint8Array.from(bytes));
 t.after(()=>{presentation.cleanup();w.close();});return {w,presentation};
}
const white='<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>';

test('compatibility renderer inherits paragraph defaults and respects explicit run overrides',async t=>{
 const bytes=deck(`<a:p><a:pPr><a:defRPr sz="3000" b="1" i="1" u="sng">${white}<a:latin typeface="Arial"/></a:defRPr></a:pPr><a:r><a:t>Título branco</a:t></a:r><a:r><a:rPr sz="1800" b="0" i="0" u="none"><a:solidFill><a:srgbClr val="FFA500"/></a:solidFill></a:rPr><a:t> normal</a:t></a:r></a:p>`);
 const original=Buffer.from(bytes),{w,presentation}=await load(t,bytes);
 assert.equal(presentation.slideMasters.size,0,'slide relationship must not match slideMaster');
 const runs=presentation.slides[0].elements.find(e=>e.id==='2').text.paragraphs[0].runs;
 assert.equal(runs[0].fontSize,40);assert.equal(runs[0].color.hex,'#FFFFFF');assert.equal(runs[0].bold,true);
 assert.equal(runs[1].fontSize,24);assert.equal(runs[1].color.hex,'#FFA500');assert.equal(runs[1].bold,false);assert.equal(runs[1].italic,false);assert.equal(runs[1].underline,false);
 w.OpenDocPptxVendor.renderSlideToElement(presentation,0,w.document.querySelector('#slide'),{width:960,height:540});
 const span=[...w.document.querySelectorAll('span')].find(n=>n.textContent==='Título branco'&&n.style.fontSize);
 assert.equal(span.style.fontSize,'40px');assert.equal(span.style.color,'rgb(255, 255, 255)');
 assert.equal(Buffer.compare(Buffer.from(bytes),original),0,'preview must not rewrite the PPTX');
});

test('local list levels, paragraph defaults, spaces, fields and soft breaks retain their order',async t=>{
 const list=`<a:lvl1pPr><a:defRPr sz="2400" b="1">${white}</a:defRPr></a:lvl1pPr><a:lvl2pPr><a:defRPr sz="1800"/></a:lvl2pPr>`;
 const {presentation}=await load(t,deck(`<a:p><a:pPr lvl="0"/><a:r><a:t xml:space="preserve">Antes </a:t></a:r><a:br/><a:fld id="field" type="slidenum"><a:t>2</a:t></a:fld><a:r><a:t xml:space="preserve"> depois</a:t></a:r></a:p><a:p><a:pPr lvl="1"><a:defRPr sz="2000"/></a:pPr><a:r><a:t>Nível dois</a:t></a:r></a:p>`,list));
 const paragraphs=presentation.slides[0].elements.find(e=>e.id==='2').text.paragraphs;
 assert.equal(paragraphs[0].runs.map(r=>r.text).join(''),'Antes \n2 depois');
 assert.equal(paragraphs[0].runs[0].fontSize,32);
 assert.ok(Math.abs(paragraphs[1].runs[0].fontSize-80/3)<1e-9);
});

test('wave preset renders two cubic curves instead of a rectangular replacement',async t=>{
 const {w,presentation}=await load(t,deck('<a:p/>'));
 assert.equal(presentation.slides[0].elements.find(e=>e.id==='3').shapeType,'wave');
 w.OpenDocPptxVendor.renderSlideToElement(presentation,0,w.document.querySelector('#slide'),{width:960,height:540});
 const wave=[...w.document.querySelectorAll('path')].find(p=>(p.getAttribute('d')||'').includes(' C '));
 assert.ok(wave);assert.equal((wave.getAttribute('d').match(/ C /g)||[]).length,2);
 assert.match(wave.getAttribute('d'),/^M 0 12 C /);assert.ok(!/NaN|Infinity/.test(wave.getAttribute('d')));
});

test('exact relationship types resolve masters and layouts with mapped colors and explicit placeholder bounds',async t=>{
 const {unzipSync,zipSync,strToU8,strFromU8}=require('fflate');
 const A='http://schemas.openxmlformats.org/drawingml/2006/main',P='http://schemas.openxmlformats.org/presentationml/2006/main',R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
 const files=unzipSync(deck('<a:p><a:r><a:t>Inherited layout title</a:t></a:r></a:p>'));
 const put=(name,text)=>files[name]=strToU8(text);
 const rels=items=>`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id,type,target])=>`<Relationship Id="${id}" Type="${R}/${type}" Target="${target}"/>`).join('')}</Relationships>`;
 put('ppt/_rels/presentation.xml.rels',rels([['slide','slide','slides/slide1.xml'],['master','slideMaster','slideMasters/slideMaster1.xml']]));
 put('ppt/slides/_rels/slide1.xml.rels',rels([['layout','slideLayout','../slideLayouts/slideLayout1.xml']]));
 put('ppt/slideMasters/_rels/slideMaster1.xml.rels',rels([['layout','slideLayout','../slideLayouts/slideLayout1.xml'],['theme','theme','../theme/theme2.xml']]));
 put('ppt/slideLayouts/_rels/slideLayout1.xml.rels',rels([['master','slideMaster','../slideMasters/slideMaster1.xml']]));
 put('ppt/theme/theme2.xml',`<a:theme xmlns:a="${A}" name="Master-specific theme"><a:themeElements><a:clrScheme name="Brown"><a:dk1><a:srgbClr val="4E3B30"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1></a:clrScheme></a:themeElements></a:theme>`);
 const mapped='<a:solidFill><a:schemeClr val="tx1"/></a:solidFill>';
 put('ppt/slideMasters/slideMaster1.xml',`<p:sldMaster xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${R}"><p:cSld><p:bg><p:bgPr><a:solidFill><a:schemeClr val="bg1"/></a:solidFill></p:bgPr></p:bg><p:spTree/></p:cSld><p:clrMap bg1="dk1" tx1="lt1"/><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="layout"/></p:sldLayoutIdLst></p:sldMaster>`);
 const placeholder=`<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4572000" cy="2743200"/></a:xfrm></p:spPr><p:txBody><a:bodyPr anchor="b"/><a:lstStyle><a:lvl1pPr><a:defRPr sz="3000">${mapped}</a:defRPr></a:lvl1pPr></a:lstStyle><a:p><a:r><a:t>Layout prompt</a:t></a:r></a:p></p:txBody></p:sp>`;
 put('ppt/slideLayouts/slideLayout1.xml',`<p:sldLayout xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree>${placeholder}</p:spTree></p:cSld></p:sldLayout>`);
 put('ppt/slides/slide1.xml',strFromU8(files['ppt/slides/slide1.xml']).replace('<p:nvPr/></p:nvSpPr>','<p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>'));
 const {w,presentation}=await load(t,zipSync(files));
 assert.deepEqual([...presentation.slideMasters.keys()],['ppt/slideMasters/slideMaster1.xml']);
 assert.equal(presentation.slideLayouts.size,1);
 const run=presentation.slides[0].elements.find(e=>e.id==='2').text.paragraphs[0].runs[0];
 assert.equal(run.fontSize,40);assert.equal(run.color.hex,'#FFFFFF');
 assert.equal(presentation.slides[0].elements.find(e=>e.id==='2').text.verticalAlign,'bottom');
 w.OpenDocPptxVendor.renderSlideToElement(presentation,0,w.document.querySelector('#slide'),{width:960,height:540});
 assert.equal(w.document.querySelector('svg > rect').getAttribute('fill'),'#4E3B30');
 assert.ok(!w.document.querySelector('#slide').textContent.includes('Layout prompt'));
});
