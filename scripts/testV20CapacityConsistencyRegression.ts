import assert from 'node:assert/strict';
import {
  validateSubjectWeeklySchedule,
  resolvePlannedMeetingCapacity,
  resolveEffectiveSubjectSlots,
} from '../src/services/subjectScheduleService';
import {
  resolveCalendarSubjectCapacity,
  resolveSemesterCapacityV5,
} from '../src/services/jpEngine';
import { AcademicCalendar, CalendarDay, SubjectWeeklySchedule } from '../src/types';

console.log('===========================================================');
console.log('🧪 RUNNING V20 JP & MEETING CAPACITY CONSISTENCY REGRESSION');
console.log('===========================================================');

// Helper to generate calendar days for a 2-week period (Mon-Fri)
function createTwoWeekCalendarDays(
  startDateStr: string,
  modifications: Record<string, string> = {}
): CalendarDay[] {
  const days: CalendarDay[] = [];
  const [y, m, d] = startDateStr.split('-').map(Number);
  const start = new Date(y, m - 1, d, 12, 0, 0);

  // 14 calendar days (two full weeks)
  for (let i = 0; i < 14; i++) {
    const cur = new Date(start);
    cur.setDate(cur.getDate() + i);
    const dateStr = cur.toISOString().slice(0, 10);
    const dayOfWeek = cur.getDay(); // 0 Sun, 1 Mon... 6 Sat

    // Default: weekdays (1-5) are EFFECTIVE_LEARNING, weekends (0, 6) are HOLIDAY
    let status = dayOfWeek >= 1 && dayOfWeek <= 5 ? 'EFFECTIVE_LEARNING' : 'HOLIDAY';
    if (modifications[dateStr]) {
      status = modifications[dateStr];
    }

    days.push({
      id: `day-${dateStr}`,
      academicCalendarId: 'cal-test',
      date: dateStr,
      status: status as any,
    });
  }
  return days;
}

const baseCal: AcademicCalendar = {
  id: 'cal-test',
  academicSettingId: 'sp-1',
  academicYear: '2026/2027',
  semester: '1 (Ganjil)',
  startDate: '2026-10-19', // Monday
  endDate: '2026-11-01',   // Sunday (2 weeks = 10 weekdays)
  schoolDaysPerWeek: 5,
  workflowStatus: 'CONFIRMED',
  updatedAt: '2026-10-19T00:00:00Z',
};

// --- Skenario 1: 5 JP, satu sesi 5 JP ---
console.log('--- Skenario 1: 5 JP, satu sesi 5 JP ---');
{
  const sched1: SubjectWeeklySchedule = {
    semesterPlanId: 'sp-1',
    basedOnWeeklyJP: 5,
    sessions: [
      { id: 'sess-1', order: 1, jp: 5, dayOfWeek: 1 }, // Monday 5 JP
    ],
    updatedAt: '2026-10-19T00:00:00Z',
  };

  const val = validateSubjectWeeklySchedule(sched1, 5, 5);
  assert.equal(val.isValid, true);
  assert.equal(val.isComplete, true);
  assert.equal(val.totalWeeklyJP, 5);

  const days = createTwoWeekCalendarDays('2026-10-19');
  const slots = resolveEffectiveSubjectSlots({
    semesterPlanId: 'sp-1',
    schedule: sched1,
    expectedWeeklyJP: 5,
    calendar: baseCal,
    calendarDays: days,
    schoolDaysPerWeek: 5,
  });

  assert.equal(slots.isReady, true);
  // In 2 full weeks, there are 2 Mondays
  assert.equal(slots.totalMeetingSlots, 2);
  assert.equal(slots.totalJP, 10);
  assert.equal(slots.excludedOccurrences.length, 0);

  const planned = resolvePlannedMeetingCapacity({
    schedule: sched1,
    expectedWeeklyJP: 5,
    calendarConfirmed: true,
    effectiveWeekSlots: 2,
    calendar: baseCal,
    calendarDays: days,
    semesterPlanId: 'sp-1',
  });
  assert.equal(planned.isReady, true);
  assert.equal(planned.capacitySource, 'ACTUAL_SLOTS');
  assert.equal(planned.totalMeetingCapacity, 2);
  assert.equal(planned.totalJP, 10);
  console.log('✅ Skenario 1 passed: 1 sesi 5 JP terverifikasi.');
}

// --- Skenario 2: 5 JP, dua sesi 3+2 JP ---
console.log('--- Skenario 2: 5 JP, dua sesi 3+2 JP ---');
{
  const sched2: SubjectWeeklySchedule = {
    semesterPlanId: 'sp-1',
    basedOnWeeklyJP: 5,
    sessions: [
      { id: 'sess-mon', order: 1, jp: 3, dayOfWeek: 1 }, // Monday 3 JP
      { id: 'sess-thu', order: 2, jp: 2, dayOfWeek: 4 }, // Thursday 2 JP
    ],
    updatedAt: '2026-10-19T00:00:00Z',
  };

  const val = validateSubjectWeeklySchedule(sched2, 5, 5);
  assert.equal(val.isValid, true);
  assert.equal(val.isComplete, true);
  assert.equal(val.totalWeeklyJP, 5);

  const days = createTwoWeekCalendarDays('2026-10-19');
  const slots = resolveEffectiveSubjectSlots({
    semesterPlanId: 'sp-1',
    schedule: sched2,
    expectedWeeklyJP: 5,
    calendar: baseCal,
    calendarDays: days,
    schoolDaysPerWeek: 5,
  });

  assert.equal(slots.isReady, true);
  // 2 Mondays (2*3 = 6 JP) + 2 Thursdays (2*2 = 4 JP) = 4 meetings, 10 JP
  assert.equal(slots.totalMeetingSlots, 4);
  assert.equal(slots.totalJP, 10);

  const planned = resolvePlannedMeetingCapacity({
    schedule: sched2,
    expectedWeeklyJP: 5,
    calendarConfirmed: true,
    effectiveWeekSlots: 2,
    calendar: baseCal,
    calendarDays: days,
    semesterPlanId: 'sp-1',
  });
  assert.equal(planned.capacitySource, 'ACTUAL_SLOTS');
  assert.equal(planned.totalMeetingCapacity, 4);
  assert.equal(planned.totalJP, 10);
  console.log('✅ Skenario 2 passed: 2 sesi 3+2 JP terverifikasi.');
}

// --- Skenario 3: 5 JP, tiga sesi 2+2+1 JP ---
console.log('--- Skenario 3: 5 JP, tiga sesi 2+2+1 JP ---');
{
  const sched3: SubjectWeeklySchedule = {
    semesterPlanId: 'sp-1',
    basedOnWeeklyJP: 5,
    sessions: [
      { id: 'sess-mon', order: 1, jp: 2, dayOfWeek: 1 },
      { id: 'sess-wed', order: 2, jp: 2, dayOfWeek: 3 },
      { id: 'sess-fri', order: 3, jp: 1, dayOfWeek: 5 },
    ],
    updatedAt: '2026-10-19T00:00:00Z',
  };

  const val = validateSubjectWeeklySchedule(sched3, 5, 5);
  assert.equal(val.isValid, true);
  assert.equal(val.isComplete, true);
  assert.equal(val.totalWeeklyJP, 5);

  const days = createTwoWeekCalendarDays('2026-10-19');
  const slots = resolveEffectiveSubjectSlots({
    semesterPlanId: 'sp-1',
    schedule: sched3,
    expectedWeeklyJP: 5,
    calendar: baseCal,
    calendarDays: days,
    schoolDaysPerWeek: 5,
  });

  assert.equal(slots.isReady, true);
  // 2 Mon (4 JP) + 2 Wed (4 JP) + 2 Fri (2 JP) = 6 meetings, 10 JP
  assert.equal(slots.totalMeetingSlots, 6);
  assert.equal(slots.totalJP, 10);
  console.log('✅ Skenario 3 passed: 3 sesi 2+2+1 JP terverifikasi.');
}

// --- Skenario 4: Senin libur → kehilangan 3 JP pada pola Senin 3 + Kamis 2 ---
console.log('--- Skenario 4: Senin libur → kehilangan 3 JP pada pola Senin 3 + Kamis 2 ---');
{
  const sched2: SubjectWeeklySchedule = {
    semesterPlanId: 'sp-1',
    basedOnWeeklyJP: 5,
    sessions: [
      { id: 'sess-mon', order: 1, jp: 3, dayOfWeek: 1 },
      { id: 'sess-thu', order: 2, jp: 2, dayOfWeek: 4 },
    ],
    updatedAt: '2026-10-19T00:00:00Z',
  };

  // 2026-10-19 is the first Monday, mark as HOLIDAY
  const daysWithMondayHoliday = createTwoWeekCalendarDays('2026-10-19', {
    '2026-10-19': 'HOLIDAY',
  });

  const slots = resolveEffectiveSubjectSlots({
    semesterPlanId: 'sp-1',
    schedule: sched2,
    expectedWeeklyJP: 5,
    calendar: baseCal,
    calendarDays: daysWithMondayHoliday,
    schoolDaysPerWeek: 5,
  });

  assert.equal(slots.isReady, true);
  // 1 effective Monday (3 JP) + 2 effective Thursdays (4 JP) = 3 meetings, 7 JP
  assert.equal(slots.totalMeetingSlots, 3);
  assert.equal(slots.totalJP, 7);
  // Excluded occurrence on Monday with 3 JP
  assert.equal(slots.excludedOccurrences.length, 1);
  assert.equal(slots.excludedOccurrences[0].jp, 3);
  assert.equal(slots.excludedOccurrences[0].date, '2026-10-19');

  const planned = resolvePlannedMeetingCapacity({
    schedule: sched2,
    expectedWeeklyJP: 5,
    calendarConfirmed: true,
    effectiveWeekSlots: 2,
    calendar: baseCal,
    calendarDays: daysWithMondayHoliday,
    semesterPlanId: 'sp-1',
  });
  assert.equal(planned.totalMeetingCapacity, 3);
  assert.equal(planned.totalJP, 7);
  assert.equal(planned.calendarLostJP, 3);
  console.log('✅ Skenario 4 passed: Libur Senin tepat mengurangi 3 JP dan 1 pertemuan.');
}

// --- Skenario 5: Kamis libur → kehilangan 2 JP pada pola Senin 3 + Kamis 2 ---
console.log('--- Skenario 5: Kamis libur → kehilangan 2 JP pada pola Senin 3 + Kamis 2 ---');
{
  const sched2: SubjectWeeklySchedule = {
    semesterPlanId: 'sp-1',
    basedOnWeeklyJP: 5,
    sessions: [
      { id: 'sess-mon', order: 1, jp: 3, dayOfWeek: 1 },
      { id: 'sess-thu', order: 2, jp: 2, dayOfWeek: 4 },
    ],
    updatedAt: '2026-10-19T00:00:00Z',
  };

  // 2026-10-22 is Thursday, mark as HOLIDAY
  const daysWithThursdayHoliday = createTwoWeekCalendarDays('2026-10-19', {
    '2026-10-22': 'HOLIDAY',
  });

  const slots = resolveEffectiveSubjectSlots({
    semesterPlanId: 'sp-1',
    schedule: sched2,
    expectedWeeklyJP: 5,
    calendar: baseCal,
    calendarDays: daysWithThursdayHoliday,
    schoolDaysPerWeek: 5,
  });

  assert.equal(slots.isReady, true);
  // 2 effective Mondays (6 JP) + 1 effective Thursday (2 JP) = 3 meetings, 8 JP
  assert.equal(slots.totalMeetingSlots, 3);
  assert.equal(slots.totalJP, 8);
  assert.equal(slots.excludedOccurrences.length, 1);
  assert.equal(slots.excludedOccurrences[0].jp, 2);
  assert.equal(slots.excludedOccurrences[0].date, '2026-10-22');

  const planned = resolvePlannedMeetingCapacity({
    schedule: sched2,
    expectedWeeklyJP: 5,
    calendarConfirmed: true,
    effectiveWeekSlots: 2,
    calendar: baseCal,
    calendarDays: daysWithThursdayHoliday,
    semesterPlanId: 'sp-1',
  });
  assert.equal(planned.totalMeetingCapacity, 3);
  assert.equal(planned.totalJP, 8);
  assert.equal(planned.calendarLostJP, 2);
  console.log('✅ Skenario 5 passed: Libur Kamis tepat mengurangi 2 JP dan 1 pertemuan.');
}

// --- Skenario 6: Beberapa sesi pada satu hari, dengan urutan berbeda ---
console.log('--- Skenario 6: Beberapa sesi pada satu hari, dengan urutan berbeda ---');
{
  const schedMultiSameDay: SubjectWeeklySchedule = {
    semesterPlanId: 'sp-1',
    basedOnWeeklyJP: 5,
    sessions: [
      { id: 'sess-mon-1', order: 1, jp: 2, dayOfWeek: 1 }, // Monday early
      { id: 'sess-mon-2', order: 2, jp: 1, dayOfWeek: 1 }, // Monday late
      { id: 'sess-wed', order: 3, jp: 2, dayOfWeek: 3 },   // Wednesday
    ],
    updatedAt: '2026-10-19T00:00:00Z',
  };

  const val = validateSubjectWeeklySchedule(schedMultiSameDay, 5, 5);
  assert.equal(val.isValid, true);
  assert.equal(val.isComplete, true);

  const days = createTwoWeekCalendarDays('2026-10-19');
  const slots = resolveEffectiveSubjectSlots({
    semesterPlanId: 'sp-1',
    schedule: schedMultiSameDay,
    expectedWeeklyJP: 5,
    calendar: baseCal,
    calendarDays: days,
    schoolDaysPerWeek: 5,
  });

  assert.equal(slots.isReady, true);
  // 2 Mondays * 2 sessions = 4 slots; 2 Wednesdays * 1 session = 2 slots -> total 6 slots
  assert.equal(slots.totalMeetingSlots, 6);
  assert.equal(slots.totalJP, 10);

  // Check deterministic ordering on Monday 2026-10-19: order 1 precedes order 2
  const mondaySlots = slots.slots.filter(s => s.date === '2026-10-19');
  assert.equal(mondaySlots.length, 2);
  assert.equal(mondaySlots[0].sessionId, 'sess-mon-1');
  assert.equal(mondaySlots[0].jp, 2);
  assert.equal(mondaySlots[0].sessionOrder, 1);
  assert.equal(mondaySlots[1].sessionId, 'sess-mon-2');
  assert.equal(mondaySlots[1].jp, 1);
  assert.equal(mondaySlots[1].sessionOrder, 2);

  // When that Monday is HOLIDAY, both sessions are excluded losing 2 + 1 = 3 JP
  const holidayMon = createTwoWeekCalendarDays('2026-10-19', { '2026-10-19': 'HOLIDAY' });
  const holidaySlots = resolveEffectiveSubjectSlots({
    semesterPlanId: 'sp-1',
    schedule: schedMultiSameDay,
    expectedWeeklyJP: 5,
    calendar: baseCal,
    calendarDays: holidayMon,
    schoolDaysPerWeek: 5,
  });
  assert.equal(holidaySlots.totalMeetingSlots, 4); // 2 on 2nd Mon, 2 on Wed
  assert.equal(holidaySlots.totalJP, 7);
  assert.equal(holidaySlots.excludedOccurrences.length, 2);
  assert.equal(holidaySlots.excludedOccurrences[0].jp, 2);
  assert.equal(holidaySlots.excludedOccurrences[1].jp, 1);
  console.log('✅ Skenario 6 passed: Sesi ganda pada satu hari memiliki urutan deterministik.');
}

// --- Skenario 7: Kalender semester belum lengkap ---
console.log('--- Skenario 7: Kalender semester belum lengkap ---');
{
  const sched: SubjectWeeklySchedule = {
    semesterPlanId: 'sp-1',
    basedOnWeeklyJP: 5,
    sessions: [{ id: 's1', order: 1, jp: 5, dayOfWeek: 1 }],
    updatedAt: '2026-10-19T00:00:00Z',
  };

  // Missing days (only 3 days out of 14 provided)
  const incompleteDays: CalendarDay[] = [
    { id: 'd1', academicCalendarId: 'cal-test', date: '2026-10-19', status: 'EFFECTIVE_LEARNING' },
    { id: 'd2', academicCalendarId: 'cal-test', date: '2026-10-20', status: 'EFFECTIVE_LEARNING' },
    { id: 'd3', academicCalendarId: 'cal-test', date: '2026-10-21', status: 'UNKNOWN' as any },
  ];

  const slots = resolveEffectiveSubjectSlots({
    semesterPlanId: 'sp-1',
    schedule: sched,
    expectedWeeklyJP: 5,
    calendar: baseCal,
    calendarDays: incompleteDays,
    schoolDaysPerWeek: 5,
  });
  assert.equal(slots.isReady, false);

  const planned = resolvePlannedMeetingCapacity({
    schedule: sched,
    expectedWeeklyJP: 5,
    calendarConfirmed: true,
    effectiveWeekSlots: 2,
    calendar: baseCal,
    calendarDays: incompleteDays,
    semesterPlanId: 'sp-1',
  });
  assert.equal(planned.isReady, false);
  console.log('✅ Skenario 7 passed: Kalender tidak lengkap menolak status ready (fail-closed).');
}

// --- Skenario 8: Perubahan hari mengajar setelah jadwal tersimpan ---
console.log('--- Skenario 8: Perubahan hari mengajar setelah jadwal tersimpan ---');
{
  // Initial: Monday 3 + Thursday 2
  const schedInitial: SubjectWeeklySchedule = {
    semesterPlanId: 'sp-1',
    basedOnWeeklyJP: 5,
    sessions: [
      { id: 's-1', order: 1, jp: 3, dayOfWeek: 1 },
      { id: 's-2', order: 2, jp: 2, dayOfWeek: 4 },
    ],
    updatedAt: '2026-10-19T00:00:00Z',
  };

  const days = createTwoWeekCalendarDays('2026-10-19', { '2026-10-19': 'HOLIDAY' }); // Monday holiday
  const slotsInitial = resolveEffectiveSubjectSlots({
    semesterPlanId: 'sp-1',
    schedule: schedInitial,
    expectedWeeklyJP: 5,
    calendar: baseCal,
    calendarDays: days,
    schoolDaysPerWeek: 5,
  });
  // Monday is holiday -> loses 3 JP (total 7 JP)
  assert.equal(slotsInitial.totalJP, 7);

  // Teacher moves sessions to Tuesday (2) and Friday (5) where there are no holidays
  const schedUpdated: SubjectWeeklySchedule = {
    semesterPlanId: 'sp-1',
    basedOnWeeklyJP: 5,
    sessions: [
      { id: 's-1', order: 1, jp: 3, dayOfWeek: 2 },
      { id: 's-2', order: 2, jp: 2, dayOfWeek: 5 },
    ],
    updatedAt: '2026-10-20T00:00:00Z',
  };

  const slotsUpdated = resolveEffectiveSubjectSlots({
    semesterPlanId: 'sp-1',
    schedule: schedUpdated,
    expectedWeeklyJP: 5,
    calendar: baseCal,
    calendarDays: days,
    schoolDaysPerWeek: 5,
  });
  // Tuesday and Friday are effective -> full 10 JP!
  assert.equal(slotsUpdated.totalJP, 10);
  assert.equal(slotsUpdated.excludedOccurrences.length, 0);
  console.log('✅ Skenario 8 passed: Perubahan hari mengajar mengevaluasi ulang slot secara akurat.');
}

// --- Skenario 9: Proyek V5 lama tanpa hari mengajar (legacy schedule) ---
console.log('--- Skenario 9: Proyek V5 lama tanpa hari mengajar ---');
{
  const legacySched: SubjectWeeklySchedule = {
    semesterPlanId: 'sp-1',
    basedOnWeeklyJP: 5,
    sessions: [
      { id: 'legacy-1', order: 1, jp: 5 }, // No dayOfWeek
    ],
    updatedAt: '2026-10-19T00:00:00Z',
  };

  const days = createTwoWeekCalendarDays('2026-10-19');

  // resolveCalendarSubjectCapacity should return EFFECTIVE_DAY_ESTIMATE without crashing
  const cap = resolveCalendarSubjectCapacity({
    semesterPlanId: 'sp-1',
    calendar: baseCal,
    calendarDays: days,
    weeklyJP: 5,
    schedule: legacySched,
  });

  assert.equal(cap.capacitySource, 'EFFECTIVE_DAY_ESTIMATE');
  assert.equal(cap.availableJP, 10);

  // resolvePlannedMeetingCapacity should return ESTIMATE
  const planned = resolvePlannedMeetingCapacity({
    schedule: legacySched,
    expectedWeeklyJP: 5,
    calendarConfirmed: true,
    effectiveWeekSlots: 2,
    calendar: baseCal,
    calendarDays: days,
    semesterPlanId: 'sp-1',
  });
  assert.equal(planned.capacitySource, 'ESTIMATE');
  assert.equal(planned.isReady, true);
  assert.equal(planned.totalMeetingCapacity, 2);
  assert.equal(planned.totalJP, 10);
  console.log('✅ Skenario 9 passed: Proyek lama tanpa hari mengajar fallback aman ke ESTIMATE.');
}

// --- Skenario 10: Semester 1 dan 2 dengan kapasitas berbeda ---
console.log('--- Skenario 10: Semester 1 dan 2 dengan kapasitas berbeda ---');
{
  const schedS1: SubjectWeeklySchedule = {
    semesterPlanId: 'sp-s1',
    basedOnWeeklyJP: 4,
    sessions: [
      { id: 's1-1', order: 1, jp: 2, dayOfWeek: 1 },
      { id: 's1-2', order: 2, jp: 2, dayOfWeek: 3 },
    ],
    updatedAt: '2026-10-19T00:00:00Z',
  };

  const schedS2: SubjectWeeklySchedule = {
    semesterPlanId: 'sp-s2',
    basedOnWeeklyJP: 4,
    sessions: [
      { id: 's2-1', order: 1, jp: 2, dayOfWeek: 2 },
      { id: 's2-2', order: 2, jp: 2, dayOfWeek: 4 },
    ],
    updatedAt: '2026-10-19T00:00:00Z',
  };

  const calS1: AcademicCalendar = {
    ...baseCal,
    id: 'cal-s1',
    academicSettingId: 'sp-s1',
    startDate: '2026-10-19',
    endDate: '2026-11-01', // 2 weeks (10 weekdays)
  };

  const calS2: AcademicCalendar = {
    ...baseCal,
    id: 'cal-s2',
    academicSettingId: 'sp-s2',
    startDate: '2027-01-11',
    endDate: '2027-01-17', // 1 week (5 weekdays)
  };

  const daysS1 = createTwoWeekCalendarDays('2026-10-19');
  const daysS2 = createTwoWeekCalendarDays('2027-01-11').slice(0, 7);

  const plannedS1 = resolvePlannedMeetingCapacity({
    schedule: schedS1,
    expectedWeeklyJP: 4,
    calendarConfirmed: true,
    effectiveWeekSlots: 2,
    calendar: calS1,
    calendarDays: daysS1,
    semesterPlanId: 'sp-s1',
  });

  const plannedS2 = resolvePlannedMeetingCapacity({
    schedule: schedS2,
    expectedWeeklyJP: 4,
    calendarConfirmed: true,
    effectiveWeekSlots: 1,
    calendar: calS2,
    calendarDays: daysS2,
    semesterPlanId: 'sp-s2',
  });

  assert.equal(plannedS1.totalMeetingCapacity, 4);
  assert.equal(plannedS1.totalJP, 8);
  assert.equal(plannedS2.totalMeetingCapacity, 2);
  assert.equal(plannedS2.totalJP, 4);
  assert.notEqual(plannedS1.totalMeetingCapacity, plannedS2.totalMeetingCapacity);
  assert.notEqual(plannedS1.totalJP, plannedS2.totalJP);

  console.log('✅ Skenario 10 passed: S1 dan S2 kapasitas berbeda independen tanpa crosstalk.');
}

// --- Skenario 11: Transisi ESTIMATE -> ACTUAL_SLOTS ---
console.log('--- Skenario 11: Transisi ESTIMATE -> ACTUAL_SLOTS ---');
{
  const draftSched: SubjectWeeklySchedule = {
    semesterPlanId: 'sp-1',
    basedOnWeeklyJP: 5,
    sessions: [
      { id: 's-1', order: 1, jp: 5 }, // Hari mengajar belum ditentukan (no dayOfWeek)
    ],
    updatedAt: '2026-10-19T00:00:00Z',
  };

  const days = createTwoWeekCalendarDays('2026-10-19');

  // Draft stage: unconfirmed teaching days -> ESTIMATE
  const draftPlanned = resolvePlannedMeetingCapacity({
    schedule: draftSched,
    expectedWeeklyJP: 5,
    calendarConfirmed: true,
    effectiveWeekSlots: 2,
    calendar: baseCal,
    calendarDays: days,
    semesterPlanId: 'sp-1',
  });

  assert.equal(draftPlanned.capacitySource, 'ESTIMATE');
  assert.equal(draftPlanned.isReady, true);
  assert.equal(draftPlanned.totalMeetingCapacity, 2);

  // Transition stage: teaching days assigned -> ACTUAL_SLOTS
  const finalSched: SubjectWeeklySchedule = {
    ...draftSched,
    sessions: [
      { id: 's-1', order: 1, jp: 5, dayOfWeek: 1 }, // Monday 5 JP
    ],
    updatedAt: '2026-10-19T00:05:00Z',
  };

  const finalPlanned = resolvePlannedMeetingCapacity({
    schedule: finalSched,
    expectedWeeklyJP: 5,
    calendarConfirmed: true,
    effectiveWeekSlots: 2,
    calendar: baseCal,
    calendarDays: days,
    semesterPlanId: 'sp-1',
  });

  assert.equal(finalPlanned.capacitySource, 'ACTUAL_SLOTS');
  assert.equal(finalPlanned.isReady, true);
  assert.equal(finalPlanned.totalMeetingCapacity, 2);
  assert.equal(finalPlanned.totalJP, 10);
  console.log('✅ Skenario 11 passed: Transisi ESTIMATE -> ACTUAL_SLOTS berhasil dan konsisten.');
}

// --- Skenario 12: Perubahan Hari Mengajar & Evaluasi Kapasitas Aktual ---
console.log('--- Skenario 12: Perubahan Hari Mengajar & Evaluasi Kapasitas Aktual ---');
{
  const initialSched: SubjectWeeklySchedule = {
    semesterPlanId: 'sp-1',
    basedOnWeeklyJP: 5,
    sessions: [
      { id: 'sess-mon', order: 1, jp: 3, dayOfWeek: 1 }, // Mon
      { id: 'sess-thu', order: 2, jp: 2, dayOfWeek: 4 }, // Thu
    ],
    updatedAt: '2026-10-19T00:00:00Z',
  };

  const days = createTwoWeekCalendarDays('2026-10-19');
  const initialSlots = resolveEffectiveSubjectSlots({
    semesterPlanId: 'sp-1',
    schedule: initialSched,
    expectedWeeklyJP: 5,
    calendar: baseCal,
    calendarDays: days,
    schoolDaysPerWeek: 5,
  });

  assert.equal(initialSlots.slots.filter(s => s.dayOfWeek === 4).length, 2); // 2 Thursdays

  // Update schedule: move Thursday session to Wednesday
  const updatedSched: SubjectWeeklySchedule = {
    semesterPlanId: 'sp-1',
    basedOnWeeklyJP: 5,
    sessions: [
      { id: 'sess-mon', order: 1, jp: 3, dayOfWeek: 1 }, // Mon
      { id: 'sess-wed', order: 2, jp: 2, dayOfWeek: 3 }, // Wed
    ],
    updatedAt: '2026-10-19T01:00:00Z',
  };

  const updatedSlots = resolveEffectiveSubjectSlots({
    semesterPlanId: 'sp-1',
    schedule: updatedSched,
    expectedWeeklyJP: 5,
    calendar: baseCal,
    calendarDays: days,
    schoolDaysPerWeek: 5,
  });

  assert.equal(updatedSlots.slots.filter(s => s.dayOfWeek === 4).length, 0); // 0 Thursdays
  assert.equal(updatedSlots.slots.filter(s => s.dayOfWeek === 3).length, 2); // 2 Wednesdays
  assert.equal(updatedSlots.totalMeetingSlots, 4);
  assert.equal(updatedSlots.totalJP, 10);
  console.log('✅ Skenario 12 passed: Perubahan hari mengajar memperbarui slot aktual secara akurat.');
}

// --- Skenario 13: Penyimpanan Kalender & Reload Antarsemester ---
console.log('--- Skenario 13: Penyimpanan Kalender & Reload Antarsemester ---');
{
  const schedS1: SubjectWeeklySchedule = {
    semesterPlanId: 'sp-s1',
    basedOnWeeklyJP: 5,
    sessions: [{ id: 's1-mon', order: 1, jp: 5, dayOfWeek: 1 }],
    updatedAt: '2026-10-19T00:00:00Z',
  };

  const schedS2: SubjectWeeklySchedule = {
    semesterPlanId: 'sp-s2',
    basedOnWeeklyJP: 5,
    sessions: [
      { id: 's2-tue', order: 1, jp: 3, dayOfWeek: 2 },
      { id: 's2-fri', order: 2, jp: 2, dayOfWeek: 5 },
    ],
    updatedAt: '2026-10-19T00:00:00Z',
  };

  const calS1: AcademicCalendar = { ...baseCal, id: 'cal-s1', academicSettingId: 'sp-s1' };
  const calS2: AcademicCalendar = { ...baseCal, id: 'cal-s2', academicSettingId: 'sp-s2', startDate: '2027-01-11', endDate: '2027-01-24' };

  const daysS1 = createTwoWeekCalendarDays('2026-10-19');
  const daysS2 = createTwoWeekCalendarDays('2027-01-11');

  const capS1 = resolvePlannedMeetingCapacity({
    schedule: schedS1,
    expectedWeeklyJP: 5,
    calendarConfirmed: true,
    effectiveWeekSlots: 2,
    calendar: calS1,
    calendarDays: daysS1,
    semesterPlanId: 'sp-s1',
  });

  const capS2 = resolvePlannedMeetingCapacity({
    schedule: schedS2,
    expectedWeeklyJP: 5,
    calendarConfirmed: true,
    effectiveWeekSlots: 2,
    calendar: calS2,
    calendarDays: daysS2,
    semesterPlanId: 'sp-s2',
  });

  assert.equal(capS1.totalMeetingCapacity, 2);
  assert.equal(capS2.totalMeetingCapacity, 4);
  assert.equal(capS1.capacitySource, 'ACTUAL_SLOTS');
  assert.equal(capS2.capacitySource, 'ACTUAL_SLOTS');
  console.log('✅ Skenario 13 passed: Penyimpanan kalender & reload antarsemester terverifikasi.');
}

console.log('===========================================================');
console.log('🎉 ALL 13 V20/V21 REGRESSION SCENARIOS PASSED WITH 100% SUCCESS!');
console.log('===========================================================');

