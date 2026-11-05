import assert from 'assert';
import { validateLearningPlan } from '../src/services/learningPlanService';
import type { AcademicSetting, TPData, ATPData, LearningPlan } from '../src/types';

/**
 * Regression Test: Learning Plan ATP Reference Validation
 * Verifies that validateLearningPlan() validates relevant ATP contracts at LearningPlan stage
 * without re-validating upstream CP / CPAnalysis provenance.
 */
function runRegression() {
  console.log('=== RUNNING LEARNING PLAN ATP REFERENCE REGRESSION SUITE ===\n');
  let passed = 0;
  let total = 0;

  function test(name: string, fn: () => void) {
    total++;
    try {
      fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}:`, err);
    }
  }

  const mockAcademicSetting: AcademicSetting = {
    id: 'setting-1',
    profileId: 'prof-1',
    subject: 'Informatika',
    level: 'SMP',
    grade: 'Kelas 7',
    phase: 'Fase D',
    semester: '1 (Ganjil)',
    academicYear: '2026/2027',
    curriculum: 'Kurikulum Merdeka',
    curriculumType: 'KURIKULUM_MERDEKA',
    updatedAt: new Date().toISOString(),
  };

  const mockTpData: TPData = {
    id: 'tpdata-1',
    academicSettingId: 'setting-1',
    updatedAt: new Date().toISOString(),
    workflowStatus: 'SIAP',
    needsReview: false,
    items: [
      {
        id: 'tp-1',
        order: 1,
        code: 'TP-1',
        statement: 'Memahami konsep dasar algoritma pemrograman.',
        competence: 'Memahami',
        contentScope: 'Algoritma',
        p3Dimensions: ['Bernalar Kritis'],
      },
    ],
  };

  const validAtpData: ATPData = {
    id: 'atpdata-1',
    academicSettingId: 'setting-1',
    updatedAt: new Date().toISOString(),
    totalJP: 4,
    workflowStatus: 'SIAP',
    needsReview: false,
    items: [
      {
        id: 'atp-1',
        stepNumber: 1,
        focus: 'Fokus algoritma dasar',
        linkedTpIds: ['tp-1'],
        tpId: 'tp-1',
        tpCode: 'TP-1',
        tpStatement: 'Memahami konsep dasar algoritma pemrograman.',
        materialScope: 'Algoritma',
        jp: 4,
        semester: 1,
      },
    ],
  };

  const baseValidPlan: LearningPlan = {
    id: 'plan-1',
    academicSettingId: 'setting-1',
    curriculumType: 'KURIKULUM_MERDEKA',
    sourceType: 'MANUAL',
    status: 'SIAP',
    confirmedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    topic: 'Dasar Algoritma',
    tpIds: ['tp-1'],
    atpItemIds: ['atp-1'],
    allocatedJP: 4,
    objectives: [
      {
        id: 'obj-1',
        tpId: 'tp-1',
        code: 'TP-1',
        statement: 'Memahami konsep dasar algoritma pemrograman.',
        materialScope: 'Algoritma',
      },
    ],
    learningExperiences: [
      {
        id: 'exp-1',
        phase: 'UNDERSTAND',
        description: 'Memahami konsep dasar logika algoritma',
        durationMinutes: 40,
        linkedTpIds: ['tp-1'],
      },
      {
        id: 'exp-2',
        phase: 'APPLY',
        description: 'Menerapkan logika algoritma dalam bagan alur',
        durationMinutes: 80,
        linkedTpIds: ['tp-1'],
      },
      {
        id: 'exp-3',
        phase: 'REFLECT',
        description: 'Merefleksi proses berpikir komputasional',
        durationMinutes: 40,
        linkedTpIds: ['tp-1'],
      },
    ],
    assessmentPlan: {
      initial: [
        { id: 'ass-1', type: 'INITIAL', description: 'Asesmen awal diagnostik', linkedTpIds: ['tp-1'] },
      ],
      formative: [
        { id: 'ass-2', type: 'FORMATIVE', description: 'Asesmen formatif latihan', linkedTpIds: ['tp-1'] },
      ],
      summative: [
        { id: 'ass-3', type: 'SUMMATIVE', description: 'Asesmen sumatif unit', linkedTpIds: ['tp-1'] },
      ],
    },
  };

  // Case A — valid upstream: TP SIAP + ATP SIAP + linkedTpIds valid + CPAnalysis tidak diberikan
  test('Case A: Valid upstream with CPAnalysis omitted should pass validateLearningPlan()', () => {
    const contextA = {
      academicSetting: mockAcademicSetting,
      tp: mockTpData,
      atp: validAtpData,
      // CPAnalysis deliberately omitted / undefined
    };

    const resA = validateLearningPlan(baseValidPlan, contextA);

    assert.strictEqual(
      resA.errors.some((e) => e.includes('ATP acuan tidak lolos validasi runtime terhadap TP kanonikal')),
      false,
      'Harus tidak ada error false negative "ATP acuan tidak lolos validasi runtime terhadap TP kanonikal"'
    );
    assert.strictEqual(resA.isValid, true, `Expected valid plan, but got errors: ${resA.errors.join('; ')}`);
    assert.strictEqual(resA.errors.length, 0);
  });

  // Case B — dangling linkedTpIds: ATP SIAP tetapi linkedTpIds menunjuk TP yang tidak ada
  test('Case B: ATP SIAP but linkedTpIds contains dangling TP reference should fail validateLearningPlan()', () => {
    const atpWithDanglingTp: ATPData = {
      ...validAtpData,
      items: [
        {
          ...validAtpData.items[0],
          linkedTpIds: ['tp-non-existent-999'],
        },
      ],
    };

    const contextB = {
      academicSetting: mockAcademicSetting,
      tp: mockTpData,
      atp: atpWithDanglingTp,
    };

    const resB = validateLearningPlan(baseValidPlan, contextB);

    assert.strictEqual(resB.isValid, false, 'Expected invalid plan when linkedTpIds has dangling reference');
    assert.strictEqual(
      resB.errors.some((e) => e.includes('Dangling Reference') || e.includes('tp-non-existent-999')),
      true,
      `Expected dangling TP reference error, got: ${resB.errors.join('; ')}`
    );
  });

  // Case C — ATP belum SIAP: workflowStatus !== 'SIAP' or needsReview === true
  test('Case C1: ATP with workflowStatus DRAFT should fail validateLearningPlan()', () => {
    const atpDraft: ATPData = {
      ...validAtpData,
      workflowStatus: 'DRAFT',
    };

    const contextC1 = {
      academicSetting: mockAcademicSetting,
      tp: mockTpData,
      atp: atpDraft,
    };

    const resC1 = validateLearningPlan(baseValidPlan, contextC1);

    assert.strictEqual(resC1.isValid, false, 'Expected invalid plan when ATP status is DRAFT');
    assert.strictEqual(
      resC1.errors.some((e) => e.includes('ATP acuan belum SIAP atau masih memerlukan peninjauan ulang.')),
      true,
      `Expected ATP not ready error, got: ${resC1.errors.join('; ')}`
    );
  });

  test('Case C2: ATP with needsReview = true should fail validateLearningPlan()', () => {
    const atpNeedsReview: ATPData = {
      ...validAtpData,
      needsReview: true,
      reviewReason: 'TP acuan berubah',
    };

    const contextC2 = {
      academicSetting: mockAcademicSetting,
      tp: mockTpData,
      atp: atpNeedsReview,
    };

    const resC2 = validateLearningPlan(baseValidPlan, contextC2);

    assert.strictEqual(resC2.isValid, false, 'Expected invalid plan when ATP needsReview is true');
    assert.strictEqual(
      resC2.errors.some((e) => e.includes('ATP acuan belum SIAP atau masih memerlukan peninjauan ulang.')),
      true,
      `Expected ATP not ready error, got: ${resC2.errors.join('; ')}`
    );
  });

  // Case D — duplicate TP references within linkedTpIds
  test('Case D: ATP item with duplicate linkedTpIds should fail validateLearningPlan()', () => {
    const atpDuplicateTp: ATPData = {
      ...validAtpData,
      items: [
        {
          ...validAtpData.items[0],
          linkedTpIds: ['tp-1', 'tp-1'],
        },
      ],
    };

    const contextD = {
      academicSetting: mockAcademicSetting,
      tp: mockTpData,
      atp: atpDuplicateTp,
    };

    const resD = validateLearningPlan(baseValidPlan, contextD);

    assert.strictEqual(resD.isValid, false, 'Expected invalid plan when linkedTpIds has duplicates');
    assert.strictEqual(
      resD.errors.some((e) => e.includes('Duplicate TP Reference') || e.includes('duplikasi referensi TP')),
      true,
      `Expected duplicate TP reference error, got: ${resD.errors.join('; ')}`
    );
  });

  // Case E — Orphan ATP item ID in plan
  test('Case E: Plan references non-existent atpItemId should fail validateLearningPlan()', () => {
    const planWithOrphanAtp: LearningPlan = {
      ...baseValidPlan,
      atpItemIds: ['atp-orphan-999'],
    };

    const contextE = {
      academicSetting: mockAcademicSetting,
      tp: mockTpData,
      atp: validAtpData,
    };

    const resE = validateLearningPlan(planWithOrphanAtp, contextE);

    assert.strictEqual(resE.isValid, false, 'Expected invalid plan when referencing orphan ATP ID');
    assert.strictEqual(
      resE.errors.some((e) => e.includes('Orphan ATP ID') || e.includes('atp-orphan-999')),
      true,
      `Expected orphan ATP ID error, got: ${resE.errors.join('; ')}`
    );
  });

  console.log(`\nRegression Suite Complete: ${passed}/${total} tests passed.`);
  if (passed !== total) {
    throw new Error(`Regression failed: ${total - passed} test(s) failed.`);
  }
}

runRegression();
