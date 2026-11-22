import assert from 'assert';
import type { ATPData, TPData, ATPUnitMapping } from '../src/types';
import {
  applyATPMappingActions,
  computeMappingFingerprint,
  type MappingActionItem,
} from '../src/services/atpMappingActionApplyService';
import { validateATPUnitMappingCanonical } from '../src/services/atpUnitMappingValidationService';

const mockAtp: ATPData = {
  id: 'atp-mat-7',
  academicSettingId: 'setting-smp-7',
  updatedAt: '2026-10-16T00:00:00Z',
  workflowStatus: 'SIAP',
  items: [
    {
      id: 'atp-item-1',
      stepNumber: 1,
      focus: 'Konsep dan operasi bilangan bulat',
      linkedTpIds: ['tp-1', 'tp-2'],
    },
    {
      id: 'atp-item-2',
      stepNumber: 2,
      focus: 'Operasi pecahan dan desimal',
      linkedTpIds: ['tp-3'],
    },
    {
      id: 'atp-item-3',
      stepNumber: 3,
      focus: 'Bentuk aljabar dan penyederhanaan',
      linkedTpIds: ['tp-4', 'tp-5'],
    },
    {
      id: 'atp-item-4',
      stepNumber: 4,
      focus: 'Persamaan linear satu variabel',
      linkedTpIds: ['tp-6'],
    },
    {
      id: 'atp-item-5',
      stepNumber: 5,
      focus: 'Statistika dasar dan penyajian data',
      linkedTpIds: ['tp-7'],
    },
  ],
};

const mockTp: TPData = {
  id: 'tp-mat-7',
  academicSettingId: 'setting-smp-7',
  updatedAt: '2026-10-16T00:00:00Z',
  items: [
    {
      id: 'tp-1',
      code: 'TP 7.1',
      statement: 'Memahami konsep bilangan bulat negatif dan positif dalam konteks sehari-hari.',
      competence: 'Memahami',
      contentScope: 'Bilangan Bulat',
      order: 1,
    },
    {
      id: 'tp-2',
      code: 'TP 7.2',
      statement: 'Melakukan operasi hitung penjumlahan dan pengurangan bilangan bulat.',
      competence: 'Melakukan',
      contentScope: 'Operasi Bilangan Bulat',
      order: 2,
    },
    {
      id: 'tp-3',
      code: 'TP 7.3',
      statement: 'Melakukan operasi perkalian dan pembagian pecahan dan desimal.',
      competence: 'Melakukan',
      contentScope: 'Pecahan dan Desimal',
      order: 3,
    },
    {
      id: 'tp-4',
      code: 'TP 7.4',
      statement: 'Mengenal variabel, koefisien, konstanta, dan suku pada bentuk aljabar.',
      competence: 'Mengenal',
      contentScope: 'Unsur Bentuk Aljabar',
      order: 4,
    },
    {
      id: 'tp-5',
      code: 'TP 7.5',
      statement: 'Melakukan operasi penjumlahan dan pengurangan bentuk aljabar linear.',
      competence: 'Melakukan',
      contentScope: 'Operasi Bentuk Aljabar',
      order: 5,
    },
    {
      id: 'tp-6',
      code: 'TP 7.6',
      statement: 'Menyelesaikan persamaan linear satu variabel sederhana.',
      competence: 'Menyelesaikan',
      contentScope: 'PLSV',
      order: 6,
    },
    {
      id: 'tp-7',
      code: 'TP 7.7',
      statement: 'Menyajikan dan menginterpretasikan data dalam bentuk diagram batang.',
      competence: 'Menyajikan',
      contentScope: 'Statistika',
      order: 7,
    },
  ],
};

console.log('=== RUNNING ATP UNIT MAPPING ACTION APPLY REGRESSION TESTS ===');

// =========================================================================
// Test 1: Semua Bab kosong, beberapa materi baru per Bab
// =========================================================================
{
  const emptyUnits: ATPUnitMapping[] = [
    {
      id: 'unit-1',
      title: 'Bab 1 Bilangan',
      order: 1,
      linkedAtpItemIds: [],
      linkedTpIds: [],
      materials: [],
    },
    {
      id: 'unit-2',
      title: 'Bab 2 Aljabar',
      order: 2,
      linkedAtpItemIds: [],
      linkedTpIds: [],
      materials: [],
    },
    {
      id: 'unit-3',
      title: 'Bab 3 Statistika',
      order: 3,
      linkedAtpItemIds: [],
      linkedTpIds: [],
      materials: [],
    },
  ];

  const fp = computeMappingFingerprint(emptyUnits, mockAtp, mockTp);

  const actions: MappingActionItem[] = [
    {
      id: 'act-1a',
      type: 'ADD_MATERIAL_TO_UNIT',
      targetUnitId: 'unit-1',
      title: 'Bilangan Bulat dan Operasinya',
      linkedAtpItemIds: ['atp-item-1'],
      linkedTpIds: ['tp-1', 'tp-2'],
    },
    {
      id: 'act-1b',
      type: 'ADD_MATERIAL_TO_UNIT',
      targetUnitId: 'unit-1',
      title: 'Pecahan dan Desimal',
      linkedAtpItemIds: ['atp-item-2'],
      linkedTpIds: ['tp-3'],
    },
    {
      id: 'act-2a',
      type: 'ADD_MATERIAL_TO_UNIT',
      targetUnitId: 'unit-2',
      title: 'Bentuk Aljabar Linear',
      linkedAtpItemIds: ['atp-item-3'],
      linkedTpIds: ['tp-4', 'tp-5'],
    },
    {
      id: 'act-2b',
      type: 'ADD_MATERIAL_TO_UNIT',
      targetUnitId: 'unit-2',
      title: 'Persamaan Linear Satu Variabel',
      linkedAtpItemIds: ['atp-item-4'],
      linkedTpIds: ['tp-6'],
    },
    {
      id: 'act-3a',
      type: 'ADD_MATERIAL_TO_UNIT',
      targetUnitId: 'unit-3',
      title: 'Penyajian dan Interpretasi Data',
      linkedAtpItemIds: ['atp-item-5'],
      linkedTpIds: ['tp-7'],
    },
  ];

  const result = applyATPMappingActions({
    units: emptyUnits,
    selectedActions: actions,
    atp: mockAtp,
    tp: mockTp,
    expectedFingerprint: fp,
    currentFingerprint: fp,
  });

  assert.strictEqual(result.success, true, 'Semua Bab kosong harus berhasil menerima rekomendasi materi');
  assert.ok(result.nextUnits, 'nextUnits harus terdefinisi');
  assert.strictEqual(result.nextUnits!.length, 3, 'Jumlah Bab harus tetap 3');

  // Verify Bab 1
  const u1 = result.nextUnits![0];
  assert.strictEqual(u1.id, 'unit-1');
  assert.strictEqual(u1.title, 'Bab 1 Bilangan');
  assert.strictEqual(u1.order, 1);
  assert.strictEqual(u1.materials.length, 2, 'Bab 1 harus memiliki 2 materi baru');
  assert.strictEqual(u1.materials[0].title, 'Bilangan Bulat dan Operasinya');
  assert.strictEqual(u1.materials[0].order, 1);
  assert.strictEqual(u1.materials[1].title, 'Pecahan dan Desimal');
  assert.strictEqual(u1.materials[1].order, 2);
  assert.deepStrictEqual(u1.linkedAtpItemIds, ['atp-item-1', 'atp-item-2']);
  assert.deepStrictEqual(u1.linkedTpIds, ['tp-1', 'tp-2', 'tp-3']);

  // Verify Bab 2
  const u2 = result.nextUnits![1];
  assert.strictEqual(u2.id, 'unit-2');
  assert.strictEqual(u2.materials.length, 2, 'Bab 2 harus memiliki 2 materi baru');
  assert.strictEqual(u2.materials[0].title, 'Bentuk Aljabar Linear');
  assert.strictEqual(u2.materials[0].order, 1);
  assert.strictEqual(u2.materials[1].title, 'Persamaan Linear Satu Variabel');
  assert.strictEqual(u2.materials[1].order, 2);

  // Verify Bab 3
  const u3 = result.nextUnits![2];
  assert.strictEqual(u3.id, 'unit-3');
  assert.strictEqual(u3.materials.length, 1, 'Bab 3 harus memiliki 1 materi baru');
  assert.strictEqual(u3.materials[0].title, 'Penyajian dan Interpretasi Data');
  assert.strictEqual(u3.materials[0].order, 1);

  console.log('[PASS] Test 1: Semua Bab kosong, beberapa materi baru per Bab berhasil diterapkan');
}

// =========================================================================
// Test 2: Bab tanpa lineage membangun lineage canonical
// =========================================================================
{
  const unitWithoutLineage: ATPUnitMapping[] = [
    {
      id: 'unit-aljabar',
      title: 'Bab Bentuk Aljabar',
      order: 1,
      linkedAtpItemIds: [],
      linkedTpIds: [],
      materials: [],
    },
  ];

  const fp = computeMappingFingerprint(unitWithoutLineage, mockAtp, mockTp);

  const action: MappingActionItem = {
    id: 'act-aljabar',
    type: 'ADD_MATERIAL_TO_UNIT',
    targetUnitId: 'unit-aljabar',
    title: 'Operasi Bentuk Aljabar',
    linkedAtpItemIds: ['atp-item-3'],
    // Bab-first: TP subset is explicit; ATP parents are deterministic.
    linkedTpIds: ['tp-4', 'tp-5'],
  };

  const result = applyATPMappingActions({
    units: unitWithoutLineage,
    selectedActions: [action],
    atp: mockAtp,
    tp: mockTp,
    expectedFingerprint: fp,
    currentFingerprint: fp,
  });

  assert.strictEqual(result.success, true, 'Bab tanpa lineage harus berhasil membangun lineage');
  const u = result.nextUnits![0];
  assert.deepStrictEqual(u.linkedAtpItemIds, ['atp-item-3']);
  assert.ok(u.linkedTpIds.includes('tp-4') && u.linkedTpIds.includes('tp-5'), 'Lineage Bab mencakup canonical TPs dari ATP tertaut');
  assert.strictEqual(u.materials.length, 1);
  assert.strictEqual(u.materials[0].title, 'Operasi Bentuk Aljabar');
  assert.deepStrictEqual(u.materials[0].linkedAtpItemIds, ['atp-item-3']);
  assert.ok(u.materials[0].linkedTpIds.includes('tp-4') && u.materials[0].linkedTpIds.includes('tp-5'));

  console.log('[PASS] Test 2: Bab tanpa lineage berhasil membangun linkedAtpItemIds dan linkedTpIds canonical');
}

// =========================================================================
// Test 3: Bab dengan lineage valid (subset diperbolehkan, di luar lineage ditolak)
// =========================================================================
{
  const unitWithLineage: ATPUnitMapping[] = [
    {
      id: 'unit-bil',
      title: 'Bab Bilangan',
      order: 1,
      linkedAtpItemIds: ['atp-item-1', 'atp-item-2'],
      linkedTpIds: ['tp-1', 'tp-2', 'tp-3'],
      materials: [
        {
          id: 'mat-exist-1',
          title: 'Bilangan Bulat Dasar',
          order: 1,
          linkedAtpItemIds: ['atp-item-1'],
          linkedTpIds: ['tp-1'],
        },
      ],
    },
  ];

  const fp = computeMappingFingerprint(unitWithLineage, mockAtp, mockTp);

  // 3A. Valid subset addition
  const validAction: MappingActionItem = {
    id: 'act-valid-subset',
    type: 'ADD_MATERIAL_TO_UNIT',
    targetUnitId: 'unit-bil',
    title: 'Operasi Pecahan Lanjutan',
    linkedAtpItemIds: ['atp-item-2'],
    linkedTpIds: ['tp-3'],
  };

  const partial = applyATPMappingActions({ units: unitWithLineage, selectedActions: [validAction], atp: mockAtp, tp: mockTp, expectedFingerprint: fp, currentFingerprint: fp });
  assert.equal(partial.success, false, 'Bundle yang masih meninggalkan TP Bab tanpa materi wajib ditolak');
  assert.equal(partial.nextUnits, undefined);
  const resultValid = applyATPMappingActions({
    units: unitWithLineage,
    selectedActions: [validAction, { id: 'align-pair', type: 'ALIGN_EXISTING_MATERIAL', targetUnitId: 'unit-bil', targetMaterialId: 'mat-exist-1', linkedTpIds: ['tp-1','tp-2'], linkedAtpItemIds: ['atp-item-1'] }],
    atp: mockAtp,
    tp: mockTp,
    expectedFingerprint: fp,
    currentFingerprint: fp,
  });

  assert.strictEqual(resultValid.success, true, 'Materi baru dengan subset TP/ATP Bab induk harus diterima');
  assert.strictEqual(resultValid.nextUnits![0].materials.length, 2);
  assert.strictEqual(resultValid.nextUnits![0].materials[0].title, 'Bilangan Bulat Dasar');
  assert.strictEqual(resultValid.nextUnits![0].materials[1].title, 'Operasi Pecahan Lanjutan');

  // 3B. Invalid addition (ATP 'atp-item-4' not in parent unit lineage)
  const invalidAction: MappingActionItem = {
    id: 'act-invalid-lineage',
    type: 'ADD_MATERIAL_TO_UNIT',
    targetUnitId: 'unit-bil',
    title: 'Persamaan Linear (Salah Bab)',
    linkedAtpItemIds: ['atp-item-4'],
    linkedTpIds: ['tp-6'],
  };

  const resultInvalid = applyATPMappingActions({
    units: unitWithLineage,
    selectedActions: [invalidAction],
    atp: mockAtp,
    tp: mockTp,
    expectedFingerprint: fp,
    currentFingerprint: fp,
  });

  assert.strictEqual(resultInvalid.success, false, 'Materi baru dengan ATP di luar Bab induk harus ditolak');
  assert.ok(
    resultInvalid.issues.some((iss) => iss.includes('tidak didukung Bab induk')),
    'Harus memuat pesan alasan penolakan silsilah Bab induk'
  );

  console.log('[PASS] Test 3: Bab dengan lineage valid mengizinkan subset dan menolak ATP di luar lineage Bab');
}

// =========================================================================
// Test 4: Beberapa action sekaligus diterapkan secara konsisten
// =========================================================================
{
  const initialUnits: ATPUnitMapping[] = [
    {
      id: 'unit-1',
      title: 'Bab 1',
      order: 1,
      linkedAtpItemIds: [],
      linkedTpIds: [],
      materials: [],
    },
    {
      id: 'unit-2',
      title: 'Bab 2',
      order: 2,
      linkedAtpItemIds: [],
      linkedTpIds: [],
      materials: [],
    },
  ];

  const fp = computeMappingFingerprint(initialUnits, mockAtp, mockTp);

  const batchActions: MappingActionItem[] = [
    {
      id: 'b-1',
      type: 'ADD_MATERIAL_TO_UNIT',
      targetUnitId: 'unit-1',
      title: 'Materi 1.1',
      linkedAtpItemIds: ['atp-item-1'],
      linkedTpIds: ['tp-1', 'tp-2'],
    },
    {
      id: 'b-2',
      type: 'ADD_MATERIAL_TO_UNIT',
      targetUnitId: 'unit-1',
      title: 'Materi 1.2',
      linkedAtpItemIds: ['atp-item-2'],
      linkedTpIds: ['tp-3'],
    },
    {
      id: 'b-3',
      type: 'ADD_MATERIAL_TO_UNIT',
      targetUnitId: 'unit-2',
      title: 'Materi 2.1',
      linkedAtpItemIds: ['atp-item-3'],
      linkedTpIds: ['tp-4', 'tp-5'],
    },
  ];

  const res = applyATPMappingActions({
    units: initialUnits,
    selectedActions: batchActions,
    atp: mockAtp,
    tp: mockTp,
    expectedFingerprint: fp,
    currentFingerprint: fp,
  });

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.nextUnits![0].materials.length, 2);
  assert.strictEqual(res.nextUnits![1].materials.length, 1);

  console.log('[PASS] Test 4: Beberapa action sekaligus diterapkan secara konsisten');
}

// =========================================================================
// Test 5: Satu action invalid menyebabkan seluruh transaksi batal (Atomic Rollback)
// =========================================================================
{
  const units: ATPUnitMapping[] = [
    {
      id: 'unit-1',
      title: 'Bab 1',
      order: 1,
      linkedAtpItemIds: [],
      linkedTpIds: [],
      materials: [],
    },
    {
      id: 'unit-2',
      title: 'Bab 2',
      order: 2,
      linkedAtpItemIds: [],
      linkedTpIds: [],
      materials: [],
    },
  ];

  const fp = computeMappingFingerprint(units, mockAtp, mockTp);

  const actionsWithOneInvalid: MappingActionItem[] = [
    {
      id: 'valid-1',
      type: 'ADD_MATERIAL_TO_UNIT',
      targetUnitId: 'unit-1',
      title: 'Materi Valid 1',
      linkedAtpItemIds: ['atp-item-1'],
      linkedTpIds: ['tp-1', 'tp-2'],
    },
    {
      id: 'invalid-fictitious-atp',
      type: 'ADD_MATERIAL_TO_UNIT',
      targetUnitId: 'unit-2',
      title: 'Materi Fiktif ATP',
      linkedAtpItemIds: ['atp-item-999_FIKTIF'],
      linkedTpIds: ['tp-7'],
    },
    {
      id: 'valid-2',
      type: 'ADD_MATERIAL_TO_UNIT',
      targetUnitId: 'unit-1',
      title: 'Materi Valid 2',
      linkedAtpItemIds: ['atp-item-2'],
      linkedTpIds: ['tp-3'],
    },
  ];

  const res = applyATPMappingActions({
    units,
    selectedActions: actionsWithOneInvalid,
    atp: mockAtp,
    tp: mockTp,
    expectedFingerprint: fp,
    currentFingerprint: fp,
  });

  assert.strictEqual(res.success, false, 'Jika ada 1 action invalid, transaksi harus batal');
  assert.strictEqual(res.nextUnits, undefined, 'nextUnits tidak boleh dihasilkan saat gagal');
  assert.ok(
    res.issues.some((iss) => iss.includes('atp-item-999_FIKTIF')),
    'Harus memuat alasan spesifik ID ATP fiktif'
  );

  // Verify original units are completely untouched
  assert.strictEqual(units[0].materials.length, 0);
  assert.strictEqual(units[1].materials.length, 0);

  console.log('[PASS] Test 5: Satu action invalid membatalkan seluruh transaksi secara atomik');
}

// =========================================================================
// Test 6: Penerapan ulang tidak menciptakan duplikat (Idempotency)
// =========================================================================
{
  const unit: ATPUnitMapping[] = [
    {
      id: 'unit-1',
      title: 'Bab 1',
      order: 1,
      linkedAtpItemIds: [],
      linkedTpIds: [],
      materials: [],
    },
  ];

  const fp1 = computeMappingFingerprint(unit, mockAtp, mockTp);
  const action: MappingActionItem = {
    id: 'act-repeat',
    type: 'ADD_MATERIAL_TO_UNIT',
    targetUnitId: 'unit-1',
    title: 'Operasi Bilangan Bulat',
    linkedAtpItemIds: ['atp-item-1'],
    linkedTpIds: ['tp-1', 'tp-2'],
  };

  // 1st Application
  const res1 = applyATPMappingActions({
    units: unit,
    selectedActions: [action],
    atp: mockAtp,
    tp: mockTp,
    expectedFingerprint: fp1,
    currentFingerprint: fp1,
  });

  assert.strictEqual(res1.success, true);
  assert.strictEqual(res1.nextUnits![0].materials.length, 1);
  assert.strictEqual(res1.nextUnits![0].materials[0].title, 'Operasi Bilangan Bulat');

  // 2nd Application (Penerapan Ulang with fresh fingerprint)
  const fp2 = computeMappingFingerprint(res1.nextUnits!, mockAtp, mockTp);
  const res2 = applyATPMappingActions({
    units: res1.nextUnits!,
    selectedActions: [action],
    atp: mockAtp,
    tp: mockTp,
    expectedFingerprint: fp2,
    currentFingerprint: fp2,
  });

  assert.strictEqual(res2.success, true, 'Penerapan ulang harus sukses secara idempoten');
  assert.strictEqual(res2.nextUnits![0].materials.length, 1, 'Penerapan ulang TIDAK boleh menambah materi duplikat');
  assert.strictEqual(res2.nextUnits![0].materials[0].title, 'Operasi Bilangan Bulat');

  // Also test passing duplicate actions in the same batch
  const resDuplicateInBatch = applyATPMappingActions({
    units: unit,
    selectedActions: [action, action],
    atp: mockAtp,
    tp: mockTp,
    expectedFingerprint: fp1,
    currentFingerprint: fp1,
  });

  assert.strictEqual(resDuplicateInBatch.success, true);
  assert.strictEqual(
    resDuplicateInBatch.nextUnits![0].materials.length,
    1,
    'Dua action dengan judul yang sama dalam satu batch tidak boleh menduplikasi materi'
  );

  console.log('[PASS] Test 6: Penerapan ulang tidak menciptakan duplikat');
}

// =========================================================================
// Test 7: Jumlah, ID, judul, dan urutan Bab tetap identik
// =========================================================================
{
  const units: ATPUnitMapping[] = [
    {
      id: 'custom-unit-alpha',
      title: 'Bab I: Bilangan dan Operasinya',
      order: 1,
      linkedAtpItemIds: [],
      linkedTpIds: [],
      materials: [],
    },
    {
      id: 'custom-unit-beta',
      title: 'Bab II: Pemikiran Aljabar',
      order: 2,
      linkedAtpItemIds: [],
      linkedTpIds: [],
      materials: [],
    },
    {
      id: 'custom-unit-gamma',
      title: 'Bab III: Eksplorasi Data',
      order: 3,
      linkedAtpItemIds: [],
      linkedTpIds: [],
      materials: [],
    },
  ];

  const fp = computeMappingFingerprint(units, mockAtp, mockTp);

  const actions: MappingActionItem[] = [
    {
      id: 'act-a',
      type: 'ADD_MATERIAL_TO_UNIT',
      targetUnitId: 'custom-unit-alpha',
      title: 'Bilangan Bulat Positif dan Negatif',
      linkedAtpItemIds: ['atp-item-1'],
      linkedTpIds: ['tp-1', 'tp-2'],
    },
    {
      id: 'act-c',
      type: 'ADD_MATERIAL_TO_UNIT',
      targetUnitId: 'custom-unit-gamma',
      title: 'Pengolahan Data Statistik',
      linkedAtpItemIds: ['atp-item-5'],
      linkedTpIds: ['tp-7'],
    },
  ];

  const res = applyATPMappingActions({
    units,
    selectedActions: actions,
    atp: mockAtp,
    tp: mockTp,
    expectedFingerprint: fp,
    currentFingerprint: fp,
  });

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.nextUnits!.length, units.length, 'Jumlah Bab harus tetap sama');

  for (let i = 0; i < units.length; i++) {
    assert.strictEqual(res.nextUnits![i].id, units[i].id, `ID Bab ke-${i + 1} harus identik`);
    assert.strictEqual(res.nextUnits![i].title, units[i].title, `Judul Bab ke-${i + 1} harus identik`);
    assert.strictEqual(res.nextUnits![i].order, units[i].order, `Urutan Bab ke-${i + 1} harus identik`);
  }

  console.log('[PASS] Test 7: Jumlah, ID, judul, dan urutan Bab tetap 100% identik');
}

// =========================================================================
// Test 8: Urutan materi baru konsisten mengikuti urutan rekomendasi tanpa ubah existing
// =========================================================================
{
  const unitWithExisting: ATPUnitMapping[] = [
    {
      id: 'unit-seq',
      title: 'Bab Urutan Materi',
      order: 1,
      linkedAtpItemIds: ['atp-item-1'],
      linkedTpIds: ['tp-1', 'tp-2'],
      materials: [
        {
          id: 'mat-exist-a',
          title: 'Materi Manual Guru 1',
          order: 1,
          linkedAtpItemIds: ['atp-item-1'],
          linkedTpIds: ['tp-1'],
        },
        {
          id: 'mat-exist-b',
          title: 'Materi Manual Guru 2',
          order: 2,
          linkedAtpItemIds: ['atp-item-1'],
          linkedTpIds: ['tp-1'],
        },
      ],
    },
  ];

  const fp = computeMappingFingerprint(unitWithExisting, mockAtp, mockTp);

  const seqActions: MappingActionItem[] = [
    {
      id: 'act-seq-1',
      type: 'ADD_MATERIAL_TO_UNIT',
      targetUnitId: 'unit-seq',
      title: 'Rekomendasi Pertama',
      linkedAtpItemIds: ['atp-item-1'],
      linkedTpIds: ['tp-1'],
    },
    {
      id: 'act-seq-2',
      type: 'ADD_MATERIAL_TO_UNIT',
      targetUnitId: 'unit-seq',
      title: 'Rekomendasi Kedua',
      linkedAtpItemIds: ['atp-item-1'],
      linkedTpIds: ['tp-2'],
    },
  ];

  const res = applyATPMappingActions({
    units: unitWithExisting,
    selectedActions: seqActions,
    atp: mockAtp,
    tp: mockTp,
    expectedFingerprint: fp,
    currentFingerprint: fp,
  });

  assert.strictEqual(res.success, true);
  const mats = res.nextUnits![0].materials;
  assert.strictEqual(mats.length, 4);

  // Existing materials remain untouched in positions 0 and 1
  assert.strictEqual(mats[0].title, 'Materi Manual Guru 1');
  assert.strictEqual(mats[0].order, 1);
  assert.strictEqual(mats[1].title, 'Materi Manual Guru 2');
  assert.strictEqual(mats[1].order, 2);

  // New materials appended in recommendation sequence
  assert.strictEqual(mats[2].title, 'Rekomendasi Pertama');
  assert.strictEqual(mats[2].order, 3);
  assert.strictEqual(mats[3].title, 'Rekomendasi Kedua');
  assert.strictEqual(mats[3].order, 4);

  console.log('[PASS] Test 8: Urutan materi baru konsisten mengikuti rekomendasi tanpa mengubah materi existing');
}

// =========================================================================
// Test 9: Validasi canonical pasca penerapan berhasil
// =========================================================================
{
  const fullUnits: ATPUnitMapping[] = [
    {
      id: 'u-1',
      title: 'Bab 1',
      order: 1,
      linkedAtpItemIds: [],
      linkedTpIds: [],
      materials: [],
    },
    {
      id: 'u-2',
      title: 'Bab 2',
      order: 2,
      linkedAtpItemIds: [],
      linkedTpIds: [],
      materials: [],
    },
    {
      id: 'u-3',
      title: 'Bab 3',
      order: 3,
      linkedAtpItemIds: [],
      linkedTpIds: [],
      materials: [],
    },
  ];

  const fp = computeMappingFingerprint(fullUnits, mockAtp, mockTp);

  const actions: MappingActionItem[] = [
    {
      id: 'a1',
      type: 'ADD_MATERIAL_TO_UNIT',
      targetUnitId: 'u-1',
      title: 'Materi 1',
      linkedAtpItemIds: ['atp-item-1', 'atp-item-2'],
      linkedTpIds: ['tp-1', 'tp-2', 'tp-3'],
    },
    {
      id: 'a2',
      type: 'ADD_MATERIAL_TO_UNIT',
      targetUnitId: 'u-2',
      title: 'Materi 2',
      linkedAtpItemIds: ['atp-item-3', 'atp-item-4'],
      linkedTpIds: ['tp-4', 'tp-5', 'tp-6'],
    },
    {
      id: 'a3',
      type: 'ADD_MATERIAL_TO_UNIT',
      targetUnitId: 'u-3',
      title: 'Materi 3',
      linkedAtpItemIds: ['atp-item-5'],
      linkedTpIds: ['tp-7'],
    },
  ];

  const res = applyATPMappingActions({
    units: fullUnits,
    selectedActions: actions,
    atp: mockAtp,
    tp: mockTp,
    expectedFingerprint: fp,
    currentFingerprint: fp,
  });

  assert.strictEqual(res.success, true);

  const validation = validateATPUnitMappingCanonical(
    {
      id: 'mapping-complete',
      academicSettingId: 'setting-smp-7',
      atpId: mockAtp.id,
      units: res.nextUnits!,
      updatedAt: '2026-10-16T00:00:00Z',
    },
    mockAtp,
    mockTp
  );

  assert.strictEqual(validation.isValid, true, 'Draf hasil penerapan harus valid canonical');
  assert.strictEqual(validation.isComplete, true, 'Draf lengkap harus mencakup seluruh ATP dan TP canonical');
  assert.strictEqual(validation.invalidReferenceCount, 0);
  assert.strictEqual(validation.unitsWithoutLineage.length, 0);

  console.log('[PASS] Test 9: Validasi canonical pasca penerapan berhasil dan lengkap');
}

console.log('==============================================================');
console.log('TOTAL: 9/9 TESTS PASSED SUCCESSFULLY');
console.log('==============================================================');
