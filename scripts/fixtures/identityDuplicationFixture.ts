import assert from 'node:assert/strict';
import { createInitialStorageV5, validateStorageStateV5 } from '../../src/services/storageV5';
import { computeAtpSubstantiveFingerprint, computeTpSubstantiveFingerprint } from '../../src/services/atpMappingActionApplyService';
import { resolveATPUnitMappingReadiness } from '../../src/services/atpMappingReadinessService';
import { validateCPDataWorkflow, validateCPAnalysisDataWorkflow, validateTPDataWorkflow, validateATPDataWorkflow } from '../../src/services/cpWorkflowService';


export function createIdentityDuplicationFixture() {
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

return state;
}
