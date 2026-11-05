import { assessAnnualJP, sumSemesterAllocatedJP, compareAnnualJPReference } from '../services/annualJPAssessment';
import React, { useState, useMemo, useEffect } from 'react';
import {
  CalendarRange,
  ArrowRight,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  AlertCircle,
  Layers,
  Info,
} from 'lucide-react';
import {
  SchoolData,
  TeacherProfile,
  AcademicSetting,
  AcademicCalendar,
  CalendarDay,
  TimeAllocation,
  SemesterPlan,
  YearPlan,
  ATPData,
  TPData,
  ATPUnitMappingData,
  UnitExecutionPlanData,
  K13Analysis,
  SubjectWeeklySchedule,
  LearningMeetingScheduleData,
} from '../types';
import {
  AnnualPlanningTaskRail,
  AnnualPlanningTaskRailItem,
  AnnualPlanningTaskStatus,
} from './AnnualPlanningTaskRail';
import { getSemesterDataV5, loadStorageV5 } from '../services/storageV5';
import { resolveSemesterCapacityV5, getSubjectJP } from '../services/jpEngine';
import { TimePlanningManager } from './administration/TimePlanningManager';
import { UnitExecutionPlanManager } from './UnitExecutionPlanManager';
import { UnitSemesterPlanningManager } from './UnitSemesterPlanningManager';
import {
  validateUnitExecutionPlan,
  createEmptyUnitExecutionPlanData,
} from '../services/unitExecutionPlanService';
import { resolveUnitSemesterPlacement } from '../services/unitSemesterPlanningService';
import {
  resolvePlannedMeetingCapacity,
  isActualPlannedCapacityReady,
} from '../services/subjectScheduleService';
import { isLearningMeetingScheduleReady } from '../services/learningMeetingScheduleService';
import { validateATPUnitMappingCanonical } from '../services/atpUnitMappingValidationService';
import { resolveATPUnitMappingReadiness } from '../services/atpMappingReadinessService';

export interface AnnualPlanningManagerProps {
  school: SchoolData;
  profile: TeacherProfile;
  academicSetting: AcademicSetting;
  yearPlan?: YearPlan;
  semesterPlans: SemesterPlan[];
  mapping?: ATPUnitMappingData;
  unitExecutionPlan?: UnitExecutionPlanData;
  tp?: TPData;
  atp?: ATPData;
  k13Analysis?: K13Analysis;
  onSaveCalendar: (calendar: AcademicCalendar, days: CalendarDay[], explicitSemesterPlanId?: string) => boolean;
  onSaveSemesterJPSetting?: (actualWeeklyJP: number | null, explicitSemesterPlanId?: string) => boolean;
  onSaveTimeAllocations: (allocations: TimeAllocation[], explicitSemesterPlanId?: string) => boolean;
  onSaveUnitExecutionPlan?: (plan: UnitExecutionPlanData) => boolean;
  onSaveSubjectWeeklySchedule?: (schedule: SubjectWeeklySchedule, explicitSemesterPlanId?: string) => boolean;
  onSaveLearningMeetingSchedule?: (schedule: LearningMeetingScheduleData, explicitSemesterPlanId?: string) => boolean;
  onNextStep: () => void;
  onReviewAnnualJPReference?: (yearPlanId: string) => boolean;
  onBackToMapping: () => void;
}

export const AnnualPlanningManager: React.FC<AnnualPlanningManagerProps> = ({
  school,
  profile,
  academicSetting,
  yearPlan,
  semesterPlans,
  mapping,
  unitExecutionPlan,
  tp,
  atp,
  k13Analysis,
  onSaveCalendar,
  onSaveSemesterJPSetting,
  onSaveTimeAllocations,
  onSaveUnitExecutionPlan,
  onSaveSubjectWeeklySchedule,
  onSaveLearningMeetingSchedule,
  onNextStep,
  onReviewAnnualJPReference,
  onBackToMapping,
}) => {
  // Identify Semester 1 and Semester 2 plans from the year hierarchy
  const sem1Plan = useMemo(() => {
    return semesterPlans.find((sp) => sp.semester === 1);
  }, [semesterPlans]);

  const sem2Plan = useMemo(() => {
    return semesterPlans.find((sp) => sp.semester === 2);
  }, [semesterPlans]);

  const isKurikulumMerdeka = academicSetting.curriculumType === 'KURIKULUM_MERDEKA';

  const mappingReadiness = useMemo(() => {
    if (!isKurikulumMerdeka) return null;
    return resolveATPUnitMappingReadiness(mapping, atp, tp, academicSetting);
  }, [isKurikulumMerdeka, mapping, atp, tp, academicSetting]);

  // Selected semester tab in the annual planning workspace (defaults to Semester 1)
  const [activeTabSemester, setActiveTabSemester] = useState<1 | 2>(1);

  const [activeTaskId, setActiveTaskId] = useState<string>('time-s1');

  // Official benchmark rule
  const officialRule = useMemo(() => {
    return getSubjectJP({
      curriculumType: yearPlan?.curriculumType ?? academicSetting.curriculumType,
      curriculum: academicSetting.curriculum,
      level: yearPlan?.level ?? academicSetting.level,
      grade: yearPlan?.grade ?? academicSetting.grade,
      subject: yearPlan?.subject ?? academicSetting.subject,
      academicYear: yearPlan?.academicYear ?? academicSetting.academicYear,
    });
  }, [academicSetting, yearPlan]);

  // Resolve V5 storage state reactively
  const v5State = useMemo(() => {
    try {
      return loadStorageV5();
    } catch {
      return { semesterPlans: [], semesterData: { academicCalendar: [], timeAllocation: [] }, semesterJPSettings: [], annualJPReferences: [] };
    }
  }, [semesterPlans, academicSetting]);

  // Semester 1 data and capacity
  const s1Data = useMemo(() => {
    if (!sem1Plan) return null;
    try {
      return getSemesterDataV5(sem1Plan.id);
    } catch {
      return null;
    }
  }, [sem1Plan, v5State]);

  const s1Capacity = useMemo(() => {
    if (!sem1Plan) return null;
    try {
      return resolveSemesterCapacityV5(sem1Plan.id, v5State);
    } catch {
      return null;
    }
  }, [sem1Plan, v5State, s1Data]);

  // Semester 2 data and capacity
  const s2Data = useMemo(() => {
    if (!sem2Plan) return null;
    try {
      return getSemesterDataV5(sem2Plan.id);
    } catch {
      return null;
    }
  }, [sem2Plan, v5State]);

  const s2Capacity = useMemo(() => {
    if (!sem2Plan) return null;
    try {
      return resolveSemesterCapacityV5(sem2Plan.id, v5State);
    } catch {
      return null;
    }
  }, [sem2Plan, v5State, s2Data]);

  // Total planned annual JP
  const totalAnnualAvailableJP = useMemo(() => {
    const s1 = s1Capacity?.availableJP ?? 0;
    const s2 = s2Capacity?.availableJP ?? 0;
    if (!s1Capacity?.isReady || !s2Capacity?.isReady) return null;
    return s1 + s2;
  }, [s1Capacity, s2Capacity]);

  const annualJPAssessment = assessAnnualJP(officialRule, [
    { semester: 1, capacityJP: s1Capacity?.isCalendarConfirmed && s1Capacity.capacitySource === 'ACTUAL_SLOTS' ? s1Capacity.availableJP : null, calendarLostJP: s1Capacity?.calendarLostJP,
      allocatedJP: sumSemesterAllocatedJP(s1Data) },
    { semester: 2, capacityJP: s2Capacity?.isCalendarConfirmed && s2Capacity.capacitySource === 'ACTUAL_SLOTS' ? s2Capacity.availableJP : null, calendarLostJP: s2Capacity?.calendarLostJP,
      allocatedJP: sumSemesterAllocatedJP(s2Data) },
  ]);
  const storedAnnualReference = v5State.annualJPReferences?.find(e => e.yearPlanId === yearPlan?.id)?.value;
  const referenceReview = compareAnnualJPReference(storedAnnualReference, officialRule);
  const [referenceReviewMessage, setReferenceReviewMessage] = useState('');

  const activeSelectedPlan = activeTabSemester === 1 ? sem1Plan : sem2Plan;
  const activeSelectedData = activeTabSemester === 1 ? s1Data : s2Data;

  const hasS1SavedAllocation = useMemo(() => {
    const allocs = s1Data?.timeAllocation;
    if (!Array.isArray(allocs) || allocs.length === 0) return false;
    const total = allocs.reduce((sum, a) => sum + (Number(a.allocatedJP ?? a.jp) || 0), 0);
    if (total <= 0) return false;
    if (s1Capacity?.availableJP !== null && s1Capacity?.availableJP !== undefined && s1Capacity.availableJP > 0 && total > s1Capacity.availableJP) {
      return false;
    }
    return true;
  }, [s1Data?.timeAllocation, s1Capacity?.availableJP]);

  const hasS2SavedAllocation = useMemo(() => {
    const allocs = s2Data?.timeAllocation;
    if (!Array.isArray(allocs) || allocs.length === 0) return false;
    const total = allocs.reduce((sum, a) => sum + (Number(a.allocatedJP ?? a.jp) || 0), 0);
    if (total <= 0) return false;
    if (s2Capacity?.availableJP !== null && s2Capacity?.availableJP !== undefined && s2Capacity.availableJP > 0 && total > s2Capacity.availableJP) {
      return false;
    }
    return true;
  }, [s2Data?.timeAllocation, s2Capacity?.availableJP]);

  const meetingValidation = useMemo(() => {
    if (!mapping) return null;
    return validateUnitExecutionPlan(
      unitExecutionPlan || createEmptyUnitExecutionPlanData(mapping),
      mapping,
      atp || null,
      tp || null
    );
  }, [unitExecutionPlan, mapping, atp, tp]);

  const effectiveUnitExecutionPlan = useMemo(() => {
    if (!mapping) return null;
    return unitExecutionPlan ?? createEmptyUnitExecutionPlanData(mapping);
  }, [unitExecutionPlan, mapping]);

  const placementValidation = useMemo(() => {
    if (!mapping || !effectiveUnitExecutionPlan) return null;
    return resolveUnitSemesterPlacement(effectiveUnitExecutionPlan, mapping);
  }, [effectiveUnitExecutionPlan, mapping]);

  const placementReady = Boolean(
    effectiveUnitExecutionPlan?.semesterPlacement &&
    placementValidation &&
    placementValidation.isComplete
  );

  const s1PlannedCapacity = useMemo(() => {
    const calendarConfirmed = Boolean(s1Data?.academicCalendar?.calendar?.workflowStatus === 'CONFIRMED');
    const effectiveWeekSlots = s1Capacity?.effectiveWeekSlots || 0;
    return resolvePlannedMeetingCapacity({
      schedule: s1Data?.subjectWeeklySchedule,
      expectedWeeklyJP: s1Capacity?.actualScheduledWeeklyJP ?? null,
      calendarConfirmed,
      effectiveWeekSlots,
      calendar: s1Data?.academicCalendar?.calendar,
      calendarDays: s1Data?.academicCalendar?.days || [],
      semesterPlanId: sem1Plan?.id,
      schoolDaysPerWeek: s1Data?.academicCalendar?.calendar?.schoolDaysPerWeek,
    });
  }, [s1Data, s1Capacity, sem1Plan]);

  const s2PlannedCapacity = useMemo(() => {
    const calendarConfirmed = Boolean(s2Data?.academicCalendar?.calendar?.workflowStatus === 'CONFIRMED');
    const effectiveWeekSlots = s2Capacity?.effectiveWeekSlots || 0;
    return resolvePlannedMeetingCapacity({
      schedule: s2Data?.subjectWeeklySchedule,
      expectedWeeklyJP: s2Capacity?.actualScheduledWeeklyJP ?? null,
      calendarConfirmed,
      effectiveWeekSlots,
      calendar: s2Data?.academicCalendar?.calendar,
      calendarDays: s2Data?.academicCalendar?.days || [],
      semesterPlanId: sem2Plan?.id,
      schoolDaysPerWeek: s2Data?.academicCalendar?.calendar?.schoolDaysPerWeek,
    });
  }, [s2Data, s2Capacity, sem2Plan]);

  const isK13Curriculum = academicSetting.curriculumType === 'K13' || academicSetting.curriculum?.includes('2013');

  const s1ScheduleReadiness = useMemo(() => {
    return isLearningMeetingScheduleReady({
      schedule: s1Data?.learningMeetingSchedule,
      semester: 1,
      mapping,
      unitExecutionPlan: effectiveUnitExecutionPlan || unitExecutionPlan,
      subjectWeeklySchedule: s1Data?.subjectWeeklySchedule,
      expectedWeeklyJP: s1Capacity?.actualScheduledWeeklyJP ?? s1Data?.semesterJPSetting?.actualScheduledWeeklyJP,
      calendar: s1Data?.academicCalendar?.calendar,
      calendarDays: s1Data?.academicCalendar?.days || [],
    });
  }, [s1Data, mapping, effectiveUnitExecutionPlan, unitExecutionPlan, s1Capacity]);

  const isS1ExactScheduleReady = s1ScheduleReadiness.isReady;

  const s2ScheduleReadiness = useMemo(() => {
    return isLearningMeetingScheduleReady({
      schedule: s2Data?.learningMeetingSchedule,
      semester: 2,
      mapping,
      unitExecutionPlan: effectiveUnitExecutionPlan || unitExecutionPlan,
      subjectWeeklySchedule: s2Data?.subjectWeeklySchedule,
      expectedWeeklyJP: s2Capacity?.actualScheduledWeeklyJP ?? s2Data?.semesterJPSetting?.actualScheduledWeeklyJP,
      calendar: s2Data?.academicCalendar?.calendar,
      calendarDays: s2Data?.academicCalendar?.days || [],
    });
  }, [s2Data, mapping, effectiveUnitExecutionPlan, unitExecutionPlan, s2Capacity]);

  const isS2ExactScheduleReady = s2ScheduleReadiness.isReady;

  const isTask5Complete = !isK13Curriculum
    ? (isS1ExactScheduleReady && isS2ExactScheduleReady && isActualPlannedCapacityReady(s1PlannedCapacity) && isActualPlannedCapacityReady(s2PlannedCapacity))
    : (hasS1SavedAllocation && hasS2SavedAllocation);

  const meetingCounts = useMemo(() => {
    const empty = { semester1: 0, semester2: 0 };
    if (!effectiveUnitExecutionPlan || !placementValidation?.isComplete) return empty;

    const s1UnitIds = new Set(placementValidation.semester1UnitIds);
    return (effectiveUnitExecutionPlan.units || []).reduce((acc, unit) => {
      const count = unit.meetings?.length || 0;
      if (s1UnitIds.has(unit.unitId)) {
        acc.semester1 += count;
      } else {
        acc.semester2 += count;
      }
      return acc;
    }, empty);
  }, [effectiveUnitExecutionPlan, placementValidation]);

  const s1CalendarReady = Boolean(
    s1Capacity?.isCalendarConfirmed &&
    s1Capacity?.effectiveWeekSlots &&
    s1Capacity.effectiveWeekSlots > 0
  );
  const s1JpReady = Boolean(
    s1Capacity?.actualScheduledWeeklyJP &&
    s1Capacity.actualScheduledWeeklyJP > 0
  );
  const s1ScheduleSaved = Boolean(s1Data?.subjectWeeklySchedule);
  const s1TimeReady = s1CalendarReady && s1JpReady && s1ScheduleSaved && s1PlannedCapacity.isReady;

  const s2CalendarReady = Boolean(
    s2Capacity?.isCalendarConfirmed &&
    s2Capacity?.effectiveWeekSlots &&
    s2Capacity.effectiveWeekSlots > 0
  );
  const s2JpReady = Boolean(
    s2Capacity?.actualScheduledWeeklyJP &&
    s2Capacity.actualScheduledWeeklyJP > 0
  );
  const s2ScheduleSaved = Boolean(s2Data?.subjectWeeklySchedule);
  const s2TimeReady = s2CalendarReady && s2JpReady && s2ScheduleSaved && s2PlannedCapacity.isReady;

  const s1TargetMeetings = s1PlannedCapacity.totalMeetingCapacity;
  const s2TargetMeetings = s2PlannedCapacity.totalMeetingCapacity;

  const s1MeetingCountWithinCapacity = meetingCounts.semester1 <= s1TargetMeetings;
  const s2MeetingCountWithinCapacity = meetingCounts.semester2 <= s2TargetMeetings;
  const meetingCountDetail = `S1 ${meetingCounts.semester1} digunakan (kapasitas ${s1TargetMeetings}) • S2 ${meetingCounts.semester2} digunakan (kapasitas ${s2TargetMeetings})`;
  const meetingCoverageComplete = Boolean(placementReady && meetingValidation?.isComplete);
  const meetingExactReady = Boolean(
    meetingCoverageComplete &&
    s1PlannedCapacity.isReady &&
    s2PlannedCapacity.isReady &&
    s1MeetingCountWithinCapacity &&
    s2MeetingCountWithinCapacity
  );

  const annualTasks: AnnualPlanningTaskRailItem[] = useMemo(() => {
    const t1Complete = s1TimeReady;
    const t2Complete = s2TimeReady;
    const t3Complete = placementReady;
    const t4Complete = meetingExactReady;
    const t5Complete = isTask5Complete;

    const t2Locked =
      !t1Complete;

    const t3Locked =
      !(t1Complete && t2Complete);

    const t4Locked =
      !(t1Complete && t2Complete && t3Complete);

    const t5Locked =
      !(t1Complete && t2Complete && t3Complete && t4Complete);

    return [
      {
        id: 'time-s1',
        title: 'Waktu Semester 1',
        status: t1Complete ? 'COMPLETE' : 'PENDING',
        isLocked: false,
        detail: s1PlannedCapacity.isReady
          ? s1PlannedCapacity.capacitySource === 'ACTUAL_SLOTS'
            ? `${s1PlannedCapacity.totalMeetingCapacity} Pertemuan • ${s1PlannedCapacity.totalJP} JP (Aktual)`
            : `${s1PlannedCapacity.totalMeetingCapacity} Pertemuan • ${s1PlannedCapacity.totalJP} JP (Estimasi)`
          : 'Belum dihitung',
      },
      {
        id: 'time-s2',
        title: 'Waktu Semester 2',
        status: t2Complete ? 'COMPLETE' : 'PENDING',
        isLocked: t2Locked,
        lockReason: 'Lengkapi Waktu Semester 1 terlebih dahulu',
        detail: s2PlannedCapacity.isReady
          ? s2PlannedCapacity.capacitySource === 'ACTUAL_SLOTS'
            ? `${s2PlannedCapacity.totalMeetingCapacity} Pertemuan • ${s2PlannedCapacity.totalJP} JP (Aktual)`
            : `${s2PlannedCapacity.totalMeetingCapacity} Pertemuan • ${s2PlannedCapacity.totalJP} JP (Estimasi)`
          : 'Belum dihitung',
      },
      {
        id: 'placement',
        title: 'Pembagian Bab',
        status: t3Complete ? 'COMPLETE' : 'PENDING',
        isLocked: t3Locked,
        lockReason: 'Lengkapi Waktu Semester 1 & 2 terlebih dahulu',
      },
      {
        id: 'meetings',
        title: 'Struktur Pertemuan',
        status: t4Complete
          ? 'COMPLETE'
          : meetingCoverageComplete
          ? 'NEEDS_REVIEW'
          : 'PENDING',
        isLocked: t4Locked,
        lockReason: 'Tetapkan pembagian Unit/Bab Semester 1 & 2 terlebih dahulu',
        detail: meetingCountDetail,
      },
      {
        id: 'time-allocation',
        title: 'Alokasi Waktu',
        status: t5Complete ? 'COMPLETE' : 'PENDING',
        isLocked: t5Locked,
        lockReason: 'Lengkapi Struktur Pertemuan terlebih dahulu',
      },
    ];
  }, [
    s1TimeReady,
    s2TimeReady,
    placementReady,
    meetingExactReady,
    meetingCoverageComplete,
    isTask5Complete,
    s1PlannedCapacity,
    s2PlannedCapacity,
    meetingCountDetail,
  ]);

  const isAnnualReady = useMemo(() => {
    return annualTasks.every((task) => task.status === 'COMPLETE');
  }, [annualTasks]);

  // Sync activeTaskId if it becomes locked due to data changes
  useEffect(() => {
    const currentActiveItem = annualTasks.find((t) => t.id === activeTaskId);
    if (!currentActiveItem || currentActiveItem.isLocked) {
      // Find first incomplete and unlocked task, otherwise default to first unlocked task
      const firstIncomplete = annualTasks.find((t) => !t.isLocked && t.status !== 'COMPLETE');
      if (firstIncomplete) {
        setActiveTaskId(firstIncomplete.id);
      } else {
        const firstUnlocked = annualTasks.find((t) => !t.isLocked);
        if (firstUnlocked) {
          setActiveTaskId(firstUnlocked.id);
        } else {
          setActiveTaskId('time-s1');
        }
      }
    }
  }, [annualTasks, activeTaskId]);

  const handleSelectTask = (taskId: string) => {
    setActiveTaskId(taskId);
    if (taskId === 'time-s1') {
      setActiveTabSemester(1);
    } else if (taskId === 'time-s2') {
      setActiveTabSemester(2);
    } else if (taskId === 'time-allocation') {
      if (!hasS1SavedAllocation) {
        setActiveTabSemester(1);
      } else if (!hasS2SavedAllocation) {
        setActiveTabSemester(2);
      } else {
        setActiveTabSemester(1);
      }
    }

    window.setTimeout(() => {
      document.getElementById('annual-active-task-panel')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }, 50);
  };

  const activeHeaderDetails = useMemo(() => {
    switch (activeTaskId) {
      case 'time-s1':
        return {
          num: 1,
          title: 'Waktu Semester 1',
          desc: 'LENGKAPI Kalender Pendidikan, JP Mingguan, dan Pola Pertemuan Mingguan Semester 1.',
        };
      case 'time-s2':
        return {
          num: 2,
          title: 'Waktu Semester 2',
          desc: 'LENGKAPI Kalender Pendidikan, JP Mingguan, dan Pola Pertemuan Mingguan Semester 2.',
        };
      case 'placement':
        return {
          num: 3,
          title: 'Pembagian Bab',
          desc: 'Tetapkan Unit/Bab yang masuk Semester 1 dan Semester 2.',
        };
      case 'meetings':
        return {
          num: 4,
          title: 'Struktur Pertemuan',
          desc: 'Susun Pertemuan sesuai pembagian Bab dan kapasitas perencanaan.',
        };
      case 'time-allocation':
        return {
          num: 5,
          title: 'Alokasi Waktu',
          desc: 'Tetapkan alokasi waktu pembelajaran.',
        };
      default:
        return { num: 1, title: '', desc: '' };
    }
  }, [activeTaskId]);

  const nextStepCTA = useMemo(() => {
    switch (activeTaskId) {
      case 'time-s1':
        return {
          isReady: s1TimeReady,
          label: 'Lanjut ke Waktu Semester 2',
          targetId: 'time-s2',
        };
      case 'time-s2':
        return {
          isReady: s2TimeReady,
          label: 'Lanjut ke Pembagian Bab',
          targetId: 'placement',
        };
      case 'placement':
        return {
          isReady: placementReady,
          label: 'Lanjut ke Struktur Pertemuan',
          targetId: 'meetings',
        };
      case 'meetings':
        return {
          isReady: meetingExactReady,
          label: 'Lanjut ke Alokasi Waktu',
          targetId: 'time-allocation',
        };
      default:
        return null;
    }
  }, [activeTaskId, s1TimeReady, s2TimeReady, placementReady, meetingExactReady]);

  const s1Guidance = useMemo(() => {
    if (!s1CalendarReady) return 'Simpan & Tetapkan Kalender Pendidikan.';
    if (!s1JpReady) return 'Tentukan JP Mingguan Mapel.';
    if (!s1ScheduleSaved) return 'Simpan Pola Pertemuan Mingguan.';
    if (!s1PlannedCapacity.isReady) return 'Pola Pertemuan tersimpan tetapi kapasitas belum valid. Periksa pesan validasi Kalender/Pola Pertemuan.';
    return 'Semester 1 siap. Lanjut ke Semester 2.';
  }, [s1CalendarReady, s1JpReady, s1ScheduleSaved, s1PlannedCapacity.isReady]);

  const s2Guidance = useMemo(() => {
    if (!s2CalendarReady) return 'Simpan & Tetapkan Kalender Pendidikan.';
    if (!s2JpReady) return 'Tentukan JP Mingguan Mapel.';
    if (!s2ScheduleSaved) return 'Simpan Pola Pertemuan Mingguan.';
    if (!s2PlannedCapacity.isReady) return 'Pola Pertemuan tersimpan tetapi kapasitas belum valid. Periksa pesan validasi Kalender/Pola Pertemuan.';
    return 'Semester 2 siap. Lanjut ke Pembagian Bab.';
  }, [s2CalendarReady, s2JpReady, s2ScheduleSaved, s2PlannedCapacity.isReady]);

  if (isKurikulumMerdeka && (!mappingReadiness || !mappingReadiness.canProceed)) {
    const blockers = mappingReadiness?.blockers || ['Pemetaan Bab & Lingkup Materi belum selesai diselaraskan.'];

    return (
      <div className="max-w-4xl mx-auto my-12 p-8 bg-white border border-rose-100 rounded-3xl shadow-xs space-y-6 text-center animate-fadeIn">
        <div className="w-16 h-16 bg-rose-50 border border-rose-100 rounded-full flex items-center justify-center mx-auto">
          <AlertCircle className="w-8 h-8 text-rose-600" />
        </div>

        <div className="space-y-2">
          <h2 className="text-xl font-bold text-slate-900">
            Pemetaan Bab & Lingkup Materi belum selesai diselaraskan atau belum siap.
          </h2>
          <p className="text-sm text-slate-600 max-w-xl mx-auto leading-relaxed">
            Lengkapi pemetaan ATP/TP terlebih dahulu agar
            Pembagian Bab, Struktur Pertemuan, Modul Ajar,
            dan asesmen tetap konsisten.
          </p>
        </div>

        {blockers.length > 0 && (
          <div className="bg-amber-50/60 p-4 rounded-2xl border border-amber-200 text-left max-w-md mx-auto space-y-2 text-xs text-amber-900">
            <div className="font-bold flex items-center gap-1.5 text-sm">
              <Info className="w-4 h-4 text-amber-600 shrink-0" />
              <span>Alasan / Blocker:</span>
            </div>
            <ul className="list-disc pl-5 space-y-1">
              {blockers.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="pt-4">
          <button
            id="btn-back-to-mapping"
            type="button"
            onClick={onBackToMapping}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-bold text-white bg-indigo-700 hover:bg-indigo-800 transition cursor-pointer shadow-xs"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Kembali ke Pemetaan Unit/Bab (07)</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-blue-100 text-blue-900 text-xs font-bold flex items-center justify-center">
                08
              </span>
              <h3 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
                <CalendarRange className="w-5 h-5 text-blue-700" />
                <span>Perencanaan Tahunan — Pertemuan, Kalender & Alokasi Waktu</span>
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-1 max-w-3xl leading-relaxed">
              Siapkan <strong>Waktu Semester</strong>, <strong>Pembagian Bab</strong>, <strong>Struktur Pertemuan</strong>, serta <strong>Alokasi Waktu</strong> untuk Semester 1 & 2 secara terpadu sebelum memilih semester aktif.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isAnnualReady ? (
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Rencana Tahunan Siap</span>
              </div>
            ) : (
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold">
                <AlertCircle className="w-4 h-4 text-amber-600" />
                <span>Belum Lengkap</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-5 items-start">
        <AnnualPlanningTaskRail tasks={annualTasks} onSelectTask={handleSelectTask} activeTaskId={activeTaskId} />

        <div className="min-w-0 flex-1 space-y-6">
          {/* Annual Summary & Both Semesters Overview Bar */}
          <div className="text-xs p-3 border rounded-xl space-y-1" id="annual-jp-assessment">
            <div>Status acuan: <strong>{referenceReview.status}</strong>. JP intrakurikuler tahunan resmi: {annualJPAssessment.officialJP ?? 'Belum terverifikasi'}.</div>
            <div>JP rencana/teralokasi S1 + S2: {annualJPAssessment.allocatedJP ?? 'UNRESOLVED'}. Kapasitas JP aktual: {annualJPAssessment.capacityJP ?? 'UNRESOLVED'}.</div>
            <div>Selisih acuan − rencana: {annualJPAssessment.referenceDifferenceJP ?? 'UNRESOLVED'} JP. Selisih kapasitas − alokasi: {annualJPAssessment.unallocatedJP ?? 'UNRESOLVED'} JP.</div>
            <div>{annualJPAssessment.capacityStatus === 'OVER_ALLOCATED' ? 'Kelebihan alokasi terhadap kapasitas.' : annualJPAssessment.capacityStatus === 'UNDER_ALLOCATED' ? 'Masih ada kapasitas yang belum dialokasikan.' : annualJPAssessment.capacityStatus === 'BALANCED' ? 'Alokasi sesuai kapasitas.' : 'Kapasitas aktual atau alokasi belum lengkap (UNRESOLVED).'}</div>
            {annualJPAssessment.capacityBelowReferenceJP !== null && annualJPAssessment.capacityBelowReferenceJP > 0 && <div>Kekurangan kapasitas terhadap acuan: {annualJPAssessment.capacityBelowReferenceJP} JP.</div>}
            <div>Selisih terhadap acuan adalah bahan tinjauan, bukan otomatis pelanggaran regulasi. Alokasi draf belum merupakan jadwal final.</div>
            {storedAnnualReference && <div>Default mingguan tersimpan: {storedAnnualReference.referenceWeeklyEquivalentJP ?? 'belum tersedia'} JP; ekuivalen master: {officialRule.weeklyJP ?? 'belum terverifikasi'} JP. Jika berbeda, tinjau pola sekolah secara terpisah; ekuivalen bukan batas sesi.</div>}
            <div>Basis S1: {s1Capacity?.capacitySource ?? 'UNRESOLVED'}; S2: {s2Capacity?.capacitySource ?? 'UNRESOLVED'}. Estimasi hanya untuk pratinjau/draf; finalisasi memerlukan slot aktual kedua semester.</div>
            {annualJPAssessment.capacityJP === null && totalAnnualAvailableJP !== null && <div>Pratinjau kapasitas estimasi: {totalAnnualAvailableJP} JP.</div>}
            {annualJPAssessment.semesterImbalance && <div>Alokasi melebihi kapasitas pada salah satu semester; saldo tahunan tidak menghapus ketidakseimbangan ini.</div>}
            {referenceReview.needsReview && <div className="p-2 border border-amber-300 rounded-lg" role="alert">
              Acuan tahunan tersimpan {referenceReview.storedJP ?? 'belum tersedia'} JP berbeda dari master {referenceReview.masterJP} JP untuk {academicSetting.subject}, {academicSetting.grade}, {academicSetting.academicYear}.
              <div>Ekuivalen mingguan master: {officialRule.weeklyJP ?? 'belum terverifikasi'}; nilai mingguan tersimpan: {storedAnnualReference?.referenceWeeklyEquivalentJP ?? 'belum tersedia'} (dipertahankan).</div>
              <div>Tinjau referensi; pembaruan hanya mengubah acuan tahunan, tanpa mengubah jadwal, override semester, TP/ATP/Bab atau pertemuan.</div>
              {onReviewAnnualJPReference && yearPlan && <button type="button" id="review-annual-jp-reference" className="underline font-semibold" onClick={() => {
                const saved = onReviewAnnualJPReference(yearPlan.id);
                setReferenceReviewMessage(saved ? 'Acuan tahunan diperbarui. Pola mingguan dan kedua semester tetap dipertahankan.' : 'Acuan belum diperbarui; data tetap dipertahankan.');
              }}>Perbarui acuan tahunan saja ke {referenceReview.masterJP} JP</button>}
            </div>}
            {referenceReviewMessage && <div role="status">{referenceReviewMessage}</div>}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Semester 1 Overview Card */}
            <div className="p-4 rounded-2xl border bg-white border-slate-200 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-blue-700" />
                  <span>Waktu Semester 1</span>
                </span>
                {s1TimeReady ? (
                  <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                    Siap
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 text-[10px] font-bold">
                    Belum Lengkap
                  </span>
                )}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="bg-white/80 p-2 rounded-xl border border-slate-200/60">
                  <div className="text-[10px] text-slate-500 font-medium">Hari / Pekan Efektif</div>
                  <div className="font-bold text-slate-800 mt-0.5">
                    {s1Capacity?.effectiveLearningDays ?? '-'} Hari • {s1Capacity?.effectiveWeeks ?? '-'} Pekan
                  </div>
                </div>
                <div className="bg-white/80 p-2 rounded-xl border border-slate-200/60">
                  <div className="text-[10px] text-slate-500 font-medium">JP Aktual • Tersedia</div>
                  <div className="font-bold text-blue-900 mt-0.5">
                    {!isK13Curriculum ? (
                      s1PlannedCapacity.isReady ? (
                        <span>
                          {s1PlannedCapacity.totalMeetingCapacity} Pertemuan • {s1PlannedCapacity.totalJP} JP{' '}
                          {s1PlannedCapacity.capacitySource === 'ACTUAL_SLOTS' ? 'Aktual' : 'Estimasi'}
                        </span>
                      ) : (
                        <span>Belum dihitung</span>
                      )
                    ) : (
                      <span>{s1Capacity?.actualScheduledWeeklyJP ?? '-'} JP/mgg • {s1Capacity?.availableJP ?? '-'} Total JP</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Semester 2 Overview Card */}
            <div className="p-4 rounded-2xl border bg-white border-slate-200 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-blue-700" />
                  <span>Waktu Semester 2</span>
                </span>
                {s2TimeReady ? (
                  <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                    Siap
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 text-[10px] font-bold">
                    Belum Lengkap
                  </span>
                )}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="bg-white/80 p-2 rounded-xl border border-slate-200/60">
                  <div className="text-[10px] text-slate-500 font-medium">Hari / Pekan Efektif</div>
                  <div className="font-bold text-slate-800 mt-0.5">
                    {s2Capacity?.effectiveLearningDays ?? '-'} Hari • {s2Capacity?.effectiveWeeks ?? '-'} Pekan
                  </div>
                </div>
                <div className="bg-white/80 p-2 rounded-xl border border-slate-200/60">
                  <div className="text-[10px] text-slate-500 font-medium">JP Aktual • Tersedia</div>
                  <div className="font-bold text-blue-900 mt-0.5">
                    {!isK13Curriculum ? (
                      s2PlannedCapacity.isReady ? (
                        <span>
                          {s2PlannedCapacity.totalMeetingCapacity} Pertemuan • {s2PlannedCapacity.totalJP} JP{' '}
                          {s2PlannedCapacity.capacitySource === 'ACTUAL_SLOTS' ? 'Aktual' : 'Estimasi'}
                        </span>
                      ) : (
                        <span>Belum dihitung</span>
                      )
                    ) : (
                      <span>{s2Capacity?.actualScheduledWeeklyJP ?? '-'} JP/mgg • {s2Capacity?.availableJP ?? '-'} Total JP</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Total Annual Benchmark Card */}
            <div className="p-4 rounded-2xl border border-slate-200/80 bg-slate-900 text-white shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-indigo-300 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Kapasitas Pembelajaran 1 Tahun</span>
                </span>
                <span className="text-[10px] bg-indigo-800/80 text-indigo-200 px-2 py-0.5 rounded-md font-bold">
                  {academicSetting.academicYear}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="bg-slate-800/90 p-2 rounded-xl border border-slate-700/60">
                  <div className="text-[10px] text-slate-400 font-medium">Total JP Efektif (S1+S2)</div>
                  <div className="font-bold text-white mt-0.5">
                    {!isK13Curriculum && s1PlannedCapacity.isReady && s2PlannedCapacity.isReady ? (
                      <span>{s1PlannedCapacity.totalJP + s2PlannedCapacity.totalJP} JP Rencana ({s1PlannedCapacity.totalMeetingCapacity + s2PlannedCapacity.totalMeetingCapacity} Pertemuan)</span>
                    ) : (
                      <span>{totalAnnualAvailableJP !== null ? `${totalAnnualAvailableJP} JP` : 'Belum Lengkap'}</span>
                    )}
                  </div>
                </div>
                <div className="bg-slate-800/90 p-2 rounded-xl border border-slate-700/60">
                  <div className="text-[10px] text-slate-400 font-medium">Standar Regulasi</div>
                  <div className="font-bold text-indigo-300 mt-0.5">
                    {officialRule.annualJP ? `${officialRule.annualJP} JP / thn` : `${officialRule.weeklyJP || '-'} JP / mgg`}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ACTIVE WORKSPACE CONTAINER */}
          <div id="annual-active-task-panel" className="p-5 rounded-2xl border border-blue-200 bg-blue-50/20 space-y-6 scroll-mt-6 shadow-2xs">
            <div className="border-b border-blue-200/80 pb-4">
              <span className="text-[10px] font-bold text-blue-700 uppercase tracking-wider block">
                Langkah {activeHeaderDetails.num} dari 5
              </span>
              <h3 className="text-lg font-extrabold text-blue-950 mt-1">
                {activeHeaderDetails.title}
              </h3>
              <p className="text-xs text-blue-800/90 mt-1 leading-relaxed">
                {activeHeaderDetails.desc}
              </p>
            </div>

            {/* Kesiapan Checklist Card */}
            {activeTaskId === 'time-s1' && (
              <div className="p-4 rounded-xl border border-blue-200 bg-white shadow-2xs space-y-3 font-sans">
                <h4 className="text-xs font-bold text-blue-950 flex items-center gap-1.5 uppercase tracking-wide">
                  <CheckCircle2 className="w-4 h-4 text-blue-600" />
                  <span>Kesiapan Semester 1</span>
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs font-semibold text-slate-700">
                  <div className="flex items-center gap-2">
                    {s1CalendarReady ? (
                      <span className="text-emerald-700 font-bold flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Kalender Pendidikan (Siap)</span>
                      </span>
                    ) : (
                      <span className="text-slate-400 flex items-center gap-1.5">
                        <span className="w-3.5 h-3.5 border border-slate-300 rounded-full inline-block" />
                        <span>Kalender Pendidikan</span>
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {s1JpReady ? (
                      <span className="text-emerald-700 font-bold flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>JP Mingguan ({s1Capacity?.actualScheduledWeeklyJP} JP / minggu)</span>
                      </span>
                    ) : (
                      <span className="text-slate-400 flex items-center gap-1.5">
                        <span className="w-3.5 h-3.5 border border-slate-300 rounded-full inline-block" />
                        <span>JP Mingguan</span>
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {s1ScheduleSaved ? (
                      <span className="text-emerald-700 font-bold flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Pola Pertemuan Mingguan (Tersimpan)</span>
                      </span>
                    ) : (
                      <span className="text-slate-400 flex items-center gap-1.5">
                        <span className="w-3.5 h-3.5 border border-slate-300 rounded-full inline-block" />
                        <span>Pola Pertemuan Mingguan</span>
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {s1PlannedCapacity.isReady ? (
                      <span className="text-emerald-700 font-bold flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>
                          {s1PlannedCapacity.capacitySource === 'ACTUAL_SLOTS'
                            ? `Kapasitas Pertemuan Aktual (${s1PlannedCapacity.totalMeetingCapacity} Pertemuan • ${s1PlannedCapacity.totalJP} JP)`
                            : `Kapasitas Pertemuan Estimasi (${s1PlannedCapacity.totalMeetingCapacity} Pertemuan • ${s1PlannedCapacity.totalJP} JP)`}
                        </span>
                      </span>
                    ) : (
                      <span className="text-slate-400 flex items-center gap-1.5">
                        <span className="w-3.5 h-3.5 border border-slate-300 rounded-full inline-block" />
                        <span>Kapasitas Pertemuan Perencanaan</span>
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-2 pt-2 border-t border-slate-100 flex items-start gap-1.5 text-xs text-blue-900 font-bold">
                  <span className="shrink-0 bg-blue-100 text-blue-800 text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded mt-0.5">
                    Panduan
                  </span>
                  <span>{s1Guidance}</span>
                </div>
              </div>
            )}

            {activeTaskId === 'time-s2' && (
              <div className="p-4 rounded-xl border border-blue-200 bg-white shadow-2xs space-y-3 font-sans">
                <h4 className="text-xs font-bold text-blue-950 flex items-center gap-1.5 uppercase tracking-wide">
                  <CheckCircle2 className="w-4 h-4 text-blue-600" />
                  <span>Kesiapan Semester 2</span>
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs font-semibold text-slate-700">
                  <div className="flex items-center gap-2">
                    {s2CalendarReady ? (
                      <span className="text-emerald-700 font-bold flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Kalender Pendidikan (Siap)</span>
                      </span>
                    ) : (
                      <span className="text-slate-400 flex items-center gap-1.5">
                        <span className="w-3.5 h-3.5 border border-slate-300 rounded-full inline-block" />
                        <span>Kalender Pendidikan</span>
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {s2JpReady ? (
                      <span className="text-emerald-700 font-bold flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>JP Mingguan ({s2Capacity?.actualScheduledWeeklyJP} JP / minggu)</span>
                      </span>
                    ) : (
                      <span className="text-slate-400 flex items-center gap-1.5">
                        <span className="w-3.5 h-3.5 border border-slate-300 rounded-full inline-block" />
                        <span>JP Mingguan</span>
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {s2ScheduleSaved ? (
                      <span className="text-emerald-700 font-bold flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Pola Pertemuan Mingguan (Tersimpan)</span>
                      </span>
                    ) : (
                      <span className="text-slate-400 flex items-center gap-1.5">
                        <span className="w-3.5 h-3.5 border border-slate-300 rounded-full inline-block" />
                        <span>Pola Pertemuan Mingguan</span>
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {s2PlannedCapacity.isReady ? (
                      <span className="text-emerald-700 font-bold flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>
                          {s2PlannedCapacity.capacitySource === 'ACTUAL_SLOTS'
                            ? `Kapasitas Pertemuan Aktual (${s2PlannedCapacity.totalMeetingCapacity} Pertemuan • ${s2PlannedCapacity.totalJP} JP)`
                            : `Kapasitas Pertemuan Estimasi (${s2PlannedCapacity.totalMeetingCapacity} Pertemuan • ${s2PlannedCapacity.totalJP} JP)`}
                        </span>
                      </span>
                    ) : (
                      <span className="text-slate-400 flex items-center gap-1.5">
                        <span className="w-3.5 h-3.5 border border-slate-300 rounded-full inline-block" />
                        <span>Kapasitas Pertemuan Perencanaan</span>
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-2 pt-2 border-t border-slate-100 flex items-start gap-1.5 text-xs text-blue-900 font-bold">
                  <span className="shrink-0 bg-blue-100 text-blue-800 text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded mt-0.5">
                    Panduan
                  </span>
                  <span>{s2Guidance}</span>
                </div>
              </div>
            )}

            {/* A. TimePlanningManager Container */}
            <div className={activeTaskId === 'time-s1' || activeTaskId === 'time-s2' || activeTaskId === 'time-allocation' ? 'block animate-in fade-in duration-150' : 'hidden'}>
              {activeSelectedPlan && (
                <div id="time-planning-container" className="pt-1 scroll-mt-4">
                  <TimePlanningManager
                    school={school}
                    profile={profile}
                    academicSetting={{
                      ...academicSetting,
                      id: activeSelectedPlan.id,
                      semester: activeSelectedPlan.semester === 1 ? '1 (Ganjil)' : '2 (Genap)',
                    }}
                    atp={atp}
                    tp={tp}
                    k13Analysis={k13Analysis}
                    calendar={activeSelectedData?.academicCalendar?.calendar}
                    calendarDays={activeSelectedData?.academicCalendar?.days || []}
                    timeAllocations={activeSelectedData?.timeAllocation || []}
                    semesterJPSetting={activeSelectedData?.semesterJPSetting}
                    subjectWeeklySchedule={activeSelectedData?.subjectWeeklySchedule}
                    mapping={mapping}
                    unitExecutionPlan={effectiveUnitExecutionPlan || unitExecutionPlan}
                    semester={activeSelectedPlan.semester}
                    viewMode={
                      activeTaskId === 'time-allocation'
                        ? 'ALLOCATION'
                        : 'TIME_SETUP'
                    }
                    explicitSemesterPlanId={activeSelectedPlan.id}
                    onSaveCalendar={onSaveCalendar}
                    onSaveSemesterJPSetting={onSaveSemesterJPSetting}
                    onSaveTimeAllocations={onSaveTimeAllocations}
                    onSaveSubjectWeeklySchedule={onSaveSubjectWeeklySchedule}
                    persistedSchedule={activeSelectedData?.learningMeetingSchedule}
                    onSaveLearningMeetingSchedule={onSaveLearningMeetingSchedule}
                    onSaveUnitExecutionPlan={onSaveUnitExecutionPlan}
                    afterTimeSetup={activeTaskId === 'time-allocation' ? (
                      /* Dalam Task 5 boleh tampil sub-selector kecil */
                      <div className="flex items-center gap-2 mb-4 bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
                        <span className="text-xs font-bold text-slate-500 uppercase tracking-wide px-1">
                          Pilih Semester Alokasi:
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveTabSemester(1);
                          }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                            activeTabSemester === 1
                              ? 'bg-blue-900 text-white shadow-xs'
                              : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-300'
                          }`}
                        >
                          Semester 1 {(!isK13Curriculum ? isS1ExactScheduleReady : hasS1SavedAllocation) && '✓'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveTabSemester(2);
                          }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                            activeTabSemester === 2
                              ? 'bg-blue-900 text-white shadow-xs'
                              : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-300'
                          }`}
                        >
                          Semester 2 {(!isK13Curriculum ? isS2ExactScheduleReady : hasS2SavedAllocation) && '✓'}
                        </button>
                      </div>
                    ) : undefined}
                  />
                </div>
              )}
            </div>

            {/* B. UnitSemesterPlanningManager Container */}
            <div id="annual-task-placement" className={activeTaskId === 'placement' ? 'block animate-in fade-in duration-150' : 'hidden'}>
              {mapping && effectiveUnitExecutionPlan && onSaveUnitExecutionPlan && (
                <UnitSemesterPlanningManager
                  mapping={mapping}
                  unitExecutionPlan={effectiveUnitExecutionPlan}
                  s1AvailableJP={s1Capacity?.availableJP ?? null}
                  s2AvailableJP={s2Capacity?.availableJP ?? null}
                  onSave={onSaveUnitExecutionPlan}
                />
              )}
            </div>

            {/* C. UnitExecutionPlanManager Container */}
            <div id="annual-task-meetings" className={activeTaskId === 'meetings' ? 'block animate-in fade-in duration-150 font-sans' : 'hidden'}>
              {mapping && atp && tp && onSaveUnitExecutionPlan && (
                <UnitExecutionPlanManager
                  mapping={mapping}
                  unitExecutionPlan={unitExecutionPlan}
                  atp={atp}
                  tp={tp}
                  subject={academicSetting.subject}
                  grade={academicSetting.grade}
                  phase={academicSetting.phase}
                  onSave={onSaveUnitExecutionPlan}
                  meetingCapacity={{
                    semester1: {
                      isReady: s1PlannedCapacity.isReady,
                      targetMeetingCount: s1PlannedCapacity.totalMeetingCapacity,
                      totalJP: s1PlannedCapacity.totalJP,
                      capacitySource: s1PlannedCapacity.capacitySource,
                      calendarLostJP: s1PlannedCapacity.calendarLostJP,
                    },
                    semester2: {
                      isReady: s2PlannedCapacity.isReady,
                      targetMeetingCount: s2PlannedCapacity.totalMeetingCapacity,
                      totalJP: s2PlannedCapacity.totalJP,
                      capacitySource: s2PlannedCapacity.capacitySource,
                      calendarLostJP: s2PlannedCapacity.calendarLostJP,
                    },
                  }}
                />
              )}
            </div>

            {/* Guided CTA Bar for Tasks 1 to 4 */}
            {nextStepCTA && (
              <div className="pt-4 border-t border-blue-200/80 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
                <span className="text-slate-600 font-medium font-sans">
                  {nextStepCTA.isReady ? (
                    <span className="text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200 font-bold flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      Langkah ini selesai! Silakan lanjut ke langkah berikutnya.
                    </span>
                  ) : (
                    <span className="text-amber-800 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200 font-bold flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      <span>
                        {activeTaskId === 'time-s1'
                          ? s1Guidance
                          : activeTaskId === 'time-s2'
                          ? s2Guidance
                          : 'Selesaikan dan simpan langkah ini terlebih dahulu.'}
                      </span>
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  disabled={!nextStepCTA.isReady}
                  onClick={() => handleSelectTask(nextStepCTA.targetId)}
                  className={`px-5 py-2.5 rounded-xl font-bold transition flex items-center gap-2 cursor-pointer ${
                    nextStepCTA.isReady
                      ? 'bg-blue-900 hover:bg-blue-950 text-white shadow-xs'
                      : 'bg-slate-200 text-slate-400 border border-slate-300 cursor-not-allowed'
                  }`}
                >
                  <span>{nextStepCTA.label}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Final Guided CTA Bar for Task 5 */}
            {activeTaskId === 'time-allocation' && (
              <div className="pt-4 border-t border-blue-200/80 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
                <span className="text-slate-600 font-medium">
                  {isAnnualReady ? (
                    <span className="text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200 font-bold flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      Seluruh rangkaian Perencanaan Tahunan (Step 08) telah selesai disusun!
                    </span>
                  ) : (!isK13Curriculum && (s1ScheduleReadiness.isStale || s2ScheduleReadiness.isStale)) ? (
                    <span className="text-amber-800 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200 font-bold flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                      Jadwal Aktual berubah/stale dan perlu disusun ulang.
                    </span>
                  ) : (
                    <span className="text-amber-800 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200 font-bold flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                      {!isK13Curriculum
                        ? 'Lengkapi dan simpan Jadwal Aktual Semester 1 dan Semester 2 terlebih dahulu.'
                        : 'Selesaikan dan simpan Alokasi Waktu Semester 1 & 2 terlebih dahulu.'}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  id="finalize-step08"
                  disabled={!isAnnualReady}
                  onClick={() => { if (isAnnualReady) onNextStep(); }}
                  className={`px-5 py-2.5 rounded-xl font-bold transition flex items-center gap-2 cursor-pointer ${
                    isAnnualReady
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs'
                      : 'bg-slate-200 text-slate-400 border border-slate-300 cursor-not-allowed'
                  }`}
                >
                  <span>Lanjut ke Pilih Semester Aktif (09)</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* Bottom Navigation */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-slate-200">
        <button
          id="btn-back-to-mapping"
          type="button"
          onClick={onBackToMapping}
          className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 shadow-xs transition cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Kembali ke Pemetaan Unit/Bab (07)</span>
        </button>
      </div>
    </div>
  );
};
