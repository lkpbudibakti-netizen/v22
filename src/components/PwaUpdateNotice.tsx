import React, { useEffect, useRef, useState } from 'react';
import { APP_BUILD_ID, APP_BUILD_SHA } from '../config/buildInfo';
import { createRuntimeUpdateMonitor, RuntimeUpdateState } from '../services/runtimeUpdateService';

export function PwaUpdateNotice() {
  const [state, setState] = useState<RuntimeUpdateState>({ waiting: false, needsReload: false });
  const apply = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    let disposed = false;
    let registration: ServiceWorkerRegistration | undefined;
    const monitor = createRuntimeUpdateMonitor({
      runtimeBuildId: APP_BUILD_ID,
      notify: next => { if (!disposed) setState(next); },
      reload: () => window.location.reload(),
      isBusy: () => Boolean(document.querySelector('[data-export-busy="true"]')),
    });
    // Native registration avoids helper-owned reload handlers bypassing consent/busy checks.
    const workerCleanups: Array<() => void> = [];
    let hadController = Boolean(navigator.serviceWorker?.controller);
    const watchInstallingWorker = () => {
      const worker = registration?.installing;
      if (!worker) return;
      const onStateChange = () => {
        if (!disposed && worker.state === 'installed' && (hadController || registration?.waiting)) monitor.waiting();
      };
      worker.addEventListener('statechange', onStateChange);
      workerCleanups.push(() => worker.removeEventListener('statechange', onStateChange));
      onStateChange();
    };
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      void navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js',
        { scope: import.meta.env.BASE_URL, updateViaCache: 'none' },
      ).then(result => {
        if (disposed) return;
        registration = result;
        result.addEventListener('updatefound', watchInstallingWorker);
        workerCleanups.push(() => result.removeEventListener('updatefound', watchInstallingWorker));
        watchInstallingWorker();
        if (result.waiting) monitor.waiting();
        void check();
      }).catch(() => { /* Deployment identity can still be checked if registration fails. */ });
    }
    const update = async () => {
      if (!registration?.waiting) throw new Error('Service worker baru belum siap.');
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    };
    async function check() {
      let workerChecked = false;
      try {
        if (registration) { await registration.update(); workerChecked = true; }
        if (registration?.waiting) monitor.waiting();
      } catch { /* A failed worker check must not prevent checking deployment identity. */ }
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}build-info.json?check=${Date.now()}`, { cache: 'no-store' });
        if (response.ok) monitor.compare(await response.json());
      } catch { /* Offline is not evidence of an old build. */ }
      return workerChecked && !registration?.installing && !registration?.waiting;
    }
    apply.current = async () => monitor.apply(update, Boolean(navigator.serviceWorker?.controller), await check());
    const onControllerChange = () => {
      if (!disposed && hadController) monitor.controllerChanged();
      hadController = true;
    };
    navigator.serviceWorker?.addEventListener('controllerchange', onControllerChange);
    const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', check);
    const interval = window.setInterval(check, 60_000);
    void check();
    return () => { disposed = true; workerCleanups.forEach(cleanup => cleanup()); navigator.serviceWorker?.removeEventListener('controllerchange', onControllerChange); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('online', check); window.clearInterval(interval); };
  }, []);
  if (!state.newerBuildId && !state.waiting && !state.needsReload && APP_BUILD_ID !== 'runtime-unknown') return null;
  return <aside role="status" className="bg-amber-50 border-b border-amber-200 px-4 py-3 text-sm text-amber-950">
    <strong>{state.newerBuildId || state.waiting || state.needsReload ? 'Aplikasi masih memakai versi lama.' : 'Identitas build runtime belum tersedia.'}</strong>{' '}
    Simpan perubahan Anda sebelum memperbarui aplikasi.
    <button className="ml-3 underline font-bold" onClick={() => void apply.current()}>Perbarui &amp; Muat Ulang</button>
    {state.error && <p>{state.error}</p>}
    <details className="text-xs"><summary>Detail versi</summary><p>Runtime SHA: {APP_BUILD_SHA || 'tidak tersedia'}</p><p>Runtime: {APP_BUILD_ID}</p><p>Tersedia: {state.newerBuildId || 'pembaruan service worker'}</p></details>
  </aside>;
}
