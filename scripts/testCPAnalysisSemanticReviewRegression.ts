import assert from 'node:assert';
import {
  reviewCPAnalysisSemantic,
  detectCompetenceGroups,
  resolveTargetCompetenceForAnalysis,
  extractTargetCompetenceFromCP,
  applyFindingToItems,
  undoAppliedFinding,
} from '../src/services/cpAnalysisSemanticReviewService';
import type { CPData, CPAnalysisItem } from '../src/types';

console.log('=== RUNNING REGRESSION: CP ANALYSIS SEMANTIC REVIEW SERVICE ===\n');

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

const sampleCanonicalCP: CPData = {
  id: 'cp-pjok-fase-b',
  academicSettingId: 'acad-pjok-b',
  generalDescription: 'Peserta didik mempraktikkan keterampilan gerak fundamental dan menerapkan pola hidup sehat.',
  elements: [
    {
      id: 'elem-1',
      code: 'E1',
      name: 'Terampil Bergerak',
      content: 'Peserta didik mempraktikkan keterampilan gerak fundamental lokomotor, non-lokomotor, dan manipulatif dalam berbagai permainan.',
    },
    {
      id: 'elem-2',
      code: 'E2',
      name: 'Belajar Melalui Gerak',
      content: 'Peserta didik menerapkan perilaku fair play dan menunjukkan kerjasama dalam aktivitas jasmani kelompok.',
    },
    {
      id: 'elem-3',
      code: 'E3',
      name: 'Memilih Hidup Sehat',
      content: 'Peserta didik mengeksplorasi pola makan sehat bergizi seimbang dan mempraktikkan penanganan cedera ringan.',
    },
  ],
  workflowStatus: 'SIAP',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

// 1. Competence detection
runTest('1. detectCompetenceGroups correctly identifies single and compound verbs', () => {
  const comp1 = detectCompetenceGroups('Mempraktikkan gerak dasar');
  assert.ok(comp1.includes('practice'), 'Should detect practice');

  const comp2 = detectCompetenceGroups('Memahami dan menjelaskan konsep');
  assert.ok(comp2.includes('understand'), 'Should detect understand');

  const comp3 = detectCompetenceGroups('Menganalisis dan menyusun strategi');
  assert.ok(comp3.includes('analyze'), 'Should detect analyze');
  assert.ok(comp3.includes('create'), 'Should detect create');

  const comp4 = detectCompetenceGroups('Mengeksplorasi pola makan sehat');
  assert.ok(comp4.includes('explore'), 'Should detect explore');
});

// 2. Competence mismatch detection: practice -> understand dilution
runTest('2. COMPETENCE_MISMATCH: flags downward dilution from practical skill to theoretical understanding', () => {
  const items: CPAnalysisItem[] = [
    {
      id: 'item-diluted',
      elementId: 'elem-1',
      elementName: 'Terampil Bergerak',
      cpText: sampleCanonicalCP.elements[0].content,
      cpCompetence: 'Memahami', // CP requires 'mempraktikkan'
      materialScope: 'keterampilan gerak fundamental lokomotor, non-lokomotor, manipulatif',
      order: 1,
    },
    {
      id: 'item-2',
      elementId: 'elem-2',
      elementName: 'Belajar Melalui Gerak',
      cpText: sampleCanonicalCP.elements[1].content,
      cpCompetence: 'Menerapkan',
      materialScope: 'perilaku fair play dan kerjasama',
      order: 2,
    },
    {
      id: 'item-3',
      elementId: 'elem-3',
      elementName: 'Memilih Hidup Sehat',
      cpText: sampleCanonicalCP.elements[2].content,
      cpCompetence: 'Mengeksplorasi dan mempraktikkan',
      materialScope: 'pola makan sehat bergizi seimbang dan penanganan cedera ringan',
      order: 3,
    },
  ];

  const result = reviewCPAnalysisSemantic(items, sampleCanonicalCP);
  assert.ok(result.totalFindings > 0, 'Should flag findings');
  const mismatchFinding = result.findings.find((f) => f.type === 'COMPETENCE_MISMATCH');
  assert.ok(mismatchFinding, 'Must identify COMPETENCE_MISMATCH');
  assert.strictEqual(mismatchFinding?.itemId, 'item-diluted');
  assert.strictEqual(mismatchFinding?.severity, 'WARNING');
  assert.strictEqual(mismatchFinding?.confidence, 'HIGH');
  assert.ok(mismatchFinding?.reason.includes('praktik'), 'Reason must mention practical skill dilution');
});

// 3. Unsupported material addition detection
runTest('3. UNSUPPORTED_ADDITION: flags completely ungrounded alien topics', () => {
  const items: CPAnalysisItem[] = [
    {
      id: 'item-alien',
      elementId: 'elem-1',
      elementName: 'Terampil Bergerak',
      cpText: sampleCanonicalCP.elements[0].content,
      cpCompetence: 'Mempraktikkan',
      materialScope: 'pemrograman python dan algoritma kecerdasan buatan', // Alien topic
      order: 1,
    },
    {
      id: 'item-2',
      elementId: 'elem-2',
      elementName: 'Belajar Melalui Gerak',
      cpText: sampleCanonicalCP.elements[1].content,
      cpCompetence: 'Menerapkan',
      materialScope: 'perilaku fair play dan kerjasama',
      order: 2,
    },
    {
      id: 'item-3',
      elementId: 'elem-3',
      elementName: 'Memilih Hidup Sehat',
      cpText: sampleCanonicalCP.elements[2].content,
      cpCompetence: 'Mengeksplorasi dan mempraktikkan',
      materialScope: 'pola makan sehat bergizi seimbang dan penanganan cedera ringan',
      order: 3,
    },
  ];

  const result = reviewCPAnalysisSemantic(items, sampleCanonicalCP);
  const unsupportedFinding = result.findings.find((f) => f.type === 'UNSUPPORTED_ADDITION');
  assert.ok(unsupportedFinding, 'Must identify UNSUPPORTED_ADDITION');
  assert.strictEqual(unsupportedFinding?.itemId, 'item-alien');
  assert.strictEqual(unsupportedFinding?.severity, 'WARNING');
});

// 4. Missing element detection
runTest('4. MATERIAL_MISSING: flags unanalyzed canonical element', () => {
  const items: CPAnalysisItem[] = [
    {
      id: 'item-1',
      elementId: 'elem-1',
      elementName: 'Terampil Bergerak',
      cpText: sampleCanonicalCP.elements[0].content,
      cpCompetence: 'Mempraktikkan',
      materialScope: 'keterampilan gerak fundamental lokomotor, non-lokomotor, manipulatif',
      order: 1,
    },
    // elem-2 and elem-3 omitted
  ];

  const result = reviewCPAnalysisSemantic(items, sampleCanonicalCP);
  const missingElemFindings = result.findings.filter((f) => f.type === 'MATERIAL_MISSING');
  assert.ok(missingElemFindings.length >= 2, 'Must flag missing elements 2 and 3');
  assert.ok(missingElemFindings.some((f) => f.elementId === 'elem-2'));
  assert.ok(missingElemFindings.some((f) => f.elementId === 'elem-3'));
});

// 5. Inconsistent suggested TP detection
runTest('5. SUGGESTED_TP_INCONSISTENT: flags draft TP that contradicts analysis row', () => {
  const items: CPAnalysisItem[] = [
    {
      id: 'item-inconsistent-tp',
      elementId: 'elem-1',
      elementName: 'Terampil Bergerak',
      cpText: sampleCanonicalCP.elements[0].content,
      cpCompetence: 'Mempraktikkan',
      materialScope: 'keterampilan gerak fundamental lokomotor dan non-lokomotor',
      suggestedTp: 'Peserta didik menghafal teori sejarah senam lantai kuno.', // Contradicts competence and material
      order: 1,
    },
    {
      id: 'item-2',
      elementId: 'elem-2',
      elementName: 'Belajar Melalui Gerak',
      cpText: sampleCanonicalCP.elements[1].content,
      cpCompetence: 'Menerapkan',
      materialScope: 'perilaku fair play dan kerjasama kelompok',
      order: 2,
    },
    {
      id: 'item-3',
      elementId: 'elem-3',
      elementName: 'Memilih Hidup Sehat',
      cpText: sampleCanonicalCP.elements[2].content,
      cpCompetence: 'Mengeksplorasi dan mempraktikkan',
      materialScope: 'pola makan sehat bergizi seimbang dan penanganan cedera ringan',
      order: 3,
    },
  ];

  const result = reviewCPAnalysisSemantic(items, sampleCanonicalCP);
  const tpFinding = result.findings.find((f) => f.type === 'SUGGESTED_TP_INCONSISTENT');
  assert.ok(tpFinding, 'Must identify SUGGESTED_TP_INCONSISTENT');
  assert.strictEqual(tpFinding?.itemId, 'item-inconsistent-tp');
});

// 6. Complete and well-aligned CP analysis passes with 0 warnings
runTest('6. PERFECT_ALIGNMENT: completely aligned CP analysis produces zero warnings', () => {
  const items: CPAnalysisItem[] = [
    {
      id: 'item-1',
      elementId: 'elem-1',
      elementName: 'Terampil Bergerak',
      cpText: sampleCanonicalCP.elements[0].content,
      cpCompetence: 'Mempraktikkan',
      materialScope: 'keterampilan gerak fundamental lokomotor non-lokomotor manipulatif berbagai permainan',
      suggestedTp: 'Peserta didik mempraktikkan keterampilan gerak fundamental lokomotor non-lokomotor manipulatif.',
      order: 1,
    },
    {
      id: 'item-2',
      elementId: 'elem-2',
      elementName: 'Belajar Melalui Gerak',
      cpText: sampleCanonicalCP.elements[1].content,
      cpCompetence: 'Menerapkan',
      materialScope: 'perilaku fair play dan kerjasama kelompok aktivitas jasmani',
      suggestedTp: 'Peserta didik menerapkan perilaku fair play dan kerjasama kelompok dalam aktivitas jasmani.',
      order: 2,
    },
    {
      id: 'item-3',
      elementId: 'elem-3',
      elementName: 'Memilih Hidup Sehat',
      cpText: sampleCanonicalCP.elements[2].content,
      cpCompetence: 'Mengeksplorasi dan mempraktikkan',
      materialScope: 'pola makan sehat bergizi seimbang dan penanganan cedera ringan',
      suggestedTp: 'Peserta didik mengeksplorasi pola makan sehat bergizi seimbang dan mempraktikkan penanganan cedera ringan.',
      order: 3,
    },
  ];

  const result = reviewCPAnalysisSemantic(items, sampleCanonicalCP);
  assert.strictEqual(result.warningCount, 0, 'Warning count must be 0 for perfectly aligned analysis');
  assert.strictEqual(result.isValid, true, 'Review result must be valid');
  assert.ok(result.summaryMessage.includes('selaras secara semantik'), 'Summary message must confirm alignment');
});

// 7. Compound competence preservation: all action verbs preserved (not cut off at 2)
runTest('7. COMPOUND_COMPETENCE: preserves all verbs (e.g. 3 verbs) without truncation', () => {
  const cpText = 'Peserta didik mengamati, menyelidiki, dan menjelaskan daur hidup tumbuhan berbunga.';
  const res = resolveTargetCompetenceForAnalysis(cpText, 'daur hidup tumbuhan berbunga');
  assert.strictEqual(res.canAutoApply, true);
  const compLower = res.targetCompetence.toLowerCase();
  assert.ok(compLower.includes('mengamati'), 'Must include mengamati');
  assert.ok(compLower.includes('menyelidiki'), 'Must include menyelidiki');
  assert.ok(compLower.includes('menjelaskan'), 'Must include menjelaskan');
});

// 8. Tailored recommendations to row substance
runTest('8. SUBSTANCE_TAILORED: matches verbs from the specific clause corresponding to row materialScope', () => {
  const cpText = 'Peserta didik menyusun dan menerapkan aturan untuk fair play, serta mempertunjukkan peran dalam kelompok.';
  
  // Row 1: materialScope matches clause 1
  const res1 = resolveTargetCompetenceForAnalysis(cpText, 'Aturan untuk fair play');
  assert.strictEqual(res1.canAutoApply, true);
  const comp1Lower = res1.targetCompetence.toLowerCase();
  assert.ok(comp1Lower.includes('menyusun'), 'Must include menyusun');
  assert.ok(comp1Lower.includes('menerapkan'), 'Must include menerapkan');
  assert.ok(!comp1Lower.includes('mempertunjukkan'), 'Must NOT copy verb from unrelated clause');

  // Row 2: materialScope matches clause 2
  const res2 = resolveTargetCompetenceForAnalysis(cpText, 'Peran dalam kelompok');
  assert.strictEqual(res2.canAutoApply, true);
  const comp2Lower = res2.targetCompetence.toLowerCase();
  assert.ok(comp2Lower.includes('mempertunjukkan'), 'Must include mempertunjukkan');
  assert.ok(!comp2Lower.includes('menyusun'), 'Must NOT copy verbs from clause 1');
});

// 9. Ambiguous or uncertain competence triggers Perlu Tinjauan Guru (canAutoApply = false)
runTest('9. PERLU_TINJAUAN_GURU: triggers when competence cannot be ascertained with certainty', () => {
  const multiClauseCP = 'Peserta didik mengamati pertumbuhan tanaman; serta menghitung massa jenis larutan.';
  // Alien material that does not match any clause
  const res = resolveTargetCompetenceForAnalysis(multiClauseCP, 'Topik sejarah kerajaan kuno');
  assert.strictEqual(res.canAutoApply, false);
  assert.strictEqual(res.confidence, 'LOW');
});

// 10. applyFindingToItems isolation: updates ONLY target field on target row
runTest('10. APPLY_ISOLATION: modifies only target field of target item and preserves others', () => {
  const initialItems: CPAnalysisItem[] = [
    {
      id: 'row-1',
      elementId: 'elem-1',
      elementName: 'Terampil Bergerak',
      cpText: 'Peserta didik mempraktikkan keterampilan gerak fundamental.',
      cpCompetence: 'Memahami',
      materialScope: 'keterampilan gerak fundamental',
      order: 1,
    },
    {
      id: 'row-2',
      elementId: 'elem-2',
      elementName: 'Belajar Melalui Gerak',
      cpText: 'Peserta didik menerapkan fair play.',
      cpCompetence: 'Menerapkan',
      materialScope: 'fair play',
      order: 2,
    },
  ];

  const fakeFinding = {
    id: 'f-1',
    itemId: 'row-1',
    elementId: 'elem-1',
    type: 'COMPETENCE_MISMATCH' as const,
    severity: 'WARNING' as const,
    confidence: 'HIGH' as const,
    title: 'Mismatch',
    reason: 'Reduced',
    evidence: {},
    suggestion: 'Ubah ke Mempraktikkan',
    canAutoApply: true,
    suggestedChange: {
      field: 'cpCompetence' as const,
      fieldLabel: 'KKO',
      currentValue: 'Memahami',
      suggestedValue: 'Mempraktikkan',
    },
  };

  const { updatedItems, record } = applyFindingToItems(initialItems, fakeFinding, 'Mempraktikkan');
  assert.ok(record);
  assert.strictEqual(record?.previousValue, 'Memahami');
  assert.strictEqual(record?.appliedValue, 'Mempraktikkan');

  // Row 1 competence updated
  assert.strictEqual(updatedItems[0].cpCompetence, 'Mempraktikkan');
  // Row 1 other fields unchanged
  assert.strictEqual(updatedItems[0].elementId, 'elem-1');
  assert.strictEqual(updatedItems[0].cpText, 'Peserta didik mempraktikkan keterampilan gerak fundamental.');
  assert.strictEqual(updatedItems[0].materialScope, 'keterampilan gerak fundamental');

  // Row 2 completely untouched
  assert.strictEqual(updatedItems[1].cpCompetence, 'Menerapkan');
  assert.strictEqual(updatedItems[1].materialScope, 'fair play');
});

// 11. Safe Undo: reverts cleanly when value matches applied value
runTest('11. SAFE_UNDO_SUCCESS: reverts when current value still matches applied value', () => {
  const items: CPAnalysisItem[] = [
    {
      id: 'row-1',
      elementId: 'elem-1',
      elementName: 'E1',
      cpText: 'Teks',
      cpCompetence: 'Mempraktikkan', // was applied
      materialScope: 'Materi',
      order: 1,
    },
  ];

  const record = {
    findingId: 'f-1',
    itemId: 'row-1',
    field: 'cpCompetence' as const,
    previousValue: 'Memahami',
    appliedValue: 'Mempraktikkan',
    appliedAt: new Date().toISOString(),
  };

  const undoRes = undoAppliedFinding(items, record);
  assert.strictEqual(undoRes.success, true);
  assert.strictEqual(undoRes.reason, 'MATCH_REVERTED');
  assert.strictEqual(undoRes.updatedItems[0].cpCompetence, 'Memahami');
});

// 12. Safe Undo: blocked and preserves manual edit when teacher edited after applying
runTest('12. SAFE_UNDO_BLOCKED_ON_MANUAL_EDIT: refuses to overwrite teacher manual changes', () => {
  const items: CPAnalysisItem[] = [
    {
      id: 'row-1',
      elementId: 'elem-1',
      elementName: 'E1',
      cpText: 'Teks',
      cpCompetence: 'Mempraktikkan dan menguji secara mandiri', // edited manually by teacher!
      materialScope: 'Materi',
      order: 1,
    },
  ];

  const record = {
    findingId: 'f-1',
    itemId: 'row-1',
    field: 'cpCompetence' as const,
    previousValue: 'Memahami',
    appliedValue: 'Mempraktikkan', // was applied earlier
    appliedAt: new Date().toISOString(),
  };

  const undoRes = undoAppliedFinding(items, record);
  assert.strictEqual(undoRes.success, false);
  assert.strictEqual(undoRes.reason, 'VALUE_MODIFIED_MANUALLY');
  // Manual edit is preserved!
  assert.strictEqual(undoRes.updatedItems[0].cpCompetence, 'Mempraktikkan dan menguji secara mandiri');
  assert.ok(undoRes.message.includes('telah diedit secara manual'));
});

console.log(`\n========================================`);
console.log(`CP ANALYSIS SEMANTIC REVIEW: ALL ${passedTests}/${totalTests} TESTS PASSED`);
console.log(`========================================\n`);
