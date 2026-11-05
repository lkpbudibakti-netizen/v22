import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { getSubjectJP, resolveCalendarSubjectCapacity, resolveSemesterCapacityV5, calculateAvailableJP } from '../src/services/jpEngine';
import { resolveSemesterJPFromValues, resolveSemesterJPFromState } from '../src/services/semesterJPResolver';
import { resolveEffectiveSubjectSlots } from '../src/services/subjectScheduleService';
import { assessAnnualJP, sumSemesterAllocatedJP } from '../src/services/annualJPAssessment';
import { createModulAjarRuntimeFixture } from './fixtures/modulAjarRuntimeFixture';
import { buildPromesProjection } from '../src/services/documentEngine/promesProjection';
import { buildProtaProjection } from '../src/services/documentEngine/protaProjection';
import { generatePROMES } from '../src/services/documentEngine/generators/promesGenerator';
import { generatePROTA } from '../src/services/documentEngine/generators/protaGenerator';
import { generateAlokasiWaktu } from '../src/services/documentEngine/generators/alokasiWaktuGenerator';
import { generateKalenderAkademik } from '../src/services/documentEngine/generators/kalenderGenerator';
import { generatePdfDocument } from '../src/services/documentEngine/renderers/pdf/pdfDocGenerators';

const query: any = { curriculumType: 'KURIKULUM_MERDEKA', level: 'SD', grade: '1', subject: 'PJOK', academicYear: '2025/2026' };
// Evidence: Permendikdasmen 13/2025, Lampiran II Tabel 1, official PDF pages 15–16:
// https://kemendikdasmen.go.id/download/file/1400 — no regulatory master numbers changed.
assert.equal(getSubjectJP(query).referenceAnnualJP, 108);
assert.equal(getSubjectJP({ ...query, allocationType: 'KOKURIKULER' }).referenceAnnualJP, 36);
assert.equal(getSubjectJP({ ...query, allocationType: 'TOTAL' }).referenceAnnualJP, 144);
assert.equal(getSubjectJP(query).regulationYear, 2025);
assert.equal(getSubjectJP(query).sourceUrl, 'https://kemendikdasmen.go.id/download/file/1400');
assert.equal(getSubjectJP({ ...query, academicYear: '2024/2025' }).regulationYear, 2024);
for (const invalid of [{ level: 'SMP' }, { grade: '99' }, { grade: '' }, { subject: '' }, { subject: 'Mapel rekaan' }]) assert(!getSubjectJP({ ...query, ...invalid }).isOfficial);
for (const invalid of [{ grade: 'Kelas 1/2' }, { academicYear: 'invalid' }, { academicYear: '2025/2027' }]) assert(!getSubjectJP({ ...query, ...invalid }).isOfficial);
const calendar: any = { id: 'cal', academicSettingId: 's1', startDate: '2026-10-19', endDate: '2026-10-23', schoolDaysPerWeek: 5, workflowStatus: 'CONFIRMED' };
const days: any[] = Array.from({ length: 5 }, (_, index) => ({ id: 'd'+index, date: `2026-10-${19+index}`, status: 'EFFECTIVE_LEARNING' }));
const schedule: any = { semesterPlanId: 's1', basedOnWeeklyJP: 2, sessions: [{ id: 'monday', dayOfWeek: 1, jp: 2, order: 1 }], updatedAt: 'now' };
const capacity = (calendarDays: any[], extra: any = {}) => resolveCalendarSubjectCapacity({ semesterPlanId: 's1', calendar, calendarDays, schedule, weeklyJP: 2, ...extra });
assert.equal(capacity(days).availableJP, 2);
const tuesdayHoliday = days.map((d, i) => ({ ...d, status: i === 1 ? 'HOLIDAY' : d.status }));
assert.equal(capacity(tuesdayHoliday).availableJP, 2, 'Holiday off subject slot must not reduce subject JP');
assert.equal(capacity(tuesdayHoliday).calendarLostJP, 0);
const mondayHoliday = days.map((d, i) => ({ ...d, status: i === 0 ? 'HOLIDAY' : d.status }));
assert.equal(capacity(mondayHoliday).availableJP, 0);
assert.equal(capacity(mondayHoliday).calendarLostJP, 2, 'Exclude actual occurrence once, not another proportional deduction');
assert.equal(capacity([...mondayHoliday, mondayHoliday[0]]).availableJP, 0, 'Duplicate date must not double subtract');
const estimate = capacity(tuesdayHoliday, { schedule: undefined, weeklyJP: 5 });
assert.equal(estimate.capacitySource, 'EFFECTIVE_DAY_ESTIMATE'); assert.equal(estimate.availableJP, 4); assert.equal(estimate.calendarLostJP, 1);
assert.equal(capacity(tuesdayHoliday, { schedule: { ...schedule, sessions: [{ id: 'legacy', jp: 2, order: 1 }] } }).capacitySource, 'EFFECTIVE_DAY_ESTIMATE');
assert.equal(capacity(days.slice(0, 1)).availableJP, null, 'Partial calendar must not silently become resolved');
assert.equal(resolveEffectiveSubjectSlots({ semesterPlanId: 's1', calendar, calendarDays: days.slice(0, 1), schedule, expectedWeeklyJP: 2 }).isReady, false);
assert.equal(capacity(days, { schedule: { ...schedule, basedOnWeeklyJP: 3 } }).availableJP, null);
assert.equal(resolveSemesterJPFromValues({ actualScheduledWeeklyJP: 2, source: 'SEMESTER_OVERRIDE' } as any, { referenceWeeklyEquivalentJP: 2 } as any).isOverride, true);
assert.equal(resolveSemesterJPFromValues({ actualScheduledWeeklyJP: Infinity } as any).weeklyJP, null);
assert.equal(calculateAvailableJP({ subjectWeeklyJP: Infinity, effectiveLearningDays: 5, schoolDaysPerWeek: 5 }).availableJP, null);
assert.equal(calculateAvailableJP({ subjectWeeklyJP: 3, effectiveLearningDays: 100, schoolDaysPerWeek: 5, officialAnnualJP: 50 }).isCapacityExceeded, false, 'Never invent annual comparison by doubling semester capacity');
const state: any = { semesterPlans: [{ id: 's1', yearPlanId: 'year', semester: 1 }, { id: 's2', yearPlanId: 'year', semester: 2 }],
  annualJPReferences: [{ yearPlanId: 'year', value: { referenceWeeklyEquivalentJP: 3 } }],
  semesterJPSettings: [{ semesterPlanId: 's1', value: { semesterPlanId: 's1', actualScheduledWeeklyJP: 2, source: 'SEMESTER_OVERRIDE' } }],
  semesterData: { academicCalendar: [{ semesterPlanId: 's1', value: { calendar, days: tuesdayHoliday } }], subjectWeeklySchedules: [{ semesterPlanId: 's1', value: schedule }] } };
const stored = JSON.stringify(state);
assert.equal(resolveSemesterCapacityV5('s1', state).availableJP, 2);
assert.equal(resolveSemesterCapacityV5('s1', state).capacitySource, 'ACTUAL_SLOTS');
assert.equal(resolveSemesterCapacityV5('missing', state).availableJP, null);
assert.equal(resolveSemesterJPFromState('missing', state).weeklyJP, null);
assert.equal(resolveSemesterCapacityV5('s1', state, { calendar, calendarDays: days.slice(0, 1) }).availableJP, null);
assert.equal(JSON.stringify(state), stored);
const assessment = assessAnnualJP({ isOfficial: true, referenceAnnualJP: 108 }, [
  { semester: 1, capacityJP: 50, allocatedJP: 55, calendarLostJP: 4 },
  { semester: 2, capacityJP: 50, allocatedJP: 45, calendarLostJP: 4 },
]);
assert.equal(assessment.capacityStatus, 'BALANCED'); assert.equal(assessment.referenceCheck, 'BELOW_REFERENCE');
assert.equal(assessment.unallocatedJP, 0); assert.equal(assessment.capacityBelowReferenceJP, 8); assert.equal(assessment.calendarLostJP, 8);
assert.equal(sumSemesterAllocatedJP({ learningMeetingSchedule: { entries: [{ meetingId: 'm', jp: 2 }] }, timeAllocation: [{ allocatedJP: 99 }] }), 2);
assert.equal(sumSemesterAllocatedJP({ timeAllocation: [{ allocatedJP: 3 }] }), 3);
assert.equal(sumSemesterAllocatedJP({ learningMeetingSchedule: { entries: [{ meetingId: 'm', jp: 2 }, { meetingId: 'm', jp: 2 }] } }), null);
assert(assessment.semesterImbalance, 'Balanced annual total must not conceal semester overflow');
assert.equal(assessAnnualJP({ isOfficial: true, referenceAnnualJP: 108 }, [{ semester: 1, capacityJP: 50, allocatedJP: 45 }]).capacityJP, null);

const context = createModulAjarRuntimeFixture();
context.documentDate = '2026-10-27'; context.skipDownload = true;
context.academicSetting = { ...context.academicSetting, id: 's1', academicYear: '2026/2027', semester: '1 (Ganjil)' };
context.calendar = calendar; context.calendarDays = tuesdayHoliday; context.subjectWeeklySchedule = schedule;
context.semesterJPSetting = { semesterPlanId: 's1', actualScheduledWeeklyJP: 2, source: 'SEMESTER_OVERRIDE' };
context.annualJPReference = { officialAnnualJP: 108, referenceWeeklyEquivalentJP: 3 };
const unit2 = { ...structuredClone(context.atpUnitMapping.units[0]), id: 'unit2', order: 2 };
context.atpUnitMapping.units.push(unit2);
const execution2 = { unitId: 'unit2', meetings: context.unitExecutionPlan.units[0].meetings.map((m: any) => ({ ...m, id: 's2-'+m.id, unitId: 'unit2' })) };
context.unitExecutionPlan.units.push(execution2);
context.learningMeetingSchedules[0].semesterPlanId = 's1'; context.learningMeetingSchedules[0].schedule.semesterPlanId = 's1';
context.learningMeetingSchedules[0].schedule.entries.forEach((e: any) => e.semesterPlanId = 's1');
context.learningMeetingSchedules.push({ semester: 2, semesterPlanId: 's2', schedule: { semesterPlanId: 's2', status: 'COMPLETE', entries: execution2.meetings.map((m: any) => ({ meetingId: m.id, unitId: 'unit2', semesterPlanId: 's2', date: '2027-01-18', jp: 2, weekIndex: 1, dayOfWeek: 1, mode: 'MANUAL' })) } });
context.protaSemesterAllocations = [{ semester: 1, semesterPlanId: 's1', capacityJP: 2, allocations: [] }, { semester: 2, semesterPlanId: 's2', capacityJP: 2, allocations: [] }];
const original = JSON.stringify(context);
assert.equal(buildPromesProjection(context).availableJP, 2);
const annual = buildProtaProjection(context);
assert.equal(annual.availableAnnualJP, 4); assert.equal(annual.unallocatedAnnualJP, -8); assert.equal(annual.referenceDifferenceJP, 60);
assert.equal(annual.validationStatus, 'OVER_ALLOCATED');
const legacyReference = { ...context, annualJPReference: { ...context.annualJPReference, officialAnnualJP: 144 } };
assert.equal(buildProtaProjection(legacyReference).officialAnnualJP, 72, 'SMP VII reference is 72 intra, not 108/144 total JP');
assert.equal(legacyReference.annualJPReference.officialAnnualJP, 144, 'A read-only check must not repair saved legacy numbers');
const forbidden = /UNDER_ALLOCATED|OVER_ALLOCATED|BALANCED|UNVERIFIED_CAPACITY|BELOW_REFERENCE|ACTUAL_SLOTS|EFFECTIVE_DAY_ESTIMATE|UNRESOLVED|EFFECTIVE_LEARNING|HOLIDAY|NON_LEARNING/;
for (const [type, generator] of [['PROMES', generatePROMES], ['PROTA', generatePROTA], ['ALOKASI_WAKTU', generateAlokasiWaktu], ['KALENDER_AKADEMIK', generateKalenderAkademik]] as const) {
  const docx = await generator(context);
  const xml = await (await JSZip.loadAsync(await docx.blob!.arrayBuffer())).file('word/document.xml')!.async('string');
  assert(!forbidden.test(xml), `${type} DOCX leaks technical status`);
  const pdf = await generatePdfDocument(type, context);
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(await pdf.blob.arrayBuffer()), useSystemFonts: true });
  const parsed = await task.promise; let text = '';
  for (let page = 1; page <= parsed.numPages; page++) text += (await (await parsed.getPage(page)).getTextContent()).items.map((item: any) => item.str || '').join(' ');
  assert(!forbidden.test(text), `${type} PDF leaks technical status`);
  if (type === 'PROMES') { assert(xml.includes('2 JP')); assert(text.includes('2 JP')); }
  if (type === 'PROTA') { assert(xml.includes('60 JP')); assert(text.includes('60 JP')); }
  if (type === 'KALENDER_AKADEMIK') { assert(xml.includes('Hari Libur')); assert(text.includes('Hari Libur')); }
  await task.destroy();
}
assert.equal(JSON.stringify(context), original);
console.log('PASS: official lookup scope/type/year, actual holiday slot intersections, no double deductions, legacy estimate, partial calendar, overrides, annual capacity vs reference separation, semester imbalance, immutable inputs and real DOCX/PDF without technical statuses.');
