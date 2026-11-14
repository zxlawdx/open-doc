const path=require('node:path');
module.exports=name=>path.join(__dirname,'../../apps',({editor:'documents',workbook:'spreadsheets',data:'data'}[name.replace(/\.html$/,'')]||'home'),'templates',name.endsWith('.html')?name:name+'.html');
