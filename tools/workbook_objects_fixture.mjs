// This function is serialized into the packaged application's own WebEngine.
export async function workbookObjectsSmoke(){
  await OpenDocApp.action('workbook-new');
  const {token}=await window.pywebview.api.get_bootstrap();
  const call=async data=>{
    const response=await fetch('/api/open_doc/workbook',{method:'POST',headers:{'Content-Type':'application/json','X-Open-Doc-Token':token},body:JSON.stringify(data)});
    const result=await response.json();if(!response.ok||result.error)throw Error(result.error||'Worksheet API failed.');return result;
  };
  const book=await call({operation:'new'});
  const asset=await call({operation:'image-add',id:book.id,name:'Native image',data_url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAMCAIAAADtbgqsAAAAGUlEQVR4nGNcoZTGQC5gIlvnqOZRzTTXDACIewFIN82hKgAAAABJRU5ErkJggg=='});
  const sheet={name:'Dados',cells:{'0,0':'Mês','0,1':'Valor','0,2':'Custo','1,0':'Jan','1,1':'20','1,2':'10','2,0':'Fev','2,1':'30','2,2':'12','3,0':'TRUE','5,0':'Merged title','7,4':'=IF(COUNT(B8:D8)=0,"",AVERAGE(B8:D8))'},bold:[],layout:{columns:{'1':236},rows:{'0':40},merges:[[5,0,5,2]],freeze:[1,0]},
    objects:[
      {id:'image',type:'image',name:'Native image',media_id:asset.media_id,x:0,y:112,width:120,height:80},
      {id:'chart',type:'chart',name:'Native chart',chart_kind:'bar',range:[0,0,2,2],x:160,y:112,width:480,height:280},
      {id:'shape',type:'shape',name:'Native shape',shape_kind:'arrow',text:'Native shape',fill:'#E8F0FE',color:'#174EA6',x:650,y:112,width:160,height:120}],
    cell_tools:{'1,3':{sparkline:{kind:'column',range:[1,1,1,2]}},'3,0':{checkbox:true},'3,1':{choices:['Pendente','Concluído'],comment:'Native comment'},'0,0':{hyperlink:'https://example.com'}}};
  const title='Packaged Sheet Drawings '+Date.now();
  const saved=await call({operation:'save',id:book.id,revision:book.revision,title,sheets:[sheet]});
  const reopened=await call({operation:'open',id:book.id});
  if(reopened.sheets[0].objects.length!==3||JSON.stringify(reopened).includes('data:image/'))throw Error('Worksheet drawings or compact media persistence failed.');
  await OpenDocApp.action('home');
  let button;
  for(let attempt=0;attempt<100&&!button;attempt++){button=[...document.querySelectorAll('.library-file-title')].find(node=>node.textContent===title);if(!button)await new Promise(resolve=>setTimeout(resolve,100));}
  if(!button)throw Error('Saved workbook not found in Central.');button.click();
  for(let attempt=0;attempt<100;attempt++){
    const host=document.querySelector('[data-workbook]');
    if(!host.hidden&&host.querySelector('.workbook-drawing img')?.naturalWidth===20&&host.querySelectorAll('.workbook-drawing').length===3&&host.querySelector('svg[aria-label^=Minigráfico]')&&host.querySelector('[data-book-checkbox]')&&host.querySelector('[data-book-choice]')&&host.querySelector('[data-book-col=\"1\"]')?.style.width==='236px'&&host.querySelector('[data-cell=\"5,0\"]')?.getAttribute('aria-colspan')==='3')return {ok:true,revision:saved.revision};
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw Error('Packaged worksheet drawings and controls did not render.');
}
