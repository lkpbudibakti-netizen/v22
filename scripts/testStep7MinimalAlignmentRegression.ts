import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { parseBabMateriXlsx } from '../src/services/atpUnitMappingImportService';
import { sanitizeMappingAnalysisResult, buildMappingAnalysisPrompt } from '../server/mappingAnalysis';
import { applyMinimalAlignment, mappingCoverage, type AlignmentAction } from '../src/services/mappingAlignmentService';
import { applyATPMappingActions, rollbackATPMappingActions, computeMappingFingerprint } from '../src/services/atpMappingActionApplyService';
import { extractSelectedMappingActions, resolveApplyActionsEligibility } from '../src/services/atpApplyActionEligibilityService';

const tp: any = { id: 'tp', updatedAt: 'now', items: Array.from({ length: 5 }, (_, i) => ({ id: 't'+i, code: 'TP'+i,
  statement: ['Melempar dan menangkap bola secara manipulatif.', 'Merawat kebersihan tubuh setelah bermain.', 'Menjaga keselamatan diri ketika bermain.', 'Membiasakan hidup aktif dan berolahraga.', 'Memilih makanan sehat dan bergizi.'][i] })) };
const atp: any = { id: 'atp', updatedAt: 'now', items: [
  { id: 'a1', stepNumber: 1, focus: 'Gerak dan keselamatan', linkedTpIds: ['t0', 't1', 't2'] },
  { id: 'a2', stepNumber: 2, focus: 'Hidup aktif dan sehat', linkedTpIds: ['t3', 't4'] },
] };
const titles = ['Lempar tangkap bola', 'Kebersihan tubuh', ...Array.from({ length: 8 }, (_, i) => 'Materi guru A '+i),
  'Hidup aktif setiap hari', ...Array.from({ length: 8 }, (_, i) => 'Materi guru B '+i)];
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(titles.map((title, index) => ({ babOrder: index < 10 ? 1 : 2,
  babTitle: index < 10 ? 'Bab Gerak dan Perawatan' : 'Bab Hidup Sehat', materialOrder: index < 10 ? index+1 : index-9, materialTitle: title }))), 'BAB_MATERI');
const imported = parseBabMateriXlsx(XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }));
assert(imported.success);
const mapping: any = { id: 'mapping', academicSettingId: 'year', atpId: atp.id, units: imported.units, updatedAt: 'now' };
const params = { tpData: tp, atpData: atp, currentMapping: mapping };
const pristine = JSON.stringify(params);
const before = mappingCoverage(mapping.units, atp, tp);
assert.equal(before.unmappedAtpIds.length, 2); assert.equal(before.uncoveredTpIds.length, 5);
const initial = sanitizeMappingAnalysisResult({}, params);
assert.equal(initial.materialFindings.filter(m => m.status === 'MANUAL_REVIEW').length, 19);
assert.equal(initial.gapFindings?.length, 26); // 2 ATP + 5 TP + 19 materials
assert(initial.gapFindings?.every(g => g.reason && g.id));
assert(buildMappingAnalysisPrompt(params).includes(JSON.stringify(tp.items)), 'All TP, including orphans, must reach semantic analysis');
const [u1, u2] = mapping.units;
function action(type: AlignmentAction['type'], unit: any, material: any, tpId: string, extra: any = {}): AlignmentAction {
  return { id: type+'-'+tpId, type, targetUnitId: unit.id, targetMaterialId: material?.id,
    linkedTpIds: [tpId], before: material?.title, reason: 'Hubungan pedagogis relevan; perubahan lebih kecil diprioritaskan.',
    evidence: [{ tpId, tpQuote: tp.items.find((t: any) => t.id === tpId).statement, materialQuote: material?.title || extra.after }], ...extra };
}
const link = action('LINK_TP', u1, u1.materials[0], 't0');
const edit = action('EDIT_MATERIAL', u1, u1.materials[1], 't1', { after: 'Kebersihan tubuh setelah bermain' });
const add = action('ADD_MATERIAL', u1, undefined, 't2', { after: 'Keselamatan diri saat bermain' });
const move = action('MOVE_MATERIAL', u1, u2.materials[0], 't3', { sourceUnitId: u2.id });
const eat = action('ADD_MATERIAL', u2, undefined, 't4', { after: 'Makanan sehat dan bergizi' });
const raw: any = { alignmentProposals: [link, edit, add, move, eat] };
const analyzed = sanitizeMappingAnalysisResult(raw, params);
assert.equal(analyzed.alignmentProposals?.filter(p => p.action).length, 5, JSON.stringify(analyzed.alignmentProposals));
assert(analyzed.alignmentProposals?.every(p => p.reason && p.impact));
// Partial approval repairs one material while the other 18 unresolved materials remain visible.
const selected = extractSelectedMappingActions(analyzed as any, new Set([analyzed.alignmentProposals![0].id]));
const fp = computeMappingFingerprint(mapping.units, atp, tp);
const eligibility = resolveApplyActionsEligibility({ selectedActions: selected, selectedCount: 1, units: mapping.units, atp, tp, expectedFingerprint: fp, currentFingerprint: fp });
assert(eligibility.canApply, eligibility.issues.join('; '));
const partial = applyATPMappingActions({ selectedActions: selected, units: mapping.units, atp, tp, expectedFingerprint: fp, currentFingerprint: fp });
assert(partial.success, partial.issues.join('; '));
assert.equal(mappingCoverage(partial.nextUnits!, atp, tp).uncoveredTpIds.length, 4);
assert.deepEqual(partial.rollbackUnits, mapping.units);
const all = applyMinimalAlignment(mapping.units, [link, edit, add, move, eat], atp, tp);
assert(all.success, all.issues.join('; ')); assert.equal(all.coverage!.uncoveredTpIds.length, 0);
assert.equal(all.coverage!.unmappedAtpIds.length, 0);
assert.equal(all.nextUnits![0].materials[1].title, edit.after);
assert(all.nextUnits![0].materials.some(m => m.id === move.targetMaterialId));
assert(!all.nextUnits![1].materials.some(m => m.id === move.targetMaterialId));
assert.deepEqual(all.nextUnits!.map(u => [u.id, u.title, u.order]), mapping.units.map((u: any) => [u.id, u.title, u.order]));
// Untouched imported values are byte-for-byte unchanged.
assert.deepEqual(all.nextUnits![0].materials.slice(2, 10), mapping.units[0].materials.slice(2));
const reorder: AlignmentAction = { ...link, id: 'reorder', type: 'RESTRUCTURE_UNIT', targetMaterialId: undefined,
  before: JSON.stringify(all.nextUnits![0].materials.map(m => m.id)), materialOrder: all.nextUnits![0].materials.map(m => m.id).reverse() };
const ordered = applyMinimalAlignment(all.nextUnits!, [reorder], atp, tp);
assert(ordered.success, ordered.issues.join('; '));
assert.deepEqual(ordered.nextUnits![0].materials.map(m => m.id), reorder.materialOrder);
const rerun = sanitizeMappingAnalysisResult(raw, { ...params, currentMapping: { ...mapping, units: all.nextUnits } });
assert(rerun.alignmentProposals?.every(p => !p.action));
assert.equal(rerun.materialFindings.filter(m => m.status === 'MANUAL_REVIEW').length, 16, 'Approved lineage must survive reanalysis despite low lexical overlap');
const repeated = applyMinimalAlignment(all.nextUnits!, [link, edit, add, move, eat], atp, tp);
assert(repeated.success, repeated.issues.join('; ')); assert.deepEqual(repeated.nextUnits, all.nextUnits);
const stale = applyATPMappingActions({ units: partial.nextUnits!, atp, tp, selectedActions: [link], expectedFingerprint: fp, currentFingerprint: fp });
assert(!stale.success, 'Recompute real fingerprint, never trust caller-supplied currentFingerprint');
const rollback = rollbackATPMappingActions(all.nextUnits!, all.rollbackUnits!, computeMappingFingerprint(all.nextUnits!, atp, tp), atp, tp);
assert(rollback.success); assert.deepEqual(rollback.nextUnits, mapping.units);
assert(!rollbackATPMappingActions(partial.nextUnits!, all.rollbackUnits!, computeMappingFingerprint(all.nextUnits!, atp, tp), atp, tp).success);
const invalid = { ...edit, id: 'bad', before: 'not the original' };
const atomic = applyMinimalAlignment(mapping.units, [link, invalid], atp, tp);
assert(!atomic.success); assert.equal(atomic.nextUnits, undefined);
assert(!applyMinimalAlignment(mapping.units, [link, { ...link, id: 'duplicate' }], atp, tp).success);
assert(!applyMinimalAlignment(mapping.units, [{ ...link, linkedTpIds: ['fake'] }], atp, tp).success);
assert(!applyMinimalAlignment(mapping.units, [{ ...link, evidence: [] }], atp, tp).success);
assert(!applyMinimalAlignment(mapping.units, [{ ...edit, after: 'Topik sepenuhnya berbeda' }], atp, tp).success);
assert(!applyMinimalAlignment(mapping.units, [{ ...reorder, targetUnitId: 'unknown' }], atp, tp).success);
const conflictUnits = structuredClone(mapping.units);
conflictUnits[0].materials[0].title = 'Gerak lokomotor';
const conflictAction = { ...link, before: 'Gerak lokomotor', evidence: [{ ...link.evidence[0], materialQuote: 'Gerak lokomotor' }] };
assert(applyMinimalAlignment(conflictUnits, [conflictAction], atp, tp).issues.some(issue => issue.includes('HARD_CONFLICT')));
const malformed = sanitizeMappingAnalysisResult({ alignmentProposals: [null, {}, { id: 'bad-object', type: 'LINK_TP', targetUnitId: {}, before: {}, linkedTpIds: [null] }] }, params);
assert(malformed.alignmentProposals?.every(p => !p.action));
const duplicateProposals = sanitizeMappingAnalysisResult({ alignmentProposals: [link, link] }, params);
assert(duplicateProposals.alignmentProposals?.every(p => !p.action));
const noEvidence = sanitizeMappingAnalysisResult({ alignmentProposals: [{ ...link, evidence: [] }] }, params);
assert(noEvidence.gapFindings?.find(g => g.kind === 'TP' && g.id === 't0')?.reason.includes('EVIDENCE_MISSING'));
assert.equal(mappingCoverage(partial.nextUnits!, atp, tp).isComplete, false, 'Partial progress must never clear Step 8 readiness gaps');
const orphanTp = structuredClone(tp); orphanTp.items.push({ id: 'orphan', statement: 'TP tanpa induk ATP' });
const orphanAnalysis = sanitizeMappingAnalysisResult({}, { ...params, tpData: orphanTp });
assert(orphanAnalysis.gapFindings?.some(g => g.kind === 'TP' && g.id === 'orphan' && g.reason));
assert.equal(JSON.stringify(params), pristine, 'AI analysis/apply must not mutate original imports, TP or ATP');
console.log('PASS: 2 unmapped ATP + 5 uncovered TP + 19 review materials; all five prioritized actions, exact evidence/diffs, Excel preservation, partial approval, atomic rejection, reanalysis, idempotency, rollback snapshot and actual stale guard. Semantic AI responses are fixtures, not live provider proof.');
