import type { DocumentGenerationContext, DocumentType } from './documentEngine/types';
import type { DependencyValidationIssue } from './workflowEngine';
import JSZip from 'jszip';

export type ProductionClassification = 'WARNING' | 'BLOCKER_DOKUMEN' | 'BLOCKER_PAKET';
export interface ProductionFinding {
  stage: string;
  object: string;
  classification: ProductionClassification;
  problem: string;
  exportImpact: string;
  minimalFix: string;
}
export function productionFinding(stage: string, object: string, classification: ProductionClassification, problem: string): ProductionFinding {
  return { stage, object, classification, problem,
    exportImpact: classification === 'WARNING' ? 'Ekspor tetap diizinkan jika struktur minimum valid' : classification === 'BLOCKER_DOKUMEN' ? 'Hanya dokumen/objek ini diblokir; dokumen lain tetap diproses' : 'Paket tidak dapat dibuat atau diunduh',
    minimalFix: classification === 'WARNING' ? 'Tinjau kualitas pada master bila diperlukan; regenerasi tidak wajib' : classification === 'BLOCKER_DOKUMEN' ? 'Lengkapi substansi/identitas atau perbaiki referensi/file dokumen ini' : 'Periksa rincian dokumen gagal atau coba kembali pembentukan/unduhan ZIP' };
}
const structuralWorkflowCodes: Record<string, string> = {
  PROFILE_INCOMPLETE: 'Identitas tujuan', ACADEMIC_SETTING_INCOMPLETE: 'Konteks tujuan', CURRICULUM_UNRESOLVED: 'Kurikulum tujuan',
  ORPHAN_ATP_TP_ID: 'ATP', ORPHAN_CRITERIA_TP_ID: 'KKTP', AMBIGUOUS_CRITERIA_REFERENCE: 'KKTP', INVALID_ATP_REFERENCE_IN_MAPPING: 'PEMETAAN_ATP_UNIT',
};
export function classifyWorkflowFinding(issue: DependencyValidationIssue): ProductionFinding {
  const target = structuralWorkflowCodes[issue.code];
  return productionFinding(issue.module, target || issue.targetId || issue.code, (target || issue.severity === 'ERROR' && !['MISSING_ATP_TP_COVERAGE'].includes(issue.code)) ? 'BLOCKER_DOKUMEN' : 'WARNING', issue.message);
}
export function formatProductionFindings(findings: ProductionFinding[]): string {
  const cell = (s: string) => s.replace(/[\r\n|]+/g, ' ');
  return ['Tahap | Dokumen/Objek | Klasifikasi | Masalah | Dampak Ekspor | Perbaikan Minimal',
    ...findings.map(f => [f.stage, f.object, f.classification, f.problem, f.exportImpact, f.minimalFix].map(cell).join(' | '))].join('\n');
}
export class ProductionExportError extends Error {
  constructor(public findings: ProductionFinding[], public documents: import('./documentEngine/types').ZipExportItemStatus[] = []) {
    super(formatProductionFindings(findings));
    this.name = 'ProductionExportError';
  }
}

/** Only known workflow metadata is advisory. Unknown projection errors remain structural. */
export function classifyProjectionFinding(problem: string): ProductionClassification {
  return /^Struktur Pertemuan stale relatif terhadap Pemetaan Unit\/Bab\.$|^Jadwal semester [12] stale setelah perubahan pemetaan\/pertemuan\. Tinjau dan simpan ulang jadwal\.$|^Schedule semester [12] belum COMPLETE\.$|^Struktur Pertemuan belum lengkap \(coverage atau pertemuan masih kurang\)\.$/.test(problem) ? 'WARNING' : 'BLOCKER_DOKUMEN';
}

/** Validate explicit references; never silently discard an orphan because another reference resolved. */
export function productionReferenceIssues(type: DocumentType, context: Partial<DocumentGenerationContext>): string[] {
  const issues: string[] = [];
  const check = (ids: string[], known: string[], label: string) => {
    for (const id of ids) if (!id || known.filter(value => value === id).length !== 1) issues.push(`${label}: referensi '${id}' hilang atau ambigu.`);
    if (new Set(ids).size !== ids.length) issues.push(`${label}: referensi duplikat.`);
  };
  const tpIds = (context.tp?.items || []).map(item => item.id);
  const atpIds = (context.atp?.items || []).map(item => item.id);
  if (type === 'ATP') for (const item of context.atp?.items || []) check(item.linkedTpIds?.length ? item.linkedTpIds : item.tpId ? [item.tpId] : [], tpIds, `ATP ${item.id}`);
  if (type === 'PEMETAAN_ATP_UNIT') for (const unit of context.atpUnitMapping?.units || []) check(unit.linkedAtpItemIds || [], atpIds, `Unit ${unit.id}`);
  if (type === 'KKTP') for (const item of context.assessmentCriteria || []) check([item.tpId], tpIds, `KKTP ${item.id}`);
  if ((type === 'MODUL_AJAR' || type === 'RPM')) for (const plan of (context.learningPlans || []).filter(plan => !context.activeLearningPlanId || plan.id === context.activeLearningPlanId)) {
    check(plan.tpIds || [], tpIds, `Modul ${plan.id} TP`);
    check(plan.atpItemIds || [], atpIds, `Modul ${plan.id} ATP`);
    if (context.zipAnnualSource?.yearPlan.identityOnlyImport?.mode === 'IDENTITY_ONLY') {
      const meetingIds = (context.unitExecutionPlan?.units || []).filter(unit => unit.unitId === plan.unitId)
        .flatMap(unit => unit.meetings.map(meeting => meeting.id));
      const scheduledIds = (context.learningMeetingSchedules || []).filter(bundle => bundle.semesterPlanId === plan.academicSettingId)
        .flatMap(bundle => bundle.schedule.entries.filter(entry => entry.unitId === plan.unitId).map(entry => entry.meetingId));
      check(plan.learningMeetingIds || [], meetingIds, `Modul ${plan.id} pertemuan Bab`);
      check(plan.learningMeetingIds || [], scheduledIds, `Modul ${plan.id} jadwal semester`);
    }
  }
  return issues;
}

/** A nonempty blob alone does not prove that a renderer produced a valid document. */
export async function assertProductionDocumentFile(file: Blob | Uint8Array | undefined, format: 'pdf' | 'docx'): Promise<void> {
  if (!file) throw new Error(`File ${format} tidak tersedia.`);
  const bytes = file instanceof Uint8Array ? file : new Uint8Array(await file.arrayBuffer());
  if (!bytes.length) throw new Error(`File ${format} kosong.`);
  if (format === 'pdf') {
    const text = new TextDecoder('latin1').decode(bytes);
    if (!text.startsWith('%PDF-') || !text.trimEnd().endsWith('%%EOF') || !/\/Type\s*\/Page\b/.test(text)) throw new Error('Struktur file PDF tidak valid.');
  } else {
    const archive = await JSZip.loadAsync(bytes, { checkCRC32: true });
    const xml = await archive.file('word/document.xml')?.async('string');
    if (!archive.file('[Content_Types].xml') || !xml || !/<w:document\b/.test(xml) || !/<w:body\b/.test(xml) || !xml.includes('</w:document>')) throw new Error('Struktur file DOCX tidak valid.');
  }
}

export function productionZipFindings(result: import('./documentEngine/types').ZipExportResult): ProductionFinding[] {
  return (result.itemResults || []).filter(item => item.status !== 'SUCCESS').map(item => productionFinding(item.type, item.instanceTitle || item.instanceId || item.type, 'BLOCKER_DOKUMEN', item.reason || item.status));
}
