import { deriveMappingAtpIds } from './atpMappingLineageService';
import type { ATPData, TPData, ATPUnitMapping, ATPUnitMaterial, ATPUnitMappingData } from '../types';
import { validateATPUnitMappingCanonical } from './atpUnitMappingValidationService';
import { checkMappingSemanticEvidence } from '../../server/mappingSemanticEvidence';
import { applyMinimalAlignment, type AlignmentAction, type AlignmentActionType } from './mappingAlignmentService';

export interface MappingActionItem {
  id: string;
  type: 'ASSIGN_ATP_TO_UNIT' | 'ADD_MATERIAL_TO_UNIT' | 'ALIGN_EXISTING_MATERIAL' | 'RECOVER_ATP_LINEAGE' | AlignmentActionType;
  atpItemId?: string;
  targetUnitId?: string;
  targetMaterialId?: string;
  title?: string;
  linkedAtpItemIds?: string[];
  linkedTpIds?: string[];
  removeAtpItemIds?: string[];
  sourceUnitId?: string;
  before?: string;
  after?: string;
  materialOrder?: string[];
  reason?: string;
  evidence?: AlignmentAction['evidence'];
}

export interface ApplyATPMappingActionsInput {
  units: ATPUnitMapping[];
  selectedActions: MappingActionItem[];
  atp: ATPData;
  tp: TPData;
  mappingId?: string;
  academicSettingId?: string;
  expectedFingerprint?: string;
  currentFingerprint?: string;
}

export interface ApplyATPMappingActionsResult {
  success: boolean;
  nextUnits?: ATPUnitMapping[];
  issues: string[];
  rollbackUnits?: ATPUnitMapping[];
}

function getCanonicalTpsForAtpItem(atpItem: any): string[] {
  if (!atpItem) return [];
  if (Array.isArray(atpItem.linkedTpIds) && atpItem.linkedTpIds.length > 0) {
    return atpItem.linkedTpIds;
  }
  if (atpItem.tpId) {
    return [atpItem.tpId];
  }
  return [];
}

export function computeMappingFingerprint(units: ATPUnitMapping[], atp: ATPData, tp: TPData): string {
  const unitSummary = (units || []).map((u) => ({
    id: u.id,
    title: u.title,
    order: u.order,
    atp: [...(u.linkedAtpItemIds || [])].sort(),
    tp: [...(u.linkedTpIds || [])].sort(),
    mats: (u.materials || []).map((m) => ({
      id: m.id,
      title: m.title,
      order: m.order,
      atp: [...(m.linkedAtpItemIds || [])].sort(),
      tp: [...(m.linkedTpIds || [])].sort(),
    })).sort((a, b) => a.id.localeCompare(b.id)),
  })).sort((a, b) => a.id.localeCompare(b.id));

  const atpSummary = (atp.items || []).map((a) => ({
    id: a.id,
    stepNumber: a.stepNumber,
    focus: a.focus,
    tps: [...getCanonicalTpsForAtpItem(a)].sort(),
  })).sort((a, b) => a.id.localeCompare(b.id));

  const tpSummary = (tp.items || []).map((t) => ({
    id: t.id,
    statement: t.statement,
    competence: t.competence,
    contentScope: t.contentScope,
  })).sort((a, b) => a.id.localeCompare(b.id));

  return JSON.stringify({
    units: unitSummary,
    atpItems: atpSummary,
    tpItems: tpSummary,
  });
}

export function rollbackATPMappingActions(units: ATPUnitMapping[], rollbackUnits: ATPUnitMapping[], expectedFingerprint: string, atp: ATPData, tp: TPData): ApplyATPMappingActionsResult {
  if (computeMappingFingerprint(units, atp, tp) !== expectedFingerprint) return { success: false, issues: ['Rollback ditolak: draf atau canonical berubah setelah apply.'] };
  return { success: true, nextUnits: structuredClone(rollbackUnits), issues: [] };
}

export function computeAtpSubstantiveFingerprint(atp: ATPData | undefined): string {
  return JSON.stringify((atp?.items || []).map((a) => ({
    id: a.id,
    stepNumber: a.stepNumber,
    focus: a.focus,
    tps: [...getCanonicalTpsForAtpItem(a)].sort(),
  })).sort((a, b) => a.id.localeCompare(b.id)));
}

export function computeTpSubstantiveFingerprint(tp: TPData | undefined): string {
  return JSON.stringify((tp?.items || []).map((t) => ({
    id: t.id,
    statement: t.statement,
    competence: t.competence,
    contentScope: t.contentScope,
  })).sort((a, b) => a.id.localeCompare(b.id)));
}

// Imported legacy snapshots retain the source ID ordering after IDs are remapped.
// Only ordering is ignored: IDs, substance, fields and lineage must still match exactly.
export function matchesSubstantiveFingerprint(snapshot: string | undefined, current: string): boolean {
  if (!snapshot) return false;
  if (snapshot === current) return true;
  try {
    const normalize = (value: unknown): string | undefined => {
      if (!Array.isArray(value) || value.length === 0) return undefined;
      const ids = new Set<string>();
      const entries = value.map(item => {
        if (!item || typeof item !== 'object' || typeof item.id !== 'string' || ids.has(item.id)) {
          throw new Error('Invalid snapshot identity');
        }
        ids.add(item.id);
        const record = { ...item };
        if ('tps' in record) {
          if (!Array.isArray(record.tps) || record.tps.some((id: unknown) => typeof id !== 'string')) {
            throw new Error('Invalid snapshot lineage');
          }
          record.tps = [...record.tps].sort();
        }
        return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b))) as { id: string; [k: string]: unknown };
      });
      return JSON.stringify(entries.sort((a, b) => String(a.id).localeCompare(String(b.id))));
    };
    const expected = normalize(JSON.parse(current));
    return expected !== undefined && normalize(JSON.parse(snapshot)) === expected;
  } catch {
    return false;
  }
}

export function buildMappingDraftFromUnits(
  units: ATPUnitMapping[],
  mappingId?: string,
  academicSettingId?: string,
  atpId?: string,
  tpDataId?: string,
  basedOnTpUpdatedAt?: string,
  basedOnAtpUpdatedAt?: string,
  basedOnTpFingerprint?: string,
  basedOnAtpFingerprint?: string
): ATPUnitMappingData {
  const finalUnits: ATPUnitMapping[] = (units || []).map((u, idx) => {
    const uId = u.id && u.id.trim() ? u.id.trim() : `unit-${Date.now()}-${idx + 1}`;
    const uTitle = u.title !== undefined ? u.title : `Bab ${idx + 1}`;
    const linkedAtpItemIds = Array.isArray(u.linkedAtpItemIds) ? [...u.linkedAtpItemIds] : [];
    const linkedTpIds = Array.isArray(u.linkedTpIds) ? [...u.linkedTpIds] : [];

    const materials: ATPUnitMaterial[] = (u.materials || []).map((m, mIdx) => {
      const matAtpIds = Array.isArray(m.linkedAtpItemIds) ? [...m.linkedAtpItemIds] : [];
      const matTpIds = Array.isArray(m.linkedTpIds) ? [...m.linkedTpIds] : [];

      return {
        id: m.id && m.id.trim() ? m.id.trim() : `mat-${Date.now()}-${mIdx + 1}`,
        title: m.title !== undefined ? m.title : '',
        order: m.order,
        linkedTpIds: matTpIds,
        linkedAtpItemIds: matAtpIds,
      };
    });

    return {
      id: uId,
      title: uTitle,
      order: typeof u.order === 'number' ? u.order : idx + 1,
      linkedAtpItemIds,
      linkedTpIds,
      materials,
    };
  });

  return {
    id: mappingId && mappingId.trim() ? mappingId.trim() : (atpId ? `mapping-${atpId}` : `atp-mapping-${Date.now()}`),
    academicSettingId: academicSettingId || '',
    atpId: atpId || '',
    tpDataId: tpDataId || '',
    units: finalUnits,
    basedOnTpUpdatedAt,
    basedOnAtpUpdatedAt,
    updatedAt: new Date().toISOString(),
    basedOnTpFingerprint,
    basedOnAtpFingerprint,
  } as ATPUnitMappingData;
}

export function applyATPMappingActions(input: ApplyATPMappingActionsInput): ApplyATPMappingActionsResult {
  const actualFingerprint = computeMappingFingerprint(input.units, input.atp, input.tp);
  if (input.expectedFingerprint !== actualFingerprint || input.currentFingerprint !== actualFingerprint) {
    return { success: false, issues: ['Analisis tidak tersedia atau sudah kedaluwarsa. Jalankan analisis ulang.'] };
  }
  const minimalTypes = ['LINK_TP', 'EDIT_MATERIAL', 'ADD_MATERIAL', 'MOVE_MATERIAL', 'RESTRUCTURE_UNIT'];
  if (input.selectedActions.some(action => minimalTypes.includes(action?.type))) {
    if (input.selectedActions.some(action => !minimalTypes.includes(action?.type))) return { success: false, issues: ['Pilih proposal perubahan minimal atau bundle lama secara terpisah; tidak ada perubahan parsial diterapkan.'] };
    return applyMinimalAlignment(input.units, input.selectedActions as AlignmentAction[], input.atp, input.tp);
  }
  const {
    units,
    selectedActions: proposedActions,
    atp,
    tp,
    mappingId,
    academicSettingId,
    expectedFingerprint,
    currentFingerprint,
  } = input;

  const issues: string[] = [];
  // Normalize a transaction from TP choices before any draft mutation. No full-ATP TP expansion.
  const selectedActions = (proposedActions || []).map(action => {
    if (!action) return action;
    const selectedTpIds = action.linkedTpIds || [];
    const derived = deriveMappingAtpIds(selectedTpIds, atp, tp);
    issues.push(...derived.issues);
    if (!selectedTpIds.length) issues.push('Bundle Bab/Materi wajib memilih subset TP canonical.');
    if (action.type === 'ASSIGN_ATP_TO_UNIT') {
      if (!derived.atpItemIds.includes(action.atpItemId || '')) issues.push('ATP penugasan bukan induk TP pilihan.');
      return { ...action, linkedTpIds: [...selectedTpIds] };
    }
    const supplied = action.linkedAtpItemIds || (action.atpItemId ? [action.atpItemId] : []);
    for (const id of supplied) if (!atp.items.some(item => item.id === id)) issues.push(`Action merujuk ATP fiktif: ${id}`);
    if (supplied.length && (supplied.some(id => !derived.atpItemIds.includes(id)) || derived.atpItemIds.some(id => !supplied.includes(id)))) {
      issues.push('CANONICAL_LINEAGE_MISMATCH: ATP materi harus sama dengan induk TP canonical pilihan.');
    }
    return { ...action, linkedTpIds: [...selectedTpIds], linkedAtpItemIds: derived.atpItemIds };
  });


  // 1. Stale Analysis Guard
  if (
    !expectedFingerprint ||
    !currentFingerprint ||
    expectedFingerprint !== currentFingerprint
  ) {
    return {
      success: false,
      issues: ['Analisis tidak tersedia atau sudah kedaluwarsa. Jalankan analisis ulang.'],
    };
  }

  if (!Array.isArray(selectedActions) || selectedActions.length === 0) {
    return {
      success: true,
      nextUnits: JSON.parse(JSON.stringify(units)),
      issues: [],
    };
  }

  const validAtpIds = new Set((atp.items || []).map((a) => a.id));
  const validTpIds = new Set((tp.items || []).map((t) => t.id));
  const atpMap = new Map((atp.items || []).map((a) => [a.id, a]));

  const unitMap = new Map<string, { unit: ATPUnitMapping; materialIds: Set<string> }>();
  (units || []).forEach((u) => {
    const matSet = new Set((u.materials || []).map((m) => m.id));
    unitMap.set(u.id, { unit: u, materialIds: matSet });
  });
  const explicitAssignments = (unitId: string) => selectedActions.filter(a =>
    a?.type === 'ASSIGN_ATP_TO_UNIT' && a.targetUnitId === unitId);

  // Pre-validate all actions atomically (no silent continue/skip)
  for (const action of selectedActions) {
    if (!action || !action.type) {
      issues.push('Ditemukan action tidak dikenal atau kosong.');
      continue;
    }

    if (
      action.type !== 'ASSIGN_ATP_TO_UNIT' &&
      action.type !== 'ADD_MATERIAL_TO_UNIT' &&
      action.type !== 'ALIGN_EXISTING_MATERIAL' &&
      action.type !== 'RECOVER_ATP_LINEAGE'
    ) {
      issues.push(`Tipe action tidak valid: ${action.type}`);
      continue;
    }

    const targetUnitId = String(action.targetUnitId || '').trim();
    if (!targetUnitId || !unitMap.has(targetUnitId)) {
      issues.push(`Action menargetkan Bab dengan ID fiktif atau tidak ada: ${targetUnitId}`);
      continue;
    }

    if (action.type === 'ASSIGN_ATP_TO_UNIT') {
      const atpId = String(action.atpItemId || '').trim();
      if (!atpId || !validAtpIds.has(atpId)) {
        issues.push(`ASSIGN_ATP merujuk ID ATP fiktif atau tidak valid: ${atpId}`);
      }
      const linkedTps = Array.isArray(action.linkedTpIds) ? action.linkedTpIds : [];
      if (linkedTps.length === 0) {
        issues.push(`ASSIGN_ATP wajib menyertakan subset linkedTpIds.`);
      } else {
        const atpObj = atpMap.get(atpId);
        const canonTps = getCanonicalTpsForAtpItem(atpObj);
        for (const tId of linkedTps) {
          if (!validTpIds.has(tId) || !canonTps.includes(tId)) {
            issues.push(`Subset TP '${tId}' tidak didukung oleh ATP canonical tertaut.`);
          }
        }
      }
    } else if (action.type === 'ADD_MATERIAL_TO_UNIT') {
      const title = String(action.title || '').trim();
      if (!title) {
        issues.push('ADD_MATERIAL wajib memiliki judul materi.');
      }
      const rawAtps = Array.isArray(action.linkedAtpItemIds) && action.linkedAtpItemIds.length > 0
        ? action.linkedAtpItemIds
        : (action.atpItemId ? [action.atpItemId] : []);
      const linkedAtps = rawAtps.map((id) => String(id).trim()).filter(Boolean);

      if (linkedAtps.length === 0) {
        issues.push('ADD_MATERIAL wajib merujuk minimal 1 ATP canonical.');
      }

      for (const aId of linkedAtps) {
        if (!validAtpIds.has(aId)) issues.push(`ADD_MATERIAL merujuk ATP fiktif: ${aId}`);
      }

      const rawTps = Array.isArray(action.linkedTpIds) && action.linkedTpIds.length > 0
        ? action.linkedTpIds
        : Array.from(new Set(linkedAtps.flatMap((aId) => getCanonicalTpsForAtpItem(atpMap.get(aId)))));
      const linkedTps = rawTps.map((id) => String(id).trim()).filter(Boolean);

      if (linkedTps.length === 0) {
        issues.push('ADD_MATERIAL wajib memiliki silsilah (lineage) TP yang lengkap.');
      }

      for (const tId of linkedTps) {
        if (!validTpIds.has(tId)) issues.push(`ADD_MATERIAL merujuk TP fiktif: ${tId}`);
      }
      for (const tId of linkedTps) {
        const supported = linkedAtps.some((aId) => getCanonicalTpsForAtpItem(atpMap.get(aId)).includes(tId));
        if (!supported) issues.push(`TP '${tId}' tidak didukung oleh ATP canonical pada ADD_MATERIAL.`);
      }

      const unitInfo = unitMap.get(targetUnitId)?.unit;
      const unitHasLineage = (unitInfo?.linkedAtpItemIds || []).length > 0;
      if (unitHasLineage) {
        const assignments = explicitAssignments(targetUnitId);
        for (const aId of linkedAtps) {
          if (!(unitInfo?.linkedAtpItemIds || []).includes(aId) && !assignments.some(a => a.atpItemId === aId)) issues.push(`ADD_MATERIAL merujuk ATP '${aId}' yang tidak didukung Bab induk.`);
        }
        const unitTps = unitInfo?.linkedTpIds || [];
        if (unitTps.length > 0) {
          for (const tId of linkedTps) {
            if (!unitTps.includes(tId) && !assignments.some(a => a.linkedTpIds?.includes(tId))) issues.push(`ADD_MATERIAL merujuk TP '${tId}' yang tidak didukung Bab induk.`);
          }
        }
      }
    } else if (action.type === 'ALIGN_EXISTING_MATERIAL' || action.type === 'RECOVER_ATP_LINEAGE') {
      const matId = String(action.targetMaterialId || '').trim();
      const unitInfo = unitMap.get(targetUnitId);
      if (matId && (!unitInfo || !unitInfo.materialIds.has(matId))) {
        issues.push(`${action.type} merujuk Lingkup Materi fiktif atau tidak sesuai Bab: ${matId}`);
      }
      if (action.type === 'ALIGN_EXISTING_MATERIAL' && !matId) {
        issues.push(`ALIGN_EXISTING_MATERIAL wajib menargetkan Lingkup Materi existing.`);
      }
      const linkedAtps = Array.isArray(action.linkedAtpItemIds) ? action.linkedAtpItemIds : [];
      const linkedTps = Array.isArray(action.linkedTpIds) ? action.linkedTpIds : [];
      if (linkedAtps.length === 0 || linkedTps.length === 0) {
        issues.push(`${action.type} wajib memiliki lineage ATP dan TP yang lengkap.`);
      }
      for (const aId of linkedAtps) {
        if (!validAtpIds.has(aId)) issues.push(`${action.type} merujuk ATP fiktif: ${aId}`);
      }
      for (const tId of linkedTps) {
        if (!validTpIds.has(tId)) issues.push(`${action.type} merujuk TP fiktif: ${tId}`);
      }
      for (const tId of linkedTps) {
        const supported = linkedAtps.some((aId) => getCanonicalTpsForAtpItem(atpMap.get(aId)).includes(tId));
        if (!supported) issues.push(`TP '${tId}' tidak didukung oleh ATP canonical pada ${action.type}.`);
      }
      const unit = unitInfo?.unit;
      const unitHasLineage = (unit?.linkedAtpItemIds || []).length > 0 || (unit?.linkedTpIds || []).length > 0;
      if (action.type === 'ALIGN_EXISTING_MATERIAL' && unitHasLineage) {
        const assignments = explicitAssignments(targetUnitId);
        for (const aId of linkedAtps) {
          if (!(unit?.linkedAtpItemIds || []).includes(aId) && !assignments.some(a => a.atpItemId === aId)) issues.push(`ALIGN_EXISTING_MATERIAL merujuk ATP '${aId}' yang tidak didukung Bab induk.`);
        }
        for (const tId of linkedTps) {
          if (!(unit?.linkedTpIds || []).includes(tId) && !assignments.some(a => a.linkedTpIds?.includes(tId))) issues.push(`ALIGN_EXISTING_MATERIAL merujuk TP '${tId}' yang tidak didukung Bab induk.`);
        }
      }
      if (action.type === 'RECOVER_ATP_LINEAGE') {
        const staleAtps = Array.isArray(action.removeAtpItemIds) ? action.removeAtpItemIds : [];
        if (staleAtps.length === 0) {
          issues.push('RECOVER_ATP_LINEAGE wajib menyebut removeAtpItemIds.');
        }
        const targetMaterial = matId ? (unit?.materials || []).find((m) => m.id === matId) : undefined;
        const sourceAtpIds = matId ? (targetMaterial?.linkedAtpItemIds || []) : (unit?.linkedAtpItemIds || []);
        for (const staleId of staleAtps) {
          if (validAtpIds.has(staleId)) {
            issues.push(`RECOVER_ATP_LINEAGE tidak boleh menghapus ATP canonical yang masih valid: ${staleId}`);
          }
          if (!sourceAtpIds.includes(staleId)) {
            issues.push(`RECOVER_ATP_LINEAGE mencoba menghapus ATP lama '${staleId}' yang tidak ada pada target.`);
          }
        }
      }
    }
  }

  if (issues.length > 0) {
    return {
      success: false,
      issues,
    };
  }

  // Deep clone units for transaction application
  let nextUnits: ATPUnitMapping[] = JSON.parse(JSON.stringify(units));

  for (const action of selectedActions) {
    const targetUnitId = action.targetUnitId!;

    if (action.type === 'ASSIGN_ATP_TO_UNIT') {
      const atpId = action.atpItemId!;
      const actionTpIds = action.linkedTpIds || [];

      nextUnits = nextUnits.map((u) => {
        if (u.id !== targetUnitId) return u;
        const nextLinkedAtp = [...(u.linkedAtpItemIds || [])];
        if (!nextLinkedAtp.includes(atpId)) {
          nextLinkedAtp.push(atpId);
        }
        const nextTpIds = Array.from(new Set([...(u.linkedTpIds || []), ...actionTpIds]));
        return {
          ...u,
          linkedAtpItemIds: nextLinkedAtp,
          linkedTpIds: nextTpIds,
        };
      });
    } else if (action.type === 'ADD_MATERIAL_TO_UNIT') {
      const title = String(action.title || '').trim();
      const rawAtps = Array.isArray(action.linkedAtpItemIds) && action.linkedAtpItemIds.length > 0
        ? action.linkedAtpItemIds
        : (action.atpItemId ? [action.atpItemId] : []);
      const actionAtps = rawAtps.map((id) => String(id).trim()).filter(Boolean);

      const rawTps = Array.isArray(action.linkedTpIds) && action.linkedTpIds.length > 0
        ? action.linkedTpIds
        : Array.from(new Set(actionAtps.flatMap((aId) => getCanonicalTpsForAtpItem(atpMap.get(aId)))));
      const actionTps = rawTps.map((id) => String(id).trim()).filter(Boolean);

      // Canonical sort for material lineage
      const sortedMatAtps = [...actionAtps].sort((a, b) => {
        const indexA = (atp.items || []).findIndex((item) => item.id === a);
        const indexB = (atp.items || []).findIndex((item) => item.id === b);
        return indexA - indexB;
      });
      const sortedMatTps = [...actionTps].sort((a, b) => {
        const indexA = (tp.items || []).findIndex((item) => item.id === a);
        const indexB = (tp.items || []).findIndex((item) => item.id === b);
        return indexA - indexB;
      });

      nextUnits = nextUnits.map((u) => {
        if (u.id !== targetUnitId) return u;

        const nextUnitAtp = Array.from(new Set([...(u.linkedAtpItemIds || []), ...actionAtps])).sort((a, b) => {
          const indexA = (atp.items || []).findIndex((item) => item.id === a);
          const indexB = (atp.items || []).findIndex((item) => item.id === b);
          return indexA - indexB;
        });

        const nextUnitTp = Array.from(new Set([...(u.linkedTpIds || []), ...actionTps])).sort((a, b) => {
          const indexA = (tp.items || []).findIndex((item) => item.id === a);
          const indexB = (tp.items || []).findIndex((item) => item.id === b);
          return indexA - indexB;
        });

        const currentMats = [...(u.materials || [])];
        const existingMatIdx = currentMats.findIndex(
          (m) => m.title.trim().toLowerCase() === title.toLowerCase()
        );

        let nextMaterials: ATPUnitMaterial[];
        if (existingMatIdx >= 0) {
          // Re-application or duplicate recommendation: merge lineage without creating duplicate material
          const existingMat = currentMats[existingMatIdx];
          const mergedAtps = Array.from(new Set([...(existingMat.linkedAtpItemIds || []), ...sortedMatAtps])).sort((a, b) => {
            const indexA = (atp.items || []).findIndex((item) => item.id === a);
            const indexB = (atp.items || []).findIndex((item) => item.id === b);
            return indexA - indexB;
          });
          const mergedTps = Array.from(new Set([...(existingMat.linkedTpIds || []), ...sortedMatTps])).sort((a, b) => {
            const indexA = (tp.items || []).findIndex((item) => item.id === a);
            const indexB = (tp.items || []).findIndex((item) => item.id === b);
            return indexA - indexB;
          });

          nextMaterials = currentMats.map((m, idx) => {
            if (idx !== existingMatIdx) return m;
            return {
              ...m,
              linkedAtpItemIds: mergedAtps,
              linkedTpIds: mergedTps,
            };
          });
        } else {
          // Append new material in consistent sequential recommendation order
          const newMat: ATPUnitMaterial = {
            id: `mat-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            title,
            order: Math.max(0, ...currentMats.map(material => material.order)) + 1,
            linkedTpIds: sortedMatTps,
            linkedAtpItemIds: sortedMatAtps,
          };
          nextMaterials = [...currentMats, newMat];
        }

        return {
          ...u,
          linkedAtpItemIds: nextUnitAtp,
          linkedTpIds: nextUnitTp,
          materials: nextMaterials,
        };
      });
    } else if (action.type === 'ALIGN_EXISTING_MATERIAL' || action.type === 'RECOVER_ATP_LINEAGE') {
      const matId = action.targetMaterialId!;
      const proposedAtp = action.linkedAtpItemIds || [];
      const proposedTp = action.linkedTpIds || [];
      const removeAtpIds = action.type === 'RECOVER_ATP_LINEAGE' ? (action.removeAtpItemIds || []) : [];

      const sortedAtpIds = [...proposedAtp].sort((a, b) => {
        const indexA = (atp.items || []).findIndex((item) => item.id === a);
        const indexB = (atp.items || []).findIndex((item) => item.id === b);
        return indexA - indexB;
      });

      const sortedTpIds = [...proposedTp].sort((a, b) => {
        const indexA = (tp.items || []).findIndex((item) => item.id === a);
        const indexB = (tp.items || []).findIndex((item) => item.id === b);
        return indexA - indexB;
      });

      nextUnits = nextUnits.map((u) => {
        if (u.id !== targetUnitId) return u;
        const unitAtpWithoutStale = (u.linkedAtpItemIds || []).filter((id) => !removeAtpIds.includes(id));
        const nextUnitAtp = Array.from(new Set([...unitAtpWithoutStale, ...sortedAtpIds])).sort((a, b) => {
          const indexA = (atp.items || []).findIndex((item) => item.id === a);
          const indexB = (atp.items || []).findIndex((item) => item.id === b);
          return indexA - indexB;
        });
        const nextUnitTp = Array.from(new Set([...(u.linkedTpIds || []), ...sortedTpIds])).sort((a, b) => {
          const indexA = (tp.items || []).findIndex((item) => item.id === a);
          const indexB = (tp.items || []).findIndex((item) => item.id === b);
          return indexA - indexB;
        });
        const nextMaterials = (u.materials || []).map((mat) => {
          if (mat.id !== matId) return mat;
          return {
            ...mat,
            linkedAtpItemIds: sortedAtpIds,
            linkedTpIds: sortedTpIds,
          };
        });
        return {
          ...u,
          linkedAtpItemIds: nextUnitAtp,
          linkedTpIds: nextUnitTp,
          materials: nextMaterials,
        };
      });
    }
  }

  // Validate candidate using canonical validator
  const candidateMapping = buildMappingDraftFromUnits(
    nextUnits,
    mappingId,
    academicSettingId,
    atp.id,
    tp.id,
    tp.updatedAt,
    atp.updatedAt,
    computeTpSubstantiveFingerprint(tp),
    computeAtpSubstantiveFingerprint(atp)
  );

  const validation = validateATPUnitMappingCanonical(candidateMapping, atp, tp);
  const beforeValidation = validateATPUnitMappingCanonical({ ...candidateMapping, units }, atp, tp);
  for (const gap of validation.materialCoverageGaps) {
    const before = beforeValidation.materialCoverageGaps.find(g => g.unitId === gap.unitId);
    const introducedTp = gap.tpIds.filter(id => !before?.tpIds.includes(id));
    const introducedAtp = gap.atpItemIds.filter(id => !before?.atpItemIds.includes(id));
    if (introducedTp.length || introducedAtp.length) {
      issues.push(`SOURCE_LINEAGE_MISSING: rekomendasi memperluas Bab '${gap.unitTitle}' tanpa dukungan materi: TP [${introducedTp}], ATP [${introducedAtp}]. Pilih penyelarasan materi yang relevan dalam transaksi yang sama.`);
    }
  }
  for (const action of selectedActions.filter(a => a.type === 'ASSIGN_ATP_TO_UNIT')) {
    const unit = nextUnits.find(u => u.id === action.targetUnitId)!;
    const original = units.find(u => u.id === unit.id)!;
    const supported = (unit.materials || []).filter(m => m.linkedAtpItemIds.includes(action.atpItemId!));
    if (!supported.length || (action.linkedTpIds || []).some(id => !supported.some(m => m.linkedTpIds.includes(id)))) {
      issues.push(`ASSIGN_ATP_TO_UNIT: Bab '${unit.title}' memerlukan materi pendukung untuk ATP '${action.atpItemId}' dan TP [${action.linkedTpIds}]. Terapkan penyelarasan materi terkait bersama penugasan ATP.`);
    }
    for (const tpId of action.linkedTpIds || []) {
      if (original.linkedAtpItemIds.includes(action.atpItemId!) && original.linkedTpIds.includes(tpId)) continue;
      const relevant = supported.some(m => m.linkedTpIds.includes(tpId) && !checkMappingSemanticEvidence({
        label: m.title, tpItems: (tp.items || []).filter(item => item.id === tpId),
      }).hardConflict);
      if (!relevant) issues.push(`ASSIGN_ATP_TO_UNIT: Bab '${unit.title}', TP '${tpId}': konflik domain gerak eksplisit pada materi pendukung. Tinjau substansi materi sebelum memperluas relasi Bab.`);
    }
  }
  const affectedUnits = new Set(selectedActions.map(action => action.targetUnitId));
  for (const gap of validation.materialCoverageGaps.filter(gap => affectedUnits.has(gap.unitId))) {
    issues.push('SOURCE_LINEAGE_MISSING: bundle Bab '+gap.unitTitle+' belum lengkap; seluruh TP/ATP Bab harus didukung materi dalam transaksi yang sama.');
  }
  if (validation.materialsWithoutLineage.some(item => affectedUnits.has(item.unitId)) || validation.unitsWithoutLineage.some(id => affectedUnits.has(id))) {
    issues.push('Bundle Bab + Materi + TP + ATP belum lengkap. Tidak ada perubahan parsial yang diterapkan.');
  }
  if (issues.length) return { success: false, issues };

  if (!validation.isValid) {
    return {
      success: false,
      issues: validation.issues.length > 0 ? validation.issues : ['Validasi canonical gagal pada draf hasil penerapan action.'],
    };
  }

  // Strict invariant: unit count, IDs, titles, and order must remain completely identical
  if (
    nextUnits.length !== units.length ||
    nextUnits.some((u, idx) => u.id !== units[idx].id || u.title !== units[idx].title || u.order !== units[idx].order)
  ) {
    return {
      success: false,
      issues: ['Struktur Bab (jumlah, ID, judul, atau urutan) tidak boleh berubah saat menerapkan rekomendasi.'],
    };
  }

  return {
    success: true,
    nextUnits,
    issues: [],
  };
}
