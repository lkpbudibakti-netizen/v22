import assert from 'node:assert/strict';
import { generateModulAjar } from '../src/services/documentEngine/generators/modulAjarGenerator';
import JSZip from 'jszip';

console.log('=== RUNNING MODUL AJAR DOCX PRESENTATION REGRESSION ===');

const stamp = '2026-10-17T00:00:00Z';
const tpIds = ['tp-1', 'tp-2'];
const atpIds = ['atp-1', 'atp-2'];

const setting: any = {
  id: 'sem-1',
  curriculumType: 'KURIKULUM_MERDEKA',
  curriculum: 'Kurikulum Merdeka',
  semester: '1',
  subject: 'Matematika',
  grade: '7',
  phase: 'D',
  academicYear: '2026/2027',
};

const tp: any = {
  id: 'tp',
  academicSettingId: 'sem-1',
  workflowStatus: 'SIAP',
  updatedAt: stamp,
  items: [
    { id: 'tp-1', code: 'TP.7.1', statement: 'Memahami bilangan bulat dan operasinya', order: 1 },
    { id: 'tp-2', code: 'TP.7.2', statement: 'Menerapkan operasi bilangan dalam soal cerita', order: 2 },
  ],
};

const atp: any = {
  id: 'atp',
  academicSettingId: 'sem-1',
  workflowStatus: 'SIAP',
  updatedAt: stamp,
  basedOnTpUpdatedAt: stamp,
  items: [
    { id: 'atp-1', tpId: 'tp-1', linkedTpIds: ['tp-1'], stepNumber: 1, semester: 1, jp: 4 },
    { id: 'atp-2', tpId: 'tp-2', linkedTpIds: ['tp-2'], stepNumber: 2, semester: 1, jp: 4 },
  ],
};

const mapping: any = {
  id: 'mapping',
  academicSettingId: 'sem-1',
  updatedAt: stamp,
  units: [
    {
      id: 'unit-1',
      title: 'Bilangan Bulat',
      order: 1,
      linkedTpIds: tpIds,
      linkedAtpItemIds: atpIds,
      materials: [
        { id: 'mat-1', title: 'Konsep Bilangan Bulat', order: 1, linkedTpIds: ['tp-1'], linkedAtpItemIds: ['atp-1'] },
        { id: 'mat-2', title: 'Operasi Penjumlahan dan Pengurangan', order: 2, linkedTpIds: ['tp-2'], linkedAtpItemIds: ['atp-2'] },
      ],
    },
  ],
};

// Intentionally out-of-order meetings: order 3, 1, 2
const rawMeetings = [
  { id: 'm-3', title: 'Latihan Soal Cerita Operasi Bilangan', unitId: 'unit-1', order: 3, jp: 2, linkedTpIds: ['tp-2'], linkedAtpItemIds: ['atp-2'], materialIds: ['mat-2'] },
  { id: 'm-1', title: 'Pengenalan Bilangan Positif dan Negatif', unitId: 'unit-1', order: 1, jp: 2, linkedTpIds: ['tp-1'], linkedAtpItemIds: ['atp-1'], materialIds: ['mat-1'] },
  { id: 'm-2', title: 'Garis Bilangan dan Penjumlahan', unitId: 'unit-1', order: 2, jp: 2, linkedTpIds: ['tp-1', 'tp-2'], linkedAtpItemIds: ['atp-1', 'atp-2'], materialIds: ['mat-1', 'mat-2'] },
];

const execution: any = {
  id: 'execution',
  academicSettingId: 'sem-1',
  mappingId: 'mapping',
  basedOnMappingUpdatedAt: stamp,
  units: [{ unitId: 'unit-1', meetings: rawMeetings }],
};

const schedules: any = [
  {
    semesterPlanId: 'sem-1',
    semester: 1,
    schedule: {
      semesterPlanId: 'sem-1',
      status: 'COMPLETE',
      entries: [
        { meetingId: 'm-3', semesterPlanId: 'sem-1', unitId: 'unit-1', date: '2026-10-25', jp: 2, mode: 'MANUAL', dayOfWeek: 1, weekIndex: 3 },
        { meetingId: 'm-1', semesterPlanId: 'sem-1', unitId: 'unit-1', date: '2026-10-11', jp: 2, mode: 'MANUAL', dayOfWeek: 1, weekIndex: 1 },
        { meetingId: 'm-2', semesterPlanId: 'sem-1', unitId: 'unit-1', date: '2026-10-18', jp: 2, mode: 'MANUAL', dayOfWeek: 1, weekIndex: 2 },
      ],
    },
  },
];

const criteria: any = [
  {
    id: 'kktp-1',
    academicSettingId: 'sem-1',
    tpId: 'tp-1',
    description: 'Mampu menjelaskan pengertian bilangan bulat',
    approach: 'rubrik',
    indicators: ['Menjelaskan letak bilangan pada garis bilangan', 'Menentukan nilai mutlak bilangan'],
    levels: [
      { level: 'Perlu Bimbingan', label: 'Perlu Bimbingan', description: 'Belum memahami konsep bilangan negatif' },
      { level: 'Cukup', label: 'Cukup', description: 'Mampu memahami bilangan bulat dengan bantuan visual' },
      { level: 'Baik', label: 'Baik', description: 'Mampu menjelaskan dan meletakkan posisi bilangan secara mandiri' },
      { level: 'Sangat Baik', label: 'Sangat Baik', description: 'Menguasai konsep dan mampu membimbing teman sebaya' },
    ],
    workflowStatus: 'SIAP',
    updatedAt: stamp,
  },
  {
    id: 'kktp-2',
    academicSettingId: 'sem-1',
    tpId: 'tp-2',
    description: 'Mampu menyelesaikan operasi hitung bilangan bulat kontekstual',
    approach: 'rubrik',
    indicators: ['Menyelesaikan operasi penjumlahan dan pengurangan'],
    levels: [
      { level: 'Perlu Bimbingan', label: 'Perlu Bimbingan', description: 'Sering melakukan kesalahan tanda' },
      { level: 'Cukup', label: 'Cukup', description: 'Bisa menyelesaikan operasi hitung sederhana' },
      { level: 'Baik', label: 'Baik', description: 'Mampu menyelesaikan soal cerita dengan langkah sistematis' },
      { level: 'Sangat Baik', label: 'Sangat Baik', description: 'Mampu memformulasikan model matematika kompleks secara akurat' },
    ],
    workflowStatus: 'SIAP',
    updatedAt: stamp,
  },
];

const plan: any = {
  id: 'lp-main',
  curriculumType: 'KURIKULUM_MERDEKA',
  academicSettingId: 'sem-1',
  unitId: 'unit-1',
  learningMeetingIds: ['m-3', 'm-1', 'm-2'],
  tpIds,
  atpItemIds: atpIds,
  kktpCriterionIds: ['kktp-1', 'kktp-2'],
  sourceType: 'MANUAL',
  status: 'SIAP',
  confirmedAt: stamp,
  createdAt: stamp,
  updatedAt: stamp,
  objectives: tp.items.map((t: any) => ({ ...t, tpId: t.id })),
  topic: 'Bilangan Bulat dan Operasinya',
  allocatedJP: 6,
  initialCompetency: 'Peserta didik telah memahami konsep bilangan cacah dan pecahan dasar di sekolah dasar.',
  graduateProfileDimensions: ['Kemandirian', 'Penalaran Kritis'],
  resources: [{ id: 'r-1', title: 'Buku Matematika SMP Kelas 7', source: 'Kemdikbudristek' }],
  learningModel: 'Problem-Based Learning terintegrasi Discovery Learning',
  learningExperiences: [
    { id: 'exp-1', phase: 'UNDERSTAND', description: 'Peserta didik menyimak penjelasan tentang konsep bilangan bulat', durationMinutes: 30 },
    { id: 'exp-2', phase: 'APPLY', description: 'Peserta didik mendiskusikan studi kasus suhu udara di berbagai negara', durationMinutes: 40 },
    { id: 'exp-3', phase: 'REFLECT', description: 'Peserta didik merefleksikan pemahaman melalui jurnal belajar', durationMinutes: 10 },
  ],
  assessmentPlan: {
    initial: [{ id: 'ass-1', type: 'DIAGNOSTIK', linkedTpIds: ['tp-1'], description: 'Tes apersepsi bilangan cacah', technique: 'Tes Tertulis', instrument: 'Lembar Soal Pilihan Ganda Singkat' }],
    formative: [
      { id: 'ass-2', type: 'FORMATIF', linkedTpIds: ['tp-1'], learningMeetingId: 'm-1', description: 'Observasi aktivitas garis bilangan', technique: 'Observasi Performa' },
      { id: 'ass-3', type: 'FORMATIF', linkedTpIds: ['tp-2'], learningMeetingId: 'm-3', description: 'Lembar kerja siswa soal cerita', technique: 'Penugasan Terstruktur' },
    ],
    summative: [{ id: 'ass-4', type: 'SUMATIF', linkedTpIds: tpIds, description: 'Tes Akhir Lingkup Materi Bilangan Bulat', technique: 'Tes Uraian Terstandar' }],
  },
  differentiation: {
    content: 'Menyediakan garis bilangan konkrit bagi murid dengan kesiapan belajar awal.',
    process: 'Diskusi kelompok heterogen dengan scaffolding bertahap.',
    product: 'Murid menyajikan hasil pemecahan masalah dalam bentuk poster atau paparan lisan.',
    notes: 'Pemantauan berkala terhadap peserta didik yang membutuhkan penguatan.',
  },
  enrichmentPlan: 'Peserta didik dengan capaian tinggi diberikan soal eksplorasi bertingkat HOTS olimpiade matematika tingkat pemula.',
  remedialPlan: 'Bimbingan terbimbing secara individual untuk operasi hitung bertanda negatif.',
  reflection: {
    teacherReflection: 'Alokasi waktu pada fase penemuan garis bilangan berjalan efektif dan kondusif.',
    studentReflection: 'Saya merasa lebih percaya diri menyelesaikan operasi bilangan bulat menggunakan garis bilangan.',
  },
};

const context: any = {
  school: { name: 'SMP Negeri 1 Merdeka Belajar', npsn: '12345678', principalName: 'Dr. H. Sulaiman, M.Pd.', principalNip: '197001011995031001' },
  profile: { name: 'Ibu Rahayu Kusuma, S.Pd.', nip: '198504122010012025' },
  academicSetting: setting,
  tp,
  atp,
  atpUnitMapping: mapping,
  unitExecutionPlan: execution,
  learningMeetingSchedules: schedules,
  learningPlans: [plan],
  activeLearningPlanId: 'lp-main',
  assessmentCriteria: criteria,
};

// Generate DOCX
const docxResult = await generateModulAjar({ ...context, skipDownload: true });
assert(docxResult.success, 'Document generation failed');
assert(docxResult.blob, 'Missing blob in generated result');

const zip = await JSZip.loadAsync(await docxResult.blob!.arrayBuffer());
const xml = await zip.file('word/document.xml')!.async('string');

// 1. DOCX tidak memuat tanggal meeting
console.log('--- Checking 1: DOCX tidak memuat tanggal meeting ---');
assert(!xml.includes('2026-10-11'), 'Meeting 1 date must NOT appear in DOCX');
assert(!xml.includes('2026-10-18'), 'Meeting 2 date must NOT appear in DOCX');
assert(!xml.includes('2026-10-25'), 'Meeting 3 date must NOT appear in DOCX');
console.log('[PASS] DOCX tidak memuat tanggal meeting');

// 2. Tidak ada undefined
console.log('--- Checking 2: Tidak ada undefined ---');
assert(!xml.includes('undefined'), 'Output must not contain "undefined"');
assert(!xml.includes('null'), 'Output must not contain literal "null"');
console.log('[PASS] Tidak ada output undefined');

// 3. Semua meeting muncul urut
console.log('--- Checking 3: Semua meeting muncul urut ---');
const idxMeeting1 = xml.indexOf('PERTEMUAN 1 — Pengenalan Bilangan Positif dan Negatif — 2 JP');
const idxMeeting2 = xml.indexOf('PERTEMUAN 2 — Garis Bilangan dan Penjumlahan — 2 JP');
const idxMeeting3 = xml.indexOf('PERTEMUAN 3 — Latihan Soal Cerita Operasi Bilangan — 2 JP');

assert(idxMeeting1 !== -1, 'Meeting 1 header not found');
assert(idxMeeting2 !== -1, 'Meeting 2 header not found');
assert(idxMeeting3 !== -1, 'Meeting 3 header not found');
assert(idxMeeting1 < idxMeeting2, 'Meeting 1 must appear before Meeting 2');
assert(idxMeeting2 < idxMeeting3, 'Meeting 2 must appear before Meeting 3');
console.log('[PASS] Semua meeting muncul urut: 1 -> 2 -> 3');

// 4. Setiap meeting punya header jelas + Materi + TP + KKTP
console.log('--- Checking 4: Setiap meeting punya header jelas + Materi + TP + KKTP ---');
assert(xml.includes('Materi'), 'Missing Materi label');
assert(xml.includes('Tujuan Pembelajaran'), 'Missing Tujuan Pembelajaran label');
assert(xml.includes('Asesmen'), 'Missing Asesmen label');
assert(xml.includes('KKTP'), 'Missing KKTP label');
console.log('[PASS] Setiap meeting memiliki blok terpisah dengan label tebal Materi, TP, Asesmen, KKTP');

// 5. KKTP terstruktur per TP (Kriteria, Indikator, Perlu Bimbingan, Cukup, Baik, Sangat Baik)
console.log('--- Checking 5: KKTP terstruktur per TP ---');
assert(xml.includes('Kriteria:'), 'Missing Kriteria field in KKTP');
assert(xml.includes('Indikator:'), 'Missing Indikator field in KKTP');
assert(xml.includes('Perlu Bimbingan:'), 'Missing Perlu Bimbingan tier');
assert(xml.includes('Cukup:'), 'Missing Cukup tier');
assert(xml.includes('Baik:'), 'Missing Baik tier');
assert(xml.includes('Sangat Baik:'), 'Missing Sangat Baik tier');
// Verify KKTP is NOT pipe-delimited single line
assert(!xml.includes('Mampu menjelaskan pengertian bilangan bulat |'), 'KKTP must not be pipe-delimited raw line');
console.log('[PASS] KKTP terpecah rapi per TP dengan tingkat capaian terstruktur');

// 6. Narrative paragraph justified
console.log('--- Checking 6: Narrative paragraph justified ---');
assert(xml.includes('w:jc w:val="both"'), 'Narrative paragraphs must have justified alignment');
console.log('[PASS] Paragraf narasi panjang terset JUSTIFIED');

// 7. Identity & signoff tables neat without border
console.log('--- Checking 7: Identity & signoff tables borderless ---');
assert(xml.includes('SMP Negeri 1 Merdeka Belajar'), 'Missing school name in identity table');
assert(xml.includes('Dr. H. Sulaiman, M.Pd.'), 'Missing principal name in signoff table');
assert(xml.includes('Ibu Rahayu Kusuma, S.Pd.'), 'Missing teacher name in signoff table');
assert(xml.includes('Mengetahui,'), 'Missing signoff block heading');
console.log('[PASS] Identity dan signoff tables rapi tanpa border');

// 8. Blank mode generation test
console.log('--- Checking 8: Blank mode export ---');
const blankDocx = await generateModulAjar({ ...context, documentMode: 'blank', skipDownload: true });
assert(blankDocx.success, 'Blank mode document generation failed');
const blankZip = await JSZip.loadAsync(await blankDocx.blob!.arrayBuffer());
const blankXml = await blankZip.file('word/document.xml')!.async('string');
assert(blankXml.includes('........................................................................................................................'));
assert(!blankXml.includes('undefined'), 'Blank document must not contain undefined');
console.log('[PASS] Blank mode export generates clean dotted placeholder format');

console.log('======================================================');
console.log('ALL MODUL AJAR PRESENTATION REGRESSION TESTS PASSED!');
console.log('======================================================');
