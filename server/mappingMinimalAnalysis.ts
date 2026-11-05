import { ALIGNMENT_PRIORITY, applyMinimalAlignment, mappingCoverage, type AlignmentAction, type AlignmentProposal } from '../src/services/mappingAlignmentService';
import type { AnalyzeATPUnitMappingServerParams, MappingAnalysisResult } from './mappingAnalysis';
import { getMappingAtpTpIds, deriveMappingAtpIds } from '../src/services/atpMappingLineageService';

/** AI owns semantic proposals; the server derives impact from real candidate data, not AI counts. */
export function attachMinimalAlignment(raw: any, params: AnalyzeATPUnitMappingServerParams, result: MappingAnalysisResult): MappingAnalysisResult {
  const { currentMapping: mapping, atpData: atp, tpData: tp } = params;
  const before = mappingCoverage(mapping.units, atp, tp);
  const proposals: AlignmentProposal[] = [];
  // Accept the flat prompt schema and the existing UI-shaped {action: ...} envelope.
  // Only representation is normalized; canonical IDs, text and evidence are never repaired.
  const actions: any[] = (Array.isArray(raw?.alignmentProposals) ? raw.alignmentProposals.slice(0, 200) : []).map((candidate: any) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return { contractIssue: 'PROPOSAL_SHAPE_INVALID: proposal harus berupa object.' };
    if (!('action' in candidate)) return candidate;
    if (!candidate.action || typeof candidate.action !== 'object' || Array.isArray(candidate.action)) return { ...candidate, contractIssue: 'ACTION_SHAPE_INVALID: action harus berupa object.' };
    const merged = { ...candidate, ...candidate.action };
    for (const key of ['type', 'targetUnitId', 'targetMaterialId', 'sourceUnitId', 'linkedTpIds', 'before', 'after', 'materialOrder', 'reason', 'evidence']) {
      if (candidate[key] !== undefined && candidate.action[key] !== undefined && JSON.stringify(candidate[key]) !== JSON.stringify(candidate.action[key])) {
        merged.contractIssue = `ACTION_ENVELOPE_CONFLICT: field '${key}' berbeda antara proposal dan action.`;
      }
    }
    return merged;
  });
  const seen = new Set<string>();
  for (const candidate of actions) {
    if (!candidate || typeof candidate !== 'object') continue;
    const action: AlignmentAction = {
      id: typeof candidate.id === 'string' ? candidate.id : '', type: candidate.type,
      targetUnitId: typeof candidate.targetUnitId === 'string' ? candidate.targetUnitId : '',
      targetMaterialId: typeof candidate.targetMaterialId === 'string' ? candidate.targetMaterialId : undefined,
      sourceUnitId: typeof candidate.sourceUnitId === 'string' ? candidate.sourceUnitId : undefined,
      linkedTpIds: Array.isArray(candidate.linkedTpIds) && candidate.linkedTpIds.every((id: unknown) => typeof id === 'string') ? candidate.linkedTpIds : [],
      before: typeof candidate.before === 'string' ? candidate.before : undefined,
      after: typeof candidate.after === 'string' ? candidate.after : undefined,
      materialOrder: Array.isArray(candidate.materialOrder) && candidate.materialOrder.every((id: unknown) => typeof id === 'string') ? candidate.materialOrder : undefined,
      reason: typeof candidate.reason === 'string' ? candidate.reason : '', evidence: candidate.evidence,
    };
    const preview = applyMinimalAlignment(mapping.units, [action], atp, tp);
    const duplicate = seen.has(action.id) || actions.filter(a => a?.id === action.id).length > 1;
    const unchanged = preview.success && JSON.stringify(preview.nextUnits) === JSON.stringify(mapping.units);
    const validationIssues = [candidate.contractIssue, duplicate ? 'PROPOSAL_ID_DUPLICATE: ID proposal duplikat; analisis ulang.' : undefined,
      ...preview.issues].filter((issue): issue is string => typeof issue === 'string' && !!issue);
    const validationStatus = validationIssues.length ? 'REJECTED' : unchanged ? 'ALREADY_APPLIED' : 'READY';
    seen.add(action.id);
    proposals.push({ id: `minimal-${proposals.length}-${action.id}`, targetUnitId: action.targetUnitId,
      targetMaterialId: action.targetMaterialId, before: typeof action.before === 'string' ? action.before : '',
      after: action.type === 'RESTRUCTURE_UNIT' ? JSON.stringify(action.materialOrder || []) : typeof action.after === 'string' ? action.after : typeof action.before === 'string' ? action.before : '',
      tpIds: Array.isArray(action.linkedTpIds) ? action.linkedTpIds : [],
      validationStatus, validationIssues, proposalType: typeof action.type === 'string' ? action.type : undefined,
      reason: validationIssues.length ? validationIssues.join('; ') : unchanged ? 'Proposal sudah diterapkan; tidak ada perubahan tambahan.' : action.reason,
      action: validationStatus === 'READY' ? action : undefined,
      impact: { newlyCoveredTpIds: preview.coverage ? before.uncoveredTpIds.filter(id => !preview.coverage!.uncoveredTpIds.includes(id)) : [],
        newlyMappedAtpIds: preview.coverage ? before.unmappedAtpIds.filter(id => !preview.coverage!.unmappedAtpIds.includes(id)) : [] } });
  }
  // Expose lowest-impact proposal first; do not silently select alternatives or apply anything.
  proposals.sort((a, b) => ALIGNMENT_PRIORITY.indexOf(a.action?.type!) - ALIGNMENT_PRIORITY.indexOf(b.action?.type!));
  const gaps: NonNullable<MappingAnalysisResult['gapFindings']> = [];
  const add = (kind: 'TP' | 'ATP' | 'MATERIAL', id: string) => {
    const matches = proposals.filter(p => p.action && (kind === 'TP' ? p.tpIds.includes(id) : kind === 'ATP'
      ? getMappingAtpTpIds(atp.items.find(a => a.id === id)!).some(tpId => p.tpIds.includes(tpId)) : p.targetMaterialId === id));
    const specific = (Array.isArray(raw?.gapFindings) ? raw.gapFindings : []).find((g: any) => g?.kind === kind && g.id === id);
    const rejected = proposals.filter(p => !p.action && (kind === 'TP' ? p.tpIds.includes(id) : kind === 'MATERIAL' ? p.targetMaterialId === id
      : getMappingAtpTpIds(atp.items.find(a => a.id === id)!).some(tpId => p.tpIds.includes(tpId))));
    const lineageIssues = kind === 'TP' ? deriveMappingAtpIds([id], atp, tp).issues : [];
    gaps.push({ kind, id, proposalIds: matches.map(p => p.id), reason: matches.length
      ? 'Tinjau proposal dan dampak coverage; hanya pilihan yang disetujui diterapkan.'
      : typeof specific?.reason === 'string' && specific.reason.trim() ? specific.reason
      : rejected.length ? rejected.map(p => p.reason).join('; ')
      : lineageIssues.length ? lineageIssues.join('; ')
      : `Tidak ada proposal AI terverifikasi untuk ${kind} '${id}'; diperlukan analisis semantik/keputusan guru, relasi tidak dipaksakan.` });
  };
  before.unmappedAtpIds.forEach(id => add('ATP', id));
  before.uncoveredTpIds.forEach(id => add('TP', id));
  result.materialFindings.filter(m => m.status === 'MANUAL_REVIEW').forEach(m => add('MATERIAL', m.materialId || m.id));
  return { ...result, alignmentProposals: proposals, gapFindings: gaps };
}
