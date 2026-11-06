import { resolveLearningPlanMeetingBudgets } from '../src/services/learningPlanActivityMeetingService';
import { validateLearningPlanActivityMeetings } from '../src/services/learningPlanActivityMeetingService';
import { resolveEffectiveSubjectSlots } from '../src/services/subjectScheduleService';
import { resolveLearningMeetingSchedule, buildLearningMeetingScheduleData, validateLearningMeetingScheduleData } from '../src/services/learningMeetingScheduleService';
import { createCompleteProjectZip, readCompleteProjectZip } from '../src/services/completeProjectZipService';
import { importCompleteAdministrationProject } from '../src/services/administrationProjectImportService';
import { buildUnitExecutionPlanAIDiagnosticReport } from '../src/services/diagnosticService';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as icons from 'lucide-react';
import * as alignment from '../src/services/meetingAlignmentService';
import * as execution from '../src/services/unitExecutionPlanService';
import * as placement from '../src/services/unitSemesterPlanningService';
import * as allocation from '../src/services/unitMeetingAllocationService';
import * as storage from '../src/services/storageV5';
import { isLearningMeetingScheduleStale } from '../src/services/learningMeetingScheduleService';
import { resolveScheduledLearningMeetings } from '../src/services/scheduledLearningMeetingProjectionService';
import { computeAtpSubstantiveFingerprint, computeTpSubstantiveFingerprint } from '../src/services/atpMappingActionApplyService';
import { createIdentityDuplicationFixture } from './fixtures/identityDuplicationFixture';
import { assertMeetingSourceLineage, MeetingCoverageError } from '../server/unitMeetingCoverageRepair';
import type { LearningMeeting, UnitExecutionPlanData, AppStorageStateV5 } from '../src/types';

const memory=new Map<string,string>(); let writes=0, failWrites=false, serial=0, passed=0;
(globalThis as any).localStorage={getItem:(k:string)=>memory.get(k)??null,setItem:(k:string,v:string)=>{if(failWrites) throw new Error('quota exceeded');writes++;memory.set(k,v);},removeItem:(k:string)=>memory.delete(k)};
const newId=()=>`new-${serial++}`;
function test(name:string, fn:()=>void) {fn();passed++;console.log('PASS',name);}
function fixture(counts=[3,1],targets=[1,1],slotJP=4) {
  const state=createIdentityDuplicationFixture();
  const tp=state.annualData.tp[0].value, atp=state.annualData.atp[0].value;
  tp.items=tp.items.slice(0,1);atp.items=atp.items.slice(0,1);
  const mapping=state.annualData.atpUnitMappings![0].value, plan=state.annualData.unitExecutionPlans![0].value;
  const base=structuredClone(mapping.units[0]);
  mapping.units=[0,1].map(i=>({...structuredClone(base),id:`u${i}`,title:`Bab ${i+1}`,order:i+1,linkedTpIds:[`t${i}`],linkedAtpItemIds:[`a${i}`],materials:[{id:`mat${i}`,title:`Materi ${i+1}`,order:1,linkedTpIds:[`t${i}`],linkedAtpItemIds:[`a${i}`]}]}));
  const tpBase=structuredClone(tp.items[0]), atpBase=structuredClone(atp.items[0]);
  tp.items=[0,1].map(i=>({...tpBase,id:`t${i}`,code:`TP${i+1}`,order:i+1}));
  atp.items=[0,1].map(i=>({...atpBase,id:`a${i}`,stepNumber:i+1,linkedTpIds:[`t${i}`],allocatedJP:1,jp:1}));
  tp.workflowStatus='SIAP';atp.workflowStatus='SIAP';tp.needsReview=false;atp.needsReview=false;
  mapping.basedOnAtpFingerprint=computeAtpSubstantiveFingerprint(atp);mapping.basedOnTpFingerprint=computeTpSubstantiveFingerprint(tp);
  plan.units=mapping.units.map((u,i)=>({unitId:u.id,meetings:Array.from({length:counts[i]},(_,j)=>({id:`m${i}-${j}`,unitId:u.id,order:j+1,plannedJP:1,title:`Kegiatan ${j+1}`,materialIds:[`mat${i}`],linkedAtpItemIds:[`a${i}`],linkedTpIds:[`t${i}`]}))}));
  plan.semesterPlacement={mode:'CONTIGUOUS_BOUNDARY',semester1LastUnitId:'u0',updatedAt:plan.updatedAt};
  state.semesterData.learningPlan=[];state.semesterData.assessmentPlan=[];state.semesterData.assessmentPackage=[];
  state.semesterData.timeAllocation=[];state.semesterData.assessmentCriteria=[];state.semesterData.grade=[];state.semesterData.remedial=[];state.semesterData.enrichment=[];
  state.semesterData.attendance=[];state.semesterData.journalRealizations=[];state.semesterData.learningMeetingSchedules=[];
  state.semesterJPSettings=[];state.semesterData.academicCalendar=[];state.semesterData.subjectWeeklySchedules=[];
  for(const i of [0,1]) {
    const sp=`sp${i+1}`,start=i?'2027-01-04':'2026-08-03';
    const dates=Array.from({length:(Math.max(1,targets[i])-1)*7+5},(_,j)=>new Date(Date.parse(start)+j*86400000).toISOString().slice(0,10)).filter(date=>![0,6].includes(new Date(date).getUTCDay()));
    state.semesterJPSettings.push({semesterPlanId:sp,value:{semesterPlanId:sp,actualScheduledWeeklyJP:slotJP,source:'SEMESTER_OVERRIDE'}});
    state.semesterData.academicCalendar.push({semesterPlanId:sp,value:{calendar:{id:`cal${i}`,academicSettingId:sp,academicYear:'2026/2027',semester:String(i+1) as '1'|'2',startDate:start,endDate:dates.at(-1)!,schoolDaysPerWeek:5,workflowStatus:'CONFIRMED',updatedAt:plan.updatedAt},days:dates.map((date,j)=>({id:`day${i}-${j}`,academicCalendarId:`cal${i}`,date,status:'EFFECTIVE_LEARNING'}))}});
    state.semesterData.subjectWeeklySchedules.push({semesterPlanId:sp,value:{semesterPlanId:sp,basedOnWeeklyJP:slotJP,updatedAt:plan.updatedAt,sessions:[{id:`session${i}`,dayOfWeek:1,jp:slotJP,order:1}]}});
  }
  state.documents=[{id:'historical',type:'JURNAL',title:'Jurnal lama',status:'completed',academicSettingId:'sp1',snapshot:{historical:'keep'} as any}];
  return state;
}
function empty(m:LearningMeeting) {Object.assign(m,{title:'',materialIds:[],linkedAtpItemIds:[],linkedTpIds:[]});}
function review(state:AppStorageStateV5,add=false) {
  storage.saveStorageV5(state);
  const source=storage.getMeetingAlignmentSourceV5('y'), draft=source.persistedPlan!;
  const proposal=alignment.proposeMeetingAlignment(draft,source.mapping,source.capacity,source.context,add);
  return {source,draft,proposal,apply:()=>alignment.applyMeetingAlignment(draft,source.mapping,source.capacity,proposal,newId,source.context)};
}
function addSchedule(state:AppStorageStateV5) {
  const plan=state.annualData.unitExecutionPlans![0].value;
  state.semesterData.learningMeetingSchedules=[{semesterPlanId:'sp1',value:{id:'schedule',semesterPlanId:'sp1',status:'COMPLETE',basedOnMappingUpdatedAt:state.annualData.atpUnitMappings![0].value.updatedAt,basedOnUnitExecutionPlanUpdatedAt:plan.updatedAt,basedOnSubjectWeeklyScheduleUpdatedAt:plan.updatedAt,basedOnCalendarUpdatedAt:plan.updatedAt,basedOnWeeklyJP:4,updatedAt:plan.updatedAt,unresolvedMeetingIds:[],entries:plan.units[0].meetings.map((m,i)=>({meetingId:m.id,unitId:'u0',semesterPlanId:'sp1',sessionId:'session0',sourceSlotId:`slot${i}`,date:'2026-08-03',dayOfWeek:1,jp:4,weekIndex:1,mode:'AUTO'}))}}];
}

test('surplus capacity is allowed; optional additions require preview and preserve IDs',()=>{
  const state=fixture([1,1],[3,2]); const {source,draft,proposal,apply}=review(state);
  assert.deepEqual(proposal.errors,[]);assert.equal(proposal.operations.length,0);assert.deepEqual(apply(),draft);
  const allocationResult=allocation.allocateUnitMeetings({mapping:source.mapping,currentPlan:draft,semester1UnitIds:['u0'],semester2UnitIds:['u1'],targetS1:3,targetS2:2});
  assert.equal(allocationResult.isValid,true);assert.equal(allocationResult.semester1.newTarget,0);assert.equal(allocationResult.semester2.newTarget,0);
  const report=buildUnitExecutionPlanAIDiagnosticReport({mapping:source.mapping,unitExecutionPlan:draft,capacityContext:source.capacity});
  assert.ok(report.includes('S1 target=3 existing=1 requestedNew=0'));assert.ok(report.includes('S2 target=2 existing=1 requestedNew=0'));
  const grow=alignment.proposeMeetingAlignment(draft,source.mapping,source.capacity,source.context,true);
  const next=alignment.applyMeetingAlignment(draft,source.mapping,source.capacity,grow,newId,source.context);
  assert.deepEqual(next.units.map(u=>u.meetings.length),[3,2]);assert.equal(next.units[0].meetings[0].id,draft.units[0].meetings[0].id);
  storage.saveUnitExecutionPlanV5('y',next,{draft,proposal:grow});assert.deepEqual(storage.getUnitExecutionPlanV5('y'),next);
});
test('empty removal and compatible content merge share one proposal; content/order/coverage retained',()=>{
  const state=fixture();empty(state.annualData.unitExecutionPlans![0].value.units[0].meetings[2]);
  const {source,draft,proposal,apply}=review(state);assert.deepEqual(proposal.errors,[]);
  assert.deepEqual(proposal.operations.map(o=>o.type),['REMOVE_EMPTY','MERGE']);
  const snapshot=JSON.stringify(draft), next=apply();assert.equal(JSON.stringify(draft),snapshot);
  assert.equal(next.units[0].meetings.length,1);assert.equal(next.units[0].meetings[0].id,'m0-0');assert.equal(next.units[0].meetings[0].title,'Kegiatan 1 / Kegiatan 2');
  assert.deepEqual(next.units[0].meetings[0].alignmentMerge!.sources,draft.units[0].meetings.slice(0,2));
  assert.equal(execution.validateUnitExecutionPlan(next,source.mapping,source.context.atp,source.context.tp).isComplete,true);
  assert.deepEqual(next.semesterPlacement,draft.semesterPlacement);assert.deepEqual(next.units.map(u=>u.unitId),draft.units.map(u=>u.unitId));
  assert.equal(new Set(next.units.flatMap(u=>u.meetings.map(m=>m.id))).size,2);
});
test('empty-only reduction preserves a realized meeting verbatim',()=>{
  const state=fixture([3,1],[2,1]);const plan=state.annualData.unitExecutionPlans![0].value;
  empty(plan.units[0].meetings[2]);state.semesterData.journalRealizations=[{semesterPlanId:'sp1',value:[{semesterPlanId:'sp1',meetingId:'m0-0',outcome:'Keep',updatedAt:'2026-11-05'}]}];
  const r=review(state);assert.deepEqual(r.proposal.errors,[]);assert.deepEqual(r.proposal.operations.map(o=>o.type),['REMOVE_EMPTY']);
  assert.deepEqual(r.apply().units[0].meetings[0],plan.units[0].meetings[0]);
});
test('original S1 42/42 and S2 48/41 empty-slot case remains exact and ordered',()=>{
  const state=fixture([42,1],[1,1]);const source=storage.getMeetingAlignmentSourceV5('y',state),mapping=structuredClone(source.mapping),plan=structuredClone(source.persistedPlan!);
  const unit=structuredClone(mapping.units[1]);mapping.units=[mapping.units[0],...[15,12,9,12].map((_,i)=>({...structuredClone(unit),id:'b'+i,title:'Bab '+(i+5),order:i+2,materials:unit.materials.map(m=>({...m,id:m.id+'-'+i}))}))];
  plan.units=[plan.units[0],...[15,12,9,12].map((count,i)=>({unitId:'b'+i,meetings:Array.from({length:count},(_,j)=>({id:'b'+i+'m'+j,unitId:'b'+i,order:j+1,title:'',materialIds:[],linkedAtpItemIds:[],linkedTpIds:[]}))}))];plan.units[0].meetings.forEach(empty);
  const capacity={semester1:{isReady:true,targetMeetingCount:42,capacitySource:'ACTUAL_SLOTS'},semester2:{isReady:true,targetMeetingCount:41,capacitySource:'ACTUAL_SLOTS'}};
  source.context.slotJP={semester1:Array(42).fill(2),semester2:Array(41).fill(2)};
  const proposal=alignment.proposeMeetingAlignment(plan,mapping,capacity,source.context);
  assert.deepEqual(proposal.errors,[]);assert.equal(proposal.rows[0].proposed,42);assert.equal(proposal.rows.slice(1).reduce((s,r)=>s+r.proposed,0),41);
  const next=alignment.applyMeetingAlignment(plan,mapping,capacity,proposal,newId,source.context);
  assert.deepEqual(next.units.map(u=>u.unitId),plan.units.map(u=>u.unitId));assert.deepEqual(next.units[0],plan.units[0]);
});
test('unknown or excessive JP, incompatible scope, assessments and unknown content block merging',()=>{
  for(const mode of ['unknown','null','jp','scope','assessment','legacy']) {
    const state=fixture([2,1],[1,1],mode==='jp'?1:4), m=state.annualData.unitExecutionPlans![0].value.units[0].meetings[1];
    if(mode==='unknown') {delete m.plannedJP;delete state.annualData.atp[0].value.items[0].allocatedJP;delete state.annualData.atp[0].value.items[0].jp;state.annualData.atpUnitMappings![0].value.basedOnAtpFingerprint=computeAtpSubstantiveFingerprint(state.annualData.atp[0].value);}
    if(mode==='null') {(m as any).plannedJP=null;state.annualData.atp[0].value.items[0].allocatedJP=null;state.annualData.atpUnitMappings![0].value.basedOnAtpFingerprint=computeAtpSubstantiveFingerprint(state.annualData.atp[0].value);}
    if(mode==='scope') m.linkedTpIds=['t1'];if(mode==='assessment') m.title='Asesmen sumatif';if(mode==='legacy') (m as any).manualNotes='Keep';
    const r=review(state);assert.ok(r.proposal.errors.length,mode);assert.throws(r.apply);assert.deepEqual(storage.getUnitExecutionPlanV5('y'),r.draft);
  }
});
test('accumulated merge workload is retained for future alignment',()=>{
  const r=review(fixture([3,1],[1,1],4));assert.deepEqual(r.proposal.errors,[]);const next=r.apply();
  assert.equal(next.units[0].meetings[0].alignmentMerge!.requiredJP,3);
  assert.equal(next.units[0].meetings[0].alignmentMerge!.sources.length,3);
});
test('journal, attendance, realization, legacy attendance and learning-plan references are protected',()=>{
  for(const mode of ['journal','attendance','legacy','legacy-ambiguous','learning']) {
    const state=fixture([2,1]);addSchedule(state);
    if(mode==='journal') state.semesterData.journalRealizations=[{semesterPlanId:'sp1',value:[{semesterPlanId:'sp1',meetingId:'m0-1',outcome:'Realisasi',updatedAt:'2026-11-05'}]}];
    if(mode.startsWith('legacy') || mode==='attendance') state.semesterData.attendance=[{semesterPlanId:'sp1',value:{records:[],sessions:[{id:'attendance',academicSettingId:'sp1',meetingId:mode==='attendance'?'m0-1':undefined,date:mode==='legacy-ambiguous'?'2026-08-04':'2026-08-03',meetingNumber:mode==='legacy-ambiguous'?99:2,createdAt:'2026-11-05'}]}}];
    if(mode==='learning') state.semesterData.learningPlan=[{semesterPlanId:'sp1',value:[{id:'lp',academicSettingId:'sp1',unitId:'u0',learningMeetingIds:['m0-1'],learningSteps:{core:[{id:'c',learningMeetingId:'m0-1',description:'Manual',durationMinutes:10}]},assessmentPlan:{},tpIds:['t0'],atpItemIds:['a0'],objectives:[],status:'DRAFT',sourceType:'MANUAL',createdAt:'2026-11-05',updatedAt:'2026-11-05'}]}];
    const r=review(state);assert.ok(r.source.context.protectedMeetings['m0-1']?.length,mode);assert.ok(r.proposal.errors.length,mode);assert.throws(r.apply);
  }
});
test('protected empty slots are never deleted; surviving executed meeting is unchanged',()=>{
  const state=fixture([3,1]);empty(state.annualData.unitExecutionPlans![0].value.units[0].meetings[2]);
  state.semesterData.journalRealizations=[{semesterPlanId:'sp1',value:[{semesterPlanId:'sp1',meetingId:'m0-2',outcome:'Keep',updatedAt:'2026-11-05'}]}];
  const r=review(state);assert.ok(r.proposal.errors.length);assert.ok(r.proposal.operations.every(o=>!o.meetingIds.includes('m0-2')));
});
test('alignment cannot smuggle unsaved edits or deletion of a factual meeting',()=>{
  const state=fixture([3,1],[2,1]);
  state.semesterData.journalRealizations=[{semesterPlanId:'sp1',value:[{semesterPlanId:'sp1',meetingId:'m0-2',outcome:'Keep',updatedAt:'2026-11-05'}]}];
  const r=review(state),draft=structuredClone(r.draft);draft.units[0].meetings[2].title='Changed';
  assert.ok(alignment.proposeMeetingAlignment(draft,r.source.mapping,r.source.capacity,r.source.context).errors.some(e=>e.includes('terlindungi')));
  draft.units[0].meetings.pop();
  assert.ok(alignment.proposeMeetingAlignment(draft,r.source.mapping,r.source.capacity,r.source.context).errors.some(e=>e.includes('terlindungi')));
});
test('saved schedule and document invalidation is one write; source and historical snapshots unchanged',()=>{
  const state=fixture();empty(state.annualData.unitExecutionPlans![0].value.units[0].meetings[2]);addSchedule(state);
  const sourceSnapshot=JSON.stringify([state.annualData.cp,state.annualData.tp,state.annualData.atp,state.annualData.atpUnitMappings,state.semesterData.academicCalendar]);
  const r=review(state), next=r.apply(), beforeWrites=writes;
  assert.ok(r.proposal.impacts.length>=2);
  storage.saveUnitExecutionPlanV5('y',next,{draft:r.draft,proposal:r.proposal});assert.equal(writes,beforeWrites+1);
  const reloaded=storage.loadStorageV5(), schedule=reloaded.semesterData.learningMeetingSchedules![0].value;
  assert.equal(schedule.status,'DRAFT');assert.deepEqual(schedule.entries.map(e=>e.meetingId),['m0-0']);assert.equal(schedule.entries[0].date,'2026-08-03');
  assert.equal(isLearningMeetingScheduleStale({schedule,mappingUpdatedAt:r.source.mapping.updatedAt,unitExecutionPlanUpdatedAt:next.updatedAt,subjectWeeklyScheduleUpdatedAt:schedule.basedOnSubjectWeeklyScheduleUpdatedAt,calendarUpdatedAt:schedule.basedOnCalendarUpdatedAt,expectedWeeklyJP:4}),true);
  assert.equal(resolveScheduledLearningMeetings({mapping:r.source.mapping,unitExecutionPlan:next,schedules:[{semesterPlanId:'sp1',semester:1,schedule}],atp:r.source.context.atp,tp:r.source.context.tp}).isValid,false);
  assert.equal(reloaded.documents[0].status,'draft');assert.deepEqual(reloaded.documents[0].snapshot,state.documents[0].snapshot);
  assert.equal(JSON.stringify([reloaded.annualData.cp,reloaded.annualData.tp,reloaded.annualData.atp,reloaded.annualData.atpUnitMappings,reloaded.semesterData.academicCalendar]),sourceSnapshot);
  assert.deepEqual(storage.getUnitExecutionPlanV5('y'),next);
});
test('calendar same-count revision, stale data, new factual dependencies and tampered payload reject atomically',()=>{
  for(const mode of ['calendar','plan','journal','mapping','tamper']) {
    const r=review(fixture([2,1])), next=r.apply();
    if(mode!=='tamper') {
      const current=storage.loadStorageV5();
      if(mode==='calendar') current.semesterData.academicCalendar[0].value.calendar.updatedAt='2026-11-05';
      if(mode==='plan') current.annualData.unitExecutionPlans![0].value.units[0].meetings[0].title='New edit';
      if(mode==='journal') current.semesterData.journalRealizations=[{semesterPlanId:'sp1',value:[{semesterPlanId:'sp1',meetingId:'m0-1',activities:'New fact',updatedAt:'2026-11-05'}]}];
      if(mode==='mapping') current.annualData.atpUnitMappings![0].value.updatedAt='2026-11-05';
      storage.saveStorageV5(current);
    } else next.units[0].meetings[0].title='Tampered';
    const before=memory.get(storage.STORAGE_KEY_V5),beforeWrites=writes;
    assert.throws(()=>storage.saveUnitExecutionPlanV5('y',next,{draft:r.draft,proposal:r.proposal}),undefined,mode);
    assert.equal(memory.get(storage.STORAGE_KEY_V5),before);assert.equal(writes,beforeWrites);
  }
});
test('save failure never partially changes plan, schedules or documents',()=>{
  const state=fixture([2,1]);addSchedule(state);const r=review(state),next=r.apply(),before=memory.get(storage.STORAGE_KEY_V5);
  failWrites=true;try {assert.throws(()=>storage.saveUnitExecutionPlanV5('y',next,{draft:r.draft,proposal:r.proposal}),/quota/);}finally{failWrites=false;}
  assert.equal(memory.get(storage.STORAGE_KEY_V5),before);
});
test('single Bab, unchanged semester and invalid minimum/capacity',()=>{
  const state=fixture([2,1]);state.annualData.atpUnitMappings![0].value.units.pop();state.annualData.unitExecutionPlans![0].value.units.pop();
  // Pure service accepts an unused second-semester capacity without moving the single Bab.
  const source=storage.getMeetingAlignmentSourceV5('y',state);source.context.errors=[];
  const plan=state.annualData.unitExecutionPlans![0].value;
  const proposal=alignment.proposeMeetingAlignment(plan,source.mapping,source.capacity,source.context);
  assert.deepEqual(proposal.errors,[]);assert.equal(proposal.rows.length,1);assert.equal(proposal.rows[0].semester,1);
  const invalid={...source.capacity,semester1:{isReady:true,targetMeetingCount:0}};
  assert.ok(alignment.proposeMeetingAlignment(plan,source.mapping,invalid,source.context).errors.length);
  assert.ok(alignment.proposeMeetingAlignment(plan,source.mapping,{...invalid,semester1:{isReady:true,targetMeetingCount:NaN}},source.context).errors.length);
});


function mixedPattern(state:AppStorageStateV5) {
  const weekly=state.semesterData.subjectWeeklySchedules![0].value;
  weekly.sessions=[{id:'mon',dayOfWeek:1,jp:2,order:1},{id:'wed',dayOfWeek:3,jp:4,order:2}];weekly.basedOnWeeklyJP=6;
  state.semesterJPSettings[0].value.actualScheduledWeeklyJP=6;
}
function activities(m:LearningMeeting, demands:number[], essential=true) {
  m.plannedJP=demands.reduce((s,n)=>s+n,0);
  m.activities=demands.map((jp,i)=>({id:m.id+'-activity-'+i,learningMeetingId:m.id,description:'Substansi '+m.id+' bagian '+i,durationMinutes:jp*35,essential,activityType:'learning'}));
}
test('48 to 41 uses empty, proven redundancy and merges on actual mixed 2/4 JP slots',()=>{
  const state=fixture([48,1],[21,1]);mixedPattern(state);
  const cal=state.semesterData.academicCalendar[0].value;
  cal.days.filter(d=>new Date(d.date).getUTCDay()===3).at(-1)!.status='HOLIDAY';
  const meetings=state.annualData.unitExecutionPlans![0].value.units[0].meetings;
  [45,46,47].forEach(i=>empty(meetings[i]));
  activities(meetings[0],[1],false);activities(meetings[1],[1],false);
  meetings[0].title=meetings[1].title='Pengulangan identik yang ditinjau';
  meetings[1].activities![0].description=meetings[0].activities![0].description;
  const sourceBefore=JSON.stringify([state.annualData.cp,state.annualData.tp,state.annualData.atp,state.annualData.atpUnitMappings,state.semesterData.academicCalendar]);
  const r=review(state);assert.equal(r.source.capacity.semester1.targetMeetingCount,41);assert.deepEqual(r.proposal.errors,[]);
  const strategies=new Set(r.proposal.operations.map(o=>o.type));assert.ok(strategies.has('REMOVE_EMPTY'));assert.ok(strategies.has('REDUCE_REDUNDANT'));assert.ok(strategies.has('MERGE'));
  const next=r.apply();assert.equal(next.units[0].meetings.length,41);assert.ok(r.proposal.simulation.every(row=>row.plannedJP===null || row.plannedJP<=row.slotJP!));
  assert.equal(r.proposal.curriculumJPStatus,'SEPARATE_REVIEW');assert.equal(r.proposal.slotStatus,'VALID');
  assert.equal(execution.validateUnitExecutionPlan(next,r.source.mapping,r.source.context.atp,r.source.context.tp).isComplete,true);
  storage.saveUnitExecutionPlanV5('y',next,{draft:r.draft,proposal:r.proposal});const saved=storage.loadStorageV5();
  assert.equal(JSON.stringify([saved.annualData.cp,saved.annualData.tp,saved.annualData.atp,saved.annualData.atpUnitMappings,saved.semesterData.academicCalendar]),sourceBefore);
});
test('actual mixed slots permit a 4 JP merge in the second slot, without doubling ATP JP',()=>{
  const state=fixture([3,1]);mixedPattern(state);
  state.annualData.unitExecutionPlans![0].value.units[0].meetings.forEach(m=>m.plannedJP=2);
  state.annualData.atp[0].value.items[0].allocatedJP=100;
  state.annualData.atpUnitMappings![0].value.basedOnAtpFingerprint=computeAtpSubstantiveFingerprint(state.annualData.atp[0].value);
  const r=review(state);assert.deepEqual(r.proposal.errors,[]);const next=r.apply();
  assert.deepEqual(next.units[0].meetings.map(m=>m.plannedJP),[2,4]);assert.equal(next.units[0].meetings[1].id,'m0-1');
  assert.deepEqual(r.proposal.simulation.filter(row=>row.semester===1).map(row=>row.slotJP),[2,4]);
});
test('redundancy requires reviewed identical activities; essential/assessment content is retained',()=>{
  const state=fixture([2,1],[1,1],2),meetings=state.annualData.unitExecutionPlans![0].value.units[0].meetings;
  meetings.forEach(m=>{m.title='Judul sama';activities(m,[2],false);m.activities![0].description='Latihan identik';});
  let r=review(state);assert.deepEqual(r.proposal.errors,[]);assert.equal(r.proposal.operations[0].type,'REDUCE_REDUNDANT');assert.equal(r.apply().units[0].meetings[0].plannedJP,2);
  meetings[1].activities![0].essential=true;r=review(state);assert.ok(r.proposal.errors.length);assert.throws(r.apply);
  meetings[1].activities![0].essential=false;meetings[1].activities![0].activityType='assessment';r=review(state);assert.ok(r.proposal.errors.length);
  meetings[1].activities![0].activityType='learning';meetings[1].activities![0].description='Kegiatan unik esensial';r=review(state);assert.ok(r.proposal.errors.length);
});
test('COMPACT preserves every activity, essential flag, duration and source order',()=>{
  const state=fixture([3,1]);mixedPattern(state);const meetings=state.annualData.unitExecutionPlans![0].value.units[0].meetings;
  activities(meetings[0],[2,1]);activities(meetings[1],[1]);activities(meetings[2],[2]);
  const r=review(state);assert.deepEqual(r.proposal.errors,[]);assert.ok(r.proposal.operations.some(o=>o.type==='COMPACT'));
  const next=r.apply();assert.deepEqual(next.units[0].meetings.map(m=>m.plannedJP),[2,4]);
  assert.deepEqual(next.units[0].meetings.flatMap(m=>m.activities!.map(a=>[a.id,a.description,a.durationMinutes,a.essential])),meetings.flatMap(m=>m.activities!.map(a=>[a.id,a.description,a.durationMinutes,a.essential])));
});
test('REDISTRIBUTE fits 4+2 JP demand to 2/4 slots without reducing activities',()=>{
  const state=fixture([2,1]);mixedPattern(state);const meetings=state.annualData.unitExecutionPlans![0].value.units[0].meetings;
  activities(meetings[0],[2,2]);activities(meetings[1],[2]);
  const r=review(state);assert.deepEqual(r.proposal.errors,[]);assert.ok(r.proposal.operations.some(o=>o.type==='REDISTRIBUTE'));
  assert.deepEqual(r.apply().units[0].meetings.map(m=>m.plannedJP),[2,4]);
});
test('unique TP/material and prerequisite sequence cannot be reduced away or reversed',()=>{
  const state=fixture([2,1],[1,1],2),atp=state.annualData.atp[0].value,tp=state.annualData.tp[0].value,map=state.annualData.atpUnitMappings![0].value;
  tp.items.push({...tp.items[0],id:'unique-tp',order:3});atp.items[1].stepNumber=3;atp.items.push({...atp.items[0],id:'unique-atp',stepNumber:2,linkedTpIds:['unique-tp']});
  map.units[0].linkedTpIds.push('unique-tp');map.units[0].linkedAtpItemIds.push('unique-atp');map.units[0].materials.push({id:'unique-mat',title:'Substansi unik',order:2,linkedTpIds:['unique-tp'],linkedAtpItemIds:['unique-atp']});
  map.basedOnAtpFingerprint=computeAtpSubstantiveFingerprint(atp);map.basedOnTpFingerprint=computeTpSubstantiveFingerprint(tp);
  const meetings=state.annualData.unitExecutionPlans![0].value.units[0].meetings;
  activities(meetings[0],[2]);activities(meetings[1],[2]);meetings[1].linkedTpIds=['unique-tp'];meetings[1].linkedAtpItemIds=['unique-atp'];meetings[1].materialIds=['unique-mat'];
  let r=review(state);assert.ok(r.proposal.errors.length);assert.throws(r.apply);
  const slots=state.semesterData.subjectWeeklySchedules![0].value;slots.sessions[0].jp=4;slots.basedOnWeeklyJP=4;state.semesterJPSettings[0].value.actualScheduledWeeklyJP=4;
  r=review(state);assert.deepEqual(r.proposal.errors,[]);assert.ok(r.apply().units[0].meetings[0].linkedTpIds.includes('unique-tp'));
  [meetings[0],meetings[1]]=[meetings[1],meetings[0]];meetings.forEach((m,i)=>m.order=i+1);
  r=review(state);assert.ok(r.proposal.errors.some(e=>e.includes('prasyarat')));assert.throws(r.apply);
});
test('unknown demand blocks content optimization but legacy backups remain lossless and do not acquire ATP JP',()=>{
  const state=fixture([2,1]);state.annualData.unitExecutionPlans![0].value.units.forEach(u=>u.meetings.forEach(m=>delete m.plannedJP));
  const legacy=storage.parseBackupV5(storage.serializeBackupV5(state));assert.ok(legacy.annualData.unitExecutionPlans![0].value.units.every(u=>u.meetings.every(m=>m.plannedJP===undefined)));
  const r=review(legacy);assert.ok(r.proposal.errors.some(e=>e.includes('JP pertemuan belum diketahui')));assert.throws(r.apply);
});
test('AI drafts reject invented IDs/JP, lost essentials, changed duration, stale source and protected IDs',()=>{
  const state=fixture([2,1]);mixedPattern(state);const ms=state.annualData.unitExecutionPlans![0].value.units[0].meetings;activities(ms[0],[2,2]);activities(ms[1],[2]);
  const r=review(state),fp=alignment.optimizationFingerprint(r.draft,r.source.mapping,r.source.context);
  const valid:alignment.MeetingOptimizationDraft={sourceFingerprint:fp,reason:'Redistribusi kegiatan utuh',edits:[{id:ms[0].id,plannedJP:2,activities:ms[0].activities!.slice(0,1)},{id:ms[1].id,plannedJP:4,activities:[{...ms[0].activities![1],learningMeetingId:ms[1].id},...ms[1].activities!]}]};
  assert.deepEqual(alignment.validateMeetingOptimizationDraft(valid,r.draft,r.source.mapping,r.source.context).errors,[]);
  for(const mode of ['id','tp','jp','activity','duration','stale','protected']) {
    const invalid=structuredClone(valid),context=structuredClone(r.source.context);
    if(mode==='id')invalid.edits[0].id='invented';if(mode==='tp')invalid.edits[0].linkedTpIds=['invented'];if(mode==='jp')invalid.edits[0].plannedJP=1;
    if(mode==='activity')invalid.edits[0].activities=[];if(mode==='duration')invalid.edits[0].activities![0].durationMinutes=1;
    if(mode==='stale')invalid.sourceFingerprint='old';if(mode==='protected')context.protectedMeetings[ms[0].id]=['journal'];
    assert.ok(alignment.validateMeetingOptimizationDraft(invalid,r.draft,r.source.mapping,context).errors.length,mode);
  }
});
test('ordinary save also rejects edits to referenced assessment/factual meeting IDs',()=>{
  const state=fixture([2,1]);state.semesterData.assessmentPlan=[{semesterPlanId:'sp1',value:[{id:'assessment-ref',academicSettingId:'sp1',learningMeetingId:'m0-0'} as any]}];
  const r=review(state),changed=structuredClone(r.draft),before=memory.get(storage.STORAGE_KEY_V5);changed.units[0].meetings[0].title='Changed';
  assert.throws(()=>storage.saveUnitExecutionPlanV5('y',changed),/terlindungi/);assert.equal(memory.get(storage.STORAGE_KEY_V5),before);
});


test('automatic/manual schedules and document projections reject a meeting that exceeds its actual JP slot',()=>{
  const r=review(fixture([1,1],[1,1],2)), state=storage.loadStorageV5(),calendar=state.semesterData.academicCalendar[0].value,weekly=state.semesterData.subjectWeeklySchedules![0].value;
  const params={semesterPlanId:'sp1',semester:1 as const,mapping:r.source.mapping,unitExecutionPlan:r.draft,subjectWeeklySchedule:weekly,expectedWeeklyJP:2,calendar:calendar.calendar,calendarDays:calendar.days};
  const slots=resolveEffectiveSubjectSlots({...params,schedule:weekly});const good=resolveLearningMeetingSchedule({...params,subjectSlotResult:slots});assert.equal(good.isValid,true);
  const data=buildLearningMeetingScheduleData({...params,autoResult:good,manualOverrides:[]});
  const oversized=structuredClone(r.draft);oversized.units[0].meetings[0].plannedJP=3;
  assert.equal(resolveLearningMeetingSchedule({...params,unitExecutionPlan:oversized,subjectSlotResult:slots}).isValid,false);
  assert.equal(validateLearningMeetingScheduleData({...params,unitExecutionPlan:oversized,data}).isValid,false);
  assert.equal(resolveScheduledLearningMeetings({mapping:r.source.mapping,unitExecutionPlan:oversized,schedules:[{semesterPlanId:'sp1',semester:1,schedule:data}],atp:r.source.context.atp,tp:r.source.context.tp}).isValid,false);
});
test('Modul Ajar activity validator preserves essential source descriptions and their time budgets',()=>{
  const setting:any={level:'SD',grade:'3',subject:'PJOK',curriculumType:'KURIKULUM_MERDEKA',curriculum:'Kurikulum Merdeka',academicYear:'2026/2027'};
  const plan:any={learningSteps:{opening:[{id:'o',learningMeetingId:'m',description:'Pembukaan',durationMinutes:10}],core:[{id:'c',learningMeetingId:'m',description:'Praktik esensial',durationMinutes:50}],closing:[{id:'f',learningMeetingId:'m',description:'Penutup',durationMinutes:10}]}};
  const meetings=[{meetingId:'m',jp:2,activities:[{id:'source',description:'Praktik esensial',durationMinutes:35,essential:true}]}];
  assert.equal(validateLearningPlanActivityMeetings(plan,['m'],true,meetings,setting).isValid,true);
  plan.learningSteps.core[0].description='Kegiatan lain';assert.equal(validateLearningPlanActivityMeetings(plan,['m'],true,meetings,setting).isValid,false);
  plan.learningSteps.core[0].description='Praktik esensial';meetings[0].activities[0].durationMinutes=60;assert.equal(validateLearningPlanActivityMeetings(plan,['m'],true,meetings,setting).isValid,false);
  (meetings[0].activities[0] as any).durationMinutes=undefined;assert.equal(validateLearningPlanActivityMeetings(plan,['m'],true,meetings,setting).isValid,false);
});


test('infeasible 48 to 41 reports JP blockers and never forces a partial reduction',()=>{
  const state=fixture([48,1],[41,1],2);state.annualData.unitExecutionPlans![0].value.units[0].meetings.forEach(m=>m.plannedJP=4);
  const r=review(state),before=memory.get(storage.STORAGE_KEY_V5);
  assert.ok(r.proposal.errors.length);assert.ok([...r.proposal.errors,...r.proposal.conflicts].some(e=>e.includes('4 JP') || e.includes('4 →')));
  assert.throws(r.apply);assert.equal(memory.get(storage.STORAGE_KEY_V5),before);assert.equal(storage.getUnitExecutionPlanV5('y')!.units[0].meetings.length,48);
});
test('empty removal cannot shift the dated slot of a realized meeting',()=>{
  const state=fixture([3,1],[2,1],2);empty(state.annualData.unitExecutionPlans![0].value.units[0].meetings[0]);addSchedule(state);
  const schedule=state.semesterData.learningMeetingSchedules![0].value;
  schedule.entries=schedule.entries.filter(e=>e.meetingId==='m0-1');Object.assign(schedule.entries[0],{date:'2026-08-10',jp:2});schedule.status='DRAFT';schedule.unresolvedMeetingIds=['m0-0','m0-2'];
  state.semesterData.journalRealizations=[{semesterPlanId:'sp1',value:[{semesterPlanId:'sp1',meetingId:'m0-1',actualDate:'2026-08-10',actualJP:2,outcome:'Terlaksana',updatedAt:'2026-11-05'}]}];
  const r=review(state);assert.ok(r.proposal.errors.length);assert.ok(r.proposal.conflicts.some(c=>c.includes('terlindungi')));assert.throws(r.apply);
});


function calendarContent(request:ReturnType<typeof allocation.prepareCalendarMeetingGeneration>,mapping:any) {
  return {units:request.allocation.units.map(target=>{const unit=mapping.units.find((u:any)=>u.id===target.unitId);return {unitId:target.unitId,meetings:Array.from({length:target.newTargetCount},(_,i)=>({title:unit.title+' sesi '+(i+1),materialIds:unit.materials.map((m:any)=>m.id),linkedTpIds:unit.linkedTpIds,linkedAtpItemIds:unit.linkedAtpItemIds,plannedJP:999}))};})};
}
function finalReview(state:AppStorageStateV5,mode:'COMPLETE'|'REGENERATE'='COMPLETE') {
  const r=review(state),request=allocation.prepareCalendarMeetingGeneration(r.draft,r.source.mapping,r.source.capacity,r.source.context,mode);
  const result=allocation.buildCalendarMeetingCandidate(r.draft,r.source.mapping,r.source.capacity,r.source.context,mode,calendarContent(request,r.source.mapping),newId);
  return {...r,request,result};
}
test('S1 estimate 42 without teaching days reports calendar only; actual S1 42 and S2 48 to 41 regenerate',()=>{
  const state=fixture([42,48],[42,41]);
  state.semesterData.subjectWeeklySchedules![0].value.sessions.forEach(s=>delete s.dayOfWeek);
  const r=review(state),before=memory.get(storage.STORAGE_KEY_V5);
  assert.equal(r.source.capacity.semester1.capacitySource,'ESTIMATE');
  assert.equal(r.source.context.slotDetails!.semester1.length,0);
  assert.equal(r.source.context.slotDetails!.semester2.length,41);
  assert.ok(r.source.context.calendarErrors!.some(e=>e.includes('Semester 1') && e.includes('Hari mengajar') && e.includes('Alokasi Waktu')));
  assert.throws(()=>allocation.prepareCalendarMeetingGeneration(r.draft,r.source.mapping,r.source.capacity,r.source.context,'REGENERATE'),(e:Error)=>e.message.includes('Kalender Semester 1') && !e.message.includes('coverage') && !e.message.includes('Semester 2:'));
  assert.equal(memory.get(storage.STORAGE_KEY_V5),before);
  state.semesterData.subjectWeeklySchedules![0].value.sessions.forEach(s=>s.dayOfWeek=1);
  const actual=finalReview(state,'REGENERATE');
  assert.deepEqual(actual.result.candidate.units.map(u=>u.meetings.length),[42,41]);
  assert.ok(actual.result.candidate.units.every(u=>u.meetings.every(m=>m.plannedJP===4)));
});
test('final generation fills 10 confirmed slots exactly, including already complete curriculum coverage',()=>{
  const r=finalReview(fixture([1,1],[10,1])),next=r.result.candidate;
  assert.equal(next.units[0].meetings.length,10);assert.ok(next.units[0].meetings.every(m=>m.plannedJP===4));
  assert.equal(r.request.allocation.semester1.newTarget,9);assert.equal(next.units[0].meetings[0].id,r.draft.units[0].meetings[0].id);
  assert.deepEqual(allocation.validateCalendarMeetingCandidate(next,r.draft,r.source.mapping,r.source.capacity,r.source.context),[]);
  storage.saveUnitExecutionPlanV5('y',next,{draft:r.draft,calendarGeneration:r.result});assert.deepEqual(storage.getUnitExecutionPlanV5('y'),next);
});
test('system binds 4/2 JP from ordered actual slots and ignores AI JP, with correct Modul Ajar budgets',()=>{
  const state=fixture([0,0]);mixedPattern(state);const weekly=state.semesterData.subjectWeeklySchedules![0].value;weekly.sessions[0].jp=4;weekly.sessions[1].jp=2;
  const r=finalReview(state),meetings=r.result.candidate.units[0].meetings;
  assert.deepEqual(meetings.map(m=>m.plannedJP),[4,2]);
  const budgets=resolveLearningPlanMeetingBudgets(meetings.map(m=>({meetingId:m.id,jp:m.plannedJP!,plannedJP:m.plannedJP})),{level:'SD',grade:'2',subject:'PJOK',curriculumType:'KURIKULUM_MERDEKA',curriculum:'Kurikulum Merdeka',academicYear:'2026/2027'});
  assert.equal(budgets.isValid,true);assert.deepEqual(budgets.meetings.map(m=>m.durationMinutes),[140,70]);
});
test('holiday removes exactly one effective slot and generated meeting without editing the calendar',()=>{
  const state=fixture([0,0],[10,1]),cal=state.semesterData.academicCalendar[0].value;
  cal.days.find(d=>d.date===cal.calendar.startDate)!.status='HOLIDAY';const before=JSON.stringify(state.semesterData.academicCalendar);
  const r=finalReview(state);assert.equal(r.request.slots.semester1.length,9);assert.equal(r.result.candidate.units[0].meetings.length,9);
  storage.saveUnitExecutionPlanV5('y',r.result.candidate,{draft:r.draft,calendarGeneration:r.result});assert.equal(JSON.stringify(storage.loadStorageV5().semesterData.academicCalendar),before);
});
test('48 old meetings regenerate to 41 only after approval, retaining source content; protected data rejects preflight',()=>{
  const state=fixture([1,48],[1,41]),r=finalReview(state,'REGENERATE'),before=memory.get(storage.STORAGE_KEY_V5);
  assert.equal(r.result.candidate.units[1].meetings.length,41);assert.equal(memory.get(storage.STORAGE_KEY_V5),before);
  assert.deepEqual(r.result.candidate.units[1].meetings[0].alignmentMerge!.sources,r.draft.units[1].meetings);
  storage.saveUnitExecutionPlanV5('y',r.result.candidate,{draft:r.draft,calendarGeneration:r.result});assert.equal(storage.getUnitExecutionPlanV5('y')!.units[1].meetings.length,41);
  state.semesterData.journalRealizations=[{semesterPlanId:'sp2',value:[{semesterPlanId:'sp2',meetingId:'m1-0',outcome:'Executed',updatedAt:'2026-11-06'}]}];
  const protectedSource=review(state),stored=memory.get(storage.STORAGE_KEY_V5);
  assert.throws(()=>allocation.prepareCalendarMeetingGeneration(protectedSource.draft,protectedSource.source.mapping,protectedSource.source.capacity,protectedSource.source.context,'REGENERATE'),/terlindungi/);
  assert.equal(memory.get(storage.STORAGE_KEY_V5),stored);
});
test('final generation rejects estimates, invalid AI counts/coverage, stale calendar and failed save atomically',()=>{
  const r=finalReview(fixture([0,0],[3,1]));
  assert.throws(()=>allocation.prepareCalendarMeetingGeneration(r.draft,r.source.mapping,{...r.source.capacity,semester1:{...r.source.capacity.semester1,capacitySource:'ESTIMATE'}},r.source.context,'COMPLETE'),/estimasi/);
  const bad=calendarContent(r.request,r.source.mapping);bad.units[0].meetings.pop();
  assert.throws(()=>allocation.buildCalendarMeetingCandidate(r.draft,r.source.mapping,r.source.capacity,r.source.context,'COMPLETE',bad,newId),/Jumlah/);
  const incomplete=calendarContent(r.request,r.source.mapping);incomplete.units[0].meetings.forEach(m=>m.materialIds=[]);
  assert.throws(()=>allocation.buildCalendarMeetingCandidate(r.draft,r.source.mapping,r.source.capacity,r.source.context,'COMPLETE',incomplete,newId));
  const before=memory.get(storage.STORAGE_KEY_V5);failWrites=true;try{assert.throws(()=>storage.saveUnitExecutionPlanV5('y',r.result.candidate,{draft:r.draft,calendarGeneration:r.result}),/quota/);}finally{failWrites=false;}assert.equal(memory.get(storage.STORAGE_KEY_V5),before);
  const changed=storage.loadStorageV5();changed.semesterData.academicCalendar[0].value.calendar.updatedAt='new-calendar';storage.saveStorageV5(changed);const latest=memory.get(storage.STORAGE_KEY_V5);
  assert.throws(()=>storage.saveUnitExecutionPlanV5('y',r.result.candidate,{draft:r.draft,calendarGeneration:r.result}),/berubah/);assert.equal(memory.get(storage.STORAGE_KEY_V5),latest);
});
async function calendarGenerationUIAndRoute() {
  const r=review(fixture([1,2],[2,1])),savedBefore=memory.get(storage.STORAGE_KEY_V5);let sent:any,calls=0;
  const props:any={mapping:r.source.mapping,unitExecutionPlan:r.draft,atp:r.source.context.atp,tp:r.source.context.tp,meetingCapacity:r.source.capacity,__generate:async(params:any)=>{sent=params;return {units:params.unitMeetingTargets.map((target:any)=>{const unit=r.source.mapping.units.find(u=>u.id===target.unitId)!;return{unitId:unit.id,meetings:Array.from({length:target.newTargetCount},()=>({title:unit.title,materialIds:unit.materials.map(m=>m.id),linkedAtpItemIds:unit.linkedAtpItemIds,linkedTpIds:unit.linkedTpIds,plannedJP:99}))};})};},onSave:(next:UnitExecutionPlanData,approval:any)=>{calls++;storage.saveUnitExecutionPlanV5('y',next,approval);props.unitExecutionPlan=next;return true;}};
  const h=ui(props);h.button('Kosongkan Draf Pertemuan').props.onClick();assert.equal(memory.get(storage.STORAGE_KEY_V5),savedBefore);await h.button('Regenerate sesuai Slot Aktual').props.onClick();assert.equal(sent.calendarSlots.confirmed,true);assert.equal(calls,0);assert.equal(memory.get(storage.STORAGE_KEY_V5),savedBefore);
  h.button('Batal Regenerate').props.onClick();assert.equal(calls,0);await h.button('Regenerate sesuai Slot Aktual').props.onClick();h.button('Setujui & Simpan Hasil Generate').props.onClick();assert.equal(calls,1);
  assert.deepEqual(storage.getUnitExecutionPlanV5('y')!.units.map(u=>u.meetings.length),[2,1]);assert.deepEqual(storage.getUnitExecutionPlanV5('y')!.units[0].meetings[0].alignmentMerge!.sources,r.draft.units[0].meetings);console.log('PASS real Regenerate UI sends actual slots, cancellation preserves data, approval saves exact counts with pre-clear provenance');passed++;
  const server=readFileSync('server.ts','utf8'),start=server.indexOf("app.post('/api/ai/generate-unit-meetings'"),end=server.indexOf('\napp.post(',start+10);let handler:any;
  runInNewContext(ts.transpileModule(server.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{console,app:{post:(_p:string,f:any)=>handler=f},assertMeetingSourceLineage,MeetingCoverageError,validateUnitExecutionPlan:execution.validateUnitExecutionPlan,validateCalendarMeetingSlots:allocation.validateCalendarMeetingSlots});
  const body:any=sent;body.unitMeetingTargets[0].newTargetCount--;
  let status=200,payload:any;const res:any={status:(n:number)=>{status=n;return res;},json:(v:any)=>{payload=v;return res;}};
  await handler({body},res);assert.equal(status,400);assert.equal(payload.code,'UNIT_TARGET_INVALID');
  body.calendarSlots.confirmed=false;await handler({body},res);assert.equal(status,400);assert.equal(payload.code,'CALENDAR_SLOTS_INVALID');
  console.log('PASS real final-mode backend rejects underfilled targets and unconfirmed calendars before provider call');passed++;
}

function ui(props:any) {
  const values:any[]=[];let cursor=0;
  const source=readFileSync('src/components/UnitExecutionPlanManager.tsx','utf8');
  const compiled=ts.transpileModule(source.slice(source.indexOf('function generateStableId')), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText;
  const exports:any={};
  runInNewContext(compiled,{exports,React,console,window:{confirm:props.__confirm || (()=>true)},crypto:{randomUUID:newId},structuredClone,JSON,Date,Math,...icons,...alignment,...execution,...placement,...allocation,...storage,Map,Set,requestMeetingOptimizationAI:props.__optimization || (async()=>{throw new Error('AI unavailable');}),
    useMemo:(factory:()=>any)=>factory(),useEffect:()=>{},useRef:(initial:any)=>{const i=cursor++;if(!(i in values))values[i]={current:initial};return values[i];},useState:(initial:any)=>{const i=cursor++;if(!(i in values)) values[i]=typeof initial==='function'?initial():initial;return [values[i],(next:any)=>{values[i]=typeof next==='function'?next(values[i]):next;}];},
    recordDiagnosticEvent:props.__recordEvent || (()=>{}),buildUnitExecutionPlanAIDiagnosticReport,navigator:{clipboard:{writeText:async(report:string)=>props.__copyReport?.(report)}},setTimeout:()=>{},AIMeetingGenerationError:class extends Error{},generateUnitMeetingsWithAI:props.__generate || (()=>{throw new Error('AI should not be called');}),
  });
  const walk=(e:any):any[]=>!React.isValidElement(e)?[]:[e,...React.Children.toArray((e.props as any).children).flatMap(walk)];
  const nodes=()=>{cursor=0;return walk(exports.UnitExecutionPlanManager(props));};
  const button=(label:string)=>nodes().find(n=>n.type==='button' && React.Children.toArray(n.props.children).join('')===label);
  return {nodes,button};
}
test('clear draft requires confirmation, preserves storage, restores content and refuses protected references',()=>{
  for(const mode of ['cancel','clear','protected']){
    const state=fixture([2,1],[2,1]);if(mode==='protected')state.semesterData.journalRealizations=[{semesterPlanId:'sp1',value:[{semesterPlanId:'sp1',meetingId:'m0-0',outcome:'Keep',updatedAt:'2026-11-05'}]}];
    const r=review(state);let calls=0;
    const h=ui({mapping:r.source.mapping,unitExecutionPlan:r.draft,atp:r.source.context.atp,tp:r.source.context.tp,meetingCapacity:r.source.capacity,__confirm:()=>mode!=='cancel',onSave:()=>{calls++;return true;}}),before=memory.get(storage.STORAGE_KEY_V5);
    h.button('Kosongkan Draf Pertemuan').props.onClick();
    assert.equal(memory.get(storage.STORAGE_KEY_V5),before);assert.equal(calls,0);
    if(mode==='clear'){
      assert.ok(h.button('Pulihkan Draf Pertemuan'));
      h.nodes().find(n=>n.type==='button' && React.Children.toArray(n.props.children).some((child:any)=>child?.props?.children==='Simpan Struktur Pertemuan'))!.props.onClick();assert.equal(calls,0);
      h.button('Pulihkan Draf Pertemuan').props.onClick();assert.ok(!h.button('Pulihkan Draf Pertemuan'));
    }else assert.ok(!h.button('Pulihkan Draf Pertemuan'));
  }
});
test('real UI cancel, teacher approval, optional additions and failed save',()=>{
  for(const mode of ['cancel','approve','fail','add']) {
    const r=review(fixture(mode==='add'?[1,1]:[2,1],mode==='add'?[2,2]:[1,1]));let calls=0;
    const props:any={mapping:r.source.mapping,unitExecutionPlan:r.draft,atp:r.source.context.atp,tp:r.source.context.tp,meetingCapacity:r.source.capacity,onSave:(next:UnitExecutionPlanData,approval:any)=>{calls++;if(mode==='fail')return false;storage.saveUnitExecutionPlanV5('y',next,approval);return true;}};
    const harness=ui(props), before=memory.get(storage.STORAGE_KEY_V5);
    harness.button('Tinjau Penyesuaian').props.onClick();assert.ok(harness.nodes().some(n=>n.props.role==='dialog'));
    if(mode==='cancel') {harness.button('Batal').props.onClick();assert.equal(calls,0);assert.equal(memory.get(storage.STORAGE_KEY_V5),before);assert.ok(!harness.nodes().some(n=>n.props.role==='dialog'));}
    else {
      if(mode==='add') {assert.equal(harness.button('Setujui & Terapkan').props.disabled,true);const check=harness.nodes().find(n=>n.type==='input'&&n.props.type==='checkbox');check.props.onChange({target:{checked:true}});}
      assert.equal(harness.button('Setujui & Terapkan').props.disabled,false);harness.button('Setujui & Terapkan').props.onClick();assert.equal(calls,1);
      if(mode==='fail') {assert.equal(memory.get(storage.STORAGE_KEY_V5),before);assert.ok(harness.nodes().some(n=>n.props.role==='dialog'));}
      else assert.notEqual(memory.get(storage.STORAGE_KEY_V5),before);
    }
  }
});
test('real UI rejects newly recorded attendance after preview without submitting',()=>{
  const r=review(fixture([2,1]));let calls=0;
  const h=ui({mapping:r.source.mapping,unitExecutionPlan:r.draft,atp:r.source.context.atp,tp:r.source.context.tp,meetingCapacity:r.source.capacity,onSave:()=>{calls++;return true;}});
  h.button('Tinjau Penyesuaian').props.onClick();const current=storage.loadStorageV5();current.semesterData.attendance=[{semesterPlanId:'sp1',value:{sessions:[{id:'att',academicSettingId:'sp1',date:'2026-08-03',meetingId:'m0-1',meetingNumber:2,createdAt:'2026-11-05'}],records:[]}}];storage.saveStorageV5(current);
  h.button('Setujui & Terapkan').props.onClick();assert.equal(calls,0);assert.ok(h.nodes().some(n=>n.type==='span'&&String(n.props.children).includes('berubah')));
});

async function backendZeroWork() {
  const r=review(fixture([1,1],[2,2]));
  const source=readFileSync('server.ts','utf8'), start=source.indexOf("app.post('/api/ai/generate-unit-meetings'");
  const end=source.indexOf('\napp.post(',start+10);let handler:any;
  const compiled=ts.transpileModule(source.slice(start,end>0?end:undefined),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  runInNewContext(compiled,{console,app:{post:(_path:string,h:any)=>{if(!handler)handler=h;}},assertMeetingSourceLineage,MeetingCoverageError,validateUnitExecutionPlan:execution.validateUnitExecutionPlan});
  const body={mapping:r.source.mapping,tpData:r.source.context.tp,atpData:r.source.context.atp,currentPlan:r.draft,capacityContext:{semester1LastUnitId:'u0',semester1:{targetMeetingCount:2},semester2:{targetMeetingCount:2}},unitMeetingTargets:r.draft.units.map((u,i)=>({unitId:u.unitId,semester:i+1,existingCount:1,newTargetCount:0}))};
  let status=200,response:any;const res:any={status:(n:number)=>{status=n;return res;},json:(data:any)=>{response=data;return res;}};
  await handler({body},res);assert.equal(status,200);assert.equal(response.engine,'no_work');assert.equal(response.data.units.length,0);
  body.unitMeetingTargets[0].newTargetCount=2;await handler({body},res);assert.equal(status,400);assert.equal(response.code,'UNIT_TARGET_INVALID');
  console.log('PASS real backend: approved targets below calendar ceiling; zero requested slots never call Gemini; excess rejected');passed++;
}

async function aiDraftHandlers() {
  const r=review(fixture([1,1])), draft:alignment.MeetingOptimizationDraft={sourceFingerprint:alignment.optimizationFingerprint(r.draft,r.source.mapping,r.source.context),reason:'Perjelas judul tanpa mengurangi substansi/JP',edits:[{id:'m0-0',title:'Kegiatan 1 — penjelasan konteks'}]};
  let calls=0;const optimizationEvents:any[]=[];const props:any={__recordEvent:(event:any)=>optimizationEvents.push(event),mapping:r.source.mapping,unitExecutionPlan:r.draft,atp:r.source.context.atp,tp:r.source.context.tp,meetingCapacity:r.source.capacity,__optimization:async()=>draft,onSave:(next:UnitExecutionPlanData,approval:any)=>{calls++;storage.saveUnitExecutionPlanV5('y',next,approval);return true;}};
  const h=ui(props),before=memory.get(storage.STORAGE_KEY_V5);h.button('Tinjau Penyesuaian').props.onClick();
  await h.button('Usulkan Optimalisasi dengan AI').props.onClick();assert.deepEqual(optimizationEvents.map(e=>e.action),['AI_OPTIMIZATION_REQUEST','AI_OPTIMIZATION_DRAFT_READY']);assert.equal(calls,0);assert.equal(memory.get(storage.STORAGE_KEY_V5),before);
  assert.equal(h.button('Setujui & Terapkan').props.disabled,false);h.button('Setujui & Terapkan').props.onClick();assert.equal(calls,1);
  const saved=storage.getUnitExecutionPlanV5('y')!;assert.equal(saved.units[0].meetings[0].title,draft.edits[0].title);assert.deepEqual(saved.units[0].meetings[0].alignmentMerge!.sources[0],r.draft.units[0].meetings[0]);
  props.unitExecutionPlan=saved;assert.ok(!h.nodes().some(n=>n.props.role==='dialog'));assert.ok(!h.nodes().some(n=>n.type==='p' && React.Children.toArray(n.props.children).join('').includes('Konflik')));
  console.log('PASS actual UI: AI result remains draft until explicit teacher approval');passed++;
  const fresh=review(fixture([1,1]));let release:(value:any)=>void=()=>{};
  const pending=ui({...props,mapping:fresh.source.mapping,unitExecutionPlan:fresh.draft,__optimization:()=>new Promise(resolve=>{release=resolve;})});pending.button('Tinjau Penyesuaian').props.onClick();
  const request=pending.button('Usulkan Optimalisasi dengan AI').props.onClick();pending.button('Batal').props.onClick();release(draft);await request;
  assert.ok(!pending.nodes().some(n=>n.props.role==='dialog'));assert.ok(optimizationEvents.some(e=>e.action==='AI_OPTIMIZATION_CANCELLED'));console.log('PASS actual UI: cancel discards a late AI result');passed++;
  const source=readFileSync('server.ts','utf8'),start=source.indexOf("app.post('/api/ai/recommend-meeting-reconciliation'"),end=source.indexOf('\napp.post(',start+10);let handler:any,modelResult:any={reason:'Judul diperjelas',edits:[{id:'m0-0',title:'Kegiatan 1 — konteks AI'}]};
  const compiled=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  runInNewContext(compiled,{console,app:{post:(_path:string,value:any)=>handler=value},validateUnitExecutionPlan:execution.validateUnitExecutionPlan,...alignment,resolveApiKey:()=> 'mock-key',createAIClient:()=>({}),generateContentWithRetry:async()=>({text:JSON.stringify(modelResult)})});
  let status=200,response:any;const res:any={status:(n:number)=>{status=n;return res;},json:(value:any)=>{response=value;return res;}};
  const body={mode:'OPTIMIZE',plan:fresh.draft,mapping:fresh.source.mapping,context:fresh.source.context},rawBefore=memory.get(storage.STORAGE_KEY_V5);
  await handler({body},res);assert.equal(status,200);assert.ok(response.draft);assert.equal(memory.get(storage.STORAGE_KEY_V5),rawBefore);
  modelResult.edits=[{id:'invented',plannedJP:99}];await handler({body},res);assert.equal(status,422);assert.equal(response.code,'AI_OPTIMIZATION_INVALID');assert.equal(memory.get(storage.STORAGE_KEY_V5),rawBefore);
  console.log('PASS actual optimization route with mocked provider: canonical draft accepted, invented ID/JP rejected, storage unchanged');passed++;
}



test('diagnostic reports current capacity instead of an old AI snapshot, with actual optimization blockers',()=>{
  const state=fixture([1,2],[1,1]);delete state.annualData.unitExecutionPlans![0].value.units[1].meetings[0].plannedJP;
  const r=review(state),report=buildUnitExecutionPlanAIDiagnosticReport({mapping:r.source.mapping,unitExecutionPlan:r.draft,capacityContext:r.source.capacity,
    validation:execution.validateUnitExecutionPlan(r.draft,r.source.mapping,r.source.context.atp,r.source.context.tp),alignmentProposal:r.proposal,isGeneratingMeetings:false,isOptimizing:false,
    lastAIDiagnostic:{capacity:{semester1:{target:99,existing:99,requestedNew:0},semester2:{target:88,existing:88,requestedNew:0}}}});
  assert.ok(report.includes('S2 target=1 existing=2 requestedNew=0'));assert.ok(!report.includes('S2 target=88'));
  assert.ok(report.includes('withinCapacity: false'));assert.ok(report.includes('isComplete: true'));assert.ok(report.includes('missing=[m1-0]'));
  assert.ok(report.includes('kebutuhan JP pertemuan belum diketahui'));assert.ok(report.includes('slotStatus: CONFLICT'));assert.ok(report.includes('generationInProgress: false'));
  const without=buildUnitExecutionPlanAIDiagnosticReport({mapping:r.source.mapping,unitExecutionPlan:r.draft,capacityContext:r.source.capacity});
  assert.ok(without.includes('meetingStatus: NOT_EVALUATED'));assert.ok(without.includes('this report cannot establish optimization feasibility'));
});
async function generationPreflightTelemetry() {
  const r=review(fixture([1,2],[1,1])),events:any[]=[];let copied='';
  const props:any={mapping:r.source.mapping,unitExecutionPlan:r.draft,atp:r.source.context.atp,tp:r.source.context.tp,meetingCapacity:r.source.capacity,onSave:()=>true,__recordEvent:(event:any)=>events.push(event),__copyReport:(report:string)=>{copied=report;}};
  const h=ui(props);const button=h.nodes().find(n=>n.type==='button' && n.props.onClick?.name==='handleGenerateWithAI');assert.ok(button);
  await button.props.onClick();assert.deepEqual(events.map(e=>e.action),['AI_GENERATION_REQUEST','AI_GENERATION_BLOCKED']);assert.equal(events[1].metadata.code,'CAPACITY_CONFLICT');
  await h.nodes().find(n=>n.type==='button' && n.props.onClick?.name==='handleCopyDiagnostic').props.onClick();
  assert.ok(copied.includes('code: CAPACITY_CONFLICT'));assert.ok(copied.includes('stage: CAPACITY_CHECK'));assert.ok(copied.includes('generationInProgress: false'));assert.ok(copied.includes('Proposed Distribution:'));
  console.log('PASS real generation preflight logs CAPACITY_CONFLICT terminal state without calling Gemini');passed++;
}

async function optimizedImportRoundtrip() {
  const state=fixture([3,1]);mixedPattern(state);const meetings=state.annualData.unitExecutionPlans![0].value.units[0].meetings;
  meetings.forEach(m=>activities(m,[1]));const r=review(state),next=r.apply();storage.saveUnitExecutionPlanV5('y',next,{draft:r.draft,proposal:r.proposal});
  const zipped=await readCompleteProjectZip(await createCompleteProjectZip(storage.loadStorageV5(),'y'));
  const result=importCompleteAdministrationProject(zipped,{mode:'CONTINUE_EDITING',targetProfileId:'p2',targetSchoolId:'s2',documentDate:'2026-11-05'});
  const imported=storage.getUnitExecutionPlanV5(result.yearPlanId)!;
  assert.deepEqual(imported.units.map(u=>u.meetings.map(m=>m.plannedJP)),next.units.map(u=>u.meetings.map(m=>m.plannedJP)));
  assert.ok(imported.units.flatMap(u=>u.meetings).some(m=>m.alignmentMerge?.sources.length));
  assert.ok(imported.units.flatMap(u=>u.meetings).every(m=>(m.activities || []).every(a=>a.learningMeetingId===m.id)));
  console.log('PASS actual optimized-plan ZIP import/export: planned JP, source provenance and remapped activity/meeting IDs retained');passed++;
}

await calendarGenerationUIAndRoute();
await generationPreflightTelemetry();
await optimizedImportRoundtrip();
await backendZeroWork();
await aiDraftHandlers();
console.log(`PASS ${passed} calendar-driven alignment scenarios.`);
