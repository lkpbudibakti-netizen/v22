import assert from 'node:assert/strict';
import { assertV21TimeProjectionContract } from './helpers/v21TimeProjectionContract';
import { createReadyV21WorkflowFixture,v21DocumentContext } from './fixtures/v21ReadyWorkflowFixture';
import { generateAlokasiWaktu } from '../src/services/documentEngine/generators/alokasiWaktuGenerator';
import { generatePdfDocument } from '../src/services/documentEngine/renderers/pdf/pdfDocGenerators';
import { buildK13AlokasiWaktuRows } from '../src/services/documentEngine/k13AlokasiWaktuHelper';
import { validateDocumentRequirements } from '../src/services/documentEngine';
import type { DocumentGenerationContext } from '../src/services/documentEngine/types';
import type {AcademicSetting,K13Analysis,TimeAllocation} from '../src/types';
async function runTest(name:string,fn:()=>unknown){await fn();console.log('PASS '+name);}
async function main(){
await assertV21TimeProjectionContract('ALOKASI_WAKTU');
const {school,profile}=v21DocumentContext(createReadyV21WorkflowFixture());
  const k13Setting: AcademicSetting = {
    id: 'k13-setting-1',
    profileId: profile.id,
    curriculum: 'Kurikulum 2013',
    curriculumType: 'K13',
    academicYear: '2026/2027',
    semester: '1 (Ganjil)',
    level: 'SD',
    grade: '4',
    phase: '',
    subject: 'Matematika',
    subjectWeeklyJP: 4,
    totalHoursPerWeek: 4,
    updatedAt: new Date().toISOString(),
  };

  const sampleK13Analysis: K13Analysis = {
    id: 'k13-analysis-1',
    academicSettingId: 'k13-setting-1',
    updatedAt: new Date().toISOString(),
    items: [
      { id: 'kd-3.1', skl: 'SKL 1', ki: 'KI 3', kd: '3.1', indikator: 'Indikator 1', materi: 'Operasi Hitung', alokasiJp: 8, kegiatan: 'Latihan' },
      { id: 'kd-3.2', skl: 'SKL 1', ki: 'KI 3', kd: '3.2', indikator: 'Indikator 2', materi: 'Pecahan', alokasiJp: 10, kegiatan: 'Diskusi' },
    ],
  };

  // K13 CASE A — Canonical allocation priority
  await runTest('K13 Case A. TimeAllocation.allocatedJP (12) overrides K13Item.alokasiJp (8)', () => {
    const k13Allocations: TimeAllocation[] = [
      { id: 'alloc-k13-1', academicSettingId: 'k13-setting-1', sourceType: 'KD', sourceId: 'kd-3.1', allocatedJP: 12, jp: 12, startWeek: 1, endWeek: 3 },
    ];
    const k13Rows = buildK13AlokasiWaktuRows(sampleK13Analysis.items, k13Allocations);
    assert.strictEqual(k13Rows[0].allocatedJP, 12, 'Must use 12 JP from TimeAllocation');
  });

  // K13 CASE B — Legacy fallback
  await runTest('K13 Case B. Falls back to item.alokasiJp (8) when no TimeAllocation exists', () => {
    const k13Rows = buildK13AlokasiWaktuRows(sampleK13Analysis.items, []);
    assert.strictEqual(k13Rows[0].allocatedJP, 8, 'Must fall back to item.alokasiJp = 8');
  });

  // K13 CASE C — Week range
  await runTest('K13 Case C. Displays startWeek to endWeek as "Pekan 3–6"', () => {
    const k13Allocations: TimeAllocation[] = [
      { id: 'alloc-k13-1', academicSettingId: 'k13-setting-1', sourceType: 'KD', sourceId: 'kd-3.1', allocatedJP: 12, jp: 12, startWeek: 3, endWeek: 6 },
    ];
    const k13Rows = buildK13AlokasiWaktuRows(sampleK13Analysis.items, k13Allocations);
    assert.strictEqual(k13Rows[0].weekDisplay, 'Pekan 3–6');
  });

  // K13 CASE D — Preview / DOCX / PDF source parity
  await runTest('K13 Case D. DOCX and PDF execute cleanly for K13 using buildK13AlokasiWaktuRows', async () => {
    const ctx: DocumentGenerationContext = {
      school,
      profile,
      academicSetting: k13Setting,
      k13Analysis: sampleK13Analysis,
      timeAllocations: [
        { id: 'alloc-k13-1', academicSettingId: 'k13-setting-1', sourceType: 'KD', sourceId: 'kd-3.1', allocatedJP: 12, jp: 12, startWeek: 1, endWeek: 3 },
      ],
      documentMode: 'data',
      skipDownload: true,
    };

    const docxRes = await generateAlokasiWaktu(ctx);
    assert.strictEqual(docxRes.success, true);
    assert.ok(docxRes.blob);

    const pdfRes = await generatePdfDocument('ALOKASI_WAKTU', ctx);
    assert.ok(pdfRes.blob);
    assert.strictEqual(pdfRes.fileName.includes('Alokasi_Waktu'), true);
  });

  // K13 CASE E — missing K13 analysis
  await runTest('K13 Case E. Missing K13 analysis fails validation in data mode, succeeds in blank mode', () => {
    const invalidCtx: DocumentGenerationContext = {
      school,
      profile,
      academicSetting: k13Setting,
      k13Analysis: { id: 'empty-1', academicSettingId: 'k13-setting-1', items: [], updatedAt: '' },
      documentMode: 'data',
      documentDate: '2026-07-15',
    };

    const valData = validateDocumentRequirements('ALOKASI_WAKTU', invalidCtx);
    assert.strictEqual(valData.isValid, false);

    const blankCtx: DocumentGenerationContext = { ...invalidCtx, documentMode: 'blank' };
    const valBlank = validateDocumentRequirements('ALOKASI_WAKTU', blankCtx);
    assert.strictEqual(valBlank.isValid, true);
  });

  // K13 CASE F — no Merdeka contamination
  await runTest('K13 Case F. K13 does not require SemesterJPSetting, ATP annual, or ATP_ITEM allocation', () => {
    const pureK13Ctx: DocumentGenerationContext = {
      school,
      profile,
      academicSetting: k13Setting,
      k13Analysis: sampleK13Analysis,
      atp: undefined,
      semesterJPSetting: undefined,
      calendar: undefined,
      calendarDays: [],
      timeAllocations: [],
      documentMode: 'data',
      documentDate: '2026-07-15',
    };

    const valRes = validateDocumentRequirements('ALOKASI_WAKTU', pureK13Ctx);
    assert.strictEqual(valRes.isValid, true, 'K13 must pass validation without Merdeka prerequisites');
  });


}
main().catch(error=>{console.error(error);process.exitCode=1;});
