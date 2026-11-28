import { resolveCalendarSubjectCapacity } from '../jpEngine';
import { resolveSemesterJPFromValues } from '../semesterJPResolver';
import type { DocumentGenerationContext, DocumentType, ZipExportItemStatus, LearningPlan } from './types';
import { resolveUnitSemesterPlacement } from '../unitSemesterPlanningService';
import { findSubjectByCode, findSubjectByNameOrAlias } from '../../data/curriculum/subjects';

export interface AnnualZipWorkItem {
  type: DocumentType;
  instanceId?: string;
  instanceTitle?: string;
  context: DocumentGenerationContext;
  folderCategory: string;
  seqNum: number;
  fileStem?: string;
}

const annualTypes = new Set<DocumentType>([
  'CP', 'TP', 'ANALISIS_CP_TP', 'ATP', 'PEMETAAN_ATP_UNIT', 'PROTA',
  'ANALISIS_SKL_KI_KD', 'PENETAPAN_KKM', 'KALENDER_AKADEMIK',
]);
export const isAnnualZipDocument = (type: DocumentType) => annualTypes.has(type);
export const semesterZipFolder = (semester: 1 | 2) => semester === 1 ? 'Semester_1' : 'Semester_2';

function zipLabel(value: string, limit: number, fallback: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, limit).replace(/-+$/g, '') || fallback;
}

function administrationZipLabels(context: DocumentGenerationContext) {
  const setting = context.academicSetting;
  const subject = setting?.subject || '';
  const code = context.zipAnnualSource?.yearPlan.subjectCode;
  const canonical = findSubjectByCode(code) || findSubjectByCode(subject) || findSubjectByNameOrAlias(subject);
  return {
    subject: zipLabel(canonical?.code || subject, 16, 'MAPEL'),
    grade: 'K' + zipLabel((setting?.grade || '').replace(/^kelas\s+/i, ''), 12, 'X'),
    level: zipLabel(setting?.level || context.zipAnnualSource?.yearPlan.level || '', 4, 'SEK'),
    year: zipLabel(setting?.academicYear || '', 12, 'TA'),
  };
}

export function administrationZipRoot(context: DocumentGenerationContext): string {
  const { subject, grade } = administrationZipLabels(context);
  return `ADM_${subject}_${grade}`;
}

export function administrationZipFileName(context: DocumentGenerationContext, format: 'pdf' | 'docx' | 'both'): string {
  const { subject, grade, level, year } = administrationZipLabels(context);
  const section = zipLabel(context.academicSetting?.classSection || '', 8, '');
  const mode = context.documentMode === 'blank' ? '_Kosong' : '';
  const formatSuffix = format === 'both' ? '' : format === 'pdf' ? '_PDF' : '_WORD';
  return `ADM_${subject}_${level}_${grade}${section ? '_' + section : ''}_${year}${mode}${formatSuffix}.zip`;
}

/** No storage reads or semester-label fallback: each context owns persisted SemesterPlan data. */
export function resolveAnnualZipContexts(base: DocumentGenerationContext): {
  annual: DocumentGenerationContext;
  semesters: { semester: 1 | 2; context: DocumentGenerationContext }[];
  issues: string[];
} {
  const source = base.zipAnnualSource;
  if (!source) {
    const semester = base.academicSetting?.semester?.startsWith('1') ? 1 : base.academicSetting?.semester?.startsWith('2') ? 2 : undefined;
    return { annual: { ...base, snapshot: undefined, skipDownload: true },
      semesters: semester ? [{ semester, context: { ...base, snapshot: undefined, skipDownload: true } }] : [],
      issues: ['Context canonical tahun ajaran lengkap belum tersedia; semester lain tidak direkayasa.'] };
  }
  const year = source.yearPlan;
  const setting = base.academicSetting;
  if (year.academicYear !== setting.academicYear || year.subject !== setting.subject || year.grade !== setting.grade || year.profileId !== setting.profileId) {
    return { annual: base, semesters: [], issues: ['Identitas YearPlan tidak cocok dengan context export.'] };
  }
  const annual: DocumentGenerationContext = { ...base, snapshot: undefined, skipDownload: true,
    // Preserve supplied metadata: the existing export validator still requires a semester.
    // Annual scope comes from YearPlan/folder, not by clearing otherwise valid metadata.
    academicSetting: { ...setting, id: year.id } };
  const issues: string[] = [];
  const semesters: { semester: 1 | 2; context: DocumentGenerationContext }[] = [];
  for (const semester of [1, 2] as const) {
    const plans = source.semesterPlans.filter(sp => sp.yearPlanId === year.id && sp.semester === semester);
    if (plans.length !== 1) { issues.push(`Semester ${semester}: SemesterPlan tidak tersedia atau ambigu.`); continue; }
    const sp = plans[0];
    const read = <T>(entries: { semesterPlanId: string; value: T }[] | undefined): T | undefined => {
      const matches = (entries || []).filter(e => e.semesterPlanId === sp.id);
      if (matches.length > 1) throw new Error(`Semester ${semester}: data tersimpan ganda/ambigu.`);
      return matches[0]?.value;
    };
    try {
      const data = source.semesterData;
      const calendar = read(data.academicCalendar);
      const attendance = read(data.attendance);
      const grade = read(data.grade);
      const context: DocumentGenerationContext = { ...annual,
        academicSetting: { ...setting, id: sp.id, semester: semester === 1 ? '1 (Ganjil)' : '2 (Genap)', updatedAt: sp.updatedAt },
        calendar: calendar?.calendar, calendarDays: calendar?.days || [],
        subjectWeeklySchedule: read(data.subjectWeeklySchedules),
        timeAllocations: read(data.timeAllocation) || [], semesterJPSetting: read(source.semesterJPSettings),
        learningPlans: read(data.learningPlan) || [], assessmentPlans: read(data.assessmentPlan) || [],
        assessmentPackages: read(data.assessmentPackage) || [], assessmentCriteria: read(data.assessmentCriteria) || [],
        students: read(data.roster) || [], attendanceSessions: attendance?.sessions || [], attendanceRecords: attendance?.records || [],
        journalRealizations: read(data.journalRealizations) || [],
        assessments: grade?.assessments || [], assessmentResults: grade?.results || [],
        remedials: read(data.remedial) || [], enrichments: read(data.enrichment) || [],
        activeLearningPlanId: undefined, activeAssessmentPackageId: undefined,
      };
      semesters.push({ semester, context });
    } catch (error) { issues.push((error as Error).message); }
  }
  // Schedules stay annual: canonical projection validates global coverage before isolating semester rows.
  const schedules = semesters.flatMap(({ semester, context }) => {
    const entries = source.semesterData.learningMeetingSchedules?.filter(e => e.semesterPlanId === context.academicSetting.id) || [];
    if (entries.length !== 1) return [];
    return [{ semester, semesterPlanId: context.academicSetting.id, schedule: entries[0].value }];
  });
  annual.learningMeetingSchedules = schedules;
  annual.protaSemesterAllocations = semesters.map(({ semester, context }) => ({ semester, semesterPlanId: context.academicSetting.id, allocations: context.timeAllocations || [],
    capacityJP: context.calendar?.workflowStatus === 'CONFIRMED' ? resolveCalendarSubjectCapacity({ semesterPlanId: context.academicSetting.id, calendar: context.calendar, calendarDays: context.calendarDays, schedule: context.subjectWeeklySchedule, weeklyJP: resolveSemesterJPFromValues(context.semesterJPSetting, context.annualJPReference).weeklyJP }).availableJP : null }));
  semesters.forEach(({ context }) => {
    context.learningMeetingSchedules = schedules;
    context.protaSemesterAllocations = annual.protaSemesterAllocations;
  });
  return { annual, semesters, issues };
}

/** Meeting IDs determine semester; Unit placement is an independent cross-check. */
export function resolveZipLearningPlan(plan: LearningPlan, annual: DocumentGenerationContext,
  semesters: ReturnType<typeof resolveAnnualZipContexts>['semesters'], type: 'MODUL_AJAR' | 'RPM' = 'MODUL_AJAR') {
  const fail = (reason: string) => ({ reason, item: undefined });
  const unitOrder = annual.atpUnitMapping?.units.find(unit => unit.id === plan.unitId)?.order;
  const fileStem = unitOrder ? (type === 'RPM' ? 'RPM' : 'Modul_Ajar') + '_Bab_' + unitOrder : undefined;
  if (annual.workMode === 'production') {
    const targets = semesters.filter(target => target.context.academicSetting.id === plan.academicSettingId);
    if (targets.length !== 1) return fail('Semester tujuan Modul Ajar tidak tersedia atau ambigu.');
    const target = targets[0];
    const item: AnnualZipWorkItem = { type, instanceId: plan.id, instanceTitle: plan.title || plan.topic || plan.id,
      context: { ...target.context, learningPlanPresentation: type, learningPlans: [plan], activeLearningPlanId: plan.id, skipDownload: true },
      folderCategory: semesterZipFolder(target.semester), seqNum: unitOrder ?? 1, fileStem };
    return { item, reason: undefined };
  }
  const units = annual.atpUnitMapping?.units.filter(unit => unit.id === plan.unitId) || [];
  const execution = annual.unitExecutionPlan;
  if (units.length !== 1 || !execution || !plan.learningMeetingIds?.length) return fail('Lineage Bab → pertemuan → Modul Ajar tidak lengkap/ambigu.');
  const unit = units[0];
  if (!Number.isInteger(unit.order) || unit.order < 1 || !unit.title.trim()) return fail('Nomor/judul Bab canonical tidak valid.');
  const placement = resolveUnitSemesterPlacement(execution, annual.atpUnitMapping!);
  const placed = placement.resolvedUnits.filter(row => row.unitId === unit.id);
  if (!placement.isValid || !placement.isComplete || placement.isStale || placed.length !== 1) return fail('Penempatan semester Bab belum valid/lengkap atau stale.');
  const planIds = new Set<string>();
  for (const id of plan.learningMeetingIds) {
    const canonical = execution.units.flatMap(u => u.meetings.filter(m => m.id === id).map(() => u.unitId));
    const matches = (annual.learningMeetingSchedules || []).flatMap(bundle =>
      bundle.schedule.entries.filter(entry => entry.meetingId === id).map(entry => ({ bundle, entry })));
    if (canonical.length !== 1 || canonical[0] !== unit.id || matches.length !== 1) return fail(`Pertemuan '${id}' tidak ditemukan, ambigu, atau berbeda Bab.`);
    const { bundle, entry } = matches[0];
    if (entry.unitId !== unit.id || entry.semesterPlanId !== bundle.semesterPlanId ||
        bundle.schedule.semesterPlanId !== bundle.semesterPlanId || bundle.semester !== placed[0].semester) return fail(`Pertemuan '${id}' bertentangan dengan lineage/penempatan semester Bab.`);
    planIds.add(entry.semesterPlanId);
  }
  if (planIds.size !== 1) return fail('Modul Ajar ambigu/lintas semester.');
  const targets = semesters.filter(s => planIds.has(s.context.academicSetting.id));
  if (targets.length !== 1 || plan.academicSettingId !== targets[0].context.academicSetting.id) return fail('SemesterPlan Modul Ajar tidak cocok atau context semester tidak tersedia.');
  const target = targets[0];
  const item: AnnualZipWorkItem = { type, instanceId: plan.id, instanceTitle: unit.title,
    context: { ...target.context, learningPlanPresentation: type, learningPlans: [plan], activeLearningPlanId: plan.id, skipDownload: true },
    folderCategory: semesterZipFolder(target.semester), seqNum: unit.order,
    fileStem };
  return { item, reason: undefined };
}

export function buildAnnualZipWorkItems(types: DocumentType[], base: DocumentGenerationContext) {
  const { annual, semesters, issues } = resolveAnnualZipContexts(base);
  const items: AnnualZipWorkItem[] = [];
  const skipped: ZipExportItemStatus[] = [];
  const skip = (type: DocumentType, reason: string, instanceId?: string) => skipped.push({ type, instanceId, status: 'SKIPPED', reason });
  for (const type of types) {
    if (annualTypes.has(type)) {
      if (issues.some(issue => issue.startsWith('Identitas'))) { skip(type, issues.join('; ')); continue; }
      if (type === 'KALENDER_AKADEMIK' && semesters.length) {
        for (const { semester, context } of semesters) items.push({ type, context,
          instanceId: context.academicSetting.id, instanceTitle: `Kalender Pendidikan Semester ${semester}`,
          folderCategory: 'Administrasi_Umum', seqNum: semester });
        continue;
      }
      items.push({ type, context: annual, folderCategory: 'Administrasi_Umum', seqNum: items.length + 1 });
    } else if (type === 'MODUL_AJAR' || type === 'RPM') {
      const orders = new Map(annual.atpUnitMapping?.units.map(unit => [unit.id, unit.order]));
      const plans = semesters.flatMap(s => s.context.learningPlans || []).sort((a, b) =>
        (orders.get(a.unitId) ?? Infinity) - (orders.get(b.unitId) ?? Infinity));
      if (base.workMode === 'production' && base.zipAnnualSource?.yearPlan.identityOnlyImport?.mode === 'IDENTITY_ONLY') {
        for (const semester of [1, 2]) {
          if (!semesters.find(scope => scope.semester === semester)?.context.learningPlans?.length) {
            skip(type, 'Semester ' + semester + ': Modul Ajar belum tersedia.');
          }
        }
        for (const unit of annual.atpUnitMapping?.units || []) {
          if (!plans.some(plan => plan.unitId === unit.id)) skip(type, 'Bab ' + unit.title + ': Modul Ajar belum tersedia.', unit.id);
        }
      } else if (!plans.length) skip(type, 'Belum ada Modul Ajar pada context semester tersedia. ' + issues.join('; '));
      for (const plan of plans) {
        if (plans.filter(p => p.id === plan.id).length !== 1) { skip(type, 'ID Modul Ajar ganda/ambigu.', plan.id); continue; }
        const result = resolveZipLearningPlan(plan, annual, semesters, type);
        if (result.item) items.push(result.item); else skip(type, result.reason!, plan.id);
      }
    } else {
      for (const semester of [1, 2] as const) {
        const scoped = semesters.find(s => s.semester === semester);
        if (!scoped) { skip(type, `Semester ${semester}: context canonical tidak tersedia. ${issues.join('; ')}`); continue; }
        const folderCategory = semesterZipFolder(semester);
        if (type === 'ASESMEN') {
          const packages = scoped.context.assessmentPackages || [];
          if (!packages.length) skip(type, `Semester ${semester}: belum ada perangkat asesmen.`);
          for (const pkg of packages) {
            items.push({ type, instanceId: pkg.id, instanceTitle: pkg.title, folderCategory, seqNum: items.length + 1,
              context: { ...scoped.context, activeAssessmentPackageId: pkg.id } });
          }
        } else items.push({ type, context: scoped.context, folderCategory, seqNum: 1 });
      }
    }
  }
  return { items, skipped };
}
