import { ALIGNMENT_PRIORITY, applyMinimalAlignment, mappingCoverage, mappingActionKind, isMappingActionAutomatic, hasTeacherMaterialSupport, suggestMappingCopyedit, buildMappingPedagogicalReport, type AlignmentAction, type AlignmentProposal } from '../src/services/mappingAlignmentService';
import type { AnalyzeATPUnitMappingServerParams, MappingAnalysisResult } from './mappingAnalysis';
import { getMappingAtpTpIds, deriveMappingAtpIds } from '../src/services/atpMappingLineageService';
import {normalizeStep07SourceEvidence} from '../src/services/step07AutoExecutionPolicy';

/** AI owns semantic proposals; the server derives impact from real candidate data, not AI counts. */
export function attachMinimalAlignment(raw: any, params: AnalyzeATPUnitMappingServerParams, result: MappingAnalysisResult): MappingAnalysisResult {
  const { currentMapping: mapping, atpData: atp, tpData: tp } = params;
  const before = mappingCoverage(mapping.units, atp, tp);
  const proposals: AlignmentProposal[] = [];
  // Accept the flat prompt schema and the existing UI-shaped {action: ...} envelope.
  // Canonical IDs and curriculum text remain immutable. Scoped Step07 source
  // citations are repaired below; this preview never grants semantic authority.
  const actions: any[] = (Array.isArray(raw?.alignmentProposals) ? raw.alignmentProposals.slice(0, 200) : []).map((candidate: any) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return { contractIssue: 'PROPOSAL_SHAPE_INVALID: proposal harus berupa object.' };
    if (!('action' in candidate)) return candidate;
    if (!candidate.action || typeof candidate.action !== 'object' || Array.isArray(candidate.action)) return { ...candidate, contractIssue: 'ACTION_SHAPE_INVALID: action harus berupa object.' };
    const merged = { ...candidate, ...candidate.action };
    for (const key of ['type', 'targetUnitId', 'targetMaterialId', 'sourceUnitId', 'linkedTpIds', 'before', 'after', 'materialOrder', 'reason', 'evidence', 'replaceTpIds']) {
      if (candidate[key] !== undefined && candidate.action[key] !== undefined && JSON.stringify(candidate[key]) !== JSON.stringify(candidate.action[key])) {
        merged.contractIssue = `ACTION_ENVELOPE_CONFLICT: field '${key}' berbeda antara proposal dan action.`;
      }
    }
    return merged;
  });
  const seen = new Set<string>();
  for (const review of Array.isArray(raw?.materialReviews) ? raw.materialReviews.slice(0,200) : []) {
    const material=mapping.units.find(unit=>unit.id===review?.unitId)?.materials.find(material=>material.id===review?.materialId);
    for (const [index,candidate] of (Array.isArray(review?.candidates)?review.candidates.slice(0,20):[]).entries()) actions.push({
      id:`review-${review.materialId}-${index}`,type:'LINK_TP',targetUnitId:review.unitId,targetMaterialId:review.materialId,before:material?.title,
      linkedTpIds:candidate?.tpIds,reason:candidate?.reason,evidence:candidate?.evidence,
      contractIssue: Array.isArray(candidate?.missingEvidence) && candidate.missingEvidence.length ? `NEEDS_REVIEW: ${candidate.missingEvidence.join('; ')}` : undefined,
    });
  }
  for (const unit of mapping.units) for (const material of unit.materials) {
    const parents = deriveMappingAtpIds(material.linkedTpIds, atp, tp);
    if (hasTeacherMaterialSupport(unit, material, tp) && !parents.issues.length &&
      (parents.atpItemIds.length !== material.linkedAtpItemIds.length || parents.atpItemIds.some(id => !material.linkedAtpItemIds.includes(id))) &&
      !actions.some(a => a.targetMaterialId === material.id)) actions.push({id:`repair-parent-${material.id}`,type:'LINK_TP',targetUnitId:unit.id,targetMaterialId:material.id,
        before:material.title,linkedTpIds:material.linkedTpIds,reason:'Pulihkan hanya ATP induk dari TP yang telah disetujui guru; substansi, judul dan TP tetap.',
        evidence:material.linkedTpIds.map(tpId=>({tpId,tpQuote:tp.items.find(t=>t.id===tpId)!.statement,materialQuote:material.title}))});
  }
  for (const unit of mapping.units) for (const entity of [unit, ...unit.materials]) {
    const materialId = entity === unit ? undefined : entity.id;
    const after = suggestMappingCopyedit(entity.title);
    if (after !== entity.title && !actions.some(a => a.targetUnitId === unit.id && a.targetMaterialId === materialId && ['EDIT_UNIT_TITLE','EDIT_MATERIAL'].includes(a.type))) {
      actions.push({ id: `copyedit-${unit.id}-${entity.id}`, type: materialId ? 'EDIT_MATERIAL' : 'EDIT_UNIT_TITLE', targetUnitId: unit.id, targetMaterialId: materialId,
        linkedTpIds: entity.linkedTpIds, before: entity.title, after, reason: 'Perbaikan ejaan/spasi/kapital awal deterministik; kompetensi dan cakupan tetap.', evidence: [] });
    }
  }
  for (const candidate of actions) {
    if (!candidate || typeof candidate !== 'object') continue;
    const action: AlignmentAction = {
      id: typeof candidate.id === 'string' ? candidate.id : '', type: candidate.type,
      replaceTpIds:candidate.replaceTpIds===true,
      targetUnitId: typeof candidate.targetUnitId === 'string' ? candidate.targetUnitId : '',
      targetMaterialId: typeof candidate.targetMaterialId === 'string' ? candidate.targetMaterialId : undefined,
      sourceUnitId: typeof candidate.sourceUnitId === 'string' ? candidate.sourceUnitId : undefined,
      linkedTpIds: Array.isArray(candidate.linkedTpIds) && candidate.linkedTpIds.every((id: unknown) => typeof id === 'string') ? candidate.linkedTpIds : [],
      before: typeof candidate.before === 'string' ? candidate.before : undefined,
      after: typeof candidate.after === 'string' ? candidate.after : undefined,
      materialOrder: Array.isArray(candidate.materialOrder) && candidate.materialOrder.every((id: unknown) => typeof id === 'string') ? candidate.materialOrder : undefined,
      reason: typeof candidate.reason === 'string' ? candidate.reason : '', evidence: candidate.evidence,
    };
    const sourceRepair=params.step07Auto?.scope==='STEP07_AUTO_REPAIR'?normalizeStep07SourceEvidence(action,mapping.units,tp):undefined;
    if(sourceRepair)Object.assign(action,sourceRepair.action);
    const preview = applyMinimalAlignment(mapping.units, [action], atp, tp);
    const duplicate = seen.has(action.id) || actions.filter(a => a?.id === action.id).length > 1;
    const unchanged = preview.success && JSON.stringify(preview.nextUnits) === JSON.stringify(mapping.units);
    const validationIssues = [candidate.contractIssue, duplicate ? 'PROPOSAL_ID_DUPLICATE: ID proposal duplikat; analisis ulang.' : undefined,
      ...preview.issues].filter((issue): issue is string => typeof issue === 'string' && !!issue);
    const validationStatus = validationIssues.length ? 'REJECTED' : unchanged ? 'ALREADY_APPLIED' : 'READY';
    const changeKind = mappingActionKind(action, mapping.units);
    const automatic = isMappingActionAutomatic(action, mapping.units, tp);
    seen.add(action.id);
    proposals.push({ id: `minimal-${proposals.length}-${action.id}`,actionId:action.id,sourceEvidenceRepairs:sourceRepair?.notes, targetUnitId: action.targetUnitId,
      targetMaterialId: action.targetMaterialId, before: typeof action.before === 'string' ? action.before : '',
      after: action.type === 'RESTRUCTURE_UNIT' ? JSON.stringify(action.materialOrder || []) : typeof action.after === 'string' ? action.after : typeof action.before === 'string' ? action.before : '',
      tpIds: Array.isArray(action.linkedTpIds) ? action.linkedTpIds : [],
      validationStatus, validationIssues, changeKind, approval: automatic ? 'AUTOMATIC' : 'TEACHER', executionClass:automatic?'AUTO_APPLY':'NEEDS_APPROVAL', proposalType: typeof action.type === 'string' ? action.type : undefined,
      reason: validationIssues.length ? [action.reason,...validationIssues].filter(Boolean).join('; ') : unchanged ? 'Proposal sudah diterapkan; tidak ada perubahan tambahan.' : action.reason,
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
  return { ...result, alignmentProposals: proposals, gapFindings: gaps, pedagogicalFindings: buildMappingPedagogicalReport(mapping.units, atp, tp) };
}
