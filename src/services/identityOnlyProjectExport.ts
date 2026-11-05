import type { AppStorageStateV5 } from '../types/storageV5';
import type { DocumentGenerationContext, DocumentType } from './documentEngine/types';
import { buildAnnualZipWorkItems, resolveAnnualZipContexts } from './documentEngine/annualZipPlan';
import { DOCUMENT_CATALOG, validateDocumentRequirements } from './documentEngine';
import { resolveEffectiveContext } from './documentEngine/snapshot';
import { getCurriculumDocumentTypes } from './curriculumRouter';

/** Existing annual ZIP planner supplies exact semester contexts; no fabricated scope. */
export function buildImportedProjectExportContext(state: AppStorageStateV5, yearPlanId: string): DocumentGenerationContext {
  const year = state.yearPlans.find(year => year.id === yearPlanId);
  if (!year) throw new Error('Proyek hasil impor tidak ditemukan.');
  const profile = state.profiles.find(profile => profile.id === year.profileId);
  const school = state.schools.find(school => school.id === year.schoolId);
  const workspace = state.workspaces.find(workspace => workspace.yearPlanId === year.id);
  const semesterPlans = state.semesterPlans.filter(plan => plan.yearPlanId === year.id).sort((a,b) => a.semester-b.semester);
  if (!profile || !school || !workspace || !semesterPlans.length) throw new Error('Identitas/konteks tujuan tidak lengkap.');
  const read = <T,>(entries: { yearPlanId: string; value: T }[] | undefined) => entries?.find(entry => entry.yearPlanId === year.id)?.value;
  const base: DocumentGenerationContext = {
    profile, school, workspace: { ...workspace, academicSettingId: year.id },
    academicSetting: { ...year, id: semesterPlans[0].id, curriculum: year.curriculumType === 'K13' ? 'Kurikulum 2013' : 'Kurikulum Merdeka', phase: year.phase || '', semester: semesterPlans[0].semester === 1 ? '1 (Ganjil)' : '2 (Genap)' },
    cp: read(state.annualData.cp), tp: read(state.annualData.tp), atp: read(state.annualData.atp),
    atpUnitMapping: read(state.annualData.atpUnitMappings), unitExecutionPlan: read(state.annualData.unitExecutionPlans),
    documentDate: workspace.documentDate, documentMode: 'data', snapshot: undefined, skipDownload: true,
    zipAnnualSource: { yearPlan: year, semesterPlans, semesterData: state.semesterData, semesterJPSettings: state.semesterJPSettings },
  };
  const resolved = resolveAnnualZipContexts(base);
  const first = resolved.semesters.find(item => item.context.academicSetting.id === semesterPlans[0].id);
  if (!first) throw new Error(resolved.issues.join('; ') || 'Konteks semester tujuan tidak tersedia.');
  return resolveEffectiveContext({ ...first.context, zipAnnualSource: base.zipAnnualSource, snapshot: undefined });
}

export function importedProjectExportReadiness(state: AppStorageStateV5, yearPlanId: string) {
  const context = buildImportedProjectExportContext(state, yearPlanId);
  const types = getCurriculumDocumentTypes(context.academicSetting.curriculumType || 'KURIKULUM_MERDEKA') as DocumentType[];
  const plan = buildAnnualZipWorkItems(types, context);
  const rows = plan.items.map(item => {
    const validation = validateDocumentRequirements(item.type, resolveEffectiveContext(item.context));
    return { type: item.type, instanceId: item.instanceId, title: item.instanceTitle || DOCUMENT_CATALOG.find(doc => doc.type === item.type)?.title || item.type,
      ready: validation.isValid, reasons: validation.missingFields };
  });
  rows.push(...plan.skipped.map(item => ({ type: item.type, instanceId: item.instanceId, title: item.instanceTitle || item.type, ready: false, reasons: [item.reason || 'Konteks belum tersedia.'] })));
  return { context, types, rows, readyCount: rows.filter(row => row.ready).length, skippedCount: rows.filter(row => !row.ready).length };
}
