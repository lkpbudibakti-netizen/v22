import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { CPData, CPAnalysisData } from '../src/types';
import {
  validateCPDataWorkflow,
  validateCPAnalysisDataWorkflow,
} from '../src/services/cpWorkflowService';
import { fallbackAnalyzeCP } from '../server/curriculumFallback';
import {
  getInitialCPAnalysisItems,
  deriveAnalysisItemsFromCP,
} from '../src/components/CPAnalysisManager';
import { checkSemanticCoverage } from '../server/cpAnalysisSemanticCoverage';

console.log('=== RUNNING AUDIT: MERDEKA CP ANALYSIS INTEGRITY (NO DATA > FAKE DATA) ===\n');

let totalTests = 0;
let passedTests = 0;

function runTest(name: string, fn: () => void) {
  totalTests++;
  try {
    fn();
    console.log(`[PASS] ${totalTests}. ${name}`);
    passedTests++;
  } catch (err: any) {
    console.error(`[FAIL] ${totalTests}. ${name}:`, err.message);
    throw err;
  }
}

const sampleCP: CPData = {
  id: 'cp-yp-test-01',
  academicSettingId: 'yp-test-01',
  generalDescription: 'Peserta didik menguasai keterampilan gerak dasar dan pola hidup sehat.',
  elements: [
    {
      id: 'elem-1',
      name: 'Terampil Bergerak',
      content: 'Peserta didik mempraktikkan keterampilan gerak fundamental secara efektif.',
    },
    {
      id: 'elem-2',
      name: 'Belajar Melalui Gerak',
      content: 'Peserta didik menerapkan perilaku hidup sehat dalam aktivitas jasmani.',
    },
  ],
  updatedAt: '2026-07-20T10:30:00.000Z',
};

runTest('1. No saved analysis -> initial analysis items are not fabricated', () => {
  // When cpAnalysis is undefined, null, or has empty items
  const itemsUndefined = getInitialCPAnalysisItems(undefined);
  assert.strictEqual(itemsUndefined.length, 0, 'Items must be empty when cpAnalysis is undefined');

  const itemsNull = getInitialCPAnalysisItems(null);
  assert.strictEqual(itemsNull.length, 0, 'Items must be empty when cpAnalysis is null');

  const emptyAnalysis: CPAnalysisData = {
    id: 'cpa-1',
    academicSettingId: 'as-1',
    generalSummary: '',
    items: [],
    updatedAt: '2026-07-20T10:00:00.000Z',
  };
  const itemsEmpty = getInitialCPAnalysisItems(emptyAnalysis);
  assert.strictEqual(itemsEmpty.length, 0, 'Items must be empty when cpAnalysis.items is empty');

  // When real saved analysis items exist, they are preserved
  const realAnalysis: CPAnalysisData = {
    ...emptyAnalysis,
    items: [
      {
        id: 'real-item-1',
        elementName: 'Terampil Bergerak',
        cpText: 'Konten asli',
        cpCompetence: 'Mempraktikkan',
        materialScope: 'Gerak dasar',
        order: 1,
      },
    ],
  };
  const itemsReal = getInitialCPAnalysisItems(realAnalysis);
  assert.strictEqual(itemsReal.length, 1);
  assert.strictEqual(itemsReal[0].id, 'real-item-1');
  assert.strictEqual(itemsReal[0].cpCompetence, 'Mempraktikkan');
});

runTest('2. No automatic "Elemen Utama" synthetic analysis', () => {
  const compPath = path.resolve(process.cwd(), 'src/components/CPAnalysisManager.tsx');
  const compSource = fs.readFileSync(compPath, 'utf-8').replace(/\r\n/g, '\n');

  // Ensure "Elemen Utama" is never synthetically created
  assert.strictEqual(
    compSource.includes('Elemen Utama'),
    false,
    'CPAnalysisManager must not include synthetic "Elemen Utama" default item'
  );

  // Ensure fake pedagogical filler phrases are removed
  assert.strictEqual(
    compSource.includes('Mempraktikkan, memahami, menerapkan, mengevaluasi'),
    false,
    'CPAnalysisManager must not have hardcoded synthetic competence values'
  );
  assert.strictEqual(
    compSource.includes('Peserta didik mampu menerapkan esensi'),
    false,
    'CPAnalysisManager must not have hardcoded synthetic meaningful understanding'
  );
  assert.strictEqual(
    compSource.includes('Peserta didik dapat menguasai keterampilan dasar pada elemen'),
    false,
    'CPAnalysisManager must not have hardcoded synthetic suggested TP'
  );
});

runTest('3. Explicit local derive from CP copies: element identity/name, CP text, order', () => {
  const derived = deriveAnalysisItemsFromCP(sampleCP);
  assert.strictEqual(derived.length, 2, 'Must produce 2 items corresponding to 2 CP elements');

  // Element 1 checks
  assert.strictEqual(derived[0].elementId, 'elem-1');
  assert.strictEqual(derived[0].elementName, 'Terampil Bergerak');
  assert.strictEqual(
    derived[0].cpText,
    'Peserta didik mempraktikkan keterampilan gerak fundamental secara efektif.'
  );
  assert.strictEqual(derived[0].order, 1);

  // Element 2 checks
  assert.strictEqual(derived[1].elementId, 'elem-2');
  assert.strictEqual(derived[1].elementName, 'Belajar Melalui Gerak');
  assert.strictEqual(
    derived[1].cpText,
    'Peserta didik menerapkan perilaku hidup sehat dalam aktivitas jasmani.'
  );
  assert.strictEqual(derived[1].order, 2);
});

runTest('4. Local derive leaves empty: cpCompetence, materialScope (unless direct element name copy), meaningfulUnderstanding, suggestedTp', () => {
  const derived = deriveAnalysisItemsFromCP(sampleCP);

  for (let i = 0; i < derived.length; i++) {
    const item = derived[i];
    assert.strictEqual(
      item.cpCompetence,
      '',
      `Item ${i + 1} cpCompetence must be empty for teacher completion`
    );
    assert.ok(
      item.materialScope === '' || item.materialScope === item.elementName,
      `Item ${i + 1} materialScope must be empty or direct factual copy of elementName`
    );
    assert.strictEqual(
      item.meaningfulUnderstanding || '',
      '',
      `Item ${i + 1} meaningfulUnderstanding must be empty`
    );
    assert.strictEqual(
      item.suggestedTp || '',
      '',
      `Item ${i + 1} suggestedTp must be empty`
    );
  }
});

runTest('5. Local derive does not use: generatedBy: "AI"', () => {
  const compPath = path.resolve(process.cwd(), 'src/components/CPAnalysisManager.tsx');
  const compSource = fs.readFileSync(compPath, 'utf-8').replace(/\r\n/g, '\n');

  // Find handleGenerateFromCP function body
  const match = compSource.match(/const handleGenerateFromCP = \([^)]*\) => \{([\s\S]*?)\n  \};/);
  assert.ok(match, 'handleGenerateFromCP must be present in CPAnalysisManager');
  const body = match[1];

  assert.strictEqual(
    body.includes("generatedBy: 'AI'"),
    false,
    'handleGenerateFromCP must NOT set generatedBy: "AI"'
  );
  assert.ok(
    !body.includes("onSaveCPAnalysis("),
    'Structure action must not auto-save or rewrite provenance'
  );
});

runTest('6. Local/manual save uses generatedBy: "TEACHER" or preserves valid previous non-false provenance', () => {
  const compPath = path.resolve(process.cwd(), 'src/components/CPAnalysisManager.tsx');
  const compSource = fs.readFileSync(compPath, 'utf-8').replace(/\r\n/g, '\n');

  // Verify handleSave provenance handling
  const match = compSource.match(/const handleSave = (?:\(\): boolean =>|\(\) =>) \{([\s\S]*?)\n  \};/);
  assert.ok(match, 'handleSave must be present in CPAnalysisManager');
  const body = match[1];

  assert.ok(
    body.includes("nextGeneratedBy") || body.includes("generatedBy"),
    'handleSave must compute generatedBy'
  );
  assert.ok(
    body.includes("'TEACHER'"),
    'handleSave must fallback to TEACHER provenance'
  );
});

runTest('7. basedOnCpUpdatedAt remains tied to current CP timestamp', () => {
  const compPath = path.resolve(process.cwd(), 'src/components/CPAnalysisManager.tsx');
  const compSource = fs.readFileSync(compPath, 'utf-8').replace(/\r\n/g, '\n');

  // Explicit save preserves stored lineage; pulling structure never rebases or saves.
  const matches = compSource.match(/basedOnCpUpdatedAt:\s*cp\.updatedAt/g);
  assert.ok(
    compSource.includes('cpAnalysis?.basedOnCpUpdatedAt ||') && compSource.includes('cp.updatedAt ||'),
    'Explicit save must preserve existing basedOnCpUpdatedAt; local derive references current CP'
  );
});

runTest('8. CP Analysis component integrity: CPAnalysisManager does not perform direct storage writes', () => {
  const compPath = path.resolve(process.cwd(), 'src/components/CPAnalysisManager.tsx');
  const compSource = fs.readFileSync(compPath, 'utf-8').replace(/\r\n/g, '\n');

  assert.strictEqual(
    compSource.includes('saveStorageV5'),
    false,
    'CPAnalysisManager must not call saveStorageV5 directly'
  );
  assert.strictEqual(
    compSource.includes('saveCPAnalysisV5'),
    false,
    'CPAnalysisManager must delegate to onSaveCPAnalysis instead of saving directly'
  );
});

runTest('9. CP element tanpa ID -> CP tidak SIAP (PERLU_DILENGKAPI)', () => {
  const invalidCP: CPData = {
    ...sampleCP,
    elements: [
      { id: '', name: 'Elemen 1', content: 'Uraian elemen 1' },
      { id: 'elem-2', name: 'Elemen 2', content: 'Uraian elemen 2' },
    ],
    source: {retrievedAt: '2026-01-01T00:00:00Z', title: 'Kep BSKAP', institution: 'BSKAP', documentYear: '2025', verificationStatus: 'verified' },
  };
  const val = validateCPDataWorkflow(invalidCP);
  assert.strictEqual(val.isSiap, false, 'CP dengan element tanpa ID tidak boleh SIAP');
  assert.strictEqual(val.status, 'PERLU_DILENGKAPI');
  assert.ok(val.issues.some((iss) => iss.includes('tidak memiliki ID elemen yang valid')));
});

runTest('10. duplicate CP element ID -> CP tidak SIAP (PERLU_DILENGKAPI)', () => {
  const dupCP: CPData = {
    ...sampleCP,
    elements: [
      { id: 'dup-id', name: 'Elemen 1', content: 'Uraian elemen 1' },
      { id: 'dup-id', name: 'Elemen 2', content: 'Uraian elemen 2' },
    ],
    source: {retrievedAt: '2026-01-01T00:00:00Z', title: 'Kep BSKAP', institution: 'BSKAP', documentYear: '2025', verificationStatus: 'verified' },
  };
  const val = validateCPDataWorkflow(dupCP);
  assert.strictEqual(val.isSiap, false, 'CP dengan duplicate element ID tidak boleh SIAP');
  assert.strictEqual(val.status, 'PERLU_DILENGKAPI');
  assert.ok(val.issues.some((iss) => iss.includes('ID duplikat')));
});

runTest('11. AnalysisItem tanpa elementId -> tidak SIAP', () => {
  const validCP: CPData = {
    ...sampleCP,
    source: {retrievedAt: '2026-01-01T00:00:00Z', title: 'Kep BSKAP', institution: 'BSKAP', documentYear: '2025', verificationStatus: 'verified' },
  };
  const cpa: CPAnalysisData = {
    id: 'cpa-test',
    academicSettingId: validCP.academicSettingId,
    cpId: validCP.id,
    basedOnCpUpdatedAt: validCP.updatedAt,
    updatedAt: new Date().toISOString(),
    items: [
      {
        id: 'item-1',
        elementId: '',
        elementName: 'Terampil Bergerak',
        cpCompetence: 'Mempraktikkan',
        materialScope: 'Gerak dasar',
        order: 1,
      },
      {
        id: 'item-2',
        elementId: 'elem-2',
        elementName: 'Belajar Melalui Gerak',
        cpCompetence: 'Menerapkan',
        materialScope: 'Pola hidup sehat',
        order: 2,
      },
    ],
  };
  const val = validateCPAnalysisDataWorkflow(cpa, validCP);
  assert.strictEqual(val.isSiap, false, 'AnalysisItem tanpa elementId tidak boleh SIAP');
  assert.ok(val.issues.some((iss) => iss.includes('elementId kosong')));
});

runTest('12. AnalysisItem memakai unknown elementId -> tidak SIAP', () => {
  const validCP: CPData = {
    ...sampleCP,
    source: {retrievedAt: '2026-01-01T00:00:00Z', title: 'Kep BSKAP', institution: 'BSKAP', documentYear: '2025', verificationStatus: 'verified' },
  };
  const cpa: CPAnalysisData = {
    id: 'cpa-test',
    academicSettingId: validCP.academicSettingId,
    cpId: validCP.id,
    basedOnCpUpdatedAt: validCP.updatedAt,
    updatedAt: new Date().toISOString(),
    items: [
      {
        id: 'item-1',
        elementId: 'elem-ghost-99',
        elementName: 'Terampil Bergerak',
        cpCompetence: 'Mempraktikkan',
        materialScope: 'Gerak dasar',
        order: 1,
      },
      {
        id: 'item-2',
        elementId: 'elem-2',
        elementName: 'Belajar Melalui Gerak',
        cpCompetence: 'Menerapkan',
        materialScope: 'Pola hidup sehat',
        order: 2,
      },
    ],
  };
  const val = validateCPAnalysisDataWorkflow(cpa, validCP);
  assert.strictEqual(val.isSiap, false, 'AnalysisItem dengan unknown elementId tidak boleh SIAP');
  assert.ok(val.issues.some((iss) => iss.includes('tidak ada pada CP rujukan')));
});

runTest('13. CP punya E1 + E2 tetapi Analysis hanya mencakup E1 -> tidak SIAP', () => {
  const validCP: CPData = {
    ...sampleCP,
    source: {retrievedAt: '2026-01-01T00:00:00Z', title: 'Kep BSKAP', institution: 'BSKAP', documentYear: '2025', verificationStatus: 'verified' },
  };
  const cpa: CPAnalysisData = {
    id: 'cpa-test',
    academicSettingId: validCP.academicSettingId,
    cpId: validCP.id,
    basedOnCpUpdatedAt: validCP.updatedAt,
    updatedAt: new Date().toISOString(),
    items: [
      {
        id: 'item-1',
        elementId: 'elem-1',
        elementName: 'Terampil Bergerak',
        cpCompetence: 'Mempraktikkan',
        materialScope: 'Gerak dasar',
        order: 1,
      },
    ],
  };
  const val = validateCPAnalysisDataWorkflow(cpa, validCP);
  assert.strictEqual(val.isSiap, false, 'Jika elemen CP belum tercakup lengkap, tidak boleh SIAP');
  assert.ok(val.issues.some((iss) => iss.includes('belum dianalisis oleh butir Analisis CP mana pun')));
});

runTest('14. E1 mempunyai 2 AnalysisItem dan E2 mempunyai 1 -> valid/SIAP jika field lain lengkap', () => {
  const validCP: CPData = {
    ...sampleCP,
    source: {retrievedAt: '2026-01-01T00:00:00Z', title: 'Kep BSKAP', institution: 'BSKAP', documentYear: '2025', verificationStatus: 'verified' },
  };
  const cpa: CPAnalysisData = {
    id: 'cpa-test',
    academicSettingId: validCP.academicSettingId,
    cpId: validCP.id,
    basedOnCpUpdatedAt: validCP.updatedAt,
    updatedAt: new Date().toISOString(),
    items: [
      {
        id: 'item-1a',
        elementId: 'elem-1',
        elementName: 'Terampil Bergerak',
        cpText: 'Peserta didik mempraktikkan keterampilan gerak fundamental secara efektif.',
        cpCompetence: 'Mempraktikkan',
        materialScope: 'Gerak lokomotor',
        order: 1,
      },
      {
        id: 'item-1b',
        elementId: 'elem-1',
        elementName: 'Terampil Bergerak',
        cpText: 'Peserta didik mempraktikkan keterampilan gerak fundamental secara efektif.',
        cpCompetence: 'Mengeksplorasi',
        materialScope: 'Gerak manipulatif',
        order: 2,
      },
      {
        id: 'item-2',
        elementId: 'elem-2',
        elementName: 'Belajar Melalui Gerak',
        cpText: 'Peserta didik menerapkan perilaku hidup sehat dalam aktivitas jasmani.',
        cpCompetence: 'Menerapkan',
        materialScope: 'Pola hidup sehat',
        order: 3,
      },
    ],
  };
  const val = validateCPAnalysisDataWorkflow(cpa, validCP);
  assert.strictEqual(val.isSiap, true, 'Multi-item per elemen harus valid dan SIAP');
  assert.strictEqual(val.issues.length, 0);
});

runTest('15. cpAnalysis.cpId !== cp.id -> tidak SIAP', () => {
  const validCP: CPData = {
    ...sampleCP,
    source: {retrievedAt: '2026-01-01T00:00:00Z', title: 'Kep BSKAP', institution: 'BSKAP', documentYear: '2025', verificationStatus: 'verified' },
  };
  const cpa: CPAnalysisData = {
    id: 'cpa-test',
    academicSettingId: validCP.academicSettingId,
    cpId: 'wrong-cp-id-999',
    basedOnCpUpdatedAt: validCP.updatedAt,
    updatedAt: new Date().toISOString(),
    items: [
      {
        id: 'item-1',
        elementId: 'elem-1',
        elementName: 'Terampil Bergerak',
        cpCompetence: 'Mempraktikkan',
        materialScope: 'Gerak dasar',
        order: 1,
      },
      {
        id: 'item-2',
        elementId: 'elem-2',
        elementName: 'Belajar Melalui Gerak',
        cpCompetence: 'Menerapkan',
        materialScope: 'Pola hidup sehat',
        order: 2,
      },
    ],
  };
  const val = validateCPAnalysisDataWorkflow(cpa, validCP);
  assert.strictEqual(val.isSiap, false, 'cpAnalysis.cpId beda dengan cp.id tidak boleh SIAP');
  assert.ok(val.issues.some((iss) => iss.includes('tidak sesuai dengan ID CP')));
});

runTest('16. basedOnCpUpdatedAt hilang ketika CP mempunyai updatedAt -> tidak SIAP', () => {
  const validCP: CPData = {
    ...sampleCP,
    source: {retrievedAt: '2026-01-01T00:00:00Z', title: 'Kep BSKAP', institution: 'BSKAP', documentYear: '2025', verificationStatus: 'verified' },
  };
  const cpa: CPAnalysisData = {
    id: 'cpa-test',
    academicSettingId: validCP.academicSettingId,
    cpId: validCP.id,
    basedOnCpUpdatedAt: undefined,
    updatedAt: new Date().toISOString(),
    items: [
      {
        id: 'item-1',
        elementId: 'elem-1',
        elementName: 'Terampil Bergerak',
        cpCompetence: 'Mempraktikkan',
        materialScope: 'Gerak dasar',
        order: 1,
      },
      {
        id: 'item-2',
        elementId: 'elem-2',
        elementName: 'Belajar Melalui Gerak',
        cpCompetence: 'Menerapkan',
        materialScope: 'Pola hidup sehat',
        order: 2,
      },
    ],
  };
  const val = validateCPAnalysisDataWorkflow(cpa, validCP);
  assert.strictEqual(val.isSiap, false, 'basedOnCpUpdatedAt wajib ada jika cp.updatedAt ada');
  assert.ok(val.issues.some((iss) => iss.includes('basedOnCpUpdatedAt')));
});

runTest('17. fallback analysis mempertahankan seluruh canonical element IDs', () => {
  const fallback = fallbackAnalyzeCP({
    cpText: sampleCP.generalDescription,
    elements: sampleCP.elements,
    subject: 'PJOK',
    grade: 'Kelas 1',
    phase: 'Fase A',
  });

  const ids = fallback.items.map((it) => it.elementId);
  assert.ok(ids.includes('elem-1'), 'Fallback harus mempertahankan elem-1');
  assert.ok(ids.includes('elem-2'), 'Fallback harus mempertahankan elem-2');
  assert.strictEqual(ids.length >= 2, true);
});

runTest('18. fallback tidak memotong bagian akhir CP panjang (tidak ada 120 char truncation)', () => {
  const longText = 'Mempraktikkan keterampilan gerak fundamental dalam situasi permainan sederhana dan tradisional yang sangat panjang dan kaya akan variasi gerak berirama serta aktivitas air di lingkungan sekitar sekolah secara komprehensif dan berkelanjutan tanpa dipotong sama sekali.';
  const fallback = fallbackAnalyzeCP({
    elements: [
      {
        id: 'long-elem-1',
        name: 'Elemen Panjang',
        content: longText,
      },
    ],
    subject: 'PJOK',
  });

  assert.strictEqual(fallback.items.length >= 1, true);
  const scope = fallback.items[0].materialScope;
  assert.strictEqual(scope.includes('...'), false, 'Fallback tidak boleh memotong teks dengan elipsis');
  assert.ok(scope.includes('tanpa dipotong sama sekali'), 'Teks akhir harus utuh');
});

runTest('19. source CPAnalysisManager tidak lagi mengandung it.elementId || (cp.elements && cp.elements[idx]?.id)', () => {
  const compPath = path.resolve(process.cwd(), 'src/components/CPAnalysisManager.tsx');
  const compSource = fs.readFileSync(compPath, 'utf-8').replace(/\r\n/g, '\n');

  assert.strictEqual(
    compSource.includes('it.elementId || (cp.elements && cp.elements[idx]?.id)'),
    false,
    'CPAnalysisManager must not use positional fallback for elementId'
  );
  assert.strictEqual(
    compSource.includes('cp.elements[idx]?.id'),
    false,
    'CPAnalysisManager must not use cp.elements[idx]?.id'
  );
});

runTest('20. /api/ai/analyze-cp tidak menggunakan positional validElements[idx] untuk memperbaiki elementId AI', () => {
  const serverPath = path.resolve(process.cwd(), 'server.ts');
  const serverSource = fs.readFileSync(serverPath, 'utf-8');

  // Verify within /api/ai/analyze-cp endpoint that validElements[idx] is not used
  const endpointMatch = serverSource.match(/app\.post\('\/api\/ai\/analyze-cp'[\s\S]*?app\.post/);
  assert.ok(endpointMatch, 'Endpoint /api/ai/analyze-cp must exist in server.ts');
  const endpointBody = endpointMatch[0];

  assert.strictEqual(
    endpointBody.includes('validElements[idx]'),
    false,
    'server.ts /api/ai/analyze-cp must not use validElements[idx] positional fallback'
  );
});

runTest('21. Mismatch elementName terhadap elemen CP canonical -> ditolak validator (PERLU_DILENGKAPI)', () => {
  const validCP: CPData = {
    ...sampleCP,
    source: {retrievedAt: '2026-01-01T00:00:00Z', title: 'Kep BSKAP', institution: 'BSKAP', documentYear: '2025', verificationStatus: 'verified' },
  };
  const cpa: CPAnalysisData = {
    id: 'cpa-test',
    academicSettingId: validCP.academicSettingId,
    cpId: validCP.id,
    basedOnCpUpdatedAt: validCP.updatedAt,
    updatedAt: new Date().toISOString(),
    items: [
      {
        id: 'item-1',
        elementId: 'elem-1',
        elementName: 'Elemen Palsu / Modifikasi',
        cpText: 'Peserta didik mempraktikkan keterampilan gerak fundamental secara efektif.',
        cpCompetence: 'Mempraktikkan',
        materialScope: 'Gerak dasar',
        order: 1,
      },
      {
        id: 'item-2',
        elementId: 'elem-2',
        elementName: 'Belajar Melalui Gerak',
        cpText: 'Peserta didik menerapkan perilaku hidup sehat dalam aktivitas jasmani.',
        cpCompetence: 'Menerapkan',
        materialScope: 'Pola hidup sehat',
        order: 2,
      },
    ],
  };
  const val = validateCPAnalysisDataWorkflow(cpa, validCP);
  assert.strictEqual(val.isSiap, false, 'Nama elemen berbeda dengan canonical harus ditolak');
  assert.ok(val.issues.some((iss) => iss.includes('tidak sesuai dengan nama elemen CP canonical')));
});

runTest('22. Mismatch cpText terhadap elemen CP canonical -> ditolak validator (PERLU_DILENGKAPI)', () => {
  const validCP: CPData = {
    ...sampleCP,
    source: {retrievedAt: '2026-01-01T00:00:00Z', title: 'Kep BSKAP', institution: 'BSKAP', documentYear: '2025', verificationStatus: 'verified' },
  };
  const cpa: CPAnalysisData = {
    id: 'cpa-test',
    academicSettingId: validCP.academicSettingId,
    cpId: validCP.id,
    basedOnCpUpdatedAt: validCP.updatedAt,
    updatedAt: new Date().toISOString(),
    items: [
      {
        id: 'item-1',
        elementId: 'elem-1',
        elementName: 'Terampil Bergerak',
        cpText: 'Teks yang diubah atau diparafrase sepihak tanpa izin kurikulum.',
        cpCompetence: 'Mempraktikkan',
        materialScope: 'Gerak dasar',
        order: 1,
      },
      {
        id: 'item-2',
        elementId: 'elem-2',
        elementName: 'Belajar Melalui Gerak',
        cpText: 'Peserta didik menerapkan perilaku hidup sehat dalam aktivitas jasmani.',
        cpCompetence: 'Menerapkan',
        materialScope: 'Pola hidup sehat',
        order: 2,
      },
    ],
  };
  const val = validateCPAnalysisDataWorkflow(cpa, validCP);
  assert.strictEqual(val.isSiap, false, 'Teks CP yang tidak cocok dengan canonical content harus ditolak');
  assert.ok(val.issues.some((iss) => iss.includes('tidak sesuai dengan isi elemen CP canonical')));
});

runTest('23. Ordinary save preserves previous basedOnCpUpdatedAt to prevent stale laundering', () => {
  const compPath = path.resolve(process.cwd(), 'src/components/CPAnalysisManager.tsx');
  const compSource = fs.readFileSync(compPath, 'utf-8').replace(/\r\n/g, '\n');

  // Verify handleSave implementation preserves existing basedOnCpUpdatedAt
  const match = compSource.match(/const handleSave = \(\): boolean => \{([\s\S]*?)\n  \};/);
  assert.ok(match, 'handleSave must exist');
  const body = match[1];

  assert.ok(
    body.includes('cpAnalysis?.basedOnCpUpdatedAt ||'),
    'handleSave must preserve existing basedOnCpUpdatedAt before falling back'
  );
  assert.ok(
    !body.includes('basedOnCpUpdatedAt: cp.updatedAt ||'),
    'handleSave must not unconditionally overwrite basedOnCpUpdatedAt with cp.updatedAt'
  );
});

runTest('24. Ordinary save preserves needsReview / isCPOutdated condition', () => {
  const compPath = path.resolve(process.cwd(), 'src/components/CPAnalysisManager.tsx');
  const compSource = fs.readFileSync(compPath, 'utf-8').replace(/\r\n/g, '\n');

  const match = compSource.match(/const handleSave = \(\): boolean => \{([\s\S]*?)\n  \};/);
  assert.ok(match, 'handleSave must exist');
  const body = match[1];

  assert.ok(
    body.includes('shouldKeepReview') || body.includes('cpAnalysis?.needsReview || isCPOutdated'),
    'handleSave must preserve needsReview if previously flagged or currently outdated'
  );
  assert.ok(
    !body.includes('needsReview: false,'),
    'handleSave must not hardcode needsReview: false'
  );
});

runTest('25. handleSave evaluates candidate to determine final workflowStatus', () => {
  const compPath = path.resolve(process.cwd(), 'src/components/CPAnalysisManager.tsx');
  const compSource = fs.readFileSync(compPath, 'utf-8').replace(/\r\n/g, '\n');

  const match = compSource.match(/const handleSave = \(\): boolean => \{([\s\S]*?)\n  \};/);
  assert.ok(match, 'handleSave must exist');
  const body = match[1];

  assert.ok(
    body.includes('validateCPAnalysisDataWorkflow(candidate, cp)'),
    'handleSave must validate candidate directly before deciding final workflowStatus'
  );
});

runTest('26. AI stages a proposal without saving/rebasing; explicit local structure remains draft only', () => {
  const compPath = path.resolve(process.cwd(), 'src/components/CPAnalysisManager.tsx');
  const compSource = fs.readFileSync(compPath, 'utf-8').replace(/\r\n/g, '\n');

  // AI must preserve stored review lineage; behavioral coverage lives in testStep4MeaningfulUnderstandingRegression.
  const aiMatch = compSource.match(/executeAIAnalysis = async \([^)]*\) => \{([\s\S]*?)\n  \};/);
  assert.ok(aiMatch, 'executeAIAnalysis must exist');
  assert.ok(!aiMatch[1].includes('needsReview: false'), 'AI must not clear stored review state');
  assert.ok(!aiMatch[1].includes('onSaveCPAnalysis('), 'AI must stage results without auto-saving');

  const deriveMatch = compSource.match(/handleGenerateFromCP = \([^)]*\) => \{([\s\S]*?)\n  \};/);
  assert.ok(deriveMatch, 'handleGenerateFromCP must exist');
  assert.ok(!deriveMatch[1].includes('needsReview: false'), 'Structure draft must preserve stored needsReview');
  assert.ok(!deriveMatch[1].includes('onSaveCPAnalysis('), 'Structure draft must never auto-save/rebase source metadata');
});

runTest('27. CP invalid -> CPAnalysis tidak SIAP (CP prerequisite restored)', () => {
  const invalidCP: CPData = {
    ...sampleCP,
    generalDescription: '', // empty generalDescription makes CP invalid
    source: undefined,
  };
  const cpa: CPAnalysisData = {
    id: 'cpa-test',
    academicSettingId: invalidCP.academicSettingId,
    cpId: invalidCP.id,
    basedOnCpUpdatedAt: invalidCP.updatedAt,
    updatedAt: new Date().toISOString(),
    items: [
      {
        id: 'item-1',
        elementId: 'elem-1',
        elementName: 'Terampil Bergerak',
        cpText: 'Peserta didik mempraktikkan keterampilan gerak fundamental secara efektif.',
        cpCompetence: 'Mempraktikkan',
        materialScope: 'Gerak dasar',
        order: 1,
      },
      {
        id: 'item-2',
        elementId: 'elem-2',
        elementName: 'Belajar Melalui Gerak',
        cpText: 'Peserta didik menerapkan perilaku hidup sehat dalam aktivitas jasmani.',
        cpCompetence: 'Menerapkan',
        materialScope: 'Pola hidup sehat',
        order: 2,
      },
    ],
  };

  const val = validateCPAnalysisDataWorkflow(cpa, invalidCP);
  assert.strictEqual(val.isSiap, false, 'CPAnalysis harus tidak SIAP jika CP rujukan tidak valid');
  assert.ok(
    val.issues.some((iss) => iss.includes('Capaian Pembelajaran (CP) rujukan belum memenuhi status SIAP.')),
    'Harus memuat issue CP belum memenuhi status SIAP'
  );
});

runTest('28. handleSave mempunyai return type boolean', () => {
  const compPath = path.resolve(process.cwd(), 'src/components/CPAnalysisManager.tsx');
  const compSource = fs.readFileSync(compPath, 'utf-8').replace(/\r\n/g, '\n');

  assert.ok(
    compSource.includes('const handleSave = (): boolean =>'),
    'handleSave must have explicit return type boolean'
  );
  assert.ok(
    compSource.includes('return false;'),
    'handleSave must return false when candidate is not siap'
  );
  assert.ok(
    compSource.includes('return true;'),
    'handleSave must return true when candidate is siap'
  );
});

runTest('29. Navigation memanggil onNextStep() hanya jika handleSave() mengembalikan true', () => {
  const compPath = path.resolve(process.cwd(), 'src/components/CPAnalysisManager.tsx');
  const compSource = fs.readFileSync(compPath, 'utf-8').replace(/\r\n/g, '\n');

  assert.ok(
    compSource.includes('const ready = handleSave();\n            if (ready) {\n              onNextStep();\n            }') ||
    compSource.includes('const ready = handleSave();\n            if (ready) {\n              onNextStep();'),
    'Navigation button must gate onNextStep() on handleSave() returning true'
  );
  assert.strictEqual(
    compSource.includes('handleSave();\n            onNextStep();'),
    false,
    'Navigation must not call onNextStep() unconditionally'
  );
});

runTest('30. validateATPDataWorkflow() tetap melakukan deep validateTPDataWorkflow() tanpa conditional if (cpAnalysis)', () => {
  const servicePath = path.resolve(process.cwd(), 'src/services/cpWorkflowService.ts');
  const serviceSource = fs.readFileSync(servicePath, 'utf-8');

  assert.strictEqual(
    serviceSource.includes('if (cpAnalysis) {\n      const tpValidation = validateTPDataWorkflow'),
    false,
    'validateATPDataWorkflow must not wrap validateTPDataWorkflow in if (cpAnalysis)'
  );
  assert.ok(
    serviceSource.includes('const tpValidation = validateTPDataWorkflow(tp, cp, cpAnalysis, academicSetting);'),
    'validateATPDataWorkflow must run validateTPDataWorkflow directly'
  );
});

runTest('31. handleSaveCPAnalysis does not rebase basedOnCpUpdatedAt unconditionally', () => {
  const appPath = path.resolve(process.cwd(), 'src/App.tsx');
  const appSource = fs.readFileSync(appPath, 'utf-8');

  assert.strictEqual(
    appSource.includes('basedOnCpUpdatedAt: persistedCP.updatedAt,'),
    false,
    'handleSaveCPAnalysis must not have unconditional basedOnCpUpdatedAt: persistedCP.updatedAt'
  );
  assert.ok(
    appSource.includes('basedOnCpUpdatedAt:\n') || appSource.includes('basedOnCpUpdatedAt:'),
    'handleSaveCPAnalysis must specify basedOnCpUpdatedAt with fallback logic'
  );
  assert.ok(
    appSource.includes('analysis.basedOnCpUpdatedAt'),
    'handleSaveCPAnalysis must prioritize analysis.basedOnCpUpdatedAt'
  );
});

runTest('32. /api/ai/analyze-cp enforces semantic coverage and includes PJOK Fase A 046/2025 clauses', () => {
  const serverPath = path.resolve(process.cwd(), 'server/cpAnalysisAI.ts');
  const serverSource = fs.readFileSync(serverPath, 'utf-8');

  assert.ok(
    serverSource.includes('fallbackAnalyzeCP(input)'),
    '/api/ai/analyze-cp must build deterministic baseline using fallbackAnalyzeCP'
  );
  assert.ok(
    serverSource.includes('cp4Coverage(validation.items,elements)'),
    '/api/ai/analyze-cp must compare substantive tokens for semantic coverage guard'
  );
  assert.ok(
    serverSource.toLowerCase().includes('setiap klausa/kompetensi berbeda pada uraian elemen'),
    'Gemini prompt must include instruction about clauses/competencies separated by ;'
  );
});

runTest('33. checkSemanticCoverage behavioral test: complete passes, missing clause fails', () => {
  const baselineItems = [
    {
      elementId: 'elem-pjok-1',
      materialScope: 'mengenali situasi dan potensi yang berisiko terhadap kesehatan dan keselamatan; strategi mencari bantuan kepada orang dewasa terpercaya',
    },
  ];

  const completeSanitized = [
    {
      elementId: 'elem-pjok-1',
      cpCompetence: 'Mengenali & Mencari',
      materialScope: 'situasi potensi berisiko kesehatan keselamatan serta strategi mencari bantuan kepada orang dewasa terpercaya',
      suggestedTp: 'Peserta didik mampu mengenali risiko dan mencari bantuan orang dewasa terpercaya.',
    },
  ];

  const partialMissingSanitized = [
    {
      elementId: 'elem-pjok-1',
      cpCompetence: 'Mengenali',
      materialScope: 'situasi potensi berisiko kesehatan keselamatan',
      suggestedTp: 'Peserta didik mampu mengenali risiko kesehatan.',
    },
  ];

  assert.strictEqual(
    checkSemanticCoverage(baselineItems, completeSanitized),
    true,
    'Complete semantic coverage must pass'
  );

  assert.strictEqual(
    checkSemanticCoverage(baselineItems, partialMissingSanitized),
    false,
    'Semantic coverage missing crucial clause must fail'
  );

  const baselineShort = [
    {
      elementId: 'elem-pjok-short',
      materialScope: 'Berpartisipasi di dalam berbagai aktivitas jasmani dan mengidentifikasi manfaatnya.',
    },
  ];

  const shortComplete = [
    {
      elementId: 'elem-pjok-short',
      cpCompetence: 'Berpartisipasi',
      materialScope: 'berbagai aktivitas jasmani serta mengidentifikasi manfaatnya',
      suggestedTp: 'Peserta didik berpartisipasi dalam aktivitas jasmani dan mengidentifikasi manfaatnya.',
    },
  ];

  const shortPartialMissing = [
    {
      elementId: 'elem-pjok-short',
      cpCompetence: 'Berpartisipasi',
      materialScope: 'berbagai aktivitas jasmani',
      suggestedTp: 'Peserta didik berpartisipasi dalam aktivitas jasmani.',
    },
  ];

  assert.strictEqual(
    checkSemanticCoverage(baselineShort, shortComplete),
    true,
    'Short baseline complete coverage must pass'
  );

  assert.strictEqual(
    checkSemanticCoverage(baselineShort, shortPartialMissing),
    false,
    'Short baseline missing benefit/manfaat must fail'
  );
});

console.log(`\n========================================`);
console.log(`MERDEKA CP ANALYSIS INTEGRITY: ALL ${passedTests}/${totalTests} TESTS PASSED`);
console.log(`========================================\n`);


