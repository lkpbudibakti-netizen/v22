import { LearningMeeting } from '../types';
// Unknown fields are protected too, so future/manual content cannot be silently discarded.
export function isEmptyAlignmentMeeting(meeting: LearningMeeting): boolean {
  return Object.entries(meeting).every(([key, value]) => {
    if (['id', 'unitId', 'order', 'plannedJP'].includes(key)) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.length === 0;
    return value == null;
  });
}

/** Shared by optimization, automatic/manual schedules and document projections. */
export function meetingSlotIssue(meeting: LearningMeeting, slotJP: number): string | null {
  if (!Number.isFinite(slotJP) || slotJP <= 0) return `Slot JP pertemuan ${meeting.id} tidak valid.`;
  if (meeting.plannedJP !== undefined && (!Number.isFinite(meeting.plannedJP) || meeting.plannedJP <= 0)) return `Kebutuhan JP pertemuan ${meeting.id} tidak valid.`;
  if (meeting.plannedJP !== undefined && meeting.plannedJP > slotJP) return `Pertemuan ${meeting.id} membutuhkan ${meeting.plannedJP} JP, slot aktual hanya ${slotJP} JP.`;
  return null;
}

/** Sequential pairing only; calendar resolution and canonical order belong to existing callers. */
export function simulateMeetingSlotJP(meetings: LearningMeeting[], slots: readonly { jp: number }[]) {
  const errors: string[] = [], unknownIds: string[] = [];
  const rows = meetings.map((meeting, index) => {
    const slot = slots[index];
    if (!slot) errors.push(`Pertemuan ${meeting.id} tidak memperoleh slot aktual.`);
    else {
      const issue = meetingSlotIssue(meeting, slot.jp);
      if (issue) errors.push(issue);
    }
    if (meeting.plannedJP === undefined && !isEmptyAlignmentMeeting(meeting)) unknownIds.push(meeting.id);
    return { meetingId: meeting.id, unitId: meeting.unitId, order: meeting.order, title: meeting.title, plannedJP: meeting.plannedJP ?? null, slotIndex: index, slotJP: slot?.jp ?? null };
  });
  return { rows, errors, unknownIds };
}
