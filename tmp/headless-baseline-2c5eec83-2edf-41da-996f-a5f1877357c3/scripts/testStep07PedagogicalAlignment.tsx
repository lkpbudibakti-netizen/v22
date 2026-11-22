import assert from 'node:assert/strict';
import React from 'react';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { classifyMappingTitle, applyMinimalAlignment, mappingActionKind, versionMappingUpdate, undoMappingTitle, buildMappingPedagogicalReport, mappingRevisionKeys, type AlignmentAction } from '../src/services/mappingAlignmentService';
import { sanitizeMappingAnalysisResult, fallbackAnalyzeMapping } from '../server/mappingAnalysis';
import { validateATPUnitMappingCanonical } from '../src/services/atpUnitMappingValidationService';
import { resolveATPUnitMappingReadiness } from '../src/services/atpMappingReadinessService';
import { computeMappingFingerprint, applyATPMappingActions, buildMappingDraftFromUnits } from '../src/services/atpMappingActionApplyService';
import { createInitialUnits, buildCurrentMappingDraftFromUnits } from '../src/components/ATPUnitMappingManager';
import { AlignmentProposalReview } from '../src/components/AlignmentProposalReview';
import { nodes, nodeText, byId } from './helpers/uiContractHarness';
import { isUnitExecutionPlanStale } from '../src/services/unitExecutionPlanService';
import { parseBabMateriXlsx } from '../src/services/atpUnitMappingImportService';
import { createReadyV21WorkflowFixture, v21DocumentContext } from './fixtures/v21ReadyWorkflowFixture';
import { createModulAjarRuntimeFixture } from './fixtures/modulAjarRuntimeFixture';
import { saveATPUnitMappingV5, loadStorageV5, serializeBackupV5, parseBackupV5, saveStorageV5 } from '../src/services/storageV5';
import { buildModulAjarProjection } from '../src/services/documentEngine/modulAjarProjection';
import { generateDocument } from '../src/services/documentEngine';
import { generatePdfDocument } from '../src/services/documentEngine/renderers/pdf/pdfDocGenerators';
import type { ATPData, TPData, ATPUnitMappingData } from '../src/types';

const memory=new Map<string,string>();
(globalThis as any).localStorage={getItem:(k:string)=>memory.get(k)||null,setItem:(k:string,v:string)=>memory.set(k,v),removeItem:(k:string)=>memory.delete(k),clear:()=>memory.clear()};
const stamp='2026-11-08T00:00:00.000Z';
function fixture() {
  const tp:TPData={id:'tp',academicSettingId:'y',workflowStatus:'SIAP',updatedAt:stamp,items:[
    {id:'t1',code:'E1-01',statement:'Mempraktikkan gerak lokomotor berjalan dan berlari.',competence:'Mempraktikkan',contentScope:'Gerak lokomotor',order:1},
    {id:'t2',code:'E2-01',statement:'Mempraktikkan gerak manipulatif lempar dan tangkap bola.',competence:'Mempraktikkan',contentScope:'Gerak manipulatif',order:2},
    {id:'t3',code:'E3-GHA-01',statement:'Menerapkan gaya hidup aktif melalui aktivitas jasmani teratur.',competence:'Menerapkan',contentScope:'Gaya hidup aktif',order:3},
  ]};
  const atp:ATPData={id:'atp',academicSettingId:'y',tpDataId:tp.id,workflowStatus:'SIAP',updatedAt:stamp,basedOnTpUpdatedAt:stamp,items:tp.items.map((t,i)=>({id:'a'+(i+1),stepNumber:i+1,linkedTpIds:[t.id],focus:t.contentScope}))};
  const mapping:ATPUnitMappingData={id:'mapping',academicSettingId:'y',atpId:atp.id,tpDataId:tp.id,updatedAt:stamp,units:tp.items.map((t,i)=>({
    id:'u'+(i+1),title:['Gerakan lokomotor','Keterampilan manipulatif bola','Bab 3 Gaya Hidup Aktif'][i],order:i+1,linkedTpIds:[t.id],linkedAtpItemIds:['a'+(i+1)],
    materials:[{id:'m'+(i+1),title:['Tehnik gerakan lokomotor berjalan','Gerak manipulatif lempar tangkap bola kecil','Aktivitas jasmani teratur'][i],order:1,linkedTpIds:[t.id],linkedAtpItemIds:['a'+(i+1)]}],
  }))};
  return {tp,atp,mapping};
}
function action(f:ReturnType<typeof fixture>, type:AlignmentAction['type'], unitIndex:number, after?:string, material=false):AlignmentAction {
  const unit=f.mapping.units[unitIndex], entity=material?unit.materials[0]:unit;
  return {id:`${type}-${unit.id}`,type,targetUnitId:unit.id,targetMaterialId:material?entity.id:undefined,before:entity.title,after,
    linkedTpIds:[...entity.linkedTpIds],reason:'Tinjau aktivitas, kompetensi dan cakupan TP melalui kutipan sumber sebelum menyetujui perubahan.',
    evidence:entity.linkedTpIds.map(tpId=>({tpId,tpQuote:f.tp.items.find(t=>t.id===tpId)!.statement,materialQuote:entity.title}))};
}
let passed=0;
async function test(name:string, run:()=>void|Promise<void>) { await run(); passed++; console.log(`PASS ${passed}. ${name}`); }
await test('COPYEDIT ejaan, kapitalisasi dan spasi otomatis, tercatat tanpa mutasi canonical',()=>{
  const f=fixture(), before=JSON.stringify(f);
  const report=sanitizeMappingAnalysisResult({}, {currentMapping:f.mapping,tpData:f.tp,atpData:f.atp});
  const edits=report.alignmentProposals!.filter(p=>p.action&&p.approval==='AUTOMATIC');
  assert(edits.length);const changed=applyMinimalAlignment(f.mapping.units,edits.map(p=>p.action!),f.atp,f.tp);
  assert(changed.success,changed.issues.join(';'));assert.equal(changed.nextUnits![0].materials[0].title,'Teknik gerakan lokomotor berjalan');
  assert.equal(changed.nextUnits![0].materials[0].originalTitle,f.mapping.units[0].materials[0].title);
  assert.equal(changed.nextUnits![0].materials[0].titleHistory![0].approval,'AUTOMATIC');assert.equal(JSON.stringify(f),before);
  assert.equal(classifyMappingTitle('Latihan 1/2 putaran','Latihan 1,2 putaran'),'CONTENT_CHANGE','numeric punctuation cannot silently alter scope');
});
await test('RENAME setara memakai aturan tertutup; judul Bab boleh disunting, lineage tetap',()=>{
  const f=fixture(), a=action(f,'EDIT_UNIT_TITLE',0,'Gerak lokomotor');
  assert.equal(mappingActionKind(a,f.mapping.units),'RENAME');
  const result=applyMinimalAlignment(f.mapping.units,[a],f.atp,f.tp);assert(result.success,result.issues.join(';'));
  assert.equal(result.nextUnits![0].title,'Gerak lokomotor');assert.deepEqual(result.nextUnits![0].linkedTpIds,['t1']);
  assert.deepEqual(result.nextUnits![0].materials,f.mapping.units[0].materials);
});
await test('Perubahan satu kata yang mengubah cakupan adalah CONTENT_CHANGE, wajib guru',()=>{
  const f=fixture(), a=action(f,'EDIT_MATERIAL',1,'Gerak manipulatif lempar tangkap bola besar',true);
  const proposal=sanitizeMappingAnalysisResult({alignmentProposals:[a]}, {currentMapping:f.mapping,tpData:f.tp,atpData:f.atp}).alignmentProposals!.find(p=>p.action?.id===a.id)!;
  assert.equal(proposal.changeKind,'CONTENT_CHANGE');assert.equal(proposal.approval,'TEACHER');
  assert.equal(JSON.stringify(f.mapping.units).includes('bola besar'),false);
});
await test('PJOK kelas 4 Bab 3 E3-GHA-01: global coverage bukan dukungan materi; tidak dipaksa',()=>{
  const f=fixture();f.mapping.units[2].materials[0].linkedTpIds=[];f.mapping.units[2].materials[0].linkedAtpItemIds=[];
  const before=JSON.stringify(f), validation=validateATPUnitMappingCanonical(f.mapping,f.atp,f.tp);
  assert.deepEqual(validation.uncoveredTpIds,[]);assert.equal(validation.isComplete,false);
  const findings=buildMappingPedagogicalReport(f.mapping.units,f.atp,f.tp), gap=findings.find(x=>x.category==='UNIT_LINEAGE'&&x.unitId==='u3')!;
  assert(gap.actual.includes('E3-GHA-01'));assert(gap.recommendation.includes('Pilihan guru'));assert.equal(gap.approval,'TEACHER');
  assert.equal(resolveATPUnitMappingReadiness(f.mapping,f.atp,f.tp).canProceed,false);assert.equal(JSON.stringify(f),before);
});
await test('Satu TP boleh muncul pada beberapa Bab dan Materi dengan ID berbeda',()=>{
  const f=fixture();f.mapping.units.push({...structuredClone(f.mapping.units[0]),id:'u4',order:4,materials:[{...f.mapping.units[0].materials[0],id:'m4'}]});
  const v=validateATPUnitMappingCanonical(f.mapping,f.atp,f.tp);assert(v.isValid&&v.isComplete,v.issues.join(';'));
});
await test('Materi TP tidak relevan ditolak; overlap keyword tidak menciptakan relasi atau ALIGNED',()=>{
  const f=fixture();f.mapping.units[0].materials[0].title='Penjumlahan bilangan bulat';
  const readiness=resolveATPUnitMappingReadiness(f.mapping,f.atp,f.tp);assert(readiness.canProceed);assert.equal(readiness.validationResult!.semanticConflicts!.length,0);
  const raw={materialFindings:[{unitId:'u1',materialId:'m1',status:'SUPPORTED',supportingTpIds:['t1'],reason:'AI mengklaim selaras'}]};
  const result=sanitizeMappingAnalysisResult(raw,{currentMapping:f.mapping,tpData:f.tp,atpData:f.atp});assert.equal(result.materialFindings.find(m=>m.materialId==='m1')!.status,'MANUAL_REVIEW');
  const bare=fixture();bare.mapping.units[0].materials[0].linkedTpIds=[];bare.mapping.units[0].materials[0].linkedAtpItemIds=[];
  const fallback=fallbackAnalyzeMapping({currentMapping:bare.mapping,tpData:bare.tp,atpData:bare.atp});
  assert.equal(fallback.materialFindings.find(m=>m.materialId==='m1')!.action,undefined);
});
await test('Judul materi duplikat dengan fokus berbeda ditinjau, tidak dihapus/digabung otomatis',()=>{
  const f=fixture();f.mapping.units[0].materials[0].title='Aktivitas jasmani';f.mapping.units[2].materials[0].title='Aktivitas jasmani';
  const report=buildMappingPedagogicalReport(f.mapping.units,f.atp,f.tp);assert.equal(report.filter(r=>r.category==='POSSIBLE_DUPLICATE').length,2);
  assert(report.filter(r=>r.category==='POSSIBLE_DUPLICATE').every(r=>r.status==='NEEDS_REVIEW'&&r.recommendation.includes('fokus berbeda')));
  assert.equal(f.mapping.units.flatMap(u=>u.materials).length,3);
});
await test('Edit manual setelah analisis menolak apply dan undo stale',()=>{
  const f=fixture(), a=action(f,'EDIT_UNIT_TITLE',0,'Gerak lokomotor'), fp=computeMappingFingerprint(f.mapping.units,f.atp,f.tp);
  f.mapping.units[0].title='Gerakan lokomotor berjalan';
  assert(!applyATPMappingActions({units:f.mapping.units,atp:f.atp,tp:f.tp,selectedActions:[a],expectedFingerprint:fp,currentFingerprint:fp}).success);
  const fresh=fixture(), applied=applyMinimalAlignment(fresh.mapping.units,[action(fresh,'EDIT_UNIT_TITLE',0,'Gerak lokomotor')],fresh.atp,fresh.tp);
  applied.nextUnits![0].title='Edit guru sesudah AI';assert(!undoMappingTitle(applied.nextUnits!,'u1').success);
});
await test('Analisis ulang idempotent, rename bolak-balik dicegah, undo dihormati',()=>{
  const f=fixture(), a=action(f,'EDIT_UNIT_TITLE',0,'Gerak lokomotor');
  const applied=applyMinimalAlignment(f.mapping.units,[a],f.atp,f.tp);assert(applied.success);
  const reverse={...a,before:'Gerak lokomotor',after:'Gerakan lokomotor'};
  const rerun=applyMinimalAlignment(applied.nextUnits!,[reverse],f.atp,f.tp);assert.deepEqual(rerun.nextUnits,applied.nextUnits);
  const undone=undoMappingTitle(applied.nextUnits!,'u1');assert(undone.success);assert.equal(undone.nextUnits![0].title,a.before);
  const again=applyMinimalAlignment(undone.nextUnits!,[a],f.atp,f.tp);assert.deepEqual(again.nextUnits,undone.nextUnits);
});
await test('Versi struktur/substansi/presentasi dan invalidasi setelah validasi terpisah',()=>{
  const f=fixture(), copy=structuredClone(f.mapping);copy.units[0].title='GERAKAN LOKOMOTOR';copy.updatedAt='2026-11-08T01:00:00Z';
  const presentation=versionMappingUpdate(f.mapping,copy);assert.equal(presentation.updatedAt,f.mapping.updatedAt);assert.equal(presentation.revisions!.substance,1);assert.equal(presentation.revisions!.presentation,2);
  const plan:any={mappingId:f.mapping.id,basedOnMappingUpdatedAt:f.mapping.updatedAt};assert(!isUnitExecutionPlanStale(plan,presentation));
  const changed=structuredClone(presentation);changed.units[0].materials[0].title='Gerakan lokomotor berjalan dan berlari';
  const substantive=versionMappingUpdate(presentation,changed,'2026-11-08T02:00:00Z');assert(isUnitExecutionPlanStale(plan,substantive));assert.equal(substantive.revisions!.substance,2);
  const restructured=structuredClone(substantive);restructured.units[0].materials.push({...restructured.units[0].materials[0],id:'new-material',order:2});
  assert.equal(versionMappingUpdate(substantive,restructured).revisions!.structure,2);
});
await test('Import lama, metadata lossless, penyimpanan, backup/restore tidak menghapus pemetaan manual',()=>{
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet([{babOrder:1,babTitle:'Bab Manual',materialOrder:1,materialTitle:'Materi Manual'}]),'BAB_MATERI');
  const imported=parseBabMateriXlsx(XLSX.write(book,{type:'buffer',bookType:'xlsx'}));assert(imported.success);assert.equal(imported.units![0].title,'Bab Manual');
  const f=fixture(), applied=applyMinimalAlignment(f.mapping.units,[action(f,'EDIT_UNIT_TITLE',0,'Gerak lokomotor')],f.atp,f.tp);
  const initial=createInitialUnits({...f.mapping,units:applied.nextUnits!},f.atp.items);assert.deepEqual(initial,applied.nextUnits);
  assert.deepEqual(buildMappingDraftFromUnits(initial).units,initial);assert.deepEqual(buildCurrentMappingDraftFromUnits(initial).units,initial);
  const state=createReadyV21WorkflowFixture();const previous=state.annualData.atpUnitMappings![0].value;
  const renamed=structuredClone(previous);renamed.units[0].title=renamed.units[0].title.toLocaleUpperCase('id');renamed.updatedAt='2026-11-08T03:00:00Z';
  const saved=saveATPUnitMappingV5('y',renamed);assert.equal(saved.updatedAt,previous.updatedAt);assert(saved.units[0].titleHistory!.length);
  const backup=parseBackupV5(serializeBackupV5(loadStorageV5()));assert(backup);saveStorageV5(backup);assert.equal(loadStorageV5().annualData.atpUnitMappings![0].value.units[0].title,saved.units[0].title);
});
await test('Judul terbaru pada Prota/Promes/Modul Ajar DOCX dan PDF, TP/ATP serta jadwal tetap',async()=>{
  const state=createReadyV21WorkflowFixture(), original=state.annualData.atpUnitMappings![0].value;
  const updated=structuredClone(original);updated.units[0].title=updated.units[0].title.toLocaleUpperCase('id');updated.units[0].materials[0].title=updated.units[0].materials[0].title.toLocaleUpperCase('id');
  saveATPUnitMappingV5('y',updated);const context=v21DocumentContext(loadStorageV5());
  const moduleContext=createModulAjarRuntimeFixture();const moduleBefore=structuredClone(moduleContext.atpUnitMapping);
  const moduleUpdated=structuredClone(moduleBefore);moduleUpdated.units[0].title='UNIT';moduleUpdated.units[0].materials[0].title='MATERI T1';
  moduleContext.atpUnitMapping=versionMappingUpdate(moduleBefore,moduleUpdated);moduleContext.skipDownload=true;
  moduleContext.academicSetting.academicYear='2026/2027';moduleContext.documentDate='2026-11-08';
  assert.equal(buildModulAjarProjection(moduleContext).unitTitle,'UNIT');
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  for(const type of ['PROTA','PROMES','MODUL_AJAR'] as const){
    const ctx=type==='MODUL_AJAR'?moduleContext:context;const expected=type==='MODUL_AJAR'?['UNIT','MATERI T1']:[updated.units[0].title,updated.units[0].materials[0].title];
    const before=JSON.stringify(ctx), doc=await generateDocument(type,ctx), pdf=await generatePdfDocument(type,ctx);
    const xml=await(await JSZip.loadAsync(await doc.blob!.arrayBuffer())).file('word/document.xml')!.async('string');
    const task=getDocument({data:new Uint8Array(await pdf.blob.arrayBuffer()),useSystemFonts:true});const parsed=await task.promise;let text='';
    for(let p=1;p<=parsed.numPages;p++)text+=(await(await parsed.getPage(p)).getTextContent()).items.map((x:any)=>x.str||'').join(' ');
    for(const title of expected){assert(xml.includes(title),`${type} DOCX lacks ${title}`);assert(text.replace(/\s/g,'').includes(title.replace(/\s/g,'')),`${type} PDF lacks ${title}`);}
    await task.destroy();assert.equal(JSON.stringify(ctx),before);
  }
});
await test('Laporan progressive disclosure memakai readiness validator; tanpa konfirmasi kosong',()=>{
  const f=fixture(), readiness=resolveATPUnitMappingReadiness(f.mapping,f.atp,f.tp);
  const tree=AlignmentProposalReview({proposals:[],selectedIds:new Set(),onSelectionChange:()=>{},readiness,findings:buildMappingPedagogicalReport(f.mapping.units,f.atp,f.tp),units:f.mapping.units,atp:f.atp,tp:f.tp});
  assert.match(nodeText(byId(tree,'mapping-readiness-report')), /READY Step 08:\s+Ya/);
  assert(nodes(tree,n=>n.type==='details').length>2);assert.equal(nodes(tree,n=>n.type==='input'&&n.props.type==='checkbox').length,0);
});
console.log(`PASS ${passed}/${passed}: Step 07 pedagogical authority, report UX, versioning, legacy persistence and downstream exports. Live Gemini and browser visual QA are separate checks.`);
