import { classifyProjectionFinding } from '../productionValidation';
import { DocumentGenerationContext } from './types';
import {
  resolveScheduledLearningMeetings,
  ScheduledLearningMeetingProjection,
} from '../scheduledLearningMeetingProjectionService';

export interface MerdekaCanonicalTimeProjection {
  rows: ScheduledLearningMeetingProjection[];
  isReady: boolean;
  errors: string[];
}

/**
 * Shared pure canonical helper to resolve scheduled learning meeting projections
 * for Kurikulum Merdeka documents (PROTA, PROMES, ALOKASI WAKTU).
 */
export function resolveMerdekaCanonicalTimeProjection(
  context: DocumentGenerationContext
): MerdekaCanonicalTimeProjection {
  const errors: string[] = [];

  if (!context.atpUnitMapping) {
    errors.push('Pemetaan Unit/Bab (ATPUnitMapping) belum tersedia.');
  }

  if (!context.unitExecutionPlan) {
    errors.push('Struktur Pertemuan (UnitExecutionPlan) belum tersedia.');
  }

  if (!context.learningMeetingSchedules || context.learningMeetingSchedules.length === 0) {
    errors.push('Jadwal Aktual (LearningMeetingSchedule) belum tersedia.');
  }

  if (errors.length > 0) {
    return {
      rows: [],
      isReady: false,
      errors,
    };
  }

  const result = resolveScheduledLearningMeetings({
    allowDraftWorkflow: context.workMode === 'production',
    mapping: context.atpUnitMapping!,
    unitExecutionPlan: context.unitExecutionPlan!,
    schedules: context.learningMeetingSchedules || [],
    tp: context.tp,
    atp: context.atp,
  });

  return {
    rows: result.rows,
    isReady: result.rows.length > 0 && (context.workMode === 'production'
      ? !result.errors.some(error => classifyProjectionFinding(error) === 'BLOCKER_DOKUMEN') && new Set(result.rows.map(row => row.meetingId)).size === result.rows.length && result.rows.every(row =>
          Number.isFinite(row.jp) && row.jp > 0 && /^\d{4}-\d{2}-\d{2}$/.test(row.date) && Number.isFinite(Date.parse(row.date)) && row.unitTitle?.trim())
      : result.isValid),
    errors: result.errors,
  };
}
