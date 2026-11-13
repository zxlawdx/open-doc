"use strict";
(() => {
  const NS='http://www.w3.org/2000/svg',colors=['#1a73e8','#db4437','#0f9d58','#f4b400','#8e44ad'];
  const id=()=> 'sheet-object-'+(crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random().toString(36).slice(2));
  function chartData(obj,state){
    const [top,left,bottom,right]=obj.range;
    const labels=[],series=[];
    for(let c=left+1;c<=right;c++)series.push({name:String(state.calc(state.index,top,c)),values:[]});
    for(let r=top+1;r<=bottom;r++){
      labels.push(String(state.calc(state.index,r,left)));
      series.forEach((line,i)=>{
        const raw=state.calc(state.index,r,left+i+1),value=window.OpenDocWorkbookPivot.number(raw);
        line.values.push(Number.isFinite(value)?value:null);
      });
    }
    return {labels,series};
  }
  function chartSvg(obj,state){
    const {labels,series}=chartData(obj,state),svg=document.createElementNS(NS,'svg');
    svg.setAttribute('viewBox','0 0 600 320');svg.setAttribute('role','img');svg.setAttribute('aria-label',obj.name);
    function item(name,props,text){const node=document.createElementNS(NS,name);
      for(const [key,value]of Object.entries(props||{}))node.setAttribute(key,String(value));
      if(text!==undefined)node.textContent=text;svg.append(node);return node;}
    const all=series.flatMap(s=>s.values).filter(v=>v!==null),minimum=Math.min(0,...all),maximum=Math.max(0,...all),span=maximum-minimum||1;
    const y=n=>260-(n-minimum)/span*210;
    item('title',{},obj.name);item('text',{x:24,y:25,'font-size':17,fill:'currentColor'},obj.name);
    if(obj.chart_kind==='pie'){
      const values=series[0]?.values.map(v=>Math.max(0,v||0))||[],total=values.reduce((a,b)=>a+b,0);let start=-Math.PI/2;
      if(!total){item('text',{x:24,y:150,fill:'currentColor'},'Pizza requer valores positivos.');return svg;}
      values.forEach((value,i)=>{if(!value)return;const angle=value/total*Math.PI*2,end=start+angle,cx=220,cy=170,r=105;
        if(angle>Math.PI*2-1e-8)item('circle',{cx,cy,r,fill:colors[i%colors.length]});
        else item('path',{d:`M ${cx} ${cy} L ${cx+r*Math.cos(start)} ${cy+r*Math.sin(start)} A ${r} ${r} 0 ${angle>Math.PI?1:0} 1 ${cx+r*Math.cos(end)} ${cy+r*Math.sin(end)} Z`,fill:colors[i%colors.length]});
        start=end;
      });
      labels.slice(0,10).forEach((name,i)=>item('text',{x:350,y:65+i*22,'font-size':12,fill:colors[i%colors.length]},name+' · '+(values[i]/total*100).toFixed(1)+'%'));
    }else{
      const slots=500/Math.max(1,labels.length);
      const horizontal=obj.chart_kind==='hbar';
      item('line',{x1:60,y1:y(0),x2:560,y2:y(0),stroke:'currentColor','stroke-opacity':'.3'});
      for(let j=0;j<=4;j++){const value=minimum+span*j/4;
        if(!horizontal)item('text',{x:54,y:y(value)+4,'font-size':10,'text-anchor':'end',fill:'currentColor'},new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(value));}
      const xValues=labels.map(window.OpenDocWorkbookPivot.number),xMin=Math.min(...xValues.filter(Number.isFinite)),xMax=Math.max(...xValues.filter(Number.isFinite));
      series.forEach((line,s)=>{
        const points=[];line.values.forEach((value,i)=>{if(value===null)return;
          const x=obj.chart_kind==='scatter'?60+(xValues[i]-xMin)/(xMax-xMin||1)*500:60+(i+.5)*slots;
          const color=colors[s%colors.length];
          if(obj.chart_kind==='bar')item('rect',{x:60+i*slots+s*slots/series.length+1,y:Math.min(y(0),y(value)),width:Math.max(.5,slots/series.length-2),height:Math.max(.5,Math.abs(y(value)-y(0))),fill:color});
          else if(horizontal){const slot=210/labels.length,w=500/span;
            item('rect',{x:60+(Math.min(0,value)-minimum)*w,y:50+i*slot+s*slot/series.length,width:Math.abs(value)*w,height:Math.max(.5,slot/series.length-2),fill:color});
          }else if(obj.chart_kind==='scatter'){if(Number.isFinite(x))item('circle',{cx:x,cy:y(value),r:3,fill:color});}
          else points.push([x,y(value)]);
        });
        if(points.length){
          if(obj.chart_kind==='area')item('polygon',{points:[[points[0][0],y(0)],...points,[points[points.length-1][0],y(0)]].map(p=>p.join(',')).join(' '),fill:colors[s%colors.length],'fill-opacity':'.2'});
          item('polyline',{points:points.map(p=>p.join(',')).join(' '),fill:'none',stroke:colors[s%colors.length],'stroke-width':2});
        }
        item('text',{x:65+s*120,y:310,'font-size':11,fill:colors[s%colors.length]},line.name.slice(0,17));
      });
      const step=Math.max(1,Math.ceil(labels.length/8));labels.forEach((label,i)=>{if(i%step===0)item('text',horizontal?{x:55,y:50+(i+.5)*210/labels.length,'text-anchor':'end','font-size':10,fill:'currentColor'}:{x:60+(i+.5)*slots,y:280,'text-anchor':'middle','font-size':10,fill:'currentColor'},label.slice(0,16));});
    }
    return svg;
  }
  function sparklineSvg(config,state){
    const values=[],[top,left,bottom,right]=config.range;
    for(let r=top;r<=bottom;r++)for(let c=left;c<=right;c++){
      const raw=state.calc(state.index,r,c),number=window.OpenDocWorkbookPivot.number(raw);
      values.push(Number.isFinite(number)?(config.kind==='winloss'?Math.sign(number):number):null);
    }
    const valid=values.filter(v=>v!==null),svg=document.createElementNS(NS,'svg');svg.setAttribute('viewBox','0 0 112 28');svg.setAttribute('preserveAspectRatio','none');svg.setAttribute('role','img');svg.setAttribute('aria-label','Minigráfico '+config.kind);
    const min=Math.min(0,...valid),max=Math.max(0,...valid),span=max-min||1;
    const y=n=>25-(n-min)/span*22,slot=108/Math.max(1,values.length);
    if(config.kind==='line'){
      let d='';let active=false;values.forEach((v,i)=>{if(v===null){active=false;return;}d+=(active?' L ':' M ')+(2+(i+.5)*slot)+' '+y(v);active=true;});
      const line=document.createElementNS(NS,'path');line.setAttribute('d',d);line.setAttribute('fill','none');line.setAttribute('stroke','#1a73e8');line.setAttribute('stroke-width','1.5');svg.append(line);
    }else values.forEach((v,i)=>{if(v===null)return;const bar=document.createElementNS(NS,'rect');for(const [key,value]of Object.entries({x:2+i*slot,y:Math.min(y(0),y(v)),width:Math.max(.5,slot-1),height:Math.max(.5,Math.abs(y(v)-y(0))),fill:v<0?'#db4437':'#1a73e8'}))bar.setAttribute(key,value);svg.append(bar);});
    return svg;
  }
  function shapeSvg(obj){
    const width=obj.width||600,height=obj.height||320;
    const svg=document.createElementNS(NS,'svg');svg.setAttribute('viewBox','0 0 '+width+' '+height);svg.setAttribute('preserveAspectRatio','none');svg.setAttribute('aria-label',obj.name);svg.setAttribute('role','img');
    const kind=obj.shape_kind;
    let shape;
    if(kind==='ellipse'){shape=document.createElementNS(NS,'ellipse');for(const [k,v]of Object.entries({cx:300,cy:160,rx:295,ry:155}))shape.setAttribute(k,v);}
    else if(kind==='line'){shape=document.createElementNS(NS,'line');for(const [k,v]of Object.entries({x1:5,y1:315,x2:595,y2:5}))shape.setAttribute(k,v);}
    else if(['triangle','diamond','arrow'].includes(kind)){shape=document.createElementNS(NS,'polygon');shape.setAttribute('points',{triangle:'300,5 595,315 5,315',diamond:'300,5 595,160 300,315 5,160',arrow:'5,90 410,90 410,5 595,160 410,315 410,230 5,230'}[kind]);}
    else if(kind!=='text'){shape=document.createElementNS(NS,'rect');for(const [k,v]of Object.entries({x:5,y:5,width:590,height:310}))shape.setAttribute(k,v);}
    if(shape){shape.setAttribute('fill',kind==='line'?'none':obj.fill);shape.setAttribute('stroke',obj.color);shape.setAttribute('stroke-width','2');shape.setAttribute('vector-effect','non-scaling-stroke');const group=document.createElementNS(NS,'g');group.setAttribute('transform','scale('+width/600+' '+height/320+')');group.append(shape);svg.append(group);}
    if(obj.text){const foreign=document.createElementNS(NS,'foreignObject');for(const [k,v]of Object.entries({x:8,y:8,width:Math.max(1,width-16),height:Math.max(1,height-16)}))foreign.setAttribute(k,v);
      const text=document.createElement('div');text.style.cssText='width:100%;height:100%;display:flex;align-items:center;justify-content:center;white-space:pre-wrap;overflow-wrap:anywhere;text-align:center;font:16px Arial,sans-serif';text.style.color=obj.color;text.textContent=obj.text;foreign.append(text);svg.append(foreign);}
    return svg;
  }
  function create({host,viewport,getState,change,request,dialog,report,signal}){
    const layer=document.createElement('div');layer.className='workbook-drawings';viewport.append(layer);
    const input=document.createElement('input');input.type='file';input.accept='image/png,image/jpeg,image/webp';input.hidden=true;host.append(input);
    const cache=new Map();
    function remember(key,url){if(cache.size>=8&&!cache.has(key))cache.delete(cache.keys().next().value);cache.set(key,url);}
    let selected=null,lastObjects,lastCalc,lastSheet,lastScale,drag=null;
    function snapshot(){const s=getState();return {...s,objects:s.sheet.objects||[]};}
    function apply(objects){const s=snapshot(),before=s.sheet.objects;change(s.sheet,before,objects);}
    function updateObject(identifier,patch){apply(snapshot().objects.map(o=>o.id===identifier?{...o,...patch}:o));}
    function choose(identifier){selected=identifier;for(const node of layer.children)node.dataset.selected=String(node.dataset.objectId===identifier);}
    async function addImage(file){
      const start=snapshot();
      if(file.size>4*1024*1024)throw Error('A imagem deve ter no máximo 4 MB.');
      const mime=file.type==='image/jpg'?'image/jpeg':file.type||(/\.png$/i.test(file.name)?'image/png':/\.webp$/i.test(file.name)?'image/webp':'image/jpeg');
      if(!['image/png','image/jpeg','image/webp'].includes(mime))throw Error('Escolha uma imagem PNG, JPEG ou WebP.');
      let dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Não foi possível ler a imagem.'));reader.readAsDataURL(file);});
      dataUrl='data:'+mime+';base64,'+String(dataUrl).split(',')[1];
      const asset=await request('workbook',{operation:'image-add',id:start.bookId,data_url:dataUrl,name:file.name});
      await start.idle?.();
      if(snapshot().bookId!==start.bookId||snapshot().sheet!==start.sheet)return;
      remember(asset.media_id,asset.url);const scale=Math.min(1,360/asset.width,280/asset.height);
      const obj={id:id(),type:'image',name:file.name.slice(0,200),media_id:asset.media_id,
        x:start.col*112,y:start.row*28,width:Math.max(16,asset.width*scale),height:Math.max(16,asset.height*scale)};
      selected=obj.id;apply([...snapshot().objects,obj]);
    }
    async function addChart(){
      const s=snapshot(),range=s.bounds;
      if((range[2]-range[0]+1)*(range[3]-range[1]+1)>50000)throw Error('Use até 50 mil células por gráfico.');
      if(range[0]>=range[2]||range[1]>=range[3])throw Error('Selecione os cabeçalhos, categorias e pelo menos uma coluna de valores.');
      const name=await dialog('Inserir gráfico','Título do gráfico:',true,null,{label:'Título ',type:'text',initial:'Gráfico'});if(!name)return;
      await s.idle?.();
      if(snapshot().sheet!==s.sheet)return;
      const kind=host.querySelector('[data-book-chart-kind]').value;
      const obj={id:id(),type:'chart',name:name.slice(0,200),chart_kind:kind,range:range.slice(),
        x:s.col*112,y:(range[2]+2)*28,width:560,height:320};
      const current=snapshot();
      for(let pass=0;pass<=current.objects.length;pass++){
        const overlap=current.objects.find(other=>obj.x<other.x+other.width&&obj.x+obj.width>other.x&&obj.y<other.y+other.height&&obj.y+obj.height>other.y);
        if(!overlap)break;obj.y=overlap.y+overlap.height+24;
      }
      obj.y=Math.min(280000,obj.y);selected=obj.id;apply([...current.objects,obj]);
      viewport.scrollTop=Math.max(viewport.scrollTop,s.cellHeight+(obj.y+obj.height)*s.scale-viewport.clientHeight);
    }
    async function addShape(){
      const s=snapshot(),kind=host.querySelector('[data-book-shape-kind]').value;
      let text='';
      if(kind==='text'){
        text=await dialog('Inserir caixa de texto','Texto da caixa:',true,null,{label:'Texto ',type:'text',initial:'Texto'});
        if(!text||snapshot().sheet!==s.sheet)return;
      }
      await s.idle?.();if(snapshot().sheet!==s.sheet)return;
      const obj={id:id(),type:'shape',name:kind==='text'?text.slice(0,200):'Forma',shape_kind:kind,text,fill:'#E8F0FE',color:'#174EA6',x:s.col*112,y:s.row*28,width:240,height:kind==='text'?80:140};
      selected=obj.id;apply([...snapshot().objects,obj]);
    }
    function sync(){
      const s=snapshot(),scale=s.scale;
      if(s.sheet===lastSheet&&s.objects===lastObjects&&s.calc===lastCalc&&scale===lastScale)return;
      if(lastSheet!==s.sheet)selected=null;
      lastSheet=s.sheet;lastObjects=s.objects;lastCalc=s.calc;lastScale=scale;
      const previous=new Map([...layer.children].map(n=>[n.dataset.objectId,n]));
      for(const obj of s.objects){
        let node=previous.get(obj.id);previous.delete(obj.id);
        if(!node){node=document.createElement('div');node.className='workbook-drawing';node.dataset.objectId=obj.id;node.tabIndex=0;
          const toolbar=document.createElement('div');toolbar.className='workbook-drawing-tools';
          for(const [action,label]of [['edit','Editar'],['duplicate','Duplicar'],['remove','Excluir']]){const button=document.createElement('button');button.type='button';button.dataset.objectAction=action;button.textContent=label;toolbar.append(button);}
          const content=document.createElement('div');content.className='workbook-drawing-content';
          const resize=document.createElement('button');resize.type='button';resize.className='workbook-drawing-resize';resize.dataset.objectResize='true';resize.setAttribute('aria-label','Redimensionar objeto');
          node.append(toolbar,content,resize);layer.append(node);
        }
        node.setAttribute('aria-label',obj.name);node.dataset.selected=String(selected===obj.id);
        Object.assign(node.style,{left:(s.gutter+obj.x*scale)+'px',top:(s.cellHeight+obj.y*scale)+'px',width:obj.width*scale+'px',height:obj.height*scale+'px'});
        const content=node.querySelector('.workbook-drawing-content');
        if(obj.type==='image'){
          let image=content.querySelector('img');if(!image){image=document.createElement('img');image.draggable=false;content.replaceChildren(image);}
          image.alt=obj.name;
          if(cache.has(obj.media_id)){const url=cache.get(obj.media_id);if(image.getAttribute('src')!==url)image.src=url;}
          else request('workbook',{operation:'image-read',id:s.bookId,media_id:obj.media_id}).then(data=>{remember(obj.media_id,data.url);if(image.isConnected)image.src=data.url;}).catch(error=>report(error.message));
        }else content.replaceChildren(obj.type==='shape'?shapeSvg(obj):chartSvg(obj,s));
      }
      for(const node of previous.values())node.remove();
    }
    async function command(name){
      if(name==='image'){input.click();return;}
      if(name==='chart')return addChart();
      if(name==='shape')return addShape();
    }
    input.addEventListener('change',()=>{const file=input.files[0];if(file)addImage(file).catch(error=>report(error.message));input.value='';},{signal});
    layer.addEventListener('click',async event=>{
      const node=event.target.closest('[data-object-id]');if(!node||snapshot().busy)return;
      event.stopPropagation();choose(node.dataset.objectId);
      const action=event.target.closest('[data-object-action]')?.dataset.objectAction;if(!action)return;
      const s=snapshot(),obj=s.objects.find(o=>o.id===selected);if(!obj)return;
      if(action==='remove'){apply(s.objects.filter(o=>o.id!==selected));selected=null;}
      if(action==='duplicate'){const copy={...obj,id:id(),x:Math.min(11200,obj.x+24),y:Math.min(280000,obj.y+24)};selected=copy.id;apply([...s.objects,copy]);}
      if(action==='edit'){
        const name=await dialog('Propriedades do objeto','Título ou descrição:',true,null,{label:'Descrição ',type:'text',initial:obj.name});
        if(name&&snapshot().sheet===s.sheet)updateObject(obj.id,{name:name.slice(0,200),...(obj.type==='chart'?{chart_kind:host.querySelector('[data-book-chart-kind]').value}:obj.type==='shape'?{text:name}:{})});
      }
    },{signal});
    layer.addEventListener('pointerdown',event=>{
      const node=event.target.closest('[data-object-id]');if(!node||snapshot().busy||event.button!==0||event.target.closest('[data-object-action]'))return;
      event.preventDefault();event.stopPropagation();choose(node.dataset.objectId);node.focus({preventScroll:true});
      const s=snapshot(),obj=s.objects.find(o=>o.id===selected);
      drag={node,obj,scale:s.scale,x:event.clientX,y:event.clientY,resize:!!event.target.closest('[data-object-resize]'),pointer:event.pointerId};
      node.setPointerCapture?.(event.pointerId);
    },{signal});
    layer.addEventListener('pointermove',event=>{
      if(!drag||drag.pointer!==event.pointerId)return;
      const dx=(event.clientX-drag.x)/drag.scale,dy=(event.clientY-drag.y)/drag.scale;
      drag.patch=drag.resize?{width:Math.max(16,Math.min(4000,drag.obj.width+dx)),height:Math.max(16,Math.min(4000,drag.obj.height+dy))}:
        {x:Math.max(0,Math.min(11200,drag.obj.x+dx)),y:Math.max(0,Math.min(280000,drag.obj.y+dy))};
      if(drag.resize&&drag.obj.type==='image'&&!event.shiftKey){
        const ratio=drag.obj.width/drag.obj.height;
        const factor=Math.max(16/Math.min(drag.obj.width,drag.obj.height),Math.min(4000/Math.max(drag.obj.width,drag.obj.height),Math.abs(dx)>=Math.abs(dy*ratio)?drag.patch.width/drag.obj.width:drag.patch.height/drag.obj.height));
        drag.patch={width:drag.obj.width*factor,height:drag.obj.height*factor};
      }
      const s=snapshot(),obj={...drag.obj,...drag.patch};
      Object.assign(drag.node.style,{left:s.gutter+obj.x*s.scale+'px',top:s.cellHeight+obj.y*s.scale+'px',width:obj.width*s.scale+'px',height:obj.height*s.scale+'px'});
    },{signal});
    layer.addEventListener('pointerup',event=>{if(!drag||drag.pointer!==event.pointerId)return;const {obj,patch}=drag;drag=null;if(patch)updateObject(obj.id,patch);},{signal});
    layer.addEventListener('pointercancel',()=>{drag=null;lastObjects=null;sync();},{signal});
    layer.addEventListener('keydown',event=>{
      if(!selected||snapshot().busy||event.target.closest('button'))return;
      const obj=snapshot().objects.find(o=>o.id===selected);if(!obj)return;
      if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();event.stopPropagation();apply(snapshot().objects.filter(o=>o.id!==selected));selected=null;}
      const move={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
      if(move){event.preventDefault();event.stopPropagation();const step=event.shiftKey?10:1;updateObject(obj.id,{x:Math.max(0,Math.min(11200,obj.x+move[0]*step)),y:Math.max(0,Math.min(280000,obj.y+move[1]*step))});}
    },{signal});
    viewport.addEventListener('pointerdown',event=>{if(!event.target.closest('[data-object-id]'))choose(null);},{signal});
    signal.addEventListener('abort',()=>{layer.remove();input.remove();cache.clear();},{once:true});
    return {sync,command,addImage,addChart,addShape};
  }
  window.OpenDocWorkbookObjects={create,chartData,chartSvg,shapeSvg,sparklineSvg};
})();
