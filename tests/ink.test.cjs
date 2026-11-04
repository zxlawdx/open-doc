/* Pressure, cancellation, palm rejection and context-menu regression. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom'),{getStroke}=require('perfect-freehand');
const source=name=>fs.readFileSync(path.resolve(__dirname,'../apps/open_doc/static/js/'+name),'utf8');
function setup(t){const dom=new JSDOM('<div data-app><div class="toolbar"></div><div class="document-page" data-page-index="0"><div data-page-content><p data-node-id="p1">Text</p></div></div></div>',{runScripts:'outside-only'}),w=dom.window,root=w.document.querySelector('[data-app]'),controller=new w.AbortController();delete w.structuredClone;w.eval(source('compat.js'));w.requestAnimationFrame=fn=>setTimeout(fn,0);w.OpenDocFreehand={getStroke};w.OpenDocModel={id:()=>Math.random().toString(36).slice(2)};w.pywebview={api:{}};w.eval(source('ink.js'));let layers=[],writes=0;const editor={inkLayers:()=>layers,setInkLayers:v=>{layers=v;writes++;},format:()=>{},snapshot:()=>({id:'ink-test'})};w.OpenDocInk.create({root,editor,status:()=>{},signal:controller.signal});const svg=root.querySelector('svg');svg.getBoundingClientRect=()=>({left:0,top:0,width:900,height:1200});svg.setPointerCapture=()=>{};
function event(type,x,y,extra={}){const e=new w.MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0});for(const [k,v] of Object.entries({pointerId:1,pointerType:'pen',pressure:.7,tiltX:10,tiltY:-12,...extra}))Object.defineProperty(e,k,{value:v});svg.dispatchEvent(e);}
t.after(()=>{controller.abort();w.close();});return {w,root,svg,event,layers:()=>layers,writes:()=>writes};}
test('pen pressure is local until pointerup; geometry and outline are normalized',t=>{const s=setup(t);s.root.querySelector('[data-ink-mode=pen]').click();s.event('pointerdown',90,120,{pressure:.2});s.event('pointermove',180,240,{pressure:.8});assert.equal(s.writes(),0);s.event('pointerup',270,300);assert.equal(s.writes(),1);const stroke=s.layers()[0].strokes[0];assert.equal(stroke.points[0].pressure,.2);assert.equal(stroke.points[0].tilt_y,-12);assert.ok(stroke.outline.length>3);assert.ok(stroke.outline.flat().every(n=>Number.isFinite(n)&&n>=0&&n<=1));});
test('touch palm and cancelled pen never commit ink',t=>{const s=setup(t);s.root.querySelector('[data-ink-mode=pen]').click();s.event('pointerdown',10,20,{pointerType:'touch'});s.event('pointerup',10,20,{pointerType:'touch'});assert.equal(s.writes(),0);s.event('pointerdown',10,20);s.event('pointercancel',20,30);assert.equal(s.writes(),0);});
test('empty coalesced events falls back to the current event',t=>{const s=setup(t);s.root.querySelector('[data-ink-mode=pen]').click();s.event('pointerdown',20,20);s.event('pointermove',200,200,{getCoalescedEvents:()=>[]});s.event('pointerup',300,300);assert.ok(s.layers()[0].strokes[0].points.some(p=>p.x>.3));});
test('right-click margin opens menu; left click and editable text keep native behavior',t=>{const s=setup(t),controller=new s.w.AbortController();s.w.eval(source('page_menu.js'));s.w.OpenDocPageMenu.create(s.root,{insertPage:()=>{}},controller.signal);const page=s.root.querySelector('.document-page'),menu=s.root.querySelector('[data-page-menu]');page.dispatchEvent(new s.w.MouseEvent('click',{bubbles:true,button:0}));assert.equal(menu.hidden,true);const right=new s.w.MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2});page.dispatchEvent(right);assert.equal(menu.hidden,false);assert.equal(right.defaultPrevented,true);const text=new s.w.MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2});s.root.querySelector('p').dispatchEvent(text);assert.equal(menu.hidden,true);assert.equal(text.defaultPrevented,false);controller.abort();});

test('ink commits when structuredClone is unavailable',t=>{const s=setup(t);delete s.w.structuredClone;s.root.querySelector('[data-ink-mode=pen]').click();s.event('pointerdown',20,30);s.event('pointermove',120,130);s.event('pointerup',220,230);assert.equal(s.writes(),1);assert.equal(s.layers()[0].strokes.length,1);});
test('JSON clone works with a native structuredClone present or absent',t=>{const s=setup(t),value={a:[1,true,null,'Olá']};for(const native of [undefined,structuredClone]){s.w.structuredClone=native;const copy=s.w.OpenDocCompat.cloneJson(value);assert.equal(JSON.stringify(copy),JSON.stringify(value));assert.notEqual(copy,value);}assert.equal(s.w.OpenDocCompat.cloneJson(undefined),undefined);});

test('ink_suppresses_synthetic_click and auxclick without affecting cursor',t=>{const s=setup(t);let clicks=0,downs=0;s.root.addEventListener('click',()=>clicks++);s.root.addEventListener('pointerdown',()=>downs++);s.root.querySelector('[data-ink-mode=pen]').click();clicks=0;s.event('pointerdown',20,30);s.event('pointermove',100,100);s.event('pointerup',200,200);s.event('click',200,200);s.event('auxclick',200,200);assert.equal(clicks,0);assert.equal(downs,0);s.root.querySelector('[data-ink-mode=cursor]').click();clicks=0;s.event('click',20,30);assert.equal(clicks,1);});
test('toolbar_click_is_not_suppressed_immediately_after_stroke',t=>{const s=setup(t),cursor=s.root.querySelector('[data-ink-mode=cursor]');s.root.querySelector('[data-ink-mode=pen]').click();s.event('pointerdown',20,30);s.event('pointermove',100,100);s.event('pointerup',200,200);const click=new s.w.MouseEvent('click',{bubbles:true,cancelable:true,detail:1});cursor.dispatchEvent(click);assert.equal(click.defaultPrevented,false);assert.equal(s.root.dataset.inkMode,'cursor');});
test('ink_pointer_capture_safe and lostpointercapture after up preserve committed pressure',t=>{const s=setup(t);s.svg.setPointerCapture=()=>{throw Error('capture unavailable');};s.svg.releasePointerCapture=()=>{s.event('lostpointercapture',0,0);};s.root.querySelector('[data-ink-mode=pen]').click();s.event('pointerdown',20,30);s.event('pointermove',120,130);s.event('pointerup',220,230);s.event('lostpointercapture',0,0);assert.equal(s.writes(),1);assert.equal(s.layers()[0].strokes[0].points[0].pressure,.7);});
test('handwriting_button_disabled_without_backend',async t=>{const s=setup(t);await new Promise(r=>setTimeout(r,5));const button=Array.from(s.root.querySelectorAll('button')).find(b=>b.textContent==='Converter escrita');assert.equal(button.disabled,true);assert.match(s.root.querySelector('[data-handwriting-status]').textContent,/indisponível/);s.w.pywebview.api.handwriting_capabilities=async()=>({backends:[{backend:'qa-fake',available:true,language:'pt-BR'}]});s.root.dispatchEvent(new s.w.Event('open-doc:handwriting-capabilities'));await new Promise(r=>setTimeout(r,5));assert.equal(button.disabled,false);});
test('handwriting_error_preserves_strokes',async t=>{const s=setup(t);s.w.pywebview.api.handwriting_capabilities=async()=>({backends:[{backend:'qa-fake',available:true}]});s.w.pywebview.api.recognize_handwriting=async()=>({error:'idioma ausente'});s.root.dispatchEvent(new s.w.Event('open-doc:handwriting-capabilities'));await new Promise(r=>setTimeout(r,5));s.root.querySelector('[data-ink-mode=handwriting]').click();s.event('pointerdown',20,30);s.event('pointerup',100,100);const before=JSON.stringify(s.layers());Array.from(s.root.querySelectorAll('button')).find(b=>b.textContent==='Converter escrita').click();await new Promise(r=>setTimeout(r,5));assert.equal(JSON.stringify(s.layers()),before);});

test('pen_never_becomes_eraser_from_button_flags',t=>{const s=setup(t);s.root.querySelector('[data-ink-mode=pen]').click();s.event('pointerdown',100,100);s.event('pointermove',150,150);s.event('pointerup',200,200);assert.equal(s.layers()[0].strokes.length,1);s.event('pointerdown',100,100,{button:5,buttons:32});s.event('pointermove',150,150,{button:5,buttons:32});s.event('pointerup',200,200,{button:5,buttons:0});assert.equal(s.layers()[0].strokes.length,2);assert.equal(s.w.OpenDocInk.shouldErase('pen'),false);assert.equal(s.w.OpenDocInk.shouldErase('handwriting'),false);assert.equal(s.w.OpenDocInk.shouldErase('highlighter'),false);assert.equal(s.w.OpenDocInk.shouldErase('eraser'),true);});

test('pen_curve_with_eraser_bit_does_not_delete_previous_strokes',t=>{const s=setup(t);s.root.querySelector('[data-ink-mode=pen]').click();s.event('pointerdown',420,420);s.event('pointermove',460,420);s.event('pointerup',500,420);const before=s.layers()[0].strokes[0].id;s.event('pointerdown',420,420,{buttons:32});for(const [x,y] of [[450,390],[480,420],[450,450],[420,420],[450,360]])s.event('pointermove',x,y,{buttons:32});s.event('pointerup',450,360,{buttons:0});assert.equal(s.layers()[0].strokes.length,2);assert.equal(s.layers()[0].strokes[0].id,before);});

test('pointercancel_from_another_pointer_does_not_cancel_active_pen',t=>{const s=setup(t);s.root.querySelector('[data-ink-mode=pen]').click();s.event('pointerdown',20,20,{pointerId:7});s.event('pointercancel',30,30,{pointerId:8});s.event('pointermove',100,100,{pointerId:7});s.event('pointerup',160,160,{pointerId:7});assert.equal(s.layers()[0].strokes.length,1);});

test('ink overlay tracks the page border box and not padded text content',async t=>{
 const context=setup(t),page=context.root.querySelector('.document-page');
 Object.defineProperty(page,'clientWidth',{configurable:true,get:()=>794});
 Object.defineProperty(page,'clientHeight',{configurable:true,get:()=>1123});
 context.root.dispatchEvent(new context.w.Event('open-doc:layout'));
 await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(context.svg.style.left,'0px');
 assert.equal(context.svg.style.top,'0px');
 assert.equal(context.svg.style.width,'794px');
 assert.equal(context.svg.style.height,'1123px');
 context.root.querySelector('[data-ink-mode=pen]').click();
 context.event('pointerdown',400,600);
 context.event('pointermove',1500,1600);
 context.event('pointerup',1700,1800);
 const stroke=context.layers()[0].strokes[0];
 assert.ok(stroke.points.every(p=>p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1));
 assert.ok(stroke.outline.flat().every(value=>value>=0&&value<=1));
});

test('partial eraser cuts only the crossed part of a long, sparsely sampled line',t=>{
 const q=setup(t);
 q.root.querySelector('[data-ink-mode=pen]').click();
 q.event('pointerdown',100,600);q.event('pointermove',800,600);q.event('pointerup',800,600);
 const before=q.layers()[0].strokes[0],writes=q.writes();
 assert.equal(before.points.length,2);
 q.root.querySelector('[data-ink-mode=eraser-partial]').click();
 assert.equal(q.root.dataset.inkMode,'eraser-partial');
 q.event('pointerdown',450,560);q.event('pointermove',450,640);
 assert.equal(q.writes(),writes,'one history entry only at pointerup');
 q.event('pointerup',450,640);
 const parts=q.layers()[0].strokes;
 assert.equal(q.writes(),writes+1);
 assert.equal(parts.length,2,'the two visible pieces survive');
 assert.equal(parts[0].id,before.id);
 assert.notEqual(parts[1].id,parts[0].id);
 assert.equal(parts[0].color,before.color);assert.equal(parts[1].color,before.color);
 assert.ok(parts.every(p=>p.outline.length>=3 && p.points.length>1));
 assert.ok(parts[0].points.every(p=>p.x*900<450));
 assert.ok(parts[1].points.every(p=>p.x*900>450));
});

test('whole-stroke eraser deletes the entire line after a single touch',t=>{
 const q=setup(t);
 q.root.querySelector('[data-ink-mode=pen]').click();
 q.event('pointerdown',90,240);q.event('pointermove',810,240);q.event('pointerup',810,240);
 assert.equal(q.layers()[0].strokes.length,1);
 q.root.querySelector('[data-ink-mode=eraser]').click();
 assert.equal(q.w.OpenDocInk.shouldErase('eraser'),true);
 assert.equal(q.w.OpenDocInk.shouldErase('eraser-partial'),true);
 q.event('pointerdown',450,240);q.event('pointerup',450,240);
 assert.equal(q.layers()[0].strokes.length,0);
});

test('partial eraser does not alter remote ink or create undo entries without a hit',t=>{
 const q=setup(t);
 q.root.querySelector('[data-ink-mode=pen]').click();
 q.event('pointerdown',90,200);q.event('pointermove',810,200);q.event('pointerup',810,200);
 const before=JSON.stringify(q.layers()),writes=q.writes();
 q.root.querySelector('[data-ink-mode=eraser-partial]').click();
 q.event('pointerdown',450,700);q.event('pointermove',550,800);q.event('pointerup',550,800);
 assert.equal(JSON.stringify(q.layers()),before);
 assert.equal(q.writes(),writes);
});

test('partial eraser preserves pressure, tool and handwritten flag of fragments',t=>{
 const q=setup(t);
 q.root.querySelector('[data-ink-mode=handwriting]').click();
 q.event('pointerdown',90,450,{pressure:.2});
 q.event('pointermove',450,450,{pressure:.7});
 q.event('pointermove',810,450,{pressure:.9});
 q.event('pointerup',810,450,{pressure:.9});
 q.root.querySelector('[data-ink-mode=eraser-partial]').click();
 q.event('pointerdown',450,400);q.event('pointermove',450,500);q.event('pointerup',450,500);
 const parts=q.layers()[0].strokes;
 assert.equal(parts.length,2);
 assert.ok(parts.every(p=>p.handwriting && p.tool==='pen'));
 assert.ok(parts.every(p=>p.points.every(pt=>pt.pressure>=.2&&pt.pressure<=.9)));
 assert.ok(parts.every(p=>p.outline.flat().every(v=>Number.isFinite(v)&&v>=0&&v<=1)));
});
