import type { ATPData, TPData, ATPUnitMapping, ATPUnitMappingData } from '../types';
import { computeMappingFingerprint } from './atpMappingActionApplyService';
import { validateATPUnitMappingCanonical } from './atpUnitMappingValidationService';

export interface MappingGenerationPreview {
  candidate: ATPUnitMappingData;
  sourceFingerprint: string;
  targetUnitCount: number;
}

// Reuse identity only for unambiguous, substantively unchanged content/lineage.
const signature = (item: { title: string; linkedTpIds: string[]; linkedAtpItemIds: string[] }) =>
  JSON.stringify([item.title.trim(), [...item.linkedTpIds].sort(), [...item.linkedAtpItemIds].sort()]);

export function prepareMappingGenerationPreview(candidate: ATPUnitMappingData, current: ATPUnitMapping[], atp: ATPData, tp: TPData, targetUnitCount = candidate.units?.length): MappingGenerationPreview {
  assertGeneratedMapping(candidate, atp, tp, targetUnitCount);
  const copy = structuredClone(candidate);
  for (const unit of copy.units) {
    const matches = current.filter(old => signature(old) === signature(unit));
    if (matches.length !== 1 || copy.units.filter(other => signature(other) === signature(unit)).length !== 1) continue;
    const old = matches[0];
    unit.id = old.id;
    for (const material of unit.materials || []) {
      const materials = (old.materials || []).filter(item => signature(item) === signature(material));
      if (materials.length === 1 && unit.materials.filter(item => signature(item) === signature(material)).length === 1) material.id = materials[0].id;
    }
  }
  assertGeneratedMapping(copy, atp, tp, targetUnitCount);
  return { candidate: copy, sourceFingerprint: computeMappingFingerprint(current, atp, tp), targetUnitCount };
}

function assertGeneratedMapping(candidate: ATPUnitMappingData, atp: ATPData, tp: TPData, count: number) {
  if (!Number.isInteger(count) || count < 1 || count > 20 || candidate.units?.length !== count) throw new Error(`Jumlah Bab hasil AI harus tepat ${count}.`);
  if (candidate.atpId !== atp.id || (candidate.tpDataId && candidate.tpDataId !== tp.id)) throw new Error('Sumber ATP/TP hasil penyusunan tidak sesuai konteks saat ini.');
  const result = validateATPUnitMappingCanonical(candidate, atp, tp);
  if (!result.isValid || !result.isComplete) throw new Error(result.issues.join('; ') || 'Cakupan ATP/TP belum lengkap.');
}

/** Revalidate at explicit approval time; no mutation or partial result on failure. */
export function approveMappingGenerationPreview(preview: MappingGenerationPreview, current: ATPUnitMapping[], atp: ATPData, tp: TPData, targetUnitCount = preview.targetUnitCount): ATPUnitMapping[] {
  if (preview.sourceFingerprint !== computeMappingFingerprint(current, atp, tp) || targetUnitCount !== preview.targetUnitCount) throw new Error('Draf, ATP/TP, atau target Bab berubah sejak preview. Susun ulang untuk meninjau hasil terbaru.');
  assertGeneratedMapping(preview.candidate, atp, tp, targetUnitCount);
  return structuredClone(preview.candidate.units);
}
