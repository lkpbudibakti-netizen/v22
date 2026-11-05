import { validateLearningPlanActivityMeetings, ActivityMeetingScope } from './learningPlanActivityMeetingService';
import {
  LearningPlan,
  LearningPlanStatus,
  LearningPlanSource,
  AcademicSetting,
  TPData,
  ATPData,
  K13Analysis,
  TimeAllocation,
  AssessmentCriterion,
  CurriculumType,
  TPItem,
  ATPItem,
  LearningExperience,
  LearningExperiencePhase,
  DeepLearningPrinciple,
  DeepLearningContext,
  LearningObjectiveReference,
  AssessmentPlanItem,
  LearningResource,
  ATPUnitMappingData,
  UnitExecutionPlanData,
  LearningMeetingScheduleData,
  AcademicCalendar, CalendarDay, SubjectWeeklySchedule, SemesterJPSetting, AnnualJPReference,
} from '../types';
import { isLearningMeetingScheduleReady } from './learningMeetingScheduleService';
import { resolveSemesterJPFromValues } from './semesterJPResolver';
import { resolveATPItemTPReferences } from './cpWorkflowService';
import {
  resolveScheduledLearningMeetings,
  ScheduledLearningMeetingProjection,
} from './scheduledLearningMeetingProjectionService';
import {
  CANONICAL_GRADUATE_PROFILE_DIMENSIONS,
  isCanonicalGraduateProfileDimension,
  validateGraduateProfileDimensions,
} from '../constants/graduateProfileDimensions';

export {
  CANONICAL_GRADUATE_PROFILE_DIMENSIONS,
  isCanonicalGraduateProfileDimension,
  validateGraduateProfileDimensions,
};

export const LEARNING_EXPERIENCE_PHASE_LABELS: Record<LearningExperiencePhase, string> = {
  UNDERSTAND: 'Memahami',
  APPLY: 'Mengaplikasi',
  REFLECT: 'Merefleksi',
};

export const DEEP_LEARNING_PRINCIPLE_LABELS: Record<DeepLearningPrinciple, string> = {
  MINDFUL: 'Berkesadaran',
  MEANINGFUL: 'Bermakna',
  JOYFUL: 'Menggembirakan',
};

export const GRADUATE_PROFILE_DIMENSIONS_LABEL = 'Dimensi Profil Lulusan';
export const LEARNING_EXPERIENCES_LABEL = 'Pengalaman Belajar';

export function normalizeLearningExperiencePhase(raw: unknown): LearningExperiencePhase | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toUpperCase();
  if (s === 'UNDERSTAND' || s === 'MEMAHAMI') {
    return 'UNDERSTAND';
  }
  if (s === 'APPLY' || s === 'MENGAPLIKASI' || s === 'MENGAPLIKASIKAN') {
    return 'APPLY';
  }
  if (s === 'REFLECT' || s === 'MEREFLEKSI' || s === 'MEREFLEKSIKAN') {
    return 'REFLECT';
  }
  return null;
}

export function normalizeDeepLearningPrinciple(raw: unknown): DeepLearningPrinciple | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toUpperCase();
  if (s === 'MINDFUL' || s === 'BERKESADARAN') return 'MINDFUL';
  if (s === 'MEANINGFUL' || s === 'BERMAKNA') return 'MEANINGFUL';
  if (s === 'JOYFUL' || s === 'MENGGEMBIRAKAN') return 'JOYFUL';
  return null;
}

export interface LearningPlanObjectiveResolution {
  objectives: LearningObjectiveReference[];
  danglingIds: string[];
}

export interface LearningPlanScopeUnit {
  id: string;
  type: 'CANONICAL_UNIT' | 'ATP_STEP' | 'SINGLE_TP';
  title: string;
  unitId?: string;
  learningMeetingIds?: string[];
  stepNumber?: number;
  tpCode?: string;
  tpItem?: TPItem;
  tpItems?: TPItem[];
  atpItem?: ATPItem;
  atpItems?: ATPItem[];
  linkedTpIds: string[];
  linkedAtpItemIds: string[];
  unitTitle?: string;
  materialScope?: string;
  materials?: { id: string; title: string }[];
  jp?: number | null;
  meetings?: {
    meetingId: string;
    order: number;
    title: string;
    date?: string;
    jp: number;
    materials?: { id: string; title: string }[];
    linkedTpIds?: string[];
    linkedAtpItemIds?: string[];
  }[];
}

export function isAtpReadyForAIScope(atpData?: ATPData | null): boolean {
  if (!atpData || !atpData.items || atpData.items.length === 0) return false;
  return atpData.workflowStatus === 'SIAP' && !atpData.needsReview;
}

/**
 * Resolves semester JP for an ATP item strictly from active semester TimeAllocation records.
 * Ignores ASSESSMENT and RESERVE allocations.
 * Never falls back to annual ATPItem.jp or legacy ATPItem.allocatedJP.
 */
export function resolveAtpItemSemesterJP(
  atpItem: ATPItem,
  timeAllocations?: TimeAllocation[] | null
): number | null {
  if (!timeAllocations || timeAllocations.length === 0) return null;
  const matches = timeAllocations.filter((ta) => {
    if (ta.sourceType === 'ASSESSMENT' || ta.sourceType === 'RESERVE') return false;
    const isExact = ta.sourceId === atpItem.id || ta.atpItemId === atpItem.id;
    if (!isExact) return false;
    if (ta.sourceType === 'ATP_ITEM' || !ta.sourceType) return true;
    return false;
  });
  if (matches.length === 0) return null;
  const total = matches.reduce((sum, ta) => {
    const val = typeof ta.allocatedJP === 'number' && ta.allocatedJP > 0
      ? ta.allocatedJP
      : typeof ta.jp === 'number' && ta.jp > 0
      ? ta.jp
      : 0;
    return sum + val;
  }, 0);
  return total > 0 ? total : null;
}

export interface SemesterAllocationBundleLike {
  allocations: TimeAllocation[];
  semester?: 1 | 2 | number;
  semesterPlanId?: string;
}

/**
 * Resolves canonical annual JP for an ATP item across available semester allocations or TimeAllocation collections.
 * Ignores ASSESSMENT and RESERVE allocations.
 * Accepts ATP_ITEM source only.
 * Sums positive allocatedJP (fallback to positive jp) across matched TimeAllocation records.
 * Deduplicates TimeAllocation records by ID.
 * Returns null when unresolved.
 * Never falls back to legacy ATPItem.allocatedJP or ATPItem.jp.
 */
export function resolveAtpItemAnnualJP(
  atpItem: ATPItem,
  allocationSource?: (TimeAllocation | SemesterAllocationBundleLike)[] | TimeAllocation[] | SemesterAllocationBundleLike[] | null
): number | null {
  if (!atpItem || !allocationSource || allocationSource.length === 0) return null;

  // Flatten allocations from either semester allocation bundles or direct TimeAllocation arrays
  const rawAllocations: TimeAllocation[] = [];
  for (const entry of allocationSource) {
    if (!entry) continue;
    if ('allocations' in entry && Array.isArray((entry as SemesterAllocationBundleLike).allocations)) {
      rawAllocations.push(...(entry as SemesterAllocationBundleLike).allocations);
    } else if ('sourceId' in entry || 'allocatedJP' in entry || 'jp' in entry || 'id' in entry) {
      rawAllocations.push(entry as TimeAllocation);
    }
  }

  if (rawAllocations.length === 0) return null;

  // Avoid duplicate allocation records by ID
  const seenIds = new Set<string>();
  const uniqueAllocations: TimeAllocation[] = [];
  for (const alloc of rawAllocations) {
    if (alloc.id) {
      if (seenIds.has(alloc.id)) continue;
      seenIds.add(alloc.id);
    }
    uniqueAllocations.push(alloc);
  }

  const matches = uniqueAllocations.filter((ta) => {
    if (ta.sourceType === 'ASSESSMENT' || ta.sourceType === 'RESERVE') return false;
    const isExact = ta.sourceId === atpItem.id || ta.atpItemId === atpItem.id;
    if (!isExact) return false;
    if (ta.sourceType === 'ATP_ITEM' || !ta.sourceType) return true;
    return false;
  });

  if (matches.length === 0) return null;

  const total = matches.reduce((sum, ta) => {
    const val = typeof ta.allocatedJP === 'number' && ta.allocatedJP > 0
      ? ta.allocatedJP
      : typeof ta.jp === 'number' && ta.jp > 0
      ? ta.jp
      : 0;
    return sum + val;
  }, 0);

  return total > 0 ? total : null;
}

/**
 * Resolves semester JP for a direct TP allocation strictly from active semester TimeAllocation records.
 * Ignores ASSESSMENT and RESERVE allocations.
 */
export function resolveDirectTpSemesterJP(
  tpItem: TPItem,
  timeAllocations?: TimeAllocation[] | null
): number | null {
  if (!timeAllocations || timeAllocations.length === 0) return null;
  const matches = timeAllocations.filter((ta) => {
    if (ta.sourceType === 'ASSESSMENT' || ta.sourceType === 'RESERVE') return false;
    const isExact = ta.sourceId === tpItem.id || ta.tpId === tpItem.id;
    if (!isExact) return false;
    if (ta.sourceType === 'TP' || !ta.sourceType) return true;
    return false;
  });
  if (matches.length === 0) return null;
  const total = matches.reduce((sum, ta) => {
    const val = typeof ta.allocatedJP === 'number' && ta.allocatedJP > 0
      ? ta.allocatedJP
      : typeof ta.jp === 'number' && ta.jp > 0
      ? ta.jp
      : 0;
    return sum + val;
  }, 0);
  return total > 0 ? total : null;
}

/**
 * Canonical Resolver for Active Semester LearningPlan Scopes.
 * Pipeline: Annual TP + Annual ATP + Active Semester TimeAllocation -> Semester Learning Scope.
 * Only TP / ATP items that actually have positive learning TimeAllocation in the active semester are admitted.
 * Never guesses from TP codes or uses legacy ATPItem.semester.
 */
export function resolveSemesterLearningScopes(
  tpData?: TPData | null,
  atpData?: ATPData | null,
  timeAllocations?: TimeAllocation[] | null
): LearningPlanScopeUnit[] {
  const availableTps = tpData?.items || [];
  if (availableTps.length === 0) return [];
  if (!timeAllocations || timeAllocations.length === 0) return [];

  // 1. Process ATP items with positive active semester time allocation
  const atpScopes: LearningPlanScopeUnit[] = [];
  const representedTpIds = new Set<string>();

  if (isAtpReadyForAIScope(atpData) && atpData?.items) {
    for (let index = 0; index < atpData.items.length; index++) {
      const atpItem = atpData.items[index];
      if (!atpItem.tpId) continue;
      const linkedTp = availableTps.find((t) => t.id === atpItem.tpId);
      if (!linkedTp) continue;

      const allocatedJP = resolveAtpItemSemesterJP(atpItem, timeAllocations);
      // ONLY include if positive allocatedJP exists in active semester timeAllocations
      if (typeof allocatedJP === 'number' && allocatedJP > 0) {
        representedTpIds.add(linkedTp.id);
        const stepNo = atpItem.stepNumber || atpItem.sequence || index + 1;
        const material = atpItem.materialScope || linkedTp.contentScope || linkedTp.statement;

        atpScopes.push({
          id: atpItem.id,
          type: 'ATP_STEP',
          title: `Langkah ${stepNo}: ${material}`,
          stepNumber: stepNo,
          tpCode: linkedTp.code,
          tpItem: linkedTp,
          atpItem: atpItem,
          linkedTpIds: [linkedTp.id],
          linkedAtpItemIds: [atpItem.id],
          unitTitle: atpItem.unitTitle,
          materialScope: material,
          jp: allocatedJP,
        });
      }
    }
  }

  // 2. Direct TP allocations (for TPs not represented by active semester ATP scopes)
  const singleTpScopes: LearningPlanScopeUnit[] = [];
  for (const tpItem of availableTps) {
    if (representedTpIds.has(tpItem.id)) continue;
    const directJP = resolveDirectTpSemesterJP(tpItem, timeAllocations);
    if (typeof directJP === 'number' && directJP > 0) {
      singleTpScopes.push({
        id: tpItem.id,
        type: 'SINGLE_TP',
        title: tpItem.code ? `[${tpItem.code}] ${tpItem.statement}` : tpItem.statement,
        tpCode: tpItem.code || undefined,
        tpItem: tpItem,
        linkedTpIds: [tpItem.id],
        linkedAtpItemIds: [],
        materialScope: tpItem.contentScope,
        jp: directJP,
      });
    }
  }

  return [...atpScopes, ...singleTpScopes];
}

export const resolveAvailableScopes = resolveSemesterLearningScopes;

export interface BuildLearningPlanScopeUnitsParams {
  academicSetting?: AcademicSetting | null;
  atpUnitMapping?: ATPUnitMappingData | null;
  unitExecutionPlan?: UnitExecutionPlanData | null;
  learningMeetingSchedules?: Array<{
    semesterPlanId: string;
    semester: 1 | 2;
    schedule: LearningMeetingScheduleData;
  }> | null;
  tp?: TPData | null;
  atp?: ATPData | null;
  timeAllocations?: TimeAllocation[] | null;
}

/**
 * Builds canonical LearningPlan scopes per Unit/Bab from ScheduledLearningMeetingProjection.
 * 1 scope = 1 Unit/Bab.
 * Sums exact row.jp, groups all meetings, and unions linkedTpIds & linkedAtpItemIds.
 */
export function buildLearningPlanScopeUnits(
  paramsOrTp?: BuildLearningPlanScopeUnitsParams | TPData | null,
  legacyAtp?: ATPData | null,
  legacyTimeAllocations?: TimeAllocation[] | null
): LearningPlanScopeUnit[] {
  let params: BuildLearningPlanScopeUnitsParams;

  if (
    paramsOrTp &&
    typeof paramsOrTp === 'object' &&
    ('atpUnitMapping' in paramsOrTp ||
      'unitExecutionPlan' in paramsOrTp ||
      'learningMeetingSchedules' in paramsOrTp ||
      'academicSetting' in paramsOrTp)
  ) {
    params = paramsOrTp as BuildLearningPlanScopeUnitsParams;
  } else {
    params = {
      tp: paramsOrTp as TPData | null,
      atp: legacyAtp,
      timeAllocations: legacyTimeAllocations,
    };
  }

  const {
    academicSetting,
    atpUnitMapping,
    unitExecutionPlan,
    learningMeetingSchedules,
    tp,
    atp,
    timeAllocations,
  } = params;

  // 1. Canonical authority: ScheduledLearningMeetingProjection
  if (
    atpUnitMapping &&
    unitExecutionPlan &&
    learningMeetingSchedules &&
    learningMeetingSchedules.length > 0
  ) {
    const projectionResult = resolveScheduledLearningMeetings({
      mapping: atpUnitMapping,
      unitExecutionPlan,
      schedules: learningMeetingSchedules,
      tp: tp || undefined,
      atp: atp || undefined,
    });

    if (!projectionResult.isValid || projectionResult.rows.length === 0) {
      return [];
    }

    const activeSettingId = academicSetting?.id;
    const semesterRows = activeSettingId
      ? projectionResult.rows.filter((r) => r.semesterPlanId === activeSettingId)
      : projectionResult.rows;

    if (semesterRows.length === 0) {
      return [];
    }

    // Group rows per unitId
    const unitMap = new Map<string, typeof semesterRows>();
    const unitOrderMap = new Map<string, number>();

    for (const row of semesterRows) {
      if (!unitMap.has(row.unitId)) {
        unitMap.set(row.unitId, []);
        unitOrderMap.set(row.unitId, row.unitOrder);
      }
      unitMap.get(row.unitId)!.push(row);
    }

    const availableTps = tp?.items || [];
    const availableAtps = atp?.items || [];
    const unitScopes: LearningPlanScopeUnit[] = [];

    for (const [unitId, rowsForUnit] of unitMap.entries()) {
      const firstRow = rowsForUnit[0];
      const unitTitle = firstRow.unitTitle;
      const learningMeetingIds = rowsForUnit.map((r) => r.meetingId);

      // Deterministic union of linkedTpIds
      const linkedTpIdSet = new Set<string>();
      const linkedTpIds: string[] = [];
      for (const r of rowsForUnit) {
        for (const tpId of r.linkedTpIds || []) {
          if (!linkedTpIdSet.has(tpId)) {
            linkedTpIdSet.add(tpId);
            linkedTpIds.push(tpId);
          }
        }
      }

      // Deterministic union of linkedAtpItemIds
      const linkedAtpIdSet = new Set<string>();
      const linkedAtpItemIds: string[] = [];
      for (const r of rowsForUnit) {
        for (const atpId of r.linkedAtpItemIds || []) {
          if (!linkedAtpIdSet.has(atpId)) {
            linkedAtpIdSet.add(atpId);
            linkedAtpItemIds.push(atpId);
          }
        }
      }

      // Exact sum of JP across all meetings
      const totalJP = rowsForUnit.reduce((sum, r) => sum + (Number(r.jp) || 0), 0);

      // Deduplicated materials from projection
      const seenMatId = new Set<string>();
      const materials: { id: string; title: string }[] = [];
      for (const r of rowsForUnit) {
        for (const mat of r.materials || []) {
          if (!seenMatId.has(mat.id)) {
            seenMatId.add(mat.id);
            materials.push(mat);
          }
        }
      }

      const materialScope = materials.map((m) => m.title).join(', ');
      const matchedTps = availableTps.filter((t) => linkedTpIdSet.has(t.id));
      const matchedAtps = availableAtps.filter((a) => linkedAtpIdSet.has(a.id));

      const meetings = rowsForUnit.map((r) => ({
        meetingId: r.meetingId,
        order: r.meetingOrder,
        title: r.meetingTitle,
        date: r.date || undefined,
        jp: r.jp,
        materials: r.materials,
        linkedTpIds: r.linkedTpIds,
        linkedAtpItemIds: r.linkedAtpItemIds,
      }));

      unitScopes.push({
        id: unitId,
        type: 'CANONICAL_UNIT',
        title: unitTitle,
        unitId,
        unitTitle,
        learningMeetingIds,
        linkedTpIds,
        linkedAtpItemIds,
        materials,
        materialScope,
        jp: totalJP > 0 ? totalJP : null,
        tpItems: matchedTps,
        tpItem: matchedTps[0],
        atpItems: matchedAtps,
        atpItem: matchedAtps[0],
        meetings,
      });
    }

    unitScopes.sort((a, b) => {
      const orderA = unitOrderMap.get(a.unitId || '') ?? 999;
      const orderB = unitOrderMap.get(b.unitId || '') ?? 999;
      return orderA - orderB;
    });

    return unitScopes;
  }

  // 2. Legacy fallback for non-canonical / K13 workspaces
  if (academicSetting?.curriculumType === 'K13') {
    return resolveSemesterLearningScopes(tp, atp, timeAllocations);
  }

  return [];
}

export function resolveLearningPlanObjectives(params: {
  tpIds?: string[];
  tp?: TPData | null;
  k13Analysis?: K13Analysis | null;
  curriculumType?: CurriculumType;
}): LearningPlanObjectiveResolution {
  const objectives: LearningObjectiveReference[] = [];
  const danglingIds: string[] = [];
  const orderedIds = Array.isArray(params.tpIds) ? params.tpIds.filter(Boolean) : [];

  for (const id of orderedIds) {
    const tpItem = params.tp?.items?.find((item) => item.id === id);
    if (tpItem) {
      objectives.push({
        id: tpItem.id,
        tpId: tpItem.id,
        code: tpItem.code,
        statement: tpItem.statement || tpItem.description || '',
        materialScope: tpItem.contentScope,
      });
      continue;
    }

    if (params.curriculumType === 'K13') {
      const k13Item = params.k13Analysis?.items?.find((item) => item.id === id);
      if (k13Item) {
        objectives.push({
          id: k13Item.id,
          tpId: k13Item.id,
          code: k13Item.kd ? k13Item.kd.slice(0, 24) : 'KD',
          statement: k13Item.tujuanPembelajaran || k13Item.indikator || k13Item.kd || '',
          materialScope: k13Item.materi,
        });
        continue;
      }
    }

    danglingIds.push(id);
  }

  return { objectives, danglingIds };
}

export interface LearningPlanJPResolution {
  allocatedJP?: number;
  source:
    | 'CANONICAL_MEETINGS'
    | 'EXPLICIT_PLAN'
    | 'CANONICAL_ATP'
    | 'LINKED_TIME_ALLOCATION'
    | 'UNRESOLVED';
  timeAllocationIds?: string[];
  issues?: string[];
}

/**
 * Resolves allocated JP strictly from real data hierarchy:
 * 1. canonical scheduled meetings (CANONICAL_MEETINGS) - Wins over stored allocatedJP and TimeAllocation!
 * 2. explicit LearningPlan.allocatedJP
 * 3. linked TimeAllocation (legacy fallback)
 * 4. UNRESOLVED
 */
export function resolveLearningPlanAllocatedJP(
  plan: LearningPlan,
  context: {
    atp?: ATPData | null;
    timeAllocations?: TimeAllocation[] | null;
    academicSetting?: AcademicSetting | null;
    atpUnitMapping?: ATPUnitMappingData | null;
    unitExecutionPlan?: UnitExecutionPlanData | null;
    learningMeetingSchedules?: Array<{
      semesterPlanId: string;
      semester: 1 | 2;
      schedule: LearningMeetingScheduleData;
    }> | null;
    scheduledMeetings?: ScheduledLearningMeetingProjection[] | null;
  }
): LearningPlanJPResolution {
  const issues: string[] = [];

  const isCanonicalPlan = Boolean(
    plan.unitId || (plan.learningMeetingIds && plan.learningMeetingIds.length > 0)
  );

  // 1. CANONICAL AUTHORITY: scheduled meetings projection (Fail-closed: NO fallback for canonical plans!)
  if (isCanonicalPlan) {
    let projectionRows: ScheduledLearningMeetingProjection[] = [];

    if (context.scheduledMeetings) {
      projectionRows = context.scheduledMeetings;
    } else if (
      context.atpUnitMapping &&
      context.unitExecutionPlan &&
      context.learningMeetingSchedules &&
      context.learningMeetingSchedules.length > 0
    ) {
      const proj = resolveScheduledLearningMeetings({
        mapping: context.atpUnitMapping,
        unitExecutionPlan: context.unitExecutionPlan,
        schedules: context.learningMeetingSchedules,
        tp: undefined,
        atp: context.atp || undefined,
      });
      if (proj.isValid) {
        projectionRows = proj.rows;
      } else {
        issues.push(...proj.errors);
        return {
          source: 'UNRESOLVED',
          issues: issues.length > 0 ? issues : ['Proyeksi jadwal pertemuan canonical tidak valid.'],
        };
      }
    } else {
      return {
        source: 'UNRESOLVED',
        issues: ['Proyeksi jadwal pertemuan canonical tidak tersedia untuk rencana pembelajaran ini.'],
      };
    }

    const activeSettingId = context.academicSetting?.id || plan.academicSettingId;
    const semesterRows = activeSettingId
      ? projectionRows.filter((r) => r.semesterPlanId === activeSettingId)
      : projectionRows;

    if (semesterRows.length === 0) {
      return {
        source: 'UNRESOLVED',
        issues: ['Tidak ada jadwal pertemuan canonical pada semester aktif.'],
      };
    }

    let matchedRows: ScheduledLearningMeetingProjection[] = [];

    if (plan.unitId) {
      matchedRows = semesterRows.filter((r) => r.unitId === plan.unitId);
      if (matchedRows.length === 0) {
        return {
          source: 'UNRESOLVED',
          issues: [`Tidak ada jadwal pertemuan untuk Unit '${plan.unitId}' pada semester aktif.`],
        };
      }
      if (plan.learningMeetingIds && plan.learningMeetingIds.length > 0) {
        const canonicalMeetingIds = matchedRows.map((r) => r.meetingId);
        const canonicalSet = new Set(canonicalMeetingIds);
        const planSet = new Set(plan.learningMeetingIds);
        if (canonicalSet.size !== planSet.size || !canonicalMeetingIds.every((id) => planSet.has(id))) {
          return {
            source: 'UNRESOLVED',
            issues: ['Daftar learningMeetingIds rencana tidak sesuai dengan jadwal pertemuan canonical Unit.'],
          };
        }
      }
    } else if (plan.learningMeetingIds && plan.learningMeetingIds.length > 0) {
      const semesterMeetingMap = new Map(semesterRows.map((r) => [r.meetingId, r]));
      let inferredUnitId: string | null = null;
      for (const mId of plan.learningMeetingIds) {
        const row = semesterMeetingMap.get(mId);
        if (!row) {
          return {
            source: 'UNRESOLVED',
            issues: [`Pertemuan '${mId}' tidak ditemukan pada semester aktif.`],
          };
        }
        if (!inferredUnitId) {
          inferredUnitId = row.unitId;
        } else if (inferredUnitId !== row.unitId) {
          return {
            source: 'UNRESOLVED',
            issues: [`Pertemuan rencana berasal dari lebih dari satu Unit/Bab ('${inferredUnitId}' dan '${row.unitId}').`],
          };
        }
        matchedRows.push(row);
      }

      if (inferredUnitId) {
        const canonicalUnitRows = semesterRows.filter((r) => r.unitId === inferredUnitId);
        const canonicalMeetingIds = canonicalUnitRows.map((r) => r.meetingId);
        const canonicalSet = new Set(canonicalMeetingIds);
        const planSet = new Set(plan.learningMeetingIds);
        if (canonicalSet.size !== planSet.size || !canonicalMeetingIds.every((id) => planSet.has(id))) {
          return {
            source: 'UNRESOLVED',
            issues: ['Daftar learningMeetingIds rencana tidak sesuai dengan jadwal pertemuan canonical Unit.'],
          };
        }
      }
    }

    const totalJP = matchedRows.reduce((sum, r) => sum + (Number(r.jp) || 0), 0);
    if (totalJP > 0) {
      return {
        allocatedJP: totalJP,
        source: 'CANONICAL_MEETINGS',
        issues,
      };
    }

    return {
      source: 'UNRESOLVED',
      issues: ['Alokasi JP canonical bernilai 0 atau tidak valid.'],
    };
  }

  // 2. Explicit LearningPlan.allocatedJP (fallback if non-canonical plan)
  if (typeof plan.allocatedJP === 'number' && !isNaN(plan.allocatedJP) && plan.allocatedJP > 0) {
    return { allocatedJP: plan.allocatedJP, source: 'EXPLICIT_PLAN' };
  }

  // 3. Linked TimeAllocation (legacy fallback only for non-canonical plan)
  if (context.timeAllocations && context.timeAllocations.length > 0) {
    const scopedAllocations = context.timeAllocations.filter(
      (ta) => !ta.academicSettingId || ta.academicSettingId === plan.academicSettingId
    );

    const matchedAllocs: TimeAllocation[] = [];

    for (const ta of scopedAllocations) {
      if (ta.sourceType === 'ASSESSMENT' || ta.sourceType === 'RESERVE') {
        continue;
      }

      // 1. Explicitly referenced by ID
      const matchedById = plan.timeAllocationIds?.includes(ta.id || '');
      if (matchedById) {
        matchedAllocs.push(ta);
        continue;
      }

      // 2. Referenced by ATP Item ID (strictly sourceType === 'ATP_ITEM' or absent)
      const planAtpIds = plan.atpItemIds || [];
      if (planAtpIds.length > 0) {
        const atpItemId = ta.atpItemId || '';
        const sourceId = ta.sourceId || '';
        const matchesAtp = planAtpIds.includes(atpItemId) || planAtpIds.includes(sourceId);
        if (matchesAtp) {
          if (!ta.sourceType || ta.sourceType === 'ATP_ITEM') {
            matchedAllocs.push(ta);
            continue;
          }
        }
      }

      // 3. Fallback to TP ID (only if no ATP item ids are specified in the plan)
      const planTpIds = plan.tpIds || [];
      if (planAtpIds.length === 0 && planTpIds.length > 0) {
        if (ta.tpId && planTpIds.includes(ta.tpId)) {
          matchedAllocs.push(ta);
        }
      }
    }

    const uniqueMatchedAllocs: TimeAllocation[] = [];
    const seenIds = new Set<string>();
    for (const ta of matchedAllocs) {
      if (ta.id && !seenIds.has(ta.id)) {
        seenIds.add(ta.id);
        uniqueMatchedAllocs.push(ta);
      }
    }

    const totalAllocJP = uniqueMatchedAllocs.reduce((sum, a) => {
      const val = typeof a.allocatedJP === 'number' && a.allocatedJP > 0
        ? a.allocatedJP
        : (typeof a.jp === 'number' && a.jp > 0 ? a.jp : 0);
      return sum + val;
    }, 0);

    if (totalAllocJP > 0) {
      return {
        allocatedJP: totalAllocJP,
        source: 'LINKED_TIME_ALLOCATION',
        timeAllocationIds: uniqueMatchedAllocs.map((a) => a.id).filter((id): id is string => typeof id === 'string'),
        issues,
      };
    }
  }

  // 4. UNRESOLVED
  return { allocatedJP: undefined, source: 'UNRESOLVED', issues };
}

export function normalizeAIReflection(raw: any): LearningPlan['reflection'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const teacherReflection = typeof raw.teacherReflection === 'string'
    ? raw.teacherReflection
    : (typeof raw.teacher === 'string' ? raw.teacher : undefined);
  const studentReflection = typeof raw.studentReflection === 'string'
    ? raw.studentReflection
    : (typeof raw.student === 'string' ? raw.student : undefined);
  if (!teacherReflection && !studentReflection) return undefined;
  return { teacherReflection, studentReflection };
}

export function normalizeDeepLearningContext(raw: any): DeepLearningContext | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const principles = Array.isArray(raw.principles)
    ? raw.principles
        .map((p: unknown) => normalizeDeepLearningPrinciple(p))
        .filter((p: DeepLearningPrinciple | null): p is DeepLearningPrinciple => p !== null)
    : undefined;
  const graduateProfileDimensions = Array.isArray(raw.graduateProfileDimensions)
    ? raw.graduateProfileDimensions.filter((d: unknown): d is string => typeof d === 'string' && d.trim().length > 0)
    : undefined;

  if ((!principles || principles.length === 0) && (!graduateProfileDimensions || graduateProfileDimensions.length === 0)) {
    return undefined;
  }

  return {
    principles: principles && principles.length > 0 ? Array.from(new Set(principles)) : undefined,
    graduateProfileDimensions,
  };
}

function normalizeAIAssessmentItems(rawItems: any, type: AssessmentPlanItem['type'], tpIds: string[]): AssessmentPlanItem[] {
  if (!Array.isArray(rawItems)) return [];
  const results: AssessmentPlanItem[] = [];
  for (let idx = 0; idx < rawItems.length; idx++) {
    const item = rawItems[idx];
    if (!item || typeof item !== 'object') continue;
    const description = typeof item.description === 'string' ? item.description.trim() : '';
    const technique = typeof item.technique === 'string' ? item.technique.trim() : undefined;
    const method = typeof item.method === 'string' ? item.method.trim() : undefined;
    const instrument = typeof item.instrument === 'string' ? item.instrument.trim() : undefined;
    if (!description) continue;
    results.push({
      id: `asm-${type.toLowerCase()}-${results.length + 1}-${Date.now().toString(36)}`,
      type,
      linkedTpIds: [...tpIds],
      method,
      technique,
      instrument,
      learningMeetingId: typeof item.learningMeetingId === 'string' && item.learningMeetingId.trim() ? item.learningMeetingId.trim() : undefined,
      description,
    });
  }
  return results;
}

export function validateAILearningPlanPayload(data: any): { isValid: boolean; reason?: string } {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { isValid: false, reason: 'Payload AI bukan berupa objek valid' };
  }

  if (!Array.isArray(data.learningExperiences) || data.learningExperiences.length === 0) {
    return { isValid: false, reason: 'Daftar Pengalaman Belajar (learningExperiences) kosong atau bukan array' };
  }

  const phaseSet = new Set<string>();
  for (let i = 0; i < data.learningExperiences.length; i++) {
    const exp = data.learningExperiences[i];
    if (!exp || typeof exp !== 'object') {
      return { isValid: false, reason: `Butir pengalaman belajar ke-${i + 1} bukan berupa objek` };
    }
    const normalizedPhase = normalizeLearningExperiencePhase(exp.phase);
    if (!normalizedPhase) {
      return { isValid: false, reason: `Fase pengalaman belajar ke-${i + 1} ('${exp.phase}') tidak valid. Pilihan sah: UNDERSTAND, APPLY, REFLECT` };
    }
    exp.phase = normalizedPhase;
    phaseSet.add(normalizedPhase);

    if (!exp.description || typeof exp.description !== 'string' || exp.description.trim() === '') {
      return { isValid: false, reason: `Deskripsi pengalaman belajar ke-${i + 1} kosong` };
    }

    exp.id = `exp-ai-${i + 1}`;
  }

  for (const phase of ['UNDERSTAND', 'APPLY', 'REFLECT']) {
    if (!phaseSet.has(phase)) {
      return { isValid: false, reason: `Pengalaman Belajar wajib memuat fase ${phase}` };
    }
  }

  return { isValid: true };
}

export function normalizeAIAssessmentPlan(raw: any, tpIds: string[]): LearningPlan['assessmentPlan'] {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    initial: normalizeAIAssessmentItems(source.initial, 'INITIAL', tpIds),
    formative: normalizeAIAssessmentItems(source.formative, 'FORMATIVE', tpIds),
    summative: normalizeAIAssessmentItems(source.summative, 'SUMMATIVE', tpIds),
  };
}

export function normalizeAIResources(raw: any): LearningPlan['resources'] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((resource, idx) => {
      if (typeof resource === 'string') {
        const title = resource.trim();
        return title ? { id: `res-ai-${idx + 1}-${Date.now().toString(36)}`, title } : null;
      }
      if (!resource || typeof resource !== 'object') return null;
      const title = typeof resource.title === 'string' && resource.title.trim()
        ? resource.title.trim()
        : (typeof resource.source === 'string' && resource.source.trim() ? resource.source.trim() : '');
      if (!title) return null;
      const resItem: LearningResource = {
        id: `res-ai-${idx + 1}-${Date.now().toString(36)}`,
        type: typeof resource.type === 'string' ? resource.type : undefined,
        title,
        source: typeof resource.source === 'string' ? resource.source : undefined,
        url: typeof resource.url === 'string' ? resource.url : undefined,
      };
      return resItem;
    })
    .filter((resource): resource is LearningResource => resource !== null);
}

export interface LearningPlanValidationResult {
  needsReview?: boolean;
  valid: boolean;
  isValid: boolean;
  errors: string[];
  warnings: string[];
  draftErrors: string[];
  finalizationErrors: string[];
  resolvedTPs: Array<{ id: string; code?: string; statement: string; materialScope?: string }>;
  resolvedATPs: Array<{ id: string; stepNumber?: number; materialScope?: string; jp?: number }>;
  resolvedAllocatedJP?: number;
  jpResolutionSource?:
    | 'CANONICAL_MEETINGS'
    | 'EXPLICIT_PLAN'
    | 'CANONICAL_ATP'
    | 'LINKED_TIME_ALLOCATION'
    | 'UNRESOLVED';
}

export interface LearningPlanActualTimeContext {
  calendar?: AcademicCalendar;
  calendarDays?: CalendarDay[];
  subjectWeeklySchedule?: SubjectWeeklySchedule;
  semesterJPSetting?: SemesterJPSetting;
  annualJPReference?: AnnualJPReference;
}

/**
 * Validates a canonical LearningPlan against workspace dependencies.
 * Follows strict principles:
 * - NO DATA > FAKE DATA
 * - ID > TEXT MATCH
 * - UNRESOLVED > GUESS
 * - VALIDATOR > AUTO SIAP
 * - AI OUTPUT = DRAFT
 * - TEACHER EDIT ALWAYS WINS
 */
export function validateLearningPlan(
  plan: LearningPlan,
  context: {
    academicSetting?: AcademicSetting | null;
    tp?: TPData | null;
    atp?: ATPData | null;
    atpUnitMapping?: ATPUnitMappingData | null;
    unitExecutionPlan?: UnitExecutionPlanData | null;
    learningMeetingSchedules?: Array<{
      semesterPlanId: string;
      semester: 1 | 2;
      schedule: LearningMeetingScheduleData;
    }> | null;
    scheduledMeetings?: ScheduledLearningMeetingProjection[] | null;
    k13Analysis?: K13Analysis | null;
    timeAllocations?: TimeAllocation[] | null;
    assessmentCriteria?: AssessmentCriterion[] | null;
  } & LearningPlanActualTimeContext
): LearningPlanValidationResult {
  const draftErrors: string[] = [];
  const finalizationErrors: string[] = [];
  const errors: string[] = draftErrors;
  const warnings: string[] = [];
  const resolvedTPs: Array<{ id: string; code?: string; statement: string; materialScope?: string }> = [];
  const resolvedATPs: Array<{ id: string; stepNumber?: number; materialScope?: string; jp?: number }> = [];

  if (!plan) {
    return {
      valid: false,
      isValid: false,
      errors: ['Data Perencanaan Pembelajaran (LearningPlan) tidak ditemukan / kosong.'],
      warnings: [],
      draftErrors: ['Data Perencanaan Pembelajaran (LearningPlan) tidak ditemukan / kosong.'],
      finalizationErrors: [],
      resolvedTPs: [],
      resolvedATPs: [],
      resolvedAllocatedJP: undefined,
      jpResolutionSource: 'UNRESOLVED',
    };
  }

  // 1. Validate Academic Setting linkage
  if (!plan.academicSettingId || plan.academicSettingId.trim() === '') {
    errors.push('ID Pengaturan Akademik (academicSettingId) tidak valid.');
  } else if (context.academicSetting && context.academicSetting.id !== plan.academicSettingId) {
    errors.push(`ID Pengaturan Akademik tidak sesuai (Plan: ${plan.academicSettingId}, Context: ${context.academicSetting.id}).`);
  }
  if (!plan.curriculumType || !context.academicSetting?.curriculumType || plan.curriculumType !== context.academicSetting.curriculumType) {
    errors.push('Kurikulum LearningPlan belum terselesaikan.');
  }

  const objectiveResolution = resolveLearningPlanObjectives({
    tpIds: plan.tpIds,
    tp: context.tp,
    k13Analysis: context.k13Analysis,
    curriculumType: plan.curriculumType,
  });

  if (plan.curriculumType === 'KURIKULUM_MERDEKA') {
    if (plan.tpIds && plan.tpIds.length > 0) {
      if (!context.tp || context.tp.workflowStatus !== 'SIAP' || context.tp.needsReview) {
        errors.push('TP acuan belum SIAP atau masih memerlukan peninjauan ulang.');
      }
    }
    if (plan.atpItemIds && plan.atpItemIds.length > 0) {
      if (!context.atp || context.atp.workflowStatus !== 'SIAP' || context.atp.needsReview) {
        errors.push('ATP acuan belum SIAP atau masih memerlukan peninjauan ulang.');
      } else {
        const availableAtpItems: ATPItem[] = context.atp.items || [];
        const tpItems: TPItem[] = context.tp?.items || [];
        for (const atpItemId of plan.atpItemIds) {
          const atpItem = availableAtpItems.find((item) => item.id === atpItemId);
          if (!atpItem) {
            const orphanMsg = `Langkah ATP dengan ID '${atpItemId}' tidak ditemukan dalam alur ATP aktif (Orphan ATP ID).`;
            if (!errors.includes(orphanMsg)) {
              errors.push(orphanMsg);
            }
            continue;
          }
          const refRes = resolveATPItemTPReferences(atpItem, tpItems);
          if (!refRes.isValid) {
            refRes.issues.forEach((issue) => {
              if (!errors.includes(issue)) {
                errors.push(issue);
              }
            });
          }
        }
      }
    }
  }

  // 2. Validate Canonical TP Dependency (Strict ID lookup - NO text matching)
  if (!plan.tpIds || !Array.isArray(plan.tpIds) || plan.tpIds.length === 0) {
    errors.push('Perencanaan Pembelajaran wajib merujuk minimal 1 Tujuan Pembelajaran (tpIds kosong).');
  } else {
    objectiveResolution.objectives.forEach((obj) => {
      resolvedTPs.push({
        id: obj.tpId || obj.id,
        code: obj.code,
        statement: obj.statement,
        materialScope: obj.materialScope,
      });
    });
    objectiveResolution.danglingIds.forEach((tpId) => {
      errors.push(`Tujuan Pembelajaran/KD dengan ID '${tpId}' tidak ditemukan dalam data canonical aktif (Orphan TP ID).`);
    });
  }

  // 3. Validate Canonical ATP Dependency (Strict ID lookup)
  if (plan.atpItemIds && Array.isArray(plan.atpItemIds) && plan.atpItemIds.length > 0) {
    const availableAtpItems: ATPItem[] = context.atp?.items || [];
    for (const atpItemId of plan.atpItemIds) {
      const foundAtp = availableAtpItems.find((item) => item.id === atpItemId);
      if (foundAtp) {
        resolvedATPs.push({
          id: foundAtp.id,
          stepNumber: foundAtp.stepNumber,
          materialScope: foundAtp.materialScope,
          jp: typeof foundAtp.jp === 'number' ? foundAtp.jp : undefined,
        });
      } else {
        const orphanMsg = `Langkah ATP dengan ID '${atpItemId}' tidak ditemukan dalam alur ATP aktif (Orphan ATP ID).`;
        if (!errors.includes(orphanMsg)) {
          errors.push(orphanMsg);
        }
      }
    }
  }

  // 3b. Canonical schedule & lineage validation (unitId & learningMeetingIds)
  const isCanonicalPlan = Boolean(
    plan.unitId || (plan.learningMeetingIds && plan.learningMeetingIds.length > 0)
  );

  let projectionRows: ScheduledLearningMeetingProjection[] = [];
  let projectionAvailable = false;
  let projectionErrors: string[] = [];

  if (context.scheduledMeetings) {
    projectionRows = context.scheduledMeetings;
    projectionAvailable = true;
  } else if (
    context.atpUnitMapping &&
    context.unitExecutionPlan &&
    context.learningMeetingSchedules &&
    context.learningMeetingSchedules.length > 0
  ) {
    const proj = resolveScheduledLearningMeetings({
      mapping: context.atpUnitMapping,
      unitExecutionPlan: context.unitExecutionPlan,
      schedules: context.learningMeetingSchedules,
      tp: context.tp || undefined,
      atp: context.atp || undefined,
    });
    if (proj.isValid) {
      projectionRows = proj.rows;
      projectionAvailable = true;
    } else {
      projectionErrors = proj.errors;
    }
  }

  const activeSettingId = context.academicSetting?.id || plan.academicSettingId;
  const semesterRows = activeSettingId
    ? projectionRows.filter((r) => r.semesterPlanId === activeSettingId)
    : projectionRows;

  const activityMeetingValidation = validateLearningPlanActivityMeetings(
    plan, plan.learningMeetingIds || [], false,
    semesterRows.filter(row => (plan.learningMeetingIds || []).includes(row.meetingId)),
    context.academicSetting,
  );
  if (!activityMeetingValidation.isValid) errors.push(activityMeetingValidation.reason!);
  let actualTimeNeedsReview = false;
  if (isCanonicalPlan && (context.calendar || context.subjectWeeklySchedule || context.calendarDays)) {
    const activeSchedule = context.learningMeetingSchedules?.find(s => s.semesterPlanId === activeSettingId);
    const readiness = isLearningMeetingScheduleReady({ schedule: activeSchedule?.schedule,
      semester: activeSchedule?.semester || 1, mapping: context.atpUnitMapping, unitExecutionPlan: context.unitExecutionPlan,
      subjectWeeklySchedule: context.subjectWeeklySchedule,
      expectedWeeklyJP: resolveSemesterJPFromValues(context.semesterJPSetting, context.annualJPReference).weeklyJP,
      calendar: context.calendar, calendarDays: context.calendarDays });
    actualTimeNeedsReview = !readiness.isReady || context.calendar?.workflowStatus !== 'CONFIRMED';
    if (actualTimeNeedsReview) errors.push('Jadwal aktual perlu ditinjau sebelum memvalidasi durasi: ' + readiness.errors.join('; '));
  }

  const semesterMeetingMap = new Map(semesterRows.map((r) => [r.meetingId, r]));
  let targetUnitId: string | null = plan.unitId || null;

  if (isCanonicalPlan) {
    if (!projectionAvailable) {
      if (projectionErrors.length > 0) {
        errors.push(...projectionErrors);
      } else {
        errors.push('Proyeksi jadwal pertemuan canonical tidak tersedia untuk memvalidasi lineage rencana pembelajaran.');
      }
    }

    if (plan.unitId) {
      if (context.atpUnitMapping) {
        const unitExists = (context.atpUnitMapping.units || []).some((u) => u.id === plan.unitId);
        if (!unitExists) {
          errors.push(`Unit ID '${plan.unitId}' tidak ditemukan pada Pemetaan Unit/Bab.`);
        }
      }
      if (plan.learningMeetingIds && plan.learningMeetingIds.length > 0) {
        for (const mId of plan.learningMeetingIds) {
          const meetingRow = semesterMeetingMap.get(mId);
          if (!meetingRow) {
            errors.push(`Pertemuan dengan ID '${mId}' tidak ditemukan pada jadwal pertemuan semester aktif.`);
          } else if (meetingRow.unitId !== plan.unitId) {
            errors.push(`Pertemuan '${mId}' berasal dari unit '${meetingRow.unitId}', berbeda dengan unitId rancangan '${plan.unitId}'.`);
          }
        }
      }
    } else if (plan.learningMeetingIds && plan.learningMeetingIds.length > 0) {
      let inferredUnitId: string | null = null;
      let hasUnitMismatch = false;
      for (const mId of plan.learningMeetingIds) {
        const meetingRow = semesterMeetingMap.get(mId);
        if (!meetingRow) {
          errors.push(`Pertemuan dengan ID '${mId}' tidak ditemukan pada jadwal pertemuan semester aktif.`);
        } else {
          if (!inferredUnitId) {
            inferredUnitId = meetingRow.unitId;
          } else if (inferredUnitId !== meetingRow.unitId) {
            errors.push(`Pertemuan '${mId}' berasal dari unit berbeda ('${meetingRow.unitId}' vs '${inferredUnitId}'). Seluruh pertemuan harus berasal dari satu Unit.`);
            hasUnitMismatch = true;
          }
        }
      }
      if (!hasUnitMismatch && inferredUnitId) {
        targetUnitId = inferredUnitId;
      }
    }

    if (targetUnitId) {
      const canonicalUnitRows = semesterRows.filter((r) => r.unitId === targetUnitId);
      if (canonicalUnitRows.length === 0 && projectionRows.length > 0) {
        errors.push(`Tidak ditemukan jadwal pertemuan untuk Unit '${targetUnitId}' pada semester aktif.`);
      } else if (canonicalUnitRows.length > 0) {
        // 1. learningMeetingIds = meeting canonical Unit tersebut (Set equality)
        const canonicalMeetingIds = canonicalUnitRows.map((r) => r.meetingId);
        const canonicalMeetingIdSet = new Set(canonicalMeetingIds);
        const planMeetingIdSet = new Set(plan.learningMeetingIds || []);

        for (const mId of canonicalMeetingIds) {
          if (!planMeetingIdSet.has(mId)) {
            errors.push(`Pertemuan canonical '${mId}' untuk Unit '${targetUnitId}' belum dimasukkan ke dalam rencana pembelajaran.`);
          }
        }
        for (const mId of plan.learningMeetingIds || []) {
          if (!canonicalMeetingIdSet.has(mId)) {
            errors.push(`Pertemuan '${mId}' bukan merupakan bagian dari pertemuan canonical Unit '${targetUnitId}' pada semester aktif.`);
          }
        }

        // 2. tpIds = deterministic union linkedTpIds canonical (Set equality)
        const canonicalTpIdSet = new Set<string>();
        for (const r of canonicalUnitRows) {
          for (const tpId of r.linkedTpIds || []) {
            if (tpId) canonicalTpIdSet.add(tpId);
          }
        }

        const planTpIdSet = new Set(plan.tpIds || []);
        for (const tpId of canonicalTpIdSet) {
          if (!planTpIdSet.has(tpId)) {
            errors.push(`Tujuan Pembelajaran (TP) canonical '${tpId}' dari Unit '${targetUnitId}' belum terhubung ke rencana pembelajaran.`);
          }
        }
        for (const tpId of plan.tpIds || []) {
          if (!canonicalTpIdSet.has(tpId)) {
            errors.push(`Tujuan Pembelajaran (TP) '${tpId}' bukan merupakan bagian dari TP canonical Unit '${targetUnitId}'.`);
          }
        }

        // 3. atpItemIds = deterministic union linkedAtpItemIds canonical (Set equality)
        const canonicalAtpIdSet = new Set<string>();
        for (const r of canonicalUnitRows) {
          for (const atpId of r.linkedAtpItemIds || []) {
            if (atpId) canonicalAtpIdSet.add(atpId);
          }
        }

        const planAtpIdSet = new Set(plan.atpItemIds || []);
        for (const atpId of canonicalAtpIdSet) {
          if (!planAtpIdSet.has(atpId)) {
            errors.push(`Langkah ATP canonical '${atpId}' dari Unit '${targetUnitId}' belum terhubung ke rencana pembelajaran.`);
          }
        }
        for (const atpId of plan.atpItemIds || []) {
          if (!canonicalAtpIdSet.has(atpId)) {
            errors.push(`Langkah ATP '${atpId}' bukan merupakan bagian dari ATP canonical Unit '${targetUnitId}'.`);
          }
        }
      }
    }
  }

  // 3c. Validate Active Semester TimeAllocation Scope (ONLY for legacy non-canonical Kurikulum Merdeka plans)
  if (!isCanonicalPlan && context.timeAllocations && context.timeAllocations.length > 0) {
    if (plan.atpItemIds && plan.atpItemIds.length > 0) {
      for (const atpItemId of plan.atpItemIds) {
        const isAtpAllocated = context.timeAllocations.some((ta) => {
          if (ta.sourceType === 'ASSESSMENT' || ta.sourceType === 'RESERVE') return false;
          const isExact = ta.sourceId === atpItemId || ta.atpItemId === atpItemId;
          if (!isExact) return false;
          if (ta.sourceType === 'ATP_ITEM' || !ta.sourceType) {
            const val = typeof ta.allocatedJP === 'number' && ta.allocatedJP > 0
              ? ta.allocatedJP
              : typeof ta.jp === 'number' && ta.jp > 0
              ? ta.jp
              : 0;
            return val > 0;
          }
          return false;
        });
        if (!isAtpAllocated) {
          errors.push(`Langkah ATP dengan ID '${atpItemId}' tidak memiliki alokasi waktu pada semester aktif.`);
        }
      }
    }

    if (plan.tpIds && plan.tpIds.length > 0) {
      for (const tpId of plan.tpIds) {
        const isTpAllocated = context.timeAllocations.some((ta) => {
          if (ta.sourceType === 'ASSESSMENT' || ta.sourceType === 'RESERVE') return false;
          if (ta.sourceType === 'ATP_ITEM' || !ta.sourceType) {
            const matchingAtp = context.atp?.items?.find((a) => a.id === ta.sourceId || a.id === ta.atpItemId);
            if (matchingAtp && matchingAtp.tpId === tpId) {
              const val = typeof ta.allocatedJP === 'number' && ta.allocatedJP > 0
                ? ta.allocatedJP
                : typeof ta.jp === 'number' && ta.jp > 0
                ? ta.jp
                : 0;
              return val > 0;
            }
          }
          if (ta.sourceType === 'TP' || !ta.sourceType) {
            if (ta.sourceId === tpId || ta.tpId === tpId) {
              const val = typeof ta.allocatedJP === 'number' && ta.allocatedJP > 0
                ? ta.allocatedJP
                : typeof ta.jp === 'number' && ta.jp > 0
                ? ta.jp
                : 0;
              return val > 0;
            }
          }
          return false;
        });
        if (!isTpAllocated) {
          errors.push(`Tujuan Pembelajaran dengan ID '${tpId}' tidak memiliki alokasi waktu pada semester aktif.`);
        }
      }
    }
  }

  // 4. Validate Objectives list from canonical TP/KD, not stale stored cache
  if (objectiveResolution.objectives.length === 0) {
    errors.push('Daftar rumusan Tujuan Pembelajaran canonical tidak boleh kosong.');
  } else {
    objectiveResolution.objectives.forEach((obj, i) => {
      if (!obj.statement || obj.statement.trim() === '') {
        errors.push(`Tujuan Pembelajaran canonical butir ke-${i + 1} memiliki rumusan kalimat kosong.`);
      }
    });
  }

  // 5. Validate Learning Activity & Canonical Learning Experiences (2026 Compatible)
  const experiences = Array.isArray(plan.learningExperiences) ? plan.learningExperiences : [];
  const seenExpIds = new Set<string>();
  let validExpCount = 0;

  for (let i = 0; i < experiences.length; i++) {
    const exp = experiences[i];
    if (!exp) continue;

    let isExperienceValid = true;

    // Validate ID
    if (!exp.id || exp.id.trim() === '') {
      errors.push(`Pengalaman Belajar butir ke-${i + 1} memiliki ID kosong.`);
      isExperienceValid = false;
    } else if (seenExpIds.has(exp.id)) {
      errors.push(`Terdapat duplikasi ID '${exp.id}' pada Pengalaman Belajar (learningExperiences).`);
      isExperienceValid = false;
    } else {
      seenExpIds.add(exp.id);
    }

    // Validate phase
    const validPhases: LearningExperiencePhase[] = ['UNDERSTAND', 'APPLY', 'REFLECT'];
    if (!validPhases.includes(exp.phase)) {
      errors.push(
        `Pengalaman Belajar '${exp.id || i + 1}' memiliki fase tidak sah ('${exp.phase}'). Pilihan yang sah: UNDERSTAND (Memahami), APPLY (Mengaplikasi), REFLECT (Merefleksi).`
      );
      isExperienceValid = false;
    }

    // Validate description
    if (!exp.description || exp.description.trim() === '') {
      errors.push(`Pengalaman Belajar '${exp.id || i + 1}' memiliki deskripsi kosong.`);
      isExperienceValid = false;
    }

    // Validate durationMinutes if provided
    if (exp.durationMinutes !== undefined && exp.durationMinutes !== null) {
      if (
        typeof exp.durationMinutes !== 'number' ||
        !Number.isFinite(exp.durationMinutes) ||
        isNaN(exp.durationMinutes) ||
        exp.durationMinutes <= 0
      ) {
        errors.push(
          `Pengalaman Belajar '${exp.id || i + 1}' memiliki alokasi waktu (durationMinutes) tidak valid: ${String(exp.durationMinutes)}. Harus berupa bilangan positif terhingga (> 0).`
        );
        isExperienceValid = false;
      }
    }

    // Validate linked TP IDs (strictly canonical, no dangling references)
    if (exp.linkedTpIds && Array.isArray(exp.linkedTpIds)) {
      for (const linkedId of exp.linkedTpIds) {
        if (!plan.tpIds || !plan.tpIds.includes(linkedId)) {
          errors.push(
            `Pengalaman Belajar '${exp.id || i + 1}' merujuk TP ID '${linkedId}' yang tidak terdaftar dalam perencanaan ini (dangling TP reference).`
          );
          isExperienceValid = false;
        }
      }
    }

    if (isExperienceValid) {
      validExpCount++;
    }
  }

  // Legacy learning steps evaluation
  const openingSteps = plan.learningSteps?.opening || [];
  const coreSteps = plan.learningSteps?.core || [];
  const closingSteps = plan.learningSteps?.closing || [];

  const coreValidCount = coreSteps.filter((s) => s && s.description && s.description.trim().length > 0).length;
  const openingValidCount = openingSteps.filter((s) => s && s.description && s.description.trim().length > 0).length;
  const closingValidCount = closingSteps.filter((s) => s && s.description && s.description.trim().length > 0).length;
  const hasLegacySteps = (openingValidCount + coreValidCount + closingValidCount) > 0;

  // Learning activity check: valid if canonical learning experiences OR valid legacy steps exist
  if (validExpCount > 0) {
    // Canonical 2026 pathway satisfied! Core steps in legacy schema are NOT required.
    if (openingValidCount === 0 && hasLegacySteps) {
      warnings.push('Kegiatan Pendahuluan belum diisi deskripsi aktivitasnya.');
    }
    if (closingValidCount === 0 && hasLegacySteps) {
      warnings.push('Kegiatan Penutup belum diisi deskripsi aktivitasnya.');
    }
  } else if (hasLegacySteps) {
    // Legacy pathway validation
    if (coreValidCount === 0) {
      errors.push('Kegiatan Inti pembelajaran wajib memiliki minimal 1 langkah aktivitas yang terisi deskripsinya (atau sediakan Pengalaman Belajar canonical).');
    }
    if (openingValidCount === 0) {
      warnings.push('Kegiatan Pendahuluan belum diisi deskripsi aktivitasnya.');
    }
    if (closingValidCount === 0) {
      warnings.push('Kegiatan Penutup belum diisi deskripsi aktivitasnya.');
    }
  } else {
    // Neither canonical experiences nor legacy steps exist
    errors.push('Perencanaan Pembelajaran wajib memiliki aktivitas pembelajaran (Pengalaman Belajar canonical 2026 atau Langkah Pembelajaran legacy).');
  }

  // 6. Validate Deep Learning Context (Optional contextual model - NOT mandatory checklist)
  if (plan.deepLearningContext) {
    if (Array.isArray(plan.deepLearningContext.principles)) {
      const validPrinciples: DeepLearningPrinciple[] = ['MINDFUL', 'MEANINGFUL', 'JOYFUL'];
      for (const p of plan.deepLearningContext.principles) {
        if (!validPrinciples.includes(p)) {
          errors.push(`Prinsip Pembelajaran Mendalam '${p}' tidak valid. Pilihan yang sah: MINDFUL (Berkesadaran), MEANINGFUL (Bermakna), JOYFUL (Menggembirakan).`);
        }
      }
      const uniquePrinciples = new Set(plan.deepLearningContext.principles);
      if (uniquePrinciples.size !== plan.deepLearningContext.principles.length) {
        errors.push('Terdapat duplikasi nilai pada prinsip Pembelajaran Mendalam (principles).');
      }
    }
    if (Array.isArray(plan.deepLearningContext.graduateProfileDimensions)) {
      const uniqueDims = new Set(plan.deepLearningContext.graduateProfileDimensions);
      if (uniqueDims.size !== plan.deepLearningContext.graduateProfileDimensions.length) {
        warnings.push('Terdapat duplikasi nilai pada Dimensi Profil Lulusan pada deepLearningContext.');
      }
    }
  }

  // 7. Validate Graduate Profile Dimensions against the shared canonical validator.
  // Fail-closed: blank, non-string, and unknown values are validation errors.
  if (plan.graduateProfileDimensions !== undefined) {
    const dimValidation = validateGraduateProfileDimensions(
      plan.graduateProfileDimensions
    );

    if (!dimValidation.isValid) {
      errors.push(
        dimValidation.error || 'Dimensi Profil Lulusan tidak valid.'
      );
    } else {
      const uniqueDims = new Set(dimValidation.dimensions);
      if (uniqueDims.size !== dimValidation.dimensions.length) {
        warnings.push(
          'Terdapat duplikasi nilai pada Dimensi Profil Lulusan (graduateProfileDimensions).'
        );
      }
    }
  }

  // 8. Validate Assessment Plan (Rencana Asesmen)
  const initialAssessments = plan.assessmentPlan?.initial || [];
  const formativeAssessments = plan.assessmentPlan?.formative || [];
  const summativeAssessments = plan.assessmentPlan?.summative || [];

  const totalAssessmentItems = initialAssessments.length + formativeAssessments.length + summativeAssessments.length;
  if (totalAssessmentItems === 0) {
    errors.push('Rencana Asesmen minimal harus memuat salah satu bentuk penilaian (Awal, Formatif, atau Sumatif).');
  } else {
    const allAssessments = [...initialAssessments, ...formativeAssessments, ...summativeAssessments];
    for (const item of allAssessments) {
      if (item.linkedTpIds && Array.isArray(item.linkedTpIds)) {
        for (const linkedId of item.linkedTpIds) {
          if (!plan.tpIds.includes(linkedId)) {
            errors.push(`Rencana asesmen '${item.type}' merujuk TP ID '${linkedId}' yang tidak terdaftar dalam perencanaan ini.`);
          }
        }
      }

      // Validasi asesmen per pertemuan jika learningMeetingId ditentukan
      if (item.learningMeetingId !== undefined && item.learningMeetingId !== null) {
        const mId = typeof item.learningMeetingId === 'string' ? item.learningMeetingId.trim() : '';
        if (!mId) {
          errors.push(`Rencana asesmen '${item.type}' (ID: '${item.id}') memiliki learningMeetingId tidak valid (string kosong).`);
        } else if (!projectionAvailable) {
          // 6. Jika sumber canonical tidak tersedia, jangan menganggap referensi pertemuan valid
          errors.push(
            `Jadwal pertemuan canonical tidak tersedia untuk memvalidasi asesmen '${item.type}' (ID: '${item.id}') yang merujuk pertemuan '${mId}'.`
          );
        } else {
          // 3a. Tolak ID pertemuan yang tidak ditemukan pada jadwal pertemuan canonical semester aktif
          const meetingRow = semesterMeetingMap.get(mId);
          if (!meetingRow) {
            errors.push(
              `Pertemuan dengan ID '${mId}' pada rencana asesmen '${item.type}' (ID: '${item.id}') tidak ditemukan pada jadwal pertemuan canonical semester aktif.`
            );
          } else {
            // 3b. Tolak ID pertemuan yang tidak tercantum dalam plan.learningMeetingIds
            const planMeetingIdSet = new Set(plan.learningMeetingIds || []);
            if (!planMeetingIdSet.has(mId)) {
              errors.push(
                `Pertemuan '${mId}' pada rencana asesmen '${item.type}' (ID: '${item.id}') tidak tercantum dalam daftar pertemuan rencana pembelajaran (plan.learningMeetingIds).`
              );
            }

            // 3c. Tolak ID pertemuan lintas Bab/Unit
            const effectiveUnitId =
              targetUnitId ||
              plan.unitId ||
              (plan.learningMeetingIds && plan.learningMeetingIds.length > 0
                ? semesterMeetingMap.get(plan.learningMeetingIds[0])?.unitId
                : null);
            if (effectiveUnitId && meetingRow.unitId !== effectiveUnitId) {
              errors.push(
                `Pertemuan '${mId}' pada rencana asesmen '${item.type}' (ID: '${item.id}') berasal dari Bab/Unit '${meetingRow.unitId}', berbeda dengan Bab/Unit rencana pembelajaran ('${effectiveUnitId}'). Asesmen pertemuan tidak boleh lintas Bab.`
              );
            }

            // 4. Periksa kesesuaian linkedTpIds asesmen dengan TP canonical yang terhubung pada pertemuan tersebut
            const canonicalMeetingTpIds = meetingRow.linkedTpIds || [];
            if (!item.linkedTpIds || !Array.isArray(item.linkedTpIds) || item.linkedTpIds.length === 0) {
              errors.push(
                `Rencana asesmen '${item.type}' (ID: '${item.id}') pada pertemuan '${mId}' wajib menghubungkan minimal satu Tujuan Pembelajaran (linkedTpIds).`
              );
            } else {
              for (const tpId of item.linkedTpIds) {
                if (!canonicalMeetingTpIds.includes(tpId)) {
                  errors.push(
                    `Tujuan Pembelajaran '${tpId}' pada rencana asesmen '${item.type}' (ID: '${item.id}') tidak sesuai dengan TP canonical yang terhubung pada pertemuan '${mId}' (TP canonical pertemuan: ${canonicalMeetingTpIds.length > 0 ? canonicalMeetingTpIds.join(', ') : 'tidak ada'}).`
                  );
                }
              }
            }
          }
        }
      }
    }
  }

  // 9. Time / JP Allocation Resolution (Strictly from real data)
  const jpResolution = resolveLearningPlanAllocatedJP(plan, {
    atp: context.atp,
    timeAllocations: context.timeAllocations,
    academicSetting: context.academicSetting,
    atpUnitMapping: context.atpUnitMapping,
    unitExecutionPlan: context.unitExecutionPlan,
    learningMeetingSchedules: context.learningMeetingSchedules,
    scheduledMeetings: context.scheduledMeetings,
  });
  const resolvedAllocatedJP = jpResolution.allocatedJP;

  if (resolvedAllocatedJP === undefined) {
    warnings.push('Alokasi JP belum ditentukan.');
  }

  if (experiences.length > 0) {
    const validPhaseSet = new Set(
      experiences
        .filter((exp) => exp && exp.description && exp.description.trim())
        .map((exp) => exp.phase)
        .filter((phase) => phase === 'UNDERSTAND' || phase === 'APPLY' || phase === 'REFLECT')
    );
    (['UNDERSTAND', 'APPLY', 'REFLECT'] as LearningExperiencePhase[]).forEach((phase) => {
      if (!validPhaseSet.has(phase)) {
        errors.push(`Pengalaman Belajar canonical wajib memuat fase ${phase} (${LEARNING_EXPERIENCE_PHASE_LABELS[phase]}).`);
      }
    });
  }
  (jpResolution.issues || []).forEach((issue) => warnings.push(issue));

  // 10. Lifecycle & Status Validation
  if (plan.status === 'SIAP') {
    if (draftErrors.length > 0) {
      finalizationErrors.push('Status SIAP tidak valid karena masih terdapat kesalahan integritas data draf.');
    }
    if (!plan.confirmedAt) {
      finalizationErrors.push('Status SIAP memerlukan konfirmasi dan penetapan eksplisit dari guru (confirmedAt belum tercatat).');
    }
    if (plan.sourceType === 'AI_DRAFT' && !plan.confirmedAt) {
      finalizationErrors.push('Keluaran draf AI tidak boleh langsung berstatus SIAP tanpa peninjauan guru.');
    }
  }

  const allErrors = [...draftErrors, ...finalizationErrors];

  return {
    valid: allErrors.length === 0,
    needsReview: !activityMeetingValidation.isValid || actualTimeNeedsReview,
    isValid: allErrors.length === 0,
    errors: allErrors,
    warnings,
    draftErrors,
    finalizationErrors,
    resolvedTPs,
    resolvedATPs,
    resolvedAllocatedJP,
    jpResolutionSource: jpResolution.source,
  };
}

/**
 * Validates output readiness for RPP.
 * RPP requires canonical plan validity (validateLearningPlan),
 * and does NOT require Modul Ajar-specific fields (initialCompetency, DPL, resources, learningModel).
 */
export function validateLearningPlanForRPP(
  plan: LearningPlan,
  context: {
    academicSetting?: AcademicSetting | null;
    tp?: TPData | null;
    atp?: ATPData | null;
    atpUnitMapping?: ATPUnitMappingData | null;
    unitExecutionPlan?: UnitExecutionPlanData | null;
    learningMeetingSchedules?: Array<{
      semesterPlanId: string;
      semester: 1 | 2;
      schedule: LearningMeetingScheduleData;
    }> | null;
    scheduledMeetings?: ScheduledLearningMeetingProjection[] | null;
    k13Analysis?: K13Analysis | null;
    timeAllocations?: TimeAllocation[] | null;
    assessmentCriteria?: AssessmentCriterion[] | null;
  }
): LearningPlanValidationResult {
  return validateLearningPlan(plan, context);
}

/**
 * Validates output readiness for Modul Ajar.
 * Modul Ajar requires canonical plan validity (validateLearningPlan),
 * plus specific components for Kurikulum Merdeka print-readiness:
 * - initialCompetency non-empty
 * - graduateProfileDimensions valid
 * - at least one valid resource (title or source non-empty)
 * - learningModel non-empty
 */
export function validateLearningPlanForModulAjar(
  plan: LearningPlan,
  context: {
    academicSetting?: AcademicSetting | null;
    tp?: TPData | null;
    atp?: ATPData | null;
    atpUnitMapping?: ATPUnitMappingData | null;
    unitExecutionPlan?: UnitExecutionPlanData | null;
    learningMeetingSchedules?: Array<{
      semesterPlanId: string;
      semester: 1 | 2;
      schedule: LearningMeetingScheduleData;
    }> | null;
    scheduledMeetings?: ScheduledLearningMeetingProjection[] | null;
    k13Analysis?: K13Analysis | null;
    timeAllocations?: TimeAllocation[] | null;
    assessmentCriteria?: AssessmentCriterion[] | null;
  } & LearningPlanActualTimeContext
): LearningPlanValidationResult {
  const canonicalResult = validateLearningPlan(plan, context);

  if (!plan) {
    return canonicalResult;
  }

  const modulAjarErrors: string[] = [];

  // Requirements for Modul Ajar output readiness (Kurikulum Merdeka)
  if (plan.curriculumType === 'KURIKULUM_MERDEKA' || !plan.curriculumType) {
    if (!plan.initialCompetency || typeof plan.initialCompetency !== 'string' || plan.initialCompetency.trim() === '') {
      modulAjarErrors.push('Kompetensi Awal belum diisi.');
    }
    const dimValidation = validateGraduateProfileDimensions(
      plan.graduateProfileDimensions
    );
    if (!dimValidation.isValid) {
      modulAjarErrors.push(
        dimValidation.error || 'Dimensi Profil Lulusan belum dipilih.'
      );
    }
    const validResources = (plan.resources || []).filter(
      (r) =>
        r &&
        typeof r === 'object' &&
        ((typeof r.title === 'string' && r.title.trim().length > 0) ||
          (typeof r.source === 'string' && r.source.trim().length > 0))
    );
    if (validResources.length === 0) {
      modulAjarErrors.push('Sarana dan prasarana / sumber belajar belum diisi.');
    }
    if (!plan.learningModel || typeof plan.learningModel !== 'string' || plan.learningModel.trim() === '') {
      modulAjarErrors.push('Model/praktik pembelajaran belum diisi.');
    }
  }

  const allErrors = [...canonicalResult.errors, ...modulAjarErrors];
  const finalizationErrors = [...canonicalResult.finalizationErrors, ...modulAjarErrors];

  return {
    ...canonicalResult,
    valid: allErrors.length === 0,
    isValid: allErrors.length === 0,
    errors: allErrors,
    finalizationErrors,
  };
}

/**
 * Creates an initial empty canonical LearningPlan in DRAFT status.
 * Never fabricates experiences, deep learning principles, or graduate profile dimensions.
 */
export function createEmptyLearningPlan(params: {
  academicSetting: AcademicSetting;
  curriculumType?: CurriculumType;
  unitId?: string;
  learningMeetingIds?: string[];
  tpIds?: string[];
  atpItemIds?: string[];
  allocatedJP?: number;
  title?: string;
  topic?: string;
  context?: { tp?: TPData | null; atp?: ATPData | null };
}): LearningPlan {
  const {
    academicSetting,
    curriculumType,
    unitId,
    learningMeetingIds,
    tpIds = [],
    atpItemIds = [],
    allocatedJP,
    title,
    topic,
    context,
  } = params;
  const now = new Date().toISOString();

  const objectives = resolveLearningPlanObjectives({ tpIds, tp: context?.tp, curriculumType }).objectives;

  return {
    id: `lp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    academicSettingId: academicSetting.id,
    curriculumType,
    sourceType: 'MANUAL',
    status: 'DRAFT',
    unitId,
    learningMeetingIds,
    tpIds,
    atpItemIds,
    allocatedJP: typeof allocatedJP === 'number' && allocatedJP > 0 ? allocatedJP : undefined,
    title: title || (objectives.length > 0 ? `Modul Ajar: ${objectives[0].materialScope || objectives[0].code || 'Topik Pembelajaran'}` : ''),
    topic: topic || (objectives.length > 0 ? (objectives[0].materialScope || '') : ''),
    objectives,
    learningExperiences: [],
    learningSteps: {
      opening: [],
      core: [],
      closing: [],
    },
    assessmentPlan: {
      initial: [],
      formative: [],
      summative: [],
    },
    resources: [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Creates an AI Draft LearningPlan. Always sets sourceType: 'AI_DRAFT' and status: 'DRAFT'.
 * Preserves teacher/draft data without fabricating missing experiences/principles/dimensions.
 */
export function createAIDraftLearningPlan(params: {
  academicSetting: AcademicSetting;
  curriculumType?: CurriculumType;
  unitId?: string;
  learningMeetingIds?: string[];
  meetings?: ActivityMeetingScope[];
  tpIds: string[];
  atpItemIds?: string[];
  allocatedJP?: number;
  aiDraft: Partial<LearningPlan>;
  context?: { tp?: TPData | null; atp?: ATPData | null };
}): LearningPlan {
  const {
    academicSetting,
    curriculumType,
    unitId,
    learningMeetingIds,
    meetings,
    tpIds,
    atpItemIds = [],
    allocatedJP,
    aiDraft,
    context,
  } = params;
  const activityValidation = validateLearningPlanActivityMeetings(aiDraft, learningMeetingIds || [], Boolean(learningMeetingIds?.length), meetings || [], academicSetting);
  if (!activityValidation.isValid) throw new Error(activityValidation.reason);
  const now = new Date().toISOString();

  const canonicalAllocatedJP =
    typeof allocatedJP === 'number' && allocatedJP > 0
      ? allocatedJP
      : typeof aiDraft.allocatedJP === 'number' && aiDraft.allocatedJP > 0
      ? aiDraft.allocatedJP
      : undefined;

  const objectives = resolveLearningPlanObjectives({ tpIds, tp: context?.tp, curriculumType }).objectives;
  const normalizedAssessmentPlan = normalizeAIAssessmentPlan(aiDraft.assessmentPlan, tpIds);
  const normalizedDeepLearningContext = normalizeDeepLearningContext(aiDraft.deepLearningContext);
  const normalizedResources = normalizeAIResources(aiDraft.resources);

  return {
    id: `lp-ai-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    academicSettingId: academicSetting.id,
    curriculumType,
    sourceType: 'AI_DRAFT',
    status: 'DRAFT',
    unitId,
    learningMeetingIds,
    tpIds,
    atpItemIds,
    title: aiDraft.title || (objectives.length > 0 ? `Draf Modul Ajar: ${objectives[0].materialScope || objectives[0].code || 'Topik'}` : 'Draf Modul Ajar'),
    topic: aiDraft.topic || (objectives.length > 0 ? objectives[0].materialScope : ''),
    objectives,
    learningExperiences: Array.isArray(aiDraft.learningExperiences)
      ? aiDraft.learningExperiences.map((exp, idx) => {
          const normPhase = normalizeLearningExperiencePhase(exp.phase) || exp.phase;
          return {
            id: `exp-ai-${idx + 1}-${Date.now().toString(36)}`,
            phase: normPhase as LearningExperiencePhase,
            description: exp.description || '',
            ...(exp.learningMeetingId !== undefined ? { learningMeetingId: exp.learningMeetingId } : {}),
            durationMinutes:
              typeof exp.durationMinutes === 'number' &&
              Number.isFinite(exp.durationMinutes) &&
              !isNaN(exp.durationMinutes) &&
              exp.durationMinutes > 0
                ? exp.durationMinutes
                : undefined,
            linkedTpIds: Array.isArray(exp.linkedTpIds) ? exp.linkedTpIds : undefined,
          };
        })
      : [],
    deepLearningContext: normalizedDeepLearningContext,
    graduateProfileDimensions: Array.isArray(aiDraft.graduateProfileDimensions) ? aiDraft.graduateProfileDimensions : undefined,
    learningSteps: {
      opening: (aiDraft.learningSteps?.opening || []).map((step, index) => ({ ...step, id: step.id || `step-ai-opening-${index + 1}-${now}` })),
      core: (aiDraft.learningSteps?.core || []).map((step, index) => ({ ...step, id: step.id || `step-ai-core-${index + 1}-${now}` })),
      closing: (aiDraft.learningSteps?.closing || []).map((step, index) => ({ ...step, id: step.id || `step-ai-closing-${index + 1}-${now}` })),
    },
    assessmentPlan: {
      initial: normalizedAssessmentPlan.initial,
      formative: normalizedAssessmentPlan.formative,
      summative: normalizedAssessmentPlan.summative,
    },
    resources: normalizedResources,
    differentiation: aiDraft.differentiation,
    meaningfulUnderstanding: aiDraft.meaningfulUnderstanding,
    triggerQuestions: aiDraft.triggerQuestions,
    reflection: normalizeAIReflection(aiDraft.reflection),
    enrichmentPlan: aiDraft.enrichmentPlan,
    remedialPlan: aiDraft.remedialPlan,
    initialCompetency: aiDraft.initialCompetency,
    targetStudents: aiDraft.targetStudents,
    learningModel: aiDraft.learningModel,
    p3Dimensions: aiDraft.p3Dimensions,
    allocatedJP: canonicalAllocatedJP,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Confirms a LearningPlan as SIAP after rigorous validation.
 */
export function confirmLearningPlan(
  plan: LearningPlan,
  context: {
    academicSetting?: AcademicSetting | null;
    tp?: TPData | null;
    atp?: ATPData | null;
    atpUnitMapping?: ATPUnitMappingData | null;
    unitExecutionPlan?: UnitExecutionPlanData | null;
    learningMeetingSchedules?: Array<{
      semesterPlanId: string;
      semester: 1 | 2;
      schedule: LearningMeetingScheduleData;
    }> | null;
    scheduledMeetings?: ScheduledLearningMeetingProjection[] | null;
    k13Analysis?: K13Analysis | null;
    timeAllocations?: TimeAllocation[] | null;
    assessmentCriteria?: AssessmentCriterion[] | null;
  } & LearningPlanActualTimeContext
): { success: boolean; plan: LearningPlan; validation: LearningPlanValidationResult } {
  // First evaluate validation without the status check
  const candidatePlan: LearningPlan = {
    ...plan,
    status: 'SIAP',
    confirmedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const validation = validateLearningPlan(candidatePlan, context);

  if (!validation.valid) {
    return {
      success: false,
      plan: {
        ...plan,
        status: 'PERLU_DILENGKAPI',
        confirmedAt: undefined,
        updatedAt: new Date().toISOString(),
      },
      validation,
    };
  }

  return {
    success: true,
    plan: candidatePlan,
    validation,
  };
}

/**
 * Determines whether a change to a LearningPlan is pedagogically substantive.
 * Substantive edits invalidate SIAP status and revert the plan to DRAFT.
 */
export function isSubstantiveLearningPlanChange(oldPlan: LearningPlan, newPlan: LearningPlan): boolean {
  if (JSON.stringify(oldPlan.tpIds || []) !== JSON.stringify(newPlan.tpIds || [])) return true;
  if (JSON.stringify(oldPlan.atpItemIds || []) !== JSON.stringify(newPlan.atpItemIds || [])) return true;
  if (JSON.stringify(oldPlan.kktpCriterionIds || []) !== JSON.stringify(newPlan.kktpCriterionIds || [])) return true;
  if ((oldPlan.title || '') !== (newPlan.title || '')) return true;
  if ((oldPlan.topic || '') !== (newPlan.topic || '')) return true;
  if (JSON.stringify(oldPlan.objectives || []) !== JSON.stringify(newPlan.objectives || [])) return true;
  if (JSON.stringify(oldPlan.learningExperiences || []) !== JSON.stringify(newPlan.learningExperiences || [])) return true;
  if (JSON.stringify(oldPlan.learningSteps || {}) !== JSON.stringify(newPlan.learningSteps || {})) return true;
  if (JSON.stringify(oldPlan.deepLearningContext || {}) !== JSON.stringify(newPlan.deepLearningContext || {})) return true;
  if (JSON.stringify(oldPlan.graduateProfileDimensions || []) !== JSON.stringify(newPlan.graduateProfileDimensions || [])) return true;
  if (JSON.stringify(oldPlan.assessmentPlan || {}) !== JSON.stringify(newPlan.assessmentPlan || {})) return true;
  if (JSON.stringify(oldPlan.resources || []) !== JSON.stringify(newPlan.resources || [])) return true;
  if (JSON.stringify(oldPlan.differentiation || {}) !== JSON.stringify(newPlan.differentiation || {})) return true;
  if ((oldPlan.meaningfulUnderstanding || '') !== (newPlan.meaningfulUnderstanding || '')) return true;
  if (JSON.stringify(oldPlan.triggerQuestions || []) !== JSON.stringify(newPlan.triggerQuestions || [])) return true;
  if (JSON.stringify(oldPlan.reflection || {}) !== JSON.stringify(newPlan.reflection || {})) return true;
  if ((oldPlan.enrichmentPlan || '') !== (newPlan.enrichmentPlan || '')) return true;
  if ((oldPlan.remedialPlan || '') !== (newPlan.remedialPlan || '')) return true;
  if (oldPlan.allocatedJP !== newPlan.allocatedJP) return true;
  return false;
}

/**
 * Automatically invalidates SIAP status if underlying dependencies (TP/ATP) were deleted or changed.
 */
export function invalidatePlanIfDependenciesChanged(
  plan: LearningPlan,
  context: {
    academicSetting?: AcademicSetting | null;
    tp?: TPData | null;
    atp?: ATPData | null;
    k13Analysis?: K13Analysis | null;
  }
): { plan: LearningPlan; isInvalidated: boolean; reason?: string } {
  if (plan.status !== 'SIAP') {
    return { plan, isInvalidated: false };
  }

  const validation = validateLearningPlan(plan, context);
  if (!validation.valid) {
    return {
      plan: {
        ...plan,
        status: 'PERLU_DILENGKAPI',
        confirmedAt: undefined,
        updatedAt: new Date().toISOString(),
      },
      isInvalidated: true,
      reason: `Status diturunkan ke PERLU_DILENGKAPI karena dependency berubah:\n${validation.errors.join('\n')}`,
    };
  }

  return { plan, isInvalidated: false };
}

/**
 * Migrates legacy learning plans without fabricating non-existent pedagogical facts.
 */
export function migrateLegacyLearningPlan(
  legacy: any,
  academicSettingId: string,
  curriculumType?: CurriculumType
): LearningPlan {
  const now = new Date().toISOString();
  const rawId = legacy?.id || `lp-migrated-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

  // Parse objectives safely
  const objectives: LearningPlan['objectives'] = [];
  if (Array.isArray(legacy?.objectives)) {
    for (let i = 0; i < legacy.objectives.length; i++) {
      const obj = legacy.objectives[i];
      if (typeof obj === 'string') {
        objectives.push({
          id: `obj-${i + 1}`,
          statement: obj,
        });
      } else if (obj && typeof obj === 'object') {
        objectives.push({
          id: obj.id || `obj-${i + 1}`,
          tpId: obj.tpId,
          code: obj.code,
          statement: obj.statement || obj.description || '',
          materialScope: obj.materialScope || obj.contentScope,
        });
      }
    }
  }

  // Parse steps safely
  const opening: LearningPlan['learningSteps']['opening'] = [];
  const core: LearningPlan['learningSteps']['core'] = [];
  const closing: LearningPlan['learningSteps']['closing'] = [];

  if (Array.isArray(legacy?.learningSteps)) {
    for (let i = 0; i < legacy.learningSteps.length; i++) {
      const s = legacy.learningSteps[i];
      const stepItem = {
        id: s.id || `step-${i + 1}`,
        stepName: s.stepName || 'Kegiatan Inti',
        description: s.description || '',
        durationMinutes: typeof s.durationMinutes === 'number' ? s.durationMinutes : undefined,
      };
      const nameLower = (s.stepName || '').toLowerCase();
      if (nameLower.includes('awal') || nameLower.includes('pendahuluan')) {
        opening.push(stepItem);
      } else if (nameLower.includes('tutup') || nameLower.includes('penutup') || nameLower.includes('akhir')) {
        closing.push(stepItem);
      } else {
        core.push(stepItem);
      }
    }
  } else if (legacy?.learningSteps && typeof legacy.learningSteps === 'object') {
    if (Array.isArray(legacy.learningSteps.opening)) opening.push(...legacy.learningSteps.opening);
    if (Array.isArray(legacy.learningSteps.core)) core.push(...legacy.learningSteps.core);
    if (Array.isArray(legacy.learningSteps.closing)) closing.push(...legacy.learningSteps.closing);
  }

  // Parse assessments safely
  const initialAssessments: LearningPlan['assessmentPlan']['initial'] = [];
  const formativeAssessments: LearningPlan['assessmentPlan']['formative'] = [];
  const summativeAssessments: LearningPlan['assessmentPlan']['summative'] = [];

  if (Array.isArray(legacy?.assessmentPlan)) {
    for (let i = 0; i < legacy.assessmentPlan.length; i++) {
      const a = legacy.assessmentPlan[i];
      const item = {
        id: a.id || `asm-${i + 1}`,
        type: ((a.type || 'FORMATIVE').toUpperCase() as 'INITIAL' | 'FORMATIVE' | 'SUMMATIVE'),
        technique: a.technique,
        instrument: a.instrument,
        linkedTpIds: Array.isArray(a.linkedTpIds) ? a.linkedTpIds : [],
        learningMeetingId: typeof a.learningMeetingId === 'string' && a.learningMeetingId.trim() ? a.learningMeetingId.trim() : undefined,
        description: a.description || a.instrument || a.technique,
      };
      if (item.type === 'INITIAL') initialAssessments.push(item);
      else if (item.type === 'SUMMATIVE') summativeAssessments.push(item);
      else formativeAssessments.push(item);
    }
  } else if (legacy?.assessmentPlan && typeof legacy.assessmentPlan === 'object') {
    if (Array.isArray(legacy.assessmentPlan.initial)) initialAssessments.push(...legacy.assessmentPlan.initial);
    if (Array.isArray(legacy.assessmentPlan.formative)) formativeAssessments.push(...legacy.assessmentPlan.formative);
    if (Array.isArray(legacy.assessmentPlan.summative)) summativeAssessments.push(...legacy.assessmentPlan.summative);
  }

  return {
    id: rawId,
    academicSettingId: legacy?.academicSettingId || academicSettingId,
    curriculumType: legacy?.curriculumType || curriculumType,
    sourceType: 'MIGRATED',
    status: 'DRAFT', // Migrated plans always require teacher review
    tpIds: Array.isArray(legacy?.tpIds) ? legacy.tpIds : [],
    atpItemIds: Array.isArray(legacy?.atpItemIds) ? legacy.atpItemIds : [],
    kktpCriterionIds: Array.isArray(legacy?.kktpCriterionIds) ? legacy.kktpCriterionIds : [],
    timeAllocationIds: Array.isArray(legacy?.timeAllocationIds) ? legacy.timeAllocationIds : [],
    title: legacy?.title || '',
    topic: legacy?.topic || '',
    objectives,
    learningSteps: {
      opening,
      core,
      closing,
    },
    learningExperiences: Array.isArray(legacy?.learningExperiences)
      ? legacy.learningExperiences.map((exp: any, idx: number) => ({
          id: exp.id || `exp-${idx + 1}`,
          phase: exp.phase,
          description: exp.description || '',
          linkedTpIds: Array.isArray(exp.linkedTpIds) ? exp.linkedTpIds : undefined,
          durationMinutes:
            typeof exp.durationMinutes === 'number' &&
            Number.isFinite(exp.durationMinutes) &&
            !isNaN(exp.durationMinutes) &&
            exp.durationMinutes > 0
              ? exp.durationMinutes
              : undefined,
        }))
      : undefined,
    deepLearningContext: legacy?.deepLearningContext,
    graduateProfileDimensions: Array.isArray(legacy?.graduateProfileDimensions) ? legacy.graduateProfileDimensions : undefined,
    assessmentPlan: {
      initial: initialAssessments,
      formative: formativeAssessments,
      summative: summativeAssessments,
    },
    resources: Array.isArray(legacy?.resources) ? legacy.resources.map((r: any, idx: number) => (typeof r === 'string' ? { id: `res-${idx + 1}`, title: r } : r)) : [],
    differentiation: legacy?.differentiation,
    meaningfulUnderstanding: legacy?.meaningfulUnderstanding,
    triggerQuestions: Array.isArray(legacy?.triggerQuestions) ? legacy.triggerQuestions : [],
    reflection: legacy?.reflection,
    enrichmentPlan: legacy?.enrichmentPlan,
    remedialPlan: legacy?.remedialPlan,
    initialCompetency: legacy?.initialCompetency,
    targetStudents: legacy?.targetStudents,
    learningModel: legacy?.learningModel,
    p3Dimensions: Array.isArray(legacy?.p3Dimensions) ? legacy.p3Dimensions : [],
    allocatedJP: typeof legacy?.allocatedJP === 'number' ? legacy.allocatedJP : undefined,
    createdAt: legacy?.createdAt || now,
    updatedAt: now,
  };
}
