import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  createInitialStorageV5,
  loadStorageV5,
  saveStorageV5,
  resetStorageV5,
  createProfileV5,
  createSchoolV5,
  createYearHierarchyV5,
  setActiveYearPlanV5,
  setActiveSemesterPlanV5,
  saveCPV5,
  saveCPAnalysisV5,
  saveTPV5,
  saveATPV5,
  STORAGE_KEY_V5,
} from '../src/services/storageV5';
import { getRuntimeContextV5 } from '../src/services/runtimeV5';
import { CPData, CPAnalysisData, TPData, ATPData, WorkflowStepId } from '../src/types';
import React from 'react';
import { WorkflowStepper } from '../src/components/WorkflowStepper';
import { SemesterSelector } from '../src/components/SemesterSelector';
import { validateWorkflowDependencies } from '../src/services/workflowEngine';
import { resolveATPUnitMappingReadiness } from '../src/services/atpMappingReadinessService';
import { isK13 } from '../src/services/curriculumRouter';
import { createReadyV21WorkflowFixture } from './fixtures/v21ReadyWorkflowFixture';
import { appCallback, jsxCallback, byId, nodeText, nodes } from './helpers/uiContractHarness';

console.log('=== RUNNING AUDIT: MERDEKA V5 SEMESTER NAVIGATION (B.3A) ===\n');

let totalTests = 0;
let passedTests = 0;

function runTest(name: string, fn: () => void) {
  totalTests++;
  try {
    fn();
    console.log(`[PASS] ${totalTests}. ${name}`);
    passedTests++;
  } catch (err: any) {
    console.error(`[FAIL] ${totalTests}. ${name}:`, err.message);
    throw err;
  }
}

// Mock localStorage in Node environment
class MockLocalStorage {
  private store: Map<string, string> = new Map();
  public readCount = 0;
  public writeCount = 0;

  getItem(key: string): string | null {
    this.readCount++;
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.writeCount++;
    this.store.set(key, String(value));
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
    this.readCount = 0;
    this.writeCount = 0;
  }

  get length(): number {
    return this.store.size;
  }

  key(index: number): string | null {
    const keys = Array.from(this.store.keys());
    return keys[index] || null;
  }
}

const mockStorage = new MockLocalStorage();
(globalThis as any).localStorage = mockStorage;

const V3_STORAGE_KEY = 'administrasi_guru_ai_storage_v3';

// Setup immutable V3 sentinel
const v3Sentinel = JSON.stringify({
  marker: 'V3_SENTINEL_IMMUTABLE_SEMESTER_NAV_TEST',
  checksum: 'semester-v5-sentinel-777',
  timestamp: 1719000000000,
  workspaces: [{ id: 'legacy-w1', academicSettingId: 'as-1' }],
});
mockStorage.setItem(V3_STORAGE_KEY, v3Sentinel);

// Initialize fresh V5 state
resetStorageV5();

const testSchool = createSchoolV5({
  name: 'SD Negeri Sukamaju 04',
  npsn: '20262004',
  address: 'Jl. Merdeka No. 14',
  village: 'Sukamaju',
  district: 'Pintar',
  regency: 'Kota Mandiri',
  province: 'Jawa Tengah',
  principalName: 'Sri Wahyuni, M.Pd.',
  principalNip: '197508122000032001',
});

const testProfile = createProfileV5({
  name: 'Guru IPAS Berprestasi',
  nip: '198703152012011002',
  status: 'PNS',
  defaultSubject: 'Ilmu Pengetahuan Alam dan Sosial (IPAS)',
  defaultLevel: 'SD',
  schoolId: testSchool.id,
});

const hierarchyA = createYearHierarchyV5({
  profileId: testProfile.id,
  schoolId: testSchool.id,
  academicYear: '2026/2027',
  curriculumType: 'KURIKULUM_MERDEKA',
  level: 'SD',
  grade: 'Kelas 4',
  subject: 'Ilmu Pengetahuan Alam dan Sosial (IPAS)',
  phase: 'B',
  workspaceName: 'IPAS — Kelas 4 — 2026/2027',
});
const yearPlanA = hierarchyA.yearPlan;
const semesterPlansA = hierarchyA.semesterPlans;
const semester1A = semesterPlansA.find((s) => s.semester === 1)!;
const semester2A = semesterPlansA.find((s) => s.semester === 2)!;

const hierarchyB = createYearHierarchyV5({
  profileId: testProfile.id,
  schoolId: testSchool.id,
  academicYear: '2027/2028',
  curriculumType: 'KURIKULUM_MERDEKA',
  level: 'SD',
  grade: 'Kelas 5',
  subject: 'Ilmu Pengetahuan Alam dan Sosial (IPAS)',
  phase: 'C',
  workspaceName: 'IPAS — Kelas 5 — 2027/2028',
});
const yearPlanB = hierarchyB.yearPlan;
const semesterPlansB = hierarchyB.semesterPlans;

// Setup Annual CP, CP Analysis, TP, ATP for YearPlan A
const cpA: CPData = {
  id: `cp-${yearPlanA.id}`,
  academicSettingId: yearPlanA.id,
  generalDescription: 'Capaian Pembelajaran IPAS Kelas 4',
  elements: [{ id: 'elem-1', name: 'Pemahaman IPAS', content: 'Memahami ekosistem sekitar.' }],
  updatedAt: '2026-02-10T08:00:00.000Z',
};
saveCPV5(yearPlanA.id, cpA);

const analysisA: CPAnalysisData = {
  id: `cpanalysis-${yearPlanA.id}`,
  academicSettingId: yearPlanA.id,
  cpId: cpA.id,
  generalSummary: 'Analisis IPAS',
  basedOnCpUpdatedAt: cpA.updatedAt,
  items: [
    {
      id: 'ana-1',
      elementId: 'elem-1',
      elementName: 'Pemahaman IPAS',
      cpText: 'Memahami ekosistem sekitar.',
      cpCompetence: 'Memahami',
      materialScope: 'Ekosistem',
      order: 1,
    },
  ],
  updatedAt: '2026-02-10T09:00:00.000Z',
};
saveCPAnalysisV5(yearPlanA.id, analysisA);

const tpA: TPData = {
  id: `tp-${yearPlanA.id}`,
  academicSettingId: yearPlanA.id,
  cpId: cpA.id,
  cpAnalysisId: analysisA.id,
  academicYear: '2026/2027',
  subjectCode: 'IPAS',
  phase: 'B',
  items: [
    {
      id: 'tp-item-1',
      code: 'TP 4.1',
      statement: 'Menganalisis hubungan antarmakhluk hidup dalam ekosistem.',
      competence: 'Menganalisis',
      contentScope: 'Ekosistem',
      order: 1,
    },
  ],
  workflowStatus: 'SIAP',
  generatedBy: 'TEACHER',
  needsReview: false,
  basedOnCpUpdatedAt: cpA.updatedAt,
  basedOnAnalysisUpdatedAt: analysisA.updatedAt,
  updatedAt: '2026-02-10T10:00:00.000Z',
};
saveTPV5(yearPlanA.id, tpA);

const atpA: ATPData = {
  id: `atp-${yearPlanA.id}`,
  academicSettingId: yearPlanA.id,
  tpId: tpA.id,
  tpDataId: tpA.id,
  academicYear: '2026/2027',
  subjectCode: 'IPAS',
  phase: 'B',
  rationale: 'Alur disusun mulai dari pengamatan lingkungan.',
  items: [
    {
      id: 'atp-item-1',
      stepNumber: 1,
      tpId: 'tp-item-1',
      tpCode: 'TP 4.1',
      tpStatement: 'Menganalisis hubungan antarmakhluk hidup dalam ekosistem.',
      materialScope: 'Ekosistem',
      p3Dimensions: ['Bernalar Kritis'],
    },
  ],
  totalJP: 0,
  knownTotalJP: 0,
  hasUnknownJP: true,
  allocationComplete: false,
  workflowStatus: 'SIAP',
  generatedBy: 'TEACHER',
  needsReview: false,
  basedOnTpUpdatedAt: tpA.updatedAt,
  updatedAt: '2026-02-10T11:00:00.000Z',
};
saveATPV5(yearPlanA.id, atpA);

setActiveYearPlanV5(yearPlanA.id);

// Runtime authority, isolation and legacy data preservation (no source-text assertions).
runTest('Fresh annual context never auto-selects Semester 1',()=>{
  assert.equal(getRuntimeContextV5().activeSemesterPlan,undefined);
  assert.equal(getRuntimeContextV5().semesterPlansForActiveYear.length,2);
});
const annualBefore=JSON.stringify(getRuntimeContextV5().annualData);
for(const semester of [semester1A,semester2A])runTest('Storage selects actual semester '+semester.semester,()=>{
  setActiveSemesterPlanV5(semester.id);assert.equal(getRuntimeContextV5().activeSemesterPlan?.id,semester.id);
  assert.equal(JSON.stringify(getRuntimeContextV5().annualData),annualBefore);
});
runTest('Switching YearPlan clears incompatible semester and retains V3 sentinel',()=>{
  setActiveYearPlanV5(yearPlanB.id);assert.equal(getRuntimeContextV5().activeSemesterPlan,undefined);
  assert.equal(mockStorage.getItem(V3_STORAGE_KEY),v3Sentinel);
});

const ready=createReadyV21WorkflowFixture();
ready.activeProfileId=ready.profiles[0].id;ready.activeYearPlanId=ready.yearPlans[0].id;ready.activeWorkspaceId=ready.workspaces[0].id;ready.activeSemesterPlanId=undefined;
function context(state=ready) {
  const annual=(key:string)=>(state.annualData as any)[key][0]?.value;
  return {profile:state.profiles[0],school:state.schools[0],academicSetting:{...state.yearPlans[0],id:state.yearPlans[0].id,semester:'' as const,phase:state.yearPlans[0].phase||'A',curriculum:'Kurikulum Merdeka'},
    cp:annual('cp'),cpAnalysis:annual('cpAnalysis'),tp:annual('tp'),atp:annual('atp'),atpUnitMapping:annual('atpUnitMappings'),unitExecutionPlan:annual('unitExecutionPlans')};
}
saveStorageV5(ready);const ctx=context();
const order:WorkflowStepId[]=['atp','atp-mapping','annual-planning','semester','admin'];
runTest('Rendered V21 workflow has exactly ATP 06 → Pemetaan 07 → Tahunan 08 → Semester 09 → Administrasi 10',()=>{
  const selected:string[]=[];
  const tree=WorkflowStepper({...ctx,currentStep:'atp',onSelectStep:s=>selected.push(s)});
  const buttons=nodes(tree,n=>n.type==='button');
  assert.deepEqual(buttons.slice(-5).map(b=>b.props.id),order.map(s=>'btn-step-'+s));
  order.forEach((step,index)=>{
    const button=byId(tree,'btn-step-'+step);assert.match(nodeText(button),new RegExp('^'+String(index+6).padStart(2,'0')+'\\b'));
    if(!button.props.disabled){button.props.onClick();assert.equal(selected.at(-1),step);}
  });
});
for(const [component,attribute,destination] of [
  ['ATPManager','onNextStep','atp-mapping'],['ATPUnitMappingManager','onBackToATP','atp'],
  ['AnnualPlanningManager','onNextStep','semester'],['AnnualPlanningManager','onBackToMapping','atp-mapping'],
  ['SemesterSelector','onNextStep','admin'],['SemesterSelector','onBackToATP','annual-planning'],
])runTest(component+'.'+attribute+' executes actual App wiring to '+destination,()=>{
  let actual='';jsxCallback(component,attribute,{setCurrentStep:(s:string)=>actual=s})();assert.equal(actual,destination);
});
runTest('Pemetaan → Tahunan uses real readiness; invalid/dangling mapping cannot proceed',()=>{
  for(const mapping of [ctx.atpUnitMapping,{...ctx.atpUnitMapping,units:[]}]) {
    let step='';const notices:any[]=[];
    const enter=appCallback('handleEnterAnnualPlanning',{isK13,resolveATPUnitMappingReadiness,transitionalAcademicSetting:ctx.academicSetting,
      activeATPUnitMapping:mapping,activeATP:ctx.atp,activeTP:ctx.tp,setCurrentStep:(s:string)=>step=s,setAppNotice:(n:any)=>notices.push(n)});
    jsxCallback('ATPUnitMappingManager','onNextStep',{handleEnterAnnualPlanning:enter})();
    assert.equal(step,mapping.units.length?'annual-planning':'atp-mapping');
    assert.equal(notices.length,mapping.units.length?0:1);
  }
});
runTest('Missing/stale annual dependencies block Semester and Admin even with a selected semester',()=>{
  for(const change of ['missing','stale']) {
    const state=structuredClone(ready);
    if(change==='missing')state.annualData.atpUnitMappings=[];
    else state.annualData.atpUnitMappings[0].value.basedOnAtpUpdatedAt='2000-01-01T00:00:00Z';
    saveStorageV5(state);const invalid=context(state);const report=validateWorkflowDependencies(invalid);
    assert(report.stepStates.semester.isBlocked);assert(report.stepStates.admin.isBlocked);
    const tree=WorkflowStepper({...invalid,currentStep:'atp',activeSemesterPlan:state.semesterPlans[0],onSelectStep:()=>assert.fail('blocked click')});
    assert(byId(tree,'btn-step-semester').props.disabled);assert(byId(tree,'btn-step-admin').props.disabled);
  }
  saveStorageV5(ready);
});
runTest('Semester completion requires explicit valid selection; annual readiness alone does not complete it',()=>{
  const report=validateWorkflowDependencies(ctx);
  assert.equal(report.stepStates['annual-planning'].isComplete,true,JSON.stringify(report.stepStates['annual-planning']));
  assert.equal(report.stepStates.semester.status,'READY');assert.equal(report.stepStates.semester.isComplete,false);
  const tree=WorkflowStepper({...ctx,currentStep:'semester',onSelectStep:()=>{}});
  assert.equal(byId(tree,'btn-step-admin').props.disabled,true);
});
runTest('SemesterSelector renders real records, rejects foreign selection, and continues/backtracks correctly',()=>{
  const selected:string[]=[];let next=0,back=0;
  const props={semesterPlans:ready.semesterPlans,onSelectSemester:(id:string)=>selected.push(id),onNextStep:()=>next++,onBackToATP:()=>back++};
  for(const activeSemesterPlan of [undefined,{...ready.semesterPlans[0],id:'foreign-semester'}]) {
    const tree=SemesterSelector({...props,activeSemesterPlan});assert(byId(tree,'btn-next-to-admin-from-semester').props.disabled);
  }
  const tree=SemesterSelector({...props,activeSemesterPlan:ready.semesterPlans[1]});
  assert.equal(byId(tree,'btn-next-to-admin-from-semester').props.disabled,false);
  const choice=nodes(tree,n=>n.type==='button'&&nodeText(n).includes(ready.semesterPlans[0].id))[0];assert(choice);choice.props.onClick();
  assert.deepEqual(selected,[ready.semesterPlans[0].id]);byId(tree,'btn-next-to-admin-from-semester').props.onClick();assert.equal(next,1);
  assert.match(nodeText(byId(tree,'btn-back-to-atp')),/Perencanaan Tahunan \(08\)/);byId(tree,'btn-back-to-atp').props.onClick();assert.equal(back,1);
});
runTest('App selects semester using V5 authority, refreshes only after success, and reports invalid IDs',()=>{
  let refreshed=0;const notices:any[]=[];
  const select=appCallback('handleSelectSemester',{setActiveSemesterPlanV5,refreshV5:()=>refreshed++,setAppNotice:(n:any)=>notices.push(n)});
  select(ready.semesterPlans[1].id);assert.equal(getRuntimeContextV5().activeSemesterPlan?.id,ready.semesterPlans[1].id);assert.equal(refreshed,1);
  select('missing');assert.equal(refreshed,1);assert.equal(notices.length,1);
});
runTest('App admin navigation rejects missing semester for Merdeka but preserves K13 route',()=>{
  for(const curriculumType of ['KURIKULUM_MERDEKA','K13']) {
    let step='';const notices:any[]=[];let annual=0;
    const select=appCallback('handleSelectStep',{isK13,transitionalAcademicSetting:{...ctx.academicSetting,curriculumType,curriculum:curriculumType==='K13'?'Kurikulum 2013':'Kurikulum Merdeka'},isActiveSemesterValid:false,
      handleEnterAnnualPlanning:()=>annual++,setCurrentStep:(s:string)=>step=s,setAppNotice:(n:any)=>notices.push(n)});
    select('admin');assert.equal(step,curriculumType==='K13'?'admin':'semester');assert.equal(notices.length,curriculumType==='K13'?0:1);
    select('annual-planning');assert.equal(annual,1);
  }
});
// Formerly no-op handlers are now real scoped persistence. Verify writes, guards,
// refresh order and errors by executing each callback, not searching its source.
for(const [name,writer,annual] of [
  ['handleSaveStudents','saveRosterV5',false],['handleSaveCriteria','saveAssessmentCriteriaV5',false],
  ['handleSaveRemedials','saveRemedialV5',false],['handleSaveEnrichments','saveEnrichmentV5',false],
  ['handleSaveATPUnitMapping','saveATPUnitMappingV5',true],['handleSaveUnitExecutionPlan','saveUnitExecutionPlanV5',true],
] as const)runTest(name+' writes the canonical scope; missing scope/error never refreshes',()=>{
  for(const mode of ['ok','missing','error']) {
    const events:any[]=[];const payload=annual?{id:'fixture'}:[];const notices:any[]=[];
    const callback=appCallback(name,{activeYearPlan:mode==='missing'?undefined:ready.yearPlans[0],activeSemesterPlan:mode==='missing'?undefined:ready.semesterPlans[0],
      [writer]:(...args:unknown[])=>{if(mode==='error')throw Error('fixture failure');events.push(['save',...args]);},
      refreshV5:()=>events.push(['refresh']),setAppNotice:(n:any)=>notices.push(n)});
    const result=callback(payload);
    if(mode==='ok')assert.deepEqual(events,[['save',annual?ready.yearPlans[0].id:ready.semesterPlans[0].id,payload],['refresh']]);
    else {assert.deepEqual(events,[]);assert.equal(notices.length,1);}
    if(annual)assert.equal(result,mode==='ok');
  }
});
runTest('Attendance/grade upserts replace only their target records; assessment deletion keeps unrelated results',()=>{
  const runtimeContext={semesterData:{attendance:{sessions:[{id:'s1'},{id:'s2'}],records:[{id:'r1',sessionId:'s1'},{id:'r2',sessionId:'s2'}]},grade:{assessments:[{id:'a1'},{id:'a2'}],results:[{id:'g1',assessmentId:'a1'},{id:'g2',assessmentId:'a2'}]}}};
  for(const [name,writer,args,expected] of [
    ['handleSaveAttendance','saveAttendanceV5',[{id:'s1',edited:true},[{id:'new',sessionId:'s1'}]],{sessions:[{id:'s1',edited:true},{id:'s2'}],records:[{id:'r2',sessionId:'s2'},{id:'new',sessionId:'s1'}]}],
    ['handleSaveAssessment','saveGradeV5',[{id:'a1',edited:true},[{id:'new',assessmentId:'a1'}]],{assessments:[{id:'a1',edited:true},{id:'a2'}],results:[{id:'g2',assessmentId:'a2'},{id:'new',assessmentId:'a1'}]}],
    ['handleDeleteAssessment','saveGradeV5',['a1'],{assessments:[{id:'a2'}],results:[{id:'g2',assessmentId:'a2'}]}],
  ] as const) {
    let writes=0;const before=JSON.stringify(runtimeContext);
    appCallback(name,{runtimeContext,activeSemesterPlan:ready.semesterPlans[0],[writer]:(id:string,data:unknown)=>{writes++;assert.equal(id,ready.semesterPlans[0].id);assert.deepEqual(data,expected);},refreshV5:()=>{},setAppNotice:()=>assert.fail('unexpected save error')})(...args);
    assert.equal(writes,1);assert.equal(JSON.stringify(runtimeContext),before);
  }
});
console.log(`PASS ${passedTests}/${totalTests}: V21 five-stage navigation, dependency gates, actual UI handlers, scoped persistence, runtime isolation and V3 preservation.`);
