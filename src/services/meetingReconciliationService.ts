import {
  UnitExecutionPlanData,
  ATPUnitMappingData,
  ATPData,
  TPData,
  LearningMeeting,
} from '../types';
import { validateUnitExecutionPlan } from './unitExecutionPlanService';

export type MeetingReconciliationAction = 'RESCHEDULE' | 'MERGE' | 'REDUCE';

export interface MeetingReconciliationSafeOption {
  action: MeetingReconciliationAction;
  meetingId: string;

  // RESCHEDULE option params
  candidateDate?: string;
  candidateSessionId?: string;
  candidateLabel?: string;

  // MERGE option params
  targetMeetingId?: string;
  targetMeetingTitle?: string;

  safe: true;
  coveragePreserved: boolean;
}

export interface MeetingReconciliationAnalysis {
  meetingId: string;
  unitId: string;
  unitTitle: string;
  meetingTitle: string;

  safeOptions: MeetingReconciliationSafeOption[];

  uniqueMaterialIds: string[];
  uniqueAtpItemIds: string[];
  uniqueTpIds: string[];

  canReduce: boolean;
  mergeTargetMeetingIds: string[];
}

/**
 * Deterministically analyzes safe reconciliation options for a given unresolved meeting.
 * Safety is determined by application logic and canonical validator, NOT by AI.
 */
export function analyzeMeetingReconciliation(params: {
  unresolvedMeetingId: string;
  unitExecutionPlan: UnitExecutionPlanData;
  mapping: ATPUnitMappingData;
  atpData?: ATPData | null;
  tpData?: TPData | null;
  replacementCandidates: Array<{
    date: string;
    sessionId: string;
    label: string;
  }>;
}): MeetingReconciliationAnalysis {
  const {
    unresolvedMeetingId,
    unitExecutionPlan,
    mapping,
    atpData,
    tpData,
    replacementCandidates,
  } = params;

  let sourceMeeting: LearningMeeting | null = null;
  let sourceUnitId = '';
  let sourceUnitMeetings: LearningMeeting[] = [];

  for (const u of unitExecutionPlan.units || []) {
    const found = (u.meetings || []).find((m) => m.id === unresolvedMeetingId);
    if (found) {
      sourceMeeting = found;
      sourceUnitId = u.unitId;
      sourceUnitMeetings = u.meetings || [];
      break;
    }
  }

  const mappingUnit = (mapping.units || []).find((u) => u.id === sourceUnitId);
  const unitTitle = mappingUnit?.title || `Unit ${sourceUnitId}`;
  const meetingTitle = sourceMeeting?.title || 'Pertemuan';

  if (!sourceMeeting || !sourceUnitId) {
    return {
      meetingId: unresolvedMeetingId,
      unitId: '',
      unitTitle: '',
      meetingTitle: '',
      safeOptions: [],
      uniqueMaterialIds: [],
      uniqueAtpItemIds: [],
      uniqueTpIds: [],
      canReduce: false,
      mergeTargetMeetingIds: [],
    };
  }

  // 1. Compute unique coverage for sourceMeeting within its parent Unit
  const otherMeetingsInUnit = sourceUnitMeetings.filter((m) => m.id !== unresolvedMeetingId);
  const otherMaterialIds = new Set(otherMeetingsInUnit.flatMap((m) => m.materialIds || []));
  const otherAtpItemIds = new Set(otherMeetingsInUnit.flatMap((m) => m.linkedAtpItemIds || []));
  const otherTpIds = new Set(otherMeetingsInUnit.flatMap((m) => m.linkedTpIds || []));

  const uniqueMaterialIds = (sourceMeeting.materialIds || []).filter((id) => !otherMaterialIds.has(id));
  const uniqueAtpItemIds = (sourceMeeting.linkedAtpItemIds || []).filter((id) => !otherAtpItemIds.has(id));
  const uniqueTpIds = (sourceMeeting.linkedTpIds || []).filter((id) => !otherTpIds.has(id));

  const safeOptions: MeetingReconciliationSafeOption[] = [];

  // 2. RESCHEDULE Safe Options
  for (const cand of replacementCandidates) {
    safeOptions.push({
      action: 'RESCHEDULE',
      meetingId: unresolvedMeetingId,
      candidateDate: cand.date,
      candidateSessionId: cand.sessionId,
      candidateLabel: cand.label,
      safe: true,
      coveragePreserved: true,
    });
  }

  // 3. MERGE Safe Options (Adjacent meetings in same unit)
  const mergeTargetMeetingIds: string[] = [];
  const sortedUnitMeetings = [...sourceUnitMeetings].sort((a, b) => a.order - b.order);
  const sourceIndex = sortedUnitMeetings.findIndex((m) => m.id === unresolvedMeetingId);

  const adjacentMeetingCandidates: LearningMeeting[] = [];
  if (sourceIndex > 0) {
    adjacentMeetingCandidates.push(sortedUnitMeetings[sourceIndex - 1]);
  }
  if (sourceIndex < sortedUnitMeetings.length - 1) {
    adjacentMeetingCandidates.push(sortedUnitMeetings[sourceIndex + 1]);
  }

  for (const targetM of adjacentMeetingCandidates) {
    // Simulate plan with MERGE
    const simulatedPlan: UnitExecutionPlanData = JSON.parse(JSON.stringify(unitExecutionPlan));
    const simUnit = simulatedPlan.units.find((u) => u.unitId === sourceUnitId);
    if (simUnit) {
      const simTarget = simUnit.meetings.find((m) => m.id === targetM.id);
      if (simTarget) {
        // Union refs
        simTarget.materialIds = Array.from(
          new Set([...(simTarget.materialIds || []), ...(sourceMeeting.materialIds || [])])
        );
        simTarget.linkedAtpItemIds = Array.from(
          new Set([...(simTarget.linkedAtpItemIds || []), ...(sourceMeeting.linkedAtpItemIds || [])])
        );
        simTarget.linkedTpIds = Array.from(
          new Set([...(simTarget.linkedTpIds || []), ...(sourceMeeting.linkedTpIds || [])])
        );

        // Remove source meeting
        simUnit.meetings = simUnit.meetings.filter((m) => m.id !== unresolvedMeetingId);
        simUnit.meetings.sort((a, b) => a.order - b.order);
        simUnit.meetings.forEach((m, idx) => {
          m.order = idx + 1;
        });

        const simVal = validateUnitExecutionPlan(simulatedPlan, mapping, atpData, tpData);
        if (simVal.isValid && simVal.isComplete) {
          mergeTargetMeetingIds.push(targetM.id);
          safeOptions.push({
            action: 'MERGE',
            meetingId: unresolvedMeetingId,
            targetMeetingId: targetM.id,
            targetMeetingTitle: targetM.title,
            safe: true,
            coveragePreserved: true,
          });
        }
      }
    }
  }

  // 4. REDUCE Safe Option ("Padatkan Pertemuan")
  let canReduce = false;
  if (sourceUnitMeetings.length > 1) {
    const simulatedPlan: UnitExecutionPlanData = JSON.parse(JSON.stringify(unitExecutionPlan));
    const simUnit = simulatedPlan.units.find((u) => u.unitId === sourceUnitId);
    if (simUnit) {
      simUnit.meetings = simUnit.meetings.filter((m) => m.id !== unresolvedMeetingId);
      simUnit.meetings.sort((a, b) => a.order - b.order);
      simUnit.meetings.forEach((m, idx) => {
        m.order = idx + 1;
      });

      const simVal = validateUnitExecutionPlan(simulatedPlan, mapping, atpData, tpData);
      if (simVal.isValid && simVal.isComplete) {
        canReduce = true;
        safeOptions.push({
          action: 'REDUCE',
          meetingId: unresolvedMeetingId,
          safe: true,
          coveragePreserved: true,
        });
      }
    }
  }

  return {
    meetingId: unresolvedMeetingId,
    unitId: sourceUnitId,
    unitTitle,
    meetingTitle,
    safeOptions,
    uniqueMaterialIds,
    uniqueAtpItemIds,
    uniqueTpIds,
    canReduce,
    mergeTargetMeetingIds,
  };
}

/**
 * Checks if a reconciliation action is still safe against current safe options.
 */
export function isReconciliationOptionStillSafe(
  recommendation: {
    action: MeetingReconciliationAction;
    candidateDate?: string;
    candidateSessionId?: string;
    targetMeetingId?: string;
  },
  safeOptions: MeetingReconciliationSafeOption[]
): boolean {
  if (!Array.isArray(safeOptions) || safeOptions.length === 0) return false;

  if (recommendation.action === 'RESCHEDULE') {
    return safeOptions.some(
      (opt) =>
        opt.action === 'RESCHEDULE' &&
        opt.candidateDate === recommendation.candidateDate &&
        opt.candidateSessionId === recommendation.candidateSessionId
    );
  }

  if (recommendation.action === 'MERGE') {
    return safeOptions.some(
      (opt) =>
        opt.action === 'MERGE' &&
        opt.targetMeetingId === recommendation.targetMeetingId
    );
  }

  if (recommendation.action === 'REDUCE') {
    return safeOptions.some((opt) => opt.action === 'REDUCE');
  }

  return false;
}

/**
 * Applies a chosen reconciliation action on UnitExecutionPlanData with strict re-validation before saving.
 */
export function applyReconciliationAction(params: {
  action: MeetingReconciliationAction;
  unresolvedMeetingId: string;
  unitExecutionPlan: UnitExecutionPlanData;
  mapping: ATPUnitMappingData;
  atpData?: ATPData | null;
  tpData?: TPData | null;
  candidateDate?: string;
  candidateSessionId?: string;
  targetMeetingId?: string;
  suggestedTitle?: string;
  safeOptions: MeetingReconciliationSafeOption[];
}): {
  updatedPlan?: UnitExecutionPlanData;
  manualSelection?: { date: string; sessionId: string };
  success: boolean;
  error?: string;
} {
  const {
    action,
    unresolvedMeetingId,
    unitExecutionPlan,
    mapping,
    atpData,
    tpData,
    candidateDate,
    candidateSessionId,
    targetMeetingId,
    suggestedTitle,
    safeOptions,
  } = params;

  const stillSafe = isReconciliationOptionStillSafe(
    {
      action,
      candidateDate,
      candidateSessionId,
      targetMeetingId,
    },
    safeOptions
  );

  if (!stillSafe) {
    return {
      success: false,
      error:
        'Rekomendasi sudah tidak sesuai dengan kondisi jadwal terbaru. Silakan optimalkan ulang.',
    };
  }

  if (action === 'RESCHEDULE') {
    if (!candidateDate || !candidateSessionId) {
      return { success: false, error: 'Tanggal atau sesi kandidat pengganti belum dipilih.' };
    }
    return {
      success: true,
      manualSelection: { date: candidateDate, sessionId: candidateSessionId },
    };
  }

  if (action === 'MERGE') {
    if (!targetMeetingId) {
      return { success: false, error: 'Pertemuan target penggabungan belum dipilih.' };
    }

    const updatedPlan: UnitExecutionPlanData = JSON.parse(JSON.stringify(unitExecutionPlan));
    let sourceMeeting: LearningMeeting | null = null;
    const targetUnit = updatedPlan.units.find((u) =>
      u.meetings.some((m) => m.id === unresolvedMeetingId)
    );

    if (!targetUnit) {
      return { success: false, error: 'Pertemuan belum terjadwal tidak ditemukan dalam Rencana Pelaksanaan.' };
    }

    sourceMeeting = targetUnit.meetings.find((m) => m.id === unresolvedMeetingId) || null;
    const targetMeeting = targetUnit.meetings.find((m) => m.id === targetMeetingId);

    if (!sourceMeeting || !targetMeeting) {
      return { success: false, error: 'Pertemuan target atau asal penggabungan tidak ditemukan.' };
    }

    // UNION refs
    targetMeeting.materialIds = Array.from(
      new Set([...(targetMeeting.materialIds || []), ...(sourceMeeting.materialIds || [])])
    );
    targetMeeting.linkedAtpItemIds = Array.from(
      new Set([...(targetMeeting.linkedAtpItemIds || []), ...(sourceMeeting.linkedAtpItemIds || [])])
    );
    targetMeeting.linkedTpIds = Array.from(
      new Set([...(targetMeeting.linkedTpIds || []), ...(sourceMeeting.linkedTpIds || [])])
    );

    if (suggestedTitle && suggestedTitle.trim()) {
      targetMeeting.title = suggestedTitle.trim();
    }

    // Remove source meeting
    targetUnit.meetings = targetUnit.meetings.filter((m) => m.id !== unresolvedMeetingId);
    targetUnit.meetings.sort((a, b) => a.order - b.order);
    targetUnit.meetings.forEach((m, idx) => {
      m.order = idx + 1;
    });

    updatedPlan.updatedAt = new Date().toISOString();

    const val = validateUnitExecutionPlan(updatedPlan, mapping, atpData, tpData);
    if (!val.isValid || !val.isComplete) {
      return {
        success: false,
        error: `Penggabungan pertemuan gagal validasi: ${val.errors.join(' ')}`,
      };
    }

    return { success: true, updatedPlan };
  }

  if (action === 'REDUCE') {
    const updatedPlan: UnitExecutionPlanData = JSON.parse(JSON.stringify(unitExecutionPlan));
    const targetUnit = updatedPlan.units.find((u) =>
      u.meetings.some((m) => m.id === unresolvedMeetingId)
    );

    if (!targetUnit) {
      return { success: false, error: 'Pertemuan belum terjadwal tidak ditemukan.' };
    }

    targetUnit.meetings = targetUnit.meetings.filter((m) => m.id !== unresolvedMeetingId);
    targetUnit.meetings.sort((a, b) => a.order - b.order);
    targetUnit.meetings.forEach((m, idx) => {
      m.order = idx + 1;
    });

    updatedPlan.updatedAt = new Date().toISOString();

    const val = validateUnitExecutionPlan(updatedPlan, mapping, atpData, tpData);
    if (!val.isValid || !val.isComplete) {
      return {
        success: false,
        error: `Pemadatan pertemuan tidak aman karena menghilangkan cakupan pembelajaran kanonikal.`,
      };
    }

    return { success: true, updatedPlan };
  }

  return { success: false, error: 'Aksi rekonsiliasi tidak dikenal.' };
}
