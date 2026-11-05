import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { annualPlanningManagerHarness } from './fixtures/annualPlanningManagerHarness';
import { createTwoSemesterAdministrationImportFixture } from './fixtures/readyAdministrationImportFixture';
import { loadStorageV5, saveStorageV5, STORAGE_KEY_V5, reviewAnnualJPReferenceV5, getSemesterDataV5, saveSubjectWeeklyScheduleV5, saveLearningMeetingScheduleV5, serializeBackupV5, parseBackupV5 } from '../src/services/storageV5';
import { getSubjectJP, resolveSemesterCapacityV5 } from '../src/services/jpEngine';
import { resolvePlannedMeetingCapacity, resolveEffectiveSubjectSlots, isActualPlannedCapacityReady } from '../src/services/subjectScheduleService';
import { buildLearningMeetingScheduleData, resolveLearningMeetingSchedule } from '../src/services/learningMeetingScheduleService';
import { assessAnnualJP, compareAnnualJPReference, sumSemesterAllocatedJP } from '../src/services/annualJPAssessment';
import { validateWorkflowDependencies } from '../src/services/workflowEngine';
import { exportCompleteAdministrationProjectFromState } from '../src/services/administrationProjectExportService';
import { createCompleteProjectZip, readCompleteProjectZip } from '../src/services/completeProjectZipService';
import { importCompleteAdministrationProject } from '../src/services/administrationProjectImportService';

const memory = new Map<string,string>(); let writes=0;
(globalThis as any).localStorage={getItem:(k:string)=>memory.get(k)??null,setItem:(k:string,v:string)=>{writes++;memory.set(k,v);},removeItem:(k:string)=>memory.delete(k)};
const stamp='2026-01-01T00:00:00Z';
function setup(pattern=[3]) {
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
    const first=sp.semester===1?'2026-08-03':'2027-01-04';
    cal.calendar.startDate=first;
    cal.calendar.endDate=first.slice(0,-2)+String(Number(first.slice(-2))+4).padStart(2,'0');
    cal.calendar.updatedAt=stamp;
    cal.days=Array.from({length:5},(_,i)=>({id:`${sp.id}-${i}`,academicCalendarId:cal.calendar.id,date:first.slice(0,-2)+String(Number(first.slice(-2))+i).padStart(2,'0'),status:'EFFECTIVE_LEARNING' as const}));
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
function view(next=()=>{},yearPlanId='y') {
  const state=loadStorageV5(),year=state.yearPlans.find(y=>y.id===yearPlanId)!;
  const academic:any={id:'y',profileId:year.profileId,curriculum:'Kurikulum Merdeka',...year,semester:''};
  return annualPlanningManagerHarness({school:state.schools.find(s=>s.id===year.schoolId),profile:state.profiles.find(p=>p.id===year.profileId),academicSetting:academic,yearPlan:year,semesterPlans:state.semesterPlans.filter(s=>s.yearPlanId===yearPlanId),
    mapping:state.annualData.atpUnitMappings!.find(e=>e.yearPlanId===yearPlanId)!.value,unitExecutionPlan:state.annualData.unitExecutionPlans!.find(e=>e.yearPlanId===yearPlanId)!.value,tp:state.annualData.tp.find(e=>e.yearPlanId===yearPlanId)!.value,atp:state.annualData.atp.find(e=>e.yearPlanId===yearPlanId)!.value,
    onSaveCalendar:()=>true,onSaveTimeAllocations:()=>true,onSaveUnitExecutionPlan:()=>true,onNextStep:next,onBackToMapping:()=>{},
    onReviewAnnualJPReference:(id:string)=>{reviewAnnualJPReferenceV5(id);return true;}});
}
function workflow(yearPlanId='y') {
 const state=loadStorageV5(),y=state.yearPlans.find(y=>y.id===yearPlanId)!;
 return validateWorkflowDependencies({profile:state.profiles.find(p=>p.id===y.profileId),school:state.schools.find(s=>s.id===y.schoolId),academicSetting:{...y,curriculum:'Kurikulum Merdeka',semester:''} as any,
 cp:state.annualData.cp.find(e=>e.yearPlanId===yearPlanId)!.value,cpAnalysis:state.annualData.cpAnalysis.find(e=>e.yearPlanId===yearPlanId)!.value,tp:state.annualData.tp.find(e=>e.yearPlanId===yearPlanId)!.value,atp:state.annualData.atp.find(e=>e.yearPlanId===yearPlanId)!.value,atpUnitMapping:state.annualData.atpUnitMappings!.find(e=>e.yearPlanId===yearPlanId)!.value,unitExecutionPlan:state.annualData.unitExecutionPlans!.find(e=>e.yearPlanId===yearPlanId)!.value});
}
function finalButton(h:ReturnType<typeof view>) {
 const rail=h.nodes().find(n=>n.type==='task-rail');assert(rail,'Step 08 actual component must render');
 rail.props.onSelectTask('time-allocation');
 const button=h.nodes().find(n=>n.props.id==='finalize-step08');assert(button,'final CTA must be reachable');return button;
}
let state=setup();let advances=0;let h=view(()=>advances++);
const initialWrites=writes;h.nodes();assert.equal(writes,initialWrites,'render never repairs data');
assert.equal(workflow().stepStates['annual-planning'].isComplete,true,JSON.stringify(workflow().stepStates));
const html=renderToStaticMarkup(h.nodes()[0]);
for(const label of ['VERIFIED','JP rencana/teralokasi','Kapasitas JP aktual','144','108','Selisih acuan','Kekurangan kapasitas'])assert(html.includes(label),label);
let button=finalButton(h);assert.equal(button.props.disabled,false);button.props.onClick();assert.equal(advances,1,'actual rendered final CTA executes');
const beforeReview=loadStorageV5();h.nodes().find(n=>n.props.id==='review-annual-jp-reference').props.onClick();
state=loadStorageV5();assert.equal(state.annualJPReferences[0].value.officialAnnualJP,108);
const unchanged=structuredClone(state);unchanged.annualJPReferences=beforeReview.annualJPReferences;
assert.deepEqual(unchanged,beforeReview,'explicit review changes only AnnualJPReference');
assert.equal(state.annualJPReferences[0].value.referenceWeeklyEquivalentJP,3);
assert.equal(compareAnnualJPReference(state.annualJPReferences[0].value,{isOfficial:true,referenceAnnualJP:108}).needsReview,false);
assert.equal(finalButton(view()).props.disabled,false,'reload remains final-ready after annual review');

// ESTIMATE stays ready for preview and can be saved as a weekly-pattern draft, never finalized.
const actual=structuredClone(state);
const noDays=structuredClone(state.semesterData.subjectWeeklySchedules![0].value);noDays.sessions.forEach(s=>delete s.dayOfWeek);
saveSubjectWeeklyScheduleV5('sp1',noDays);
const preview=resolvePlannedMeetingCapacity({schedule:noDays,expectedWeeklyJP:3,calendarConfirmed:true,effectiveWeekSlots:1,schoolDaysPerWeek:5});
assert.equal(preview.isReady,true);assert.equal(preview.capacitySource,'ESTIMATE');assert.equal(isActualPlannedCapacityReady(preview),false);
assert.equal(workflow().stepStates['annual-planning'].isComplete,false);
assert.equal(workflow().stepStates.semester.isBlocked,true,'Step 09 cannot bypass unresolved final slots');
h=view(()=>advances++);button=finalButton(h);assert.equal(button.props.disabled,true);button.props.onClick();assert.equal(advances,1,'programmatic click cannot bypass gate');
assert(renderToStaticMarkup(h.nodes()[0]).includes('Kapasitas JP aktual: UNRESOLVED'));
assert.deepEqual(loadStorageV5().semesterData.learningMeetingSchedules,actual.semesterData.learningMeetingSchedules,'draft saves do not erase saved schedules');
saveSubjectWeeklyScheduleV5('sp1',actual.semesterData.subjectWeeklySchedules![0].value);finalizeSchedules();
assert.equal(finalButton(view()).props.disabled,false,'ESTIMATE → ACTUAL_SLOTS');

// Calendar holidays and semesters remain independent; stale final schedule cannot be reused.
state=loadStorageV5();const second=JSON.stringify(getSemesterDataV5('sp2'));
state.semesterData.academicCalendar[0].value.days[1].status='HOLIDAY';saveStorageV5(state);
assert.equal(resolveSemesterCapacityV5('sp1',loadStorageV5()).availableJP,3,'off-slot holiday');
state.semesterData.academicCalendar[0].value.days[0].status='HOLIDAY';saveStorageV5(state);
assert.equal(resolveSemesterCapacityV5('sp1',loadStorageV5()).availableJP,0,'on-slot holiday');
assert.equal(JSON.stringify(getSemesterDataV5('sp2')),second);
assert.equal(workflow().stepStates['annual-planning'].isComplete,false);
const zeroCapacityHTML=renderToStaticMarkup(view().nodes()[0]);
assert(zeroCapacityHTML.includes('Kapasitas JP aktual: 3'),'known zero in S1 is capacity shortage, not unresolved');
assert(zeroCapacityHTML.includes('Kelebihan alokasi terhadap kapasitas.'));

// PAI legacy 3 JP must not become 2 JP just because the corrected master is 72/year.
state=setup([3]);Object.assign(state.yearPlans[0],{subject:'PAI',grade:'Kelas 7',phase:'D',level:'SMP'});saveStorageV5(state);
const paiBefore=loadStorageV5();reviewAnnualJPReferenceV5('y');
assert.equal(loadStorageV5().annualJPReferences[0].value.officialAnnualJP,72);
assert.equal(loadStorageV5().annualJPReferences[0].value.referenceWeeklyEquivalentJP,3);
assert.deepEqual(loadStorageV5().semesterJPSettings,paiBefore.semesterJPSettings);
assert.deepEqual(loadStorageV5().semesterData,paiBefore.semesterData);
assert.equal(resolveSemesterCapacityV5('sp1',loadStorageV5()).actualScheduledWeeklyJP,3);
assert.equal(finalButton(view()).props.disabled,false);

// Mathematics 5 = 3+2; finalization is independent of matching the annual reference.
state=setup([3,2]);state.yearPlans[0].subject='Matematika';state.yearPlans[0].grade='Kelas 3';state.yearPlans[0].phase='B';saveStorageV5(state);
assert.deepEqual(getSemesterDataV5('sp1').learningMeetingSchedule!.entries.map(e=>e.jp),[3,2]);
assert.equal(finalButton(view()).props.disabled,false);
const assessment=assessAnnualJP(getSubjectJP({curriculumType:'KURIKULUM_MERDEKA',level:'SD',grade:'3',subject:'Matematika',academicYear:'2026/2027'}),[1,2].map(semester=>({semester:semester as 1|2,capacityJP:resolveSemesterCapacityV5(`sp${semester}`,state).availableJP,allocatedJP:sumSemesterAllocatedJP(getSemesterDataV5(`sp${semester}`))})));
assert.equal(assessment.officialJP,180);assert.equal(assessment.capacityJP,10);assert.equal(assessment.referenceDifferenceJP,170);
assert.equal(assessment.capacityStatus,'BALANCED');

// Fractional annual equivalent is never converted to a session; explicit semester overrides survive review.
state=setup([2]);Object.assign(state.yearPlans[0],{subject:'Pendidikan Pancasila',grade:'Kelas 11',phase:'F',level:'SMA',academicYear:'2024/2025'});
state.annualJPReferences[0].value.referenceWeeklyEquivalentJP=1.5;saveStorageV5(state);
reviewAnnualJPReferenceV5('y');assert.equal(loadStorageV5().annualJPReferences[0].value.officialAnnualJP,54);
assert.equal(loadStorageV5().annualJPReferences[0].value.referenceWeeklyEquivalentJP,1.5);
assert.equal(finalButton(view()).props.disabled,false);
const fractional=loadStorageV5();fractional.semesterJPSettings=[];saveStorageV5(fractional);
assert.equal(resolveSemesterCapacityV5('sp1',loadStorageV5()).isReady,false);
saveStorageV5(state);reviewAnnualJPReferenceV5('y');

// V5 backup reload and actual project ZIP export/import preserve both semesters and explicit review.
const backup=parseBackupV5(serializeBackupV5(loadStorageV5()));saveStorageV5(backup);
assert.equal(finalButton(view()).props.disabled,false);
const archive=await readCompleteProjectZip(await createCompleteProjectZip(loadStorageV5(),'y'));
assert.deepEqual(archive.project.annualJPReferences,loadStorageV5().annualJPReferences);
assert.deepEqual(exportCompleteAdministrationProjectFromState(loadStorageV5(),'y').project.semesterJPSettings,loadStorageV5().semesterJPSettings);
const imported=importCompleteAdministrationProject(archive,{mode:'CONTINUE_EDITING',targetProfileId:'p2',targetSchoolId:'s2',documentDate:'2026-10-31'});
const importedState=loadStorageV5();
assert.equal(importedState.annualJPReferences.find(e=>e.yearPlanId===imported.yearPlanId)!.value.officialAnnualJP,54);
assert.equal(importedState.semesterPlans.filter(s=>s.yearPlanId===imported.yearPlanId).length,2);
assert.equal(importedState.semesterData.learningMeetingSchedules!.filter(e=>importedState.semesterPlans.some(s=>s.yearPlanId===imported.yearPlanId&&s.id===e.semesterPlanId)).length,2);
assert.equal(finalButton(view(()=>advances++,imported.yearPlanId)).props.disabled,false,'imported schedules remain final-ready after ID remapping');
assert.equal(workflow(imported.yearPlanId).stepStates['annual-planning'].isComplete,true);
assert.equal(workflow(imported.yearPlanId).stepStates.semester.isBlocked,false);
finalButton(view(()=>advances++,imported.yearPlanId)).props.onClick();assert.equal(advances,2);
// Unknown master cannot be promoted or changed by the review action.
state=loadStorageV5();state.yearPlans.find(y=>y.id==='y')!.subject='Mapel rekaan';saveStorageV5(state);
const beforeUnknown=memory.get(STORAGE_KEY_V5);assert.throws(()=>reviewAnnualJPReferenceV5('y'));assert.equal(memory.get(STORAGE_KEY_V5),beforeUnknown);
assert(renderToStaticMarkup(view().nodes()[0]).includes('UNVERIFIED'));
console.log('PASS Step 08 JP: actual component review/final handlers, estimate draft → actual final, holidays, independent semesters, fractional annual reference, V5 reload and real ZIP import/export.');
