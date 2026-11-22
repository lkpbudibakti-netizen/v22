import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runStep07AutoRepair } from '../src/services/step07AutoRepairService';
import { readStep07Checkpoint, resolveStep07CheckpointContext } from '../src/services/step07CheckpointService';
import { loadStorageV5, saveStorageV5, getATPUnitMappingV5 } from '../src/services/storageV5';
import { buildMappingAnalysisPrompt, sanitizeMappingAnalysisResult } from '../server/mappingAnalysis';
import { resolveATPUnitMappingReadiness } from '../src/services/atpMappingReadinessService';
import { createReadyV21WorkflowFixture } from './fixtures/v21ReadyWorkflowFixture';
import type { AlignmentAction } from '../src/services/mappingAlignmentService';
import type { ATPData, TPData, ATPUnitMappingData, Step07AutoRequest } from '../src/types';

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (err) {
    console.error(`FAIL: ${name}`, err);
    throw err;
  }
}

const raw = JSON.parse(readFileSync('scripts/fixtures/pjokClass6MappingDiagnostic.json', 'utf8'));
const memory = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => memory.get(k) || null,
  setItem: (k: string, v: string) => memory.set(k, v),
  removeItem: (k: string) => memory.delete(k),
};
const locked = new Set<string>();
Object.defineProperty(globalThis.navigator, 'locks', {
  configurable: true,
  value: {
    request: async (key: string, options: { ifAvailable?: boolean; signal?: AbortSignal }, fn: (lock: unknown) => Promise<unknown>) => {
      if (locked.has(key) && options.ifAvailable) return fn(null);
      while (locked.has(key)) {
        if (options.signal?.aborted) throw Error('Aborted');
        await new Promise((r) => setTimeout(r, 1));
      }
      locked.add(key);
      try {
        return await fn({ name: key });
      } finally {
        locked.delete(key);
      }
    },
  },
});

function seedFixture() {
  memory.clear();
  const state = createReadyV21WorkflowFixture();
  const yearPlanId = 'y';
  const tp: TPData = {
    id: 'tp-1',
    academicSettingId: yearPlanId,
    updatedAt: '2026-11-10',
    workflowStatus: 'SIAP',
    items: structuredClone(raw.tp),
  };
  const atp: ATPData = {
    id: 'atp-1',
    academicSettingId: yearPlanId,
    tpDataId: 'tp-1',
    updatedAt: '2026-11-10',
    workflowStatus: 'SIAP',
    items: structuredClone(raw.atp),
  };
  const mapping: ATPUnitMappingData = {
    id: 'map-1',
    academicSettingId: yearPlanId,
    atpId: 'atp-1',
    tpDataId: 'tp-1',
    updatedAt: '2026-11-10',
    units: raw.units.map((u: any) => ({
      id: u.id,
      order: u.order,
      title: u.title,
      linkedTpIds: u.linkedTpIds || [],
      linkedAtpItemIds: u.linkedAtpItemIds || [],
      materials: u.materials.map((m: any) => ({
        id: m.id,
        order: m.order,
        title: m.title,
        linkedTpIds: m.linkedTpIds || [],
        linkedAtpItemIds: m.linkedAtpItemIds || [],
      })),
    })),
  };

  state.annualData.tp = [{ yearPlanId, value: tp }];
  state.annualData.atp = [{ yearPlanId, value: atp }];
  state.annualData.atpUnitMappings = [{ yearPlanId, value: mapping }];
  saveStorageV5(state);

  return { atp, tp, mapping, yearPlanId };
}

import { hasTeacherMaterialSupport } from '../src/services/mappingAlignmentService';

function mockProvider(f: { atp: ATPData; tp: TPData; mapping: ATPUnitMappingData }, delayMs: number = 0) {
  return async (m: ATPUnitMappingData, r: Step07AutoRequest, signal?: AbortSignal) => {
    if (delayMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delayMs);
        if (signal) {
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            const err = new Error('API_ABORTED: Permintaan dibatalkan.');
            (err as any).name = 'AbortError';
            reject(err);
          });
        }
      });
    }

    if (r.phase === 'VERIFY') {
      const checks = (r.actions || []).map((a) => ({
        actionId: a.id,
        verdict: 'SUPPORTED' as const,
        reason: 'Simulated verifier',
        missingEvidence: [],
        targetUnitQuote: m.units.find((u) => u.id === a.targetUnitId)!.title,
        evidence: a.linkedTpIds.map((id) => ({
          tpId: id,
          tpQuote: f.tp.items.find((t) => t.id === id)!.statement,
          materialQuote: a.before!,
          competenceQuote: f.tp.items.find((t) => t.id === id)!.competence.split(',')[0].trim(),
          contextQuote: a.before!,
        })),
      }));
      return { summary: {} as any, atpFindings: [], materialFindings: [], step07SemanticChecks: checks };
    }

    const actions: AlignmentAction[] = m.units.flatMap((u) =>
      u.materials.filter((mat) => !hasTeacherMaterialSupport(u, mat, f.tp)).map((mat) => {
        const original = raw.units.find((v: any) => v.order === u.order);
        const old = original?.materials?.find((v: any) => v.order === mat.order);
        const ids = mat.linkedTpIds.length ? mat.linkedTpIds : (old?.linkedTpIds?.length ? old.linkedTpIds : (original?.linkedTpIds?.length ? [original.linkedTpIds[0]] : [f.tp.items[1].id]));
        return {
          id: 'repair-' + mat.id,
          type: 'EDIT_MATERIAL',
          targetUnitId: u.id,
          targetMaterialId: mat.id,
          before: mat.title,
          after: mat.title + ' — ' + ids.map((id: string) => { const t = f.tp.items.find((x) => x.id === id)!; return t.competence.split(',')[0].trim() + ' ' + t.contentScope; }).join('; '),
          linkedTpIds: ids,
          reason: 'Simulated edit',
          evidence: ids.map((id: string) => ({ tpId: id, tpQuote: f.tp.items.find((x) => x.id === id)!.statement, materialQuote: mat.title })),
        };
      })
    );

    return sanitizeMappingAnalysisResult(
      { alignmentProposals: actions },
      { currentMapping: m, atpData: f.atp, tpData: f.tp, step07Auto: r }
    );
  };
}

async function runTests() {
  await test('Simulated AI response > 30s (35s delay) completes successfully when callTimeoutMs is 60s', async () => {
    const f = seedFixture();
    const context = resolveStep07CheckpointContext(f.yearPlanId);
    const analyze = mockProvider(f, 35); // 35ms simulated delay (representing 35s in production)

    const result = await runStep07AutoRepair({
      mapping: f.mapping,
      atp: f.atp,
      tp: f.tp,
      persistedMapping: f.mapping,
      checkpointContext: context,
      callTimeoutMs: 100, // 100ms per-call budget allows 35ms to finish
      timeoutMs: 30000,
      analyze: (draft, req, sig) => analyze(draft, req, sig),
      save: (draft) => {
        saveStorageV5({ ...loadStorageV5(), annualData: { ...loadStorageV5().annualData, atpUnitMappings: [{ yearPlanId: f.yearPlanId, value: draft }] } });
        return true;
      },
      isCurrent: () => true,
    });

    console.log('Test 1 issues:', result.issues);
    assert.equal(result.outcome, 'COMPLETE');
    assert.equal(result.saved, true);
    assert.equal(result.readiness.canProceed, true);
  });

  await test('Call timing out at callTimeoutMs triggers API_ABORTED without consuming semantic retry budget', async () => {
    const f = seedFixture();
    const context = resolveStep07CheckpointContext(f.yearPlanId);

    const analyze = async (_m: ATPUnitMappingData, _r: Step07AutoRequest, signal?: AbortSignal) => {
      await new Promise<void>((_, reject) => {
        if (signal) {
          signal.addEventListener('abort', () => {
            reject(new Error('STEP07_TIMEOUT: batas waktu analisis terlampaui.'));
          });
        }
      });
      return { summary: {} as any, atpFindings: [], materialFindings: [] };
    };

    const result = await runStep07AutoRepair({
      mapping: f.mapping,
      atp: f.atp,
      tp: f.tp,
      persistedMapping: f.mapping,
      checkpointContext: context,
      callTimeoutMs: 20, // 20ms timeout
      timeoutMs: 1000,
      analyze: (draft, req, sig) => analyze(draft, req, sig),
      save: (draft) => {
        saveStorageV5({ ...loadStorageV5(), annualData: { ...loadStorageV5().annualData, atpUnitMappings: [{ yearPlanId: f.yearPlanId, value: draft }] } });
        return true;
      },
      isCurrent: () => true,
    });

    console.log('Test 2 issues:', result.issues, 'outcome:', result.outcome);
    assert.equal(result.outcome, 'TIMEOUT');
    assert.equal(result.saved, false);
    assert(result.issues.some((i) => i.includes('STEP07_TIMEOUT')));
    const cp = readStep07Checkpoint(context)!;
    const u1Id = cp.activeUnitId!;
    assert.equal(cp.units[u1Id]?.status, 'BLOCKED');
    assert.notEqual(cp.units[u1Id]?.status, 'NEEDS_TEACHER_REVIEW');
  });

  await test('Resume after timeout preserves completed unit checkpoints without repeating work', async () => {
    const f = seedFixture();
    const context = resolveStep07CheckpointContext(f.yearPlanId);
    const readiness = resolveATPUnitMappingReadiness(f.mapping, f.atp, f.tp, undefined, { evaluateRepair: true });
    const queue = f.mapping.units.filter((u) => (readiness.repairIssues || []).some((i) => i.unitId === u.id)).sort((a, b) => (readiness.repairIssues || []).filter((i) => i.unitId === b.id).length - (readiness.repairIssues || []).filter((i) => i.unitId === a.id).length);
    const u1Id = queue[0].id;
    const u2Id = queue[1].id;

    // Unit u1 succeeds, Unit u2 times out
    const analyzeFailOnU2 = async (m: ATPUnitMappingData, r: Step07AutoRequest, signal?: AbortSignal) => {
      if (r.execution?.activeUnitId === u2Id) {
        await new Promise<void>((_, reject) => {
          if (signal) signal.addEventListener('abort', () => reject(new Error('STEP07_TIMEOUT')));
        });
      }
      return mockProvider(f)(m, r, signal);
    };

    const run1 = await runStep07AutoRepair({
      mapping: f.mapping,
      atp: f.atp,
      tp: f.tp,
      persistedMapping: f.mapping,
      checkpointContext: context,
      callTimeoutMs: 25,
      timeoutMs: 500,
      analyze: (draft, req, sig) => analyzeFailOnU2(draft, req, sig),
      save: (draft) => {
        saveStorageV5({ ...loadStorageV5(), annualData: { ...loadStorageV5().annualData, atpUnitMappings: [{ yearPlanId: f.yearPlanId, value: draft }] } });
        return true;
      },
      isCurrent: () => true,
    });

    assert.equal(run1.outcome, 'TIMEOUT');
    const cpMid = readStep07Checkpoint(context)!;
    assert.equal(cpMid.units[u1Id]?.status, 'DONE');
    assert.equal(cpMid.units[u2Id]?.status, 'BLOCKED');

    // Resume with working provider
    const resumedMapping = getATPUnitMappingV5(f.yearPlanId)!;
    const run2 = await runStep07AutoRepair({
      mapping: resumedMapping,
      atp: f.atp,
      tp: f.tp,
      persistedMapping: resumedMapping,
      checkpointContext: context,
      callTimeoutMs: 200,
      timeoutMs: 30000,
      analyze: (draft, req, sig) => mockProvider(f)(draft, req, sig),
      save: (draft) => {
        saveStorageV5({ ...loadStorageV5(), annualData: { ...loadStorageV5().annualData, atpUnitMappings: [{ yearPlanId: f.yearPlanId, value: draft }] } });
        return true;
      },
      isCurrent: () => true,
    });

    assert.equal(run2.outcome, 'COMPLETE');
    assert.equal(run2.saved, true);
    assert.equal(run2.readiness.canProceed, true);

    const cpFinal = readStep07Checkpoint(context)!;
    assert.equal(cpFinal.units[u1Id]?.status, 'DONE');
    assert.equal(cpFinal.units[u2Id]?.status, 'DONE');
  });

  await test('Prompt context optimization: non-active units use compact representation in activeUnitId scope', () => {
    const f = seedFixture();
    const u1Id = raw.units[0].id;
    const u2Id = raw.units[1].id;
    const prompt = buildMappingAnalysisPrompt({
      subject: 'PJOK',
      grade: 'Kelas 6',
      phase: 'Fase C',
      tpData: f.tp,
      atpData: f.atp,
      currentMapping: f.mapping,
      step07Auto: {
        scope: 'STEP07_AUTO_REPAIR',
        phase: 'PROPOSE',
        round: 1,
        focus: { unitIds: [u1Id], materialIds: [], tpIds: [], atpIds: [] },
        validation: { canProceed: false, issues: [], rejectedActions: [] },
        execution: {
          mode: 'INITIAL_MAPPING',
          activeUnitId: u1Id,
          reconciliation: false,
          otherUnits: [{ id: u2Id, title: 'Aktivitas Senam', tpIds: [], materialCount: 3 }],
        },
      },
    });

    assert(prompt.includes('BAB/MATERI ASLI:'));
    assert(prompt.includes(`"unitId":"${u1Id}"`));
    assert(prompt.includes('"missingMaterialCoverage"'));
    assert(prompt.includes(`"unitId":"${u2Id}"`));
    const u2Match = prompt.match(new RegExp(`\\{"unitId":"${u2Id}"[^}]*\\}`));
    assert(u2Match !== null);
    assert(!u2Match[0].includes('missingMaterialCoverage'));
  });

  console.log(`\nAll ${passed}/${passed} Step07 timeout resilience tests PASSED cleanly.`);
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
