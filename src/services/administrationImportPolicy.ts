import type { CPData, TPData, ATPData, YearPlan, DocumentType } from '../types';
import type { DocumentGenerationContext } from './documentEngine/types';
import { resolveGrade } from './cognitiveAdaptationService';
import { cpSourceRepository } from './cpSourceRepository';
import { resolveAnnualZipContexts } from './documentEngine/annualZipPlan';
import { resolveSemesterJPFromValues } from './semesterJPResolver';
import { validateLearningMeetingScheduleData } from './learningMeetingScheduleService';

const phase = (value = '') => value.replace(/^Fase\s*/i,'').trim().toUpperCase();
export function classImportCompatibility(year: YearPlan, cp?: CPData, tp?: TPData, atp?: ATPData) {
  if (year.identityOnlyImport?.mode !== 'OTHER_CLASS' || resolveGrade(undefined, year.identityOnlyImport.sourceGrade) === resolveGrade(undefined, year.grade)) return { cpCompatible: true, tpCompatible: true, atpCompatible: true, reasons: [] as string[] };
  const lookup = cpSourceRepository.searchWithDiagnostics({ subject: year.subject, level: year.level, phase: year.phase, grade: year.grade, academicYear: year.academicYear, curriculum: year.curriculumType });
  const official = lookup.status === 'RESOLVED' ? lookup.results[0] : undefined;
  const cpCompatible = Boolean(cp && official && official.verificationStatus === 'VERIFIED' &&
    (cp.source?.id === official.id || cp.source?.versionCode === official.id) &&
    JSON.stringify(cp.elements.map(el=>[el.name,el.content])) === JSON.stringify(official.elements.map(el=>[el.name,el.content])));
  const tpCompatible = cpCompatible && Boolean(tp && phase(tp.phase) === phase(year.phase) && tp.workflowStatus === 'SIAP' && !tp.needsReview);
  const atpCompatible = tpCompatible && Boolean(atp?.workflowStatus === 'SIAP' && !atp.needsReview);
  const reasons: string[] = [];
  if (!cpCompatible) reasons.push(`CP belum terbukti kompatibel dengan ${year.grade} / Fase ${phase(year.phase)} berdasarkan sumber resmi; substansi asal dipertahankan untuk ditinjau.`);
  if (!tpCompatible) reasons.push('TP memerlukan peninjauan kompatibilitas kelas/fase tujuan.');
  if (!atpCompatible) reasons.push('ATP dan perangkat turunannya memerlukan TP yang kompatibel dengan kelas/fase tujuan.');
  return { cpCompatible, tpCompatible, atpCompatible, reasons };
}

/** Reuse stored semester contexts and the existing schedule validator. No allocation or dates are invented. */
export function importedTimingIssues(context: DocumentGenerationContext, annual = false, calendarOnly = false): string[] {
  if (context.zipAnnualSource?.yearPlan.identityOnlyImport?.mode !== 'IDENTITY_SCHEDULE') return [];
  const scoped = resolveAnnualZipContexts(context);
  const semesters = annual ? scoped.semesters : scoped.semesters.filter(item=>item.context.academicSetting.id === context.academicSetting.id);
  if (!semesters.length || (annual && semesters.length !== 2)) return ['Konteks kalender/jadwal semester tujuan belum lengkap.'];
  const issues: string[] = [];
  for (const { semester, context: target } of semesters) {
    const prefix = `Semester ${semester}: `;
    if (target.calendar?.workflowStatus !== 'CONFIRMED') { issues.push(prefix+'konfirmasikan kalender sekolah tujuan.'); continue; }
    if (calendarOnly) continue;
    if (!target.semesterJPSetting || target.semesterJPSetting.source === 'UNRESOLVED') { issues.push(prefix+'tinjau dan simpan JP sekolah tujuan.'); continue; }
    const weeklyJP = resolveSemesterJPFromValues(target.semesterJPSetting,target.annualJPReference).weeklyJP;
    const bundles = (target.learningMeetingSchedules || []).filter(bundle=>bundle.semesterPlanId===target.academicSetting.id);
    if (!target.atpUnitMapping || !target.unitExecutionPlan || !target.subjectWeeklySchedule || !weeklyJP || bundles.length!==1) { issues.push(prefix+'jadwal mapel/pertemuan tujuan belum lengkap.'); continue; }
    const checked = validateLearningMeetingScheduleData({ data: bundles[0].schedule, semester, mapping: target.atpUnitMapping, unitExecutionPlan: target.unitExecutionPlan,
      subjectWeeklySchedule: target.subjectWeeklySchedule, expectedWeeklyJP: weeklyJP, calendar: target.calendar!, calendarDays: target.calendarDays || [] });
    if (!checked.isValid || checked.isStale || bundles[0].schedule.status !== 'COMPLETE') issues.push(prefix+'perbarui jadwal pertemuan setelah perubahan kalender/JP. '+checked.errors.join('; '));
  }
  return issues;
}

export function importDocumentPolicyIssue(type: DocumentType, context: Partial<DocumentGenerationContext>): string | undefined {
  if (context.documentMode === 'blank' || !context.zipAnnualSource) return;
  const year = context.zipAnnualSource.yearPlan;
  const compatibility = classImportCompatibility(year,context.cp,context.tp,context.atp);
  if (type==='CP' && !compatibility.cpCompatible) return compatibility.reasons[0];
  if (['TP','ANALISIS_CP_TP'].includes(type) && !compatibility.tpCompatible) return compatibility.reasons.join('; ');
  if (['ATP','PEMETAAN_ATP_UNIT','PROTA','PROMES','ALOKASI_WAKTU','MODUL_AJAR','KKTP','ASESMEN','JURNAL'].includes(type) && !compatibility.atpCompatible) return compatibility.reasons.join('; ');
  if (context.academicSetting && ['PROTA','PROMES','ALOKASI_WAKTU','MODUL_AJAR','JURNAL','KALENDER_AKADEMIK','HARI_EFEKTIF'].includes(type)) {
    const issues = importedTimingIssues(context as DocumentGenerationContext, type==='PROTA', ['KALENDER_AKADEMIK','HARI_EFEKTIF'].includes(type));
    if (issues.length) return issues.join('; ');
  }
}
