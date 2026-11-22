import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import JSZip from 'jszip';
import { createTwoSemesterAdministrationImportFixture } from './fixtures/readyAdministrationImportFixture';
import { annualPlanningManagerHarness } from './fixtures/annualPlanningManagerHarness';
import { assessProductionJPSufficiency } from '../src/services/annualJPAssessment';
import { resolveEffectiveSubjectSlots } from '../src/services/subjectScheduleService';
import { resolveLearningMeetingSchedule, buildLearningMeetingScheduleData, validateLearningMeetingScheduleData } from '../src/services/learningMeetingScheduleService';
import { getMeetingAlignmentSourceV5, saveLearningMeetingScheduleV5, loadStorageV5, STORAGE_KEY_V5 } from '../src/services/storageV5';
import { validateCalendarMeetingCandidate } from '../src/services/unitMeetingAllocationService';
import { proposeMeetingAlignment } from '../src/services/meetingAlignmentService';
import { buildImportedProjectExportContext } from '../src/services/identityOnlyProjectExport';
import { resolveAnnualZipContexts } from '../src/services/documentEngine/annualZipPlan';
import { buildProtaProjection } from '../src/services/documentEngine/protaProjection';
import { buildPromesProjection } from '../src/services/documentEngine/promesProjection';
import { generateDocument, generatePdfDocument } from '../src/services/documentEngine';
import { appCallback, evaluateExpression, initializer } from './helpers/uiContractHarness';
import { validateWorkflowDependencies } from '../src/services/workflowEngine';
import { createCompleteProjectZip, readCompleteProjectZip } from '../src/services/completeProjectZipService';
import { prepareCompleteAdministrationProjectImport } from '../src/services/administrationProjectImportService';

const reference = { isOfficial: true, referenceAnnualJP: 108 };
const assessed = (allocated: number, capacity: number, official = true) => assessProductionJPSufficiency({ ...reference, isOfficial: official }, [
  { semester: 1, allocatedJP: allocated / 2, capacityJP: capacity / 2 }, { semester: 2, allocatedJP: allocated / 2, capacityJP: capacity / 2 },
], true, true);
for (const [allocated, capacity, expected] of [[108,129,'SELESAI'],[99,129,'REVIEW'],[135,129,'ERROR'],[108,108,'SELESAI']] as const) assert.equal(assessed(allocated,capacity).status,expected);
assert.equal(assessed(108,129,false).status,'REVIEW');
assert.equal(assessProductionJPSufficiency(reference,[{semester:1,capacityJP:50,allocatedJP:54},{semester:2,capacityJP:79,allocatedJP:54}],true,true).status,'ERROR');
assert.equal(assessProductionJPSufficiency(reference,[{semester:1,capacityJP:63,allocatedJP:54},{semester:2,capacityJP:66,allocatedJP:54}],false,true).status,'ERROR');
assert.equal(assessProductionJPSufficiency(reference,[{semester:1,capacityJP:63,allocatedJP:54},{semester:2,capacityJP:66,allocatedJP:null}],true,false).status,'REVIEW');
console.log('PASS 1-6: verified reference, sufficiency, semester ceilings, missing allocation and unverified reference');

const stamp='2026-01-01T00:00:00Z', memory=new Map<string,string>();
(globalThis as any).localStorage={getItem:(key:string)=>memory.get(key)??null,setItem:(key:string,value:string)=>memory.set(key,value),removeItem:(key:string)=>memory.delete(key)};
const iso=(date:Date)=>date.toISOString().slice(0,10);
const plus=(date:string,days:number)=>iso(new Date(Date.parse(date)+days*86400000));
function fixture(counts=[18,18], capacities=[21,22], gap:boolean|'start'=true) {
  const state=createTwoSemesterAdministrationImportFixture();
  state.semesterData.learningPlan=[];state.semesterData.assessmentPlan=[];state.semesterData.assessmentPackage=[];
  state.semesterData.attendance=[];state.semesterData.grade=[];state.semesterData.journalRealizations=[];
  state.annualJPReferences=[{yearPlanId:'y',value:{officialAnnualJP:999,referenceWeeklyEquivalentJP:3,weeklyJPSource:'LEGACY_VALUE',regulationReference:'Master impor belum terverifikasi'}}];
  const mapping=state.annualData.atpUnitMappings![0].value, plan=state.annualData.unitExecutionPlans![0].value;
  for (const sp of state.semesterPlans) {
    const index=sp.semester-1, first=index?'2027-01-04':'2026-07-06';
    const cal=state.semesterData.academicCalendar.find(e=>e.semesterPlanId===sp.id)!.value;
    Object.assign(cal.calendar,{startDate:first,endDate:plus(first,(capacities[index]-1)*7+4),schoolDaysPerWeek:5,workflowStatus:'CONFIRMED',updatedAt:stamp});
    cal.days=[];
    for(let day=first;day<=cal.calendar.endDate;day=plus(day,1)) if(![0,6].includes(new Date(day).getUTCDay())) cal.days.push({id:`${sp.id}-${day}`,academicCalendarId:cal.calendar.id,date:day,status:'effective',sourceLayer:'GENERATED_EFFECTIVE_BASELINE'});
    state.semesterJPSettings.find(e=>e.semesterPlanId===sp.id)!.value={semesterPlanId:sp.id,actualScheduledWeeklyJP:3,source:'SEMESTER_OVERRIDE'};
    const weekly=state.semesterData.subjectWeeklySchedules!.find(e=>e.semesterPlanId===sp.id)!.value;
    Object.assign(weekly,{sessions:[{id:`session-${sp.id}`,order:1,dayOfWeek:1,jp:3}],basedOnWeeklyJP:3,basedOnSchoolDaysPerWeek:5,updatedAt:stamp});
    const original=plan.units[index].meetings[0];
    plan.units[index].meetings=Array.from({length:counts[index]},(_,i)=>({...structuredClone(original),id:i?`meeting-${sp.id}-${i}`:original.id,order:i+1,plannedJP:3}));
  }
  const validators:any[]=[];
  for (const sp of state.semesterPlans) {
    const data=state.semesterData.academicCalendar.find(e=>e.semesterPlanId===sp.id)!.value;
    const weekly=state.semesterData.subjectWeeklySchedules!.find(e=>e.semesterPlanId===sp.id)!.value;
    const slots=resolveEffectiveSubjectSlots({semesterPlanId:sp.id,calendar:data.calendar,calendarDays:data.days,schedule:weekly,expectedWeeklyJP:3});
    assert(slots.isReady,slots.errors.join('; ')); assert.equal(slots.slots.length,capacities[sp.semester-1]);
    const meetings=plan.units[sp.semester-1].meetings;
    const assignments=meetings.map((meeting,i)=>({meetingId:meeting.id,sourceSlotId:slots.slots[i+(gap==='start'||(gap&&i>0)?1:0)].id}));
    const resolved=resolveLearningMeetingSchedule({semesterPlanId:sp.id,semester:sp.semester,mapping,unitExecutionPlan:plan,subjectSlotResult:slots,slotAssignments:assignments});
    assert(resolved.isValid,resolved.errors.join('; '));
    const saved=buildLearningMeetingScheduleData({semesterPlanId:sp.id,semester:sp.semester,mapping,unitExecutionPlan:plan,calendar:data.calendar,subjectWeeklySchedule:weekly,expectedWeeklyJP:3,autoResult:resolved,manualOverrides:[]});
    state.semesterData.learningMeetingSchedules!.find(e=>e.semesterPlanId===sp.id)!.value=saved;
    validators.push({data:saved,semester:sp.semester,mapping,unitExecutionPlan:plan,calendar:data.calendar,calendarDays:data.days,subjectWeeklySchedule:weekly,expectedWeeklyJP:3});
  }
  return {state,mapping,plan,validators};
}
function view(state:ReturnType<typeof fixture>['state'],productionMode=true) {
  memory.set(STORAGE_KEY_V5,JSON.stringify(state));const year=state.yearPlans[0];
  return annualPlanningManagerHarness({productionMode,school:state.schools[0],profile:state.profiles[0],academicSetting:{...year,curriculum:'Kurikulum Merdeka',semester:''},yearPlan:year,
    semesterPlans:state.semesterPlans,mapping:state.annualData.atpUnitMappings![0].value,unitExecutionPlan:state.annualData.unitExecutionPlans![0].value,tp:state.annualData.tp[0].value,atp:state.annualData.atp[0].value,
    onSaveCalendar:()=>assert.fail('Render must not save'),onSaveTimeAllocations:()=>assert.fail('Render must not allocate'),onSaveUnitExecutionPlan:()=>assert.fail('Render must not generate'),onNextStep:()=>{},onBackToMapping:()=>{}},true);
}
const current=fixture(), before=JSON.stringify(current.state), h=view(current.state);
function workflow(state: typeof current.state, productionMode=true) {
  const saved=structuredClone(state);saved.activeYearPlanId='y';saved.activeProfileId=saved.profiles[0].id;saved.activeWorkspaceId=saved.workspaces[0].id;
  memory.set(STORAGE_KEY_V5,JSON.stringify(saved));
  return validateWorkflowDependencies({profile:saved.profiles[0],school:saved.schools[0],
    academicSetting:{...saved.yearPlans[0],phase:saved.yearPlans[0].phase || 'A',curriculum:'Kurikulum Merdeka',semester:''},
    workspace:{...saved.workspaces[0],academicSettingId:'y'},cp:saved.annualData.cp[0].value,cpAnalysis:saved.annualData.cpAnalysis[0].value,
    tp:saved.annualData.tp[0].value,atp:saved.annualData.atp[0].value,
    atpUnitMapping:saved.annualData.atpUnitMappings![0].value,unitExecutionPlan:saved.annualData.unitExecutionPlans![0].value},
    {productionMode}).stepStates['annual-planning'];
}
assert.equal(workflow(current.state).isComplete,true,'Top workflow must agree with Step08 sufficiency');
assert.equal(workflow(current.state,false).isComplete,true,'Normal uses the same JP sufficiency and saved slots');
const tasks=h.nodes().find(n=>n.type==='task-rail')!.props.tasks;
assert.equal(tasks.find((t:any)=>t.id==='meetings').status,'COMPLETE');
assert.equal(tasks.find((t:any)=>t.id==='time-allocation').status,'COMPLETE');
const html=renderToStaticMarkup(h.nodes()[0]);
assert(html.includes('SELESAI')&&html.includes('Sisa kapasitas kalender tidak wajib dialokasikan.'));
assert(html.includes('JP Acuan Resmi: 108') && html.includes('JP Teralokasi: 108') && html.includes('JP Tersedia: 129'));
const normal=view(current.state,false).nodes().find(n=>n.type==='task-rail')!.props.tasks;
assert.equal(normal.find((t:any)=>t.id==='meetings').status,'COMPLETE');
const draftSources=structuredClone(current.state);
for(const key of ['tp','atp'] as const) {draftSources.annualData[key][0].value.workflowStatus='DRAFT';draftSources.annualData[key][0].value.needsReview=true;}
assert.equal(view(draftSources).nodes().find(n=>n.type==='task-rail')!.props.tasks.find((t:any)=>t.id==='meetings').status,'COMPLETE','Workflow metadata cannot erase genuine JP sufficiency in Production');
assert.equal(workflow(draftSources).isComplete,true,'Production workflow must accept structurally valid draft sources');
assert.equal(workflow(draftSources,false).isComplete,false,'Normal still blocks relevant source review');
assert(!view(draftSources,false).nodes().some(n=>n.type==='task-rail'),'Normal must not open a mapping that needs review');
const upstreamReview=structuredClone(current.state);upstreamReview.annualData.cpAnalysis[0].value.needsReview=true;
assert.equal(workflow(upstreamReview,false).isComplete,false,'Normal retains the upstream analysis warning gate');
assert.equal(workflow(upstreamReview,true).isComplete,true,'Production may navigate with an upstream warning when stored planning is valid');
for(const checked of current.validators) {
  assert(validateLearningMeetingScheduleData({...checked,allowUnusedSlots:true}).isValid);
  assert(validateLearningMeetingScheduleData(checked).isValid,'Default schedule contract preserves explicit saved slots in both modes');
}
const low=fixture([16,17]), lowTasks=view(low.state).nodes().find(n=>n.type==='task-rail')!.props.tasks;
assert.equal(workflow(low.state).isComplete,false,'Top workflow cannot mark insufficient JP complete');
assert.equal(lowTasks.find((t:any)=>t.id==='meetings').status,'NEEDS_REVIEW');
const full=fixture([18,18],[18,18],false);
assert.equal(view(full.state).nodes().find(n=>n.type==='task-rail')!.props.tasks.find((t:any)=>t.id==='meetings').status,'COMPLETE');
console.log('PASS actual Step08: 108/129 complete, 99/129 review, 108/108 complete; imported 999 never substitutes official 108; both modes share sufficiency');
const unverified=structuredClone(current.state);unverified.yearPlans[0].subject='Mapel tidak terverifikasi';
assert.equal(view(unverified).nodes().find(n=>n.type==='task-rail')!.props.tasks.find((t:any)=>t.id==='meetings').status,'NEEDS_REVIEW');
const missingAllocation=structuredClone(current.state);missingAllocation.semesterData.learningMeetingSchedules!.pop();
assert.equal(view(missingAllocation).nodes().find(n=>n.type==='task-rail')!.props.tasks.find((t:any)=>t.id==='time-allocation').status,'NEEDS_REVIEW');
const overAllocated=structuredClone(current.state);
for(const entry of overAllocated.semesterData.learningMeetingSchedules![0].value.entries.slice(0,9)) entry.jp+=3;
const semesterOverflow=structuredClone(current.state);semesterOverflow.semesterData.learningMeetingSchedules![0].value.entries[0].jp+=12;
for(const mode of [false,true]) {
  for(const [data,status] of [[current.state,'COMPLETE'],[low.state,'NEEDS_REVIEW'],[full.state,'COMPLETE'],[overAllocated,'ERROR'],[semesterOverflow,'ERROR'],[unverified,'NEEDS_REVIEW'],[missingAllocation,'NEEDS_REVIEW']] as const) {
    const rail=view(data,mode).nodes().find(n=>n.type==='task-rail');assert(rail,`Expected actual Step08 in mode ${mode}`);
    for(const id of ['meetings','time-allocation']) assert.equal(rail.props.tasks.find((t:any)=>t.id===id).status,status,`mode=${mode}, task=${id}`);
    assert.equal(workflow(data,mode).isComplete,status==='COMPLETE');
  }
}
const startGap=fixture([18,18],[21,22],'start');
for(const mode of [false,true]) assert.equal(workflow(startGap.state,mode).isComplete,true);
memory.set(STORAGE_KEY_V5,JSON.stringify(startGap.state));
const startDate=startGap.validators[0].data.entries[0].date;
saveLearningMeetingScheduleV5('sp1',startGap.validators[0].data);
assert.equal(loadStorageV5().semesterData.learningMeetingSchedules![0].value.entries[0].date,startDate);
assert.equal(startDate,plus(startGap.validators[0].calendar.startDate,7),'Leading empty slot must not move a saved meeting');
console.log('PASS both modes: full status matrix, unknown reference, semester overflow, missing schedule, leading/middle/trailing gaps and Normal warning gate');
const uncovered=structuredClone(current.state);uncovered.annualData.atpUnitMappings![0].value.units[0].materials.push({...uncovered.annualData.atpUnitMappings![0].value.units[0].materials[0],id:'uncovered-material',title:'Materi fixture belum tercakup'});
assert.notEqual(view(uncovered).nodes().find(n=>n.type==='task-rail')!.props.tasks.find((t:any)=>t.id==='meetings').status,'COMPLETE');
const unmapped=structuredClone(current.state);
unmapped.annualData.tp[0].value.items.push({...unmapped.annualData.tp[0].value.items[0],id:'unmapped-canonical-tp'});
assert.notEqual(view(unmapped).nodes().find(n=>n.type==='task-rail')!.props.tasks.find((t:any)=>t.id==='meetings').status,'COMPLETE');
assert.equal(workflow(unmapped).isComplete,false,'Uncovered canonical TP cannot be hidden by sufficient JP');
for(const productionMode of [true,false]) {
  const calls:any[]=[];
  const callback=appCallback('handleSaveLearningMeetingSchedule',{useCallback:(fn:any)=>fn,activeSemesterPlan:{id:'sp1'},productionMode,
    saveLearningMeetingScheduleV5:(...args:any[])=>calls.push(args),refreshV5:()=>{},setAppNotice:()=>assert.fail('Unexpected save failure')});
  assert(callback(current.validators[0].data,'sp1'));
  assert.equal(calls[0].length,2);
}

memory.set(STORAGE_KEY_V5,JSON.stringify(current.state));
let source=getMeetingAlignmentSourceV5('y');
assert.deepEqual(validateCalendarMeetingCandidate(current.plan,current.plan,current.mapping,source.capacity,source.context,{allowUnusedSlots:true}),[]);
assert(validateCalendarMeetingCandidate(current.plan,current.plan,current.mapping,source.capacity,source.context).length);
source.context.allowUnusedSlots=true;
const proposal=proposeMeetingAlignment(current.plan,current.mapping,source.capacity,source.context);
assert.equal(proposal.errors.length,0,proposal.errors.join('; '));assert.equal(proposal.operations.length,0,'Spare slots must not add/merge/delete meetings');
const events:string[]=[],notices:string[]=[];
const generate=evaluateExpression(initializer('src/components/UnitExecutionPlanManager.tsx','generateCalendarMeetings'),{
  isGeneratingMeetings:false,validation:{isStale:false},draft:current.plan,mapping:current.mapping,
  setIsGeneratingMeetings:()=>{},setGenerationError:(value:unknown)=>{assert.equal(value,null);},
  setGenerationNotice:(value:string|null)=>{if(value)notices.push(value);},setGenerationPreview:()=>{},
  setLastAIDiagnostic:()=>{},setLastAIGenerationError:()=>{},recordDiagnosticEvent:(event:any)=>events.push(event.action),
  getMeetingAlignmentSourceV5:()=>source,validateCalendarMeetingCandidate,
  prepareCalendarMeetingGeneration:()=>assert.fail('A valid subset must not prepare a full-calendar regeneration'),
  generateUnitMeetingsWithAI:()=>assert.fail('A valid subset must not call AI'),AIMeetingGenerationError:Error,
});
await generate('COMPLETE');assert(events.includes('AI_GENERATION_NO_WORK'));assert.equal(notices.length,1);
const checked=current.validators[0], protectedMeeting=current.plan.units[0].meetings.at(-1)!;
current.state.semesterData.journalRealizations=[{semesterPlanId:'sp1',value:[{meetingId:protectedMeeting.id,semesterPlanId:'sp1',reflection:'Konten terlindungi',updatedAt:stamp}]}];
memory.set(STORAGE_KEY_V5,JSON.stringify(current.state));source=getMeetingAlignmentSourceV5('y');
assert.equal(validateCalendarMeetingCandidate(current.plan,current.plan,current.mapping,source.capacity,source.context,{allowUnusedSlots:true}).length,0);
const sameDate=checked.data.entries[1].date;
assert.equal(sameDate,plus(checked.calendar.startDate,14),'Gap at week 2 must not shift meeting 2 back');
saveLearningMeetingScheduleV5('sp1',checked.data);
assert.equal(loadStorageV5().semesterData.learningMeetingSchedules![0].value.entries[1].date,sameDate);
const shifted=structuredClone(checked.data), last=shifted.entries.at(-1)!;
const nextSlot=source.context.slotDetails!.semester1[19];
Object.assign(last,{sourceSlotId:nextSlot.id,date:nextSlot.date,sessionId:nextSlot.sessionId,dayOfWeek:1,weekIndex:last.weekIndex+1});
assert.throws(()=>saveLearningMeetingScheduleV5('sp1',shifted),/terlindungi/);
const duplicate=structuredClone(checked.data);duplicate.entries[1]={...duplicate.entries[0],meetingId:duplicate.entries[1].meetingId};
assert(!validateLearningMeetingScheduleData({...checked,data:duplicate,allowUnusedSlots:true}).isValid);
const broken=structuredClone(current.state);broken.annualData.unitExecutionPlans![0].value.units[0].meetings[0].materialIds=['missing-material'];
assert.equal(view(broken).nodes().find(n=>n.type==='task-rail')!.props.tasks.find((t:any)=>t.id==='meetings').status,'ERROR');
console.log('PASS gaps, duplicate/invalid slots, protected date/session/JP/content, and missing material fails closed');

memory.set(STORAGE_KEY_V5,JSON.stringify(current.state));
for(const workMode of ['authoring','production'] as const) {
const context={...buildImportedProjectExportContext(current.state,'y'),workMode,skipDownload:true};
const contexts=resolveAnnualZipContexts(context);
const prota=buildProtaProjection(contexts.annual);assert(prota.isReady,prota.unreadyReason);assert.equal(prota.totalAllocatedJP,108);
for(const sem of contexts.semesters) {
  const promes=buildPromesProjection(sem.context);assert(promes.isReady,promes.unreadyReason);
  assert.equal(promes.rows.reduce((sum,row)=>sum+row.allocatedJP,0),54);
}
const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
for(const type of ['PROTA','PROMES','ALOKASI_WAKTU'] as const) {
  const ctx=type==='PROTA'?contexts.annual:contexts.semesters[0].context;
  const docx=await generateDocument(type,ctx), zip=await JSZip.loadAsync(new Uint8Array(await docx.blob!.arrayBuffer()));
  const xml=await zip.file('word/document.xml')!.async('string');assert(xml.includes(type==='PROTA'?'108':'54'));
  assert(!xml.includes('Alokasi belum terpenuhi'),'Spare calendar capacity is not a JP shortage');
  const pdf=await generatePdfDocument(type,ctx), loader=getDocument({data:new Uint8Array(await pdf.blob.arrayBuffer()),useSystemFonts:true}), parsed=await loader.promise;
  let text='';for(let i=1;i<=parsed.numPages;i++) text+=(await (await parsed.getPage(i)).getTextContent()).items.map((t:any)=>t.str||'').join(' ');
  assert(text.includes(type==='PROTA'?'108':'54'));assert(!text.includes('Alokasi belum terpenuhi'));await loader.destroy();
}
}
const archive=await readCompleteProjectZip(await createCompleteProjectZip(current.state,'y'));
for(const workMode of ['authoring','production'] as const) {
  const restored=prepareCompleteAdministrationProjectImport(current.state,archive,{mode:'CONTINUE_EDITING',targetProfileId:'p2',targetSchoolId:'s2',documentDate:'2026-11-16',workMode});
  const restoredSemesters=new Set(restored.state.semesterPlans.filter(sp=>sp.yearPlanId===restored.yearPlanId).map(sp=>sp.id));
  const schedules=restored.state.semesterData.learningMeetingSchedules!.filter(e=>restoredSemesters.has(e.semesterPlanId));
  assert.equal(schedules.length,2);
  for(const schedule of schedules) {
    assert.equal(schedule.value.status,'COMPLETE','Legacy ZIP schema must preserve valid subset schedule');
    assert.equal(schedule.value.entries.reduce((sum,e)=>sum+e.jp,0),54);
  }
  assert.deepEqual(schedules.flatMap(s=>s.value.entries.map(e=>[e.date,e.sessionId,e.jp])).map(([date,,jp])=>[date,jp]),current.state.semesterData.learningMeetingSchedules!.flatMap(s=>s.value.entries.map(e=>[e.date,e.jp])));
}
assert.equal(before,JSON.stringify({...current.state,semesterData:{...current.state.semesterData,journalRealizations:[]}}),'No source content/calendar/meetings are rewritten by projection or export');
console.log('PASS both modes: actual DOCX/PDF PROTA, PROMES, Alokasi Waktu and existing-schema ZIP import preserve saved 108/54 JP and dates. No PAI V6.2/live import or visual renderer claim.');
