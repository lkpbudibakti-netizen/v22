import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { createIdentityExportFixture, withK13ExportData } from './fixtures/identityExportFixture';
import { generateDocument, generateDocumentFormatted, validateDocumentRequirements, createDocumentSnapshot, resolveEffectiveContext } from '../src/services/documentEngine';
import { generatePdfDocument } from '../src/services/documentEngine/renderers/pdf/pdfDocGenerators';
import { generateZipBundle } from '../src/services/documentEngine/zipBundle';
import { buildAnnualZipWorkItems } from '../src/services/documentEngine/annualZipPlan';
import { maskExportIdentity } from '../src/services/documentEngine/exportIdentity';
import { buildModulAjarProjection } from '../src/services/documentEngine/modulAjarProjection';
import { createAssessmentDocumentSnapshot } from '../src/services/documentEngine/assessmentExportService';
import type { DocumentType } from '../src/types';
import type { DocumentGenerationContext } from '../src/services/documentEngine/types';
import { evaluateExpression, initializer } from './helpers/uiContractHarness';
import { getCurriculumDocumentTypes } from '../src/services/curriculumRouter';
import { getCurriculumType } from '../src/services/curriculumRules';

const out='tmp/blank-export-audit';mkdirSync(out,{recursive:true});
const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
const types:DocumentType[]=['CP','TP','ANALISIS_CP_TP','ATP','PEMETAAN_ATP_UNIT','PROTA','PROMES','MODUL_AJAR','KKTP','ASESMEN','DAFTAR_HADIR','DAFTAR_NILAI','JURNAL','REMEDIAL_PENGAYAAN','KALENDER_AKADEMIK','HARI_EFEKTIF','ALOKASI_WAKTU'];
const results:any[]=[];
const text=(xml:string)=>[...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(m=>m[1]).join(' ');
const compact=(s:string)=>s.replace(/\s/g,'');
const identityTokens=(c:DocumentGenerationContext)=>[
  c.school.name,c.school.npsn,c.school.address,c.school.village,c.school.district,c.school.regency,c.school.province,
  c.school.principalName,c.school.principalNip,c.school.principalSource,c.school.principalSourceUrl,c.profile.name,c.profile.nip,c.profile.nuptk,
].filter((s):s is string=>typeof s==='string'&&!!s.trim());
function assertUnchanged(before:string,after:unknown,label:string) {
  const actual=JSON.stringify(after);
  if(actual===before) return;
  const changes:string[]=[];
  function visit(a:any,b:any,path:string) {
    if(changes.length>=8||JSON.stringify(a)===JSON.stringify(b))return;
    if(!a||!b||typeof a!=='object'||typeof b!=='object'){changes.push(`${path}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);return;}
    for(const key of new Set([...Object.keys(a),...Object.keys(b)]))visit(a[key],b[key],path+'.'+key);
  }
  visit(JSON.parse(before),JSON.parse(actual),'source');
  assert.fail(label+' '+changes.join('\n'));
}
function assertPrivate(value:unknown,tokens:string[],label:string) {
  const serialized=compact(typeof value==='string'?value:JSON.stringify(value));
  for(const token of tokens) assert(!serialized.includes(compact(token)),`${label} leaks ${token}`);
}
function academicBody(xml:string) {
  // All existing generators use their first table for identity and a labelled,
  // in-flow final signoff. Compare actual content, not byte sizes or source code.
  const firstEnd=xml.indexOf('</w:tbl>')+8;
  const signoff=xml.indexOf('Pengesahan:');
  const end=signoff<0?xml.length:xml.lastIndexOf('<w:p>',signoff);
  return compact(text(xml.slice(firstEnd,end)));
}
async function inspectDocx(blob:Blob,tokens:string[],label:string) {
  const zip=await JSZip.loadAsync(await blob.arrayBuffer());
  for(const file of Object.values(zip.files).filter(f=>/\.(xml|rels)$/.test(f.name))) assertPrivate(await file.async('string'),tokens,`${label}:${file.name}`);
  const xml=await zip.file('word/document.xml')!.async('string');
  const signoff=[...xml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].find(m=>m[0].includes('Mengetahui,'))?.[0];
  assert(signoff && /w:cantSplit/.test(signoff) && /w:keepNext/.test(signoff) && /w:keepLines/.test(signoff),label+' signoff protection');
  assert(!signoff.includes('w:trHeight'),label+' fixed signoff height');
  return xml;
}
async function inspectPdf(blob:Blob,tokens:string[],label:string) {
  const task=getDocument({data:new Uint8Array(await blob.arrayBuffer()),useSystemFonts:true});const pdf=await task.promise;
  const meta=await pdf.getMetadata();assertPrivate(meta,tokens,label+' metadata');
  assertPrivate(meta.metadata?.getRaw() || '',tokens,label+' XMP metadata');
  const pages:string[]=[];let signature=0;const bounds:string[]=[];
  for(let i=1;i<=pdf.numPages;i++) {
    const page=await pdf.getPage(i), [,,w,h]=page.view;
    assert(Math.abs(Math.min(w,h)-595.28)<1 && Math.abs(Math.max(w,h)-841.89)<1,label+' A4');
    const items:any[]=(await page.getTextContent()).items;
    const content=items.map(t=>t.str||'').join(' ');pages.push(content);assertPrivate(content,tokens,`${label} page ${i}`);
    assert(content.trim(),label+' empty page');
    if(content.includes('Mengetahui,')) {
      signature++;
      for(const marker of ['Pengesahan','Kepala Sekolah','Guru Mata Pelajaran','NIP.']) assert(content.includes(marker),`${label} signoff split: ${marker}`);
      assert(items.some(t=>t.str?.includes('Pengesahan') && h-t.transform[5]>20),label+' signoff outside margin');
    }
    const left=(w>h?25:30)*72/25.4,right=w-(w>h?20:25)*72/25.4;
    for(const t of items.filter(t=>t.str?.trim()&&!/^Halaman \d+ dari \d+$/.test(t.str))) {
      const x=t.transform[4],y=h-t.transform[5];
      if(x<left-2||x+t.width>right+2||y<15||y>h-15) bounds.push(`${i}:${t.str}`);
    }
  }
  assert(signature,label+' missing signoff');
  await task.destroy();return {pages:pages.length,text:pages.join('\n'),bounds};
}
for(const semester of [1,2] as const) {
  const {context,state,storage}=createIdentityExportFixture(semester);
  const sourceStorage=()=>[...storage].filter(([key])=>key!=='alco_diagnostic_events_v1');
  const tokens=identityTokens(context);
  const sourceBefore=JSON.stringify({context,state,storage:sourceStorage()});
  const all=[...types,...(semester===1?['ANALISIS_SKL_KI_KD','PENETAPAN_KKM'] as DocumentType[]:[])];
  const cases=all.map(type=>({type,k13:type==='ANALISIS_SKL_KI_KD'||type==='PENETAPAN_KKM'}));
  if(semester===1) cases.push(...(['PROTA','PROMES','ALOKASI_WAKTU'] as DocumentType[]).map(type=>({type,k13:true})));
  for(const {type,k13} of cases) {
    const base=k13?withK13ExportData(context):context;
    const data={...base,documentMode:'data' as const},blank={...base,documentMode:'blank' as const};
    assert.equal(validateDocumentRequirements(type,data).isValid,true,`${type}: fixture not ready`);
    assert.equal(validateDocumentRequirements(type,blank).isValid,true,`${type}: blank readiness differs`);
    const d=await generateDocument(type,data),b=await generateDocument(type,blank);
    const dx=await inspectDocx(d.blob!,[],type+' data'),bx=await inspectDocx(b.blob!,tokens,type+' blank');
    assert(text(dx).includes(context.profile.name) && text(dx).includes(context.school.name),type+' data mode lost identity');
    assert.equal(academicBody(bx),academicBody(dx),`${type}: DOCX academic body differs`);
    assert.equal(bx.match(/<w:pgSz[^>]*\/>/)?.[0],dx.match(/<w:pgSz[^>]*\/>/)?.[0],type+' orientation');
    assert.equal(bx.match(/<w:pgMar[^>]*\/>/)?.[0],dx.match(/<w:pgMar[^>]*\/>/)?.[0],type+' margins');
    assertPrivate({fileName:b.fileName,record:b.record},tokens,type+' DOCX result');
    const dp=await generatePdfDocument(type,data),bp=await generatePdfDocument(type,blank);
    const pd=await inspectPdf(dp.blob,[],type+' data'),pb=await inspectPdf(bp.blob,tokens,type+' blank');
    const masked=maskExportIdentity(blank);
    for(const field of ['cp','tp','atp','atpUnitMapping','unitExecutionPlan','calendar','calendarDays','timeAllocations','students','attendanceRecords','journalRealizations'] as const)
      assert.deepEqual(masked[field],base[field],`${type}: mask changed ${field}`);
    // A data-mode control with anonymous identity values exercises the original
    // data rendering path while retaining every byte of academic source content.
    const control=await generatePdfDocument(type,{...masked,documentMode:'data',school:{...masked.school,name:'-'},profile:{...masked.profile,name:'-'}});
    const pc=await inspectPdf(control.blob,[],type+' anonymous data control');
    const pdfBody=(s:string)=>compact(s.split('Pengesahan')[0].replace(/Halaman \d+ dari \d+/g,'')).replace(/(?:SEKOLAH|-)—SEMESTER/g,'—SEMESTER');
    assert.equal(pdfBody(pb.text),pdfBody(pc.text),`${type}: PDF academic body differs from data renderer`);
    // Every significant DOCX body phrase must survive identity masking in PDF.
    const dxWords=academicBody(dx);
    const shared=[context.tp!.items[0].statement,context.atp!.items[0].focus,context.atpUnitMapping!.units[semester-1].materials[0].title,context.students?.[0]?.name].filter((s):s is string=>!!s&&s.length>5);
    for(const marker of shared) if(compact(pd.text).includes(compact(marker))) assert(compact(pb.text).includes(compact(marker)),`${type}: PDF lost ${marker}`);
    assert(dxWords.length>0,type+' empty body');
    assertPrivate({fileName:bp.fileName,snapshot:bp.snapshot},tokens,type+' PDF result');
    for(const [ext,blob]of [['docx',b.blob!],['pdf',bp.blob]] as const)writeFileSync(`${out}/${type}${k13?'-k13':''}-s${semester}-blank.${ext}`,Buffer.from(await blob.arrayBuffer()));
    results.push({type,semester,k13,docx:'CONTENT_AND_IDENTITY_PASS',pdfPages:pb.pages,pdfBounds:pb.bounds,docxVisual:'BLOCKED_PENDING_WORD_OR_LIBREOFFICE'});
    console.log('PASS paired render',type,'semester',semester);
    assertUnchanged(sourceBefore,{context,state,storage:sourceStorage()},type+' export changed source');
    assertPrivate(storage.get('alco_diagnostic_events_v1') || '',tokens,'Export diagnostics');
  }
  assertUnchanged(sourceBefore,{context,state,storage:sourceStorage()},'Export changed V5/source');
}

const {context,state,storage}=createIdentityExportFixture();
const zipTokens=identityTokens(context);
const frozen=createDocumentSnapshot(context,'docx','data','CP');const frozenBefore=JSON.stringify(frozen);
const historical={...context,school:{...context.school,name:'LIVE_SCHOOL_DIFFERENT'},profile:{...context.profile,name:'LIVE_TEACHER_DIFFERENT'},snapshot:frozen,documentMode:'blank' as const};
const old=await generateDocumentFormatted('CP',historical,'docx');
await inspectDocx(old.blob!,[frozen.schoolName,frozen.teacherName,'LIVE_SCHOOL_DIFFERENT','LIVE_TEACHER_DIFFERENT'],'historical');
assertPrivate(old.snapshot,[frozen.schoolName,frozen.teacherName],'historical snapshot');assert.equal(JSON.stringify(frozen),frozenBefore);
assert.equal(old.snapshot.documentMode,'blank');assert.equal(frozen.documentMode,'data');
assert.equal(resolveEffectiveContext({...historical,documentMode:'data'}).school.name,frozen.schoolName,'Data snapshot authority changed');
assert.deepEqual(maskExportIdentity(maskExportIdentity(historical)),maskExportIdentity(historical),'Mask must be idempotent');
for(const type of ['CP','ATP','MODUL_AJAR','ASESMEN','JURNAL'] as DocumentType[]) {
  const missing={...context,cp:undefined,tp:undefined,atp:undefined,learningPlans:[],assessmentPackages:[],learningMeetingSchedules:[]};
  assert.equal(validateDocumentRequirements(type,{...missing,documentMode:'data'}).isValid,false);
  assert.equal(validateDocumentRequirements(type,{...missing,documentMode:'blank'}).isValid,false);
  await assert.rejects(()=>generateDocument(type,{...missing,documentMode:'blank'}));
  await assert.rejects(()=>generatePdfDocument(type,{...missing,documentMode:'blank'}));
}
assert.throws(()=>createAssessmentDocumentSnapshot({...context,documentMode:'blank',documentDate:undefined,workspace:undefined}));
assert.throws(()=>createAssessmentDocumentSnapshot({...context,documentMode:'blank',snapshot:{...frozen,mode:'BLANK_TEMPLATE',documentType:'ASESMEN'} as any}));
assert.equal(buildModulAjarProjection({...context,documentMode:'blank',learningPlans:[]}).isReady,false);

// Multi-instance + both semesters. Use existing annual work planner for both modes.
for(const row of state.semesterData.learningPlan) row.value.push({...structuredClone(row.value[0]),id:row.value[0].id+'-second'});
for(const row of state.semesterData.assessmentPackage) row.value.push({...structuredClone(row.value[0]),id:row.value[0].id+'-second'});
const zipStorage=()=>[...storage].filter(([key])=>key!=='alco_diagnostic_events_v1');
const zipBefore=JSON.stringify({state,storage:zipStorage()});
const dataPlan=buildAnnualZipWorkItems(types,{...context,documentMode:'data'}),blankPlan=buildAnnualZipWorkItems(types,{...context,documentMode:'blank'});
assert.deepEqual(blankPlan.items.map(i=>[i.type,i.instanceId,i.folderCategory]),dataPlan.items.map(i=>[i.type,i.instanceId,i.folderCategory]),'Annual work coverage differs');
const zd=await generateZipBundle({format:'both',types,documentMode:'data'},{...context,skipDownload:true});
const zb=await generateZipBundle({format:'both',types,documentMode:'blank'},{...context,skipDownload:true});
assert.deepEqual(zb.itemResults?.map(i=>[i.type,i.instanceId,i.status]),zd.itemResults?.map(i=>[i.type,i.instanceId,i.status]),'ZIP status/coverage differs');
assert.equal(zb.exportedCount,zd.exportedCount);assert.equal(zb.docxCount,zd.docxCount);assert.equal(zb.pdfCount,zd.pdfCount);
assert((zb.itemResults?.filter(i=>i.type==='MODUL_AJAR' && i.status==='SUCCESS').length || 0)>=4,'ZIP must contain every ready module instance in both semesters');
const archive=await JSZip.loadAsync(await zb.zipBlob!.arrayBuffer());let checked=0;
for(const file of Object.values(archive.files).filter(f=>!f.dir)) {
  assertPrivate(file.name,zipTokens,'ZIP path');
  const blob=new Blob([await file.async('uint8array')]);
  if(file.name.endsWith('.docx'))await inspectDocx(blob,zipTokens,file.name);
  else if(file.name.endsWith('.pdf'))await inspectPdf(blob,zipTokens,file.name);
  else assertPrivate(await file.async('string'),zipTokens,file.name);
  checked++;
}
assertPrivate(zb.snapshots,zipTokens,'ZIP snapshots');
assertUnchanged(zipBefore,{state,storage:zipStorage()},'ZIP modified source/checkpoint');
writeFileSync(`${out}/blank-bundle.zip`,Buffer.from(await zb.zipBlob!.arrayBuffer()));
writeFileSync(`${out}/results.json`,JSON.stringify({results,zip:{files:checked,docx:zb.docxCount,pdf:zb.pdfCount,items:zb.itemResults},docxVisual:'BLOCKED until Word/LibreOffice render succeeds'},null,2));
assert(results.every(r=>!r.pdfBounds.length),'Inspect PDF bounds failures in results.json');
const ui=readFileSync('src/components/AdminDocsExport.tsx','utf8');assert(ui.includes('Format Kosong — isi administrasi lengkap, tanpa identitas guru dan sekolah.'));
// Actual UI single/bulk handlers, real generators, intercepted downloads only.
const blankContext={...context,documentMode:'blank' as const,learningPlans:context.learningPlans?.slice(0,1),assessmentPackages:context.assessmentPackages?.slice(0,1)};
const downloads:Blob[]=[];const messages:string[]=[];let updates=0;
const bindings:any={context:blankContext,academicSetting:context.academicSetting,workspace:context.workspace,documentMode:'blank',localDocs:[],historicalModulSnapshot:undefined,
  getDocRecord:()=>({id:'historic',type:'CP',snapshot:frozen}),resolveEffectiveContext,createDocumentSnapshot,validateDocumentRequirements,
  generateDocument:async(...args:Parameters<typeof generateDocument>)=>{const r=await generateDocument(...args);downloads.push(r.blob!);return r;},generatePdfDocument,
  saveAs:(blob:Blob)=>downloads.push(blob),setLocalDocs:()=>updates++,onUpdateDocuments:()=>updates++,
  setGeneratingDocType:()=>{},setIsExportingAll:()=>{},setExportErrorMessage:(s:string)=>{if(s)assert.fail(s);},setExportSuccessMessage:(s:string)=>{if(s)messages.push(s);},
  getCurriculumType,getCurriculumDocumentTypes,isK13KKMValid:false,
  setTimeout:(fn:()=>void)=>{fn();return 0;}};
const single=evaluateExpression(initializer('src/components/AdminDocsExport.tsx','handleGenerateSingleDoc'),bindings);
await single('CP','docx');await single('CP','pdf');
const bulk=evaluateExpression(initializer('src/components/AdminDocsExport.tsx','handleGenerateAllDocs'),bindings);
await bulk('docx');await bulk('pdf');
assert.equal(downloads.length,2+2*getCurriculumDocumentTypes('KURIKULUM_MERDEKA',{hasK13KKM:false,includeKkm:false}).length,'Single and bulk downloads must all execute');
assert.equal(updates,0,'Blank export must not overwrite historical records');
for(const [i,blob] of downloads.entries()) {
  if(blob.type.includes('pdf')) await inspectPdf(blob,zipTokens,'UI download '+i);
  else await inspectDocx(blob,zipTokens,'UI download '+i);
}
console.log(`PASS ${results.length} paired document cases; ${checked} actual ZIP files; frozen snapshots/V5 unchanged; incomplete sources rejected. DOCX visual render NOT VERIFIED.`);
