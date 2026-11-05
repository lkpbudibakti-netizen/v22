import type { ATPData, TPData, ATPUnitMapping } from '../types';
import { deriveMappingAtpIds } from './atpMappingLineageService';
import { validateATPUnitMappingCanonical } from './atpUnitMappingValidationService';
import { checkMappingSemanticEvidence } from '../../server/mappingSemanticEvidence';

export const ALIGNMENT_PRIORITY = ['LINK_TP', 'EDIT_MATERIAL', 'ADD_MATERIAL', 'MOVE_MATERIAL', 'RESTRUCTURE_UNIT'] as const;
export type AlignmentActionType = typeof ALIGNMENT_PRIORITY[number];
export interface AlignmentAction {
  id: string;
  type: AlignmentActionType;
  targetUnitId: string;
  targetMaterialId?: string;
  sourceUnitId?: string;
  linkedTpIds: string[];
  before?: string;
  after?: string;
  materialOrder?: string[];
  reason: string;
  evidence: { tpId: string; tpQuote: string; materialQuote: string }[];
}
export interface AlignmentProposal {
  id: string;
  action?: AlignmentAction;
  validationStatus?: 'READY' | 'REJECTED' | 'ALREADY_APPLIED';
  validationIssues?: string[];
  proposalType?: string;
  reason: string;
  before: string;
  after: string;
  targetUnitId: string;
  targetMaterialId?: string;
  tpIds: string[];
  impact: { newlyCoveredTpIds: string[]; newlyMappedAtpIds: string[] };
}

export function alignmentProposalStatus(proposal: AlignmentProposal): 'READY' | 'REJECTED' | 'ALREADY_APPLIED' {
  if (proposal.validationStatus === 'ALREADY_APPLIED') return 'ALREADY_APPLIED';
  if (proposal.action && proposal.validationStatus !== 'REJECTED') return 'READY';
  return 'REJECTED';
}

export function alignmentProposalDiagnostics(proposals: AlignmentProposal[]) {
  const reasons = new Map<string, number>();
  for (const proposal of proposals.filter(p => alignmentProposalStatus(p) === 'REJECTED')) {
    for (const issue of proposal.validationIssues?.length ? proposal.validationIssues : [proposal.reason]) reasons.set(issue, (reasons.get(issue) || 0) + 1);
  }
  return { ready: proposals.filter(p => alignmentProposalStatus(p) === 'READY').length,
    rejected: proposals.filter(p => alignmentProposalStatus(p) === 'REJECTED').length,
    alreadyApplied: proposals.filter(p => alignmentProposalStatus(p) === 'ALREADY_APPLIED').length,
    rejectionReasons: [...reasons].map(([reason, count]) => ({ reason, count })) };
}

/** Used by the checkbox and regression; rejected IDs cannot enter the selection. */
export function toggleAlignmentProposalSelection(proposals: AlignmentProposal[], previous: Set<string>, id: string) {
  const ready = new Set(proposals.filter(p => alignmentProposalStatus(p) === 'READY').map(p => p.id));
  const next = new Set([...previous].filter(selected => ready.has(selected)));
  if (!ready.has(id)) return next;
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}

export function mappingCoverage(units: ATPUnitMapping[], atp: ATPData, tp: TPData) {
  return validateATPUnitMappingCanonical({ id: 'alignment', academicSettingId: '', atpId: atp.id, units, updatedAt: '' }, atp, tp);
}

/** Mutate only a cloned draft, then validate the entire candidate. Existing incomplete data stays visible. */
export function applyMinimalAlignment(units: ATPUnitMapping[], actions: AlignmentAction[], atp: ATPData, tp: TPData) {
  const next = structuredClone(units);
  const issues: string[] = [];
  const fail = (reason: string) => { issues.push(reason); };
  const usedMaterials = new Set<string>();
  const usedIds = new Set<string>();
  for (const action of [...actions].sort((a, b) => ALIGNMENT_PRIORITY.indexOf(a?.type) - ALIGNMENT_PRIORITY.indexOf(b?.type))) {
    if (!action || !ALIGNMENT_PRIORITY.includes(action.type)) { fail('Tipe proposal tidak dikenal.'); continue; }
    if (!action.id || usedIds.has(action.id)) { fail('ID proposal kosong/duplikat.'); continue; }
    usedIds.add(action.id);
    const target = next.find(u => u.id === action.targetUnitId);
    const source = next.find(u => u.id === (action.sourceUnitId || action.targetUnitId));
    const original = units.find(u => u.id === (action.sourceUnitId || action.targetUnitId))?.materials.find(m => m.id === action.targetMaterialId);
    const material = source?.materials.find(m => m.id === action.targetMaterialId);
    if (!target || !source) { fail('ID Bab target/sumber tidak ditemukan.'); continue; }
    if (typeof action.reason !== 'string' || !action.reason.trim()) { fail('Alasan pedagogis wajib tersedia.'); continue; }
    if (!Array.isArray(action.linkedTpIds) || !action.linkedTpIds.length || new Set(action.linkedTpIds).size !== action.linkedTpIds.length) { fail('Subset TP wajib eksplisit, tidak kosong/duplikat.'); continue; }
    const parents = deriveMappingAtpIds(action.linkedTpIds, atp, tp);
    if (parents.issues.length) { issues.push(...parents.issues); continue; }
    const alreadyMoved = action.type === 'MOVE_MATERIAL' && !material && target.materials.find(m => m.id === action.targetMaterialId);
    if (alreadyMoved && alreadyMoved.title === action.before && action.linkedTpIds.every(id => alreadyMoved.linkedTpIds.includes(id))) continue;
    if (action.type === 'EDIT_MATERIAL' && material?.title === action.after && action.linkedTpIds.every(id => material.linkedTpIds.includes(id))) continue;
    const title = action.type === 'EDIT_MATERIAL' || action.type === 'ADD_MATERIAL' ? action.after : material?.title;
    if (action.type !== 'RESTRUCTURE_UNIT') {
      if (typeof title !== 'string' || !title.trim()) { fail('Judul materi belum tersedia.'); continue; }
      if (action.type !== 'ADD_MATERIAL' && (!original || !material)) { fail('ID materi sumber tidak ditemukan.'); continue; }
      if (action.type !== 'ADD_MATERIAL' && action.before !== original!.title) { fail('BEFORE_MISMATCH: materi telah berubah; analisis ulang.'); continue; }
      if (action.targetMaterialId && usedMaterials.has(action.targetMaterialId)) { fail('Proposal bertentangan untuk materi yang sama; pilih satu alternatif.'); continue; }
      if (action.targetMaterialId) usedMaterials.add(action.targetMaterialId);
      for (const id of action.linkedTpIds) {
        const objective = tp.items.find(t => t.id === id)!;
        const evidence = Array.isArray(action.evidence) ? action.evidence.find(e => e?.tpId === id) : undefined;
        const sourceText = action.type === 'ADD_MATERIAL' ? title : original!.title;
        if (typeof evidence?.tpQuote !== 'string' || !evidence.tpQuote.trim() || !objective.statement.includes(evidence.tpQuote) ||
            typeof evidence.materialQuote !== 'string' || !evidence.materialQuote.trim() || !sourceText.includes(evidence.materialQuote)) {
          fail(`EVIDENCE_MISSING: kutipan sumber materi dan TP '${id}' harus dapat diverifikasi secara exact.`);
        } else if (evidence.tpQuote.trim().length < Math.min(12, objective.statement.trim().length) || evidence.materialQuote.trim().length < Math.min(8, sourceText.trim().length)) {
          fail(`EVIDENCE_TOO_SHORT: kutipan TP '${id}' dan materi harus memuat substansi sumber, bukan satu karakter/kata generik.`);
        }
        if (checkMappingSemanticEvidence({ label: title, tpItems: [objective] }).hardConflict) fail(`HARD_CONFLICT: materi berlawanan dengan TP '${id}'.`);
      }
      if (action.type === 'EDIT_MATERIAL') {
        const words = original!.title.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
        const after = new Set(title.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
        if (words.filter(word => after.has(word)).length < Math.ceil(words.length * .6)) fail('EDIT_TOO_BROAD: revisi harus mempertahankan sebagian besar redaksi asli.');
      }
      if (issues.length) continue;
      if (action.type === 'ADD_MATERIAL') {
        const existing = target.materials.find(m => m.title.trim().toLowerCase() === title.trim().toLowerCase());
        if (existing && (!action.linkedTpIds.every(id => existing.linkedTpIds.includes(id)))) { fail('DUPLICATE_MATERIAL: gunakan LINK_TP pada materi existing.'); continue; }
        if (!existing && next.some(u => u.materials.some(m => m.id === `alignment-${action.id}`))) { fail('ID materi baru sudah dipakai; analisis ulang.'); continue; }
        if (!existing) target.materials.push({ id: `alignment-${action.id}`, title, order: Math.max(0, ...target.materials.map(m => m.order)) + 1,
          linkedTpIds: [...action.linkedTpIds], linkedAtpItemIds: parents.atpItemIds });
      } else {
        if (action.type === 'MOVE_MATERIAL') {
          if (source.id === target.id) { fail('MOVE_MATERIAL memerlukan Bab tujuan berbeda.'); continue; }
          if (target.materials.some(m => m.id === material!.id || m.title === material!.title)) { fail('Materi tujuan duplikat.'); continue; }
          source.materials = source.materials.filter(m => m.id !== material!.id);
          target.materials.push(material!);
          material!.order = Math.max(0, ...target.materials.filter(m => m.id !== material!.id).map(m => m.order)) + 1;
        }
        if (action.type === 'EDIT_MATERIAL') material!.title = title;
        material!.linkedTpIds = [...new Set([...material!.linkedTpIds, ...action.linkedTpIds])];
        const derived = deriveMappingAtpIds(material!.linkedTpIds, atp, tp);
        issues.push(...derived.issues);
        material!.linkedAtpItemIds = derived.atpItemIds;
      }
    } else {
      // The immutable Bab contract permits only regrouping the material sequence inside an existing Bab.
      if (action.linkedTpIds.some(id => !target.materials.some(m => m.linkedTpIds.includes(id)))) {
        fail('RESTRUCTURE_UNIT tidak boleh mengklaim coverage baru tanpa materi pendukung; gunakan LINK_TP lebih dahulu.'); continue;
      }
      const ids = action.materialOrder;
      if (!Array.isArray(ids) || ids.length !== target.materials.length || new Set(ids).size !== ids.length || ids.some(id => !target.materials.some(m => m.id === id))) {
        fail('RESTRUCTURE_UNIT hanya boleh mengurutkan seluruh ID materi existing; Bab/isi tidak boleh diganti.'); continue;
      }
      if (JSON.stringify(target.materials.map(m => m.id)) === JSON.stringify(ids)) continue;
      if (action.before !== JSON.stringify(units.find(u => u.id === target.id)!.materials.map(m => m.id))) { fail('BEFORE_MISMATCH: urutan materi berubah.'); continue; }
      target.materials = ids.map((id, index) => ({ ...target.materials.find(m => m.id === id)!, order: index + 1 }));
    }
    // Preserve unrelated declared lineage; movement may remove only lineage supported by the moved material.
    for (const unit of new Set([source, target])) {
      const moved = action.type === 'MOVE_MATERIAL' && unit.id === source.id;
      const declaredTp = moved ? unit.linkedTpIds.filter(id => !material!.linkedTpIds.includes(id)) : unit.linkedTpIds;
      unit.linkedTpIds = [...new Set([...declaredTp, ...unit.materials.flatMap(m => m.linkedTpIds)])];
      const derived = deriveMappingAtpIds(unit.linkedTpIds, atp, tp);
      issues.push(...derived.issues);
      unit.linkedAtpItemIds = [...new Set([...(moved ? unit.linkedAtpItemIds.filter(id => !material!.linkedAtpItemIds.includes(id)) : unit.linkedAtpItemIds), ...derived.atpItemIds])];
    }
  }
  const before = mappingCoverage(units, atp, tp), coverage = mappingCoverage(next, atp, tp);
  if (!coverage.isValid) issues.push(...coverage.issues);
  for (const gap of coverage.materialCoverageGaps) {
    const previous = before.materialCoverageGaps.find(g => g.unitId === gap.unitId);
    if (gap.tpIds.some(id => !previous?.tpIds.includes(id)) || gap.atpItemIds.some(id => !previous?.atpItemIds.includes(id))) {
      fail(`SOURCE_LINEAGE_MISSING: perubahan menambah gap dukungan materi pada Bab '${gap.unitId}'.`);
    }
  }
  if (coverage.uncoveredTpIds.some(id => !before.uncoveredTpIds.includes(id)) || coverage.unmappedAtpIds.some(id => !before.unmappedAtpIds.includes(id))) fail('COVERAGE_REGRESSION: perubahan menghilangkan cakupan canonical.');
  return issues.length ? { success: false, issues: [...new Set(issues)] } : { success: true, issues: [], nextUnits: next, rollbackUnits: structuredClone(units), coverage };
}
