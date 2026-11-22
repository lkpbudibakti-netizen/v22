import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import JSZip from 'jszip';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';

const root=path.resolve(process.argv[2]||'tmp/blank-export-audit');
const records=JSON.parse(fs.readFileSync(path.join(root,'word-render-results.json'),'utf8').replace(/^\uFEFF/,''));
assert.equal(records.length,39,'Every paired fixture DOCX must have a Word-render result');
const tokens=['IDENTITY_SCHOOL_9C71','93472168','IDENTITY_ADDRESS_9C71','IDENTITY_VILLAGE_9C71','IDENTITY_DISTRICT_9C71','IDENTITY_REGENCY_9C71','IDENTITY_PROVINCE_9C71','IDENTITY_PRINCIPAL_9C71','197912312008011973','IDENTITY_SOURCE_9C71','identity.invalid/9C71','IDENTITY_TEACHER_9C71','198912312013012973','IDENTITY_NUPTK_9C71'];
const compact=s=>s.normalize('NFKC').replace(/\s/g,'');
const decode=s=>s.replace(/&(?:amp|lt|gt|quot|apos);/g,v=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}[v])).replace(/&#(x[\da-f]+|\d+);/gi,(_,v)=>String.fromCodePoint(v[0].toLowerCase()==='x'?parseInt(v.slice(1),16):Number(v)));
const results=[],images=[];
let canvasModule;
if(process.argv.includes('--raster')) canvasModule=await import('@napi-rs/canvas');
for(const record of records) {
  assert.equal(record.status,'RENDERED_PENDING_PDF_QA',record.source);
  const sha=crypto.createHash('sha256').update(fs.readFileSync(record.source)).digest('hex');
  assert.equal(sha,record.inputSha256.toLowerCase(),'Input changed after Word render: '+record.source);
  const zip=await JSZip.loadAsync(fs.readFileSync(record.source));
  const xml=await zip.file('word/document.xml').async('string');
  const landscape=xml.includes('w:orient="landscape"');
  const required=[...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(m=>decode(m[1])).filter(s=>compact(s).length>=6);
  const task=getDocument({data:new Uint8Array(fs.readFileSync(record.pdf)),useSystemFonts:true,
    standardFontDataUrl:path.resolve('node_modules/pdfjs-dist/standard_fonts').replaceAll('\\','/')+'/',
    wasmUrl:path.resolve('node_modules/pdfjs-dist/wasm').replaceAll('\\','/')+'/',useWorkerFetch:false});
  const pdf=await task.promise,meta=await pdf.getMetadata();
  const metadata=JSON.stringify(meta)+(meta.metadata?.getRaw()||'');
  for(const token of tokens)assert(!compact(metadata).includes(compact(token)),record.source+' metadata identity leak');
  let content='',signoffs=0;const bounds=[];
  for(let i=1;i<=pdf.numPages;i++) {
    const p=await pdf.getPage(i),[,,w,h]=p.view;
    assert.equal(w>h,landscape,record.source+' orientation');
    assert(Math.abs(Math.min(w,h)-595.28)<1&&Math.abs(Math.max(w,h)-841.89)<1,record.source+' A4');
    const items=(await p.getTextContent()).items.filter(t=>'str'in t);
    const text=items.map(t=>t.str).join(' ');content+=' '+text;
    assert(text.trim(),record.source+' blank page');
    if(text.includes('Mengetahui,')) {
      signoffs++;
      for(const marker of ['Pengesahan','Kepala Sekolah','Guru Mata Pelajaran','NIP.'])assert(text.includes(marker),record.source+' split signoff '+marker);
    }
    const left=(landscape?25:30)*72/25.4,right=w-(landscape?20:25)*72/25.4;
    for(const t of items.filter(t=>t.str.trim())) {
      const x=t.transform[4],y=h-t.transform[5];
      if(x<left-2||x+t.width>right+2||y<15||y>h-15)bounds.push({page:i,text:t.str,x,y,width:t.width});
    }
    if(canvasModule) {
      const v=p.getViewport({scale:1.4}),canvas=canvasModule.createCanvas(v.width,v.height);
      await p.render({canvasContext:canvas.getContext('2d'),viewport:v}).promise;
      const png=record.pdf.replace(/\.pdf$/,`-p${i}.png`);fs.writeFileSync(png,canvas.toBuffer('image/png'));images.push({file:png,label:path.basename(record.pdf)+` p${i}`});
    }
  }
  assert(signoffs,record.source+' missing signoff');
  const flat=compact(content);
  for(const token of tokens)assert(!flat.includes(compact(token)),record.source+' identity leak');
  const missing=required.filter(t=>!flat.includes(compact(t)));
  results.push({...record,status:missing.length||bounds.length?'FAIL':'CONTENT_GEOMETRY_SIGNOFF_PASS',pdfPages:pdf.numPages,missing,bounds});
  await task.destroy();
  fs.writeFileSync(path.join(root,'word-validation.json'),JSON.stringify({results,visual:'Raster inspection required; coordinate/text assertions alone do not prove visual fidelity.'},null,2));
  console.log(path.basename(record.source),results.at(-1).status,pdf.numPages+' pages');
}
if(canvasModule) for(let start=0;start<images.length;start+=12) {
  const sheet=canvasModule.createCanvas(1320,1320),ctx=sheet.getContext('2d');ctx.fillStyle='#ddd';ctx.fillRect(0,0,1320,1320);ctx.font='12px Arial';
  for(const [j,item]of images.slice(start,start+12).entries()) {
    const img=await canvasModule.loadImage(item.file),x=(j%4)*330,y=Math.floor(j/4)*440,scale=Math.min(320/img.width,410/img.height);
    ctx.drawImage(img,x,y,img.width*scale,img.height*scale);ctx.fillStyle='#111';ctx.fillText(item.label,x+3,y+426,324);
  }
  fs.writeFileSync(path.join(root,`word-contact-${Math.floor(start/12)+1}.png`),sheet.toBuffer('image/png'));
}
assert(results.every(r=>r.status==='CONTENT_GEOMETRY_SIGNOFF_PASS'),'Inspect word-validation.json');
console.log('PASS Word-rendered PDF text, identity, A4, geometry and intact contextual signoff for all 39 fixtures. Visual inspection is a separate gate.');
