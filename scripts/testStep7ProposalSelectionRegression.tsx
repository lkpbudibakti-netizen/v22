import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AlignmentProposalReview } from '../src/components/AlignmentProposalReview';
import { sanitizeMappingAnalysisResult, buildMappingAnalysisPrompt } from '../server/mappingAnalysis';
import { alignmentProposalDiagnostics, mappingCoverage } from '../src/services/mappingAlignmentService';
import { extractSelectedMappingActions, resolveApplyActionsEligibility } from '../src/services/atpApplyActionEligibilityService';
import { applyATPMappingActions, computeMappingFingerprint } from '../src/services/atpMappingActionApplyService';

const tp: any = { id: 'tp', updatedAt: 'now', items: [
  { id: 't1', code: 'TP1', statement: 'Melempar dan menangkap bola secara manipulatif.' },
  { id: 't2', code: 'TP2', statement: 'Merawat kebersihan tubuh setelah bermain.' },
  { id: 'orphan', code: 'TP3', statement: 'TP canonical tanpa induk ATP.' },
] };
const atp: any = { id: 'atp', updatedAt: 'now', items: [
  { id: 'a1', stepNumber: 1, focus: 'Gerak bola', linkedTpIds: ['t1'] },
  { id: 'a2', stepNumber: 2, focus: 'Kesehatan', linkedTpIds: ['t2'] },
] };
const units: any = [{ id: 'u1', title: 'Bab Gerak', order: 1, linkedTpIds: [], linkedAtpItemIds: [], materials: [
  { id: 'm1', title: 'Lempar tangkap bola', order: 1, linkedTpIds: [], linkedAtpItemIds: [] },
  { id: 'conflict', title: 'Gerak lokomotor', order: 2, linkedTpIds: [], linkedAtpItemIds: [] },
] }, { id: 'u2', title: 'Bab Kesehatan', order: 2, linkedTpIds: [], linkedAtpItemIds: [], materials: [] }];
const mapping: any = { id: 'map', academicSettingId: 'year', atpId: atp.id, units, updatedAt: 'now' };
const params = { currentMapping: mapping, tpData: tp, atpData: atp };
const original = JSON.stringify(params);
const link = { id: 'link', type: 'LINK_TP', targetUnitId: 'u1', targetMaterialId: 'm1', linkedTpIds: ['t1'],
  before: 'Lempar tangkap bola', reason: 'Latihan bola mendukung keterampilan manipulatif.',
  evidence: [{ tpId: 't1', tpQuote: tp.items[0].statement, materialQuote: 'Lempar tangkap bola' }] };
const add = { id: 'add', type: 'ADD_MATERIAL', targetUnitId: 'u2', linkedTpIds: ['t2'], after: 'Kebersihan tubuh',
  reason: 'Belum ada materi untuk pembiasaan kebersihan.', evidence: [{ tpId: 't2', tpQuote: tp.items[1].statement, materialQuote: 'Kebersihan tubuh' }] };
const raw = { alignmentProposals: [link,
  { id: 'finding-add', action: add }, // UI-style envelope uses a distinct finding ID; executable ID stays exact.
  { ...link, id: 'bad-id', targetUnitId: 'missing' },
  { ...link, id: 'bad-before', before: 'Judul rekaan AI' },
  { ...link, id: 'bad-evidence', evidence: [{ tpId: 't1', tpQuote: 'parafrase', materialQuote: 'Lempar tangkap bola' }] },
  { ...link, id: 'short', evidence: [{ tpId: 't1', tpQuote: 'Melempar', materialQuote: 'Lempar tangkap bola' }] },
  { ...link, id: 'bad-lineage', linkedTpIds: ['orphan'] },
  { ...link, id: 'hard-conflict', targetMaterialId: 'conflict', before: 'Gerak lokomotor', evidence: [{ tpId: 't1', tpQuote: tp.items[0].statement, materialQuote: 'Gerak lokomotor' }] },
  { id: 'envelope-conflict', targetUnitId: 'u1', action: { ...add, id: 'envelope-conflict', targetUnitId: 'u2' } },
] };
const result = sanitizeMappingAnalysisResult(raw, params);
const proposals = result.alignmentProposals!;
const diagnostic = alignmentProposalDiagnostics(proposals);
assert.equal(diagnostic.ready, 2); assert.equal(diagnostic.rejected, 7); assert.equal(diagnostic.alreadyApplied, 0);
for (const marker of ['EVIDENCE_MISSING', 'EVIDENCE_TOO_SHORT', 'BEFORE_MISMATCH', 'HARD_CONFLICT', 'ACTION_ENVELOPE_CONFLICT', 'ID Bab', 'induk ATP']) {
  assert(diagnostic.rejectionReasons.some(r => r.reason.includes(marker)), marker);
}
assert(proposals.filter(p => p.validationStatus === 'REJECTED').every(p => !p.action && p.validationIssues!.length));
assert(proposals.some(p => p.action?.id === 'add'), 'Wrapped valid action must survive the parser');
assert(buildMappingAnalysisPrompt(params).includes('min(12,'));
assert(buildMappingAnalysisPrompt(params).includes('before LINK_TP/EDIT_MATERIAL/MOVE_MATERIAL'));

let selected = new Set<string>();
const tree = () => AlignmentProposalReview({ proposals, selectedIds: selected, onSelectionChange: ids => { selected = ids; } });
function nodes(element: React.ReactNode): React.ReactElement<any>[] {
  if (!React.isValidElement(element)) return [];
  return [element as React.ReactElement<any>, ...React.Children.toArray((element.props as any).children).flatMap(nodes)];
}
const boxes = () => nodes(tree()).filter(node => node.type === 'input');
assert.equal(boxes().filter(node => !node.props.disabled).length, 2);
assert.equal(boxes().filter(node => node.props.disabled).length, 7);
const html = renderToStaticMarkup(tree());
assert(html.includes('Siap dipilih: 2')); assert(html.includes('Ditolak: 7'));
assert(html.includes('BEFORE_MISMATCH')); assert(html.includes('Alasan validasi proposal'));
// Exercise the rendered checkbox's actual onChange callback, then the same extraction/preview/apply as Step 7.
const linkProposal = proposals.find(p => p.action?.id === 'link')!;
boxes().find(box => box.props['aria-label'] === `Pilih proposal ${linkProposal.id}`)!.props.onChange();
assert.deepEqual([...selected], [linkProposal.id]);
assert(boxes().find(box => box.props['aria-label'] === `Pilih proposal ${linkProposal.id}`)!.props.checked);
const rejected = proposals.find(p => p.validationStatus === 'REJECTED')!;
boxes().find(box => box.props['aria-label'] === `Pilih proposal ${rejected.id}`)!.props.onChange();
assert(!selected.has(rejected.id));
const fp = computeMappingFingerprint(units, atp, tp);
const selectedActions = extractSelectedMappingActions(result, selected);
const eligibility = resolveApplyActionsEligibility({ units, atp, tp, selectedCount: selected.size, selectedActions, expectedFingerprint: fp, currentFingerprint: fp });
assert(eligibility.canApply, eligibility.issues.join('; '));
const applied = applyATPMappingActions({ units, atp, tp, selectedActions, expectedFingerprint: fp, currentFingerprint: fp });
assert(applied.success, applied.issues.join('; '));
assert.deepEqual(applied.nextUnits![1], units[1], 'Unapproved ADD must never modify Bab 2');
assert.equal(mappingCoverage(applied.nextUnits!, atp, tp).uncoveredTpIds.length, 2);
const next = sanitizeMappingAnalysisResult(raw, { ...params, currentMapping: { ...mapping, units: applied.nextUnits } });
assert.equal(next.alignmentProposals!.find(p => p.proposalType === 'LINK_TP' && p.reason.includes('sudah diterapkan'))?.validationStatus, 'ALREADY_APPLIED');
assert.equal(alignmentProposalDiagnostics(next.alignmentProposals!).alreadyApplied, 1);
const stale = resolveApplyActionsEligibility({ units: applied.nextUnits!, atp, tp, selectedCount: 1, selectedActions, expectedFingerprint: fp, currentFingerprint: fp });
assert(!stale.canApply); assert(stale.previewIssues.some(issue => issue.includes('kedaluwarsa')));
assert.equal(extractSelectedMappingActions(result, new Set([rejected.id])).length, 0);
const rejectedOnly = resolveApplyActionsEligibility({ units, atp, tp, selectedCount: 1, selectedActions: [], expectedFingerprint: fp, currentFingerprint: fp });
assert(!rejectedOnly.canApply);
assert.equal(JSON.stringify(params), original);
console.log('PASS: flat/wrapped Gemini contract, READY/REJECTED/ALREADY_APPLIED diagnostics, exact rejection reasons, rendered checkbox handler → selection → extraction → atomic apply → canonical revalidation, partial consent and stale rejection. Fixture provider responses, no live Gemini/browser claim.');
