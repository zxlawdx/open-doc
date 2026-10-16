/* Reproducible local bundles for QtWebEngine Chromium 87; no runtime CDN. */
import {build} from 'esbuild';
import {mkdir,cp,readFile,writeFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url),out=new URL('apps/open_doc/static/js/vendor/',root);
await mkdir(out,{recursive:true});
const common={bundle:true,minify:true,target:'chrome87',platform:'browser',format:'iife',legalComments:'eof'};
await build({...common,stdin:{contents:"import 'core-js/actual';import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';window.OpenDocPdf=pdfjs;",resolveDir:root.pathname},outfile:new URL('pdf.bundle.js',out).pathname});
await build({...common,stdin:{contents:"import 'core-js/actual';import 'pdfjs-dist/legacy/build/pdf.worker.mjs';",resolveDir:root.pathname},outfile:new URL('pdf.worker.bundle.js',out).pathname});
await build({...common,stdin:{contents:"import {getStroke} from 'perfect-freehand';window.OpenDocFreehand={getStroke};",resolveDir:root.pathname},outfile:new URL('freehand.bundle.js',out).pathname});
for(const name of ['standard_fonts','cmaps'])await cp(new URL('node_modules/pdfjs-dist/'+name,root),new URL('apps/open_doc/static/pdfjs/'+name,root),{recursive:true});
for(const [name,license] of [['pdfjs-dist','LICENSE'],['perfect-freehand','LICENSE'],['core-js','LICENSE']])await cp(new URL('node_modules/'+name+'/'+license,root),new URL(name+'-LICENSE.txt',out));
console.log('Local legacy PDF.js / worker / freehand bundles built for Chrome 87');
