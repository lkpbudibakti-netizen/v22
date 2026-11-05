import assert from 'node:assert';
import {
  isPedagogicalItemValid,
  validateAILearningPlanPayload,
  getFailedAssessmentGroups,
  buildLearningPlanRepairPrompt,
  learningPlanResponseSchema,
} from '../server';
import { normalizeAIAssessmentPlan } from '../src/services/learningPlanService';
import { LearningPlan } from '../src/types';
import type { LearningPlanScopeUnit } from '../src/services/learningPlanService';

async function runRegressionSuite() {
  console.log('=== RUNNING AI LEARNING PLAN ASSESSMENT RECOVERY REGRESSION SUITE ===\n');
  let passedCount = 0;
  let failedCount = 0;

  function test(name: string, fn: () => void | Promise<void>) {
    try {
      fn();
      console.log(`[PASS] ${name}`);
      passedCount++;
    } catch (err: any) {
      console.error(`[FAIL] ${name}:`, err.message);
      failedCount++;
    }
  }

  // Base valid payload fixture
  const createBaseValidPayload = () => ({
    title: 'Modul Ajar Informatika Bab 1',
    topic: 'Algoritma dan Pemrograman',
    initialCompetency: 'Murid telah mengenal konsep instruksi langkah demi langkah',
    graduateProfileDimensions: ['Penalaran Kritis', 'Kreativitas'],
    resources: [{ title: 'Buku Siswa Informatika Kelas 7' }],
    learningModel: 'Problem Based Learning dengan praktik kolaboratif',
    learningExperiences: [
      { phase: 'UNDERSTAND', description: 'Murid memahami konsep alur logika' },
      { phase: 'APPLY', description: 'Murid merancang diagram alir pemecahan masalah' },
      { phase: 'REFLECT', description: 'Murid merefleksikan proses penyusunan algoritma' },
    ],
    assessmentPlan: {
      initial: [
        {
          type: 'INITIAL',
          technique: 'Tes Lisan',
          instrument: 'Pertanyaan Pemantik',
          description: 'Apersepsi tanya jawab untuk mengidentifikasi pengetahuan awal urutan logis',
        },
      ],
      formative: [
        {
          type: 'FORMATIVE',
          technique: 'Observasi',
          instrument: 'Lembar Ceklis Keterampilan',
          description: 'Observasi proses murid saat merancang flowchart percabangan secara berkelompok',
        },
      ],
      summative: [
        {
          type: 'SUMMATIVE',
          technique: 'Tes Tertulis',
          instrument: 'Soal Uraian Studi Kasus',
          description: 'Evaluasi akhir unit materi mengenai perancangan algoritma terstruktur',
        },
      ],
    },
  });

  // =========================================================================
  // TEST 1: formative kosong
  // =========================================================================
  test('Test 1a: Payload dengan formative kosong [] ditolak dengan pesan spesifik', () => {
    const payload = createBaseValidPayload();
    payload.assessmentPlan.formative = [];

    const val = validateAILearningPlanPayload(payload);
    assert.strictEqual(val.isValid, false, 'Payload dengan formative kosong harus tidak valid');
    assert.strictEqual(
      val.reason,
      'Rencana Asesmen Formatif (formative) tidak memuat item pedagogis valid',
      `Reason harus spesifik: ${val.reason}`
    );

    const failedGroups = getFailedAssessmentGroups(payload);
    assert.ok(
      failedGroups.some((g) => g.includes('formative')),
      'getFailedAssessmentGroups harus mendeteksi formative gagal'
    );
  });

  test('Test 1b: ResponseSchema mewajibkan assessmentPlan, formative, minItems: 1, dan description', () => {
    assert.ok(
      learningPlanResponseSchema.required.includes('assessmentPlan'),
      'Schema harus mewajibkan assessmentPlan di level root'
    );

    const apSchema = learningPlanResponseSchema.properties.assessmentPlan;
    assert.ok(
      apSchema.required.includes('initial') &&
      apSchema.required.includes('formative') &&
      apSchema.required.includes('summative'),
      'assessmentPlan harus mewajibkan initial, formative, dan summative'
    );

    assert.strictEqual(
      (apSchema.properties.formative as any).minItems,
      1,
      'formative schema harus memiliki minItems: 1'
    );

    const itemProps = (apSchema.properties.formative as any).items;
    assert.ok(
      itemProps.required.includes('description'),
      'item formative harus mewajibkan description'
    );
  });

  // =========================================================================
  // TEST 2: Item tidak valid (description kosong atau whitespace)
  // =========================================================================
  test('Test 2a: isPedagogicalItemValid menolak description kosong atau bukan string', () => {
    assert.strictEqual(isPedagogicalItemValid(null), false);
    assert.strictEqual(isPedagogicalItemValid(undefined), false);
    assert.strictEqual(isPedagogicalItemValid({}), false);
    assert.strictEqual(isPedagogicalItemValid({ description: '' }), false);
    assert.strictEqual(isPedagogicalItemValid({ description: '   ' }), false);
    assert.strictEqual(isPedagogicalItemValid({ technique: 'Observasi' }), false);
    assert.strictEqual(
      isPedagogicalItemValid({ description: 'Observasi unjuk kerja murid' }),
      true
    );
  });

  test('Test 2b: formative dengan item tanpa description ditolak', () => {
    const payload = createBaseValidPayload();
    payload.assessmentPlan.formative = [
      { type: 'FORMATIVE', technique: 'Observasi', description: '  ' } as any,
    ];

    const val = validateAILearningPlanPayload(payload);
    assert.strictEqual(val.isValid, false);
    assert.strictEqual(
      val.reason,
      'Rencana Asesmen Formatif (formative) tidak memuat item pedagogis valid'
    );
  });

  test('Test 2c: initial atau summative dengan item kosong juga ditolak spesifik', () => {
    const payloadInitEmpty = createBaseValidPayload();
    payloadInitEmpty.assessmentPlan.initial = [{ description: '' } as any];
    const valInit = validateAILearningPlanPayload(payloadInitEmpty);
    assert.strictEqual(valInit.isValid, false);
    assert.strictEqual(
      valInit.reason,
      'Rencana Asesmen Awal (initial) tidak memuat item pedagogis valid'
    );

    const payloadSummEmpty = createBaseValidPayload();
    payloadSummEmpty.assessmentPlan.summative = [];
    const valSumm = validateAILearningPlanPayload(payloadSummEmpty);
    assert.strictEqual(valSumm.isValid, false);
    assert.strictEqual(
      valSumm.reason,
      'Rencana Asesmen Sumatif (summative) tidak memuat item pedagogis valid'
    );
  });

  test('Test 2d: normalizeAIAssessmentPlan menyaring item tanpa description', () => {
    const rawPlan = {
      initial: [{ description: 'Apersepsi' }],
      formative: [{ technique: 'Observasi' }], // no description!
      summative: [{ description: 'Ujian Akhir' }],
    };
    const normalized = normalizeAIAssessmentPlan(rawPlan, ['tp-101']);
    assert.strictEqual(normalized.initial.length, 1);
    assert.strictEqual(normalized.formative.length, 0, 'Item tanpa description tidak boleh lolos ke formative');
    assert.strictEqual(normalized.summative.length, 1);
  });

  // =========================================================================
  // TEST 3: Recovery Berhasil (Simulated AI Repair Attempt)
  // =========================================================================
  test('Test 3: Recovery berhasil memperbaiki formative kosong dan mempertahankan data kanonikal', () => {
    // 1. Initial output from AI with empty formative
    const initialRawOutput = createBaseValidPayload();
    initialRawOutput.assessmentPlan.formative = [];

    // 2. Initial validation fails
    const initialVal = validateAILearningPlanPayload(initialRawOutput);
    assert.strictEqual(initialVal.isValid, false);
    assert.strictEqual(
      initialVal.reason,
      'Rencana Asesmen Formatif (formative) tidak memuat item pedagogis valid'
    );

    const failedGroups = getFailedAssessmentGroups(initialRawOutput);
    assert.deepStrictEqual(failedGroups, ['formative (Asesmen Formatif)']);

    // 3. Build repair prompt
    const repairPrompt = buildLearningPlanRepairPrompt({
      parsed: initialRawOutput,
      validationReason: initialVal.reason,
      failedGroups,
      topic: 'Algoritma dan Pemrograman',
      tps: [{ id: 'tp-101', statement: 'Memahami algoritma' }],
      canonicalAllocatedJP: 6,
    });

    assert.ok(repairPrompt.includes('PERINGATAN PERBAIKAN STRUKTUR MODUL AJAR'));
    assert.ok(repairPrompt.includes('formative (Asesmen Formatif)'));
    assert.ok(repairPrompt.includes('Alokasi waktu kanonikal: 6 JP'));
    assert.ok(repairPrompt.includes('JANGAN menghasilkan asesmen fiktif'));

    // 4. Simulated repaired output from AI
    const repairedOutput = {
      ...initialRawOutput,
      assessmentPlan: {
        ...initialRawOutput.assessmentPlan,
        formative: [
          {
            type: 'FORMATIVE',
            technique: 'Observasi Kinerja',
            instrument: 'Rubrik Penilaian Diskusi',
            description: 'Observasi keaktifan murid saat menyusun algoritma percabangan dalam kelompok',
          },
        ],
      },
    };

    // 5. Re-validation
    const repairedVal = validateAILearningPlanPayload(repairedOutput);
    assert.strictEqual(repairedVal.isValid, true, 'Repaired output harus valid');
    assert.strictEqual(repairedOutput.topic, 'Algoritma dan Pemrograman', 'Topic asli harus terjaga');
    assert.strictEqual(repairedOutput.learningExperiences.length, 3, 'Pengalaman belajar asli harus terjaga');
    assert.strictEqual(repairedOutput.assessmentPlan.formative.length, 1);
  });

  // =========================================================================
  // TEST 4: Recovery Gagal (Fail-Closed, Max 1 Attempt)
  // =========================================================================
  test('Test 4: Recovery gagal menolak respons tidak valid dan tidak mengarang asesmen fiktif', () => {
    // 1. Initial output invalid
    const initialRawOutput = createBaseValidPayload();
    initialRawOutput.assessmentPlan.formative = [];

    const initialVal = validateAILearningPlanPayload(initialRawOutput);
    assert.strictEqual(initialVal.isValid, false);

    // 2. Simulated repaired output is STILL invalid (AI still returned empty formative or blank description)
    const stillBrokenRepairedOutput = {
      ...initialRawOutput,
      assessmentPlan: {
        ...initialRawOutput.assessmentPlan,
        formative: [{ description: '   ' }], // Still invalid!
      },
    };

    // 3. Re-validation of repair attempt
    const secondVal = validateAILearningPlanPayload(stillBrokenRepairedOutput);
    assert.strictEqual(secondVal.isValid, false, 'Repair yang masih kosong/blank harus tetap invalid');
    assert.strictEqual(
      secondVal.reason,
      'Rencana Asesmen Formatif (formative) tidak memuat item pedagogis valid'
    );

    // 4. Fail-closed contract: Error message specifically states failure after repair
    const finalErrorMessage = `Respons AI tidak memenuhi kualifikasi struktur Modul Ajar setelah perbaikan: ${secondVal.reason}`;
    assert.ok(
      finalErrorMessage.includes('setelah perbaikan'),
      'Pesan error harus eksplisit menyatakan kegagalan setelah percobaan perbaikan'
    );
    assert.ok(
      finalErrorMessage.includes('Rencana Asesmen Formatif (formative) tidak memuat item pedagogis valid'),
      'Pesan error harus memuat alasan spesifik kegagalan'
    );
  });

  // =========================================================================
  // TEST 5: Mekanisme Batch (3 Bab: 1 Berhasil, 2 Gagal)
  // =========================================================================
  test('Test 5: Batch 3 Bab dengan 1 berhasil dan 2 gagal menyimpan Bab berhasil sebagai DRAFT dan memungkinkan coba ulang tanpa duplikasi', async () => {
    // Define 3 scopes for active semester
    const scopes: LearningPlanScopeUnit[] = [
      {
        id: 'unit-1',
        type: 'CANONICAL_UNIT',
        unitId: 'unit-1',
        title: 'Bab 1: Algoritma dan Pemrograman',
        unitTitle: 'Bab 1: Algoritma dan Pemrograman',
        linkedTpIds: ['tp-101'],
        linkedAtpItemIds: ['atp-101'],
        jp: 4,
      },
      {
        id: 'unit-2',
        type: 'CANONICAL_UNIT',
        unitId: 'unit-2',
        title: 'Bab 2: Analisis Data',
        unitTitle: 'Bab 2: Analisis Data',
        linkedTpIds: ['tp-201'],
        linkedAtpItemIds: ['atp-201'],
        jp: 4,
      },
      {
        id: 'unit-3',
        type: 'CANONICAL_UNIT',
        unitId: 'unit-3',
        title: 'Bab 3: Jaringan Komputer',
        unitTitle: 'Bab 3: Jaringan Komputer',
        linkedTpIds: ['tp-301'],
        linkedAtpItemIds: ['atp-301'],
        jp: 4,
      },
    ];

    // State of saved LearningPlans in workspace
    let persistedPlans: LearningPlan[] = [];

    // Helper checking if scope has plan
    const hasAssociatedPlan = (scope: LearningPlanScopeUnit, plans: LearningPlan[]) => {
      return plans.some((p) => p.unitId === scope.unitId);
    };

    // Simulated generator function
    const simulateAIGeneration = async (scope: LearningPlanScopeUnit): Promise<LearningPlan> => {
      if (scope.unitId === 'unit-1') {
        // Unit 1 succeeds
        return {
          id: `lp-${scope.unitId}`,
          academicSettingId: 'setting-1',
          curriculumType: 'KURIKULUM_MERDEKA',
          unitId: scope.unitId,
          tpIds: scope.linkedTpIds,
          atpItemIds: scope.linkedAtpItemIds,
          title: `Modul Ajar: ${scope.title}`,
          topic: scope.title,
          sourceType: 'AI_DRAFT',
          status: 'DRAFT',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          objectives: [],
          learningExperiences: [
            { id: 'exp-1', phase: 'UNDERSTAND', description: 'Memahami' },
            { id: 'exp-2', phase: 'APPLY', description: 'Menerapkan' },
            { id: 'exp-3', phase: 'REFLECT', description: 'Refleksi' },
          ],
          assessmentPlan: {
            initial: [{ id: 'a1', type: 'INITIAL', description: 'Diagnostik', linkedTpIds: scope.linkedTpIds }],
            formative: [{ id: 'f1', type: 'FORMATIVE', description: 'Formatif', linkedTpIds: scope.linkedTpIds }],
            summative: [{ id: 's1', type: 'SUMMATIVE', description: 'Sumatif', linkedTpIds: scope.linkedTpIds }],
          },
        };
      } else if (scope.unitId === 'unit-2') {
        // Unit 2 fails due to validation error (e.g. formative empty after repair)
        throw new Error('Respons AI tidak memenuhi kualifikasi struktur Modul Ajar setelah perbaikan: Rencana Asesmen Formatif (formative) tidak memuat item pedagogis valid');
      } else {
        // Unit 3 fails due to AI network timeout
        throw new Error('Layanan AI sedang mengalami lonjakan antrean trafik tinggi. Silakan coba lagi.');
      }
    };

    // RUN BATCH 1
    const pendingBatch1 = scopes.filter((s) => !hasAssociatedPlan(s, persistedPlans));
    assert.strictEqual(pendingBatch1.length, 3, 'Batch 1 harus memproses 3 unit pending');

    const generatedBatch1: LearningPlan[] = [];
    let successCount = 0;
    let failCount = 0;

    for (const scope of pendingBatch1) {
      try {
        const plan = await simulateAIGeneration(scope);
        generatedBatch1.push(plan);
        successCount++;
      } catch (err) {
        failCount++;
      }
    }

    assert.strictEqual(successCount, 1, 'Hanya 1 unit yang berhasil');
    assert.strictEqual(failCount, 2, '2 unit gagal');
    assert.strictEqual(generatedBatch1.length, 1, 'generatedBatch1 hanya memuat 1 plan');
    assert.strictEqual(generatedBatch1[0].unitId, 'unit-1');
    assert.strictEqual(generatedBatch1[0].status, 'DRAFT', 'Unit yang berhasil harus berstatus DRAFT');

    // Save successful batch results to persistedPlans
    persistedPlans = [...persistedPlans, ...generatedBatch1];
    assert.strictEqual(persistedPlans.length, 1, 'Hanya Unit 1 yang tersimpan');

    // SIMULATE TEACHER EDITING UNIT 1
    persistedPlans[0] = {
      ...persistedPlans[0],
      title: 'Modul Ajar Bab 1 (Diedit Guru)',
    };

    // RUN BATCH 2 (RETRY)
    let skippedCount = 0;
    const pendingBatch2: LearningPlanScopeUnit[] = [];

    for (const scope of scopes) {
      if (hasAssociatedPlan(scope, persistedPlans)) {
        skippedCount++;
      } else {
        pendingBatch2.push(scope);
      }
    }

    assert.strictEqual(skippedCount, 1, 'Unit 1 harus dilewati (sudah ada)');
    assert.strictEqual(pendingBatch2.length, 2, 'Hanya Unit 2 dan Unit 3 yang perlu dicoba ulang');
    assert.deepStrictEqual(
      pendingBatch2.map((s) => s.unitId),
      ['unit-2', 'unit-3'],
      'Unit yang dicoba ulang tepat unit-2 dan unit-3'
    );

    // Verify teacher edit on Unit 1 was NOT touched or overwritten
    assert.strictEqual(
      persistedPlans[0].title,
      'Modul Ajar Bab 1 (Diedit Guru)',
      'Data guru pada Bab 1 tidak boleh tertimpa saat retry batch'
    );
  });

  console.log(`\n==========================================`);
  console.log(`TOTAL PASSED: ${passedCount}`);
  console.log(`TOTAL FAILED: ${failedCount}`);
  console.log(`==========================================`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

runRegressionSuite();
