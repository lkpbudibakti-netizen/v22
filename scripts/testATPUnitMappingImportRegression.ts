import assert from 'node:assert';
import * as XLSX from 'xlsx';
import {
  validateAndBuildATPUnitMappings,
  validateAndUpdateBabTitlesOnly,
  parseBabMateriXlsx,
  createBabMateriTemplateWorkbook,
  RawBabMateriRow,
} from '../src/services/atpUnitMappingImportService';
import { validateATPDataWorkflow } from '../src/services/cpWorkflowService';

console.log('=== RUNNING TESTS: ATP Unit & Material Import Service ===');

// ==========================================
// CASE A: 6 Bab, 17 Materi, strictly empty lineage
// ==========================================
console.log('Testing Case A: 6 Bab, 17 Materi with empty lineage...');
{
  const rows: RawBabMateriRow[] = [
    // Bab 1 (3 materials)
    { babOrder: 1, babTitle: 'Bab 1: Serunya Bergerak di Tempat', materialOrder: 1, materialTitle: 'Gerakan menekuk tubuh' },
    { babOrder: 1, babTitle: 'Bab 1: Serunya Bergerak di Tempat', materialOrder: 2, materialTitle: 'Gerakan memilin dan memutar tubuh' },
    { babOrder: 1, babTitle: 'Bab 1: Serunya Bergerak di Tempat', materialOrder: 3, materialTitle: 'Gerakan mengayun dan membungkuk' },
    // Bab 2 (3 materials)
    { babOrder: 2, babTitle: 'Bab 2: Gerak Berpindah Tempat', materialOrder: 1, materialTitle: 'Merangkak' },
    { babOrder: 2, babTitle: 'Bab 2: Gerak Berpindah Tempat', materialOrder: 2, materialTitle: 'Berjalan dan berlari' },
    { babOrder: 2, babTitle: 'Bab 2: Gerak Berpindah Tempat', materialOrder: 3, materialTitle: 'Melompat dan meloncat' },
    // Bab 3 (3 materials)
    { babOrder: 3, babTitle: 'Bab 3: Gerak Manipulatif Dasar', materialOrder: 1, materialTitle: 'Melempar bola' },
    { babOrder: 3, babTitle: 'Bab 3: Gerak Manipulatif Dasar', materialOrder: 2, materialTitle: 'Menangkap bola' },
    { babOrder: 3, babTitle: 'Bab 3: Gerak Manipulatif Dasar', materialOrder: 3, materialTitle: 'Menendang bola' },
    // Bab 4 (3 materials)
    { babOrder: 4, babTitle: 'Bab 4: Kebugaran Jasmani Anak', materialOrder: 1, materialTitle: 'Latihan kelenturan' },
    { babOrder: 4, babTitle: 'Bab 4: Kebugaran Jasmani Anak', materialOrder: 2, materialTitle: 'Latihan kekuatan otot' },
    { babOrder: 4, babTitle: 'Bab 4: Kebugaran Jasmani Anak', materialOrder: 3, materialTitle: 'Latihan daya tahan' },
    // Bab 5 (3 materials)
    { babOrder: 5, babTitle: 'Bab 5: Senam dan Irama', materialOrder: 1, materialTitle: 'Pola langkah senam irama' },
    { babOrder: 5, babTitle: 'Bab 5: Senam dan Irama', materialOrder: 2, materialTitle: 'Ayunan lengan berirama' },
    { babOrder: 5, babTitle: 'Bab 5: Senam dan Irama', materialOrder: 3, materialTitle: 'Kombinasi gerak berirama' },
    // Bab 6 (2 materials)
    { babOrder: 6, babTitle: 'Bab 6: Pola Hidup Bersih dan Sehat', materialOrder: 1, materialTitle: 'Kebersihan diri dan pakaian' },
    { babOrder: 6, babTitle: 'Bab 6: Pola Hidup Bersih dan Sehat', materialOrder: 2, materialTitle: 'Makanan bergizi seimbang' },
  ];

  const result = validateAndBuildATPUnitMappings(rows);

  assert.strictEqual(result.success, true, 'Result success must be true');
  assert.ok(result.units, 'Units must be defined');
  assert.strictEqual(result.units.length, 6, 'Total units (Bab) must be 6');
  assert.strictEqual(result.stats?.totalBabs, 6, 'stats.totalBabs must be 6');
  assert.strictEqual(result.stats?.totalMaterials, 17, 'stats.totalMaterials must be 17');

  let totalMaterialsCount = 0;
  result.units.forEach((u, uIdx) => {
    assert.strictEqual(u.order, uIdx + 1, `Unit order must be ${uIdx + 1}`);
    assert.strictEqual(u.linkedAtpItemIds.length, 0, `Unit ${u.title} linkedAtpItemIds must be strictly empty`);
    assert.strictEqual(u.linkedTpIds.length, 0, `Unit ${u.title} linkedTpIds must be strictly empty`);
    assert.ok(Array.isArray(u.materials), 'Unit materials must be an array');
    
    u.materials?.forEach((m, mIdx) => {
      totalMaterialsCount++;
      assert.strictEqual(m.linkedAtpItemIds?.length, 0, `Material ${m.title} linkedAtpItemIds must be strictly empty`);
      assert.strictEqual(m.linkedTpIds?.length, 0, `Material ${m.title} linkedTpIds must be strictly empty`);
      assert.strictEqual(m.order, mIdx + 1, `Material order must be sorted ascending (${mIdx + 1})`);
    });
  });
  assert.strictEqual(totalMaterialsCount, 17, 'Sum of materials across all units must be 17');
  console.log('✅ Case A passed');
}

// ==========================================
// CASE B: materialTitle kosong -> ERROR, no partial result
// ==========================================
console.log('Testing Case B: materialTitle kosong -> ERROR, no partial result...');
{
  const rowsWithEmptyMaterial: RawBabMateriRow[] = [
    { babOrder: 1, babTitle: 'Bab 1', materialOrder: 1, materialTitle: 'Materi 1' },
    { babOrder: 1, babTitle: 'Bab 1', materialOrder: 2, materialTitle: '' }, // EMPTY
    { babOrder: 2, babTitle: 'Bab 2', materialOrder: 1, materialTitle: 'Materi 2.1' },
  ];

  const result = validateAndBuildATPUnitMappings(rowsWithEmptyMaterial);

  assert.strictEqual(result.success, false, 'Result success must be false when materialTitle is empty');
  assert.strictEqual(result.units, undefined, 'No partial result: units must be undefined');
  assert.ok(result.errors && result.errors.length > 0, 'Errors array must contain validation errors');
  assert.ok(
    result.errors.some((err) => err.includes('materialTitle')),
    'Error message must mention materialTitle'
  );
  console.log('✅ Case B passed');
}

// ==========================================
// CASE C: Duplicate babOrder=1, materialOrder=1 -> ERROR
// ==========================================
console.log('Testing Case C: Duplicate babOrder=1, materialOrder=1 -> ERROR...');
{
  const rowsWithDuplicateOrder: RawBabMateriRow[] = [
    { babOrder: 1, babTitle: 'Bab 1', materialOrder: 1, materialTitle: 'Materi 1.1' },
    { babOrder: 1, babTitle: 'Bab 1', materialOrder: 1, materialTitle: 'Materi 1.1 duplicate' }, // DUPLICATE COMBO
  ];

  const result = validateAndBuildATPUnitMappings(rowsWithDuplicateOrder);

  assert.strictEqual(result.success, false, 'Result success must be false on duplicate combination');
  assert.strictEqual(result.units, undefined, 'No partial result on duplicate');
  assert.ok(
    result.errors?.some((err) => err.toLowerCase().includes('duplikasi')),
    'Error message must indicate duplicate'
  );
  console.log('✅ Case C passed');
}

// ==========================================
// CASE D: Conflicting title: 1 | Bab A vs 1 | Bab B -> ERROR
// ==========================================
console.log('Testing Case D: Conflicting title (1 | Bab A vs 1 | Bab B) -> ERROR...');
{
  const rowsWithConflictingTitle: RawBabMateriRow[] = [
    { babOrder: 1, babTitle: 'Bab 1: Konsep A', materialOrder: 1, materialTitle: 'Materi 1' },
    { babOrder: 1, babTitle: 'Bab 1: Konsep B', materialOrder: 2, materialTitle: 'Materi 2' }, // CONFLICTING TITLE
  ];

  const result = validateAndBuildATPUnitMappings(rowsWithConflictingTitle);

  assert.strictEqual(result.success, false, 'Result success must be false on conflicting Bab title');
  assert.strictEqual(result.units, undefined, 'No partial result on conflicting title');
  assert.ok(
    result.errors?.some((err) => err.includes('bertentangan')),
    'Error message must indicate conflicting title'
  );
  console.log('✅ Case D passed');
}

// ==========================================
// CASE E: Full XLSX file parsing (buffer) with Sheet BAB_MATERI
// ==========================================
console.log('Testing Case E: Binary XLSX parsing via parseBabMateriXlsx...');
{
  const wsData = [
    ['babOrder', 'babTitle', 'materialOrder', 'materialTitle'],
    [1, 'Bab 1: Eksplorasi Gerak', 1, 'Gerak Lokomotor'],
    [1, 'Bab 1: Eksplorasi Gerak', 2, 'Gerak Non-lokomotor'],
    [2, 'Bab 2: Kebugaran', 1, 'Latihan Kelentukan'],
  ];

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'BAB_MATERI');

  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const result = parseBabMateriXlsx(buf);

  assert.strictEqual(result.success, true, 'XLSX parsing must succeed');
  assert.strictEqual(result.units?.length, 2, 'Must have 2 units');
  assert.strictEqual(result.stats?.totalMaterials, 3, 'Must have 3 materials');
  assert.strictEqual(result.units?.[0].title, 'Bab 1: Eksplorasi Gerak');
  assert.strictEqual(result.units?.[0].materials?.[0].title, 'Gerak Lokomotor');
  assert.strictEqual(result.units?.[0].linkedAtpItemIds.length, 0);
  assert.strictEqual(result.units?.[0].linkedTpIds.length, 0);
  console.log('✅ Case E passed');
}

// ==========================================
// CASE F: Missing sheet BAB_MATERI -> ERROR
// ==========================================
console.log('Testing Case F: Missing sheet BAB_MATERI -> ERROR...');
{
  const ws = XLSX.utils.aoa_to_sheet([['test', 123]]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'SHEET_LAIN');

  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const result = parseBabMateriXlsx(buf);

  assert.strictEqual(result.success, false, 'Should fail when sheet BAB_MATERI missing');
  assert.ok(result.errors?.some((err) => err.includes('BAB_MATERI')));
  console.log('✅ Case F passed');
}

// ==========================================
// CASE G: UPDATE_BAB_TITLES_ONLY mode (Success & Integrity)
// ==========================================
console.log('Testing Case G: UPDATE_BAB_TITLES_ONLY mode (Success & Integrity)...');
{
  const savedUnits = [
    {
      id: 'unit-orig-1',
      title: 'Bab 1: Judul Lama 1',
      order: 1,
      linkedAtpItemIds: ['atp-1', 'atp-2'],
      linkedTpIds: ['tp-1'],
      materials: [
        {
          id: 'mat-orig-1',
          title: 'Materi Asli 1.1',
          order: 1,
          linkedAtpItemIds: ['atp-1'],
          linkedTpIds: ['tp-1'],
        },
      ],
    },
    {
      id: 'unit-orig-2',
      title: 'Bab 2: Judul Lama 2',
      order: 2,
      linkedAtpItemIds: ['atp-3'],
      linkedTpIds: ['tp-2'],
      materials: [
        {
          id: 'mat-orig-2',
          title: 'Materi Asli 2.1',
          order: 1,
          linkedAtpItemIds: ['atp-3'],
          linkedTpIds: ['tp-2'],
        },
      ],
    },
  ];

  // Excel with empty material columns
  const titleOnlyRows: RawBabMateriRow[] = [
    { babOrder: 1, babTitle: 'Bab 1: Judul Baru Yang Diperbarui', materialOrder: '', materialTitle: '' },
    { babOrder: 2, babTitle: 'Bab 2: Judul Baru Permainan', materialOrder: null, materialTitle: undefined },
  ];

  const result = validateAndUpdateBabTitlesOnly(titleOnlyRows, savedUnits);

  assert.strictEqual(result.success, true, 'Result success must be true in title-only mode');
  assert.strictEqual(result.mode, 'UPDATE_BAB_TITLES_ONLY');
  assert.strictEqual(result.units?.length, 2, 'Must preserve unit count of 2');
  assert.strictEqual(result.stats?.titleChangesCount, 2, 'Should report 2 title changes');

  // Verify unit 1 updated title while keeping ID, materials, and lineage
  assert.strictEqual(result.units?.[0].id, 'unit-orig-1', 'Unit ID must be preserved');
  assert.strictEqual(result.units?.[0].order, 1, 'Unit order must be preserved');
  assert.strictEqual(result.units?.[0].title, 'Bab 1: Judul Baru Yang Diperbarui');
  assert.deepStrictEqual(result.units?.[0].linkedAtpItemIds, ['atp-1', 'atp-2'], 'Unit linkedAtpItemIds preserved');
  assert.deepStrictEqual(result.units?.[0].linkedTpIds, ['tp-1'], 'Unit linkedTpIds preserved');
  assert.strictEqual(result.units?.[0].materials.length, 1, 'Materials count preserved');
  assert.strictEqual(result.units?.[0].materials[0].id, 'mat-orig-1', 'Material ID preserved');
  assert.strictEqual(result.units?.[0].materials[0].title, 'Materi Asli 1.1', 'Material title preserved');
  assert.deepStrictEqual(result.units?.[0].materials[0].linkedAtpItemIds, ['atp-1']);
  assert.deepStrictEqual(result.units?.[0].materials[0].linkedTpIds, ['tp-1']);

  // Verify unit 2
  assert.strictEqual(result.units?.[1].id, 'unit-orig-2');
  assert.strictEqual(result.units?.[1].title, 'Bab 2: Judul Baru Permainan');
  assert.strictEqual(result.units?.[1].materials[0].title, 'Materi Asli 2.1');

  console.log('✅ Case G passed');
}

// ==========================================
// CASE H: Mismatched Bab count in UPDATE_BAB_TITLES_ONLY -> ERROR & Diagnosis
// ==========================================
console.log('Testing Case H: Mismatched Bab count in UPDATE_BAB_TITLES_ONLY -> ERROR & Diagnosis...');
{
  const savedUnits = [
    { id: 'u1', title: 'Bab 1', order: 1, linkedAtpItemIds: [], linkedTpIds: [], materials: [] },
    { id: 'u2', title: 'Bab 2', order: 2, linkedAtpItemIds: [], linkedTpIds: [], materials: [] },
    { id: 'u3', title: 'Bab 3', order: 3, linkedAtpItemIds: [], linkedTpIds: [], materials: [] },
  ];

  // Excel has only 2 Babs (count mismatch)
  const rowsWith2Babs: RawBabMateriRow[] = [
    { babOrder: 1, babTitle: 'Bab 1 Baru' },
    { babOrder: 2, babTitle: 'Bab 2 Baru' },
  ];

  const result = validateAndUpdateBabTitlesOnly(rowsWith2Babs, savedUnits);

  assert.strictEqual(result.success, false, 'Should fail when Bab count mismatches');
  assert.strictEqual(result.units, undefined, 'No partial units on error');
  assert.ok(result.errors?.some((err) => err.includes('Jumlah Bab dalam file Excel (2) tidak cocok dengan jumlah Bab tersimpan (3)')));

  console.log('✅ Case H passed');
}

// ==========================================
// CASE I: Empty babTitle or Conflicting Title in UPDATE_BAB_TITLES_ONLY -> ERROR
// ==========================================
console.log('Testing Case I: Empty babTitle or Conflicting Title in UPDATE_BAB_TITLES_ONLY -> ERROR...');
{
  const savedUnits = [
    { id: 'u1', title: 'Bab 1', order: 1, linkedAtpItemIds: [], linkedTpIds: [], materials: [] },
  ];

  // Empty title
  const rowsEmptyTitle: RawBabMateriRow[] = [
    { babOrder: 1, babTitle: '' },
  ];
  const resEmpty = validateAndUpdateBabTitlesOnly(rowsEmptyTitle, savedUnits);
  assert.strictEqual(resEmpty.success, false);
  assert.ok(resEmpty.errors?.some((err) => err.includes('babTitle')));

  // Conflicting title for babOrder 1
  const rowsConflict: RawBabMateriRow[] = [
    { babOrder: 1, babTitle: 'Judul X' },
    { babOrder: 1, babTitle: 'Judul Y' },
  ];
  const resConflict = validateAndUpdateBabTitlesOnly(rowsConflict, savedUnits);
  assert.strictEqual(resConflict.success, false);
  assert.ok(resConflict.errors?.some((err) => err.includes('bertentangan')));

  console.log('✅ Case I passed');
}

// ==========================================
// CASE J: parseBabMateriXlsx with mode 'UPDATE_BAB_TITLES_ONLY' via XLSX buffer
// ==========================================
console.log('Testing Case J: parseBabMateriXlsx with mode UPDATE_BAB_TITLES_ONLY...');
{
  const savedUnits = [
    { id: 'u1', title: 'Bab 1 Lama', order: 1, linkedAtpItemIds: ['a1'], linkedTpIds: ['t1'], materials: [] },
    { id: 'u2', title: 'Bab 2 Lama', order: 2, linkedAtpItemIds: ['a2'], linkedTpIds: ['t2'], materials: [] },
  ];

  const wsData = [
    ['babOrder', 'babTitle'],
    [1, 'Bab 1 Reborn'],
    [2, 'Bab 2 Reborn'],
  ];

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'BAB_MATERI');

  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const result = parseBabMateriXlsx(buf, 'UPDATE_BAB_TITLES_ONLY', savedUnits);

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.mode, 'UPDATE_BAB_TITLES_ONLY');
  assert.strictEqual(result.units?.[0].title, 'Bab 1 Reborn');
  assert.strictEqual(result.units?.[0].id, 'u1');
  assert.deepStrictEqual(result.units?.[0].linkedAtpItemIds, ['a1']);
  assert.strictEqual(result.units?.[1].title, 'Bab 2 Reborn');
  assert.strictEqual(result.units?.[1].id, 'u2');

  console.log('✅ Case J passed');
}

// ==========================================
// ROUND-TRIP TEMPLATE REGRESSION
// ==========================================
console.log('Testing Round-Trip Template Regression...');
{
  const templateWb = createBabMateriTemplateWorkbook();
  assert.strictEqual(templateWb.SheetNames.includes('BAB_MATERI'), true, 'Sheet name must be BAB_MATERI');
  const buf = XLSX.write(templateWb, { type: 'array', bookType: 'xlsx' });
  const result = parseBabMateriXlsx(buf);

  assert.strictEqual(result.success, true, 'Round-trip template parse success must be true');
  assert.strictEqual(result.units?.length, 2, 'Template must have 2 babs');
  assert.strictEqual(result.stats?.totalMaterials, 3, 'Template must have 3 materials total');
  
  result.units?.forEach((u) => {
    assert.strictEqual(u.linkedAtpItemIds.length, 0, 'Unit linkedAtpItemIds must be 0');
    assert.strictEqual(u.linkedTpIds.length, 0, 'Unit linkedTpIds must be 0');
    u.materials.forEach((m) => {
      assert.strictEqual(m.linkedAtpItemIds.length, 0, 'Material linkedAtpItemIds must be 0');
      assert.strictEqual(m.linkedTpIds.length, 0, 'Material linkedTpIds must be 0');
    });
  });
  console.log('✅ Round-Trip Template Regression passed');
}

// ==========================================
// READINESS REGRESSION (Cases A, B, C, D)
// ==========================================
console.log('Testing Readiness Regression (Cases A, B, C, D)...');
{
  const mockCP = {
    id: 'cp-001',
    academicSettingId: 'acad-001',
    workflowStatus: 'SIAP' as const,
    needsReview: false,
    updatedAt: '2026-01-01T00:00:00Z',
    generalDescription: 'Deskripsi umum capaian pembelajaran matematika.',
    elements: [{ id: 'elem-1', name: 'Bilangan', content: 'Memahami bilangan cacah.' }],
    source: { type: 'MERDEKA' as const, verificationStatus: 'VERIFIED', title: 'SK BSKAP' },
  };
  const mockCPAnalysis = {
    id: 'cpa-001',
    cpId: 'cp-001',
    academicSettingId: 'acad-001',
    workflowStatus: 'SIAP' as const,
    needsReview: false,
    updatedAt: '2026-01-01T00:00:00Z',
    items: [
      {
        id: 'ana-001',
        elementId: 'elem-1',
        elementName: 'Bilangan',
        cpText: 'Memahami bilangan cacah.',
        cpCompetence: 'Memahami',
        materialScope: 'Bilangan Cacah',
        suggestedTp: 'Peserta didik memahami bilangan cacah.',
        order: 1,
      }
    ],
    basedOnCpUpdatedAt: '2026-01-01T00:00:00Z',
  };
  const mockTP = {
    id: 'tp-data-001',
    academicSettingId: 'acad-001',
    cpId: 'cp-001',
    cpAnalysisId: 'cpa-001',
    academicYear: '2025/2026',
    subjectCode: 'Matematika',
    phase: 'B',
    workflowStatus: 'SIAP' as const,
    needsReview: false,
    updatedAt: '2026-01-02T00:00:00Z',
    items: [
      {
        id: 'tp-001',
        code: 'E1-BLG-01',
        elementName: 'Bilangan',
        statement: 'Peserta didik memahami bilangan cacah.',
        competence: 'Memahami',
        contentScope: 'Bilangan Cacah',
        cpAnalysisId: 'ana-001',
        cpAnalysisItemIds: ['ana-001'],
        order: 1,
      }
    ],
  };

  const mockAcademicSetting = {
    id: 'acad-001',
    profileId: 'prof-001',
    curriculumType: 'KURIKULUM_MERDEKA' as const,
    academicYear: '2025/2026',
    level: 'SD' as const,
    grade: 'Kelas 4',
    phase: 'B' as const,
    semester: '1 (Ganjil)' as const,
  };

  const baseATP = {
    id: 'atp-001',
    academicSettingId: 'acad-001',
    tpId: 'tp-data-001',
    tpDataId: 'tp-data-001',
    academicYear: '2025/2026',
    subjectCode: 'Matematika',
    phase: 'B' as const,
    workflowStatus: 'SIAP' as const,
    needsReview: false,
    basedOnTpUpdatedAt: mockTP.updatedAt,
    items: [
      {
        id: 'atp-item-1',
        stepNumber: 1,
        linkedTpIds: ['tp-001'],
        focus: 'Memahami konsep bilangan cacah',
        tpCode: 'E1-BLG-01',
        tpStatement: 'Peserta didik memahami bilangan cacah.',
        jp: 4,
        semester: '1 (Ganjil)',
      }
    ],
    updatedAt: '2026-01-03T00:00:00Z',
  };

  // Helper function
  function canImportBabMateri({
    atp,
    tp,
    academicSetting,
    cp,
    cpAnalysis,
}: {
    atp?: any;
    tp?: any;
    academicSetting?: any;
    cp?: any;
    cpAnalysis?: any;
  }): boolean {
    return validateATPDataWorkflow(
      atp,
      tp,
      academicSetting,
      cp,
      cpAnalysis
    ).isSiap;
  }

  // Case A — full canonical chain ready
  const resA = canImportBabMateri({
    atp: baseATP,
    tp: mockTP,
    academicSetting: mockAcademicSetting,
    cp: mockCP,
    cpAnalysis: mockCPAnalysis,
  });
  assert.strictEqual(resA, true, 'Case A: canImportBabMateri must be true');

  // Case B — TP stale against ATP
  const staleTP = {
    ...mockTP,
    updatedAt: '2026-01-05T00:00:00Z',
  };
  const resB = canImportBabMateri({
    atp: baseATP,
    tp: staleTP,
    academicSetting: mockAcademicSetting,
    cp: mockCP,
    cpAnalysis: mockCPAnalysis,
  });
  assert.strictEqual(resB, false, 'Case B: canImportBabMateri must be false when TP is newer than ATP lineage');

  // Case C — CP Analysis missing
  const resC = canImportBabMateri({
    atp: baseATP,
    tp: mockTP,
    academicSetting: mockAcademicSetting,
    cp: mockCP,
    cpAnalysis: undefined,
  });
  assert.strictEqual(resC, false, 'Case C: canImportBabMateri must be false when cpAnalysis is missing');

  // Case D — ATP needsReview
  const reviewedATP = {
    ...baseATP,
    needsReview: true,
  };
  const resD = canImportBabMateri({
    atp: reviewedATP,
    tp: mockTP,
    academicSetting: mockAcademicSetting,
    cp: mockCP,
    cpAnalysis: mockCPAnalysis,
  });
  assert.strictEqual(resD, false, 'Case D: canImportBabMateri must be false when ATP needsReview is true');

  // Case E — ATP status not SIAP
  const draftATP = {
    ...baseATP,
    workflowStatus: 'DRAFT' as const,
  };
  const resE = canImportBabMateri({
    atp: draftATP,
    tp: mockTP,
    academicSetting: mockAcademicSetting,
    cp: mockCP,
    cpAnalysis: mockCPAnalysis,
  });
  assert.strictEqual(resE, false, 'Case E: canImportBabMateri must be false when ATP status is not SIAP');

  console.log('✅ Readiness Regression (Cases A, B, C, D, E) passed');
}

console.log('=== ALL REGRESSION TESTS PASSED SUCCESSFULLY ===');
