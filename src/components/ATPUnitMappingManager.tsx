import { AlignmentProposalReview } from './AlignmentProposalReview';
import { deriveMappingAtpIds } from '../services/atpMappingLineageService';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  FolderTree,
  ArrowRight,
  ArrowLeft,
  Save,
  AlertCircle,
  Sparkles,
  Layers,
  Check,
  Plus,
  Trash2,
  ListPlus,
  Info,
  ArrowUp,
  ArrowDown,
  BookOpen,
  FileSpreadsheet,
  X,
  Download,
  Copy,
} from 'lucide-react';
import {
  ATPData,
  ATPItem,
  TPData,
  AcademicSetting,
  ATPUnitMappingData,
  ATPUnitMapping,
  ATPUnitMaterial,
  CPData,
  CPAnalysisData,
} from '../types';
import {
  analyzeATPUnitMappingWithAI,
  generateCanonicalATPUnitMappingWithAI,
  MappingAnalysisResult,
} from '../services/aiService';
import { validateATPUnitMappingCanonical } from '../services/atpUnitMappingValidationService';
import { mappingCoverage, alignmentProposalStatus } from '../services/mappingAlignmentService';
import { proceedWithATPUnitMapping, resolveATPUnitMappingReadiness } from '../services/atpMappingReadinessService';
import {
  applyATPMappingActions,
  rollbackATPMappingActions,
  computeAtpSubstantiveFingerprint,
  computeMappingFingerprint,
  computeTpSubstantiveFingerprint,
} from '../services/atpMappingActionApplyService';
import {
  extractSelectedMappingActions,
  resolveApplyActionsEligibility,
  type ApplyActionEligibilityResult,
} from '../services/atpApplyActionEligibilityService';
import { runGuardedAnalysis } from '../services/atpAsyncGuard';
import { prepareMappingGenerationPreview, approveMappingGenerationPreview, type MappingGenerationPreview } from '../services/atpMappingGenerationPreview';
import {
  parseBabMateriXlsx,
  downloadBabMateriTemplateXlsx,
  ATPUnitMappingImportResult,
} from '../services/atpUnitMappingImportService';
import { validateATPDataWorkflow } from '../services/cpWorkflowService';
import { buildATPUnitMappingDiagnosticReport } from '../services/diagnosticService';

export interface ATPUnitMappingManagerProps {
  atp: ATPData;
  tp: TPData;
  mapping?: ATPUnitMappingData;
  academicSetting?: AcademicSetting;
  cp?: CPData;
  cpAnalysis?: CPAnalysisData;
  onSaveMapping: (updatedMapping: ATPUnitMappingData) => boolean;
  onNextStep: () => void;
  onBackToATP: () => void;
}

/**
 * Checks if a unit title is a generic default placeholder rather than substantive manual teacher content.
 */
export function isPlaceholderUnitTitle(title?: string): boolean {
  if (!title || !title.trim()) return true;
  const trimmed = title.trim();
  if (/^(?:bab|unit)\s*\d+$/i.test(trimmed)) return true;
  if (/^(?:bab|unit)\s*\d*\s*[:\-]?\s*(?:\(judul\s+bab\s+baru\)|\(judul\s+unit\s+baru\)|\(bab\s+baru\))$/i.test(trimmed)) return true;
  return false;
}

/**
 * Derives union of linked TP IDs from the list of linked ATP items.
 */
function deriveUnitLinkedTpIds(linkedAtpItemIds: string[], atpItems: ATPItem[]): string[] {
  const atpMap = new Map<string, ATPItem>(atpItems.map((it) => [it.id, it]));
  const tpIdSet = new Set<string>();
  for (const atpId of linkedAtpItemIds) {
    const item = atpMap.get(atpId);
    if (!item) continue;
    if (Array.isArray(item.linkedTpIds) && item.linkedTpIds.length > 0) {
      item.linkedTpIds.forEach((id) => {
        if (id && id.trim()) tpIdSet.add(id.trim());
      });
    } else if (item.tpId && item.tpId.trim()) {
      tpIdSet.add(item.tpId.trim());
    }
  }
  return Array.from(tpIdSet);
}

/**
 * Builds initial canonical units state.
 */
export function createInitialUnits(
  mapping: ATPUnitMappingData | undefined,
  atpItems: ATPItem[]
): ATPUnitMapping[] {
  if (mapping && Array.isArray(mapping.units) && mapping.units.length > 0) {
    return mapping.units.map((u, idx) => ({
      id: u.id,
      title: u.title,
      order: u.order,
      linkedAtpItemIds: u.linkedAtpItemIds || [],
      linkedTpIds:
        Array.isArray(u.linkedTpIds)
          ? u.linkedTpIds
          : [],
      materials: (u.materials || []).map((m, mIdx) => ({
        id: m.id || `mat-${Date.now()}-${mIdx + 1}`,
        title: m.title || '',
        order: m.order || mIdx + 1,
        linkedTpIds: m.linkedTpIds || [],
        linkedAtpItemIds: m.linkedAtpItemIds || [],
      })),
    }));
  }

  // Fallback initial draft: bootstrap from legacy unitTitle & materialScope if available
  const legacyUnitMap = new Map<
    string,
    { atpIds: string[]; materialsMap: Map<string, { atpIds: string[]; tpIds: string[] }> }
  >();

  atpItems.forEach((it) => {
    const t = it.unitTitle?.trim();
    if (t) {
      if (!legacyUnitMap.has(t)) {
        legacyUnitMap.set(t, { atpIds: [], materialsMap: new Map() });
      }
      const unitEntry = legacyUnitMap.get(t)!;
      unitEntry.atpIds.push(it.id);

      const mScope = it.materialScope?.trim();
      if (mScope) {
        if (!unitEntry.materialsMap.has(mScope)) {
          unitEntry.materialsMap.set(mScope, { atpIds: [], tpIds: [] });
        }
        const matEntry = unitEntry.materialsMap.get(mScope)!;
        matEntry.atpIds.push(it.id);
        const itemTpIds =
          Array.isArray(it.linkedTpIds) && it.linkedTpIds.length > 0
            ? it.linkedTpIds
            : it.tpId
            ? [it.tpId]
            : [];
        itemTpIds.forEach((id) => {
          if (id && !matEntry.tpIds.includes(id)) matEntry.tpIds.push(id);
        });
      }
    }
  });

  if (legacyUnitMap.size > 0) {
    const initial: ATPUnitMapping[] = [];
    let order = 1;
    legacyUnitMap.forEach((entry, title) => {
      const mats: ATPUnitMaterial[] = [];
      let mOrder = 1;
      entry.materialsMap.forEach((mEntry, mTitle) => {
        mats.push({
          id: `mat-${Date.now()}-${order}-${mOrder}-${Math.random().toString(36).substring(2, 6)}`,
          title: mTitle,
          order: mOrder,
          linkedAtpItemIds: mEntry.atpIds,
          linkedTpIds: mEntry.tpIds,
        });
        mOrder++;
      });

      initial.push({
        id: `unit-${Date.now()}-${order}-${Math.random().toString(36).substring(2, 6)}`,
        title,
        order,
        linkedAtpItemIds: entry.atpIds,
        linkedTpIds: deriveUnitLinkedTpIds(entry.atpIds, atpItems),
        materials: mats,
      });
      order++;
    });
    return initial;
  }

  // Default 6 Bab with empty materials
  const defaults: ATPUnitMapping[] = [];
  for (let i = 1; i <= 6; i++) {
    defaults.push({
      id: `unit-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 6)}`,
      title: `Bab ${i}`,
      order: i,
      linkedAtpItemIds: [],
      linkedTpIds: [],
      materials: [],
    });
  }
  return defaults;
}

/**
 * Builds canonical ATPUnitMappingData from live units state without lossy silent filtering.
 */
export function buildCurrentMappingDraftFromUnits(
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
  const finalUnits: ATPUnitMapping[] = units.map((u, idx) => {
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
      order: u.order,
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
    basedOnTpFingerprint,
    basedOnAtpFingerprint,
    updatedAt: new Date().toISOString(),
  };
}

export const ATPUnitMappingManager: React.FC<ATPUnitMappingManagerProps> = ({
  atp,
  tp,
  mapping,
  academicSetting,
  cp,
  cpAnalysis,
  onSaveMapping,
  onNextStep,
  onBackToATP,
}) => {
  const [units, setUnits] = useState<ATPUnitMapping[]>(() =>
    createInitialUnits(mapping, atp.items || [])
  );
  const [hasChanges, setHasChanges] = useState(false);
  const [saveSuccessNotice, setSaveSuccessNotice] = useState(false);
  const [saveErrorNotice, setSaveErrorNotice] = useState<string | null>(null);
  const [localValidationNotice, setLocalValidationNotice] = useState<string | null>(null);

  // Sync state if canonical mapping prop updates
  useEffect(() => {
    if (mapping && Array.isArray(mapping.units) && mapping.units.length > 0) {
      if (!hasChanges) {
        setUnits(createInitialUnits(mapping, atp.items || []));
      }
    }
  }, [mapping, hasChanges, atp.items]);

  // Canonical mapping existence and unsaved draft checks
  const hasCanonicalMapping = Boolean(
    mapping && Array.isArray(mapping.units) && mapping.units.length > 0
  );

  // Substantive manual content selects guidance; generation always requires approval.
  const hasSubstantiveManualMappingContent = useMemo(() => {
    // A. canonical mapping sudah ada
    if (hasCanonicalMapping) return true;

    // B. ada unit.linkedAtpItemIds.length > 0
    if (units.some((u) => Array.isArray(u.linkedAtpItemIds) && u.linkedAtpItemIds.length > 0)) {
      return true;
    }

    // C. ada material.title.trim() non-empty
    if (
      units.some(
        (u) =>
          Array.isArray(u.materials) &&
          u.materials.some((m) => m.title && m.title.trim().length > 0)
      )
    ) {
      return true;
    }

    // D. guru mengubah judul default Bab menjadi title substantif
    if (units.some((u) => !isPlaceholderUnitTitle(u.title))) {
      return true;
    }

    return false;
  }, [hasCanonicalMapping, units]);

  const hasMeaningfulUnsavedDraft =
    !hasCanonicalMapping &&
    units.some(
      (unit) =>
        (unit.linkedAtpItemIds && unit.linkedAtpItemIds.length > 0) ||
        (unit.materials && unit.materials.some((mat) => mat.title && mat.title.trim().length > 0))
    );

  const canSave = hasChanges || hasMeaningfulUnsavedDraft;

  // Sorted canonical ATP items by stepNumber
  const sortedAtpItems = useMemo(() => {
    return [...(atp.items || [])].sort(
      (a, b) => (a.stepNumber || 0) - (b.stepNumber || 0)
    );
  }, [atp.items]);

  const atpItemMap = useMemo(() => {
    return new Map<string, ATPItem>(sortedAtpItems.map((it) => [it.id, it]));
  }, [sortedAtpItems]);



  // Assigned ATP Item IDs Set across all units
  const assignedAtpIdSet = useMemo(() => {
    const set = new Set<string>();
    units.forEach((u) => {
      (u.linkedAtpItemIds || []).forEach((id) => set.add(id));
    });
    return set;
  }, [units]);

  // Unassigned ATP items (ATP yang belum muncul pada Unit mana pun)
  const unassignedItems = useMemo(() => {
    return sortedAtpItems.filter((it) => !assignedAtpIdSet.has(it.id));
  }, [sortedAtpItems, assignedAtpIdSet]);

  // Total mapped items count
  const mappedCount = useMemo(() => {
    return sortedAtpItems.length - unassignedItems.length;
  }, [sortedAtpItems, unassignedItems]);

  // Shared production readiness resolver for Step 07 and Step 08
  const mappingReadiness = useMemo(() => {
    const currentDraft: ATPUnitMappingData = {
      ...mapping,
      id: mapping?.id || 'temp',
      academicSettingId: academicSetting?.id || atp.academicSettingId || '',
      atpId: atp.id,
      tpDataId: tp.id || atp.tpDataId,
      units,
      updatedAt: mapping?.updatedAt || new Date().toISOString(),
    } as ATPUnitMappingData;

    return resolveATPUnitMappingReadiness(currentDraft, atp, tp, academicSetting);
  }, [units, atp, tp, academicSetting, mapping]);

  const localValidation = useMemo(() => {
    const validation = mappingReadiness.validationResult || validateATPUnitMappingCanonical(mapping, atp, tp);

    const zCount = validation.unmappedAtpIds.length + validation.uncoveredTpIds.length;

    let summaryMessage = mappingReadiness.blockers[0] || '';
    if (!summaryMessage) {
      if (mappingReadiness.canProceed) {
        summaryMessage = 'Pemetaan siap digunakan untuk Perencanaan Tahunan.';
      } else if (!validation.isValid) {
        summaryMessage = 'Pemetaan belum siap. Perbaiki silsilah/lineage yang tidak valid.';
      } else if (zCount > 0) {
        summaryMessage = 'Pemetaan belum siap. Hubungkan ATP/TP canonical yang tersisa.';
      } else {
        const missingUnits = validation.unitsWithoutLineage.map(unitId => units.find(unit => unit.id === unitId)?.title || unitId).join(', ');
        summaryMessage = missingUnits ? `Pemetaan belum siap. Lengkapi Bab (${missingUnits}) atau Materi yang belum diselaraskan.` : 'Pemetaan belum siap.';
      }
    }

    return {
      isComplete: mappingReadiness.canProceed,
      isValid: validation.isValid,
      unitsWithoutLineageCount: validation.unitsWithoutLineage.length,
      materialsWithoutLineageCount: validation.materialsWithoutLineage.length,
      unmappedAtpAndUncoveredTpCount: zCount,
      summaryMessage,
      issues: mappingReadiness.blockers.length > 0 ? mappingReadiness.blockers : validation.issues,
    };
  }, [mappingReadiness, units, atp, tp, academicSetting, mapping?.id]);

  // Handlers for Bab (Unit)
  const handleRenameBab = (unitId: string, newTitle: string) => {
    setUnits((prev) =>
      prev.map((u) => (u.id === unitId ? { ...u, title: newTitle } : u))
    );
    setHasChanges(true);
    setSaveSuccessNotice(false);
    setSaveErrorNotice(null);
    setAnalysisResult(null);
    setSelectedAnalysisActionIds(new Set());
    setAppliedNotice(null);
  };

  const handleAddEmptyBab = () => {
    const nextOrder = units.length + 1;
    const newUnit: ATPUnitMapping = {
      id: `unit-${Date.now()}-${nextOrder}-${Math.random().toString(36).substring(2, 6)}`,
      title: `Bab ${nextOrder}: (Judul Bab Baru)`,
      order: nextOrder,
      linkedAtpItemIds: [],
      linkedTpIds: [],
      materials: [],
    };
    setUnits((prev) => [...prev, newUnit]);
    setHasChanges(true);
    setSaveSuccessNotice(false);
    setSaveErrorNotice(null);
    setAnalysisResult(null);
    setSelectedAnalysisActionIds(new Set());
    setAppliedNotice(null);
  };

  const handleRemoveBab = (unitId: string) => {
    setUnits((prev) => {
      const filtered = prev.filter((u) => u.id !== unitId);
      return filtered.map((u, idx) => ({ ...u, order: idx + 1 }));
    });
    setHasChanges(true);
    setSaveSuccessNotice(false);
    setSaveErrorNotice(null);
    setAnalysisResult(null);
    setSelectedAnalysisActionIds(new Set());
    setAppliedNotice(null);
  };

  const handleTargetCountChange = (newCount: number) => {
    const clamped = Math.max(1, Math.min(15, newCount));
    if (clamped > units.length) {
      const toAdd = clamped - units.length;
      const additions: ATPUnitMapping[] = [];
      for (let i = 1; i <= toAdd; i++) {
        const ord = units.length + i;
        additions.push({
          id: `unit-${Date.now()}-${ord}-${Math.random().toString(36).substring(2, 6)}`,
          title: `Bab ${ord}`,
          order: ord,
          linkedTpIds: [],
          linkedAtpItemIds: [],
          materials: [],
        });
      }
      setUnits((prev) => [...prev, ...additions]);
      setHasChanges(true);
      setSaveSuccessNotice(false);
      setSaveErrorNotice(null);
      setAnalysisResult(null);
      setSelectedAnalysisActionIds(new Set());
      setAppliedNotice(null);
    } else if (clamped < units.length) {
      const removableCount = units.length - clamped;
      let removed = 0;
      const nextUnits = [...units];
      for (let i = nextUnits.length - 1; i >= 0 && removed < removableCount; i--) {
        if ((nextUnits[i].linkedAtpItemIds || []).length === 0 && (nextUnits[i].materials || []).length === 0) {
          nextUnits.splice(i, 1);
          removed++;
        }
      }
      if (removed > 0) {
        setUnits(nextUnits.map((u, idx) => ({ ...u, order: idx + 1 })));
        setHasChanges(true);
        setSaveSuccessNotice(false);
        setSaveErrorNotice(null);
        setAnalysisResult(null);
        setSelectedAnalysisActionIds(new Set());
        setAppliedNotice(null);
      }
    }
  };

  // Toggle specific TP membership for a Bab
  const handleToggleTpInBab = (unitId: string, tpId: string) => {
    setUnits((prev) =>
      prev.map((u) => {
        if (u.id !== unitId) return u;
        const currentTpIds = u.linkedTpIds || [];
        const isSelected = currentTpIds.includes(tpId);
        const nextTpIds = isSelected ? currentTpIds.filter(id => id !== tpId) : [...currentTpIds, tpId];
        const derived = deriveMappingAtpIds(nextTpIds, atp, tp);
        if (derived.issues.length) return u;

        // If unchecking, also remove from materials in this unit
        const nextMaterials = isSelected
          ? (u.materials || []).map((m) => ({
              ...m,
              linkedTpIds: (m.linkedTpIds || []).filter((id) => id !== tpId),
              linkedAtpItemIds: deriveMappingAtpIds((m.linkedTpIds || []).filter(id => id !== tpId), atp, tp).atpItemIds,
            }))
          : u.materials;

        return {
          ...u,
          linkedTpIds: nextTpIds,
          linkedAtpItemIds: derived.atpItemIds,
          materials: nextMaterials,
        };
      })
    );
    setHasChanges(true);
    setSaveSuccessNotice(false);
    setSaveErrorNotice(null);
    setAnalysisResult(null);
    setSelectedAnalysisActionIds(new Set());
    setAppliedNotice(null);
  };

  // Handlers for Lingkup Materi (Materials)
  const handleAddMaterial = (unitId: string) => {
    setUnits((prev) =>
      prev.map((u) => {
        if (u.id !== unitId) return u;
        const currentMaterials = u.materials || [];
        // A new teacher material starts without lineage; select its relevant TP explicitly.
        const defaultAtpIds: string[] = [];
        const defaultTpIds: string[] = [];
        const newMaterial: ATPUnitMaterial = {
          id: `mat-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          title: '',
          order: currentMaterials.length + 1,
          linkedTpIds: defaultTpIds,
          linkedAtpItemIds: defaultAtpIds,
        };
        return {
          ...u,
          materials: [...currentMaterials, newMaterial],
        };
      })
    );
    setHasChanges(true);
    setSaveSuccessNotice(false);
    setSaveErrorNotice(null);
    setAnalysisResult(null);
    setSelectedAnalysisActionIds(new Set());
    setAppliedNotice(null);
  };

  const handleMaterialTitleChange = (unitId: string, materialId: string, title: string) => {
    setUnits((prev) =>
      prev.map((u) => {
        if (u.id !== unitId) return u;
        const nextMaterials = (u.materials || []).map((m) =>
          m.id === materialId ? { ...m, title } : m
        );
        return {
          ...u,
          materials: nextMaterials,
        };
      })
    );
    setHasChanges(true);
    setSaveSuccessNotice(false);
    setSaveErrorNotice(null);
    setAnalysisResult(null);
    setSelectedAnalysisActionIds(new Set());
    setAppliedNotice(null);
  };

  const handleToggleMaterialTp = (unitId: string, materialId: string, tpId: string) => {
    setUnits(prev => prev.map(unit => {
      if (unit.id !== unitId) return unit;
      const materials = unit.materials.map(material => {
        if (material.id !== materialId) return material;
        const ids = material.linkedTpIds.includes(tpId)
          ? material.linkedTpIds.filter(id => id !== tpId) : [...material.linkedTpIds, tpId];
        const derived = deriveMappingAtpIds(ids, atp, tp);
        return derived.issues.length ? material : { ...material, linkedTpIds: ids, linkedAtpItemIds: derived.atpItemIds };
      });
      const ids = [...new Set([...unit.linkedTpIds, ...materials.flatMap(material => material.linkedTpIds)])];
      const derived = deriveMappingAtpIds(ids, atp, tp);
      return derived.issues.length ? unit : { ...unit, materials, linkedTpIds: ids, linkedAtpItemIds: derived.atpItemIds };
    }));
    setHasChanges(true); setSaveSuccessNotice(false); setSaveErrorNotice(null);
    setAnalysisResult(null); setSelectedAnalysisActionIds(new Set()); setAppliedNotice(null);
  };

  const handleRemoveMaterial = (unitId: string, materialId: string) => {
    setUnits((prev) =>
      prev.map((u) => {
        if (u.id !== unitId) return u;
        const filtered = (u.materials || []).filter((m) => m.id !== materialId);
        const renumbered = filtered.map((m, idx) => ({
          ...m,
          order: idx + 1,
        }));
        return {
          ...u,
          materials: renumbered,
        };
      })
    );
    setHasChanges(true);
    setSaveSuccessNotice(false);
    setSaveErrorNotice(null);
    setAnalysisResult(null);
    setSelectedAnalysisActionIds(new Set());
    setAppliedNotice(null);
  };

  const handleMoveMaterial = (unitId: string, materialIndex: number, direction: 'up' | 'down') => {
    setUnits((prev) =>
      prev.map((u) => {
        if (u.id !== unitId) return u;
        const mats = [...(u.materials || [])];
        const targetIdx = direction === 'up' ? materialIndex - 1 : materialIndex + 1;
        if (targetIdx < 0 || targetIdx >= mats.length) return u;

        const temp = mats[materialIndex];
        mats[materialIndex] = mats[targetIdx];
        mats[targetIdx] = temp;

        return {
          ...u,
          materials: mats.map((m, idx) => ({ ...m, order: idx + 1 })),
        };
      })
    );
    setHasChanges(true);
    setSaveSuccessNotice(false);
    setSaveErrorNotice(null);
    setAnalysisResult(null);
    setSelectedAnalysisActionIds(new Set());
    setAppliedNotice(null);
  };

  // Helper to build canonical ATPUnitMappingData from current live draft
  const buildCurrentMappingDraft = (): ATPUnitMappingData => {
    return buildCurrentMappingDraftFromUnits(
      units,
      mapping?.id,
      academicSetting?.id || atp.academicSettingId,
      atp.id,
      tp.id || atp.tpDataId,
      tp.updatedAt || atp.basedOnTpUpdatedAt,
      atp.updatedAt,
      computeTpSubstantiveFingerprint(tp),
      computeAtpSubstantiveFingerprint(atp)
    );
  };

  // AI Analysis State
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<MappingAnalysisResult | null>(null);
  const [lastAnalysisSnapshot, setLastAnalysisSnapshot] = useState<MappingAnalysisResult | null>(null);
  const [lastAppliedActionIds, setLastAppliedActionIds] = useState<string[]>([]);
  const [copyDiagnosticNotice, setCopyDiagnosticNotice] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [selectedAnalysisActionIds, setSelectedAnalysisActionIds] = useState<Set<string>>(new Set());
  const [appliedNotice, setAppliedNotice] = useState<string | null>(null);
  const [analysisFingerprint, setAnalysisFingerprint] = useState<string | null>(null);
  const [applyIssues, setApplyIssues] = useState<string[]>([]);
  const [alignmentRollback, setAlignmentRollback] = useState<{ units: ATPUnitMapping[]; fingerprint: string } | null>(null);
  const [isGeneratingStructure, setIsGeneratingStructure] = useState(false);
  const [generationPreview, setGenerationPreview] = useState<MappingGenerationPreview | null>(null);
  const [generationPreviewContext, setGenerationPreviewContext] = useState('');
  const [generationError, setGenerationError] = useState<string | null>(null);
  const generationContext = JSON.stringify({ units, atp, tp, academicSetting, cpAnalysis });
  const generationContextRef = useRef(generationContext);
  generationContextRef.current = generationContext;

  const handleGenerateStructure = async () => {
    const source = generationContextRef.current;
    const snapshot = structuredClone(units);
    setIsGeneratingStructure(true); setGenerationError(null); setGenerationPreview(null);
    try {
      const candidate = await generateCanonicalATPUnitMappingWithAI({
        academicSettingId: academicSetting?.id || atp.academicSettingId,
        subject: academicSetting?.subject, grade: academicSetting?.grade, phase: academicSetting?.phase,
        atpData: atp, tpData: tp, cpAnalysisData: cpAnalysis,
        // Omit existingMapping: its legacy branch aligns existing titles instead of composing anew.
        // Existing identity is reconciled conservatively in the approval preview.
        // No targetUnitCount: the existing engine recommends natural semantic clusters.
      });
      if (source !== generationContextRef.current) throw new Error('Draf atau sumber berubah selama penyusunan. Jalankan ulang.');
      setGenerationPreview(prepareMappingGenerationPreview(candidate, snapshot, atp, tp));
      setGenerationPreviewContext(source);
    } catch (error) { setGenerationError(error instanceof Error ? error.message : 'Penyusunan Bab gagal.'); }
    finally { setIsGeneratingStructure(false); }
  };

  const handleApproveStructure = () => {
    if (!generationPreview) return;
    try {
      if (generationPreviewContext !== generationContextRef.current) throw new Error('Draf atau konteks berubah sejak preview. Susun ulang untuk meninjau hasil terbaru.');
      const next = approveMappingGenerationPreview(generationPreview, units, atp, tp);
      setUnits(next); setHasChanges(true); setGenerationPreview(null); setGenerationError(null);
      setAnalysisResult(null); setAnalysisFingerprint(null); setSelectedAnalysisActionIds(new Set());
      setAlignmentRollback(null); setApplyIssues([]); setSaveSuccessNotice(false); setSaveErrorNotice(null);
      setAppliedNotice('Struktur AI disetujui dan diterapkan ke draf. Anda dapat mengedit Bab dan materi sebelum klik Simpan Pemetaan.');
    } catch (error) { setGenerationError(error instanceof Error ? error.message : 'Preview tidak dapat diterapkan.'); }
  };

  const unitsRef = useRef(units);
  useEffect(() => {
    unitsRef.current = units;
  }, [units]);

  const atpRef = useRef(atp);
  useEffect(() => {
    atpRef.current = atp;
  }, [atp]);

  const tpRef = useRef(tp);
  useEffect(() => {
    tpRef.current = tp;
  }, [tp]);

  const analysisRequestIdRef = useRef(0);

  // Import Bab & Materi State (Section 4, 5, 6)
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importPreviewResult, setImportPreviewResult] = useState<ATPUnitMappingImportResult | null>(null);
  const [importErrors, setImportErrors] = useState<string[] | null>(null);
  const [importSuccessNotice, setImportSuccessNotice] = useState<string | null>(null);

  // Section 6: ATP Readiness Gate for Import Bab & Materi (using canonical workflow authority)
  const notReadyMessage = 'ATP perlu ditinjau atau diperbarui sebelum mengimpor struktur Bab & Materi.';

  const atpWorkflowValidation = useMemo(() => {
    return validateATPDataWorkflow(atp, tp, academicSetting, cp, cpAnalysis);
  }, [atp, tp, academicSetting, cp, cpAnalysis]);

  const isATPReady = Boolean(atpWorkflowValidation.isSiap);

  const handleImportClick = () => {
    if (!isATPReady) {
      setImportErrors([
        notReadyMessage,
        ...(atpWorkflowValidation.issues || []),
      ]);
      return;
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!isATPReady) {
      setImportErrors([
        notReadyMessage,
        ...(atpWorkflowValidation.issues || []),
      ]);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setIsImporting(true);
    setImportErrors(null);

    try {
      const buffer = await file.arrayBuffer();
      const result = parseBabMateriXlsx(buffer);
      if (!result.success || !result.units || result.units.length === 0) {
        setImportErrors(result.errors || ['Gagal membaca file XLSX.']);
        setImportPreviewResult(null);
      } else {
        setImportPreviewResult(result);
        setImportErrors(null);
      }
    } catch (err: any) {
      setImportErrors([err?.message || 'Terjadi kesalahan saat memproses file XLSX.']);
      setImportPreviewResult(null);
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleApplyImportToDraft = () => {
    if (!importPreviewResult?.units || importPreviewResult.units.length === 0) return;

    setUnits(importPreviewResult.units);
    setHasChanges(true);

    // Section 5: Reset state analysis lama bila diperlukan
    setAnalysisResult(null);
    setLastAnalysisSnapshot(null);
    setLastAppliedActionIds([]);
    setSelectedAnalysisActionIds(new Set());
    setAppliedNotice(null);
    setSaveSuccessNotice(false);
    setSaveErrorNotice(null);
    setAnalysisFingerprint(null);

    const stats = importPreviewResult.stats;
    setImportSuccessNotice(
      `Berhasil menerapkan ${stats?.totalBabs || importPreviewResult.units.length} Bab dan ${stats?.totalMaterials || 0} Lingkup Materi ke Draf. Silakan klik 'Analisis & Selaraskan' untuk menyelaraskan dengan ATP & TP kanonikal.`
    );

    setImportPreviewResult(null);
  };

  const handleCancelImport = () => {
    setImportPreviewResult(null);
    setImportErrors(null);
  };

  const handleAnalyzeMapping = async () => {
    setIsAnalyzing(true);
    setAnalysisError(null);
    setAppliedNotice(null);

    const requestId = ++analysisRequestIdRef.current;
    const snapshotUnits = JSON.parse(JSON.stringify(unitsRef.current));
    const expectedFp = computeMappingFingerprint(snapshotUnits, atpRef.current, tpRef.current);

    const currentDraft = buildCurrentMappingDraftFromUnits(
      snapshotUnits,
      mapping?.id,
      academicSetting?.id || atpRef.current.academicSettingId,
      atpRef.current.id,
      tpRef.current.id || atpRef.current.tpDataId,
      tpRef.current.updatedAt || atpRef.current.basedOnTpUpdatedAt,
      atpRef.current.updatedAt,
      computeTpSubstantiveFingerprint(tpRef.current),
      computeAtpSubstantiveFingerprint(atpRef.current)
    );

    const guardResult = await runGuardedAnalysis({
      requestId,
      getCurrentRequestId: () => analysisRequestIdRef.current,
      unitsGetter: () => unitsRef.current,
      atpGetter: () => atpRef.current,
      tpGetter: () => tpRef.current,
      expectedFingerprint: expectedFp,
      fetchFn: () => analyzeATPUnitMappingWithAI({
        subject: academicSetting?.subject,
        grade: academicSetting?.grade,
        phase: academicSetting?.phase,
        tpData: tpRef.current,
        atpData: atpRef.current,
        currentMapping: currentDraft,
      }),
    });

    if (requestId !== analysisRequestIdRef.current) {
      return;
    }

    if (!guardResult.success) {
      if (!guardResult.isStaleOrOutdated) {
        setAnalysisError(guardResult.error || 'Gagal menganalisis pemetaan Bab & Lingkup Materi.');
        setAnalysisResult(null);
        setAnalysisFingerprint(null);
      } else {
        setAnalysisError(guardResult.error || 'Data Bab, ATP, atau TP berubah selama analisis. Jalankan analisis ulang.');
        setAnalysisResult(null);
        setAnalysisFingerprint(null);
      }
      setIsAnalyzing(false);
      return;
    }

    const freshFp = computeMappingFingerprint(unitsRef.current, atpRef.current, tpRef.current);
    setAnalysisResult(guardResult.result!);
    setLastAnalysisSnapshot(guardResult.result!);
    setAnalysisFingerprint(freshFp);
    setSelectedAnalysisActionIds(new Set());
    setIsAnalyzing(false);
  };

  const handleToggleAction = (findingId: string) => {
    setApplyIssues([]);
    const findings = [...(analysisResult?.atpFindings || []), ...(analysisResult?.materialFindings || [])];
    const target = findings.find(finding => finding.id === findingId)?.action?.targetUnitId;
    const bundle = findings.filter(finding => finding.action && finding.action.targetUnitId === target);
    setSelectedAnalysisActionIds(prev => {
      const legacyIds = new Set(findings.map(f => f.id));
      const next = new Set([...prev].filter(id => legacyIds.has(id))); const remove = prev.has(findingId);
      for (const finding of bundle) { if (remove) next.delete(finding.id); else next.add(finding.id); }
      return next;
    });
  };

  const handleSelectAllActionable = () => {
    if (!analysisResult) return;
    setApplyIssues([]);
    const allActionIds = new Set<string>();
    if (analysisResult.alignmentProposals?.some(p => alignmentProposalStatus(p) === 'READY')) {
      const materialKeys = new Set<string>();
      analysisResult.alignmentProposals.filter(p => alignmentProposalStatus(p) === 'READY').forEach(p => {
        const key = p.targetMaterialId || `${p.targetUnitId}:${p.action?.after || p.action?.type}`;
        if (!materialKeys.has(key)) { allActionIds.add(p.id); materialKeys.add(key); }
      });
      setSelectedAnalysisActionIds(allActionIds);
      return;
    }
    analysisResult.atpFindings.forEach((f) => {
      if (f.action) allActionIds.add(f.id);
    });
    analysisResult.materialFindings.forEach((m) => {
      if (m.action) allActionIds.add(m.id);
    });
    setSelectedAnalysisActionIds(allActionIds);
  };

  const handleDeselectAllActionable = () => {
    setApplyIssues([]);
    setSelectedAnalysisActionIds(new Set());
  };

  // Contract 2: Hitung selectedActions aktual dari analysisResult + selectedAnalysisActionIds sebelum render
  const selectedActions = useMemo(() => {
    return extractSelectedMappingActions(analysisResult, selectedAnalysisActionIds);
  }, [analysisResult, selectedAnalysisActionIds]);

  const currentFingerprint = useMemo(() => {
    return computeMappingFingerprint(units, atp, tp);
  }, [units, atp, tp]);

  // Contract 3 & 4: Kelayakan action nyata & alasan disabled
  const actionEligibility: ApplyActionEligibilityResult = useMemo(() => {
    return resolveApplyActionsEligibility({
      selectedCount: selectedAnalysisActionIds.size,
      selectedActions,
      units,
      atp,
      tp,
      expectedFingerprint: analysisFingerprint,
      currentFingerprint,
    });
  }, [
    selectedAnalysisActionIds.size,
    selectedActions,
    units,
    atp,
    tp,
    analysisFingerprint,
    currentFingerprint,
  ]);

  const handleApplySelectedActions = () => {
    if (!analysisResult || selectedAnalysisActionIds.size === 0) return;

    if (!actionEligibility.canApply) {
      if (actionEligibility.issues.length > 0) {
        setApplyIssues(actionEligibility.issues);
      }
      return;
    }

    const result = applyATPMappingActions({
      units,
      selectedActions,
      atp,
      tp,
      mappingId: mapping?.id,
      academicSettingId: academicSetting?.id,
      expectedFingerprint: analysisFingerprint,
      currentFingerprint,
    });

    if (!result.success || !result.nextUnits) {
      setAppliedNotice(null);
      const issues = result.issues && result.issues.length > 0 ? result.issues : ['Penerapan pilihan gagal.'];
      setApplyIssues(issues);
      setAnalysisError(issues.join('\n'));
      return;
    }

    setAlignmentRollback({ units: result.rollbackUnits || structuredClone(units), fingerprint: computeMappingFingerprint(result.nextUnits, atp, tp) });
    setUnits(result.nextUnits);
    setHasChanges(true);
    setLastAppliedActionIds([...selectedAnalysisActionIds]);
    setSelectedAnalysisActionIds(new Set());
    setApplyIssues([]);
    setAnalysisResult(null);
    setSaveSuccessNotice(false);
    setAnalysisFingerprint(null);
    const actualCoverage = mappingCoverage(result.nextUnits, atp, tp);
    setAppliedNotice(`Saran diterapkan ke draf. Sisa ATP belum dipetakan: ${actualCoverage.unmappedAtpIds.length}; TP belum tercakup: ${actualCoverage.uncoveredTpIds.length}. Klik Simpan Pemetaan untuk menyimpan.`);
  };

  const handleCopyDiagnostic = async () => {
    try {
      const currentDraft = buildCurrentMappingDraft();
      const validation = validateATPUnitMappingCanonical(currentDraft, atp, tp);
      const report = buildATPUnitMappingDiagnosticReport({
        academicSetting,
        mapping: currentDraft,
        atp,
        tp,
        validation,
        analysisResult: lastAnalysisSnapshot || analysisResult,
        appliedActionIds: lastAppliedActionIds,
      });

      await navigator.clipboard.writeText(report);
      setCopyDiagnosticNotice('Diagnosis berhasil disalin.');
      setTimeout(() => {
        setCopyDiagnosticNotice((prev) => (prev === 'Diagnosis berhasil disalin.' ? null : prev));
      }, 3500);
    } catch {
      setCopyDiagnosticNotice('Gagal menyalin diagnosis ke clipboard.');
      setTimeout(() => {
        setCopyDiagnosticNotice((prev) => (prev === 'Gagal menyalin diagnosis ke clipboard.' ? null : prev));
      }, 3500);
    }
  };

  // Save Mapping Canonical
  const handleSave = (): boolean => {
    const result = buildCurrentMappingDraft();
    const readiness = resolveATPUnitMappingReadiness(result, atp, tp, academicSetting);

    if (!readiness.canSaveDraft) {
      setSaveSuccessNotice(false);
      const errorMsg = readiness.blockers.length > 0 
        ? `Pemetaan tidak dapat disimpan: ${readiness.blockers[0]}`
        : 'Pemetaan tidak dapat disimpan: referensi atau identitas akademik tidak valid.';
      setSaveErrorNotice(errorMsg);
      setLocalValidationNotice(errorMsg);
      return false;
    }

    const validation = validateATPUnitMappingCanonical(result, atp, tp);

    if (!validation.isValid) {
      setSaveSuccessNotice(false);
      const errorMsg = validation.issues.length > 0
        ? `Pemetaan tidak valid: ${validation.issues.join(' ')}`
        : 'Pemetaan memiliki referensi tidak valid. Perbaiki silsilah/lineage sebelum menyimpan.';
      setSaveErrorNotice(errorMsg);
      setLocalValidationNotice(errorMsg);
      return false;
    }

    const saved = onSaveMapping(result);
    if (saved) {
      setHasChanges(false);
      setSaveSuccessNotice(true);
      setSaveErrorNotice(null);
      setLocalValidationNotice(null);
      setTimeout(() => setSaveSuccessNotice(false), 3500);
      return true;
    } else {
      setSaveSuccessNotice(false);
      setSaveErrorNotice(
        'Pemetaan belum tersimpan. Periksa pesan kesalahan di atas lalu coba Simpan kembali.'
      );
      return false;
    }
  };

  const handleProceedNext = () => {
    setLocalValidationNotice(null);

    const result = proceedWithATPUnitMapping(mappingReadiness, canSave ? handleSave : undefined, onNextStep);
    if (!result.proceeded) setLocalValidationNotice(`Belum dapat lanjut Step 08: ${result.issues.join(' ')}`);
  };

  // Button state logic for 4 conditions
  let saveButtonText = 'Simpan Pemetaan';
  let isSaveButtonDisabled = true;
  let saveButtonClass = 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed';

  if (hasCanonicalMapping) {
    if (hasChanges) {
      // Condition B: mapping ADA + hasChanges
      saveButtonText = 'Simpan Perubahan';
      isSaveButtonDisabled = false;
      saveButtonClass = 'text-white bg-blue-800 hover:bg-blue-900 ring-2 ring-blue-500/20 cursor-pointer shadow-xs';
    } else {
      // Condition A: mapping ADA + !hasChanges
      saveButtonText = localValidation.isValid && !localValidation.isComplete ? '✓ Draf tersimpan' : '✓ Tersimpan';
      isSaveButtonDisabled = true;
      saveButtonClass = 'text-emerald-700 bg-emerald-50 border border-emerald-200 cursor-default opacity-90';
    }
  } else {
    if (hasMeaningfulUnsavedDraft || hasChanges) {
      // Condition C: mapping BELUM ADA + hasMeaningfulUnsavedDraft
      saveButtonText = 'Simpan Pemetaan';
      isSaveButtonDisabled = false;
      saveButtonClass = 'text-white bg-blue-800 hover:bg-blue-900 ring-2 ring-blue-500/20 cursor-pointer shadow-xs';
    } else {
      // Condition D: mapping BELUM ADA + !hasChanges + !hasMeaningfulUnsavedDraft
      saveButtonText = 'Simpan Pemetaan';
      isSaveButtonDisabled = true;
      saveButtonClass = 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed';
    }
  }

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-blue-100 text-blue-900 text-xs font-bold flex items-center justify-center">
                07
              </span>
              <h3 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
                <FolderTree className="w-5 h-5 text-blue-700" />
                <span>Pemetaan ATP ke Unit / Bab & Lingkup Materi</span>
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-1 max-w-3xl leading-relaxed">
              Kelompokkan langkah-langkah Alur Tujuan Pembelajaran (ATP) ke dalam <strong>Unit / Bab</strong> dan rumuskan fokus <strong>Lingkup Materi Inti</strong>. Setiap Bab menjadi wadah tematis yang memayungi langkah ATP dan memuat banyak Lingkup Materi.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              id="btn-save-mapping"
              type="button"
              onClick={handleSave}
              disabled={isSaveButtonDisabled}
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition shadow-xs ${saveButtonClass}`}
            >
              {hasCanonicalMapping && !hasChanges ? (
                <Check className="w-3.5 h-3.5 text-emerald-600" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              <span>{saveButtonText}</span>
            </button>
          </div>
        </div>

        {/* Status Alerts */}
        {localValidationNotice && (
          <div className="mt-3 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-center justify-between gap-2 animate-fadeIn">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{localValidationNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setLocalValidationNotice(null)}
              className="text-xs font-bold text-rose-600 hover:underline cursor-pointer"
            >
              Tutup
            </button>
          </div>
        )}

        {saveErrorNotice && (
          <div className="mt-3 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-center justify-between gap-2 animate-fadeIn">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{saveErrorNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setSaveErrorNotice(null)}
              className="text-xs font-bold text-rose-600 hover:underline cursor-pointer"
            >
              Tutup
            </button>
          </div>
        )}

        {saveSuccessNotice && (
          <div className="mt-3 p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center gap-2 animate-fadeIn">
            <Check className="w-4 h-4 text-emerald-600" />
            <span>Perubahan pemetaan Unit/Bab dan Lingkup Materi berhasil disimpan ke Pemetaan Bab dan Lingkup Materi.</span>
          </div>
        )}

        {/* Applied Analysis Notice */}
        {appliedNotice && (
          <div className="mt-3 p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-semibold flex items-center justify-between gap-2 animate-fadeIn">
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{appliedNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setAppliedNotice(null)}
              className="text-xs font-bold text-emerald-700 hover:underline cursor-pointer"
            >
              Tutup
            </button>
          </div>
        )}

        {/* AI Generation Error Notice */}

        {/* AI Analysis Error Notice */}
        {analysisError && (
          <div className="mt-3 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-center justify-between gap-2 animate-fadeIn">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>Analisis Pemetaan gagal: {analysisError}</span>
            </div>
            <button
              type="button"
              onClick={() => setAnalysisError(null)}
              className="text-xs font-bold text-rose-600 hover:underline cursor-pointer"
            >
              Tutup
            </button>
          </div>
        )}

        {/* Structural Status Summary Banner (Readiness Summary C6) */}
        <div className="mt-3">
          {localValidation.isComplete ? (
            <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-semibold flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{localValidation.summaryMessage}</span>
              </div>
              <button
                type="button"
                onClick={handleCopyDiagnostic}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-emerald-300 text-emerald-700 hover:bg-emerald-100 text-[11px] font-bold shadow-2xs transition cursor-pointer shrink-0"
                title="Salin laporan diagnosis pemetaan ke clipboard"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Salin Diagnosis</span>
              </button>
            </div>
          ) : (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 space-y-2">
              <div className="flex items-center justify-between gap-2 text-xs font-bold">
                <div className="flex items-center gap-2">
                  <Info className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>{localValidation.summaryMessage}</span>
                </div>
                <button
                  type="button"
                  onClick={handleCopyDiagnostic}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-amber-300 text-amber-800 hover:bg-amber-100 text-[11px] font-bold shadow-2xs transition cursor-pointer shrink-0"
                  title="Salin laporan diagnosis pemetaan ke clipboard"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Salin Diagnosis</span>
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 px-6">
                <div className="text-[10px] flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${localValidation.unitsWithoutLineageCount > 0 ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                  <span>{localValidation.unitsWithoutLineageCount} Bab belum memiliki lineage</span>
                </div>
                <div className="text-[10px] flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${localValidation.materialsWithoutLineageCount > 0 ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                  <span>{localValidation.materialsWithoutLineageCount} Materi belum diselaraskan</span>
                </div>
                <div className="text-[10px] flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${localValidation.unmappedAtpAndUncoveredTpCount > 0 ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                  <span>{localValidation.unmappedAtpAndUncoveredTpCount} ATP/TP canonical tersisa (Z)</span>
                </div>
              </div>
            </div>
          )}

          {copyDiagnosticNotice && (
            <div className="mt-2 p-2 rounded-xl bg-slate-800 text-white text-xs font-medium flex items-center justify-between animate-fadeIn">
              <div className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>{copyDiagnosticNotice}</span>
              </div>
              <button
                type="button"
                onClick={() => setCopyDiagnosticNotice(null)}
                className="text-slate-400 hover:text-white cursor-pointer ml-2"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {hasChanges && !saveSuccessNotice && !saveErrorNotice && !localValidationNotice && (
          <div className="mt-3 p-2.5 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-xs font-medium flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-blue-600 shrink-0" />
            <span>Terdapat perubahan Unit/Bab atau Lingkup Materi yang belum disimpan. Klik "{saveButtonText}" atau lanjutkan untuk menyimpan.</span>
          </div>
        )}

        {importSuccessNotice && (
          <div className="mt-3 p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{importSuccessNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setImportSuccessNotice(null)}
              className="text-emerald-600 hover:text-emerald-900 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Main AI toolbar precedes manual/import controls at every viewport width. */}
      <div className="bg-white rounded-2xl border border-indigo-100 shadow-xs p-5 space-y-4">
        <div role="toolbar" aria-label="Bantuan AI Pemetaan Bab" id="mapping-ai-toolbar" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button id="btn-generate-mapping" type="button" onClick={handleGenerateStructure}
            disabled={isGeneratingStructure || isAnalyzing || !atp.items.length || !tp.items.length}
            className="flex items-center justify-center gap-2 w-full min-h-12 px-4 py-3 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white text-sm font-bold shadow-xs disabled:opacity-50 disabled:cursor-not-allowed">
            <Sparkles className={`w-5 h-5 shrink-0 ${isGeneratingStructure ? 'animate-spin' : ''}`} />
            <span>{isGeneratingStructure ? 'Menyusun...' : 'Susun dengan AI'}</span>
          </button>
          <button id="btn-analyze-mapping" type="button" onClick={handleAnalyzeMapping}
            disabled={isAnalyzing || isGeneratingStructure || units.length === 0}
            className="flex items-center justify-center gap-2 w-full min-h-12 px-4 py-3 rounded-xl border border-indigo-700 bg-white hover:bg-indigo-50 text-indigo-900 text-sm font-bold shadow-xs disabled:opacity-50 disabled:cursor-not-allowed">
            <Sparkles className={`w-5 h-5 shrink-0 ${isAnalyzing ? 'animate-spin' : ''}`} />
            <span>{isAnalyzing ? 'Menganalisis...' : 'Analisis & Selaraskan'}</span>
          </button>
        </div>
        <p className="text-xs text-slate-600">Susun dengan AI mengusulkan struktur baru dan jumlah Bab otomatis berdasarkan TP/ATP. Analisis &amp; Selaraskan menelaah struktur draf yang sudah ada.</p>
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Target Count Input & Add Bab */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 bg-slate-50 px-3.5 py-2 rounded-xl border border-slate-200">
              <label htmlFor="target-unit-count" className="text-xs font-bold text-slate-800 whitespace-nowrap">
                Jumlah Bab draf:
              </label>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleTargetCountChange(units.length - 1)}
                  disabled={units.length <= 1}
                  className="w-7 h-7 rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 flex items-center justify-center text-xs font-bold disabled:opacity-40 cursor-pointer"
                >
                  -
                </button>
                <input
                  id="target-unit-count"
                  type="number"
                  min={1}
                  max={15}
                  value={units.length}
                  onChange={(e) => handleTargetCountChange(parseInt(e.target.value, 10) || 1)}
                  className="w-12 text-center text-xs font-bold py-1 rounded-md border border-slate-300 bg-white"
                />
                <button
                  type="button"
                  onClick={() => handleTargetCountChange(units.length + 1)}
                  disabled={units.length >= 15}
                  className="w-7 h-7 rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 flex items-center justify-center text-xs font-bold disabled:opacity-40 cursor-pointer"
                >
                  +
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={handleAddEmptyBab}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-dashed border-indigo-300 text-indigo-700 hover:bg-indigo-50 text-xs font-bold transition cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Tambah Bab Baru</span>
            </button>
          </div>

          {/* Action Buttons: Import, AI Generate, AI Analyze */}
          <div className="flex items-center gap-2.5 flex-wrap">
            {/* Download Template Button */}
            <button
              id="btn-download-bab-materi-template"
              type="button"
              onClick={() => downloadBabMateriTemplateXlsx()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-bold shadow-2xs transition cursor-pointer"
              title="Download template Excel untuk struktur Bab & Materi"
            >
              <Download className="w-4 h-4 text-slate-600" />
              <span>Download Template</span>
            </button>

            {/* Import Bab & Materi Button */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleFileSelect}
            />
            <button
              id="btn-import-bab-materi"
              type="button"
              onClick={handleImportClick}
              disabled={!isATPReady || isImporting}
              title={
                !isATPReady
                  ? 'Selesaikan ATP terlebih dahulu sebelum mengimpor struktur Bab & Materi.'
                  : 'Impor struktur Bab dan Lingkup Materi dari file Excel (sheet BAB_MATERI)'
              }
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold border shadow-2xs transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                !isATPReady
                  ? 'bg-slate-100 border-slate-200 text-slate-400'
                  : 'bg-white border-emerald-300 text-emerald-800 hover:bg-emerald-50'
              }`}
            >
              <FileSpreadsheet className={`w-4 h-4 ${isImporting ? 'animate-spin' : 'text-emerald-700'}`} />
              <span>{isImporting ? 'Membaca XLSX...' : 'Import Bab & Materi'}</span>
            </button>

            {/* Import Preview Modal (Section 4, 7, 8) */}
            {importPreviewResult && importPreviewResult.units && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-fadeIn">
                <div className="bg-white rounded-2xl p-6 max-w-2xl w-full max-h-[88vh] flex flex-col space-y-4 shadow-2xl">
                  <div className="flex items-start justify-between border-b border-slate-100 pb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center">
                        <FileSpreadsheet className="w-5 h-5 text-emerald-700" />
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-900 text-sm">Pratinjau Import Bab & Lingkup Materi</h3>
                        <p className="text-xs text-slate-500">
                          Struktur Bab & Materi dari sheet <code>BAB_MATERI</code> berhasil divalidasi.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleCancelImport}
                      className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Stats Summary */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-emerald-50/60 border border-emerald-200 rounded-xl p-3 flex items-center justify-between">
                      <span className="text-xs font-semibold text-emerald-900">Jumlah Bab:</span>
                      <span className="text-sm font-extrabold text-emerald-700">
                        {importPreviewResult.stats?.totalBabs || importPreviewResult.units.length}
                      </span>
                    </div>
                    <div className="bg-indigo-50/60 border border-indigo-200 rounded-xl p-3 flex items-center justify-between">
                      <span className="text-xs font-semibold text-indigo-900">Jumlah Materi:</span>
                      <span className="text-sm font-extrabold text-indigo-700">
                        {importPreviewResult.stats?.totalMaterials || 0}
                      </span>
                    </div>
                  </div>

                  {/* Warnings & Notices (Section 7 & 8) */}
                  {hasCanonicalMapping && (
                    <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <p className="font-semibold leading-tight">
                          Pemetaan Bab sudah tersimpan. Struktur hasil import hanya akan mengganti draf saat ini. Data tersimpan baru berubah setelah Anda menekan Simpan Perubahan.
                        </p>
                        <p className="text-[11px] text-amber-800">
                          Perubahan pada struktur Bab/Materi dapat memengaruhi pemetaan Tujuan Pembelajaran (TP) yang sudah ada sebelumnya.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Lineage Isolation Notice (Section 3 & 9) */}
                  <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 text-xs flex items-center gap-2">
                    <Info className="w-4 h-4 text-blue-600 shrink-0" />
                    <span>
                      Struktur Bab & Materi diimpor dengan lineage kosong. Gunakan fitur <strong>Analisis & Selaraskan</strong> setelah menerapkan ke draf untuk menghubungkan dengan TP & ATP kanonikal.
                    </span>
                  </div>

                  {/* Scrollable List of Babs & Materials */}
                  <div className="flex-1 overflow-y-auto space-y-3 pr-1 border border-slate-200 rounded-xl p-3 bg-slate-50/30 max-h-[35vh]">
                    {importPreviewResult.units.map((u) => (
                      <div key={u.id} className="bg-white rounded-lg border border-slate-200 p-2.5 space-y-1.5 shadow-2xs">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-800 text-[11px] font-bold">
                              Bab {u.order}
                            </span>
                            <span className="font-bold text-slate-800 text-xs">{u.title}</span>
                          </div>
                          <span className="text-[11px] text-slate-500 font-medium">
                            {u.materials?.length || 0} materi
                          </span>
                        </div>
                        {u.materials && u.materials.length > 0 && (
                          <div className="pl-4 pt-1 space-y-1 border-t border-slate-100">
                            {u.materials.map((m) => (
                              <div key={m.id} className="flex items-center gap-2 text-[11px] text-slate-600">
                                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
                                <span className="text-slate-400 font-semibold">{m.order}.</span>
                                <span>{m.title}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Modal Actions */}
                  <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={handleCancelImport}
                      className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition cursor-pointer"
                    >
                      Batal
                    </button>
                    <button
                      id="btn-apply-import-to-draft"
                      type="button"
                      onClick={handleApplyImportToDraft}
                      className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold transition cursor-pointer shadow-xs"
                    >
                      Terapkan ke Draf
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Import Error Modal */}
            {importErrors && importErrors.length > 0 && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-fadeIn">
                <div className="bg-white rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-xl bg-red-100 text-red-700 flex items-center justify-center shrink-0">
                      <AlertCircle className="w-5 h-5 text-red-600" />
                    </div>
                    <div className="space-y-1">
                      <h3 className="font-bold text-slate-900 text-sm">Gagal Mengimpor File Excel</h3>
                      <p className="text-xs text-slate-500">
                        Ditemukan kesalahan validasi pada struktur file:
                      </p>
                    </div>
                  </div>

                  <div className="bg-red-50/60 border border-red-200 rounded-xl p-3 max-h-48 overflow-y-auto space-y-1.5 text-xs text-red-800">
                    {importErrors.map((err, idx) => (
                      <div key={idx} className="flex items-start gap-2">
                        <span className="font-bold text-red-500 shrink-0">•</span>
                        <span className="leading-relaxed">{err}</span>
                      </div>
                    ))}
                  </div>

                  <div className="flex justify-end pt-1">
                    <button
                      type="button"
                      onClick={() => setImportErrors(null)}
                      className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold transition cursor-pointer"
                    >
                      Tutup
                    </button>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>

        {/* Informational Guidance Notice */}
        <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/80 flex items-start gap-2.5 text-xs text-slate-600">
          <Info className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
          <p>
            {hasSubstantiveManualMappingContent ? (
              <>
                <strong>Authority Struktur Guru:</strong> Struktur Bab & Lingkup Materi manual adalah acuan utama. Analisis mengikuti Bab/Materi → TP relevan → ATP induk canonical. Setiap pilihan otomatis memilih satu bundle Bab lengkap. Fitur <em>Analisis Pemetaan</em> memberikan telaah keselarasan TP ↔ ATP dan saran opsional tanpa mengubah struktur Bab secara otomatis.
              </>
            ) : (
              <>
                <strong>Penyusunan Pemetaan Awal:</strong> Draf Pemetaan belum memiliki isi substantif. Anda dapat menyusun Bab & Lingkup Materi secara manual atau menggunakan <strong>Susun dengan AI</strong> untuk meninjau usulan pengelompokan TP & alur ATP sebelum menyetujuinya.
              </>
            )}
          </p>
        </div>
      </div>

      {generationError && <div role="alert" className="p-3 text-sm text-red-800 bg-red-50 rounded-xl">{generationError}</div>}
      {generationPreview && <section id="mapping-generation-preview" className="bg-white border rounded-xl p-4 space-y-3">
        <h3 className="font-bold">Preview struktur AI — belum mengubah draf</h3>
        <details className="text-xs">
          <summary>Struktur saat ini ({units.length} Bab) yang akan diganti</summary>
          {[...units].sort((a,b) => a.order-b.order).map(unit => <div key={unit.id} className="py-1">
            <strong>{unit.order}. {unit.title}</strong>: {(unit.materials || []).map(material => material.title).join('; ') || '(belum ada materi)'}
          </div>)}
        </details>
        <p className="text-xs">Rekomendasi AI: {generationPreview.candidate.units.length} Bab. Cakupan tervalidasi: seluruh {atp.items.length} ATP dan {tp.items.length} TP, termasuk dukungan materi.</p>
        {generationPreview.candidate.units.map(unit => <div key={unit.id} className="border-t pt-2 text-xs">
          <strong>Bab {unit.order}: {unit.title}</strong>
          <div>ATP: {unit.linkedAtpItemIds.join(', ')} · TP: {unit.linkedTpIds.map(id => tp.items.find(item => item.id === id)?.code || id).join(', ')}</div>
          <ul>{unit.materials.map(material => <li key={material.id}>{material.title} — TP: {material.linkedTpIds.map(id => tp.items.find(item => item.id === id)?.code || id).join(', ')}; ATP: {material.linkedAtpItemIds.join(', ')}</li>)}</ul>
        </div>)}
        <p className="text-xs">Persetujuan akan mengganti seluruh struktur Bab dan materi draf, termasuk isi manual/impor. Setelah diterapkan, Anda dapat mengedit judul, materi, dan pemetaan sebelum Simpan Pemetaan. Draf tersimpan belum berubah sampai disimpan.</p>
        <button type="button" id="btn-approve-generated-mapping" onClick={handleApproveStructure} className="px-3 py-2 rounded bg-indigo-700 text-white text-xs">Setujui dan Ganti Struktur Draf</button>
        <button type="button" onClick={() => setGenerationPreview(null)} className="ml-3 text-xs">Batalkan</button>
      </section>}
      {/* AI Analysis Findings Panel */}
      {alignmentRollback && (
        <button type="button" className="text-sm font-semibold text-amber-800" onClick={() => {
          const restored = rollbackATPMappingActions(unitsRef.current, alignmentRollback.units, alignmentRollback.fingerprint, atpRef.current, tpRef.current);
          if (!restored.success || !restored.nextUnits) { setApplyIssues(restored.issues); return; }
          setUnits(restored.nextUnits); setHasChanges(true);
          setAnalysisResult(null); setAnalysisFingerprint(null); setSelectedAnalysisActionIds(new Set());
          setAlignmentRollback(null); setAppliedNotice('Batch terakhir dibatalkan; materi asli dipulihkan ke draf. Simpan Pemetaan untuk menyimpan.');
        }}>Batalkan batch penyelarasan terakhir</button>
      )}
      {analysisResult && (
        <div className="bg-white rounded-2xl border-2 border-indigo-300 shadow-md p-5 space-y-5 animate-fadeIn">
          {(analysisResult.alignmentProposals?.length || analysisResult.gapFindings?.length) ? (
            <div className="space-y-3">
              <h4 className="font-bold text-sm">Preview perubahan minimal — pilih hanya perubahan yang disetujui</h4>
              <AlignmentProposalReview proposals={analysisResult.alignmentProposals || []}
                selectedIds={selectedAnalysisActionIds} onSelectionChange={ids => {
                  setSelectedAnalysisActionIds(ids); setApplyIssues([]);
                }} />
              <details><summary>Gap yang masih memerlukan penyelarasan</summary>
                {analysisResult.gapFindings?.map(gap => <p key={gap.kind+gap.id} className="text-xs">{gap.kind} {gap.id}: {gap.reason}</p>)}
              </details>
            </div>
          ) : null}
          {/* Analysis Header & Summary Metrics */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-indigo-100">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-700" />
                <h4 className="text-sm font-bold text-slate-900">
                  Hasil Analisis Pemetaan Manual ↔ TP ↔ ATP
                </h4>
                <span className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-800 text-[11px] font-bold border border-indigo-200">
                  Read-Only Analysis
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Tinjau temuan keselarasan di bawah. Pilih saran yang ingin diterapkan ke draft, lalu klik <strong>Terapkan Pilihan</strong>.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSelectAllActionable}
                className="text-xs font-bold text-indigo-700 hover:underline cursor-pointer"
              >
                Pilih Semua Saran
              </button>
              <span className="text-slate-300">•</span>
              <button
                type="button"
                onClick={handleDeselectAllActionable}
                className="text-xs font-bold text-slate-600 hover:underline cursor-pointer"
              >
                Kosongkan Pilihan
              </button>
              <span className="text-slate-300">•</span>
              <button
                type="button"
                onClick={() => setAnalysisResult(null)}
                className="text-xs font-bold text-slate-500 hover:underline cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>

          {/* Metrics Overview Pills */}
          <div className={`grid grid-cols-2 gap-3 ${analysisResult.summary.missingMaterialSuggestions > 0 ? 'sm:grid-cols-3 lg:grid-cols-6' : 'sm:grid-cols-5'}`}>
            <div className="bg-emerald-50/80 border border-emerald-200 rounded-xl p-3">
              <div className="text-[11px] font-bold text-emerald-800 uppercase">Selaras berdasarkan bukti</div>
              <div className="text-lg font-extrabold text-emerald-900 mt-0.5">
                {analysisResult.summary.alignedAtp} <span className="text-xs font-normal text-emerald-700">Langkah</span>
              </div>
            </div>

            <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-3">
              <div className="text-[11px] font-bold text-amber-800 uppercase">ATP Belum Dipetakan</div>
              <div className="text-lg font-extrabold text-amber-900 mt-0.5">
                {analysisResult.summary.unmappedAtp} <span className="text-xs font-normal text-amber-700">Langkah</span>
              </div>
            </div>

            <div className="bg-rose-50/80 border border-rose-200 rounded-xl p-3">
              <div className="text-[11px] font-bold text-rose-800 uppercase">ATP Perlu Ditinjau</div>
              <div className="text-lg font-extrabold text-rose-900 mt-0.5">
                {analysisResult.summary.reviewAtp} <span className="text-xs font-normal text-rose-700">Langkah</span>
              </div>
            </div>

            <div className="bg-indigo-50/80 border border-indigo-200 rounded-xl p-3">
              <div className="text-[11px] font-bold text-indigo-800 uppercase">Materi Dapat Diselaraskan</div>
              <div className="text-lg font-extrabold text-indigo-900 mt-0.5">
                {analysisResult.summary.alignableMaterials} <span className="text-xs font-normal text-indigo-700">Materi</span>
              </div>
            </div>

            {analysisResult.summary.missingMaterialSuggestions > 0 && (
              <div className="bg-blue-50/80 border border-blue-200 rounded-xl p-3">
                <div className="text-[11px] font-bold text-blue-800 uppercase">Saran Materi Baru</div>
                <div className="text-lg font-extrabold text-blue-900 mt-0.5">
                  {analysisResult.summary.missingMaterialSuggestions} <span className="text-xs font-normal text-blue-700">Saran</span>
                </div>
              </div>
            )}

            <div className="bg-slate-50 border border-slate-300 rounded-xl p-3">
              <div className="text-[11px] font-bold text-slate-700 uppercase">Materi Perlu Ditinjau</div>
              <div className="text-lg font-extrabold text-slate-900 mt-0.5">
                {analysisResult.summary.manualMaterialReview} <span className="text-xs font-normal text-slate-600">Materi</span>
              </div>
            </div>
          </div>

          {/* Findings Detail List */}
          <div className="space-y-4 pt-1">
            {/* 1. Unmapped ATP Findings with Suggestions */}
            {analysisResult.atpFindings.filter((f) => f.status === 'UNMAPPED').length > 0 && (
              <div className="space-y-2.5">
                <h5 className="text-xs font-bold text-amber-950 uppercase tracking-wider flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 text-amber-700" />
                  <span>Saran Pemetaan Langkah ATP yang Belum Terpetakan</span>
                </h5>

                <div className="space-y-2">
                  {analysisResult.atpFindings
                    .filter((f) => f.status === 'UNMAPPED')
                    .map((finding) => {
                      const atpItem = atpItemMap.get(finding.atpItemId);
                      const targetUnit = units.find((u) => u.id === finding.suggestedUnitId);
                      const isSelected = selectedAnalysisActionIds.has(finding.id);

                      return (
                        <div
                          key={finding.id}
                          className={`p-3.5 rounded-xl border transition flex flex-col md:flex-row md:items-center justify-between gap-3 ${
                            isSelected
                              ? 'bg-amber-50/90 border-amber-400 ring-1 ring-amber-300'
                              : 'bg-white border-slate-200 hover:border-amber-200'
                          }`}
                        >
                          <div className="flex items-start gap-3 flex-1">
                            {finding.action && (
                              <input
                                id={`check-${finding.id}`}
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => handleToggleAction(finding.id)}
                                className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 mt-1 cursor-pointer"
                              />
                            )}
                            <div className="space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="px-2 py-0.5 rounded-md bg-amber-800 text-white font-bold text-xs">
                                  Langkah {atpItem?.stepNumber || '?'}
                                </span>
                                {atpItem?.focus && (
                                  <span className="font-semibold text-xs text-slate-800">
                                    {atpItem.focus}
                                  </span>
                                )}
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                                  Kekuatan: {finding.strength === 'STRONG' ? 'Kuat' : finding.strength === 'LOW' ? 'Rendah' : 'Sedang'}
                                </span>
                              </div>

                              <p className="text-xs text-slate-600 leading-relaxed">
                                {finding.reason}
                              </p>

                              {targetUnit && (
                                <div className="text-xs font-bold text-indigo-900 bg-indigo-50/80 px-2.5 py-1 rounded-lg inline-block border border-indigo-200">
                                  Saran Bab: Bab {targetUnit.order}: {targetUnit.title}
                                </div>
                              )}
                            </div>
                          </div>

                          {finding.action && (
                            <label
                              htmlFor={`check-${finding.id}`}
                              className="text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-xl border border-indigo-200 shrink-0 cursor-pointer text-center"
                            >
                              {isSelected ? '✓ Terpilih' : 'Terapkan saran ini'}
                            </label>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {/* 2. Review ATP Findings */}
            {analysisResult.atpFindings.filter((f) => f.status === 'REVIEW').length > 0 && (
              <div className="space-y-2.5">
                <h5 className="text-xs font-bold text-rose-950 uppercase tracking-wider flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 text-rose-700" />
                  <span>Perlu tinjauan keselarasan</span>
                </h5>

                <div className="space-y-2">
                  {analysisResult.atpFindings
                    .filter((f) => f.status === 'REVIEW')
                    .map((finding) => {
                      const atpItem = atpItemMap.get(finding.atpItemId);
                      const currentUnit = units.find((u) => u.id === finding.currentUnitId);

                      return (
                        <div
                          key={finding.id}
                          className="p-3.5 rounded-xl bg-rose-50/50 border border-rose-200 flex flex-col md:flex-row md:items-center justify-between gap-3"
                        >
                          <div className="space-y-1 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 rounded-md bg-rose-800 text-white font-bold text-xs">
                                Langkah {atpItem?.stepNumber || '?'}
                              </span>
                              {currentUnit && (
                                <span className="text-xs text-slate-600 font-semibold">
                                  (Saat ini di Bab {currentUnit.order}: {currentUnit.title})
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-rose-900 leading-relaxed">
                              {finding.reason}
                            </p>
                          </div>
                          <span className="text-[11px] font-bold text-rose-700 bg-rose-100 px-2.5 py-1 rounded-lg border border-rose-300 shrink-0">
                            Perlu tinjauan keselarasan
                          </span>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {/* 3. Missing Material Findings */}
            {analysisResult.materialFindings.filter((m) => m.status === 'MISSING_MATERIAL').length > 0 && (
              <div className="space-y-2.5">
                <h5 className="text-xs font-bold text-blue-950 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-blue-700" />
                  <span>Saran Penambahan Lingkup Materi</span>
                </h5>

                <div className="space-y-2">
                  {analysisResult.materialFindings
                    .filter((m) => m.status === 'MISSING_MATERIAL')
                    .map((finding) => {
                      const targetUnit = units.find((u) => u.id === finding.unitId);
                      const isSelected = selectedAnalysisActionIds.has(finding.id);

                      return (
                        <div
                          key={finding.id}
                          className={`p-3.5 rounded-xl border transition flex flex-col md:flex-row md:items-center justify-between gap-3 ${
                            isSelected
                              ? 'bg-blue-50/90 border-blue-400 ring-1 ring-blue-300'
                              : 'bg-white border-slate-200 hover:border-blue-200'
                          }`}
                        >
                          <div className="flex items-start gap-3 flex-1">
                            {finding.action && (
                              <input
                                id={`check-${finding.id}`}
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => handleToggleAction(finding.id)}
                                className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 mt-1 cursor-pointer"
                              />
                            )}
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="px-2 py-0.5 rounded-md bg-blue-800 text-white font-bold text-xs">
                                  + {finding.suggestedTitle || (finding.action?.type === 'ADD_MATERIAL_TO_UNIT' ? finding.action.title : '')}
                                </span>
                                {targetUnit && (
                                  <span className="text-xs text-slate-700 font-semibold">
                                    untuk Bab {targetUnit.order}: {targetUnit.title}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-slate-600 leading-relaxed">
                                {finding.reason}
                              </p>
                            </div>
                          </div>

                          {finding.action && (
                            <label
                              htmlFor={`check-${finding.id}`}
                              className="text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-xl border border-blue-200 shrink-0 cursor-pointer text-center"
                            >
                              {isSelected ? '✓ Terpilih' : 'Tambahkan materi ini'}
                            </label>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {/* 3.5. Aligned Existing Material Suggestions */}
            {analysisResult.materialFindings.filter((m) => m.status === 'ALIGNABLE').length > 0 && (
              <div className="space-y-2.5">
                <h5 className="text-xs font-bold text-indigo-950 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-indigo-700" />
                  <span>Materi yang Dapat Diselaraskan</span>
                </h5>

                <div className="space-y-2">
                  {analysisResult.materialFindings
                    .filter((m) => m.status === 'ALIGNABLE')
                    .map((finding) => {
                      const targetUnit = units.find((u) => u.id === finding.unitId);
                      const targetMat = (targetUnit?.materials || []).find((mat) => mat.id === finding.materialId);
                      const isSelected = selectedAnalysisActionIds.has(finding.id);

                      const recAtpId = finding.action?.type === 'ALIGN_EXISTING_MATERIAL' || finding.action?.type === 'RECOVER_ATP_LINEAGE' ? finding.action.linkedAtpItemIds[0] : null;
                      const recAtpItem = recAtpId ? atpItemMap.get(recAtpId) : null;

                      const recTpIds = finding.action?.type === 'ALIGN_EXISTING_MATERIAL' || finding.action?.type === 'RECOVER_ATP_LINEAGE' ? finding.action.linkedTpIds : [];
                      const recTps = recTpIds.map((tpId) => (tp.items || []).find((t) => t.id === tpId)).filter(Boolean);

                      return (
                        <div
                          key={finding.id}
                          className={`p-3.5 rounded-xl border transition flex flex-col md:flex-row md:items-center justify-between gap-3 ${
                            isSelected
                              ? 'bg-indigo-50/90 border-indigo-400 ring-1 ring-indigo-300'
                              : 'bg-white border-slate-200 hover:border-indigo-200'
                          }`}
                        >
                          <div className="flex items-start gap-3 flex-1">
                            {finding.action && (
                              <input
                                id={`check-${finding.id}`}
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => handleToggleAction(finding.id)}
                                className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 mt-1 cursor-pointer"
                              />
                            )}
                            <div className="space-y-1 flex-1">
                              <div className="flex flex-col gap-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  {targetUnit && (
                                    <span className="px-2 py-0.5 rounded-md bg-indigo-800 text-white font-bold text-[10px]">
                                      Bab {targetUnit.order}: {targetUnit.title}
                                    </span>
                                  )}
                                  <span className="font-bold text-xs text-slate-900">
                                    Materi manual: {targetMat?.title || '(Tanpa Judul)'}
                                  </span>
                                </div>
                                {recAtpItem && (
                                  <div className="text-[11px] text-slate-700">
                                    <span className="font-semibold">Saran ATP:</span> Langkah {recAtpItem.stepNumber || '?'}: {recAtpItem.focus || 'Fokus ATP'}
                                  </div>
                                )}
                                {recTps.length > 0 && (
                                  <div className="text-[11px] text-slate-700 flex flex-wrap gap-1.5 items-center">
                                    <span className="font-semibold">Saran TP:</span>
                                    {recTps.map((t) => (
                                      <span key={t?.id} className="inline-block px-1.5 py-0.5 bg-slate-100 rounded text-slate-800 font-medium text-[10px] border border-slate-200">
                                        {t?.code || 'TP'}: {t?.statement}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <p className="text-xs text-slate-600 leading-relaxed mt-1">
                                {finding.reason}
                              </p>
                            </div>
                          </div>

                          {finding.action && (
                            <label
                              htmlFor={`check-${finding.id}`}
                              className="text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-xl border border-indigo-200 shrink-0 cursor-pointer text-center"
                            >
                              {isSelected ? '✓ Terpilih' : 'Selaraskan materi ini'}
                            </label>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {/* 4. Manual Material Review Findings */}
            {analysisResult.materialFindings.filter((m) => m.status === 'MANUAL_REVIEW').length > 0 && (
              <div className="space-y-2.5">
                <h5 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 text-slate-600" />
                  <span>Perlu tinjauan guru</span>
                </h5>

                <div className="space-y-2">
                  {analysisResult.materialFindings
                    .filter((m) => m.status === 'MANUAL_REVIEW')
                    .map((finding) => {
                      const unit = units.find((u) => u.id === finding.unitId);
                      const mat = (unit?.materials || []).find((m) => m.id === finding.materialId);

                      return (
                        <div
                          key={finding.id}
                          className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3"
                        >
                          <div className="space-y-1 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              {unit && (
                                <span className="px-2 py-0.5 rounded-md bg-slate-800 text-white font-bold text-xs">
                                  Bab {unit.order}: {unit.title}
                                </span>
                              )}
                              <span className="font-bold text-xs text-slate-900">
                                Materi: {mat?.title || finding.suggestedTitle || '(Tanpa Judul)'}
                              </span>
                            </div>
                            <p className="text-xs text-slate-600 leading-relaxed">
                              {finding.reason}
                            </p>
                          </div>

                          <span className="text-[11px] font-bold text-slate-700 bg-slate-200/80 px-2.5 py-1 rounded-lg border border-slate-300 shrink-0">
                            Perlu ditinjau guru
                          </span>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {/* 5. Aligned ATP List (Collapsed overview) */}
            {analysisResult.atpFindings.filter((f) => f.status === 'ALIGNED').length > 0 && (
              <details className="bg-slate-50/70 p-3 rounded-xl border border-slate-200 text-xs text-slate-700 space-y-2">
                <summary className="font-bold text-emerald-800 cursor-pointer hover:underline">
                  Lihat {analysisResult.summary.alignedAtp} Langkah ATP Selaras berdasarkan bukti yang tersedia
                </summary>
                <div className="space-y-1.5 pt-2">
                  {analysisResult.atpFindings
                    .filter((f) => f.status === 'ALIGNED')
                    .map((finding) => {
                      const atpItem = atpItemMap.get(finding.atpItemId);
                      const unit = units.find((u) => u.id === finding.currentUnitId);
                      return (
                        <div key={finding.id} className="flex items-center justify-between text-xs py-1 border-b border-slate-200/60 last:border-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900">Langkah {atpItem?.stepNumber || '?'}:</span>
                            <span>{atpItem?.focus || 'Fokus ATP'}</span>
                          </div>
                          {unit && (
                            <span className="text-[11px] font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                              Bab {unit.order}: {unit.title}
                            </span>
                          )}
                        </div>
                      );
                    })}
                </div>
              </details>
            )}

            {/* 6. Supported Materials List (Collapsed overview) */}
            {analysisResult.materialFindings.filter((m) => m.status === 'SUPPORTED').length > 0 && (
              <details className="bg-slate-50/70 p-3 rounded-xl border border-slate-200 text-xs text-slate-700 space-y-2">
                <summary className="font-bold text-emerald-800 cursor-pointer hover:underline">
                  Lihat {analysisResult.materialFindings.filter((m) => m.status === 'SUPPORTED').length} Materi selaras berdasarkan bukti yang tersedia
                </summary>
                <div className="space-y-1.5 pt-2">
                  {analysisResult.materialFindings
                    .filter((m) => m.status === 'SUPPORTED')
                    .map((finding) => {
                      const unit = units.find((u) => u.id === finding.unitId);
                      const mat = (unit?.materials || []).find((m) => m.id === finding.materialId);
                      return (
                        <div key={finding.id} className="flex items-center justify-between text-xs py-1 border-b border-slate-200/60 last:border-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900">Bab {unit?.order || '?'}:</span>
                            <span>{mat?.title || 'Materi'}</span>
                          </div>
                          <span className="text-[11px] font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                            Selaras berdasarkan bukti
                          </span>
                        </div>
                      );
                    })}
                </div>
              </details>
            )}
          </div>

          {/* Informative warnings also remain visible when executable actions can be applied. */}
          {actionEligibility.diagnosticWarning && (
            <div
              id="apply-actions-diagnostic-warning"
              className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs flex items-start gap-2.5 animate-fadeIn"
            >
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-bold text-amber-950">Diagnostik Pilihan Saran:</p>
                <p className="leading-relaxed">
                  {actionEligibility.diagnosticWarning || `Anda telah memilih ${selectedAnalysisActionIds.size} saran, namun pilihan tersebut tidak memiliki tindakan otomatis (action) yang valid untuk diterapkan ke draft. Saran ini bersifat tinjauan atau rekomendasi manual.`}
                </p>
              </div>
            </div>
          )}

          {/* Stale Analysis Warning */}
          {selectedAnalysisActionIds.size > 0 && selectedActions.length > 0 && actionEligibility.disabledReason === 'hasil analisis stale/kedaluwarsa' && (
            <div
              id="apply-actions-stale-warning"
              className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs flex items-start gap-2.5 animate-fadeIn"
            >
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-bold text-amber-950">Hasil Analisis Kedaluwarsa:</p>
                <p className="leading-relaxed">
                  {actionEligibility.diagnosticWarning || 'Hasil analisis sudah kedaluwarsa karena struktur Bab atau data telah berubah setelah analisis. Jalankan analisis ulang.'}
                </p>
              </div>
            </div>
          )}

          {/* Action Issues Panel on Apply Failure: Contract 6 */}
          {applyIssues.length > 0 && (
            <div
              id="apply-actions-issues-panel"
              className="p-3.5 rounded-xl bg-rose-50 border border-rose-300 text-rose-900 text-xs space-y-2 animate-fadeIn"
            >
              <div className="flex items-center gap-2 font-bold text-rose-950">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>Gagal Menerapkan Pilihan ({applyIssues.length} kendala terdeteksi):</span>
              </div>
              <ul className="list-disc list-inside space-y-1 pl-1 text-rose-800 font-medium">
                {applyIssues.map((issue, idx) => (
                  <li key={idx} className="leading-relaxed">{issue}</li>
                ))}
              </ul>
              <p className="text-[11px] text-rose-700 font-semibold">
                Silakan sesuaikan pilihan saran atau lakukan analisis ulang untuk memperbarui rekomendasi.
              </p>
            </div>
          )}

          {/* Action Footer inside Panel */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-indigo-100">
            <div className="flex flex-col gap-1 w-full sm:w-auto">
              <div className="text-xs text-slate-500">
                Terpilih: <strong className="text-slate-800">{selectedAnalysisActionIds.size}</strong> saran{' '}
                <span className="text-slate-400">({selectedActions.length} action valid)</span>
              </div>
              <details id="apply-actions-preview-diagnostics" className="text-xs text-slate-500">
                <summary className="cursor-pointer">Detail pemeriksaan pilihan</summary>
                <div>selectedFindingCount: {actionEligibility.selectedFindingCount}</div>
                <div>executableActionCount: {actionEligibility.executableActionCount}</div>
                <div>previewSuccess: {String(actionEligibility.previewSuccess)}</div>
                <div>previewIssues:</div>
                <ul>{actionEligibility.previewIssues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>
              </details>
              {!actionEligibility.canApply && actionEligibility.disabledReason && (
                <div
                  id="apply-actions-disabled-reason"
                  className="flex items-center gap-1.5 text-xs text-amber-800 font-medium bg-amber-50/80 px-2.5 py-1 rounded-lg border border-amber-200"
                >
                  <Info className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>Alasan tombol nonaktif: <strong>{actionEligibility.disabledReason}</strong></span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => setAnalysisResult(null)}
                className="w-full sm:w-auto px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 border border-slate-200 transition cursor-pointer"
              >
                Tutup Hasil
              </button>

              <button
                id="btn-apply-analysis-actions"
                type="button"
                onClick={handleApplySelectedActions}
                disabled={!actionEligibility.canApply}
                title={actionEligibility.disabledReason || 'Terapkan pilihan saran ke draf'}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-5 py-2 rounded-xl text-xs font-bold text-white bg-indigo-800 hover:bg-indigo-900 disabled:bg-slate-200 disabled:text-slate-400 transition cursor-pointer shadow-xs disabled:cursor-not-allowed"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Terapkan Pilihan ({selectedActions.length})</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Overview Stat Bar */}
      <div className="flex items-center justify-between text-xs text-slate-500 px-1">
        <div className="flex items-center gap-2 font-semibold">
          <Layers className="w-4 h-4 text-blue-700" />
          <span>Struktur Unit: {units.length} Bab Terdaftar</span>
        </div>
        <div>
          <span>Terpetakan: <strong className="text-slate-800">{mappedCount}</strong> dari {sortedAtpItems.length} Langkah ATP</span>
        </div>
      </div>

      {/* Bab-Centered Editor: List of Bab Containers */}
      <div className="space-y-6">
        {units.map((unit, bIdx) => {
          const assignedItemIds = unit.linkedAtpItemIds || [];

          return (
            <div
              key={unit.id || `unit-${bIdx}`}
              className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden transition"
            >
              {/* Bab Container Header */}
              <div className="bg-slate-50/90 p-4 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex items-center gap-3 flex-1">
                  <span className="px-3 py-1 rounded-xl bg-blue-900 text-white font-bold text-xs shrink-0 shadow-2xs">
                    BAB {bIdx + 1}
                  </span>
                  <div className="flex-1 flex items-center gap-2">
                    <label htmlFor={`bab-title-input-${unit.id}`} className="sr-only">Judul Bab</label>
                    <input
                      id={`bab-title-input-${unit.id}`}
                      type="text"
                      value={unit.title}
                      placeholder={`Judul Bab ${bIdx + 1}...`}
                      onChange={(e) => handleRenameBab(unit.id, e.target.value)}
                      className="w-full text-sm font-bold text-slate-900 px-3 py-1.5 rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-600 bg-white"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] font-bold text-slate-500 bg-white px-2.5 py-1 rounded-lg border border-slate-200">
                    {assignedItemIds.length} Langkah ATP
                  </span>
                  <span className="text-[11px] font-bold text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-lg border border-indigo-200">
                    {(unit.materials || []).length} Lingkup Materi
                  </span>

                  {assignedItemIds.length === 0 && (
                    <button
                      type="button"
                      title="Hapus Bab Kosong Ini"
                      onClick={() => handleRemoveBab(unit.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-rose-600 hover:bg-rose-50 border border-rose-200 text-xs font-bold transition cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Hapus Bab</span>
                    </button>
                  )}
                </div>
              </div>

              {/* SECTION: Lingkup Materi (0..n per Bab) */}
              <div className="p-4 sm:p-5 border-b border-slate-200/80 bg-slate-50/40 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-indigo-700" />
                    <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                      Lingkup Materi ({(unit.materials || []).length})
                    </span>
                    <span className="text-[11px] text-slate-500 hidden sm:inline">
                      • Materi pokok / topik yang dipelajari pada Bab ini
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleAddMaterial(unit.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold transition cursor-pointer border border-indigo-200 shadow-2xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Tambah Lingkup Materi</span>
                  </button>
                </div>

                {(!unit.materials || unit.materials.length === 0) ? (
                  <div className="p-4 rounded-xl border border-dashed border-slate-200 bg-white text-center text-xs text-slate-400">
                    Belum ada lingkup materi pada Bab ini. Klik <strong>"+ Tambah Lingkup Materi"</strong> untuk menambahkan topik materi.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {unit.materials.map((mat, mIdx) => (
                      <div
                        key={mat.id}
                        className="p-3 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-2.5"
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-md bg-indigo-50 text-indigo-700 text-xs font-bold flex items-center justify-center shrink-0">
                            {mIdx + 1}
                          </span>
                          <input
                            type="text"
                            value={mat.title}
                            placeholder={`Topik / Lingkup Materi ${mIdx + 1}...`}
                            onChange={(e) => handleMaterialTitleChange(unit.id, mat.id, e.target.value)}
                            className="flex-1 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-indigo-600 bg-white"
                          />
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleMoveMaterial(unit.id, mIdx, 'up')}
                              disabled={mIdx === 0}
                              className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-20 cursor-pointer"
                              title="Geser naik"
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMoveMaterial(unit.id, mIdx, 'down')}
                              disabled={mIdx === unit.materials.length - 1}
                              className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-20 cursor-pointer"
                              title="Geser turun"
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveMaterial(unit.id, mat.id)}
                              className="p-1 text-slate-400 hover:text-rose-600 transition cursor-pointer"
                              title="Hapus lingkup materi"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2 text-xs">
                          {(tp.items || []).map(item => <label key={item.id} className="flex items-start gap-1 p-1 border rounded">
                            <input type="checkbox" checked={mat.linkedTpIds.includes(item.id)} onChange={() => handleToggleMaterialTp(unit.id, mat.id, item.id)} />
                            <span>[{item.code}] {item.statement}</span>
                          </label>)}
                        </div>

                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="p-4 space-y-3">
                <h4 className="text-xs font-bold">Pilih TP relevan untuk Bab ini</h4>
                <p className="text-xs text-slate-500">Urutan Bab mengikuti penyajian guru. Nomor tahap ATP mengikuti progresi pedagogis; satu ATP dapat mendukung beberapa Bab dengan subset TP berbeda.</p>
                {(tp.items || []).map(item => <label key={item.id} className="flex gap-2 text-xs p-2 border rounded-lg">
                  <input type="checkbox" checked={unit.linkedTpIds.includes(item.id)} onChange={() => handleToggleTpInBab(unit.id, item.id)} />
                  <span>[{item.code}] {item.statement}</span>
                </label>)}
                <p className="text-xs font-semibold">ATP induk canonical: {assignedItemIds.map(id => {
                  const item = atpItemMap.get(id);
                  return item ? 'Tahap '+item.stepNumber+' — '+item.focus : 'ID tidak valid: '+id;
                }).join('; ') || 'Belum ada TP dipilih'}</p>
              </div>
            </div>
          );
        })}

        {unassignedItems.length > 0 && <p className="p-4 text-xs text-amber-900 bg-amber-50 rounded-xl">ATP belum tercakup: {unassignedItems.map(item => 'Tahap '+item.stepNumber).join(', ')}. Pilih TP relevan pada Bab/Materi; induk ATP diturunkan otomatis tanpa memindahkan ATP dari Bab lain.</p>}
      </div>

      {/* Navigation Buttons */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-slate-200">
        <button
          id="btn-back-to-atp"
          type="button"
          onClick={onBackToATP}
          className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 shadow-xs transition cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Kembali ke Alur Tujuan Pembelajaran (06)</span>
        </button>

        <div className="flex flex-col items-stretch gap-2 w-full sm:max-w-xl" aria-live="polite">
          {!mappingReadiness.canProceed && <div id="mapping-proceed-blockers" role="status"
            className="border border-amber-300 bg-amber-50 text-amber-900 rounded-lg p-3 text-sm space-y-2">
            <p className="font-semibold">Belum dapat lanjut Step 08</p>
            <ul className="list-disc pl-5 space-y-1">{mappingReadiness.blockers.map((issue, index) => <li key={index}>{issue}</li>)}</ul>
            <p>Lengkapi relasi pada Lingkup Materi yang sesuai dengan TP/ATP Bab. Gunakan Analisis &amp; Selaraskan untuk meninjau saran, lalu simpan draf.</p>
            <button type="button" className="font-semibold text-blue-800 underline" onClick={() => {
              const unitId = mappingReadiness.validationResult?.materialCoverageGaps[0]?.unitId || units[0]?.id;
              const input = document.getElementById(`bab-title-input-${unitId}`);
              input?.scrollIntoView({ behavior: 'smooth', block: 'center' }); input?.focus();
            }}>Tinjau Bab dan Lingkup Materi</button>
          </div>}
          {(saveErrorNotice || localValidationNotice) && <p role="alert" className="text-sm text-red-700">{saveErrorNotice || localValidationNotice}</p>}
          <button
            id="btn-next-to-annual-planning"
            type="button"
            onClick={handleProceedNext}
            aria-describedby={!mappingReadiness.canProceed ? 'mapping-proceed-blockers' : undefined}
            className="w-full sm:w-auto flex items-center justify-center gap-2 bg-blue-900 hover:bg-blue-950 text-white py-2.5 px-6 rounded-xl text-sm font-semibold shadow-sm transition cursor-pointer"
          >
            <span>Lanjut ke Perencanaan Tahunan (08)</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
