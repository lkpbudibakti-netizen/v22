import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { createReadyV21WorkflowFixture, v21DocumentContext } from './fixtures/v21ReadyWorkflowFixture';
import { saveStorageV5, loadStorageV5, STORAGE_KEY_V5, saveSubjectWeeklyScheduleV5, updateSchoolV5, getMeetingAlignmentSourceV5, serializeBackupV5, parseBackupV5 } from '../src/services/storageV5';
import { formatOfficialDate } from '../src/services/documentEngine/docxStyles';
import { createDocumentSnapshot, resolveEffectiveContext } from '../src/services/documentEngine/snapshot';
import { generateDocument, generatePdfDocument, validateDocumentRequirements } from '../src/services/documentEngine';
import { buildPromesProjection } from '../src/services/documentEngine/promesProjection';
import { createCompleteProjectZip, readCompleteProjectZip } from '../src/services/completeProjectZipService';
import { prepareCompleteAdministrationProjectImport } from '../src/services/administrationProjectImportService';
import { evaluateExpression, initializer } from './helpers/uiContractHarness';
import { buildImportedProjectExportContext } from '../src/services/identityOnlyProjectExport';
import { buildNationalBaseCandidate } from '../src/services/calendarProvider';
import { resolvePlanningBaseline } from '../src/data/calendar/planningBaselines';
import { projectNationalBaseToSemesterDraft } from '../src/services/calendarResolver';
import { generateZipBundle } from '../src/services/documentEngine/zipBundle';

const memory=new Map<string,string>();let writes=0;
(globalThis as any).localStorage={getItem:(key:string)=>memory.get(key)??null,setItem:(key:string,value:string)=>{writes++;memory.set(key,value);},removeItem:(key:string)=>memory.delete(key)};
function fixture() {
  const state=createReadyV21WorkflowFixture([3],undefined,19);
  for(const key of Object.keys(state.semesterData)) if(!['academicCalendar','timeAllocation','subjectWeeklySchedules','learningMeetingSchedules'].includes(key)) (state.semesterData as any)[key]=[];
  state.documents=[];
  for(const unit of state.annualData.unitExecutionPlans![0].value.units) {unit.meetings.splice(1,1);unit.meetings.forEach((meeting,index)=>meeting.order=index+1);}
  for(const schedule of state.semesterData.learningMeetingSchedules!) schedule.value.entries.splice(1,1);
  Object.assign(state.schools[0],{name:'SEKOLAH_TUJUAN',regency:'Kota Tangerang',district:'Kec. Ciledug'});
  state.schools[1].regency='Kota Surabaya';
  saveStorageV5(state);return state;
}
const initial=fixture(), curriculum=JSON.stringify([initial.annualData,initial.semesterData]);
updateSchoolV5('s1',{regency:'Kota Bandung',district:'Kec. Sukajadi'});
let state=loadStorageV5();assert.equal(JSON.stringify([state.annualData,state.semesterData]),curriculum);
assert(formatOfficialDate(state.schools[0],'2026-11-16').startsWith('Kota Bandung,'));
assert(formatOfficialDate({...state.schools[0],regency:''},'2026-11-16').startsWith('Sukajadi,'));
const oldContext={...v21DocumentContext(initial),documentDate:'2026-11-16'};
const oldSnapshot=createDocumentSnapshot(oldContext,'docx');
const live={...v21DocumentContext(state),workMode:'production' as const,documentDate:'2026-11-16',snapshot:oldSnapshot};
assert.equal(resolveEffectiveContext(live).school.regency,'Kota Bandung');
assert.equal(resolveEffectiveContext({...live,workMode:'authoring'}).school.regency,'Kota Tangerang','Normal snapshots remain historical');
assert.equal(resolveEffectiveContext({...live,documentDate:'2026-11-17'}).documentDate,'2026-11-17');
assert.equal(JSON.stringify([loadStorageV5().annualData,loadStorageV5().semesterData]),curriculum);
console.log('PASS identity/date: school update changes presentation only; Production uses live identity, Normal preserves snapshot');

const schoolBefore=JSON.stringify(state.schools),oldWeekly=state.semesterData.subjectWeeklySchedules![0].value;
const beforeNoop=memory.get(STORAGE_KEY_V5),beforeWrites=writes;
const noop=saveSubjectWeeklyScheduleV5('sp1',{...oldWeekly,updatedAt:'2099-01-01T00:00:00Z'},{productionMode:true});
assert.deepEqual(noop,oldWeekly);assert.equal(writes,beforeWrites);assert.equal(memory.get(STORAGE_KEY_V5),beforeNoop);
const patterns=state.semesterData.subjectWeeklySchedules!.map(e=>({id:e.semesterPlanId,value:{...e.value,sessions:e.value.sessions.map(s=>({...s,dayOfWeek:2 as const})),updatedAt:'2026-11-16T10:00:00Z'}}));
for(const pattern of patterns) {
  const previous=loadStorageV5(),beforeSave=writes;
  saveSubjectWeeklyScheduleV5(pattern.id,pattern.value,{productionMode:true});
  const after=loadStorageV5(),old=previous.semesterData.learningMeetingSchedules!.find(e=>e.semesterPlanId===pattern.id)!.value,next=after.semesterData.learningMeetingSchedules!.find(e=>e.semesterPlanId===pattern.id)!.value;
  assert.equal(writes,beforeSave+1,'Pattern and dated schedule commit in one write');
  assert.deepEqual(next.entries.map(e=>[e.meetingId,e.unitId,e.jp]),old.entries.map(e=>[e.meetingId,e.unitId,e.jp]));
  for(let i=0;i<old.entries.length;i++) assert.equal(Date.parse(next.entries[i].date)-Date.parse(old.entries[i].date),86400000);
  assert.equal(Date.parse(next.entries[1].date)-Date.parse(next.entries[0].date),14*86400000,'Unused middle week stays unused');
  assert.equal(next.basedOnSubjectWeeklyScheduleUpdatedAt,after.semesterData.subjectWeeklySchedules!.find(e=>e.semesterPlanId===pattern.id)!.value.updatedAt);
  assert.equal(JSON.stringify(after.annualData),JSON.stringify(previous.annualData));
  assert.deepEqual(after.semesterData.academicCalendar,previous.semesterData.academicCalendar);
}
state=loadStorageV5();assert.equal(JSON.stringify(state.schools),schoolBefore);
assert.equal(state.semesterData.learningMeetingSchedules!.reduce((sum,s)=>sum+s.value.entries.reduce((n,e)=>n+e.jp,0),0),108);
assert.equal(getMeetingAlignmentSourceV5('y').context.errors.length,0);
assert.equal(buildPromesProjection({...v21DocumentContext(state),workMode:'production'}).isReady,true);
const advisory={...v21DocumentContext(state),workMode:'production' as const};
advisory.calendar={...advisory.calendar!,workflowStatus:'UNRESOLVED'};
assert.equal(validateDocumentRequirements('PROMES',advisory).isValid,true,'A workflow warning does not invalidate actual effective dates');
const invalidDays={...advisory,calendarDays:advisory.calendarDays!.map(day=>day.date===state.semesterData.learningMeetingSchedules![0].value.entries[0].date?{...day,status:'HOLIDAY' as const}:day)};
assert.equal(validateDocumentRequirements('PROMES',invalidDays).isValid,false,'An ineffective actual date remains a blocker despite advisory workflow status');
console.log('PASS no-op + Monday→Tuesday: both semesters, one atomic write each, unchanged IDs/content/JP and unused slots');

const savedState=loadStorageV5();
function rejected(next:any,reason:RegExp) {const before=memory.get(STORAGE_KEY_V5),count=writes;assert.throws(()=>saveSubjectWeeklyScheduleV5('sp1',next,{productionMode:true}),reason);assert.equal(memory.get(STORAGE_KEY_V5),before);assert.equal(writes,count);}
const weekly=state.semesterData.subjectWeeklySchedules![0].value;
rejected({...weekly,sessions:[...weekly.sessions,{...weekly.sessions[0]}]},/Duplicate/);
const insufficient=structuredClone(state);insufficient.semesterData.academicCalendar[0].value.days.forEach(day=>{if(new Date(day.date).getUTCDay()===3)day.status='HOLIDAY';});saveStorageV5(insufficient);
rejected({...weekly,sessions:weekly.sessions.map(s=>({...s,dayOfWeek:3}))},/kapasitas|Slot|slot/i);
saveStorageV5(savedState);
const protectedState=loadStorageV5(),first=protectedState.semesterData.learningMeetingSchedules![0].value.entries[0];
protectedState.semesterData.journalRealizations=[{semesterPlanId:'sp1',value:[{semesterPlanId:'sp1',meetingId:first.meetingId,outcome:'REALISASI_TETAP',updatedAt:'2026-11-16'}]}];saveStorageV5(protectedState);
rejected({...weekly,sessions:weekly.sessions.map(s=>({...s,dayOfWeek:3}))},/terlindungi.*persetujuan/);
saveStorageV5(savedState);
console.log('PASS conflicts, insufficient capacity and protected realization reject without partial persistence');

const beforeNormal=loadStorageV5();saveSubjectWeeklyScheduleV5('sp1',{...weekly,sessions:weekly.sessions.map(s=>({...s,dayOfWeek:3 as const})),updatedAt:'2099-01-01T00:00:00Z'});
assert.deepEqual(loadStorageV5().semesterData.learningMeetingSchedules,beforeNormal.semesterData.learningMeetingSchedules,'Normal keeps its existing explicit schedule-save workflow');
const staleContext={...v21DocumentContext(loadStorageV5()),workMode:'production' as const};
for(const type of ['PROMES','ALOKASI_WAKTU','MODUL_AJAR'] as const) assert.equal(validateDocumentRequirements(type,staleContext).isValid,false,'Production must not export dated stale schedules');
saveStorageV5(savedState);saveStorageV5(parseBackupV5(serializeBackupV5(loadStorageV5())));
console.log('PASS Normal unchanged; Production export rejects stale dates; backup reload preserves updated schedules');

const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
const zipSource=buildImportedProjectExportContext(loadStorageV5(),'y').zipAnnualSource;
for(const semester of [1,2] as const) {
  const context={...v21DocumentContext(loadStorageV5(),semester),zipAnnualSource:zipSource,workMode:'production' as const,documentDate:'2026-11-16',snapshot:oldSnapshot};
  for(const type of ['PROTA','PROMES','ALOKASI_WAKTU'] as const) {
    const result=await generateDocument(type,context);assert(result.blob,'DOCX must be generated');
    const zip=await JSZip.loadAsync(new Uint8Array(await result.blob.arrayBuffer())),xml=await zip.file('word/document.xml')!.async('string');
    assert(xml.includes('Kota Bandung'));assert(!xml.includes('Kota Tangerang'));assert(!xml.includes('Ciledug'));
    assert(xml.includes('16 November 2026'));
    if(type==='ALOKASI_WAKTU') assert(xml.includes(semester===1?'4 Agustus 2026':'5 Januari 2027'),'DOCX contains the updated Tuesday date');
    const pdf=await generatePdfDocument(type,context),loader=getDocument({data:new Uint8Array(await pdf.blob.arrayBuffer()),useSystemFonts:true}),doc=await loader.promise;
    let text='';for(let i=1;i<=doc.numPages;i++) text+=(await(await doc.getPage(i)).getTextContent()).items.map((item:any)=>item.str||'').join(' ');
    assert(text.includes('Kota Bandung'));assert(!text.includes('Kota Tangerang'));assert(text.includes('16 November 2026'));
    if(type==='ALOKASI_WAKTU') assert(text.includes(semester===1?'4 Agustus 2026':'5 Januari 2027'),'PDF contains the same updated Tuesday date');
    await loader.destroy();
  }
}
const beforeZip=memory.get(STORAGE_KEY_V5),archive=await readCompleteProjectZip(await createCompleteProjectZip(loadStorageV5(),'y'));
const packageResult=await generateZipBundle({types:['PROTA','PROMES','ALOKASI_WAKTU'],format:'both'},
  {...buildImportedProjectExportContext(loadStorageV5(),'y'),workMode:'production',skipDownload:true,documentDate:'2026-11-16'});
assert(packageResult.zipBlob);assert(!packageResult.itemResults?.some(item=>item.status==='FAILED'));
const packageZip=await JSZip.loadAsync(new Uint8Array(await packageResult.zipBlob.arrayBuffer()));
assert.equal(Object.keys(packageZip.files).filter(name=>/\.(docx|pdf)$/.test(name)).length,10,'Annual PROTA plus two semesters PROMES/Alokasi, both formats');
const imported=prepareCompleteAdministrationProjectImport(loadStorageV5(),archive,{mode:'CONTINUE_EDITING',targetProfileId:'p2',targetSchoolId:'s2',documentDate:'2026-11-16',workMode:'production'});
assert.equal(imported.state.semesterData.learningMeetingSchedules!.filter(e=>imported.state.semesterPlans.some(sp=>sp.yearPlanId===imported.yearPlanId&&sp.id===e.semesterPlanId)).reduce((sum,e)=>sum+e.value.entries.length,0),36);
assert.equal(resolveEffectiveContext({...buildImportedProjectExportContext(imported.state,imported.yearPlanId),workMode:'production',snapshot:oldSnapshot}).school.regency,'Kota Surabaya');
assert.equal(memory.get(STORAGE_KEY_V5),beforeZip,'ZIP/import preview cannot mutate source');
console.log('PASS DOCX/PDF live city + document date, both semesters; ZIP roundtrip keeps 36 meetings and source immutable');

const messages:string[]=[];
const national=evaluateExpression(initializer('src/components/administration/TimePlanningManager.tsx','handleAutoResolve'),{
  productionMode:true,calendar:state.semesterData.academicCalendar[0].value.calendar,setResolutionMessage:(message:string)=>messages.push(message),
  resolveCalendarOnline:()=>assert.fail('City change cannot search/regenerate calendar'),
});await national();assert(messages[0].includes('dipertahankan'));
const draft:Record<string,unknown>={};
const setters=Object.fromEntries(['StartDate','EndDate','SchoolDaysPerWeek','OnlineDiscovery','SourceType','SourceName','SourceAuthority','SourceDocumentNumber','SourceUrl','DraftVerifiedAt','Days','WorkflowStatus','ResolutionStatus','ResolutionMessage'].map(name=>['set'+name,(value:unknown)=>draft[name]=value]));
const nationalDraft=evaluateExpression(initializer('src/components/administration/TimePlanningManager.tsx','handleAutoResolve'),{
  productionMode:true,calendar:undefined,academicYear:'2026/2027',semester:'1',academicSetting:{id:'y'},
  startDate:'',endDate:'',schoolDaysPerWeek:5,days:[],...setters,resolvePlanningBaseline,buildNationalBaseCandidate,projectNationalBaseToSemesterDraft,
  resolveCalendarOnline:()=>assert.fail('National baseline cannot call AI/region search'),
});await nationalDraft();assert.equal(draft.SourceType,'NATIONAL_HOLIDAY_OVERLAY');assert.equal(draft.ResolutionStatus,'PARTIALLY_RESOLVED');assert(String(draft.ResolutionMessage).includes('bukan kalender daerah terverifikasi'));
console.log('PASS saved Production calendar preserved without AI/region resolution. No Gemini live or Word visual-render claim.');
