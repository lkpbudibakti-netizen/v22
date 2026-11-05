import assert from 'node:assert';
import { mergeGeneratedTPsWithExisting } from '../src/services/aiService';
import { TPItem } from '../src/types';

console.log('=== RUNNING AUDIT: MERDEKA TP REGENERATION REGRESSION (PHASE 2B) ===\n');

let totalTests = 0;
let passedTests = 0;

function runTest(name: string, fn: () => void) {
  totalTests++;
  try {
    fn();
    console.log(`[PASS] ${totalTests}. ${name}`);
    passedTests++;
  } catch (err: any) {
    console.error(`[FAIL] ${totalTests}. ${name}:`, err.message);
    throw err;
  }
}

const activeAnalysisItems = [{ id: 'ana-1' }, { id: 'ana-2' }];

runTest('1. elementName sama tetapi AnalysisItem berbeda -> ID TIDAK boleh dipertahankan (dibuat TP baru / unmatched)', () => {
  const existing: TPItem[] = [
    {
      id: 'tp-exist-1',
      code: 'E1-PCH-01',
      elementName: 'Elemen Gerak',
      statement: 'Pernyataan lama',
      competence: 'Menganalisis',
      contentScope: 'Materi lama',
      cpAnalysisItemIds: ['ana-1'],
      order: 1,
    },
  ];

  const generated: Partial<TPItem>[] = [
    {
      code: 'E1-PCH-01',
      elementName: 'Elemen Gerak',
      statement: 'Pernyataan baru dari AI',
      competence: 'Memonitor',
      contentScope: 'Materi baru',
      cpAnalysisItemIds: ['ana-2'], // Different analysis item ID
    },
  ];

  const merged = mergeGeneratedTPsWithExisting(generated, existing, activeAnalysisItems, 'REBUILD_FROM_UPSTREAM');
  assert.strictEqual(merged.length, 1);
  assert.notStrictEqual(merged[0].id, 'tp-exist-1', 'ID lama tidak boleh dipertahankan karena lineage berbeda');
  assert.strictEqual(merged[0].statement, 'Pernyataan baru dari AI');
});

runTest('2. Lineage sama + contentScope exact -> existing ID BOLEH dipertahankan', () => {
  const existing: TPItem[] = [
    {
      id: 'tp-exist-2',
      code: 'E1-PCH-02',
      elementName: 'Elemen Gerak',
      statement: 'Pernyataan lama',
      competence: 'Menganalisis',
      contentScope: 'Materi Inti Sama',
      cpAnalysisItemIds: ['ana-1'],
      order: 1,
    },
  ];

  const generated: Partial<TPItem>[] = [
    {
      code: 'E1-PCH-02',
      elementName: 'Elemen Gerak',
      statement: 'Pernyataan baru dari AI',
      competence: 'Memonitor',
      contentScope: 'Materi Inti Sama',
      cpAnalysisItemIds: ['ana-1'],
    },
  ];

  const merged = mergeGeneratedTPsWithExisting(generated, existing, activeAnalysisItems, 'ALIGN_EXISTING');
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].id, 'tp-exist-2', 'ID existing harus dipertahankan karena lineage dan contentScope cocok');
});

runTest('3. Ketika ID dipertahankan: statement, competence, contentScope berasal dari generated, bukan existing (Generated Wins)', () => {
  const existing: TPItem[] = [
    {
      id: 'tp-exist-3',
      code: 'E1-PCH-03',
      elementName: 'Elemen',
      statement: 'Existing Statement',
      competence: 'Existing Competence',
      contentScope: 'Existing Scope',
      cpAnalysisItemIds: ['ana-1'],
      order: 1,
    },
  ];

  const generated: Partial<TPItem>[] = [
    {
      code: 'E1-PCH-03',
      elementName: 'Elemen Baru',
      statement: 'Generated Statement WIN',
      competence: 'Generated Competence WIN',
      contentScope: 'Existing Scope',
      cpAnalysisItemIds: ['ana-1'],
    },
  ];

  const merged = mergeGeneratedTPsWithExisting(generated, existing, activeAnalysisItems, 'ALIGN_EXISTING');
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].id, 'tp-exist-3');
  assert.strictEqual(merged[0].statement, 'Generated Statement WIN');
  assert.strictEqual(merged[0].competence, 'Generated Competence WIN');
  assert.strictEqual(merged[0].contentScope, 'Existing Scope');
});

runTest('4. REBUILD_FROM_UPSTREAM: unmatched existing TP tidak ikut hasil akhir', () => {
  const existing: TPItem[] = [
    {
      id: 'tp-exist-4a',
      code: 'E1-PCH-04',
      elementName: 'Elemen',
      statement: 'Matched',
      competence: 'K',
      contentScope: 'Sama',
      cpAnalysisItemIds: ['ana-1'],
      order: 1,
    },
    {
      id: 'tp-exist-4b',
      code: 'E1-PCH-05',
      elementName: 'Elemen Lain',
      statement: 'Unmatched Manual TP',
      competence: 'K',
      contentScope: 'Lain',
      cpAnalysisItemIds: ['ana-1'],
      order: 2,
    },
  ];

  const generated: Partial<TPItem>[] = [
    {
      code: 'E1-PCH-04',
      elementName: 'Elemen',
      statement: 'Matched',
      competence: 'K',
      contentScope: 'Sama',
      cpAnalysisItemIds: ['ana-1'],
    },
  ];

  const merged = mergeGeneratedTPsWithExisting(generated, existing, activeAnalysisItems, 'REBUILD_FROM_UPSTREAM');
  assert.strictEqual(merged.length, 1, 'Rebuild mode harus membuang unmatched existing TP');
  assert.strictEqual(merged[0].id, 'tp-exist-4a');
});

runTest('5. ALIGN_EXISTING: unmatched existing TP dengan lineage aktif boleh tetap ada', () => {
  const existing: TPItem[] = [
    {
      id: 'tp-exist-5a',
      code: 'E1-PCH-04',
      elementName: 'Elemen',
      statement: 'Matched',
      competence: 'K',
      contentScope: 'Sama',
      cpAnalysisItemIds: ['ana-1'],
      order: 1,
    },
    {
      id: 'tp-exist-5b',
      code: 'E1-PCH-05',
      elementName: 'Elemen Lain',
      statement: 'Unmatched Manual TP dengan Lineage Aktif',
      competence: 'K',
      contentScope: 'Lain',
      cpAnalysisItemIds: ['ana-2'],
      order: 2,
    },
  ];

  const generated: Partial<TPItem>[] = [
    {
      code: 'E1-PCH-04',
      elementName: 'Elemen',
      statement: 'Matched',
      competence: 'K',
      contentScope: 'Sama',
      cpAnalysisItemIds: ['ana-1'],
    },
  ];

  const merged = mergeGeneratedTPsWithExisting(generated, existing, activeAnalysisItems, 'ALIGN_EXISTING');
  assert.strictEqual(merged.length, 2, 'Align mode harus mempertahankan unmatched existing TP dengan lineage aktif');
  assert.ok(merged.some((m) => m.id === 'tp-exist-5b'));
});

runTest('6. Existing TP dengan stale/non-active cpAnalysisItemIds tidak pernah dipertahankan di ALIGN_EXISTING', () => {
  const existing: TPItem[] = [
    {
      id: 'tp-exist-stale',
      code: 'E1-STALE',
      elementName: 'Stale',
      statement: 'Stale TP',
      competence: 'K',
      contentScope: 'Stale',
      cpAnalysisItemIds: ['ana-stale-99'],
      order: 1,
    },
  ];

  const generated: Partial<TPItem>[] = [
    {
      code: 'E1-NEW',
      elementName: 'New',
      statement: 'New TP',
      competence: 'K',
      contentScope: 'New',
      cpAnalysisItemIds: ['ana-1'],
    },
  ];

  const merged = mergeGeneratedTPsWithExisting(generated, existing, activeAnalysisItems, 'ALIGN_EXISTING');
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].id !== 'tp-exist-stale', true, 'Stale TP tidak boleh terbawa');
});

runTest('7. Multiple TP dari satu CPAnalysisItem tidak salah bertukar ID tanpa semantic match', () => {
  const existing: TPItem[] = [
    {
      id: 'tp-1',
      code: 'E1-AA-01',
      elementName: 'Elem',
      statement: 'Statement 1',
      competence: 'K1',
      contentScope: 'Scope 1',
      cpAnalysisItemIds: ['ana-1'],
      order: 1,
    },
    {
      id: 'tp-2',
      code: 'E1-BB-01',
      elementName: 'Elem',
      statement: 'Statement 2',
      competence: 'K2',
      contentScope: 'Scope 2',
      cpAnalysisItemIds: ['ana-1'],
      order: 2,
    },
  ];

  const generated: Partial<TPItem>[] = [
    {
      code: 'E1-BB-01',
      elementName: 'Elem',
      statement: 'Statement 2 Modified',
      competence: 'K2',
      contentScope: 'Scope 2',
      cpAnalysisItemIds: ['ana-1'],
    },
    {
      code: 'E1-AA-01',
      elementName: 'Elem',
      statement: 'Statement 1 Modified',
      competence: 'K1',
      contentScope: 'Scope 1',
      cpAnalysisItemIds: ['ana-1'],
    },
  ];

  const merged = mergeGeneratedTPsWithExisting(generated, existing, activeAnalysisItems, 'ALIGN_EXISTING');
  assert.strictEqual(merged.length, 2);
  const m1 = merged.find((m) => m.code === 'E1-AA-01');
  const m2 = merged.find((m) => m.code === 'E1-BB-01');
  assert.strictEqual(m1?.id, 'tp-1');
  assert.strictEqual(m2?.id, 'tp-2');
});

console.log(`\n========================================`);
console.log(`MERDEKA TP REGENERATION REGRESSION: ALL ${passedTests}/${totalTests} TESTS PASSED`);
console.log(`========================================\n`);
