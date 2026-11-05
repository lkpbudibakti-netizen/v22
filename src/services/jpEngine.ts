import { resolveEffectiveSubjectSlots } from './subjectScheduleService';
import {
  CurriculumType,
  CurriculumStructureRule,
  MasterCurriculumStructure,
  SubjectJPQuery,
  SubjectJPResult,
  TeachingAssignment,
  AdditionalDuty,
  TeacherLoadValidationResult,
  EffectiveDayResult,
  AvailableJPResult,
  TimeAllocationValidationResult,
  TimeAllocationStatus,
  LearningTimeAllocation,
  TimeAllocation,
  AcademicCalendar,
  CalendarDay,
  EffectiveWeekInfo,
  CanonicalDayStatus,
  CalendarCompletenessResult,
  SemesterJPSetting,
  SubjectWeeklySchedule,
} from '../types';
import {
  calculateTeacherWorkload,
  PREDEFINED_ADDITIONAL_DUTIES,
} from './teacherWorkloadEngine';
import { loadStorageV5 } from './storageV5';
import {
  ALL_CURRICULUM_STRUCTURE_RULES,
  resolveCurriculumContext,
  findSubjectByCode,
  getRegulationSources,
  parseAcademicYear,
} from '../data/curriculum';
import {
  resolveSemesterJPFromState,
  ResolvedSemesterJP,
} from './semesterJPResolver';

export { calculateTeacherWorkload, PREDEFINED_ADDITIONAL_DUTIES, resolveSemesterJPFromState };
export type { ResolvedSemesterJP };

/**
 * MASTER STRUKTUR KURIKULUM RESMI PEMERINTAH (KEMENDIKDASMEN / KEMENAG)
 * Didelegasikan ke Master Regulasi Terpusat di src/data/curriculum/
 * Menyediakan kompatibilitas penuh dengan CurriculumStructureRule[]
 */
export const MASTER_CURRICULUM_STRUCTURE: CurriculumStructureRule[] = ALL_CURRICULUM_STRUCTURE_RULES.map((rule) => {
  const subj = findSubjectByCode(rule.subjectCode);
  const regs = getRegulationSources(rule.regulationIds);
  const mainReg = [...regs].sort((a, b) => b.year - a.year)[0];
  return {
    id: rule.id,
    curriculum: rule.curriculumType === 'K13' ? 'Kurikulum 2013' : 'Kurikulum Merdeka',
    curriculumType: rule.curriculumType,
    regulation: mainReg?.title || 'Regulasi Kemendikdasmen',
    regulationYear: mainReg?.year || 2024,
    level: rule.level,
    phase: rule.phase ? `Fase ${rule.phase}` : undefined,
    grade: `Kelas ${rule.grade}`,
    subject: subj?.name || rule.subjectCode,
    intrakurikulerWeeklyJP: rule.derivedWeeklyJP,
    intrakurikulerAnnualJP: rule.intrakurikulerAnnualJP,
    kokurikulerAnnualJP: rule.kokurikulerAnnualJP,
    totalAnnualJP: rule.totalAnnualJP,
    weeklyJP: rule.derivedWeeklyJP,
    annualJP: rule.intrakurikulerAnnualJP,
    kokurikulerJP: rule.kokurikulerAnnualJP,
    source: mainReg?.authority || 'Kemendikdasmen RI',
    sourceUrl: mainReg?.sourceUrl,
    effectiveFrom: rule.effectiveFrom,
    verificationStatus: rule.verificationStatus === 'VERIFIED' ? 'VERIFIED' : 'UNVERIFIED',
    notes: rule.notes,
  };
});

/**
 * Normalisasi string teks untuk perbandingan fuzzy yang aman
 */
function normalizeText(text?: any): string {
  if (text === null || text === undefined) return '';
  return String(text)
    .toLowerCase()
    .replace(/[(),.\-_/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Lookup JP Mata Pelajaran dari Master Struktur Kurikulum Resmi Pemerintah
 * Terkoneksi langsung ke Single Entry Point Resolver: resolveCurriculumContext
 */
export function getSubjectJP(query: SubjectJPQuery): SubjectJPResult {
  const normCurriculum = normalizeText(query.curriculum);
  const resolvedCurriculumType: CurriculumType | undefined =
    query.curriculumType ||
    (normCurriculum.includes('k13') || normCurriculum.includes('2013') || normCurriculum.includes('k 13')
      ? 'K13'
      : normCurriculum.includes('merdeka')
      ? 'KURIKULUM_MERDEKA'
      : undefined);

  if (!resolvedCurriculumType) {
    return {
      weeklyJP: null,
      intrakurikulerWeeklyJP: null,
      intrakurikulerAnnualJP: undefined,
      kokurikulerAnnualJP: undefined,
      totalAnnualJP: undefined,
      annualJP: undefined,
      kokurikulerJP: undefined,
      isOfficial: false,
      verificationStatus: 'UNVERIFIED',
      statusLabel: 'Kurikulum belum ditentukan',
      sourceType: 'UNVERIFIED',
      regulation: undefined,
      regulationYear: undefined,
      source: undefined,
      explanation: 'Alokasi JP tidak dapat ditentukan secara otomatis karena kurikulum belum ditentukan atau tidak dikenali.',
    };
  }

  // Parse nomor kelas jika tersedia (e.g. "Kelas 4" -> 4, "4" -> 4, 4 -> 4)
  const gradeMatch = String(query.grade || '').trim().match(/^(?:kelas\s*)?(\d{1,2})$/i);
  const gradeNum = gradeMatch ? Number(gradeMatch[1]) : NaN;
  const year = query.academicYear ? parseAcademicYear(query.academicYear) : undefined;
  const validYear = !query.academicYear || !!year && year.endYear === year.startYear + 1;

  // 1. Delegasi ke Central Resolver jika nomor kelas terdeteksi
  if (!isNaN(gradeNum) && gradeNum > 0 && query.subject && validYear) {
    const resolvedContext = resolveCurriculumContext({
      curriculumType: resolvedCurriculumType,
      grade: gradeNum,
      level: query.level,
      academicYear: query.academicYear,
      subjectInput: query.subject,
    });

    if (resolvedContext && resolvedContext.rule) {
      const { rule, regulationSources } = resolvedContext;
      const mainReg = [...regulationSources].sort((a, b) => b.year - a.year)[0];
      const matchedLegacyRule = MASTER_CURRICULUM_STRUCTURE.find((r) => r.id === rule.id);

      return {
        weeklyJP: rule.derivedWeeklyJP,
        intrakurikulerWeeklyJP: rule.derivedWeeklyJP,
        intrakurikulerAnnualJP: rule.intrakurikulerAnnualJP ?? undefined,
        kokurikulerAnnualJP: rule.kokurikulerAnnualJP ?? undefined,
        totalAnnualJP: rule.totalAnnualJP ?? undefined,
        annualJP: rule.intrakurikulerAnnualJP ?? undefined,
        referenceAnnualJP: query.allocationType === 'KOKURIKULER' ? rule.kokurikulerAnnualJP ?? undefined : query.allocationType === 'TOTAL' ? rule.totalAnnualJP ?? undefined : rule.intrakurikulerAnnualJP ?? undefined,
        kokurikulerJP: rule.kokurikulerAnnualJP ?? undefined,
        isOfficial: rule.verificationStatus === 'VERIFIED',
        verificationStatus: rule.verificationStatus === 'VERIFIED' ? 'VERIFIED' : 'UNVERIFIED',
        statusLabel: rule.verificationStatus === 'VERIFIED' ? 'Terverifikasi Resmi' : 'Belum diverifikasi',
        sourceType: rule.verificationStatus === 'VERIFIED' ? 'OFFICIAL' : 'UNVERIFIED',
        regulation: mainReg?.title || 'Permendikbudristek No. 12 Tahun 2024',
        regulationYear: mainReg?.year || 2024,
        source: mainReg?.authority || 'BSKAP Kemendikdasmen RI',
        sourceUrl: mainReg?.sourceUrl,
        effectiveFrom: rule.effectiveFrom,
        curriculumType: rule.curriculumType,
        matchedRule: matchedLegacyRule,
        explanation: rule.verificationStatus === 'VERIFIED'
          ? `Alokasi intrakurikuler resmi: ${rule.derivedWeeklyJP} JP/minggu (${rule.intrakurikulerAnnualJP} JP/tahun${rule.kokurikulerAnnualJP ? `, Kokurikuler/P5: ${rule.kokurikulerAnnualJP} JP/tahun` : ''}) berdasarkan ${mainReg?.title || 'Regulasi Resmi'}.`
          : rule.notes || 'Alokasi JP memerlukan audit manual sebelum digunakan sebagai acuan resmi.',
      };
    }
  }

  // 3. JANGAN MENGARANG: Mapel tidak ditemukan dalam master resmi
  return {
    weeklyJP: null,
    intrakurikulerWeeklyJP: null,
    isOfficial: false,
    verificationStatus: 'UNVERIFIED',
    statusLabel: 'Belum diverifikasi',
    sourceType: 'UNVERIFIED',
    source: 'Struktur Kurikulum Belum Diverifikasi',
    curriculumType: resolvedCurriculumType,
    explanation: `Mata pelajaran "${query.subject || 'Mapel'}" pada ${query.level || ''} ${query.grade || ''} belum terdaftar dalam struktur regulasi baku. Silakan tetapkan JP intrakurikuler secara manual.`,
  };
}

/**
 * Normalisasi Status Hari Kalender ke Status Kanonikal
 * Memetakan input legacy/raw ke CanonicalDayStatus
 */
export function normalizeCalendarDayStatus(status?: string): CanonicalDayStatus {
  if (!status) return 'UNKNOWN';
  const clean = status.trim().toUpperCase();
  if (
    clean === 'EFFECTIVE' ||
    clean === 'EFEKTIF' ||
    clean === 'EFFECTIVE_LEARNING'
  ) {
    return 'EFFECTIVE_LEARNING';
  }
  if (clean === 'HOLIDAY' || clean === 'LIBUR') {
    return 'HOLIDAY';
  }
  if (
    clean === 'SCHOOLEVENT' ||
    clean === 'SCHOOL_EVENT' ||
    clean === 'KEGIATAN_SEKOLAH'
  ) {
    return 'SCHOOL_EVENT';
  }
  if (clean === 'ASSESSMENT' || clean === 'ASESMEN') {
    return 'ASSESSMENT';
  }
  if (clean === 'BREAK' || clean === 'JEDA_SEMESTER' || clean === 'JEDA') {
    return 'BREAK';
  }
  if (
    clean === 'NONLEARNING' ||
    clean === 'NON_LEARNING' ||
    clean === 'NON_EFEKTIF' ||
    clean === 'WEEKEND' ||
    clean === 'OTHER'
  ) {
    return 'NON_LEARNING';
  }
  return 'UNKNOWN';
}

/**
 * Validasi Kelengkapan Kalender Akademik
 * Memeriksa apakah setiap hari sekolah terjadwal memiliki catatan status definitif
 */
export function validateCalendarCompleteness(
  calendar: Partial<AcademicCalendar> & {
    startDate?: string;
    endDate?: string;
    schoolDaysPerWeek?: number;
    calendarDays?: CalendarDay[];
  },
  calendarDaysParam?: CalendarDay[]
): CalendarCompletenessResult {
  const schoolDaysPerWeek =
    calendar.schoolDaysPerWeek === 5 || calendar.schoolDaysPerWeek === 6
      ? calendar.schoolDaysPerWeek
      : null;

  const calendarDays =
    calendarDaysParam && calendarDaysParam.length > 0
      ? calendarDaysParam
      : calendar.calendarDays || [];

  const startDateStr = calendar.startDate || calendarDays[0]?.date;
  const endDateStr = calendar.endDate || calendarDays[calendarDays.length - 1]?.date;

  if (!schoolDaysPerWeek || !startDateStr || !endDateStr) {
    return {
      complete: false,
      missingScheduledDates: [],
      totalScheduledDays: 0,
      recordedScheduledDays: 0,
      diagnostic: 'Konfigurasi kalender (tanggal mulai/selesai atau hari sekolah) belum lengkap.',
    };
  }

  const start = new Date(startDateStr);
  const end = new Date(endDateStr);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
    return {
      complete: false,
      missingScheduledDates: [],
      totalScheduledDays: 0,
      recordedScheduledDays: 0,
      diagnostic: 'Rentang tanggal kalender tidak valid.',
    };
  }

  const dayMap = new Map<string, CalendarDay>();
  for (const day of calendarDays) {
    if (day.date) {
      dayMap.set(day.date, day);
    }
  }

  let totalScheduledDays = 0;
  let recordedScheduledDays = 0;
  const missingScheduledDates: string[] = [];

  const current = new Date(start);
  while (current <= end) {
    const dayOfWeek = current.getDay();
    const isScheduledSchoolDay =
      schoolDaysPerWeek === 6
        ? dayOfWeek >= 1 && dayOfWeek <= 6
        : dayOfWeek >= 1 && dayOfWeek <= 5;

    if (isScheduledSchoolDay) {
      totalScheduledDays++;
      const dateStr = current.toISOString().slice(0, 10);
      const dayRecord = dayMap.get(dateStr);
      if (dayRecord && normalizeCalendarDayStatus(dayRecord.status) !== 'UNKNOWN') {
        recordedScheduledDays++;
      } else {
        missingScheduledDates.push(dateStr);
      }
    }
    current.setDate(current.getDate() + 1);
  }

  const complete = missingScheduledDates.length === 0;
  const diagnostic = complete
    ? 'Kalender lengkap untuk seluruh hari sekolah terjadwal.'
    : `Terdapat ${missingScheduledDates.length} hari sekolah terjadwal tanpa status terdefinisi (UNKNOWN).`;

  return {
    complete,
    missingScheduledDates,
    totalScheduledDays,
    recordedScheduledDays,
    diagnostic,
  };
}

export function calculateEffectiveDays(
  calendar: Partial<AcademicCalendar> & {
    startDate?: string;
    endDate?: string;
    schoolDaysPerWeek?: number;
    calendarDays?: CalendarDay[];
  },
  calendarDaysParam?: CalendarDay[]
): EffectiveDayResult {
  const schoolDaysPerWeek =
    calendar.schoolDaysPerWeek === 5 || calendar.schoolDaysPerWeek === 6
      ? calendar.schoolDaysPerWeek
      : null;

  const holidays: Array<{ date: string; notes?: string }> = [];
  const events: Array<{ date: string; notes?: string }> = [];
  const assessments: Array<{ date: string; notes?: string }> = [];
  const nonLearning: Array<{ date: string; notes?: string }> = [];
  const unknown: Array<{ date: string; notes?: string }> = [];

  const emptyResult = (status: 'RESOLVED' | 'UNRESOLVED' | 'PARTIAL' = 'UNRESOLVED'): EffectiveDayResult => ({
    status,
    totalCalendarDays: 0,
    scheduledSchoolDays: 0,
    effectiveLearningDays: 0,
    holidayDays: 0,
    schoolEventDays: 0,
    assessmentDays: 0,
    nonLearningDays: 0,
    unknownDays: 0,
    breakdown: { holidays, events, assessments, nonLearning, unknown },
    monthlyBreakdown: [],
  });

  // Jangan berasumsi 5 hari sekolah jika data tidak diatur
  if (!schoolDaysPerWeek) {
    return emptyResult('UNRESOLVED');
  }

  const calendarDays =
    calendarDaysParam && calendarDaysParam.length > 0
      ? calendarDaysParam
      : (calendar.calendarDays || []);

  const startDateStr = calendar.startDate || calendarDays[0]?.date;
  const endDateStr = calendar.endDate || calendarDays[calendarDays.length - 1]?.date;

  if (!startDateStr || !endDateStr) {
    return emptyResult('UNRESOLVED');
  }

  const start = new Date(startDateStr);
  const end = new Date(endDateStr);

  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
    return emptyResult('UNRESOLVED');
  }

  const completeness = validateCalendarCompleteness(calendar, calendarDaysParam);

  // Map agenda hari yang ditandai khusus
  const dayMap = new Map<string, CalendarDay>();
  for (const day of calendarDays) {
    if (day.date) {
      dayMap.set(day.date, day);
    }
  }

  let totalCalendarDays = 0;
  let scheduledSchoolDays = 0;
  let effectiveLearningDays = 0;
  let holidayDays = 0;
  let schoolEventDays = 0;
  let assessmentDays = 0;
  let nonLearningDays = 0;
  let unknownDays = 0;

  const monthMap = new Map<string, { monthName: string; effectiveDays: number }>();
  const monthNames = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];

  const recordEffectiveDay = (d: Date) => {
    effectiveLearningDays++;
    const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const mName = `${monthNames[d.getMonth()]} ${d.getFullYear()}`;
    const cur = monthMap.get(mKey) || { monthName: mName, effectiveDays: 0 };
    cur.effectiveDays++;
    monthMap.set(mKey, cur);
  };

  const current = new Date(start);
  while (current <= end) {
    totalCalendarDays++;
    const dayOfWeek = current.getDay(); // 0: Sunday, 1: Mon, ..., 6: Sat

    // Cek apakah hari sekolah terjadwal
    // 5 hari kerja: Senin (1) s.d. Jumat (5)
    // 6 hari kerja: Senin (1) s.d. Sabtu (6)
    const isScheduledSchoolDay =
      schoolDaysPerWeek === 6
        ? dayOfWeek >= 1 && dayOfWeek <= 6
        : dayOfWeek >= 1 && dayOfWeek <= 5;

    if (isScheduledSchoolDay) {
      scheduledSchoolDays++;
      const dateStr = current.toISOString().slice(0, 10);
      const specialDay = dayMap.get(dateStr);
      const canonicalStatus = specialDay
        ? normalizeCalendarDayStatus(specialDay.status)
        : 'UNKNOWN';

      switch (canonicalStatus) {
        case 'EFFECTIVE_LEARNING':
          recordEffectiveDay(current);
          break;
        case 'HOLIDAY':
          holidayDays++;
          holidays.push({ date: dateStr, notes: specialDay?.notes });
          break;
        case 'SCHOOL_EVENT':
          schoolEventDays++;
          events.push({ date: dateStr, notes: specialDay?.notes });
          break;
        case 'ASSESSMENT':
          assessmentDays++;
          assessments.push({ date: dateStr, notes: specialDay?.notes });
          break;
        case 'BREAK':
        case 'NON_LEARNING':
          nonLearningDays++;
          nonLearning.push({ date: dateStr, notes: specialDay?.notes });
          break;
        case 'UNKNOWN':
        default:
          // Hari sekolah terjadwal tanpa status definitif tidak dianggap hari efektif
          unknownDays++;
          unknown.push({
            date: dateStr,
            notes: specialDay?.notes || 'Data status kalender tidak tersedia (UNKNOWN)',
          });
          break;
      }
    }

    current.setDate(current.getDate() + 1);
  }

  const monthlyBreakdown = Array.from(monthMap.values()).map((m) => ({
    monthName: m.monthName,
    effectiveDays: m.effectiveDays,
    effectiveWeeks: Math.max(0, Math.round(m.effectiveDays / schoolDaysPerWeek)),
  }));

  const status: 'RESOLVED' | 'PARTIAL' = unknownDays > 0 ? 'PARTIAL' : 'RESOLVED';

  return {
    status,
    totalCalendarDays,
    scheduledSchoolDays,
    effectiveLearningDays,
    holidayDays,
    schoolEventDays,
    assessmentDays,
    nonLearningDays,
    unknownDays,
    completeness,
    breakdown: {
      holidays,
      events,
      assessments,
      nonLearning,
      unknown,
    },
    monthlyBreakdown,
  };
}

/**
 * Mengelompokkan hari-hari efektif pembelajaran berdasarkan minggu kalender
 * untuk mendapatkan urutan Minggu Efektif Aktual beserta tanggal dan bulan resminya.
 */
export function getEffectiveWeeksList(
  calendar: Partial<AcademicCalendar> & {
    startDate?: string;
    endDate?: string;
    schoolDaysPerWeek?: number;
    calendarDays?: CalendarDay[];
  },
  calendarDaysParam?: CalendarDay[]
): EffectiveWeekInfo[] {
  const schoolDaysPerWeek =
    calendar?.schoolDaysPerWeek === 5 || calendar?.schoolDaysPerWeek === 6
      ? calendar.schoolDaysPerWeek
      : null;

  if (!schoolDaysPerWeek) return [];

  const calendarDays =
    calendarDaysParam && calendarDaysParam.length > 0
      ? calendarDaysParam
      : (calendar?.calendarDays || []);

  if (!calendarDays || calendarDays.length === 0) {
    return [];
  }

  const startDateStr = calendar?.startDate || calendarDays[0]?.date;
  const endDateStr = calendar?.endDate || calendarDays[calendarDays.length - 1]?.date;

  if (!startDateStr || !endDateStr) return [];

  const start = new Date(startDateStr);
  const end = new Date(endDateStr);

  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return [];

  const dayMap = new Map<string, CalendarDay>();
  for (const day of calendarDays) {
    if (day?.date) {
      dayMap.set(day.date, day);
    }
  }

  // Group effective days into calendar weeks (Monday to Sunday)
  const weekMap = new Map<string, string[]>();
  const weekOrder: string[] = [];

  const current = new Date(start);
  while (current <= end) {
    const dayOfWeek = current.getDay(); // 0: Sun, 1: Mon...
    const isScheduledSchoolDay =
      schoolDaysPerWeek === 6
        ? dayOfWeek >= 1 && dayOfWeek <= 6
        : dayOfWeek >= 1 && dayOfWeek <= 5;

    if (isScheduledSchoolDay) {
      const dateStr = current.toISOString().slice(0, 10);
      const specialDay = dayMap.get(dateStr);
      const canonicalStatus = specialDay
        ? normalizeCalendarDayStatus(specialDay.status)
        : 'UNKNOWN';

      // HANYA hari dengan status kanonikal EFFECTIVE_LEARNING yang dihitung
      if (canonicalStatus === 'EFFECTIVE_LEARNING') {
        // Monday of current date's calendar week
        const mon = new Date(current);
        const day = mon.getDay();
        const diff = mon.getDate() - day + (day === 0 ? -6 : 1);
        mon.setDate(diff);
        const mondayKey = mon.toISOString().slice(0, 10);

        if (!weekMap.has(mondayKey)) {
          weekMap.set(mondayKey, []);
          weekOrder.push(mondayKey);
        }
        weekMap.get(mondayKey)!.push(dateStr);
      }
    }

    current.setDate(current.getDate() + 1);
  }

  const effectiveWeeks: EffectiveWeekInfo[] = [];
  let effectiveWeekCounter = 1;

  for (const monKey of weekOrder) {
    const dates = weekMap.get(monKey);
    if (dates && dates.length > 0) {
      const firstDate = new Date(dates[0]);
      effectiveWeeks.push({
        weekIndex: effectiveWeekCounter++,
        startDate: dates[0],
        endDate: dates[dates.length - 1],
        effectiveDaysCount: dates.length,
        month: firstDate.getMonth() + 1, // 1 - 12
        year: firstDate.getFullYear(),
      });
    }
  }

  return effectiveWeeks;
}

/**
 * Menghitung Minggu Efektif Ekuivalen dari Hari Efektif Belajar
 * Wajib menerima schoolDaysPerWeek yang valid (5 atau 6). Jika tidak valid/undefined/null, mengembalikan status UNRESOLVED.
 */
export function calculateEffectiveWeeks(
  effectiveLearningDays: number,
  schoolDaysPerWeek?: number | null
): {
  status: 'RESOLVED' | 'UNRESOLVED';
  effectiveWeeksEquivalent: number | null;
  effectiveWeeksRounded: number | null;
  unresolvedReason?: string;
} {
  const validDays =
    schoolDaysPerWeek === 5 || schoolDaysPerWeek === 6 ? schoolDaysPerWeek : null;

  if (!validDays) {
    return {
      status: 'UNRESOLVED',
      effectiveWeeksEquivalent: null,
      effectiveWeeksRounded: null,
      unresolvedReason: 'Hari sekolah per minggu (schoolDaysPerWeek) harus bernilai 5 atau 6.',
    };
  }

  const equivalent = Math.max(0, effectiveLearningDays) / validDays;
  const rounded = Math.round(equivalent * 10) / 10;
  return {
    status: 'RESOLVED',
    effectiveWeeksEquivalent: equivalent,
    effectiveWeeksRounded: rounded,
  };
}

/**
 * Menghitung Alokasi Jam Pelajaran (JP) Tersedia dalam satu semester
 * Formula: JP Mingguan Aktual × (Hari Efektif Belajar ÷ Hari Sekolah per Minggu)
 * Wajib menerima schoolDaysPerWeek valid (5 atau 6) dan weeklyJPSource !== 'REFERENCE_EQUIVALENT'.
 */
export function calculateAvailableJP(params: {
  subjectWeeklyJP?: number | null;
  effectiveLearningDays?: number | null;
  schoolDaysPerWeek?: number | null;
  weeklyJPSource?: 'ACTUAL_SCHEDULE' | 'REFERENCE_EQUIVALENT' | 'DEFAULT_ANNUAL' | 'SEMESTER_OVERRIDE' | 'TEACHER_CONFIRMED';
  calendarStatus?: 'RESOLVED' | 'UNRESOLVED' | 'PARTIAL';
  effectiveDayStatus?: 'RESOLVED' | 'UNRESOLVED' | 'PARTIAL';
  actualScheduledAnnualJP?: number | null;
  semester?: string;
  academicYear?: string;
  level?: string;
  grade?: string;
  subject?: string;
  officialAnnualJP?: number | null;
}): AvailableJPResult {
  const validDays =
    params.schoolDaysPerWeek === 5 || params.schoolDaysPerWeek === 6
      ? params.schoolDaysPerWeek
      : null;

  if (!validDays) {
    return {
      status: 'UNRESOLVED',
      subjectWeeklyJP: params.subjectWeeklyJP ?? null,
      effectiveLearningDays: params.effectiveLearningDays ?? null,
      schoolDaysPerWeek: null,
      effectiveWeeksEquivalent: null,
      effectiveWeeksRounded: null,
      availableJP: null,
      unresolvedReason:
        'Hari sekolah per minggu (schoolDaysPerWeek) belum ditentukan atau tidak valid (harus 5 atau 6 hari).',
      formula: 'JP Mingguan × (Hari Efektif Belajar ÷ Hari Sekolah/Minggu)',
      formulaCalculation: 'Data hari sekolah per minggu tidak valid (UNRESOLVED)',
      jpPerWeek: params.subjectWeeklyJP ?? null,
      effectiveWeeks: null,
      officialAnnualJP: params.officialAnnualJP ?? undefined,
      details: {
        semester: params.semester,
        academicYear: params.academicYear,
        level: params.level,
        grade: params.grade,
        subject: params.subject,
      },
    };
  }

  if (params.weeklyJPSource === 'REFERENCE_EQUIVALENT') {
    return {
      status: 'UNRESOLVED',
      subjectWeeklyJP: params.subjectWeeklyJP ?? null,
      effectiveLearningDays: params.effectiveLearningDays ?? null,
      schoolDaysPerWeek: validDays,
      effectiveWeeksEquivalent: null,
      effectiveWeeksRounded: null,
      availableJP: null,
      unresolvedReason:
        'Alokasi mingguan berasal dari REFERENCE_EQUIVALENT normatif regulasi, bukan jadwal mingguan aktual sekolah (ACTUAL_SCHEDULE).',
      formula: 'JP Mingguan Aktual × (Hari Efektif Belajar ÷ Hari Sekolah/Minggu)',
      formulaCalculation: 'Bukan jadwal mingguan aktual sekolah (REFERENCE_EQUIVALENT)',
      jpPerWeek: params.subjectWeeklyJP ?? null,
      effectiveWeeks: null,
      officialAnnualJP: params.officialAnnualJP ?? undefined,
      details: {
        semester: params.semester,
        academicYear: params.academicYear,
        level: params.level,
        grade: params.grade,
        subject: params.subject,
      },
    };
  }

  if (
    params.calendarStatus === 'PARTIAL' ||
    params.calendarStatus === 'UNRESOLVED' ||
    params.effectiveDayStatus === 'PARTIAL' ||
    params.effectiveDayStatus === 'UNRESOLVED'
  ) {
    return {
      status: 'UNRESOLVED',
      subjectWeeklyJP: params.subjectWeeklyJP ?? null,
      effectiveLearningDays: params.effectiveLearningDays ?? null,
      schoolDaysPerWeek: validDays,
      effectiveWeeksEquivalent: null,
      effectiveWeeksRounded: null,
      availableJP: null,
      unresolvedReason:
        'Kalender pendidikan belum lengkap. Hari sekolah terjadwal memiliki status yang belum terdefinisi.',
      formula: 'JP Mingguan × (Hari Efektif Belajar ÷ Hari Sekolah/Minggu)',
      formulaCalculation: 'Kalender pendidikan belum lengkap (UNRESOLVED)',
      jpPerWeek: params.subjectWeeklyJP ?? null,
      effectiveWeeks: null,
      officialAnnualJP: params.officialAnnualJP ?? undefined,
      details: {
        semester: params.semester,
        academicYear: params.academicYear,
        level: params.level,
        grade: params.grade,
        subject: params.subject,
      },
    };
  }

  if (
    params.subjectWeeklyJP === null ||
    params.subjectWeeklyJP === undefined ||
    !Number.isFinite(Number(params.subjectWeeklyJP)) ||
    Number(params.subjectWeeklyJP) <= 0
  ) {
    return {
      status: 'UNRESOLVED',
      subjectWeeklyJP: null,
      effectiveLearningDays: params.effectiveLearningDays ?? null,
      schoolDaysPerWeek: validDays,
      effectiveWeeksEquivalent: null,
      effectiveWeeksRounded: null,
      availableJP: null,
      unresolvedReason: 'Jam Pelajaran (JP) mingguan belum ditentukan.',
      formula: 'JP Mingguan × (Hari Efektif Belajar ÷ Hari Sekolah/Minggu)',
      formulaCalculation: 'JP mingguan belum ditentukan (UNRESOLVED)',
      jpPerWeek: null,
      effectiveWeeks: null,
      officialAnnualJP: params.officialAnnualJP ?? undefined,
      details: {
        semester: params.semester,
        academicYear: params.academicYear,
        level: params.level,
        grade: params.grade,
        subject: params.subject,
      },
    };
  }

  if (
    params.effectiveLearningDays === null ||
    params.effectiveLearningDays === undefined ||
    !Number.isFinite(Number(params.effectiveLearningDays))
  ) {
    return {
      status: 'UNRESOLVED',
      subjectWeeklyJP: Number(params.subjectWeeklyJP),
      effectiveLearningDays: null,
      schoolDaysPerWeek: validDays,
      effectiveWeeksEquivalent: null,
      effectiveWeeksRounded: null,
      availableJP: null,
      unresolvedReason: 'Hari efektif belajar belum ditentukan.',
      formula: 'JP Mingguan × (Hari Efektif Belajar ÷ Hari Sekolah/Minggu)',
      formulaCalculation: 'Hari efektif belajar belum ditentukan (UNRESOLVED)',
      jpPerWeek: Number(params.subjectWeeklyJP),
      effectiveWeeks: null,
      officialAnnualJP: params.officialAnnualJP ?? undefined,
      details: {
        semester: params.semester,
        academicYear: params.academicYear,
        level: params.level,
        grade: params.grade,
        subject: params.subject,
      },
    };
  }

  const subjectWeeklyJP = Number(params.subjectWeeklyJP);
  const effectiveLearningDays = Math.max(0, Number(params.effectiveLearningDays));

  const { effectiveWeeksEquivalent, effectiveWeeksRounded } = calculateEffectiveWeeks(
    effectiveLearningDays,
    validDays
  );

  const exactAvailableJP = subjectWeeklyJP * (effectiveLearningDays / validDays);
  const availableJP = Math.round(exactAvailableJP);

  // Annual comparison requires both real semesters; never project one semester × 2.
  const isCapacityExceeded = false;
  const capacityWarning = undefined;

  const formula = 'JP Mingguan × (Hari Efektif Belajar ÷ Hari Sekolah/Minggu)';
  const formulaCalculation = `${subjectWeeklyJP} JP/minggu × (${effectiveLearningDays} hari ÷ ${validDays} hari/minggu) = ${subjectWeeklyJP} × ${effectiveWeeksRounded} = ${availableJP} JP`;

  return {
    status: 'RESOLVED',
    subjectWeeklyJP,
    effectiveLearningDays,
    schoolDaysPerWeek: validDays,
    effectiveWeeksEquivalent,
    effectiveWeeksRounded,
    availableJP,
    formula,
    formulaCalculation,
    isCapacityExceeded,
    capacityWarning,
    officialAnnualJP: params.officialAnnualJP ?? undefined,
    details: {
      semester: params.semester,
      academicYear: params.academicYear,
      level: params.level,
      grade: params.grade,
      subject: params.subject,
    },
    jpPerWeek: subjectWeeklyJP,
    effectiveWeeks: effectiveWeeksRounded,
  };
}

/**
 * Canonical Semester Resolver:
 * Resolve semester ('1' | '2' | null) secara jujur dari data nyata tanpa asumsi diam (NO ASSUMPTION).
 * Mengembalikan '1' untuk valid semester 1, '2' untuk valid semester 2, dan null untuk missing/unresolved/invalid.
 */
export function resolveSemester(
  calendarSemester?: string | number | null,
  settingSemester?: string | number | null
): '1' | '2' | null {
  const parseSem = (val?: string | number | null): '1' | '2' | null => {
    if (val === null || val === undefined) return null;
    const str = String(val).trim().toLowerCase();
    if (!str) return null;
    // Cek semester 2 secara eksplisit
    if (str === '2' || str.includes('2') || str.includes('genap')) {
      return '2';
    }
    // Cek semester 1 secara eksplisit
    if (str === '1' || str.includes('1') || str.includes('ganjil')) {
      return '1';
    }
    return null;
  };

  const fromCal = parseSem(calendarSemester);
  if (fromCal) return fromCal;

  const fromSetting = parseSem(settingSemester);
  if (fromSetting) return fromSetting;

  return null;
}

/**
 * Normalisasi batas pekan alokasi waktu (startWeek & endWeek) terhadap kapasitas minggu efektif
 */
export function normalizeWeekRange(
  startWeek: number | undefined | null,
  endWeek: number | undefined | null,
  effectiveWeeks?: number | null
): { startWeek: number; endWeek: number } {
  let start = startWeek && startWeek >= 1 ? Math.floor(startWeek) : 1;
  const maxWeeks = effectiveWeeks && effectiveWeeks > 0 ? Math.floor(effectiveWeeks) : null;

  if (maxWeeks !== null && start > maxWeeks) {
    start = maxWeeks;
  }

  let end = endWeek && endWeek >= 1 ? Math.floor(endWeek) : start;
  if (end < start) {
    end = start;
  }
  if (maxWeeks !== null && end > maxWeeks) {
    end = maxWeeks;
  }
  if (end < start) {
    start = end;
  }

  return { startWeek: start, endWeek: end };
}

/**
 * Normalisasi objek alokasi ke model shared LearningTimeAllocation
 */
export function normalizeLearningAllocation(raw: Partial<LearningTimeAllocation | TimeAllocation>): LearningTimeAllocation {
  const allocatedJP = Number(raw.allocatedJP ?? raw.jp ?? 0);
  const startWeek = raw.startWeek ?? raw.weekNumber;
  const sourceId = raw.sourceId ?? raw.tpId ?? raw.atpItemId ?? raw.id ?? '';
  let sourceType = raw.sourceType;
  if (!sourceType) {
    const rawAny = raw as Record<string, any>;
    if (raw.atpItemId || rawAny.atpId || (sourceId && (sourceId.startsWith('atp-') || sourceId.startsWith('ATP-')))) {
      sourceType = 'ATP_ITEM';
    } else if (raw.tpId || rawAny.tpCode || (sourceId && (sourceId.startsWith('tp-') || sourceId.startsWith('TP-')))) {
      sourceType = 'TP';
    } else if (rawAny.kdId || rawAny.kd || rawAny.kdCode || (sourceId && (sourceId.startsWith('kd-') || sourceId.startsWith('KD-')))) {
      sourceType = 'KD';
    } else if (rawAny.k13ObjectiveId || rawAny.indicatorId || rawAny.indikatorId || (sourceId && sourceId.startsWith('k13-'))) {
      sourceType = 'K13_OBJECTIVE';
    } else {
      sourceType = 'LEGACY';
    }
  }
  const resolvedSem = resolveSemester((raw as Record<string, any>).semester);
  return {
    id: raw.id || `alloc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    academicSettingId: raw.academicSettingId || '',
    sourceType,
    sourceId,
    semester: resolvedSem ?? (raw as Record<string, any>).semester ?? '',
    allocatedJP,
    startWeek,
    endWeek: raw.endWeek ?? startWeek,
    month: raw.month,
    monthName: raw.monthName,
    notes: raw.notes,
    tpId: raw.tpId || (sourceType === 'TP' || sourceType === 'ATP_ITEM' ? sourceId : undefined),
    atpItemId: raw.atpItemId || (sourceType === 'ATP_ITEM' ? sourceId : undefined),
    weekNumber: startWeek,
    jp: allocatedJP,
  };
}

/**
 * Validasi Keseluruhan Distribusi Alokasi Waktu (TP / KD) terhadap JP Tersedia
 */
export function validateTimeAllocations(
  allocations: Array<Partial<LearningTimeAllocation | TimeAllocation>>,
  availableJP: number
): TimeAllocationValidationResult {
  const totalAllocatedJP = allocations.reduce((sum, item) => {
    const jp = Number(item.allocatedJP ?? item.jp) || 0;
    return sum + jp;
  }, 0);

  const remainingJP = availableJP - totalAllocatedJP;
  let status: TimeAllocationStatus = 'BALANCED';
  let statusLabel = 'Alokasi Seimbang';
  let statusDescription = `Total alokasi waktu (${totalAllocatedJP} JP) tepat sama dengan kapasitas JP tersedia (${availableJP} JP).`;

  if (remainingJP > 0) {
    status = 'UNDER_ALLOCATED';
    statusLabel = 'Sisa JP Belum Dialokasikan';
    statusDescription = `Terdapat sisa ${remainingJP} JP yang belum dialokasikan dari total ${availableJP} JP tersedia.`;
  } else if (remainingJP < 0) {
    status = 'OVER_ALLOCATED';
    statusLabel = 'Defisit JP';
    statusDescription = `Total alokasi (${totalAllocatedJP} JP) melampaui JP tersedia (${availableJP} JP) sebesar ${Math.abs(remainingJP)} JP.`;
  }

  return {
    availableJP,
    totalAllocatedJP,
    remainingJP,
    status,
    statusLabel,
    statusDescription,
    allocationsCount: allocations.length,
  };
}

/**
 * Menurunkan nilai JP intrakurikuler mata pelajaran dengan pelacakan provenance yang jelas
 */
export function deriveEffectiveJP(setting: {
  academicYear?: string;
  curriculum?: string;
  curriculumType?: CurriculumType;
  level?: string;
  grade?: string;
  subject?: string;
  subjectWeeklyJP?: number;
  totalHoursPerWeek?: number;
  isHoursOverridden?: boolean;
  hoursSourceType?: 'OFFICIAL' | 'USER_OVERRIDE' | 'UNVERIFIED' | 'LEGACY_VALUE';
}): {
  weeklyJP: number;
  isOfficial: boolean;
  isOverridden: boolean;
  sourceType: 'OFFICIAL' | 'USER_OVERRIDE' | 'UNVERIFIED' | 'LEGACY_VALUE';
  ruleResult: SubjectJPResult;
  sourceExplanation: string;
} {
  const ruleResult = getSubjectJP({
    curriculum: setting.curriculum,
    curriculumType: setting.curriculumType,
    level: setting.level,
    grade: setting.grade,
    subject: setting.subject,
    academicYear: setting.academicYear,
  });

  const customValue = setting.subjectWeeklyJP ?? setting.totalHoursPerWeek;

  if (
    (setting.isHoursOverridden || setting.hoursSourceType === 'USER_OVERRIDE') &&
    customValue !== undefined &&
    customValue > 0
  ) {
    return {
      weeklyJP: customValue,
      isOfficial: ruleResult.isOfficial && customValue === ruleResult.weeklyJP,
      isOverridden: true,
      sourceType: 'USER_OVERRIDE',
      ruleResult,
      sourceExplanation: `Manual Override Guru (${customValue} JP/minggu). ${ruleResult.isOfficial ? `Standar resmi: ${ruleResult.weeklyJP} JP/minggu (${ruleResult.regulation}).` : 'Belum diverifikasi dalam regulasi resmi.'}`,
    };
  }

  if (ruleResult.isOfficial && ruleResult.weeklyJP !== null) {
    return {
      weeklyJP: ruleResult.weeklyJP,
      isOfficial: true,
      isOverridden: false,
      sourceType: 'OFFICIAL',
      ruleResult,
      sourceExplanation: ruleResult.explanation,
    };
  }

  return {
    weeklyJP: customValue || 0,
    isOfficial: false,
    isOverridden: false,
    sourceType: 'UNVERIFIED',
    ruleResult,
    sourceExplanation: ruleResult.explanation,
  };
}

/** @deprecated Compatibility wrapper */
export function calculateSemesterJP(jpPerWeek: number, semesterEffectiveWeeks: number): number {
  return Math.max(0, Number(jpPerWeek) || 0) * Math.max(0, Number(semesterEffectiveWeeks) || 0);
}

/** @deprecated Compatibility wrapper */
export function calculateAnnualJP(jpPerWeek: number, annualEffectiveWeeks: number): number {
  return Math.max(0, Number(jpPerWeek) || 0) * Math.max(0, Number(annualEffectiveWeeks) || 0);
}

/**
 * Normalizes curriculum string or type to canonical CurriculumType
 */
export function getCurriculumType(curriculum?: string, curriculumType?: CurriculumType): CurriculumType | undefined {
  if (curriculumType === 'K13' || curriculumType === 'KURIKULUM_MERDEKA') {
    return curriculumType;
  }
  const curr = (curriculum || '').toLowerCase();
  if (curr.includes('k13') || curr.includes('2013') || curr.includes('k-13') || curr.includes('k 13')) {
    return 'K13';
  }
  if (curr.includes('merdeka')) {
    return 'KURIKULUM_MERDEKA';
  }
  return undefined;
}

/** @deprecated Compatibility wrapper */
export function validateTeacherTeachingLoad(
  assignments: TeachingAssignment[] = [],
  additionalDuties: AdditionalDuty[] = [],
  teacherName?: string
): TeacherLoadValidationResult {
  return calculateTeacherWorkload(assignments, additionalDuties, teacherName);
}

/**
 * Kapasitas dan Kesiapan Semester untuk Auto-Allocation ATP
 */
export interface SemesterCapacityInfo {
  capacitySource?: 'ACTUAL_SLOTS' | 'EFFECTIVE_DAY_ESTIMATE' | 'UNRESOLVED';
  calendarLostJP?: number | null;
  totalMeetingCapacity?: number | null;
  totalMeetingSlots?: number | null;
  semesterPlanId: string;
  semester: '1' | '2';
  isCalendarConfirmed: boolean;
  effectiveWeeks: number | null;
  effectiveWeekSlots: number | null;
  effectiveLearningDays: number | null;
  actualScheduledWeeklyJP: number | null;
  jpSource?: 'SEMESTER_OVERRIDE' | 'DEFAULT_ANNUAL' | 'UNRESOLVED';
  isJPOverridden?: boolean;
  defaultAnnualWeeklyJP?: number | null;
  availableJP: number | null;
  isReady: boolean;
  unreadyReason?: string;
}

export interface ATPPartitionResult<T> {
  s1Items: T[];
  s2Items: T[];
  s1Share: number;
  s2Share: number;
}

export interface AutoAllocationParams {
  annualATPItems: Array<{ id: string; stepNumber?: number; [key: string]: any }>;
  targetSemester: '1' | '2';
  semesterPlanId: string;
  reservedNonAtpJP?: number;
  s1Capacity: {
    semesterPlanId?: string;
    availableJP: number | null;
    effectiveWeeks: number | null;
    effectiveWeekSlots?: number | null;
    actualScheduledWeeklyJP: number | null;
    isCalendarConfirmed: boolean;
  };
  s2Capacity: {
    semesterPlanId?: string;
    availableJP: number | null;
    effectiveWeeks: number | null;
    effectiveWeekSlots?: number | null;
    actualScheduledWeeklyJP: number | null;
    isCalendarConfirmed: boolean;
  };
}

export interface AutoAllocationResult {
  status:
    | 'SUCCESS'
    | 'NOT_READY'
    | 'INSUFFICIENT_EFFECTIVE_WEEKS'
    | 'INSUFFICIENT_ATP_CAPACITY'
    | 'NO_ITEMS';
  allocations: TimeAllocation[];
  s1ItemsCount: number;
  s2ItemsCount: number;
  message?: string;
}

/**
 * Partisi Deterministik ATP Tahunan Antar Semester berdasarkan Proporsi Kapasitas (S1 & S2)
 * Jika seluruh item memiliki semester hint (1 atau 2), partisi menggunakan hint tersebut.
 */
export function partitionAnnualATP<T extends { stepNumber?: number; semester?: any }>(
  annualATPItems: T[],
  s1AvailableJP: number,
  s2AvailableJP: number
): ATPPartitionResult<T> {
  const sortedItems = [...annualATPItems].sort((a, b) => {
    const stepA = typeof a.stepNumber === 'number' ? a.stepNumber : 0;
    const stepB = typeof b.stepNumber === 'number' ? b.stepNumber : 0;
    return stepA - stepB;
  });

  const totalItems = sortedItems.length;
  const s1Cap = Math.max(0, s1AvailableJP || 0);
  const s2Cap = Math.max(0, s2AvailableJP || 0);
  const totalCapacity = s1Cap + s2Cap;

  if (totalItems === 0 || totalCapacity === 0) {
    return {
      s1Items: [],
      s2Items: [],
      s1Share: 0,
      s2Share: 0,
    };
  }

  const s1Share = s1Cap / totalCapacity;
  const s2Share = s2Cap / totalCapacity;

  // Cek apakah SELURUH item memiliki hint semester valid (1 atau 2)
  const allHaveValidSemesterHint =
    totalItems > 0 &&
    sortedItems.every(
      (item) => item.semester === 1 || item.semester === 2
    );

  if (allHaveValidSemesterHint) {
    const s1Items = sortedItems.filter((item) => item.semester === 1);
    const s2Items = sortedItems.filter((item) => item.semester === 2);

    return {
      s1Items,
      s2Items,
      s1Share,
      s2Share,
    };
  }

  let s1Count = Math.round(totalItems * s1Share);

  // Jika kedua semester memiliki kapasitas > 0 dan total item > 1, cegah salah satu semester bernilai 0
  if (totalItems > 1 && s1Cap > 0 && s2Cap > 0) {
    if (s1Count < 1) s1Count = 1;
    if (s1Count > totalItems - 1) s1Count = totalItems - 1;
  }

  const s1Items = sortedItems.slice(0, s1Count);
  const s2Items = sortedItems.slice(s1Count);

  return {
    s1Items,
    s2Items,
    s1Share,
    s2Share,
  };
}

/**
 * Susun Alokasi Waktu Semester Otomatis (ATP Tahunan -> Semester -> Pekan -> JP)
 */
export function buildAutomaticSemesterAllocations(
  params: AutoAllocationParams
): AutoAllocationResult {
  const {
    annualATPItems,
    targetSemester,
    semesterPlanId,
    s1Capacity,
    s2Capacity,
  } = params;

  // 1. Validasi Kesiapan Semester 1 & Semester 2
  const isS1Ready =
    Boolean(s1Capacity?.isCalendarConfirmed) &&
    typeof s1Capacity?.actualScheduledWeeklyJP === 'number' &&
    s1Capacity.actualScheduledWeeklyJP > 0 &&
    typeof s1Capacity?.effectiveWeeks === 'number' &&
    s1Capacity.effectiveWeeks > 0 &&
    typeof s1Capacity?.availableJP === 'number' &&
    s1Capacity.availableJP > 0;

  const isS2Ready =
    Boolean(s2Capacity?.isCalendarConfirmed) &&
    typeof s2Capacity?.actualScheduledWeeklyJP === 'number' &&
    s2Capacity.actualScheduledWeeklyJP > 0 &&
    typeof s2Capacity?.effectiveWeeks === 'number' &&
    s2Capacity.effectiveWeeks > 0 &&
    typeof s2Capacity?.availableJP === 'number' &&
    s2Capacity.availableJP > 0;

  if (!isS1Ready || !isS2Ready) {
    return {
      status: 'NOT_READY',
      allocations: [],
      s1ItemsCount: 0,
      s2ItemsCount: 0,
      message:
        'Lengkapi kalender dan JP aktual Semester 1 & 2 agar pembagian ATP tahunan dapat dihitung secara konsisten.',
    };
  }

  // Konsistensi identitas target semester dan semesterPlanId (Fail-closed)
  if (
    (targetSemester === '1' && s1Capacity?.semesterPlanId && semesterPlanId !== s1Capacity.semesterPlanId) ||
    (targetSemester === '2' && s2Capacity?.semesterPlanId && semesterPlanId !== s2Capacity.semesterPlanId) ||
    (targetSemester === '1' && s2Capacity?.semesterPlanId && s1Capacity?.semesterPlanId !== s2Capacity.semesterPlanId && semesterPlanId === s2Capacity.semesterPlanId) ||
    (targetSemester === '2' && s1Capacity?.semesterPlanId && s1Capacity.semesterPlanId !== s2Capacity?.semesterPlanId && semesterPlanId === s1Capacity.semesterPlanId)
  ) {
    return {
      status: 'NOT_READY',
      allocations: [],
      s1ItemsCount: 0,
      s2ItemsCount: 0,
      message: `Inkonsistensi: targetSemester '${targetSemester}' tidak sesuai dengan semesterPlanId '${semesterPlanId}'.`,
    };
  }

  if (!annualATPItems || annualATPItems.length === 0) {
    return {
      status: 'NO_ITEMS',
      allocations: [],
      s1ItemsCount: 0,
      s2ItemsCount: 0,
      message: 'Tidak ada item ATP tahunan yang dapat dialokasikan.',
    };
  }

  // 2. Partisi ATP deterministik
  const partition = partitionAnnualATP(
    annualATPItems,
    s1Capacity.availableJP!,
    s2Capacity.availableJP!
  );

  const targetItems = targetSemester === '1' ? partition.s1Items : partition.s2Items;
  const targetCap = targetSemester === '1' ? s1Capacity : s2Capacity;
  const effectiveWeeks = targetCap.effectiveWeeks!;
  const availableJP = targetCap.availableJP!;
  const weeklyJP = targetCap.actualScheduledWeeklyJP!;

  const reservedJP = Math.max(0, Number(params.reservedNonAtpJP) || 0);
  const targetATPAvailableJP = availableJP - reservedJP;

  if (targetItems.length === 0) {
    return {
      status: 'SUCCESS',
      allocations: [],
      s1ItemsCount: partition.s1Items.length,
      s2ItemsCount: partition.s2Items.length,
      message: 'Tidak ada ATP yang dialokasikan untuk semester ini.',
    };
  }

  // 3. Batasi jika alokasi non-ATP menghabiskan kapasitas JP semester aktif
  if (targetATPAvailableJP <= 0) {
    return {
      status: 'INSUFFICIENT_ATP_CAPACITY',
      allocations: [],
      s1ItemsCount: partition.s1Items.length,
      s2ItemsCount: partition.s2Items.length,
      message: `Kapasitas JP tidak mencukupi untuk ATP setelah dikurangi alokasi non-ATP (${reservedJP} JP dari total ${availableJP} JP tersedia).`,
    };
  }

  // Fail-closed jika kapasitas JP tersisa lebih kecil dari jumlah ATP item (kurang dari minimal 1 JP per ATP)
  if (targetATPAvailableJP < targetItems.length) {
    return {
      status: 'INSUFFICIENT_ATP_CAPACITY',
      allocations: [],
      s1ItemsCount: partition.s1Items.length,
      s2ItemsCount: partition.s2Items.length,
      message: `Kapasitas JP (${targetATPAvailableJP} JP) tidak mencukupi untuk mengalokasikan minimal 1 JP per materi (${targetItems.length} materi ATP).`,
    };
  }

  // Discrete week slots for scheduling
  const weekSlots = Math.floor(
    targetCap.effectiveWeekSlots ||
      (targetCap.effectiveWeeks ? Math.ceil(targetCap.effectiveWeeks) : 18)
  );

  // 4. Batasi jika jumlah item ATP melebihi slot minggu efektif (Fail Closed)
  if (targetItems.length > weekSlots) {
    return {
      status: 'INSUFFICIENT_EFFECTIVE_WEEKS',
      allocations: [],
      s1ItemsCount: partition.s1Items.length,
      s2ItemsCount: partition.s2Items.length,
      message: `Jumlah item ATP (${targetItems.length}) melebihi jumlah minggu efektif (${weekSlots}) pada Semester ${targetSemester}.`,
    };
  }

  // 5. Distribusi pekan kontigu secara seimbang berbasis discrete week slots
  const n = targetItems.length;
  const baseWeeks = Math.floor(weekSlots / n);
  const remainder = weekSlots % n;

  const itemWeekCounts: number[] = [];
  for (let i = 0; i < n; i++) {
    itemWeekCounts.push(baseWeeks + (i < remainder ? 1 : 0));
  }

  const weekRanges: Array<{ startWeek: number; endWeek: number }> = [];
  let currentWeek = 1;
  for (let i = 0; i < n; i++) {
    const wCount = itemWeekCounts[i];
    const rawStart = currentWeek;
    const rawEnd = currentWeek + wCount - 1;
    const norm = normalizeWeekRange(rawStart, rawEnd, weekSlots);
    weekRanges.push(norm);
    currentWeek = norm.endWeek + 1;
  }

  // 6. Alokasi JP berdasar weekly JP aktual dan sinkronisasi tepat ke targetATPAvailableJP
  const rawJPs = itemWeekCounts.map((w) => w * weeklyJP);
  const totalRawJP = rawJPs.reduce((a, b) => a + b, 0);
  const diff = targetATPAvailableJP - totalRawJP;

  const allocatedJPs = [...rawJPs];
  if (diff !== 0) {
    if (allocatedJPs[allocatedJPs.length - 1] + diff > 0) {
      allocatedJPs[allocatedJPs.length - 1] += diff;
    } else {
      let remaining = targetATPAvailableJP;
      for (let i = 0; i < n; i++) {
        if (i === n - 1) {
          allocatedJPs[i] = Math.max(1, remaining);
        } else {
          const share = Math.max(
            1,
            Math.floor((rawJPs[i] / (totalRawJP || 1)) * targetATPAvailableJP)
          );
          allocatedJPs[i] = share;
          remaining -= share;
        }
      }
    }
  }

  // 7. Buat objek TimeAllocation kanonikal
  const allocations: TimeAllocation[] = targetItems.map((item, idx) => {
    const range = weekRanges[idx];
    const jp = allocatedJPs[idx];
    return {
      id: `alloc-${semesterPlanId}-${item.id}`,
      academicSettingId: semesterPlanId,
      sourceType: 'ATP_ITEM',
      sourceId: item.id,
      atpItemId: item.id,
      semester: targetSemester === '1' ? '1 (Ganjil)' : '2 (Genap)',
      allocatedJP: jp,
      jp,
      startWeek: range.startWeek,
      endWeek: range.endWeek,
      weekNumber: range.startWeek,
    };
  });

  return {
    status: 'SUCCESS',
    allocations,
    s1ItemsCount: partition.s1Items.length,
    s2ItemsCount: partition.s2Items.length,
  };
}

/**
 * Canonical Semester JP Resolver:
 * Hierarchy:
 * A. SemesterJPSetting.actualScheduledWeeklyJP (Semester Override / Confirmed)
 * B. AnnualJPReference.referenceWeeklyEquivalentJP (Default JP/pekan dari Data Pembelajaran)
 * C. Unresolved
 */
export function resolveSemesterJP(
  semesterPlanId: string,
  state: {
    semesterPlans?: Array<{ id: string; semester?: number; yearPlanId: string }>;
    semesterJPSettings?: Array<{ semesterPlanId: string; value?: SemesterJPSetting }>;
    annualJPReferences?: Array<{ yearPlanId: string; value?: any }>;
  },
  overrideSetting?: SemesterJPSetting
): ResolvedSemesterJP {
  return resolveSemesterJPFromState(semesterPlanId, state, overrideSetting);
}

/**
 * Resolver Kapasitas Semester dari Model Penyimpanan V5
 */
export function resolveSemesterCapacityV5(
  semesterPlanId: string,
  state: {
    semesterPlans?: Array<{ id: string; semester: number; yearPlanId: string }>;
    semesterData?: {
      academicCalendar?: Array<{ semesterPlanId: string; value?: { calendar?: AcademicCalendar; days?: CalendarDay[] } }>;
      subjectWeeklySchedules?: Array<{ semesterPlanId: string; value: SubjectWeeklySchedule }>;
    };
    semesterJPSettings?: Array<{ semesterPlanId: string; value?: SemesterJPSetting }>;
    annualJPReferences?: Array<{ yearPlanId: string; value?: any }>;
  },
  override?: {
    calendar?: AcademicCalendar;
    calendarDays?: CalendarDay[];
    semesterJPSetting?: SemesterJPSetting;
  }
): SemesterCapacityInfo {
  const sp = state.semesterPlans?.find((s) => s.id === semesterPlanId);
  const semNumber: '1' | '2' = sp?.semester === 2 ? '2' : '1';

  const calData = override?.calendar
    ? { calendar: override.calendar, days: override.calendarDays || [] }
    : state.semesterData?.academicCalendar?.find((e) => e.semesterPlanId === semesterPlanId)?.value;

  const cal = calData?.calendar;
  const days = calData?.days || [];

  const isCalendarConfirmed = cal?.workflowStatus === 'CONFIRMED';
  const effectiveDayResult = cal ? calculateEffectiveDays(cal, days) : null;
  const effectiveLearningDays = effectiveDayResult?.effectiveLearningDays ?? null;
  const schoolDaysPerWeek =
    cal?.schoolDaysPerWeek === 5 || cal?.schoolDaysPerWeek === 6
      ? cal.schoolDaysPerWeek
      : null;

  const effectiveWeeksRes =
    effectiveLearningDays !== null && schoolDaysPerWeek !== null
      ? calculateEffectiveWeeks(effectiveLearningDays, schoolDaysPerWeek)
      : null;

  const effectiveWeeks =
    effectiveWeeksRes?.status === 'RESOLVED' ? effectiveWeeksRes.effectiveWeeksRounded : null;

  // Derive discrete week slots from actual calendar week grouping with fallback to ceil(equivalent)
  const effectiveWeeksList = cal ? getEffectiveWeeksList(cal, days) : [];
  const effectiveWeekSlots =
    effectiveWeeksList.length > 0
      ? effectiveWeeksList.length
      : effectiveWeeksRes?.status === 'RESOLVED' && effectiveWeeksRes.effectiveWeeksEquivalent
      ? Math.ceil(effectiveWeeksRes.effectiveWeeksEquivalent)
      : effectiveWeeks !== null
      ? Math.ceil(effectiveWeeks)
      : null;

  const resolvedJP = resolveSemesterJP(semesterPlanId, state, override?.semesterJPSetting);
  const actualScheduledWeeklyJP = resolvedJP.weeklyJP;
  const jpSource = resolvedJP.source;
  const isJPOverridden = resolvedJP.isOverride;
  const defaultAnnualWeeklyJP = resolvedJP.defaultAnnualWeeklyJP;

  const capacity = resolveCalendarSubjectCapacity({ semesterPlanId, calendar: cal, calendarDays: days,
    weeklyJP: actualScheduledWeeklyJP,
    schedule: state.semesterData?.subjectWeeklySchedules?.find(e => e.semesterPlanId === semesterPlanId)?.value });
  const availableJP = sp && isCalendarConfirmed ? capacity.availableJP : null;

  const isReady = Boolean(
    isCalendarConfirmed &&
    actualScheduledWeeklyJP !== null &&
    actualScheduledWeeklyJP > 0 &&
    effectiveWeekSlots !== null &&
    effectiveWeekSlots > 0 &&
    availableJP !== null &&
    availableJP > 0
  );

  const totalMeetingCapacity = capacity.totalMeetingSlots ?? (
    effectiveWeekSlots !== null && actualScheduledWeeklyJP !== null && state.semesterData?.subjectWeeklySchedules?.find(e => e.semesterPlanId === semesterPlanId)?.value?.sessions?.length
      ? effectiveWeekSlots * state.semesterData.subjectWeeklySchedules.find(e => e.semesterPlanId === semesterPlanId)!.value.sessions.length
      : null
  );

  return {
    semesterPlanId,
    semester: semNumber,
    isCalendarConfirmed,
    effectiveWeeks,
    effectiveWeekSlots,
    effectiveLearningDays,
    actualScheduledWeeklyJP,
    jpSource,
    isJPOverridden,
    defaultAnnualWeeklyJP,
    availableJP,
    capacitySource: capacity.capacitySource,
    calendarLostJP: capacity.calendarLostJP,
    totalMeetingSlots: capacity.totalMeetingSlots ?? null,
    totalMeetingCapacity,
    isReady,
  };
}

/** One capacity authority: dated subject slots when available, otherwise an explicitly marked day estimate. */
export function resolveCalendarSubjectCapacity(params: {
  semesterPlanId: string;
  calendar?: AcademicCalendar;
  calendarDays?: CalendarDay[];
  weeklyJP: number | null;
  schedule?: SubjectWeeklySchedule;
}) {
  const { semesterPlanId, calendar, calendarDays = [], weeklyJP, schedule } = params;
  const days = calendar ? calculateEffectiveDays(calendar, calendarDays) : null;
  const estimate = calculateAvailableJP({
    subjectWeeklyJP: weeklyJP,
    effectiveLearningDays: days?.effectiveLearningDays,
    schoolDaysPerWeek: calendar?.schoolDaysPerWeek,
    calendarStatus: days?.status || 'UNRESOLVED',
    effectiveDayStatus: days?.status || 'UNRESOLVED',
    weeklyJPSource: 'DEFAULT_ANNUAL',
  });
  const unresolved = {
    ...estimate,
    status: 'UNRESOLVED' as const,
    availableJP: null,
    capacitySource: 'UNRESOLVED' as const,
    calendarLostJP: null as number | null,
    totalMeetingSlots: null as number | null,
  };
  if (!calendar || days?.status !== 'RESOLVED' || estimate.availableJP === null) return unresolved;

  const maxDay = calendar.schoolDaysPerWeek === 6 ? 6 : 5;
  const allDated = Boolean(
    schedule &&
    schedule.sessions &&
    schedule.sessions.length > 0 &&
    schedule.sessions.every(
      (session) => typeof session.dayOfWeek === 'number' && session.dayOfWeek >= 1 && session.dayOfWeek <= maxDay
    )
  );

  if (allDated) {
    const slots = resolveEffectiveSubjectSlots({
      semesterPlanId,
      schedule,
      expectedWeeklyJP: weeklyJP,
      calendar,
      calendarDays,
      schoolDaysPerWeek: calendar.schoolDaysPerWeek,
    });
    if (!slots.isReady || schedule?.semesterPlanId !== semesterPlanId) {
      return {
        ...unresolved,
        unresolvedReason: slots.errors.join('; ') || 'Jadwal mapel tidak cocok dengan semester.',
      };
    }
    return {
      ...estimate,
      availableJP: slots.totalJP,
      capacitySource: 'ACTUAL_SLOTS' as const,
      calendarLostJP: slots.excludedOccurrences.reduce((sum, occurrence) => sum + occurrence.jp, 0),
      totalMeetingSlots: slots.totalMeetingSlots,
      formula: 'Jumlah JP slot mapel pada hari pembelajaran',
      formulaCalculation: `${slots.totalJP} JP`,
    };
  }

  // Legacy session patterns without weekdays cannot identify actual dates; preserve the estimate.
  const nominal = Math.round(((weeklyJP || 0) * days.scheduledSchoolDays) / calendar.schoolDaysPerWeek!);
  return {
    ...estimate,
    capacitySource: 'EFFECTIVE_DAY_ESTIMATE' as const,
    calendarLostJP: Math.max(0, nominal - estimate.availableJP),
    totalMeetingSlots: null,
  };
}

/**
 * Convenience helper to resolve semester capacity for an explicit semesterPlanId
 * directly from V5 persistent storage without requiring activeSemesterPlan.
 */
export function getSemesterCapacityV5(
  semesterPlanId: string,
  override?: {
    calendar?: AcademicCalendar;
    calendarDays?: CalendarDay[];
    semesterJPSetting?: SemesterJPSetting;
  }
): SemesterCapacityInfo {
  const state = loadStorageV5();
  return resolveSemesterCapacityV5(semesterPlanId, state, override);
}

