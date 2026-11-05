import { performImportProjectTransferInState } from '../src/services/projectTransferImportService';
import { validateProjectTransfer } from '../src/services/projectTransferService';
import { createInitialStorageV5 } from '../src/services/storageV5';
import { ProjectTransferPackage } from '../src/types/projectTransfer';
import { validateWorkflowDependencies } from '../src/services/workflowEngine';
import { validateTPDataWorkflow } from '../src/services/cpWorkflowService';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${msg}`);
  }
}

console.log('--- STARTING REGRESSION TESTS FOR PROJECT TRANSFER CANONICAL BRIDGE ---');

// Setup mock V5 state
function createTestState() {
  const state = createInitialStorageV5();
  state.profiles.push({
    id: 'prof-001',
    name: 'Budi Santoso',
    nip: '19850101',
    status: 'PNS',
    defaultSubject: 'Matematika',
    defaultLevel: 'SD',
    schoolId: 'sch-001',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  state.schools.push({
    id: 'sch-001',
    name: 'SD Negeri 1 Merdeka',
    npsn: '12345678',
    address: 'Jl. Pendidikan No. 1',
    village: 'Merdeka',
    district: 'Kota',
    regency: 'Kota',
    province: 'Provinsi',
    principalName: 'Dr. Sutrisno',
    principalNip: '19700101',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return state;
}

// ==========================================
// SCENARIO A: Valid Merdeka v1
// ==========================================
console.log('Testing Scenario A: Valid Merdeka v1...');
{
  const state = createTestState();
  const pkg: ProjectTransferPackage = {
    schemaVersion: '1.0',
    academicYear: '2026/2027',
    curriculumType: 'KURIKULUM_MERDEKA',
    level: 'SD',
    grade: 'Kelas 4',
    phase: 'B',
    subject: 'Matematika',
    cp: [
      {
        code: 'E1',
        element: 'Bilangan',
        content: 'Pada akhir Fase B, peserta didik menunjukkan pemahaman dan intuisi bilangan pada bilangan cacah sampai 10.000.',
      },
    ],
    tp: [
      {
        code: 'E1-BLG-01',
        cpCode: 'E1',
        statement: 'Membaca dan menuliskan bilangan cacah sampai 10.000.',
        competence: 'Membaca dan menuliskan',
        materialScope: 'Bilangan cacah sampai 10.000',
      },
      {
        code: 'E1-BLG-02',
        cpCode: 'E1',
        statement: 'Membandingkan dan mengurutkan bilangan cacah sampai 10.000.',
        competence: 'Membandingkan dan mengurutkan',
        materialScope: 'Bilangan cacah sampai 10.000',
      },
    ],
    atp: [
      {
        order: 1,
        tpCode: 'E1-BLG-01',
        material: 'Bilangan cacah sampai 10.000',
        jp: 4,
        semester: 1,
      },
      {
        order: 2,
        tpCode: 'E1-BLG-02',
        material: 'Bilangan cacah sampai 10.000',
        jp: 4,
        semester: 1,
      },
    ],
  };

  const res = performImportProjectTransferInState(state, {
    pkg,
    profileId: 'prof-001',
    schoolId: 'sch-001',
  });

  // CP checks
  assert(res.cp.elements.length === 1, 'CP elements count harus 1');
  assert(res.cp.elements[0].code === 'E1', 'Internal code CP element harus E1');
  assert(res.cp.workflowStatus === 'PERLU_DILENGKAPI', `CP workflowStatus harus PERLU_DILENGKAPI (got ${res.cp.workflowStatus})`);

  // CP Analysis must NOT be created synthetically from TP
  assert(res.cpAnalysis === undefined, 'CPAnalysis tidak boleh dibuat secara sintetis saat import Merdeka');
  const storedCpAnalysis = state.annualData.cpAnalysis.find((e) => e.yearPlanId === res.yearPlan.id);
  assert(!storedCpAnalysis, 'CPAnalysis tidak boleh tersimpan di state.annualData.cpAnalysis saat import');

  // TP checks: draft seed, review flagged, workflowStatus PERLU_DILENGKAPI
  assert(res.tp.items.length === 2, 'TP items count harus 2');
  assert(res.tp.items[0].cpAnalysisItemIds === undefined, 'TP item 0 cpAnalysisItemIds harus undefined (tidak ada fake linkage)');
  assert((res.tp.items[0] as any).needsReview === undefined, 'TPItem tidak boleh memiliki needsReview');
  assert(res.tp.needsReview === true, 'TPData needsReview harus true');
  assert(res.tp.workflowStatus === 'PERLU_DILENGKAPI', `TP workflowStatus harus PERLU_DILENGKAPI (got ${res.tp.workflowStatus})`);
  assert(res.tp.status === 'DRAFT', `TP status harus DRAFT (got ${res.tp.status})`);

  // ATP checks
  assert(res.atp.items[0].linkedTpIds?.length === 1, 'ATP item 0 linkedTpIds harus berisikan ID TP');
  assert(res.atp.items[0].linkedTpIds?.[0] === res.tp.items[0].id, 'linkedTpIds[0] harus merujuk ke TPItem.id internal');
  assert(res.atp.workflowStatus === 'DRAFT', `ATP workflowStatus harus DRAFT (got ${res.atp.workflowStatus})`);
  assert(res.atp.status === 'DRAFT', `ATP status harus DRAFT (got ${res.atp.status})`);
  assert(res.atp.items[0].focus === undefined, 'Focus ATP item 0 harus undefined');
}

// ==========================================
// SCENARIO B: Missing competence / materialScope
// ==========================================
console.log('Testing Scenario B: Missing competence / materialScope...');
{
  const state = createTestState();
  const pkg: ProjectTransferPackage = {
    schemaVersion: '1.0',
    academicYear: '2026/2027',
    curriculumType: 'KURIKULUM_MERDEKA',
    level: 'SD',
    grade: 'Kelas 4',
    phase: 'B',
    subject: 'Matematika',
    cp: [
      {
        code: 'E1',
        element: 'Bilangan',
        content: 'Deskripsi elemen bilangan.',
      },
    ],
    tp: [
      {
        code: 'E1-BLG-01',
        cpCode: 'E1',
        statement: 'Membaca bilangan cacah sampai 10.000.',
        competence: '', // Kosong!
        materialScope: '', // Kosong!
      },
    ],
    atp: [
      {
        order: 1,
        tpCode: 'E1-BLG-01',
      },
    ],
  };

  const validation = validateProjectTransfer(pkg);
  assert(validation.isValid, 'Validation harus berhasil (isValid: true) bila competence/materialScope kosong pada Merdeka');
  assert(validation.errors.length === 0, 'Tidak boleh ada blocking error untuk competence/materialScope kosong');
  assert(validation.warnings.some((e) => e.code === 'EMPTY_TP_COMPETENCE'), 'Harus ada warning EMPTY_TP_COMPETENCE');
  assert(validation.warnings.some((e) => e.code === 'EMPTY_TP_MATERIAL_SCOPE'), 'Harus ada warning EMPTY_TP_MATERIAL_SCOPE');

  const res = performImportProjectTransferInState(state, {
    pkg,
    profileId: 'prof-001',
    schoolId: 'sch-001',
  });

  assert(res.tp.items[0].competence === '', 'Import harus mempertahankan competence kosong apa adanya tanpa sintesis');
  assert(res.tp.items[0].contentScope === '', 'Import harus mempertahankan contentScope kosong apa adanya tanpa sintesis');
  assert(res.cpAnalysis === undefined, 'CP Analysis tidak boleh dibuat saat import');
  assert(res.tp.workflowStatus === 'PERLU_DILENGKAPI', 'TP harus berstatus PERLU_DILENGKAPI sehingga ATP terkunci');
}

// ==========================================
// SCENARIO C: Invalid legacy TP code
// ==========================================
console.log('Testing Scenario C: Invalid legacy TP code...');
{
  const state = createTestState();
  const pkg: ProjectTransferPackage = {
    schemaVersion: '1.0',
    academicYear: '2026/2027',
    curriculumType: 'KURIKULUM_MERDEKA',
    level: 'SD',
    grade: 'Kelas 4',
    phase: 'B',
    subject: 'Matematika',
    cp: [
      {
        code: 'E1',
        element: 'Bilangan',
        content: 'Deskripsi elemen bilangan.',
      },
    ],
    tp: [
      {
        code: 'TP-01', // Kode legacy non-canonical (bukan E1-BLG-01)
        cpCode: 'E1',
        statement: 'Membaca bilangan cacah.',
        competence: 'Membaca',
        materialScope: 'Bilangan cacah',
      },
    ],
    atp: [
      {
        order: 1,
        tpCode: 'TP-01',
      },
    ],
  };

  const validation = validateProjectTransfer(pkg);
  assert(validation.isValid, 'Validation harus berhasil (isValid: true) untuk kode TP non-canonical pada Merdeka');
  assert(validation.errors.length === 0, 'Tidak boleh ada blocking error untuk kode TP non-canonical');
  assert(validation.warnings.some((e) => e.code === 'INVALID_MERDEKA_TP_CODE'), 'Harus ada warning INVALID_MERDEKA_TP_CODE');

  const res = performImportProjectTransferInState(state, {
    pkg,
    profileId: 'prof-001',
    schoolId: 'sch-001',
  });

  assert(res.tp.items[0].code === 'TP-01', 'Import harus mempertahankan kode TP asli apa adanya');
  assert(res.tp.workflowStatus === 'PERLU_DILENGKAPI', 'TP harus berstatus PERLU_DILENGKAPI karena kode non-canonical sehingga ATP terkunci');
}

// ==========================================
// SCENARIO D: ATP import
// ==========================================
console.log('Testing Scenario D: ATP import...');
{
  const state = createTestState();
  const pkg: ProjectTransferPackage = {
    schemaVersion: '1.0',
    academicYear: '2026/2027',
    curriculumType: 'KURIKULUM_MERDEKA',
    level: 'SD',
    grade: 'Kelas 4',
    phase: 'B',
    subject: 'Matematika',
    cp: [
      {
        code: 'E1',
        element: 'Bilangan',
        content: 'Deskripsi elemen.',
      },
    ],
    tp: [
      {
        code: 'E1-BLG-01',
        cpCode: 'E1',
        statement: 'Membaca bilangan.',
        competence: 'Membaca',
        materialScope: 'Bilangan',
      },
    ],
    atp: [
      {
        order: 1,
        tpCode: 'E1-BLG-01',
        unit: 'Unit 1',
        material: 'Bilangan',
      },
    ],
  };

  const res = performImportProjectTransferInState(state, {
    pkg,
    profileId: 'prof-001',
    schoolId: 'sch-001',
  });

  const atpItem = res.atp.items[0];
  assert(atpItem.linkedTpIds?.length === 1, 'linkedTpIds harus berisi 1 ID');
  assert(atpItem.linkedTpIds?.[0] === res.tp.items[0].id, 'linkedTpIds harus merujuk ke TPItem.id internal');
  assert(atpItem.focus === undefined, 'focus ATP import tidak boleh dibuat secara sintetis');
  assert(res.atp.workflowStatus === 'DRAFT', 'ATP workflowStatus harus DRAFT');
}

// ==========================================
// SCENARIO E: K13
// ==========================================
console.log('Testing Scenario E: K13 curriculum...');
{
  const state = createTestState();
  const pkg: ProjectTransferPackage = {
    schemaVersion: '1.0',
    academicYear: '2026/2027',
    curriculumType: 'K13',
    level: 'SD',
    grade: 'Kelas 4',
    phase: 'B',
    subject: 'Matematika',
    cp: [
      {
        code: 'KD3.1',
        element: 'Pengetahuan',
        content: 'Memahami sifat-sifat operasi hitung.',
      },
    ],
    tp: [
      {
        code: 'KD3.1-01',
        cpCode: 'KD3.1',
        statement: 'Menjelaskan sifat komutatif.',
        competence: 'Menjelaskan',
        materialScope: 'Sifat komutatif',
      },
    ],
    atp: [
      {
        order: 1,
        tpCode: 'KD3.1-01',
      },
    ],
  };

  const res = performImportProjectTransferInState(state, {
    pkg,
    profileId: 'prof-001',
    schoolId: 'sch-001',
  });

  assert(res.cpAnalysis === undefined, 'K13 tidak boleh membuat synthetic CPAnalysis Merdeka');
  const storedCpAnalysis = state.annualData.cpAnalysis.filter((e) => e.yearPlanId === res.yearPlan.id);
  assert(storedCpAnalysis.length === 0, 'K13 tidak boleh menyimpan CPAnalysis di annualData');
}

// ==========================================
// SCENARIO F: TP valid secara isi tapi cpCode kosong
// ==========================================
console.log('Testing Scenario F: TP valid secara isi tapi cpCode kosong...');
{
  const state = createTestState();
  const pkg: ProjectTransferPackage = {
    schemaVersion: '1.0',
    academicYear: '2026/2027',
    curriculumType: 'KURIKULUM_MERDEKA',
    level: 'SD',
    grade: 'Kelas 4',
    phase: 'B',
    subject: 'Matematika',
    cp: [
      {
        code: 'E1',
        element: 'Bilangan',
        content: 'Deskripsi elemen bilangan.',
      },
    ],
    tp: [
      {
        code: 'E1-BLG-01',
        cpCode: '', // cpCode kosong!
        statement: 'Membaca bilangan cacah sampai 10.000.',
        competence: 'Membaca',
        materialScope: 'Bilangan cacah sampai 10.000',
      },
    ],
    atp: [
      {
        order: 1,
        tpCode: 'E1-BLG-01',
      },
    ],
  };

  const validation = validateProjectTransfer(pkg);
  assert(!validation.isValid, 'Validation harus gagal bila cpCode kosong pada Merdeka');
  assert(validation.errors.some((e) => e.code === 'EMPTY_TP_CP_REF'), 'Harus ada error EMPTY_TP_CP_REF');

  let importThrew = false;
  try {
    performImportProjectTransferInState(state, {
      pkg,
      profileId: 'prof-001',
      schoolId: 'sch-001',
    });
  } catch (err: any) {
    importThrew = true;
    assert(err.message.includes('ProjectTransferPackage tidak valid'), 'Pesan error import harus menunjukkan package tidak valid');
  }
  assert(importThrew, 'Import harus ditolak bila cpCode kosong pada Merdeka');
}

// ==========================================
// SCENARIO G: CP element kosong & TP merujuk cpCode E1
// ==========================================
console.log('Testing Scenario G: CP element kosong & TP merujuk cpCode E1...');
{
  const state = createTestState();
  const pkg: ProjectTransferPackage = {
    schemaVersion: '1.0',
    academicYear: '2026/2027',
    curriculumType: 'KURIKULUM_MERDEKA',
    level: 'SD',
    grade: 'Kelas 4',
    phase: 'B',
    subject: 'Matematika',
    cp: [
      {
        code: 'E1',
        element: '', // element CP kosong!
        content: 'Konten CP valid',
      },
    ],
    tp: [
      {
        code: 'E1-BLG-01',
        cpCode: 'E1',
        statement: 'Membaca bilangan cacah.',
        competence: 'Membaca',
        materialScope: 'Bilangan cacah',
      },
    ],
    atp: [
      {
        order: 1,
        tpCode: 'E1-BLG-01',
      },
    ],
  };

  const validation = validateProjectTransfer(pkg);
  assert(validation.isValid, 'Validation harus berhasil (isValid: true) bila CP element kosong pada Merdeka');
  assert(validation.errors.length === 0, 'Tidak boleh ada blocking error untuk CP element kosong');
  assert(validation.warnings.some((e) => e.code === 'EMPTY_CP_ELEMENT'), 'Harus ada warning EMPTY_CP_ELEMENT');

  const res = performImportProjectTransferInState(state, {
    pkg,
    profileId: 'prof-001',
    schoolId: 'sch-001',
  });

  assert(res.cp.elements[0].name === '', 'Import harus mempertahankan elementName kosong apa adanya tanpa sintesis');
  assert(res.cp.elements[0].code === 'E1', 'Internal element code harus E1');
  assert(res.cp.workflowStatus === 'PERLU_DILENGKAPI', 'CP Analysis harus berstatus PERLU_DILENGKAPI');
  assert(res.cpAnalysis === undefined, 'CP Analysis tidak boleh dibuat saat import');
  assert(res.tp.workflowStatus === 'PERLU_DILENGKAPI', 'TP harus berstatus PERLU_DILENGKAPI sehingga ATP terkunci');
}

// ==========================================
// SCENARIO H: K13 Field Isolation
// ==========================================
console.log('Testing Scenario H: K13 Field Isolation...');
{
  const state = createTestState();
  const pkg: ProjectTransferPackage = {
    schemaVersion: '1.0',
    academicYear: '2026/2027',
    curriculumType: 'K13',
    level: 'SD',
    grade: 'Kelas 4',
    phase: 'B',
    subject: 'Matematika',
    cp: [
      {
        code: 'KD3.1',
        element: 'Pengetahuan',
        content: 'Memahami sifat-sifat operasi hitung.',
      },
    ],
    tp: [
      {
        code: 'KD3.1-01',
        cpCode: 'KD3.1',
        statement: 'Menjelaskan sifat komutatif.',
        competence: 'Menjelaskan',
        materialScope: 'Sifat komutatif',
      },
    ],
    atp: [
      {
        order: 1,
        tpCode: 'KD3.1-01',
      },
    ],
  };

  const res = performImportProjectTransferInState(state, {
    pkg,
    profileId: 'prof-001',
    schoolId: 'sch-001',
  });

  assert(res.cpAnalysis === undefined, 'K13 cpAnalysis harus undefined');
  assert(res.yearPlan.subjectCode === undefined, 'K13 yearPlan.subjectCode harus undefined');
  assert(res.tp.cpId === undefined, 'K13 tp.cpId harus undefined');
  assert(res.tp.subjectCode === undefined, 'K13 tp.subjectCode harus undefined');
  assert(res.tp.basedOnCpUpdatedAt === undefined, 'K13 tp.basedOnCpUpdatedAt harus undefined');
  assert(res.atp.items[0].linkedTpIds === undefined, 'K13 atp.items[0].linkedTpIds harus undefined');
  assert(res.atp.subjectCode === undefined, 'K13 atp.subjectCode harus undefined');
  assert(res.atp.basedOnTpUpdatedAt === undefined, 'K13 atp.basedOnTpUpdatedAt harus undefined');
}

// ==========================================
// SCENARIO I: K13 Permissive Contract (Non-Canonical TP, missing element/competence are warnings only)
// ==========================================
console.log('Testing Scenario I: K13 Permissive Contract...');
{
  const state = createTestState();
  const pkg: ProjectTransferPackage = {
    schemaVersion: '1.0',
    academicYear: '2026/2027',
    curriculumType: 'K13',
    level: 'SD',
    grade: 'Kelas 4',
    phase: 'B',
    subject: 'Matematika',
    cp: [
      {
        code: 'KD3.1',
        element: '', // Empty element allowed as warning in K13
        content: 'Memahami sifat-sifat operasi hitung.',
      },
    ],
    tp: [
      {
        code: 'TP-01', // Non-canonical code allowed in K13
        statement: 'Menjelaskan sifat komutatif.',
        competence: '', // Empty competence allowed as warning in K13
        materialScope: '', // Empty materialScope allowed as warning in K13
      },
    ],
    atp: [
      {
        order: 1,
        tpCode: 'TP-01',
      },
    ],
  };

  const validation = validateProjectTransfer(pkg);
  assert(validation.isValid, 'Validation harus valid untuk K13 meskipun element/competence/materialScope kosong atau TP code non-canonical');
  assert(validation.errors.length === 0, 'K13 tidak boleh menghasilkan ERROR untuk kelonggaran tersebut');
  assert(validation.warnings.length > 0, 'K13 harus menghasilkan WARNING untuk kelonggaran tersebut');

  const res = performImportProjectTransferInState(state, {
    pkg,
    profileId: 'prof-001',
    schoolId: 'sch-001',
  });
  assert(res.tp.items[0].code === 'TP-01', 'K13 import harus mempertahankan kode TP asli');
}

// ==========================================
// SCENARIO J: PJOK Legacy Seed Import & Workflow Chain Authority
// ==========================================
console.log('Testing Scenario J: PJOK Legacy Seed Import & Workflow Chain Authority...');
{
  const state = createTestState();

  const cpList = [
    { code: 'CP-01', element: 'Keterampilan Gerak', content: 'Mempraktikkan keterampilan pola gerak dasar.' },
    { code: 'CP-02', element: 'Pengetahuan Gerak', content: 'Memahami prosedur keterampilan pola gerak dasar.' },
    { code: 'CP-03', element: 'Pemanfaatan Gerak', content: 'Mempraktikkan aktivitas jasmani untuk kesehatan.' },
    { code: 'CP-04', element: 'Pengembangan Karakter', content: 'Menunjukkan perilaku bertanggung jawab dalam aktivitas jasmani.' },
  ];

  const tpList = Array.from({ length: 17 }, (_, i) => {
    const idx = i + 1;
    const code = `TP-${idx < 10 ? '0' + idx : idx}`;
    const cpCode = `CP-0${(i % 4) + 1}`;
    return {
      code,
      cpCode,
      statement: `Mempraktikkan aktivitas pembelajaran gerak dasar ${idx}.`,
      competence: 'Mempraktikkan',
      materialScope: `Pola gerak dasar ${idx}`,
    };
  });

  const atpList = Array.from({ length: 17 }, (_, i) => {
    const idx = i + 1;
    const tpCode = `TP-${idx < 10 ? '0' + idx : idx}`;
    return {
      order: idx,
      tpCode,
      material: `Pola gerak dasar ${idx}`,
    };
  });

  const pkg: ProjectTransferPackage = {
    schemaVersion: '1.0',
    academicYear: '2026/2027',
    curriculumType: 'KURIKULUM_MERDEKA',
    level: 'SD',
    grade: 'Kelas 1',
    phase: 'Fase A',
    subject: 'Pendidikan Jasmani, Olahraga, dan Kesehatan (PJOK)',
    cp: cpList,
    tp: tpList,
    atp: atpList,
  };

  // 1. Validation Pre-Import
  const validation = validateProjectTransfer(pkg);
  assert(validation.isValid, 'Validation harus berhasil (isValid: true) meskipun kode TP legacy dan JP kosong');
  assert(validation.errors.length === 0, 'Tidak boleh ada blocking errors');
  assert(validation.warnings.some((w) => w.code === 'INVALID_MERDEKA_TP_CODE'), 'Harus ada warning INVALID_MERDEKA_TP_CODE');
  assert(validation.warnings.some((w) => w.code === 'ATP_MISSING_JP'), 'Harus ada warning ATP_MISSING_JP');

  // 2. Perform Import
  const res = performImportProjectTransferInState(state, {
    pkg,
    profileId: 'prof-001',
    schoolId: 'sch-001',
  });

  // A. CP Assertions
  assert(res.cp.elements.length === 4, 'CP elements count harus 4');
  assert(res.cp.elements[0].code === 'E1', 'CP element 0 code harus E1');
  assert(res.cp.elements[1].code === 'E2', 'CP element 1 code harus E2');
  assert(res.cp.elements[2].code === 'E3', 'CP element 2 code harus E3');
  assert(res.cp.elements[3].code === 'E4', 'CP element 3 code harus E4');
  assert(res.cp.elements[0].name === 'Keterampilan Gerak', 'Isi nama elemen CP harus tetap sama seperti Excel');
  assert(res.cp.workflowStatus === 'PERLU_DILENGKAPI', 'CP workflowStatus harus PERLU_DILENGKAPI');

  // B. CP Analysis Assertions (must NOT be created synthetically)
  assert(res.cpAnalysis === undefined, 'CPAnalysis tidak boleh dibuat secara sintetis dari 17 TP');
  const storedCpAnalysis = state.annualData.cpAnalysis.find((e) => e.yearPlanId === res.yearPlan.id);
  assert(!storedCpAnalysis, 'CPAnalysis tidak boleh disimpan di state.annualData.cpAnalysis');

  // C. TP Assertions
  assert(res.tp.items.length === 17, 'TP items count harus 17');
  assert(res.tp.items[0].code === 'TP-01', 'Kode TP asli Excel harus dipertahankan');
  assert(res.tp.items[16].code === 'TP-17', 'Kode TP 17 asli Excel harus dipertahankan');
  assert(res.tp.items[0].statement === 'Mempraktikkan aktivitas pembelajaran gerak dasar 1.', 'Statement TP asli dipertahankan');
  assert(res.tp.items[0].competence === 'Mempraktikkan', 'Competence TP asli dipertahankan');
  assert(res.tp.items[0].contentScope === 'Pola gerak dasar 1', 'ContentScope TP asli dipertahankan');
  assert(res.tp.items[0].cpAnalysisItemIds === undefined, 'TP tidak boleh memiliki fake cpAnalysisItemIds');
  assert((res.tp.items[0] as any).needsReview === undefined, 'TPItem tidak boleh memiliki needsReview');
  assert(res.tp.needsReview === true, 'TPData needsReview harus true');
  assert(res.tp.workflowStatus === 'PERLU_DILENGKAPI', 'TP workflowStatus harus PERLU_DILENGKAPI');

  // D. ATP Assertions
  assert(res.atp.items.length === 17, 'ATP items count harus 17');
  assert(res.atp.workflowStatus === 'DRAFT', 'ATP workflowStatus harus DRAFT');
  for (let i = 0; i < 17; i++) {
    const atpItem = res.atp.items[i];
    const expectedTpItem = res.tp.items[i];
    assert(atpItem.linkedTpIds?.length === 1, `ATP item ${i + 1} linkedTpIds harus berisikan 1 ID`);
    assert(atpItem.linkedTpIds?.[0] === expectedTpItem.id, `ATP item ${i + 1} linkedTpIds[0] harus menunjuk ke TPItem internal`);
    assert(atpItem.allocatedJP === null, `ATP item ${i + 1} allocatedJP harus null karena Excel kosong`);
    assert(atpItem.jp === null, `ATP item ${i + 1} jp harus null karena Excel kosong`);
  }

  // E. Workflow Chain Authority Assertions
  const wf = validateWorkflowDependencies({
    profile: state.profiles[0],
    school: state.schools[0],
    academicSetting: {
      id: res.yearPlan.id,
      profileId: state.profiles[0].id,
      curriculum: 'Kurikulum Merdeka',
      curriculumType: 'KURIKULUM_MERDEKA',
      academicYear: res.yearPlan.academicYear,
      level: res.yearPlan.level,
      grade: res.yearPlan.grade,
      phase: 'Fase A',
      subject: res.yearPlan.subject,
      semester: '1 (Ganjil)',
      updatedAt: new Date().toISOString(),
    },
    cp: res.cp,
    cpAnalysis: res.cpAnalysis,
    tp: res.tp,
    atp: res.atp,
  });

  assert(wf.stepStates.cp.isComplete === false, 'Workflow CP tidak boleh COMPLETE (harus direview)');
  assert(wf.stepStates.cp.status === 'IN_PROGRESS', 'Workflow CP harus IN_PROGRESS');
  assert(wf.stepStates['cp-analysis'].isComplete === false, 'Workflow CP Analysis tidak boleh COMPLETE');
  assert(wf.stepStates['cp-analysis'].status === 'BLOCKED', 'Workflow CP Analysis harus BLOCKED sebelum CP SIAP');
  assert(wf.stepStates.tp.isComplete === false, 'Workflow TP tidak boleh COMPLETE');
  assert(wf.stepStates.tp.status === 'BLOCKED', 'Workflow TP harus BLOCKED sebelum CP Analysis SIAP');
  assert(wf.stepStates.atp.isComplete === false, 'Workflow ATP tidak boleh COMPLETE');
  assert(wf.stepStates.atp.status === 'BLOCKED', 'Workflow ATP harus BLOCKED sebelum TP SIAP');
}

// ==========================================
// SCENARIO K: TP Validator fail-closed saat CP Analysis undefined
// ==========================================
console.log('Testing Scenario K: TP Validator fail-closed saat CP Analysis undefined...');
{
  const testCP = {
    id: 'cp-001',
    academicSettingId: 'yp-001',
    generalDescription: 'Peserta didik memahami konsep bilangan bulat dan operasinya.',
    elements: [
      { id: 'elem-01', code: 'E1', name: 'Bilangan', content: 'Memahami bilangan cacah.' },
    ],
    source: {
      title: 'CP Matematika Fase B',
      institution: 'Kemendikbudristek',
      retrievedAt: new Date().toISOString(),
      verificationStatus: 'verified_official',
    },
    workflowStatus: 'SIAP' as const,
    updatedAt: new Date().toISOString(),
  };

  const testTP = {
    id: 'tp-001',
    academicSettingId: 'yp-001',
    academicYear: '2024/2025',
    subjectCode: 'Matematika',
    phase: 'B',
    items: [
      {
        id: 'tp-item-01',
        code: 'E1-BLG-01',
        elementName: 'Bilangan',
        statement: 'Membaca dan menuliskan bilangan cacah sampai 10.000.',
        competence: 'Membaca dan menuliskan',
        contentScope: 'Bilangan cacah sampai 10.000',
        order: 1,
        sequence: 1,
        status: 'DRAFT' as const,
      },
    ],
    workflowStatus: 'PERLU_DILENGKAPI' as const,
    updatedAt: new Date().toISOString(),
  };

  const validation = validateTPDataWorkflow(testTP, testCP as any, undefined, {
    id: 'yp-001',
    subject: 'Matematika',
    academicYear: '2024/2025',
    phase: 'B',
  } as any);

  assert(validation.isSiap === false, 'validateTPDataWorkflow(...).isSiap harus false saat cpAnalysis undefined');
  assert(validation.status === 'PERLU_DILENGKAPI', 'status harus PERLU_DILENGKAPI saat cpAnalysis undefined');
  assert(
    validation.issues.includes('Analisis CP rujukan belum tersedia.'),
    'issues harus mengandung "Analisis CP rujukan belum tersedia."'
  );
}

console.log('--- ALL REGRESSION TESTS PASSED SUCCESSFULLY ---');
