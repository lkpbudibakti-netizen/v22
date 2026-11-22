import type { DocumentGenerationContext } from './documentEngine/types';
import { DOCUMENT_CATALOG, validateDocumentRequirements } from './documentEngine';
import { validateWorkflowDependencies } from './workflowEngine';
import { validateCPAnalysisDataWorkflow, validateTPDataWorkflow } from './cpWorkflowService';
import { buildAnnualZipWorkItems } from './documentEngine/annualZipPlan';
import { getCurriculumTypeFromSetting } from './curriculumRouter';
import { classifyWorkflowFinding, formatProductionFindings, productionFinding, type ProductionFinding } from './productionValidation';

/** Read-only diagnostics; actual per-document validators decide eligibility. */
export function buildProductionEvaluationReport(context: DocumentGenerationContext, runtimeFindings: ProductionFinding[] = []): string {
  const production = { ...context, workMode: 'production' as const };
  const findings: ProductionFinding[] = [];
  try {
    findings.push(...validateWorkflowDependencies(production).issues.map(classifyWorkflowFinding));
    for (const [stage, result] of [
      ['cp-analysis', validateCPAnalysisDataWorkflow(context.cpAnalysis, context.cp)],
      ['tp', validateTPDataWorkflow(context.tp, context.cp, context.cpAnalysis, context.academicSetting)],
    ] as const) for (const problem of result.issues) findings.push(productionFinding(stage, stage, 'WARNING', problem));
    for (const [name, data] of [['CP', context.cp], ['Analisis CP', context.cpAnalysis], ['TP', context.tp], ['ATP', context.atp]] as const) {
      if (data && (data.workflowStatus !== 'SIAP' || ('needsReview' in data && data.needsReview))) findings.push(productionFinding(name, name, 'WARNING', 'Status workflow belum SIAP atau masih perlu ditinjau.'));
    }
  } catch (error) {
    findings.push(productionFinding('Diagnostik', '-', 'WARNING', 'Pemeriksaan kualitas tidak selesai: ' + String(error)));
  }
  const k13 = getCurriculumTypeFromSetting(context.academicSetting) === 'K13';
  const types = DOCUMENT_CATALOG.map(doc => doc.type).filter(type => k13
    ? !['CP', 'TP', 'ANALISIS_CP_TP', 'ATP', 'PEMETAAN_ATP_UNIT', 'MODUL_AJAR', 'KKTP', 'ASESMEN'].includes(type)
    : !['ANALISIS_SKL_KI_KD', 'PENETAPAN_KKM'].includes(type));
  const work = buildAnnualZipWorkItems(types, production);
  for (const item of work.items) {
    const result = validateDocumentRequirements(item.type, item.context);
    findings.push(...(result.findings || []).map(finding => ({ ...finding, object: item.instanceTitle || item.instanceId || item.type })));
  }
  for (const item of work.skipped) findings.push(productionFinding(item.type, item.instanceTitle || item.instanceId || item.type, 'BLOCKER_DOKUMEN', item.reason || 'Dokumen tidak tersedia.'));
  findings.push(...runtimeFindings);
  return ['LAPORAN EVALUASI PRODUKSI', 'Master/proyek: ' + (context.zipAnnualSource?.yearPlan.id || context.workspace?.id || context.academicSetting.id), formatProductionFindings(findings)].join('\n');
}
