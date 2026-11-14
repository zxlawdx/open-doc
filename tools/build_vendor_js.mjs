/* One offline build, native filesystem paths on Windows and POSIX. */
import {cp,mkdir,mkdtemp,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'..'),out=join(root,'apps','home','static','js','vendor'),require=createRequire(import.meta.url);
const dependencies=['esbuild','core-js','pdfjs-dist','perfect-freehand','pptx-viewer','fflate','codemirror','@codemirror/lang-python','@codemirror/lang-sql'];
await mkdir(out,{recursive:true});const marker=join(out,'.build-failed');await writeFile(marker,'Build incompleto: execute npm run build:vendor.\n');
try{for(const name of dependencies)require.resolve(name);}catch(error){console.error('Dependência de vendor ausente. Execute npm ci.\n'+error.message);process.exit(1);}
const {build}=await import('esbuild');await mkdir(out,{recursive:true});
const temporary=await mkdtemp(join(root,'.vela-vendor-'));
const hash=data=>createHash('sha256').update(data).digest('hex');

// Compatibility fixes for the pinned MIT pptx-viewer 0.2.2. Fail closed if
// upstream changes these code paths; never modify node_modules or bundle bytes.
let pptxCompatibilityApplied=false;
const pptxCompatibility={name:'opendoc-pptx-compatibility',setup(builder){
 builder.onLoad({filter:/pptx-viewer[.]js$/},async args=>{
  let source=await readFile(args.path,'utf8');
  function replace(from,to){
   if(source.split(from).length!==2)throw Error('PPTX compatibility patch no longer matches upstream: '+from.slice(0,70));
   source=source.replace(from,to);
  }
  replace('      for (const [l, c] of r)\n        if (l.includes(i) || i.includes(l))\n          return c;','      return r.get(hn(i)) || [];');
  replace('        const x = yr($, g, e, c.colors, g);',`        let theme=c;
        const rels=e.getText(jt(g));
        if(rels){
          const relationships=q(rels), relationship=relationships.getByType(rt.THEME)[0];
          const path=relationship && relationships.resolvePath(relationship.id,g);
          const xml=path && e.getText(path);
          if(xml)theme=yn(xml);
        }
        const x = yr($, g, e, theme.colors, g);
        x.theme=theme;`);
  replace('const U = Fr(E, P, e, c.colors, P, g);','const U = Fr(E, P, e, g.theme.colors, P, g);');
  replace('const E = Ar(S, b, e, c.colors, x, w, F);','const E = Ar(S, b, e, F?.theme.colors || c.colors, x, w, F);');
  replace('  for (const l of e) i(l.elements);\n  for (const l of t.values()) i(l.elements);\n  for (const l of n.values()) i(l.elements);',`  const fallback=r;
  for (const l of e){r=n.get(t.get(l.layoutId)?.masterId)?.theme || fallback;i(l.elements);}
  for (const l of t.values()){r=n.get(l.masterId)?.theme || fallback;i(l.elements);}
  for (const l of n.values()){r=l.theme || fallback;i(l.elements);}`);
  replace('function mn(e, t) {','function mn(e, t) {\n  e = t.__colorMap?.[e] || e;');
  replace('function R(e, t) {','function openDocBaseColor(e, t) {');
  replace('function Dt(e) {',`function R(e,t){
    const color=openDocBaseColor(e,t);
    if(!color)return color;
    const node=h(e,"srgbClr") || h(e,"schemeClr") || h(e,"prstClr");
    if(!node)return color;
    let rgb=[1,3,5].map(i=>parseInt(color.hex.slice(i,i+2),16)/255),changed=false;
    for(const transform of Array.from(node.children)){
      const name=transform.localName,value=C(transform,"val",100000)/100000;
      if(name!=="lumMod" && name!=="lumOff")continue;
      // DrawingML luminance changes HSL lightness, not each RGB channel.
      const low=Math.min(...rgb),high=Math.max(...rgb),light=(low+high)/2;
      const saturation=high===low?0:(high-low)/(1-Math.abs(2*light-1));
      const next=Math.max(0,Math.min(1,name==="lumMod"?light*value:light+value));
      const chroma=(1-Math.abs(2*next-1))*saturation;
      rgb=rgb.map(c=>(high===low?0:(c-low)/(high-low)*chroma)+next-chroma/2);
      changed=true;
    }
    return changed?{...color,hex:"#"+rgb.map(c=>Math.round(Math.max(0,Math.min(1,c))*255).toString(16).padStart(2,"0")).join("").toUpperCase()}:color;
  }
function Dt(e) {`);
  replace('  const p = {\n    themeColors: r,','  r = {...r, __colorMap: {...l?.colorMap, ...i?.colorMap, ...wr(o)}};\n  const p = {\n    themeColors: r,');
  replace('  const u = {\n    themeColors: r,','  r = {...r, __colorMap: Cr(l)};\n  const u = {\n    themeColors: r,');
  replace('  const d = {\n    themeColors: r,','  r = {...r, __colorMap: {...i?.colorMap, ...wr(c)}};\n  const d = {\n    themeColors: r,');
  replace('  let c = $t(l), o = null;','  let c = $t(l), o = i && t.layout ? ce(i, t.layout.elements) : null;');
  replace('  if (g && i) {\n    if (o) {\n      const F = o.text;\n      F && fr(g, F);\n    }\n    (w = t.master) != null && w.textStyles && dr(g, i, t.master.textStyles);\n  }',`  if (g) {
    const parent = o || (i && t.master ? ce(i, t.master.elements) : null);
    if(parent?.text){
      fr(g,parent.text);
      if(!h(b,"bodyPr")?.hasAttribute("anchor"))g.verticalAlign=parent.text.verticalAlign;
    }
    if(t.master?.textStyles)dr(g,i || {type:"other"},t.master.textStyles);
  }`);
  replace('  for (const a of o) {\n    const u = kn(a, t, n);',`  const styles = Nt(h(e, "lstStyle"), t);
  for (const a of o) {
    const level = C(h(a, "pPr") || a, "lvl", 0);
    const u = kn(a, t, n, styles[level] || {});`);
  replace('function kn(e, t, n) {','function kn(e, t, n, inherited = {}) {');
  replace('  for (const g of p) {\n    const $ = Pn(g, t, n);\n    r.push($);\n  }\n  M(e, "br").length > 0 && r.length === 0 && r.push({ text: "" });\n  const b = M(e, "fld");\n  for (const g of b) {\n    const $ = h(g, "t");\n    $ && r.push({ text: H($) });\n  }',`  const defaults = {...inherited, ...Ut(s ? h(s, "defRPr") : null, t, n)};
  for (const child of Array.from(e.children)) {
    if(child.localName === "r" || child.localName === "fld")r.push({...defaults, ...Pn(child,t,n)});
    else if(child.localName === "br")r.push({...defaults, ...Ut(h(child,"rPr"),t,n), text:"\\n"});
  }
  if(!r.length)r.push({...defaults, ...Ut(h(e,"endParaRPr"),t,n), text:""});`);
  replace('s = r ? H(r) : "", i = h(e, "rPr")','s = r ? r.textContent || "" : "", i = h(e, "rPr")');
  replace('Q(e, "b") && (r.bold = !0), Q(e, "i") && (r.italic = !0);',
          'e.hasAttribute("b") && (r.bold = Q(e, "b")), e.hasAttribute("i") && (r.italic = Q(e, "i"));');
  replace('i && i !== "none" && (r.underline = !0);','i && (r.underline = i !== "none");');
  replace('n.style.fontFamily = `"${e.fontFamily}", sans-serif`','n.style.fontFamily = `"${e.fontFamily}", Arial, "Liberation Sans", "DejaVu Sans", sans-serif`');
  replace('      startAt: a,','      startAt: a,\n      explicitStart: i.hasAttribute("startAt"),');
  replace('t.lastBulletType.get(s) !== u && (t.numbers.set(s, e.bullet.startAt || 1)', '(t.lastBulletType.get(s) !== u || e.bullet.explicitStart) && (t.numbers.set(s, e.bullet.startAt || 1)');
  replace('    r.appendChild(o);\n  }\n  const c = document.createElement("span");',`    const first=e.runs.find(run=>run.text.trim()) || {};
    if(!e.bullet.color && first.color)o.style.color=T(first.color);
    if(!e.bullet.font && first.fontFamily)o.style.fontFamily='"'+first.fontFamily+'", Arial, "Liberation Sans", "DejaVu Sans", sans-serif';
    if(!e.bullet.sizePercent && first.fontSize)o.style.fontSize=first.fontSize*n.fontScale+"px";
    r.appendChild(o);
  }
  const c = document.createElement("span");`);
  replace('return e.runs.length === 0 && !e.bullet && (c.innerHTML = "&nbsp;"), r.appendChild(c), r;', 'return !c.textContent && !e.bullet && ((c.firstElementChild || c).textContent = "\\u00a0"), r.appendChild(c), r;');
  replace('l && l !== "noStrike" && (r.strikethrough = !0);','l && (r.strikethrough = l !== "noStrike");');
  replace('    index: t,\n    background: A,','    index: t,\n    showMasterShapes: m(o, "showMasterSp") !== "0",\n    background: A,');
  replace('if (i.appendChild(o), r && (n == null ? void 0 : n.showMasterShapes) !== !1)', 'if (i.appendChild(o), r && e.showMasterShapes !== false && (n == null ? void 0 : n.showMasterShapes) !== !1)');
  replace('    ellipse: "ellipse",','    wave: "wave",\n    ellipse: "ellipse",');
  replace('  switch (e) {\n    case "ellipse": {',`  switch (e) {
    case "wave": {
      // DrawingML preset wave: two cubic Beziers, amplitude/phase adjustments.
      const amplitude=Math.max(0,Math.min(.2,r?.get("adj1") ?? .125));
      const phase=Math.max(-.1,Math.min(.1,r?.get("adj2") ?? 0));
      const offset=2*t*phase, negative=phase>0?0:offset, positive=phase>0?offset:0;
      const x2=-negative,x5=t-positive,step=(negative+x5)/3;
      const x3=x2+step,x4=(x3+x5)/2,x6=positive,x10=t+negative;
      const x7=x6+step,x8=(x7+x10)/2;
      const top=n*amplitude,delta=top*10/3,bottom=n-top;
      l.setAttribute("d",'M '+x2+' '+top+' C '+x3+' '+(top-delta)+' '+x4+' '+(top+delta)+' '+x5+' '+top+
        ' L '+x10+' '+bottom+' C '+x8+' '+(bottom+delta)+' '+x7+' '+(bottom-delta)+' '+x6+' '+bottom+' Z');
      return l;
    }
    case "ellipse": {`);
  pptxCompatibilityApplied=true;
  return {contents:source,loader:'js'};
 });
}};

try{
 const common={bundle:true,minify:true,target:'chrome83',platform:'browser',format:'iife',legalComments:'eof',plugins:[pptxCompatibility]};
 const entries={
  'pdf.bundle.js':"import 'core-js/actual';import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';window.OpenDocPdf=pdfjs;",
  'pdf.worker.bundle.js':"import 'core-js/actual';import {WorkerMessageHandler} from 'pdfjs-dist/legacy/build/pdf.worker.mjs';globalThis.pdfjsWorker={WorkerMessageHandler};",
  'freehand.bundle.js':"import {getStroke} from 'perfect-freehand';window.OpenDocFreehand={getStroke};",
  'pptx.bundle.js':"import {loadPresentation,renderSlideToElement} from 'pptx-viewer';window.OpenDocPptxVendor={loadPresentation,renderSlideToElement};",
  'code-editor.bundle.js':"import {basicSetup} from 'codemirror';import {EditorView,keymap,hoverTooltip} from '@codemirror/view';import {EditorState,Compartment} from '@codemirror/state';import {python} from '@codemirror/lang-python';import {sql,SQLite} from '@codemirror/lang-sql';import {autocompletion,acceptCompletion} from '@codemirror/autocomplete';import {linter} from '@codemirror/lint';import {HighlightStyle,syntaxHighlighting} from '@codemirror/language';import {tags} from '@lezer/highlight';window.OpenDocCodeVendor={basicSetup,EditorView,keymap,hoverTooltip,EditorState,Compartment,python,sql,SQLite,autocompletion,acceptCompletion,linter,HighlightStyle,syntaxHighlighting,tags};"
 };
 const files={};
 for(const [name,contents] of Object.entries(entries)){const target=join(temporary,name);await build({...common,stdin:{contents,resolveDir:root},outfile:target});execFileSync(process.execPath,['--check',target]);files[name]=hash(await readFile(target));}
 if(!pptxCompatibilityApplied)throw Error('PPTX compatibility patch was not included in the build.');
 const versions={};for(const name of dependencies)versions[name]=JSON.parse(await readFile(join(root,'node_modules',name,'package.json'),'utf8')).version;
 const source_hash=hash(Buffer.concat([await readFile(fileURLToPath(import.meta.url)),Buffer.from('\0'),await readFile(join(root,'package-lock.json'))]));
 const build_hash=hash(JSON.stringify({source_hash,files}));let previous={};try{previous=JSON.parse(await readFile(join(out,'vendor-manifest.json'),'utf8'));}catch{}
 const manifest={versions,target:'chrome83',source_hash,files,build_hash,built_at:previous.build_hash===build_hash?previous.built_at:new Date().toISOString()};
 for(const name of ['standard_fonts','cmaps'])await cp(join(root,'node_modules','pdfjs-dist',name),join(root,'apps','home','static','pdfjs',name),{recursive:true});
 for(const name of ['pdfjs-dist','perfect-freehand','core-js','pptx-viewer','fflate'])await cp(join(root,'node_modules',name,'LICENSE'),join(temporary,name+'-LICENSE.txt'));
 const lock=JSON.parse(await readFile(join(root,'package-lock.json'),'utf8'));
 const codeLicenses=[];
 for(const name of Object.keys(lock.packages).filter(path=>/^node_modules\/(?:@codemirror\/|@lezer\/|@marijn\/|codemirror$|style-mod$|w3c-keyname$|crelt$)/.test(path))){
   const license=await readFile(join(root,name,'LICENSE'),'utf8');
   codeLicenses.push(name.replace('node_modules/','')+'\n'+license);
 }
 await writeFile(join(temporary,'code-editor-LICENSE.txt'),codeLicenses.join('\n'));
 // The marker prevents startup with a partial group if any replace fails.
 for(const name of [...Object.keys(entries),'code-editor-LICENSE.txt',...['pdfjs-dist','perfect-freehand','core-js','pptx-viewer','fflate'].map(n=>n+'-LICENSE.txt')])await rename(join(temporary,name),join(out,name));
 await writeFile(join(temporary,'vendor-manifest.json'),JSON.stringify(manifest,null,2)+'\n');await rename(join(temporary,'vendor-manifest.json'),join(out,'vendor-manifest.json'));await rm(marker);
 console.info('Open Doc vendors OK',JSON.stringify({versions,target:manifest.target,build_hash}));
}catch(error){console.error('Build de vendors falhou; assets bloqueados. Execute npm ci e npm run build:vendor.\n'+error.stack);process.exitCode=1;}finally{await rm(temporary,{recursive:true,force:true});}
