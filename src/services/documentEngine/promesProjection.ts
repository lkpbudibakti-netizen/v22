import { resolveCalendarSubjectCapacity } from '../jpEngine';
import { DocumentGenerationContext } from './types';
import { EffectiveWeekInfo, TimeAllocation } from '../../types';
import {
  calculateEffectiveDays,
  calculateEffectiveWeeks,
  getEffectiveWeeksList,
  calculateAvailableJP,
  validateTimeAllocations,
} from '../jpEngine';
import { isK13 as isK13Check } from '../curriculumRouter';
import { resolveSemesterJPFromValues } from '../semesterJPResolver';
import { resolveMerdekaCanonicalTimeProjection } from './meetingTimeProjection';

export interface PromesMonthHeader {
  monthKey: string;
  monthName: string;
  monthNumber: number; // 1..12
  year?: number;
  weeks: Array<{
    weekIndex: number;
    startDate?: string;
    endDate?: string;
  }>;
}

export interface PromesRow {
  id: string;
  unitId?: string;
  unitTitle?: string;
  atpItemId?: string;
  sourceType: 'ATP_ITEM' | 'ASSESSMENT' | 'RESERVE' | 'KD' | 'UNIT' | 'OTHER';
  tpCode: string;
  tpStatement: string;
  materialScope: string;
  allocatedJP: number;
  startWeek: number;
  endWeek: number;
  monthlyJP: Record<string, number>; // monthName or monthKey -> JP
  weekAllocations: Record<number, number>; // weekIndex -> JP
  notes?: string;
}

export interface PromesProjection {
  semester: '1' | '2';
  curriculumType: 'KURIKULUM_MERDEKA' | 'K13';
  actualScheduledWeeklyJP: number | null;
  effectiveLearningDays: number | null;
  effectiveWeeksEquivalent: number | null;
  effectiveWeekSlots: number | null;
  availableJP: number | null;
  monthHeaders: PromesMonthHeader[];
  rows: PromesRow[];
  assessmentRows: PromesRow[];
  reserveRows: PromesRow[];
  totalAllocatedJP: number;
  remainingJP: number;
  validationStatus: 'BALANCED' | 'UNDER_ALLOCATED' | 'OVER_ALLOCATED';
  isReady: boolean;
  unreadyReason?: string;
}

const INDONESIAN_MONTH_NAMES: Record<number, string> = {
  1: 'Juli', // Fallback or mapping will map date month numbers
  2: 'Agustus',
  3: 'September',
  4: 'Oktober',
  5: 'November',
  6: 'Desember',
};

const MONTH_NAMES_BY_NUMBER: Record<number, string> = {
  1: 'Januari',
  2: 'Februari',
  3: 'Maret',
  4: 'April',
  5: 'Mei',
  6: 'Juni',
  7: 'Juli',
  8: 'Agustus',
  9: 'September',
  10: 'Oktober',
  11: 'November',
  12: 'Desember',
};

/**
 * Pure Canonical PROMES Projection Builder
 */
export function buildAlokasiWaktuProjection(context: DocumentGenerationContext): PromesProjection {
  return buildPromesProjection(context);
}

export function buildPromesProjection(context: DocumentGenerationContext): PromesProjection {
  const { academicSetting, calendar, calendarDays = [], timeAllocations = [], atp, k13Analysis, semesterJPSetting, annualJPReference, documentMode } = context;

  const isK13 = isK13Check(academicSetting);
  const curriculumType: 'KURIKULUM_MERDEKA' | 'K13' = isK13 ? 'K13' : 'KURIKULUM_MERDEKA';

  const isSemesterGanjil =
    academicSetting?.semester?.includes('1') ||
    academicSetting?.semester?.toLowerCase().includes('ganjil');
  const semester: '1' | '2' = isSemesterGanjil ? '1' : '2';
  const activeSemesterNum = isSemesterGanjil ? 1 : 2;

  const defaultMonthNames = isSemesterGanjil
    ? ['Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
    : ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni'];

  const activeSettingPlanId = academicSetting?.id;

  // Defensive Semester Isolation for TimeAllocations (used for K13)
  const scopedTimeAllocations = activeSettingPlanId
    ? timeAllocations.filter((a) => !a.academicSettingId || a.academicSettingId === activeSettingPlanId)
    : timeAllocations;

  // Actual Weekly JP Source using shared canonical resolver
  const hasMismatchedSemesterJP = Boolean(semesterJPSetting && semesterJPSetting.semesterPlanId !== activeSettingPlanId);
  const resolvedSemesterJP = hasMismatchedSemesterJP
    ? resolveSemesterJPFromValues()
    : resolveSemesterJPFromValues(semesterJPSetting, annualJPReference);
  let actualScheduledWeeklyJP: number | null = resolvedSemesterJP.weeklyJP;
  if (isK13 && !actualScheduledWeeklyJP) {
    actualScheduledWeeklyJP = academicSetting?.subjectWeeklyJP || academicSetting?.totalHoursPerWeek || null;
  }

  // Calendar Capacity Analysis
  const hasCalendar = Boolean(calendar?.startDate && calendar?.endDate);
  const isCalendarConfirmed = calendar?.workflowStatus === 'CONFIRMED';

  let effectiveLearningDays: number | null = null;
  let effectiveWeeksEquivalent: number | null = null;
  let effectiveWeekSlots: number | null = null;
  let availableJP: number | null = null;
  let effectiveWeeksList: EffectiveWeekInfo[] = [];

  if (hasCalendar && calendar) {
    const effDaysRes = calculateEffectiveDays(calendar, calendarDays);
    effectiveLearningDays = effDaysRes.effectiveLearningDays;

    const schoolDaysPerWeek = calendar.schoolDaysPerWeek === 6 ? 6 : 5;
    const effWeeksRes = calculateEffectiveWeeks(effectiveLearningDays, schoolDaysPerWeek);
    if (effWeeksRes.status === 'RESOLVED') {
      effectiveWeeksEquivalent = effWeeksRes.effectiveWeeksRounded;
    }

    effectiveWeeksList = getEffectiveWeeksList(calendar, calendarDays);
    effectiveWeekSlots =
      effectiveWeeksList.length > 0
        ? effectiveWeeksList.length
        : effWeeksRes.status === 'RESOLVED' && effWeeksRes.effectiveWeeksEquivalent
        ? Math.ceil(effWeeksRes.effectiveWeeksEquivalent)
        : 18;

    const capacity = resolveCalendarSubjectCapacity({ semesterPlanId: academicSetting.id, calendar, calendarDays,
      weeklyJP: actualScheduledWeeklyJP, schedule: context.subjectWeeklySchedule });
    availableJP = capacity.availableJP;
  }

  // Data Mode Readiness Validation
  let isReady = true;
  let unreadyReason: string | undefined = undefined;

  if (documentMode !== 'blank') {
    if (hasMismatchedSemesterJP) {
      isReady = false;
      unreadyReason = 'Pengaturan JP bukan milik SemesterPlan aktif. Pilih pengaturan semester yang sesuai.';
    } else if (!hasCalendar || !isCalendarConfirmed) {
      isReady = false;
      unreadyReason = 'Program Semester belum dapat dibuat karena kalender pendidikan semester aktif belum dikonfirmasi.';
    } else if (availableJP === null) {
      isReady = false;
      unreadyReason = 'Kapasitas JP belum dapat dihitung: kalender parsial atau jadwal mapel tidak valid.';
    } else if (!actualScheduledWeeklyJP || actualScheduledWeeklyJP <= 0) {
      isReady = false;
      unreadyReason = 'Program Semester belum dapat dibuat karena Jam Pelajaran (JP) aktual semester aktif belum ditetapkan.';
    }
  }

  // Build Month Headers
  const monthHeaders: PromesMonthHeader[] = [];
  const totalSlots = effectiveWeekSlots || 18;

  if (effectiveWeeksList.length > 0) {
    const monthGroupMap = new Map<string, { monthKey: string; monthName: string; monthNumber: number; year?: number; weeks: Array<{ weekIndex: number; startDate?: string; endDate?: string }> }>();

    for (const info of effectiveWeeksList) {
      const mName = MONTH_NAMES_BY_NUMBER[info.month] || `Bulan ${info.month}`;
      const mKey = `${mName}`;

      if (!monthGroupMap.has(mKey)) {
        monthGroupMap.set(mKey, {
          monthKey: mKey,
          monthName: mName,
          monthNumber: info.month,
          year: info.year,
          weeks: [],
        });
      }
      monthGroupMap.get(mKey)!.weeks.push({
        weekIndex: info.weekIndex,
        startDate: info.startDate,
        endDate: info.endDate,
      });
    }

    // Ensure standard semester months are present in correct order
    for (const name of defaultMonthNames) {
      const existing = Array.from(monthGroupMap.values()).find((m) => m.monthName.toLowerCase() === name.toLowerCase());
      if (existing) {
        monthHeaders.push({
          monthKey: existing.monthName,
          monthName: existing.monthName,
          monthNumber: existing.monthNumber,
          year: existing.year,
          weeks: existing.weeks,
        });
      } else {
        monthHeaders.push({
          monthKey: name,
          monthName: name,
          monthNumber: 0,
          weeks: [],
        });
      }
    }
  } else {
    // Fallback default 6 month headers with equal week distribution
    const weeksPerMonth = Math.ceil(totalSlots / 6);
    let curWeek = 1;

    for (let i = 0; i < 6; i++) {
      const mName = defaultMonthNames[i] || `Bulan ${i + 1}`;
      const monthWeeks: Array<{ weekIndex: number }> = [];

      for (let w = 0; w < weeksPerMonth && curWeek <= totalSlots; w++) {
        monthWeeks.push({ weekIndex: curWeek++ });
      }

      monthHeaders.push({
        monthKey: mName,
        monthName: mName,
        monthNumber: i + 1,
        weeks: monthWeeks,
      });
    }
  }

  // Map Week Index -> Month Name
  const weekToMonthNameMap = new Map<number, string>();
  monthHeaders.forEach((mh) => {
    mh.weeks.forEach((w) => {
      weekToMonthNameMap.set(w.weekIndex, mh.monthName);
    });
  });

  const rows: PromesRow[] = [];
  const assessmentRows: PromesRow[] = [];
  const reserveRows: PromesRow[] = [];

  if (!isK13) {
    // KURIKULUM MERDEKA: Pure Canonical Scheduled Learning Meetings
    if (documentMode !== 'blank') {
      const canonical = resolveMerdekaCanonicalTimeProjection(context);

      if (!canonical.isReady) {
        isReady = false;
        unreadyReason = canonical.errors.length > 0
          ? `Program Semester belum dapat dibuat karena: ${canonical.errors.join(' ')}`
          : 'Program Semester belum dapat dibuat karena Jadwal Aktual semester aktif belum lengkap.';
      } else {
        const activeRows = canonical.rows.filter((r) => r.semester === activeSemesterNum);

        if (activeRows.length === 0) {
          isReady = false;
          unreadyReason = `Program Semester belum dapat dibuat karena Jadwal Aktual Semester ${activeSemesterNum} belum lengkap.`;
        } else {
          // Aggregate active semester canonical meetings by Unit/Bab
          const unitPromesMap = new Map<
            string,
            {
              unitId: string;
              unitTitle: string;
              unitOrder: number;
              allocatedJP: number;
              minWeek: number;
              maxWeek: number;
              weekAllocations: Record<number, number>;
              monthlyJP: Record<string, number>;
              linkedTpIds: string[];
              linkedAtpItemIds: string[];
              materialTitlesSet: Set<string>;
            }
          >();

          for (const row of activeRows) {
            if (!unitPromesMap.has(row.unitId)) {
              const monthlyInit: Record<string, number> = {};
              monthHeaders.forEach((mh) => {
                monthlyInit[mh.monthName] = 0;
              });

              unitPromesMap.set(row.unitId, {
                unitId: row.unitId,
                unitTitle: row.unitTitle,
                unitOrder: row.unitOrder,
                allocatedJP: 0,
                minWeek: row.weekIndex,
                maxWeek: row.weekIndex,
                weekAllocations: {},
                monthlyJP: monthlyInit,
                linkedTpIds: [],
                linkedAtpItemIds: [],
                materialTitlesSet: new Set(),
              });
            }

            const u = unitPromesMap.get(row.unitId)!;
            u.allocatedJP += row.jp;
            if (row.weekIndex < u.minWeek) u.minWeek = row.weekIndex;
            if (row.weekIndex > u.maxWeek) u.maxWeek = row.weekIndex;

            // Exact week allocation from exact schedule
            u.weekAllocations[row.weekIndex] = (u.weekAllocations[row.weekIndex] || 0) + row.jp;

            // Exact month allocation based on row.date
            const dateParts = row.date ? row.date.split('-') : [];
            let monthName = '';
            if (dateParts.length >= 2) {
              const mNum = parseInt(dateParts[1], 10);
              monthName = MONTH_NAMES_BY_NUMBER[mNum] || '';
            }
            if (!monthName) {
              monthName = weekToMonthNameMap.get(row.weekIndex) || defaultMonthNames[0];
            }

            u.monthlyJP[monthName] = (u.monthlyJP[monthName] || 0) + row.jp;

            for (const tpId of row.linkedTpIds || []) {
              if (!u.linkedTpIds.includes(tpId)) u.linkedTpIds.push(tpId);
            }
            for (const atpId of row.linkedAtpItemIds || []) {
              if (!u.linkedAtpItemIds.includes(atpId)) u.linkedAtpItemIds.push(atpId);
            }
            for (const mat of row.materials || []) {
              if (mat.title) u.materialTitlesSet.add(mat.title);
            }
          }

          const sortedUnits = Array.from(unitPromesMap.values()).sort((a, b) => a.unitOrder - b.unitOrder);
          const tpItems = context.tp?.items || [];

          for (const u of sortedUnits) {
            const matchedTps = tpItems.filter((t) => u.linkedTpIds.includes(t.id));
            const tpStatements = matchedTps.map((t) => t.statement).filter(Boolean);
            const tpCodes = matchedTps.map((t) => t.code).filter(Boolean);

            const tpCodeDisplay = tpCodes.length > 0 ? tpCodes.join(', ') : `Bab ${u.unitOrder}`;
            const tpStatementDisplay =
              tpStatements.length > 0
                ? `${u.unitTitle}\n• ${tpStatements.join('\n• ')}`
                : u.unitTitle;
            const materialScope = Array.from(u.materialTitlesSet).join(', ') || '-';

            rows.push({
              id: u.unitId,
              unitId: u.unitId,
              unitTitle: u.unitTitle,
              sourceType: 'UNIT',
              tpCode: tpCodeDisplay,
              tpStatement: tpStatementDisplay,
              materialScope,
              allocatedJP: u.allocatedJP,
              startWeek: u.minWeek,
              endWeek: u.maxWeek,
              monthlyJP: u.monthlyJP,
              weekAllocations: u.weekAllocations,
            });
          }
        }
      }
    }

    const totalAllocatedJP = rows.reduce((sum, r) => sum + r.allocatedJP, 0);
    const avail = availableJP;
    const remainingJP = avail !== null ? avail - totalAllocatedJP : 0;
    let validationStatus: PromesProjection['validationStatus'] = 'BALANCED';
    if (avail !== null) {
      if (totalAllocatedJP < avail) {
        validationStatus = 'UNDER_ALLOCATED';
      } else if (totalAllocatedJP === avail) {
        validationStatus = 'BALANCED';
      } else {
        validationStatus = 'OVER_ALLOCATED';
      }
    }

    return {
      semester,
      curriculumType,
      actualScheduledWeeklyJP,
      effectiveLearningDays,
      effectiveWeeksEquivalent,
      effectiveWeekSlots,
      availableJP,
      monthHeaders,
      rows,
      assessmentRows: [],
      reserveRows: [],
      totalAllocatedJP,
      remainingJP,
      validationStatus,
      isReady,
      unreadyReason,
    };
  }

  // KURIKULUM 2013 (K13) Legacy logic
  const buildRowFromAllocation = (
    id: string,
    sourceType: PromesRow['sourceType'],
    tpCode: string,
    tpStatement: string,
    materialScope: string,
    allocatedJP: number,
    rawStartWeek: number,
    rawEndWeek: number,
    atpItemId?: string,
    notes?: string
  ): PromesRow => {
    const startWeek = Math.max(1, Math.min(rawStartWeek || 1, totalSlots));
    const endWeek = Math.max(startWeek, Math.min(rawEndWeek || startWeek, totalSlots));

    const activeWeeks: number[] = [];
    for (let w = startWeek; w <= endWeek; w++) {
      activeWeeks.push(w);
    }

    const nWeeks = activeWeeks.length;
    const baseJP = Math.floor(allocatedJP / (nWeeks || 1));
    const remainder = allocatedJP % (nWeeks || 1);

    const weekAllocations: Record<number, number> = {};
    const monthlyJP: Record<string, number> = {};

    monthHeaders.forEach((mh) => {
      monthlyJP[mh.monthName] = 0;
    });

    for (let i = 0; i < nWeeks; i++) {
      const w = activeWeeks[i];
      const wJP = baseJP + (i < remainder ? 1 : 0);
      weekAllocations[w] = wJP;

      const mName = weekToMonthNameMap.get(w) || defaultMonthNames[Math.min(Math.floor((w - 1) / 3), 5)];
      monthlyJP[mName] = (monthlyJP[mName] || 0) + wJP;
    }

    return {
      id,
      atpItemId,
      sourceType,
      tpCode,
      tpStatement,
      materialScope,
      allocatedJP,
      startWeek,
      endWeek,
      monthlyJP,
      weekAllocations,
      notes,
    };
  };

  const k13Items = k13Analysis?.items || [];

  if (scopedTimeAllocations.length > 0) {
    for (const alloc of scopedTimeAllocations) {
      const jp = Number(alloc.allocatedJP ?? alloc.jp ?? 0);
      const startW = alloc.startWeek || alloc.weekNumber || 1;
      const endW = alloc.endWeek || startW;

      if (alloc.sourceType === 'KD' || alloc.sourceId) {
        const k13Match = k13Items.find((i) => i.id === alloc.sourceId || i.kd === alloc.sourceId);
        rows.push(
          buildRowFromAllocation(
            alloc.id,
            'KD',
            k13Match?.kd || alloc.sourceId || `KD.${rows.length + 1}`,
            k13Match?.indikator || k13Match?.tujuanPembelajaran || alloc.notes || '-',
            k13Match?.materi || '-',
            jp,
            startW,
            endW,
            undefined,
            alloc.notes
          )
        );
      } else if (alloc.sourceType === 'ASSESSMENT') {
        assessmentRows.push(
          buildRowFromAllocation(
            alloc.id,
            'ASSESSMENT',
            'ASESMEN',
            alloc.notes || 'Asesmen Sumatif / UH / PTS / PAS',
            'Asesmen K13',
            jp,
            startW,
            endW,
            undefined,
            alloc.notes
          )
        );
      } else if (alloc.sourceType === 'RESERVE') {
        reserveRows.push(
          buildRowFromAllocation(
            alloc.id,
            'RESERVE',
            'CADANGAN',
            alloc.notes || 'Alokasi Cadangan K13',
            'Cadangan',
            jp,
            startW,
            endW,
            undefined,
            alloc.notes
          )
        );
      }
    }
  } else {
    k13Items.forEach((item, idx) => {
      const jp = Number(item.alokasiJp || 4);
      const startW = Math.min(idx + 1, totalSlots);
      rows.push(
        buildRowFromAllocation(
          item.id || `k13-${idx}`,
          'KD',
          item.kd || `KD.${idx + 1}`,
          item.indikator || item.tujuanPembelajaran || '-',
          item.materi || '-',
          jp,
          startW,
          startW,
          undefined,
          undefined
        )
      );
    });
  }

  const avail = availableJP ?? 0;
  const validationRes = validateTimeAllocations(scopedTimeAllocations, avail);

  const totalAllocatedJP = validationRes.totalAllocatedJP;
  const remainingJP = validationRes.remainingJP;
  const validationStatus: PromesProjection['validationStatus'] = validationRes.status;

  return {
    semester,
    curriculumType,
    actualScheduledWeeklyJP,
    effectiveLearningDays,
    effectiveWeeksEquivalent,
    effectiveWeekSlots,
    availableJP,
    monthHeaders,
    rows,
    assessmentRows,
    reserveRows,
    totalAllocatedJP,
    remainingJP,
    validationStatus,
    isReady,
    unreadyReason,
  };
}
