import type { DocumentGenerationContext } from '../src/services/documentEngine/types';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { generateATP } from '../src/services/documentEngine/generators/atpGenerator';
import { generatePROMES } from '../src/services/documentEngine/generators/promesGenerator';
import { generatePdfDocument } from '../src/services/documentEngine/renderers/pdf/pdfDocGenerators';
import { generateZipBundle } from '../src/services/documentEngine/zipBundle';
import { buildATPDocumentProjection, ATP_DOCUMENT_COLUMNS } from '../src/services/documentEngine/atpDocumentProjection';
import { buildPromesProjection } from '../src/services/documentEngine/promesProjection';

const stamp = '2026-10-20T08:00:00Z';

function createMockContext(opts?: {
  semester?: '1' | '2';
  schoolName?: string;
  teacherName?: string;
  principalName?: string;
  numAtpItems?: number;
}):DocumentGenerationContext {
  const sem = opts?.semester || '1';
  const year = sem === '1' ? 2026 : 2027;
  const month = sem === '1' ? '10' : '01';
  const itemCount = opts?.numAtpItems ?? 4;

  const tpItems = Array.from({ length: itemCount }, (_, i) => ({competence: 'Memahami',contentScope:'Informatika',
    id: `tp-${i + 1}`,
    code: `TP.${i + 1}`,
    statement: `Mampu memahami dan mempraktikkan konsep pembelajaran tahap ${i + 1}`,
    order: i + 1,
  }));

  const atpItems = Array.from({ length: itemCount }, (_, i) => ({
    id: `atp-${i + 1}`,
    stepNumber: i + 1,
    focus: `Fokus unit pembelajaran bertahap ${i + 1}`,
    linkedTpIds: [`tp-${i + 1}`],
    semester: (i < 2 ? 1 : 2) as 1|2,
    unitTitle: i < 2 ? 'Bab 1 Pembelajaran Terpadu' : 'Bab 2 Pembelajaran Lanjutan',
    jp: 3,
  }));

  const materials = tpItems.map((t, idx) => ({
    id: `mat-${idx + 1}`,
    title: `Materi Pokok ${idx + 1}`,
    order: idx + 1,
    linkedTpIds: [t.id],
    linkedAtpItemIds: [atpItems[idx].id],
  }));

  const units = [
    {
      id: 'unit-1',
      title: 'Bab 1 Pembelajaran Terpadu',
      order: 1,
      linkedTpIds: [tpItems[0].id, tpItems[1].id],
      linkedAtpItemIds: [atpItems[0].id, atpItems[1].id],
      materials: [materials[0], materials[1]],
    },
    {
      id: 'unit-2',
      title: 'Bab 2 Pembelajaran Lanjutan',
      order: 2,
      linkedTpIds: [tpItems[2].id, tpItems[3].id],
      linkedAtpItemIds: [atpItems[2].id, atpItems[3].id],
      materials: [materials[2], materials[3]],
    },
  ];

  const meetings = [
    {
      id: 'meet-1',
      title: 'Pertemuan 1',
      unitId: 'unit-1',
      order: 1,
      jp: 3,
      linkedTpIds: [tpItems[0].id],
      linkedAtpItemIds: [atpItems[0].id],
      materialIds: [materials[0].id],
    },
    {
      id: 'meet-2',
      title: 'Pertemuan 2',
      unitId: 'unit-1',
      order: 2,
      jp: 3,
      linkedTpIds: [tpItems[1].id],
      linkedAtpItemIds: [atpItems[1].id],
      materialIds: [materials[1].id],
    },
    {
      id: 'meet-3',
      title: 'Pertemuan 3',
      unitId: 'unit-2',
      order: 1,
      jp: 3,
      linkedTpIds: [tpItems[2].id],
      linkedAtpItemIds: [atpItems[2].id],
      materialIds: [materials[2].id],
    },
    {
      id: 'meet-4',
      title: 'Pertemuan 4',
      unitId: 'unit-2',
      order: 2,
      jp: 3,
      linkedTpIds: [tpItems[3].id],
      linkedAtpItemIds: [atpItems[3].id],
      materialIds: [materials[3].id],
    },
  ];

  const executionUnits = [
    { unitId: 'unit-1', meetings: [meetings[0], meetings[1]] },
    { unitId: 'unit-2', meetings: [meetings[2], meetings[3]] },
  ];

  const schedules:NonNullable<DocumentGenerationContext['learningMeetingSchedules']> = [
    {
      semesterPlanId: 'sem-1',
      semester: 1,
      schedule: {
        id:'fixture-schedule',unresolvedMeetingIds:[],basedOnMappingUpdatedAt:stamp,basedOnUnitExecutionPlanUpdatedAt:stamp,basedOnSubjectWeeklyScheduleUpdatedAt:stamp,basedOnCalendarUpdatedAt:stamp,basedOnWeeklyJP:3,updatedAt:stamp,
        semesterPlanId: 'sem-1',
        status: 'COMPLETE',
        entries: [
          {
            meetingId: 'meet-1',sessionId:'session-meet-1',sourceSlotId:'subject-slot:sem-1:session-meet-1:2026-10-12',
            semesterPlanId: 'sem-1',
            unitId: 'unit-1',
            date: '2026-10-12',
            jp: 3,
            mode: 'MANUAL_OVERRIDE',
            dayOfWeek: 1,
            weekIndex: 1,
          },
          {
            meetingId: 'meet-2',sessionId:'session-meet-2',sourceSlotId:'subject-slot:sem-1:session-meet-2:2026-10-19',
            semesterPlanId: 'sem-1',
            unitId: 'unit-1',
            date: '2026-10-19',
            jp: 3,
            mode: 'MANUAL_OVERRIDE',
            dayOfWeek: 1,
            weekIndex: 2,
          },
        ],
      },
    },
    {
      semesterPlanId: 'sem-2',
      semester: 2,
      schedule: {
        id:'fixture-schedule',unresolvedMeetingIds:[],basedOnMappingUpdatedAt:stamp,basedOnUnitExecutionPlanUpdatedAt:stamp,basedOnSubjectWeeklyScheduleUpdatedAt:stamp,basedOnCalendarUpdatedAt:stamp,basedOnWeeklyJP:3,updatedAt:stamp,
        semesterPlanId: 'sem-2',
        status: 'COMPLETE',
        entries: [
          {
            meetingId: 'meet-3',sessionId:'session-meet-3',sourceSlotId:'subject-slot:sem-2:session-meet-3:2027-01-11',
            semesterPlanId: 'sem-2',
            unitId: 'unit-2',
            date: '2027-01-11',
            jp: 3,
            mode: 'MANUAL_OVERRIDE',
            dayOfWeek: 1,
            weekIndex: 1,
          },
          {
            meetingId: 'meet-4',sessionId:'session-meet-4',sourceSlotId:'subject-slot:sem-2:session-meet-4:2027-01-18',
            semesterPlanId: 'sem-2',
            unitId: 'unit-2',
            date: '2027-01-18',
            jp: 3,
            mode: 'MANUAL_OVERRIDE',
            dayOfWeek: 1,
            weekIndex: 2,
          },
        ],
      },
    },
  ];

  const calendarDays = Array.from({ length: 31 }, (_, i) => ({
    id: `d-${i + 1}`,
    academicCalendarId: `cal-${sem}`,
    date: `${year}-${month}-${String(i + 1).padStart(2, '0')}`,
    status: 'EFFECTIVE_LEARNING' as const,
  }));

  return {
    school: {
      id: 'school-1',
      name: opts?.schoolName || 'SMP Negeri 1 Pembelajaran',
      npsn: '20109988', village:'Desa',province:'Jawa Barat',createdAt:stamp,updatedAt:stamp,
      address: 'Jl. Merdeka Belajar No. 10',
      district: 'Kecamatan Cerdas',
      regency: 'Kabupaten Maju',
      principalName: opts?.principalName || 'Drs. H. Kepala Sekolah, M.Pd.',
      principalNip: '197001011995011001',
    },
    profile: {
      id: 'teacher-1',
      name: opts?.teacherName || 'Ibu Guru Hebat, S.Pd.',
      nip: '198502022010012002',status:'PNS',defaultSubject:'Informatika',defaultLevel:'SMP',schoolId:'school-1',createdAt:stamp,updatedAt:stamp,
    },
    academicSetting: {
      id: `sem-${sem}`,
      profileId: 'teacher-1',
      subject: 'Informatika',
      grade: 'Kelas 7',
      phase: 'D',
      semester: sem==='1'?'1 (Ganjil)':'2 (Genap)', updatedAt:stamp,
      academicYear: '2026/2027',
      curriculum: 'Kurikulum Merdeka',
      curriculumType: 'KURIKULUM_MERDEKA',
    },
    documentDate: `${year}-${month}-15`,
    skipDownload: true,
    documentMode: 'data' as const,
    cp: {
      id: `cp-${sem}`,
      academicSettingId: `sem-${sem}`,
      generalDescription: 'Capaian Pembelajaran Informatika Fase D secara menyeluruh.',
      elements: [
        {
          id: 'elem-1',
          name: 'Berpikir Komputasional',
          content: 'Peserta didik mampu menerapkan berpikir komputasional dalam menyelesaikan persoalan.',
        },
      ],
      updatedAt: stamp,
    },
    tp: {
      id: `tp-${sem}`,
      academicSettingId: `sem-${sem}`,
      workflowStatus: 'SIAP',
      items: tpItems,
      updatedAt: stamp,
    },
    atp: {
      id: `atp-${sem}`,
      academicSettingId: `sem-${sem}`,
      rationale: 'Rasional alur pembelajaran dirancang logis dari dasar hingga aplikatif.',
      workflowStatus: 'SIAP',
      items: atpItems,
      updatedAt: stamp,
    },
    atpUnitMapping: {
      id: `mapping-${sem}`,atpId:`atp-${sem}`,
      academicSettingId: `sem-${sem}`,
      units,
      updatedAt: stamp,
    },
    unitExecutionPlan: {
      id: `exec-${sem}`,
      academicSettingId: `sem-${sem}`,
      mappingId: `mapping-${sem}`,
      units: executionUnits,
      semesterPlacement: { updatedAt:stamp,mode: 'CONTIGUOUS_BOUNDARY', semester1LastUnitId: 'unit-1' },
      basedOnMappingUpdatedAt: stamp,updatedAt:stamp,
    },
    learningMeetingSchedules: schedules,
    calendar: {
      id: `cal-${sem}`,
      academicSettingId: `sem-${sem}`,
      startDate: `${year}-${month}-01`,
      endDate: `${year}-${month}-31`,
      schoolDaysPerWeek: 5,academicYear:'2026/2027',semester:sem==='1'?'1 (Ganjil)':'2 (Genap)',updatedAt:stamp,
      workflowStatus: 'CONFIRMED',
    },
    calendarDays,
    semesterJPSetting: {
      semesterPlanId: `sem-${sem}`,
      actualScheduledWeeklyJP: 3,
      source: 'TEACHER_CONFIRMED',
    },
    zipAnnualSource: {
      yearPlan: {
        id: 'year-1',level:'SMP',createdAt:stamp,updatedAt:stamp,
        profileId: 'teacher-1',
        schoolId: 'school-1',
        academicYear: '2026/2027',
        subject: 'Informatika',
        grade: 'Kelas 7',
        curriculumType: 'KURIKULUM_MERDEKA',
      },
      semesterPlans: [1, 2].map((n) => ({
        id: `sem-${n}`,
        yearPlanId: 'year-1',
        semester: n as 1|2,createdAt:stamp,
        updatedAt: stamp,
      })),
      semesterJPSettings: [1, 2].map((n) => ({
        semesterPlanId: `sem-${n}`,
        value: {
          semesterPlanId: `sem-${n}`,
          actualScheduledWeeklyJP: 3,
          source: 'TEACHER_CONFIRMED',
        },
      })),
      semesterData: {
        academicCalendar: [1, 2].map((n) => ({
          semesterPlanId: `sem-${n}`,
          value: {
            calendar: {
              id: `cal-${n}`,
              academicSettingId: `sem-${n}`,
              startDate: n === 1 ? '2026-10-01' : '2027-01-01',
              endDate: n === 1 ? '2026-10-31' : '2027-01-31',
              schoolDaysPerWeek: 5,academicYear:'2026/2027',semester:sem==='1'?'1 (Ganjil)':'2 (Genap)',updatedAt:stamp,
              workflowStatus: 'CONFIRMED',
            },
            days: Array.from({ length: 31 }, (_, i) => ({
              id: `d-${n}-${i + 1}`,
              academicCalendarId: `cal-${n}`,
              date: `${n === 1 ? '2026-10' : '2027-01'}-${String(i + 1).padStart(2, '0')}`,
              status: 'EFFECTIVE_LEARNING',
            })),
          },
        })),
        learningPlan: [1, 2].map((n) => ({
          semesterPlanId: `sem-${n}`,
          value: [],
        })),
        assessmentCriteria: [1, 2].map((n) => ({
          semesterPlanId: `sem-${n}`,
          value: [],
        })),
        learningMeetingSchedules: [1, 2].map((n) => ({
          semesterPlanId: `sem-${n}`,
          value: schedules[n - 1].schedule,
        })),
        timeAllocation: [],
        assessmentPlan: [],
        assessmentPackage: [],
        roster: [],
        attendance: [],
        grade: [],
        remedial: [],
        enrichment: [],
      },
    },
  };
}

async function extractDocxXml(blob: Blob): Promise<string> {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  return zip.file('word/document.xml')!.async('string');
}

async function parsePdf(blob: Blob) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useSystemFonts: true });
  const parsed = await task.promise;
  let fullText = '';
  for (let i = 1; i <= parsed.numPages; i++) {
    const page = await parsed.getPage(i);
    const content = await page.getTextContent();
    fullText += ' ' + content.items.map((item: any) => item.str || '').join(' ');
  }
  return { parsed, task, fullText: fullText.replace(/\s+/g, ' ').trim() };
}

async function runTests() {
  console.log('--- STARTING DOCUMENT ORIENTATION & FIDELITY REGRESSION TESTS ---');

  // =========================================================================
  // TEST 1: ATP PDF/DOCX = A4 Portrait
  // =========================================================================
  console.log('Testing Test 1: ATP PDF/DOCX = A4 Portrait...');
  const atpCtx = createMockContext({ semester: '1' });

  // 1a. DOCX
  const atpDocx = await generateATP(atpCtx);
  const atpXml = await extractDocxXml(atpDocx.blob!);
  assert(atpXml.includes('w:orient="portrait"'), 'ATP DOCX must specify w:orient="portrait"');
  assert(!atpXml.includes('w:orient="landscape"'), 'ATP DOCX must NOT contain w:orient="landscape"');
  assert(atpXml.includes('<w:cantSplit/>'), 'ATP DOCX table rows must have cantSplit');
  assert(atpXml.includes('<w:tblHeader'), 'ATP DOCX table must have tblHeader');

  // 1b. PDF
  const atpPdf = await generatePdfDocument('ATP', atpCtx);
  const atpParsedPdf = await parsePdf(atpPdf.blob);
  const atpPage1 = await atpParsedPdf.parsed.getPage(1);
  const atpWidth = atpPage1.view[2];
  const atpHeight = atpPage1.view[3];
  assert(atpHeight > atpWidth, `ATP PDF must be Portrait (height ${atpHeight} > width ${atpWidth})`);
  // Standard A4 in points is 595.28 x 841.89
  assert(Math.abs(atpWidth - 595.28) < 5, `ATP PDF width should be approx 595pt (was ${atpWidth})`);
  assert(Math.abs(atpHeight - 841.89) < 5, `ATP PDF height should be approx 842pt (was ${atpHeight})`);
  await atpParsedPdf.task.destroy();
  console.log('PASS Test 1: ATP DOCX & PDF are both verified A4 Portrait.');

  // =========================================================================
  // TEST 2: PROMES PDF/DOCX = A4 Landscape
  // =========================================================================
  console.log('Testing Test 2: PROMES PDF/DOCX = A4 Landscape...');
  const promesCtx = createMockContext({ semester: '1' });

  // 2a. DOCX
  const promesDocx = await generatePROMES(promesCtx);
  const promesXml = await extractDocxXml(promesDocx.blob!);
  assert(promesXml.includes('w:orient="landscape"'), 'PROMES DOCX must specify w:orient="landscape"');
  assert(promesXml.includes('<w:tblHeader'), 'PROMES DOCX table must have tblHeader');

  // 2b. PDF
  const promesPdf = await generatePdfDocument('PROMES', promesCtx);
  const promesParsedPdf = await parsePdf(promesPdf.blob);
  const promesPage1 = await promesParsedPdf.parsed.getPage(1);
  const promesWidth = promesPage1.view[2];
  const promesHeight = promesPage1.view[3];
  assert(promesWidth > promesHeight, `PROMES PDF must be Landscape (width ${promesWidth} > height ${promesHeight})`);
  assert(Math.abs(promesWidth - 841.89) < 5, `PROMES PDF width should be approx 842pt (was ${promesWidth})`);
  assert(Math.abs(promesHeight - 595.28) < 5, `PROMES PDF height should be approx 595pt (was ${promesHeight})`);
  await promesParsedPdf.task.destroy();
  console.log('PASS Test 2: PROMES DOCX & PDF are both verified A4 Landscape.');

  // =========================================================================
  // TEST 3: PDF and DOCX Substance & Metadata Equality
  // =========================================================================
  console.log('Testing Test 3: PDF & DOCX Substance & Metadata Equality...');
  // For ATP:
  const atpProj = buildATPDocumentProjection(atpCtx);
  for (const header of ATP_DOCUMENT_COLUMNS) {
    assert(atpXml.includes(header), `DOCX must contain ATP column: ${header}`);
    assert(atpParsedPdf.fullText.includes(header), `PDF must contain ATP column: ${header}`);
  }
  assert(atpXml.includes(atpCtx.school.name), 'ATP DOCX must contain school name');
  assert(atpParsedPdf.fullText.includes(atpCtx.school.name), 'ATP PDF must contain school name');
  assert(atpXml.includes(atpCtx.profile.name), 'ATP DOCX must contain teacher name');
  assert(atpParsedPdf.fullText.includes(atpCtx.profile.name), 'ATP PDF must contain teacher name');
  assert(atpXml.includes(atpCtx.school.principalName), 'ATP DOCX must contain principal name');
  assert(atpParsedPdf.fullText.includes(atpCtx.school.principalName), 'ATP PDF must contain principal name');
  assert(atpXml.includes(atpCtx.atp.rationale), 'ATP DOCX must contain rationale');
  assert(atpParsedPdf.fullText.includes(atpCtx.atp.rationale), 'ATP PDF must contain rationale');

  // For PROMES:
  const promesParsedPdf2 = await parsePdf(promesPdf.blob);
  const promesText = promesParsedPdf2.fullText;
  // Metadata rows:
  const expectedPromesSnippets = [
    'Alokasi Intrakurikuler per Minggu',
    'Minggu Efektif Semester',
    'Total Kapasitas JP Tersedia',
    'Matriks Distribusi Alokasi Waktu Pembelajaran Bulanan',
    'Status & Catatan Pelaksanaan',
    promesCtx.school.name,
    promesCtx.profile.name,
    promesCtx.school.principalName,
  ];
  for (const snip of expectedPromesSnippets) {
    const xmlSnip = snip.replace(/&/g, '&amp;');
    assert(promesXml.includes(xmlSnip), `PROMES DOCX must include "${snip}"`);
    assert(
      promesText.replace(/\s+/g, ' ').includes(snip.replace(/\s+/g, ' ')),
      `PROMES PDF must include "${snip}"`
    );
  }
  await promesParsedPdf2.task.destroy();
  console.log('PASS Test 3: PDF and DOCX share identical metadata, sections, and values.');

  // =========================================================================
  // TEST 4: Long Tables and Multi-Page Integrity
  // =========================================================================
  console.log('Testing Test 4: Long Tables and Multi-Page Handling...');
  const longAtpCtx = createMockContext({ semester: '1', numAtpItems: 18 });
  const longAtpPdf = await generatePdfDocument('ATP', longAtpCtx);
  const longAtpParsed = await parsePdf(longAtpPdf.blob);
  assert(longAtpParsed.parsed.numPages > 1, `Long ATP PDF should span multiple pages (pages: ${longAtpParsed.parsed.numPages})`);

  // Verify every page remains in Portrait
  for (let p = 1; p <= longAtpParsed.parsed.numPages; p++) {
    const page = await longAtpParsed.parsed.getPage(p);
    assert(page.view[3] > page.view[2], `Page ${p} of long ATP PDF must be Portrait`);
  }
  await longAtpParsed.task.destroy();
  console.log('PASS Test 4: Long ATP table seamlessly spans multiple pages in Portrait without clipping.');

  // =========================================================================
  // TEST 5: Target Identity After Import ("Ganti Identitas Saja")
  // =========================================================================
  console.log('Testing Test 5: Target Identity After Import ("Ganti Identitas Saja")...');
  const targetSchool = 'SMP Negeri 99 Target Baru';
  const targetTeacher = 'Guru Sasaran Baru, M.Pd.';
  const targetPrincipal = 'Dr. Kepala Baru, M.M.';
  const importedCtx = createMockContext({
    semester: '1',
    schoolName: targetSchool,
    teacherName: targetTeacher,
    principalName: targetPrincipal,
  });

  const importedAtpDocx = await generateATP(importedCtx);
  const importedAtpXml = await extractDocxXml(importedAtpDocx.blob!);
  const importedAtpPdf = await generatePdfDocument('ATP', importedCtx);
  const importedAtpParsed = await parsePdf(importedAtpPdf.blob);

  assert(importedAtpXml.includes(targetSchool), 'DOCX must contain new target school');
  assert(importedAtpXml.includes(targetTeacher), 'DOCX must contain new target teacher');
  assert(importedAtpXml.includes(targetPrincipal), 'DOCX must contain new target principal');
  assert(importedAtpParsed.fullText.includes(targetSchool), 'PDF must contain new target school');
  assert(importedAtpParsed.fullText.includes(targetTeacher), 'PDF must contain new target teacher');
  assert(importedAtpParsed.fullText.includes(targetPrincipal), 'PDF must contain new target principal');

  assert(!importedAtpXml.includes('SMP Negeri 1 Pembelajaran'), 'DOCX must not contain old school');
  assert(!importedAtpParsed.fullText.includes('SMP Negeri 1 Pembelajaran'), 'PDF must not contain old school');
  await importedAtpParsed.task.destroy();
  console.log('PASS Test 5: Target identity reflects cleanly in both DOCX and PDF.');

  // =========================================================================
  // TEST 6: 2-Semester ZIP Export & Completeness Verification
  // =========================================================================
  console.log('Testing Test 6: 2-Semester ZIP Export & Completeness Check...');
  for (const sem of ['1', '2'] as const) {
    const zipCtx = createMockContext({ semester: sem });
    const zipResult = await generateZipBundle(
      {
        format: 'both',
        documentMode: 'data',
        types: ['ATP', 'PROMES'],
      },
      zipCtx as any
    );

    assert(zipResult.zipBlob && zipResult.zipBlob.size > 0, `ZIP for Semester ${sem} must not be empty`);
    assert(zipResult.pdfCount > 0, `ZIP for Semester ${sem} must contain PDF files`);
    assert(zipResult.docxCount > 0, `ZIP for Semester ${sem} must contain DOCX files`);
    if (!zipResult.isComplete) {
      console.log('ITEM RESULTS SEMESTER', sem, JSON.stringify(zipResult.itemResults, null, 2));
    }
    assert.equal(zipResult.isComplete, true, `Targeted ZIP for Semester ${sem} must report isComplete=true`);

    // Verify ZIP contains ATP portrait docx and PROMES landscape docx
    const zipArchive = await JSZip.loadAsync(await zipResult.zipBlob.arrayBuffer());
    const fileNames = Object.keys(zipArchive.files);
    assert(fileNames.some((f) => f.includes('ATP') && f.endsWith('.docx')), 'ZIP must include ATP .docx');
    assert(fileNames.some((f) => f.includes('ATP') && f.endsWith('.pdf')), 'ZIP must include ATP .pdf');
    assert(fileNames.some((f) => f.includes('PROMES') && f.endsWith('.docx')), 'ZIP must include PROMES .docx');
    assert(fileNames.some((f) => f.includes('PROMES') && f.endsWith('.pdf')), 'ZIP must include PROMES .pdf');
  }

  // Verify that an incomplete bundle reports isComplete === false
  const incompleteCtx = createMockContext({ semester: '1' });
  const partialZipResult = await generateZipBundle(
    {
      format: 'both',
      documentMode: 'data',
      types: ['ATP', 'PROMES', 'KKTP'], // KKTP will be skipped because kktp data not configured
    },
    incompleteCtx as any
  );
  assert.equal(
    partialZipResult.isComplete,
    false,
    'ZIP bundle must report isComplete=false when any requested document is skipped or failed'
  );
  assert((partialZipResult.skippedCount || 0) > 0, 'Partial ZIP must count skipped documents');

  // Verify Blank Mode ZIP export
  const blankCtx = createMockContext({ semester: '1' });
  blankCtx.documentMode = 'blank';
  const blankZipResult = await generateZipBundle(
    {
      format: 'both',
      documentMode: 'blank',
      types: ['ATP', 'PROMES'],
    },
    blankCtx as any
  );
  assert(blankZipResult.zipBlob && blankZipResult.zipBlob.size > 0, 'Blank ZIP must not be empty');
  assert.equal(blankZipResult.isComplete, true, 'Blank ZIP must report isComplete=true');

  console.log('PASS Test 6: 2-Semester ZIP export contains both formats and accurately enforces completion status.');

  console.log('--- ALL REGRESSION TESTS PASSED SUCCESSFULLY! ---');
}

runTests().catch((err) => {
  console.error('FAILED REGRESSION TEST:', err);
  process.exit(1);
});
