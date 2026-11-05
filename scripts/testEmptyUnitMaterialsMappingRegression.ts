import assert from 'node:assert';
import {
  sanitizeMappingAnalysisResult,
  fallbackAnalyzeMapping,
} from '../server/mappingAnalysis';
import { applyATPMappingActions, computeMappingFingerprint } from '../src/services/atpMappingActionApplyService';
import type { ATPData, ATPUnitMappingData, TPData } from '../src/types';

console.log('=== RUNNING EMPTY UNIT MATERIALS MAPPING REGRESSION TESTS ===\n');

let totalPassed = 0;
let totalFailed = 0;

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    totalPassed++;
  } catch (err: any) {
    console.error(`[FAIL] ${name}:`, err.message);
    totalFailed++;
  }
}

// Canonical Fixtures: PJOK SD/SMP
const tpDataPJOK: TPData = {
  id: 'tp-pjok',
  academicSettingId: 'acad-pjok',
  items: [
    {
      id: 'tp-loko',
      code: 'E1-GER-01',
      statement: 'Peserta didik mempraktikkan variasi gerak lokomotor seperti berjalan dan berlari.',
      competence: 'Mempraktikkan',
      contentScope: 'Gerak lokomotor',
      order: 1,
    },
    {
      id: 'tp-non',
      code: 'E1-GER-02',
      statement: 'Peserta didik mempraktikkan variasi gerak non-lokomotor seperti menekuk dan memutar.',
      competence: 'Mempraktikkan',
      contentScope: 'Gerak non-lokomotor',
      order: 2,
    },
    {
      id: 'tp-manip',
      code: 'E1-GER-03',
      statement: 'Peserta didik mempraktikkan variasi gerak manipulatif menggunakan bola.',
      competence: 'Mempraktikkan',
      contentScope: 'Variasi gerak manipulatif',
      order: 3,
    },
    {
      id: 'tp-safe',
      code: 'E2-KES-01',
      statement: 'Peserta didik menerapkan keselamatan aktivitas fisik agar terhindar dari cedera.',
      competence: 'Menerapkan',
      contentScope: 'Keselamatan aktivitas fisik',
      order: 4,
    },
  ],
  workflowStatus: 'SIAP',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const atpDataPJOK: ATPData = {
  id: 'atp-pjok',
  academicSettingId: 'acad-pjok',
  tpDataId: tpDataPJOK.id,
  items: [
    { id: 'atp-loko', stepNumber: 1, linkedTpIds: ['tp-loko'], focus: 'Variasi gerak lokomotor' },
    { id: 'atp-non', stepNumber: 2, linkedTpIds: ['tp-non'], focus: 'Variasi gerak non-lokomotor' },
    { id: 'atp-manip', stepNumber: 3, linkedTpIds: ['tp-manip'], focus: 'Variasi gerak manipulatif' },
    { id: 'atp-safe', stepNumber: 4, linkedTpIds: ['tp-safe'], focus: 'Keselamatan aktivitas fisik' },
  ],
  workflowStatus: 'SIAP',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

// =========================================================================
// TEST 1: SEMUA BAB KOSONG (All Empty Bab)
// =========================================================================
runTest('Test 1: Semua Bab kosong menghasilkan rekomendasi MISSING_MATERIAL dengan ADD_MATERIAL_TO_UNIT', () => {
  const mappingAllEmpty: ATPUnitMappingData = {
    id: 'mapping-all-empty',
    academicSettingId: 'acad-pjok',
    atpId: atpDataPJOK.id,
    tpDataId: tpDataPJOK.id,
    units: [
      {
        id: 'unit-1',
        title: 'Bab 1: Gerak Lokomotor',
        order: 1,
        linkedAtpItemIds: ['atp-loko'],
        linkedTpIds: ['tp-loko'],
        materials: [],
      },
      {
        id: 'unit-2',
        title: 'Bab 2: Gerak Non-Lokomotor',
        order: 2,
        linkedAtpItemIds: ['atp-non'],
        linkedTpIds: ['tp-non'],
        materials: [],
      },
      {
        id: 'unit-3',
        title: 'Bab 3: Gerak Manipulatif',
        order: 3,
        linkedAtpItemIds: ['atp-manip'],
        linkedTpIds: ['tp-manip'],
        materials: [],
      },
    ],
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const initialUnitsSnapshot = JSON.parse(JSON.stringify(mappingAllEmpty.units));

  const result = fallbackAnalyzeMapping({
    tpData: tpDataPJOK,
    atpData: atpDataPJOK,
    currentMapping: mappingAllEmpty,
  });

  // 1. Structure of original Bab is untouched (read-only)
  assert.deepStrictEqual(mappingAllEmpty.units, initialUnitsSnapshot, 'Bab asli tidak boleh berubah setelah analisis');
  assert.strictEqual(mappingAllEmpty.units.length, 3, 'Jumlah Bab harus tetap 3');

  // 2. Every empty Bab has MISSING_MATERIAL
  const unit1Findings = result.materialFindings.filter((f) => f.unitId === 'unit-1');
  const unit2Findings = result.materialFindings.filter((f) => f.unitId === 'unit-2');
  const unit3Findings = result.materialFindings.filter((f) => f.unitId === 'unit-3');

  assert.ok(unit1Findings.length >= 1, 'Unit 1 harus memiliki rekomendasi materi');
  assert.ok(unit2Findings.length >= 1, 'Unit 2 harus memiliki rekomendasi materi');
  assert.ok(unit3Findings.length >= 1, 'Unit 3 harus memiliki rekomendasi materi');

  assert.strictEqual(unit1Findings[0].status, 'MISSING_MATERIAL');
  assert.strictEqual(unit2Findings[0].status, 'MISSING_MATERIAL');
  assert.strictEqual(unit3Findings[0].status, 'MISSING_MATERIAL');

  // 3. Actions use ADD_MATERIAL_TO_UNIT with correct targetUnitId and canonical lineage
  assert.strictEqual(unit1Findings[0].action?.type, 'ADD_MATERIAL_TO_UNIT');
  assert.strictEqual(unit1Findings[0].action?.targetUnitId, 'unit-1');
  assert.deepStrictEqual(unit1Findings[0].action?.linkedAtpItemIds, ['atp-loko']);
  assert.deepStrictEqual(unit1Findings[0].action?.linkedTpIds, ['tp-loko']);
  assert.ok(unit1Findings[0].action?.title.length > 0, 'Judul materi tidak boleh kosong');

  assert.strictEqual(unit2Findings[0].action?.type, 'ADD_MATERIAL_TO_UNIT');
  assert.strictEqual(unit2Findings[0].action?.targetUnitId, 'unit-2');
  assert.deepStrictEqual(unit2Findings[0].action?.linkedAtpItemIds, ['atp-non']);

  assert.strictEqual(unit3Findings[0].action?.type, 'ADD_MATERIAL_TO_UNIT');
  assert.strictEqual(unit3Findings[0].action?.targetUnitId, 'unit-3');
  assert.deepStrictEqual(unit3Findings[0].action?.linkedAtpItemIds, ['atp-manip']);

  // 4. Test applyATPMappingActions with the recommended action
  const fp = computeMappingFingerprint(mappingAllEmpty.units, atpDataPJOK, tpDataPJOK);
  const applyRes = applyATPMappingActions({
    units: mappingAllEmpty.units,
    selectedActions: [{ id: unit1Findings[0].id, ...unit1Findings[0].action! }],
    atp: atpDataPJOK,
    tp: tpDataPJOK,
    expectedFingerprint: fp,
    currentFingerprint: fp,
  });

  assert.strictEqual(applyRes.success, true, 'ADD_MATERIAL_TO_UNIT dari rekomendasi harus berhasil diaplikasikan');
  assert.strictEqual(applyRes.nextUnits?.[0].materials.length, 1, 'Unit 1 harus memiliki 1 materi setelah aksi diaplikasikan');
  assert.strictEqual(applyRes.nextUnits?.[0].materials[0].title, unit1Findings[0].action!.title);
});

// =========================================================================
// TEST 2: SEBAGIAN BAB KOSONG (Partial Empty Bab)
// =========================================================================
runTest('Test 2: Sebagian Bab kosong mempertahankan materi existing dan hanya menambah materi pada Bab kosong', () => {
  const mappingPartial: ATPUnitMappingData = {
    id: 'mapping-partial',
    academicSettingId: 'acad-pjok',
    atpId: atpDataPJOK.id,
    tpDataId: tpDataPJOK.id,
    units: [
      {
        id: 'unit-filled',
        title: 'Bab 1: Gerak Lokomotor',
        order: 1,
        linkedAtpItemIds: ['atp-loko'],
        linkedTpIds: ['tp-loko'],
        materials: [
          {
            id: 'mat-1',
            title: 'Variasi Gerak Lokomotor',
            order: 1,
            linkedAtpItemIds: ['atp-loko'],
            linkedTpIds: ['tp-loko'],
          },
        ],
      },
      {
        id: 'unit-empty',
        title: 'Bab 2: Gerak Non-Lokomotor',
        order: 2,
        linkedAtpItemIds: ['atp-non'],
        linkedTpIds: ['tp-non'],
        materials: [], // Empty!
      },
    ],
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const result = fallbackAnalyzeMapping({
    tpData: tpDataPJOK,
    atpData: atpDataPJOK,
    currentMapping: mappingPartial,
  });

  // Unit-filled produces SUPPORTED or ALIGNABLE for existing material mat-1
  const filledFindings = result.materialFindings.filter((f) => f.unitId === 'unit-filled');
  assert.strictEqual(filledFindings.length, 1);
  assert.strictEqual(filledFindings[0].materialId, 'mat-1');
  assert.ok(
    filledFindings[0].status === 'SUPPORTED' || filledFindings[0].status === 'ALIGNABLE',
    `Status materi existing harus valid: ${filledFindings[0].status}`
  );

  // Unit-empty produces MISSING_MATERIAL recommendation
  const emptyFindings = result.materialFindings.filter((f) => f.unitId === 'unit-empty');
  assert.strictEqual(emptyFindings.length, 1);
  assert.strictEqual(emptyFindings[0].status, 'MISSING_MATERIAL');
  assert.strictEqual(emptyFindings[0].action?.type, 'ADD_MATERIAL_TO_UNIT');
  assert.strictEqual(emptyFindings[0].action?.targetUnitId, 'unit-empty');
  assert.deepStrictEqual(emptyFindings[0].action?.linkedAtpItemIds, ['atp-non']);

  // Summary counts
  assert.strictEqual(result.summary.missingMaterialSuggestions, 1);
});

// =========================================================================
// TEST 3: BAB TANPA LINEAGE (Empty Bab without lineage)
// =========================================================================
runTest('Test 3: Bab tanpa lineage dan tanpa materi menghasilkan rekomendasi berdasarkan keselarasan judul Bab', () => {
  const mappingNoLineage: ATPUnitMappingData = {
    id: 'mapping-nolineage',
    academicSettingId: 'acad-pjok',
    atpId: atpDataPJOK.id,
    tpDataId: tpDataPJOK.id,
    units: [
      {
        id: 'unit-imported',
        title: 'Variasi Gerak Manipulatif', // Strong semantic alignment with tp-manip and atp-manip
        order: 1,
        linkedAtpItemIds: [], // No lineage yet!
        linkedTpIds: [],      // No lineage yet!
        materials: [],        // Empty!
      },
    ],
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const result = fallbackAnalyzeMapping({
    tpData: tpDataPJOK,
    atpData: atpDataPJOK,
    currentMapping: mappingNoLineage,
  });

  const unitFindings = result.materialFindings.filter((f) => f.unitId === 'unit-imported');
  assert.strictEqual(unitFindings.length, 1, 'Harus menghasilkan tepat 1 rekomendasi materi');
  assert.strictEqual(unitFindings[0].status, 'MISSING_MATERIAL');
  assert.strictEqual(unitFindings[0].action?.type, 'ADD_MATERIAL_TO_UNIT');
  assert.strictEqual(unitFindings[0].action?.targetUnitId, 'unit-imported');
  assert.deepStrictEqual(unitFindings[0].action?.linkedAtpItemIds, ['atp-manip']);
  assert.deepStrictEqual(unitFindings[0].action?.linkedTpIds, ['tp-manip']);
  assert.strictEqual(unitFindings[0].action?.title, 'Variasi Gerak Manipulatif');

  // Verify action passes validation in apply service
  const fp = computeMappingFingerprint(mappingNoLineage.units, atpDataPJOK, tpDataPJOK);
  const applyRes = applyATPMappingActions({
    units: mappingNoLineage.units,
    selectedActions: [{ id: unitFindings[0].id, ...unitFindings[0].action! }],
    atp: atpDataPJOK,
    tp: tpDataPJOK,
    expectedFingerprint: fp,
    currentFingerprint: fp,
  });

  assert.strictEqual(applyRes.success, true, 'Aksi penambahan materi pada Bab tanpa lineage harus valid');
  assert.deepStrictEqual(applyRes.nextUnits?.[0].linkedAtpItemIds, ['atp-manip'], 'Bab induk memperoleh ATP lineage dari materi baru');
  assert.deepStrictEqual(applyRes.nextUnits?.[0].linkedTpIds, ['tp-manip'], 'Bab induk memperoleh TP lineage dari materi baru');
});

// =========================================================================
// TEST 4: HASIL AI TIDAK LENGKAP (Incomplete AI result)
// =========================================================================
runTest('Test 4: Hasil AI yang mengabaikan salah satu Bab kosong dipulihkan secara deterministik', () => {
  const mappingTwoEmpty: ATPUnitMappingData = {
    id: 'mapping-two-empty',
    academicSettingId: 'acad-pjok',
    atpId: atpDataPJOK.id,
    tpDataId: tpDataPJOK.id,
    units: [
      {
        id: 'unit-1',
        title: 'Bab 1: Gerak Lokomotor',
        order: 1,
        linkedAtpItemIds: ['atp-loko'],
        linkedTpIds: ['tp-loko'],
        materials: [],
      },
      {
        id: 'unit-2',
        title: 'Bab 2: Gerak Non-Lokomotor',
        order: 2,
        linkedAtpItemIds: ['atp-non'],
        linkedTpIds: ['tp-non'],
        materials: [],
      },
    ],
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  // Simulated AI response: AI ONLY returned recommendation for Unit 1, completely omitted Unit 2!
  const incompleteAIResponse = {
    summary: {},
    atpFindings: [],
    materialFindings: [
      {
        id: 'ai-mat-1',
        status: 'MISSING_MATERIAL',
        unitId: 'unit-1',
        suggestedTitle: 'Variasi Gerak Lokomotor',
        supportingAtpItemIds: ['atp-loko'],
        supportingTpIds: ['tp-loko'],
        reason: 'Saran AI untuk unit 1',
        action: {
          type: 'ADD_MATERIAL_TO_UNIT',
          targetUnitId: 'unit-1',
          title: 'Variasi Gerak Lokomotor',
          linkedAtpItemIds: ['atp-loko'],
          linkedTpIds: ['tp-loko'],
        },
      },
    ],
  };

  const sanitized = sanitizeMappingAnalysisResult(incompleteAIResponse, {
    tpData: tpDataPJOK,
    atpData: atpDataPJOK,
    currentMapping: mappingTwoEmpty,
  });

  // Unit 1 preserved from AI
  const unit1Findings = sanitized.materialFindings.filter((f) => f.unitId === 'unit-1');
  assert.strictEqual(unit1Findings.length, 1);
  assert.strictEqual(unit1Findings[0].id, 'ai-mat-1');
  assert.strictEqual(unit1Findings[0].status, 'MISSING_MATERIAL');

  // Unit 2 (omitted by AI) is automatically recovered by deterministic empty unit handler
  const unit2Findings = sanitized.materialFindings.filter((f) => f.unitId === 'unit-2');
  assert.strictEqual(unit2Findings.length, 1, 'Unit 2 yang dilewatkan AI harus memperoleh rekomendasi deterministik');
  assert.strictEqual(unit2Findings[0].status, 'MISSING_MATERIAL');
  assert.strictEqual(unit2Findings[0].action?.type, 'ADD_MATERIAL_TO_UNIT');
  assert.strictEqual(unit2Findings[0].action?.targetUnitId, 'unit-2');
  assert.deepStrictEqual(unit2Findings[0].action?.linkedAtpItemIds, ['atp-non']);
});

// =========================================================================
// TEST 5: BAB DENGAN KESELARASAN AMBIGU / TANPA BUKTI CUKUP
// =========================================================================
runTest('Test 5: Bab dengan keselarasan ambigu menghasilkan MANUAL_REVIEW tanpa action fiktif', () => {
  const mappingAmbiguous: ATPUnitMappingData = {
    id: 'mapping-ambig',
    academicSettingId: 'acad-pjok',
    atpId: atpDataPJOK.id,
    tpDataId: tpDataPJOK.id,
    units: [
      {
        id: 'unit-generic-title',
        title: 'Bab 1', // Only stop words, no substantive token!
        order: 1,
        linkedAtpItemIds: [],
        linkedTpIds: [],
        materials: [],
      },
      {
        id: 'unit-unrelated-topic',
        title: 'Proyek Robotika Lanjutan', // Unrelated domain to PJOK
        order: 2,
        linkedAtpItemIds: [],
        linkedTpIds: [],
        materials: [],
      },
    ],
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const result = fallbackAnalyzeMapping({
    tpData: tpDataPJOK,
    atpData: atpDataPJOK,
    currentMapping: mappingAmbiguous,
  });

  const genericFindings = result.materialFindings.filter((f) => f.unitId === 'unit-generic-title');
  assert.strictEqual(genericFindings.length, 1);
  assert.strictEqual(genericFindings[0].status, 'MANUAL_REVIEW', 'Judul tanpa kata kunci substansi harus MANUAL_REVIEW');
  assert.strictEqual(genericFindings[0].action, undefined, 'MANUAL_REVIEW tidak boleh memiliki action fiktif');
  assert.ok(genericFindings[0].reason.includes('tidak memuat kata kunci substansi'), 'Alasan harus jelas');

  const unrelatedFindings = result.materialFindings.filter((f) => f.unitId === 'unit-unrelated-topic');
  assert.strictEqual(unrelatedFindings.length, 1);
  assert.strictEqual(unrelatedFindings[0].status, 'MANUAL_REVIEW', 'Topik tidak selaras harus MANUAL_REVIEW');
  assert.strictEqual(unrelatedFindings[0].action, undefined, 'MANUAL_REVIEW tidak boleh memiliki action fiktif');
  assert.ok(unrelatedFindings[0].reason.includes('belum dapat dipastikan'), 'Alasan harus jelas');
});

// =========================================================================
// TEST 6: BEBERAPA LINGKUP MATERI UNTUK SATU BAB (Multiple Materials)
// =========================================================================
runTest('Test 6: Bab tanpa evidence TP lengkap tidak membuat materi dari fokus ATP', () => {
  const tpInformatika: TPData = {
    id: 'tp-info',
    academicSettingId: 'acad-info',
    items: [
      {
        id: 'tp-algo',
        code: 'E1-AP-01',
        statement: 'Memahami konsep dasar algoritma dan diagram alir (flowchart).',
        competence: 'Memahami',
        contentScope: 'Algoritma dan Flowchart',
        order: 1,
      },
      {
        id: 'tp-control',
        code: 'E1-AP-02',
        statement: 'Menerapkan struktur percabangan dan perulangan dalam pemrograman.',
        competence: 'Menerapkan',
        contentScope: 'Struktur Kontrol Pemrograman',
        order: 2,
      },
    ],
    workflowStatus: 'SIAP',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const atpInformatika: ATPData = {
    id: 'atp-info',
    academicSettingId: 'acad-info',
    tpDataId: tpInformatika.id,
    items: [
      { id: 'atp-algo', stepNumber: 1, linkedTpIds: ['tp-algo'], focus: 'Algoritma dan Diagram Alir' },
      { id: 'atp-control', stepNumber: 2, linkedTpIds: ['tp-control'], focus: 'Struktur Percabangan dan Perulangan' },
    ],
    workflowStatus: 'SIAP',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const mappingInfo: ATPUnitMappingData = {
    id: 'mapping-info',
    academicSettingId: 'acad-info',
    atpId: atpInformatika.id,
    tpDataId: tpInformatika.id,
    units: [
      {
        id: 'unit-coding',
        title: 'Bab 1: Algoritma dan Pemrograman',
        order: 1,
        linkedAtpItemIds: ['atp-algo', 'atp-control'],
        linkedTpIds: ['tp-algo', 'tp-control'],
        materials: [], // Empty!
      },
    ],
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const result = fallbackAnalyzeMapping({
    tpData: tpInformatika,
    atpData: atpInformatika,
    currentMapping: mappingInfo,
  });

  const findings = result.materialFindings.filter((f) => f.unitId === 'unit-coding');
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].status, 'MANUAL_REVIEW', 'Judul Bab tidak membuktikan seluruh TP kontrol; jangan membuat materi dari fokus ATP');
  assert.strictEqual(findings[0].action, undefined);

});

console.log(`\n==========================================`);
console.log(`TOTAL PASSED: ${totalPassed}`);
console.log(`TOTAL FAILED: ${totalFailed}`);
console.log(`==========================================`);

if (totalFailed > 0) {
  process.exit(1);
}
