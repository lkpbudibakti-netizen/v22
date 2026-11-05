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
  plan.units=mapping.units.map((u,i)=>({unitId:u.id,meetings:Array.from({length:counts[i]},(_,j)=>({id:`m${i}-${j}`,unitId:u.id,order:j+1,title:`Kegiatan ${j+1}`,materialIds:[`mat${i}`],linkedAtpItemIds:[`a${i}`],linkedTpIds:[`t${i}`]}))}));
  plan.semesterPlacement={mode:'CONTIGUOUS_BOUNDARY',semester1LastUnitId:'u0',updatedAt:plan.updatedAt};
  state.semesterData.learningPlan=[];state.semesterData.assessmentPlan=[];state.semesterData.assessmentPackage=[];
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
  const capacity={semester1:{isReady:true,targetMeetingCount:42},semester2:{isReady:true,targetMeetingCount:41}};
  const proposal=alignment.proposeMeetingAlignment(plan,mapping,capacity,source.context);
  assert.deepEqual(proposal.errors,[]);assert.deepEqual(proposal.rows.map(r=>r.proposed),[42,13,10,8,10]);
  const next=alignment.applyMeetingAlignment(plan,mapping,capacity,proposal,newId,source.context);
  assert.deepEqual(next.units.map(u=>u.unitId),plan.units.map(u=>u.unitId));assert.deepEqual(next.units[0],plan.units[0]);
});
test('unknown or excessive JP, incompatible scope, assessments and unknown content block merging',()=>{
  for(const mode of ['unknown','null','jp','scope','assessment','legacy']) {
    const state=fixture([2,1],[1,1],mode==='jp'?1:4), m=state.annualData.unitExecutionPlans![0].value.units[0].meetings[1];
    if(mode==='unknown') {delete state.annualData.atp[0].value.items[0].allocatedJP;delete state.annualData.atp[0].value.items[0].jp;state.annualData.atpUnitMappings![0].value.basedOnAtpFingerprint=computeAtpSubstantiveFingerprint(state.annualData.atp[0].value);}
    if(mode==='null') {state.annualData.atp[0].value.items[0].allocatedJP=null;state.annualData.atpUnitMappings![0].value.basedOnAtpFingerprint=computeAtpSubstantiveFingerprint(state.annualData.atp[0].value);}
    if(mode==='scope') m.linkedTpIds=['t1'];if(mode==='assessment') m.title='Asesmen sumatif';if(mode==='legacy') (m as any).manualNotes='Keep';
    const r=review(state);assert.ok(r.proposal.errors.length,mode);assert.throws(r.apply);assert.deepEqual(storage.getUnitExecutionPlanV5('y'),r.draft);
  }
});
test('accumulated merge workload is retained for future alignment',()=>{
  const r=review(fixture([3,1],[1,1],4));assert.deepEqual(r.proposal.errors,[]);const next=r.apply();
  assert.equal(next.units[0].meetings[0].alignmentMerge!.requiredJP,3);
  assert.equal(next.units[0].meetings[0].alignmentMerge!.sources[0].alignmentMerge!.requiredJP,2);
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

function ui(props:any) {
  const values:any[]=[];let cursor=0;
  const source=readFileSync('src/components/UnitExecutionPlanManager.tsx','utf8');
  const compiled=ts.transpileModule(source.slice(source.indexOf('function generateStableId')), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText;
  const exports:any={};
  runInNewContext(compiled,{exports,React,console,crypto:{randomUUID:newId},structuredClone,JSON,Date,Math,...icons,...alignment,...execution,...placement,...allocation,...storage,Map,Set,
    useMemo:(factory:()=>any)=>factory(),useEffect:()=>{},useState:(initial:any)=>{const i=cursor++;if(!(i in values)) values[i]=typeof initial==='function'?initial():initial;return [values[i],(next:any)=>{values[i]=typeof next==='function'?next(values[i]):next;}];},
    recordDiagnosticEvent:()=>{},setTimeout:()=>{},AIMeetingGenerationError:class extends Error{},generateUnitMeetingsWithAI:()=>{throw new Error('AI should not be called');},
  });
  const walk=(e:any):any[]=>!React.isValidElement(e)?[]:[e,...React.Children.toArray((e.props as any).children).flatMap(walk)];
  const nodes=()=>{cursor=0;return walk(exports.UnitExecutionPlanManager(props));};
  const button=(label:string)=>nodes().find(n=>n.type==='button' && React.Children.toArray(n.props.children).join('')===label);
  return {nodes,button};
}
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
await backendZeroWork();
console.log(`PASS ${passed} calendar-driven alignment scenarios.`);
