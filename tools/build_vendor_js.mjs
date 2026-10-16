/* One offline build, native filesystem paths on Windows and POSIX. */
import {cp,mkdir,mkdtemp,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'..'),out=join(root,'apps','open_doc','static','js','vendor'),require=createRequire(import.meta.url);
const dependencies=['esbuild','core-js','pdfjs-dist','perfect-freehand','pptx-viewer','fflate'];
await mkdir(out,{recursive:true});const marker=join(out,'.build-failed');await writeFile(marker,'Build incompleto: execute npm run build:vendor.\n');
try{for(const name of dependencies)require.resolve(name);}catch(error){console.error('Dependência de vendor ausente. Execute npm ci.\n'+error.message);process.exit(1);}
const {build}=await import('esbuild');await mkdir(out,{recursive:true});
const temporary=await mkdtemp(join(root,'.vela-vendor-'));
const hash=data=>createHash('sha256').update(data).digest('hex');
try{
 const common={bundle:true,minify:true,target:'chrome87',platform:'browser',format:'iife',legalComments:'eof'};
 const entries={
  'pdf.bundle.js':"import 'core-js/actual';import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';window.OpenDocPdf=pdfjs;",
  'pdf.worker.bundle.js':"import 'core-js/actual';import {WorkerMessageHandler} from 'pdfjs-dist/legacy/build/pdf.worker.mjs';globalThis.pdfjsWorker={WorkerMessageHandler};",
  'freehand.bundle.js':"import {getStroke} from 'perfect-freehand';window.OpenDocFreehand={getStroke};",
  'pptx.bundle.js':"import {loadPresentation,renderSlideToElement} from 'pptx-viewer';window.OpenDocPptxVendor={loadPresentation,renderSlideToElement};"
 };
 const files={};
 for(const [name,contents] of Object.entries(entries)){const target=join(temporary,name);await build({...common,stdin:{contents,resolveDir:root},outfile:target});execFileSync(process.execPath,['--check',target]);files[name]=hash(await readFile(target));}
 const versions={};for(const name of dependencies)versions[name]=JSON.parse(await readFile(join(root,'node_modules',name,'package.json'),'utf8')).version;
 const source_hash=hash(Buffer.concat([await readFile(fileURLToPath(import.meta.url)),Buffer.from('\0'),await readFile(join(root,'package-lock.json'))]));
 const build_hash=hash(JSON.stringify({source_hash,files}));let previous={};try{previous=JSON.parse(await readFile(join(out,'vendor-manifest.json'),'utf8'));}catch{}
 const manifest={versions,target:'chrome87',source_hash,files,build_hash,built_at:previous.build_hash===build_hash?previous.built_at:new Date().toISOString()};
 for(const name of ['standard_fonts','cmaps'])await cp(join(root,'node_modules','pdfjs-dist',name),join(root,'apps','open_doc','static','pdfjs',name),{recursive:true});
 for(const name of ['pdfjs-dist','perfect-freehand','core-js','pptx-viewer','fflate'])await cp(join(root,'node_modules',name,'LICENSE'),join(temporary,name+'-LICENSE.txt'));
 // The marker prevents startup with a partial group if any replace fails.
 for(const name of [...Object.keys(entries),...['pdfjs-dist','perfect-freehand','core-js','pptx-viewer','fflate'].map(n=>n+'-LICENSE.txt')])await rename(join(temporary,name),join(out,name));
 await writeFile(join(temporary,'vendor-manifest.json'),JSON.stringify(manifest,null,2)+'\n');await rename(join(temporary,'vendor-manifest.json'),join(out,'vendor-manifest.json'));await rm(marker);
 console.info('Open Doc vendors OK',JSON.stringify({versions,target:manifest.target,build_hash}));
}catch(error){console.error('Build de vendors falhou; assets bloqueados. Execute npm ci e npm run build:vendor.\n'+error.stack);process.exitCode=1;}finally{await rm(temporary,{recursive:true,force:true});}
