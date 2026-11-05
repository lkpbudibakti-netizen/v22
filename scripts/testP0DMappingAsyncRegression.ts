import assert from 'node:assert';
import { runGuardedAnalysis } from '../src/services/atpAsyncGuard';
import { computeMappingFingerprint } from '../src/services/atpMappingActionApplyService';
import type { ATPData, TPData, ATPUnitMapping } from '../src/types';

console.log('=== RUNNING P0-D ASYNC SAFETY REGRESSION TESTS ===');

const mockAtp: ATPData = {
  id: 'atp-1',
  academicSettingId: 'set-1',
  tpDataId: 'tp-1',
  basedOnTpUpdatedAt: '2026-01-01',
  updatedAt: '2026-01-01',
  items: [],
};

const mockTp: TPData = {
  academicSettingId:'set-1',
  id: 'tp-1',
  updatedAt: '2026-01-01',
  items: [],
};

const mockUnits: ATPUnitMapping[] = [
  { id: 'u-1', title: 'Bab 1', order: 1, materials: [], linkedTpIds: [], linkedAtpItemIds: [] }
];

async function runTests() {
  // Scenario 1: ATP substantive changed during request -> response rejected
  {
    let currentAtp = { ...mockAtp, updatedAt: '2026-01-01' };
    let currentTp = { ...mockTp };
    let currentUnits = [...mockUnits];
    let requestId = 1;

    const fp = computeMappingFingerprint(currentUnits, currentAtp, currentTp);

    const promise = runGuardedAnalysis({
      requestId,
      getCurrentRequestId: () => requestId,
      unitsGetter: () => currentUnits,
      atpGetter: () => currentAtp,
      tpGetter: () => currentTp,
      expectedFingerprint: fp,
      fetchFn: async () => {
        currentAtp = { ...mockAtp, items: [{ id: 'atp-new', stepNumber: 1, linkedTpIds: ['tp-1'] }] as any };
        return { analysis: 'result' };
      },
    });

    const res = await promise;
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.isStaleOrOutdated, true);
    console.log('PASS Scenario 1: ATP substantive change during request -> rejected');
  }

  // Scenario 2: TP substantive changed during request -> response rejected
  {
    let currentAtp = { ...mockAtp };
    let currentTp = { ...mockTp, updatedAt: '2026-01-01' };
    let currentUnits = [...mockUnits];
    let requestId = 1;

    const fp = computeMappingFingerprint(currentUnits, currentAtp, currentTp);

    const promise = runGuardedAnalysis({
      requestId,
      getCurrentRequestId: () => requestId,
      unitsGetter: () => currentUnits,
      atpGetter: () => currentAtp,
      tpGetter: () => currentTp,
      expectedFingerprint: fp,
      fetchFn: async () => {
        currentTp = { ...mockTp, items: [{ id: 'tp-new', statement: 'TP baru' }] as any };
        return { analysis: 'result' };
      },
    });

    const res = await promise;
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.isStaleOrOutdated, true);
    console.log('PASS Scenario 2: TP substantive change during request -> rejected');
  }

  // Scenario 3: Draft Bab/Materi changed during request -> response rejected
  {
    let currentAtp = { ...mockAtp };
    let currentTp = { ...mockTp };
    let currentUnits = [...mockUnits];
    let requestId = 1;

    const fp = computeMappingFingerprint(currentUnits, currentAtp, currentTp);

    const promise = runGuardedAnalysis({
      requestId,
      getCurrentRequestId: () => requestId,
      unitsGetter: () => currentUnits,
      atpGetter: () => currentAtp,
      tpGetter: () => currentTp,
      expectedFingerprint: fp,
      fetchFn: async () => {
        currentUnits = [{ id: 'u-2', title: 'Bab Baru', order: 1, materials: [], linkedTpIds: [], linkedAtpItemIds: [] }];
        return { analysis: 'result' };
      },
    });

    const res = await promise;
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.isStaleOrOutdated, true);
    console.log('PASS Scenario 3: Draft changed during request -> rejected');
  }

  // Scenario 4: Request A started, then B started; A finishes last -> A ignored
  {
    let globalRequestId = 1;
    let currentAtp = { ...mockAtp };
    let currentTp = { ...mockTp };
    let currentUnits = [...mockUnits];
    let fp = computeMappingFingerprint(currentUnits, currentAtp, currentTp);

    const reqAId = globalRequestId;
    globalRequestId = 2;

    const promiseA = runGuardedAnalysis({
      requestId: reqAId,
      getCurrentRequestId: () => globalRequestId,
      unitsGetter: () => currentUnits,
      atpGetter: () => currentAtp,
      tpGetter: () => currentTp,
      expectedFingerprint: fp,
      fetchFn: async () => {
        await new Promise(r => setTimeout(r, 20));
        return { source: 'A' };
      },
    });

    const resA = await promiseA;
    assert.strictEqual(resA.success, false);
    assert.strictEqual(resA.isStaleOrOutdated, true);
    console.log('PASS Scenario 4: Request A finished after B started -> ignored');
  }

  // Scenario 5 & 6: Out of order failure/success handling test
  {
    let globalRequestId = 1;
    let latestResult: string | null = null;
    let latestError: string | null = null;

    async function triggerAnalysis(isSlowFailure: boolean) {
      const requestId = ++globalRequestId;
      const currentAtp = { ...mockAtp };
      const currentTp = { ...mockTp };
      const currentUnits = [...mockUnits];
      const fp = computeMappingFingerprint(currentUnits, currentAtp, currentTp);

      const delay = isSlowFailure ? 30 : 5;
      
      const res = await runGuardedAnalysis({
        requestId,
        getCurrentRequestId: () => globalRequestId,
        unitsGetter: () => currentUnits,
        atpGetter: () => currentAtp,
        tpGetter: () => currentTp,
        expectedFingerprint: fp,
        fetchFn: async () => {
          await new Promise(r => setTimeout(r, delay));
          if (isSlowFailure) throw new Error('Error from A');
          return { data: 'Success B' };
        },
      });

      if (requestId === globalRequestId) {
        if (res.success) {
          latestResult = JSON.stringify(res.result);
        } else if (!res.isStaleOrOutdated && res.error) {
          latestError = res.error;
        }
      }
    }

    const p1 = triggerAnalysis(true); // Slow request A that fails
    await new Promise(r => setTimeout(r, 5));
    const p2 = triggerAnalysis(false); // Fast request B that succeeds

    await Promise.all([p1, p2]);

    assert.strictEqual(latestError, null);
    assert.strictEqual(latestResult, JSON.stringify({ data: 'Success B' }));
    console.log('PASS Scenario 5 & 6: Out-of-order failure and success handling verified');
  }

  // Scenario 7: Valid request without changes -> result accepted
  {
    let currentAtp = { ...mockAtp };
    let currentTp = { ...mockTp };
    let currentUnits = [...mockUnits];
    let requestId = 1;

    const fp = computeMappingFingerprint(currentUnits, currentAtp, currentTp);

    const res = await runGuardedAnalysis({
      requestId,
      getCurrentRequestId: () => requestId,
      unitsGetter: () => currentUnits,
      atpGetter: () => currentAtp,
      tpGetter: () => currentTp,
      expectedFingerprint: fp,
      fetchFn: async () => ({ status: 'ok', findings: [] }),
    });

    assert.strictEqual(res.success, true);
    assert.deepStrictEqual(res.result, { status: 'ok', findings: [] });
    console.log('PASS Scenario 7: Valid request without changes -> accepted');
  }

  // Scenario 8: Metadata-only upstream change -> result accepted
  {
    let currentAtp = { ...mockAtp, updatedAt: '2026-01-01' };
    let currentTp = { ...mockTp, updatedAt: '2026-01-01' };
    let currentUnits = [...mockUnits];
    let requestId = 1;

    const fp = computeMappingFingerprint(currentUnits, currentAtp, currentTp);

    const res = await runGuardedAnalysis({
      requestId,
      getCurrentRequestId: () => requestId,
      unitsGetter: () => currentUnits,
      atpGetter: () => currentAtp,
      tpGetter: () => currentTp,
      expectedFingerprint: fp,
      fetchFn: async () => {
        currentAtp = { ...currentAtp, updatedAt: '2026-01-02' };
        currentTp = { ...currentTp, updatedAt: '2026-01-02' };
        return { status: 'ok', findings: [] };
      },
    });

    assert.strictEqual(res.success, true);
    console.log('PASS Scenario 8: Metadata-only upstream change -> accepted');
  }

  console.log('=== ALL P0-D ASYNC SAFETY REGRESSION TESTS PASSED SUCCESSFULLY ===');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
