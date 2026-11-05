import {
  ATPData,
  ATPUnitMappingData,
  LearningMeetingScheduleData,
  LearningMeetingScheduleEntryMode,
  TPData,
  UnitExecutionPlanData,
} from '../types';
import { validateUnitExecutionPlan } from './unitExecutionPlanService';

export interface ScheduledLearningMeetingProjection {
  meetingId: string;
  unitId: string;
  unitTitle: string;
  unitOrder: number;
  meetingTitle: string;
  meetingOrder: number;
  linkedAtpItemIds: string[];
  linkedTpIds: string[];
  materials: { id: string; title: string }[];
  semester: 1 | 2;
  semesterPlanId: string;
  date: string;
  dayOfWeek: 1 | 2 | 3 | 4 | 5 | 6;
  weekIndex: number;
  jp: number;
  mode: LearningMeetingScheduleEntryMode;
}

export interface ScheduledLearningMeetingScheduleInput {
  semesterPlanId: string;
  semester: 1 | 2;
  schedule: LearningMeetingScheduleData;
}

export interface ScheduledLearningMeetingProjectionResult {
  rows: ScheduledLearningMeetingProjection[];
  errors: string[];
  isValid: boolean;
}

export function resolveScheduledLearningMeetings(params: {
  mapping: ATPUnitMappingData;
  unitExecutionPlan: UnitExecutionPlanData;
  schedules: ScheduledLearningMeetingScheduleInput[];
  tp?: TPData;
  atp?: ATPData;
}): ScheduledLearningMeetingProjectionResult {
  const { mapping, unitExecutionPlan, schedules, tp, atp } = params;
  const errors: string[] = [];
  const rows: ScheduledLearningMeetingProjection[] = [];

  // 1. Canonical UnitExecutionPlan validation
  const planValidation = validateUnitExecutionPlan(
    unitExecutionPlan,
    mapping,
    atp || null,
    tp || null
  );

  if (planValidation.isStale) {
    errors.push('Struktur Pertemuan stale relatif terhadap Pemetaan Unit/Bab.');
  }
  if (!planValidation.isValid) {
    errors.push(...planValidation.errors);
  }
  if (!planValidation.isComplete) {
    errors.push('Struktur Pertemuan belum lengkap (coverage atau pertemuan masih kurang).');
  }

  const mappingUnitMap = new Map((mapping.units || []).map((unit) => [unit.id, unit]));
  const meetingMap = new Map<string, {
    unitId: string;
    meetingTitle: string;
    meetingOrder: number;
    linkedAtpItemIds: string[];
    linkedTpIds: string[];
    materialIds: string[];
  }>();

  for (const unitPlan of unitExecutionPlan.units || []) {
    if (!mappingUnitMap.has(unitPlan.unitId)) {
      continue;
    }

    for (const meeting of unitPlan.meetings || []) {
      meetingMap.set(meeting.id, {
        unitId: unitPlan.unitId,
        meetingTitle: meeting.title,
        meetingOrder: meeting.order,
        linkedAtpItemIds: [...(meeting.linkedAtpItemIds || [])],
        linkedTpIds: [...(meeting.linkedTpIds || [])],
        materialIds: [...(meeting.materialIds || [])],
      });
    }
  }

  // 2. Validate schedules and semester bundle integrity
  const scheduleSemesterPlanIds = new Set<string>();
  const scheduleSemesters = new Set<number>();
  const projectedMeetingIds = new Set<string>();

  for (const scheduleInput of schedules || []) {
    const { semesterPlanId, semester, schedule } = scheduleInput;

    if (semester !== 1 && semester !== 2) {
      errors.push(`Nilai semester "${semester}" tidak valid (harus 1 atau 2).`);
    }
    if (scheduleSemesters.has(semester)) {
      errors.push(`Duplicate schedule untuk semester ${semester}.`);
    }
    scheduleSemesters.add(semester);

    if (scheduleSemesterPlanIds.has(semesterPlanId)) {
      errors.push(`Duplicate schedule untuk semesterPlanId "${semesterPlanId}".`);
    }
    scheduleSemesterPlanIds.add(semesterPlanId);

    if (!schedule) {
      errors.push(`Schedule untuk semester ${semester} tidak ada.`);
      continue;
    }

    if (schedule.semesterPlanId !== semesterPlanId) {
      errors.push(`LearningMeetingScheduleData semesterPlanId "${schedule.semesterPlanId}" tidak cocok dengan input "${semesterPlanId}".`);
    }
    if (schedule.status !== 'COMPLETE') {
      errors.push(`Schedule semester ${semester} belum COMPLETE.`);
    }
    if ((schedule.unresolvedMeetingIds || []).length > 0) {
      errors.push(`Schedule semester ${semester} masih memiliki unresolvedMeetingIds.`);
    }

    if (schedule.semesterPlanId !== semesterPlanId || schedule.status !== 'COMPLETE' || (schedule.unresolvedMeetingIds || []).length > 0) {
      continue;
    }

    const entryMeetingIds = new Set<string>();
    for (const entry of schedule.entries || []) {
      if (entry.semesterPlanId !== semesterPlanId) {
        errors.push(`Entry meeting "${entry.meetingId}" memiliki semesterPlanId "${entry.semesterPlanId}", bukan "${semesterPlanId}".`);
        continue;
      }
      if (entryMeetingIds.has(entry.meetingId)) {
        errors.push(`Duplicate meetingId pada schedule "${semesterPlanId}": "${entry.meetingId}".`);
      }
      entryMeetingIds.add(entry.meetingId);
      if (projectedMeetingIds.has(entry.meetingId)) {
        errors.push(`Duplicate meetingId lintas schedule: "${entry.meetingId}".`);
        continue;
      }
      projectedMeetingIds.add(entry.meetingId);

      const meeting = meetingMap.get(entry.meetingId);
      if (!meeting) {
        errors.push(`Schedule "${semesterPlanId}" memuat orphan meetingId "${entry.meetingId}".`);
        continue;
      }
      if (entry.unitId !== meeting.unitId) {
        errors.push(`Entry meeting "${entry.meetingId}" unitId "${entry.unitId}" tidak cocok dengan UnitExecutionPlan unitId "${meeting.unitId}".`);
        continue;
      }

      const mappingUnit = mappingUnitMap.get(meeting.unitId);
      if (!mappingUnit) {
        errors.push(`Meeting "${entry.meetingId}" mengarah ke unit "${meeting.unitId}" yang tidak ada pada ATPUnitMapping.`);
        continue;
      }

      // 3. Resolve materials strictly without fallback
      const unitMaterialsMap = new Map((mappingUnit.materials || []).map((m) => [m.id, m]));
      const materialList: { id: string; title: string; order: number }[] = [];
      let hasOrphanMaterial = false;

      for (const matId of meeting.materialIds || []) {
        const mat = unitMaterialsMap.get(matId);
        if (!mat) {
          hasOrphanMaterial = true;
          errors.push(`Meeting "${entry.meetingId}" merujuk materialId "${matId}" yang tidak ditemukan pada unit "${meeting.unitId}".`);
        } else {
          materialList.push({ id: mat.id, title: mat.title, order: mat.order });
        }
      }

      if (hasOrphanMaterial) {
        continue;
      }

      materialList.sort((a, b) => a.order - b.order);
      const materials = materialList.map((m) => ({ id: m.id, title: m.title }));

      rows.push({
        meetingId: entry.meetingId,
        unitId: meeting.unitId,
        unitTitle: mappingUnit.title,
        unitOrder: mappingUnit.order,
        meetingTitle: meeting.meetingTitle,
        meetingOrder: meeting.meetingOrder,
        linkedAtpItemIds: meeting.linkedAtpItemIds,
        linkedTpIds: meeting.linkedTpIds,
        materials,
        semester,
        semesterPlanId,
        date: entry.date,
        dayOfWeek: entry.dayOfWeek,
        weekIndex: entry.weekIndex,
        jp: entry.jp,
        mode: entry.mode,
      });
    }
  }

  rows.sort((a, b) => {
    if (a.semester !== b.semester) return a.semester - b.semester;
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.unitOrder !== b.unitOrder) return a.unitOrder - b.unitOrder;
    return a.meetingOrder - b.meetingOrder;
  });

  return {
    rows,
    errors,
    isValid: errors.length === 0,
  };
}
