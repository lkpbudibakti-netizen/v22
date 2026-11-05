import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CompleteProjectImportModal } from '../src/components/CompleteProjectImportModal';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import JSZip from 'jszip';
import { inflateSync } from 'node:zlib';
import { createReadyAdministrationImportFixture } from './fixtures/readyAdministrationImportFixture';
import { createCompleteProjectZip, readCompleteProjectZip } from '../src/services/completeProjectZipService';
import { prepareCompleteAdministrationProjectImport, importCompleteAdministrationProject, importCompleteAdministrationProjectAndExport } from '../src/services/administrationProjectImportService';
import { completeImportModalHarness } from './fixtures/completeImportModalHarness';
import { buildImportedProjectExportContext, importedProjectExportReadiness } from '../src/services/identityOnlyProjectExport';
import { resolveAnnualZipContexts, buildAnnualZipWorkItems, administrationZipRoot, isAnnualZipDocument, semesterZipFolder } from '../src/services/documentEngine/annualZipPlan';
import { buildModulAjarProjection } from '../src/services/documentEngine/modulAjarProjection';
import { validateLearningMeetingScheduleData } from '../src/services/learningMeetingScheduleService';
import { validateDocumentRequirements, generateDocument } from '../src/services/documentEngine';
import { generatePdfDocument } from '../src/services/documentEngine/renderers/pdf/pdfDocGenerators';
import { resolveEffectiveContext } from '../src/services/documentEngine/snapshot';
import { getCurriculumType } from '../src/services/curriculumRules';
import { STORAGE_KEY_V5 } from '../src/services/storageV5';
import { loadStorageV5 } from '../src/services/storageV5';

const source = createReadyAdministrationImportFixture();
const initial = JSON.stringify(source);
const modal = renderToStaticMarkup(<CompleteProjectImportModal state={source} onClose={() => {}} onSuccess={() => {}} />);
for (const label of ['Ganti Identitas Saja','Salin ke Profil Lain','Pulihkan Proyek']) assert(modal.includes(label));
const sourceContext = buildImportedProjectExportContext(source,'y');
const sourceSemester = resolveAnnualZipContexts(sourceContext).semesters[0].context;
assert(buildModulAjarProjection({ ...sourceSemester, activeLearningPlanId:'lp' }).isReady, buildModulAjarProjection({ ...sourceSemester, activeLearningPlanId:'lp' }).error);
assert(validateDocumentRequirements('ASESMEN',{...sourceSemester,activeAssessmentPackageId:'pkg'}).isValid);
const sourceTiming = validateLearningMeetingScheduleData({ data:source.semesterData.learningMeetingSchedules![0].value, semester:1,
  mapping:source.annualData.atpUnitMappings![0].value, unitExecutionPlan:source.annualData.unitExecutionPlans![0].value,
  subjectWeeklySchedule:source.semesterData.subjectWeeklySchedules![0].value, expectedWeeklyJP:2,
  calendar:source.semesterData.academicCalendar[0].value.calendar,calendarDays:source.semesterData.academicCalendar[0].value.days });
assert(sourceTiming.isValid && !sourceTiming.isStale, sourceTiming.errors.join('; '));
const bytes = await createCompleteProjectZip(source,'y');
const archive = await readCompleteProjectZip(bytes);
const options = { mode:'IDENTITY_ONLY' as const,targetProfileId:'p2',targetSchoolId:'s2',documentDate:'2026-10-27' };
const result = prepareCompleteAdministrationProjectImport(source,archive,options);
assert.equal(JSON.stringify(source),initial);
assert.equal(result.step7.target.canProceed,true,result.step7.target.blockers.join('; '));
const targetTP = result.state.annualData.tp.find(entry => entry.yearPlanId === result.yearPlanId)!.value;
const targetATP = result.state.annualData.atp.find(entry => entry.yearPlanId === result.yearPlanId)!.value;
assert.deepEqual(targetTP.items.map(item=>[item.code,item.statement,item.competence,item.contentScope]), source.annualData.tp[0].value.items.map(item=>[item.code,item.statement,item.competence,item.contentScope]));
assert.deepEqual(targetATP.items.map(item=>[item.stepNumber,item.focus]), source.annualData.atp[0].value.items.map(item=>[item.stepNumber,item.focus]));
const targetMapping = result.state.annualData.atpUnitMappings!.find(entry=>entry.yearPlanId===result.yearPlanId)!.value;
assert.deepEqual(targetMapping.units.map(unit=>[unit.order,unit.title,unit.materials.map(material=>material.title)]),source.annualData.atpUnitMappings![0].value.units.map(unit=>[unit.order,unit.title,unit.materials.map(material=>material.title)]));
assert(targetTP.items.every(item=>!source.annualData.tp[0].value.items.some(old=>old.id===item.id)));
const context = buildImportedProjectExportContext(result.state,result.yearPlanId);
assert.equal(context.profile.name,'GURU_TUJUAN_TEST'); assert.equal(context.school.npsn,'33333333');
assert(context.academicSetting.planningReferenceNotice?.includes('data sumber'));
const work = buildAnnualZipWorkItems(['MODUL_AJAR','ASESMEN','CP','TP','ATP'],context);
const module = work.items.find(item=>item.type==='MODUL_AJAR')!;
const assessment = work.items.find(item=>item.type==='ASESMEN')!;
assert(module,JSON.stringify(work.skipped)); assert(assessment);
assert(buildModulAjarProjection(module.context).isReady,buildModulAjarProjection(module.context).error);
assert(validateDocumentRequirements('ASESMEN',assessment.context).isValid);
assert.equal(context.students?.length,0); assert.equal(context.attendanceSessions?.length,0); assert.equal(context.journalRealizations?.length,0);
assert.equal(result.state.documents.length,source.documents.length,'No source document records copied to the new project');
assert.equal(JSON.stringify(result.state.yearPlans.find(year=>year.id==='y')),JSON.stringify(source.yearPlans[0]));
const schedule = result.state.semesterData.learningMeetingSchedules!.find(entry=>entry.semesterPlanId===module.context.academicSetting.id)!.value;
assert.equal(schedule.status,'COMPLETE'); assert(!schedule.entries[0].sourceSlotId.includes('sp1'));
assert.equal(schedule.entries[0].jp,2); assert.equal(schedule.entries[0].date,'2026-08-03');
assert.equal(module.context.learningPlans![0].status,'SIAP'); assert.equal(assessment.context.assessmentPackages![0].workflowStatus,'SIAP');
assert(!JSON.stringify(assessment.context.assessmentPackages).includes('GURU_ASAL_TEST'));
assert(importedProjectExportReadiness(result.state,result.yearPlanId).readyCount>0);
const reexported = await readCompleteProjectZip(await createCompleteProjectZip(result.state,result.yearPlanId));
assert.equal(reexported.project.profiles[0].name,'GURU_TUJUAN_TEST');
assert(!JSON.stringify(reexported.project).includes('MURID_ASAL'));
assert(!JSON.stringify(reexported.project).includes('HASIL_ASAL'));
for (const item of [module,assessment]) {
  const docx = await generateDocument(item.type,item.context);
  const xml = await (await JSZip.loadAsync(await docx.blob!.arrayBuffer())).file('word/document.xml')!.async('string');
  const pdf = await generatePdfDocument(item.type,item.context);
  const raw = Buffer.from(await pdf.blob.arrayBuffer()).toString('latin1');
  const streams = [...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(match=>{try{return inflateSync(Buffer.from(match[1],'latin1')).toString('latin1');}catch{return '';}}).join('');
  const text = [...streams.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)].map(match=>match[1]).join('');
  for (const rendered of [xml,text]) {
    for (const forbidden of ['GURU_ASAL_TEST','SEKOLAH_ASAL_TEST','ALAMAT_ASAL_TEST','KEPSEK_ASAL_TEST','111111111111111111','11111111','222222222222222222']) assert(!rendered.includes(forbidden),forbidden);
    assert(rendered.includes('GURU_TUJUAN_TEST') && rendered.includes('SEKOLAH_TUJUAN_TEST'));
    assert(rendered.includes('33333333') && rendered.includes('333333333333333333') && rendered.includes('444444444444444444'));
  }
  if(item.type==='MODUL_AJAR') assert(xml.includes('data sumber') && text.includes('data sumber'));
}
const stale=structuredClone(archive); stale.project.annualData.atpUnitMappings![0].value.basedOnTpFingerprint='stale-source';
assert(!prepareCompleteAdministrationProjectImport(source,stale,options).step7.target.canProceed);
const manual=structuredClone(archive);
manual.project.semesterData.learningMeetingSchedules![0].value.entries[0].mode='MANUAL_OVERRIDE';
manual.project.semesterData.learningMeetingSchedules![0].value.entries[0].sourceSlotId='manual-slot:sp1:meet:2026-08-03:session';
const manualImport=prepareCompleteAdministrationProjectImport(source,manual,options);
const manualSchedule=manualImport.state.semesterData.learningMeetingSchedules!.find(entry=>entry.semesterPlanId!== 'sp1')!.value;
assert.equal(manualSchedule.status,'DRAFT','Invalid source manual override must not become complete just because IDs were rebased');
assert(manualImport.warnings.some(warning=>warning.includes('sudah memiliki slot otomatis')));
assert(manualSchedule.entries[0].sourceSlotId.startsWith('manual-slot:transfer-'));
const invalidAssessment=structuredClone(archive); invalidAssessment.project.semesterData.assessmentPackage[0].value[0].answerKeys[0].optionIds=['missing-option'];
const invalidAssessmentImport=prepareCompleteAdministrationProjectImport(source,invalidAssessment,options);
const invalidPackage=invalidAssessmentImport.state.semesterData.assessmentPackage.find(entry=>entry.semesterPlanId!=='sp1')!.value[0];
assert.equal(invalidPackage.workflowStatus,'DRAFT'); assert(invalidPackage.needsReview);
const badTiming=structuredClone(archive); badTiming.project.semesterData.learningMeetingSchedules![0].value.basedOnCalendarUpdatedAt='stale';
const badResult=prepareCompleteAdministrationProjectImport(source,badTiming,options);
assert(!buildAnnualZipWorkItems(['MODUL_AJAR'],buildImportedProjectExportContext(badResult.state,badResult.yearPlanId)).items.some(item=>item.context.learningPlans?.[0].status==='SIAP'));
const draft=structuredClone(archive); draft.project.annualData.tp[0].value.workflowStatus='DRAFT';
assert(!prepareCompleteAdministrationProjectImport(source,draft,options).step7.target.canProceed);
const prose = structuredClone(archive); prose.project.semesterData.learningPlan[0].value[0].topic='Latihan di SEKOLAH_ASAL_TEST';
const proseImport = prepareCompleteAdministrationProjectImport(source,prose,options);
const proseModule = buildAnnualZipWorkItems(['MODUL_AJAR'],buildImportedProjectExportContext(proseImport.state,proseImport.yearPlanId)).items[0];
assert(proseModule); assert(!validateDocumentRequirements('MODUL_AJAR',proseModule.context).isValid);
assert(validateDocumentRequirements('MODUL_AJAR',proseModule.context).missingFields.some(reason=>reason.includes('teks sumber')));
assert.equal(proseModule.context.learningPlans![0].topic,'Latihan di SEKOLAH_ASAL_TEST');
assert.throws(()=>prepareCompleteAdministrationProjectImport(result.state,archive,options),/Konflik proyek/);
assert.throws(()=>prepareCompleteAdministrationProjectImport(source,archive,{...options,targetSchoolId:'s1'}),/tidak sesuai/);
assert.throws(()=>prepareCompleteAdministrationProjectImport(source,archive,{...options,documentDate:''}),/tanggal dokumen/);
const broken=structuredClone(archive); broken.project.annualData.atpUnitMappings![0].value.units[0].materials[0].linkedTpIds=['missing'];
const storage=new Map<string,string>([[STORAGE_KEY_V5,initial]]);
(globalThis as any).localStorage={getItem:(key:string)=>storage.get(key)||null,setItem:(key:string,value:string)=>storage.set(key,value)};
let writes=0;
assert.throws(()=>importCompleteAdministrationProject(broken,options,()=>{writes++;})); assert.equal(writes,0); assert.equal(storage.get(STORAGE_KEY_V5),initial);
const committed=importCompleteAdministrationProject(archive,options,next=>{writes++;storage.set(STORAGE_KEY_V5,JSON.stringify(next));});
assert.equal(writes,1); assert.equal(committed.step7.target.canProceed,true);

// Real ZIP orchestration and real renderer bytes; adapt Blob for Node JSZip only.
const exports:any={}; const downloads:any[]=[];
let failing = false;
const render = async(type:any,ctx:any)=>{if(failing && type==='MODUL_AJAR') throw new Error('Fixture DOCX failed');const res=await generateDocument(type,ctx);const data:any=new Uint8Array(await res.blob!.arrayBuffer());Object.defineProperty(data,'size',{value:data.length});return {...res,blob:data};};
const renderPdf = async(type:any,ctx:any)=>{if(failing && ['MODUL_AJAR','ASESMEN'].includes(type)) throw new Error('Fixture PDF failed');const res=await generatePdfDocument(type,ctx);const data:any=new Uint8Array(await res.blob.arrayBuffer());Object.defineProperty(data,'size',{value:data.length});return {...res,blob:data};};
runInNewContext(ts.transpileModule(readFileSync('src/services/documentEngine/zipBundle.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,console,Error,require:(id:string)=>{
  if(id==='jszip')return JSZip;if(id==='file-saver')return(blob:Blob,name:string)=>downloads.push({blob,name});
  if(id==='./annualZipPlan')return{buildAnnualZipWorkItems,administrationZipRoot,isAnnualZipDocument,semesterZipFolder};
  if(id==='../curriculumRules')return{getCurriculumType};if(id==='./snapshot')return{resolveEffectiveContext};
  if(id==='./index')return{validateDocumentRequirements,generateDocument:render};if(id==='./renderers/pdf/pdfDocGenerators')return{generatePdfDocument:renderPdf};
  if(id==='../curriculumRouter')return{MERDEKA_EXPORT_DOC_TYPES:['MODUL_AJAR','ASESMEN']};throw new Error(id);
}});
const zip=await exports.generateZipBundle({types:['MODUL_AJAR','ASESMEN'],format:'both'},context);
assert.equal(zip.successCount,2); assert(zip.skippedCount>=1,'Missing second-semester assessments must be reported');assert.equal(downloads.length,1);
const zipFiles=await JSZip.loadAsync(await downloads[0].blob.arrayBuffer());
assert.equal(Object.values(zipFiles.files).filter(file=>!file.dir).length,4);
assert(!zip.zipFileName.includes('ASAL'));assert(zip.zipFileName.includes('PJOK'));
failing = true;
const mixed = await exports.generateZipBundle({types:['MODUL_AJAR','ASESMEN','CP'],format:'both'},context);
assert.equal(mixed.successCount,1); assert.equal(mixed.partialCount,1); assert.equal(mixed.failedCount,1); assert(mixed.skippedCount>=1);
assert(mixed.itemResults.some((item:any)=>item.reason?.includes('Fixture PDF failed')));
// Mode 1: upload → one click → real atomic import → real PDF/DOCX ZIP, with no checkbox/second action.
failing = false; storage.set(STORAGE_KEY_V5, initial);
const beforeDownloads = downloads.length;
let flowCalls = 0, successCalls = 0;
const harness = completeImportModalHarness({ state:{...source,activeProfileId:'p2'},onClose:()=>{},onSuccess:()=>{successCalls++;} }, {
  readCompleteProjectZip, prepareCompleteAdministrationProjectImport: () => { throw new Error('No preparation confirmation step for Mode 1'); },
  importCompleteAdministrationProject, importedProjectExportReadiness, loadStorageV5,
  generateZipBundle:exports.generateZipBundle,
  importCompleteAdministrationProjectAndExport: async (value:any,opts:any) => { flowCalls++; return importCompleteAdministrationProjectAndExport(value,opts,exports.generateZipBundle); },
});
await harness.nodes().find(node=>node.type==='input' && node.props.type==='file').props.onChange({target:{files:[{arrayBuffer:async()=>bytes}]}});
const loaded = harness.nodes();
assert(!loaded.some(node=>node.type==='input' && node.props.type==='checkbox'));
const primary = loaded.find(node=>node.type==='button' && harness.text(node).includes('Impor & Unduh ZIP'));
assert(primary && !primary.props.disabled);
await Promise.all([primary.props.onClick(),primary.props.onClick()]);
assert.equal(flowCalls,1); assert.equal(successCalls,1); assert.equal(downloads.length,beforeDownloads+1);
assert(harness.nodes().some(node=>node.props.role==='status'));
console.log('PASS: complete-project ZIP identity-only round-trip, destination DOCX/PDF and ZIP, valid SIAP module/assessment and Step7, exact slot/ID remapping, source provenance/factual separation, stale/draft blocking, conflict/atomic persistence and no source metadata leakage. No live browser claim.');
