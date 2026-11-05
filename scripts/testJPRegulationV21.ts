import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ALL_CURRICULUM_STRUCTURE_RULES } from '../src/data/curriculum/structure';
import { resolveCurriculumContext, parseAcademicYear } from '../src/data/curriculum/resolver';
import { getSubjectJP, resolveCalendarSubjectCapacity, resolveSemesterCapacityV5 } from '../src/services/jpEngine';
import { resolveSemesterJPFromValues } from '../src/services/semesterJPResolver';
import { validateSubjectWeeklySchedule } from '../src/services/subjectScheduleService';
import { assessAnnualJP } from '../src/services/annualJPAssessment';
import { resolveLearningMeetingSchedule } from '../src/services/learningMeetingScheduleService';
import { resolveEffectiveSubjectSlots } from '../src/services/subjectScheduleService';

// Independent transcription of Lampiran II tables; includes all KM rows and explicit audit gaps.
const matrix = JSON.parse(readFileSync(new URL('./fixtures/jpRegulationMatrix.json', import.meta.url), 'utf8'));
const rules = ALL_CURRICULUM_STRUCTURE_RULES.filter(r => r.curriculumType === 'KURIKULUM_MERDEKA');
assert.equal(matrix.length, rules.length);
assert.equal(new Set(matrix.map((r: any) => r.id)).size, rules.length);
const snapshot = JSON.stringify(ALL_CURRICULUM_STRUCTURE_RULES);
for (const row of matrix) {
  const rule = rules.find(r => r.id === row.id)!;
  assert(rule, row.id);
  const actual = [rule.intrakurikulerAnnualJP, rule.kokurikulerAnnualJP, rule.totalAnnualJP, rule.referenceWeeksPerYear, rule.derivedWeeklyJP];
  assert.deepEqual(actual, row.expected ?? row.before, row.id);
  assert.equal(rule.minutesPerJP, rule.level === 'SD' ? 35 : rule.level === 'SMP' ? 40 : 45);
  if (!row.expected) assert.equal(rule.verificationStatus, 'UNVERIFIED', row.id);
  const resolved = resolveCurriculumContext({ grade: rule.grade, subjectCode: rule.subjectCode, academicYear: row.year === 2024 ? '2024/2025' : '2025/2026' });
  assert.equal(resolved?.rule?.id, rule.id, `year selection: ${row.id}`);
  if (row.expected) {
    assert.equal(actual[0]! + actual[1]!, actual[2]);
    assert.equal(actual[0]! / actual[3]!, actual[4]);
  }
}
for (const grade of [7, 8, 9]) for (const subjectCode of ['PAI','PAK','PKAT','PHINDU','PBUDDHA','PKHONGHUCU']) {
  for (const academicYear of ['2024/2025', '2025/2026', '2026/2027']) {
    const result = resolveCurriculumContext({ grade, subjectCode, academicYear })!;
    assert.equal(result.intrakurikulerAnnualJP, grade === 9 ? 64 : 72);
    assert.equal(result.derivedWeeklyJP, 2);
    assert.equal(result.actualAvailableAnnualJP, null);
  }
}
const pai = getSubjectJP({ curriculumType: 'KURIKULUM_MERDEKA', level: 'SMP', grade: '7', subject: 'PAI', academicYear: '2025/2026' });
assert.equal(pai.matchedRule?.id, 'km25-smp-7-pai');
assert.equal(pai.referenceAnnualJP, 72);
assert.equal(pai.kokurikulerAnnualJP, 36);
assert.equal(pai.totalAnnualJP, 108);
const branchAudit = getSubjectJP({ curriculumType:'KURIKULUM_MERDEKA',level:'SMA',grade:'10',subject:'Fisika',academicYear:'2025/2026' });
assert.equal(branchAudit.sourceType,'UNVERIFIED');
assert.equal(branchAudit.isOfficial,false);
assert(branchAudit.explanation.includes('AUDIT MANUAL'));
assert.equal(resolveCurriculumContext({grade:1, subjectCode:'BINDO', academicYear:'2024/2025'})?.derivedWeeklyJP, 6);
assert.equal(resolveCurriculumContext({grade:1, subjectCode:'BINDO', academicYear:'2025/2026'})?.derivedWeeklyJP, 7);
assert.equal(parseAcademicYear('2025/2027'), null);

// 32–36 complete weeks, with holidays on and off a subject day. No annual rescaling.
for (const weeks of [27, 32, 33, 34, 35, 36]) for (const pattern of [[1], [2], [3], [3,2], [10]]) {
  const weeklyJP = pattern.reduce((a,b)=>a+b,0);
  const start = new Date('2025-07-07T00:00:00Z');
  const days: any[] = [];
  for (let i=0; i<weeks*7; i++) {
    const d = new Date(start.getTime()+i*86400000);
    if (d.getUTCDay() >= 1 && d.getUTCDay() <= 5) days.push({ id: String(i), date:d.toISOString().slice(0,10), status:'EFFECTIVE_LEARNING' });
  }
  const calendar: any = {id:'cal',academicSettingId:'s1',startDate:days[0].date,endDate:days.at(-1).date,schoolDaysPerWeek:5,workflowStatus:'CONFIRMED'};
  const schedule: any = {semesterPlanId:'s1',basedOnWeeklyJP:weeklyJP,updatedAt:'test',sessions:pattern.map((jp,i)=>({id:String(i),order:i+1,jp,dayOfWeek:i===0?1:3}))};
  const state: any = {semesterPlans:[{id:'s1',yearPlanId:'y',semester:1}],annualJPReferences:[{yearPlanId:'y',value:{officialAnnualJP:108,referenceWeeklyEquivalentJP:3}}],semesterJPSettings:[{semesterPlanId:'s1',value:{semesterPlanId:'s1',actualScheduledWeeklyJP:weeklyJP,source:'SEMESTER_OVERRIDE'}}],semesterData:{academicCalendar:[{semesterPlanId:'s1',value:{calendar,days}}],subjectWeeklySchedules:[{semesterPlanId:'s1',value:schedule}]}};
  const before=JSON.stringify(state);
  assert.equal(resolveSemesterCapacityV5('s1',state).availableJP,weeks*weeklyJP);
  assert.equal(validateSubjectWeeklySchedule(schedule,weeklyJP,5).isComplete,true);
  if (weeks===32 && pattern.length===2) {
    const mapping: any={id:'map',updatedAt:'test',units:[{id:'u',order:1}]};
    const plan: any={mappingId:'map',basedOnMappingUpdatedAt:'test',semesterPlacement:{mode:'CONTIGUOUS_BOUNDARY',semester1LastUnitId:'u'},units:[{unitId:'u',meetings:[{id:'m1',unitId:'u',order:1},{id:'m2',unitId:'u',order:2}]}]};
    const beforePlan=JSON.stringify(plan);
    const result=resolveLearningMeetingSchedule({semesterPlanId:'s1',semester:1,mapping,unitExecutionPlan:plan,subjectSlotResult:resolveEffectiveSubjectSlots({semesterPlanId:'s1',calendar,calendarDays:days,schedule,expectedWeeklyJP:5})});
    assert.equal(result.isReady,true);
    assert.deepEqual(result.scheduledEntries.map(e=>e.jp),[3,2]);
    assert.equal(result.totalActualJP,5);
    assert.equal(JSON.stringify(plan),beforePlan);
  }
  const capacity=(calendarDays:any[])=>resolveCalendarSubjectCapacity({semesterPlanId:'s1',calendar,calendarDays,schedule,weeklyJP});
  assert.equal(capacity(days.map((d,i)=>({...d,status:i===1?'HOLIDAY':d.status}))).availableJP,weeks*weeklyJP);
  assert.equal(capacity(days.map((d,i)=>({...d,status:i===0?'HOLIDAY':d.status}))).availableJP,weeks*weeklyJP-pattern[0]);
  assert.equal(capacity(days.slice(1)).availableJP,null);
  assert.equal(JSON.stringify(state),before);
}
assert.equal(resolveCurriculumContext({grade:1,subjectCode:'PJOK',academicYear:'2025/2026'})?.derivedWeeklyJP,3);
assert.equal(resolveCurriculumContext({grade:3,subjectCode:'MAT',academicYear:'2025/2026'})?.derivedWeeklyJP,5);
const annual = resolveCurriculumContext({grade:11,subjectCode:'PANCASILA',academicYear:'2024/2025'})!;
assert.equal(annual.allocationMode,'ANNUAL');
assert.equal(annual.intrakurikulerAnnualJP,54);
assert.equal(resolveSemesterJPFromValues(null,{officialAnnualJP:54,referenceWeeklyEquivalentJP:1.5}).weeklyJP,null);
assert.equal(resolveSemesterJPFromValues({semesterPlanId:'s1',actualScheduledWeeklyJP:1.5,source:'DEFAULT_ANNUAL'},{officialAnnualJP:54,referenceWeeklyEquivalentJP:1.5}).weeklyJP,null);
assert.equal(resolveSemesterJPFromValues({semesterPlanId:'s1',actualScheduledWeeklyJP:2,source:'SEMESTER_OVERRIDE'},{officialAnnualJP:54,referenceWeeklyEquivalentJP:1.5}).weeklyJP,2);
for (const invalid of [Infinity,NaN,-1]) assert.equal(resolveCurriculumContext({grade:7,subjectCode:'PAI',academicYear:'2025/2026',actualScheduledAnnualJP:invalid})?.actualAvailableAnnualJP,null);
assert.equal(resolveCurriculumContext({grade:7,subjectCode:'PAI',academicYear:'2025/2026',actualWeeklyJP:2,schoolWeeksPerYear:Infinity})?.actualAvailableAnnualJP,null);
const comparison=assessAnnualJP({isOfficial:true,referenceAnnualJP:72},[{semester:1,capacityJP:32,allocatedJP:36},{semester:2,capacityJP:32,allocatedJP:28}]);
assert.equal(comparison.referenceDifferenceJP,8);
assert.equal(comparison.capacityBelowReferenceJP,8);
assert.equal(comparison.semesterImbalance,true);
assert.equal(JSON.stringify(ALL_CURRICULUM_STRUCTURE_RULES),snapshot);
console.log(`PASS V21: ${matrix.length} master rows, year selection, all religions, 32–36 weeks, PJOK 3, MAT 3+2, 10-JP session, holidays, annual fractional fallback, V5 overrides and immutable inputs.`);
