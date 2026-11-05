import {
  SubjectWeeklySchedule,
  AcademicCalendar,
  CalendarDay,
  SubjectScheduleDay,
} from '../types';
import { getEffectiveWeeksList, normalizeCalendarDayStatus, validateCalendarCompleteness } from './jpEngine';

export interface SubjectScheduleValidationResult {
  isValid: boolean;
  isComplete: boolean;
  isStale: boolean;
  totalWeeklyJP: number;
  errors: string[];
  warnings: string[];
}

export interface EffectiveSubjectSlot {
  id: string;
  semesterPlanId: string;
  sessionId: string;
  date: string; // YYYY-MM-DD
  dayOfWeek: 1 | 2 | 3 | 4 | 5 | 6;
  jp: number;
  weekIndex: number;
  month: number;
  year: number;
  sessionOrder?: number;
}

export interface ExcludedSubjectOccurrence {
  sessionId: string;
  date: string;
  dayOfWeek: 1 | 2 | 3 | 4 | 5 | 6;
  jp: number;
  reason: string;
}

export interface EffectiveSubjectSlotResult {
  isValid: boolean;
  isComplete: boolean;
  isReady: boolean;
  isStale: boolean;

  errors: string[];
  warnings: string[];

  slots: EffectiveSubjectSlot[];
  excludedOccurrences: ExcludedSubjectOccurrence[];

  totalMeetingSlots: number;
  totalJP: number;
  totalExcludedOccurrences: number;
}

export interface PlannedMeetingCapacityResult {
  isReady: boolean;
  isValid: boolean;
  isComplete: boolean;
  isStale: boolean;
  errors: string[];
  warnings: string[];
  meetingsPerWeek: number;
  effectiveWeekSlots: number;
  totalMeetingCapacity: number;
  totalJP: number;
  capacitySource: 'ACTUAL_SLOTS' | 'ESTIMATE';
  calendarLostJP?: number;
  totalExcludedOccurrences?: number;
}

/** Final Step 08 gate only. isReady itself continues to support estimate previews/drafts. */
export function isActualPlannedCapacityReady(capacity: PlannedMeetingCapacityResult): boolean {
  return capacity.capacitySource === 'ACTUAL_SLOTS' && capacity.isReady && capacity.isValid &&
    capacity.isComplete && !capacity.isStale && Number.isFinite(capacity.totalJP) && capacity.totalJP > 0;
}

/**
 * Validates a SubjectWeeklySchedule against expected weekly JP.
 * Supports multi-session patterns (1-3+ sessions per week) with individual JP and deterministic order.
 */
export function validateSubjectWeeklySchedule(
  schedule: SubjectWeeklySchedule | undefined,
  expectedWeeklyJP: number | null,
  schoolDaysPerWeek?: number | null
): SubjectScheduleValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!schedule) {
    return {
      isValid: true,
      isComplete: false,
      isStale: false,
      totalWeeklyJP: 0,
      errors: [],
      warnings: [],
    };
  }

  if (expectedWeeklyJP === null || !Number.isFinite(expectedWeeklyJP) || expectedWeeklyJP <= 0) {
    errors.push('JP mingguan canonical belum ditentukan atau bernilai 0.');
    return {
      isValid: false,
      isComplete: false,
      isStale: false,
      totalWeeklyJP: 0,
      errors,
      warnings,
    };
  }

  const isStale = schedule.basedOnWeeklyJP !== expectedWeeklyJP;
  if (isStale) {
    errors.push(`Pola jadwal stale: basedOnWeeklyJP (${schedule.basedOnWeeklyJP}) tidak cocok dengan JP mingguan saat ini (${expectedWeeklyJP}).`);
  }

  const sessions = schedule.sessions || [];
  if (sessions.length === 0) {
    errors.push('Pola jadwal belum memiliki sesi.');
  }

  const sessionIds = new Set<string>();
  const orders = new Set<number>();
  let totalWeeklyJP = 0;
  const maxDay = schoolDaysPerWeek === 6 ? 6 : 5;

  for (const s of sessions) {
    if (!s.id || !s.id.trim()) {
      errors.push('ID sesi tidak boleh kosong.');
    } else if (sessionIds.has(s.id)) {
      errors.push(`ID sesi duplikat: ${s.id}`);
    } else {
      sessionIds.add(s.id);
    }

    if (typeof s.jp !== 'number' || s.jp <= 0 || !Number.isInteger(s.jp)) {
      errors.push(`Jumlah JP untuk sesi ${s.id} harus berupa integer positif.`);
    } else {
      totalWeeklyJP += s.jp;
    }

    if (typeof s.order !== 'number' || s.order <= 0 || !Number.isInteger(s.order)) {
      errors.push(`Order sesi tidak valid untuk sesi ${s.id}.`);
    } else if (orders.has(s.order)) {
      errors.push(`Order sesi duplikat: ${s.order}`);
    } else {
      orders.add(s.order);
    }

    if (s.dayOfWeek !== undefined && s.dayOfWeek !== null && (schoolDaysPerWeek === 5 || schoolDaysPerWeek === 6)) {
      if (!Number.isInteger(s.dayOfWeek) || s.dayOfWeek < 1 || s.dayOfWeek > maxDay) {
        errors.push(`Hari mengajar sesi ${s.id} (${s.dayOfWeek}) di luar batas hari sekolah (${maxDay} hari/minggu).`);
      }
    }
  }

  if (totalWeeklyJP !== expectedWeeklyJP) {
    errors.push(`Total JP sesi (${totalWeeklyJP} JP) tidak sama dengan JP mingguan canonical (${expectedWeeklyJP} JP).`);
  }

  const isValid = errors.filter((e) => !e.includes('stale')).length === 0;
  const isComplete = !isStale && errors.length === 0 && sessions.length > 0 && totalWeeklyJP === expectedWeeklyJP;

  return {
    isValid,
    isComplete,
    isStale,
    totalWeeklyJP,
    errors,
    warnings,
  };
}

/**
 * Resolves planned meeting capacity.
 * When calendar and teaching days (hari mengajar) are confirmed, it uses resolveEffectiveSubjectSlots
 * as the final authoritative capacity (ACTUAL_SLOTS).
 * Otherwise, it retains the effective weeks estimate (ESTIMATE).
 */
export function resolvePlannedMeetingCapacity(params: {
  schedule?: SubjectWeeklySchedule;
  expectedWeeklyJP: number | null;
  calendarConfirmed: boolean;
  effectiveWeekSlots: number;
  calendar?: AcademicCalendar;
  calendarDays?: CalendarDay[];
  semesterPlanId?: string;
  schoolDaysPerWeek?: number | null;
}): PlannedMeetingCapacityResult {
  const {
    schedule,
    expectedWeeklyJP,
    calendarConfirmed,
    effectiveWeekSlots,
    calendar,
    calendarDays,
    semesterPlanId,
    schoolDaysPerWeek,
  } = params;

  const schoolDays = calendar?.schoolDaysPerWeek ?? schoolDaysPerWeek ?? null;
  const validation = validateSubjectWeeklySchedule(schedule, expectedWeeklyJP, schoolDays);

  const meetingsPerWeek = schedule?.sessions ? schedule.sessions.length : 0;
  const estimatedMeetings = effectiveWeekSlots * meetingsPerWeek;
  const estimatedJP = effectiveWeekSlots * (expectedWeeklyJP || 0);

  const maxDay = schoolDays === 6 ? 6 : 5;
  const hasConfirmedTeachingDays = Boolean(
    schedule &&
    schedule.sessions &&
    schedule.sessions.length > 0 &&
    schedule.sessions.every(
      (s) => typeof s.dayOfWeek === 'number' && s.dayOfWeek >= 1 && s.dayOfWeek <= maxDay
    )
  );

  const canUseActualSlots = Boolean(
    hasConfirmedTeachingDays &&
    calendarConfirmed &&
    calendar &&
    calendar.startDate &&
    calendar.endDate &&
    Array.isArray(calendarDays) &&
    calendarDays.length > 0
  );

  if (canUseActualSlots) {
    const effectivePlanId = semesterPlanId || schedule?.semesterPlanId || '';
    const slotsResult = resolveEffectiveSubjectSlots({
      semesterPlanId: effectivePlanId,
      schedule,
      expectedWeeklyJP,
      calendar,
      calendarDays,
      schoolDaysPerWeek: schoolDays,
    });

    if (slotsResult.isReady) {
      const calendarLostJP = slotsResult.excludedOccurrences.reduce((sum, o) => sum + (o.jp || 0), 0);
      return {
        isReady: true,
        isValid: slotsResult.isValid,
        isComplete: slotsResult.isComplete,
        isStale: slotsResult.isStale,
        errors: slotsResult.errors,
        warnings: slotsResult.warnings,
        meetingsPerWeek,
        effectiveWeekSlots,
        totalMeetingCapacity: slotsResult.totalMeetingSlots,
        totalJP: slotsResult.totalJP,
        capacitySource: 'ACTUAL_SLOTS',
        calendarLostJP,
        totalExcludedOccurrences: slotsResult.totalExcludedOccurrences,
      };
    }

    return {
      isReady: false,
      isValid: slotsResult.isValid,
      isComplete: false,
      isStale: slotsResult.isStale,
      errors: slotsResult.errors.length > 0 ? slotsResult.errors : ['Kalender pendidikan atau jadwal sesi belum siap untuk menghasilkan slot aktual.'],
      warnings: slotsResult.warnings,
      meetingsPerWeek,
      effectiveWeekSlots,
      totalMeetingCapacity: slotsResult.totalMeetingSlots,
      totalJP: slotsResult.totalJP,
      capacitySource: 'ACTUAL_SLOTS',
      calendarLostJP: 0,
      totalExcludedOccurrences: slotsResult.totalExcludedOccurrences,
    };
  }

  // Fallback to ESTIMATE when teaching days are not yet allocated or calendar is unconfirmed
  const isReady = Boolean(
    validation.isComplete &&
    !validation.isStale &&
    calendarConfirmed &&
    effectiveWeekSlots > 0 &&
    expectedWeeklyJP &&
    expectedWeeklyJP > 0
  );

  return {
    isReady,
    isValid: validation.isValid,
    isComplete: validation.isComplete,
    isStale: validation.isStale,
    errors: validation.errors,
    warnings: validation.warnings,
    meetingsPerWeek,
    effectiveWeekSlots,
    totalMeetingCapacity: estimatedMeetings,
    totalJP: estimatedJP,
    capacitySource: 'ESTIMATE',
    calendarLostJP: 0,
    totalExcludedOccurrences: 0,
  };
}

/**
 * Resolves effective subject slots from schedule and academic calendar.
 * If sessions don't have valid days of the week, it gracefully returns not ready.
 */
export function resolveEffectiveSubjectSlots(params: {
  semesterPlanId: string;
  schedule?: SubjectWeeklySchedule;
  expectedWeeklyJP: number | null;
  calendar?: AcademicCalendar;
  calendarDays?: CalendarDay[];
  schoolDaysPerWeek?: number | null;
}): EffectiveSubjectSlotResult {
  const { semesterPlanId, schedule, expectedWeeklyJP, calendar, calendarDays = [], schoolDaysPerWeek } = params;

  const validation = validateSubjectWeeklySchedule(schedule, expectedWeeklyJP, calendar?.schoolDaysPerWeek ?? schoolDaysPerWeek);

  const slots: EffectiveSubjectSlot[] = [];
  const excludedOccurrences: ExcludedSubjectOccurrence[] = [];

  const calendarReady = Boolean(
    calendar &&
    calendar.startDate &&
    calendar.endDate &&
    (calendar.schoolDaysPerWeek === 5 || calendar.schoolDaysPerWeek === 6) &&
    calendar.workflowStatus === 'CONFIRMED' &&
    Array.isArray(calendarDays) &&
    calendarDays.length > 0
  );

  const maxDay = (calendar?.schoolDaysPerWeek === 6 || schoolDaysPerWeek === 6) ? 6 : 5;
  const hasInvalidDayOfWeek = !schedule || schedule.sessions.some(s => !s.dayOfWeek || typeof s.dayOfWeek !== 'number' || s.dayOfWeek < 1 || s.dayOfWeek > maxDay);

  if (hasInvalidDayOfWeek) {
    return {
      isValid: validation.isValid,
      isComplete: validation.isComplete,
      isReady: false,
      isStale: validation.isStale,
      errors: [...validation.errors, `Hari mengajar belum dialokasikan untuk seluruh sesi sesuai kalender sekolah (${maxDay} hari/minggu). Slot tanggal aktual ditentukan pada tahap Alokasi Waktu.`],
      warnings: validation.warnings,
      slots: [],
      excludedOccurrences: [],
      totalMeetingSlots: 0,
      totalJP: 0,
      totalExcludedOccurrences: 0,
    };
  }

  const completeness = calendar ? validateCalendarCompleteness(calendar, calendarDays) : null;
  const calendarComplete = completeness ? completeness.complete : false;
  const schoolWeekValid = !schedule?.sessions.some(s => s.dayOfWeek && s.dayOfWeek > maxDay);
  const completenessErrors: string[] = [];
  if (completeness && !completeness.complete) {
    completenessErrors.push(completeness.diagnostic || 'Kalender pendidikan belum lengkap untuk seluruh hari sekolah.');
  }
  if (!schoolWeekValid) {
    completenessErrors.push(`Terdapat sesi pada hari di luar jadwal sekolah (${maxDay} hari/minggu).`);
  }
  const isReady = validation.isComplete && calendarReady && calendarComplete && schoolWeekValid;

  if (!isReady || !schedule || !calendar) {
    return {
      isValid: validation.isValid,
      isComplete: validation.isComplete,
      isReady: false,
      isStale: validation.isStale,
      errors: [...validation.errors, ...completenessErrors],
      warnings: validation.warnings,
      slots: [],
      excludedOccurrences: [],
      totalMeetingSlots: 0,
      totalJP: 0,
      totalExcludedOccurrences: 0,
    };
  }

  const dayMap = new Map<string, CalendarDay>();
  calendarDays.forEach((d) => {
    if (d && d.date) dayMap.set(d.date, d);
  });

  const [sy, sm, sd] = calendar.startDate.split('-').map(Number);
  const [ey, em, ed] = calendar.endDate.split('-').map(Number);
  const currentDate = new Date(sy, sm - 1, sd, 12, 0, 0);
  const endDateTime = new Date(ey, em - 1, ed, 12, 0, 0);

  if (isNaN(currentDate.getTime()) || isNaN(endDateTime.getTime())) {
    return {
      ...validation,
      isReady: false,
      errors: [...validation.errors, 'Tanggal mulai atau selesai kalender tidak valid.'],
      slots: [],
      excludedOccurrences: [],
      totalMeetingSlots: 0,
      totalJP: 0,
      totalExcludedOccurrences: 0,
    };
  }

  const effectiveWeeks = getEffectiveWeeksList(calendar, calendarDays);

  while (currentDate <= endDateTime) {
    const yyyy = currentDate.getFullYear();
    const mm = String(currentDate.getMonth() + 1).padStart(2, '0');
    const dd = String(currentDate.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;

    const dayOfWeekJs = currentDate.getDay(); // 0 = Sunday, 1 = Monday ... 6 = Saturday
    const dayOfWeek: 1 | 2 | 3 | 4 | 5 | 6 = dayOfWeekJs === 0 ? 7 : (dayOfWeekJs as any);

    const sessionsOnThisDay = (dayOfWeek >= 1 && dayOfWeek <= 6)
      ? schedule.sessions
          .filter((s) => s.dayOfWeek === dayOfWeek)
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id))
      : [];

    if (sessionsOnThisDay.length === 0) {
      currentDate.setDate(currentDate.getDate() + 1);
      continue;
    }

    const calDay = dayMap.get(dateStr);
    const canonicalStatus = normalizeCalendarDayStatus(calDay?.status);

    if (canonicalStatus === 'UNKNOWN') {
      return {
        isValid: validation.isValid,
        isComplete: validation.isComplete,
        isReady: false,
        isStale: validation.isStale,
        errors: [...validation.errors, `Kalender memiliki status UNKNOWN atau belum lengkap pada tanggal ${dateStr}.`],
        warnings: validation.warnings,
        slots: [],
        excludedOccurrences: [],
        totalMeetingSlots: 0,
        totalJP: 0,
        totalExcludedOccurrences: 0,
      };
    }

    const weekInfo = effectiveWeeks.find((wk) => dateStr >= wk.startDate && dateStr <= wk.endDate);
    const weekIndex = weekInfo ? weekInfo.weekIndex : 1;
    const month = currentDate.getMonth() + 1;
    const year = currentDate.getFullYear();

    if (canonicalStatus === 'EFFECTIVE_LEARNING') {
      for (const s of sessionsOnThisDay) {
        slots.push({
          id: `subject-slot:${semesterPlanId}:${s.id}:${dateStr}`,
          semesterPlanId,
          sessionId: s.id,
          date: dateStr,
          dayOfWeek,
          jp: s.jp || 0,
          weekIndex,
          month,
          year,
          sessionOrder: s.order,
        });
      }
    } else if (
      canonicalStatus === 'HOLIDAY' ||
      canonicalStatus === 'BREAK' ||
      canonicalStatus === 'NON_LEARNING' ||
      canonicalStatus === 'SCHOOL_EVENT' ||
      canonicalStatus === 'ASSESSMENT'
    ) {
      for (const s of sessionsOnThisDay) {
        excludedOccurrences.push({
          sessionId: s.id,
          date: dateStr,
          dayOfWeek,
          jp: s.jp || 0,
          reason: canonicalStatus,
        });
      }
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }

  const totalMeetingSlots = slots.length;
  const totalJP = slots.reduce((sum, s) => sum + s.jp, 0);
  const totalExcludedOccurrences = excludedOccurrences.length;

  return {
    isValid: validation.isValid,
    isComplete: validation.isComplete,
    isReady: true,
    isStale: validation.isStale,
    errors: validation.errors,
    warnings: validation.warnings,
    slots,
    excludedOccurrences,
    totalMeetingSlots,
    totalJP,
    totalExcludedOccurrences,
  };
}
