/* One dispatch point for rich and fixed document lifecycles. */
"use strict";
(() => {
 function create(options){const {root}=options,original=options.document,isFixed=n=>n?.content_format==='opendoc-fixed-v1';
  const placeholder={id:original.id,title:original.title,markdown:'',revision:original.revision},rich=window.OpenDocEditor.create({...options,document:isFixed(original)?placeholder:original}),fixed=window.OpenDocFixedDocument.create(options);let current=rich;
  function load(note){fixed.deactivate();rich.suspend(isFixed(note));current=isFixed(note)?fixed:rich;root.dataset.documentKind=current===fixed?'fixed':'rich';const slider=root.querySelector('[data-zoom]');slider.min=current===fixed?'25':'50';slider.max=current===fixed?'300':'150';root.querySelector('[data-document-body]').hidden=current===fixed;current.load(note);}
  const methods=['flush','snapshot','inkLayers','setInkLayers','insertRecognized','format','export','isClean','setLocked','setMode','capture','refresh','style','textState','commandState','pagination','pageView','copy','insertPage','pageSetup','replaceText','tableOperation'];const facade={load,find:()=>{if(current!==fixed)return false;fixed.find();return true;},destroy:()=>rich.destroy()};for(const name of methods)facade[name]=(...args)=>current[name]?.(...args);load(original);return facade;
 }
 window.OpenDocDocumentKinds={create};
})();
