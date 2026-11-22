import { computeMappingFingerprint } from './atpMappingActionApplyService';
import type { ATPData, TPData, ATPUnitMapping } from '../types';

export interface AsyncAnalysisGuardResult<T> {
  success: boolean;
  result?: T;
  error?: string;
  isStaleOrOutdated?: boolean;
}

export async function runGuardedAnalysis<T>(params: {
  requestId: number;
  getCurrentRequestId: () => number;
  unitsGetter: () => ATPUnitMapping[];
  atpGetter: () => ATPData;
  tpGetter: () => TPData;
  expectedFingerprint: string;
  fetchFn: () => Promise<T>;
}): Promise<AsyncAnalysisGuardResult<T>> {
  try {
    const data = await params.fetchFn();

    // Check request identity / out-of-order
    if (params.requestId !== params.getCurrentRequestId()) {
      return { success: false, isStaleOrOutdated: true };
    }

    // Check fingerprint freshness (ATP, TP, or draft units changed)
    const freshFp = computeMappingFingerprint(
      params.unitsGetter(),
      params.atpGetter(),
      params.tpGetter()
    );

    if (params.requestId !== params.getCurrentRequestId()) {
      return { success: false, isStaleOrOutdated: true };
    }

    if (params.expectedFingerprint !== freshFp) {
      return {
        success: false,
        error: 'Data Bab, ATP, atau TP berubah selama analisis. Jalankan analisis ulang.',
        isStaleOrOutdated: true,
      };
    }

    return { success: true, result: data };
  } catch (err: any) {
    if (params.requestId !== params.getCurrentRequestId()) {
      return { success: false, isStaleOrOutdated: true };
    }
    return {
      success: false,
      error: err?.message || 'Gagal menganalisis pemetaan Bab & Lingkup Materi.',
    };
  }
}
