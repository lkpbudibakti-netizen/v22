import { runStep07AutoRepair, step07RepairColor, undoStep07AutoRepair } from '../services/step07AutoRepairService';
import {STEP07_SEMANTIC_POLICY_VERSION} from '../services/step07AutoExecutionPolicy';
import { getATPUnitMappingV5 } from '../services/storageV5';
import { resolveStep07CheckpointContext,readStep07Checkpoint,step07CanonicalKey,step07UnitKey,type Step07WorkStatus } from '../services/step07CheckpointService';
import { copyCPAnalysisDiagnosis } from '../services/cpAnalysisAIDiagnostics';
import {buildStep07FullDiagnosticReport} from '../services/step07FullDiagnosticReport';
import {redactStep07Diagnostic} from '../services/step07DiagnosticsService';
import { AlignmentProposalReview, inlineMappingChanges } from './AlignmentProposalReview';
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
import { mappingCoverage, alignmentProposalStatus, refreshAlignmentProposals, isMappingActionAutomatic, formatMappingUnitTitle, confirmMappingMaterialOrigin, applyMinimalAlignment, buildMappingMaterialResolutions, undoMappingTitle, undoMappingRelation, recordMappingBatch } from '../services/mappingAlignmentService';
import { proceedWithATPUnitMapping, resolveATPUnitMappingReadiness, countStep07CompletedUnits,finalizeTeacherReviewedMapping } from '../services/atpMappingReadinessService';
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
  ATPUnitMappingImportMode,
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
      ...u,
      id: u.id,
      title: u.title,
      order: u.order,
      linkedAtpItemIds: u.linkedAtpItemIds || [],
      linkedTpIds:
        Array.isArray(u.linkedTpIds)
          ? u.linkedTpIds
          : [],
      materials: (u.materials || []).map((m, mIdx) => ({
        ...m,
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
        ...m,
        id: m.id && m.id.trim() ? m.id.trim() : `mat-${Date.now()}-${mIdx + 1}`,
        title: m.title !== undefined ? m.title : '',
        order: m.order,
        linkedTpIds: matTpIds,
        linkedAtpItemIds: matAtpIds,
      };
    });

    return {
      ...u,
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
  const [autoRepair,setAutoRepair]=useState(mapping?.step07AutoRepair);
  const [repairProgress,setRepairProgress]=useState(mapping?.step07AutoRepair?.progress);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [unitRepairState,setUnitRepairState]=useState<{unitId:string;message:string;remaining?:number;success?:boolean}>();
  const [checkpointWork,setCheckpointWork]=useState<Step07WorkStatus>();
  const [manualDiagnostic,setManualDiagnostic]=useState('');
  const [autoPhase,setAutoPhase]=useState('');
  const [rejectedProposalIds,setRejectedProposalIds]=useState<Set<string>>(new Set());
  const [saveSuccessNotice, setSaveSuccessNotice] = useState(false);
  const [saveErrorNotice, setSaveErrorNotice] = useState<string | null>(null);
  const [localValidationNotice, setLocalValidationNotice] = useState<string | null>(null);

  // Sync state if canonical mapping prop updates
  useEffect(() => {
    if (mapping && Array.isArray(mapping.units) && mapping.units.length > 0) {
      if (!hasChanges&&!isAnalyzing) {
        const saved=getATPUnitMappingV5(mapping.academicSettingId);
        const source=saved?.id===mapping.id&&saved.atpId===atp.id&&saved.tpDataId===mapping.tpDataId?saved:mapping;
        setUnits(createInitialUnits(source, atp.items || []));
        setAutoRepair(source.step07AutoRepair);
        setRepairProgress(source.step07AutoRepair?.progress);
      }
    }
  }, [mapping, hasChanges, atp.items,isAnalyzing]);
  useEffect(()=>{
    if(isAnalyzing||!mapping)return;
    setCheckpointWork(undefined);
    try{
      const checkpoint=readStep07Checkpoint(resolveStep07CheckpointContext(mapping.academicSettingId));
      const id=checkpoint?.activeUnitId,point=id?checkpoint?.units[id]:undefined;
      if(checkpoint&&point&&id)setCheckpointWork({mode:checkpoint.mode,activeUnitId:id,stage:point.stage,completed:countStep07CompletedUnits(mapping,atp,tp),total:mapping.units.length,checkpointStatus:'Checkpoint tersedia untuk dilanjutkan'});
    }catch{/* A corrupt/unavailable checkpoint is reported when repair or diagnostics is invoked. */}
  },[mapping,isAnalyzing,atp,tp]);

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
      step07AutoRepair:autoRepair,
      updatedAt: mapping?.updatedAt || new Date().toISOString(),
    } as ATPUnitMappingData;

    return resolveATPUnitMappingReadiness(currentDraft, atp, tp, academicSetting);
  }, [units, atp, tp, academicSetting, mapping, autoRepair]);

  const displayedRepairProgress=isAnalyzing?repairProgress:autoRepair?.progress&&{
    ...autoRepair.progress,
    remaining:mappingReadiness.repairIssues?.length ?? autoRepair.progress.remaining,
    ...(autoRepair.initialIssueIds&&mappingReadiness.repairIssues?{resolved:autoRepair.initialIssueIds.filter(id=>!mappingReadiness.repairIssues!.some(issue=>issue.id===id)).length}:{}),
  };

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
      return derived.issues.length ? unit : { ...unit, materials, linkedTpIds: ids, linkedAtpItemIds: derived.atpItemIds,
        actionHistory:[...(unit.actionHistory || []),{id:`manual-link-${materialId}-${Date.now()}`,at:new Date().toISOString(),kind:'REALIGN' as const,approval:'TEACHER' as const,unitId,materialId,
          before:JSON.stringify(unit.materials.find(m=>m.id===materialId)?.linkedTpIds || []),after:JSON.stringify(materials.find(m=>m.id===materialId)?.linkedTpIds || []),reason:'Guru mengubah relasi melalui editor manual; analisis otomatis tidak boleh menimpa keputusan ini.'}] };
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
    const draft=buildCurrentMappingDraftFromUnits(
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
    return {...mapping,...draft,step07AutoRepair:autoRepair};
  };

  // AI Analysis State
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
      const next = recordMappingBatch(units, approveMappingGenerationPreview(generationPreview, units, atp, tp), 'Guru menyetujui preview struktur AI sebelum diterapkan ke draf.');
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
  const analysisBusyRef = useRef(false);
  useEffect(()=>()=>{analysisRequestIdRef.current++;},[]);

  // Import Bab & Materi State (Section 4, 5, 6)
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importMode, setImportMode] = useState<ATPUnitMappingImportMode>('FULL_STRUCTURE');
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

    if (importMode === 'UPDATE_BAB_TITLES_ONLY' && units.length === 0) {
      setImportErrors([
        'Tidak ada Bab tersimpan dalam draf untuk diperbarui nama judulnya. Silakan buat atau impor Bab & Materi terlebih dahulu.',
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
      const result = parseBabMateriXlsx(buffer, importMode, units);
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

    const isTitlesOnly = importPreviewResult.mode === 'UPDATE_BAB_TITLES_ONLY';
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
    if (isTitlesOnly) {
      setImportSuccessNotice(
        `Berhasil memperbarui ${stats?.titleChangesCount || 0} judul Bab pada draf. Klik 'Simpan Perubahan' untuk menyimpan.`
      );
    } else {
      setImportSuccessNotice(
        `Berhasil menerapkan ${stats?.totalBabs || importPreviewResult.units.length} Bab dan ${stats?.totalMaterials || 0} Lingkup Materi ke Draf. Silakan klik 'Analisis & Selaraskan' untuk menyelaraskan dengan ATP & TP kanonikal.`
      );
    }

    setImportPreviewResult(null);
  };

  const handleCancelImport = () => {
    setImportPreviewResult(null);
    setImportErrors(null);
  };

  const handleAnalyzeMapping = async (targetUnitId?:string) => {
    if(analysisBusyRef.current||isGeneratingStructure)return;
    analysisBusyRef.current=true;
    setUnitRepairState(targetUnitId?{unitId:targetUnitId,message:'Menganalisis Bab ini...'}:undefined);
    setIsAnalyzing(true);setAutoPhase('Menganalisis');setAnalysisError(null);setApplyIssues([]);setAppliedNotice(null);setSelectedAnalysisActionIds(new Set());
    const requestId=++analysisRequestIdRef.current;
    try{
    const source=generationContextRef.current;
    const initial=buildCurrentMappingDraft();
    const checkpointContext=resolveStep07CheckpointContext(initial.academicSettingId);
    const result=await runStep07AutoRepair({mapping:initial,persistedMapping:mapping,atp:atpRef.current,tp:tpRef.current,
      checkpointContext,targetUnitId,onWork:setCheckpointWork,
      isCurrent:()=>requestId===analysisRequestIdRef.current&&source===generationContextRef.current,
      analyze:(draft,step07Auto,signal)=>analyzeATPUnitMappingWithAI({subject:academicSetting?.subject,grade:academicSetting?.grade,phase:academicSetting?.phase,tpData:tpRef.current,atpData:atpRef.current,currentMapping:draft,step07Auto},{signal,diagnosticContext:checkpointContext}),
      save:onSaveMapping,onStatus:setAutoPhase,onProgress:setRepairProgress,
    });
    if(requestId!==analysisRequestIdRef.current)return;
    setIsAnalyzing(false);
    if(result.stale){const message='Data manual atau konteks berubah. Hasil lama tidak diterapkan.';setAnalysisError(message);if(targetUnitId)setUnitRepairState({unitId:targetUnitId,message,success:false});return;}
    setAlignmentRollback({units:structuredClone(initial.units),fingerprint:computeMappingFingerprint(result.mapping.units,atpRef.current,tpRef.current)});
    setUnits(result.mapping.units);unitsRef.current=result.mapping.units;setAutoRepair(result.mapping.step07AutoRepair);
    setHasChanges(!result.persisted);setAnalysisResult(result.analysis || null);setLastAnalysisSnapshot(result.analysis || null);setLastAppliedActionIds(result.appliedActions);
    setAnalysisFingerprint(computeMappingFingerprint(result.mapping.units,atpRef.current,tpRef.current));
    setSaveSuccessNotice(result.saved);setAutoPhase(result.saved?'Selesai':'Belum selesai');
    if(targetUnitId){
      const issues=resolveATPUnitMappingReadiness(result.mapping,atpRef.current,tpRef.current,undefined,{evaluateRepair:true}).repairIssues?.filter(issue=>issue.unitId===targetUnitId) || [];
      const selected=result.mapping.units.find(u=>u.id===targetUnitId),stored=getATPUnitMappingV5(initial.academicSettingId)?.units.find(u=>u.id===targetUnitId);
      const targetSaved=!!selected&&!!stored&&JSON.stringify(selected)===JSON.stringify(stored),complete=!!selected&&!issues.length;
      const failed=['SAVE_FAILED','TIMEOUT','BUDGET_LIMIT'].includes(result.outcome)||result.issues.some(issue=>/CHECKPOINT_|API_FAILURE|AI_UNAVAILABLE|AI_NOT_CONFIGURED|STEP07_STALE/.test(issue));
      const success=complete&&!failed&&(targetSaved||!result.appliedActions.length);
      const message=failed?`Proses Bab terhenti: ${result.issues[0] || result.outcome}. ${targetSaved?'Snapshot Bab tersimpan tetap aman.':''}`:complete&&targetSaved?'Bab ini valid dan tersimpan.':success?'Bab ini sudah valid. Perubahan manual tetap di draf; simpan pemetaan untuk menyimpannya.':`Bab ini belum selesai: ${issues.length} masalah tersisa. ${result.issues[0] || 'Periksa materi dan bukti TP Bab ini.'}`;
      setUnitRepairState({unitId:targetUnitId,message,remaining:issues.length,success});
      setAnalysisError(success?null:[result.issues[0],...issues.map(issue=>issue.message)].filter(Boolean).join('\n'));
      if(success)setAppliedNotice(message+(!result.persisted?' Perubahan Bab lain tetap berada di draf.':''));
    }
    else if(result.saved)setAppliedNotice('Selesai: hasil valid dan lengkap tersimpan atomik. Lanjut Step 08 tersedia.');
    else {setAnalysisError(result.issues.join('\n') || 'Gap belum dapat diselesaikan secara pedagogis. Draft aman terakhir dipertahankan.');if(result.persisted)setAppliedNotice('Progres aman tersimpan. Klik Lanjutkan Perbaikan untuk menyelesaikan masalah tersisa.');}
    }catch(error){
      if(requestId===analysisRequestIdRef.current){const message=error instanceof Error?error.message:String(error);setAnalysisError(message);if(targetUnitId)setUnitRepairState({unitId:targetUnitId,message,success:false});}
    }finally{analysisBusyRef.current=false;if(requestId===analysisRequestIdRef.current)setIsAnalyzing(false);}
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
    if (analysisResult.alignmentProposals?.some(p => alignmentProposalStatus(p) === 'READY' && p.approval !== 'AUTOMATIC')) {
      const materialKeys = new Set<string>();
      analysisResult.alignmentProposals.filter(p => alignmentProposalStatus(p) === 'READY' && p.approval !== 'AUTOMATIC').forEach(p => {
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

  const handleApplySelectedActions = (requestedIds?:Set<string>,amendment?:{id:string;after:string;reason:string}) => {
    const actionIds=requestedIds || selectedAnalysisActionIds;
    const actions=(requestedIds?extractSelectedMappingActions(analysisResult,actionIds):selectedActions).map(action=>{
      const proposal=analysisResult?.alignmentProposals?.find(p=>p.id===amendment?.id&&p.action?.id===action.id);
      if (!proposal||!amendment||!['ADD_MATERIAL','EDIT_MATERIAL','EDIT_UNIT_TITLE'].includes(action.type)) return action;
      return {...action,after:amendment.after,reason:amendment.reason,evidence:action.type==='ADD_MATERIAL'?action.evidence?.map(e=>({...e,materialQuote:amendment.after})):action.evidence};
    });
    const eligibility=requestedIds?resolveApplyActionsEligibility({selectedCount:actionIds.size,selectedActions:actions,units,atp,tp,expectedFingerprint:analysisFingerprint,currentFingerprint}):actionEligibility;
    if (!analysisResult || actionIds.size === 0) return;

    if (!eligibility.canApply) {
      if (eligibility.issues.length > 0) {
        setApplyIssues(eligibility.issues);
      }
      return;
    }

    const result = applyATPMappingActions({
      units,
      selectedActions:actions,
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
    setLastAppliedActionIds([...actionIds]);
    setSelectedAnalysisActionIds(new Set());
    setApplyIssues([]);
    setAnalysisResult({...analysisResult,alignmentProposals:refreshAlignmentProposals(analysisResult.alignmentProposals || [],result.nextUnits,atp,tp).map(p=>actionIds.has(p.id)?{...p,after:amendment?.id===p.id?amendment.after:p.after,action:undefined,validationStatus:'ALREADY_APPLIED' as const}:p),atpFindings:analysisResult.atpFindings.map(f=>actionIds.has(f.id)?{...f,action:undefined}:f),materialFindings:analysisResult.materialFindings.map(f=>actionIds.has(f.id)?{...f,action:undefined}:f)});
    setSaveSuccessNotice(false);
    setAnalysisFingerprint(computeMappingFingerprint(result.nextUnits,atp,tp));
    const actualCoverage = mappingCoverage(result.nextUnits, atp, tp);
    setAppliedNotice(`Saran diterapkan ke draf. Sisa ATP belum dipetakan: ${actualCoverage.unmappedAtpIds.length}; TP belum tercakup: ${actualCoverage.uncoveredTpIds.length}. Klik Simpan Pemetaan untuk menyimpan.`);
  };

  // Reuse persisted proposals only for their exact current unit/canonical source.
  const guidancePoints=useMemo(()=>{
    try{const cp=readStep07Checkpoint(resolveStep07CheckpointContext(academicSetting?.id || atp.academicSettingId));
      return cp?.canonical===step07CanonicalKey(atp,tp)?units.flatMap(unit=>{const point=cp.units[unit.id];return point?.source===step07UnitKey(unit)&&point.semanticPolicyVersion===STEP07_SEMANTIC_POLICY_VERSION?[{unitId:unit.id,point}]:[];}):[];
    }catch{return [];}
  },[units,atp,tp,academicSetting?.id,checkpointWork]);
  const guidanceProposals=[...guidancePoints.flatMap(({point})=>(point.proposal || point.analysis)?.alignmentProposals || []),...(analysisResult?.alignmentProposals || [])]
    .filter(p=>units.some(u=>u.id===p.targetUnitId&&u.materials.some(m=>m.id===p.targetMaterialId&&m.title===p.before)));
  const materialResolutions=buildMappingMaterialResolutions(units,atp,tp,guidanceProposals,analysisResult?.gapFindings);
  const selectedForUnit=(unit:ATPUnitMapping)=>new Set([...selectedAnalysisActionIds].filter(id=>{
    const proposal=analysisResult?.alignmentProposals?.find(p=>p.id===id);
    if(proposal) return proposal.targetUnitId===unit.id||unit.materials.some(material=>material.id===proposal.targetMaterialId);
    const finding=[...(analysisResult?.atpFindings || []),...(analysisResult?.materialFindings || [])].find(f=>f.id===id);
    return finding?.action?.targetUnitId===unit.id;
  }));
  const repairBoxClass=(unitId:string,materialId?:string)=>{
    const color=step07RepairColor(units,autoRepair,unitId,materialId);
    return color==='red'?'bg-red-50 border-red-400':color==='pink'?'bg-pink-50 border-pink-400':color==='green'?'bg-emerald-50 border-emerald-400':'bg-white border-slate-200';
  };
  const renderInlineAlignment=(unit:ATPUnitMapping,materialId?:string)=>(
    <div><AlignmentProposalReview proposals={[]} materialResolutions={materialResolutions} inlineScope={{unitId:unit.id,materialId}} baselineUnits={units} rejectedIds={rejectedProposalIds}
                onApproveProposal={(ids,amendment)=>handleApplySelectedActions(ids,amendment)} onRejectProposal={id=>{setRejectedProposalIds(previous=>new Set(previous).add(id));setSelectedAnalysisActionIds(previous=>new Set([...previous].filter(selected=>selected!==id)));setAppliedNotice('Usulan ditolak pada analisis ini. Data draf tidak diubah.');}}
                gaps={analysisResult?.gapFindings}
                onConfirmOrigin={(unitId,materialId,title)=>{try {setUnits(confirmMappingMaterialOrigin(unitsRef.current,unitId,materialId,title));setHasChanges(true);} catch(error) {setApplyIssues([error instanceof Error?error.message:String(error)]);}}}
                onReviewMaterial={(unitId,materialId,title,tpIds,reason,newTitle,replace)=>{
                  const material=unitsRef.current.find(u=>u.id===unitId)?.materials.find(m=>m.id===materialId);
                  const selectedTpIds=tpIds.length?tpIds:(replace?[]:material?.linkedTpIds || []);
                  const rename=newTitle!==title;
                  if (replace && rename) {setApplyIssues(['Lakukan koreksi relasi dan perubahan judul dalam tindakan terpisah agar setiap dampak dapat ditinjau.']);return;}
                  if ((!selectedTpIds.length && !rename && !replace) || !reason.trim()) {setApplyIssues(['Pilih TP atau perbaiki judul, lalu jelaskan alasan relevansi substansi/kompetensi sebelum ACC.']);return;}
                  const current=unitsRef.current, before=computeMappingFingerprint(current,atpRef.current,tpRef.current);
                  const result=applyATPMappingActions({units:current,atp:atpRef.current,tp:tpRef.current,expectedFingerprint:before,currentFingerprint:before,
                    selectedActions:[{id:`teacher-review-${materialId}-${Date.now()}`,type:rename?'EDIT_MATERIAL':'LINK_TP',targetUnitId:unitId,targetMaterialId:materialId,before:title,after:rename?newTitle:undefined,replaceTpIds:replace,linkedTpIds:[...new Set([...(replace?[]:material?.linkedTpIds || []),...selectedTpIds])],reason:reason.trim(),
                      evidence:[...new Set([...(replace?[]:material?.linkedTpIds || []),...selectedTpIds])].map(tpId=>({tpId,tpQuote:tpRef.current.items.find(t=>t.id===tpId)?.statement || '',materialQuote:title}))}]});
                  if (!result.success || !result.nextUnits) {setApplyIssues(result.issues);return;}
                  setAlignmentRollback({units:structuredClone(current),fingerprint:computeMappingFingerprint(result.nextUnits,atpRef.current,tpRef.current)});
                  setUnits(result.nextUnits);unitsRef.current=result.nextUnits;setHasChanges(true);setAnalysisFingerprint(computeMappingFingerprint(result.nextUnits,atpRef.current,tpRef.current));setSelectedAnalysisActionIds(new Set());setApplyIssues([]);
                  setAnalysisResult(previous=>previous?{...previous,alignmentProposals:refreshAlignmentProposals(previous.alignmentProposals || [],result.nextUnits!,atpRef.current,tpRef.current)}:previous);
                  setAppliedNotice('Persetujuan dan alasan guru dicatat pada draf. Simpan Pemetaan untuk menyimpan atomik; Step 08 memakai data tersimpan terbaru.');
                }}
                readiness={mappingReadiness} units={units} atp={atp} tp={tp}
                selectedIds={selectedAnalysisActionIds} onSelectionChange={ids => {
                  setSelectedAnalysisActionIds(ids); setApplyIssues([]);
                }} />
      {!materialId&&selectedForUnit(unit).size>0&&<button type="button" className="text-xs font-semibold underline my-2" onClick={()=>handleApplySelectedActions(selectedForUnit(unit))}>Setujui pilihan pada Bab ini ({selectedForUnit(unit).size})</button>}
    </div>

  );

  const renderMaterialGuidance=(unit:ATPUnitMapping,material:ATPUnitMaterial)=>{
    const resolution=materialResolutions.find(r=>r.unitId===unit.id&&r.materialId===material.id);
    if(!resolution||resolution.status==='RESOLVED')return null;
    const point=guidancePoints.find(p=>p.unitId===unit.id)?.point;
    const proposal=[...guidanceProposals].reverse().find(p=>p.targetUnitId===unit.id&&p.targetMaterialId===material.id);
    const actionId=proposal?.action?.id;
    const belongs=(id?:string)=>!!id&&(id===actionId||id===proposal?.id||!!proposal?.id.endsWith('-'+id)||id.includes(material.id));
    const checks=point?.verification?.step07SemanticChecks?.filter(c=>belongs(c.actionId)) || [];
    const reasons=[...new Set([...(proposal?.validationIssues || []),...checks.flatMap(c=>c.verdict!=='SUPPORTED'?[c.reason,...c.missingEvidence]:[]),...(point?.events.filter(e=>!e.success&&belongs(e.actionId)).map(e=>e.reason) || []),...(point?.repairState?.failures.filter(f=>belongs(f.actionId)).map(f=>f.reason) || [])])];
    return <section data-teacher-guidance={material.id} className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2 text-xs">
      <p className="font-semibold">Perlu tinjauan: {material.title}</p>
      <p>{material.linkedTpIds.length?'TP sudah dicentang, tetapi alasan relevansi dan persetujuan untuk redaksi saat ini belum lengkap.':'Materi belum dipetakan. Pilih TP berdasarkan relevansi substansi dan cakupan.'} Centang relasi saja belum mencatat bukti pedagogis.</p>
      {proposal&&<div><p>Usulan AI untuk ditinjau — belum dinyatakan valid:</p><p><del>{proposal.before}</del> → <strong>{proposal.after || proposal.before}</strong></p><p>{proposal.reason}</p></div>}
      {reasons.map(reason=><p key={reason}>Belum diterapkan: {reason}</p>)}
      {material.linkedTpIds.map(id=>{const objective=tp.items.find(t=>t.id===id);return objective?<p key={id}>[{objective.code}] {objective.statement}</p>:null;})}
      <p>Edit judul bila perlu, lalu jelaskan relevansi substansi dan cakupan materi terhadap setiap TP. Aktivitas pembelajaran dirumuskan pada modul ajar. Jika TP tidak sesuai, koreksi relasinya. Usulan AI di atas tidak otomatis diterapkan atau dianggap benar.</p>
      {renderInlineAlignment(unit,material.id)}
    </section>;
  };

  const handleCopyDiagnostic = async () => {
    try {
      const report=buildStep07FullDiagnosticReport({mapping:buildCurrentMappingDraft(),atp,tp,work:checkpointWork,error:analysisError});
      const copied=await copyCPAnalysisDiagnosis(report);
      setManualDiagnostic(copied==='manual'?report:'');
      setCopyDiagnosticNotice(copied==='copied'?'Diagnosis berhasil disalin.':'Clipboard ditolak. Pilih dan salin laporan pada kotak di bawah.');
      setTimeout(() => {
        setCopyDiagnosticNotice((prev) => (prev === 'Diagnosis berhasil disalin.' ? null : prev));
      }, 3500);
    } catch(error) {
      setCopyDiagnosticNotice('Diagnosis gagal dibuat/disalin: '+redactStep07Diagnostic(error instanceof Error?error.message:String(error)));
      setTimeout(() => {
        setCopyDiagnosticNotice((prev) => (prev === 'Gagal menyalin diagnosis ke clipboard.' ? null : prev));
      }, 3500);
    }
  };

  // Save Mapping Canonical
  const handleSave = (): boolean => {
    const result = finalizeTeacherReviewedMapping(buildCurrentMappingDraft(),atp,tp,academicSetting);
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
      setAutoRepair(result.step07AutoRepair);
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
              <span>{autoRepair?'Auto-repair belum selesai: '+analysisError.split('\n')[0]:`Analisis Pemetaan gagal: ${analysisError}`}</span>
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

            </div>
          ) : (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 space-y-2">
              <div className="flex items-center justify-between gap-2 text-xs font-bold">
                <div className="flex items-center gap-2">
                  <Info className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>{localValidation.summaryMessage}</span>
                </div>

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

        {importErrors && importErrors.length > 0 && (
          <div className="mt-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs space-y-1.5 animate-fadeIn">
            <div className="flex items-center justify-between font-bold">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>Gagal Mengimpor Excel ({importErrors.length} kendala/diagnosis):</span>
              </div>
              <button
                type="button"
                onClick={() => setImportErrors(null)}
                className="text-rose-600 hover:text-rose-800 text-xs cursor-pointer font-bold"
              >
                Tutup
              </button>
            </div>
            <ul className="list-disc pl-5 space-y-0.5 text-rose-800">
              {importErrors.map((err, idx) => (
                <li key={idx}>{err}</li>
              ))}
            </ul>
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
          <button id="btn-analyze-mapping" type="button" onClick={()=>handleAnalyzeMapping()}
            disabled={isAnalyzing || isGeneratingStructure || units.length === 0}
            className="flex items-center justify-center gap-2 w-full min-h-12 px-4 py-3 rounded-xl border border-indigo-700 bg-white hover:bg-indigo-50 text-indigo-900 text-sm font-bold shadow-xs disabled:opacity-50 disabled:cursor-not-allowed">
            <Sparkles className={`w-5 h-5 shrink-0 ${isAnalyzing ? 'animate-spin' : ''}`} />
            <span>{isAnalyzing ? `${autoPhase}...` : 'Analisis & Selaraskan'}</span>
          </button>
        </div>
        <p className="text-xs text-slate-600">Susun dengan AI mengusulkan struktur baru dan jumlah Bab otomatis berdasarkan TP/ATP. Analisis &amp; Selaraskan menelaah struktur draf yang sudah ada.</p>
        <button id="btn-copy-mapping-diagnostic" type="button" onClick={handleCopyDiagnostic} className="text-xs underline">Salin Diagnostik Lengkap</button>
        {manualDiagnostic&&<textarea aria-label="Laporan diagnostik untuk disalin manual" readOnly value={manualDiagnostic} onFocus={event=>event.currentTarget.select()} className="w-full h-40 border rounded-lg p-2 text-xs"/>}
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

          {/* Action Buttons: Mode Selector, Import, Download Template */}
          <div className="flex items-center gap-2.5 flex-wrap">
            {/* Download Template Button */}
            <button
              id="btn-download-bab-materi-template"
              type="button"
              onClick={() => downloadBabMateriTemplateXlsx()}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-bold shadow-2xs transition cursor-pointer"
              title="Download template Excel untuk struktur Bab & Materi"
            >
              <Download className="w-4 h-4 text-slate-600" />
              <span>Download Template</span>
            </button>

            {/* Mode Selector */}
            <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200">
              <button
                id="mode-full-structure"
                type="button"
                onClick={() => { setImportMode('FULL_STRUCTURE'); setImportErrors(null); }}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                  importMode === 'FULL_STRUCTURE'
                    ? 'bg-white text-emerald-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Impor Bab & Materi
              </button>
              <button
                id="mode-update-titles-only"
                type="button"
                onClick={() => { setImportMode('UPDATE_BAB_TITLES_ONLY'); setImportErrors(null); }}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                  importMode === 'UPDATE_BAB_TITLES_ONLY'
                    ? 'bg-white text-emerald-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Perbarui Nama Bab Saja
              </button>
            </div>

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
                  : importMode === 'UPDATE_BAB_TITLES_ONLY'
                  ? 'Perbarui hanya judul Bab dari file Excel (sheet BAB_MATERI)'
                  : 'Impor struktur Bab dan Lingkup Materi dari file Excel (sheet BAB_MATERI)'
              }
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold border shadow-2xs transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                !isATPReady
                  ? 'bg-slate-100 border-slate-200 text-slate-400'
                  : 'bg-emerald-700 text-white hover:bg-emerald-800'
              }`}
            >
              <FileSpreadsheet className={`w-4 h-4 ${isImporting ? 'animate-spin' : 'text-white'}`} />
              <span>
                {isImporting
                  ? 'Membaca XLSX...'
                  : importMode === 'UPDATE_BAB_TITLES_ONLY'
                  ? 'Pilih Excel Judul Bab'
                  : 'Pilih Excel Bab & Materi'}
              </span>
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
                        <h3 className="font-bold text-slate-900 text-sm">
                          {importPreviewResult.mode === 'UPDATE_BAB_TITLES_ONLY'
                            ? 'Pratinjau Perbarui Nama Bab Saja'
                            : 'Pratinjau Import Bab & Lingkup Materi'}
                        </h3>
                        <p className="text-xs text-slate-500">
                          {importPreviewResult.mode === 'UPDATE_BAB_TITLES_ONLY'
                            ? `Meninjau ${importPreviewResult.titleChanges?.length || 0} Bab dari sheet BAB_MATERI.`
                            : 'Struktur Bab & Materi dari sheet BAB_MATERI berhasil divalidasi.'}
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
                  {importPreviewResult.mode === 'UPDATE_BAB_TITLES_ONLY' ? (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-emerald-50/60 border border-emerald-200 rounded-xl p-3 flex items-center justify-between">
                        <span className="text-xs font-semibold text-emerald-900">Jumlah Bab Tersimpan:</span>
                        <span className="text-sm font-extrabold text-emerald-700">
                          {importPreviewResult.stats?.totalBabs || 0}
                        </span>
                      </div>
                      <div className="bg-blue-50/60 border border-blue-200 rounded-xl p-3 flex items-center justify-between">
                        <span className="text-xs font-semibold text-blue-900">Judul Diperbarui:</span>
                        <span className="text-sm font-extrabold text-blue-700">
                          {importPreviewResult.stats?.titleChangesCount || 0} Bab
                        </span>
                      </div>
                    </div>
                  ) : (
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
                  )}

                  {/* Notices */}
                  {importPreviewResult.mode === 'UPDATE_BAB_TITLES_ONLY' ? (
                    <div className="p-2.5 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-xs flex items-center gap-2">
                      <Info className="w-4 h-4 text-blue-600 shrink-0" />
                      <span>
                        <strong>Mode Perbarui Nama Bab Saja:</strong> Seluruh ID Bab, Lingkup Materi, pemetaan TP/ATP, JP, dan relasi kanonikal TETAP UTUH tanpa perubahan.
                      </span>
                    </div>
                  ) : (
                    <>
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

                      <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 text-xs flex items-center gap-2">
                        <Info className="w-4 h-4 text-blue-600 shrink-0" />
                        <span>
                          Struktur Bab & Materi diimpor dengan lineage kosong. Gunakan fitur <strong>Analisis & Selaraskan</strong> setelah menerapkan ke draf untuk menghubungkan dengan TP & ATP kanonikal.
                        </span>
                      </div>
                    </>
                  )}

                  {/* Scrollable List of Babs & Materials or Title Changes */}
                  {importPreviewResult.mode === 'UPDATE_BAB_TITLES_ONLY' ? (
                    <div className="flex-1 overflow-y-auto space-y-2 pr-1 border border-slate-200 rounded-xl p-3 bg-slate-50/30 max-h-[35vh]">
                      {importPreviewResult.titleChanges?.map((ch) => {
                        const isChanged = ch.oldTitle !== ch.newTitle;
                        return (
                          <div
                            key={ch.babOrder}
                            className={`bg-white rounded-lg border p-3 space-y-1 shadow-2xs ${
                              isChanged ? 'border-blue-200 bg-blue-50/20' : 'border-slate-200'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-800 text-[11px] font-bold">
                                Bab {ch.babOrder}
                              </span>
                              <span
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                  isChanged
                                    ? 'bg-blue-100 text-blue-800'
                                    : 'bg-slate-100 text-slate-600'
                                }`}
                              >
                                {isChanged ? 'Diperbarui' : 'Tetap'}
                              </span>
                            </div>
                            <div className="text-xs space-y-0.5 pt-1">
                              <div className="text-slate-500 flex items-center gap-1.5">
                                <span className="font-semibold text-slate-400 w-20 shrink-0">Judul Lama:</span>
                                <span className="line-through decoration-slate-300">{ch.oldTitle}</span>
                              </div>
                              <div className="text-slate-900 font-bold flex items-center gap-1.5">
                                <span className="font-semibold text-blue-600 w-20 shrink-0">Judul Baru:</span>
                                <span className="text-blue-900">{ch.newTitle}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
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
                  )}

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
                      {importPreviewResult.mode === 'UPDATE_BAB_TITLES_ONLY'
                        ? 'Terapkan Perubahan Judul ke Draf'
                        : 'Terapkan ke Draf'}
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
                <strong>Auto-repair Step 07:</strong> Analisis &amp; Selaraskan memperbaiki masalah hingga readiness Step 08 terpenuhi, selama masih ada kemajuan dan anggaran aman. Jika proses dijeda, progres valid disimpan dan dapat dilanjutkan. TP/ATP kanonikal, snapshot, histori dan aturan pedagogis tetap dipertahankan.
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
          <strong>{formatMappingUnitTitle(unit)}</strong>
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
          setUnits(recordMappingBatch(unitsRef.current, restored.nextUnits, 'Guru membatalkan batch penyelarasan terakhir.', true)); setHasChanges(true);
          setAnalysisResult(null); setAnalysisFingerprint(null); setSelectedAnalysisActionIds(new Set());
          setAlignmentRollback(null); setAppliedNotice('Batch terakhir dibatalkan; materi asli dipulihkan ke draf. Simpan Pemetaan untuk menyimpan.');
        }}>Batalkan batch penyelarasan terakhir</button>
      )}
      {(isAnalyzing||autoRepair||checkpointWork)&&<section id="step07-auto-status" role="status" className="rounded-xl border p-4 space-y-2">
        <strong>{isAnalyzing?autoPhase:autoRepair?.outcome==='NEEDS_TEACHER_REVIEW'?'Perlu tinjauan guru':(!hasChanges&&mappingReadiness.canProceed?'Selesai':'Belum selesai')}</strong>
        {checkpointWork&&<p id="step07-checkpoint-status" className="text-sm">{checkpointWork.mode} · Bab aktif: {checkpointWork.activeUnitId==='GLOBAL'?'Rekonsiliasi global':units.find(u=>u.id===checkpointWork.activeUnitId)?.title || checkpointWork.activeUnitId} · Tahap: {checkpointWork.stage} · Bab selesai: {isAnalyzing?checkpointWork.completed:countStep07CompletedUnits({...mapping,id:mapping?.id || 'temp',academicSettingId:atp.academicSettingId,atpId:atp.id,updatedAt:mapping?.updatedAt || '',units,step07AutoRepair:autoRepair},atp,tp)}/{units.length} · {checkpointWork.checkpointStatus}</p>}
        {displayedRepairProgress&&<p className="text-sm" id="step07-repair-progress">Masalah awal: {displayedRepairProgress!.initial} · Selesai: {displayedRepairProgress!.resolved} · Tersisa: {displayedRepairProgress!.remaining}</p>}
        <p className="text-sm">Merah: redaksi berubah · Hijau: redaksi tetap · Pink: lingkup materi baru hasil AI.</p>
        {autoRepair&&!isAnalyzing&&<p className="text-sm">{autoRepair.rounds} putaran · {mappingReadiness.validationResult?.isValid?'Valid':'Belum valid'} · {mappingReadiness.validationResult?.isComplete?'Struktur lengkap':'Struktur belum lengkap'} · {hasChanges?'Draft belum tersimpan':'Tersimpan'}</p>}
        <details><summary>Detail proses</summary><ul>{[...new Set([...(autoRepair?.issues || []),...(analysisError?.split('\n') || [])])].map((issue,index)=><li key={index}>{issue}</li>)}</ul></details>
        {(autoRepair||checkpointWork)&&!isAnalyzing&&!mappingReadiness.canProceed&&<button id="btn-resume-step07-repair" type="button" onClick={()=>handleAnalyzeMapping()} disabled={isGeneratingStructure||units.length===0} className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Lanjutkan Perbaikan</button>}
      </section>}

      <details id="mapping-action-history" className="rounded-xl border bg-white p-4 text-sm">
        <summary>Riwayat tindakan dan perubahan redaksi sebelum/sesudah</summary>
        <p>Perubahan draf perlu disimpan. Undo ditolak jika judul sudah berubah setelah tindakan.</p>
        {autoRepair&&!autoRepair.undone&&<button type="button" className="underline font-semibold" onClick={()=>{
          const restored=undoStep07AutoRepair({...mapping,...buildCurrentMappingDraft(),units,step07AutoRepair:autoRepair},atp,tp,mapping || null);
          if(!restored.success||!restored.mapping){setAnalysisError(restored.issues.join('; '));return;}
          setUnits(restored.mapping.units);unitsRef.current=restored.mapping.units;setAutoRepair(restored.mapping.step07AutoRepair);setHasChanges(true);setAnalysisResult(null);setAnalysisFingerprint(null);
        }}>Undo auto-repair terakhir</button>}
        {units.flatMap(unit => [unit, ...unit.materials].map(entity => <div key={`${unit.id}-${entity.id}`} className="mt-3">
          {(entity.titleHistory || []).map(record => <p key={record.id}>{record.at} · {record.kind} · {record.approval}: {record.before} → {record.after}</p>)}
          {(entity.titleHistory || []).some(record => record.kind !== 'UNDO' && !(entity.titleHistory || []).some(h => h.undoOf === record.id)) &&
            <button type="button" className="underline" onClick={() => {
              const restored = undoMappingTitle(unitsRef.current, unit.id, entity === unit ? undefined : entity.id);
              if (!restored.success || !restored.nextUnits) { setApplyIssues(restored.issues); return; }
              setUnits(restored.nextUnits); setHasChanges(true); setAnalysisResult(null); setAnalysisFingerprint(null); setSelectedAnalysisActionIds(new Set());
            }}>Undo judul {entity.title}</button>}
          {entity === unit && (unit.actionHistory || []).map(record => <details key={record.id}><summary>{record.kind}: {record.reason}</summary>{record.kind === 'REALIGN' && record.beforeLinks && !(unit.actionHistory || []).some(h=>h.undoOf===record.id) && <button type="button" className="underline" onClick={()=>{const restored=undoMappingRelation(unitsRef.current,unit.id,record.id,atpRef.current,tpRef.current);if (!restored.success || !restored.nextUnits) {setApplyIssues(restored.issues);return;}setUnits(restored.nextUnits);setHasChanges(true);setAnalysisResult(null);setAnalysisFingerprint(null);setSelectedAnalysisActionIds(new Set());}}>Undo relasi materi</button>}<p>Sebelum: {record.before}</p><p>Sesudah: {record.after}</p></details>)}
        </div>))}
      </details>
      <div id="mapping-final-status" role="status" className="text-sm rounded-xl border p-3">
        <strong>{mappingReadiness.canProceed&&!isAnalyzing&&(!autoRepair||!hasChanges) ? 'READY untuk Step 08' : 'Belum READY untuk Step 08'}</strong>
        <p>{mappingReadiness.canProceed&&!hasChanges?'Pemetaan tersimpan dan siap dilanjutkan.':mappingReadiness.blockers[0] || 'Simpan hasil sebelum lanjut Step 08.'}</p>
      </div>
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
              id={`mapping-unit-${unit.id}`}
              data-repair-color={step07RepairColor(units,autoRepair,unit.id)}
              className={`rounded-2xl border-2 shadow-xs overflow-hidden transition ${repairBoxClass(unit.id)}`}
            >
              {/* Bab Container Header */}
              <div className={`p-4 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3 ${repairBoxClass(unit.id)}`}>
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

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button type="button" id={`btn-analyze-unit-${unit.id}`} onClick={()=>handleAnalyzeMapping(unit.id)} disabled={isAnalyzing||isGeneratingStructure||!atp.items.length||!tp.items.length} aria-busy={isAnalyzing&&unitRepairState?.unitId===unit.id} className="rounded-lg border border-indigo-300 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 disabled:opacity-50">
                    {isAnalyzing&&unitRepairState?.unitId===unit.id?'Menganalisis Bab Ini...':'Analisis Ulang Bab Ini'}
                  </button>
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
                      onClick={() => {if(window.confirm(`Hapus Bab "${unit.title}" beserta lingkup materinya dari draf?`))handleRemoveBab(unit.id);}}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-rose-600 hover:bg-rose-50 border border-rose-200 text-xs font-bold transition cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Hapus Bab</span>
                    </button>
                  )}
                </div>
              </div>


              {/* SECTION: Lingkup Materi (0..n per Bab) */}
              {mappingReadiness.validationResult?.materialCoverageGaps.filter(gap=>gap.unitId===unit.id).map(gap=><div key={gap.unitId} data-unit-coverage-guidance={unit.id} className="px-4 py-2 bg-amber-50 text-sm">
                <strong>Klaim Bab belum didukung materi.</strong>
                {gap.tpIds.map(id=><p key={id}>[{tp.items.find(t=>t.id===id)?.code || id}] {tp.items.find(t=>t.id===id)?.statement}</p>)}
                <p>Tinjau materi yang benar-benar mengajarkan TP ini dan catat buktinya di bawah. Jika TP tidak diajarkan pada Bab ini, hapus centangnya pada “Pilih TP relevan untuk Bab ini”. Jangan menambahkan relasi hanya untuk melengkapi status.</p>
              </div>)}
              {unitRepairState?.unitId===unit.id&&<p id={`step07-unit-status-${unit.id}`} role="status" className={`px-4 py-2 text-sm ${unitRepairState.success===false?'text-rose-700':'text-indigo-700'}`}>
                {isAnalyzing?`${autoPhase} · ${checkpointWork?.activeUnitId===unit.id?checkpointWork.stage:'ANALYZE'}`:unitRepairState.message}
                {!isAnalyzing&&unitRepairState.remaining!==undefined&&` Masalah Bab tersisa: ${unitRepairState.remaining}.`}
              </p>}
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
                        data-mapping-material={mat.id}
                        data-repair-color={step07RepairColor(units,autoRepair,unit.id,mat.id)}
                        className={`p-3 rounded-xl border-2 shadow-2xs space-y-2.5 ${repairBoxClass(unit.id,mat.id)}`}
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
                              onClick={() => {if(window.confirm(`Hapus lingkup materi "${mat.title}" dari draf?`))handleRemoveMaterial(unit.id, mat.id);}}
                              className="p-1 text-slate-400 hover:text-rose-600 transition cursor-pointer"
                              title="Hapus lingkup materi"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>


                        <details><summary className="text-xs cursor-pointer">Relasi TP/ATP saat ini</summary><div className="flex flex-wrap gap-2 text-xs">
                          {(tp.items || []).map(item => <label key={item.id} className="flex items-start gap-1 p-1 border rounded">
                            <input type="checkbox" checked={mat.linkedTpIds.includes(item.id)} onChange={() => handleToggleMaterialTp(unit.id, mat.id, item.id)} />
                            <span>[{item.code}] {item.statement}</span>
                          </label>)}
                        </div>

                        </details>
                        {renderMaterialGuidance(unit,mat)}
                      </div>
                    ))}
                  </div>
                )}
                {(mapping?.units.find(previous=>previous.id===unit.id)?.materials || []).filter(previous=>!units.some(current=>current.materials.some(material=>material.id===previous.id))).map(previous=><div key={previous.id} data-change-badge="Dihapus" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs"><strong>Dihapus dari draf</strong> · <del>{previous.title}</del><p>Materi tidak lagi ada pada draf. Perubahan belum disimpan; kesiapan Step 08 tetap mengikuti validator.</p></div>)}
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

        {(mapping?.units || []).filter(previous=>!units.some(unit=>unit.id===previous.id)).map(previous=><div key={previous.id} data-change-badge="Dihapus" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm"><strong>Bab dihapus dari draf</strong> · <del>{previous.title}</del><p>{previous.materials.length} lingkup materi pada Bab ini tidak lagi tampil dalam draf. Perubahan belum disimpan.</p></div>)}
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
            <p>Gunakan Analisis &amp; Selaraskan untuk memperbaiki dan menyimpan hasil yang terverifikasi. Jika bukti belum cukup, periksa Detail proses atau lengkapi draft; Step 08 tetap terkunci.</p>
            <button type="button" className="font-semibold text-blue-800 underline" onClick={() => {
              const unitId = mappingReadiness.validationResult?.materialCoverageGaps[0]?.unitId || units[0]?.id;
              const input = document.getElementById(`bab-title-input-${unitId}`);
              input?.scrollIntoView({ behavior: 'smooth', block: 'center' }); input?.focus();
            }}>Tinjau Bab dan Lingkup Materi</button>
          </div>}
          {(saveErrorNotice || localValidationNotice) && <p role="alert" className="text-sm text-red-700">{saveErrorNotice || localValidationNotice}</p>}
          <button
            id="btn-next-to-annual-planning"
            disabled={isAnalyzing || !mappingReadiness.canProceed || (!!autoRepair && hasChanges)}
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
