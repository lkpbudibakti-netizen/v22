import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  writeStep07Checkpoint,
  readStep07Checkpoint,
  compactStep07Checkpoint,
  classifyCheckpointStorageError,
  resolveStep07CheckpointContext,
  step07CheckpointKey,
  type Step07Checkpoint,
  type Step07UnitCheckpoint
} from '../src/services/step07CheckpointService';
import {runStep07AutoRepair, type Step07RepairOptions} from '../src/services/step07AutoRepairService';
import {countStep07CompletedUnits, resolveATPUnitMappingReadiness} from '../src/services/atpMappingReadinessService';
import {saveStorageV5, getATPUnitMappingV5, saveATPUnitMappingV5} from '../src/services/storageV5';
import {createReadyV21WorkflowFixture} from './fixtures/v21ReadyWorkflowFixture';
import type {ATPUnitMappingData, ATPData, TPData, Step07AutoRequest, Step07SemanticCheck} from '../src/types';

const raw = JSON.parse(readFileSync('scripts/fixtures/pjokClass6RealProjectEvidence.json', 'utf8'));
const memory = new Map<string, string>();
const locks = new Set<string>();

(globalThis as any).localStorage = {
  getItem: (k: string) => memory.get(k) || null,
  setItem: (k: string, v: string) => memory.set(k, v),
  removeItem: (k: string) => memory.delete(k)
};

Object.defineProperty(navigator, 'locks', {
  configurable: true,
  value: {
    request: async (key: string, options: any, callback: any) => {
      if (locks.has(key) && options.ifAvailable) return callback(null);
      while (locks.has(key)) await new Promise(r => setTimeout(r, 1));
      locks.add(key);
      try { return await callback({name: key}); } finally { locks.delete(key); }
    }
  }
});

function seed() {
  memory.clear();
  const state = createReadyV21WorkflowFixture();
  const f = structuredClone(raw) as {mapping: ATPUnitMappingData; atp: ATPData; tp: TPData};
  state.annualData.tp = [{yearPlanId: 'y', value: f.tp}];
  state.annualData.atp = [{yearPlanId: 'y', value: f.atp}];
  state.annualData.atpUnitMappings = [{yearPlanId: 'y', value: f.mapping}];
  saveStorageV5(state);
  return f;
}

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  await fn();
  console.log('PASS ' + (++passed) + '. ' + name);
}

// 1. Error classification: QuotaExceeded vs Serialization vs StorageUnavailable vs Generic
await test('Differentiate storage errors: QuotaExceededError, serialization, storage unavailable, generic', () => {
  const quotaErr1 = new Error('QuotaExceeded');
  const quotaErr2 = new DOMException('The quota has been exceeded', 'QuotaExceededError');
  const typeErr = new TypeError('Converting circular structure to JSON');
  const unavailErr = new Error('localStorage is disabled in private mode');
  const genericErr = new Error('Disk I/O failure');

  const c1 = classifyCheckpointStorageError(quotaErr1);
  assert.equal(c1.category, 'CHECKPOINT_QUOTA_EXCEEDED');
  assert(c1.message.includes('kuota penyimpanan browser'));

  const c2 = classifyCheckpointStorageError(quotaErr2);
  assert.equal(c2.category, 'CHECKPOINT_QUOTA_EXCEEDED');

  const c3 = classifyCheckpointStorageError(typeErr);
  assert.equal(c3.category, 'CHECKPOINT_SERIALIZATION_FAILED');
  assert(c3.message.includes('tidak dapat diserialisasi'));

  const c4 = classifyCheckpointStorageError(unavailErr);
  assert.equal(c4.category, 'CHECKPOINT_STORAGE_UNAVAILABLE');
  assert(c4.message.includes('dinonaktifkan atau diblokir'));

  const c5 = classifyCheckpointStorageError(genericErr);
  assert.equal(c5.category, 'CHECKPOINT_SAVE_FAILED');
  assert(c5.message.includes('Disk I/O failure'));
});

// 2. Bounded growth across repeated analysis of Bab 1, 4, 7
await test('Repeated analysis of Bab 1, 4, and 7 exhibits strictly bounded checkpoint size', () => {
  const f = seed();
  const context = resolveStep07CheckpointContext('y');

  // Construct a checkpoint with units
  const cp: Step07Checkpoint = {
    schemaVersion: 1,
    revision: 0,
    context,
    canonical: 'test-canonical',
    baseStoredKey: 'test-key',
    mode: 'REPAIR',
    beforeUnits: structuredClone(f.mapping.units),
    units: {}
  };

  for (const u of f.mapping.units) {
    cp.units[u.id] = {
      source: JSON.stringify(u),
      dependency: 'test-canonical',
      stage: 'VALIDATE',
      status: 'DONE',
      applied: [],
      events: []
    };
  }

  // Simulate 35 cycles of proposals and verifications on Bab 1 (index 0), Bab 4 (index 3), Bab 7 (index 6)
  const targetIds = [f.mapping.units[0].id, f.mapping.units[3].id, f.mapping.units[6].id];
  for (let cycle = 1; cycle <= 35; cycle++) {
    for (const tid of targetIds) {
      const point = cp.units[tid];
      point.events.push({ stage: 'PROPOSE', success: true, reason: 'Proposal cycle ' + cycle });
      point.events.push({ stage: 'VERIFY', success: cycle % 3 === 0, reason: 'Verify cycle ' + cycle, failureCategory: cycle % 3 === 0 ? undefined : 'SEMANTIC_MISMATCH' });
      point.events.push({ stage: 'APPLY', success: false, reason: 'Failure cycle ' + cycle });
      point.responses ||= [];
      point.responses.push({
        phase: 'PROPOSE',
        source: point.source,
        canonical: 'test-canonical',
        result: { summary: {} as any, atpFindings: [], materialFindings: [], alignmentProposals: [{ id: 'prop-' + cycle } as any] } as any
      });
    }
    cp.invalidated ||= [];
    cp.invalidated.push({
      unitId: targetIds[cycle % 3],
      reason: 'Struktur berubah pada siklus ' + cycle,
      checkpoint: structuredClone(cp.units[targetIds[cycle % 3]])
    });
    writeStep07Checkpoint(cp);
  }

  const storedRaw = memory.get(step07CheckpointKey(context))!;
  const stored = JSON.parse(storedRaw) as Step07Checkpoint;

  // Verify bounded size
  assert(storedRaw.length < 220000, `Stored size ${storedRaw.length} exceeded budget 220KB`);
  assert(stored.invalidated!.length <= 10, 'Invalidated records must be bounded to 10');
  for (const tid of targetIds) {
    assert(stored.units[tid].events.length <= 30, 'Events per unit must be bounded to 30');
    assert((stored.units[tid].responses || []).length <= 3, 'Responses per unit must be bounded to 3');
  }
  console.log(`  Measured final checkpoint size after 35 cycles: ${storedRaw.length} chars (strictly bounded)`);
});

// 3. Emergency pruning on near-quota recovery
await test('Automatic emergency pruning saves checkpoint when nearing quota', () => {
  const f = seed();
  const context = resolveStep07CheckpointContext('y');

  const cp: Step07Checkpoint = {
    schemaVersion: 1,
    revision: 10,
    context,
    canonical: 'test-canonical',
    baseStoredKey: 'test-key',
    mode: 'REPAIR',
    beforeUnits: structuredClone(f.mapping.units),
    workingMapping: structuredClone(f.mapping),
    units: {}
  };

  for (const u of f.mapping.units) {
    cp.units[u.id] = {
      source: JSON.stringify(u),
      dependency: 'test-canonical',
      stage: 'VALIDATE',
      status: 'DONE',
      applied: ['a1'],
      events: [{ stage: 'VALIDATE', success: true, reason: 'ok' }],
      responses: [{ phase: 'PROPOSE', source: 's', canonical: 'c', result: { summary: {} as any, atpFindings: [], materialFindings: [], alignmentProposals: [] } }]
    };
  }

  // Hook setItem: throw QuotaExceededError if payload > 120000 bytes
  // Initial with workingMapping is ~153KB, pruned is ~102KB.
  const origSet = localStorage.setItem;
  let pruneTriggered = false;
  localStorage.setItem = (k: string, v: string) => {
    if (v.length > 120000) {
      pruneTriggered = true;
      throw new DOMException('QuotaExceeded', 'QuotaExceededError');
    }
    origSet(k, v);
  };

  try {
    writeStep07Checkpoint(cp);
    assert(pruneTriggered, 'Emergency prune must be triggered when size > threshold');
    const saved = readStep07Checkpoint(context)!;
    assert(saved, 'Checkpoint must be saved successfully after emergency pruning');
    assert.equal(saved.revision, 11);
  } finally {
    localStorage.setItem = origSet;
  }
});

// 4. Safe failure and V5 integrity when storage write permanently fails
await test('Hard storage failure fails safely without altering V5 or corrupting raw checkpoint', () => {
  const f = seed();
  const context = resolveStep07CheckpointContext('y');
  const v5Before = JSON.stringify(getATPUnitMappingV5('y'));

  // Save an initial valid checkpoint
  const cp: Step07Checkpoint = {
    schemaVersion: 1,
    revision: 1,
    context,
    canonical: 'test-canonical',
    baseStoredKey: 'test-key',
    mode: 'REPAIR',
    beforeUnits: structuredClone(f.mapping.units),
    units: {}
  };
  writeStep07Checkpoint(cp);
  const rawCheckpointBefore = memory.get(step07CheckpointKey(context))!;

  // Simulate hard permanent write failure
  const origSet = localStorage.setItem;
  localStorage.setItem = () => {
    throw new DOMException('The quota has been exceeded', 'QuotaExceededError');
  };
  cp.activeUnitId = 'unit-test-failure';

  try {
    assert.throws(() => writeStep07Checkpoint(cp), (err: any) => {
      return err instanceof Error &&
             err.message.includes('CHECKPOINT_SAVE_FAILED') &&
             err.message.includes('kuota penyimpanan browser');
    });
  } finally {
    localStorage.setItem = origSet;
  }

  // Verify V5 data and previous checkpoint remain intact
  assert.equal(JSON.stringify(getATPUnitMappingV5('y')), v5Before, 'V5 data must remain unchanged');
  assert.equal(memory.get(step07CheckpointKey(context)), rawCheckpointBefore, 'Raw checkpoint must not be corrupted');
});

// 5. Deduplication of beforeUnits
await test('Compaction removes duplicate beforeUnits by ID', () => {
  const f = seed();
  const context = resolveStep07CheckpointContext('y');
  const duplicatedUnits = [...f.mapping.units, ...f.mapping.units, ...f.mapping.units];

  const cp: Step07Checkpoint = {
    schemaVersion: 1,
    revision: 1,
    context,
    canonical: 'test-canonical',
    baseStoredKey: 'test-key',
    mode: 'REPAIR',
    beforeUnits: duplicatedUnits,
    units: {}
  };

  assert.equal(cp.beforeUnits.length, 27);
  compactStep07Checkpoint(cp);
  assert.equal(cp.beforeUnits.length, 9);
  assert.deepEqual(cp.beforeUnits.map(u => u.id), f.mapping.units.map(u => u.id));
});

console.log(`All ${passed}/${passed} checkpoint save resilience scenarios PASSED.`);
