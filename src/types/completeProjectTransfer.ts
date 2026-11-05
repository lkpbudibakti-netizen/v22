import type { AppStorageStateV5 } from './storageV5';

/** A single scoped project, never an application backup. */
export interface CompleteProjectArchive {
  kind: 'ADMINISTRATION_PROJECT';
  schemaVersion: '2.0';
  exportedAt: string;
  project: AppStorageStateV5;
}

export interface CompleteProjectImportOptions {
  mode: 'RESTORE' | 'COPY' | 'IDENTITY_ONLY' | 'IDENTITY_SCHEDULE' | 'OTHER_CLASS' | 'CONTINUE_EDITING';
  documentDate?: string;
  targetGrade?: string;
  targetClassSection?: string;
  targetProfileId: string;
  targetSchoolId: string;
  replaceYearPlanId?: string;
}

export const ADMINISTRATION_IMPORT_MODES = [
  { mode: 'IDENTITY_ONLY', title: 'Ganti Identitas Saja', description: 'Impor master lalu unduh ZIP PDF/DOCX otomatis.' },
  { mode: 'IDENTITY_SCHEDULE', title: 'Ganti Identitas & Jadwal', description: 'Pertahankan substansi, sesuaikan kalender, JP, dan pertemuan.' },
  { mode: 'OTHER_CLASS', title: 'Duplikasi untuk Kelas Lain', description: 'Pilih kelas/rombel; periksa kompatibilitas sebelum digunakan.' },
  { mode: 'CONTINUE_EDITING', title: 'Lanjutkan Penyuntingan', description: 'Buka salinan perencanaan yang dapat diedit, dengan progres valid tetap dipertahankan.' },
] as const;
