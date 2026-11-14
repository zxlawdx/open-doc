/* Geometry/index/cache are independent from DOM and document persistence. */
'use strict';
(()=>{
 const boxes=new WeakMap(),indices=new WeakMap(),paths=new WeakMap();
 function bounds(stroke){let box=boxes.get(stroke);if(box)return box;let left=1,top=1,right=0,bottom=0;
  for(const p of stroke.outline||[]){left=Math.min(left,p[0]);top=Math.min(top,p[1]);right=Math.max(right,p[0]);bottom=Math.max(bottom,p[1]);}
  for(const p of stroke.points||[]){left=Math.min(left,p.x);top=Math.min(top,p.y);right=Math.max(right,p.x);bottom=Math.max(bottom,p.y);}
  box={left,top,right,bottom};boxes.set(stroke,box);return box;
 }
 const intersects=(a,b)=>a.left<=b.right&&a.right>=b.left&&a.top<=b.bottom&&a.bottom>=b.top;
 class SpatialIndex{
  constructor(strokes,size=32){this.size=size;this.cells=new Map();this.wide=[];this.strokes=strokes.slice();this.ids=new Set(strokes.map(stroke=>stroke.id));strokes.forEach((stroke,index)=>this.insert(stroke,index));}
  insert(stroke,index){const b=bounds(stroke),n=this.size,x=Math.max(0,Math.floor(b.left*n)),y=Math.max(0,Math.floor(b.top*n)),r=Math.min(n-1,Math.floor(b.right*n)),d=Math.min(n-1,Math.floor(b.bottom*n));
   if((r-x+1)*(d-y+1)>64){this.wide.push(index);return;}for(let row=y;row<=d;row++)for(let col=x;col<=r;col++){const key=row*n+col;let cell=this.cells.get(key);if(!cell)this.cells.set(key,cell=[]);cell.push(index);}
  }
  query(box){const n=this.size,seen=new Set(this.wide),x=Math.max(0,Math.floor(box.left*n)),y=Math.max(0,Math.floor(box.top*n)),r=Math.min(n-1,Math.floor(box.right*n)),d=Math.min(n-1,Math.floor(box.bottom*n));
   for(let row=y;row<=d;row++)for(let col=x;col<=r;col++)for(const index of this.cells.get(row*n+col)||[])seen.add(index);
   return [...seen].filter(i=>intersects(bounds(this.strokes[i]),box)).sort((a,b)=>a-b);
  }
 }
 function index(strokes){let value=indices.get(strokes);if(!value){value=new SpatialIndex(strokes);indices.set(strokes,value);}return value;}
 function carryErasure(previous,next){const value=indices.get(previous);if(!value)return;for(const stroke of next)if(!value.ids.has(stroke.id)){value.ids.add(stroke.id);const position=value.strokes.length;value.strokes.push(stroke);value.insert(stroke,position);}indices.set(next,value);}
 function path(stroke){let value=paths.get(stroke);if(!value){value=new Path2D((stroke.outline||[]).map((p,i)=>(i?'L':'M')+p[0]+','+p[1]).join(' ')+' Z');paths.set(stroke,value);}return value;}
 function paint(ctx,stroke){if(!stroke.outline?.length)return;ctx.fillStyle=stroke.color;ctx.globalAlpha=stroke.opacity??1;ctx.fill(path(stroke));}
 function render(ctx,strokes,{schedule=callback=>requestAnimationFrame(callback),cancelled=()=>false,budget=6,onDone=()=>{}}={}){
  let position=0,frames=0,maxSlice=0;
  function step(){if(cancelled())return;const started=performance.now();let count=0;
   while(position<strokes.length){paint(ctx,strokes[position++]);count++;if(count%32===0&&performance.now()-started>=budget)break;}
   frames++;maxSlice=Math.max(maxSlice,performance.now()-started);
   if(position<strokes.length)schedule(step);else onDone({count:position,frames,maxSlice});
  }
  schedule(step);return ()=>position;
 }
 function shapePoints(kind,a,b){
  const left=Math.min(a.x,b.x),right=Math.max(a.x,b.x),top=Math.min(a.y,b.y),bottom=Math.max(a.y,b.y),point=(x,y)=>({...b,x:Math.max(0,Math.min(1,x)),y:Math.max(0,Math.min(1,y)),pressure:.5});
  if(kind==='rectangle')return [[left,top],[right,top],[right,bottom],[left,bottom],[left,top]].map(([x,y])=>point(x,y));
  if(kind==='ellipse')return Array.from({length:65},(_,i)=>{const angle=i/64*Math.PI*2;return point((left+right)/2+(right-left)/2*Math.cos(angle),(top+bottom)/2+(bottom-top)/2*Math.sin(angle));});
  if(kind==='arrow'){const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy),head=Math.min(.035,length*.3),angle=Math.atan2(dy,dx);return [a,b,point(b.x-head*Math.cos(angle-.5),b.y-head*Math.sin(angle-.5)),b,point(b.x-head*Math.cos(angle+.5),b.y-head*Math.sin(angle+.5))];}
  return [a,b];
 }
 window.OpenDocInkEngine={bounds,SpatialIndex,index,carryErasure,paint,render,shapePoints};
})();
