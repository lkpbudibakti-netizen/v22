import assert from 'node:assert/strict';
import { buildK13ProtaProjection, validateDocumentRequirements } from '../src/services/documentEngine';
import type { DocumentGenerationContext, ProtaSemesterAllocationBundle } from '../src/services/documentEngine';
import type { K13Analysis, TimeAllocation } from '../src/types';
import { assertV21TimeProjectionContract } from './helpers/v21TimeProjectionContract';
import { createReadyV21WorkflowFixture, v21DocumentContext } from './fixtures/v21ReadyWorkflowFixture';
async function runTest(name:string, fn:()=>unknown){await fn();console.log('PASS '+name);}
async function main(){
await assertV21TimeProjectionContract('PROTA');
const {school,profile,academicSetting:activeSetting}=v21DocumentContext(createReadyV21WorkflowFixture());
const sampleK13Analysis: K13Analysis = {
    id: 'k13-anal-1',
    academicSettingId: 'setting-k13',
    updatedAt: '',
    items: [
      { id: 'kd-3.1', skl: 'SKL 1', ki: 'KI 3', kd: '3.1', indikator: 'Ind 1', materi: 'Operasi Hitung', alokasiJp: 16, kegiatan: 'Aktivitas 1' },
      { id: 'kd-3.2', skl: 'SKL 1', ki: 'KI 3', kd: '3.2', indikator: 'Ind 2', materi: 'Pecahan', alokasiJp: 20, kegiatan: 'Aktivitas 2' },
    ],
  };
const sampleK13Allocations: TimeAllocation[] = [
    { id: 'k13-alloc-1', academicSettingId: 'setting-k13', sourceType: 'KD', sourceId: 'kd-3.1', allocatedJP: 18, jp: 18 },
  ];
const k13Bundles: ProtaSemesterAllocationBundle[] = [
    { semesterPlanId: 'sem-plan-k13-s1', semester: 1, allocations: sampleK13Allocations },
  ];
await runTest('Case K1. K13 analysis validation succeeds without ATP Merdeka requirements', () => {
    const ctx: DocumentGenerationContext = {
      school,
      profile,
      academicSetting: { ...activeSetting, curriculumType: 'K13', curriculum: 'Kurikulum 2013' },
      k13Analysis: sampleK13Analysis,
      documentMode: 'data',
      documentDate: '2026-07-15',
    };

    const val = validateDocumentRequirements('PROTA', ctx);
    assert.strictEqual(val.isValid, true);
  });
await runTest('Case K2. buildK13ProtaProjection resolves correct rows', () => {
    const ctx: DocumentGenerationContext = {
      school,
      profile,
      academicSetting: { ...activeSetting, curriculumType: 'K13', curriculum: 'Kurikulum 2013' },
      k13Analysis: sampleK13Analysis,
      protaSemesterAllocations: k13Bundles,
      documentMode: 'data',
      documentDate: '2026-07-15',
    };

    const proj = buildK13ProtaProjection(ctx);
    assert.strictEqual(proj.isReady, true);
    assert.strictEqual(proj.rows.length, 2);
    assert.strictEqual(proj.rows[0].kd, '3.1');
    assert.strictEqual(proj.rows[1].kd, '3.2');
  });
await runTest('Case K3. K13 TimeAllocation JP (18) overrides item.alokasiJp (16)', () => {
    const ctx: DocumentGenerationContext = {
      school,
      profile,
      academicSetting: { ...activeSetting, curriculumType: 'K13', curriculum: 'Kurikulum 2013' },
      k13Analysis: sampleK13Analysis,
      protaSemesterAllocations: k13Bundles,
      documentMode: 'data',
      documentDate: '2026-07-15',
    };

    const proj = buildK13ProtaProjection(ctx);
    assert.strictEqual(proj.rows[0].allocatedJP, 18); // alloc is 18
    assert.strictEqual(proj.rows[1].allocatedJP, 20); // fall back to item.alokasiJp (20)
  });
await runTest('Case K4. K13 does not require Annual ATP, SemesterJPSetting, or buildPromesProjection', () => {
    const ctx: DocumentGenerationContext = {
      school,
      profile,
      academicSetting: { ...activeSetting, curriculumType: 'K13', curriculum: 'Kurikulum 2013' },
      k13Analysis: sampleK13Analysis,
      protaSemesterAllocations: k13Bundles,
      documentMode: 'data',
      documentDate: '2026-07-15',
    };

    const proj = buildK13ProtaProjection(ctx);
    assert.strictEqual(proj.isReady, true);
  });
await runTest('Case K5. Unresolved K13 item semester resolves to null and display evaluates to -', () => {
    const k13WithLegacySemester = {
      ...sampleK13Analysis,
      items: sampleK13Analysis.items.map((item) => ({
        ...item,
        semester: 1,
      })),
    };

    const ctx: DocumentGenerationContext = {
      school,
      profile,
      academicSetting: { ...activeSetting, curriculumType: 'K13', curriculum: 'Kurikulum 2013' },
      k13Analysis: k13WithLegacySemester,
      protaSemesterAllocations: [], // No allocations at all
      documentMode: 'data',
      documentDate: '2026-07-15',
    };

    const proj = buildK13ProtaProjection(ctx);
    assert.strictEqual(proj.rows[0].semester, null);
    assert.strictEqual(proj.rows[1].semester, null);
  });
}
main().catch(error=>{console.error(error);process.exitCode=1;});
