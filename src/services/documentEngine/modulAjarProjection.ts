import { AssessmentCriterion, AssessmentPlanItem } from '../../types';
import { resolveScheduledLearningMeetings, ScheduledLearningMeetingProjection } from '../scheduledLearningMeetingProjectionService';
import { LearningPlan, DocumentGenerationContext } from './types';
import { validateLearningPlanForModulAjar, LearningPlanValidationResult } from '../learningPlanService';
import { resolveLearningPlanMeetingBudgets } from '../learningPlanActivityMeetingService';

export interface ModulAjarMeetingActivity {
  id: string;
  learningMeetingId: string;
  phase: string;
  title?: string;
  description: string;
  durationMinutes?: number;
}
export interface ModulAjarMeeting {
  id: string; order: number; title: string; date: string; jp: number;
  minutesPerJP: number; durationMinutes: number;
  materials: ScheduledLearningMeetingProjection['materials'];
  linkedTpIds: string[]; linkedAtpItemIds: string[];
  resolvedTPs: ModulAjarProjection['resolvedTPs'];
  assessments: AssessmentPlanItem[];
  activities: ModulAjarMeetingActivity[];
  activitiesStatus: 'COMPLETE' | 'INCOMPLETE';
  activityLines: string[];
  KKTP: Pick<AssessmentCriterion, 'id' | 'tpId' | 'description' | 'indicators'>[];
  kktpSummaryLines: string[];
}
export interface ModulAjarSection { title: string; lines: string[] }
export interface ModulAjarProjection {
  meetings?: ModulAjarMeeting[];
  sections?: ModulAjarSection[];
  isReady: boolean;
  error?: string;

  plan?: LearningPlan;

  resolvedTPs: Array<{
    id: string;
    code?: string;
    statement: string;
    materialScope?: string;
  }>;

  resolvedAllocatedJP?: number;

  jpResolutionSource:
    | 'CANONICAL_MEETINGS'
    | 'EXPLICIT_PLAN'
    | 'LINKED_TIME_ALLOCATION'
    | 'UNRESOLVED';

  validation?: LearningPlanValidationResult;
}

export function buildModulAjarProjection(context: DocumentGenerationContext): ModulAjarProjection {
  const isBlankMode = context.documentMode === 'blank';

  if (isBlankMode) {
    return {
      isReady: true,
      resolvedTPs: [],
      resolvedAllocatedJP: undefined,
      jpResolutionSource: 'UNRESOLVED',
    };
  }

  const learningPlans = context.learningPlans || [];
  const activePlanId = context.activeLearningPlanId;

  let selectedPlan: LearningPlan | undefined;

  if (activePlanId) {
    const plan = learningPlans.find((p) => p.id === activePlanId);
    if (!plan) {
      return {
        isReady: false,
        error: `Rencana pembelajaran terpilih dengan ID "${activePlanId}" tidak ditemukan.`,
        resolvedTPs: [],
        resolvedAllocatedJP: undefined,
        jpResolutionSource: 'UNRESOLVED',
      };
    }
    if (plan.status !== 'SIAP') {
      return {
        isReady: false,
        error: `Rencana pembelajaran "${plan.topic || plan.id}" terpilih belum diubah statusnya menjadi SIAP.`,
        resolvedTPs: [],
        resolvedAllocatedJP: undefined,
        jpResolutionSource: 'UNRESOLVED',
      };
    }
    selectedPlan = plan;
  } else {
    const siapPlans = learningPlans.filter((p) => p.status === 'SIAP');
    if (siapPlans.length === 0) {
      return {
        isReady: false,
        error: 'Belum ada rencana pembelajaran (Modul Ajar) dengan status SIAP.',
        resolvedTPs: [],
        resolvedAllocatedJP: undefined,
        jpResolutionSource: 'UNRESOLVED',
      };
    }
    if (siapPlans.length > 1) {
      return {
        isReady: false,
        error: 'Terdapat lebih dari satu rencana pembelajaran (Modul Ajar) dengan status SIAP. Silakan pilih salah satu rencana secara eksplisit.',
        resolvedTPs: [],
        resolvedAllocatedJP: undefined,
        jpResolutionSource: 'UNRESOLVED',
      };
    }
    selectedPlan = siapPlans[0];
  }

  const validation = validateLearningPlanForModulAjar(selectedPlan, {
    academicSetting: context.academicSetting,
    tp: context.tp,
    atp: context.atp,
    atpUnitMapping: context.atpUnitMapping,
    unitExecutionPlan: context.unitExecutionPlan,
    learningMeetingSchedules: context.learningMeetingSchedules,
    k13Analysis: context.k13Analysis,
    timeAllocations: context.timeAllocations,
    assessmentCriteria: context.assessmentCriteria,
    calendar: context.calendar, calendarDays: context.calendarDays,
    subjectWeeklySchedule: context.subjectWeeklySchedule,
    semesterJPSetting: context.semesterJPSetting, annualJPReference: context.annualJPReference,
  });

  if (!validation.valid) {
    return {
      isReady: false,
      error: validation.errors.join('; '),
      resolvedTPs: [],
      resolvedAllocatedJP: undefined,
      jpResolutionSource: 'UNRESOLVED',
      validation,
    };
  }

  const invalid = (error: string): ModulAjarProjection => ({
    isReady: false, error, resolvedTPs: [], jpResolutionSource: 'UNRESOLVED', validation,
  });
  if (!selectedPlan.unitId || !selectedPlan.learningMeetingIds?.length ||
      !context.atpUnitMapping || !context.unitExecutionPlan || !context.learningMeetingSchedules?.length) {
    return invalid('Lineage Unit → Meeting → LearningPlan belum lengkap.');
  }
  if (context.snapshot?.learningPlanId &&
      (context.snapshot.learningPlanId !== selectedPlan.id ||
       context.snapshot.sourceVersions?.learningPlanUpdatedAt !== selectedPlan.updatedAt)) {
    return invalid('Lineage LearningPlan berbeda dari snapshot.');
  }
  const scheduled = resolveScheduledLearningMeetings({
    mapping: context.atpUnitMapping, unitExecutionPlan: context.unitExecutionPlan,
    schedules: context.learningMeetingSchedules, tp: context.tp, atp: context.atp,
  });
  if (!scheduled.isValid) return invalid(scheduled.errors.join('; '));
  const ids = selectedPlan.learningMeetingIds;
  const rows = scheduled.rows.filter(r => r.semesterPlanId === context.academicSetting.id && ids.includes(r.meetingId));
  const budgets = resolveLearningPlanMeetingBudgets(rows, context.academicSetting);
  if (!budgets.isValid) return invalid(budgets.reason!);
  if (new Set(ids).size !== ids.length || rows.length !== ids.length ||
      new Set(rows.map(r => r.meetingId)).size !== ids.length ||
      new Set(rows.map(r => r.meetingOrder)).size !== ids.length ||
      rows.some(r => r.unitId !== selectedPlan.unitId || !/^\d{4}-\d{2}-\d{2}$/.test(r.date) ||
        !Number.isFinite(Date.parse(r.date)) || !Number.isFinite(r.jp) || !(r.jp > 0) ||
        !Number.isInteger(r.meetingOrder) || r.meetingOrder < 1 ||
        !r.linkedTpIds.length || !r.linkedAtpItemIds.length ||
        r.linkedTpIds.some(id => !selectedPlan.tpIds.includes(id)) ||
        r.linkedAtpItemIds.some(id => !selectedPlan.atpItemIds.includes(id)))) {
    return invalid('Pertemuan atau lineage TP/ATP/Unit tidak valid.');
  }
  // Unlinked activities stay at unit level. Never infer a meeting from text, TP, or order.
  const activities = [
    ...Object.entries(selectedPlan.learningSteps || {}).flatMap(([phase, steps]) =>
      (steps || []).map(activity => ({ ...activity, phase }))),
    ...(selectedPlan.learningExperiences || []),
  ];
  const linkedActivities = activities.filter(a => a.learningMeetingId !== undefined);
  if (linkedActivities.some(a => typeof a.learningMeetingId !== 'string' ||
      !ids.includes(a.learningMeetingId) || !rows.some(r => r.meetingId === a.learningMeetingId))) {
    return invalid('Kegiatan pembelajaran memiliki learningMeetingId yang tidak valid pada Unit/LearningPlan aktif.');
  }
  const assessments = Object.values(selectedPlan.assessmentPlan).flatMap(items => items || []);
  const criteria = (context.assessmentCriteria || []).filter(c =>
    c.academicSettingId === context.academicSetting.id && selectedPlan.tpIds.includes(c.tpId) &&
    (!selectedPlan.kktpCriterionIds?.length || selectedPlan.kktpCriterionIds.includes(c.id)));
  if ((selectedPlan.kktpCriterionIds || []).some(id => !criteria.some(c => c.id === id))) {
    return invalid('Referensi KKTP tidak ditemukan pada TP dan semester LearningPlan.');
  }
  const meetings: ModulAjarMeeting[] = rows.sort((a,b) => a.meetingOrder - b.meetingOrder).map(r => {
    const meetingActivities: ModulAjarMeetingActivity[] = linkedActivities
      .filter(a => a.learningMeetingId === r.meetingId)
      .map(a => ({ ...a, learningMeetingId: r.meetingId }));
    const complete = meetingActivities.length > 0 && meetingActivities.every(a => a.description?.trim());
    const activityLines = meetingActivities.filter(a => a.description?.trim()).map(a => {
      const labels: Record<string, string> = { opening: 'Pendahuluan', core: 'Kegiatan Inti', closing: 'Penutup', UNDERSTAND: 'Memahami', APPLY: 'Mengaplikasi', REFLECT: 'Merefleksi' };
      const isStep = ['opening', 'core', 'closing'].includes(a.phase);
      return (labels[a.phase] || a.phase) + ': ' + (a.title ? a.title + ' — ' : '') + a.description +
        (isStep && a.durationMinutes ? ' (' + a.durationMinutes + ' Menit)' : isStep ? '' : ' (pendekatan kegiatan inti)');
    });
    if (!complete) activityLines.push('Belum lengkap: kegiatan pembelajaran pertemuan belum tersedia atau deskripsinya belum diisi.');
    const KKTP = criteria.filter(c => r.linkedTpIds.includes(c.tpId))
      .map(c => ({ id: c.id, tpId: c.tpId, description: c.description, indicators: c.indicators }));
    return {
      id: r.meetingId, order: r.meetingOrder, title: r.meetingTitle, date: r.date, jp: r.jp,
      minutesPerJP: budgets.meetings.find(m => m.meetingId === r.meetingId)!.minutesPerJP,
      durationMinutes: budgets.meetings.find(m => m.meetingId === r.meetingId)!.durationMinutes,
      materials: r.materials, linkedTpIds: r.linkedTpIds, linkedAtpItemIds: r.linkedAtpItemIds,
      resolvedTPs: validation.resolvedTPs.filter(t => r.linkedTpIds.includes(t.id)),
      assessments: assessments.filter(a => a.learningMeetingId === r.meetingId &&
        a.linkedTpIds.every(id => r.linkedTpIds.includes(id))),
      activities: meetingActivities, activitiesStatus: complete ? 'COMPLETE' : 'INCOMPLETE', activityLines,
      KKTP,
      kktpSummaryLines: KKTP.map(c => 'TP: ' + (validation.resolvedTPs.find(t => t.id === c.tpId)?.code || c.tpId) +
        ' | Kriteria: ' + c.description + ' | Indikator: ' + c.indicators.join('; ')),
    };
  });
  const sections = buildSections(selectedPlan, meetings, validation.resolvedTPs, assessments, criteria);

  const jpResolutionSource = validation.jpResolutionSource === 'CANONICAL_ATP'
    ? 'UNRESOLVED'
    : (validation.jpResolutionSource || 'UNRESOLVED');

  return {
    isReady: true,
    plan: selectedPlan,
    meetings, sections,
    resolvedTPs: validation.resolvedTPs || [],
    resolvedAllocatedJP: validation.resolvedAllocatedJP,
    jpResolutionSource,
    validation,
  };
}


function buildSections(plan: LearningPlan, meetings: ModulAjarMeeting[], tps: ModulAjarProjection['resolvedTPs'], assessments: AssessmentPlanItem[], criteria: AssessmentCriterion[]): ModulAjarSection[] {
  const criterionLines = (items: AssessmentCriterion[]) => items.map(c =>
    [tps.find(t => t.id === c.tpId)?.code || c.tpId, c.description, c.approach,
      ...c.indicators, ...c.levels.map(l => (l.label || l.level) + ': ' + l.description),
      c.passingThreshold != null ? 'Ambang: ' + c.passingThreshold : '', c.notes].filter(Boolean).join(' | '));
  const assessmentLines = (items: AssessmentPlanItem[]) => items.map(a =>
    [a.type, a.description, a.method, a.technique, a.instrument, 'TP: ' + a.linkedTpIds.join(', ')].filter(Boolean).join(' | '));
  return [
    { title: 'I. INFORMASI UMUM', lines: [
      'Kompetensi Awal: ' + (plan.initialCompetency || '-'),
      'Dimensi Profil Lulusan: ' + (plan.graduateProfileDimensions || plan.p3Dimensions || []).join(', '),
      'Sarana dan Prasarana: ' + (plan.resources || []).map(r => r.title + (r.source ? ' (' + r.source + ')' : '')).join('; '),
      'Karakteristik/Kebutuhan Belajar Murid: ' + (plan.targetStudents || '-'),
      'Model/Praktik Pembelajaran: ' + (plan.learningModel || '-')] },
    { title: 'II. KOMPONEN INTI', lines: [...tps.map(t => (t.code || t.id) + ': ' + t.statement + (t.materialScope ? ' (Materi: ' + t.materialScope + ')' : '')),
      'Pemahaman Bermakna: ' + (plan.meaningfulUnderstanding || '-'),
      'Pertanyaan Pemantik: ' + (plan.triggerQuestions || []).join('; '),
      ...Object.entries(plan.learningSteps || {}).flatMap(([phase, steps]) => (steps || []).filter(step => step.learningMeetingId === undefined).map(step => phase + ': ' + (step.title || '') + ' ' + step.description + (step.durationMinutes ? ' (' + step.durationMinutes + ' Menit)' : '')))] },
    { title: 'III. RENCANA PERTEMUAN', lines: meetings.flatMap(m => [
      'Pertemuan ' + m.order + ': ' + m.title + ' | ' + m.date + ' | ' + m.jp + ' JP | ' + m.durationMinutes + ' Menit',
      'Materi: ' + m.materials.map(x => x.title).join('; '),
      'TP:', ...m.resolvedTPs.map(t => (t.code || t.id) + ': ' + t.statement),
      'Kegiatan Pembelajaran:', ...m.activityLines,
      'Asesmen:', ...assessmentLines(m.assessments), 'KKTP ringkas:', ...m.kktpSummaryLines]) },
    { title: 'IV. ASESMEN + KKTP', lines: [...assessmentLines(assessments), ...criterionLines(criteria)] },
    { title: 'V. DIFERENSIASI', lines: Object.entries(plan.differentiation || {}).map(([key,value]) => key + ': ' + value) },
    { title: 'VI. PENGAYAAN/REMEDIAL', lines: ['Pengayaan: ' + (plan.enrichmentPlan || '-'), 'Remedial: ' + (plan.remedialPlan || '-')] },
    { title: 'VII. REFLEKSI', lines: ['Guru: ' + (plan.reflection?.teacherReflection || '-'), 'Murid: ' + (plan.reflection?.studentReflection || '-')] },
  ];
}
