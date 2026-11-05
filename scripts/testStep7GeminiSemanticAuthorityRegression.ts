import assert from 'node:assert/strict';
import { sanitizeMappingAnalysisResult, fallbackAnalyzeMapping } from '../server/mappingAnalysis';
import { checkMappingSemanticEvidence } from '../server/mappingSemanticEvidence';
import { validateAndBuildATPUnitMappings } from '../src/services/atpUnitMappingImportService';
import { applyATPMappingActions, computeMappingFingerprint, type MappingActionItem } from '../src/services/atpMappingActionApplyService';
import { resolveApplyActionsEligibility } from '../src/services/atpApplyActionEligibilityService';
import { validateATPUnitMappingCanonical } from '../src/services/atpUnitMappingValidationService';
import type { TPData, ATPData, ATPUnitMappingData } from '../src/types';

const labels = ['Gerak melempar; menangkap; memukul bola', 'Kebersihan diri; kesehatan',
  'Keselamatan saat bermain', 'non-lokomotor di tempat'];
const tp: TPData = { id: 'tp-pjok', academicSettingId: 'year', updatedAt: '2026-10-18', items: [
  {order: 1, competence: 'Memahami', id: 'manip', code: 'TP1', statement: 'Mengombinasikan keterampilan manipulatif dengan variasi arah dan kekuatan.', contentScope: 'Pola manipulatif' },
  {order: 2, competence: 'Memahami', id: 'sehat', code: 'TP2', statement: 'Membiasakan perawatan tubuh dan perilaku hidup sehat.', contentScope: 'Perawatan tubuh' },
  {order: 3, competence: 'Memahami', id: 'aman', code: 'TP3', statement: 'Mengenali risiko cedera dan meminta bantuan orang dewasa tepercaya.', contentScope: 'Pencegahan bahaya' },
  {order: 4, competence: 'Memahami', id: 'non', code: 'TP4', statement: 'Mempraktikkan gerak non-lokomotor dengan kendali tubuh.', contentScope: 'Keseimbangan postural' },
] };
const atp: ATPData = { id: 'atp-pjok', academicSettingId: 'year', updatedAt: tp.updatedAt,
  items: tp.items.map((item, index) => ({ id: 'a'+index, stepNumber: index+1, focus: 'Fokus pedagogis '+index, linkedTpIds: [item.id] })) };
const imported = validateAndBuildATPUnitMappings(labels.map((label, index) => ({
  babOrder: index+1, babTitle: 'Bab Guru '+(index+1), materialOrder: 1, materialTitle: label,
})));
assert(imported.success);
const mapping: ATPUnitMappingData = { id: 'mapping', academicSettingId: 'year', atpId: atp.id, tpDataId: tp.id,
  updatedAt: tp.updatedAt, units: imported.units! };
const params = { currentMapping: mapping, tpData: tp, atpData: atp };
const before = JSON.stringify(params);
// Provider-shaped fixture, not a live Gemini request. Lexical evidence is deliberately weak.
const gemini = { materialFindings: mapping.units.map((unit, index) => ({
  id: 'gemini-'+index, unitId: unit.id, materialId: unit.materials[0].id, status: 'ALIGNABLE', strength: 'MODERATE',
  reason: 'Gemini menilai materi relevan secara semantik dengan TP yang dipilih.',
  action: { type: 'ALIGN_EXISTING_MATERIAL', targetUnitId: unit.id, targetMaterialId: unit.materials[0].id,
    linkedTpIds: [tp.items[index].id], linkedAtpItemIds: ['AI_PARENT_NOT_AUTHORITY'] },
})) };
const actionsOf = (analysis: ReturnType<typeof sanitizeMappingAnalysisResult>): MappingActionItem[] =>
  [...analysis.atpFindings, ...analysis.materialFindings].flatMap(finding => finding.action ? [{ id: finding.id, ...finding.action }] : []);
for (const [index, label] of labels.entries()) {
  const lexical = checkMappingSemanticEvidence({ label, tpItems: [tp.items[index]] });
  assert.equal(lexical.supported, false, 'Fixture must reproduce low lexical overlap');
  assert(!lexical.hardConflict);
}
const non = checkMappingSemanticEvidence({ label: labels[3], tpItems: [tp.items[3]] });
assert(!non.reason.includes('Domain pembelajaran berbeda'), 'tempat alone must not imply lokomotor');
const analysis = sanitizeMappingAnalysisResult(gemini, params);
assert.equal(analysis.materialFindings.filter(finding => finding.action).length, 4);
assert(analysis.materialFindings.every(finding => finding.status === 'ALIGNABLE'));
assert.deepEqual(analysis.materialFindings.map(finding => finding.supportingAtpItemIds), atp.items.map(item => [item.id]));
const actions = actionsOf(analysis);
const fp = computeMappingFingerprint(mapping.units, atp, tp);
assert(resolveApplyActionsEligibility({ units: mapping.units, selectedActions: actions, selectedCount: actions.length,
  atp, tp, expectedFingerprint: fp, currentFingerprint: fp }).canApply);
const applied = applyATPMappingActions({ units: mapping.units, selectedActions: actions, atp, tp,
  expectedFingerprint: fp, currentFingerprint: fp });
assert(applied.success, applied.issues.join('; '));
const validation = validateATPUnitMappingCanonical({ ...mapping, units: applied.nextUnits! }, atp, tp);
assert(validation.isValid && validation.isComplete, validation.issues.join('; '));
assert.equal(JSON.stringify(params), before);
assert.equal(actionsOf(fallbackAnalyzeMapping(params)).length, 0, 'Without Gemini, weak evidence stays manual');

// A clear, explicit movement-domain contradiction still blocks Gemini and Apply.
const conflictingMapping = structuredClone(mapping);
conflictingMapping.units[3].materials[0].title = 'Gerak lokomotor berpindah';
assert(checkMappingSemanticEvidence({ label: conflictingMapping.units[3].materials[0].title, tpItems: [tp.items[3]] }).hardConflict);
const conflict = sanitizeMappingAnalysisResult(gemini, { ...params, currentMapping: conflictingMapping });
const rejected = conflict.materialFindings.find(finding => finding.unitId === mapping.units[3].id)!;
assert.equal(rejected.status, 'MANUAL_REVIEW'); assert.equal(rejected.action, undefined);
assert(rejected.reason.includes('Konflik domain gerak eksplisit'));
assert(!actionsOf(conflict).some(action => action.targetUnitId === mapping.units[3].id));
assert(actionsOf(conflict).some(action => action.targetUnitId === mapping.units[0].id), 'Other Bab stay actionable');
const conflictingFp = computeMappingFingerprint(conflictingMapping.units, atp, tp);
const rolledBack = applyATPMappingActions({ units: conflictingMapping.units, selectedActions: actions, atp, tp,
  expectedFingerprint: conflictingFp, currentFingerprint: conflictingFp });
assert(!rolledBack.success); assert.equal(rolledBack.nextUnits, undefined);

const invalidIds = structuredClone(gemini); invalidIds.materialFindings[0].action.linkedTpIds = ['UNKNOWN_TP'];
assert.equal(sanitizeMappingAnalysisResult(invalidIds, params).materialFindings[0].status, 'MANUAL_REVIEW');
// Gemini does not bypass material coverage or permit partial application of an affected Bab.
const gapMapping = structuredClone(mapping);
gapMapping.units[0].linkedTpIds = [tp.items[0].id, tp.items[1].id];
gapMapping.units[0].linkedAtpItemIds = [atp.items[0].id, atp.items[1].id];
const gap = sanitizeMappingAnalysisResult(gemini, { ...params, currentMapping: gapMapping });
assert.equal(gap.materialFindings[0].status, 'MANUAL_REVIEW'); assert(!gap.materialFindings[0].action);
assert(gap.materialFindings[0].reason.includes('SOURCE_LINEAGE_MISSING'));
assert.equal(JSON.stringify(params), before);
console.log('PASS: Gemini PJOK throwing/catching/hitting, hygiene/health, safety and non-lokomotor di tempat yield actionable canonical bundles despite low lexical overlap; deterministic fallback stays conservative; hard conflicts, invalid IDs, coverage and atomic rollback remain enforced.');
