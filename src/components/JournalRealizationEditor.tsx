import React, { useState } from 'react';
import type { JournalRealization } from '../types';
import type { DocumentGenerationContext } from '../services/documentEngine/types';
import { buildJurnalProjection, JURNAL_COLUMNS, jurnalTableRows } from '../services/documentEngine/jurnalProjection';

export function JournalPreview({ context, onBlank }: { context: DocumentGenerationContext; onBlank: () => void }) {
  const projection = buildJurnalProjection(context);
  if (!projection.isReady) return <div role="alert" className="p-3 text-sm text-amber-900">
    <ul>{projection.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
    <button type="button" onClick={onBlank} className="mt-2 underline">Gunakan Format Kosong</button>
  </div>;
  return <div className="overflow-x-auto"><table className="w-full text-left text-[11px] border-collapse">
    <thead><tr>{JURNAL_COLUMNS.map(label => <th className="border p-2" key={label}>{label}</th>)}</tr></thead>
    <tbody>{jurnalTableRows(projection, context.documentMode === 'blank').map((row,index) => <tr key={index}>{row.map((cell,i) => <td key={i} className="border p-2 whitespace-pre-line">{cell}</td>)}</tr>)}</tbody>
  </table></div>;
}

export const JournalRealizationEditor: React.FC<{ context: DocumentGenerationContext; onSave: (note: JournalRealization) => boolean }> = ({ context, onSave }) => {
  const projection = buildJurnalProjection({ ...context, snapshot: undefined, documentMode: 'data' });
  const [meetingId, setMeetingId] = useState('');
  const row = projection.rows.find(row => row.meetingId === meetingId);
  if (!projection.isReady) return null;
  return <section className="p-4 border rounded-xl bg-white space-y-2 print:hidden">
    <h4 className="font-bold">Catat realisasi jurnal</h4>
    <p className="text-xs">Rencana tidak dianggap telah terlaksana. Kehadiran memakai presensi tersimpan; hasil, kendala, refleksi, dan tindak lanjut diisi guru. Untuk ekspor catatan terbaru, pilih Buat Baru; snapshot lama tetap tersimpan.</p>
    <select aria-label="Pertemuan jurnal" value={meetingId} onChange={event => setMeetingId(event.target.value)} className="border p-2 w-full">
      <option value="">Pilih pertemuan</option>
      {projection.rows.map(row => <option key={row.meetingId} value={row.meetingId}>{row.plannedDate} — {row.unitTitle} — {row.plannedActivity}</option>)}
    </select>
    {row && <RealizationForm key={`${row.semesterPlanId}:${row.meetingId}:${row.realization?.updatedAt || ''}`} context={context} meetingId={row.meetingId} note={row.realization} onSave={onSave} />}
  </section>;
}
const RealizationForm: React.FC<{ context: DocumentGenerationContext; meetingId: string; note?: JournalRealization; onSave: (note: JournalRealization) => boolean }> = ({ context, meetingId, note, onSave }) => {
  const [draft, setDraft] = useState<JournalRealization>(() => ({ ...note, meetingId, semesterPlanId: context.academicSetting.id, updatedAt: note?.updatedAt || '' }));
  const [notice, setNotice] = useState('');
  return <form className="space-y-2" onSubmit={event => {
    event.preventDefault();
    try { setNotice(onSave(draft) ? 'Catatan tersimpan di perangkat ini.' : 'Catatan belum tersimpan. Periksa konteks semester dan pertemuan.'); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Catatan belum tersimpan.'); }
  }}>
    <label className="block text-xs">Tanggal realisasi (isi bila sudah terlaksana)<input type="date" value={draft.actualDate || ''} onChange={event => setDraft({ ...draft, actualDate: event.target.value || undefined })} className="border p-1 ml-2" /></label>
    <label className="block text-xs">JP realisasi<input type="number" min="0.1" step="any" value={draft.actualJP ?? ''} onChange={event => setDraft({ ...draft, actualJP: event.target.value === '' ? undefined : Number(event.target.value) })} className="border p-1 ml-2" /></label>
    {([['activities','Kegiatan terlaksana'],['outcome','Hasil pembelajaran'],['obstacles','Kendala'],['reflection','Refleksi guru'],['followUp','Tindak lanjut']] as const).map(([key,label]) => <label key={key} className="block text-xs">{label}<textarea value={draft[key] || ''} onChange={event => setDraft({ ...draft, [key]: event.target.value })} className="block border p-2 w-full" /></label>)}
    <label className="block text-xs">Presensi tersimpan (opsional)<select value={draft.attendanceSessionId || ''} onChange={event => setDraft({ ...draft, attendanceSessionId: event.target.value || undefined })} className="block border p-1">
      <option value="">Gunakan presensi yang cocok secara pasti</option>
      {(context.attendanceSessions || []).filter(session => session.academicSettingId === context.academicSetting.id && (!session.meetingId || session.meetingId === meetingId)).map(session => <option key={session.id} value={session.id}>{session.date} — {session.topic || 'Pertemuan '+session.meetingNumber}</option>)}
    </select></label>
    <button type="submit" className="px-3 py-2 rounded bg-blue-900 text-white text-xs">Simpan Catatan Realisasi</button>
    {notice && <p role="status" className="text-xs">{notice}</p>}
  </form>;
}
