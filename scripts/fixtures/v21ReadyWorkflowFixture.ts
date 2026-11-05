import assert from 'node:assert/strict';
import type { DocumentGenerationContext } from '../../src/services/documentEngine/types';
import { resolveCalendarSubjectCapacity } from '../../src/services/jpEngine';
import { createTwoSemesterAdministrationImportFixture } from './readyAdministrationImportFixture';
import { loadStorageV5, saveStorageV5, STORAGE_KEY_V5, reviewAnnualJPReferenceV5, getSemesterDataV5, saveSubjectWeeklyScheduleV5, saveLearningMeetingScheduleV5, serializeBackupV5, parseBackupV5 } from '../../src/services/storageV5';
import { getSubjectJP, resolveSemesterCapacityV5 } from '../../src/services/jpEngine';
import { resolvePlannedMeetingCapacity, resolveEffectiveSubjectSlots, isActualPlannedCapacityReady } from '../../src/services/subjectScheduleService';
import { buildLearningMeetingScheduleData, resolveLearningMeetingSchedule } from '../../src/services/learningMeetingScheduleService';
import { assessAnnualJP, compareAnnualJPReference, sumSemesterAllocatedJP } from '../../src/services/annualJPAssessment';
const stamp='2026-01-01T00:00:00Z';
export function createReadyV21WorkflowFixture(pattern=[3],firstDates=['2026-08-03','2027-01-04']) {
  const state=createTwoSemesterAdministrationImportFixture();
  Object.assign(state,{activeYearPlanId:'y',activeProfileId:'p1',activeSchoolId:'s1',activeWorkspaceId:'w',activeSemesterPlanId:'sp1'});
  const mapping=state.annualData.atpUnitMappings![0].value;
  const plan=state.annualData.unitExecutionPlans![0].value;
  mapping.units.forEach((unit,i)=>{
    const tpId=i?'t-z':'t',atpId=i?'az':'a';
    unit.linkedTpIds=[tpId];unit.linkedAtpItemIds=[atpId];
    unit.materials[0].linkedTpIds=[tpId];unit.materials[0].linkedAtpItemIds=[atpId];
    plan.units[i].meetings=pattern.map((_,j)=>({...structuredClone(plan.units[i].meetings[0]),id:j?`meeting-${i}-${j}`:plan.units[i].meetings[0].id,order:j+1,linkedTpIds:[tpId],linkedAtpItemIds:[atpId],materialIds:[unit.materials[0].id]}));
  });
  const weekly=pattern.reduce((a,b)=>a+b,0);
  state.annualJPReferences=[{yearPlanId:'y',value:{officialAnnualJP:144,referenceWeeklyEquivalentJP:weekly,weeklyJPSource:'LEGACY_VALUE',regulationReference:'Ac uan lama'}}];
  for(const sp of state.semesterPlans) {
    const cal=state.semesterData.academicCalendar.find(e=>e.semesterPlanId===sp.id)!.value;
    const first=firstDates[sp.semester-1];
    const dateAt=(offset:number)=>{const date=new Date(first+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+offset);return date.toISOString().slice(0,10);};
    cal.calendar.startDate=first;
    cal.calendar.endDate=dateAt(4);
    cal.calendar.updatedAt=stamp;
    cal.days=Array.from({length:5},(_,i)=>({id:`${sp.id}-${i}`,academicCalendarId:cal.calendar.id,date:dateAt(i),status:'EFFECTIVE_LEARNING' as const}));
    state.semesterJPSettings.find(e=>e.semesterPlanId===sp.id)!.value={semesterPlanId:sp.id,actualScheduledWeeklyJP:weekly,source:'SEMESTER_OVERRIDE'};
    state.semesterData.subjectWeeklySchedules!.find(e=>e.semesterPlanId===sp.id)!.value={semesterPlanId:sp.id,basedOnWeeklyJP:weekly,updatedAt:stamp,sessions:pattern.map((jp,i)=>({id:`session-${i}`,jp,dayOfWeek:i?3:1,order:i+1}))};
  }
  saveStorageV5(state);
  finalizeSchedules();
  return loadStorageV5();
}
function finalizeSchedules() {
  const state=loadStorageV5();const mapping=state.annualData.atpUnitMappings![0].value,plan=state.annualData.unitExecutionPlans![0].value;
  for(const sp of state.semesterPlans.filter(s=>s.yearPlanId==='y')) {
    const data=getSemesterDataV5(sp.id),calendar=data.academicCalendar!.calendar,days=data.academicCalendar!.days,schedule=data.subjectWeeklySchedule!,weekly=resolveSemesterCapacityV5(sp.id,state).actualScheduledWeeklyJP!;
    const slots=resolveEffectiveSubjectSlots({semesterPlanId:sp.id,calendar,calendarDays:days,schedule,expectedWeeklyJP:weekly});
    const auto=resolveLearningMeetingSchedule({semesterPlanId:sp.id,semester:sp.semester,mapping,unitExecutionPlan:plan,subjectSlotResult:slots});
    assert(auto.isReady,auto.errors.join(';'));
    saveLearningMeetingScheduleV5(sp.id,buildLearningMeetingScheduleData({semesterPlanId:sp.id,semester:sp.semester,mapping,unitExecutionPlan:plan,calendar,subjectWeeklySchedule:schedule,expectedWeeklyJP:weekly,autoResult:auto,manualOverrides:[]}));
  }
}
export function v21DocumentContext(state:ReturnType<typeof createReadyV21WorkflowFixture>,semester:1|2=1):DocumentGenerationContext {
  const plan=state.semesterPlans.find(s=>s.yearPlanId==='y'&&s.semester===semester)!;
  const annual=(key:string)=>(state.annualData as any)[key].find((row:any)=>row.yearPlanId==='y')?.value;
  const data=getSemesterDataV5(plan.id),year=state.yearPlans.find(y=>y.id==='y')!;
  return {school:state.schools[0],profile:state.profiles[0],academicSetting:{...year,id:plan.id,phase:year.phase||'A',curriculum:'Kurikulum Merdeka',semester:semester===1?'1 (Ganjil)':'2 (Genap)'},
    cp:annual('cp'),tp:annual('tp'),atp:annual('atp'),atpUnitMapping:annual('atpUnitMappings'),unitExecutionPlan:annual('unitExecutionPlans'),
    learningMeetingSchedules:state.semesterPlans.filter(s=>s.yearPlanId==='y').map(s=>({semesterPlanId:s.id,semester:s.semester,schedule:state.semesterData.learningMeetingSchedules!.find(row=>row.semesterPlanId===s.id)!.value})),
    calendar:data.academicCalendar?.calendar,calendarDays:data.academicCalendar?.days,subjectWeeklySchedule:data.subjectWeeklySchedule,semesterJPSetting:state.semesterJPSettings.find(row=>row.semesterPlanId===plan.id)?.value,
    timeAllocations:data.timeAllocation,annualJPReference:state.annualJPReferences?.[0]?.value,
    protaSemesterAllocations:state.semesterPlans.filter(s=>s.yearPlanId==='y').map(s=>{
      const d=getSemesterDataV5(s.id),weekly=state.semesterJPSettings.find(row=>row.semesterPlanId===s.id)!.value.actualScheduledWeeklyJP;
      return {semesterPlanId:s.id,semester:s.semester,allocations:d.timeAllocation||[],capacityJP:resolveCalendarSubjectCapacity({semesterPlanId:s.id,calendar:d.academicCalendar!.calendar,calendarDays:d.academicCalendar!.days,weeklyJP:weekly,schedule:d.subjectWeeklySchedule}).availableJP};
    }),documentMode:'data',documentDate:'2026-08-03',skipDownload:true};
}
