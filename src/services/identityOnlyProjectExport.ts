import type { AppStorageStateV5 } from '../types/storageV5';
import type { DocumentGenerationContext, DocumentType, ZipExportOptions } from './documentEngine/types';
import { buildAnnualZipWorkItems, resolveAnnualZipContexts } from './documentEngine/annualZipPlan';
import { DOCUMENT_CATALOG, generateZipBundle, validateDocumentRequirements } from './documentEngine';
import { resolveEffectiveContext } from './documentEngine/snapshot';
import { getCurriculumDocumentTypes } from './curriculumRouter';
import type { WorkMode } from './workMode';
import { ProductionExportError, productionFinding, productionZipFindings } from './productionValidation';

export const PRODUCTION_PACKAGE_LABELS = {
  complete: 'Paket lengkap (termasuk asesmen)',
  core: 'Paket CP sampai Modul Ajar',
} as const;
export type ProductionPackageScope = keyof typeof PRODUCTION_PACKAGE_LABELS;
const factualDocuments = new Set<DocumentType>(['DAFTAR_HADIR', 'DAFTAR_NILAI', 'REMEDIAL_PENGAYAAN']);
const coreDocuments = new Set<DocumentType>(['CP', 'TP', 'ANALISIS_CP_TP', 'ATP', 'PEMETAAN_ATP_UNIT',
  'ANALISIS_SKL_KI_KD', 'KALENDER_AKADEMIK', 'ALOKASI_WAKTU', 'PROTA', 'PROMES', 'MODUL_AJAR', 'RPM']);

function resolveProductionPackage(context: DocumentGenerationContext, scope: ProductionPackageScope) {
  const catalog = getCurriculumDocumentTypes(context.academicSetting.curriculumType || 'KURIKULUM_MERDEKA');
  const types = catalog.filter(type => scope === 'core' ? coreDocuments.has(type) : !factualDocuments.has(type));
  return { types, excludedDocumentTypes: catalog.filter(type => !types.includes(type)) };
}

/** Existing annual ZIP planner supplies exact semester contexts; no fabricated scope. */
export function buildImportedProjectExportContext(state: AppStorageStateV5, yearPlanId: string, workMode?: WorkMode): DocumentGenerationContext {
  const year = state.yearPlans.find(year => year.id === yearPlanId);
  if (!year) throw new Error('Proyek hasil impor tidak ditemukan.');
  const profile = state.profiles.find(profile => profile.id === year.profileId);
  const school = state.schools.find(school => school.id === year.schoolId);
  const workspace = state.workspaces.find(workspace => workspace.yearPlanId === year.id);
  const semesterPlans = state.semesterPlans.filter(plan => plan.yearPlanId === year.id).sort((a,b) => a.semester-b.semester);
  if (!profile || !school || !workspace || !semesterPlans.length) throw new Error('Identitas/konteks tujuan tidak lengkap.');
  const read = <T,>(entries: { yearPlanId: string; value: T }[] | undefined) => entries?.find(entry => entry.yearPlanId === year.id)?.value;
  const base: DocumentGenerationContext = {
    workMode, annualJPReference: read(state.annualJPReferences),
    profile, school, workspace: { ...workspace, academicSettingId: year.id },
    academicSetting: { ...year, id: semesterPlans[0].id, curriculum: year.curriculumType === 'K13' ? 'Kurikulum 2013' : 'Kurikulum Merdeka', phase: year.phase || '', semester: semesterPlans[0].semester === 1 ? '1 (Ganjil)' : '2 (Genap)' },
    cpAnalysis: read(state.annualData.cpAnalysis), cp: read(state.annualData.cp), tp: read(state.annualData.tp), atp: read(state.annualData.atp),
    atpUnitMapping: read(state.annualData.atpUnitMappings), unitExecutionPlan: read(state.annualData.unitExecutionPlans),
    documentDate: workspace.documentDate, documentMode: 'data', snapshot: undefined, skipDownload: true,
    zipAnnualSource: { yearPlan: year, semesterPlans, semesterData: state.semesterData, semesterJPSettings: state.semesterJPSettings },
  };
  const resolved = resolveAnnualZipContexts(base);
  const first = resolved.semesters.find(item => item.context.academicSetting.id === semesterPlans[0].id);
  if (!first) throw new Error(resolved.issues.join('; ') || 'Konteks semester tujuan tidak tersedia.');
  return resolveEffectiveContext({ ...first.context, zipAnnualSource: base.zipAnnualSource, snapshot: undefined });
}

export function importedProjectExportReadiness(state: AppStorageStateV5, yearPlanId: string, workMode?: WorkMode, scope: ProductionPackageScope = 'complete') {
  const context = buildImportedProjectExportContext(state, yearPlanId, workMode);
  const { types } = workMode === 'production' && context.zipAnnualSource?.yearPlan.identityOnlyImport?.mode === 'IDENTITY_ONLY'
    ? resolveProductionPackage(context, scope)
    : { types: getCurriculumDocumentTypes(context.academicSetting.curriculumType || 'KURIKULUM_MERDEKA') };
  const plan = buildAnnualZipWorkItems(types, context);
  const rows = plan.items.map(item => {
    const validation = validateDocumentRequirements(item.type, resolveEffectiveContext(item.context));
    return { type: item.type, instanceId: item.instanceId, title: item.instanceTitle || DOCUMENT_CATALOG.find(doc => doc.type === item.type)?.title || item.type,
      ready: validation.isValid, reasons: validation.missingFields };
  });
  rows.push(...plan.skipped.map(item => ({ type: item.type, instanceId: item.instanceId, title: item.instanceTitle || item.type, ready: false, reasons: [item.reason || 'Konteks belum tersedia.'] })));
  return { context, types, rows, readyCount: rows.filter(row => row.ready).length, skippedCount: rows.filter(row => !row.ready).length };
}

interface ProductionPackageOptions extends Pick<ZipExportOptions, 'format' | 'types' | 'onProgress'> {
  scope?: ProductionPackageScope;
  containsSourceIdentity: (zip: Uint8Array, tokens: string[]) => Promise<boolean>;
}

export function generateImportedProductionPackage(state: AppStorageStateV5, yearPlanId: string, options: ProductionPackageOptions) {
  return generateProductionPackage(buildImportedProjectExportContext(state, yearPlanId, 'production'), options);
}

export async function generateProductionPackage(context: DocumentGenerationContext, options: ProductionPackageOptions) {
  const scope = options.scope ?? 'complete';
  const format = options.format ?? 'both';
  const { types, excludedDocumentTypes } = resolveProductionPackage(context, scope);
  const result = await generateZipBundle({ types: options.types ?? types, format, documentMode: 'data', onProgress: options.onProgress }, { ...context, skipExportDiagnostics: true });
  const documents = result.itemResults || [];
  const findings = [...productionZipFindings(result), ...(result.warnings || [])];
  if (!result.zipBlob) throw new ProductionExportError([
    ...findings, productionFinding('ZIP', 'Paket administrasi', 'BLOCKER_PAKET', 'ZIP tidak dihasilkan.'),
  ], documents);
  const zip = new Uint8Array(await result.zipBlob.arrayBuffer());
  const tokens = context.zipAnnualSource?.yearPlan.identityOnlyImport?.sourceIdentityTokens || [];
  let containsSourceIdentity: boolean;
  try {
    containsSourceIdentity = await options.containsSourceIdentity(zip, tokens);
  } catch (error) {
    throw new ProductionExportError([
      ...findings, productionFinding('ZIP', 'Integritas ZIP', 'BLOCKER_PAKET',
        'ZIP tidak dapat diverifikasi: ' + (error instanceof Error ? error.message : String(error))),
    ], documents);
  }
  if (containsSourceIdentity) throw new ProductionExportError([
    ...findings, productionFinding('ZIP', 'Identitas sumber', 'BLOCKER_PAKET', 'Dokumen hasil ekspor masih memuat identitas asal.'),
  ], documents);

  const exportGenerated = true;
  const exportCompleteForRequestedScope = result.isComplete === true;
  const orderFulfillable = exportCompleteForRequestedScope && format === 'both' &&
    result.pdfCount === result.requestedCount && result.docxCount === result.requestedCount;
  if (format === 'both' && !orderFulfillable) {
    findings.push(productionFinding('ZIP', 'Paket administrasi', 'BLOCKER_PAKET', 'Paket PDF dan DOCX belum lengkap.'));
  }
  return { result, zip, documents, findings, excludedDocumentTypes, scope, exportGenerated, exportCompleteForRequestedScope, orderFulfillable };
}