import { LearningMeeting } from '../types';
// Unknown fields are protected too, so future/manual content cannot be silently discarded.
export function isEmptyAlignmentMeeting(meeting: LearningMeeting): boolean {
  return Object.entries(meeting).every(([key, value]) => {
    if (['id', 'unitId', 'order'].includes(key)) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.length === 0;
    return value == null;
  });
}
