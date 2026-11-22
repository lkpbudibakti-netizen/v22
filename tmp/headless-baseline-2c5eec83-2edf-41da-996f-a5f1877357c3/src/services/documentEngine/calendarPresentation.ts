import { normalizeCalendarDayStatus } from '../jpEngine';

/** Human agenda labels only; internal calendar status codes must not be printed. */
export function calendarDayLabel(status?: string): string {
  const labels = { EFFECTIVE_LEARNING: 'Hari Pembelajaran', HOLIDAY: 'Hari Libur', SCHOOL_EVENT: 'Kegiatan Sekolah',
    ASSESSMENT: 'Asesmen', BREAK: 'Jeda Pembelajaran', NON_LEARNING: 'Nonpembelajaran', UNKNOWN: 'Belum ditetapkan' };
  return labels[normalizeCalendarDayStatus(status)];
}
