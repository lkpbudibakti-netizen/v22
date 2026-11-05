import type { DocumentGenerationContext, DocumentSnapshot } from './types';
import { createDocumentSnapshot, resolveEffectiveContext } from './snapshot';

export function prepareModulAjarExportContext(
  liveContext: DocumentGenerationContext,
  format: 'docx' | 'pdf',
  source: 'live' | 'snapshot' = 'live',
  historicalSnapshot?: DocumentSnapshot,
): DocumentGenerationContext {
  // Discard inherited snapshots before resolving a new live snapshot.
  const live = { ...liveContext, snapshot: undefined };
  if (source === 'snapshot') {
    if (!historicalSnapshot) throw new Error('Snapshot lama belum tersedia.');
    if (historicalSnapshot.documentMode !== 'blank' &&
        (!historicalSnapshot.learningPlanId || !historicalSnapshot.sourceVersions?.learningPlanUpdatedAt)) {
      throw new Error('Snapshot lama tidak memiliki lineage LearningPlan lengkap; dokumen historis tidak dapat direkonstruksi dengan aman.');
    }
    // Use only an existing exact historical revision. An equal ID is not equal content.
    const historicalPlans = historicalSnapshot.documentMode === 'blank'
      ? live.learningPlans
      : (live.learningPlans || []).filter(plan =>
          plan.id === historicalSnapshot.learningPlanId &&
          plan.updatedAt === historicalSnapshot.sourceVersions!.learningPlanUpdatedAt &&
          plan.academicSettingId === live.academicSetting.id);
    if (historicalSnapshot.documentMode !== 'blank' && historicalPlans?.length !== 1) {
      throw new Error('LearningPlan historis exact untuk snapshot lama tidak tersedia atau ambigu (ID dan updatedAt harus sama). Ekspor dibatalkan; revisi live tidak dipakai sebagai pengganti.');
    }
    return resolveEffectiveContext({
      ...live,
      learningPlans: historicalPlans,
      activeLearningPlanId: historicalSnapshot.learningPlanId,
    }, historicalSnapshot);
  }
  return resolveEffectiveContext(live, createDocumentSnapshot(live, format, live.documentMode, 'MODUL_AJAR'));
}
