import type { AnnualJPReference, SubjectJPResult } from '../types';

/** Compare only the annual official benchmark; the saved weekly value may be a school default. */
export function compareAnnualJPReference(stored: AnnualJPReference | null | undefined, master: Pick<SubjectJPResult, 'isOfficial' | 'referenceAnnualJP'>) {
  const masterJP = master.isOfficial && finite(master.referenceAnnualJP) ? master.referenceAnnualJP : null;
  const storedJP = finite(stored?.officialAnnualJP) ? stored.officialAnnualJP : null;
  return { masterJP, storedJP, status: masterJP === null ? 'UNVERIFIED' as const : 'VERIFIED' as const,
    needsReview: masterJP !== null && storedJP !== masterJP };
}

export interface AnnualJPSemester {
  semester: 1 | 2;
  capacityJP: number | null;
  allocatedJP: number | null;
  calendarLostJP?: number | null;
}
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
export function sumSemesterAllocatedJP(data: {
  learningMeetingSchedule?: { entries: { meetingId: string; jp: number }[] };
  timeAllocation?: { allocatedJP?: number; jp?: number }[];
} | null | undefined): number | null {
  if (data?.learningMeetingSchedule) {
    const entries = data.learningMeetingSchedule.entries;
    if (new Set(entries.map(e => e.meetingId)).size !== entries.length || entries.some(e => !finite(e.jp))) return null;
    return entries.reduce((sum, e) => sum + e.jp, 0);
  }
  if (!data?.timeAllocation) return null;
  if (data.timeAllocation.some(a => !finite(a.allocatedJP ?? a.jp))) return null;
  return data.timeAllocation.reduce((sum, a) => sum + (a.allocatedJP ?? a.jp!), 0);
}
export function assessAnnualJP(reference: Pick<SubjectJPResult, 'isOfficial' | 'referenceAnnualJP'>, semesters: AnnualJPSemester[]) {
  const complete = semesters.length === 2 && new Set(semesters.map(s => s.semester)).size === 2;
  const capacityJP = complete && semesters.every(s => finite(s.capacityJP)) ? semesters.reduce((sum, s) => sum + s.capacityJP!, 0) : null;
  const allocatedJP = complete && semesters.every(s => finite(s.allocatedJP)) ? semesters.reduce((sum, s) => sum + s.allocatedJP!, 0) : null;
  const officialJP = reference.isOfficial && finite(reference.referenceAnnualJP) ? reference.referenceAnnualJP : null;
  const unallocatedJP = capacityJP !== null && allocatedJP !== null ? capacityJP - allocatedJP : null;
  const capacityStatus = unallocatedJP === null ? null : unallocatedJP < 0 ? 'OVER_ALLOCATED' : unallocatedJP > 0 ? 'UNDER_ALLOCATED' : 'BALANCED';
  const referenceDifferenceJP = officialJP !== null && allocatedJP !== null ? officialJP - allocatedJP : null;
  const referenceCheck = referenceDifferenceJP === null ? 'UNVERIFIED' : referenceDifferenceJP > 0 ? 'BELOW_REFERENCE' : referenceDifferenceJP < 0 ? 'ABOVE_REFERENCE' : 'AT_REFERENCE';
  const balances = semesters.map(s => ({ semester: s.semester, remainingJP: finite(s.capacityJP) && finite(s.allocatedJP) ? s.capacityJP - s.allocatedJP : null }));
  return { capacityJP, allocatedJP, officialJP, unallocatedJP, capacityStatus, referenceCheck, referenceDifferenceJP,
    capacityBelowReferenceJP: capacityJP !== null && officialJP !== null ? Math.max(0, officialJP - capacityJP) : null,
    calendarLostJP: complete && semesters.every(s => finite(s.calendarLostJP)) ? semesters.reduce((sum, s) => sum + s.calendarLostJP!, 0) : null,
    semesterBalances: balances, semesterImbalance: balances.some(s => s.remainingJP !== null && s.remainingJP < 0),
  };
}
