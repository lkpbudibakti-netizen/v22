import { validateLearningPlan } from '../src/services/learningPlanService';
import {
  AcademicSetting,
  TPData,
  ATPData,
  LearningPlan,
  AssessmentPlanItem,
  ATPUnitMappingData,
  UnitExecutionPlanData,
  LearningMeetingScheduleData,
} from '../src/types';
import { ScheduledLearningMeetingProjection } from '../src/services/scheduledLearningMeetingProjectionService';

async function runRegressionSuite() {
  console.log('=== RUNNING ASSESSMENT MEETING LINKAGE REGRESSION SUITE ===\n');
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

  // --- Fixtures ---
  const mockSettingSem1: AcademicSetting = {
    id: 'setting-sem-1',
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

  const mockSettingSem2: AcademicSetting = {
    ...mockSettingSem1,
    id: 'setting-sem-2',
    semester: '2 (Genap)',
  };

  const mockTpData: TPData = {
    id: 'tpdata-1',
    academicSettingId: 'setting-sem-1',
    updatedAt: new Date().toISOString(),
    workflowStatus: 'SIAP',
    needsReview: false,
    items: [
      {
        id: 'tp-101',
        order: 1,
        code: 'TP 7.1',
        statement: 'Memahami konsep dasar algoritma dan pemrograman.',
        competence: 'Memahami',
        contentScope: 'Algoritma Pemrograman',
        p3Dimensions: ['Bernalar Kritis'],
      },
      {
        id: 'tp-102',
        order: 2,
        code: 'TP 7.2',
        statement: 'Menerapkan struktur kontrol keputusan dalam program.',
        competence: 'Menerapkan',
        contentScope: 'Struktur Kontrol',
        p3Dimensions: ['Mandiri'],
      },
      {
        id: 'tp-201',
        order: 3,
        code: 'TP 7.3',
        statement: 'Menganalisis data tabular menggunakan perkakas digital.',
        competence: 'Menganalisis',
        contentScope: 'Analisis Data',
        p3Dimensions: ['Bernalar Kritis'],
      },
    ],
  };

  const mockAtpData: ATPData = {
    id: 'atpdata-1',
    academicSettingId: 'setting-sem-1',
    updatedAt: new Date().toISOString(),
    totalJP: 36,
    workflowStatus: 'SIAP',
    needsReview: false,
    basedOnTpUpdatedAt: mockTpData.updatedAt,
    items: [
      {
        id: 'atp-101',
        stepNumber: 1,
        tpId: 'tp-101',
        tpCode: 'TP 7.1',
        tpStatement: 'Memahami konsep dasar algoritma dan pemrograman.',
        focus: 'Memahami konsep dasar algoritma dan pemrograman.',
        materialScope: 'Algoritma Pemrograman',
        jp: 4,
        semester: 1,
      },
      {
        id: 'atp-102',
        stepNumber: 2,
        tpId: 'tp-102',
        tpCode: 'TP 7.2',
        tpStatement: 'Menerapkan struktur kontrol keputusan dalam program.',
        focus: 'Menerapkan struktur kontrol keputusan dalam program.',
        materialScope: 'Struktur Kontrol',
        jp: 4,
        semester: 1,
      },
      {
        id: 'atp-201',
        stepNumber: 3,
        tpId: 'tp-201',
        tpCode: 'TP 7.3',
        tpStatement: 'Menganalisis data tabular menggunakan perkakas digital.',
        focus: 'Menganalisis data tabular menggunakan perkakas digital.',
        materialScope: 'Analisis Data',
        jp: 4,
        semester: 1,
      },
    ],
  };

  // Canonical projections for Unit 1 (Bab 1) and Unit 2 (Bab 2)
  const canonicalScheduleProjections: ScheduledLearningMeetingProjection[] = [
    {
      meetingId: 'meet-101',
      unitId: 'unit-1',
      unitTitle: 'Bab 1: Algoritma dan Pemrograman',
      unitOrder: 1,
      meetingTitle: 'Pertemuan 1: Konsep Algoritma',
      meetingOrder: 1,
      linkedAtpItemIds: [],
      linkedTpIds: ['tp-101'],
      materials: [{ id: 'mat-1', title: 'Konsep Dasar Algoritma' }],
      semester: 1,
      semesterPlanId: 'setting-sem-1',
      date: '2026-08-01',
      dayOfWeek: 1,
      weekIndex: 1,
      jp: 2,
      mode: 'AUTO',
    },
    {
      meetingId: 'meet-102',
      unitId: 'unit-1',
      unitTitle: 'Bab 1: Algoritma dan Pemrograman',
      unitOrder: 1,
      meetingTitle: 'Pertemuan 2: Struktur Kontrol',
      meetingOrder: 2,
      linkedAtpItemIds: [],
      linkedTpIds: ['tp-102'],
      materials: [{ id: 'mat-2', title: 'Struktur Kontrol IF' }],
      semester: 1,
      semesterPlanId: 'setting-sem-1',
      date: '2026-08-08',
      dayOfWeek: 1,
      weekIndex: 2,
      jp: 2,
      mode: 'AUTO',
    },
    // Meet 201 belongs to Unit 2 (Bab 2)
    {
      meetingId: 'meet-201',
      unitId: 'unit-2',
      unitTitle: 'Bab 2: Analisis Data',
      unitOrder: 2,
      meetingTitle: 'Pertemuan 1: Data Tabular',
      meetingOrder: 1,
      linkedAtpItemIds: [],
      linkedTpIds: ['tp-201'],
      materials: [{ id: 'mat-3', title: 'Spreadsheet Dasar' }],
      semester: 1,
      semesterPlanId: 'setting-sem-1',
      date: '2026-08-15',
      dayOfWeek: 1,
      weekIndex: 3,
      jp: 2,
      mode: 'AUTO',
    },
  ];

  function createBasePlan(overrides?: Partial<LearningPlan>): LearningPlan {
    return {
      id: 'plan-1',
      academicSettingId: 'setting-sem-1',
      curriculumType: 'KURIKULUM_MERDEKA',
      unitId: 'unit-1',
      learningMeetingIds: ['meet-101', 'meet-102'],
      tpIds: ['tp-101', 'tp-102'],
      atpItemIds: [],
      objectives: [],
      title: 'Modul Ajar Bab 1: Algoritma dan Pemrograman',
      topic: 'Algoritma dan Pemrograman',
      allocatedJP: 4,
      sourceType: 'MANUAL',
      status: 'DRAFT',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      learningExperiences: [
        { id: 'exp-1', phase: 'UNDERSTAND', description: 'Memahami konsep algoritma', linkedTpIds: ['tp-101'] },
        { id: 'exp-2', phase: 'APPLY', description: 'Menerapkan struktur percabangan', linkedTpIds: ['tp-102'] },
        { id: 'exp-3', phase: 'REFLECT', description: 'Refleksi pengalaman membuat alur logika', linkedTpIds: ['tp-101', 'tp-102'] },
      ],
      assessmentPlan: {
        initial: [
          {
            id: 'asm-init-1',
            type: 'INITIAL',
            technique: 'Tes Lisan',
            instrument: 'Pertanyaan Pemantik',
            linkedTpIds: ['tp-101'],
            description: 'Apersepsi pemahaman awal siswa mengenai urutan instruksi logis.',
          },
        ],
        formative: [
          {
            id: 'asm-form-1',
            type: 'FORMATIVE',
            technique: 'Observasi',
            instrument: 'Lembar Observasi',
            linkedTpIds: ['tp-101'],
            description: 'Observasi keaktifan siswa saat menyusun flowchart.',
          },
        ],
        summative: [
          {
            id: 'asm-sum-1',
            type: 'SUMMATIVE',
            technique: 'Tes Tertulis',
            instrument: 'Soal Pilihan Ganda dan Esai',
            linkedTpIds: ['tp-101', 'tp-102'],
            description: 'Ujian sumatif akhir bab materi algoritma dan struktur kontrol.',
          },
        ],
      },
      ...overrides,
    };
  }

  // =========================================================================
  // TEST 1: Asesmen Tingkat Bab (Tanpa learningMeetingId)
  // =========================================================================
  console.log('--- TEST 1: Asesmen Tingkat Bab (Tanpa learningMeetingId) ---');
  {
    const plan = createBasePlan();
    const result = validateLearningPlan(plan, {
      academicSetting: mockSettingSem1,
      tp: mockTpData,
      atp: mockAtpData,
      scheduledMeetings: canonicalScheduleProjections,
    });

    assert(result.isValid, 'Asesmen tingkat bab tanpa learningMeetingId harus valid', result.errors.join('; '));
    assert(
      plan.assessmentPlan.initial[0].learningMeetingId === undefined,
      'learningMeetingId awal tidak boleh otomatis diisi atau dimutasi'
    );
    assert(
      plan.assessmentPlan.formative[0].learningMeetingId === undefined,
      'learningMeetingId formatif tingkat bab tetap undefined'
    );
    assert(
      plan.assessmentPlan.summative[0].learningMeetingId === undefined,
      'learningMeetingId sumatif tingkat bab tetap undefined'
    );
  }

  // =========================================================================
  // TEST 2: Asesmen dengan ID Pertemuan Valid & TP Sesuai
  // =========================================================================
  console.log('\n--- TEST 2: Asesmen dengan ID Pertemuan Valid & TP Sesuai ---');
  {
    const plan = createBasePlan({
      assessmentPlan: {
        initial: [
          {
            id: 'asm-init-1',
            type: 'INITIAL',
            technique: 'Tes Diagnostik',
            linkedTpIds: ['tp-101'],
            learningMeetingId: 'meet-101', // Valid: meet-101 links to tp-101
            description: 'Diagnostik awal pertemuan 1',
          },
        ],
        formative: [
          {
            id: 'asm-form-1',
            type: 'FORMATIVE',
            technique: 'Observasi',
            linkedTpIds: ['tp-101'],
            learningMeetingId: 'meet-101', // Valid: meet-101 links to tp-101
            description: 'Formatif pertemuan 1',
          },
          {
            id: 'asm-form-2',
            type: 'FORMATIVE',
            technique: 'Penugasan Praktik',
            linkedTpIds: ['tp-102'],
            learningMeetingId: 'meet-102', // Valid: meet-102 links to tp-102
            description: 'Formatif pertemuan 2',
          },
        ],
        summative: [
          {
            id: 'asm-sum-1',
            type: 'SUMMATIVE',
            technique: 'Tes Tertulis',
            linkedTpIds: ['tp-101', 'tp-102'], // Asesmen sumatif bab tanpa meeting
            description: 'Sumatif akhir Bab 1',
          },
        ],
      },
    });

    const result = validateLearningPlan(plan, {
      academicSetting: mockSettingSem1,
      tp: mockTpData,
      atp: mockAtpData,
      scheduledMeetings: canonicalScheduleProjections,
    });

    assert(result.isValid, 'Asesmen dengan learningMeetingId valid dan TP sesuai harus lulus validasi', result.errors.join('; '));
  }

  // =========================================================================
  // TEST 3: ID Pertemuan Tidak Valid
  // =========================================================================
  console.log('\n--- TEST 3: ID Pertemuan Tidak Valid ---');
  // 3a. String kosong / whitespace
  {
    const plan = createBasePlan({
      assessmentPlan: {
        initial: [],
        formative: [
          {
            id: 'asm-form-blank',
            type: 'FORMATIVE',
            linkedTpIds: ['tp-101'],
            learningMeetingId: '   ',
            description: 'Formatif dengan whitespace meetingId',
          },
        ],
        summative: [
          {
            id: 'asm-sum-1',
            type: 'SUMMATIVE',
            linkedTpIds: ['tp-101', 'tp-102'],
            description: 'Sumatif bab',
          },
        ],
      },
    });

    const result = validateLearningPlan(plan, {
      academicSetting: mockSettingSem1,
      tp: mockTpData,
      atp: mockAtpData,
      scheduledMeetings: canonicalScheduleProjections,
    });

    assert(!result.isValid, 'learningMeetingId string kosong / whitespace harus ditolak');
    assert(
      result.errors.some((e) => e.includes('learningMeetingId tidak valid (string kosong)')),
      'Pesan error harus secara spesifik menyatakan string kosong',
      result.errors.join('; ')
    );
  }

  // 3b. Non-existent / Ghost ID
  {
    const plan = createBasePlan({
      assessmentPlan: {
        initial: [],
        formative: [
          {
            id: 'asm-form-ghost',
            type: 'FORMATIVE',
            linkedTpIds: ['tp-101'],
            learningMeetingId: 'meet-ghost-999',
            description: 'Formatif dengan meeting non-existent',
          },
        ],
        summative: [
          {
            id: 'asm-sum-1',
            type: 'SUMMATIVE',
            linkedTpIds: ['tp-101', 'tp-102'],
            description: 'Sumatif bab',
          },
        ],
      },
    });

    const result = validateLearningPlan(plan, {
      academicSetting: mockSettingSem1,
      tp: mockTpData,
      atp: mockAtpData,
      scheduledMeetings: canonicalScheduleProjections,
    });

    assert(!result.isValid, 'learningMeetingId yang tidak ada dalam jadwal canonical harus ditolak');
    assert(
      result.errors.some((e) => e.includes("tidak ditemukan pada jadwal pertemuan canonical")),
      'Pesan error harus menjelaskan pertemuan tidak ditemukan pada jadwal canonical aktif',
      result.errors.join('; ')
    );
  }

  // 3c. Meeting ID ada di jadwal, tapi tidak tercantum di plan.learningMeetingIds
  {
    const plan = createBasePlan({
      learningMeetingIds: ['meet-101'], // hanya meet-101 tercantum
      assessmentPlan: {
        initial: [],
        formative: [
          {
            id: 'asm-form-unlisted',
            type: 'FORMATIVE',
            linkedTpIds: ['tp-102'],
            learningMeetingId: 'meet-102', // meet-102 ada di Bab 1, tapi tidak ada di plan.learningMeetingIds
            description: 'Formatif merujuk pertemuan yang tidak ada di modul',
          },
        ],
        summative: [
          {
            id: 'asm-sum-1',
            type: 'SUMMATIVE',
            linkedTpIds: ['tp-101'],
            description: 'Sumatif bab',
          },
        ],
      },
      tpIds: ['tp-101'],
      atpItemIds: ['atp-101'],
      learningExperiences: [
        { id: 'exp-1', phase: 'UNDERSTAND', description: 'Memahami konsep algoritma', linkedTpIds: ['tp-101'] },
        { id: 'exp-2', phase: 'APPLY', description: 'Menerapkan struktur percabangan', linkedTpIds: ['tp-101'] },
        { id: 'exp-3', phase: 'REFLECT', description: 'Refleksi pengalaman', linkedTpIds: ['tp-101'] },
      ],
    });

    const resultWithBothMeetings = validateLearningPlan(plan, {
      academicSetting: mockSettingSem1,
      tp: mockTpData,
      atp: mockAtpData,
      scheduledMeetings: canonicalScheduleProjections,
    });

    assert(
      !resultWithBothMeetings.isValid,
      'Asesmen dengan meetingId yang tidak tercantum di plan.learningMeetingIds harus ditolak'
    );
    assert(
      resultWithBothMeetings.errors.some((e) =>
        e.includes("tidak tercantum dalam daftar pertemuan rencana pembelajaran (plan.learningMeetingIds)")
      ),
      'Pesan error harus menyebutkan plan.learningMeetingIds',
      resultWithBothMeetings.errors.join('; ')
    );
  }

  // =========================================================================
  // TEST 4: Asesmen Lintas Bab (Cross-Bab Meeting ID)
  // =========================================================================
  console.log('\n--- TEST 4: Asesmen Lintas Bab (Cross-Bab Meeting ID) ---');
  {
    // Plan is for Unit 1, but assessment refers to meet-201 (which belongs to Unit 2)
    const plan = createBasePlan({
      assessmentPlan: {
        initial: [],
        formative: [
          {
            id: 'asm-form-cross-unit',
            type: 'FORMATIVE',
            linkedTpIds: ['tp-201'],
            learningMeetingId: 'meet-201', // Unit 2
            description: 'Formatif mencuri pertemuan Bab 2',
          },
        ],
        summative: [
          {
            id: 'asm-sum-1',
            type: 'SUMMATIVE',
            linkedTpIds: ['tp-101', 'tp-102'],
            description: 'Sumatif bab',
          },
        ],
      },
    });

    const result = validateLearningPlan(plan, {
      academicSetting: mockSettingSem1,
      tp: mockTpData,
      atp: mockAtpData,
      scheduledMeetings: canonicalScheduleProjections,
    });

    assert(!result.isValid, 'Asesmen dengan ID pertemuan dari Bab lain harus ditolak');
    assert(
      result.errors.some((e) => e.includes('Asesmen pertemuan tidak boleh lintas Bab')),
      'Pesan error harus secara eksplisit menolak asesmen lintas Bab',
      result.errors.join('; ')
    );
  }

  // =========================================================================
  // TEST 5: TP Asesmen Tidak Sesuai TP Canonical Pertemuan
  // =========================================================================
  console.log('\n--- TEST 5: TP Asesmen Tidak Sesuai TP Canonical Pertemuan ---');
  // 5a. TP tidak sesuai dengan TP canonical pertemuan
  {
    // meet-101 hanya mengajarkan tp-101, tetapi asesmen meet-101 malah menilai tp-102
    const plan = createBasePlan({
      assessmentPlan: {
        initial: [],
        formative: [
          {
            id: 'asm-form-tp-mismatch',
            type: 'FORMATIVE',
            linkedTpIds: ['tp-102'], // tp-102 is in plan, but NOT connected to meet-101
            learningMeetingId: 'meet-101',
            description: 'Formatif menguji materi yang belum diajarkan di pertemuan 1',
          },
        ],
        summative: [
          {
            id: 'asm-sum-1',
            type: 'SUMMATIVE',
            linkedTpIds: ['tp-101', 'tp-102'],
            description: 'Sumatif bab',
          },
        ],
      },
    });

    const result = validateLearningPlan(plan, {
      academicSetting: mockSettingSem1,
      tp: mockTpData,
      atp: mockAtpData,
      scheduledMeetings: canonicalScheduleProjections,
    });

    assert(!result.isValid, 'Asesmen dengan TP yang tidak diajarkan pada pertemuan tersebut harus ditolak');
    assert(
      result.errors.some((e) =>
        e.includes("tidak sesuai dengan TP canonical yang terhubung pada pertemuan 'meet-101'")
      ),
      'Pesan error harus menyebutkan ketidaksesuaian TP canonical pertemuan',
      result.errors.join('; ')
    );
  }

  // 5b. linkedTpIds kosong pada asesmen per pertemuan
  {
    const plan = createBasePlan({
      assessmentPlan: {
        initial: [],
        formative: [
          {
            id: 'asm-form-empty-tp',
            type: 'FORMATIVE',
            linkedTpIds: [], // Empty linkedTpIds
            learningMeetingId: 'meet-101',
            description: 'Formatif tanpa TP',
          },
        ],
        summative: [
          {
            id: 'asm-sum-1',
            type: 'SUMMATIVE',
            linkedTpIds: ['tp-101'],
            description: 'Sumatif bab',
          },
        ],
      },
    });

    const result = validateLearningPlan(plan, {
      academicSetting: mockSettingSem1,
      tp: mockTpData,
      atp: mockAtpData,
      scheduledMeetings: canonicalScheduleProjections,
    });

    assert(!result.isValid, 'Asesmen per pertemuan tanpa linkedTpIds harus ditolak');
    assert(
      result.errors.some((e) => e.includes('wajib menghubungkan minimal satu Tujuan Pembelajaran (linkedTpIds)')),
      'Pesan error harus mewajibkan minimal satu TP terhubung',
      result.errors.join('; ')
    );
  }

  // =========================================================================
  // TEST 6: Perubahan Jadwal (Schedule Changes & Fail-Closed Behavior)
  // =========================================================================
  console.log('\n--- TEST 6: Perubahan Jadwal (Schedule Changes & Fail-Closed Behavior) ---');

  // 6a. Sumber canonical tidak tersedia -> Fail Closed
  {
    const planWithMeetingAssessment = createBasePlan({
      assessmentPlan: {
        initial: [],
        formative: [
          {
            id: 'asm-form-1',
            type: 'FORMATIVE',
            linkedTpIds: ['tp-101'],
            learningMeetingId: 'meet-101',
            description: 'Formatif pertemuan 1',
          },
        ],
        summative: [
          {
            id: 'asm-sum-1',
            type: 'SUMMATIVE',
            linkedTpIds: ['tp-101', 'tp-102'],
            description: 'Sumatif bab',
          },
        ],
      },
    });

    // Pass context without scheduledMeetings, mapping, or schedules
    const result = validateLearningPlan(planWithMeetingAssessment, {
      academicSetting: mockSettingSem1,
      tp: mockTpData,
      atp: mockAtpData,
      scheduledMeetings: null,
      atpUnitMapping: null,
      unitExecutionPlan: null,
      learningMeetingSchedules: null,
    });

    assert(!result.isValid, 'Jika sumber canonical tidak tersedia, referensi pertemuan tidak boleh dianggap valid');
    assert(
      result.errors.some((e) =>
        e.includes("Jadwal pertemuan canonical tidak tersedia untuk memvalidasi asesmen 'FORMATIVE'")
      ),
      'Harus melaporkan error bahwa jadwal canonical tidak tersedia',
      result.errors.join('; ')
    );
  }

  // 6b. Pertemuan dipindah ke semester lain (misal Semester 2)
  {
    // Projection where meet-101 is moved to Semester 2 (setting-sem-2)
    const movedScheduleProjections: ScheduledLearningMeetingProjection[] = canonicalScheduleProjections.map((r) =>
      r.meetingId === 'meet-101'
        ? { ...r, semester: 2, semesterPlanId: 'setting-sem-2' }
        : r
    );

    const plan = createBasePlan({
      assessmentPlan: {
        initial: [],
        formative: [
          {
            id: 'asm-form-1',
            type: 'FORMATIVE',
            linkedTpIds: ['tp-101'],
            learningMeetingId: 'meet-101',
            description: 'Formatif pertemuan 1 yang telah dipindah ke semester 2',
          },
        ],
        summative: [
          {
            id: 'asm-sum-1',
            type: 'SUMMATIVE',
            linkedTpIds: ['tp-101', 'tp-102'],
            description: 'Sumatif bab',
          },
        ],
      },
    });

    const result = validateLearningPlan(plan, {
      academicSetting: mockSettingSem1, // Validating active semester 1
      tp: mockTpData,
      atp: mockAtpData,
      scheduledMeetings: movedScheduleProjections,
    });

    assert(!result.isValid, 'Pertemuan yang dipindah ke semester lain harus ditolak pada semester aktif');
    assert(
      result.errors.some((e) =>
        e.includes("tidak ditemukan pada jadwal pertemuan canonical semester aktif")
      ),
      'Harus dilaporkan tidak ditemukan pada semester aktif',
      result.errors.join('; ')
    );
  }

  // 6c. Perubahan alokasi TP pada jadwal (TP rescheduling)
  {
    // Update canonical projection: meet-101 was changed to teach tp-102 instead of tp-101
    const rescheduledProjections: ScheduledLearningMeetingProjection[] = canonicalScheduleProjections.map((r) =>
      r.meetingId === 'meet-101'
        ? { ...r, linkedTpIds: ['tp-102'] } // changed canonical TP
        : r
    );

    const plan = createBasePlan({
      assessmentPlan: {
        initial: [],
        formative: [
          {
            id: 'asm-form-1',
            type: 'FORMATIVE',
            linkedTpIds: ['tp-101'], // Stale assessment still expects tp-101
            learningMeetingId: 'meet-101',
            description: 'Formatif pertemuan 1',
          },
        ],
        summative: [
          {
            id: 'asm-sum-1',
            type: 'SUMMATIVE',
            linkedTpIds: ['tp-101', 'tp-102'],
            description: 'Sumatif bab',
          },
        ],
      },
    });

    const result = validateLearningPlan(plan, {
      academicSetting: mockSettingSem1,
      tp: mockTpData,
      atp: mockAtpData,
      scheduledMeetings: rescheduledProjections,
    });

    assert(!result.isValid, 'Perubahan jadwal yang mengubah TP canonical harus memicu TP mismatch pada asesmen');
    assert(
      result.errors.some((e) =>
        e.includes("Tujuan Pembelajaran 'tp-101' pada rencana asesmen 'FORMATIVE' (ID: 'asm-form-1') tidak sesuai")
      ),
      'Pesan error harus mendeteksi tp-101 tidak sesuai lagi dengan TP jadwal terbaru',
      result.errors.join('; ')
    );
  }

  // =========================================================================
  // TEST 7: Koeksistensi Asesmen Tingkat Bab dan Per Pertemuan
  // =========================================================================
  console.log('\n--- TEST 7: Koeksistensi Asesmen Tingkat Bab dan Per Pertemuan ---');
  {
    const hybridPlan = createBasePlan({
      assessmentPlan: {
        initial: [
          {
            id: 'asm-init-chapter',
            type: 'INITIAL',
            technique: 'Tes Lisan',
            instrument: 'Tanya Jawab',
            linkedTpIds: ['tp-101'],
            description: 'Asesmen awal tingkat Bab',
            // No learningMeetingId
          },
        ],
        formative: [
          {
            id: 'asm-form-meet-1',
            type: 'FORMATIVE',
            technique: 'Observasi',
            instrument: 'Rubrik Diskusi',
            linkedTpIds: ['tp-101'],
            learningMeetingId: 'meet-101', // Per pertemuan 1
            description: 'Formatif pertemuan 1',
          },
          {
            id: 'asm-form-meet-2',
            type: 'FORMATIVE',
            technique: 'Unjuk Kerja',
            instrument: 'Tugas Coding',
            linkedTpIds: ['tp-102'],
            learningMeetingId: 'meet-102', // Per pertemuan 2
            description: 'Formatif pertemuan 2',
          },
          {
            id: 'asm-form-chapter',
            type: 'FORMATIVE',
            technique: 'Jurnal Reflektif',
            instrument: 'Lembar Refleksi',
            linkedTpIds: ['tp-101', 'tp-102'],
            description: 'Formatif menyeluruh tingkat Bab',
            // No learningMeetingId
          },
        ],
        summative: [
          {
            id: 'asm-sum-chapter',
            type: 'SUMMATIVE',
            technique: 'Tes Tertulis',
            instrument: 'Soal Evaluasi Bab',
            linkedTpIds: ['tp-101', 'tp-102'],
            description: 'Sumatif akhir Bab',
            // No learningMeetingId
          },
        ],
      },
    });

    const result = validateLearningPlan(hybridPlan, {
      academicSetting: mockSettingSem1,
      tp: mockTpData,
      atp: mockAtpData,
      scheduledMeetings: canonicalScheduleProjections,
    });

    assert(
      result.isValid,
      'Perencanaan dengan kombinasi asesmen tingkat Bab dan per pertemuan harus valid',
      result.errors.join('; ')
    );
  }

  console.log(`\n==========================================`);
  console.log(`TOTAL PASSED: ${passedCount}`);
  console.log(`TOTAL FAILED: ${failedCount}`);
  console.log(`==========================================`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

runRegressionSuite();
