import {
  ATPUnitMappingData,
  UnitExecutionPlanData,
  LearningMeetingScheduleEntry,
  LearningMeetingScheduleResult,
  LearningMeetingScheduleData,
  SubjectWeeklySchedule,
  AcademicCalendar,
  CalendarDay,
} from '../types';
import { resolveUnitSemesterPlacement } from './unitSemesterPlanningService';
import {
  EffectiveSubjectSlotResult,
  resolveEffectiveSubjectSlots,
} from './subjectScheduleService';
import { getEffectiveWeeksList, normalizeCalendarDayStatus } from './jpEngine';

/**
 * Resolves and pairs LearningMeetings sequentially to actual calendar slots.
 */
export function resolveLearningMeetingSchedule(params: {
  semesterPlanId: string;
  semester: 1 | 2;
  mapping: ATPUnitMappingData;
  unitExecutionPlan: UnitExecutionPlanData;
  subjectSlotResult: EffectiveSubjectSlotResult;
}): LearningMeetingScheduleResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Initial fail-closed validation of parameters
  if (!params.semesterPlanId || !params.semester || !params.mapping || !params.unitExecutionPlan || !params.subjectSlotResult) {
    return createFailedResult(['Parameter input resolver tidak lengkap.'], params.subjectSlotResult);
  }

  const { semesterPlanId, semester, mapping, unitExecutionPlan, subjectSlotResult } = params;

  // 2. Validate Semester Placement
  const placement = resolveUnitSemesterPlacement(unitExecutionPlan, mapping);
  if (!placement.isValid || !placement.isComplete || placement.isStale) {
    const placementErrors = placement.errors || [];
    return createFailedResult([
      'Pembagian semester Unit/Bab tidak valid, tidak lengkap, atau stale.',
      ...placementErrors,
    ], subjectSlotResult);
  }

  // 3. Validation rule: Unit ID on plan must match mapping exactly
  const mappingUnitIds = new Set((mapping.units || []).map((u) => u.id));
  const planUnitIds = new Set((unitExecutionPlan.units || []).map((u) => u.unitId));

  // Check if every plan unit is in mapping
  for (const planUnitId of planUnitIds) {
    if (!mappingUnitIds.has(planUnitId)) {
      errors.push(`Unit ID "${planUnitId}" pada rencana pelaksanaan tidak cocok dengan pemetaan Unit/Bab.`);
    }
  }
  // Check if every mapping unit is in plan
  for (const mappingUnitId of mappingUnitIds) {
    if (!planUnitIds.has(mappingUnitId)) {
      errors.push(`Rencana pelaksanaan belum memiliki unit dengan ID "${mappingUnitId}" dari pemetaan.`);
    }
  }

  // 4. Validation rule: Meeting IDs must not be empty or duplicate
  const seenMeetingIds = new Set<string>();
  const allMeetingsInPlan = (unitExecutionPlan.units || []).flatMap((u) => u.meetings || []);

  for (const m of allMeetingsInPlan) {
    if (!m.id || !m.id.trim()) {
      errors.push('Terdapat Pertemuan yang memiliki ID kosong.');
    } else if (seenMeetingIds.has(m.id)) {
      errors.push(`ID Pertemuan duplikat terdeteksi: "${m.id}".`);
    } else {
      seenMeetingIds.add(m.id);
    }

    // 5. Validation rule: meeting.order must be valid and duplicate-free in its Unit
    if (typeof m.order !== 'number' || m.order <= 0 || !Number.isInteger(m.order)) {
      errors.push(`Pertemuan "${m.id || m.title}" memiliki order tidak valid: ${m.order}.`);
    }
  }

  // Check duplicate orders per Unit
  for (const u of unitExecutionPlan.units || []) {
    const unitOrders = new Set<number>();
    for (const m of u.meetings || []) {
      if (typeof m.order === 'number' && Number.isInteger(m.order)) {
        if (unitOrders.has(m.order)) {
          errors.push(`Order Pertemuan duplikat "${m.order}" terdeteksi di Unit "${u.unitId}".`);
        }
        unitOrders.add(m.order);
      }
    }
  }

  // 6. Validation rule: subjectSlotResult slots must match input semesterPlanId and have no duplicate slot IDs
  if (subjectSlotResult.isReady && Array.isArray(subjectSlotResult.slots)) {
    const seenSlotIds = new Set<string>();
    for (const slot of subjectSlotResult.slots) {
      if (slot.semesterPlanId !== semesterPlanId) {
        errors.push(`Rencana pelaksanaan tidak cocok: slot "${slot.id}" memiliki semesterPlanId "${slot.semesterPlanId}", diharapkan "${semesterPlanId}".`);
      }
      if (seenSlotIds.has(slot.id)) {
        errors.push(`ID slot tanggal duplikat terdeteksi: "${slot.id}".`);
      } else {
        seenSlotIds.add(slot.id);
      }
    }
  }

  // If any structural validation errors exist, fail-closed immediately
  if (errors.length > 0) {
    return createFailedResult(errors, subjectSlotResult);
  }

  // 7. Determine targeted semester unit IDs
  const targetUnitIds = new Set<string>(
    semester === 1 ? placement.semester1UnitIds : placement.semester2UnitIds
  );

  // 8. Retrieve and sort meetings canonically
  // Unit sorted by mapping.units order, meetings inside each sorted by meeting.order
  const mappingUnitOrderMap = new Map<string, number>(
    (mapping.units || []).map((u) => [u.id, u.order])
  );

  const semesterPlanUnits = (unitExecutionPlan.units || [])
    .filter((u) => targetUnitIds.has(u.unitId))
    .sort((a, b) => {
      const orderA = mappingUnitOrderMap.get(a.unitId) ?? 999;
      const orderB = mappingUnitOrderMap.get(b.unitId) ?? 999;
      return orderA - orderB;
    });

  const flatMeetings: typeof allMeetingsInPlan = [];
  for (const u of semesterPlanUnits) {
    const sortedMeetings = [...(u.meetings || [])].sort((a, b) => a.order - b.order);
    flatMeetings.push(...sortedMeetings);
  }

  const totalMeetings = flatMeetings.length;

  // 9. Readiness fallback
  if (!subjectSlotResult.isReady) {
    // Return result with no scheduled entries but calculate total planned meetings
    return {
      totalMeetings,
      totalAvailableSlots: 0,
      totalScheduledMeetings: 0,
      totalUnscheduledMeetings: totalMeetings,
      totalActualJP: 0,
      totalExcludedOccurrences: subjectSlotResult?.totalExcludedOccurrences || 0,
      scheduledEntries: [],
      unscheduledMeetingIds: flatMeetings.map((m) => m.id),
      excludedOccurrences: subjectSlotResult?.excludedOccurrences || [],
      errors: [...(subjectSlotResult?.errors || [])],
      warnings: [...(subjectSlotResult?.warnings || [])],
      isReady: false,
      isComplete: false,
      isValid: true, // Structurally valid, just not ready on dates
    };
  }

  // 10. Sort exact slots deterministically
  const sortedSlots = [...(subjectSlotResult.slots || [])].sort((a, b) => {
    if (a.date !== b.date) {
      return a.date.localeCompare(b.date);
    }
    const orderA = a.sessionOrder ?? 0;
    const orderB = b.sessionOrder ?? 0;
    return orderA - orderB;
  });

  const totalAvailableSlots = sortedSlots.length;

  // 11. Sequential pairing
  const scheduledEntries: LearningMeetingScheduleEntry[] = [];
  const scheduledCount = Math.min(totalMeetings, totalAvailableSlots);

  for (let i = 0; i < scheduledCount; i++) {
    const meeting = flatMeetings[i];
    const slot = sortedSlots[i];

    scheduledEntries.push({
      meetingId: meeting.id,
      unitId: meeting.unitId,
      semesterPlanId,
      sessionId: slot.sessionId,
      sourceSlotId: slot.id,
      date: slot.date,
      dayOfWeek: slot.dayOfWeek,
      jp: slot.jp,
      weekIndex: slot.weekIndex,
      mode: 'AUTO',
    });
  }

  // 12. Handle unscheduled meetings (Capacity mismatch)
  const unscheduledMeetingIds: string[] = [];
  if (totalMeetings > totalAvailableSlots) {
    for (let i = totalAvailableSlots; i < totalMeetings; i++) {
      unscheduledMeetingIds.push(flatMeetings[i].id);
    }
    warnings.push(`Kapasitas slot perencanaan kurang: ${totalMeetings} pertemuan direncanakan, tetapi hanya tersedia ${totalAvailableSlots} slot tanggal.`);
  } else if (totalAvailableSlots > totalMeetings) {
    warnings.push(`Terdapat ${totalAvailableSlots - totalMeetings} slot perencanaan tersisa yang belum dijadwalkan.`);
  }

  const totalScheduledMeetings = scheduledEntries.length;
  const totalUnscheduledMeetings = unscheduledMeetingIds.length;
  const totalActualJP = scheduledEntries.reduce((sum, entry) => sum + entry.jp, 0);
  const totalExcludedOccurrences = subjectSlotResult?.totalExcludedOccurrences || 0;

  const isComplete = totalUnscheduledMeetings === 0;

  return {
    totalMeetings,
    totalAvailableSlots,
    totalScheduledMeetings,
    totalUnscheduledMeetings,
    totalActualJP,
    totalExcludedOccurrences,
    scheduledEntries,
    unscheduledMeetingIds,
    excludedOccurrences: subjectSlotResult?.excludedOccurrences || [],
    errors: [...(subjectSlotResult?.errors || [])],
    warnings: [...(subjectSlotResult?.warnings || []), ...warnings],
    isReady: true,
    isComplete,
    isValid: true,
  };
}

/**
 * Creates a canonically structured failed/invalid result.
 */
function createFailedResult(
  errors: string[],
  subjectSlotResult: EffectiveSubjectSlotResult
): LearningMeetingScheduleResult {
  return {
    totalMeetings: 0,
    totalAvailableSlots: 0,
    totalScheduledMeetings: 0,
    totalUnscheduledMeetings: 0,
    totalActualJP: 0,
    totalExcludedOccurrences: subjectSlotResult?.totalExcludedOccurrences || 0,
    scheduledEntries: [],
    unscheduledMeetingIds: [],
    excludedOccurrences: subjectSlotResult?.excludedOccurrences || [],
    errors,
    warnings: subjectSlotResult?.warnings || [],
    isReady: false,
    isComplete: false,
    isValid: false,
  };
}

/**
 * Checks if a persisted schedule is stale compared to current planning lineage.
 */
export function isLearningMeetingScheduleStale(params: {
  schedule: LearningMeetingScheduleData;
  mappingUpdatedAt?: string;
  unitExecutionPlanUpdatedAt?: string;
  subjectWeeklyScheduleUpdatedAt: string;
  calendarUpdatedAt: string;
  expectedWeeklyJP: number;
}): boolean {
  const {
    schedule,
    subjectWeeklyScheduleUpdatedAt,
    calendarUpdatedAt,
    expectedWeeklyJP,
  } = params;

  if (!schedule) return true;

  return (
    schedule.basedOnSubjectWeeklyScheduleUpdatedAt !== subjectWeeklyScheduleUpdatedAt ||
    schedule.basedOnCalendarUpdatedAt !== calendarUpdatedAt ||
    schedule.basedOnWeeklyJP !== expectedWeeklyJP
  );
}

export interface ValidateLearningMeetingScheduleParams {
  data: LearningMeetingScheduleData;
  semester: 1 | 2;
  mapping: ATPUnitMappingData;
  unitExecutionPlan: UnitExecutionPlanData;
  subjectWeeklySchedule: SubjectWeeklySchedule;
  expectedWeeklyJP: number;
  calendar: AcademicCalendar;
  calendarDays: CalendarDay[];
}

export interface ValidateLearningMeetingScheduleResult {
  isValid: boolean;
  isStale: boolean;
  errors: string[];
}

/**
 * Pure validator for persisted LearningMeetingScheduleData.
 */
export function validateLearningMeetingScheduleData(
  params: ValidateLearningMeetingScheduleParams
): ValidateLearningMeetingScheduleResult {
  const errors: string[] = [];
  const {
    data,
    semester,
    mapping,
    unitExecutionPlan,
    subjectWeeklySchedule,
    expectedWeeklyJP,
    calendar,
    calendarDays,
  } = params;

  // 1. Basic structural checks
  if (!data || typeof data !== 'object') {
    return { isValid: false, isStale: false, errors: ['Data jadwal tidak ada atau tidak valid.'] };
  }

  if (!data.id || typeof data.id !== 'string' || !data.id.trim()) {
    errors.push('Schedule ID tidak boleh kosong.');
  }

  if (data.semesterPlanId !== subjectWeeklySchedule.semesterPlanId) {
    errors.push(`semesterPlanId jadwal "${data.semesterPlanId}" tidak cocok dengan "${subjectWeeklySchedule.semesterPlanId}".`);
  }

  if (!Array.isArray(data.entries)) {
    errors.push('entries harus berupa array.');
  }

  if (!Array.isArray(data.unresolvedMeetingIds)) {
    errors.push('unresolvedMeetingIds harus berupa array.');
  }

  if (data.status !== 'DRAFT' && data.status !== 'COMPLETE') {
    errors.push('status hanya boleh DRAFT atau COMPLETE.');
  }

  if (typeof data.basedOnWeeklyJP !== 'number' || data.basedOnWeeklyJP <= 0) {
    errors.push('basedOnWeeklyJP harus integer positif.');
  }

  // 2. Lineage checks (Stale detection)
  const isStale = isLearningMeetingScheduleStale({
    schedule: data,
    mappingUpdatedAt: mapping?.updatedAt || '',
    unitExecutionPlanUpdatedAt: unitExecutionPlan?.updatedAt || '',
    subjectWeeklyScheduleUpdatedAt: subjectWeeklySchedule?.updatedAt || '',
    calendarUpdatedAt: calendar?.updatedAt || '',
    expectedWeeklyJP,
  });

  if (isStale) {
    errors.push('Jadwal stale: lineage timestamp atau JP mingguan tidak cocok dengan data perencanaan terkini.');
  }

  // 3. Resolve canonical semester meetings
  const placement = resolveUnitSemesterPlacement(unitExecutionPlan, mapping);
  if (!placement.isValid) {
    errors.push('Pembagian semester unit tidak valid.');
    return { isValid: false, isStale, errors };
  }

  const targetUnitIds = new Set(semester === 1 ? placement.semester1UnitIds : placement.semester2UnitIds);
  const mappingUnitOrderMap = new Map<string, number>();
  (mapping.units || []).forEach((u) => mappingUnitOrderMap.set(u.id, u.order));

  const sortedUnits = (unitExecutionPlan.units || [])
    .filter((u) => targetUnitIds.has(u.unitId))
    .sort((a, b) => {
      const orderA = mappingUnitOrderMap.get(a.unitId) ?? 999;
      const orderB = mappingUnitOrderMap.get(b.unitId) ?? 999;
      return orderA - orderB;
    });

  const canonicalMeetings: Array<{ meetingId: string; unitId: string; order: number }> = [];
  for (const u of sortedUnits) {
    const sortedM = [...(u.meetings || [])].sort((a, b) => a.order - b.order);
    for (const m of sortedM) {
      canonicalMeetings.push({ meetingId: m.id, unitId: u.unitId, order: m.order });
    }
  }

  const canonicalMeetingIds = new Set(canonicalMeetings.map((m) => m.meetingId));

  // 4. Meeting coverage checks
  const entryMeetingIds = new Set<string>();
  const sourceSlotIds = new Set<string>();
  const usedDateSessions = new Set<string>();

  for (const entry of (data.entries || [])) {
    if (!entry.meetingId || typeof entry.meetingId !== 'string') {
      errors.push('Terdapat entry dengan meetingId kosong.');
      continue;
    }
    if (entryMeetingIds.has(entry.meetingId)) {
      errors.push(`Duplicate meetingId pada entries: "${entry.meetingId}".`);
    }
    entryMeetingIds.add(entry.meetingId);

    if (!canonicalMeetingIds.has(entry.meetingId)) {
      errors.push(`Meeting ID "${entry.meetingId}" pada entries bukan merupakan Pertemuan untuk semester ini.`);
    }

    if (!entry.sourceSlotId || typeof entry.sourceSlotId !== 'string') {
      errors.push(`Entry untuk meeting "${entry.meetingId}" tidak memiliki sourceSlotId.`);
    } else {
      if (sourceSlotIds.has(entry.sourceSlotId)) {
        errors.push(`Duplicate sourceSlotId terdeteksi: "${entry.sourceSlotId}".`);
      }
      sourceSlotIds.add(entry.sourceSlotId);
    }

    const dateSessionKey = `${entry.date}:${entry.sessionId}`;
    if (usedDateSessions.has(dateSessionKey)) {
      errors.push(`Konflik: tanggal dan sesi "${dateSessionKey}" digunakan lebih dari satu kali.`);
    }
    usedDateSessions.add(dateSessionKey);

    if (entry.semesterPlanId !== data.semesterPlanId) {
      errors.push(`Entry semesterPlanId "${entry.semesterPlanId}" tidak cocok.`);
    }
    if (!entry.unitId) errors.push(`Entry meeting "${entry.meetingId}" tidak memiliki unitId.`);
    if (!entry.sessionId) errors.push(`Entry meeting "${entry.meetingId}" tidak memiliki sessionId.`);
    if (!entry.date || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
      errors.push(`Entry meeting "${entry.meetingId}" memiliki format tanggal tidak valid.`);
    }
    if (typeof entry.dayOfWeek !== 'number' || entry.dayOfWeek < 1 || entry.dayOfWeek > 6) {
      errors.push(`Entry meeting "${entry.meetingId}" memiliki dayOfWeek tidak valid (1-6).`);
    }
    if (typeof entry.jp !== 'number' || entry.jp <= 0) {
      errors.push(`Entry meeting "${entry.meetingId}" memiliki JP harus positif.`);
    }
    if (typeof entry.weekIndex !== 'number' || entry.weekIndex <= 0) {
      errors.push(`Entry meeting "${entry.meetingId}" memiliki weekIndex harus positif.`);
    }
    if (entry.mode !== 'AUTO' && entry.mode !== 'MANUAL_OVERRIDE') {
      errors.push(`Entry mode "${entry.mode}" tidak dikenal.`);
    }
  }

  const seenUnresolved = new Set<string>();
  for (const mId of (data.unresolvedMeetingIds || [])) {
    if (seenUnresolved.has(mId)) {
      errors.push(`Duplicate ID pada unresolvedMeetingIds: "${mId}".`);
    }
    seenUnresolved.add(mId);

    if (entryMeetingIds.has(mId)) {
      errors.push(`Meeting "${mId}" muncul di entries dan unresolvedMeetingIds sekaligus.`);
    }
    if (!canonicalMeetingIds.has(mId)) {
      errors.push(`Unresolved meeting ID "${mId}" bukan bagian dari semester ini.`);
    }
  }

  for (const cId of canonicalMeetingIds) {
    if (!entryMeetingIds.has(cId) && !seenUnresolved.has(cId)) {
      errors.push(`Meeting "${cId}" hilang dari entries dan unresolvedMeetingIds.`);
    }
  }

  const unresolvedCount = (data.unresolvedMeetingIds || []).length;
  if (data.status === 'COMPLETE' && unresolvedCount > 0) {
    errors.push('Status COMPLETE tidak valid karena masih terdapat unresolvedMeetingIds.');
  }
  if (data.status === 'DRAFT' && unresolvedCount === 0) {
    errors.push('Status DRAFT tidak valid karena seluruh pertemuan telah terselesaikan (unresolvedMeetingIds kosong).');
  }

  // 5. Auto resolver comparison & Manual Override validation
  const subjectSlotResult = resolveEffectiveSubjectSlots({
    semesterPlanId: data.semesterPlanId,
    schedule: subjectWeeklySchedule,
    expectedWeeklyJP,
    calendar,
    calendarDays,
    schoolDaysPerWeek: calendar.schoolDaysPerWeek,
  });

  if (!subjectSlotResult.isValid || !subjectSlotResult.isReady) {
    if (subjectSlotResult.errors && subjectSlotResult.errors.length > 0) {
      errors.push(...subjectSlotResult.errors);
    } else {
      errors.push('Resolver slot mata pelajaran belum valid atau belum siap.');
    }
    return {
      isValid: false,
      isStale,
      errors,
    };
  }

  const autoResult = resolveLearningMeetingSchedule({
    semesterPlanId: data.semesterPlanId,
    semester,
    mapping,
    unitExecutionPlan,
    subjectSlotResult,
  });

  if (!autoResult.isValid || !autoResult.isReady) {
    if (autoResult.errors && autoResult.errors.length > 0) {
      errors.push(...autoResult.errors);
    } else {
      errors.push('Resolver jadwal pertemuan otomatis belum valid atau belum siap.');
    }
    return {
      isValid: false,
      isStale,
      errors,
    };
  }

  const autoEntryMap = new Map((autoResult.scheduledEntries || []).map((e) => [e.meetingId, e]));
  const effectiveWeeks = getEffectiveWeeksList(calendar, calendarDays);
  const dayMap = new Map<string, CalendarDay>();
  (calendarDays || []).forEach((d) => {
    if (d && d.date) dayMap.set(d.date, d);
  });

  const sessionMap = new Map<string, number>();
  (subjectWeeklySchedule.sessions || []).forEach((s) => sessionMap.set(s.id, s.jp));

  for (const entry of (data.entries || [])) {
    if (entry.mode === 'AUTO') {
      const expectedAuto = autoEntryMap.get(entry.meetingId);
      if (!expectedAuto) {
        errors.push(`Entry AUTO "${entry.meetingId}" tidak ditemukan pada auto schedule result.`);
      } else {
        if (
          expectedAuto.date !== entry.date ||
          expectedAuto.sessionId !== entry.sessionId ||
          expectedAuto.dayOfWeek !== entry.dayOfWeek ||
          expectedAuto.jp !== entry.jp ||
          expectedAuto.sourceSlotId !== entry.sourceSlotId ||
          expectedAuto.unitId !== entry.unitId ||
          expectedAuto.weekIndex !== entry.weekIndex
        ) {
          errors.push(`Entry AUTO "${entry.meetingId}" tidak sesuai dengan slot otomatis terkini.`);
        }
      }
    } else if (entry.mode === 'MANUAL_OVERRIDE') {
      // Must have been in unscheduledMeetingIds
      if (!autoResult.unscheduledMeetingIds.includes(entry.meetingId)) {
        errors.push(`Meeting "${entry.meetingId}" tidak diizinkan manual override karena sudah memiliki slot otomatis.`);
      }

      // Check session
      const expectedJp = sessionMap.get(entry.sessionId);
      if (expectedJp === undefined) {
        errors.push(`Manual override sessionId "${entry.sessionId}" tidak ada pada subjectWeeklySchedule.`);
      } else if (entry.jp !== expectedJp) {
        errors.push(`Manual override JP (${entry.jp}) tidak sesuai dengan JP sesi (${expectedJp}).`);
      }

      // Check date bounds
      if (calendar.startDate && calendar.endDate) {
        if (entry.date < calendar.startDate || entry.date > calendar.endDate) {
          errors.push(`Tanggal manual "${entry.date}" di luar rentang kalender (${calendar.startDate} s.d. ${calendar.endDate}).`);
        }
      }

      // Check status of date
      const calDay = dayMap.get(entry.date);
      const dayStatus = normalizeCalendarDayStatus(calDay?.status);
      if (dayStatus !== 'EFFECTIVE_LEARNING') {
        errors.push(`Tanggal manual "${entry.date}" tidak valid karena status kalender adalah ${dayStatus} (bukan hari efektif).`);
      }

      // Check dayOfWeek
      const dParts = entry.date.split('-');
      const dObj = new Date(parseInt(dParts[0], 10), parseInt(dParts[1], 10) - 1, parseInt(dParts[2], 10));
      const jsDay = dObj.getDay();
      if (jsDay === 0) {
        errors.push(`Tanggal manual "${entry.date}" adalah hari Minggu.`);
      } else if (entry.dayOfWeek !== jsDay) {
        errors.push(`dayOfWeek manual "${entry.dayOfWeek}" tidak cocok dengan hari aktual (${jsDay}).`);
      }

      // Check weekIndex
      const wk = effectiveWeeks.find((w) => entry.date >= w.startDate && entry.date <= w.endDate);
      const expectedWk = wk ? wk.weekIndex : 1;
      if (entry.weekIndex !== expectedWk) {
        errors.push(`weekIndex manual "${entry.weekIndex}" tidak cocok dengan pekan kalender (${expectedWk}).`);
      }

      // Check expected sourceSlotId
      const expectedSlotId = `manual-slot:${data.semesterPlanId}:${entry.meetingId}:${entry.date}:${entry.sessionId}`;
      if (entry.sourceSlotId !== expectedSlotId) {
        errors.push(`sourceSlotId manual "${entry.sourceSlotId}" tidak sesuai standar.`);
      }
    }
  }

  // 6. Pedagogical / Chronological Order Check
  const canonicalMeetingOrderIndex = new Map<string, number>();
  canonicalMeetings.forEach((m, idx) => canonicalMeetingOrderIndex.set(m.meetingId, idx));

  const sortedEntriesByMeeting = [...(data.entries || [])].sort((a, b) => {
    const idxA = canonicalMeetingOrderIndex.get(a.meetingId) ?? 999;
    const idxB = canonicalMeetingOrderIndex.get(b.meetingId) ?? 999;
    return idxA - idxB;
  });

  for (let i = 1; i < sortedEntriesByMeeting.length; i++) {
    const prev = sortedEntriesByMeeting[i - 1];
    const curr = sortedEntriesByMeeting[i];
    if (curr.date < prev.date) {
      errors.push(
        `Pelanggaran urutan kronologis: Pertemuan berikutnya (${curr.meetingId}, tgl ${curr.date}) lebih awal dari pertemuan sebelumnya (${prev.meetingId}, tgl ${prev.date}).`
      );
      break;
    }
  }

  return {
    isValid: errors.length === 0,
    isStale,
    errors,
  };
}

/**
 * Builds canonical persisted LearningMeetingScheduleData combining AUTO and MANUAL entries.
 */
export function buildLearningMeetingScheduleData(params: {
  semesterPlanId: string;
  semester: 1 | 2;
  mapping: ATPUnitMappingData;
  unitExecutionPlan: UnitExecutionPlanData;
  subjectWeeklySchedule: SubjectWeeklySchedule;
  expectedWeeklyJP: number;
  calendar: AcademicCalendar;
  autoResult: LearningMeetingScheduleResult;
  manualOverrides: LearningMeetingScheduleEntry[];
  persistedId?: string;
}): LearningMeetingScheduleData {
  const {
    semesterPlanId,
    semester,
    mapping,
    unitExecutionPlan,
    subjectWeeklySchedule,
    expectedWeeklyJP,
    calendar,
    autoResult,
    manualOverrides,
    persistedId,
  } = params;

  // Resolve canonical meetings list
  const placement = resolveUnitSemesterPlacement(unitExecutionPlan, mapping);
  const targetUnitIds = new Set(semester === 1 ? placement.semester1UnitIds : placement.semester2UnitIds);
  const mappingUnitOrderMap = new Map<string, number>();
  (mapping.units || []).forEach((u) => mappingUnitOrderMap.set(u.id, u.order));

  const sortedUnits = (unitExecutionPlan.units || [])
    .filter((u) => targetUnitIds.has(u.unitId))
    .sort((a, b) => {
      const orderA = mappingUnitOrderMap.get(a.unitId) ?? 999;
      const orderB = mappingUnitOrderMap.get(b.unitId) ?? 999;
      return orderA - orderB;
    });

  const canonicalMeetings: Array<{ meetingId: string; unitId: string; order: number }> = [];
  for (const u of sortedUnits) {
    const sortedM = [...(u.meetings || [])].sort((a, b) => a.order - b.order);
    for (const m of sortedM) {
      canonicalMeetings.push({ meetingId: m.id, unitId: u.unitId, order: m.order });
    }
  }

  const canonicalOrderMap = new Map<string, number>();
  canonicalMeetings.forEach((m, idx) => canonicalOrderMap.set(m.meetingId, idx));

  // Combine AUTO entries + MANUAL overrides
  const manualMap = new Map<string, LearningMeetingScheduleEntry>();
  manualOverrides.forEach((m) => manualMap.set(m.meetingId, m));

  const combinedEntries: LearningMeetingScheduleEntry[] = [];

  for (const autoEntry of (autoResult.scheduledEntries || [])) {
    if (!manualMap.has(autoEntry.meetingId)) {
      combinedEntries.push(autoEntry);
    }
  }

  for (const manualEntry of manualOverrides) {
    combinedEntries.push(manualEntry);
  }

  // Sort combined entries following canonical meeting order
  combinedEntries.sort((a, b) => {
    const idxA = canonicalOrderMap.get(a.meetingId) ?? 999;
    const idxB = canonicalOrderMap.get(b.meetingId) ?? 999;
    return idxA - idxB;
  });

  const scheduledMeetingIds = new Set(combinedEntries.map((e) => e.meetingId));
  const unresolvedMeetingIds = canonicalMeetings
    .map((m) => m.meetingId)
    .filter((id) => !scheduledMeetingIds.has(id));

  const status = unresolvedMeetingIds.length === 0 ? 'COMPLETE' : 'DRAFT';
  const id = persistedId || `learning-meeting-schedule:${semesterPlanId}`;

  return {
    id,
    semesterPlanId,
    entries: combinedEntries,
    unresolvedMeetingIds,
    status,
    basedOnMappingUpdatedAt: mapping.updatedAt,
    basedOnUnitExecutionPlanUpdatedAt: unitExecutionPlan.updatedAt,
    basedOnSubjectWeeklyScheduleUpdatedAt: subjectWeeklySchedule.updatedAt,
    basedOnCalendarUpdatedAt: calendar.updatedAt,
    basedOnWeeklyJP: expectedWeeklyJP,
    updatedAt: new Date().toISOString(),
  };
}

export interface ExactScheduleReadinessResult {
  isReady: boolean;
  isStale: boolean;
  errors: string[];
}

/**
 * Checks whether persisted LearningMeetingScheduleData for a semester is complete and valid:
 * - data exists
 * - status === 'COMPLETE'
 * - unresolvedMeetingIds.length === 0
 * - not stale relative to mapping, UnitExecutionPlan, SubjectWeeklySchedule, calendar, current weekly JP
 * - passes validateLearningMeetingScheduleData()
 */
export function isLearningMeetingScheduleReady(params: {
  schedule: LearningMeetingScheduleData | null | undefined;
  semester: 1 | 2;
  mapping: ATPUnitMappingData | null | undefined;
  unitExecutionPlan: UnitExecutionPlanData | null | undefined;
  subjectWeeklySchedule: SubjectWeeklySchedule | null | undefined;
  expectedWeeklyJP: number | null | undefined;
  calendar: AcademicCalendar | null | undefined;
  calendarDays?: CalendarDay[];
}): ExactScheduleReadinessResult {
  const {
    schedule,
    semester,
    mapping,
    unitExecutionPlan,
    subjectWeeklySchedule,
    expectedWeeklyJP,
    calendar,
    calendarDays = [],
  } = params;

  if (!schedule) {
    return {
      isReady: false,
      isStale: false,
      errors: ['Jadwal pertemuan belum disusun atau disimpan.'],
    };
  }

  if (schedule.status !== 'COMPLETE') {
    return {
      isReady: false,
      isStale: false,
      errors: ['Status jadwal belum COMPLETE.'],
    };
  }

  if (!Array.isArray(schedule.unresolvedMeetingIds) || schedule.unresolvedMeetingIds.length > 0) {
    return {
      isReady: false,
      isStale: false,
      errors: ['Masih terdapat pertemuan yang belum terjadwal (unresolvedMeetingIds > 0).'],
    };
  }

  if (
    !mapping ||
    !unitExecutionPlan ||
    !subjectWeeklySchedule ||
    !expectedWeeklyJP ||
    expectedWeeklyJP <= 0 ||
    !calendar
  ) {
    return {
      isReady: false,
      isStale: false,
      errors: ['Prasyarat validasi jadwal belum lengkap (mapping, plan, jadwal mingguan, kalender, atau JP).'],
    };
  }

  const validation = validateLearningMeetingScheduleData({
    data: schedule,
    semester,
    mapping,
    unitExecutionPlan,
    subjectWeeklySchedule,
    expectedWeeklyJP,
    calendar,
    calendarDays,
  });

  return {
    isReady: validation.isValid && !validation.isStale,
    isStale: validation.isStale,
    errors: validation.errors,
  };
}
