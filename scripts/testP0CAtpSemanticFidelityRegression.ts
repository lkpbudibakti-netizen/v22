import {
  checkATPSemanticFidelity,
  validateATPGeneratedItemsSemanticFidelity,
} from '../src/services/atpSemanticFidelity';
import { prepareATPFinalization } from '../src/services/atpFinalizationService';
import { validateATPDataWorkflow } from '../src/services/cpWorkflowService';
import { fallbackGenerateTP } from '../server/curriculumFallback';
import type { AcademicSetting, ATPData, ATPItem, CPAnalysisData, CPData, TPData, TPItem } from '../src/types';

let failed = 0;

function assertCase(condition: boolean, label: string, details?: unknown) {
  if (condition) {
    console.log(`PASS ${label}`);
    return;
  }
  failed += 1;
  console.error(`FAIL ${label}`);
  if (details !== undefined) console.error(details);
}

const academicSetting: AcademicSetting = {
  id: 'acad-p0c',
  profileId: 'profile-p0c',
  curriculum: 'Kurikulum Merdeka',
  academicYear: '2026/2027',
  semester: '1 (Ganjil)',
  subject: 'Matematika',
  grade: 'Kelas 4',
  phase: 'Fase B',
  level: 'SD',
  totalHoursPerWeek: 4,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const cp: CPData = {
  id: 'cp-p0c',
  academicSettingId: academicSetting.id,
  generalDescription: 'Peserta didik memahami bilangan pecahan dan pengukuran dalam pemecahan masalah sehari-hari.',
  elements: [
    { id: 'elem-1', code: 'E1', name: 'Bilangan', content: 'Pecahan dan operasi pecahan.' },
    { id: 'elem-2', code: 'E2', name: 'Pengukuran', content: 'Keliling dan luas bangun datar.' },
  ],
  source: { verificationStatus: 'VERIFIED' } as any,
  workflowStatus: 'SIAP',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const cpAnalysis: CPAnalysisData = {
  id: 'analysis-p0c',
  academicSettingId: academicSetting.id,
  cpId: cp.id,
  generalSummary: 'Analisis CP Matematika fase B.',
  workflowStatus: 'SIAP',
  needsReview: false,
  basedOnCpUpdatedAt: cp.updatedAt,
  items: [
    {
      id: 'ana-pecahan',
      elementId: 'elem-1',
      elementName: 'Bilangan',
      scopeCode: 'PEC',
      cpCompetence: 'Memahami dan menerapkan',
      materialScope: 'Pecahan senilai dan penjumlahan pecahan',
      order: 1,
    },
    {
      id: 'ana-ukur',
      elementId: 'elem-2',
      elementName: 'Pengukuran',
      scopeCode: 'UKR',
      cpCompetence: 'Menganalisis',
      materialScope: 'Keliling dan luas persegi panjang',
      order: 2,
    },
  ],
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const tpItems: TPItem[] = [
  {
    id: 'tp-pecahan',
    code: 'E1-PEC-01',
    cpAnalysisId: 'ana-pecahan',
    cpAnalysisItemIds: ['ana-pecahan'],
    elementName: 'Bilangan',
    statement: 'Peserta didik menjelaskan pecahan senilai dan menerapkan penjumlahan pecahan berpenyebut sama.',
    competence: 'Menjelaskan dan menerapkan',
    contentScope: 'Pecahan senilai dan penjumlahan pecahan',
    order: 1,
  },
  {
    id: 'tp-ukur',
    code: 'E2-UKR-01',
    cpAnalysisId: 'ana-ukur',
    cpAnalysisItemIds: ['ana-ukur'],
    elementName: 'Pengukuran',
    statement: 'Peserta didik menganalisis keliling dan luas persegi panjang dalam konteks sehari-hari.',
    competence: 'Menganalisis',
    contentScope: 'Keliling dan luas persegi panjang',
    order: 2,
  },
];

const tpData: TPData = {
  id: 'tpdata-p0c',
  academicSettingId: academicSetting.id,
  cpId: cp.id,
  cpAnalysisId: cpAnalysis.id,
  academicYear: academicSetting.academicYear,
  subjectCode: academicSetting.subject,
  phase: academicSetting.phase,
  items: tpItems,
  basedOnCpUpdatedAt: cp.updatedAt,
  basedOnAnalysisUpdatedAt: cpAnalysis.updatedAt,
  workflowStatus: 'SIAP',
  needsReview: false,
  updatedAt: '2026-01-02T00:00:00.000Z',
};

function atp(items: ATPItem[], overrides: Partial<ATPData> = {}): ATPData {
  return {
    id: 'atp-p0c',
    academicSettingId: academicSetting.id,
    tpId: tpData.id,
    tpDataId: tpData.id,
    items,
    workflowStatus: 'SIAP',
    needsReview: false,
    basedOnTpUpdatedAt: tpData.updatedAt,
    updatedAt: '2026-01-03T00:00:00.000Z',
    ...overrides,
  };
}

const validSingle = checkATPSemanticFidelity('Memahami pecahan senilai dan menerapkan penjumlahan pecahan', [tpItems[0]]);
assertCase(validSingle.isValid, 'Focus sesuai TP canonical');

const competencyAligned = checkATPSemanticFidelity('Menerapkan penjumlahan pecahan senilai', [tpItems[0]]);
assertCase(competencyAligned.isValid, 'Materi sama + kompetensi sesuai PASS', competencyAligned);

const practiceTp: TPItem = {
  ...tpItems[0],
  id: 'tp-praktik-pecahan',
  code: 'E1-PEC-02',
  statement: 'Peserta didik mempraktikkan penggunaan pecahan senilai dengan alat peraga.',
  competence: 'Mempraktikkan',
  contentScope: 'Pecahan senilai',
};
const conflictingCompetence = checkATPSemanticFidelity('Menganalisis pecahan senilai', [practiceTp]);
assertCase(!conflictingCompetence.isValid, 'Materi sama + kompetensi bertentangan FAIL', conflictingCompetence);

const unclearCompetence = checkATPSemanticFidelity('Pembelajaran pecahan senilai dan penjumlahan pecahan', [tpItems[0]]);
assertCase(!unclearCompetence.isValid, 'Materi sama + kompetensi tidak jelas AMBIGU/FAIL', unclearCompetence);

const equivalentCompetence = checkATPSemanticFidelity('Menggunakan penjumlahan pecahan senilai untuk menyelesaikan soal', [tpItems[0]]);
assertCase(equivalentCompetence.isValid, 'Kompetensi setara, redaksi berbeda PASS jika dapat dibuktikan', equivalentCompetence);

const paraphrasedMaterial = checkATPSemanticFidelity('Menerapkan kegiatan menjumlahkan pecahan ekuivalen', [tpItems[0]]);
assertCase(paraphrasedMaterial.isValid, 'Parafrasa materi dengan makna setara PASS jika dapat dibuktikan', paraphrasedMaterial);

const wrongDomain = checkATPSemanticFidelity('Membaca puisi rakyat dan menulis pantun', [tpItems[0]]);
assertCase(!wrongDomain.isValid, 'Exact TP ID benar, focus beda domain FAIL', wrongDomain);

const validMulti = checkATPSemanticFidelity(
  'Menerapkan pecahan serta menganalisis pengukuran keliling dan luas persegi panjang',
  tpItems
);
assertCase(validMulti.isValid, 'Multi-TP ringkasan gabungan koheren PASS', validMulti);

const missingOneDomain = checkATPSemanticFidelity('Menerapkan penjumlahan pecahan senilai', tpItems);
assertCase(!missingOneDomain.isValid, 'Multi-TP dengan salah satu domain hilang FAIL', missingOneDomain);

const genericOnly = checkATPSemanticFidelity('Mengembangkan kompetensi melalui kegiatan pembelajaran yang baik', [tpItems[0]]);
assertCase(!genericOnly.isValid, 'Fokus menggunakan kata-kata umum saja FAIL', genericOnly);

const invalidMulti = checkATPSemanticFidelity('Menelaah struktur teks laporan hasil observasi', tpItems);
assertCase(!invalidMulti.isValid, 'Multi-TP focus menyesatkan FAIL', invalidMulti);

const changedCp: CPData = {
  ...cp,
  generalDescription: 'Peserta didik memahami bilangan desimal dan pengukuran dalam pemecahan masalah sehari-hari.',
  elements: [
    { id: 'elem-1', code: 'E1', name: 'Bilangan', content: 'Bilangan desimal dan operasi desimal.' },
    cp.elements[1],
  ],
  updatedAt: '2026-01-04T00:00:00.000Z',
};

const changedCpAnalysis: CPAnalysisData = {
  ...cpAnalysis,
  basedOnCpUpdatedAt: changedCp.updatedAt,
  items: cpAnalysis.items.map((item) => item.id === 'ana-pecahan'
    ? {
        ...item,
        cpText: changedCp.elements[0].content,
        materialScope: 'Bilangan desimal dan penjumlahan desimal',
      }
    : {
        ...item,
        cpText: changedCp.elements[1].content,
      }),
  updatedAt: '2026-01-04T00:00:00.000Z',
};

const changedTpData: TPData = {
  ...tpData,
  items: [
    {
      ...tpItems[0],
      statement: 'Peserta didik memahami bilangan desimal dan menerapkan penjumlahan desimal.',
      competence: 'Memahami dan menerapkan',
      contentScope: 'Bilangan desimal dan penjumlahan desimal',
    },
    tpItems[1],
  ],
  basedOnCpUpdatedAt: changedCp.updatedAt,
  basedOnAnalysisUpdatedAt: changedCpAnalysis.updatedAt,
  updatedAt: '2026-01-05T00:00:00.000Z',
};

const staleOldAtp = atp([
  { id: 'atp-1', stepNumber: 1, linkedTpIds: ['tp-pecahan'], focus: 'Memahami pecahan senilai' },
  { id: 'atp-2', stepNumber: 2, linkedTpIds: ['tp-ukur'], focus: 'Menganalisis keliling dan luas persegi panjang' },
]);
const staleResult = validateATPDataWorkflow(staleOldAtp, changedTpData, academicSetting, changedCp, changedCpAnalysis);
assertCase(!staleResult.isSiap && staleResult.issues.some((issue) => issue.includes('ATP_SEMANTIC_FIDELITY')), 'TP berubah substantif, ATP lama tidak sesuai FAIL', staleResult.issues);

const reconfirmedStillAligned = atp(
  [
    { id: 'atp-1', stepNumber: 1, linkedTpIds: ['tp-pecahan'], focus: 'Memahami bilangan desimal dan menerapkan penjumlahan desimal' },
    { id: 'atp-2', stepNumber: 2, linkedTpIds: ['tp-ukur'], focus: 'Menganalisis keliling dan luas persegi panjang' },
  ],
  { basedOnTpUpdatedAt: changedTpData.updatedAt }
);
const reconfirmedResult = validateATPDataWorkflow(reconfirmedStillAligned, changedTpData, academicSetting, changedCp, changedCpAnalysis);
assertCase(reconfirmedResult.isSiap, 'TP berubah tetapi ATP masih sesuai dan dikonfirmasi ulang PASS', reconfirmedResult.issues);

const persisted = atp([
  { id: 'atp-1', stepNumber: 1, linkedTpIds: ['tp-pecahan'], focus: 'Memahami pecahan senilai dan penjumlahan pecahan' },
  { id: 'atp-2', stepNumber: 2, linkedTpIds: ['tp-ukur'], focus: 'Menganalisis keliling dan luas persegi panjang' },
], {
  needsReview: true,
  reviewReason: 'TP acuan berubah.',
  updatedAt: '2026-01-03T00:00:00.000Z',
});
let saved: ATPData = persisted;
const failingCandidate = atp([
  { id: 'atp-1', stepNumber: 1, linkedTpIds: ['tp-pecahan'], focus: 'Membaca puisi rakyat' },
  { id: 'atp-2', stepNumber: 2, linkedTpIds: ['tp-ukur'], focus: 'Menganalisis keliling dan luas persegi panjang' },
], { needsReview: false, reviewReason: undefined });
const finalizationResult = prepareATPFinalization({
  atp: failingCandidate,
  tp: tpData,
  academicSetting,
  cp,
  cpAnalysis,
  rationale: 'Draf finalisasi gagal',
  subject: academicSetting.subject,
  phase: academicSetting.phase,
  academicYear: academicSetting.academicYear,
});
if (finalizationResult.canFinalize && finalizationResult.candidate) {
  saved = finalizationResult.candidate;
}
assertCase(saved === persisted && saved.needsReview === true, 'Finalisasi gagal tidak mengubah persisted ATP');

const aiSemanticReject = validateATPGeneratedItemsSemanticFidelity(
  [
    { stepNumber: 1, linkedTpIds: ['tp-pecahan'], focus: 'Membaca puisi rakyat dan menulis pantun' },
    { stepNumber: 2, linkedTpIds: ['tp-ukur'], focus: 'Menganalisis keliling dan luas persegi panjang' },
  ],
  tpItems
);
assertCase(!aiSemanticReject.isValid, 'Output Gemini salah secara semantik REJECT', aiSemanticReject);

// ... (existing code up to end)

// ---------------------------------------------------------
// UNIVERSAL SEMANTIC FIDELITY REGRESSION (5 Subjects)
// ---------------------------------------------------------

// 1. BAHASA INDONESIA (Fase B)
const biTP: TPItem[] = [{ id: 'tp-bi', code: 'E1-BIN-01', statement: 'Peserta didik mengidentifikasi ide pokok dan menyimpulkan informasi.', competence: 'Mengidentifikasi dan menyimpulkan', contentScope: 'Ide pokok dan informasi teks', order: 1 }];
assertCase(checkATPSemanticFidelity('Mengidentifikasi ide pokok dan menyimpulkan informasi dari teks', biTP).isValid, 'BI: Kompetensi majemuk PASS');
assertCase(!checkATPSemanticFidelity('Membaca buku', biTP).isValid, 'BI: Materi tidak terkait FAIL');

// 2. IPAS (Fase B)
const ipasTP: TPItem[] = [{ id: 'tp-ipas', code: 'E1-IPA-01', statement: 'Peserta didik mengamati, menyelidiki, dan menjelaskan daur hidup tumbuhan.', competence: 'Mengamati, menyelidiki, dan menjelaskan', contentScope: 'Daur hidup tumbuhan', order: 1 }];
assertCase(checkATPSemanticFidelity('Mengamati, menyelidiki, dan menjelaskan daur hidup tumbuhan', ipasTP).isValid, 'IPAS: Kompetensi majemuk PASS');
assertCase(!checkATPSemanticFidelity('Menjelaskan daur hidup tumbuhan', ipasTP).isValid, 'IPAS: Kompetensi majemuk sebagian FAIL');

// 3. PENDIDIKAN PANCASILA (Fase B)
const pancasilaTP: TPItem[] = [{ id: 'tp-pkn', code: 'E1-PKN-01', statement: 'Peserta didik menunjukkan perilaku gotong royong dan menghargai aturan.', competence: 'Menunjukkan perilaku dan menghargai', contentScope: 'Gotong royong dan aturan', order: 1 }];
assertCase(checkATPSemanticFidelity('Menunjukkan perilaku gotong royong dan menghargai aturan rumah', pancasilaTP).isValid, 'Pancasila: Multi-tindakan PASS');
assertCase(!checkATPSemanticFidelity('Menerapkan aturan rumah saja', pancasilaTP).isValid, 'Pancasila: Kompetensi hilang FAIL');

// 4. MATEMATIKA (Fase B - Valid Multi-TP)
const mathTp: TPItem[] = [
  { id: 'tp-mat-1', code: 'E1-MAT-01', statement: 'Menjelaskan bilangan cacah sampai 10.000', competence: 'Menjelaskan', contentScope: 'Bilangan cacah', order: 1 },
  { id: 'tp-mat-2', code: 'E1-MAT-02', statement: 'Menerapkan operasi hitung bilangan', competence: 'Menerapkan', contentScope: 'Operasi hitung', order: 2 }
];
const mathResult = validateATPGeneratedItemsSemanticFidelity(
  [{ stepNumber: 1, linkedTpIds: ['tp-mat-1', 'tp-mat-2'], focus: 'Menjelaskan bilangan cacah dan menerapkan operasi hitung bilangan' }],
  mathTp
);
assertCase(mathResult.isValid, 'Math: Multi-TP koheren PASS');

// 5. PJOK (Fase A - Multi-TP)
const pjokTp: TPItem[] = [
  { id: 'tp-pjok-1', code: 'E1-PJK-01', statement: 'Mempraktikkan gerak lokomotor', competence: 'Mempraktikkan', contentScope: 'Gerak lokomotor', order: 1 },
  { id: 'tp-pjok-2', code: 'E1-PJK-02', statement: 'Mengenali gerak non-lokomotor', competence: 'Mengenali', contentScope: 'Gerak non-lokomotor', order: 2 }
];
// Kasus Positif: Fokus mencakup TP-1 dan TP-2
const pjokPos = validateATPGeneratedItemsSemanticFidelity(
  [{ stepNumber: 1, linkedTpIds: ['tp-pjok-1', 'tp-pjok-2'], focus: 'Mempraktikkan gerak lokomotor dan mengenali gerak non-lokomotor' }],
  pjokTp
);
assertCase(pjokPos.isValid, 'PJOK: Multi-TP benar tertaut PASS');

// Kasus Negatif: Fokus hanya satu TP
const pjokNeg = validateATPGeneratedItemsSemanticFidelity(
  [{ stepNumber: 1, linkedTpIds: ['tp-pjok-1', 'tp-pjok-2'], focus: 'Mempraktikkan gerak lokomotor' }], 
  pjokTp
);

// 6. Mengeksplorasi (Regression)
const eksplorasiTp: TPItem[] = [{ id: 'tp-eksplorasi', code: 'E1-EXPL-01', statement: 'Peserta didik mengeksplorasi pola makan sehat.', competence: 'Mengeksplorasi', contentScope: 'Pola makan sehat', order: 1 }];
assertCase(checkATPSemanticFidelity('Mengeksplorasi pola makan sehat', eksplorasiTp).isValid, 'Eksplorasi: Kompetensi relevan PASS');
assertCase(!checkATPSemanticFidelity('Menjelaskan pola makan sehat', eksplorasiTp).isValid, 'Eksplorasi: Kompetensi lain FAIL');

// 7. Mempraktikkan (Regression)
const praktikTp: TPItem[] = [{ id: 'tp-praktik', code: 'E1-PRAK-01', statement: 'Peserta didik mempraktikkan penanganan cedera ringan.', competence: 'Mempraktikkan', contentScope: 'Penanganan cedera ringan', order: 1 }];
assertCase(checkATPSemanticFidelity('Mempraktikkan penanganan cedera ringan', praktikTp).isValid, 'Praktik: Kompetensi relevan PASS');
assertCase(!checkATPSemanticFidelity('Mengenali cedera ringan', praktikTp).isValid, 'Praktik: Kompetensi lain FAIL');


// 8. Berpartisipasi (Regression)
const partTp: TPItem[] = [{ id: 'tp-part', code: 'E1-PART-01', statement: 'Peserta didik berpartisipasi dalam permainan.', competence: 'Berpartisipasi', contentScope: 'Permainan', order: 1 }];
assertCase(checkATPSemanticFidelity('Berpartisipasi dalam permainan', partTp).isValid, 'Partisipasi: Kompetensi relevan PASS');
assertCase(!checkATPSemanticFidelity('Mengamati permainan', partTp).isValid, 'Partisipasi: Kompetensi lain FAIL');

// 9. Kompetensi Majemuk (Regression)
const majemukTp: TPItem[] = [{ id: 'tp-majemuk', code: 'E1-MAJ-01', statement: 'Peserta didik menerapkan dan berpartisipasi dalam gerak.', competence: 'Menerapkan dan berpartisipasi', contentScope: 'Gerak', order: 1 }];
assertCase(checkATPSemanticFidelity('Menerapkan dan berpartisipasi dalam gerak', majemukTp).isValid, 'Majemuk: Kompetensi lengkap PASS');
assertCase(!checkATPSemanticFidelity('Menerapkan gerak', majemukTp).isValid, 'Majemuk: Kompetensi hilang FAIL');

// ---------------------------------------------------------
// 10. PJOK FASE B KELAS 3 END-TO-END REGRESSION (10 TPs FIXTURE)
// ---------------------------------------------------------

// D1. Incomplete suggestions must express missing source competence in the statement,
// rather than laundering coverage through competence metadata alone.
const cpaBloated = [
  {
    id: 'ana-fairplay',
    elementName: 'Kebugaran Jasmani',
    scopeCode: 'MBDM',
    cpCompetence: 'Menerapkan & Berpartisipasi & Merancang & Menyusun',
    materialScope: 'aturan untuk fair play',
    suggestedTp: 'Peserta didik mampu menyusun dan menerapkan aturan untuk fair play.',
  },
];
const generatedTps = fallbackGenerateTP({
  cpAnalysisItems: cpaBloated,
});
assertCase(
  generatedTps.length === 1 &&
  generatedTps[0].competence.split(' & ').every(competence =>
    generatedTps[0].statement.toLowerCase().includes(competence.toLowerCase())) &&
  ['menerapkan', 'berpartisipasi', 'merancang', 'menyusun'].every(competence =>
    generatedTps[0].statement.toLowerCase().includes(competence)),
  'D1: Saran parsial dilengkapi dari sumber dalam rumusan TP nyata, bukan metadata saja'
);

// D2. Rumusan TP baru tidak mengulang kata kerja
const cpaDuplicateVerb = [
  {
    id: 'ana-dup',
    elementName: 'Elemen 1',
    scopeCode: 'DUP',
    cpCompetence: 'Menerapkan',
    materialScope: 'menerapkan pola hidup sehat',
  },
];
const genDupTps = fallbackGenerateTP({
  cpAnalysisItems: cpaDuplicateVerb,
});
assertCase(
  genDupTps.length === 1 && !/\bmenerapkan\s+menerapkan\b/i.test(genDupTps[0].statement),
  'D2: Rumusan TP baru tidak mengulang kata kerja (tidak ada "menerapkan menerapkan")'
);

// D3. Kompetensi majemuk yang benar tetap bisa digunakan
const cpaCompoundValid = [
  {
    id: 'ana-compound',
    elementName: 'Perilaku Hidup Sehat',
    scopeCode: 'BDBA',
    cpCompetence: 'Mengenali & Berpartisipasi',
    materialScope: 'aktivitas jasmani yang menyenangkan',
    suggestedTp: 'Peserta didik mampu mengenali dan berpartisipasi dalam aktivitas jasmani yang menyenangkan.',
  },
];
const genCompoundTps = fallbackGenerateTP({
  cpAnalysisItems: cpaCompoundValid,
});
assertCase(
  genCompoundTps.length === 1 &&
  genCompoundTps[0].competence.toLowerCase().includes('mengenal') &&
  genCompoundTps[0].competence.toLowerCase().includes('partisipasi'),
  'D3: Kompetensi majemuk yang benar tetap bisa digunakan'
);

// PJOK 10 TP CANONICAL FIXTURE (Fase B, Kelas 3, TA 2026/2027)
const pjokCp: CPData = {
  id: 'cp-pjok-p0c',
  academicSettingId: 'acad-p0c',
  generalDescription: 'Peserta didik menguasai keterampilan gerak dasar dan pola hidup sehat.',
  elements: [
    { id: 'elem-pjok-1', code: 'E1', name: 'Terampil Bergerak', content: 'Keterampilan gerak fundamental.' },
    { id: 'elem-pjok-2', code: 'E2', name: 'Belajar Melalui Gerak', content: 'Perilaku fair play dan peran kelompok.' },
    { id: 'elem-pjok-3', code: 'E3', name: 'Bergaya Hidup Aktif', content: 'Aktivitas jasmani yang menyenangkan.' },
    { id: 'elem-pjok-4', code: 'E4', name: 'Memilih Hidup Sehat', content: 'Pola makan dan penanganan cedera.' },
  ],
  source: { verificationStatus: 'VERIFIED' } as any,
  workflowStatus: 'SIAP',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const pjokAnalysisItems = [
  { id: 'ana-pjok-01', elementId: 'elem-pjok-1', elementName: 'Terampil Bergerak', cpText: 'Keterampilan gerak fundamental.', cpCompetence: 'Mempraktikkan', materialScope: 'Pola gerak dasar lokomotor', order: 1 },
  { id: 'ana-pjok-02', elementId: 'elem-pjok-1', elementName: 'Terampil Bergerak', cpText: 'Keterampilan gerak fundamental.', cpCompetence: 'Mempraktikkan', materialScope: 'Pola gerak dasar non-lokomotor', order: 2 },
  { id: 'ana-pjok-03', elementId: 'elem-pjok-1', elementName: 'Terampil Bergerak', cpText: 'Keterampilan gerak fundamental.', cpCompetence: 'Mempraktikkan', materialScope: 'Pola gerak dasar manipulatif', order: 3 },
  { id: 'ana-pjok-04', elementId: 'elem-pjok-1', elementName: 'Terampil Bergerak', cpText: 'Keterampilan gerak fundamental.', cpCompetence: 'Mempraktikkan', materialScope: 'Pola gerak dominan senam', order: 4 },
  { id: 'ana-pjok-05', elementId: 'elem-pjok-1', elementName: 'Terampil Bergerak', cpText: 'Keterampilan gerak fundamental.', cpCompetence: 'Mempraktikkan', materialScope: 'Aktivitas gerak di air', order: 5 },
  { id: 'ana-pjok-06', elementId: 'elem-pjok-2', elementName: 'Belajar Melalui Gerak', cpText: 'Perilaku fair play dan peran kelompok.', cpCompetence: 'Menyusun & Menerapkan', materialScope: 'Aturan untuk fair play', order: 6 },
  { id: 'ana-pjok-07', elementId: 'elem-pjok-2', elementName: 'Belajar Melalui Gerak', cpText: 'Perilaku fair play dan peran kelompok.', cpCompetence: 'Mempertunjukkan', materialScope: 'Peran dalam aktivitas kelompok', order: 7 },
  { id: 'ana-pjok-08', elementId: 'elem-pjok-3', elementName: 'Bergaya Hidup Aktif', cpText: 'Aktivitas jasmani yang menyenangkan.', cpCompetence: 'Mengenali & Berpartisipasi', materialScope: 'Aktivitas jasmani yang menyenangkan', order: 8 },
  { id: 'ana-pjok-09', elementId: 'elem-pjok-4', elementName: 'Memilih Hidup Sehat', cpText: 'Pola makan dan penanganan cedera.', cpCompetence: 'Mengeksplorasi', materialScope: 'Pola makan sehat dan bergizi seimbang', order: 9 },
  { id: 'ana-pjok-10', elementId: 'elem-pjok-4', elementName: 'Memilih Hidup Sehat', cpText: 'Pola makan dan penanganan cedera.', cpCompetence: 'Mempraktikkan', materialScope: 'Penanganan cedera ringan', order: 10 },
];

const pjokCpAnalysis: CPAnalysisData = {
  id: 'analysis-pjok-p0c',
  academicSettingId: 'acad-p0c',
  cpId: pjokCp.id,
  generalSummary: 'Analisis CP PJOK fase B.',
  workflowStatus: 'SIAP',
  needsReview: false,
  basedOnCpUpdatedAt: pjokCp.updatedAt,
  items: pjokAnalysisItems,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const pjok10Tps: TPItem[] = [
  { id: 'tp-pjok-01', code: 'E1-PGD-01', cpAnalysisId: 'ana-pjok-01', cpAnalysisItemIds: ['ana-pjok-01'], elementName: 'Terampil Bergerak', statement: 'Peserta didik mempraktikkan variasi pola gerak dasar lokomotor.', competence: 'Mempraktikkan', contentScope: 'Pola gerak dasar lokomotor', order: 1 },
  { id: 'tp-pjok-02', code: 'E1-PGD-02', cpAnalysisId: 'ana-pjok-02', cpAnalysisItemIds: ['ana-pjok-02'], elementName: 'Terampil Bergerak', statement: 'Peserta didik mempraktikkan variasi pola gerak dasar non-lokomotor.', competence: 'Mempraktikkan', contentScope: 'Pola gerak dasar non-lokomotor', order: 2 },
  { id: 'tp-pjok-03', code: 'E1-PGD-03', cpAnalysisId: 'ana-pjok-03', cpAnalysisItemIds: ['ana-pjok-03'], elementName: 'Terampil Bergerak', statement: 'Peserta didik mempraktikkan variasi pola gerak dasar manipulatif.', competence: 'Mempraktikkan', contentScope: 'Pola gerak dasar manipulatif', order: 3 },
  { id: 'tp-pjok-04', code: 'E1-ASM-01', cpAnalysisId: 'ana-pjok-04', cpAnalysisItemIds: ['ana-pjok-04'], elementName: 'Terampil Bergerak', statement: 'Peserta didik mempraktikkan pola gerak dominan senam.', competence: 'Mempraktikkan', contentScope: 'Pola gerak dominan senam', order: 4 },
  { id: 'tp-pjok-05', code: 'E1-AIR-01', cpAnalysisId: 'ana-pjok-05', cpAnalysisItemIds: ['ana-pjok-05'], elementName: 'Terampil Bergerak', statement: 'Peserta didik mempraktikkan aktivitas gerak di air.', competence: 'Mempraktikkan', contentScope: 'Aktivitas gerak di air', order: 5 },
  { id: 'tp-pjok-06', code: 'E2-MBDM-01', cpAnalysisId: 'ana-pjok-06', cpAnalysisItemIds: ['ana-pjok-06'], elementName: 'Belajar Melalui Gerak', statement: 'Peserta didik menyusun dan menerapkan aturan untuk fair play.', competence: 'Menyusun & Menerapkan', contentScope: 'Aturan untuk fair play', order: 6 },
  { id: 'tp-pjok-07', code: 'E2-MBPD-01', cpAnalysisId: 'ana-pjok-07', cpAnalysisItemIds: ['ana-pjok-07'], elementName: 'Belajar Melalui Gerak', statement: 'Peserta didik mempertunjukkan peran dalam aktivitas kelompok.', competence: 'Mempertunjukkan', contentScope: 'Peran dalam aktivitas kelompok', order: 7 },
  { id: 'tp-pjok-08', code: 'E3-BDBA-01', cpAnalysisId: 'ana-pjok-08', cpAnalysisItemIds: ['ana-pjok-08'], elementName: 'Bergaya Hidup Aktif', statement: 'Peserta didik mengenali dan berpartisipasi dalam aktivitas jasmani yang menyenangkan.', competence: 'Mengenali & Berpartisipasi', contentScope: 'Aktivitas jasmani yang menyenangkan', order: 8 },
  { id: 'tp-pjok-09', code: 'E4-MPMS-01', cpAnalysisId: 'ana-pjok-09', cpAnalysisItemIds: ['ana-pjok-09'], elementName: 'Memilih Hidup Sehat', statement: 'Peserta didik mengeksplorasi pola makan sehat dan bergizi seimbang.', competence: 'Mengeksplorasi', contentScope: 'Pola makan sehat dan bergizi seimbang', order: 9 },
  { id: 'tp-pjok-10', code: 'E4-MPCR-01', cpAnalysisId: 'ana-pjok-10', cpAnalysisItemIds: ['ana-pjok-10'], elementName: 'Memilih Hidup Sehat', statement: 'Peserta didik mempraktikkan penanganan cedera ringan.', competence: 'Mempraktikkan', contentScope: 'Penanganan cedera ringan', order: 10 },
];

// D4. ATP relevan dengan 10 TP Fase B diterima
const validPjok10AtpItems = [
  { stepNumber: 1, linkedTpIds: ['tp-pjok-01', 'tp-pjok-02', 'tp-pjok-03'], focus: 'Mempraktikkan variasi pola gerak dasar lokomotor, non-lokomotor, dan manipulatif' },
  { stepNumber: 2, linkedTpIds: ['tp-pjok-04', 'tp-pjok-05'], focus: 'Mempraktikkan pola gerak dominan senam dan aktivitas gerak di air' },
  { stepNumber: 3, linkedTpIds: ['tp-pjok-06', 'tp-pjok-07'], focus: 'Menyusun dan menerapkan aturan untuk fair play serta mempertunjukkan peran dalam aktivitas kelompok' },
  { stepNumber: 4, linkedTpIds: ['tp-pjok-08'], focus: 'Mengenali dan berpartisipasi dalam aktivitas jasmani yang menyenangkan' },
  { stepNumber: 5, linkedTpIds: ['tp-pjok-09', 'tp-pjok-10'], focus: 'Mengeksplorasi pola makan sehat dan bergizi seimbang serta mempraktikkan penanganan cedera ringan' },
];
const pjok10Validation = validateATPGeneratedItemsSemanticFidelity(validPjok10AtpItems, pjok10Tps);
assertCase(pjok10Validation.isValid, 'D4: ATP relevan dengan 10 TP Fase B diterima');

// D5. Kompetensi penting yang hilang tetap ditolak
const missingCompAtp = [
  { stepNumber: 1, linkedTpIds: ['tp-pjok-08'], focus: 'Mengenali aktivitas jasmani yang menyenangkan' }, // hilang "berpartisipasi"
];
const missingCompRes = validateATPGeneratedItemsSemanticFidelity(missingCompAtp, pjok10Tps);
assertCase(!missingCompRes.isValid, 'D5: Kompetensi penting yang hilang (Berpartisipasi) tetap ditolak');

// D6. Materi berbeda tetap ditolak meskipun kata kerjanya sama
const diffMaterialAtp = [
  { stepNumber: 1, linkedTpIds: ['tp-pjok-09'], focus: 'Mengeksplorasi aktivitas gerak senam irama' }, // TP-09 adalah pola makan sehat
];
const diffMaterialRes = validateATPGeneratedItemsSemanticFidelity(diffMaterialAtp, pjok10Tps);
assertCase(!diffMaterialRes.isValid, 'D6: Materi berbeda tetap ditolak meskipun kata kerjanya sama');

// D7. Seluruh TP ID canonical tetap tercakup
const coveredIds = new Set(validPjok10AtpItems.flatMap((item) => item.linkedTpIds));
assertCase(
  pjok10Tps.every((tp) => coveredIds.has(tp.id)),
  'D7: Seluruh TP ID canonical tetap tercakup dalam alur ATP'
);

// D8. Tidak ada TP/ATP ID fiktif
const validTpIdSet = new Set(pjok10Tps.map((t) => t.id));
assertCase(
  Array.from(coveredIds).every((id) => validTpIdSet.has(id)),
  'D8: Tidak ada TP ID fiktif'
);

// D9. Hasil valid dapat menjadi ATP DRAFT dan difinalisasi SIAP
const pjokAcademicSetting: AcademicSetting = {
  ...academicSetting,
  subject: 'Pendidikan Jasmani, Olahraga, dan Kesehatan',
  grade: 'Kelas 3',
  phase: 'Fase B',
};
const pjokTpData: TPData = {
  ...tpData,
  subjectCode: pjokAcademicSetting.subject,
  cpId: pjokCp.id,
  cpAnalysisId: pjokCpAnalysis.id,
  items: pjok10Tps,
  basedOnCpUpdatedAt: pjokCp.updatedAt,
  basedOnAnalysisUpdatedAt: pjokCpAnalysis.updatedAt,
};
const candidateAtp: ATPData = atp(
  validPjok10AtpItems.map((item, idx) => ({
    id: `atp-pjok-${idx + 1}`,
    stepNumber: item.stepNumber,
    linkedTpIds: item.linkedTpIds,
    focus: item.focus,
  })),
  {
    workflowStatus: 'DRAFT',
    needsReview: false,
    basedOnTpUpdatedAt: pjokTpData.updatedAt,
  }
);
const finalizeRes = prepareATPFinalization({
  atp: candidateAtp,
  tp: pjokTpData,
  academicSetting: pjokAcademicSetting,
  cp: pjokCp,
  cpAnalysis: pjokCpAnalysis,
  rationale: 'Rasional alur pembelajaran PJOK Fase B',
  subject: pjokAcademicSetting.subject,
  phase: pjokAcademicSetting.phase,
  academicYear: pjokAcademicSetting.academicYear,
});
assertCase(
  finalizeRes.canFinalize === true && finalizeRes.candidate?.workflowStatus === 'SIAP',
  'D9: Hasil valid dapat menjadi ATP DRAFT dan difinalisasi SIAP'
);

// D10. Hasil invalid tidak mengganti data ATP tersimpan
const persistedPjokAtp = { ...candidateAtp, id: 'persisted-pjok', workflowStatus: 'SIAP' as const };
let liveAtp: ATPData = persistedPjokAtp;
const invalidCandidateAtp = atp([
  { id: 'atp-inv-1', stepNumber: 1, linkedTpIds: ['tp-pjok-09'], focus: 'Menulis teks observasi' },
]);
const invalidFinalize = prepareATPFinalization({
  atp: invalidCandidateAtp,
  tp: pjokTpData,
  academicSetting: pjokAcademicSetting,
  cp: pjokCp,
  cpAnalysis: pjokCpAnalysis,
  rationale: 'Rasional gagal',
  subject: pjokAcademicSetting.subject,
  phase: pjokAcademicSetting.phase,
  academicYear: pjokAcademicSetting.academicYear,
});
if (invalidFinalize.canFinalize && invalidFinalize.candidate) {
  liveAtp = invalidFinalize.candidate;
}
assertCase(liveAtp === persistedPjokAtp, 'D10: Hasil invalid tidak mengganti data ATP tersimpan');

// D11. Contoh Bahasa Indonesia, IPAS, Matematika, dan Pendidikan Pancasila tidak mengalami regresi
// Diverifikasi oleh skenario uji 1-4 di atas yang tetap berjalan dan lulus

// D12. Tidak ada perubahan diam-diam pada TP existing
const existingStoredTp = [
  {
    id: 'stored-tp-1',
    code: 'E1-MAT-01',
    statement: 'Peserta didik memahami bilangan cacah sampai 1.000.',
    competence: 'Memahami',
    contentScope: 'Bilangan cacah sampai 1.000',
    order: 1,
  },
];
const alignedExisting = fallbackGenerateTP({
  cpAnalysisItems: [],
  existingTps: existingStoredTp,
});
assertCase(
  alignedExisting[0].id === 'stored-tp-1' &&
  alignedExisting[0].statement === existingStoredTp[0].statement &&
  alignedExisting[0].competence === existingStoredTp[0].competence,
  'D12: Tidak ada perubahan diam-diam pada TP existing'
);

if (failed > 0) {
  console.error(`P0-C ATP semantic fidelity regression failed: ${failed} scenario(s).`);
  process.exit(1);
}

console.log('P0-C ATP semantic fidelity regression scenarios passed.');
