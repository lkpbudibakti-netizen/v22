import { sanitizeMappingAnalysisResult } from '../server/mappingAnalysis';
import { checkMappingSemanticEvidence } from '../server/mappingSemanticEvidence';
import type { ATPData, ATPUnitMappingData, TPData } from '../src/types';

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

const tpData: TPData = {
  id: 'tp-pjok',
  academicSettingId: 'acad-pjok',
  items: [
    {
      id: 'tp-loko',
      code: 'E1-GER-01',
      statement: 'Peserta didik mempraktikkan variasi gerak lokomotor seperti berjalan dan berlari.',
      competence: 'Mempraktikkan',
      contentScope: 'Gerak lokomotor',
      order: 1,
    },
    {
      id: 'tp-non',
      code: 'E1-GER-02',
      statement: 'Peserta didik mempraktikkan variasi gerak non-lokomotor seperti menekuk dan memutar.',
      competence: 'Mempraktikkan',
      contentScope: 'Gerak non-lokomotor',
      order: 2,
    },
    {
      id: 'tp-manip',
      code: 'E1-GER-03',
      statement: 'Peserta didik mempraktikkan variasi gerak manipulatif menggunakan bola.',
      competence: 'Mempraktikkan',
      contentScope: 'Variasi gerak manipulatif',
      order: 3,
    },
    {
      id: 'tp-safe',
      code: 'E2-KES-01',
      statement: 'Peserta didik menerapkan keselamatan aktivitas fisik agar terhindar dari cedera.',
      competence: 'Menerapkan',
      contentScope: 'Keselamatan aktivitas fisik',
      order: 4,
    },
  ],
  workflowStatus: 'SIAP',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

// Keep this semantic fixture pedagogically valid: the combined TP stage precedes its revisits.
// Strictly inverted spans are covered independently by testStep7BabFirstRegression.ts.
const atpData: ATPData = {
  id: 'atp-pjok',
  academicSettingId: 'acad-pjok',
  tpDataId: tpData.id,
  items: [
    { id: 'atp-loko', stepNumber: 2, linkedTpIds: ['tp-loko'], focus: 'Variasi gerak lokomotor' },
    { id: 'atp-non', stepNumber: 3, linkedTpIds: ['tp-non'], focus: 'Variasi gerak non-lokomotor' },
    { id: 'atp-manip', stepNumber: 4, linkedTpIds: ['tp-manip'], focus: 'Variasi gerak manipulatif menggunakan bola' },
    { id: 'atp-safe', stepNumber: 5, linkedTpIds: ['tp-safe'], focus: 'Keselamatan aktivitas fisik' },
    { id: 'atp-combo', stepNumber: 1, linkedTpIds: ['tp-loko', 'tp-non'], focus: 'Kombinasi gerak lokomotor dan non-lokomotor' },
  ],
  workflowStatus: 'SIAP',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const mapping: ATPUnitMappingData = {
  id: 'mapping-pjok',
  academicSettingId: 'acad-pjok',
  atpId: atpData.id,
  tpDataId: tpData.id,
  units: [
    {
      id: 'unit-loko',
      title: 'Gerak Lokomotor',
      order: 1,
      linkedAtpItemIds: ['atp-loko', 'atp-combo'],
      linkedTpIds: ['tp-loko'],
      materials: [
        { id: 'mat-loko', title: 'Gerak Lokomotor', order: 1, linkedAtpItemIds: ['atp-loko', 'atp-combo'], linkedTpIds: ['tp-loko'] },
        { id: 'mat-wrong', title: 'Gerak non-lokomotor', order: 2, linkedAtpItemIds: ['atp-loko'], linkedTpIds: ['tp-loko'] },
        { id: 'mat-generic', title: 'Kegiatan gerak', order: 3, linkedAtpItemIds: ['atp-loko'], linkedTpIds: ['tp-loko'] },
      ],
    },
    {
      id: 'unit-non',
      title: 'Gerak Non-Lokomotor',
      order: 2,
      linkedAtpItemIds: ['atp-non', 'atp-combo'],
      linkedTpIds: ['tp-non'],
      materials: [
        { id: 'mat-non', title: 'Gerak Non-Lokomotor', order: 1, linkedAtpItemIds: ['atp-non'], linkedTpIds: ['tp-non'] },
      ],
    },
    {
      id: 'unit-manip',
      title: 'Variasi Gerak Manipulatif',
      order: 3,
      linkedAtpItemIds: ['atp-manip'],
      linkedTpIds: ['tp-manip'],
      materials: [
        { id: 'mat-manip', title: 'Manipulasi bola', order: 1, linkedAtpItemIds: ['atp-manip'], linkedTpIds: ['tp-manip'] },
      ],
    },
    {
      id: 'unit-safe',
      title: 'Keselamatan Aktivitas Fisik',
      order: 4,
      linkedAtpItemIds: ['atp-safe'],
      linkedTpIds: ['tp-safe'],
      materials: [
        { id: 'mat-safe', title: 'Mencegah cedera saat bergerak', order: 1, linkedAtpItemIds: ['atp-safe'], linkedTpIds: ['tp-safe'] },
      ],
    },
    {
      id: 'unit-wrong',
      title: 'Permainan Strategi Catur',
      order: 5,
      linkedAtpItemIds: [],
      linkedTpIds: [],
      materials: [],
    },
    {
      id: 'unit-broad',
      title: 'Pendidikan Jasmani dan Olahraga Umum',
      order: 6,
      linkedAtpItemIds: ['atp-loko'],
      linkedTpIds: ['tp-loko'],
      materials: [
        { id: 'mat-broad', title: 'Aktivitas jasmani dan kesehatan', order: 1, linkedAtpItemIds: ['atp-loko'], linkedTpIds: ['tp-loko'] },
      ],
    },
  ],
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function sanitize(rawResult: any) {
  return sanitizeMappingAnalysisResult(rawResult, { tpData, atpData, currentMapping: mapping });
}

// 1. Negative & Positive Semantic Evidence Regression Tests
const lokoToNon = checkMappingSemanticEvidence({
  label: 'Gerak non-lokomotor',
  atpItems: [atpData.items[0]],
  tpItems: [tpData.items[0]],
});
assertCase(!lokoToNon.supported, 'Lokomotor ↔ non-lokomotor -> REJECT', lokoToNon);

const nonToLoko = checkMappingSemanticEvidence({
  label: 'Gerak lokomotor',
  atpItems: [atpData.items[1]],
  tpItems: [tpData.items[1]],
});
assertCase(!nonToLoko.supported, 'Non-lokomotor ↔ lokomotor -> REJECT', nonToLoko);

const lokoToManip = checkMappingSemanticEvidence({
  label: 'Variasi gerak manipulatif',
  atpItems: [atpData.items[0]],
  tpItems: [tpData.items[0]],
});
assertCase(!lokoToManip.supported, 'Lokomotor ↔ manipulatif -> REJECT', lokoToManip);

const lokoPass = checkMappingSemanticEvidence({
  label: 'Gerak lokomotor',
  atpItems: [atpData.items[0]],
  tpItems: [tpData.items[0]],
});
assertCase(lokoPass.supported, 'Gerak lokomotor ↔ variasi gerak lokomotor -> PASS', lokoPass);

const manipPass = checkMappingSemanticEvidence({
  label: 'Manipulasi bola',
  atpItems: [atpData.items[2]],
  tpItems: [tpData.items[2]],
});
assertCase(manipPass.supported, 'Manipulasi bola ↔ gerak manipulatif menggunakan bola -> PASS', manipPass);

const weakEvidence = checkMappingSemanticEvidence({
  label: 'Kegiatan gerak',
  atpItems: [atpData.items[0]],
  tpItems: [tpData.items[0]],
});
assertCase(!weakEvidence.supported, 'Kegiatan gerak ↔ gerak lokomotor -> REVIEW', weakEvidence);

// Additional assertions for compound domains and broad titles
const compoundPartial = checkMappingSemanticEvidence({
  label: 'Gerak Lokomotor dan Manipulatif',
  atpItems: [atpData.items[0]],
  tpItems: [tpData.items[0]],
});
assertCase(!compoundPartial.supported, 'Domain majemuk dengan satu domain didukung -> REJECT', compoundPartial);

const compoundFull = checkMappingSemanticEvidence({
  label: 'Gerak Lokomotor dan Manipulatif',
  atpItems: [atpData.items[0], atpData.items[2]],
  tpItems: [tpData.items[0], tpData.items[2]],
});
assertCase(compoundFull.supported, 'Domain majemuk dengan seluruh domain didukung -> PASS', compoundFull);

const broadReview = checkMappingSemanticEvidence({
  label: 'Pendidikan Jasmani Umum',
  atpItems: [atpData.items[0]],
  tpItems: [tpData.items[0]],
});
assertCase(!broadReview.supported, 'Kasus judul luas tanpa bukti cukup tetap REVIEW, bukan otomatis PASS', broadReview);

const raw = {
  summary: {},
  atpFindings: [
    { id: 'wrong-theme', atpItemId: 'atp-loko', status: 'ALIGNED', currentUnitId: 'unit-wrong', supportingTpIds: ['tp-loko'], reason: 'AI klaim selaras.' },
    { id: 'no-evidence', atpItemId: 'atp-safe', status: 'ALIGNED', currentUnitId: 'unit-loko', supportingTpIds: ['tp-safe'], reason: 'AI klaim selaras tanpa bukti.' },
    { id: 'strong', atpItemId: 'atp-manip', status: 'ALIGNED', currentUnitId: 'unit-manip', supportingTpIds: ['tp-manip'], reason: 'Selaras.' },
    { id: 'multi-ok', atpItemId: 'atp-combo', status: 'ALIGNED', supportingTpIds: ['tp-loko', 'tp-non'], reason: 'Lintas Bab lengkap.' },
  ],
  materialFindings: [
    { id: 'mat-wrong-supported', status: 'SUPPORTED', unitId: 'unit-loko', materialId: 'mat-wrong', supportingTpIds: ['tp-loko'], supportingAtpItemIds: ['atp-loko'], reason: 'AI klaim supported.' },
    { id: 'mat-supported', status: 'SUPPORTED', unitId: 'unit-loko', materialId: 'mat-loko', supportingTpIds: ['tp-loko'], supportingAtpItemIds: ['atp-loko'], reason: 'Didukung.' },
    { id: 'ambiguous-action', status: 'ALIGNABLE', unitId: 'unit-loko', materialId: 'mat-generic', supportingTpIds: ['tp-loko'], supportingAtpItemIds: ['atp-loko'], reason: 'Ambigu.', action: { type: 'ALIGN_EXISTING_MATERIAL', targetUnitId: 'unit-loko', targetMaterialId: 'mat-generic', linkedAtpItemIds: ['atp-loko'], linkedTpIds: ['tp-loko'] } },
  ],
};

const result = sanitize(raw);
const byId = new Map(result.atpFindings.map((f) => [f.id, f]));
const matById = new Map(result.materialFindings.map((f) => [f.id, f]));

assertCase(byId.get('wrong-theme')?.status === 'REVIEW', 'ID benar + tema Bab bertentangan / tidak dipetakan -> REVIEW', byId.get('wrong-theme'));
assertCase(byId.get('no-evidence')?.status === 'REVIEW', 'AI mengklaim ALIGNED tanpa evidence / salah unit -> REVIEW', byId.get('no-evidence'));
assertCase(byId.get('strong')?.status === 'ALIGNED', 'Bab/TP semantik kuat -> ALIGNED', byId.get('strong'));
assertCase(byId.get('multi-ok')?.status === 'ALIGNED', 'Multi-Bab: semua subset TP selaras -> ALIGNED', byId.get('multi-ok'));
assertCase(matById.get('mat-wrong-supported')?.status === 'MANUAL_REVIEW', 'Material ID benar tetapi domain gerak eksplisit bertentangan -> MANUAL_REVIEW', matById.get('mat-wrong-supported'));
assertCase(matById.get('mat-supported')?.status === 'SUPPORTED', 'Material valid dan substansi sesuai -> SUPPORTED', matById.get('mat-supported'));
assertCase(matById.get('ambiguous-action')?.status === 'ALIGNABLE' && !!matById.get('ambiguous-action')?.action, 'Usulan Gemini dengan overlap lexical rendah tetap actionable tanpa konflik eksplisit', matById.get('ambiguous-action'));
assertCase(result.summary.alignedAtp === result.atpFindings.filter((f) => f.status === 'ALIGNED').length, 'Summary alignedAtp konsisten dengan findings final', result.summary);

// Additional regression tests for unmapped ATP claiming aligned, actual placement vs currentUnitId mismatch, and REVIEW from AI + strong evidence
const unmappedAtpMapping: ATPUnitMappingData = {
  ...mapping,
  units: mapping.units.map(u => ({ ...u, linkedAtpItemIds: [] })),
};
const unmappedResult = sanitizeMappingAnalysisResult({
  summary: {},
  atpFindings: [{ id: 'unmapped-claim', atpItemId: 'atp-loko', status: 'ALIGNED', supportingTpIds: ['tp-loko'], reason: 'Klaim AI.' }],
  materialFindings: [],
}, { tpData, atpData, currentMapping: unmappedAtpMapping });
assertCase(unmappedResult.atpFindings[0]?.status === 'UNMAPPED', 'ATP tidak dipetakan, AI klaim ALIGNED -> UNMAPPED', unmappedResult.atpFindings[0]);

const wrongMappingMismatch: ATPUnitMappingData = {
  ...mapping,
  units: mapping.units.map(u => u.id === 'unit-loko' ? { ...u, linkedAtpItemIds: ['atp-loko'] } : u),
};
const mismatchResult = sanitizeMappingAnalysisResult({
  summary: {},
  atpFindings: [{ id: 'mismatch-claim', atpItemId: 'atp-loko', status: 'ALIGNED', currentUnitId: 'unit-non', supportingTpIds: ['tp-loko'], reason: 'AI klaim unit lain.' }],
  materialFindings: [],
}, { tpData, atpData, currentMapping: wrongMappingMismatch });
assertCase(mismatchResult.atpFindings[0]?.status === 'REVIEW', 'ALIGNED dari AI + Bab salah -> REVIEW', mismatchResult.atpFindings[0]);

const reviewAiStrongResult = sanitizeMappingAnalysisResult({
  summary: {},
  atpFindings: [{ id: 'rev-strong', atpItemId: 'atp-manip', status: 'REVIEW', currentUnitId: 'unit-manip', supportingTpIds: ['tp-manip'], reason: 'AI ragu.' }],
  materialFindings: [],
}, { tpData, atpData, currentMapping: mapping });
assertCase(reviewAiStrongResult.atpFindings[0]?.status === 'REVIEW', 'REVIEW dari AI + evidence kuat -> tetap REVIEW', reviewAiStrongResult.atpFindings[0]);

const wrongMultiMapping: ATPUnitMappingData = {
  ...mapping,
  units: mapping.units.map((u) => u.id === 'unit-non'
    ? { ...u, title: 'Permainan Strategi Catur', materials: [] }
    : u),
};
const wrongMulti = sanitizeMappingAnalysisResult({
  summary: {},
  atpFindings: [{ id: 'multi-wrong', atpItemId: 'atp-combo', status: 'ALIGNED', supportingTpIds: ['tp-loko', 'tp-non'], reason: 'Union lengkap.' }],
  materialFindings: [],
}, { tpData, atpData, currentMapping: wrongMultiMapping });
assertCase(wrongMulti.atpFindings[0]?.status === 'REVIEW', 'Multi-Bab: satu Bab tidak sesuai -> REVIEW', wrongMulti.atpFindings[0]);

if (failed > 0) {
  console.error(`P1-D3 mapping semantic evidence regression failed: ${failed} scenario(s).`);
  process.exit(1);
}

console.log('P1-D3 mapping semantic evidence regression scenarios passed.');
