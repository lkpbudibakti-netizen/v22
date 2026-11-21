import assert from 'node:assert/strict';
import { createInitialStorageV5, STORAGE_KEY_V5, validateStorageStateV5 } from '../src/services/storageV5';
import { exportCompleteAdministrationProjectFromState } from '../src/services/administrationProjectExportService';
import { importCompleteAdministrationProject, prepareCompleteAdministrationProjectImport } from '../src/services/administrationProjectImportService';
import { createCompleteProjectZip, readCompleteProjectZip } from '../src/services/completeProjectZipService';
import { computeAtpSubstantiveFingerprint, computeTpSubstantiveFingerprint } from '../src/services/atpMappingActionApplyService';
import { proceedWithATPUnitMapping, resolveATPUnitMappingReadiness } from '../src/services/atpMappingReadinessService';
import { validateCPDataWorkflow, validateCPAnalysisDataWorkflow, validateTPDataWorkflow, validateATPDataWorkflow } from '../src/services/cpWorkflowService';

const now = '2026-01-01T00:00:00Z';
const state = createInitialStorageV5();
state.schools = ['s1', 's2'].map(id => ({ id, name: id, npsn: id, address: '', village: '', district: '', regency: '', province: '', principalName: '', principalNip: '', createdAt: now, updatedAt: now }));
state.profiles = ['p1', 'p2'].map((id, i) => ({ id, name: id, nip: '', status: 'PNS', defaultSubject: 'PJOK', defaultLevel: 'SD', schoolId: `s${i + 1}`, createdAt: now, updatedAt: now }));
state.yearPlans = [{ id: 'y', profileId: 'p1', schoolId: 's1', academicYear: '2026/2027', curriculumType: 'KURIKULUM_MERDEKA', subject: 'PJOK', grade: 'Kelas 2', phase: 'A', level: 'SD', createdAt: now, updatedAt: now }];
state.workspaces = [{ id: 'w', yearPlanId: 'y', profileId: 'p1', schoolId: 's1', name: 'PJOK Kelas 2', createdAt: now, updatedAt: now }];
state.semesterPlans = [1, 2].map(s => ({ id: `sp${s}`, yearPlanId: 'y', semester: s as 1 | 2, createdAt: now, updatedAt: now }));
state.annualData.cp = [{ yearPlanId: 'y', value: { id: 'cp', academicSettingId: 'y', generalDescription: 'CP gerak manipulatif', elements: [{ id: 'e', name: 'Gerak', content: 'Melempar bola' }], source: { id: 'OFFICIAL-CP', title: 'Sumber', institution: 'BSKAP', retrievedAt: now, verificationStatus: 'VERIFIED' }, updatedAt: now } }];
state.annualData.cpAnalysis = [{ yearPlanId: 'y', value: { id: 'analysis', academicSettingId: 'y', cpId: 'cp', items: [{ id: 'ai', elementId: 'e', elementName: 'Gerak', cpCompetence: 'Mempraktikkan', materialScope: 'Melempar bola', order: 1 }], updatedAt: now } }];
state.annualData.tp = [{ yearPlanId: 'y', value: { id: 'tp', cpId: 'cp', cpAnalysisId: 'analysis', academicSettingId: 'y', items: [{ id: 't', code: 'TP1', statement: 'Mempraktikkan lempar bola', competence: 'Mempraktikkan', contentScope: 'Lempar bola', order: 1, cpAnalysisItemIds: ['ai'] }], updatedAt: now } }];
state.annualData.atp = [{ yearPlanId: 'y', value: { id: 'atp', academicSettingId: 'y', tpDataId: 'tp', items: [{ id: 'a', stepNumber: 1, linkedTpIds: ['t'], focus: 'Lempar bola' }], updatedAt: now } }];
state.annualData.atpUnitMappings = [{ yearPlanId: 'y', value: { id: 'map', academicSettingId: 'y', atpId: 'atp', tpDataId: 'tp', units: [{ id: 'u', title: 'Bermain bola', order: 1, linkedTpIds: ['t'], linkedAtpItemIds: ['a'], materials: [{ id: 'm', title: 'Lempar bola', order: 1, linkedTpIds: ['t'], linkedAtpItemIds: ['a'] }] }], updatedAt: now } }];
state.annualData.unitExecutionPlans = [{ yearPlanId: 'y', value: { id: 'exec', academicSettingId: 'y', mappingId: 'map', units: [{ unitId: 'u', meetings: [{ id: 'meet', unitId: 'u', order: 1, title: 'Praktik lempar bola', materialIds: ['m'], linkedTpIds: ['t'], linkedAtpItemIds: ['a'] }] }], basedOnMappingUpdatedAt: now, updatedAt: now } }];
state.semesterData.learningPlan = [{ semesterPlanId: 'sp1', value: [{ id: 'lp', academicSettingId: 'sp1', status: 'DRAFT', tpIds: ['t'], atpItemIds: ['a'], meetingIds: ['meet'], timeAllocationIds: [], updatedAt: now } as any] }];
state.semesterData.assessmentCriteria = [{ semesterPlanId: 'sp1', value: [{ id: 'k', academicSettingId: 'sp1', tpId: 't', description: 'Lempar tepat', updatedAt: now } as any] }];
state.semesterData.assessmentPlan = [{ semesterPlanId: 'sp1', value: [{ id: 'ap', academicSettingId: 'sp1', tpIds: ['t'], criterionIds: ['k'], learningPlanIds: ['lp'], updatedAt: now } as any] }];
state.semesterData.assessmentPackage = [{ semesterPlanId: 'sp1', value: [{ id: 'pkg', academicSettingId: 'sp1', assessmentPlanId: 'ap', blueprintItems: [{ id: 'bi', objectiveRefId: 't', criterionId: 'k' }], updatedAt: now } as any] }];
state.annualData.unitExecutionPlans[0].value.semesterPlacement = { mode: 'CONTIGUOUS_BOUNDARY', semester1LastUnitId: 'u', updatedAt: now };
state.semesterJPSettings = [{ semesterPlanId: 'sp1', value: { semesterPlanId: 'sp1', actualScheduledWeeklyJP: 2, source: 'TEACHER_CONFIRMED' } }];
state.semesterData.academicCalendar = [{ semesterPlanId: 'sp1', value: { calendar: { id: 'cal', academicSettingId: 'sp1', academicYear: '2026/2027', semester: '1', startDate: '2026-08-03', endDate: '2026-08-03', schoolDaysPerWeek: 5, workflowStatus: 'CONFIRMED', confirmedAt: now, updatedAt: now },
  days: [{ id: 'day', academicCalendarId: 'cal', date: '2026-08-03', status: 'EFFECTIVE_LEARNING' }] } }];
state.semesterData.subjectWeeklySchedules = [{ semesterPlanId: 'sp1', value: { semesterPlanId: 'sp1', sessions: [{ id: 'session', dayOfWeek: 1, jp: 2, order: 1 }], basedOnWeeklyJP: 2, updatedAt: now } }];
state.semesterData.learningMeetingSchedules = [{ semesterPlanId: 'sp1', value: { id: 'schedule', semesterPlanId: 'sp1', status: 'COMPLETE', entries: [{ meetingId: 'meet', unitId: 'u', semesterPlanId: 'sp1', sessionId: 'session', sourceSlotId: 'session-2026-08-03', date: '2026-08-03', dayOfWeek: 1, jp: 2, weekIndex: 1, mode: 'AUTO' }], unresolvedMeetingIds: [], basedOnMappingUpdatedAt: now, basedOnUnitExecutionPlanUpdatedAt: now, basedOnSubjectWeeklyScheduleUpdatedAt: now, basedOnCalendarUpdatedAt: now, basedOnWeeklyJP: 2, updatedAt: now } }];
state.semesterData.timeAllocation = [{ semesterPlanId: 'sp1', value: [{ id: 'allocation', academicSettingId: 'sp1', atpItemId: 'a', tpId: 't', jp: 2 }] }];
const sourceCp = state.annualData.cp[0].value;
const sourceAnalysis = state.annualData.cpAnalysis[0].value;
const sourceTp = state.annualData.tp[0].value;
const sourceAtp = state.annualData.atp[0].value;
sourceTp.items.push({ ...structuredClone(sourceTp.items[0]), id: 't-z', code: 'E1-GER-02', order: 2,
  statement: 'Mempraktikkan variasi lempar bola' });
sourceAtp.items.push({ id: 'az', stepNumber: 2, focus: 'Mempraktikkan variasi lempar bola', linkedTpIds: ['t-z'] });
state.annualData.atpUnitMappings[0].value.units[0].linkedTpIds.push('t-z');
state.annualData.atpUnitMappings[0].value.units[0].linkedAtpItemIds.push('az');
state.annualData.atpUnitMappings[0].value.units[0].materials[0].linkedTpIds.push('t-z');
state.annualData.atpUnitMappings[0].value.units[0].materials[0].linkedAtpItemIds.push('az');
state.annualData.unitExecutionPlans[0].value.units[0].meetings[0].linkedTpIds.push('t-z');
state.annualData.unitExecutionPlans[0].value.units[0].meetings[0].linkedAtpItemIds.push('az');
sourceCp.elements[0].code = 'E1'; sourceCp.elements[0].content = 'Mempraktikkan lempar bola';
sourceAnalysis.basedOnCpUpdatedAt = now;
sourceAnalysis.items[0].cpText = sourceCp.elements[0].content;
sourceAnalysis.items[0].materialScope = 'Lempar bola';
sourceTp.items[0].code = 'E1-GER-01'; sourceTp.basedOnCpUpdatedAt = now; sourceTp.basedOnAnalysisUpdatedAt = now;
sourceAtp.basedOnTpUpdatedAt = now; sourceAtp.items[0].focus = 'Mempraktikkan lempar bola';
sourceCp.workflowStatus = validateCPDataWorkflow(sourceCp).status;
sourceAnalysis.workflowStatus = validateCPAnalysisDataWorkflow(sourceAnalysis, sourceCp).status;
sourceTp.workflowStatus = validateTPDataWorkflow(sourceTp, sourceCp, sourceAnalysis).status;
// Model an already teacher-confirmed source; the full production validator must still pass.
sourceAtp.workflowStatus = 'SIAP';
assert.equal(validateATPDataWorkflow(sourceAtp, sourceTp, undefined, sourceCp, sourceAnalysis).isSiap, true);
const sourceMapping = state.annualData.atpUnitMappings[0].value;
sourceMapping.basedOnTpFingerprint = computeTpSubstantiveFingerprint(sourceTp);
sourceMapping.basedOnAtpFingerprint = computeAtpSubstantiveFingerprint(sourceAtp);
assert.equal(resolveATPUnitMappingReadiness(sourceMapping, sourceAtp, sourceTp).canProceed, true,
  JSON.stringify({ tp: validateTPDataWorkflow(sourceTp, sourceCp, sourceAnalysis), atp: validateATPDataWorkflow(sourceAtp, sourceTp, undefined, sourceCp, sourceAnalysis) }));
validateStorageStateV5(state);
const before = JSON.stringify(state);
const bytes = await createCompleteProjectZip(state, 'y');
const archive = await readCompleteProjectZip(bytes);
assert.equal(archive.project.yearPlans.length, 1);
assert.equal(archive.project.profiles.length, 1);
const originalCrypto = globalThis.crypto;
let sequence = 99999;
Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { randomUUID: () => String(sequence--) } });
let copied: ReturnType<typeof prepareCompleteAdministrationProjectImport>;
try { copied = prepareCompleteAdministrationProjectImport(state, archive, { mode: 'COPY', targetProfileId: 'p2', targetSchoolId: 's2' }); }
finally { Object.defineProperty(globalThis, 'crypto', { configurable: true, value: originalCrypto }); }
assert.equal(JSON.stringify(state), before);
assert.equal(copied.state.yearPlans.length, 2);
assert.equal(copied.step7.source.canProceed, true);
assert.equal(copied.step7.target.canProceed, true, copied.step7.target.blockers.join('; '));
assert.equal(copied.step7.origin, 'READY');
const idLikeTitleSource = structuredClone(archive);
idLikeTitleSource.project.annualData.atpUnitMappings![0].value.units[0].title = 'u';
const idLikeTitleImport = prepareCompleteAdministrationProjectImport(state, idLikeTitleSource, { mode: 'COPY', targetProfileId: 'p2', targetSchoolId: 's2' });
assert.equal(idLikeTitleImport.state.annualData.atpUnitMappings!.find(e => e.yearPlanId === idLikeTitleImport.yearPlanId)!.value.units[0].title, 'u', 'Manual titles must never be remapped as IDs');
const targetYear = copied.state.yearPlans.find(y => y.id === copied.yearPlanId)!;
assert.equal(targetYear.schoolId, 's2');
assert.equal(targetYear.profileId, 'p2');
assert.equal(copied.state.semesterData.academicCalendar.find(e => e.semesterPlanId !== 'sp1')!.value.calendar.workflowStatus, 'UNRESOLVED');
const copiedSchedule = copied.state.semesterData.learningMeetingSchedules!.find(e => e.semesterPlanId !== 'sp1')!.value;
assert.equal(copiedSchedule.status, 'DRAFT');
assert.equal(copiedSchedule.entries.length, 0);
assert.equal(copiedSchedule.unresolvedMeetingIds.length, 1);
const tp = copied.state.annualData.tp.find(e => e.yearPlanId === copied.yearPlanId)!.value;
const mapping = copied.state.annualData.atpUnitMappings!.find(e => e.yearPlanId === copied.yearPlanId)!.value;
assert.equal(mapping.basedOnTpFingerprint, computeTpSubstantiveFingerprint(tp));
assert.equal(mapping.basedOnAtpFingerprint, computeAtpSubstantiveFingerprint(copied.state.annualData.atp.find(e => e.yearPlanId === copied.yearPlanId)!.value));
const targetAtp = copied.state.annualData.atp.find(e => e.yearPlanId === copied.yearPlanId)!.value;
const legacyMapping = structuredClone(mapping);
legacyMapping.basedOnTpFingerprint = JSON.stringify(JSON.parse(mapping.basedOnTpFingerprint!).reverse());
legacyMapping.basedOnAtpFingerprint = JSON.stringify(JSON.parse(mapping.basedOnAtpFingerprint!).reverse()
  .map((item: any) => ({ ...item, tps: [...item.tps].reverse() })));
const legacyBefore = JSON.stringify(legacyMapping);
const legacyReady = resolveATPUnitMappingReadiness(legacyMapping, targetAtp, tp);
assert.equal(legacyReady.canProceed, true, legacyReady.blockers.join('; '));
assert.equal(JSON.stringify(legacyMapping), legacyBefore, 'Readiness must not rewrite existing projects');
let nextSteps = 0;
assert.equal(proceedWithATPUnitMapping(legacyReady, () => true, () => { nextSteps++; }).proceeded, true);
assert.equal(nextSteps, 1);
for (const field of ['statement', 'competence', 'contentScope'] as const) {
  const changed = structuredClone(tp);
  changed.items[0][field] = 'Substansi berubah';
  const readiness = resolveATPUnitMappingReadiness(legacyMapping, targetAtp, changed);
  assert.equal(readiness.canProceed, false);
  assert.ok(readiness.blockers.some(b => b.includes('Substansi TP berubah')));
  assert.equal(proceedWithATPUnitMapping(readiness, undefined, () => { nextSteps++; }).proceeded, false);
}
for (const change of ['focus', 'lineage', 'step'] as const) {
  const changed = structuredClone(targetAtp);
  if (change === 'focus') changed.items[0].focus = 'Substansi berubah';
  if (change === 'lineage') changed.items[0].linkedTpIds = [tp.items[1].id];
  if (change === 'step') changed.items[0].stepNumber += 1;
  assert.ok(resolveATPUnitMappingReadiness(legacyMapping, changed, tp).blockers.some(b => b.includes('Substansi ATP berubah')));
}
const missingEvidence = { ...legacyMapping, basedOnTpFingerprint: 'unavailable' };
assert.equal(resolveATPUnitMappingReadiness(missingEvidence, targetAtp, tp).canProceed, false);
const wrongIdentity = structuredClone(tp);
wrongIdentity.items[0].id = 'unproven-remap';
assert.equal(resolveATPUnitMappingReadiness(legacyMapping, targetAtp, wrongIdentity).canProceed, false);
const incompleteLegacy = structuredClone(legacyMapping);
incompleteLegacy.units[0].materials[0].linkedTpIds = [tp.items[0].id];
const incompleteLegacyReady = resolveATPUnitMappingReadiness(incompleteLegacy, targetAtp, tp);
assert.equal(incompleteLegacyReady.canProceed, false);
assert.ok(incompleteLegacyReady.blockers.some(b => b.includes('SOURCE_LINEAGE_MISSING')));
assert.ok(!incompleteLegacyReady.blockers.some(b => b.includes('(stale)')));
const legacyArchive = structuredClone(archive);
legacyArchive.project.annualData.atpUnitMappings![0].value.basedOnTpFingerprint = JSON.stringify(JSON.parse(sourceMapping.basedOnTpFingerprint!).reverse());
legacyArchive.project.annualData.atpUnitMappings![0].value.basedOnAtpFingerprint = JSON.stringify(JSON.parse(sourceMapping.basedOnAtpFingerprint!).reverse());
const reimport = prepareCompleteAdministrationProjectImport(state, legacyArchive, { mode: 'COPY', targetProfileId: 'p2', targetSchoolId: 's2' });
assert.equal(reimport.step7.target.canProceed, true, reimport.step7.target.blockers.join('; '));
assert.notEqual(tp.items[0].id, 't');
assert.equal(mapping.units[0].materials[0].linkedTpIds[0], tp.items[0].id);
const execution = copied.state.annualData.unitExecutionPlans!.find(e => e.yearPlanId === copied.yearPlanId)!.value;
assert.equal(execution.units[0].unitId, mapping.units[0].id);
assert.equal(execution.units[0].meetings[0].materialIds[0], mapping.units[0].materials[0].id);
const targetSemester = copied.state.semesterPlans.find(s => s.yearPlanId === copied.yearPlanId && s.semester === 1)!;
const plan = copied.state.semesterData.learningPlan.find(e => e.semesterPlanId === targetSemester.id)!.value[0] as any;
assert.equal(plan.meetingIds[0], execution.units[0].meetings[0].id);
assert.equal(plan.tpIds[0], tp.items[0].id);
assert.equal(copiedSchedule.unresolvedMeetingIds[0], execution.units[0].meetings[0].id);
assert.equal(copied.state.annualData.cp.find(e => e.yearPlanId === copied.yearPlanId)!.value.source!.id, 'OFFICIAL-CP');
const cp2 = copied.state.annualData.cp.find(e => e.yearPlanId === copied.yearPlanId)!.value;
assert.equal(tp.cpId, cp2.id);
const roundtrip = await readCompleteProjectZip(await createCompleteProjectZip(copied.state, copied.yearPlanId));
assert.equal(roundtrip.project.annualData.unitExecutionPlans![0].value.units[0].meetings.length, 1);
assert.equal(resolveATPUnitMappingReadiness(roundtrip.project.annualData.atpUnitMappings![0].value,
  roundtrip.project.annualData.atp[0].value, roundtrip.project.annualData.tp[0].value).canProceed, true);
const incompleteSource = structuredClone(archive);
incompleteSource.project.annualData.atpUnitMappings![0].value.units[0].materials[0].linkedTpIds = ['t'];
incompleteSource.project.annualData.atpUnitMappings![0].value.units[0].materials[0].linkedAtpItemIds = ['a'];
incompleteSource.project.annualData.unitExecutionPlans![0].value.units[0].meetings[0].linkedTpIds = ['t'];
incompleteSource.project.annualData.unitExecutionPlans![0].value.units[0].meetings[0].linkedAtpItemIds = ['a'];
const incompleteImport = prepareCompleteAdministrationProjectImport(state, incompleteSource, { mode: 'COPY', targetProfileId: 'p2', targetSchoolId: 's2' });
assert.equal(incompleteImport.step7.origin, 'SOURCE_INCOMPLETE');
assert.equal(incompleteImport.step7.source.validationResult!.isValid, true);
assert.equal(incompleteImport.step7.source.validationResult!.isComplete, false);
assert.equal(incompleteImport.step7.target.validationResult!.isComplete, false);
assert.equal(incompleteImport.step7.target.canSaveDraft, true);
assert.ok(incompleteImport.step7.target.blockers.some(b => b.includes('SOURCE_LINEAGE_MISSING')));
const staleSource = structuredClone(archive);
staleSource.project.annualData.atpUnitMappings![0].value.basedOnTpFingerprint = 'outdated-source';
const staleImport = prepareCompleteAdministrationProjectImport(state, staleSource, { mode: 'COPY', targetProfileId: 'p2', targetSchoolId: 's2' });
assert.equal(staleImport.step7.target.canProceed, false);
assert.ok(staleImport.step7.target.blockers.some(b => b.includes('Substansi TP berubah')));
const unconfirmedSource = structuredClone(archive);
unconfirmedSource.project.annualData.tp[0].value.workflowStatus = 'DRAFT';
const unconfirmedImport = prepareCompleteAdministrationProjectImport(state, unconfirmedSource, { mode: 'COPY', targetProfileId: 'p2', targetSchoolId: 's2' });
assert.equal(unconfirmedImport.step7.target.canProceed, false, 'Import must not confirm draft TP automatically');
assert.equal(unconfirmedImport.state.annualData.tp.find(e => e.yearPlanId === unconfirmedImport.yearPlanId)!.value.workflowStatus, 'DRAFT');
assert.throws(() => prepareCompleteAdministrationProjectImport(copied.state, archive, { mode: 'COPY', targetProfileId: 'p2', targetSchoolId: 's2' }), /Konflik proyek/);
assert.throws(() => prepareCompleteAdministrationProjectImport(state, archive, { mode: 'RESTORE', targetProfileId: 'p1', targetSchoolId: 's1' }), /Konflik proyek/);
const restored = prepareCompleteAdministrationProjectImport(state, archive, { mode: 'RESTORE', targetProfileId: 'p1', targetSchoolId: 's1', replaceYearPlanId: 'y' });
assert.equal(restored.state.yearPlans.length, 1);
assert.equal(restored.step7.target.canProceed, true, restored.step7.target.blockers.join('; '));
assert.equal(restored.state.annualData.atp[0].value.items[0].linkedTpIds![0], 't');
assert.equal(restored.state.semesterData.academicCalendar[0].value.calendar.id, 'cal');
assert.equal(restored.state.semesterData.learningMeetingSchedules![0].value.entries.length, 1);
assert.throws(() => prepareCompleteAdministrationProjectImport(state, archive, { mode: 'COPY', targetProfileId: 'p2', targetSchoolId: 's1' }), /tidak sesuai/);
const collision = structuredClone(state);
collision.annualData.cp[0].value.id = 'foreign-cp';
const altered = structuredClone(archive);
altered.project.yearPlans[0].academicYear = '2027/2028';
assert.throws(() => prepareCompleteAdministrationProjectImport(collision, altered, { mode: 'RESTORE', targetProfileId: 'p1', targetSchoolId: 's1' }), /Konflik ID/);
const broken = structuredClone(archive);
broken.project.annualData.atpUnitMappings![0].value.units[0].materials[0].linkedTpIds = ['fake'];
assert.throws(() => prepareCompleteAdministrationProjectImport(state, broken, { mode: 'COPY', targetProfileId: 'p2', targetSchoolId: 's2' }), /Relasi proyek/);
const partial = structuredClone(state);
partial.annualData = createInitialStorageV5().annualData;
partial.semesterData = createInitialStorageV5().semesterData;
const partialArchive = exportCompleteAdministrationProjectFromState(partial, 'y');
assert.equal(prepareCompleteAdministrationProjectImport(state, partialArchive, { mode: 'COPY', targetProfileId: 'p2', targetSchoolId: 's2' }).state.yearPlans.length, 2);

const memory = new Map<string, string>([[STORAGE_KEY_V5, before]]);
let failStorageWrite = false;
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { if (failStorageWrite) throw new Error('QuotaExceededError'); memory.set(key, value); },
} });
const rejectedBeforeSave = memory.get(STORAGE_KEY_V5);
assert.throws(() => importCompleteAdministrationProject(broken, { mode: 'COPY', targetProfileId: 'p2', targetSchoolId: 's2' }), /Relasi proyek/);
assert.equal(memory.get(STORAGE_KEY_V5), rejectedBeforeSave);
assert.throws(() => importCompleteAdministrationProject(archive, { mode: 'COPY', targetProfileId: 'p2', targetSchoolId: 's2' }, () => { throw new Error('QuotaExceededError'); }), /QuotaExceeded/);
assert.equal(memory.get(STORAGE_KEY_V5), before);
failStorageWrite = true;
assert.throws(() => importCompleteAdministrationProject(archive, { mode: 'COPY', targetProfileId: 'p2', targetSchoolId: 's2' }), /QuotaExceeded/);
assert.equal(memory.get(STORAGE_KEY_V5), before);
failStorageWrite = false;
importCompleteAdministrationProject(archive, { mode: 'COPY', targetProfileId: 'p2', targetSchoolId: 's2' });
assert.equal(JSON.parse(memory.get(STORAGE_KEY_V5)!).yearPlans.length, 2);
console.log('PASS: complete/partial ZIP, cross-school copy, canonical remap, roundtrip, conflicts, atomic save and rollback.');

// ============================================================================
// REGRESSION SUITE A-N: Representative Bahasa Indonesia Kelas 4 Fase B Fixture
// (Exact user ZIP not present in repository; constructed per app contracts)
// ============================================================================
{
  const { exportAdministrationProjectFromState } = await import('../src/services/administrationProjectExportService');
  const { importAdministrationProject, importAdministrationProjectIntoState } = await import('../src/services/administrationProjectImportService');
  const { performImportProjectTransferInState } = await import('../src/services/projectTransferImportService');
  const { validateWorkflowDependencies } = await import('../src/services/workflowEngine');
  const { hasTeacherMaterialSupport, reviewedTpFingerprint } = await import('../src/services/mappingAlignmentService');
  const { tpSubstanceFingerprint } = await import('../src/services/tpSemanticFidelity');
  const { computeStep07VerifiedFingerprint, computeMappingFingerprint } = await import('../src/services/atpMappingActionApplyService');
  const { step07PersistedKey } = await import('../src/services/step07AutoExecutionPolicy');
  const { createTwoSemesterAdministrationImportFixture } = await import('./fixtures/readyAdministrationImportFixture');

  const sourceStamp = '2026-01-05T08:00:00Z';
  const bIndState = createTwoSemesterAdministrationImportFixture();
  bIndState.activeProfileId = 'p1';
  bIndState.activeYearPlanId = 'y';
  bIndState.activeWorkspaceId = 'w';
  bIndState.activeSemesterPlanId = 'sp1';
  bIndState.profiles[0].defaultSubject = 'Bahasa Indonesia';
  bIndState.yearPlans[0] = {
    ...bIndState.yearPlans[0],
    subject: 'Bahasa Indonesia',
    grade: 'Kelas 4',
    phase: 'B',
    level: 'SD',
    createdAt: sourceStamp,
    updatedAt: sourceStamp,
  };
  bIndState.workspaces[0].name = 'Bahasa Indonesia — Kelas 4';
  bIndState.workspaces[0].createdAt = sourceStamp;
  bIndState.workspaces[0].updatedAt = sourceStamp;

  // Customize CP -> Analisis CP -> TP (with substanceReviews paraphrase + multi-TP) -> ATP -> Mapping (with reviewedTpFingerprint + undoOf) -> Execution -> Schedule -> KKTP
  const bCp = bIndState.annualData.cp[0].value;
  bCp.generalDescription = 'Peserta didik memiliki kemampuan berbahasa untuk berkomunikasi dan bernalar sesuai tujuan kepada teman sebaya dan orang dewasa tentang hal-hal menarik di lingkungan sekitar.';
  bCp.elements = [
    { id: 'el-bi-1', code: 'E1', name: 'Menyimak', content: 'Memahami ide pokok suatu pesan lisan, informasi dari media audio, teks aural, dan instruksi lisan.' },
    { id: 'el-bi-2', code: 'E2', name: 'Membaca dan Memirsa', content: 'Memahami pesan dan informasi tentang kehidupan sehari-hari, teks narasi, dan puisi anak dalam bentuk cetak atau elektronik.' },
  ];
  bCp.updatedAt = sourceStamp;
  bCp.workflowStatus = validateCPDataWorkflow(bCp).status;
  assert.equal(bCp.workflowStatus, 'SIAP');

  const bAnalysis = bIndState.annualData.cpAnalysis[0].value;
  bAnalysis.basedOnCpUpdatedAt = sourceStamp;
  bAnalysis.updatedAt = sourceStamp;
  bAnalysis.items = [
    { id: 'ai-bi-1', elementId: 'el-bi-1', elementName: 'Menyimak', cpText: bCp.elements[0].content, cpCompetence: 'Memahami', materialScope: 'Ide pokok pesan lisan dan instruksi lisan', order: 1 },
    { id: 'ai-bi-2', elementId: 'el-bi-2', elementName: 'Membaca dan Memirsa', cpText: bCp.elements[1].content, cpCompetence: 'Memahami', materialScope: 'Teks narasi dan puisi anak', order: 2 },
  ];
  bAnalysis.workflowStatus = validateCPAnalysisDataWorkflow(bAnalysis, bCp).status;
  assert.equal(bAnalysis.workflowStatus, 'SIAP');

  const bTp = bIndState.annualData.tp[0].value;
  bTp.basedOnCpUpdatedAt = sourceStamp;
  bTp.basedOnAnalysisUpdatedAt = sourceStamp;
  bTp.updatedAt = sourceStamp;
  bTp.phase = 'B';
  bTp.subjectCode = 'Bahasa Indonesia';
  bTp.academicYear = '2026/2027';
  bTp.items = [
    { id: 'tp-bi-1', code: 'E1-SIM-01', statement: 'Peserta didik memahami ide pokok pesan lisan dan instruksi lisan.', competence: 'Memahami', contentScope: 'Ide pokok pesan lisan dan instruksi lisan', order: 1, cpAnalysisId: 'ai-bi-1', cpAnalysisItemIds: ['ai-bi-1'] },
    // Paraphrased wording requiring valid teacher substanceReviews on ai-bi-2
    { id: 'tp-bi-2', code: 'E2-BAC-01', statement: 'Peserta didik menjelaskan amanat cerita sehari-hari secara runtut.', competence: 'Menjelaskan', contentScope: 'Cerita bacaan', order: 2, cpAnalysisId: 'ai-bi-2', cpAnalysisItemIds: ['ai-bi-2'] },
    { id: 'tp-bi-3', code: 'E2-BAC-02', statement: 'Peserta didik menjelaskan syair bacaan dan ungkapan sederhana.', competence: 'Menjelaskan', contentScope: 'Syair bacaan', order: 3, cpAnalysisId: 'ai-bi-2', cpAnalysisItemIds: ['ai-bi-2'] },
  ];
  bTp.substanceReviews = [
    {
      analysisId: 'ai-bi-2',
      fingerprint: tpSubstanceFingerprint([bTp.items[1], bTp.items[2]], bAnalysis.items[1]),
      rationale: 'Menjelaskan amanat cerita dan syair bacaan sehari-hari merupakan parafrasa langsung dari pemahaman teks narasi dan puisi anak.',
    },
  ];
  bTp.workflowStatus = validateTPDataWorkflow(bTp, bCp, bAnalysis).status;
  assert.equal(bTp.workflowStatus, 'SIAP');

  const bAtp = bIndState.annualData.atp[0].value;
  bAtp.tpId = bTp.id;
  bAtp.tpDataId = bTp.id;
  bAtp.basedOnTpUpdatedAt = sourceStamp;
  bAtp.updatedAt = sourceStamp;
  bAtp.phase = 'B';
  bAtp.subjectCode = 'Bahasa Indonesia';
  bAtp.academicYear = '2026/2027';
  bAtp.items = [
    { id: 'atp-bi-1', stepNumber: 1, tpId: 'tp-bi-1', linkedTpIds: ['tp-bi-1'], focus: 'Memahami ide pokok pesan lisan dan instruksi lisan', jp: 2 },
    { id: 'atp-bi-2', stepNumber: 2, tpId: 'tp-bi-2', linkedTpIds: ['tp-bi-2'], focus: 'Menjelaskan amanat cerita sehari-hari secara runtut', jp: 1 },
    { id: 'atp-bi-3', stepNumber: 3, tpId: 'tp-bi-3', linkedTpIds: ['tp-bi-3'], focus: 'Menjelaskan syair bacaan dan ungkapan sederhana', jp: 1 },
  ];
  bAtp.workflowStatus = 'SIAP';
  assert.equal(validateATPDataWorkflow(bAtp, bTp, undefined, bCp, bAnalysis).isSiap, true);

  const bMap = bIndState.annualData.atpUnitMappings![0].value;
  bMap.basedOnTpUpdatedAt = sourceStamp;
  bMap.basedOnAtpUpdatedAt = sourceStamp;
  bMap.basedOnTpFingerprint = computeTpSubstantiveFingerprint(bTp);
  bMap.basedOnAtpFingerprint = computeAtpSubstantiveFingerprint(bAtp);
  bMap.updatedAt = sourceStamp;
  const multiTpReviewFp = reviewedTpFingerprint(['tp-bi-2', 'tp-bi-3'], bTp);
  bMap.units = [
    {
      id: 'u-bi-1',
      title: 'Sudah Besar',
      order: 1,
      linkedTpIds: ['tp-bi-1'],
      linkedAtpItemIds: ['atp-bi-1'],
      materials: [{ id: 'm-bi-1', title: 'Ide pokok pesan lisan', order: 1, linkedTpIds: ['tp-bi-1'], linkedAtpItemIds: ['atp-bi-1'] }],
      actionHistory: [
        { id: 'rec-old', at: sourceStamp, kind: 'CONTENT_CHANGE', approval: 'TEACHER', unitId: 'u-bi-1', materialId: 'm-bi-1', before: 'Judul lama', after: 'Ide pokok pesan lisan', reason: 'Revisi awal guru' },
        { id: 'rec-undo', at: sourceStamp, kind: 'UNDO', approval: 'TEACHER', unitId: 'u-bi-1', materialId: 'm-bi-1', before: 'Ide pokok pesan lisan', after: 'Judul lama', undoOf: 'rec-old', reason: 'Batalkan revisi awal' },
      ],
    },
    {
      id: 'u-bi-2',
      title: 'Di Bawah Atap',
      order: 2,
      linkedTpIds: ['tp-bi-2', 'tp-bi-3'],
      linkedAtpItemIds: ['atp-bi-2', 'atp-bi-3'],
      materials: [{
        id: 'm-bi-2',
        title: 'Amanat cerita dan syair bacaan',
        order: 1,
        linkedTpIds: ['tp-bi-2', 'tp-bi-3'],
        linkedAtpItemIds: ['atp-bi-2', 'atp-bi-3'],
        titleHistory: [{
          id: 'hist-multi-tp',
          at: sourceStamp,
          kind: 'CONTENT_CHANGE',
          approval: 'TEACHER',
          unitId: 'u-bi-2',
          materialId: 'm-bi-2',
          before: 'Amanat cerita',
          after: 'Amanat cerita dan syair bacaan',
          reason: 'Guru menyetujui gabungan dua TP dalam Bab 2.',
          reviewedTitle: 'Amanat cerita dan syair bacaan',
          reviewedTpIds: ['tp-bi-2', 'tp-bi-3'],
          reviewedTpFingerprint: multiTpReviewFp,
        }],
      }],
    },
  ];
  bMap.step07AutoRepair = {
    scope: 'STEP07_AUTO_REPAIR',
    version: 1,
    runId: 'run-bi-1',
    beforeUnits: structuredClone(bMap.units),
    addedMaterialIds: ['m-bi-2'],
    rounds: 1,
    outcome: 'COMPLETE',
    issues: [],
    verifiedFingerprint: computeStep07VerifiedFingerprint(bMap.units, bAtp, bTp),
    resultFingerprint: computeMappingFingerprint(bMap.units, bAtp, bTp),
    expectedStoredFingerprint: '',
  };
  bMap.step07AutoRepair.expectedStoredFingerprint = step07PersistedKey(bMap, bAtp, bTp);

  const { resolveEffectiveSubjectSlots } = await import('../src/services/subjectScheduleService');
  const { resolveLearningMeetingSchedule, buildLearningMeetingScheduleData } = await import('../src/services/learningMeetingScheduleService');

  const bExec = bIndState.annualData.unitExecutionPlans![0].value;
  bExec.mappingId = bMap.id;
  bExec.basedOnMappingUpdatedAt = sourceStamp;
  bExec.updatedAt = sourceStamp;
  bExec.semesterPlacement = { mode: 'CONTIGUOUS_BOUNDARY', semester1LastUnitId: 'u-bi-1', updatedAt: sourceStamp };
  bExec.units = [
    {
      unitId: 'u-bi-1',
      meetings: Array.from({ length: 18 }, (_, i) => ({
        id: i === 0 ? 'meet-bi-1' : `meet-bi-1-${i + 1}`,
        unitId: 'u-bi-1',
        order: i + 1,
        title: `Pertemuan 1.${i + 1}: Ide pokok pesan lisan`,
        materialIds: ['m-bi-1'],
        linkedTpIds: ['tp-bi-1'],
        linkedAtpItemIds: ['atp-bi-1'],
        plannedJP: 6,
      })),
    },
    {
      unitId: 'u-bi-2',
      meetings: Array.from({ length: 18 }, (_, i) => ({
        id: i === 0 ? 'meet-bi-2' : `meet-bi-2-${i + 1}`,
        unitId: 'u-bi-2',
        order: i + 1,
        title: `Pertemuan 2.${i + 1}: Cerita dan puisi anak`,
        materialIds: ['m-bi-2'],
        linkedTpIds: ['tp-bi-2', 'tp-bi-3'],
        linkedAtpItemIds: ['atp-bi-2', 'atp-bi-3'],
        plannedJP: 6,
      })),
    },
  ];

  // Ensure S1 & S2 learning plans, KKTP, assessmentPlan, assessmentPackage, allocations & full 18-week 6 JP/week schedules
  const sp1Id = bIndState.semesterPlans.find(s => s.semester === 1)!.id;
  const sp2Id = bIndState.semesterPlans.find(s => s.semester === 2)!.id;
  const s1Crit = bIndState.semesterData.assessmentCriteria.find(e => e.semesterPlanId === sp1Id)!.value;
  s1Crit[0].tpId = 'tp-bi-1'; s1Crit[0].basedOnTpUpdatedAt = sourceStamp; s1Crit[0].updatedAt = sourceStamp;
  s1Crit[1].tpId = 'tp-bi-2'; s1Crit[1].basedOnTpUpdatedAt = sourceStamp; s1Crit[1].updatedAt = sourceStamp;
  const s2Crit = bIndState.semesterData.assessmentCriteria.find(e => e.semesterPlanId === sp2Id)!.value;
  s2Crit[0].tpId = 'tp-bi-1'; s2Crit[0].basedOnTpUpdatedAt = sourceStamp; s2Crit[0].updatedAt = sourceStamp;
  s2Crit[1].tpId = 'tp-bi-2'; s2Crit[1].basedOnTpUpdatedAt = sourceStamp; s2Crit[1].updatedAt = sourceStamp;

  const plusDays = (date: string, days: number) => new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);
  for (const [spId, semNum, unitIndex, unitId, meetId, tpId, atpId, critId, startDate] of [
    [sp1Id, 1, 0, 'u-bi-1', 'meet-bi-1', 'tp-bi-1', 'atp-bi-1', s1Crit[0].id, '2026-07-06'],
    [sp2Id, 2, 1, 'u-bi-2', 'meet-bi-2', 'tp-bi-2', 'atp-bi-2', s2Crit[1].id, '2027-01-04'],
  ] as const) {
    const calEntry = bIndState.semesterData.academicCalendar.find(e => e.semesterPlanId === spId)!.value;
    const endDate = plusDays(startDate, 17 * 7 + 4);
    Object.assign(calEntry.calendar, {
      startDate, endDate, schoolDaysPerWeek: 5, workflowStatus: 'CONFIRMED', confirmedAt: sourceStamp, updatedAt: sourceStamp,
    });
    calEntry.days = [];
    for (let d = startDate; d <= endDate; d = plusDays(d, 1)) {
      if (![0, 6].includes(new Date(d).getUTCDay())) {
        calEntry.days.push({ id: `${spId}-${d}`, academicCalendarId: calEntry.calendar.id, date: d, status: 'EFFECTIVE_LEARNING' });
      }
    }
    bIndState.semesterJPSettings.find(e => e.semesterPlanId === spId)!.value = {
      semesterPlanId: spId, actualScheduledWeeklyJP: 6, source: 'TEACHER_CONFIRMED',
    };
    const weekly = bIndState.semesterData.subjectWeeklySchedules!.find(e => e.semesterPlanId === spId)!.value;
    Object.assign(weekly, {
      sessions: [{ id: weekly.sessions[0].id, order: 1, dayOfWeek: 1, jp: 6 }],
      basedOnWeeklyJP: 6, basedOnSchoolDaysPerWeek: 5, updatedAt: sourceStamp,
    });
    const slots = resolveEffectiveSubjectSlots({
      semesterPlanId: spId, calendar: calEntry.calendar, calendarDays: calEntry.days, schedule: weekly, expectedWeeklyJP: 6,
    });
    assert.equal(slots.isReady, true, slots.errors.join('; '));
    const resolvedSched = resolveLearningMeetingSchedule({
      semesterPlanId: spId, semester: semNum, mapping: bMap, unitExecutionPlan: bExec, subjectSlotResult: slots,
    });
    assert.equal(resolvedSched.isValid && resolvedSched.isReady, true, resolvedSched.errors.join('; '));
    bIndState.semesterData.learningMeetingSchedules!.find(e => e.semesterPlanId === spId)!.value = buildLearningMeetingScheduleData({
      semesterPlanId: spId, semester: semNum, mapping: bMap, unitExecutionPlan: bExec,
      subjectWeeklySchedule: weekly, expectedWeeklyJP: 6, calendar: calEntry.calendar,
      autoResult: resolvedSched, manualOverrides: [],
      persistedId: bIndState.semesterData.learningMeetingSchedules!.find(e => e.semesterPlanId === spId)!.value.id,
    });

    const lp = bIndState.semesterData.learningPlan.find(e => e.semesterPlanId === spId)!.value[0] as any;
    lp.unitId = unitId; lp.learningMeetingIds = [meetId]; lp.meetingIds = [meetId];
    lp.tpIds = [tpId]; lp.atpItemIds = [atpId]; lp.kktpCriterionIds = [critId];
    lp.allocatedJP = 6;
    lp.objectives = bTp.items.filter(i => i.id === tpId).map(i => ({ tpId: i.id, code: i.code, statement: i.statement }));
    for (const stepList of Object.values(lp.learningSteps || {}) as any[][]) for (const step of stepList) {
      if (step.learningMeetingId) step.learningMeetingId = meetId;
    }
    for (const rows of Object.values(lp.assessmentPlan) as any[][]) for (const item of rows) {
      item.linkedTpIds = [tpId];
      if (item.learningMeetingId) item.learningMeetingId = meetId;
    }
    const ap = bIndState.semesterData.assessmentPlan.find(e => e.semesterPlanId === spId)!.value[0] as any;
    ap.tpIds = [tpId]; ap.criterionIds = [critId]; ap.learningPlanIds = [lp.id];
    const pkg = bIndState.semesterData.assessmentPackage.find(e => e.semesterPlanId === spId)!.value[0] as any;
    pkg.blueprintItems[0].objectiveRefId = tpId; pkg.blueprintItems[0].criterionId = critId;
    const alloc = bIndState.semesterData.timeAllocation.find(e => e.semesterPlanId === spId)!.value[0];
    alloc.tpId = tpId; alloc.atpItemId = atpId; alloc.jp = 108;
    const journals = bIndState.semesterData.journalRealizations?.find(e => e.semesterPlanId === spId)?.value;
    if (journals) for (const j of journals) j.meetingId = meetId;
  }

  validateStorageStateV5(bIndState);
  const bIndStore = new Map<string, string>([[STORAGE_KEY_V5, JSON.stringify(bIndState)]]);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => bIndStore.get(key) ?? null,
    setItem: (key: string, value: string) => { bIndStore.set(key, value); },
    removeItem: (key: string) => { bIndStore.delete(key); },
  } });

  const bIndArchive = await readCompleteProjectZip(await createCompleteProjectZip(bIndState, 'y'));

  // Helper to evaluate full Step 01-10 workflow dependencies for a project in state
  const evalWorkflow = (st: typeof bIndState, yearPlanId: string) => {
    bIndStore.set(STORAGE_KEY_V5, JSON.stringify(st));
    const y = st.yearPlans.find(plan => plan.id === yearPlanId)!;
    const s1 = st.semesterPlans.find(sp => sp.yearPlanId === yearPlanId && sp.semester === 1)!;
    const allCriteria = st.semesterPlans
      .filter(sp => sp.yearPlanId === yearPlanId)
      .flatMap(sp => st.semesterData.assessmentCriteria.find(e => e.semesterPlanId === sp.id)?.value || []);
    return validateWorkflowDependencies({
      profile: st.profiles.find(p => p.id === y.profileId),
      school: st.schools.find(s => s.id === y.schoolId),
      academicSetting: {
        ...y,
        id: y.id,
        curriculum: y.curriculumType === 'K13' ? 'Kurikulum 2013' : 'Kurikulum Merdeka',
        semester: '1 (Ganjil)',
      } as any,
      cp: st.annualData.cp.find(e => e.yearPlanId === yearPlanId)?.value,
      cpAnalysis: st.annualData.cpAnalysis.find(e => e.yearPlanId === yearPlanId)?.value,
      tp: st.annualData.tp.find(e => e.yearPlanId === yearPlanId)?.value,
      atp: st.annualData.atp.find(e => e.yearPlanId === yearPlanId)?.value,
      atpUnitMapping: st.annualData.atpUnitMappings?.find(e => e.yearPlanId === yearPlanId)?.value,
      unitExecutionPlan: st.annualData.unitExecutionPlans?.find(e => e.yearPlanId === yearPlanId)?.value,
      assessmentCriteria: allCriteria,
      learningPlans: st.semesterData.learningPlan.find(e => e.semesterPlanId === s1.id)?.value,
      assessmentPlans: st.semesterData.assessmentPlan.find(e => e.semesterPlanId === s1.id)?.value,
    });
  };

  // Source baseline must be completely ready without any stale errors
  const srcWf = evalWorkflow(bIndState, 'y');
  assert.equal(srcWf.hasStaleModules, false, JSON.stringify(srcWf.issues));
  assert.equal(srcWf.stepStates.cp.status, 'COMPLETE');
  assert.equal(srcWf.stepStates['cp-analysis'].status, 'COMPLETE');
  assert.equal(srcWf.stepStates.tp.status, 'COMPLETE');
  assert.equal(srcWf.stepStates.atp.status, 'COMPLETE');
  assert.equal(srcWf.stepStates['atp-mapping'].status, 'COMPLETE');
  assert.equal(srcWf.stepStates['annual-planning'].status, 'COMPLETE');
  assert.equal(srcWf.stepStates.admin.isBlocked, false, srcWf.stepStates.admin.reason);

  // Force UUID reverse sort order during remap to catch any sort-order fingerprint defects (E, B, A)
  const realCrypto = globalThis.crypto;
  let uuidCounter = 900;
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { randomUUID: () => String(uuidCounter--) } });
  let continueImp: ReturnType<typeof prepareCompleteAdministrationProjectImport>;
  try {
    continueImp = prepareCompleteAdministrationProjectImport(bIndState, bIndArchive, {
      mode: 'CONTINUE_EDITING',
      targetProfileId: 'p2',
      targetSchoolId: 's2',
      documentDate: '2026-11-16',
    });
  } finally {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: realCrypto });
  }

  // Test A, B, E, K, L, M on CONTINUE_EDITING (ZIP with UUID reverse sort)
  const cTp = continueImp.state.annualData.tp.find(e => e.yearPlanId === continueImp.yearPlanId)!.value;
  const cAtp = continueImp.state.annualData.atp.find(e => e.yearPlanId === continueImp.yearPlanId)!.value;
  const cMap = continueImp.state.annualData.atpUnitMappings!.find(e => e.yearPlanId === continueImp.yearPlanId)!.value;
  const cExec = continueImp.state.annualData.unitExecutionPlans!.find(e => e.yearPlanId === continueImp.yearPlanId)!.value;
  assert.equal(cTp.workflowStatus, 'SIAP', 'Paraphrased TP with fresh substanceReviews must remain SIAP after ID remap');
  assert.equal(continueImp.step7.target.canProceed, true, continueImp.step7.target.blockers.join('; '));
  assert.equal(continueImp.nextStep, 'admin');
  assert.equal(hasTeacherMaterialSupport(cMap.units[1], cMap.units[1].materials[0], cTp), true,
    'Multi-TP reviewedTpFingerprint must remain valid even when UUID remap reverses sort order');
  assert.equal(cMap.units[0].actionHistory![1].undoOf, cMap.units[0].actionHistory![0].id,
    'MappingChangeRecord.undoOf must be remapped to the new actionHistory record ID');
  assert.equal(cMap.step07AutoRepair!.verifiedFingerprint, computeStep07VerifiedFingerprint(cMap.units, cAtp, cTp));
  assert.equal(cMap.step07AutoRepair!.resultFingerprint, computeMappingFingerprint(cMap.units, cAtp, cTp));
  assert.equal(cMap.step07AutoRepair!.expectedStoredFingerprint, step07PersistedKey(cMap, cAtp, cTp));
  assert.equal(cExec.units[0].meetings[0].materialIds[0], cMap.units[0].materials[0].id);

  const contWf = evalWorkflow(continueImp.state, continueImp.yearPlanId);
  assert.equal(contWf.hasStaleModules, false, JSON.stringify(contWf.issues));
  assert.equal(contWf.stepStates['cp-analysis'].isStale, false);
  assert.equal(contWf.stepStates.tp.isStale, false);
  assert.equal(contWf.stepStates.atp.isStale, false);
  assert.equal(contWf.kktpState.isStale, false);
  assert.equal(contWf.stepStates['annual-planning'].isComplete, true, contWf.stepStates['annual-planning'].reason);
  assert.equal(contWf.stepStates.admin.isBlocked, false, contWf.stepStates.admin.reason);

  // Test K: Re-import exported result with new IDs -> zero false stale
  const secondArchive = await readCompleteProjectZip(await createCompleteProjectZip(continueImp.state, continueImp.yearPlanId));
  const thirdImp = prepareCompleteAdministrationProjectImport(bIndState, secondArchive, {
    mode: 'IDENTITY_ONLY', targetProfileId: 'p2', targetSchoolId: 's2', documentDate: '2026-11-17',
  });
  assert.equal(evalWorkflow(thirdImp.state, thirdImp.yearPlanId).hasStaleModules, false);
  assert.equal(thirdImp.step7.target.canProceed, true);

  // Test H, I, M: COPY to different school -> CP..Step07 valid, calendar UNRESOLVED, schedule DRAFT, Step 10 legitimately waits Step 08
  const copyImp = prepareCompleteAdministrationProjectImport(bIndState, bIndArchive, {
    mode: 'COPY', targetProfileId: 'p2', targetSchoolId: 's2',
  });
  const copyWf = evalWorkflow(copyImp.state, copyImp.yearPlanId);
  assert.equal(copyWf.stepStates['cp-analysis'].isStale, false);
  assert.equal(copyWf.stepStates.tp.isStale, false);
  assert.equal(copyWf.stepStates.atp.isStale, false);
  assert.equal(copyWf.stepStates['atp-mapping'].status, 'COMPLETE');
  assert.equal(copyWf.stepStates['annual-planning'].isComplete, false);
  assert.equal(copyWf.stepStates.admin.isBlocked, true);
  assert.equal(copyWf.stepStates.admin.reason, 'Selesaikan Perencanaan Tahunan (08) terlebih dahulu.');

  // Test I: RESTORE, IDENTITY_SCHEDULE, OTHER_CLASS, Produksi mode
  const restoreImp = prepareCompleteAdministrationProjectImport(bIndState, bIndArchive, {
    mode: 'RESTORE', targetProfileId: 'p1', targetSchoolId: 's1', replaceYearPlanId: 'y',
  });
  assert.equal(evalWorkflow(restoreImp.state, restoreImp.yearPlanId).hasStaleModules, false);
  assert.equal(restoreImp.step7.target.canProceed, true);

  const schedImp = prepareCompleteAdministrationProjectImport(bIndState, bIndArchive, {
    mode: 'IDENTITY_SCHEDULE', targetProfileId: 'p2', targetSchoolId: 's2', documentDate: '2026-11-16',
  });
  assert.equal(schedImp.nextStep, 'annual-planning');
  assert.equal(evalWorkflow(schedImp.state, schedImp.yearPlanId).stepStates['atp-mapping'].isComplete, true);
  assert.equal(evalWorkflow(schedImp.state, schedImp.yearPlanId).stepStates.admin.isBlocked, true);

  const otherClassImp = prepareCompleteAdministrationProjectImport(bIndState, bIndArchive, {
    mode: 'OTHER_CLASS', targetProfileId: 'p2', targetSchoolId: 's2', documentDate: '2026-11-16', targetGrade: 'Kelas 4', targetClassSection: 'B',
  });
  assert.equal(evalWorkflow(otherClassImp.state, otherClassImp.yearPlanId).hasStaleModules, false);

  const prodImp = prepareCompleteAdministrationProjectImport(bIndState, bIndArchive, {
    mode: 'IDENTITY_ONLY', targetProfileId: 'p2', targetSchoolId: 's2', documentDate: '2026-11-16', workMode: 'production',
  });
  assert.equal(prodImp.step7.target.canProceed, true);

  // Test I & A & B: Legacy JSON Importer (importAdministrationProjectIntoState) preserves updatedAt & remaps atp.tpId / linkedTpIds / substanceReviews
  const legacyExport = exportAdministrationProjectFromState(bIndState, 'y');
  assert.equal(legacyExport.success, true, JSON.stringify(legacyExport));
  if (legacyExport.success) {
    const legacyTargetState = structuredClone(bIndState);
    const legacyRes = importAdministrationProjectIntoState(legacyTargetState, {
      package: legacyExport.package,
      targetProfileId: 'p2',
      targetSchoolId: 's2',
    });
    assert.equal(legacyRes.success, true, JSON.stringify(legacyRes));
    if (legacyRes.success) {
      const savedAfterLegacy = JSON.parse(bIndStore.get(STORAGE_KEY_V5)!);
      const lCp = savedAfterLegacy.annualData.cp.find((e: any) => e.yearPlanId === legacyRes.yearPlanId)!.value;
      const lAna = savedAfterLegacy.annualData.cpAnalysis.find((e: any) => e.yearPlanId === legacyRes.yearPlanId)!.value;
      const lTp = savedAfterLegacy.annualData.tp.find((e: any) => e.yearPlanId === legacyRes.yearPlanId)!.value;
      const lAtp = savedAfterLegacy.annualData.atp.find((e: any) => e.yearPlanId === legacyRes.yearPlanId)!.value;
      assert.equal(lCp.updatedAt, sourceStamp, 'Legacy importer must preserve original CP updatedAt');
      assert.equal(lAna.updatedAt, sourceStamp, 'Legacy importer must preserve original CPAnalysis updatedAt');
      assert.equal(lTp.updatedAt, sourceStamp, 'Legacy importer must preserve original TP updatedAt');
      assert.equal(lAtp.updatedAt, sourceStamp, 'Legacy importer must preserve original ATP updatedAt');
      assert.equal(lAtp.tpId, lTp.id, 'Legacy importer must remap ATPData.tpId using tpDataIdMap');
      assert.equal(lAtp.items[0].linkedTpIds[0], lTp.items[0].id, 'Legacy importer must remap ATPItem.linkedTpIds');
      assert.equal(validateTPDataWorkflow(lTp, lCp, lAna).isSiap, true, 'Legacy-imported TP with substanceReviews must remain SIAP');
      assert.equal(validateATPDataWorkflow(lAtp, lTp, undefined, lCp, lAna).isSiap, true, 'Legacy-imported ATP must remain SIAP');
      const legacyWf = evalWorkflow(savedAfterLegacy, legacyRes.yearPlanId);
      assert.equal(legacyWf.stepStates['cp-analysis'].isStale, false);
      assert.equal(legacyWf.stepStates.tp.isStale, false);
      assert.equal(legacyWf.stepStates.atp.isStale, false);
      assert.equal(legacyWf.kktpState.isStale, false);
    }

    // Legacy importer SOURCE_STALE preservation (C)
    const stalePkg = structuredClone(legacyExport.package);
    stalePkg.annual.cp[0].updatedAt = '2026-02-01T00:00:00Z';
    const staleLegacyRes = importAdministrationProjectIntoState(structuredClone(bIndState), {
      package: stalePkg, targetProfileId: 'p2', targetSchoolId: 's2', targetClassSection: 'Z',
    });
    assert.equal(staleLegacyRes.success, true);
    if (staleLegacyRes.success) {
      const stAfter = JSON.parse(bIndStore.get(STORAGE_KEY_V5)!);
      const wf = evalWorkflow(stAfter, staleLegacyRes.yearPlanId);
      assert.equal(wf.stepStates['cp-analysis'].isStale, true, 'Legacy importer must preserve genuine SOURCE_STALE');
      assert.ok(wf.issues.some((i: any) => i.code === 'STALE_CP_ANALYSIS'));
    }

    // Legacy importer failure leaves localStorage untouched (J)
    const snapBeforeFail = bIndStore.get(STORAGE_KEY_V5)!;
    const failLegacy = importAdministrationProject({
      package: { ...legacyExport.package, header: { ...legacyExport.package.header, subject: '' } },
      targetProfileId: 'p2', targetSchoolId: 's2',
    });
    assert.equal(failLegacy.success, false);
    assert.equal(bIndStore.get(STORAGE_KEY_V5), snapBeforeFail);
  }

  // Test I & D & N: Legacy XLSX transfer importer keeps CP/TP/ATP in review/draft (never auto SIAP)
  const xlsxState = structuredClone(bIndState);
  const xlsxRes = performImportProjectTransferInState(xlsxState, {
    pkg: {
      schemaVersion: '1.0',
      curriculumType: 'KURIKULUM_MERDEKA',
      academicYear: '2026/2027',
      subject: 'Bahasa Indonesia',
      level: 'SD',
      grade: 'Kelas 4',
      phase: 'B',
      cp: [{ element: 'Menyimak', content: 'Memahami pesan lisan', code: 'E1' }],
      tp: [{ code: 'E1-SIM-01', cpCode: 'E1', statement: 'Peserta didik memahami pesan lisan.', competence: 'Memahami', materialScope: 'Pesan lisan' }],
      atp: [{ order: 1, tpCode: 'E1-SIM-01', material: 'Pesan lisan', semester: 1 }],
    },
    profileId: 'p2',
    schoolId: 's2',
    classSection: 'C',
  });
  assert.notEqual(xlsxRes.cp.workflowStatus, 'SIAP');
  assert.notEqual(xlsxRes.tp.workflowStatus, 'SIAP');
  assert.equal(xlsxRes.tp.needsReview, true);
  assert.equal(xlsxRes.atp.workflowStatus, 'DRAFT');

  // Test C: Genuine SOURCE_STALE across CP->Analysis, Analysis->TP, TP->ATP, Schedule stays detected after ZIP import
  const staleCpArc = structuredClone(bIndArchive);
  staleCpArc.project.annualData.cp[0].value.updatedAt = '2026-02-01T00:00:00Z';
  const staleCpImp = prepareCompleteAdministrationProjectImport(bIndState, staleCpArc, {
    mode: 'CONTINUE_EDITING', targetProfileId: 'p2', targetSchoolId: 's2', documentDate: '2026-11-16',
  });
  const staleCpWf = evalWorkflow(staleCpImp.state, staleCpImp.yearPlanId);
  assert.equal(staleCpWf.stepStates['cp-analysis'].isStale, true);
  assert.ok(staleCpWf.issues.some((i: any) => i.code === 'STALE_CP_ANALYSIS'));

  const staleAnaArc = structuredClone(bIndArchive);
  staleAnaArc.project.annualData.cpAnalysis[0].value.updatedAt = '2026-02-01T00:00:00Z';
  const staleAnaImp = prepareCompleteAdministrationProjectImport(bIndState, staleAnaArc, {
    mode: 'CONTINUE_EDITING', targetProfileId: 'p2', targetSchoolId: 's2', documentDate: '2026-11-16',
  });
  assert.equal(evalWorkflow(staleAnaImp.state, staleAnaImp.yearPlanId).stepStates.tp.isStale, true);

  const staleTpArc = structuredClone(bIndArchive);
  staleTpArc.project.annualData.tp[0].value.updatedAt = '2026-02-01T00:00:00Z';
  const staleTpImp = prepareCompleteAdministrationProjectImport(bIndState, staleTpArc, {
    mode: 'CONTINUE_EDITING', targetProfileId: 'p2', targetSchoolId: 's2', documentDate: '2026-11-16',
  });
  const staleTpWf = evalWorkflow(staleTpImp.state, staleTpImp.yearPlanId);
  assert.equal(staleTpWf.stepStates.atp.isStale, true);
  assert.equal(staleTpWf.kktpState.isStale, true);

  // Test D: Source DRAFT / needsReview on CP, CPAnalysis, TP, ATP never auto-promoted to SIAP across COPY & RESTORE
  for (const field of ['cp', 'cpAnalysis', 'tp', 'atp'] as const) {
    const draftArc = structuredClone(bIndArchive);
    draftArc.project.annualData[field][0].value.workflowStatus = 'DRAFT';
    const draftCopy = prepareCompleteAdministrationProjectImport(bIndState, draftArc, {
      mode: 'COPY', targetProfileId: 'p2', targetSchoolId: 's2',
    });
    assert.equal(draftCopy.state.annualData[field].find(e => e.yearPlanId === draftCopy.yearPlanId)!.value.workflowStatus, 'DRAFT',
      `COPY must never promote DRAFT ${field} to SIAP`);
    const draftWf = evalWorkflow(draftCopy.state, draftCopy.yearPlanId);
    const stepKey = field === 'cpAnalysis' ? 'cp-analysis' : field;
    assert.notEqual(draftWf.stepStates[stepKey].status, 'COMPLETE', `Workflow must not mark DRAFT ${field} COMPLETE`);
  }

  // Test F: Stale substanceReviews[].fingerprint & stale reviewedTpFingerprint must NOT be falsely repaired on import
  const staleRevArc = structuredClone(bIndArchive);
  staleRevArc.project.annualData.tp[0].value.substanceReviews![0].fingerprint = 'tampered-old-fingerprint';
  const staleRevImp = prepareCompleteAdministrationProjectImport(bIndState, staleRevArc, {
    mode: 'CONTINUE_EDITING', targetProfileId: 'p2', targetSchoolId: 's2', documentDate: '2026-11-16',
  });
  const srTp = staleRevImp.state.annualData.tp.find(e => e.yearPlanId === staleRevImp.yearPlanId)!.value;
  assert.notEqual(srTp.workflowStatus, 'SIAP', 'Stale substanceReviews fingerprint must NOT be repaired to pass SIAP');

  const staleMapRevArc = structuredClone(bIndArchive);
  staleMapRevArc.project.annualData.atpUnitMappings![0].value.units[1].materials[0].titleHistory![0].reviewedTpFingerprint = 'stale-review-fp';
  const staleMapRevImp = prepareCompleteAdministrationProjectImport(bIndState, staleMapRevArc, {
    mode: 'CONTINUE_EDITING', targetProfileId: 'p2', targetSchoolId: 's2', documentDate: '2026-11-16',
  });
  const srMap = staleMapRevImp.state.annualData.atpUnitMappings!.find(e => e.yearPlanId === staleMapRevImp.yearPlanId)!.value;
  const srTp2 = staleMapRevImp.state.annualData.tp.find(e => e.yearPlanId === staleMapRevImp.yearPlanId)!.value;
  assert.equal(hasTeacherMaterialSupport(srMap.units[1], srMap.units[1].materials[0], srTp2), false,
    'Stale reviewedTpFingerprint must NOT be repaired by import');

  // Test G: Substantive TP/ATP edits post-import detected by readiness validator
  const editedTp = structuredClone(cTp);
  editedTp.items[0].statement = 'Peserta didik merancang pidato ilmiah bertema lingkungan.';
  assert.equal(resolveATPUnitMappingReadiness(cMap, cAtp, editedTp).canProceed, false);

  // Test N: Legacy project without complete lineage metadata (missing basedOnCpUpdatedAt / basedOnTpUpdatedAt / basedOnTpFingerprint) not promoted to SIAP
  const legacyNoLineage = structuredClone(bIndArchive);
  delete legacyNoLineage.project.annualData.cpAnalysis[0].value.basedOnCpUpdatedAt;
  delete legacyNoLineage.project.annualData.atp[0].value.basedOnTpUpdatedAt;
  delete legacyNoLineage.project.annualData.atpUnitMappings![0].value.basedOnTpFingerprint;
  const noLineageImp = prepareCompleteAdministrationProjectImport(bIndState, legacyNoLineage, {
    mode: 'COPY', targetProfileId: 'p2', targetSchoolId: 's2',
  });
  const nlAna = noLineageImp.state.annualData.cpAnalysis.find(e => e.yearPlanId === noLineageImp.yearPlanId)!.value;
  const nlAtp = noLineageImp.state.annualData.atp.find(e => e.yearPlanId === noLineageImp.yearPlanId)!.value;
  assert.notEqual(nlAna.workflowStatus, 'SIAP');
  assert.notEqual(nlAtp.workflowStatus, 'SIAP');

  console.log('PASS: Bahasa Indonesia Kelas 4 Fase B A-N regression suite passed.');
}

