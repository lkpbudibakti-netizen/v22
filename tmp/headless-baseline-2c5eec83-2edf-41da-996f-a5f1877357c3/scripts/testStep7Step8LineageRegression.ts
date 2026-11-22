import assert from 'node:assert/strict';
import { validateATPUnitMappingCanonical } from '../src/services/atpUnitMappingValidationService';
import { resolveATPUnitMappingReadiness } from '../src/services/atpMappingReadinessService';
import { applyATPMappingActions, computeMappingFingerprint } from '../src/services/atpMappingActionApplyService';
import { assertMeetingSourceLineage, MeetingCoverageError } from '../server/unitMeetingCoverageRepair';
import { fallbackGenerateCanonicalATPUnitMapping } from '../server/curriculumFallback';
import { sanitizeMappingAnalysisResult } from '../server/mappingAnalysis';
import type { ATPData, TPData, ATPUnitMappingData } from '../src/types';

const tp: TPData = { id: 'tp', academicSettingId: 'academic', workflowStatus: 'SIAP', updatedAt: '2026-01-01',
  items: ['Melempar bola', 'Menangkap bola'].map((scope, i) => ({ id: `tp${i}`, code: `TP${i}`, order: i + 1,
    statement: `Mempraktikkan ${scope}`, competence: 'Mempraktikkan', contentScope: scope })) };
const atp: ATPData = { id: 'atp', tpDataId: tp.id, academicSettingId: 'academic', workflowStatus: 'SIAP',
  updatedAt: '2026-01-01', items: [{ id: 'a', stepNumber: 1, focus: 'Melempar dan menangkap bola', linkedTpIds: ['tp0', 'tp1'] }] };
const mapping: ATPUnitMappingData = { id: 'mapping', academicSettingId: 'academic', atpId: atp.id, updatedAt: '2026-01-01',
  units: [{ id: 'teacher-unit', title: 'Bergerak Menggunakan Benda', order: 1,
    linkedTpIds: ['tp0', 'tp1'], linkedAtpItemIds: ['a'], materials: [
      { id: 'teacher-material', title: 'Melempar dan menangkap bola', order: 1, linkedTpIds: ['tp0'], linkedAtpItemIds: ['a'] },
    ] }] };
const before = JSON.stringify(mapping);
const validation = validateATPUnitMappingCanonical(mapping, atp, tp);
assert.equal(validation.isValid, true);
assert.equal(validation.isComplete, false);
assert.deepEqual(validation.materialCoverageGaps[0].tpIds, ['tp1']);
const readiness = resolveATPUnitMappingReadiness(mapping, atp, tp);
assert.equal(readiness.canSaveDraft, true);
assert.equal(readiness.canProceed, false);
assert.throws(() => assertMeetingSourceLineage(mapping.units, tp.items, atp.items),
  (e: unknown) => e instanceof MeetingCoverageError && e.code === 'SOURCE_LINEAGE_MISSING');
const analysis = sanitizeMappingAnalysisResult({ atpFindings: [], materialFindings: [], summary: {} },
  { currentMapping: mapping, atpData: atp, tpData: tp });
const analysisFp = computeMappingFingerprint(mapping.units, atp, tp);
const recommendations = applyATPMappingActions({ units: mapping.units, atp, tp,
  expectedFingerprint: analysisFp, currentFingerprint: analysisFp,
  selectedActions: [...analysis.atpFindings, ...analysis.materialFindings].flatMap(f => f.action ? [{ id: f.id, ...f.action }] : []) });
const proposed = validateATPUnitMappingCanonical({ ...mapping, units: recommendations.nextUnits || mapping.units }, atp, tp);
assert.ok(proposed.isComplete || analysis.materialFindings.some(f =>
  f.reason.includes('SOURCE_LINEAGE_MISSING') && f.reason.includes('tp1')),
  'Recommendations must cover missing TP or explicitly diagnose the unresolved gap');
assert.equal(JSON.stringify(mapping), before);

const fingerprint = computeMappingFingerprint(mapping.units, atp, tp);
const applied = applyATPMappingActions({ units: mapping.units, tp, atp,
  expectedFingerprint: fingerprint, currentFingerprint: fingerprint, selectedActions: [{ id: 'align',
    type: 'ALIGN_EXISTING_MATERIAL', targetUnitId: 'teacher-unit', targetMaterialId: 'teacher-material',
    linkedAtpItemIds: ['a'], linkedTpIds: ['tp0', 'tp1'] }] });
assert.equal(applied.success, true);
const complete = { ...mapping, units: applied.nextUnits! };
assert.equal(resolveATPUnitMappingReadiness(complete, atp, tp).canProceed, true);
assert.doesNotThrow(() => assertMeetingSourceLineage(complete.units, tp.items, atp.items));
assert.deepEqual(complete.units.map(u => [u.id, u.title, u.order, u.materials.map(m => [m.id, m.title, m.order])]),
  mapping.units.map(u => [u.id, u.title, u.order, u.materials.map(m => [m.id, m.title, m.order])]));
assert.equal(resolveATPUnitMappingReadiness(JSON.parse(JSON.stringify(complete)), atp, tp).canProceed, true);

const generated = fallbackGenerateCanonicalATPUnitMapping({ academicSettingId: 'academic', subject: 'PJOK',
  grade: 'Kelas 2', phase: 'A', tpData: tp, atpData: atp, targetUnitCount: 1 });
const fullValidation = validateATPUnitMappingCanonical(generated, atp, tp);
assert.equal(fullValidation.isValid, true, fullValidation.issues.join('; '));
assert.equal(fullValidation.isComplete, true, fullValidation.issues.join('; '));
assert.doesNotThrow(() => assertMeetingSourceLineage(generated.units, tp.items, atp.items));
const missingAtp = structuredClone(complete);
missingAtp.units[0].materials[0].linkedAtpItemIds = [];
assert.equal(resolveATPUnitMappingReadiness(missingAtp, atp, tp).canProceed, false);
const twoAtp = { ...atp, items: [...atp.items, { ...atp.items[0], id: 'a2', stepNumber: 2 }] };
const atpGap = structuredClone(complete);
atpGap.units[0].linkedAtpItemIds.push('a2');
const atpGapValidation = validateATPUnitMappingCanonical(atpGap, twoAtp, tp);
assert.equal(atpGapValidation.isValid, true);
assert.equal(atpGapValidation.isComplete, false);
assert.deepEqual(atpGapValidation.materialCoverageGaps[0].tpIds, []);
assert.deepEqual(atpGapValidation.materialCoverageGaps[0].atpItemIds, ['a2']);
assert.throws(() => assertMeetingSourceLineage(atpGap.units, tp.items, twoAtp.items),
  (e: unknown) => e instanceof MeetingCoverageError && e.code === 'SOURCE_LINEAGE_MISSING');
assert.equal(JSON.stringify(mapping), before);
console.log('PASS: Full generation, manual alignment, draft/reload readiness, and Step 08 source lineage agree.');
