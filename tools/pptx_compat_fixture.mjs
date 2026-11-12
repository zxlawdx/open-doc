// Self-contained fixture for frozen-app checks in clean Linux distributions.
// Stored ZIP entries require no project dependencies on the smoke-test host.
function zipStored(files) {
 const local=[], directory=[]; let offset=0;
 for(const [path,text] of Object.entries(files)) {
  const name=Buffer.from(path),data=Buffer.from(text);
  let crc=0xffffffff;
  for(const byte of data){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  crc=(crc^0xffffffff)>>>0;
  const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);
  header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(name.length,26);
  local.push(header,name,data);
  const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);
  entry.writeUInt32LE(crc,16);entry.writeUInt32LE(data.length,20);entry.writeUInt32LE(data.length,24);entry.writeUInt16LE(name.length,28);entry.writeUInt32LE(offset,42);
  directory.push(entry,name);offset+=header.length+name.length+data.length;
 }
 const central=Buffer.concat(directory),end=Buffer.alloc(22),count=Object.keys(files).length;
 end.writeUInt32LE(0x06054b50);end.writeUInt16LE(count,8);end.writeUInt16LE(count,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...local,central,end]);
}
const A='http://schemas.openxmlformats.org/drawingml/2006/main',P='http://schemas.openxmlformats.org/presentationml/2006/main',R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export function pptxCompatibilityFixture(body='<a:p><a:pPr><a:defRPr sz="3000" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:latin typeface="Arial"/></a:defRPr></a:pPr><a:r><a:t>Packaged PPTX QA</a:t></a:r></a:p>',list=''){
 const files={
  '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>',
  '_rels/.rels':`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="root" Type="${R}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`,
  'ppt/presentation.xml':`<p:presentation xmlns:p="${P}" xmlns:r="${R}"><p:sldIdLst><p:sldId id="256" r:id="slide"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/></p:presentation>`,
  'ppt/_rels/presentation.xml.rels':`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="slide" Type="${R}/slide" Target="slides/slide1.xml"/></Relationships>`,
  'ppt/slides/slide1.xml':`<p:sld xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${R}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
   <p:sp><p:nvSpPr><p:cNvPr id="2" name="Text"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4572000" cy="2743200"/></a:xfrm><a:prstGeom prst="rect"/><a:noFill/></p:spPr><p:txBody><a:bodyPr/><a:lstStyle>${list}</a:lstStyle>${body}</p:txBody></p:sp>
   <p:sp><p:nvSpPr><p:cNvPr id="3" name="Wave"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="4572000" y="0"/><a:ext cx="2743200" cy="914400"/></a:xfrm><a:prstGeom prst="wave"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="377591"/></a:solidFill></p:spPr></p:sp>
  </p:spTree></p:cSld></p:sld>`
 };
 return zipStored(files);
}
