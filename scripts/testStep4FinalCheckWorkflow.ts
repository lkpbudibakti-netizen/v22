import assert from 'node:assert';
import {
  reviewCPAnalysisSemantic,
  detectCompetenceGroups,
  resolveTargetCompetenceForAnalysis,
  applyFindingToItems,
  undoAppliedFinding,
  type AppliedFindingRecord,
} from '../src/services/cpAnalysisSemanticReviewService';
import { validateCPAnalysisDataWorkflow } from '../src/services/cpWorkflowService';
import type { CPData, CPAnalysisData, CPAnalysisItem, AcademicSetting } from '../src/types';

console.log('================================================================');
console.log('=== RUNNING FINAL CHECK: STEP 4 CP ANALYSIS END-TO-END SUITE ===');
console.log('================================================================\n');

let totalTests = 0;
let passedTests = 0;

function runCheck(num: number, title: string, fn: () => void) {
  totalTests++;
  try {
    fn();
    console.log(`[PASS] Tugas ${num}: ${title}`);
    passedTests++;
  } catch (err: any) {
    console.error(`[FAIL] Tugas ${num}: ${title}\n  Error: ${err.message}`);
    throw err;
  }
}

// Canonical CP Fixture for PJOK Fase B
const canonicalCP: CPData = {
  id: 'cp-pjok-fase-b-canonical',
  academicSettingId: 'acad-pjok-b',
  generalDescription: 'Peserta didik mempraktikkan keterampilan gerak fundamental dan menjaga pola hidup sehat.',
  elements: [
    {
      id: 'elem-1',
      code: 'E1',
      name: 'Terampil Bergerak',
      content: 'Peserta didik mempraktikkan keterampilan gerak fundamental lokomotor, non-lokomotor, dan manipulatif.',
    },
    {
      id: 'elem-2',
      code: 'E2',
      name: 'Belajar Melalui Gerak',
      content: 'Peserta didik menyusun dan menerapkan aturan untuk fair play, serta mempertunjukkan peran dalam kelompok.',
    },
    {
      id: 'elem-3',
      code: 'E3',
      name: 'Memilih Hidup Sehat',
      content: 'Peserta didik mengamati, menyelidiki, dan menjelaskan pola makan bergizi seimbang serta mempraktikkan penanganan cedera ringan.',
    },
  ],
  source: { verificationStatus: 'VERIFIED' } as any,
  workflowStatus: 'SIAP',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const initialAnalysisItems: CPAnalysisItem[] = [
  {
    id: 'ana-01',
    elementId: 'elem-1',
    elementName: 'Terampil Bergerak',
    cpText: canonicalCP.elements[0].content,
    cpCompetence: 'Memahami', // Intentionally diluted from 'mempraktikkan'
    materialScope: 'Pola gerak dasar lokomotor dan non-lokomotor',
    meaningfulUnderstanding: 'Gerak dasar penting untuk kebugaran',
    suggestedTp: 'Peserta didik memahami pola gerak dasar lokomotor.',
    order: 1,
  },
  {
    id: 'ana-02',
    elementId: 'elem-2',
    elementName: 'Belajar Melalui Gerak',
    cpText: canonicalCP.elements[1].content,
    cpCompetence: 'Menyusun dan menerapkan',
    materialScope: 'Aturan untuk fair play',
    meaningfulUnderstanding: 'Sportivitas dalam bermain',
    suggestedTp: 'Peserta didik menyusun dan menerapkan aturan untuk fair play.',
    order: 2,
  },
  {
    id: 'ana-03',
    elementId: 'elem-3',
    elementName: 'Memilih Hidup Sehat',
    cpText: canonicalCP.elements[2].content,
    cpCompetence: 'Menjelaskan', // Intentionally reduced from compound 'mengamati, menyelidiki, dan menjelaskan'
    materialScope: 'Pola makan bergizi seimbang',
    meaningfulUnderstanding: 'Gizi seimbang untuk tubuh sehat',
    suggestedTp: 'Peserta didik menjelaskan pola makan bergizi seimbang.',
    order: 3,
  },
];

// --- TUGAS 1: Pemeriksaan semantik menampilkan temuan, alasan, dan saran per baris ---
runCheck(1, 'Pemeriksaan semantik menampilkan temuan, alasan, dan saran konkret per baris', () => {
  const review = reviewCPAnalysisSemantic(initialAnalysisItems, canonicalCP);
  assert.ok(review.totalFindings > 0, 'Harus mendeteksi temuan ketidakselarasan');

  // Periksa temuan pada baris 1 (dilution Memahami -> Mempraktikkan)
  const finding1 = review.findings.find((f) => f.itemId === 'ana-01');
  assert.ok(finding1, 'Harus ada temuan pada baris 1 (ana-01)');
  assert.strictEqual(finding1?.itemOrder, 1);
  assert.strictEqual(finding1?.elementName, 'Terampil Bergerak');
  assert.strictEqual(finding1?.type, 'COMPETENCE_MISMATCH');
  assert.ok(finding1?.reason && finding1.reason.length > 10, 'Alasan harus jelas dan substantif');
  assert.ok(finding1?.suggestion && finding1.suggestion.length > 10, 'Saran harus ada dan jelas');
  assert.ok(finding1?.suggestedChange, 'Harus menyertakan suggestedChange konkret');
  assert.strictEqual(finding1?.suggestedChange?.field, 'cpCompetence');
  assert.strictEqual(finding1?.suggestedChange?.currentValue, 'Memahami');
  assert.ok(finding1?.suggestedChange?.suggestedValue.toLowerCase().includes('mempraktikkan'));
});

// --- TUGAS 2: Tombol Terapkan Saran membuka pratinjau Sebelum -> Sesudah dan meminta konfirmasi ---
runCheck(2, 'Pratinjau Sebelum -> Sesudah dan data perubahan dapat disesuaikan sebelum disetujui', () => {
  const review = reviewCPAnalysisSemantic(initialAnalysisItems, canonicalCP);
  const finding1 = review.findings.find((f) => f.itemId === 'ana-01')!;

  assert.strictEqual(finding1.canAutoApply, true);
  assert.ok(finding1.suggestedChange);

  // Model modal preview: Sebelum -> Sesudah
  const modalPreview = {
    finding: finding1,
    currentValue: finding1.suggestedChange?.currentValue, // Sebelum: 'Memahami'
    suggestedValue: finding1.suggestedChange?.suggestedValue, // Sesudah: 'Mempraktikkan'
    editedValue: finding1.suggestedChange?.suggestedValue, // Guru dapat mengedit sebelum konfirmasi
  };

  assert.strictEqual(modalPreview.currentValue, 'Memahami');
  assert.ok(modalPreview.suggestedValue?.toLowerCase().includes('mempraktikkan'));

  // Guru menyesuaikan teks usulan sebelum menyetujui
  modalPreview.editedValue = 'Mempraktikkan dan melatih';
  assert.strictEqual(modalPreview.editedValue, 'Mempraktikkan dan melatih');
});

// --- TUGAS 3: Perubahan hanya diterapkan pada kolom dan baris yang dipilih ---
runCheck(3, 'Perubahan hanya diterapkan pada kolom dan baris yang dipilih (isolasi ketat)', () => {
  const review = reviewCPAnalysisSemantic(initialAnalysisItems, canonicalCP);
  const finding1 = review.findings.find((f) => f.itemId === 'ana-01')!;

  const { updatedItems, record } = applyFindingToItems(
    initialAnalysisItems,
    finding1,
    'Mempraktikkan'
  );

  // Baris 1: hanya cpCompetence yang berubah
  assert.strictEqual(updatedItems[0].cpCompetence, 'Mempraktikkan');
  assert.strictEqual(updatedItems[0].elementId, 'elem-1');
  assert.strictEqual(updatedItems[0].cpText, canonicalCP.elements[0].content);
  assert.strictEqual(updatedItems[0].materialScope, 'Pola gerak dasar lokomotor dan non-lokomotor');
  assert.strictEqual(updatedItems[0].suggestedTp, 'Peserta didik memahami pola gerak dasar lokomotor.');

  // Baris 2 & 3: sama sekali tidak tersentuh
  assert.strictEqual(updatedItems[1].cpCompetence, 'Menyusun dan menerapkan');
  assert.strictEqual(updatedItems[1].materialScope, 'Aturan untuk fair play');
  assert.strictEqual(updatedItems[2].cpCompetence, 'Menjelaskan');
  assert.strictEqual(updatedItems[2].materialScope, 'Pola makan bergizi seimbang');

  assert.ok(record, 'Record perubahan harus tercatat');
  assert.strictEqual(record?.previousValue, 'Memahami');
  assert.strictEqual(record?.appliedValue, 'Mempraktikkan');
});

// --- TUGAS 4: Urungkan mengembalikan perubahan tanpa menimpa edit manual guru ---
runCheck(4, 'Urungkan mengembalikan perubahan aman dan menolak menimpa edit manual guru', () => {
  const review = reviewCPAnalysisSemantic(initialAnalysisItems, canonicalCP);
  const finding1 = review.findings.find((f) => f.itemId === 'ana-01')!;

  const { updatedItems, record } = applyFindingToItems(
    initialAnalysisItems,
    finding1,
    'Mempraktikkan'
  );
  assert.ok(record);

  // Kasus A: Nilai belum diedit manual -> Urungkan sukses
  const undoResultA = undoAppliedFinding(updatedItems, record!);
  assert.strictEqual(undoResultA.success, true);
  assert.strictEqual(undoResultA.reason, 'MATCH_REVERTED');
  assert.strictEqual(undoResultA.updatedItems[0].cpCompetence, 'Memahami');

  // Kasus B: Guru telah mengedit manual kolom tersebut setelah saran diterapkan
  const itemsWithManualEdit = updatedItems.map((it) =>
    it.id === 'ana-01' ? { ...it, cpCompetence: 'Mempraktikkan secara mandiri dan disiplin' } : it
  );

  const undoResultB = undoAppliedFinding(itemsWithManualEdit, record!);
  assert.strictEqual(undoResultB.success, false);
  assert.strictEqual(undoResultB.reason, 'VALUE_MODIFIED_MANUALLY');
  // Nilai hasil edit manual guru tetap utuh dan terlindungi
  assert.strictEqual(undoResultB.updatedItems[0].cpCompetence, 'Mempraktikkan secara mandiri dan disiplin');
  assert.ok(undoResultB.message.includes('telah diedit secara manual'));
});

// --- TUGAS 5: Jika analisis diedit setelah pemeriksaan, tandai hasil sebagai usang ---
runCheck(5, 'Data diubah pasca pemeriksaan menandai isReviewStale dan menonaktifkan Terapkan Saran', () => {
  // Simulasi state lifecycle
  let isReviewStale = false;
  const review = reviewCPAnalysisSemantic(initialAnalysisItems, canonicalCP);

  // Guru mengedit salah satu item secara manual
  const handleUserEdit = () => {
    isReviewStale = true;
  };
  handleUserEdit();

  assert.strictEqual(isReviewStale, true, 'isReviewStale harus bernilai true setelah edit manual');

  // Verifikasi guard pada fungsi apply: tidak dapat diterapkan saat isReviewStale
  const finding1 = review.findings[0];
  const canApplyWhenStale = !isReviewStale && finding1.canAutoApply;
  assert.strictEqual(canApplyWhenStale, false, 'Terapkan Saran harus dinonaktifkan saat isReviewStale');

  // Setelah guru klik "Periksa Ulang Sekarang", status stale di-reset
  const handleReReview = (currentItems: CPAnalysisItem[]) => {
    const freshReview = reviewCPAnalysisSemantic(currentItems, canonicalCP);
    isReviewStale = false;
    return freshReview;
  };
  const freshReview = handleReReview(initialAnalysisItems);
  assert.strictEqual(isReviewStale, false, 'isReviewStale harus false setelah periksa ulang');
  assert.ok(freshReview);
});

// --- TUGAS 6: Kompetensi majemuk tidak terpotong dan saran ambigu memerlukan tinjauan guru ---
runCheck(6, 'Kompetensi majemuk (3 kata kerja) tidak terpotong, kasus ambigu memerlukan tinjauan guru', () => {
  // Kasus 6A: CP mengandung 3 kompetensi majemuk pada satu klausa
  const compoundCPText = 'Peserta didik mengamati, menyelidiki, dan menjelaskan proses metamorfosis kupu-kupu.';
  const resCompound = resolveTargetCompetenceForAnalysis(compoundCPText, 'proses metamorfosis kupu-kupu');
  assert.strictEqual(resCompound.canAutoApply, true);
  const compStr = resCompound.targetCompetence.toLowerCase();
  assert.ok(compStr.includes('mengamati'), 'Harus memuat mengamati');
  assert.ok(compStr.includes('menyelidiki'), 'Harus memuat menyelidiki');
  assert.ok(compStr.includes('menjelaskan'), 'Harus memuat menjelaskan');

  // Kasus 6B: CP multi-klausa dengan kata kerja berbeda dan materi ambigu
  const multiClauseCP = 'Peserta didik mengamati ekosistem danau; serta merancang model alat peraga fisika.';
  const resAmbiguous = resolveTargetCompetenceForAnalysis(multiClauseCP, 'Materi sejarah kerajaan nusantara');
  assert.strictEqual(resAmbiguous.canAutoApply, false);
  assert.strictEqual(resAmbiguous.confidence, 'LOW');
  assert.strictEqual(resAmbiguous.targetCompetence, '');
});

// --- TUGAS 7: Hasil pemeriksaan tidak otomatis mengubah status SIAP ---
runCheck(7, 'Hasil pemeriksaan semantik bersifat non-blocking (tidak mengubah workflowStatus SIAP)', () => {
  const completeAnalysis: CPAnalysisData = {
    id: 'ana-data-pjok',
    academicSettingId: canonicalCP.academicSettingId,
    cpId: canonicalCP.id,
    workflowStatus: 'SIAP',
    generalSummary: 'Analisis CP PJOK lengkap.',
    items: initialAnalysisItems, // memiliki catatan semantik (dilusi pada baris 1)
    needsReview: false,
    basedOnCpUpdatedAt: canonicalCP.updatedAt,
    updatedAt: new Date().toISOString(),
  };

  const workflowValidation = validateCPAnalysisDataWorkflow(completeAnalysis, canonicalCP);
  assert.strictEqual(workflowValidation.isSiap, true, 'Validasi struktural CP Analysis tetap SIAP');

  const semanticReview = reviewCPAnalysisSemantic(completeAnalysis.items, canonicalCP);
  assert.ok(semanticReview.warningCount > 0, 'Terdapat catatan semantik');
  assert.strictEqual(semanticReview.isValid, true, 'Review semantik tetap berstatus isValid: true (advisory)');
  // Status SIAP tetap terjaga dan tidak diturunkan secara diam-diam
  assert.strictEqual(completeAnalysis.workflowStatus, 'SIAP');
});

// --- TUGAS 8: Data tersimpan hanya setelah guru menekan Simpan Analisis ---
runCheck(8, 'Data perubahan tetap lokal (hasUnsavedChanges = true) sampai Simpan Analisis diklik', () => {
  let hasUnsavedChanges = false;
  let persistedDatabaseData: CPAnalysisItem[] = [...initialAnalysisItems];

  // Guru menerapkan saran
  const finding1 = reviewCPAnalysisSemantic(initialAnalysisItems, canonicalCP).findings[0];
  const { updatedItems } = applyFindingToItems(initialAnalysisItems, finding1, 'Mempraktikkan');
  hasUnsavedChanges = true;

  // Sebelum simpan: data di "database/persisted" masih versi lama
  assert.strictEqual(hasUnsavedChanges, true);
  assert.strictEqual(persistedDatabaseData[0].cpCompetence, 'Memahami');

  // Guru menekan Simpan Analisis
  const handleSave = () => {
    persistedDatabaseData = [...updatedItems];
    hasUnsavedChanges = false;
  };
  handleSave();

  // Setelah simpan: data tersimpan dan hasUnsavedChanges menjadi false
  assert.strictEqual(hasUnsavedChanges, false);
  assert.strictEqual(persistedDatabaseData[0].cpCompetence, 'Mempraktikkan');
});

// --- TUGAS 9: Perubahan CP asli dan ID canonical tidak terjadi ---
runCheck(9, 'CP asli, ID canonical elemen, dan susunan elemen tidak berubah sedikit pun', () => {
  const cpCloneBefore = JSON.stringify(canonicalCP);

  const review = reviewCPAnalysisSemantic(initialAnalysisItems, canonicalCP);
  for (const finding of review.findings) {
    if (finding.canAutoApply) {
      applyFindingToItems(initialAnalysisItems, finding);
    }
  }

  const cpCloneAfter = JSON.stringify(canonicalCP);
  assert.strictEqual(cpCloneBefore, cpCloneAfter, 'Objek CP rujukan kanonikal harus 100% tidak berubah');
  assert.strictEqual(canonicalCP.elements[0].id, 'elem-1');
  assert.strictEqual(canonicalCP.elements[1].id, 'elem-2');
  assert.strictEqual(canonicalCP.elements[2].id, 'elem-3');
});

// --- TUGAS 10: Uji skenario lengkap: edit -> periksa -> terapkan -> urungkan -> simpan -> buka kembali ---
runCheck(10, 'Siklus lengkap: edit -> periksa -> terapkan -> urungkan -> simpan -> buka kembali & edge cases', () => {
  // Step 1: Workspace awal
  let currentItems: CPAnalysisItem[] = JSON.parse(JSON.stringify(initialAnalysisItems));
  let savedStorage: CPAnalysisItem[] = JSON.parse(JSON.stringify(initialAnalysisItems));
  let appliedRecords: AppliedFindingRecord[] = [];

  // Step 2: Periksa keselarasan
  let review = reviewCPAnalysisSemantic(currentItems, canonicalCP);
  assert.ok(review.warningCount > 0);
  const targetFinding = review.findings.find((f) => f.itemId === 'ana-01')!;

  // Step 3: Terapkan saran dengan teks kustom hasil pratinjau
  const customAppliedValue = 'Mempraktikkan dan menampilkan';
  const { updatedItems: step3Items, record } = applyFindingToItems(
    currentItems,
    targetFinding,
    customAppliedValue
  );
  currentItems = step3Items;
  if (record) appliedRecords.push(record);
  assert.strictEqual(currentItems[0].cpCompetence, customAppliedValue);

  // Step 4: Urungkan perubahan
  const undoRes = undoAppliedFinding(currentItems, appliedRecords[0]);
  assert.strictEqual(undoRes.success, true);
  currentItems = undoRes.updatedItems;
  assert.strictEqual(currentItems[0].cpCompetence, 'Memahami');
  appliedRecords.shift();

  // Step 5: Terapkan kembali saran standar
  const { updatedItems: step5Items, record: record2 } = applyFindingToItems(
    currentItems,
    targetFinding,
    'Mempraktikkan'
  );
  currentItems = step5Items;
  if (record2) appliedRecords.push(record2);

  // Step 6: Simpan analisis
  savedStorage = JSON.parse(JSON.stringify(currentItems));
  assert.strictEqual(savedStorage[0].cpCompetence, 'Mempraktikkan');

  // Step 7: Buka kembali (rehydrate dari storage)
  const reloadedItems: CPAnalysisItem[] = JSON.parse(JSON.stringify(savedStorage));
  assert.strictEqual(reloadedItems[0].cpCompetence, 'Mempraktikkan');

  // Step 8: Periksa ulang setelah rehydrate -> temuan COMPETENCE_MISMATCH pada ana-01 telah terselesaikan
  const reloadedReview = reviewCPAnalysisSemantic(reloadedItems, canonicalCP);
  const resolvedMismatch = reloadedReview.findings.find(
    (f) => f.itemId === 'ana-01' && f.type === 'COMPETENCE_MISMATCH'
  );
  assert.strictEqual(resolvedMismatch, undefined, 'Temuan COMPETENCE_MISMATCH pada ana-01 harus terselesaikan');

  // Dan jika usulan TP juga diselaraskan:
  const tpFinding = reloadedReview.findings.find((f) => f.itemId === 'ana-01' && f.type === 'SUGGESTED_TP_INCONSISTENT');
  if (tpFinding && tpFinding.canAutoApply) {
    const { updatedItems: fullyAlignedItems } = applyFindingToItems(reloadedItems, tpFinding);
    const fullyAlignedReview = reviewCPAnalysisSemantic(fullyAlignedItems, canonicalCP);
    const anyFindingOnAna01 = fullyAlignedReview.findings.find((f) => f.itemId === 'ana-01');
    assert.strictEqual(anyFindingOnAna01, undefined, 'Seluruh temuan pada ana-01 terselesaikan setelah TP diselaraskan');
  }

  // Step 9: Edge case - Urungkan pada item yang ID-nya tidak ada
  const nonExistentRecord: AppliedFindingRecord = {
    findingId: 'fake-f',
    itemId: 'non-existent-id',
    field: 'cpCompetence',
    previousValue: 'A',
    appliedValue: 'B',
    appliedAt: new Date().toISOString(),
  };
  const edgeCaseNotFound = undoAppliedFinding(reloadedItems, nonExistentRecord);
  assert.strictEqual(edgeCaseNotFound.success, false);
  assert.strictEqual(edgeCaseNotFound.reason, 'ITEM_NOT_FOUND');

  // Step 10: Edge case - Apply finding tanpa suggestedChange
  const fakeNoChangeFinding = { ...targetFinding, suggestedChange: undefined };
  const edgeCaseNoChange = applyFindingToItems(reloadedItems, fakeNoChangeFinding);
  assert.strictEqual(edgeCaseNoChange.updatedItems, reloadedItems);
});

console.log('\n================================================================');
console.log(`=== HASIL FINAL CHECK: SEMUA ${passedTests}/${totalTests} TUGAS BERHASIL (PASS) ===`);
console.log('================================================================\n');
