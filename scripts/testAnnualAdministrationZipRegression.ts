import * as productionValidation from '../src/services/productionValidation';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import JSZip from 'jszip';
import { createModulAjarRuntimeFixture } from './fixtures/modulAjarRuntimeFixture';
import { administrationZipRoot, buildAnnualZipWorkItems, isAnnualZipDocument, semesterZipFolder, resolveAnnualZipContexts } from '../src/services/documentEngine/annualZipPlan';
import { buildModulAjarProjection } from '../src/services/documentEngine/modulAjarProjection';
import { buildPromesProjection } from '../src/services/documentEngine/promesProjection';
import { generateZipBundle, validateDocumentRequirements } from '../src/services/documentEngine';
import { getCurriculumType } from '../src/services/curriculumRules';
import { resolveEffectiveSubjectSlots } from '../src/services/subjectScheduleService';
import { buildLearningMeetingScheduleData, resolveLearningMeetingSchedule } from '../src/services/learningMeetingScheduleService';
import { resolveEffectiveContext } from '../src/services/documentEngine/snapshot';

const base = createModulAjarRuntimeFixture();
base.documentDate = '2026-10-19';
base.profile.name = 'Adzani Kusumawardani S.Pd';
base.cp = { id: 'cp', academicSettingId: 'year', generalDescription: 'CP resmi', elements: [], workflowStatus: 'DRAFT' };
base.atp.items.forEach((item: any, index: number) => { item.focus = 'Fokus '+index; item.unitTitle = 'Bab '+index; });
const templateUnit = structuredClone(base.atpUnitMapping.units[0]);
const templateExecution = structuredClone(base.unitExecutionPlan.units[0]);
const templatePlan = structuredClone(base.learningPlans[0]);
base.academicSetting = { ...base.academicSetting, id: 's1', profileId: 'teacher', academicYear: '2026/2027', semester: '1 (Ganjil)' };
base.school.id = 'school'; base.profile.id = 'teacher';
base.atpUnitMapping.academicSettingId = 'year';
base.unitExecutionPlan.academicSettingId = 'year';
base.unitExecutionPlan.updatedAt = base.atpUnitMapping.updatedAt;
base.atpUnitMapping.units = [];
base.unitExecutionPlan.units = [];
const source: any = { yearPlan: { id: 'year', profileId: 'teacher', schoolId: 'school', academicYear: '2026/2027',
  subject: 'PJOK', grade: '7', curriculumType: 'KURIKULUM_MERDEKA' },
  semesterPlans: [1, 2].map(n => ({ id: 's'+n, yearPlanId: 'year', semester: n, updatedAt: 'now' })),
  semesterJPSettings: [], semesterData: { subjectWeeklySchedules: [], academicCalendar: [], learningPlan: [], assessmentCriteria: [],
    learningMeetingSchedules: [], timeAllocation: [], assessmentPlan: [], assessmentPackage: [], roster: [], attendance: [], grade: [], remedial: [], enrichment: [] } };
for (const semester of [1, 2]) {
  const id = 's'+semester;
  source.semesterData.learningPlan.push({ semesterPlanId: id, value: [] });
  source.semesterData.assessmentCriteria.push({ semesterPlanId: id, value: base.assessmentCriteria.map((criterion: any) => ({ ...criterion, academicSettingId: id })) });
  source.semesterData.learningMeetingSchedules.push({ semesterPlanId: id, value: { semesterPlanId: id, status: 'COMPLETE', entries: [], unresolvedMeetingIds: [] } });
  const year = semester === 1 ? 2026 : 2027, month = semester === 1 ? '10' : '01';
  const calendar = { id: 'cal'+semester, academicSettingId: id, startDate: `${year}-${month}-01`, endDate: `${year}-${month}-31`, schoolDaysPerWeek: 5, workflowStatus: 'CONFIRMED', updatedAt: '2026-10-01T00:00:00Z' };
  source.semesterData.academicCalendar.push({ semesterPlanId: id, value: { calendar, days: Array.from({ length: 31 }, (_, i) => ({ id: 'd'+i, academicCalendarId: calendar.id, date: `${year}-${month}-${String(i+1).padStart(2, '0')}`, status: 'EFFECTIVE_LEARNING' })) } });
  source.semesterJPSettings.push({ semesterPlanId: id, value: { semesterPlanId: id, actualScheduledWeeklyJP: 6, source: 'TEACHER_CONFIRMED' } });
}
for (const order of [1, 2, 3, 4, 5, 6]) {
  const semester = order <= 3 ? 1 : 2, id = 's'+semester, unitId = 'unit'+order;
  const remap = (id: string) => `u${order}-${id}`;
  base.atpUnitMapping.units.push({ ...structuredClone(templateUnit), id: unitId, order, title: 'Gerak Bab '+order });
  const meetings = templateExecution.meetings.map((m: any) => ({ ...m, id: remap(m.id), unitId }));
  base.unitExecutionPlan.units.push({ unitId, meetings });
  const plan = { ...structuredClone(templatePlan), id: 'lp'+order, academicSettingId: id, unitId, learningMeetingIds: meetings.map((m: any) => m.id) };
  for (const phase of ['opening', 'core', 'closing']) plan.learningSteps[phase].forEach((step: any) => { step.learningMeetingId = remap(step.learningMeetingId); });
  plan.assessmentPlan.formative.forEach((a: any) => { if (a.learningMeetingId) a.learningMeetingId = remap(a.learningMeetingId); });
  source.semesterData.learningPlan[semester-1].value.push(plan);
}
base.unitExecutionPlan.semesterPlacement = { mode: 'CONTIGUOUS_BOUNDARY', semester1LastUnitId: 'unit3' };
for (const semester of [1, 2] as const) {
  const semesterPlanId = 's' + semester;
  const { calendar, days: calendarDays } = source.semesterData.academicCalendar[semester - 1].value;
  const expectedWeeklyJP = 6;
  const subjectWeeklySchedule = { semesterPlanId, updatedAt: calendar.updatedAt, basedOnWeeklyJP: expectedWeeklyJP,
    sessions: ([1, 2, 3] as const).map(dayOfWeek => ({ id: semesterPlanId + '-' + dayOfWeek, dayOfWeek, jp: 2, order: dayOfWeek })) };
  const timing = { semesterPlanId, semester, mapping: base.atpUnitMapping, unitExecutionPlan: base.unitExecutionPlan };
  const subjectSlotResult = resolveEffectiveSubjectSlots({ semesterPlanId, schedule: subjectWeeklySchedule, expectedWeeklyJP, calendar, calendarDays });
  const autoResult = resolveLearningMeetingSchedule({ ...timing, subjectSlotResult });
  assert(autoResult.isReady, autoResult.errors.join('; '));
  source.semesterData.subjectWeeklySchedules.push({ semesterPlanId, value: subjectWeeklySchedule });
  source.semesterData.learningMeetingSchedules[semester - 1].value = buildLearningMeetingScheduleData({
    ...timing, subjectWeeklySchedule, expectedWeeklyJP, calendar, autoResult, manualOverrides: [],
  });
}
base.zipAnnualSource = source;
// The normal UI payload intentionally contains only active-semester plans.
base.learningPlans = source.semesterData.learningPlan[0].value;
base.snapshot = { semester: 'WRONG_HISTORICAL_SEMESTER' };
const before = JSON.stringify(base);
const requested: any = ['CP', 'ANALISIS_CP_TP', 'TP', 'ATP', 'PEMETAAN_ATP_UNIT', 'PROTA', 'KALENDER_AKADEMIK', 'MODUL_AJAR', 'RPM', 'PROMES'];
const planned = buildAnnualZipWorkItems(requested, base);
assert.deepEqual(planned.skipped, []);
const modules = planned.items.filter(i => i.type === 'MODUL_AJAR');
assert.equal(modules.length, 6);
const rpms = planned.items.filter(i => i.type === 'RPM');
assert.equal(rpms.length, 6);
assert.deepEqual(rpms.map(i => i.instanceId), modules.map(i => i.instanceId));
assert.deepEqual(rpms.map(i => i.seqNum), [1, 2, 3, 4, 5, 6]);
assert.deepEqual(modules.map(i => i.folderCategory), ['Semester_1', 'Semester_1', 'Semester_1', 'Semester_2', 'Semester_2', 'Semester_2']);
for (const [index, item] of modules.entries()) {
  assert.equal(item.fileStem, `Modul_Ajar_Bab_${index+1}`);
  assert.equal(item.context.snapshot, undefined);
  const projection = buildModulAjarProjection(item.context);
  assert(projection.isReady, projection.error);
}
const promes = planned.items.filter(i => i.type === 'PROMES');
assert.deepEqual(promes.map(i => i.context.academicSetting.id), ['s1', 's2']);
assert.deepEqual(promes.map(i => i.context.calendar?.id), ['cal1', 'cal2']);
for (const item of promes) {
  const projection = buildPromesProjection(item.context);
  assert(projection.isReady, projection.unreadyReason);
  assert.equal(projection.rows.length, 3);
  assert.equal(projection.totalAllocatedJP, 18);
}
assert(planned.items.every(i => i.context.skipDownload === true));
for (const item of planned.items) {
  const validation = validateDocumentRequirements(item.type, item.context);
  assert(validation.isValid, `${item.type}: ${validation.missingFields.join('; ')}`);
}
assert.equal(JSON.stringify(base), before);

for (const mutate of [
  (c: any) => { c.zipAnnualSource.semesterData.learningMeetingSchedules[1].value.entries.push({ ...c.zipAnnualSource.semesterData.learningMeetingSchedules[0].value.entries[0], semesterPlanId: 's2' }); },
  (c: any) => { c.zipAnnualSource.semesterData.learningPlan[0].value[0].learningMeetingIds.push('u4-m1'); },
  (c: any) => { c.zipAnnualSource.semesterData.learningPlan[0].value[0].learningMeetingIds = ['missing']; },
  (c: any) => { c.zipAnnualSource.semesterData.learningPlan[0].value[0].unitId = 'unit4'; },
]) {
  const bad = structuredClone(base); mutate(bad);
  const result = buildAnnualZipWorkItems(['MODUL_AJAR'], bad);
  assert(!result.items.some(i => i.instanceId === 'lp1'));
  assert(result.skipped.some(i => i.instanceId === 'lp1' && i.status === 'SKIPPED' && i.reason));
}
const absent = structuredClone(base); absent.zipAnnualSource.semesterPlans.pop();
const absentResult = buildAnnualZipWorkItems(requested, absent);
assert(!absentResult.items.some(i => i.folderCategory.startsWith('Semester_2')));
assert(absentResult.skipped.some(i => i.type === 'PROMES' && i.reason?.includes('Semester 2')));
const annual = buildAnnualZipWorkItems(['CP', 'TP', 'ANALISIS_CP_TP', 'ATP', 'PEMETAAN_ATP_UNIT', 'PROTA'], base);
assert(annual.items.every(i => i.folderCategory === 'Administrasi_Umum' && i.context.academicSetting.id === 'year'));
assert.equal(resolveAnnualZipContexts(base).annual.protaSemesterAllocations?.length, 2);
const draftAnnual = structuredClone(base); draftAnnual.atp.status = 'DRAFT';
assert.equal(buildAnnualZipWorkItems(['ATP'], draftAnnual).items.length, 1, 'Status eligibility belongs to document validator');
for (const type of ['CP', 'TP', 'ANALISIS_CP_TP'] as const) {
  const candidate = structuredClone(base);
  candidate.tp.status = 'DRAFT'; candidate.tp.workflowStatus = 'DRAFT'; candidate.tp.needsReview = true;
  const item = buildAnnualZipWorkItems([type], candidate).items[0];
  assert(item, 'Planner must not gate CP/TP/Analysis statuses');
  assert(validateDocumentRequirements(type, item.context).isValid);
}
const duplicated = structuredClone(base);
duplicated.zipAnnualSource.semesterPlans.push({ ...duplicated.zipAnnualSource.semesterPlans[1], id: 'second-s2' });
assert(!buildAnnualZipWorkItems(requested, duplicated).items.some(i => i.folderCategory.startsWith('Semester_2')));
const changedOwner = structuredClone(base); changedOwner.zipAnnualSource.semesterData.learningPlan[0].value[0].academicSettingId = 's2';
assert(buildAnnualZipWorkItems(requested, changedOwner).skipped.some(i => i.instanceId === 'lp1'));
const isolated = structuredClone(base);
isolated.zipAnnualSource.semesterData.learningPlan.push({ semesterPlanId: 'unrelated-year-sem', value: [{ ...templatePlan, id: 'other-year' }] });
assert.equal(buildAnnualZipWorkItems(['MODUL_AJAR'], isolated).items.length, 6);

const rendered = await generateZipBundle({ types: ['MODUL_AJAR', 'RPM'], format: 'both' }, { ...base, skipDownload: true });
assert(rendered.isComplete, JSON.stringify(rendered.itemResults));
assert.equal(rendered.requestedCount, 12);
assert.equal(rendered.pdfCount, 12);
assert.equal(rendered.docxCount, 12);
const renderedZip = await JSZip.loadAsync(await rendered.zipBlob!.arrayBuffer(), { checkCRC32: true });
for (const item of [...modules, ...rpms]) {
  assert(renderedZip.file([administrationZipRoot(base), 'PDF', item.folderCategory, item.fileStem + '.pdf'].join('/')));
  assert(renderedZip.file([administrationZipRoot(base), 'WORD', item.folderCategory, item.fileStem + '.docx'].join('/')));
}

// Exercise the real ZIP orchestration with real validators/projections, simulated renderer bytes,
// and a captured download. This verifies archive paths and one browser save without a DOM.
const downloads: { blob: Blob; name: string }[] = [];
const renderCalls: any[] = [];
let failRpm = false;
const fakeRender = async (type: any, context: any) => {
  if (failRpm && type === 'RPM') throw new Error('Renderer RPM gagal');
  assert.equal(context.skipDownload, true);
  const validation = validateDocumentRequirements(type, context);
  assert(validation.isValid, validation.missingFields.join('; '));
  renderCalls.push({ type, id: context.academicSetting.id });
  return { blob: new Blob([new Uint8Array([1, 2, 3])]) };
};
const exports: any = {};
runInNewContext(ts.transpileModule(readFileSync('src/services/documentEngine/zipBundle.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, { exports, console, Blob, Uint8Array, Error, require: (id: string) => {
  if (id === 'jszip') return JSZip;
  if (id === 'file-saver') return (blob: Blob, name: string) => downloads.push({ blob, name });
  if (id === './annualZipPlan') return { administrationZipRoot, buildAnnualZipWorkItems, isAnnualZipDocument, semesterZipFolder };
  if (id === '../curriculumRules') return { getCurriculumType };
  if (id === './snapshot') return { resolveEffectiveContext };
  if (id === './index') return { validateDocumentRequirements, generateDocument: fakeRender };
  if (id === './renderers/pdf/pdfDocGenerators') return { generatePdfDocument: fakeRender };
  if (id === '../productionValidation') return productionValidation;
  if (id === '../curriculumRouter') return { MERDEKA_EXPORT_DOC_TYPES: requested };
  throw new Error('Unexpected dependency '+id);
} });
{
  const exportContext = structuredClone(base);
  const draftPlan = { ...structuredClone(source.semesterData.learningPlan[0].value[0]), id: 'draft-plan', status: 'DRAFT' };
  exportContext.zipAnnualSource.semesterData.learningPlan[0].value.push(draftPlan);
  const draftItem = buildAnnualZipWorkItems(['MODUL_AJAR'], exportContext).items.find(i => i.instanceId === draftPlan.id)!;
  assert(draftItem, 'Planner resolves scope; validator owns export readiness');
  const invalid = validateDocumentRequirements('MODUL_AJAR', draftItem.context);
  assert(!invalid.isValid);
  const result = await exports.generateZipBundle({ types: requested, format: 'both' }, exportContext);
  const skipped = result.itemResults.find((r: any) => r.instanceId === draftPlan.id);
  assert.equal(skipped.status, 'SKIPPED');
  assert.equal(skipped.reason, invalid.missingFields.join('; '), 'Preserve the original validator reason');
  assert.equal(result.exportedCount, 22);
  assert.equal(downloads.length, 1);
  assert.equal(renderCalls.length, 44);
  assert(!result.zipFileName.includes('Sem'));
  assert(result.zipFileName.includes('2026_2027'));
  const archive = await JSZip.loadAsync(await downloads[0].blob.arrayBuffer());
  const files = Object.keys(archive.files).filter(path => !archive.files[path].dir && !path.endsWith('/Laporan_Ekspor.txt'));
  assert.equal(files.length, 44);
  assert.equal(new Set(files).size, files.length);
  assert(files.every(path => path.endsWith('.pdf') ? path.includes('/PDF/') : path.includes('/WORD/')));
  for (const item of [...modules, ...rpms]) for (const ext of ['pdf', 'docx']) assert(files.includes(`${administrationZipRoot(base)}/${ext === 'pdf' ? 'PDF' : 'WORD'}/${item.folderCategory}/${item.fileStem}.${ext}`));
  const root = administrationZipRoot(base);
  assert.equal(root, 'Kelas_7_PJOK_Adzani Kusumawardani S.Pd');
  assert.equal(administrationZipRoot({ ...base, academicSetting: { ...base.academicSetting, grade: 'Kelas 1', subject: 'PJOK/SD' } }), 'Kelas 1_PJOK_SD_Adzani Kusumawardani S.Pd');
  assert(files.every(f => f.split('/').length === 4), 'No nested document-type folders');
  for (const folder of ['Semester_1', 'Semester_2']) {
    assert(files.filter(f => f.includes('/'+folder+'/')).some(f => f.includes('PROMES')));
  }
  for (const type of ['CP', 'ANALISIS_CP_TP', 'TP', 'ATP', 'PEMETAAN_ATP_UNIT', 'PROTA', 'KALENDER_AKADEMIK']) {
    assert(result.itemResults.some((r: any) => r.type === type && r.status === 'SUCCESS'));
  }
  assert.equal(files.filter(f => f.includes('/Administrasi_Umum/')).length, 16);
  assert.deepEqual(Object.keys(archive.files).filter(path => archive.files[path].dir).sort(), [
    root+'/', ...['PDF', 'WORD'].flatMap(format => [root+'/'+format+'/', ...['Administrasi_Umum','Semester_1','Semester_2'].map(scope => root+'/'+format+'/'+scope+'/')]),
  ].sort());
  failRpm = true;
  const partial = await exports.generateZipBundle({ types: ['MODUL_AJAR', 'RPM'], format: 'both' }, { ...base, skipDownload: true });
  assert.equal(partial.isComplete, false);
  assert.equal(partial.requestedCount, 12);
  assert.equal(partial.successCount, 6);
  assert.equal(partial.failedCount, 6);
  assert(partial.itemResults.filter((row: any) => row.type === 'RPM').every((row: any) => row.status === 'FAILED'));
  const partialZip = await JSZip.loadAsync(await partial.zipBlob.arrayBuffer());
  const report = Object.values(partialZip.files).find(entry => entry.name.endsWith('/Laporan_Ekspor.txt'));
  assert.match(await report!.async('string'), /TIDAK LENGKAP[\s\S]*Renderer RPM gagal/);
}
assert.equal(JSON.stringify(base), before);
console.log('PASS: readable root with separate PDF and Word trees, all validator-approved annual documents/calendar, six modules and six RPM, isolated PROMES, original validator skip reason, no generic status gate, immutable source and one ZIP download; renderer bytes simulated.');
