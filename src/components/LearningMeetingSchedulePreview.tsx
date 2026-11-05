import React, { useMemo, useState, useEffect } from 'react';
import {
  ATPUnitMappingData,
  UnitExecutionPlanData,
  SubjectWeeklySchedule,
  AcademicCalendar,
  CalendarDay,
  LearningMeetingScheduleData,
  LearningMeetingScheduleEntry,
  ATPData,
  TPData,
} from '../types';
import { resolveEffectiveSubjectSlots } from '../services/subjectScheduleService';
import {
  resolveLearningMeetingSchedule,
  isLearningMeetingScheduleStale,
  buildLearningMeetingScheduleData,
  validateLearningMeetingScheduleData,
} from '../services/learningMeetingScheduleService';
import { resolveUnitSemesterPlacement } from '../services/unitSemesterPlanningService';
import { getEffectiveWeeksList, normalizeCalendarDayStatus } from '../services/jpEngine';
import {
  analyzeMeetingReconciliation,
  applyReconciliationAction,
  MeetingReconciliationAction,
  MeetingReconciliationAnalysis,
} from '../services/meetingReconciliationService';
import {
  requestMeetingReconciliationAI,
  AIMeetingReconciliationRecommendation,
} from '../services/aiService';
import {
  Calendar,
  AlertTriangle,
  Info,
  CheckCircle2,
  Ban,
  Layers,
  Save,
  Wrench,
  AlertCircle,
  Sparkles,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from 'lucide-react';

interface LearningMeetingSchedulePreviewProps {
  semesterPlanId: string;
  semester: 1 | 2;
  mapping?: ATPUnitMappingData;
  unitExecutionPlan?: UnitExecutionPlanData;
  schedule?: SubjectWeeklySchedule;
  expectedWeeklyJP: number | null;
  calendar?: AcademicCalendar;
  calendarDays?: CalendarDay[];
  schoolDaysPerWeek?: number | null;
  persistedSchedule?: LearningMeetingScheduleData;
  atp?: ATPData | null;
  tp?: TPData | null;
  subject?: string;
  grade?: string;
  phase?: string;
  onSaveLearningMeetingSchedule?: (
    data: LearningMeetingScheduleData,
    semesterPlanId: string
  ) => boolean;
  onSaveUnitExecutionPlan?: (data: UnitExecutionPlanData) => boolean;
}

const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const MONTH_NAMES = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

function formatIndonesianDate(isoDate: string): string {
  if (!isoDate) return '-';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const d = new Date(year, month, day);
  const dayName = DAY_NAMES[d.getDay()];
  const monthName = MONTH_NAMES[month];
  return `${dayName}, ${day} ${monthName} ${year}`;
}

function mapExcludedReason(reason: string): string {
  switch (reason) {
    case 'HOLIDAY':
      return 'Libur';
    case 'BREAK':
      return 'Libur/Jeda Semester';
    case 'NON_LEARNING':
      return 'Non-Pembelajaran';
    case 'SCHOOL_EVENT':
      return 'Kegiatan Sekolah';
    case 'ASSESSMENT':
      return 'Asesmen';
    default:
      return reason;
  }
}

interface ManualSelection {
  date: string;
  sessionId: string;
}

interface ReplacementCandidate {
  date: string;
  dayOfWeek: 1 | 2 | 3 | 4 | 5 | 6;
  sessionId: string;
  sessionOrder: number;
  jp: number;
  weekIndex: number;
  label: string;
  value: string;
}

export const LearningMeetingSchedulePreview: React.FC<LearningMeetingSchedulePreviewProps> = ({
  semesterPlanId,
  semester,
  mapping,
  unitExecutionPlan,
  schedule,
  expectedWeeklyJP,
  calendar,
  calendarDays = [],
  schoolDaysPerWeek,
  persistedSchedule,
  atp,
  tp,
  subject,
  grade,
  phase,
  onSaveLearningMeetingSchedule,
  onSaveUnitExecutionPlan,
}) => {
  // Manual reconciliation draft selections: meetingId -> { date, sessionId }
  const [manualSelections, setManualSelections] = useState<Record<string, ManualSelection>>({});
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [saveMessage, setSaveMessage] = useState<string>('');

  // AI & Reconciliation states
  const [aiRecommendations, setAiRecommendations] = useState<
    Record<
      string,
      {
        loading: boolean;
        recommendation?: AIMeetingReconciliationRecommendation;
        error?: string;
      }
    >
  >({});
  const [showSecondaryOptions, setShowSecondaryOptions] = useState<Record<string, boolean>>({});
  const [selectedMergeTarget, setSelectedMergeTarget] = useState<Record<string, string>>({});
  const [reconciliationNotice, setReconciliationNotice] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  // 1. Resolve exact subject slots using existing resolver
  const subjectSlotResult = useMemo(() => {
    return resolveEffectiveSubjectSlots({
      semesterPlanId,
      schedule,
      expectedWeeklyJP,
      calendar,
      calendarDays,
      schoolDaysPerWeek,
    });
  }, [
    semesterPlanId,
    schedule,
    expectedWeeklyJP,
    calendar,
    calendarDays,
    schoolDaysPerWeek,
  ]);

  // 2. Resolve Meeting schedule using existing resolver
  const scheduleResult = useMemo(() => {
    if (!mapping || !unitExecutionPlan) return null;
    return resolveLearningMeetingSchedule({
      semesterPlanId,
      semester,
      mapping,
      unitExecutionPlan,
      subjectSlotResult,
    });
  }, [
    semesterPlanId,
    semester,
    mapping,
    unitExecutionPlan,
    subjectSlotResult,
  ]);

  // 3. Resolve semester placement to get canonical units for target semester
  const placement = useMemo(() => {
    if (!unitExecutionPlan || !mapping) return null;
    return resolveUnitSemesterPlacement(unitExecutionPlan, mapping);
  }, [unitExecutionPlan, mapping]);

  const semesterUnitIds = useMemo(() => {
    if (!placement || !placement.isValid) return new Set<string>();
    return new Set(semester === 1 ? placement.semester1UnitIds : placement.semester2UnitIds);
  }, [placement, semester]);

  const unitMap = useMemo(() => {
    const map = new Map<string, string>();
    mapping?.units?.forEach((u) => map.set(u.id, u.title));
    return map;
  }, [mapping]);

  const mappingUnitOrderMap = useMemo(() => {
    const map = new Map<string, number>();
    mapping?.units?.forEach((u) => map.set(u.id, u.order));
    return map;
  }, [mapping]);

  // 4. Flatten all canonical meetings for this semester
  const semesterMeetings = useMemo(() => {
    if (!unitExecutionPlan || semesterUnitIds.size === 0) return [];
    const units = (unitExecutionPlan.units || [])
      .filter((u) => semesterUnitIds.has(u.unitId))
      .sort((a, b) => {
        const orderA = mappingUnitOrderMap.get(a.unitId) ?? 999;
        const orderB = mappingUnitOrderMap.get(b.unitId) ?? 999;
        return orderA - orderB;
      });

    const flat: Array<{
      meetingId: string;
      meetingTitle: string;
      unitId: string;
      unitTitle: string;
      order: number;
    }> = [];

    for (const u of units) {
      const uTitle = unitMap.get(u.unitId) || `Unit ${u.unitId}`;
      const sortedMeetings = [...(u.meetings || [])].sort((a, b) => a.order - b.order);
      for (const m of sortedMeetings) {
        flat.push({
          meetingId: m.id,
          meetingTitle: m.title,
          unitId: u.unitId,
          unitTitle: uTitle,
          order: m.order,
        });
      }
    }
    return flat;
  }, [unitExecutionPlan, semesterUnitIds, mappingUnitOrderMap, unitMap]);

  // Check if persisted schedule is stale
  const isPersistedStale = useMemo(() => {
    if (!persistedSchedule || !mapping || !unitExecutionPlan || !schedule || !calendar || !expectedWeeklyJP) {
      return false;
    }
    return isLearningMeetingScheduleStale({
      schedule: persistedSchedule,
      mappingUpdatedAt: mapping.updatedAt,
      unitExecutionPlanUpdatedAt: unitExecutionPlan.updatedAt,
      subjectWeeklyScheduleUpdatedAt: schedule.updatedAt,
      calendarUpdatedAt: calendar.updatedAt,
      expectedWeeklyJP,
    });
  }, [persistedSchedule, mapping, unitExecutionPlan, schedule, calendar, expectedWeeklyJP]);

  // Initialize/restore manual overrides from non-stale persistedSchedule
  useEffect(() => {
    if (persistedSchedule && !isPersistedStale) {
      const initial: Record<string, ManualSelection> = {};
      for (const entry of persistedSchedule.entries) {
        if (entry.mode === 'MANUAL_OVERRIDE') {
          initial[entry.meetingId] = {
            date: entry.date,
            sessionId: entry.sessionId,
          };
        }
      }
      setManualSelections(initial);
    } else {
      setManualSelections({});
    }
    setSaveStatus('idle');
    setSaveMessage('');
  }, [persistedSchedule, isPersistedStale]);

  // Available sessions from subjectWeeklySchedule
  const availableSessions = useMemo(() => {
    return [...(schedule?.sessions || [])].sort((a, b) => a.order - b.order);
  }, [schedule?.sessions]);

  // Effective weeks list from calendar
  const effectiveWeeks = useMemo(() => {
    return getEffectiveWeeksList(calendar, calendarDays);
  }, [calendar, calendarDays]);

  // All potential replacement candidates: EFFECTIVE_LEARNING dates × availableSessions
  const allPotentialCandidates = useMemo<ReplacementCandidate[]>(() => {
    if (!calendar?.startDate || !calendar?.endDate || !calendarDays || availableSessions.length === 0) {
      return [];
    }
    const start = calendar.startDate;
    const end = calendar.endDate;

    const effectiveDates: Array<{ date: string; dayOfWeek: 1 | 2 | 3 | 4 | 5 | 6; weekIndex: number }> = [];

    for (const day of calendarDays) {
      if (!day || !day.date) continue;
      if (day.date < start || day.date > end) continue;
      if (normalizeCalendarDayStatus(day.status) !== 'EFFECTIVE_LEARNING') continue;

      const parts = day.date.split('-');
      const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      const jsDay = d.getDay();
      if (jsDay === 0) continue; // Sunday

      const wk = effectiveWeeks.find((w) => day.date >= w.startDate && day.date <= w.endDate);

      effectiveDates.push({
        date: day.date,
        dayOfWeek: jsDay as 1 | 2 | 3 | 4 | 5 | 6,
        weekIndex: wk ? wk.weekIndex : 1,
      });
    }

    effectiveDates.sort((a, b) => a.date.localeCompare(b.date));

    const candidates: ReplacementCandidate[] = [];
    for (const d of effectiveDates) {
      for (const s of availableSessions) {
        candidates.push({
          date: d.date,
          dayOfWeek: d.dayOfWeek,
          sessionId: s.id,
          sessionOrder: s.order,
          jp: s.jp,
          weekIndex: d.weekIndex,
          label: `${formatIndonesianDate(d.date)} • Sesi ${s.order} • ${s.jp} JP`,
          value: `${d.date}|${s.id}`,
        });
      }
    }

    return candidates;
  }, [calendar?.startDate, calendar?.endDate, calendarDays, availableSessions, effectiveWeeks]);

  // Set of occupied AUTO date:session keys
  const autoDateSessions = useMemo(() => {
    const set = new Set<string>();
    (scheduleResult?.scheduledEntries || []).forEach((e) => {
      set.add(`${e.date}:${e.sessionId}`);
    });
    return set;
  }, [scheduleResult?.scheduledEntries]);

  // Compute filtered candidates per unscheduled meeting with chronological enforcement
  const candidatesByMeetingId = useMemo(() => {
    const map = new Map<string, ReplacementCandidate[]>();
    if (!scheduleResult || !scheduleResult.unscheduledMeetingIds) return map;

    const sessionOrderMap = new Map<string, number>();
    availableSessions.forEach((s) => sessionOrderMap.set(s.id, s.order));

    for (const mId of scheduleResult.unscheduledMeetingIds) {
      const targetIdx = semesterMeetings.findIndex((m) => m.meetingId === mId);
      if (targetIdx === -1) {
        map.set(mId, []);
        continue;
      }

      // 1. Find previous scheduled boundary
      let prevSlot: { date: string; sessionOrder: number } | null = null;
      for (let i = targetIdx - 1; i >= 0; i--) {
        const prevM = semesterMeetings[i];
        const autoEntry = scheduleResult.scheduledEntries.find((e) => e.meetingId === prevM.meetingId);
        if (autoEntry) {
          prevSlot = { date: autoEntry.date, sessionOrder: sessionOrderMap.get(autoEntry.sessionId) ?? 1 };
          break;
        }
        const manSel = manualSelections[prevM.meetingId];
        if (manSel && manSel.date && manSel.sessionId) {
          prevSlot = { date: manSel.date, sessionOrder: sessionOrderMap.get(manSel.sessionId) ?? 1 };
          break;
        }
      }

      // 2. Find next scheduled boundary
      let nextSlot: { date: string; sessionOrder: number } | null = null;
      for (let i = targetIdx + 1; i < semesterMeetings.length; i++) {
        const nextM = semesterMeetings[i];
        const autoEntry = scheduleResult.scheduledEntries.find((e) => e.meetingId === nextM.meetingId);
        if (autoEntry) {
          nextSlot = { date: autoEntry.date, sessionOrder: sessionOrderMap.get(autoEntry.sessionId) ?? 1 };
          break;
        }
        const manSel = manualSelections[nextM.meetingId];
        if (manSel && manSel.date && manSel.sessionId) {
          nextSlot = { date: manSel.date, sessionOrder: sessionOrderMap.get(manSel.sessionId) ?? 1 };
          break;
        }
      }

      // 3. Collect manual selections from other meetings
      const otherManualKeys = new Set<string>();
      for (const [otherMId, sel] of Object.entries(manualSelections) as [string, ManualSelection][]) {
        if (otherMId !== mId && sel && sel.date && sel.sessionId) {
          otherManualKeys.add(`${sel.date}:${sel.sessionId}`);
        }
      }

      // 4. Filter all potential candidates
      const filtered = allPotentialCandidates.filter((c) => {
        const key = `${c.date}:${c.sessionId}`;
        // Exclude occupied AUTO slots
        if (autoDateSessions.has(key)) return false;
        // Exclude occupied other MANUAL slots
        if (otherManualKeys.has(key)) return false;

        // Chronological boundary with previous scheduled slot
        if (prevSlot) {
          if (c.date < prevSlot.date) return false;
          if (c.date === prevSlot.date && c.sessionOrder <= prevSlot.sessionOrder) return false;
        }

        // Chronological boundary with next scheduled slot
        if (nextSlot) {
          if (c.date > nextSlot.date) return false;
          if (c.date === nextSlot.date && c.sessionOrder >= nextSlot.sessionOrder) return false;
        }

        return true;
      });

      map.set(mId, filtered);
    }

    return map;
  }, [
    scheduleResult,
    semesterMeetings,
    availableSessions,
    manualSelections,
    allPotentialCandidates,
    autoDateSessions,
  ]);

  // 1. Prerequisite check for mapping & execution plan
  if (!mapping || !unitExecutionPlan) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
        <div className="flex items-center gap-2 text-slate-800 font-bold mb-2">
          <Layers className="w-5 h-5 text-indigo-600" />
          <h3>Jadwal Pertemuan Aktual (Pratinjau)</h3>
        </div>
        <p className="text-xs text-slate-500">
          Pemetaan Unit/Bab atau Rencana Pelaksanaan Pertemuan belum tersedia.
        </p>
      </div>
    );
  }

  // 2. Calendar confirmed + start/end check
  const isCalendarConfirmed = calendar?.workflowStatus === 'CONFIRMED';
  if (!isCalendarConfirmed || !calendar?.startDate || !calendar?.endDate) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
        <div className="flex items-center gap-2 text-slate-800 font-bold mb-3">
          <Calendar className="w-5 h-5 text-indigo-600" />
          <h3>Jadwal Pertemuan Aktual (Pratinjau)</h3>
        </div>
        <div className="p-4 bg-amber-50 rounded-lg border border-amber-200 text-amber-900 text-xs flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Kalender pendidikan belum ditetapkan.</p>
            <p className="mt-0.5 text-amber-800">
              {subjectSlotResult.errors.length > 0
                ? subjectSlotResult.errors.join(' ')
                : 'Tetapkan dan konfirmasi kalender pendidikan semester ini terlebih dahulu agar tanggal slot aktual dapat dihitung.'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // 3. Weekday valid check
  const hasInvalidDayOfWeek =
    !schedule ||
    !schedule.sessions ||
    schedule.sessions.length === 0 ||
    schedule.sessions.some(
      (s) => !s.dayOfWeek || s.dayOfWeek < 1 || s.dayOfWeek > (schoolDaysPerWeek === 5 ? 5 : 6)
    );

  if (hasInvalidDayOfWeek) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
        <div className="flex items-center gap-2 text-slate-800 font-bold mb-3">
          <Calendar className="w-5 h-5 text-indigo-600" />
          <h3>Jadwal Pertemuan Aktual (Pratinjau)</h3>
        </div>
        <div className="p-4 bg-amber-50 rounded-lg border border-amber-200 text-amber-900 text-xs flex items-start gap-2.5">
          <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Jadwal aktual belum dapat dihitung.</p>
            <p className="mt-0.5 text-amber-800">
              Lengkapi dan simpan Hari Mengajar terlebih dahulu.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // 4. Subject slot result ready check
  if (!subjectSlotResult.isReady) {
    const errorMessages =
      subjectSlotResult.errors.length > 0
        ? subjectSlotResult.errors
        : ['Kalender atau kapasitas jadwal semester belum siap untuk menghasilkan slot tanggal aktual.'];

    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
        <div className="flex items-center gap-2 text-slate-800 font-bold mb-3">
          <Calendar className="w-5 h-5 text-indigo-600" />
          <h3>Jadwal Pertemuan Aktual (Pratinjau)</h3>
        </div>
        <div className="p-4 bg-amber-50 rounded-lg border border-amber-200 text-amber-900 text-xs flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Jadwal aktual belum dapat dihitung.</p>
            <ul className="mt-1 space-y-0.5 text-amber-800 list-disc list-inside">
              {errorMessages.map((err, idx) => (
                <li key={idx}>{err}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    );
  }

  // 5. Schedule result valid check
  if (!scheduleResult || !scheduleResult.isValid) {
    const errorMessages =
      scheduleResult?.errors && scheduleResult.errors.length > 0
        ? scheduleResult.errors
        : ['Struktur pertemuan atau pembagian semester tidak valid.'];

    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
        <div className="flex items-center gap-2 text-slate-800 font-bold mb-3">
          <Calendar className="w-5 h-5 text-indigo-600" />
          <h3>Jadwal Pertemuan Aktual (Pratinjau)</h3>
        </div>
        <div className="p-4 bg-rose-50 rounded-lg border border-rose-200 text-rose-900 text-xs flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Jadwal Pertemuan belum dapat disusun.</p>
            <ul className="mt-1 space-y-0.5 text-rose-800 list-disc list-inside">
              {errorMessages.map((err, idx) => (
                <li key={idx}>{err}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    );
  }

  // 6. Schedule result ready check
  if (!scheduleResult.isReady) {
    const errorMessages =
      scheduleResult.errors && scheduleResult.errors.length > 0
        ? scheduleResult.errors
        : ['Jadwal Pertemuan belum siap dihitung.'];

    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
        <div className="flex items-center gap-2 text-slate-800 font-bold mb-3">
          <Calendar className="w-5 h-5 text-indigo-600" />
          <h3>Jadwal Pertemuan Aktual (Pratinjau)</h3>
        </div>
        <div className="p-4 bg-amber-50 rounded-lg border border-amber-200 text-amber-900 text-xs flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Jadwal Pertemuan belum siap dihitung.</p>
            <ul className="mt-1 space-y-0.5 text-amber-800 list-disc list-inside">
              {errorMessages.map((err, idx) => (
                <li key={idx}>{err}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    );
  }

  // 7. When scheduleResult is valid and ready
  const sessionOrderMap = new Map<string, number>();
  availableSessions.forEach((s) => sessionOrderMap.set(s.id, s.order));

  const canonicalOrderMap = new Map<string, number>();
  semesterMeetings.forEach((m, idx) => canonicalOrderMap.set(m.meetingId, idx));

  // Compute resolved manual entries
  const manualEntries: LearningMeetingScheduleEntry[] = [];
  const manualErrors: Record<string, string> = {};
  const manualDateSessions = new Set<string>();

  for (const mId of scheduleResult.unscheduledMeetingIds) {
    const sel = manualSelections[mId];
    if (!sel || !sel.date || !sel.sessionId) continue;

    const dateSessionKey = `${sel.date}:${sel.sessionId}`;
    if (autoDateSessions.has(dateSessionKey)) {
      manualErrors[mId] = `Konflik: Tanggal dan sesi (${formatIndonesianDate(sel.date)}) sudah dipakai oleh jadwal otomatis.`;
      continue;
    }
    if (manualDateSessions.has(dateSessionKey)) {
      manualErrors[mId] = `Konflik: Tanggal dan sesi (${formatIndonesianDate(sel.date)}) sudah dipilih oleh Pertemuan lain.`;
      continue;
    }
    manualDateSessions.add(dateSessionKey);

    const sessionObj = availableSessions.find((s) => s.id === sel.sessionId);
    if (!sessionObj) {
      manualErrors[mId] = 'Sesi tidak valid.';
      continue;
    }

    const dParts = sel.date.split('-');
    const dObj = new Date(parseInt(dParts[0], 10), parseInt(dParts[1], 10) - 1, parseInt(dParts[2], 10));
    const jsDay = dObj.getDay();
    const wk = effectiveWeeks.find((w) => sel.date >= w.startDate && sel.date <= w.endDate);
    const mInfo = semesterMeetings.find((m) => m.meetingId === mId);

    manualEntries.push({
      meetingId: mId,
      unitId: mInfo?.unitId || '',
      semesterPlanId,
      sessionId: sel.sessionId,
      sourceSlotId: `manual-slot:${semesterPlanId}:${mId}:${sel.date}:${sel.sessionId}`,
      date: sel.date,
      dayOfWeek: jsDay as 1 | 2 | 3 | 4 | 5 | 6,
      jp: sessionObj.jp,
      weekIndex: wk ? wk.weekIndex : 1,
      mode: 'MANUAL_OVERRIDE',
    });
  }

  // Combined entries (AUTO + valid MANUAL)
  const combinedEntries = [...scheduleResult.scheduledEntries, ...manualEntries].sort((a, b) => {
    const idxA = canonicalOrderMap.get(a.meetingId) ?? 999;
    const idxB = canonicalOrderMap.get(b.meetingId) ?? 999;
    return idxA - idxB;
  });

  // Verify chronology of combined entries
  for (let i = 1; i < combinedEntries.length; i++) {
    const prev = combinedEntries[i - 1];
    const curr = combinedEntries[i];
    const prevSessionOrder = sessionOrderMap.get(prev.sessionId) ?? 1;
    const currSessionOrder = sessionOrderMap.get(curr.sessionId) ?? 1;

    let isChronologyViolated = false;
    if (curr.date < prev.date) {
      isChronologyViolated = true;
    } else if (curr.date === prev.date && currSessionOrder <= prevSessionOrder) {
      isChronologyViolated = true;
    }

    if (isChronologyViolated && curr.mode === 'MANUAL_OVERRIDE') {
      manualErrors[curr.meetingId] = `Urutan kronologis salah: Slot (${formatIndonesianDate(curr.date)}, Sesi ${currSessionOrder}) harus setelah Pertemuan sebelumnya (${formatIndonesianDate(prev.date)}, Sesi ${prevSessionOrder}).`;
    }
  }

  const hasAnyManualErrors = Object.keys(manualErrors).length > 0;

  // Final map of active entries for render
  const activeEntryMap = new Map<string, LearningMeetingScheduleEntry>();
  for (const entry of combinedEntries) {
    if (!manualErrors[entry.meetingId]) {
      activeEntryMap.set(entry.meetingId, entry);
    }
  }

  const totalMeetings = scheduleResult.totalMeetings;
  const totalScheduledMeetings = activeEntryMap.size;
  const totalUnscheduledMeetings = totalMeetings - totalScheduledMeetings;
  const totalAvailableSlots = scheduleResult.totalAvailableSlots + manualEntries.length;
  const totalActualJP = Array.from(activeEntryMap.values()).reduce((sum, e) => sum + e.jp, 0);
  const totalExcludedOccurrences = scheduleResult.totalExcludedOccurrences;

  const handleCandidateSelect = (meetingId: string, candidateValue: string) => {
    if (!candidateValue) {
      setManualSelections((prev) => {
        const next = { ...prev };
        delete next[meetingId];
        return next;
      });
    } else {
      const [d, sId] = candidateValue.split('|');
      setManualSelections((prev) => ({
        ...prev,
        [meetingId]: {
          date: d,
          sessionId: sId,
        },
      }));
    }
    setSaveStatus('idle');
    setSaveMessage('');
  };

  const handleRequestAIRecommendation = async (
    mId: string,
    analysis: MeetingReconciliationAnalysis
  ) => {
    setAiRecommendations((prev) => ({
      ...prev,
      [mId]: { loading: true },
    }));

    const sourceMeetingInfo = semesterMeetings.find((m) => m.meetingId === mId);
    const sourceUnit = unitExecutionPlan?.units?.find((u) => u.unitId === analysis.unitId);
    const sourceM = sourceUnit?.meetings?.find((m) => m.id === mId);

    const mappingUnit = mapping?.units?.find((u) => u.id === analysis.unitId);
    const sourceMaterials = (sourceM?.materialIds || []).map(
      (matId) => mappingUnit?.materials?.find((m) => m.id === matId)?.title || matId
    );

    const sourceAtpSummary = sourceM?.linkedAtpItemIds || [];
    const sourceTpSummary = sourceM?.linkedTpIds || [];

    const adjacentMeetings = analysis.mergeTargetMeetingIds.map((targetId) => {
      const targetM = sourceUnit?.meetings?.find((m) => m.id === targetId);
      const matTitles = (targetM?.materialIds || []).map(
        (matId) => mappingUnit?.materials?.find((m) => m.id === matId)?.title || matId
      );
      const sourceIdx = sourceUnit?.meetings?.findIndex((m) => m.id === mId) ?? 0;
      const targetIdx = sourceUnit?.meetings?.findIndex((m) => m.id === targetId) ?? 0;
      return {
        meetingId: targetId,
        title: targetM?.title || targetId,
        materials: matTitles,
        isPrevious: targetIdx < sourceIdx,
      };
    });

    const res = await requestMeetingReconciliationAI({
      subject: subject || 'Mata Pelajaran',
      grade: grade || '',
      phase: phase || '',
      unitTitle: analysis.unitTitle,
      unresolvedMeetingTitle: sourceMeetingInfo?.meetingTitle || 'Pertemuan',
      sourceMaterials,
      sourceAtpSummary,
      sourceTpSummary,
      adjacentMeetings,
      safeOptions: analysis.safeOptions,
    });

    if (res.success && res.recommendation) {
      setAiRecommendations((prev) => ({
        ...prev,
        [mId]: {
          loading: false,
          recommendation: res.recommendation,
        },
      }));
    } else {
      setAiRecommendations((prev) => ({
        ...prev,
        [mId]: {
          loading: false,
          error: res.error || 'AI belum dapat memberikan rekomendasi.',
        },
      }));
      setShowSecondaryOptions((prev) => ({ ...prev, [mId]: true }));
    }
  };

  const handleApplyRecommendation = (
    mId: string,
    rec: AIMeetingReconciliationRecommendation
  ) => {
    if (!unitExecutionPlan || !mapping) return;

    const currentCandidates = candidatesByMeetingId.get(mId) || [];
    const currentAnalysis = analyzeMeetingReconciliation({
      unresolvedMeetingId: mId,
      unitExecutionPlan,
      mapping,
      atpData: atp,
      tpData: tp,
      replacementCandidates: currentCandidates,
    });

    const res = applyReconciliationAction({
      action: rec.action,
      unresolvedMeetingId: mId,
      unitExecutionPlan,
      mapping,
      atpData: atp,
      tpData: tp,
      candidateDate: rec.candidateDate,
      candidateSessionId: rec.candidateSessionId,
      targetMeetingId: rec.targetMeetingId,
      suggestedTitle: rec.suggestedTitle,
      safeOptions: currentAnalysis.safeOptions,
    });

    if (res.success) {
      if (res.manualSelection) {
        setManualSelections((prev) => ({
          ...prev,
          [mId]: res.manualSelection!,
        }));
        setReconciliationNotice({
          type: 'success',
          message: 'Slot tanggal pengganti berhasil diterapkan.',
        });
      } else if (res.updatedPlan) {
        if (onSaveUnitExecutionPlan) {
          const saved = onSaveUnitExecutionPlan(res.updatedPlan);
          if (saved) {
            setReconciliationNotice({
              type: 'success',
              message:
                rec.action === 'MERGE'
                  ? 'Pertemuan berhasil digabungkan dan Rencana Pelaksanaan diperbarui.'
                  : 'Pertemuan berhasil dipadatkan dan Rencana Pelaksanaan diperbarui.',
            });
          } else {
            setReconciliationNotice({
              type: 'error',
              message: 'Gagal menyimpan perubahan Rencana Pelaksanaan Pertemuan.',
            });
          }
        } else {
          setReconciliationNotice({
            type: 'error',
            message: 'Authority simpan Rencana Pelaksanaan belum tersedia.',
          });
        }
      }
    } else {
      setAiRecommendations((prev) => ({
        ...prev,
        [mId]: {
          loading: false,
          recommendation: undefined,
          error: undefined,
        },
      }));
      setReconciliationNotice({
        type: 'error',
        message: 'Kondisi jadwal telah berubah. AI perlu menghitung ulang rekomendasi.',
      });
    }
  };

  const handleApplyManualAction = (
    action: MeetingReconciliationAction,
    mId: string,
    extraParams?: { targetMeetingId?: string }
  ) => {
    if (!unitExecutionPlan || !mapping) return;

    const currentCandidates = candidatesByMeetingId.get(mId) || [];
    const currentAnalysis = analyzeMeetingReconciliation({
      unresolvedMeetingId: mId,
      unitExecutionPlan,
      mapping,
      atpData: atp,
      tpData: tp,
      replacementCandidates: currentCandidates,
    });

    const res = applyReconciliationAction({
      action,
      unresolvedMeetingId: mId,
      unitExecutionPlan,
      mapping,
      atpData: atp,
      tpData: tp,
      targetMeetingId: extraParams?.targetMeetingId,
      safeOptions: currentAnalysis.safeOptions,
    });

    if (res.success) {
      if (res.updatedPlan) {
        if (onSaveUnitExecutionPlan) {
          const saved = onSaveUnitExecutionPlan(res.updatedPlan);
          if (saved) {
            setReconciliationNotice({
              type: 'success',
              message:
                action === 'MERGE'
                  ? 'Pertemuan berhasil digabungkan dan Rencana Pelaksanaan diperbarui.'
                  : 'Pertemuan berhasil dipadatkan dan Rencana Pelaksanaan diperbarui.',
            });
          } else {
            setReconciliationNotice({
              type: 'error',
              message: 'Gagal menyimpan perubahan Rencana Pelaksanaan Pertemuan.',
            });
          }
        }
      }
    } else {
      setReconciliationNotice({
        type: 'error',
        message: 'Kondisi data telah berubah. Silakan pilih kembali opsi yang tersedia.',
      });
    }
  };

  const handleSave = () => {
    if (
      !onSaveLearningMeetingSchedule ||
      !schedule ||
      !calendar ||
      !mapping ||
      !unitExecutionPlan ||
      !expectedWeeklyJP ||
      hasAnyManualErrors
    ) {
      return;
    }

    try {
      const validManuals = manualEntries.filter((e) => !manualErrors[e.meetingId]);
      const dataToSave = buildLearningMeetingScheduleData({
        semesterPlanId,
        semester,
        mapping,
        unitExecutionPlan,
        subjectWeeklySchedule: schedule,
        expectedWeeklyJP,
        calendar,
        autoResult: scheduleResult,
        manualOverrides: validManuals,
        persistedId: persistedSchedule?.id,
      });

      const validation = validateLearningMeetingScheduleData({
        data: dataToSave,
        semester,
        mapping,
        unitExecutionPlan,
        subjectWeeklySchedule: schedule,
        expectedWeeklyJP,
        calendar,
        calendarDays,
      });

      if (!validation.isValid) {
        setSaveStatus('error');
        setSaveMessage(`Gagal validasi jadwal: ${validation.errors.join('; ')}`);
        return;
      }

      const success = onSaveLearningMeetingSchedule(dataToSave, semesterPlanId);
      if (success) {
        setSaveStatus('success');
        setSaveMessage(
          dataToSave.status === 'COMPLETE'
            ? 'Jadwal aktual semester berhasil disimpan lengkap (COMPLETE).'
            : 'Draf rekonsiliasi jadwal berhasil disimpan (DRAFT).'
        );
      } else {
        setSaveStatus('error');
        setSaveMessage('Gagal menyimpan jadwal pertemuan semester.');
      }
    } catch (err: any) {
      setSaveStatus('error');
      setSaveMessage(`Gagal menyimpan: ${err.message || String(err)}`);
    }
  };

  const isCompleteStatus = totalUnscheduledMeetings === 0 && !hasAnyManualErrors;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-6">
      {/* Stale Warning Banner */}
      {persistedSchedule && isPersistedStale && (
        <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-xl text-amber-900 text-xs flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">
              Jadwal tersimpan perlu disusun ulang karena sumber perencanaan berubah.
            </p>
            <p className="text-amber-800 mt-0.5">
              Data kalender, jam mingguan, atau alur materi telah diperbarui. Silakan tinjau jadwal dan simpan kembali.
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
        <div className="flex items-center gap-2">
          <Calendar className="w-5 h-5 text-indigo-600" />
          <div>
            <h3 className="font-bold text-slate-800 text-base">
              Pratinjau Jadwal Pertemuan Aktual (Semester {semester})
            </h3>
            <p className="text-xs text-slate-500">
              Pemetaan pertemuan pembelajaran terhadap slot tanggal dan hari mengajar efektif semester
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg font-semibold text-xs">
            Kapasitas Perencanaan: {totalMeetings} Pertemuan
          </span>
          <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg font-semibold text-xs">
            Slot Jadwal Aktual: {totalAvailableSlots} Slot
          </span>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
          <span className="text-[11px] font-medium text-slate-500 block">Pertemuan Semester</span>
          <span className="text-xl font-bold text-slate-900 mt-0.5 block">{totalMeetings}</span>
        </div>

        <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
          <span className="text-[11px] font-medium text-slate-500 block">Slot Jadwal Aktual</span>
          <span className="text-xl font-bold text-slate-900 mt-0.5 block">{totalAvailableSlots}</span>
        </div>

        <div className="p-3 bg-emerald-50/70 rounded-xl border border-emerald-200">
          <span className="text-[11px] font-medium text-emerald-800 block">Pertemuan Terjadwal</span>
          <span className="text-xl font-bold text-emerald-700 mt-0.5 block">{totalScheduledMeetings}</span>
        </div>

        <div className={`p-3 rounded-xl border ${totalUnscheduledMeetings > 0 ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-slate-50 border-slate-200 text-slate-900'}`}>
          <span className={`text-[11px] font-medium block ${totalUnscheduledMeetings > 0 ? 'text-amber-800' : 'text-slate-500'}`}>
            Belum Terjadwal
          </span>
          <span className={`text-xl font-bold mt-0.5 block ${totalUnscheduledMeetings > 0 ? 'text-amber-700' : 'text-slate-900'}`}>
            {totalUnscheduledMeetings}
          </span>
        </div>

        <div className="p-3 bg-blue-50/70 rounded-xl border border-blue-200">
          <span className="text-[11px] font-medium text-blue-800 block">JP Aktual Terjadwal</span>
          <span className="text-xl font-bold text-blue-700 mt-0.5 block">{totalActualJP} JP</span>
        </div>

        <div className="p-3 bg-rose-50/70 rounded-xl border border-rose-200">
          <span className="text-[11px] font-medium text-rose-800 block">Hari/Tanggal Terblokir</span>
          <span className="text-xl font-bold text-rose-700 mt-0.5 block">{totalExcludedOccurrences}</span>
        </div>
      </div>

      {/* Mismatch Diagnostics */}
      {scheduleResult.totalMeetings > scheduleResult.totalAvailableSlots && (
        <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-xl text-amber-900 text-xs flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">
              Terdapat {scheduleResult.totalMeetings - scheduleResult.totalAvailableSlots} Pertemuan yang belum memperoleh slot jadwal aktual otomatis.
            </p>
            <p className="text-amber-800 mt-0.5">
              Pertemuan tidak dihapus atau dipindahkan otomatis. Gunakan bagian <strong>Rekonsiliasi Jadwal</strong> di bawah untuk memilih tanggal pengganti.
            </p>
          </div>
        </div>
      )}

      {scheduleResult.totalAvailableSlots > scheduleResult.totalMeetings && (
        <div className="p-3.5 bg-blue-50 border border-blue-200 rounded-xl text-blue-900 text-xs flex items-start gap-2.5">
          <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
          <p className="font-medium">
            Terdapat {scheduleResult.totalAvailableSlots - scheduleResult.totalMeetings} slot jadwal aktual yang belum digunakan.
          </p>
        </div>
      )}

      {/* Smart Meeting Reconciliation Section */}
      {scheduleResult.totalUnscheduledMeetings > 0 && (
        <div className="space-y-4 p-5 bg-amber-50/50 rounded-2xl border border-amber-200/90 shadow-2xs font-sans">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-amber-200/60 pb-3">
            <div className="flex items-center gap-2">
              <Wrench className="w-5 h-5 text-amber-700 shrink-0" />
              <div>
                <h4 className="font-extrabold text-slate-900 text-sm tracking-wide">
                  {scheduleResult.totalUnscheduledMeetings} Pertemuan Perlu Disesuaikan
                </h4>
                <p className="text-xs text-slate-600 mt-0.5">
                  Pertemuan belum memperoleh slot jadwal otomatis. Gunakan rekomendasi AI atau pilihan manual aman di bawah.
                </p>
              </div>
            </div>
            <span className="px-2.5 py-1 bg-amber-100 text-amber-900 border border-amber-300 rounded-lg text-xs font-bold shrink-0">
              Penyesuaian Jadwal
            </span>
          </div>

          {reconciliationNotice && (
            <div
              className={`p-3 rounded-xl text-xs font-semibold flex items-center justify-between gap-2 ${
                reconciliationNotice.type === 'success'
                  ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                  : reconciliationNotice.type === 'error'
                  ? 'bg-rose-50 text-rose-900 border border-rose-200'
                  : 'bg-blue-50 text-blue-900 border border-blue-200'
              }`}
            >
              <div className="flex items-center gap-2">
                {reconciliationNotice.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                )}
                <span>{reconciliationNotice.message}</span>
              </div>
              <button
                type="button"
                onClick={() => setReconciliationNotice(null)}
                className="text-[10px] font-bold text-slate-500 hover:text-slate-800 cursor-pointer"
              >
                Tutup
              </button>
            </div>
          )}

          <div className="space-y-3.5">
            {scheduleResult.unscheduledMeetingIds.map((mId) => {
              const mInfo = semesterMeetings.find((m) => m.meetingId === mId);
              const sel = manualSelections[mId] || { date: '', sessionId: '' };
              const err = manualErrors[mId];
              const candidates = candidatesByMeetingId.get(mId) || [];

              const analysis = analyzeMeetingReconciliation({
                unresolvedMeetingId: mId,
                unitExecutionPlan,
                mapping,
                atpData: atp,
                tpData: tp,
                replacementCandidates: candidates,
              });

              const aiState = aiRecommendations[mId];
              const isSecondaryOpen = showSecondaryOptions[mId] || Boolean(aiState?.error);

              return (
                <div
                  key={mId}
                  className={`p-4 bg-white rounded-xl border space-y-3 transition-all ${
                    err ? 'border-rose-300 ring-1 ring-rose-200 shadow-2xs' : 'border-slate-200/90 shadow-2xs'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                    <div>
                      <span className="font-extrabold text-slate-900 text-xs">{mInfo?.unitTitle}</span>
                      <span className="text-slate-400 mx-2">•</span>
                      <span className="font-bold text-indigo-700 text-xs">{mInfo?.meetingTitle}</span>
                    </div>
                    <span className="text-[11px] text-amber-800 bg-amber-100/80 px-2.5 py-0.5 rounded-md font-semibold">
                      Slot otomatis terkena kalender non-pembelajaran
                    </span>
                  </div>

                  {/* AI Recommendation Section */}
                  {!aiState?.recommendation && !aiState?.loading && (
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3.5 bg-indigo-50/50 rounded-xl border border-indigo-100/80">
                      <div className="text-xs text-indigo-950 font-medium">
                        <p className="font-bold text-indigo-900 flex items-center gap-1.5 mb-0.5">
                          <Sparkles className="w-4 h-4 text-indigo-600" />
                          <span>Optimasi Pedagogis AI</span>
                        </p>
                        <span className="text-slate-600">AI dapat merekomendasikan solusi paling efisien (gabung, padatkan, atau jadwal ulang) sesuai opsi aman aplikasi.</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRequestAIRecommendation(mId, analysis)}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs shadow-xs transition flex items-center gap-1.5 shrink-0 cursor-pointer"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Optimalkan dengan AI</span>
                      </button>
                    </div>
                  )}

                  {aiState?.loading && (
                    <div className="p-3.5 bg-indigo-50/50 rounded-xl border border-indigo-100 text-xs text-indigo-900 font-semibold flex items-center gap-2">
                      <RefreshCw className="w-4 h-4 text-indigo-600 animate-spin shrink-0" />
                      <span>AI sedang menghitung rekomendasi pedagogis terbaik...</span>
                    </div>
                  )}

                  {aiState?.error && (
                    <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-900 font-medium flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold">AI belum dapat memberikan rekomendasi.</p>
                        <p className="mt-0.5 text-amber-800">Anda tetap dapat memilih solusi manual yang aman di bawah ini.</p>
                      </div>
                    </div>
                  )}

                  {aiState?.recommendation && (
                    <div className="p-3.5 bg-indigo-50/80 rounded-xl border border-indigo-200 text-xs space-y-2.5">
                      <div className="flex items-center justify-between">
                        <div className="font-bold text-indigo-950 flex items-center gap-1.5">
                          <Sparkles className="w-4 h-4 text-indigo-600" />
                          <span>Rekomendasi AI</span>
                        </div>
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-indigo-200 text-indigo-900 uppercase">
                          {aiState.recommendation.action === 'MERGE'
                            ? 'Gabungkan Pertemuan'
                            : aiState.recommendation.action === 'REDUCE'
                            ? 'Padatkan Pertemuan'
                            : 'Jadwalkan Ulang'}
                        </span>
                      </div>

                      <div className="font-bold text-slate-800 text-sm">
                        {aiState.recommendation.action === 'MERGE' && (
                          <>
                            Gabungkan dengan "
                            {
                              semesterMeetings.find(
                                (m) => m.meetingId === aiState.recommendation!.targetMeetingId
                              )?.meetingTitle || 'Pertemuan Berdampingan'
                            }
                            "
                          </>
                        )}
                        {aiState.recommendation.action === 'REDUCE' && (
                          <>Padatkan Pertemuan (Cakupan materi tetap 100% lengkap)</>
                        )}
                        {aiState.recommendation.action === 'RESCHEDULE' && (
                          <>
                            Jadwalkan Ulang ke{' '}
                            {formatIndonesianDate(aiState.recommendation.candidateDate!)}
                          </>
                        )}
                      </div>

                      <p className="text-slate-600 leading-relaxed text-xs">
                        {aiState.recommendation.reason}
                      </p>

                      <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 border-t border-indigo-100">
                        <button
                          type="button"
                          onClick={() => handleApplyRecommendation(mId, aiState.recommendation!)}
                          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold text-xs shadow-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Terapkan Rekomendasi</span>
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            setShowSecondaryOptions((prev) => ({
                              ...prev,
                              [mId]: !prev[mId],
                            }))
                          }
                          className="text-xs font-bold text-indigo-700 hover:text-indigo-900 flex items-center justify-center gap-1 cursor-pointer py-1"
                        >
                          <span>{isSecondaryOpen ? 'Sembunyikan Pilihan Lain' : 'Pilihan Lain'}</span>
                          {isSecondaryOpen ? (
                            <ChevronUp className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Secondary Safe Options */}
                  {isSecondaryOpen && (
                    <div className="pt-3 border-t border-slate-100 space-y-3 font-sans">
                      <p className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                        Pilihan Manual Aman
                      </p>

                      <div className="space-y-3">
                        {/* 1. RESCHEDULE Option */}
                        <div className="p-3 bg-slate-50/80 rounded-xl border border-slate-200 space-y-2">
                          <label className="block text-[11px] font-bold text-slate-700">
                            1. Cari Slot Pengganti (Hari Efektif Valid):
                          </label>
                          {candidates.length > 0 ? (
                            <select
                              value={sel.date && sel.sessionId ? `${sel.date}|${sel.sessionId}` : ''}
                              onChange={(e) => handleCandidateSelect(mId, e.target.value)}
                              className="w-full text-xs px-2.5 py-2 border border-slate-300 rounded-lg bg-white font-medium focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                            >
                              <option value="">-- Pilih Slot Jadwal Pengganti --</option>
                              {candidates.map((c) => (
                                <option key={c.value} value={c.value}>
                                  {c.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <div className="text-[11px] text-slate-500 italic">
                              Tidak ada slot pengganti yang valid dalam rentang tanggal ini.
                            </div>
                          )}
                        </div>

                        {/* 2. MERGE Option */}
                        {analysis.mergeTargetMeetingIds.length > 0 && (
                          <div className="p-3 bg-slate-50/80 rounded-xl border border-slate-200 space-y-2">
                            <label className="block text-[11px] font-bold text-slate-700">
                              2. Gabungkan dengan Pertemuan Berdampingan:
                            </label>
                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                              <select
                                value={selectedMergeTarget[mId] || ''}
                                onChange={(e) =>
                                  setSelectedMergeTarget((prev) => ({
                                    ...prev,
                                    [mId]: e.target.value,
                                  }))
                                }
                                className="w-full text-xs px-2.5 py-2 border border-slate-300 rounded-lg bg-white font-medium focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                              >
                                <option value="">-- Pilih Pertemuan Target --</option>
                                {analysis.mergeTargetMeetingIds.map((targetId) => {
                                  const targetM = semesterMeetings.find(
                                    (m) => m.meetingId === targetId
                                  );
                                  return (
                                    <option key={targetId} value={targetId}>
                                      {targetM?.meetingTitle || targetId}
                                    </option>
                                  );
                                })}
                              </select>
                              <button
                                type="button"
                                disabled={!selectedMergeTarget[mId]}
                                onClick={() =>
                                  handleApplyManualAction('MERGE', mId, {
                                    targetMeetingId: selectedMergeTarget[mId],
                                  })
                                }
                                className={`px-4 py-2 rounded-lg font-bold text-xs transition shrink-0 cursor-pointer ${
                                  selectedMergeTarget[mId]
                                    ? 'bg-blue-900 hover:bg-blue-950 text-white shadow-xs'
                                    : 'bg-slate-200 text-slate-400 border border-slate-300 cursor-not-allowed'
                                }`}
                              >
                                Gabungkan Pertemuan
                              </button>
                            </div>
                          </div>
                        )}

                        {/* 3. REDUCE Option ("Padatkan Pertemuan") */}
                        {analysis.canReduce && (
                          <div className="p-3 bg-slate-50/80 rounded-xl border border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                            <div>
                              <p className="font-bold text-slate-800 text-xs">3. Padatkan Pertemuan</p>
                              <p className="text-[11px] text-slate-500 mt-0.5">
                                Hapus pertemuan ini dari rencana. Seluruh cakupan materi & TP/ATP tetap 100% lengkap pada pertemuan lain.
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleApplyManualAction('REDUCE', mId)}
                              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold text-xs shadow-xs transition shrink-0 cursor-pointer"
                            >
                              Padatkan Pertemuan
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {err && (
                    <div className="text-[11px] text-rose-700 flex items-center gap-1.5 pt-0.5">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>{err}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Meeting Schedule Table */}
      <div className="space-y-2">
        <h4 className="font-bold text-slate-800 text-xs tracking-wide uppercase">
          Daftar Pertemuan dan Alokasi Tanggal Aktual
        </h4>
        <div className="overflow-x-auto border border-slate-200 rounded-xl">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-100 text-slate-700 sticky top-0 font-semibold border-b border-slate-200">
              <tr>
                <th className="py-2.5 px-3 w-12 text-center">No</th>
                <th className="py-2.5 px-3 min-w-[140px]">Bab</th>
                <th className="py-2.5 px-3 min-w-[160px]">Pertemuan</th>
                <th className="py-2.5 px-3 min-w-[180px]">Hari/Tanggal</th>
                <th className="py-2.5 px-3 w-20 text-center">JP</th>
                <th className="py-2.5 px-3 w-40 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {semesterMeetings.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-400">
                    Tidak ada pertemuan yang direncanakan untuk Semester {semester}.
                  </td>
                </tr>
              ) : (
                semesterMeetings.map((m, idx) => {
                  const entry = activeEntryMap.get(m.meetingId);
                  const isScheduled = Boolean(entry);
                  const isManual = entry?.mode === 'MANUAL_OVERRIDE';

                  return (
                    <tr
                      key={m.meetingId}
                      className={isScheduled ? 'hover:bg-slate-50' : 'bg-amber-50/40 hover:bg-amber-50/60'}
                    >
                      <td className="py-2.5 px-3 text-center font-medium text-slate-500">
                        {idx + 1}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-slate-800">
                        {m.unitTitle}
                      </td>
                      <td className="py-2.5 px-3 font-medium text-slate-700">
                        {m.meetingTitle}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap font-medium text-slate-800">
                        {isScheduled && entry?.date ? (
                          <span>{formatIndonesianDate(entry.date)}</span>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-center whitespace-nowrap font-semibold text-slate-700">
                        {isScheduled && entry?.jp ? (
                          `${entry.jp} JP`
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-center whitespace-nowrap">
                        {isScheduled ? (
                          isManual ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-blue-100 text-blue-800 border border-blue-200 rounded-full font-semibold text-[11px]">
                              <CheckCircle2 className="w-3 h-3 text-blue-600" />
                              Terjadwal (Manual)
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-full font-semibold text-[11px]">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                              Terjadwal
                            </span>
                          )
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-amber-100 text-amber-800 border border-amber-200 rounded-full font-semibold text-[11px]">
                            <AlertTriangle className="w-3 h-3 text-amber-600" />
                            Belum mendapat slot
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Excluded Occurrences Section */}
      {scheduleResult.excludedOccurrences && scheduleResult.excludedOccurrences.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-slate-100">
          <div className="flex items-center gap-2">
            <Ban className="w-4 h-4 text-rose-600" />
            <h4 className="font-bold text-slate-800 text-xs tracking-wide uppercase">
              Hari Mengajar Terblokir Kalender
            </h4>
          </div>
          <div className="overflow-x-auto border border-rose-200 rounded-xl bg-rose-50/20">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-rose-100/60 text-rose-900 sticky top-0 font-semibold border-b border-rose-200">
                <tr>
                  <th className="py-2 px-3 w-12 text-center">No</th>
                  <th className="py-2 px-3 min-w-[180px]">Tanggal</th>
                  <th className="py-2 px-3 w-28">Sesi</th>
                  <th className="py-2 px-3 w-20 text-center">JP</th>
                  <th className="py-2 px-3 min-w-[200px]">Alasan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rose-100">
                {scheduleResult.excludedOccurrences.map((occ, idx) => (
                  <tr key={`${occ.sessionId}-${occ.date}-${idx}`} className="hover:bg-rose-50/50">
                    <td className="py-2 px-3 text-center font-medium text-slate-500">
                      {idx + 1}
                    </td>
                    <td className="py-2 px-3 font-semibold text-slate-800 whitespace-nowrap">
                      {formatIndonesianDate(occ.date)}
                    </td>
                    <td className="py-2 px-3 font-medium text-slate-700 whitespace-nowrap">
                      Sesi {occ.sessionId}
                    </td>
                    <td className="py-2 px-3 text-center whitespace-nowrap font-medium text-slate-700">
                      {occ.jp} JP
                    </td>
                    <td className="py-2 px-3 font-medium text-rose-800">
                      <span className="px-2 py-0.5 rounded bg-rose-100 border border-rose-200 text-[10px] font-bold">
                        {mapExcludedReason(occ.reason)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Save Action Bar */}
      {onSaveLearningMeetingSchedule && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-slate-200">
          <div className="text-xs">
            {saveStatus === 'success' && (
              <span className="text-emerald-700 font-semibold flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                {saveMessage}
              </span>
            )}
            {saveStatus === 'error' && (
              <span className="text-rose-700 font-semibold flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 text-rose-600" />
                {saveMessage}
              </span>
            )}
            {saveStatus === 'idle' && (
              <span className="text-slate-500">
                {isCompleteStatus
                  ? 'Seluruh pertemuan telah memiliki slot jadwal aktual (Status: COMPLETE).'
                  : `Terdapat ${totalUnscheduledMeetings} pertemuan belum terjadwal (Status: DRAFT).`}
              </span>
            )}
          </div>

          <button
            type="button"
            disabled={hasAnyManualErrors}
            onClick={handleSave}
            className={`px-5 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition ${
              hasAnyManualErrors
                ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                : isCompleteStatus
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs cursor-pointer'
                : 'bg-blue-900 hover:bg-blue-950 text-white shadow-xs cursor-pointer'
            }`}
          >
            <Save className="w-4 h-4" />
            {isCompleteStatus ? 'Simpan Jadwal Aktual' : 'Simpan Draf Rekonsiliasi'}
          </button>
        </div>
      )}
    </div>
  );
};
