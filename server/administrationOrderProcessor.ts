import { randomUUID } from 'node:crypto';
import type { SchoolData, TeacherProfile } from '../src/types';
import type { CompleteProjectArchive } from '../src/types/completeProjectTransfer';
import { prepareCompleteAdministrationProjectImport, validateCompleteProjectArchive } from '../src/services/administrationProjectImportService';
import { readCompleteProjectZip } from '../src/services/completeProjectZipService';
import { getCurriculumDocumentTypes } from '../src/services/curriculumRouter';
import { generateZipBundle } from '../src/services/documentEngine';
import { resolveAnnualZipContexts } from '../src/services/documentEngine/annualZipPlan';
import { orderZipContainsSourceIdentity } from './administrationOrderZipIdentity';
import type { DocumentType, ZipExportItemStatus } from '../src/services/documentEngine/types';
import { buildImportedProjectExportContext } from '../src/services/identityOnlyProjectExport';
import {
  ProductionExportError, productionFinding, productionZipFindings, type ProductionFinding,
} from '../src/services/productionValidation';
import { createInitialStorageV5 } from '../src/services/storageV5';

type CustomerSchool = Pick<SchoolData,
  'name' | 'npsn' | 'address' | 'village' | 'district' | 'regency' | 'province' | 'principalName' | 'principalNip'>;
type CustomerTeacher = Pick<TeacherProfile, 'name' | 'nip' | 'nuptk' | 'status'>;

export interface AdministrationOrderInput {
  project: CompleteProjectArchive | Uint8Array | ArrayBuffer;
  customer: { teacher: CustomerTeacher; school: CustomerSchool; documentDate: string };
}

interface OrderValidationReport {
  warnings: string[];
  findings: ProductionFinding[];
  documents: ZipExportItemStatus[];
  excludedDocumentTypes: DocumentType[];
}

export type AdministrationOrderResult =
  | { success: true; zip: Uint8Array; fileName: string; validation: OrderValidationReport }
  | { success: false; validation: OrderValidationReport };

// IDENTITY_ONLY deliberately drops factual records belonging to the source school.
const factualDocumentTypes: DocumentType[] = ['DAFTAR_HADIR', 'DAFTAR_NILAI', 'REMEDIAL_PENGAYAAN'];

export async function processAdministrationOrder(input: AdministrationOrderInput): Promise<AdministrationOrderResult> {
  const validation: OrderValidationReport = { warnings: [], findings: [], documents: [], excludedDocumentTypes: [] };
  let stage = 'IMPORT';
  try {
    const { project, customer } = input;
    const archive = project instanceof Uint8Array || project instanceof ArrayBuffer
      ? await readCompleteProjectZip(project) : validateCompleteProjectArchive(project);
    const { teacher, school, documentDate } = customer;
    const state = createInitialStorageV5();
    const createdAt = new Date().toISOString();
    const schoolId = randomUUID();
    const profileId = randomUUID();
    const schoolName = school.name.trim();
    const teacherName = teacher.name.trim();
    if (!schoolName || !teacherName) throw new Error('Nama guru dan sekolah tujuan wajib diisi.');
    state.schools.push({
      id: schoolId, createdAt, updatedAt: createdAt, name: schoolName,
      npsn: school.npsn.trim(), address: school.address.trim(), village: school.village.trim(),
      district: school.district.trim(), regency: school.regency.trim(), province: school.province.trim(),
      principalName: school.principalName.trim(), principalNip: school.principalNip.trim(),
    });
    state.profiles.push({
      id: profileId, schoolId, createdAt, updatedAt: createdAt, name: teacherName,
      nip: teacher.nip.trim(), nuptk: teacher.nuptk?.trim(), status: teacher.status,
      defaultSubject: archive.project.yearPlans[0].subject, defaultLevel: archive.project.yearPlans[0].level,
    });

    const prepared = prepareCompleteAdministrationProjectImport(state, archive, {
      mode: 'IDENTITY_ONLY', workMode: 'production', targetProfileId: profileId, targetSchoolId: schoolId, documentDate,
    });
    validation.warnings = prepared.warnings;
    stage = 'VALIDASI';
    const context = {
      ...buildImportedProjectExportContext(prepared.state, prepared.yearPlanId, 'production'),
      skipDownload: true, skipExportDiagnostics: true,
    };
    const catalog = getCurriculumDocumentTypes(context.academicSetting.curriculumType || 'KURIKULUM_MERDEKA');
    const required = catalog.filter(type => !factualDocumentTypes.includes(type));
    validation.excludedDocumentTypes = catalog.filter(type => factualDocumentTypes.includes(type));

    const year = context.zipAnnualSource!.yearPlan;
    const normalize = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('id');
    const targetValues = new Set([teacherName, teacher.nip, teacher.nuptk, schoolName, school.npsn, school.address,
      school.village, school.district, school.regency, school.province, school.principalName, school.principalNip]
      .flatMap(value => value ? [normalize(value)] : []));
    const sourceSchool = archive.project.schools[0];
    const tokens = [...(year.identityOnlyImport?.sourceIdentityTokens || []), archive.project.profiles[0].nuptk,
      sourceSchool.village, sourceSchool.district, sourceSchool.regency, sourceSchool.province]
      .filter((value): value is string => typeof value === 'string' && !!value.trim() && !targetValues.has(normalize(value)));
    const { semesters, issues } = resolveAnnualZipContexts(context);
    for (const issue of issues) validation.findings.push(productionFinding(stage, 'Semester', 'BLOCKER_PAKET', issue));
    if (required.includes('MODUL_AJAR')) {
      const plannedUnits = new Set(semesters.flatMap(({ context: scope }) => (scope.learningPlans || []).map(plan => plan.unitId)));
      for (const unit of context.atpUnitMapping?.units || []) {
        if (!plannedUnits.has(unit.id)) validation.findings.push(
          productionFinding('MODUL_AJAR', unit.title, 'BLOCKER_DOKUMEN', 'Bab belum memiliki Modul Ajar.'),
        );
      }
      for (const { semester, context: scope } of semesters) {
        if (!scope.learningPlans?.length) validation.findings.push(
          productionFinding('MODUL_AJAR', 'Semester ' + semester, 'BLOCKER_DOKUMEN', 'Belum ada Modul Ajar.'),
        );
      }
    }
    stage = 'ZIP';
    const result = await generateZipBundle({ types: required, format: 'both', documentMode: 'data' },
      context);
    validation.documents = result.itemResults || [];
    validation.findings.push(...productionZipFindings(result));
    if (!result.isComplete || !result.zipBlob || result.pdfCount !== result.requestedCount || result.docxCount !== result.requestedCount) {
      validation.findings.push(productionFinding(stage, 'Paket administrasi', 'BLOCKER_PAKET', 'Paket PDF dan DOCX belum lengkap.'));
      return { success: false, validation };
    }
    if (validation.findings.some(finding => finding.classification !== 'WARNING')) return { success: false, validation };
    const zip = new Uint8Array(await result.zipBlob.arrayBuffer());
    if (await orderZipContainsSourceIdentity(zip, tokens)) {
      validation.findings.push(productionFinding(stage, 'Identitas sumber', 'BLOCKER_PAKET',
        'Dokumen hasil ekspor masih memuat identitas asal.'));
      return { success: false, validation };
    }
    return { success: true, fileName: result.zipFileName, zip, validation };
  } catch (error) {
    if (error instanceof ProductionExportError) {
      validation.findings.push(...error.findings);
      validation.documents = error.documents;
    }
    else validation.findings.push(productionFinding(stage, 'Pesanan', 'BLOCKER_PAKET',
      error instanceof Error ? error.message : 'Pemrosesan pesanan gagal.'));
    return { success: false, validation };
  }
}
