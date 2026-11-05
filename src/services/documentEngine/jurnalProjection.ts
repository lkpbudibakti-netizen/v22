import type { JournalRealization } from '../../types';
import type { DocumentGenerationContext } from './types';
import { resolveMerdekaCanonicalTimeProjection } from './meetingTimeProjection';
import { resolveUnitSemesterPlacement } from '../unitSemesterPlanningService';
import { normalizeCalendarDayStatus } from '../jpEngine';

export interface JurnalRow {
  meetingId: string; semesterPlanId: string; unitId: string; unitTitle: string;
  materialIds: string[]; materialTitles: string[]; atpIds: string[]; atpSteps: number[];
  tpIds: string[]; tpLines: string[];
  plannedDate: string; plannedJP: number; plannedActivity: string;
  realization?: JournalRealization;
  attendance: string;
}
export interface JurnalProjection {
  version: 1; semesterPlanId: string; rows: JurnalRow[]; isReady: boolean; reasons: string[]; warnings: string[];
}
export const JURNAL_COLUMNS = ['No', 'Tanggal & JP', 'Materi & Kegiatan', 'Tujuan Pembelajaran (TP)', 'Kehadiran & Catatan', 'Refleksi', 'Tindak Lanjut'];
export const JURNAL_WIDTHS = [5, 14, 25, 22, 14, 10, 10];
export function validJournalDate(date: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0,10) === date;
}

/** Read-only meeting projection. Never invent dates, JP, activities or observations. */
export function buildJurnalProjection(context: DocumentGenerationContext): JurnalProjection {
  if (context.snapshot?.jurnalProjection) return structuredClone(context.snapshot.jurnalProjection);
  const semesterPlanId = context.academicSetting.id;
  const result: JurnalProjection = { version: 1, semesterPlanId, rows: [], isReady: false, reasons: [], warnings: [] };
  if (context.documentMode === 'blank') return { ...result, isReady: true };
  if (context.snapshot) return { ...result, reasons: ['Snapshot lama belum menyimpan isi jurnal per pertemuan. Gunakan format kosong atau buat dokumen baru dari data saat ini.'] };
  const canonical = resolveMerdekaCanonicalTimeProjection({ ...context, learningMeetingSchedules: context.learningMeetingSchedules?.filter(bundle => bundle.semesterPlanId === semesterPlanId) });
  result.reasons.push(...canonical.errors);
  const bundles = (context.learningMeetingSchedules || []).filter(bundle => bundle.semesterPlanId === semesterPlanId);
  if (bundles.length !== 1) result.reasons.push('Jadwal pertemuan semester aktif belum tersedia atau ganda.');
  const bundle = bundles.length === 1 ? bundles[0] : undefined;
  const semester = context.academicSetting.semester?.startsWith('1') ? 1 : context.academicSetting.semester?.startsWith('2') ? 2 : undefined;
  if (!bundle || bundle.semester !== semester) result.reasons.push('Identitas semester jadwal tidak cocok dengan konteks jurnal.');
  if (bundle && (bundle.schedule.basedOnMappingUpdatedAt !== context.atpUnitMapping?.updatedAt || bundle.schedule.basedOnUnitExecutionPlanUpdatedAt !== context.unitExecutionPlan?.updatedAt ||
      (context.calendar && bundle.schedule.basedOnCalendarUpdatedAt !== context.calendar.updatedAt) ||
      (context.subjectWeeklySchedule && bundle.schedule.basedOnSubjectWeeklyScheduleUpdatedAt !== context.subjectWeeklySchedule.updatedAt))) result.reasons.push('Jadwal belum diperbarui setelah perubahan Bab, pertemuan, kalender, atau jadwal mapel.');
  const placement = context.unitExecutionPlan && context.atpUnitMapping ? resolveUnitSemesterPlacement(context.unitExecutionPlan, context.atpUnitMapping) : undefined;
  if (!placement?.isValid || !placement.isComplete || placement.isStale) result.reasons.push('Penempatan semester Bab belum lengkap atau perlu diperbarui.');
  const activeUnits = new Set(placement?.resolvedUnits.filter(unit => unit.semester === semester).map(unit => unit.unitId));
  const expected = context.unitExecutionPlan?.units.filter(unit => activeUnits.has(unit.unitId)).flatMap(unit => unit.meetings) || [];
  const activeRows = canonical.rows.filter(row => row.semesterPlanId === semesterPlanId);
  for (const meeting of expected) if (!activeRows.some(row => row.meetingId === meeting.id)) result.reasons.push(`Pertemuan "${meeting.title}" (${meeting.id}) belum memiliki tanggal dan JP jadwal yang valid.`);
  for (const row of activeRows) {
    if ((context.learningMeetingSchedules || []).flatMap(bundle => (bundle.schedule?.entries || []).filter(entry => entry.meetingId === row.meetingId)).length !== 1) { result.reasons.push(`Pertemuan ${row.meetingId} memiliki jadwal ganda/lintas semester.`); continue; }
    if (!activeUnits.has(row.unitId) || row.semester !== semester) { result.reasons.push(`Pertemuan ${row.meetingId} berbeda penempatan semester Bab.`); continue; }
    if (!validJournalDate(row.date) || !Number.isFinite(row.jp) || row.jp <= 0) { result.reasons.push(`Tanggal/JP pertemuan ${row.meetingId} tidak valid.`); continue; }
    const day = (context.calendarDays || []).filter(day => day.date === row.date);
    if (day.length > 1 || day.some(day => normalizeCalendarDayStatus(day.status) !== 'EFFECTIVE_LEARNING')) { result.reasons.push(`Tanggal ${row.date} untuk pertemuan ${row.meetingId} bukan hari pembelajaran atau ambigu; perbarui jadwal.`); continue; }
    const tps = (row.linkedTpIds || []).map(id => context.tp?.items.find(item => item.id === id)).filter(Boolean);
    const atps = (row.linkedAtpItemIds || []).map(id => context.atp?.items.find(item => item.id === id)).filter(Boolean);
    if (row.linkedTpIds?.length && tps.length === 0) {
      result.warnings.push(`Pertemuan ${row.meetingId} belum memiliki rujukan TP yang tertaut.`);
    }
    const notes = (context.journalRealizations || []).filter(note => note.semesterPlanId === semesterPlanId && note.meetingId === row.meetingId);
    if (notes.length > 1) result.reasons.push(`Catatan realisasi pertemuan ${row.meetingId} ganda.`);
    const realization = notes.length === 1 ? structuredClone(notes[0]) : undefined;
    if (realization && ((realization.actualDate && !validJournalDate(realization.actualDate)) || (realization.actualJP !== undefined && (!Number.isFinite(realization.actualJP) || realization.actualJP <= 0)))) {
      result.reasons.push(`Tanggal/JP realisasi pertemuan ${row.meetingId} tidak valid.`); continue;
    }
    const actualDate = realization?.actualDate || row.date;
    const sessions = (context.attendanceSessions || []).filter(session => session.academicSettingId === semesterPlanId && session.date === actualDate && (!session.meetingId || session.meetingId === row.meetingId) &&
      (realization?.attendanceSessionId ? session.id === realization.attendanceSessionId : session.meetingId ? session.meetingId === row.meetingId : activeRows.filter(r => (context.journalRealizations?.find(n => n.semesterPlanId === semesterPlanId && n.meetingId === r.meetingId)?.actualDate || r.date) === actualDate).length === 1));
    let attendance = '';
    if (sessions.length === 1) {
      const records = (context.attendanceRecords || []).filter(record => record.sessionId === sessions[0].id);
      const roster = new Set((context.students || []).filter(student => student.academicSettingId === semesterPlanId).map(student => student.id));
      if (records.length && records.every(record => roster.has(record.studentId) && ['H','S','I','A','D'].includes(record.status)) && new Set(records.map(record => record.studentId)).size === records.length) {
        attendance = ['Hadir','Sakit','Izin','Alpa','Dispensasi'].map((label,index) => `${label}: ${records.filter(record => record.status === ['H','S','I','A','D'][index]).length}`).join('\n');
        if (records.length < roster.size) attendance += `\nBelum dicatat: ${roster.size-records.length}`;
      }
    }
    const plans = (context.learningPlans || []).filter(plan => plan.academicSettingId === semesterPlanId && plan.unitId === row.unitId && plan.status === 'SIAP' && plan.learningMeetingIds?.includes(row.meetingId));
    const plannedActivities = plans.length === 1 ? Object.values(plans[0].learningSteps || {}).flat().filter(activity => activity.learningMeetingId === row.meetingId).map(activity => activity.description).filter(Boolean) : [];
    result.rows.push({ meetingId: row.meetingId, semesterPlanId, unitId: row.unitId, unitTitle: row.unitTitle,
      materialIds: row.materials.map(m => m.id), materialTitles: row.materials.map(m => m.title),
      atpIds: row.linkedAtpItemIds, atpSteps: atps.map(atp => atp!.stepNumber), tpIds: row.linkedTpIds,
      tpLines: tps.map(tp => `[${tp!.code}] ${tp!.statement}`),
      plannedDate: row.date, plannedJP: row.jp, plannedActivity: plannedActivities.join('\n') || row.meetingTitle, realization, attendance });
  }
  if (!result.rows.length) result.reasons.push('Belum ada pertemuan terjadwal untuk jurnal semester ini.');
  result.reasons = [...new Set(result.reasons)];
  result.warnings = [...new Set(result.warnings)];
  result.isReady = result.reasons.length === 0 && result.rows.length === expected.length && expected.length > 0;
  return result;
}

export function jurnalRowCells(row: JurnalRow, index: number): string[] {
  const note = row.realization;
  const tanggalJpText = `Rencana: ${row.plannedDate}\n${row.plannedJP} JP${note?.actualDate ? `\nRealisasi: ${note.actualDate}` : ''}${note?.actualJP != null ? `\nJP riil: ${note.actualJP}` : ''}`;
  const materiKegiatanText = `${row.unitTitle}\n• Materi: ${row.materialTitles.join(', ') || '-'}\n• Kegiatan: ${row.plannedActivity}${note?.activities ? `\n• Realisasi: ${note.activities}` : ''}`;
  const tpText = row.tpLines.length > 0 ? row.tpLines.join('\n') : '(TP belum ditautkan)';
  const kehadiranCatatanText = [
    row.attendance,
    note?.outcome ? `Hasil: ${note.outcome}` : '',
    note?.obstacles ? `Kendala: ${note.obstacles}` : ''
  ].filter(Boolean).join('\n') || '-';

  return [
    String(index + 1),
    tanggalJpText,
    materiKegiatanText,
    tpText,
    kehadiranCatatanText,
    '\n\n\n', // Refleksi
    '\n\n\n'  // Tindak Lanjut
  ];
}
export function jurnalTableRows(projection: JurnalProjection, blank = false): string[][] {
  return blank ? Array.from({ length: 15 }, (_, i) => [String(i+1), ...Array(6).fill('')]) : projection.rows.map(jurnalRowCells);
}
