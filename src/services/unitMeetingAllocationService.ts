import { ATPUnitMappingData, UnitExecutionPlanData } from '../types';

export interface UnitMeetingTarget {
  unitId: string;
  semester: 1 | 2;

  existingCount: number;
  newTargetCount: number;
  finalTargetCount: number;

  missingMaterialCount: number;
  missingAtpCount: number;
  missingTpCount: number;
}

export interface UnitMeetingAllocationResult {
  isValid: boolean;
  errors: string[];

  semester1: {
    target: number;
    existing: number;
    newTarget: number;
  };

  semester2: {
    target: number;
    existing: number;
    newTarget: number;
  };

  units: UnitMeetingTarget[];
}

export interface AllocateUnitMeetingsParams {
  mapping: ATPUnitMappingData;
  currentPlan?: UnitExecutionPlanData | null;
  semester1UnitIds: string[];
  semester2UnitIds: string[];
  targetS1: number;
  targetS2: number;
}

/**
 * Deterministically allocates exact new meeting slots per Unit based on semester capacity targets
 * and missing curriculum coverage using largest remainder proportional distribution.
 */
export function allocateUnitMeetings(params: AllocateUnitMeetingsParams): UnitMeetingAllocationResult {
  const {
    mapping,
    currentPlan,
    semester1UnitIds,
    semester2UnitIds,
    targetS1,
    targetS2,
  } = params;

  const errors: string[] = [];

  const sortedMappingUnits = [...(mapping.units || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const s1UnitIdSet = new Set(semester1UnitIds);
  const s2UnitIdSet = new Set(semester2UnitIds);

  // Group units by semester in mapping order
  const s1Units = sortedMappingUnits.filter((u) => s1UnitIdSet.has(u.id));
  const s2Units = sortedMappingUnits.filter((u) => s2UnitIdSet.has(u.id));

  const planUnitsMap = new Map((currentPlan?.units || []).map((u) => [u.unitId, u]));

  function processSemester(
    units: typeof sortedMappingUnits,
    semester: 1 | 2,
    targetCount: number
  ): {
    existingCount: number;
    newTargetTotal: number;
    targets: UnitMeetingTarget[];
  } {
    let existingTotal = 0;

    interface UnitCoverageStats {
      unit: (typeof sortedMappingUnits)[0];
      mappingIndex: number;
      existingCount: number;
      missingMaterialCount: number;
      missingAtpCount: number;
      missingTpCount: number;
      hasMissingCoverage: boolean;
      weight: number;
    }

    const unitStats: UnitCoverageStats[] = units.map((unit) => {
      const mappingIndex = sortedMappingUnits.findIndex((u) => u.id === unit.id);
      const unitPlan = planUnitsMap.get(unit.id);
      const existingMeetings = unitPlan?.meetings || [];
      const existingCount = existingMeetings.length;
      existingTotal += existingCount;

      const coveredMaterials = new Set(existingMeetings.flatMap((m) => m.materialIds || []));
      const coveredAtp = new Set(existingMeetings.flatMap((m) => m.linkedAtpItemIds || []));
      const coveredTp = new Set(existingMeetings.flatMap((m) => m.linkedTpIds || []));

      const missingMaterials = (unit.materials || []).filter((m) => !coveredMaterials.has(m.id));
      const missingAtp = (unit.linkedAtpItemIds || []).filter((id) => !coveredAtp.has(id));
      const missingTp = (unit.linkedTpIds || []).filter((id) => !coveredTp.has(id));

      const missingMaterialCount = missingMaterials.length;
      const missingAtpCount = missingAtp.length;
      const missingTpCount = missingTp.length;

      const hasMissingCoverage =
        missingMaterialCount > 0 || missingAtpCount > 0 || missingTpCount > 0;

      // Weight is strictly based on missing coverage
      const weight = Math.max(1, missingMaterialCount, missingAtpCount, missingTpCount);

      return {
        unit,
        mappingIndex,
        existingCount,
        missingMaterialCount,
        missingAtpCount,
        missingTpCount,
        hasMissingCoverage,
        weight,
      };
    });

    const remainingSlots = targetCount - existingTotal;

    if (remainingSlots < 0) {
      errors.push(
        `Jumlah Pertemuan manual (${existingTotal}) melebihi kapasitas perencanaan Semester ${semester} (${targetCount}).`
      );
      return {
        existingCount: existingTotal,
        newTargetTotal: 0,
        targets: unitStats.map((st) => ({
          unitId: st.unit.id,
          semester,
          existingCount: st.existingCount,
          newTargetCount: 0,
          finalTargetCount: st.existingCount,
          missingMaterialCount: st.missingMaterialCount,
          missingAtpCount: st.missingAtpCount,
          missingTpCount: st.missingTpCount,
        })),
      };
    }

    // Units that still have missing coverage must get at least 1 mandatory slot
    const mandatoryCount = unitStats.filter((st) => st.hasMissingCoverage).length;

    if (remainingSlots < mandatoryCount) {
      errors.push(
        `Kapasitas Pertemuan tersisa Semester ${semester} (${remainingSlots}) tidak cukup untuk melengkapi coverage ${mandatoryCount} Unit yang membutuhkan minimal 1 pertemuan baru.`
      );
      return {
        existingCount: existingTotal,
        newTargetTotal: remainingSlots,
        targets: unitStats.map((st) => ({
          unitId: st.unit.id,
          semester,
          existingCount: st.existingCount,
          newTargetCount: 0,
          finalTargetCount: st.existingCount,
          missingMaterialCount: st.missingMaterialCount,
          missingAtpCount: st.missingAtpCount,
          missingTpCount: st.missingTpCount,
        })),
      };
    }

    if (unitStats.length === 0) {
      return {
        existingCount: existingTotal,
        newTargetTotal: 0,
        targets: [],
      };
    }

    // Base allocation: mandatory slot for units with missing coverage
    const assignedSlots: number[] = unitStats.map((st) => (st.hasMissingCoverage ? 1 : 0));
    const unallocated = remainingSlots - mandatoryCount;

    if (unallocated > 0) {
      const totalWeight = unitStats.reduce((sum, st) => sum + st.weight, 0);

      const remainders = unitStats.map((st, idx) => {
        const exactQuota = (st.weight / totalWeight) * unallocated;
        const integerPart = Math.floor(exactQuota);
        const remainder = exactQuota - integerPart;
        assignedSlots[idx] += integerPart;
        return {
          index: idx,
          remainder,
          mappingIndex: st.mappingIndex,
        };
      });

      const currentAllocated = assignedSlots.reduce((sum, s) => sum + s, 0);
      const leftover = remainingSlots - currentAllocated;

      if (leftover > 0) {
        // Largest remainder sorting with stable tie-break by mapping order ascending
        remainders.sort((a, b) => {
          if (Math.abs(b.remainder - a.remainder) > 1e-9) {
            return b.remainder - a.remainder;
          }
          return a.mappingIndex - b.mappingIndex;
        });

        for (let i = 0; i < leftover && i < remainders.length; i++) {
          assignedSlots[remainders[i].index] += 1;
        }
      }
    }

    const targets: UnitMeetingTarget[] = unitStats.map((st, idx) => {
      const newTargetCount = assignedSlots[idx];
      return {
        unitId: st.unit.id,
        semester,
        existingCount: st.existingCount,
        newTargetCount,
        finalTargetCount: st.existingCount + newTargetCount,
        missingMaterialCount: st.missingMaterialCount,
        missingAtpCount: st.missingAtpCount,
        missingTpCount: st.missingTpCount,
      };
    });

    return {
      existingCount: existingTotal,
      newTargetTotal: remainingSlots,
      targets,
    };
  }

  const s1Res = processSemester(s1Units, 1, targetS1);
  const s2Res = processSemester(s2Units, 2, targetS2);

  const allTargets = [...s1Res.targets, ...s2Res.targets];

  return {
    isValid: errors.length === 0,
    errors,
    semester1: {
      target: targetS1,
      existing: s1Res.existingCount,
      newTarget: s1Res.newTargetTotal,
    },
    semester2: {
      target: targetS2,
      existing: s2Res.existingCount,
      newTarget: s2Res.newTargetTotal,
    },
    units: allTargets,
  };
}
