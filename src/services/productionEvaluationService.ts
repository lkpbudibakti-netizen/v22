import type { DocumentGenerationContext } from './documentEngine/types';
import { DOCUMENT_CATALOG, validateDocumentRequirements } from './documentEngine';
import { validateWorkflowDependencies } from './workflowEngine';
import { buildModulAjarProjection } from './documentEngine/modulAjarProjection';

/** Read-only report: warnings never imply that a document is structurally printable. */
export function buildProductionEvaluationReport(context: DocumentGenerationContext): string {
  const setting = context.academicSetting;
  const lines = ['LAPORAN EVALUASI MASTER',
    'Master/proyek: ' + (context.zipAnnualSource?.yearPlan.id || context.workspace?.id || setting.id),
    `Mapel: ${setting.subject} | Kelas: ${setting.grade} | Fase: ${setting.phase || '-'} | Semester: ${setting.semester}`,
    'Tahap | Objek | Jenis | Penyebab | Dampak ekspor | Perbaikan minimal'];
  try {
    for (const issue of validateWorkflowDependencies(context).issues) {
      lines.push(`${issue.module} | ${issue.targetId || issue.code} | WARNING | ${issue.message} | Tidak mengunci navigasi; ekspor diperiksa per dokumen | Tinjau data yang disebut pada penyebab.`);
    }
  } catch (error) { lines.push('WARNING diagnostik | ' + String(error)); }
  for (const plan of context.learningPlans || []) {
    try {
      const projection = buildModulAjarProjection({ ...context, workMode: 'production', activeLearningPlanId: plan.id });
      for (const reason of projection.validation?.errors || []) lines.push(`MODUL_AJAR | ${plan.id} | WARNING | ${reason} | Substansi master tetap dipakai jika minimum tersedia | Perbaiki bagian tersebut pada master.`);
    } catch { /* Structural failures are reported below for the affected document. */ }
  }
  for (const document of DOCUMENT_CATALOG) {
    try {
      const result = validateDocumentRequirements(document.type, { ...context, workMode: 'production' });
      for (const reason of result.missingFields) lines.push(`${document.type} | ${context.activeLearningPlanId || context.activeAssessmentPackageId || '-'} | BLOCKER | ${reason} | Hanya dokumen ini dilewati | Lengkapi substansi minimum, struktur atau identitas yang disebut.`);
    } catch (error) { lines.push(`${document.type} | - | BLOCKER struktur | ${String(error)} | Hanya dokumen ini gagal | Perbaiki struktur dokumen ini.`); }
  }
  return lines.join('\n');
}
