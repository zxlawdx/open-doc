"use strict";
(() => {
  function show({host,request,initial,signal}){
    const modal=document.createElement('dialog');modal.className='dataset-import-preview';
    modal.innerHTML=`<h2>Prévia de importação e tipos</h2><p>Prévia de até 500 registros. Os tipos serão verificados no arquivo inteiro antes de confirmar. Identificadores e zeros à esquerda são preservados.</p><div class="import-options">
      <label>Encoding <select data-import-encoding><option value="auto">Automático</option><option value="utf-8-sig">UTF-8</option><option value="utf-16">UTF-16</option><option value="cp1252">Windows-1252</option><option value="latin-1">Latin-1</option></select></label>
      <label>Separador <select data-import-delimiter><option value="auto">Automático</option><option value=",">Vírgula</option><option value=";">Ponto e vírgula</option><option value="\t">Tabulação</option><option value="|">Barra vertical</option></select></label>
      <label>Decimal <select data-import-decimal><option value="auto">Automático</option><option value=".">Ponto</option><option value=",">Vírgula</option></select></label>
      <label>Milhares <select data-import-thousands><option value="">Nenhum</option><option value=".">Ponto</option><option value=",">Vírgula</option><option value=" ">Espaço</option></select></label>
      <label>Linha do cabeçalho <input data-import-header type="number" min="1" max="10000" value="1"></label>
      <label>Datas <select data-import-date-format><option value="iso">ISO (AAAA-MM-DD)</option><option value="%d/%m/%Y">DD/MM/AAAA</option><option value="%m/%d/%Y">MM/DD/AAAA</option></select></label>
      </div><button type="button" data-import-refresh>Atualizar prévia</button><output data-import-status role="status"></output><pre data-import-raw hidden></pre><div class="import-preview-scroll"><table data-import-table></table></div><footer><button type="button" data-import-cancel>Cancelar</button><button type="button" data-import-confirm>Confirmar importação</button></footer>`;
    host.append(modal);const $=s=>modal.querySelector(s),table=$('[data-import-table]'),status=$('[data-import-status]'),confirm=$('[data-import-confirm]');
    let profile=initial,working=false,resolveResult,settled=false;
    let pendingRefresh=false,queuedOptions=null,refreshTimer=null;
    const optionFields=['encoding','delimiter','decimal','thousands','header','date_format'];
    const field=name=>$('[data-import-'+name.replace('_','-')+']');
    for(const name of optionFields)field(name).value=String(profile.options[name]);
    function config(){const data={...profile.options,types:Object.create(null)};for(const name of optionFields)data[name]=name==='header'?Number(field(name).value):field(name).value;table.querySelectorAll('[data-import-type]').forEach(select=>{if(select.value!=='auto')data.types[select.dataset.importType]=select.value;});return data;}
    function render(){
      $('[data-import-raw]').hidden=!profile.raw_lines;$('[data-import-raw]').textContent=(profile.raw_lines||[]).map((line,i)=>(i+1)+': '+line).join('\n');
      table.replaceChildren();const head=document.createElement('thead'),names=document.createElement('tr'),types=document.createElement('tr');
      for(const item of profile.schema){const th=document.createElement('th');th.textContent=item.name;names.append(th);const cell=document.createElement('td'),select=document.createElement('select');select.dataset.importType=item.name;select.setAttribute('aria-label','Tipo de '+item.name);
        for(const [value,label] of [['auto','Automático: '+item.dtype],['text','Manter como texto'],['integer','Inteiro (Int64)'],['decimal','Decimal (Float64)'],['boolean','Booleano'],['date','Data'],['datetime','Data e hora']])select.add(new Option(label,value));select.value=Object.prototype.hasOwnProperty.call(profile.options.types,item.name)?profile.options.types[item.name]:'auto';
        cell.append(select);if(item.identifier||item.mixed){const note=document.createElement('small');note.textContent=item.identifier?'Identificador protegido':'Tipos mistos: texto preservado';cell.append(note);}types.append(cell);}
      head.append(names,types);const body=document.createElement('tbody');for(const row of profile.rows){const tr=body.insertRow();for(const value of row){const cell=tr.insertCell();cell.textContent=value===null?'NULL':String(value);if(value===null)cell.className='import-null';}}
      table.append(head,body);confirm.disabled=profile.errors.length>0;status.textContent=profile.errors.length?'Erros de conversão: '+profile.errors.map(e=>e.column+' · linha '+(e.line||e.row)+' · '+e.value).join('; '):profile.files.join(', ')+' · '+profile.row_count+' registros analisados'+(profile.sampled?' (prévia)':'');
    }
    async function refresh(){
      clearTimeout(refreshTimer);
      if(working){pendingRefresh=true;return;}
      const next=queuedOptions||config();
      queuedOptions=null;
      working=true;confirm.disabled=true;
      status.textContent='Analisando valores e tipos…';
      try{profile=await request('dataset',{operation:'import-preview',token:profile.token,options:next});render();}
      catch(error){status.textContent=error.message;}
      finally{working=false;if(pendingRefresh&&!settled){pendingRefresh=false;refresh();}}
    }
    function finish(value){if(settled)return;settled=true;clearTimeout(refreshTimer);if(modal.close)modal.close();modal.remove();resolveResult(value);}
    async function cancel(){if(working)return;await request('dataset',{operation:'import-cancel',token:profile.token}).catch(()=>{});finish({cancelled:true});}
    // Automatically revalidate after type changes; confirmation stays locked
    // until full-schema preview succeeds, without an extra manual step.
    modal.addEventListener('change',()=>{
      queuedOptions=config();
      confirm.disabled=true;
      status.textContent='Atualizando prévia e verificando tipos…';
      clearTimeout(refreshTimer);
      refreshTimer=setTimeout(refresh,220);
    },{signal});
    signal?.addEventListener?.('abort',()=>clearTimeout(refreshTimer),{once:true});
    $('[data-import-refresh]').onclick=refresh;$('[data-import-cancel]').onclick=cancel;
    modal.addEventListener('cancel',event=>{event.preventDefault();cancel();},{signal});
    confirm.onclick=async()=>{if(working)return;working=true;confirm.disabled=true;status.textContent='Importando e verificando o arquivo inteiro…';try{finish(await request('dataset',{operation:'import-commit',token:profile.token}));}catch(error){status.textContent=error.message;confirm.disabled=false;}finally{working=false;}};
    render();if(modal.showModal)modal.showModal();else modal.setAttribute('open','');
    return new Promise(resolve=>{resolveResult=resolve;});
  }
  window.OpenDocImportPreview={show};
})();
