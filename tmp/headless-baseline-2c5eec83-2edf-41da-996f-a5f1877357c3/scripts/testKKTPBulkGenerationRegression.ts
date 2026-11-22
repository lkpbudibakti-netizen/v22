import {
  performBulkKKTPGeneration,
  createDefaultKKTPCriterionForTP,
  isCriterionProtectedFromAIOverwrite,
} from '../src/components/administration/KKTPManager';
import { TPData, TPItem, AssessmentCriterion, AcademicSetting } from '../src/types';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${msg}`);
  }
}

console.log('--- STARTING REGRESSION TESTS FOR KKTP BULK GENERATION ---');

const mockSetting: AcademicSetting = {
  id: 'setting-001',
  profileId: 'prof-001', curriculum: 'Kurikulum Merdeka', semester: '1 (Ganjil)', level: 'SD',
  academicYear: '2026/2027',
  subject: 'Matematika',
  grade: 'Kelas 4',
  phase: 'B',
  curriculumType: 'KURIKULUM_MERDEKA',
  updatedAt: '2026-10-08T00:00:00.000Z',
};

function createMockTP(count: number, workflowStatus: TPData['workflowStatus'] = 'SIAP', needsReview = false): TPData {
  const items: TPItem[] = Array.from({ length: count }, (_, i) => ({
    id: `tp-item-${i + 1}`,
    code: `TP-0${i + 1}`,
    statement: `Tujuan Pembelajaran ${i + 1}`,
    competence: `Kompetensi ${i + 1}`,
    contentScope: `Materi ${i + 1}`,
    order: i + 1,
    sequence: i + 1,
    status: 'DRAFT',
  }));

  return {
    id: 'tp-data-001',
    academicSettingId: 'setting-001',
    workspaceId: 'ws-001',
    academicYear: '2026/2027',
    subjectCode: 'Matematika',
    phase: 'B',
    items,
    status: 'DRAFT',
    workflowStatus,
    needsReview,
    updatedAt: '2026-10-08T01:00:00.000Z',
  };
}

// ==========================================
// 1. POSITIVE: 4 TP, 0 criterion -> generate 4 DRAFT
// ==========================================
console.log('Test 1: 4 TP, 0 criterion -> generates 4 DRAFT');
const tp4 = createMockTP(4);
const res1 = performBulkKKTPGeneration({
  tp: tp4,
  academicSetting: mockSetting,
  existingCriteria: [],
});
assert(res1.canGenerate === true, 'Harus canGenerate === true');
assert(res1.totalTPCount === 4, 'totalTPCount harus 4');
assert(res1.existingCount === 0, 'existingCount harus 0');
assert(res1.missingCount === 4, 'missingCount harus 4');
assert(res1.newCriteria.length === 4, 'newCriteria count harus 4');
assert(res1.finalCriteria.length === 4, 'finalCriteria count harus 4');

// ==========================================
// 2. POSITIVE: criterion baru properties
// ==========================================
console.log('Test 2: Validasi properti criterion baru');
for (let i = 0; i < res1.newCriteria.length; i++) {
  const c = res1.newCriteria[i];
  const targetTp = tp4.items[i];
  assert(c.generatedBy === 'AI', 'generatedBy harus AI');
  assert(c.workflowStatus === 'DRAFT', 'workflowStatus harus DRAFT');
  assert(c.needsReview === false, 'needsReview harus false');
  assert(c.basedOnTpUpdatedAt === tp4.updatedAt, 'basedOnTpUpdatedAt harus sesuai TP.updatedAt');
  assert(c.tpId === targetTp.id, 'tpId harus sesuai TP item id');
  assert(c.academicSettingId === mockSetting.id, 'academicSettingId harus sesuai setting');
  assert(c.approach === 'rubrik', 'approach default harus rubrik');
}

// ==========================================
// 3. POSITIVE: final merge mempertahankan existing criteria
// ==========================================
console.log('Test 3: Final merge mempertahankan existing criteria');
const existing1: AssessmentCriterion = {indicators: [], levels: [],
  id: 'crit-exist-1',
  academicSettingId: mockSetting.id,
  tpId: 'tp-item-1',
  description: 'Existing criterion 1',
  approach: 'rubrik',
  passingThreshold: null,
  workflowStatus: 'DRAFT',
  generatedBy: 'AI',
  needsReview: false,
  updatedAt: '2026-10-07T00:00:00.000Z',
};
const res3 = performBulkKKTPGeneration({
  tp: tp4,
  academicSetting: mockSetting,
  existingCriteria: [existing1],
});
assert(res3.finalCriteria.length === 4, 'Total finalCriteria harus 4 (1 existing + 3 new)');
assert(res3.finalCriteria[0] === existing1, 'Existing criterion harus berada di finalCriteria tanpa modifikasi');
assert(res3.existingCount === 1, 'existingCount harus 1');
assert(res3.missingCount === 3, 'missingCount harus 3');

// ==========================================
// 4. PRESERVE: existing SIAP tidak berubah
// ==========================================
console.log('Test 4: Existing SIAP tidak berubah');
const existingSiap: AssessmentCriterion = {indicators: [], levels: [],
  id: 'crit-siap-1',
  academicSettingId: mockSetting.id,
  tpId: 'tp-item-1',
  description: 'KKTP SIAP Konfirmasi Guru',
  approach: 'rubrik',
  passingThreshold: null,
  workflowStatus: 'SIAP',
  generatedBy: 'TEACHER',
  needsReview: false,
  updatedAt: '2026-10-07T10:00:00.000Z',
};
const res4 = performBulkKKTPGeneration({
  tp: tp4,
  academicSetting: mockSetting,
  existingCriteria: [existingSiap],
});
const foundSiap = res4.finalCriteria.find((c) => c.tpId === 'tp-item-1');
assert(foundSiap !== undefined, 'Criterion untuk tp-item-1 harus ada');
assert(foundSiap?.id === 'crit-siap-1', 'ID criterion tidak boleh berubah');
assert(foundSiap?.workflowStatus === 'SIAP', 'workflowStatus SIAP harus preserved');
assert(foundSiap?.description === 'KKTP SIAP Konfirmasi Guru', 'description harus preserved');

// ==========================================
// 5. PRESERVE: existing PERLU_DILENGKAPI tidak berubah
// ==========================================
console.log('Test 5: Existing PERLU_DILENGKAPI tidak berubah');
const existingPerlu: AssessmentCriterion = {indicators: [], levels: [],
  id: 'crit-perlu-2',
  academicSettingId: mockSetting.id,
  tpId: 'tp-item-2',
  description: 'KKTP Perlu Dilengkapi',
  approach: 'deskripsi',
  passingThreshold: null,
  workflowStatus: 'PERLU_DILENGKAPI',
  generatedBy: 'AI',
  needsReview: true,
  reviewReason: 'Indikator belum lengkap',
  updatedAt: '2026-10-07T11:00:00.000Z',
};
const res5 = performBulkKKTPGeneration({
  tp: tp4,
  academicSetting: mockSetting,
  existingCriteria: [existingPerlu],
});
const foundPerlu = res5.finalCriteria.find((c) => c.tpId === 'tp-item-2');
assert(foundPerlu?.workflowStatus === 'PERLU_DILENGKAPI', 'PERLU_DILENGKAPI harus preserved');
assert(foundPerlu?.needsReview === true, 'needsReview true harus preserved');
assert(foundPerlu?.reviewReason === 'Indikator belum lengkap', 'reviewReason harus preserved');

// ==========================================
// 6. PRESERVE: existing DRAFT TEACHER tidak berubah
// ==========================================
console.log('Test 6: Existing DRAFT TEACHER tidak berubah');
const existingDraftTeacher: AssessmentCriterion = {indicators: [], levels: [],
  id: 'crit-teacher-3',
  academicSettingId: mockSetting.id,
  tpId: 'tp-item-3',
  description: 'Draft Mandiri Oleh Guru',
  approach: 'skala_interval',
  passingThreshold: null,
  workflowStatus: 'DRAFT',
  generatedBy: 'TEACHER',
  needsReview: false,
  updatedAt: '2026-10-07T12:00:00.000Z',
};
const res6 = performBulkKKTPGeneration({
  tp: tp4,
  academicSetting: mockSetting,
  existingCriteria: [existingDraftTeacher],
});
const foundTeacher = res6.finalCriteria.find((c) => c.tpId === 'tp-item-3');
assert(foundTeacher?.generatedBy === 'TEACHER', 'generatedBy TEACHER harus preserved');
assert(foundTeacher?.description === 'Draft Mandiri Oleh Guru', 'description harus preserved');

// ==========================================
// 7. PRESERVE: existing AI_EDITED_BY_TEACHER tidak berubah
// ==========================================
console.log('Test 7: Existing AI_EDITED_BY_TEACHER tidak berubah');
const existingAiEdited: AssessmentCriterion = {indicators: [], levels: [],
  id: 'crit-edited-4',
  academicSettingId: mockSetting.id,
  tpId: 'tp-item-4',
  description: 'AI Rekomendasi Diedit Guru',
  approach: 'rubrik',
  passingThreshold: null,
  workflowStatus: 'DRAFT',
  generatedBy: 'AI_EDITED_BY_TEACHER',
  needsReview: false,
  updatedAt: '2026-10-07T13:00:00.000Z',
};
const res7 = performBulkKKTPGeneration({
  tp: tp4,
  academicSetting: mockSetting,
  existingCriteria: [existingAiEdited],
});
const foundEdited = res7.finalCriteria.find((c) => c.tpId === 'tp-item-4');
assert(foundEdited?.generatedBy === 'AI_EDITED_BY_TEACHER', 'generatedBy AI_EDITED_BY_TEACHER harus preserved');
assert(foundEdited?.description === 'AI Rekomendasi Diedit Guru', 'description harus preserved');

// ==========================================
// 8. PRESERVE: existing AI DRAFT pada bulk tidak di-generate ulang
// ==========================================
console.log('Test 8: Existing AI DRAFT pada bulk tidak di-generate ulang');
const existingAiDraft: AssessmentCriterion = {indicators: [], levels: [],
  id: 'crit-ai-draft-1',
  academicSettingId: mockSetting.id,
  tpId: 'tp-item-1',
  description: 'Kustom teks dari AI DRAFT sebelumnya',
  approach: 'rubrik',
  passingThreshold: null,
  workflowStatus: 'DRAFT',
  generatedBy: 'AI',
  needsReview: false,
  updatedAt: '2026-10-06T08:00:00.000Z',
};
const res8 = performBulkKKTPGeneration({
  tp: tp4,
  academicSetting: mockSetting,
  existingCriteria: [existingAiDraft],
});
const foundAiDraft = res8.finalCriteria.find((c) => c.tpId === 'tp-item-1');
assert(foundAiDraft?.id === 'crit-ai-draft-1', 'ID AI DRAFT existing harus tetap sama');
assert(foundAiDraft?.description === 'Kustom teks dari AI DRAFT sebelumnya', 'AI DRAFT tidak boleh digenerate ulang');
assert(res8.missingCount === 3, 'Hanya TP yang belum ada yang digenerate');

// ==========================================
// 9. MIXED: 5 TP: 2 existing, 3 missing -> hanya menghasilkan 3 criterion baru
// ==========================================
console.log('Test 9: 5 TP: 2 existing, 3 missing -> 3 new criteria');
const tp5 = createMockTP(5);
const existingCritA: AssessmentCriterion = {indicators: [], levels: [],
  id: 'crit-a',
  academicSettingId: mockSetting.id,
  tpId: 'tp-item-1',
  description: 'Crit A',
  approach: 'rubrik',
  passingThreshold: null,
  workflowStatus: 'SIAP',
  generatedBy: 'TEACHER',
  needsReview: false,
  updatedAt: '2026-10-07T00:00:00.000Z',
};
const existingCritB: AssessmentCriterion = {indicators: [], levels: [],
  id: 'crit-b',
  academicSettingId: mockSetting.id,
  tpId: 'tp-item-3',
  description: 'Crit B',
  approach: 'rubrik',
  passingThreshold: null,
  workflowStatus: 'DRAFT',
  generatedBy: 'AI',
  needsReview: false,
  updatedAt: '2026-10-07T00:00:00.000Z',
};
const res9 = performBulkKKTPGeneration({
  tp: tp5,
  academicSetting: mockSetting,
  existingCriteria: [existingCritA, existingCritB],
});
assert(res9.totalTPCount === 5, 'totalTPCount harus 5');
assert(res9.existingCount === 2, 'existingCount harus 2');
assert(res9.missingCount === 3, 'missingCount harus 3');
assert(res9.newCriteria.length === 3, 'newCriteria.length harus 3');
assert(res9.finalCriteria.length === 5, 'finalCriteria.length harus 5');
const newTpIds = res9.newCriteria.map((c) => c.tpId);
assert(newTpIds.includes('tp-item-2'), 'Harus generate tp-item-2');
assert(newTpIds.includes('tp-item-4'), 'Harus generate tp-item-4');
assert(newTpIds.includes('tp-item-5'), 'Harus generate tp-item-5');
assert(!newTpIds.includes('tp-item-1'), 'Tidak boleh generate tp-item-1');
assert(!newTpIds.includes('tp-item-3'), 'Tidak boleh generate tp-item-3');

// ==========================================
// 10. NO-OP: semua TP sudah punya criterion -> generated count 0
// ==========================================
console.log('Test 10: Semua TP sudah punya criterion -> missingCount 0');
const allExisting: AssessmentCriterion[] = tp4.items.map((item, idx) => ({indicators: [], levels: [],
  id: `crit-all-${idx + 1}`,
  academicSettingId: mockSetting.id,
  tpId: item.id,
  description: `Existing ${item.statement}`,
  approach: 'rubrik',
  passingThreshold: null,
  workflowStatus: idx % 2 === 0 ? 'SIAP' : 'DRAFT',
  generatedBy: 'TEACHER',
  needsReview: false,
  updatedAt: '2026-10-07T00:00:00.000Z',
}));
const res10 = performBulkKKTPGeneration({
  tp: tp4,
  academicSetting: mockSetting,
  existingCriteria: allExisting,
});
assert(res10.canGenerate === true, 'canGenerate harus true');
assert(res10.missingCount === 0, 'missingCount harus 0');
assert(res10.newCriteria.length === 0, 'newCriteria.length harus 0');
assert(res10.finalCriteria.length === 4, 'finalCriteria.length harus 4');

// ==========================================
// 11. UPSTREAM BLOCK: TP workflowStatus bukan SIAP -> bulk blocked
// ==========================================
console.log('Test 11: TP workflowStatus bukan SIAP -> bulk blocked');
const tpDraft = createMockTP(4, 'DRAFT', false);
const res11 = performBulkKKTPGeneration({
  tp: tpDraft,
  academicSetting: mockSetting,
  existingCriteria: [],
});
assert(res11.canGenerate === false, 'canGenerate harus false');
assert(!!res11.blockedReason, 'blockedReason harus ada');
assert(res11.newCriteria.length === 0, 'newCriteria harus kosong');
assert(res11.finalCriteria.length === 0, 'finalCriteria harus tetap sesuai existing');

const tpPerlu = createMockTP(4, 'PERLU_DILENGKAPI', false);
const res11b = performBulkKKTPGeneration({
  tp: tpPerlu,
  academicSetting: mockSetting,
  existingCriteria: [],
});
assert(res11b.canGenerate === false, 'canGenerate harus false jika TP PERLU_DILENGKAPI');

// ==========================================
// 12. UPSTREAM BLOCK: TP needsReview true -> bulk blocked
// ==========================================
console.log('Test 12: TP needsReview true -> bulk blocked');
const tpReview = createMockTP(4, 'SIAP', true);
const res12 = performBulkKKTPGeneration({
  tp: tpReview,
  academicSetting: mockSetting,
  existingCriteria: [],
});
assert(res12.canGenerate === false, 'canGenerate harus false ketika needsReview true');
assert(!!res12.blockedReason, 'blockedReason harus ada');
assert(res12.newCriteria.length === 0, 'newCriteria harus kosong');

// ==========================================
// 13. SAFETY: Per-TP generation safety - protection check
// ==========================================
console.log('Test 13: Per-TP generation safety - protection check');
assert(
  isCriterionProtectedFromAIOverwrite({indicators: [], levels: [],
    id: 'c1',
    academicSettingId: 's1',
    tpId: 't1',
    description: '',
    approach: 'rubrik',
    passingThreshold: null,
    workflowStatus: 'SIAP',
    generatedBy: 'AI',
    needsReview: false,
    updatedAt: '',
  }) === true,
  'Status SIAP harus diproteksi dari overwrite'
);

assert(
  isCriterionProtectedFromAIOverwrite({indicators: [], levels: [],
    id: 'c2',
    academicSettingId: 's1',
    tpId: 't1',
    description: '',
    approach: 'rubrik',
    passingThreshold: null,
    workflowStatus: 'DRAFT',
    generatedBy: 'TEACHER',
    needsReview: false,
    updatedAt: '',
  }) === true,
  'generatedBy TEACHER harus diproteksi dari overwrite'
);

assert(
  isCriterionProtectedFromAIOverwrite({indicators: [], levels: [],
    id: 'c3',
    academicSettingId: 's1',
    tpId: 't1',
    description: '',
    approach: 'rubrik',
    passingThreshold: null,
    workflowStatus: 'DRAFT',
    generatedBy: 'AI_EDITED_BY_TEACHER',
    needsReview: false,
    updatedAt: '',
  }) === true,
  'generatedBy AI_EDITED_BY_TEACHER harus diproteksi dari overwrite'
);

assert(
  isCriterionProtectedFromAIOverwrite({indicators: [], levels: [],
    id: 'c4',
    academicSettingId: 's1',
    tpId: 't1',
    description: '',
    approach: 'rubrik',
    passingThreshold: null,
    workflowStatus: 'DRAFT',
    generatedBy: 'AI',
    needsReview: false,
    updatedAt: '',
  }) === false,
  'Plain AI DRAFT boleh di-regenerate'
);

// ==========================================
// 14. K13 CURRICULUM: Bulk generation blocked
// ==========================================
console.log('Test 14: K13 Curriculum bulk generation blocked');
const resK13 = performBulkKKTPGeneration({
  tp: tp4,
  academicSetting: { ...mockSetting, curriculumType: 'K13' },
  existingCriteria: [],
  isK13Curriculum: true,
});
assert(resK13.canGenerate === false, 'K13 harus diblock dari bulk generate');

console.log('--- ALL KKTP BULK GENERATION REGRESSION TESTS PASSED SUCCESSFULLY ---');
