import {
  validateLearningPlan,
  validateLearningPlanForRPP,
  validateLearningPlanForModulAjar,
} from '../src/services/learningPlanService';
import {
  AcademicSetting,
  TPData,
  ATPData,
  LearningPlan,
} from '../src/types';

function runRegressionSuite() {
  console.log('=== RUNNING LEARNING PLAN OUTPUT READINESS REGRESSION SUITE ===\n');
  let passedCount = 0;
  let failedCount = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passedCount++;
    } else {
      console.error(`[FAIL] ${testName}${detail ? `: ${detail}` : ''}`);
      failedCount++;
    }
  }

  const mockSetting: AcademicSetting = {
    id: 'setting-merdeka-1',
    profileId: 'p1',
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
    academicSettingId: 'setting-merdeka-1',
    updatedAt: new Date().toISOString(),
    workflowStatus: 'SIAP',
    needsReview: false,
    items: [
      {
        id: 'tp-101',
        order: 1,
        code: 'E1-AP-01',
        statement: 'Memahami konsep dasar algoritma dan pemrograman.',
        competence: 'Memahami',
        contentScope: 'Algoritma Pemrograman',
        p3Dimensions: ['Bernalar Kritis'],
      },
    ],
  };

  const mockAtpData: ATPData = {
    id: 'atpdata-1',
    academicSettingId: 'setting-merdeka-1',
    updatedAt: new Date().toISOString(),
    totalJP: 36,
    workflowStatus: 'SIAP',
    needsReview: false,
    basedOnTpUpdatedAt: mockTpData.updatedAt,
    items: [
      {
        id: 'atp-201',
        stepNumber: 1,
        focus: 'Konsep dasar algoritma',
        linkedTpIds: ['tp-101'],
        tpId: 'tp-101',
        tpCode: 'E1-AP-01',
        tpStatement: 'Memahami konsep dasar algoritma dan pemrograman.',
        materialScope: 'Algoritma Pemrograman',
        jp: 4,
        semester: 1,
      },
    ],
  };

  const context = {
    academicSetting: mockSetting,
    tp: mockTpData,
    atp: mockAtpData,
  };

  // Base canonical plan with valid lineage, confirmedAt, status SIAP, valid assessment & experiences
  // but WITHOUT Modul Ajar specific fields (initialCompetency, DPL, resources, learningModel)
  const canonicalBasePlan: LearningPlan = {
    id: 'lp-001',
    academicSettingId: 'setting-merdeka-1',
    curriculumType: 'KURIKULUM_MERDEKA',
    sourceType: 'MANUAL',
    status: 'SIAP',
    confirmedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    topic: 'Pengenalan Algoritma',
    tpIds: ['tp-101'],
    atpItemIds: ['atp-201'],
    allocatedJP: 4,
    objectives: [
      {
        id: 'obj-1',
        tpId: 'tp-101',
        code: 'E1-AP-01',
        statement: 'Memahami konsep dasar algoritma dan pemrograman.',
        materialScope: 'Algoritma Pemrograman',
      },
    ],
    learningExperiences: [
      { id: 'exp-1', phase: 'UNDERSTAND', description: 'Memahami bagan alur sederhana', durationMinutes: 30 },
      { id: 'exp-2', phase: 'APPLY', description: 'Menerapkan logika pada algoritma', durationMinutes: 60 },
      { id: 'exp-3', phase: 'REFLECT', description: 'Merefleksikan proses penyusunan logika', durationMinutes: 30 },
    ],
    assessmentPlan: {
      initial: [{ id: 'ass-1', type: 'INITIAL', description: 'Pre-assessment', linkedTpIds: ['tp-101'] }],
      formative: [{ id: 'ass-2', type: 'FORMATIVE', description: 'Formatif penugasan', linkedTpIds: ['tp-101'] }],
      summative: [{ id: 'ass-3', type: 'SUMMATIVE', description: 'Sumatif bab', linkedTpIds: ['tp-101'] }],
    },
    // Modul Ajar specific fields are deliberately omitted or empty:
    initialCompetency: '',
    graduateProfileDimensions: undefined,
    resources: [],
    learningModel: '',
  };

  // =========================================================================
  // Case A: Canonical / RPP ready, Modul Ajar belum ready
  // =========================================================================
  console.log('--- Case A: Canonical / RPP ready, Modul Ajar belum ready ---');
  const canonicalValA = validateLearningPlan(canonicalBasePlan, context);
  const rppValA = validateLearningPlanForRPP(canonicalBasePlan, context);
  const modulAjarValA = validateLearningPlanForModulAjar(canonicalBasePlan, context);

  assert(
    canonicalValA.valid === true && canonicalValA.errors.length === 0,
    'Case A.1: validateLearningPlan() MUST be valid (canonical plan ready)',
    canonicalValA.errors.join('; ')
  );
  assert(
    rppValA.valid === true && rppValA.errors.length === 0,
    'Case A.2: validateLearningPlanForRPP() MUST be valid (RPP does not require Modul Ajar components)',
    rppValA.errors.join('; ')
  );
  assert(
    modulAjarValA.valid === false && modulAjarValA.errors.length > 0,
    'Case A.3: validateLearningPlanForModulAjar() MUST be invalid (missing Modul Ajar specific components)',
    `Expected invalid, got valid=${modulAjarValA.valid}`
  );

  // Assert specific Modul Ajar readiness error messages
  const hasCompetencyError = modulAjarValA.errors.some((e) => e.includes('Kompetensi Awal belum diisi'));
  const hasDimensionError = modulAjarValA.errors.some(
    (e) =>
      e.includes('Dimensi Profil Lulusan belum dipilih') ||
      e.includes('Dimensi Profil Lulusan harus berupa daftar')
  );
  const hasResourcesError = modulAjarValA.errors.some((e) => e.includes('Sarana dan prasarana / sumber belajar belum diisi'));
  const hasLearningModelError = modulAjarValA.errors.some((e) => e.includes('Model/praktik pembelajaran belum diisi'));

  assert(
    hasCompetencyError,
    'Case A.4: Modul Ajar validator asserts initialCompetency error',
    modulAjarValA.errors.join('; ')
  );
  assert(
    hasDimensionError,
    'Case A.5: Modul Ajar validator asserts graduateProfileDimensions error',
    modulAjarValA.errors.join('; ')
  );
  assert(
    hasResourcesError,
    'Case A.6: Modul Ajar validator asserts resources error',
    modulAjarValA.errors.join('; ')
  );
  assert(
    hasLearningModelError,
    'Case A.7: Modul Ajar validator asserts learningModel error',
    modulAjarValA.errors.join('; ')
  );

  // =========================================================================
  // Case B: Modul Ajar lengkap
  // =========================================================================
  console.log('\n--- Case B: Modul Ajar lengkap ---');
  const completeModulAjarPlan: LearningPlan = {
    ...canonicalBasePlan,
    initialCompetency: 'Peserta didik telah mengenal penggunaan gawai dan instruksi terurut.',
    graduateProfileDimensions: ['Penalaran Kritis', 'Kemandirian'],
    resources: [
      { id: 'res-1', title: 'Buku Panduan Guru Informatika SMP Kelas VII', source: 'Kemdikbudristek' },
    ],
    learningModel: 'Problem-Based Learning (PBL)',
  };

  const canonicalValB = validateLearningPlan(completeModulAjarPlan, context);
  const rppValB = validateLearningPlanForRPP(completeModulAjarPlan, context);
  const modulAjarValB = validateLearningPlanForModulAjar(completeModulAjarPlan, context);

  assert(
    canonicalValB.valid === true && canonicalValB.errors.length === 0,
    'Case B.1: validateLearningPlan() MUST be valid when plan is fully complete',
    canonicalValB.errors.join('; ')
  );
  assert(
    rppValB.valid === true && rppValB.errors.length === 0,
    'Case B.2: validateLearningPlanForRPP() MUST be valid when plan is fully complete',
    rppValB.errors.join('; ')
  );
  assert(
    modulAjarValB.valid === true && modulAjarValB.errors.length === 0,
    'Case B.3: validateLearningPlanForModulAjar() MUST be valid when Modul Ajar components are provided',
    modulAjarValB.errors.join('; ')
  );

  // =========================================================================
  // Case C: Canonical lineage rusak
  // =========================================================================
  console.log('\n--- Case C: Canonical lineage rusak (Orphan TP / ATP) ---');
  const brokenLineagePlan: LearningPlan = {
    ...completeModulAjarPlan,
    tpIds: ['tp-orphan-999'],
    atpItemIds: ['atp-orphan-888'],
  };

  const canonicalValC = validateLearningPlan(brokenLineagePlan, context);
  const rppValC = validateLearningPlanForRPP(brokenLineagePlan, context);
  const modulAjarValC = validateLearningPlanForModulAjar(brokenLineagePlan, context);

  assert(
    canonicalValC.valid === false && canonicalValC.errors.length > 0,
    'Case C.1: validateLearningPlan() MUST be invalid due to broken canonical lineage',
    `Expected invalid, got valid=${canonicalValC.valid}`
  );
  assert(
    rppValC.valid === false && rppValC.errors.length > 0,
    'Case C.2: validateLearningPlanForRPP() MUST be invalid when canonical lineage is broken',
    `Expected invalid, got valid=${rppValC.valid}`
  );
  assert(
    modulAjarValC.valid === false && modulAjarValC.errors.length > 0,
    'Case C.3: validateLearningPlanForModulAjar() MUST be invalid when canonical lineage is broken',
    `Expected invalid, got valid=${modulAjarValC.valid}`
  );

  // Assert specific canonical lineage error messages across all validators
  const hasOrphanTpErrorCanonical = canonicalValC.errors.some((e) => e.includes('tp-orphan-999') || e.includes('Orphan TP ID'));
  const hasOrphanAtpErrorCanonical = canonicalValC.errors.some((e) => e.includes('atp-orphan-888') || e.includes('Orphan ATP ID'));
  const hasOrphanTpErrorRpp = rppValC.errors.some((e) => e.includes('tp-orphan-999') || e.includes('Orphan TP ID'));
  const hasOrphanAtpErrorModulAjar = modulAjarValC.errors.some((e) => e.includes('atp-orphan-888') || e.includes('Orphan ATP ID'));

  assert(
    hasOrphanTpErrorCanonical,
    'Case C.4: Canonical validator asserts orphan TP error',
    canonicalValC.errors.join('; ')
  );
  assert(
    hasOrphanAtpErrorCanonical,
    'Case C.5: Canonical validator asserts orphan ATP error',
    canonicalValC.errors.join('; ')
  );
  assert(
    hasOrphanTpErrorRpp,
    'Case C.6: RPP validator inherits canonical orphan TP error',
    rppValC.errors.join('; ')
  );
  assert(
    hasOrphanAtpErrorModulAjar,
    'Case C.7: Modul Ajar validator inherits canonical orphan ATP error',
    modulAjarValC.errors.join('; ')
  );

  console.log(`\n=== REGRESSION SUITE COMPLETED: ${passedCount} passed, ${failedCount} failed ===`);
  if (failedCount > 0) {
    throw new Error(`${failedCount} regression tests failed.`);
  }
}

runRegressionSuite();
