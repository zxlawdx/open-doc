/* Real QtWebEngine shape visibility proof, not a JSDOM approximation. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const port=process.argv[2]||'9234';
const destination=path.resolve(__dirname,'../docs/images/ink');
(async()=>{
 const targets=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
 const ws=new WebSocket(targets.find(item=>item.type==='page').webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
 const pending=new Map();let sequence=0;
 ws.onmessage=event=>{
  const data=JSON.parse(event.data);
  if(!pending.has(data.id))return;
  const [resolve,reject]=pending.get(data.id);pending.delete(data.id);
  data.error?reject(Error(JSON.stringify(data.error))):resolve(data.result);
 };
 const send=(method,params={})=>new Promise((resolve,reject)=>{
  const id=++sequence;pending.set(id,[resolve,reject]);ws.send(JSON.stringify({id,method,params}));
 });
 const evaluate=async expression=>{
  const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
 };
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const shot=async name=>{
   await pause(200);
   const captured=await send('Page.captureScreenshot',{format:'png'});
   fs.writeFileSync(path.join(destination,name+'.png'),Buffer.from(captured.data,'base64'));
 };
 const click=async selector=>{
   const point=await evaluate(`(()=>{
     const button=document.querySelector(${JSON.stringify(selector)});
     if(!button)throw Error('Missing visual control: '+${JSON.stringify(selector)});
     button.scrollIntoView({block:'nearest'});
     const bounds=button.getBoundingClientRect();
     return {x:bounds.left+bounds.width/2,y:bounds.top+bounds.height/2};
   })()`);
   await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
   await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
   await pause(150);
 };
 await evaluate(`(()=>{
  const ellipse=document.querySelector('.fixed-surface[data-page-index="0"] .slide-object-ellipse');
  document.querySelector('.fixed-scroll')?.scrollTo({top:0,left:0});
  ellipse?.scrollIntoView({block:'center',inline:'center'});
  return true;
 })()`);
 await pause(200);
 fs.mkdirSync(destination,{recursive:true});
 const ribbon=await evaluate(`(()=>{
   const toolbar=document.querySelector('.slide-studio-toolbar');
   const controls=document.querySelector('.fixed-controls');
   const stage=document.querySelector('.fixed-scroll');
   const direct=Array.from(toolbar?.children||[]).filter(n=>n.tagName==='BUTTON');
   const heights={};
   for(const tab of Array.from(toolbar?.querySelectorAll('.slide-ribbon-tab:not([hidden])')||[])){
     tab.click();
     const visible=toolbar.querySelector('.slide-ribbon-group:not([hidden])');
     heights[tab.textContent]=visible?.getBoundingClientRect().height||0;
   }
   const insertTab=Array.from(toolbar.querySelectorAll('.slide-ribbon-tab'))
     .find(tab=>tab.textContent==='Inserir');
   insertTab?.click();
   const insert=toolbar.querySelector('.slide-ribbon-group:not([hidden])');
   const p=insert?.getBoundingClientRect(),v=stage?.getBoundingClientRect();
   return {ribbonHeight:p?.height||0,tabHeights:heights,
     horizontalOverflow:Math.max(0,toolbar.scrollWidth-toolbar.clientWidth),
     stageHeight:v?.height||0,
     controlsHeight:controls?.getBoundingClientRect().height||0,
     directButtons:direct.map(n=>n.textContent),
     chartCommands:Array.from(insert?.querySelectorAll('.slide-ribbon-popup button')||[])
       .map(n=>n.textContent).filter(label=>label.startsWith('Gráfico:'))};
 })()`);
 await shot('pptx-compact-ribbon-and-canvas');
 // Visual regression: exact economic categories and percentages over an
 // arbitrary slide color, then the comparable white-background rendering.
 const chartCase=await evaluate(`(()=>{
   if(!window.OpenDocSlideCharts?.ChartPreview)throw Error('Charts module missing');
   const source={
     chart_type:'bar',
     chart_title:'Distribuição do PIB pela ótica da renda — Brasil, 2021',
     chart_categories:[
       'Remuneração dos empregados',
       'Excedente operacional bruto e rendimento misto bruto',
       'Impostos líquidos de subsídios'
     ],
     chart_values:[39.2,45.3,15.5],
     chart_data_labels:'both',
     chart_label_font_size:14,
     chart_label_wrap:true,
     chart_background:'transparent',
     chart_color_mode:'custom',
     chart_item_colors:['#2569D2','#F28B35','#34A876']
   };
   const host=document.createElement('div');
   host.id='qa-pib-chart';
   host.style.cssText='position:fixed;inset:7vh 8vw;z-index:99999;background:#275B43;'+
     'border:2px solid #153A30;box-shadow:0 0 0 100vmax rgba(0,0,0,.45);';
   const svg=window.OpenDocSlideCharts.ChartPreview.render(source,{
     width:740,height:420
   });
   host.append(svg);document.body.append(host);
   const names=Array.from(svg.querySelectorAll('text')).map(el=>
     Array.from(el.querySelectorAll('tspan')).map(t=>t.textContent).join(''));
   return {names,background:svg.dataset.background,
     viewBox:svg.getAttribute('viewBox'), chartIsVector:!!svg.querySelector('rect'),
     percentVisible:names.filter(name=>name.includes('%'))};
 })()`);
 assert.deepEqual(chartCase.names.filter(name=>[
     'Remuneração dos empregados',
     'Excedente operacional bruto e rendimento misto bruto',
     'Impostos líquidos de subsídios'
   ].includes(name)),[
     'Remuneração dos empregados',
     'Excedente operacional bruto e rendimento misto bruto',
     'Impostos líquidos de subsídios'
   ],'Full economic category names must survive rendering');
 assert.ok(chartCase.percentVisible.some(item=>item.includes('39,2%')));
 assert.ok(chartCase.percentVisible.some(item=>item.includes('45,3%')));
 assert.ok(chartCase.percentVisible.some(item=>item.includes('15,5%')));
 assert.equal(chartCase.background,'transparent');
 await shot('pptx-pib-transparent-full-categories-and-percentages');
 fs.writeFileSync(path.join(destination,'pptx-pib-chart-validation.json'),
   JSON.stringify(chartCase,null,2));
 await evaluate(`(()=>{
   const preview=document.querySelector('#qa-pib-chart svg');
   preview?.setAttribute('data-background','solid');
   preview?.insertBefore(document.createElementNS('http://www.w3.org/2000/svg','rect'),preview.firstChild);
   const rect=preview?.firstChild;
   if(rect){rect.setAttribute('width','100%');rect.setAttribute('height','100%');rect.setAttribute('fill','#FFFFFF');}
   return true;
 })()`);
 await shot('pptx-pib-solid-background-comparison');
 await evaluate("document.querySelector('#qa-pib-chart')?.remove()");

 fs.writeFileSync(path.join(destination,'pptx-compact-ribbon-and-canvas.json'),
   JSON.stringify(ribbon,null,2));
 assert.deepEqual(ribbon.directButtons,[],
   'Floating ungrouped ribbon buttons cover the canvas: '+JSON.stringify(ribbon));
 assert.ok(ribbon.ribbonHeight>=85&&ribbon.ribbonHeight<=105,
   'New fixed-height ribbon panel must remain bounded: '+JSON.stringify(ribbon));
 assert.ok(Object.values(ribbon.tabHeights).every(height=>
   Math.abs(height-ribbon.ribbonHeight)<=2),
   'Tabs must keep the same ribbon height: '+JSON.stringify(ribbon));
 assert.ok(ribbon.horizontalOverflow<=2,
   'PowerPoint ribbon must not require horizontal dragging: '+JSON.stringify(ribbon));
 assert.ok(ribbon.stageHeight>180,
   'Qt grid regression: ribbon collapsed .fixed-scroll to zero height; slide is not clickable: '+JSON.stringify(ribbon));
 assert.deepEqual(ribbon.chartCommands,[
   'Gráfico: Barras','Gráfico: Barras horizontais','Gráfico: Linhas',
   'Gráfico: Áreas','Gráfico: Pizza'
 ],'All chart types must be available in the ribbon menu');
 const result=await evaluate(`(()=>{
  const page=document.querySelector('.fixed-surface[data-page-index="0"]');
  const rect=page?.querySelector('.slide-object-rect');
  const ellipse=page?.querySelector('.slide-object-ellipse');
  if(!page||!rect||!ellipse)return {error:'Missing vector objects in slide DOM'};
  const b=page.getBoundingClientRect();
  const r=rect.getBoundingClientRect();
  const e=ellipse.getBoundingClientRect();
  const x=e.left+e.width/2,y=e.top+e.height/2;
  const hit=document.elementFromPoint(x,y)?.closest('[data-slide-element]')?.dataset.slideElement;
  const info=node=>({display:getComputedStyle(node).display,
   visibility:getComputedStyle(node).visibility,
   opacity:getComputedStyle(node).opacity});
  return {
   page:{x:b.left,y:b.top,width:b.width,height:b.height},
   rect:{x:r.left,y:r.top,width:r.width,height:r.height,
     fill:rect.querySelector('svg rect')?.getAttribute('fill'),...info(rect)},
   ellipse:{x:e.left,y:e.top,width:e.width,height:e.height,
     fill:ellipse.querySelector('svg ellipse')?.getAttribute('fill'),...info(ellipse)},
   hit,ellipseId:ellipse.dataset.slideElement,
   hitElement:document.elementFromPoint(x,y)?.outerHTML.slice(0,350)||null,
   hitPoint:{x,y},
   viewport:{width:innerWidth,height:innerHeight}
  };
 })()`);
 assert.ok(!result.error,JSON.stringify(result));
 for(const name of ['rect','ellipse']){
  const b=result[name];
  assert.ok(b.width>15&&b.height>15&&b.display!=='none'&&b.visibility!=='hidden'&&Number(b.opacity)>0,JSON.stringify(result));
  assert.ok(b.x>=result.page.x-1&&b.y>=result.page.y-1&&b.x+b.width<=result.page.x+result.page.width+1&&b.y+b.height<=result.page.y+result.page.height+1,JSON.stringify(result));
 }
 assert.ok(result.hitPoint.y>=0&&result.hitPoint.y<result.viewport.height,'SVG target outside Qt viewport: '+JSON.stringify(result));
 if(result.hit!==result.ellipseId){
   fs.mkdirSync(destination,{recursive:true});
   await shot('slide-svg-hit-failure');
   const details=await evaluate(`(()=>{
     const node=document.querySelector('.fixed-surface[data-page-index="0"] .slide-object-ellipse');
     const box=node.getBoundingClientRect(),x=box.left+box.width/2,y=box.top+box.height/2;
     const ancestry=[];let current=node;
     while(current&&ancestry.length<12){
       const style=getComputedStyle(current),r=current.getBoundingClientRect();
       ancestry.push({tag:current.tagName,className:String(current.className).slice(0,120),
         pointerEvents:style.pointerEvents,overflow:style.overflow,
         zIndex:style.zIndex,position:style.position,
         rect:{x:r.x,y:r.y,width:r.width,height:r.height}});
       current=current.parentElement;
     }
     return {point:{x,y},stack:document.elementsFromPoint(x,y).slice(0,12).map(el=>({
       tag:el.tagName,className:String(el.className).slice(0,120),
       pointerEvents:getComputedStyle(el).pointerEvents,
       slideElement:el.closest('[data-slide-element]')?.dataset.slideElement||null
     })),ancestry};
   })()`);
   fs.writeFileSync(path.join(destination,'slide-svg-hit-failure.json'),JSON.stringify({result,details},null,2));
 }
 assert.equal(result.hit,result.ellipseId,'Top SVG shape must be selectable: '+JSON.stringify(result));
 assert.equal(result.rect.fill,'#DAE2FD');
 assert.equal(result.ellipse.fill.toUpperCase(),'#F4B183');
 fs.mkdirSync(destination,{recursive:true});
 const png=await send('Page.captureScreenshot',{format:'png'});
 const file=path.join(destination,'slide-svg-shapes.png');
 const geometry=path.join(destination,'slide-svg-shapes.json');
 fs.writeFileSync(file,Buffer.from(png.data,'base64'));
 fs.writeFileSync(geometry,JSON.stringify(result,null,2));
 console.log('QT_SLIDE_SVG_DOM_AND_HIT_TEST_OK',geometry);
 // Regression reported by Windows users: the "Endereço" dialog was placed
 // outside the clickable region because Chromium 83 ignores CSS inset:0.
 await evaluate('(()=>{OpenDocApp.action("link");return true})()');
 let dialogOpen=false;
 for(let i=0;i<24;i++){
  dialogOpen=await evaluate("document.querySelector('[data-dialog]')?.hidden===false");
  if(dialogOpen)break;
  await new Promise(resolve=>setTimeout(resolve,125));
 }
 assert.ok(dialogOpen,'The link dialog must open before Cancel can be tested');
 const dialog=await evaluate(`(()=>{
   const overlay=document.querySelector('[data-dialog]');
   const cancel=document.querySelector('[data-dialog-cancel]');
   const back=overlay.getBoundingClientRect(),c=cancel.getBoundingClientRect();
   const x=c.x+c.width/2,y=c.y+c.height/2;
   return {back:{x:back.x,y:back.y,width:back.width,height:back.height},
     cancel:{x,y,width:c.width,height:c.height},
     hit:document.elementFromPoint(x,y)?.closest('[data-dialog-cancel]')===cancel,
     hidden:overlay.hidden,display:getComputedStyle(overlay).display,
     viewport:{width:innerWidth,height:innerHeight}};
 })()`);
 assert.ok(dialog.back.width>=dialog.viewport.width-2 &&
   dialog.back.height>=dialog.viewport.height-2,
   'Modal backdrop does not cover legacy Qt viewport: '+JSON.stringify(dialog));
 assert.ok(dialog.hit,'Cancel must receive actual pointer input: '+JSON.stringify(dialog));
 const dialogShot=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync(path.join(destination,'slide-link-dialog.png'),Buffer.from(dialogShot.data,'base64'));
 for(const type of ['mousePressed','mouseReleased'])
   await send('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,
     x:dialog.cancel.x,y:dialog.cancel.y});
 const cancelled=await evaluate(`(()=>{
   const el=document.querySelector('[data-dialog]');
   return {hidden:el.hidden,display:getComputedStyle(el).display,
     inlineDisplay:el.style.display};
 })()`);
 assert.equal(cancelled.hidden,true,'Cancel should hide link dialog');
 assert.equal(cancelled.display,'none','Dialog should not remain on screen after Cancel');
 console.log('QT_DIALOG_CANCEL_POINTER_AND_VISIBILITY_OK');

 const added=await evaluate("(()=>{const input=document.querySelector('.slide-studio-toolbar input[type=file]');if(!input)return false;const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGMUSTnxn4GBgYGJAQoAIXQCQ5eZzjUAAAAASUVORK5CYII='),c=>c.charCodeAt(0));const file=new File([bytes],'qt-pixel.png',{type:'image/png'});Object.defineProperty(input,'files',{configurable:true,value:[file]});input.dispatchEvent(new Event('change',{bubbles:true}));return true;})()");
 assert.ok(added,'Qt file input for slide images missing');
 let decoded=false;
 for(let attempt=0;attempt<40;attempt++){
   decoded=await evaluate("(()=>{const img=document.querySelector('.fixed-scroll .fixed-surface .slide-object-image img');return !!img&&img.complete&&img.naturalWidth===2&&img.naturalHeight===2;})()");
   if(decoded)break;
   await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.ok(decoded,'Qt did not decode slide image after FileReader input');
 // Exercise real Qt controls, the rendered non-destructive crop and the
 // persisted model before validating the screenshot and native PPTX.
 const cropped=await evaluate(`(()=>{
   const item=document.querySelector('.fixed-scroll .fixed-surface .slide-object-image');
   const label=Array.from(document.querySelectorAll('.slide-inspector label'))
     .find(el=>el.textContent.includes('Recorte esquerdo (%)'));
   if(!item||!label)return {error:'Image crop Inspector control missing'};
   const field=label.querySelector('input');
   field.value='25';field.dispatchEvent(new Event('change',{bubbles:true}));
   const updated=document.querySelector('.fixed-scroll .fixed-surface .slide-object-image');
   const viewport=updated.querySelector('.slide-image-crop');
   const picture=viewport?.querySelector('img');
   const source=OpenDocApp.editor().snapshot().content.surfaces[0].elements.find(
     obj=>obj.id===updated.dataset.slideElement);
   return {fraction:source?.crop_left,clip:getComputedStyle(viewport).overflow,
     fullWidth:picture?.getBoundingClientRect().width,
     visibleWidth:viewport.getBoundingClientRect().width};
 })()`);
 assert.ok(!cropped.error,JSON.stringify(cropped));
 assert.ok(Math.abs(cropped.fraction-.25)<.000001,'Qt image crop must persist: '+JSON.stringify(cropped));
 assert.equal(cropped.clip,'hidden');
 assert.ok(cropped.fullWidth>cropped.visibleWidth*1.30,
   'Qt must keep full image pixels behind non-destructive crop viewport: '+JSON.stringify(cropped));
 console.log('QT_SLIDE_IMAGE_CROP_INSPECTOR_AND_GEOMETRY_OK');
 await evaluate("(()=>{const item=document.querySelector('.fixed-scroll .fixed-surface .slide-object-image');item?.scrollIntoView({block:'center',inline:'center'});return true})()");
 await pause(200);
 const imageGeometry=await evaluate("(()=>{const item=document.querySelector('.fixed-scroll .fixed-surface .slide-object-image');const box=item.getBoundingClientRect();const x=box.left+box.width/2,y=box.top+box.height/2;const top=document.elementFromPoint(x,y);return {x:box.x,y:box.y,width:box.width,height:box.height,hit:top?.closest('[data-slide-element]')?.dataset.slideElement,hitElement:top?.outerHTML.slice(0,350),imageId:item.dataset.slideElement,viewport:{width:innerWidth,height:innerHeight}};})()");
 assert.ok(imageGeometry.width>20&&imageGeometry.height>20,'Qt slide image has zero size: '+JSON.stringify(imageGeometry));
 if(imageGeometry.hit!==imageGeometry.imageId){
   fs.mkdirSync(destination,{recursive:true});
   await shot('slide-image-hit-failure');
   const details=await evaluate(`(()=>{
     const item=document.querySelector('.fixed-scroll .fixed-surface .slide-object-image');
     const b=item.getBoundingClientRect(),x=b.left+b.width/2,y=b.top+b.height/2;
     return {point:{x,y},stack:document.elementsFromPoint(x,y).slice(0,12).map(el=>({
       tag:el.tagName,className:String(el.className).slice(0,120),
       pointerEvents:getComputedStyle(el).pointerEvents,
       slideElement:el.closest('[data-slide-element]')?.dataset.slideElement||null
     }))};
   })()`);
   fs.writeFileSync(path.join(destination,'slide-image-hit-failure.json'),JSON.stringify({imageGeometry,details},null,2));
 }
 assert.equal(imageGeometry.hit,imageGeometry.imageId,'Qt slide image not selectable');
 const imageShot=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync(path.join(destination,'slide-native-image.png'),Buffer.from(imageShot.data,'base64'));
 fs.writeFileSync(path.join(destination,'slide-native-image.json'),JSON.stringify(imageGeometry,null,2));
 console.log('QT_SLIDE_NATIVE_IMAGE_VISIBLE_AND_SELECTABLE_OK');
 // Real QtWebEngine viewport regression: PowerPoint-style one active slide.
 // Check the actual physical DOM/geometry and screenshot at two sizes.
 const initialCanvas=await evaluate(`(()=>{
   const scroller=document.querySelector('.fixed-scroll');
   return {pages:scroller.querySelectorAll('.fixed-surface').length,
     active:scroller.querySelector('.fixed-surface')?.dataset.pageIndex,
     thumbnails:document.querySelectorAll('.fixed-sidebar [data-thumbnail-index]').length,
     workspace:!!scroller.querySelector('.slide-active-workspace')};
 })()`);
 assert.deepEqual(initialCanvas,{pages:1,active:'0',thumbnails:1,workspace:true});
 await evaluate("Array.from(document.querySelectorAll('.slide-studio-toolbar button')).find(b=>b.textContent==='+ Slide').click()");
 const second=await evaluate(`(()=>{
   const scroller=document.querySelector('.fixed-scroll');
   return {pages:scroller.querySelectorAll('.fixed-surface').length,
     index:scroller.querySelector('.fixed-surface')?.dataset.pageIndex,
     thumbs:document.querySelectorAll('.fixed-sidebar [data-thumbnail-index]').length,
     current:document.querySelector('.fixed-sidebar [data-thumbnail-index="1"]')?.getAttribute('aria-current')};
 })()`);
 assert.deepEqual(second,{pages:1,index:'1',thumbs:2,current:'true'},
   'Selecting slide 2 must replace physical slide 1, not stack it');
 await click('.fixed-sidebar [data-thumbnail-index="0"]');
 assert.equal(await evaluate("document.querySelector('.fixed-scroll .fixed-surface').dataset.pageIndex"),'0');
 assert.equal(await evaluate("document.querySelectorAll('.fixed-scroll .fixed-surface').length"),1);
 await click('.fixed-sidebar [data-thumbnail-index="1"]');
 assert.equal(await evaluate("document.querySelector('.fixed-scroll .fixed-surface').dataset.pageIndex"),'1');
 for(const [width,height] of [[1366,768],[1920,1080]]){
   await send('Emulation.setDeviceMetricsOverride',
     {width,height,deviceScaleFactor:1,mobile:false});
   await pause();await pause();
   const result=await evaluate(`(()=>{
     const viewport=document.querySelector('.fixed-scroll');
     const canvas=viewport.querySelector('.fixed-surface');
     const side=document.querySelector('.fixed-sidebar');
     const inspector=document.querySelector('.slide-inspector');
     const p=canvas.getBoundingClientRect(),v=viewport.getBoundingClientRect();
     const model=OpenDocApp.editor().snapshot().content;
     const slide=model.surfaces[1];
     return {pages:viewport.querySelectorAll('.fixed-surface').length,
       thumbs:document.querySelectorAll('.fixed-sidebar [data-thumbnail-index]').length,
       ratio:p.width/p.height,expected:slide.width_pt/slide.height_pt,
       centerX:(p.left+p.right)/2,workspaceCenterX:v.left+viewport.clientWidth/2,
       fits:p.width<=v.width+1&&p.height<=v.height+1,
       sidebarWidth:side.getBoundingClientRect().width,
       inspectorWidth:inspector.getBoundingClientRect().width,
       page:{left:p.left,top:p.top,width:p.width,height:p.height},
       viewport:{left:v.left,top:v.top,width:v.width,height:v.height}};
   })()`);
   assert.equal(result.pages,1,'Qt main workspace contains one slide');
   assert.equal(result.thumbs,2,'Qt thumbnails remain independent');
   assert.ok(Math.abs(result.ratio-result.expected)<.02,
     'Qt active slide aspect ratio changed: '+JSON.stringify(result));
   assert.ok(result.sidebarWidth>110&&result.inspectorWidth>160,
     'The two side panels must stay visible: '+JSON.stringify(result));
   if(result.fits)assert.ok(Math.abs(result.centerX-result.workspaceCenterX)<3,
     'Active slide is not centered in viewport: '+JSON.stringify(result));
   await shot('pptx-one-slide-'+width);
 }
 console.log('QT_PPTX_SINGLE_ACTIVE_CANVAS_THUMBNAILS_GEOMETRY_2_RESOLUTIONS_OK');

 // New visual regression coverage: test real table and shape icons in Qt.
 await send('Emulation.setDeviceMetricsOverride',{width:1600,height:900,deviceScaleFactor:1,mobile:false});
 for(const label of ['Tabela','Estrela']){
   const clicked=await evaluate(`(()=>{
     const button=Array.from(document.querySelectorAll('.slide-studio-toolbar button'))
       .find(b=>b.textContent.trim()===${JSON.stringify(label)});
     if(!button)return false;
     button.click();return true;
   })()`);
   assert.ok(clicked,'Missing toolbar action '+label);
   if(label==='Tabela'){
     let ready=false;
     for(let attempt=0;attempt<40&&!ready;attempt++){
       ready=await evaluate("!!document.querySelector('[data-dialog]:not([hidden]) .table-csv-file')");
       if(!ready)await pause(100);
     }
     assert.ok(ready,'PPTX table must open the shared insertion dialog');
     await evaluate(`(()=>{
       const body=document.querySelector('[data-dialog-body]');
       const data=body.querySelector('textarea');
       data.value='Produto;Valor\\nPesquisa;42';
       data.dispatchEvent(new Event('input',{bubbles:true}));
       body.querySelector('input[type=checkbox]').checked=true;
       document.querySelector('[data-dialog-confirm]').click();
     })()`);
     for(let attempt=0;attempt<40;attempt++){
       if(await evaluate("!!document.querySelector('.fixed-scroll .slide-native-table')"))break;
       await pause(100);
     }
     const cell='.fixed-scroll .slide-native-table tr:nth-child(2) td:nth-child(2)';
     await click(cell);await click(cell);
     const result=await evaluate(`(()=>{
       const input=document.querySelector('.slide-table-cell-editor');
       if(!input)return null;
       const before=input.value;
       input.value='45,3';
       input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
       const table=document.querySelector('.fixed-scroll .slide-native-table');
       const cell=table.rows[1].cells[1];
       return {before,after:cell.textContent,background:getComputedStyle(cell).backgroundColor};
     })()`);
     assert.deepEqual(result,{before:'42',after:'45,3',background:'rgba(0, 0, 0, 0)'});
     await shot('pptx-table-transparent-csv-inline-edit');
   }
 }
 const qaObjects=await evaluate(`(()=>{
   const slide=document.querySelector('.fixed-scroll .fixed-surface');
   const table=slide?.querySelector('.slide-object-table table');
   const star=slide?.querySelector('.slide-object-star svg');
   const icons=['Tabela','Estrela','Nuvem','Hexágono','Pentágono','Chevron','Paralelogramo']
     .map(label=>{
       const button=Array.from(document.querySelectorAll('.slide-studio-toolbar button'))
         .find(b=>b.textContent.trim()===label);
       return {label,svg:button?.querySelector('svg use')?.getAttribute('href')||''};
     });
   const page=slide?.getBoundingClientRect(),rect=table?.getBoundingClientRect();
   return {rows:table?.rows.length,cells:table?.querySelectorAll('td,th').length,
     star:!!star,icons,fits:!!(page&&rect&&rect.width>20&&rect.height>20&&
     rect.left>=page.left-1&&rect.right<=page.right+1)};
 })()`);
 assert.equal(qaObjects.rows,2,'Qt table must render two rows');
 assert.equal(qaObjects.cells,4,'Qt table must render four cells');
 assert.ok(qaObjects.star&&qaObjects.fits,'Table or star missing/overflowing slide');
 for(const icon of qaObjects.icons)
   assert.ok(icon.svg.includes('#'),'Missing SVG symbol: '+icon.label);
 await shot('pptx-new-table-shapes-svg-1600');
 fs.writeFileSync(path.join(destination,'pptx-new-table-shapes-svg.json'),
   JSON.stringify(qaObjects,null,2));
 console.log('QT_PPTX_TABLE_SHAPES_SVG_SCREENSHOT_OK');


 // Regression from Linux Mint: bullets, inline edit, and removing bullets
 // must render exactly one paragraph layer and never freeze the editor.
 const bulletScene=await evaluate(`(()=>{
   const toolbar=document.querySelector('.slide-studio-toolbar');
   const textButton=Array.from(toolbar.querySelectorAll('button'))
     .find(b=>b.textContent.trim()==='Texto');
   if(!textButton)throw Error('Missing new text command');
   textButton.click();
   const field=document.querySelector('.slide-inspector textarea');
   if(!field)throw Error('Missing text inspector editor');
   field.value='A economia estuda produção e consumo.\\n\\nA política econômica organiza relações sociais.';
   field.dispatchEvent(new Event('change',{bubbles:true}));
   const button=Array.from(document.querySelectorAll('.slide-context-panel button'))
     .find(b=>b.textContent.trim()==='Marcadores');
   if(!button)throw Error('Missing bullet command');
   button.click();
   const obj=document.querySelector('.fixed-scroll .slide-object-text[data-selected=true]');
   if(!obj)throw Error('No selected text on slide');
   return {paragraphs:obj.querySelectorAll('.slide-text-paragraph').length,
     markers:obj.querySelectorAll('.slide-text-marker').length,
     content:obj.querySelector('.slide-text-content')?.textContent};
 })()`);
 assert.equal(bulletScene.paragraphs,3);
 assert.equal(bulletScene.markers,2);
 await shot('pptx-bullet-list-qt-normal');

 const editing=await evaluate(`(()=>{
   const obj=document.querySelector('.fixed-scroll .slide-object-text[data-selected=true]');
   obj.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}));
   const textarea=obj.querySelector('.slide-inline-editor');
   const old=obj.querySelector('.slide-text-content');
   if(!textarea||!old)throw Error('List did not enter editable mode');
   return {field:textarea.value,oldLayerHidden:getComputedStyle(old).display==='none',
     oldVisible:old.getBoundingClientRect().height};
 })()`);
 assert.ok(editing.oldLayerHidden,'Old bullet DOM must be hidden during editing');
 assert.equal(editing.oldVisible,0);
 await shot('pptx-bullet-list-qt-inline-no-overlay');

 const removed=await evaluate(`(()=>{
   const editor=document.querySelector('.slide-inline-editor');
   editor.value='A economia estuda produção e consumo.\\n\\nRelações sociais revisadas.';
   editor.dispatchEvent(new KeyboardEvent('keydown',{
     key:'Enter',ctrlKey:true,bubbles:true,cancelable:true}));
   const button=Array.from(document.querySelectorAll('.slide-context-panel button'))
     .find(b=>b.textContent.trim()==='Marcadores');
   if(!button)throw Error('No bullet toggle after editing');
   button.click();
   const obj=document.querySelector('.fixed-scroll .slide-object-text[data-selected=true]');
   return {markers:obj.querySelectorAll('.slide-text-marker').length,
     paragraphs:obj.querySelectorAll('.slide-text-paragraph').length,
     source:obj.querySelector('.slide-text-content')?.textContent};
 })()`);
 assert.equal(removed.markers,0,'Removing bullets must clear every marker');
 assert.equal(removed.paragraphs,3);
 assert.ok(removed.source.includes('Relações sociais revisadas.'));
 await shot('pptx-bullet-list-qt-after-removal');
 fs.writeFileSync(path.join(destination,'pptx-bullet-list-qt.json'),
   JSON.stringify({bulletScene,editing,removed},null,2));
 console.log('QT_PPTX_BULLET_LIST_INLINE_TEXT_NO_OVERLAY_OK');

 // Restore the original slide to allow the subsequent persistence/export
 // smoke to append text to the four existing shapes on slide 1.
 await click('.fixed-sidebar [data-thumbnail-index="0"]');
 assert.equal(await evaluate("document.querySelector('.fixed-scroll .fixed-surface')?.dataset.pageIndex"),'0');
 ws.close();
})().catch(error=>{console.error(error);process.exit(1);});
