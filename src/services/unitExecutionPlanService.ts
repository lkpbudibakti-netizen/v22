import {
  UnitExecutionPlanData,
  UnitExecutionPlan,
  LearningMeeting,
  ATPUnitMappingData,
  ATPData,
  TPData,
} from '../types';

export interface UnitMeetingCoverageResult {
  unitId: string;
  missingMaterialIds: string[];
  missingAtpItemIds: string[];
  missingTpIds: string[];
}

export interface UnitExecutionPlanValidationResult {
  isValid: boolean;
  isComplete: boolean;
  isStale: boolean;

  errors: string[];
  warnings: string[];

  missingUnitIds: string[];
  coverage: UnitMeetingCoverageResult[];
}

/**
  Creates an empty UnitExecutionPlanData structure corresponding to the provided ATPUnitMappingData.
 */
export function createEmptyUnitExecutionPlanData(
  mapping: ATPUnitMappingData
): UnitExecutionPlanData {
  const sortedUnits = [...(mapping.units || [])].sort((a, b) => a.order - b.order);
  return {
    id: `unit-execution-${mapping.id}`,
    academicSettingId: mapping.academicSettingId,
    mappingId: mapping.id,
    units: sortedUnits.map((unit) => ({
      unitId: unit.id,
      meetings: [],
    })),
    basedOnMappingUpdatedAt: mapping.updatedAt,
    updatedAt: new Date().toISOString(),
  };
}

/**
  Checks if a UnitExecutionPlanData is stale relative to the provided ATPUnitMappingData.
 */
export function isUnitExecutionPlanStale(
  plan: UnitExecutionPlanData,
  mapping: ATPUnitMappingData
): boolean {
  return (
    plan.mappingId !== mapping.id ||
    plan.basedOnMappingUpdatedAt !== mapping.updatedAt
  );
}

/**
  Validates a UnitExecutionPlanData against its canonical parent ATPUnitMappingData
  and optional ATPData / TPData.
 */
export function validateUnitExecutionPlan(
  plan: UnitExecutionPlanData,
  mapping: ATPUnitMappingData,
  atp?: ATPData | null,
  tp?: TPData | null
): UnitExecutionPlanValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const isStale = isUnitExecutionPlanStale(plan, mapping);
  if (isStale) {
    warnings.push(
      'Struktur Pertemuan dibuat berdasarkan versi Pemetaan Unit/Bab yang lebih lama.'
    );
  }

  // 1. Structural Validation
  if (plan.academicSettingId !== mapping.academicSettingId) {
    errors.push(
      `academicSettingId plan ('${plan.academicSettingId}') tidak cocok dengan mapping ('${mapping.academicSettingId}')`
    );
  }

  if (plan.mappingId !== mapping.id) {
    errors.push(
      `mappingId plan ('${plan.mappingId}') tidak cocok dengan mapping.id ('${mapping.id}')`
    );
  }

  const mappingUnitsMap = new Map((mapping.units || []).map((u) => [u.id, u]));
  const seenPlanUnitIds = new Set<string>();
  const globalMeetingIds = new Set<string>();

  const atpItemIdsSet = atp ? new Set(atp.items.map((i) => i.id)) : null;
  const tpItemIdsSet = tp ? new Set(tp.items.map((i) => i.id)) : null;

  for (const planUnit of plan.units || []) {
    // Duplicate UnitExecutionPlan.unitId
    if (seenPlanUnitIds.has(planUnit.unitId)) {
      errors.push(`Terdapat duplikasi unitId '${planUnit.unitId}' dalam plan.units`);
    } else {
      seenPlanUnitIds.add(planUnit.unitId);
    }

    // Unit not found in mapping.units (EXTRA Unit = Error)
    const mappingUnit = mappingUnitsMap.get(planUnit.unitId);
    if (!mappingUnit) {
      errors.push(
        `UnitExecutionPlan merujuk unitId '${planUnit.unitId}' yang tidak ditemukan pada Pemetaan Unit/Bab`
      );
      continue;
    }

    const mappingMaterialIds = new Set(mappingUnit.materials.map((m) => m.id));
    const mappingAtpItemIds = new Set(mappingUnit.linkedAtpItemIds || []);
    const mappingTpIds = new Set(mappingUnit.linkedTpIds || []);

    // Canonical lineage authority: Unit must have linked ATPs and TPs
    if (!mappingUnit.linkedAtpItemIds || mappingUnit.linkedAtpItemIds.length === 0) {
      errors.push(`Unit '${mappingUnit.title || mappingUnit.id}' wajib memiliki minimal satu langkah ATP tertaut.`);
    }
    if (!mappingUnit.linkedTpIds || mappingUnit.linkedTpIds.length === 0) {
      errors.push(`Unit '${mappingUnit.title || mappingUnit.id}' wajib memiliki minimal satu TP tertaut.`);
    }

    // Unit TPs must be supported by unit ATPs
    if (atp && atp.items && mappingUnit.linkedAtpItemIds && mappingUnit.linkedAtpItemIds.length > 0) {
      const unitSupportedTpSet = new Set<string>();
      mappingUnit.linkedAtpItemIds.forEach((atpId) => {
        const atpItem = atp.items.find((i) => i.id === atpId);
        if (atpItem) {
          const itemTps = Array.isArray(atpItem.linkedTpIds) && atpItem.linkedTpIds.length > 0
            ? atpItem.linkedTpIds
            : atpItem.tpId ? [atpItem.tpId] : [];
          itemTps.forEach((tId) => unitSupportedTpSet.add(tId));
        }
      });

      for (const tpId of mappingUnit.linkedTpIds || []) {
        if (!unitSupportedTpSet.has(tpId)) {
          errors.push(
            `Unit '${mappingUnit.title || mappingUnit.id}' memuat TP '${tpId}' yang tidak didukung oleh ATP pada unit tersebut.`
          );
        }
      }
    }

    // Canonical material validation before meetings:
    for (const mat of mappingUnit.materials || []) {
      const matAtpIds = mat.linkedAtpItemIds || [];
      const matTpIds = mat.linkedTpIds || [];

      if (matAtpIds.length === 0) {
        errors.push(
          `Lingkup Materi '${mat.title || mat.id}' pada Unit '${mappingUnit.title || mappingUnit.id}' wajib memiliki minimal satu langkah ATP tertaut.`
        );
      }
      if (matTpIds.length === 0) {
        errors.push(
          `Lingkup Materi '${mat.title || mat.id}' pada Unit '${mappingUnit.title || mappingUnit.id}' wajib memiliki minimal satu TP tertaut.`
        );
      }

      // material ATP ⊆ Unit ATP
      for (const id of matAtpIds) {
        if (!mappingAtpItemIds.has(id)) {
          errors.push(
            `Lingkup Materi '${mat.title || mat.id}' merujuk ATP '${id}' di luar langkah ATP Unit '${mappingUnit.title || mappingUnit.id}'.`
          );
        }
      }

      // material TP ⊆ Unit TP
      for (const id of matTpIds) {
        if (!mappingTpIds.has(id)) {
          errors.push(
            `Lingkup Materi '${mat.title || mat.id}' merujuk TP '${id}' di luar TP Unit '${mappingUnit.title || mappingUnit.id}'.`
          );
        }
      }

      // material TP didukung oleh material ATP
      if (atp && atp.items && matAtpIds.length > 0) {
        const matSupportedTpSet = new Set<string>();
        matAtpIds.forEach((atpId) => {
          const atpItem = atp.items.find((i) => i.id === atpId);
          if (atpItem) {
            const itemTps = Array.isArray(atpItem.linkedTpIds) && atpItem.linkedTpIds.length > 0
              ? atpItem.linkedTpIds
              : atpItem.tpId ? [atpItem.tpId] : [];
            itemTps.forEach((tId) => matSupportedTpSet.add(tId));
          }
        });
        for (const id of matTpIds) {
          if (!matSupportedTpSet.has(id)) {
            errors.push(
              `Lingkup Materi '${mat.title || mat.id}' memuat TP '${id}' yang tidak didukung oleh ATP materi tersebut.`
            );
          }
        }
      }
    }

    const seenUnitOrders = new Set<number>();

    for (const m of planUnit.meetings || []) {
      // Non-empty meeting ID check
      if (typeof m.id !== 'string' || !m.id.trim()) {
        errors.push(`Meeting pada Unit '${planUnit.unitId}' memiliki ID kosong.`);
      } else if (globalMeetingIds.has(m.id)) {
        errors.push(`Terdapat duplikasi meeting ID '${m.id}' secara global`);
      } else {
        globalMeetingIds.add(m.id);
      }

      // meeting.unitId !== parent unitId
      if (m.unitId !== planUnit.unitId) {
        errors.push(
          `Meeting '${m.id}' memiliki unitId '${m.unitId}' yang tidak sesuai dengan parent unitId '${planUnit.unitId}'`
        );
      }

      // meeting.order positive integer
      if (!Number.isInteger(m.order) || m.order <= 0) {
        errors.push(`Meeting '${m.id}' memiliki order (${m.order}) yang bukan integer positif`);
      }

      // duplicate meeting.order in same unit
      if (seenUnitOrders.has(m.order)) {
        errors.push(`Terdapat duplikasi meeting.order (${m.order}) pada unit '${planUnit.unitId}'`);
      } else {
        seenUnitOrders.add(m.order);
      }

      // meeting.title empty / whitespace
      if (!m.title || !m.title.trim()) {
        errors.push(`Meeting '${m.id}' memiliki title kosong`);
      }

      // duplicate IDs within meeting reference arrays
      if (new Set(m.materialIds || []).size !== (m.materialIds || []).length) {
        errors.push(`Meeting '${m.id}' mengandung duplikasi ID pada materialIds`);
      }
      if (new Set(m.linkedAtpItemIds || []).size !== (m.linkedAtpItemIds || []).length) {
        errors.push(`Meeting '${m.id}' mengandung duplikasi ID pada linkedAtpItemIds`);
      }
      if (new Set(m.linkedTpIds || []).size !== (m.linkedTpIds || []).length) {
        errors.push(`Meeting '${m.id}' mengandung duplikasi ID pada linkedTpIds`);
      }

      // Fail-closed meeting lineage: no material-only, ATP-only, or TP-only meeting
      const mMatIds = m.materialIds || [];
      const mAtpIds = m.linkedAtpItemIds || [];
      const mTpIds = m.linkedTpIds || [];

      const hasAnyLineage = mMatIds.length > 0 || mAtpIds.length > 0 || mTpIds.length > 0;
      if (hasAnyLineage) {
        if (mMatIds.length === 0) {
          errors.push(
            `Meeting '${m.title || m.id}' memiliki relasi ATP/TP namun materialIds kosong (wajib memilih Lingkup Materi).`
          );
        }
        if (mAtpIds.length === 0) {
          errors.push(
            `Meeting '${m.title || m.id}' memiliki materi/TP namun linkedAtpItemIds kosong (wajib memiliki minimal satu ATP).`
          );
        }
        if (mTpIds.length === 0) {
          errors.push(
            `Meeting '${m.title || m.id}' memiliki materi/ATP namun linkedTpIds kosong (wajib memiliki minimal satu TP).`
          );
        }
      }

      // materialIds refer to materials within same unit
      for (const matId of mMatIds) {
        if (!mappingMaterialIds.has(matId)) {
          errors.push(
            `Meeting '${m.id}' merujuk materialId '${matId}' yang tidak ada pada unit '${mappingUnit.id}'`
          );
        } else {
          // Meeting lineage must cover the ATP and TP of the materials used
          const mat = mappingUnit.materials.find((x) => x.id === matId);
          if (mat) {
            for (const matAtpId of mat.linkedAtpItemIds || []) {
              if (!mAtpIds.includes(matAtpId)) {
                errors.push(
                  `Meeting '${m.title || m.id}' menggunakan materi '${mat.title || mat.id}' yang memerlukan ATP '${matAtpId}', tetapi ATP tersebut tidak ada pada meeting.`
                );
              }
            }
            for (const matTpId of mat.linkedTpIds || []) {
              if (!mTpIds.includes(matTpId)) {
                errors.push(
                  `Meeting '${m.title || m.id}' menggunakan materi '${mat.title || mat.id}' yang memerlukan TP '${matTpId}', tetapi TP tersebut tidak ada pada meeting.`
                );
              }
            }
          }
        }
      }

      // linkedAtpItemIds refer to ATP items within same unit
      for (const atpItemId of m.linkedAtpItemIds || []) {
        if (!mappingAtpItemIds.has(atpItemId)) {
          errors.push(
            `Meeting '${m.id}' merujuk ATP item ID '${atpItemId}' yang tidak ada pada unit '${mappingUnit.id}'`
          );
        }
        if (atpItemIdsSet && !atpItemIdsSet.has(atpItemId)) {
          errors.push(
            `Meeting '${m.id}' merujuk ATP item ID '${atpItemId}' yang tidak ditemukan pada ATPData`
          );
        }
      }

      // linkedTpIds refer to TPs within same unit
      for (const tpId of m.linkedTpIds || []) {
        if (!mappingTpIds.has(tpId)) {
          errors.push(
            `Meeting '${m.id}' merujuk TP ID '${tpId}' yang tidak ada pada unit '${mappingUnit.id}'`
          );
        }
        if (tpItemIdsSet && !tpItemIdsSet.has(tpId)) {
          errors.push(
            `Meeting '${m.id}' merujuk TP ID '${tpId}' yang tidak ditemukan pada TPData`
          );
        }
      }

      // meeting TPs must be supported by meeting ATPs
      if (atp && atp.items && (m.linkedAtpItemIds || []).length > 0) {
        const meetingSupportedTpSet = new Set<string>();
        (m.linkedAtpItemIds || []).forEach((atpId) => {
          const atpItem = atp.items.find((i) => i.id === atpId);
          if (atpItem) {
            const itemTps = Array.isArray(atpItem.linkedTpIds) && atpItem.linkedTpIds.length > 0
              ? atpItem.linkedTpIds
              : atpItem.tpId ? [atpItem.tpId] : [];
            itemTps.forEach((tId) => meetingSupportedTpSet.add(tId));
          }
        });
        for (const tpId of m.linkedTpIds || []) {
          if (!meetingSupportedTpSet.has(tpId)) {
            errors.push(
              `Meeting '${m.title || m.id}' memiliki TP '${tpId}' yang tidak didukung oleh ATP pada meeting tersebut.`
            );
          }
        }
      }
    }
  }

  const isValid = errors.length === 0;

  // 2. Completeness / Coverage Analysis
  const missingUnitIds: string[] = [];
  const coverage: UnitMeetingCoverageResult[] = [];

  let allUnitsHaveMeetings = true;
  let allCoverageComplete = true;

  for (const mappingUnit of mapping.units || []) {
    const planUnit = (plan.units || []).find((u) => u.unitId === mappingUnit.id);
    if (!planUnit) {
      missingUnitIds.push(mappingUnit.id);
      allUnitsHaveMeetings = false;
    } else if (!planUnit.meetings || planUnit.meetings.length === 0) {
      allUnitsHaveMeetings = false;
    }

    const meetingMaterialIds = new Set<string>();
    const meetingAtpItemIds = new Set<string>();
    const meetingTpIds = new Set<string>();

    if (planUnit && planUnit.meetings) {
      for (const m of planUnit.meetings) {
        (m.materialIds || []).forEach((id) => meetingMaterialIds.add(id));
        (m.linkedAtpItemIds || []).forEach((id) => meetingAtpItemIds.add(id));
        (m.linkedTpIds || []).forEach((id) => meetingTpIds.add(id));
      }
    }

    const missingMaterialIds = (mappingUnit.materials || [])
      .map((m) => m.id)
      .filter((id) => !meetingMaterialIds.has(id));

    const missingAtpItemIds = (mappingUnit.linkedAtpItemIds || [])
      .filter((id) => !meetingAtpItemIds.has(id));

    const missingTpIds = (mappingUnit.linkedTpIds || [])
      .filter((id) => !meetingTpIds.has(id));

    const hasAnyEmptyMeeting = (planUnit?.meetings || []).some(
      (m) =>
        (m.materialIds || []).length === 0 ||
        (m.linkedAtpItemIds || []).length === 0 ||
        (m.linkedTpIds || []).length === 0
    );

    if (
      missingMaterialIds.length > 0 ||
      missingAtpItemIds.length > 0 ||
      missingTpIds.length > 0 ||
      hasAnyEmptyMeeting
    ) {
      allCoverageComplete = false;
    }

    coverage.push({
      unitId: mappingUnit.id,
      missingMaterialIds,
      missingAtpItemIds,
      missingTpIds,
    });
  }

  const isComplete =
    isValid &&
    !isStale &&
    missingUnitIds.length === 0 &&
    allUnitsHaveMeetings &&
    allCoverageComplete;

  return {
    isValid,
    isComplete,
    isStale,
    errors,
    warnings,
    missingUnitIds,
    coverage,
  };
}
