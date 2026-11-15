export type WorkMode = 'authoring' | 'production';

export const WORK_MODE_LABELS: Record<WorkMode, string> = {
  authoring: 'Penyusunan',
  production: 'Produksi Paket',
};
export const WORK_MODE_STORAGE_KEY = 'administrasi_guru_work_mode';

// Mode preferences are separate from master data and never promote workflow status.
export function readWorkMode(): WorkMode {
  try { return localStorage.getItem(WORK_MODE_STORAGE_KEY) === 'production' ? 'production' : 'authoring'; }
  catch { return 'authoring'; }
}

export function saveWorkMode(mode: WorkMode): boolean {
  try { localStorage.setItem(WORK_MODE_STORAGE_KEY, mode); return true; }
  catch { return false; }
}

export function isProductionContext(context: { workMode?: WorkMode }): boolean {
  return context.workMode === 'production';
}
