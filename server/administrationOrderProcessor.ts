import { randomUUID } from 'node:crypto';
import type { SchoolData, TeacherProfile } from '../src/types';
import type { CompleteProjectArchive } from '../src/types/completeProjectTransfer';
import { prepareCompleteAdministrationProjectImport, validateCompleteProjectArchive } from '../src/services/administrationProjectImportService';
import { readCompleteProjectZip } from '../src/services/completeProjectZipService';
import { orderZipContainsSourceIdentity } from './administrationOrderZipIdentity';
import type { DocumentType, ZipExportItemStatus } from '../src/services/documentEngine/types';
import { generateImportedProductionPackage, type ProductionPackageScope } from '../src/services/identityOnlyProjectExport';
import {
  ProductionExportError, productionFinding, type ProductionFinding,
} from '../src/services/productionValidation';
import { createInitialStorageV5 } from '../src/services/storageV5';

type CustomerSchool = Pick<SchoolData,
  'name' | 'npsn' | 'address' | 'village' | 'district' | 'regency' | 'province' | 'principalName' | 'principalNip'>;
type CustomerTeacher = Pick<TeacherProfile, 'name' | 'nip' | 'nuptk' | 'status'>;

export interface AdministrationOrderInput {
  packageScope?: ProductionPackageScope;
  project: CompleteProjectArchive | Uint8Array | ArrayBuffer;
  customer: { teacher: CustomerTeacher; school: CustomerSchool; documentDate: string };
}

interface OrderValidationReport {
  packageScope: ProductionPackageScope;
  exportGenerated: boolean;
  exportCompleteForRequestedScope: boolean;
  orderFulfillable: boolean;
  warnings: string[];
  findings: ProductionFinding[];
  documents: ZipExportItemStatus[];
  excludedDocumentTypes: DocumentType[];
}

export type AdministrationOrderResult =
  | { success: true; zip: Uint8Array; fileName: string; validation: OrderValidationReport }
  | { success: false; validation: OrderValidationReport };

export async function processAdministrationOrder(input: AdministrationOrderInput): Promise<AdministrationOrderResult> {
  const validation: OrderValidationReport = { warnings: [], findings: [], documents: [], excludedDocumentTypes: [],
    packageScope: input.packageScope ?? 'complete', exportGenerated: false, exportCompleteForRequestedScope: false, orderFulfillable: false };
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
    stage = 'ZIP';
    const generated = await generateImportedProductionPackage(prepared.state, prepared.yearPlanId, {
      scope: validation.packageScope, containsSourceIdentity: orderZipContainsSourceIdentity,
    });
    validation.documents = generated.documents;
    validation.findings.push(...generated.findings);
    validation.excludedDocumentTypes = generated.excludedDocumentTypes;
    validation.exportGenerated = generated.exportGenerated;
    validation.exportCompleteForRequestedScope = generated.exportCompleteForRequestedScope;
    validation.orderFulfillable = generated.orderFulfillable;
    if (!generated.orderFulfillable) return { success: false, validation };
    return { success: true, fileName: generated.result.zipFileName, zip: generated.zip, validation };
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
