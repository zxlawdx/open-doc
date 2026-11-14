const fs=require('node:fs'),path=require('node:path');
module.exports=function(name){
 for(const app of ['home','documents','spreadsheets','presentations','pdf','data','code','templates']){
  const candidate=path.join(__dirname,'../../apps',app,'static/js',name);
  if(fs.existsSync(candidate))return candidate;
 }
 throw new Error('Unknown application asset: '+name);
};
