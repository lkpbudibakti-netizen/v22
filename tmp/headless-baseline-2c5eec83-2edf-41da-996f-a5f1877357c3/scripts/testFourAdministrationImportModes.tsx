import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { inflateSync } from 'node:zlib';
import { createTwoSemesterAdministrationImportFixture } from './fixtures/readyAdministrationImportFixture';
import { completeImportModalHarness } from './fixtures/completeImportModalHarness';
import { documentZipHarness } from './fixtures/documentZipHarness';
import { ADMINISTRATION_IMPORT_MODES } from '../src/types/completeProjectTransfer';
import { createCompleteProjectZip, readCompleteProjectZip } from '../src/services/completeProjectZipService';
import { prepareCompleteAdministrationProjectImport, importCompleteAdministrationProject, importCompleteAdministrationProjectAndExport } from '../src/services/administrationProjectImportService';
import { buildImportedProjectExportContext, importedProjectExportReadiness } from '../src/services/identityOnlyProjectExport';
import { buildAnnualZipWorkItems, resolveAnnualZipContexts } from '../src/services/documentEngine/annualZipPlan';
import { generateDocument, validateDocumentRequirements } from '../src/services/documentEngine';
import { generatePdfDocument } from '../src/services/documentEngine/renderers/pdf/pdfDocGenerators';
import { createDocumentSnapshot, resolveEffectiveContext } from '../src/services/documentEngine/snapshot';
import { classImportCompatibility, importedTimingIssues } from '../src/services/administrationImportPolicy';
import { buildModulAjarProjection } from '../src/services/documentEngine/modulAjarProjection';
import { resolveEffectiveSubjectSlots } from '../src/services/subjectScheduleService';
import { buildLearningMeetingScheduleData, resolveLearningMeetingSchedule } from '../src/services/learningMeetingScheduleService';
import { STORAGE_KEY_V5, loadStorageV5 } from '../src/services/storageV5';
import { SD_CP_ENTRIES } from '../src/data/curriculum/cp/sd';

const source = createTwoSemesterAdministrationImportFixture();
const original = JSON.stringify(source);
const archive = await readCompleteProjectZip(await createCompleteProjectZip(source,'y'));
const options = {mode:'IDENTITY_ONLY' as const,targetProfileId:'p2',targetSchoolId:'s2',documentDate:'2026-10-28'};
const memory = new Map<string,string>(); let writes = 0;
(globalThis as any).localStorage = {getItem:(key:string)=>memory.get(key)||null,setItem:(key:string,value:string)=>{writes++;memory.set(key,value);},removeItem:(key:string)=>memory.delete(key)};
const reset = () => {memory.set(STORAGE_KEY_V5,original);writes=0;};
reset();
const documents = documentZipHarness();

// Mode 1: actual one-action orchestration, both semesters and both formats.
const flow = await importCompleteAdministrationProjectAndExport(archive,options,async(request,context)=>{
  assert.equal(writes,1,'Import commits atomically before document snapshot writes');
  return documents.generateZipBundle(request,context);
});
assert.equal(loadStorageV5().yearPlans.length,source.yearPlans.length+1); assert.equal(documents.downloads.length,1); assert.equal(flow.exportError,'');
assert(flow.zipResult!.itemResults!.filter(item=>item.type==='MODUL_AJAR' && item.status==='SUCCESS').length===2);
assert(flow.zipResult!.itemResults!.filter(item=>item.type==='ASESMEN' && item.status==='SUCCESS').length===2);
assert(flow.imported.step7.target.canProceed,flow.imported.step7.target.blockers.join('; '));
const zipped = await JSZip.loadAsync(await documents.downloads[0].blob.arrayBuffer());
for(const semester of [1,2]) for(const extension of ['pdf','docx']) assert(Object.keys(zipped.files).some(path=>path.includes(`Semester_${semester}/`) && path.includes('Modul_Ajar') && path.endsWith('.'+extension)));
reset();
const failure = await importCompleteAdministrationProjectAndExport(archive,options,async()=>{throw new Error('ZIP-failure-fixture');});
assert.equal(writes,1); assert.equal(failure.exportError,'ZIP-failure-fixture'); assert(loadStorageV5().yearPlans.some(year=>year.id===failure.imported.yearPlanId));

// Mode 2: only time dependencies await target review. CP/TP/ATP and valid instruments keep progress.
const scheduleImport = prepareCompleteAdministrationProjectImport(source,archive,{...options,mode:'IDENTITY_SCHEDULE'});
assert.equal(scheduleImport.nextStep,'annual-planning'); assert(scheduleImport.step7.target.canProceed);
const scheduleState = scheduleImport.state;
const beforeAnnual = JSON.stringify(scheduleState.annualData);
const initialContext = buildImportedProjectExportContext(scheduleState,scheduleImport.yearPlanId);
const beforeWork = buildAnnualZipWorkItems(['MODUL_AJAR','ASESMEN','CP'],initialContext);
assert(beforeWork.items.filter(item=>item.type==='MODUL_AJAR').every(item=>!validateDocumentRequirements(item.type,item.context).isValid));
assert(beforeWork.items.filter(item=>item.type==='ASESMEN' || item.type==='CP').every(item=>validateDocumentRequirements(item.type,item.context).isValid));
assert(beforeWork.items.filter(item=>item.type==='MODUL_AJAR').every(item=>item.context.learningPlans![0].status==='SIAP'));
const semesters = scheduleState.semesterPlans.filter(plan=>plan.yearPlanId===scheduleImport.yearPlanId).sort((a,b)=>a.semester-b.semester);
for(const sp of semesters) {
  const calendar = scheduleState.semesterData.academicCalendar.find(entry=>entry.semesterPlanId===sp.id)!.value;
  const weekly = scheduleState.semesterData.subjectWeeklySchedules!.find(entry=>entry.semesterPlanId===sp.id)!.value;
  const jp = scheduleState.semesterJPSettings.find(entry=>entry.semesterPlanId===sp.id)!.value;
  const scheduled = scheduleState.semesterData.learningMeetingSchedules!.find(entry=>entry.semesterPlanId===sp.id)!;
  const date = sp.semester===1 ? '2026-08-10' : '2027-01-11';
  calendar.calendar.workflowStatus='CONFIRMED';calendar.calendar.startDate=date;calendar.calendar.endDate=date;calendar.calendar.updatedAt='2026-10-28T01:00:00Z';calendar.days[0].date=date;
  jp.actualScheduledWeeklyJP=sp.semester===1 ? 3:2;jp.source='SCHOOL_SCHEDULE';
  weekly.sessions[0].jp=jp.actualScheduledWeeklyJP!;weekly.basedOnWeeklyJP=jp.actualScheduledWeeklyJP!;weekly.updatedAt=calendar.calendar.updatedAt;
  const ctx = buildImportedProjectExportContext(scheduleState,scheduleImport.yearPlanId);
  const pending = resolveAnnualZipContexts(ctx).semesters.find(item=>item.semester===sp.semester)!.context;
  assert(importedTimingIssues(pending).some(reason=>reason.includes('perbarui jadwal')));
  const slots=resolveEffectiveSubjectSlots({semesterPlanId:sp.id,schedule:weekly,expectedWeeklyJP:jp.actualScheduledWeeklyJP,calendar:calendar.calendar,calendarDays:calendar.days});
  const auto=resolveLearningMeetingSchedule({semesterPlanId:sp.id,semester:sp.semester,mapping:ctx.atpUnitMapping!,unitExecutionPlan:ctx.unitExecutionPlan!,subjectSlotResult:slots});
  assert(auto.isValid && auto.isReady,auto.errors.join('; '));
  scheduled.value=buildLearningMeetingScheduleData({semesterPlanId:sp.id,semester:sp.semester,mapping:ctx.atpUnitMapping!,unitExecutionPlan:ctx.unitExecutionPlan!,subjectWeeklySchedule:weekly,expectedWeeklyJP:jp.actualScheduledWeeklyJP!,calendar:calendar.calendar,autoResult:auto,manualOverrides:[],persistedId:scheduled.value.id});
  const current=resolveAnnualZipContexts(buildImportedProjectExportContext(scheduleState,scheduleImport.yearPlanId)).semesters.find(item=>item.semester===sp.semester)!.context;
  assert.deepEqual(importedTimingIssues(current),[]);
  assert(!resolveEffectiveContext(current).academicSetting.planningReferenceNotice);
  if(sp.semester===1) {
    const second=resolveAnnualZipContexts(buildImportedProjectExportContext(scheduleState,scheduleImport.yearPlanId)).semesters.find(item=>item.semester===2)!.context;
    assert(importedTimingIssues(second).length,'Unreviewed semester 2 must remain isolated');
  }
}
assert.equal(JSON.stringify(scheduleState.annualData),beforeAnnual,'Time adjustment must not regenerate or edit annual CP/TP/ATP/Bab');
const readyTime=buildAnnualZipWorkItems(['MODUL_AJAR'],buildImportedProjectExportContext(scheduleState,scheduleImport.yearPlanId));
assert(!validateDocumentRequirements('MODUL_AJAR',readyTime.items[0].context).isValid,'Changed JP must expose incompatible lesson duration, not silently rewrite content');
assert(validateDocumentRequirements('MODUL_AJAR',readyTime.items[1].context).isValid,'Unchanged semester lesson remains exportable');
// Teacher updates only the affected lesson duration after calendar/JP review.
scheduleState.semesterData.learningPlan.find(entry=>entry.semesterPlanId===semesters[0].id)!.value[0].learningSteps.core[0].durationMinutes=85;
for (const item of readyTime.items) { const validation=validateDocumentRequirements(item.type,item.context); assert(validation.isValid,JSON.stringify(validation)); }
assert.equal(buildModulAjarProjection(readyTime.items[0].context).resolvedAllocatedJP,3);

// Mode 3: same class/phase rombel preserves valid content, displays class section, isolates facts.
const classroom = prepareCompleteAdministrationProjectImport(source,archive,{...options,mode:'OTHER_CLASS',targetGrade:'Kelas 2',targetClassSection:'B'});
assert(classroom.step7.target.canProceed,classroom.step7.target.blockers.join('; '));
const classYear=classroom.state.yearPlans.find(year=>year.id===classroom.yearPlanId)!;
assert.equal(classYear.classSection,'B');assert.equal(classYear.grade,'Kelas 2');assert.equal(classYear.phase,'A');
const classContext=buildImportedProjectExportContext(classroom.state,classroom.yearPlanId);
const classModule=buildAnnualZipWorkItems(['MODUL_AJAR'],classContext).items[0];
const docx=await generateDocument('MODUL_AJAR',classModule.context);
const xml=await(await JSZip.loadAsync(await docx.blob!.arrayBuffer())).file('word/document.xml')!.async('string');
const pdf=await generatePdfDocument('MODUL_AJAR',classModule.context);
const raw=Buffer.from(await pdf.blob.arrayBuffer()).toString('latin1');
const streams=[...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(match=>{try{return inflateSync(Buffer.from(match[1],'latin1')).toString('latin1');}catch{return '';}}).join('');
const pdfText=[...streams.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)].map(match=>match[1].replace(/\\([()\\])/g,'$1')).join('');
assert(xml.includes('Kelas 2 (B)') && pdfText.includes('Kelas 2 (B)'));
for(const body of [xml,pdfText]) assert(!body.includes('GURU_ASAL_TEST') && body.includes('GURU_TUJUAN_TEST'));
const snapshot=createDocumentSnapshot(classContext,'docx','data','MODUL_AJAR');
assert.equal(resolveEffectiveContext({...classContext,academicSetting:{...classContext.academicSetting,classSection:'C'}},snapshot).academicSetting.classSection,'B');
const different=prepareCompleteAdministrationProjectImport(source,archive,{...options,mode:'OTHER_CLASS',targetGrade:'Kelas 5',targetClassSection:'A'});
assert.equal(different.nextStep,'cp'); assert(!different.step7.target.canProceed); assert(different.compatibility.reasons.length);
const incompatible=importedProjectExportReadiness(different.state,different.yearPlanId);
assert(incompatible.rows.filter(row=>['CP','TP','ATP','MODUL_AJAR','ASESMEN'].includes(row.type)).every(row=>!row.ready));
assert.equal(different.state.annualData.tp.find(entry=>entry.yearPlanId===different.yearPlanId)!.value.items[0].statement,source.annualData.tp[0].value.items[0].statement);
assert.throws(()=>prepareCompleteAdministrationProjectImport(classroom.state,archive,{...options,mode:'OTHER_CLASS',targetGrade:'2',targetClassSection:'b'}),/Konflik proyek/);
assert.throws(()=>prepareCompleteAdministrationProjectImport(source,archive,{...options,mode:'OTHER_CLASS',targetGrade:'999',targetClassSection:'B'}),/kelas dan rombel/);
const official=SD_CP_ENTRIES.find(entry=>entry.subjectCode==='PJOK' && entry.phase==='A')!;
const compatible=classImportCompatibility({...classYear,grade:'Kelas 1',identityOnlyImport:{...classYear.identityOnlyImport!,sourceGrade:'Kelas 2'}},
  {...source.annualData.cp[0].value,source:{...source.annualData.cp[0].value.source!,id:official.id},elements:official.elements.map((element,index)=>({...element,id:'official'+index}))},
  {...source.annualData.tp[0].value,phase:'A'},source.annualData.atp[0].value);
assert(compatible.cpCompatible && compatible.tpCompatible && compatible.atpCompatible,compatible.reasons.join('; '));

// Mode 4: editable workspace, not a blanket downgrade; pre-existing stale data stays stale.
const edit=prepareCompleteAdministrationProjectImport(source,archive,{...options,mode:'CONTINUE_EDITING'});
assert(edit.step7.target.canProceed);assert.equal(edit.nextStep,'admin');
assert(edit.state.semesterData.learningPlan.filter(entry=>edit.state.semesterPlans.some(sp=>sp.id===entry.semesterPlanId && sp.yearPlanId===edit.yearPlanId)).every(entry=>entry.value.every(plan=>plan.status==='SIAP')));
const stale=structuredClone(archive);stale.project.annualData.atpUnitMappings![0].value.basedOnTpFingerprint='source-stale';
const staleEdit=prepareCompleteAdministrationProjectImport(source,stale,{...options,mode:'CONTINUE_EDITING'});
assert(!staleEdit.step7.target.canProceed);assert.equal(staleEdit.nextStep,'atp-mapping');
for(const copied of [flow.imported,scheduleImport,classroom,different,edit]) {
  const ids=new Set(copied.state.semesterPlans.filter(sp=>sp.yearPlanId===copied.yearPlanId).map(sp=>sp.id));
  for(const key of ['roster','attendance','grade','journalRealizations'] as const) assert(!(copied.state.semesterData[key] || []).some(entry=>ids.has(entry.semesterPlanId)));
}
assert.equal(JSON.stringify(source),original);

// Actual UI handlers: four primary options, no modern-mode checkbox; resume export after edits needs no ZIP reimport.
for(const mode of ['IDENTITY_SCHEDULE','OTHER_CLASS','CONTINUE_EDITING'] as const) {
  reset();let actual:any;let destination='';
  const harness=completeImportModalHarness({state:{...source,activeProfileId:'p2'},onClose:()=>{},onSuccess:(result:any)=>{actual=result;},onContinue:(step:string)=>{destination=step;}},{
    readCompleteProjectZip,prepareCompleteAdministrationProjectImport,importCompleteAdministrationProject,importCompleteAdministrationProjectAndExport,
    importedProjectExportReadiness,loadStorageV5,generateZipBundle:documents.generateZipBundle,
  });
  await harness.nodes().find(node=>node.type==='input' && node.props.type==='file').props.onChange({target:{files:[{arrayBuffer:async()=>await createCompleteProjectZip(source,'y')}]}});
  for(const option of ADMINISTRATION_IMPORT_MODES) assert(harness.nodes().some(node=>node.type==='input' && node.props.value===option.mode));
  harness.nodes().find(node=>node.type==='input' && node.props.value===mode).props.onChange();
  if(mode==='OTHER_CLASS') harness.nodes().find(node=>node.type==='input' && node.props['aria-label']==='Rombel tujuan').props.onChange({target:{value:'B'}});
  assert(!harness.nodes().some(node=>node.type==='input' && node.props.type==='checkbox'));
  const button=harness.nodes().find(node=>node.type==='button' && harness.text(node).includes('Impor & Lanjutkan'));
  assert(button && !button.props.disabled);await button.props.onClick();
  assert.equal(writes,1);assert(actual && destination);
}
memory.set(STORAGE_KEY_V5,JSON.stringify(edit.state));writes=0;
let resumeExports=0;
const resume=completeImportModalHarness({state:edit.state,importedYearPlanId:edit.yearPlanId,onClose:()=>{},onSuccess:()=>{throw new Error('Resume must not import again');}},{
  importedProjectExportReadiness,loadStorageV5,
  generateZipBundle:async(request:any,context:any)=>{resumeExports++;assert.equal(context.zipAnnualSource.yearPlan.id,edit.yearPlanId);assert.equal(request.format,'both');return {successCount:1,partialCount:0,skippedCount:0,failedCount:0,itemResults:[]};},
});
assert(!resume.nodes().some(node=>node.type==='input' && node.props.type==='file'));
const resumeButton=resume.nodes().find(node=>node.type==='button' && resume.text(node)==='Unduh ZIP Administrasi');
assert(resumeButton && !resumeButton.props.disabled);await resumeButton.props.onClick();
assert.equal(resumeExports,1);assert.equal(writes,0);
reset();
const failedArchive=structuredClone(archive);failedArchive.project.annualData.atpUnitMappings![0].value.units[0].materials[0].linkedTpIds=['fake'];
await assert.rejects(importCompleteAdministrationProjectAndExport(failedArchive,options,documents.generateZipBundle));assert.equal(writes,0);
console.log('PASS: 4 shared import modes, one-action automatic Mode1 PDF/DOCX ZIP across two semesters; timing-only review/recalculation and semester isolation; class/phase compatibility + rombel metadata/snapshot; preserved editable progress, real stale rejection, atomic failures, no factual-data adoption and actual modal handlers. Browser download captured, no visual claim.');
