export interface RuntimeUpdateState {
  newerBuildId?: string;
  waiting: boolean;
  needsReload: boolean;
  error?: string;
}
export function createRuntimeUpdateMonitor(options: {
  runtimeBuildId: string;
  notify: (state: RuntimeUpdateState) => void;
  reload: () => void;
  isBusy: () => boolean;
}) {
  let state: RuntimeUpdateState = { waiting: false, needsReload: false };
  let consent = false;
  let reloaded = false;
  const reloadOnce = () => { if (!reloaded) { reloaded = true; options.reload(); } };
  const publish = (next: Partial<RuntimeUpdateState>) => { state = { ...state, ...next }; options.notify({ ...state }); };
  return {
    waiting() { publish({ waiting: true }); },
    compare(remote: unknown) {
      // buildId is the version authority; SHA is optional diagnostic metadata.
      if (remote && typeof remote === 'object' && 'buildId' in remote &&
          typeof remote.buildId === 'string' && remote.buildId.trim().length > 0) {
        publish({ newerBuildId: remote.buildId !== options.runtimeBuildId ? remote.buildId : undefined });
      }
    },
    controllerChanged() {
      if (consent && !options.isBusy()) reloadOnce();
      else publish({ needsReload: true });
    },
    async apply(update: () => Promise<void>, hasController: boolean, workerChecked = false) {
      if (options.isBusy()) { publish({ error: 'Tunggu proses ekspor selesai sebelum memperbarui aplikasi.' }); return; }
      consent = true;
      publish({ error: undefined });
      if (state.needsReload || (!hasController && !state.waiting) ||
          (state.newerBuildId && workerChecked && !state.waiting)) { reloadOnce(); return; }
      if (!state.waiting) { consent = false; publish({ error: 'Versi baru terdeteksi. Tunggu pembaruan aplikasi siap, lalu coba lagi.' }); return; }
      try { await update(); }
      catch { consent = false; publish({ error: 'Pembaruan belum berhasil. Coba kembali saat tersambung.' }); }
    },
  };
}
