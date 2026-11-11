import { ATPUnitMappingData, ATPData, TPData, AcademicSetting, Step07ReadinessIssue } from '../types';
import { validateATPUnitMappingCanonical, ATPUnitMappingValidationResult } from './atpUnitMappingValidationService';
import { computeAtpSubstantiveFingerprint, computeTpSubstantiveFingerprint, matchesSubstantiveFingerprint } from './atpMappingActionApplyService';
import { isUpstreamStale } from './workflowEngine';

export interface MappingReadiness {
  canSaveDraft: boolean;
  canProceed: boolean;
  blockers: string[];
  validationResult?: ATPUnitMappingValidationResult;
  repairIssues?:Step07ReadinessIssue[];
}

/** Legacy API: process metadata is no longer a readiness certificate. */
export function finalizeTeacherReviewedMapping(mapping:ATPUnitMappingData,_atp:ATPData,_tp:TPData,_setting?:AcademicSetting):ATPUnitMappingData {return mapping;}

export function proceedWithATPUnitMapping(readiness: MappingReadiness,
  saveDraft: (() => boolean) | undefined, onNextStep: () => void): { proceeded: boolean; issues: string[] } {
  if (!readiness.canProceed) return { proceeded: false, issues: readiness.blockers };
  if (saveDraft && !saveDraft()) return { proceeded: false, issues: ['Pemetaan belum tersimpan. Periksa kesalahan penyimpanan sebelum lanjut Step 08.'] };
  onNextStep();
  return { proceeded: true, issues: [] };
}

/**
 * Resolves readiness and blockers for ATP Unit Mapping (Step 07 -> Step 08 transition).
 * Implements shared production readiness resolver for Step 07 and Step 08:
 * 1. canSaveDraft: True if mapping or academicSetting is present, with matching academicSettingId if both exist.
 * 2. TP & ATP canonical availability & readiness: Must be present, non-empty items, and workflowStatus === 'SIAP'. Empty or unknown status cannot be considered ready.
 * 3. Identity and source relationships consistency (academicSettingId, ATP-TP source identity).
 * 4. Upstream staleness: Only check when source metadata exists on both upstream and downstream. Do not lock mapping just due to metadata timestamp differences or missing source metadata.
 * 5. Mapping validity and completeness via validateATPUnitMappingCanonical.
 * 6. Non-empty units / mapping: canProceed = false if mapping is empty, upstream not ready, or structure incomplete.
 */
export function resolveATPUnitMappingReadiness(
  mapping: ATPUnitMappingData | undefined,
  atp: ATPData | undefined,
  tp: TPData | undefined,
  academicSetting?: AcademicSetting | null,
  options?:{evaluateRepair?:boolean}
): MappingReadiness {
  const blockers: string[] = [];

  // 5. Mapping validity and completeness
  const validationResult = validateATPUnitMappingCanonical(mapping, atp, tp);

  // 1. canSaveDraft check: requires valid lineage
  let canSaveDraft = Boolean(mapping && validationResult.isValid);
  if (mapping && academicSetting && mapping.academicSettingId && academicSetting.id) {
    if (mapping.academicSettingId !== academicSetting.id) {
      canSaveDraft = false;
      blockers.push(`ID Academic Setting pada pemetaan (${mapping.academicSettingId}) tidak sesuai dengan konteks aktif (${academicSetting.id}).`);
    }
  }

  // 2. TP & ATP canonical availability & readiness
  const isTpReady = Boolean(tp && Array.isArray(tp.items) && tp.items.length > 0 && tp.workflowStatus === 'SIAP' && !tp.needsReview);
  const isAtpReady = Boolean(atp && Array.isArray(atp.items) && atp.items.length > 0 && atp.workflowStatus === 'SIAP' && !atp.needsReview);

  if (!isTpReady) {
    blockers.push('Tujuan Pembelajaran (TP) canonical belum berstatus SIAP atau belum lengkap.');
  }

  if (!isAtpReady) {
    blockers.push('Alur Tujuan Pembelajaran (ATP) canonical belum berstatus SIAP atau belum lengkap.');
  }

  // 3. Identity & source relationship consistency
  if (mapping && tp && mapping.academicSettingId && tp.academicSettingId && mapping.academicSettingId !== tp.academicSettingId) {
    blockers.push('Ketiadaan konsistensi academicSettingId antara Pemetaan dan TP.');
  }
  if (mapping && atp && mapping.academicSettingId && atp.academicSettingId && mapping.academicSettingId !== atp.academicSettingId) {
    blockers.push('Ketiadaan konsistensi academicSettingId antara Pemetaan dan ATP.');
  }
  // ATP-TP relationship check
  if (atp && tp) {
    const tpRefId = atp.tpDataId || atp.tpId;
    if (tpRefId && tpRefId !== tp.id) {
      blockers.push('Relasi ATP–TP tidak konsisten.');
    }
  }

  // 4. Upstream staleness check (only if source metadata exists and strictly newer)
  let isStale = false;
  const mappingAny = mapping as (ATPUnitMappingData & { basedOnAtpFingerprint?: string; basedOnTpFingerprint?: string }) | undefined;
  if (mapping && atp && mappingAny?.basedOnAtpFingerprint) {
    if (!matchesSubstantiveFingerprint(mappingAny.basedOnAtpFingerprint, computeAtpSubstantiveFingerprint(atp))) {
      isStale = true;
      blockers.push('Substansi ATP berubah sejak pemetaan terakhir disimpan (stale).');
    }
  } else if (mapping && atp?.updatedAt && mapping.basedOnAtpUpdatedAt) {
    if (isUpstreamStale(atp.updatedAt, mapping.basedOnAtpUpdatedAt)) {
      isStale = true;
      blockers.push('Alur ATP telah diperbarui sejak pemetaan terakhir disimpan (stale).');
    }
  }
  if (mapping && tp && mappingAny?.basedOnTpFingerprint) {
    if (!matchesSubstantiveFingerprint(mappingAny.basedOnTpFingerprint, computeTpSubstantiveFingerprint(tp))) {
      isStale = true;
      blockers.push('Substansi TP berubah sejak pemetaan terakhir disimpan (stale).');
    }
  } else if (mapping && tp?.updatedAt && mapping.basedOnTpUpdatedAt) {
    if (isUpstreamStale(tp.updatedAt, mapping.basedOnTpUpdatedAt)) {
      isStale = true;
      blockers.push('Tujuan Pembelajaran (TP) telah diperbarui sejak pemetaan terakhir disimpan (stale).');
    }
  }

  const hasUnits = Boolean(mapping && Array.isArray(mapping.units) && mapping.units.length > 0);
  if (!hasUnits) {
    blockers.push('Pemetaan Unit/Bab masih kosong.');
  }

  if (!validationResult.isValid || !validationResult.isComplete) {
    validationResult.issues.forEach((iss) => {
      if (!blockers.includes(iss)) {
        blockers.push(iss);
      }
    });
  }

  if (!validationResult.isComplete) {
    blockers.push('Pemetaan Unit/Bab belum lengkap.');
  }
  const auto=mapping?.step07AutoRepair;
  // Evaluate the same pedagogical requirements for an in-flight candidate and a saved
  // scoped run. Only the persisted-run certificate is deferred until the candidate passes.
  const scoped=options?.evaluateRepair||auto?.scope==='STEP07_AUTO_REPAIR';
  const repairIssues:Step07ReadinessIssue[]=[];
  if(scoped){
    for(const unitId of validationResult.unitsWithoutLineage)repairIssues.push({id:`unit:${unitId}`,unitId,message:`Bab ${unitId} belum memiliki lineage.`});
    for(const gap of validationResult.materialsWithoutLineage)repairIssues.push({id:`material:${gap.materialId}`,unitId:gap.unitId,materialId:gap.materialId,message:`Materi ${gap.materialId} di Bab ${gap.unitId} belum memiliki lineage.`});
    for(const tpId of validationResult.uncoveredTpIds)repairIssues.push({id:`tp:${tpId}`,tpIds:[tpId],message:`TP ${tpId} belum tercakup.`});
    for(const atpId of validationResult.unmappedAtpIds)repairIssues.push({id:`atp:${atpId}`,atpIds:[atpId],message:`ATP ${atpId} belum tercakup.`});
    for(const gap of validationResult.materialCoverageGaps){
      for(const tpId of gap.tpIds)repairIssues.push({id:`coverage:${gap.unitId}:tp:${tpId}`,unitId:gap.unitId,tpIds:[tpId],message:`TP ${tpId} pada Bab ${gap.unitId} belum didukung gabungan materi.`});
      for(const atpId of gap.atpItemIds)repairIssues.push({id:`coverage:${gap.unitId}:atp:${atpId}`,unitId:gap.unitId,atpIds:[atpId],message:`ATP ${atpId} pada Bab ${gap.unitId} belum didukung gabungan materi.`});
    }
    // Include every remaining readiness blocker, including upstream/status/source
    // errors which the AI must explain rather than "repair" by editing canonical TP/ATP.
    for(const message of [...new Set(blockers)]){
      if(message==='Pemetaan Unit/Bab belum lengkap.'||(validationResult.isValid&&validationResult.issues.includes(message)))continue;
      repairIssues.push({id:`readiness:${message}`,message});
    }
  }

  const canProceed =
    canSaveDraft &&
    hasUnits &&
    validationResult.isComplete &&
    !isStale &&
    isTpReady &&
    isAtpReady &&
    blockers.length === 0;

  return {
    canSaveDraft,
    canProceed,
    blockers,
    validationResult,
    ...(scoped?{repairIssues}:{}),
  };
}

/** UI/checkpoint progress is a projection of shared readiness, never checkpoint status. */
export function countStep07CompletedUnits(mapping:ATPUnitMappingData,atp:ATPData,tp:TPData):number {
  const issues=resolveATPUnitMappingReadiness(mapping,atp,tp,undefined,{evaluateRepair:true}).repairIssues || [];
  return mapping.units.filter(unit=>!issues.some(issue=>issue.unitId===unit.id)).length;
}
