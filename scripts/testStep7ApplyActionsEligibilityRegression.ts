import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  extractSelectedMappingActions,
  validateActionAgainstDraft,
  resolveApplyActionsEligibility,
} from '../src/services/atpApplyActionEligibilityService';
import {
  applyATPMappingActions,
  computeMappingFingerprint,
  type MappingActionItem,
} from '../src/services/atpMappingActionApplyService';
import type { ATPData, TPData, ATPUnitMapping } from '../src/types';
import type { MappingAnalysisResult } from '../src/services/aiService';

console.log('--- RUNNING REGRESSION TESTS FOR STEP 7 APPLY ACTIONS ELIGIBILITY & DIAGNOSTICS ---');

// Setup mock canonical TP & ATP
const tp: TPData = {
  id: 'tp-1',
  academicSettingId: 'setting-1',
  workflowStatus: 'SIAP',
  updatedAt: '2026-01-01',
  items: [
    {
      id: 'tp-item-1',
      code: 'TP1',
      order: 1,
      statement: 'Memahami konsep dasar gerak',
      competence: 'Memahami',
      contentScope: 'Gerak Dasar',
    },
    {
      id: 'tp-item-2',
      code: 'TP2',
      order: 2,
      statement: 'Mempraktikkan gerak lokomotor',
      competence: 'Mempraktikkan',
      contentScope: 'Gerak Lokomotor',
    },
  ],
};

const atp: ATPData = {
  id: 'atp-1',
  tpDataId: tp.id,
  academicSettingId: 'setting-1',
  workflowStatus: 'SIAP',
  updatedAt: '2026-01-01',
  items: [
    {
      id: 'atp-item-1',
      stepNumber: 1,
      focus: 'Pengenalan dan latihan gerak dasar',
      linkedTpIds: ['tp-item-1'],
    },
    {
      id: 'atp-item-2',
      stepNumber: 2,
      focus: 'Latihan gerak lokomotor terstruktur',
      linkedTpIds: ['tp-item-2'],
    },
  ],
};

const units: ATPUnitMapping[] = [
  {
    id: 'unit-1',
    title: 'Bab 1: Gerak Dasar',
    order: 1,
    linkedAtpItemIds: ['atp-item-1'],
    linkedTpIds: ['tp-item-1'],
    materials: [
      {
        id: 'mat-1',
        title: 'Pengenalan Gerak Dasar',
        order: 1,
        linkedAtpItemIds: ['atp-item-1'],
        linkedTpIds: ['tp-item-1'],
      },
    ],
  },
  {
    id: 'unit-2',
    title: 'Bab 2: Gerak Lanjutan',
    order: 2,
    linkedAtpItemIds: [],
    linkedTpIds: [],
    materials: [],
  },
];

const currentFingerprint = computeMappingFingerprint(units, atp, tp);

// -------------------------------------------------------------
// Test 1: 0 Pilihan -> Disabled + Alasan "belum ada saran dipilih"
// -------------------------------------------------------------
console.log('Testing Test 1: 0 pilihan -> disabled + alasan...');
{
  const eligibility = resolveApplyActionsEligibility({
    selectedCount: 0,
    selectedActions: [],
    units,
    atp,
    tp,
    expectedFingerprint: currentFingerprint,
    currentFingerprint,
  });

  assert.equal(eligibility.canApply, false, '0 pilihan must not allow apply');
  assert.ok(
    eligibility.disabledReason && eligibility.disabledReason.toLowerCase().includes('belum ada saran dipilih'),
    `Reason must indicate no suggestions selected. Got: ${eligibility.disabledReason}`
  );
  console.log('✓ Test 1 passed: 0 pilihan is disabled with reason:', eligibility.disabledReason);
}

// -------------------------------------------------------------
// Test 2: ID terpilih tapi action null -> Disabled + Alasan "pilihan tidak memiliki action valid"
// -------------------------------------------------------------
console.log('Testing Test 2: ID terpilih tapi action null -> disabled + alasan...');
{
  const mockAnalysis: MappingAnalysisResult = {
    summary: {
      totalAtp: 2,
      mappedAtp: 1,
      unmappedAtp: 1,
      alignedAtp: 1,
      reviewAtp: 0,
      alignableMaterials: 0,
      missingMaterialSuggestions: 0,
      manualMaterialReview: 1,
    },
    atpFindings: [],
    materialFindings: [
      {
        id: 'finding-manual-review-1',
        status: 'MANUAL_REVIEW',
        unitId: 'unit-1',
        materialId: 'mat-1',
        reason: 'Materi ini memerlukan peninjauan manual guru tanpa saran otomatis.',
        supportingTpIds: [],
        supportingAtpItemIds: [],
        // action is undefined / null
      },
    ],
  };

  const selectedIds = new Set(['finding-manual-review-1']);
  const extracted = extractSelectedMappingActions(mockAnalysis, selectedIds);
  assert.equal(extracted.length, 0, 'Extracted actions must be empty for findings without action');

  const eligibility = resolveApplyActionsEligibility({
    selectedCount: selectedIds.size,
    selectedActions: extracted,
    units,
    atp,
    tp,
    expectedFingerprint: currentFingerprint,
    currentFingerprint,
  });

  assert.equal(eligibility.canApply, false, 'Selected finding without action must not allow apply');
  assert.ok(
    eligibility.disabledReason && eligibility.disabledReason.toLowerCase().includes('pilihan tidak memiliki action valid'),
    `Reason must state no valid actions. Got: ${eligibility.disabledReason}`
  );
  assert.ok(
    eligibility.diagnosticWarning && eligibility.diagnosticWarning.length > 0,
    'Diagnostic warning must be non-empty when suggestions selected but 0 executable actions'
  );
  console.log('✓ Test 2 passed: finding without action is disabled with diagnostic warning:', eligibility.disabledReason);
}

// -------------------------------------------------------------
// Test 3: Action tidak cocok dengan draf saat ini -> Disabled + Alasan
// -------------------------------------------------------------
console.log('Testing Test 3: Action tidak cocok dengan draft -> disabled + alasan...');
{
  const mismatchedAction: MappingActionItem = {
    id: 'finding-ghost-unit',
    type: 'ASSIGN_ATP_TO_UNIT',
    atpItemId: 'atp-item-2',
    targetUnitId: 'ghost-unit-999', // Non-existent unit in draft
    linkedTpIds: ['tp-item-2'],
  };

  const validity = validateActionAgainstDraft(mismatchedAction, units, atp, tp);
  assert.equal(validity.valid, false, 'Action targeting ghost unit must be invalid');
  assert.ok(validity.issue?.includes('tidak ditemukan'), `Issue must state unit not found. Got: ${validity.issue}`);

  const eligibility = resolveApplyActionsEligibility({
    selectedCount: 1,
    selectedActions: [mismatchedAction],
    units,
    atp,
    tp,
    expectedFingerprint: currentFingerprint,
    currentFingerprint,
  });

  assert.equal(eligibility.canApply, false, 'Mismatched action must not allow apply');
  assert.ok(
    eligibility.previewSuccess === false && eligibility.previewIssues.length > 0,
    `Reason must indicate action does not match draft. Got: ${eligibility.disabledReason}`
  );
  assert.ok(eligibility.issues.length > 0, 'Issues list must not be empty');
  const preview = applyATPMappingActions({ units, selectedActions: [mismatchedAction], atp, tp,
    expectedFingerprint: currentFingerprint, currentFingerprint });
  assert.deepEqual(eligibility.previewIssues, preview.issues, 'Preserve original preview issues');
  assert.deepEqual(eligibility.issues, preview.issues);
  assert.ok(preview.issues.every(issue => eligibility.diagnosticWarning?.includes(issue)));
  console.log('✓ Test 3 passed: mismatched action is disabled with reason:', eligibility.disabledReason);
}

// -------------------------------------------------------------
// Test 4: Action valid -> Tombol Enabled
// -------------------------------------------------------------
console.log('Testing Test 4: Action valid -> tombol enabled...');
{
  const validAction: MappingActionItem = {
    id: 'finding-add-material-step2',
    type: 'ADD_MATERIAL_TO_UNIT',
    title: 'Latihan Gerak Lokomotor',
    targetUnitId: 'unit-2',
    linkedAtpItemIds: ['atp-item-2'],
    linkedTpIds: ['tp-item-2'],
  };

  const validity = validateActionAgainstDraft(validAction, units, atp, tp);
  assert.equal(validity.valid, true, 'Valid action must pass validation');

  const eligibility = resolveApplyActionsEligibility({
    selectedCount: 1,
    selectedActions: [validAction],
    units,
    atp,
    tp,
    expectedFingerprint: currentFingerprint,
    currentFingerprint,
  });

  assert.equal(eligibility.canApply, true, 'Valid action must allow apply');
  assert.equal(eligibility.disabledReason, undefined, 'Disabled reason must be undefined when enabled');
  for (const selectedCount of [0, 3]) {
    const mixed = resolveApplyActionsEligibility({ selectedCount, selectedActions: [validAction], units, atp, tp,
      expectedFingerprint: currentFingerprint, currentFingerprint });
    assert.equal(mixed.canApply, true, 'Finding count must never block a successful executable preview');
    assert.equal(mixed.selectedFindingCount, selectedCount);
    assert.equal(mixed.executableActionCount, 1);
    assert.equal(mixed.previewSuccess, true);
    assert.deepEqual(mixed.previewIssues, []);
    if (selectedCount > 1) assert.ok(mixed.diagnosticWarning?.includes('tanpa action'));
  }

  // Verify applyATPMappingActions actually succeeds with this action
  const applyResult = applyATPMappingActions({
    units,
    selectedActions: [validAction],
    atp,
    tp,
    expectedFingerprint: currentFingerprint,
    currentFingerprint,
  });

  assert.equal(applyResult.success, true, `applyATPMappingActions must succeed with valid action: ${applyResult.issues.join('; ')}`);
  assert.ok(applyResult.nextUnits, 'nextUnits must be returned');
  const targetUnitAfter = applyResult.nextUnits.find((u) => u.id === 'unit-2');
  assert.ok(targetUnitAfter?.linkedAtpItemIds.includes('atp-item-2'), 'Unit 2 must now have atp-item-2');
  assert.ok(targetUnitAfter?.linkedTpIds.includes('tp-item-2'), 'Unit 2 must now have tp-item-2');
  assert.ok(targetUnitAfter?.materials.some((m) => m.title === 'Latihan Gerak Lokomotor'), 'Unit 2 must have new material');
  console.log('✓ Test 4 passed: valid action results in enabled button and successful apply');
}

// -------------------------------------------------------------
// Test 5: Stale Fingerprint -> Apply gagal dengan alasan terlihat
// -------------------------------------------------------------
console.log('Testing Test 5: Stale fingerprint -> apply gagal dengan alasan terlihat...');
{
  const validAction: MappingActionItem = {
    id: 'finding-assign-step2',
    type: 'ASSIGN_ATP_TO_UNIT',
    atpItemId: 'atp-item-2',
    targetUnitId: 'unit-2',
    linkedTpIds: ['tp-item-2'],
  };

  const staleFingerprint = 'stale-outdated-fingerprint-12345';

  const eligibility = resolveApplyActionsEligibility({
    selectedCount: 1,
    selectedActions: [validAction],
    units,
    atp,
    tp,
    expectedFingerprint: staleFingerprint,
    currentFingerprint,
  });

  assert.equal(eligibility.canApply, false, 'Stale fingerprint must not allow apply');
  assert.ok(
    eligibility.disabledReason && eligibility.disabledReason.toLowerCase().includes('hasil analisis stale/kedaluwarsa'),
    `Reason must indicate stale analysis. Got: ${eligibility.disabledReason}`
  );

  // Direct apply test with stale fingerprint
  const applyResult = applyATPMappingActions({
    units,
    selectedActions: [validAction],
    atp,
    tp,
    expectedFingerprint: staleFingerprint,
    currentFingerprint,
  });

  assert.equal(applyResult.success, false, 'applyATPMappingActions must fail when fingerprint is stale');
  assert.ok(
    applyResult.issues.some((issue) => issue.includes('kedaluwarsa') || issue.includes('tidak tersedia')),
    `Issues must mention stale/outdated. Got: ${JSON.stringify(applyResult.issues)}`
  );
  console.log('✓ Test 5 passed: stale fingerprint fails with visible reason:', eligibility.disabledReason);
  const incomplete = resolveApplyActionsEligibility({ selectedCount: 3, selectedActions: [validAction],
    units, atp, tp, expectedFingerprint: currentFingerprint, currentFingerprint });
  const incompletePreview = applyATPMappingActions({ selectedActions: [validAction], units, atp, tp,
    expectedFingerprint: currentFingerprint, currentFingerprint });
  assert.equal(incompletePreview.success, false, 'ATP assignment without paired material must fail global preview');
  assert.equal(incomplete.canApply, false);
  assert.equal(incomplete.previewSuccess, false);
  assert.deepEqual(incomplete.previewIssues, incompletePreview.issues);
  assert.ok(incompletePreview.issues.every(issue => incomplete.diagnosticWarning?.includes(issue)));
}

// -------------------------------------------------------------
// Test 6: Verify ATPUnitMappingManager contract and UI bindings
// -------------------------------------------------------------
console.log('Testing Test 6: Verify ATPUnitMappingManager source bindings...');
{
  const componentPath = path.resolve('src/components/ATPUnitMappingManager.tsx');
  const componentSource = fs.readFileSync(componentPath, 'utf8');

  // Contract 2: selectedActions computed before render
  assert.ok(
    componentSource.includes('const selectedActions = useMemo(') ||
    componentSource.includes('selectedActions = extractSelectedMappingActions('),
    'selectedActions must be computed before render'
  );

  // Contract 3 & 4: disabled based on real eligibility and clear reason near button
  assert.ok(
    componentSource.includes('disabled={!actionEligibility.canApply}'),
    'Button disabled must be bound to actionEligibility.canApply'
  );
  assert.ok(
    componentSource.includes('id="apply-actions-disabled-reason"'),
    'Disabled reason container must exist in the UI near the button'
  );

  // Contract 5: Explicit diagnostic when user checked suggestions but 0 valid actions
  assert.ok(
    componentSource.includes('id="apply-actions-diagnostic-warning"'),
    'Diagnostic warning container must exist in the UI'
  );

  // Contract 6: All issues clearly displayed on apply failure
  assert.ok(
    componentSource.includes('id="apply-actions-issues-panel"'),
    'Apply issues list panel must exist in the UI'
  );
  assert.ok(componentSource.includes('{actionEligibility.diagnosticWarning && ('), 'Informational warning must show even when Apply is enabled');
  for (const field of ['selectedFindingCount', 'executableActionCount', 'previewSuccess', 'previewIssues']) {
    assert.ok(componentSource.includes(`actionEligibility.${field}`), `UI must expose ${field}`);
  }
  const selectAll = componentSource.slice(componentSource.indexOf('const handleSelectAllActionable'), componentSource.indexOf('const handleDeselectAllActionable'));
  assert.ok(selectAll.includes('if (f.action)') && selectAll.includes('if (m.action)'), 'Select all must select actionable findings only');

  console.log('✓ Test 6 passed: ATPUnitMappingManager adheres to all UX and diagnostic contracts');
}

console.log('-------------------------------------------------------------');
console.log('ALL REGRESSION TESTS COMPLETED SUCCESSFULLY.');
