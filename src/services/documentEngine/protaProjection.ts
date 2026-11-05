import { DocumentGenerationContext } from './types';
import { TimeAllocation } from '../../types';
import { resolveMerdekaCanonicalTimeProjection } from './meetingTimeProjection';
import { getSubjectJP } from '../jpEngine';

export interface ProtaProjectionRow {
  id: string;
  sourceType: 'ATP_ITEM' | 'ASSESSMENT' | 'RESERVE' | 'UNIT';
  atpItemId?: string;
  unitId?: string;
  unitTitle?: string;
  unitOrder?: number;
  tpCode: string;
  tpStatement: string;
  materialScope: string;
  semester: 1 | 2;
  allocatedJP: number;
}

export interface ProtaProjection {
  storedReferenceJP?: number | null;
  availableAnnualJP?: number | null;
  unallocatedAnnualJP?: number | null;
  referenceDifferenceJP?: number | null;
  isReady: boolean;
  unreadyReason?: string;
  academicYear: string;
  rows: ProtaProjectionRow[];
  assessmentRows: ProtaProjectionRow[];
  reserveRows: ProtaProjectionRow[];
  semester1AllocatedJP: number;
  semester2AllocatedJP: number;
  totalAllocatedJP: number;
  officialAnnualJP: number | null;
  referenceWeeklyEquivalentJP: number | null;
  regulationReference?: string;
  remainingAnnualJP: number | null;
  validationStatus:
    | 'BALANCED'
    | 'UNDER_ALLOCATED'
    | 'OVER_ALLOCATED'
    | 'UNVERIFIED_CAPACITY'
    | 'INCOMPLETE'
    | 'CONFLICT';
}

export interface K13ProtaProjectionRow {
  id: string;
  kd: string;
  materi: string;
  kegiatan: string;
  allocatedJP: number;
  semester: 1 | 2 | null;
}

export interface K13ProtaProjection {
  isReady: boolean;
  unreadyReason?: string;
  academicYear: string;
  rows: K13ProtaProjectionRow[];
  totalAllocatedJP: number;
}

export function buildProtaProjection(context: DocumentGenerationContext): ProtaProjection {
  const academicYear = context.academicSetting?.academicYear || '-';
  const isBlankMode = context.documentMode === 'blank';

  const storedReferenceJP = context.annualJPReference?.officialAnnualJP ?? null;
  const reference = getSubjectJP({ ...context.academicSetting, allocationType: 'INTRAKURIKULER' });
  const officialAnnualJP = reference.isOfficial ? reference.referenceAnnualJP ?? null : null;
  const referenceWeeklyEquivalentJP = context.annualJPReference?.referenceWeeklyEquivalentJP ?? null;
  const regulationReference = context.annualJPReference?.regulationReference;

  if (isBlankMode) {
    return {
      isReady: true,
      academicYear,
      rows: [],
      assessmentRows: [],
      reserveRows: [],
      semester1AllocatedJP: 0,
      semester2AllocatedJP: 0,
      totalAllocatedJP: 0,
      officialAnnualJP,
      referenceWeeklyEquivalentJP,
      regulationReference,
      remainingAnnualJP: null,
      validationStatus: 'BALANCED',
    };
  }

  // Pure Canonical Projection for Kurikulum Merdeka
  const canonical = resolveMerdekaCanonicalTimeProjection(context);

  if (!canonical.isReady) {
    return {
      isReady: false,
      unreadyReason:
        canonical.errors.length > 0
          ? `Program Tahunan belum dapat dibuat karena: ${canonical.errors.join(' ')}`
          : 'Program Tahunan belum dapat dibuat karena Jadwal Aktual Semester 1 dan Semester 2 belum lengkap.',
      academicYear,
      rows: [],
      assessmentRows: [],
      reserveRows: [],
      semester1AllocatedJP: 0,
      semester2AllocatedJP: 0,
      totalAllocatedJP: 0,
      officialAnnualJP,
      referenceWeeklyEquivalentJP,
      regulationReference,
      remainingAnnualJP: null,
      validationStatus: 'INCOMPLETE',
    };
  }

  // Check that canonical schedule rows exist for BOTH Semester 1 and Semester 2
  const hasS1 = canonical.rows.some((r) => r.semester === 1);
  const hasS2 = canonical.rows.some((r) => r.semester === 2);

  if (!hasS1 || !hasS2) {
    return {
      isReady: false,
      unreadyReason:
        'Program Tahunan belum dapat dibuat karena Jadwal Aktual Semester 1 dan Semester 2 belum lengkap.',
      academicYear,
      rows: [],
      assessmentRows: [],
      reserveRows: [],
      semester1AllocatedJP: 0,
      semester2AllocatedJP: 0,
      totalAllocatedJP: 0,
      officialAnnualJP,
      referenceWeeklyEquivalentJP,
      regulationReference,
      remainingAnnualJP: null,
      validationStatus: 'INCOMPLETE',
    };
  }

  // Aggregate canonical meeting rows by (unitId, semester) -> 1 PROTA row per Unit/Bab per semester
  const unitGroupMap = new Map<
    string,
    {
      unitId: string;
      unitTitle: string;
      unitOrder: number;
      semester: 1 | 2;
      allocatedJP: number;
      linkedTpIds: string[];
      linkedAtpItemIds: string[];
      scheduledMaterialIds: Set<string>;
      scheduledMaterialTitles: Set<string>;
    }
  >();

  for (const row of canonical.rows) {
    const key = `${row.unitId}_s${row.semester}`;
    if (!unitGroupMap.has(key)) {
      unitGroupMap.set(key, {
        unitId: row.unitId,
        unitTitle: row.unitTitle,
        unitOrder: row.unitOrder,
        semester: row.semester,
        allocatedJP: 0,
        linkedTpIds: [],
        linkedAtpItemIds: [],
        scheduledMaterialIds: new Set(),
        scheduledMaterialTitles: new Set(),
      });
    }

    const group = unitGroupMap.get(key)!;
    group.allocatedJP += row.jp;

    for (const tpId of row.linkedTpIds || []) {
      if (!group.linkedTpIds.includes(tpId)) {
        group.linkedTpIds.push(tpId);
      }
    }
    for (const atpId of row.linkedAtpItemIds || []) {
      if (!group.linkedAtpItemIds.includes(atpId)) {
        group.linkedAtpItemIds.push(atpId);
      }
    }
    for (const mat of row.materials || []) {
      if (mat.id) {
        group.scheduledMaterialIds.add(mat.id);
      }
      if (mat.title) {
        group.scheduledMaterialTitles.add(mat.title);
      }
    }
  }

  const tpItems = context.tp?.items || [];
  const rows: ProtaProjectionRow[] = [];

  const sortedGroups = Array.from(unitGroupMap.values()).sort((a, b) => {
    if (a.semester !== b.semester) return a.semester - b.semester;
    return a.unitOrder - b.unitOrder;
  });

  for (const group of sortedGroups) {
    // Resolve canonical material order from ATPUnitMapping
    const mappingUnit = context.atpUnitMapping?.units?.find(
      (u) => u.id === group.unitId
    );

    let orderedMaterialTitles: string[] = [];

    if (mappingUnit?.materials && mappingUnit.materials.length > 0) {
      // Intersection of scheduled materials and mapping unit materials, sorted by material.order
      const matched = mappingUnit.materials
        .filter(
          (m) =>
            group.scheduledMaterialIds.has(m.id) ||
            group.scheduledMaterialTitles.has(m.title)
        )
        .sort((a, b) => a.order - b.order);

      orderedMaterialTitles = matched.map((m) => m.title);
    }

    if (orderedMaterialTitles.length === 0) {
      orderedMaterialTitles = Array.from(group.scheduledMaterialTitles);
    }

    const materialScope = orderedMaterialTitles.join(', ') || '-';

    // Resolve TP statements from context.tp if available
    const matchedTps = tpItems.filter((t) => group.linkedTpIds.includes(t.id));
    const tpStatements = matchedTps.map((t) => t.statement).filter(Boolean);
    const tpCodes = matchedTps.map((t) => t.code).filter(Boolean);

    const tpCodeDisplay =
      tpCodes.length > 0 ? tpCodes.join(', ') : `Bab ${group.unitOrder}`;
    const tpStatementDisplay =
      tpStatements.length > 0
        ? `${group.unitTitle}\n• ${tpStatements.join('\n• ')}`
        : group.unitTitle;

    rows.push({
      id: `${group.unitId}_s${group.semester}`,
      sourceType: 'UNIT',
      unitId: group.unitId,
      unitTitle: group.unitTitle,
      unitOrder: group.unitOrder,
      tpCode: tpCodeDisplay,
      tpStatement: tpStatementDisplay,
      materialScope,
      semester: group.semester,
      allocatedJP: group.allocatedJP,
    });
  }

  const semester1AllocatedJP = rows
    .filter((r) => r.semester === 1)
    .reduce((sum, r) => sum + r.allocatedJP, 0);
  const semester2AllocatedJP = rows
    .filter((r) => r.semester === 2)
    .reduce((sum, r) => sum + r.allocatedJP, 0);
  const totalAllocatedJP = semester1AllocatedJP + semester2AllocatedJP;

  const remainingAnnualJP =
    officialAnnualJP !== null ? officialAnnualJP - totalAllocatedJP : null;

  const capacities = context.protaSemesterAllocations || [];
  const hasBothCapacities = capacities.length === 2 && new Set(capacities.map(c => c.semester)).size === 2 &&
    capacities.every(c => typeof c.capacityJP === 'number' && Number.isFinite(c.capacityJP) && c.capacityJP >= 0);
  const availableAnnualJP = hasBothCapacities ? capacities.reduce((sum, c) => sum + c.capacityJP!, 0) : null;
  const unallocatedAnnualJP = availableAnnualJP === null ? null : availableAnnualJP - totalAllocatedJP;
  const validationStatus: ProtaProjection['validationStatus'] = unallocatedAnnualJP === null ? 'UNVERIFIED_CAPACITY'
    : unallocatedAnnualJP > 0 ? 'UNDER_ALLOCATED' : unallocatedAnnualJP < 0 ? 'OVER_ALLOCATED' : 'BALANCED';

  return {
    isReady: true,
    academicYear,
    rows,
    assessmentRows: [],
    reserveRows: [],
    semester1AllocatedJP,
    semester2AllocatedJP,
    totalAllocatedJP,
    officialAnnualJP,
    referenceWeeklyEquivalentJP,
    regulationReference,
    remainingAnnualJP,
    availableAnnualJP, unallocatedAnnualJP, referenceDifferenceJP: remainingAnnualJP,
    storedReferenceJP,
    validationStatus,
  };
}

export function buildK13ProtaProjection(context: DocumentGenerationContext): K13ProtaProjection {
  const academicYear = context.academicSetting?.academicYear || '-';
  const isBlankMode = context.documentMode === 'blank';

  if (isBlankMode) {
    return {
      isReady: true,
      academicYear,
      rows: [],
      totalAllocatedJP: 0,
    };
  }

  const k13Items = context.k13Analysis?.items || [];
  const bundles = context.protaSemesterAllocations || [];

  const rows: K13ProtaProjectionRow[] = [];

  for (const item of k13Items) {
    // Find matching time allocation across bundles
    let matchAlloc: TimeAllocation | undefined;
    let semesterAlloc: 1 | 2 | null = null;

    for (const bundle of bundles) {
      const found = bundle.allocations.find(
        (alloc) => alloc.sourceType === 'KD' && (alloc.sourceId === item.id || alloc.sourceId === item.kd)
      );
      if (found) {
        matchAlloc = found;
        semesterAlloc = bundle.semester as 1 | 2;
        break;
      }
    }

    // fallback directly to context.timeAllocations if bundles are empty (backward-compatibility / simple context)
    if (!matchAlloc && context.timeAllocations) {
      const found = context.timeAllocations.find(
        (alloc) => alloc.sourceType === 'KD' && (alloc.sourceId === item.id || alloc.sourceId === item.kd)
      );
      if (found) {
        matchAlloc = found;
        semesterAlloc = (found.semester as 1 | 2) || null;
      }
    }

    const allocatedJP = matchAlloc?.allocatedJP ?? matchAlloc?.jp ?? (item.alokasiJp ? Number(item.alokasiJp) : 0);
    const resolvedSemester = matchAlloc?.semester 
      ? (Number(matchAlloc.semester) as 1 | 2) 
      : semesterAlloc;

    rows.push({
      id: item.id,
      kd: item.kd,
      materi: item.materi,
      kegiatan: item.kegiatan || '-',
      allocatedJP,
      semester: resolvedSemester,
    });
  }

  const totalAllocatedJP = rows.reduce((sum, r) => sum + r.allocatedJP, 0);
  const isReady = k13Items.length > 0;

  return {
    isReady,
    unreadyReason: isReady ? undefined : 'Data analisis KD Kurikulum 2013 belum tersedia.',
    academicYear,
    rows,
    totalAllocatedJP,
  };
}
