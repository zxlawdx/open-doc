/* Document encoding and crash recovery stay off the interface thread. */
'use strict';
let database;
function openDatabase() {
  if (!database) database = new Promise((resolve,reject)=>{
    const request=indexedDB.open('open-doc-recovery',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('documents');
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error || Error('Recuperação indisponível.'));
  });
  return database;
}
async function storage(op,data) {
  const db=await openDatabase();
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction('documents',op==='read'?'readonly':'readwrite');
    const store=transaction.objectStore('documents');
    const request=op==='read'?store.get(data.id):op==='clear'?store.delete(data.id):store.put(data.snapshot,data.snapshot.id);
    let value;
    request.onsuccess=()=>{value=request.result;};
    transaction.oncomplete=()=>resolve(value ?? null);
    transaction.onerror=transaction.onabort=()=>reject(transaction.error || Error('Falha na recuperação local.'));
  });
}
async function handle(message) {
  const {op,data}=message;
  if(op!=='request')return storage(op,data);
  const response=await fetch('/api/open_doc/'+data.path,{
    method:'POST',headers:{'Content-Type':'application/json','X-Open-Doc-Token':data.token},
    body:JSON.stringify(data.snapshot)
  });
  let value;
  try {value=await response.json();}
  catch {throw Error('Falha no servidor (HTTP '+response.status+'). Seu texto foi mantido.');}
  if(!response.ok || value.error){const error=Error(value.error || 'Não foi possível concluir a operação.');error.conflict=Boolean(value.conflict);throw error;}
  return value;
}
self.onmessage=event=>{
  const message=event.data;
  handle(message).then(value=>self.postMessage({id:message.id,value}),
    error=>self.postMessage({id:message.id,error:error.message,conflict:Boolean(error.conflict)}));
};
self.postMessage({ready:true});
