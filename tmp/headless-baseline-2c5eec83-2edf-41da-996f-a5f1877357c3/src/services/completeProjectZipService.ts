import JSZip from 'jszip';
import FileSaver from 'file-saver';
import type { AppStorageStateV5 } from '../types/storageV5';
import type { CompleteProjectArchive } from '../types/completeProjectTransfer';
import { exportCompleteAdministrationProjectFromState } from './administrationProjectExportService';
import { validateCompleteProjectArchive } from './administrationProjectImportService';

export async function createCompleteProjectZip(state: AppStorageStateV5, yearPlanId: string) {
  const archive = exportCompleteAdministrationProjectFromState(state, yearPlanId);
  validateCompleteProjectArchive(archive);
  return new JSZip().file('project.json', JSON.stringify(archive)).generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function downloadCompleteProjectZip(state: AppStorageStateV5, yearPlanId: string) {
  const bytes = await createCompleteProjectZip(state, yearPlanId);
  const year = state.yearPlans.find(y => y.id === yearPlanId)!;
  const name = `Proyek-${year.subject}-${year.grade}-${year.academicYear}`.replace(/[^\p{L}\p{N}_-]/gu, '-');
  FileSaver.saveAs(new Blob([bytes as BlobPart], { type: 'application/zip' }), `${name}.zip`);
}

export async function readCompleteProjectZip(bytes: ArrayBuffer | Uint8Array): Promise<CompleteProjectArchive> {
  if (bytes.byteLength > 25 * 1024 * 1024) throw new Error('ZIP melebihi batas 25 MB.');
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const entries = Object.values(zip.files).filter(f => !f.dir);
  if (entries.length !== 1 || entries[0].name !== 'project.json') throw new Error('ZIP harus berisi satu project.json proyek lengkap.');
  const json = await entries[0].async('string');
  if (json.length > 50 * 1024 * 1024) throw new Error('Isi proyek terlalu besar (batas 50 MB).');
  return validateCompleteProjectArchive(JSON.parse(json));
}
