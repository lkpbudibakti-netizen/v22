import type { DocumentGenerationContext, DocumentType } from './types';
import { buildPromesProjection } from './promesProjection';
import { buildProtaProjection } from './protaProjection';
import { buildJurnalProjection } from './jurnalProjection';

/** Do not rewrite pedagogical prose to hide old identity. Block only affected exports for explicit review. */
export function sourceIdentityExportIssue(type: DocumentType, context: Partial<DocumentGenerationContext>): string | undefined {
  if (context.documentMode === 'blank') return;
  const tokens = context.zipAnnualSource?.yearPlan.identityOnlyImport?.sourceIdentityTokens;
  if (!tokens?.length) return;
  const plans = (context.learningPlans || []).filter(plan => !context.activeLearningPlanId || plan.id === context.activeLearningPlanId);
  const unitIds = new Set(plans.map(plan => plan.unitId));
  const planTpIds = new Set(plans.flatMap(plan => plan.tpIds));
  const packages = (context.assessmentPackages || []).filter(pkg => !context.activeAssessmentPackageId || pkg.id === context.activeAssessmentPackageId);
  const packageTpIds = new Set(packages.flatMap(pkg => (pkg.blueprintItems || []).map(item => item.objectiveRefId)));
  const sources: Partial<Record<DocumentType, unknown>> = {
    CP: context.cp, TP: context.tp, ANALISIS_CP_TP: [context.cp, context.tp], ATP: [context.atp, context.tp],
    PEMETAAN_ATP_UNIT: context.atpUnitMapping, PROTA: [context.atpUnitMapping, context.timeAllocations],
    PROMES: [context.atpUnitMapping, context.timeAllocations, context.tp], ALOKASI_WAKTU: [context.atpUnitMapping, context.timeAllocations, context.tp],
    KALENDER_AKADEMIK: [context.calendar, context.calendarDays], HARI_EFEKTIF: [context.calendar, context.calendarDays],
    MODUL_AJAR: [plans, context.atpUnitMapping?.units.filter(unit => unitIds.has(unit.id)), context.unitExecutionPlan?.units.filter(unit => unitIds.has(unit.unitId)), context.tp?.items.filter(tp => planTpIds.has(tp.id))],
    ASESMEN: [packages, context.tp?.items.filter(tp => packageTpIds.has(tp.id)), context.assessmentPlans?.filter(plan => packages.some(pkg => pkg.assessmentPlanId === plan.id))],
    KKTP: context.assessmentCriteria, JURNAL: [context.unitExecutionPlan, context.journalRealizations],
  };
  // Use existing projections to avoid blocking Semester 1 for prose used only in Semester 2.
  if (context.academicSetting) {
    if (type === 'PROMES' || type === 'ALOKASI_WAKTU') sources[type] = buildPromesProjection(context as DocumentGenerationContext).rows;
    if (type === 'PROTA') sources[type] = buildProtaProjection(context as DocumentGenerationContext).rows;
    if (type === 'JURNAL') sources[type] = buildJurnalProjection(context as DocumentGenerationContext).rows;
  }
  const normalize = (text: string) => text.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('id');
  const patterns = tokens.map(token => new RegExp(`(^|[^\\p{L}\\p{N}])${normalize(token).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'u'));
  const containsIdentity = (value: unknown): boolean => {
    if (typeof value === 'string') return patterns.some(pattern => pattern.test(normalize(value)));
    if (Array.isArray(value)) return value.some(containsIdentity);
    if (value && typeof value === 'object') return Object.entries(value).some(([key, child]) =>
      !['source', 'evidence', 'regulationSources', 'curriculumLock'].includes(key) && !/Ids?$/.test(key) && containsIdentity(child));
    return false;
  };
  if (containsIdentity(sources[type])) return 'Isi dokumen masih menyebut identitas asal di dalam teks sumber. Tinjau teks tersebut secara eksplisit; substansi tidak diganti otomatis.';
}
