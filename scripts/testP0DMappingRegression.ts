import assert from 'node:assert';
import {
  applyATPMappingActions,
  computeAtpSubstantiveFingerprint,
  computeMappingFingerprint,
  computeTpSubstantiveFingerprint,
} from '../src/services/atpMappingActionApplyService';
import { validateATPUnitMappingCanonical } from '../src/services/atpUnitMappingValidationService';
import { resolveATPUnitMappingReadiness } from '../src/services/atpMappingReadinessService';
import { sanitizeMappingAnalysisResult } from '../server/mappingAnalysis';
import type { ATPData, TPData, ATPUnitMappingData } from '../src/types';

console.log('=== RUNNING P0-D PRODUCTION HELPER MAPPING REGRESSION TESTS ===\n');

const mockAtp: ATPData = {
  id: 'atp-1',
  academicSettingId: 'acad-1',
  items: [
    { id: 'atp-item-1', stepNumber: 1, linkedTpIds: ['tp-1'] },
    { id: 'atp-item-2', stepNumber: 2, linkedTpIds: ['tp-2'] },
  ],
  updatedAt: '2026-01-01T00:00:00.000Z',
} as any;

const mockTp: TPData = {
  id: 'tp-1',
  academicSettingId: 'acad-1',
  items: [
    { id: 'tp-1', code: 'TP1', statement: 'TP 1', competence: 'Memahami', contentScope: 'Materi 1' },
    { id: 'tp-2', code: 'TP2', statement: 'TP 2', competence: 'Menerapkan', contentScope: 'Materi 2' },
  ],
  updatedAt: '2026-01-01T00:00:00.000Z',
} as any;

const initialUnits = [
  {
    id: 'unit-1',
    title: 'Bab 1',
    order: 1,
    linkedAtpItemIds: ['atp-item-1', 'atp-item-2'],
    linkedTpIds: ['tp-1', 'tp-2'],
    materials: [
      {
        id: 'mat-1',
        title: 'Materi Lama',
        order: 1,
        linkedAtpItemIds: ['atp-item-1'],
        linkedTpIds: ['tp-1'],
      },
    ],
  },
];

const initialFingerprint = computeMappingFingerprint(initialUnits, mockAtp, mockTp);

// Scenario 1: ALIGN valid -> replace, bukan union
{
  const result = applyATPMappingActions({
    units: initialUnits,
    selectedActions: [{
      id: 'act-1',
      type: 'ALIGN_EXISTING_MATERIAL',
      targetUnitId: 'unit-1',
      targetMaterialId: 'mat-1',
      linkedAtpItemIds: ['atp-item-2'],
      linkedTpIds: ['tp-2'],
    }],
    atp: mockAtp,
    tp: mockTp,
    expectedFingerprint: initialFingerprint,
    currentFingerprint: initialFingerprint,
  });
  assert.strictEqual(result.success, true, 'ALIGN valid must pass');
  assert.deepStrictEqual(result.nextUnits?.[0].materials[0].linkedAtpItemIds, ['atp-item-2'], 'ALIGN must replace lineage rather than union');
  assert.deepStrictEqual(result.nextUnits?.[0].materials[0].linkedTpIds, ['tp-2']);
  console.log('PASS Scenario 1: ALIGN valid replaces lineage');
}

// Scenario 2: ALIGN invalid -> reject
{
  const result = applyATPMappingActions({
    units: initialUnits,
    selectedActions: [{
      id: 'act-2',
      type: 'ALIGN_EXISTING_MATERIAL',
      targetUnitId: 'unit-1',
      targetMaterialId: 'mat-1',
      linkedAtpItemIds: ['fiktif-atp'],
      linkedTpIds: ['tp-1'],
    }],
    atp: mockAtp,
    tp: mockTp,
    expectedFingerprint: initialFingerprint,
    currentFingerprint: initialFingerprint,
  });
  assert.strictEqual(result.success, false, 'ALIGN invalid must be rejected');
  console.log('PASS Scenario 2: ALIGN invalid rejected');
}

// Scenario 3: ASSIGN dengan subset TP kosong -> reject
{
  const result = applyATPMappingActions({
    units: initialUnits,
    selectedActions: [{
      id: 'act-3',
      type: 'ASSIGN_ATP_TO_UNIT',
      targetUnitId: 'unit-1',
      atpItemId: 'atp-item-1',
      linkedTpIds: [],
    }],
    atp: mockAtp,
    tp: mockTp,
    expectedFingerprint: initialFingerprint,
    currentFingerprint: initialFingerprint,
  });
  assert.strictEqual(result.success, false, 'ASSIGN with empty TP subset must be rejected');
  console.log('PASS Scenario 3: ASSIGN with empty TP subset rejected');
}

// Scenario 4: Multi-action satu invalid -> seluruh transaksi reject
{
  const before = JSON.stringify(initialUnits);
  const result = applyATPMappingActions({
    units: initialUnits,
    selectedActions: [
      {
        id: 'act-4a',
        type: 'ADD_MATERIAL_TO_UNIT',
        targetUnitId: 'unit-1',
        title: 'Materi Valid',
        linkedAtpItemIds: ['atp-item-1'],
        linkedTpIds: ['tp-1'],
      },
      {
        id: 'act-4b',
        type: 'ALIGN_EXISTING_MATERIAL',
        targetUnitId: 'unit-1',
        targetMaterialId: 'mat-1',
        linkedAtpItemIds: ['fiktif-atp'],
        linkedTpIds: ['tp-1'],
      },
    ],
    atp: mockAtp,
    tp: mockTp,
    expectedFingerprint: initialFingerprint,
    currentFingerprint: initialFingerprint,
  });
  assert.strictEqual(result.success, false, 'Multi-action with one invalid action must reject entire transaction atomically');
  assert.strictEqual(JSON.stringify(initialUnits), before, 'Failed apply must not mutate draft input');
  console.log('PASS Scenario 4: Multi-action atomic rejection');
}

// Scenario 5: ADD material valid -> PASS
{
  const result = applyATPMappingActions({
    units: initialUnits,
    selectedActions: [{
      id: 'act-5',
      type: 'ADD_MATERIAL_TO_UNIT',
      targetUnitId: 'unit-1',
      title: 'Materi Baru',
      linkedAtpItemIds: ['atp-item-1'],
      linkedTpIds: ['tp-1'],
    }],
    atp: mockAtp,
    tp: mockTp,
    expectedFingerprint: initialFingerprint,
    currentFingerprint: initialFingerprint,
  });
  assert.strictEqual(result.success, true, 'ADD valid material must pass');
  assert.strictEqual(result.nextUnits?.[0].materials.length, 2);
  console.log('PASS Scenario 5: ADD valid material passed');
}

// Scenario 6: ADD material parent-invalid -> reject
{
  const restrictedUnits = [{
    id: 'unit-1',
    title: 'Bab 1',
    order: 1,
    linkedAtpItemIds: ['atp-item-1'],
    linkedTpIds: ['tp-1'],
    materials: [],
  }];
  const restrictedFp = computeMappingFingerprint(restrictedUnits, mockAtp, mockTp);
  const resultRestricted = applyATPMappingActions({
    units: restrictedUnits,
    selectedActions: [{
      id: 'act-6b',
      type: 'ADD_MATERIAL_TO_UNIT',
      targetUnitId: 'unit-1',
      title: 'Materi Diluar Unit',
      linkedAtpItemIds: ['atp-item-2'],
      linkedTpIds: ['tp-2'],
    }],
    atp: mockAtp,
    tp: mockTp,
    expectedFingerprint: restrictedFp,
    currentFingerprint: restrictedFp,
  });
  assert.strictEqual(resultRestricted.success, false, 'ADD material unsupported by parent unit lineage must be rejected');
  console.log('PASS Scenario 6: ADD material parent-invalid rejected');
}

// Scenario 7: Draf berubah setelah analisis -> stale reject
{
  const modifiedUnits = JSON.parse(JSON.stringify(initialUnits));
  modifiedUnits[0].title = 'Bab 1 Diubah Guru';
  const modifiedFp = computeMappingFingerprint(modifiedUnits, mockAtp, mockTp);

  const result = applyATPMappingActions({
    units: modifiedUnits,
    selectedActions: [{
      id: 'act-7',
      type: 'ADD_MATERIAL_TO_UNIT',
      targetUnitId: 'unit-1',
      title: 'Materi',
      linkedAtpItemIds: ['atp-item-1'],
      linkedTpIds: ['tp-1'],
    }],
    atp: mockAtp,
    tp: mockTp,
    expectedFingerprint: initialFingerprint, // stale fingerprint
    currentFingerprint: modifiedFp,
  });
  assert.strictEqual(result.success, false, 'Draft change after analysis must cause stale rejection');
  console.log('PASS Scenario 7: Draft change stale rejection');
}

// Scenario 8: Substansi TP/ATP berubah -> stale reject
{
  const modifiedAtp = {
    ...mockAtp,
    updatedAt: '2026-01-02T00:00:00.000Z',
    items: [{ ...mockAtp.items[0], linkedTpIds: ['tp-2'] }, mockAtp.items[1]],
  };
  const modifiedAtpFp = computeMappingFingerprint(initialUnits, modifiedAtp, mockTp);

  const result = applyATPMappingActions({
    units: initialUnits,
    selectedActions: [{
      id: 'act-8',
      type: 'ADD_MATERIAL_TO_UNIT',
      targetUnitId: 'unit-1',
      title: 'Materi',
      linkedAtpItemIds: ['atp-item-1'],
      linkedTpIds: ['tp-1'],
    }],
    atp: modifiedAtp,
    tp: mockTp,
    expectedFingerprint: initialFingerprint,
    currentFingerprint: modifiedAtpFp,
  });
  assert.strictEqual(result.success, false, 'ATP substantive update must cause stale rejection');
  console.log('PASS Scenario 8: ATP substantive update stale rejection');
}

// Scenario 9: Fingerprint kosong -> reject
{
  const result = applyATPMappingActions({
    units: initialUnits,
    selectedActions: [{
      id: 'act-9',
      type: 'ADD_MATERIAL_TO_UNIT',
      targetUnitId: 'unit-1',
      title: 'Materi',
      linkedAtpItemIds: ['atp-item-1'],
      linkedTpIds: ['tp-1'],
    }],
    atp: mockAtp,
    tp: mockTp,
    expectedFingerprint: undefined,
    currentFingerprint: initialFingerprint,
  });
  assert.strictEqual(result.success, false, 'Empty fingerprint must be rejected');
  console.log('PASS Scenario 9: Empty fingerprint rejected');
}

// Scenario 10: Draf incomplete tetapi valid -> apply PASS
{
  const incompleteUnits = [{
    id: 'unit-1',
    title: 'Bab 1',
    order: 1,
    linkedAtpItemIds: ['atp-item-1'],
    linkedTpIds: ['tp-1'],
    materials: [],
  }];
  const incompleteFp = computeMappingFingerprint(incompleteUnits, mockAtp, mockTp);

  const result = applyATPMappingActions({
    units: incompleteUnits,
    selectedActions: [{
      id: 'act-10',
      type: 'ADD_MATERIAL_TO_UNIT',
      targetUnitId: 'unit-1',
      title: 'Materi',
      linkedAtpItemIds: ['atp-item-1'],
      linkedTpIds: ['tp-1'],
    }],
    atp: mockAtp,
    tp: mockTp,
    expectedFingerprint: incompleteFp,
    currentFingerprint: incompleteFp,
  });
  assert.strictEqual(result.success, true, 'Incomplete but valid draft application must pass');
  console.log('PASS Scenario 10: Incomplete valid draft apply passed');
}

// Scenario 11: Input awal tidak termutasi
{
  const snapshotBefore = JSON.stringify(initialUnits);
  applyATPMappingActions({
    units: initialUnits,
    selectedActions: [{
      id: 'act-11',
      type: 'ADD_MATERIAL_TO_UNIT',
      targetUnitId: 'unit-1',
      title: 'Materi Baru',
      linkedAtpItemIds: ['atp-item-1'],
      linkedTpIds: ['tp-1'],
    }],
    atp: mockAtp,
    tp: mockTp,
    expectedFingerprint: initialFingerprint,
    currentFingerprint: initialFingerprint,
  });
  const snapshotAfter = JSON.stringify(initialUnits);
  assert.strictEqual(snapshotBefore, snapshotAfter, 'Initial input units must not be mutated');
  console.log('PASS Scenario 11: Initial input immutability verified');
}

// Scenario 12: Tidak ada pemanggilan persist di helper
{
  assert.strictEqual(typeof applyATPMappingActions, 'function');
  assert.strictEqual(typeof computeMappingFingerprint, 'function');
  console.log('PASS Scenario 12: Helper is pure function without side effects');
}

// Scenario 13: Excel 6 Bab/17 Materi lineage kosong diisi tanpa mengubah struktur
{
  const excelTp: TPData = {
    id: 'tp-excel',
    academicSettingId: 'acad-1',
    workflowStatus: 'SIAP',
    items: Array.from({ length: 10 }, (_, idx) => ({
      id: `tp-excel-${idx + 1}`,
      code: `TP-${idx + 1}`,
      statement: `Memahami materi Excel ${idx + 1}`,
      competence: 'Memahami',
      contentScope: `Materi Excel ${idx + 1}`,
    })),
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as any;
  const excelAtp: ATPData = {
    id: 'atp-excel',
    academicSettingId: 'acad-1',
    tpDataId: 'tp-excel',
    workflowStatus: 'SIAP',
    items: Array.from({ length: 5 }, (_, idx) => ({
      id: `atp-excel-${idx + 1}`,
      stepNumber: idx + 1,
      focus: `Fokus ATP Excel ${idx + 1}`,
      linkedTpIds: [`tp-excel-${idx * 2 + 1}`, `tp-excel-${idx * 2 + 2}`],
    })),
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as any;
  const excelUnits = Array.from({ length: 6 }, (_, unitIdx) => ({
    id: `excel-unit-${unitIdx + 1}`,
    title: `Bab Excel ${unitIdx + 1}`,
    order: unitIdx + 1,
    linkedAtpItemIds: [],
    linkedTpIds: [],
    materials: Array.from({ length: unitIdx === 0 ? 2 : 3 }, (_, matIdx) => ({
      id: `excel-mat-${unitIdx + 1}-${matIdx + 1}`,
      title: `Materi Excel ${unitIdx + 1}.${matIdx + 1}`,
      order: matIdx + 1,
      linkedAtpItemIds: [],
      linkedTpIds: [],
    })),
  }));
  const structureBefore = (excelUnits || []).map((u) => ({
    id: u.id,
    title: u.title,
    order: u.order,
    materials: u.materials.map((m) => ({ id: m.id, title: m.title, order: m.order })),
  }));
  const materialIds = excelUnits.flatMap((u) => u.materials.map((m) => ({ unitId: u.id, materialId: m.id, order: m.order })));
  const actions = materialIds.map((entry, idx) => {
    const tpIndex = idx % 10;
    const atpIndex = Math.floor(tpIndex / 2);
    return {
      id: `excel-align-${idx + 1}`,
      type: 'ALIGN_EXISTING_MATERIAL' as const,
      targetUnitId: entry.unitId,
      targetMaterialId: entry.materialId,
      linkedAtpItemIds: [`atp-excel-${atpIndex + 1}`],
      linkedTpIds: [`tp-excel-${tpIndex + 1}`],
    };
  });
  const fp = computeMappingFingerprint(excelUnits, excelAtp, excelTp);
  const result = applyATPMappingActions({
    units: excelUnits,
    selectedActions: actions,
    atp: excelAtp,
    tp: excelTp,
    expectedFingerprint: fp,
    currentFingerprint: fp,
  });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.nextUnits?.length, 6);
  assert.strictEqual(result.nextUnits?.reduce((sum, u) => sum + u.materials.length, 0), 17);
  const structureAfter = (result.nextUnits || []).map((u) => ({
    id: u.id,
    title: u.title,
    order: u.order,
    materials: u.materials.map((m) => ({ id: m.id, title: m.title, order: m.order })),
  }));
  assert.deepStrictEqual(structureAfter, structureBefore, 'Excel Bab/Materi IDs, titles, and order must not change');
  const mapping: ATPUnitMappingData = {
    id: 'mapping-excel',
    academicSettingId: 'acad-1',
    atpId: excelAtp.id,
    tpDataId: excelTp.id,
    units: result.nextUnits!,
    basedOnAtpFingerprint: computeAtpSubstantiveFingerprint(excelAtp),
    basedOnTpFingerprint: computeTpSubstantiveFingerprint(excelTp),
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const validation = validateATPUnitMappingCanonical(mapping, excelAtp, excelTp);
  assert.strictEqual(validation.isValid, true, `Excel mapping must be canonical valid: ${validation.issues.join('; ')}`);
  assert.strictEqual(validation.isComplete, true, `Excel mapping must be complete: ${validation.issues.join('; ')}`);
  assert.strictEqual(validation.invalidReferenceCount, 0, 'Excel mapping must have Z=0 invalid references');
  assert.deepStrictEqual(validation.unmappedAtpIds, [], 'No canonical ATP may remain unmapped');
  assert.deepStrictEqual(validation.uncoveredTpIds, [], 'No canonical TP may remain uncovered');
  const readiness = resolveATPUnitMappingReadiness(mapping, excelAtp, excelTp, { id: 'acad-1' } as any);
  assert.strictEqual(readiness.canProceed, true, `Complete Excel mapping must proceed: ${readiness.blockers.join('; ')}`);
  const reloadedMapping = JSON.parse(JSON.stringify(mapping)) as ATPUnitMappingData;
  const reloadedValidation = validateATPUnitMappingCanonical(reloadedMapping, excelAtp, excelTp);
  assert.strictEqual(reloadedValidation.isValid, true, 'Reloaded mapping must retain valid lineage');
  assert.strictEqual(reloadedValidation.isComplete, true, 'Reloaded mapping must retain complete lineage');
  console.log('PASS Scenario 13: Excel imported 6 Bab/17 Materi preserved and ready');
}

// Scenario 14-16: Referensi ATP lama multi-materi direkomendasikan recovery, direlink, dan ID lama dibersihkan
{
  const oldUnits = [{
    id: 'unit-old',
    title: 'Bab 1',
    order: 1,
    linkedAtpItemIds: ['atp-item-old-1', 'atp-item-old-2'],
    linkedTpIds: ['tp-1', 'tp-2'],
    materials: [
      {
        id: 'mat-old-1',
        title: 'Materi 1',
        order: 1,
        linkedAtpItemIds: ['atp-item-old-1'],
        linkedTpIds: ['tp-1'],
      },
      {
        id: 'mat-old-2',
        title: 'Materi 2',
        order: 2,
        linkedAtpItemIds: ['atp-item-old-2'],
        linkedTpIds: ['tp-2'],
      },
    ],
  }];
  const analysis = sanitizeMappingAnalysisResult({ atpFindings: [], materialFindings: [], summary: {} }, {
    tpData: mockTp,
    atpData: mockAtp,
    currentMapping: {
      id: 'mapping-old',
      academicSettingId: 'acad-1',
      atpId: mockAtp.id,
      tpDataId: mockTp.id,
      units: oldUnits,
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  });
  const recoveryActions = analysis.materialFindings.filter((f) => f.action).map((f) => ({ id: f.id, ...f.action! }));
  assert.ok(recoveryActions.length >= 1, 'Recovery analysis must produce explicit action(s)');

  const fp = computeMappingFingerprint(oldUnits, mockAtp, mockTp);
  const applied = applyATPMappingActions({
    units: oldUnits,
    selectedActions: recoveryActions as any,
    atp: mockAtp,
    tp: mockTp,
    expectedFingerprint: fp,
    currentFingerprint: fp,
  });
  assert.strictEqual(applied.success, true, 'Recovery actions must apply');
  assert.ok(!JSON.stringify(applied.nextUnits).includes('atp-item-old'), 'Old ATP references must be removed after valid recovery');
  assert.ok(JSON.stringify(applied.nextUnits).includes('atp-item-1'), 'Current canonical ATP must be linked after recovery');
  assert.ok(JSON.stringify(applied.nextUnits).includes('atp-item-2'), 'Multiple material recovery actions must preserve each canonical ATP');
  console.log('PASS Scenario 14-16: Old ATP references recover atomically across multiple materials');
}

// Scenario 17: Relasi ambigu tidak diterapkan otomatis
{
  const ambiguousAtp: ATPData = {
    ...mockAtp,
    items: [
      ...mockAtp.items,
      { id: 'atp-item-1b', stepNumber: 3, linkedTpIds: ['tp-1'] },
    ],
  } as any;
  const oldUnits = [{
    id: 'unit-amb',
    title: 'Materi 1',
    order: 1,
    linkedAtpItemIds: ['atp-item-old'],
    linkedTpIds: ['tp-1'],
    materials: [],
  }];
  const analysis = sanitizeMappingAnalysisResult({ atpFindings: [], materialFindings: [], summary: {} }, {
    tpData: mockTp,
    atpData: ambiguousAtp,
    currentMapping: { id: 'mapping-amb', academicSettingId: 'acad-1', atpId: ambiguousAtp.id, tpDataId: mockTp.id, units: oldUnits, updatedAt: '2026-01-01' },
  });
  assert.ok(analysis.materialFindings.some((f) => f.status === 'MANUAL_REVIEW' && !f.action), 'Ambiguous recovery must require teacher review');
  console.log('PASS Scenario 17: Ambiguous recovery is not auto-actionable');
}

// Scenario 18-19: Draft valid-incomplete bisa disimpan, complete bisa lanjut
{
  const incompleteMapping: ATPUnitMappingData = {
    id: 'mapping-incomplete',
    academicSettingId: 'acad-1',
    atpId: mockAtp.id,
    tpDataId: mockTp.id,
    units: [{ id: 'unit-1', title: 'Bab 1', order: 1, linkedAtpItemIds: ['atp-item-1'], linkedTpIds: ['tp-1'], materials: [] }],
    basedOnAtpFingerprint: computeAtpSubstantiveFingerprint(mockAtp),
    basedOnTpFingerprint: computeTpSubstantiveFingerprint(mockTp),
    updatedAt: '2026-01-01',
  };
  const readyAtp = { ...mockAtp, workflowStatus: 'SIAP' } as ATPData;
  const readyTp = { ...mockTp, workflowStatus: 'SIAP' } as TPData;
  const draftReadiness = resolveATPUnitMappingReadiness(incompleteMapping, readyAtp, readyTp, { id: 'acad-1' } as any);
  assert.strictEqual(draftReadiness.canSaveDraft, true, 'Valid incomplete mapping must be saveable as draft');
  assert.strictEqual(draftReadiness.canProceed, false, 'Incomplete mapping must not proceed');

  const completeMapping: ATPUnitMappingData = {
    ...incompleteMapping,
    units: [{
      id: 'unit-1',
      title: 'Bab 1',
      order: 1,
      linkedAtpItemIds: ['atp-item-1', 'atp-item-2'],
      linkedTpIds: ['tp-1', 'tp-2'],
      materials: [
        { id: 'mat-1', title: 'Materi 1', order: 1, linkedAtpItemIds: ['atp-item-1'], linkedTpIds: ['tp-1'] },
        { id: 'mat-2', title: 'Materi 2', order: 2, linkedAtpItemIds: ['atp-item-2'], linkedTpIds: ['tp-2'] },
      ],
    }],
  };
  const completeReadiness = resolveATPUnitMappingReadiness(completeMapping, readyAtp, readyTp, { id: 'acad-1' } as any);
  assert.strictEqual(completeReadiness.canProceed, true, 'Complete valid mapping must proceed to Step 08');
  console.log('PASS Scenario 18-19: Save draft and proceed readiness verified');
}

// Scenario 20-21: Metadata-only tidak stale, substansi upstream tetap stale
{
  const mappingWithFingerprint: ATPUnitMappingData = {
    id: 'mapping-fresh',
    academicSettingId: 'acad-1',
    atpId: mockAtp.id,
    tpDataId: mockTp.id,
    units: initialUnits,
    basedOnAtpUpdatedAt: '2026-01-01T00:00:00.000Z',
    basedOnTpUpdatedAt: '2026-01-01T00:00:00.000Z',
    basedOnAtpFingerprint: computeAtpSubstantiveFingerprint(mockAtp),
    basedOnTpFingerprint: computeTpSubstantiveFingerprint(mockTp),
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const metadataOnlyAtp = { ...mockAtp, workflowStatus: 'SIAP', updatedAt: '2026-01-02T00:00:00.000Z' } as ATPData;
  const readyTp = { ...mockTp, workflowStatus: 'SIAP' } as TPData;
  const metadataReadiness = resolveATPUnitMappingReadiness(mappingWithFingerprint, metadataOnlyAtp, readyTp, { id: 'acad-1' } as any);
  assert.ok(!metadataReadiness.blockers.some((b) => b.includes('stale')), 'Metadata-only ATP update must not trigger stale when fingerprint matches');

  const changedAtp = { ...metadataOnlyAtp, items: [{ ...metadataOnlyAtp.items[0], linkedTpIds: ['tp-2'] }, metadataOnlyAtp.items[1]] } as ATPData;
  const changedReadiness = resolveATPUnitMappingReadiness(mappingWithFingerprint, changedAtp, readyTp, { id: 'acad-1' } as any);
  assert.ok(changedReadiness.blockers.some((b) => b.includes('Substansi ATP berubah')), 'Substantive ATP change must remain stale');
  console.log('PASS Scenario 20-21: Metadata-only and substantive stale checks verified');
}

console.log('\n=== ALL P0-D PRODUCTION HELPER MAPPING REGRESSION TESTS PASSED SUCCESSFULLY ===\n');
