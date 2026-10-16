/* Left-click page chrome; text clicks retain their native selection behavior. */
"use strict";
(() => {
  function create(root,editor,signal){
    const menu=document.createElement('div');menu.className='page-menu';menu.dataset.pageMenu='';menu.setAttribute('role','menu');menu.hidden=true;root.appendChild(menu);let index=0;
    for(const [label,action] of [['Nova página abaixo','below'],['Nova página acima','above'],['Inserir quebra de página','break'],['Configurar página…','setup']]){const button=document.createElement('button');button.textContent=label;button.setAttribute('role','menuitem');button.addEventListener('click',()=>{menu.hidden=true;action==='setup'?root.dispatchEvent(new CustomEvent('open-doc:page-setup')):editor.insertPage(action,index);},{signal});menu.appendChild(button);}
    root.addEventListener('click',event=>{if(menu.contains(event.target))return;let page=event.target.closest('[data-page-index]');if(!page && event.target.closest('[data-rich], [data-surface]')){const pages=Array.from(root.querySelectorAll('[data-page-index]'));page=pages.find(p=>p.getBoundingClientRect().bottom>=event.clientY) || pages[pages.length-1];}if(event.button!==0 || !page || event.target.closest('[data-page-content]')){menu.hidden=true;return;}index=Number(page.dataset.pageIndex);menu.style.left=Math.min(event.clientX,window.innerWidth-240)+'px';menu.style.top=Math.min(event.clientY,window.innerHeight-180)+'px';menu.hidden=false;menu.querySelector('button').focus();},{signal});
    document.addEventListener('keydown',event=>{if(menu.hidden)return;if(event.key==='Escape'){menu.hidden=true;return;}if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();const buttons=Array.from(menu.querySelectorAll('button')),current=buttons.indexOf(document.activeElement);buttons[(current+(event.key==='ArrowDown'?1:buttons.length-1))%buttons.length].focus();}},{signal});
    signal.addEventListener('abort',()=>menu.remove(),{once:true});return {close:()=>{menu.hidden=true;}};
  }
  window.OpenDocPageMenu={create};
})();
