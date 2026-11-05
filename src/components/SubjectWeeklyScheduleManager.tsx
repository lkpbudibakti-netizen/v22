import React, { useState, useMemo, useEffect } from 'react';
import {
  SubjectWeeklySchedule,
  SubjectWeeklyScheduleSession,
  AcademicCalendar,
  CalendarDay,
} from '../types';
import {
  validateSubjectWeeklySchedule,
  resolvePlannedMeetingCapacity,
} from '../services/subjectScheduleService';
import { getEffectiveWeeksList } from '../services/jpEngine';
import {
  Calendar,
  Clock,
  Plus,
  Trash2,
  Save,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
} from 'lucide-react';

export interface SubjectWeeklyScheduleManagerProps {
  semesterPlanId: string;
  expectedWeeklyJP: number | null;
  schoolDaysPerWeek?: number | null;
  schedule?: SubjectWeeklySchedule;
  calendar?: AcademicCalendar;
  calendarDays?: CalendarDay[];
  onSave: (schedule: SubjectWeeklySchedule) => boolean;
}

function generateStableId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `sess-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export const SubjectWeeklyScheduleManager: React.FC<SubjectWeeklyScheduleManagerProps> = ({
  semesterPlanId,
  expectedWeeklyJP,
  schoolDaysPerWeek,
  schedule,
  calendar,
  calendarDays = [],
  onSave,
}) => {
  // Local draft state
  const [draft, setDraft] = useState<SubjectWeeklySchedule>(() => {
    if (schedule && schedule.semesterPlanId === semesterPlanId) {
      return JSON.parse(JSON.stringify(schedule));
    }
    return {
      semesterPlanId,
      sessions: [
        {
          id: generateStableId(),
          jp: expectedWeeklyJP && expectedWeeklyJP > 0 ? expectedWeeklyJP : 0,
          order: 1,
        },
      ],
      basedOnWeeklyJP: expectedWeeklyJP || 0,
      updatedAt: new Date().toISOString(),
    };
  });

  const [saveNotice, setSaveNotice] = useState<{
    type: 'success' | 'error' | 'warning';
    message: string;
  } | null>(null);

  // Sync draft when persisted schedule genuinely changes
  useEffect(() => {
    if (schedule && schedule.semesterPlanId === semesterPlanId) {
      setDraft(JSON.parse(JSON.stringify(schedule)));
    } else {
      setDraft((prev) => {
        if (prev.semesterPlanId === semesterPlanId) {
          const updatedSessions = prev.sessions.map((s, idx) => {
            if (s.jp <= 0 && idx === 0 && expectedWeeklyJP && expectedWeeklyJP > 0) {
              return { ...s, jp: expectedWeeklyJP };
            }
            return s;
          });
          return {
            ...prev,
            sessions: updatedSessions,
            basedOnWeeklyJP: expectedWeeklyJP || 0,
          };
        }
        return {
          semesterPlanId,
          sessions: [
            {
              id: generateStableId(),
              jp: expectedWeeklyJP && expectedWeeklyJP > 0 ? expectedWeeklyJP : 0,
              order: 1,
            },
          ],
          basedOnWeeklyJP: expectedWeeklyJP || 0,
          updatedAt: new Date().toISOString(),
        };
      });
    }
  }, [semesterPlanId, schedule?.semesterPlanId, schedule?.updatedAt, expectedWeeklyJP]);

  // Persisted Validation
  const persistedValidation = useMemo(() => {
    if (!schedule) return null;
    return validateSubjectWeeklySchedule(schedule, expectedWeeklyJP, schoolDaysPerWeek);
  }, [schedule, expectedWeeklyJP, schoolDaysPerWeek]);

  // Candidate Schedule
  const candidateSchedule = useMemo(() => {
    return {
      ...draft,
      basedOnWeeklyJP:
        expectedWeeklyJP && expectedWeeklyJP > 0
          ? expectedWeeklyJP
          : draft.basedOnWeeklyJP,
    };
  }, [draft, expectedWeeklyJP]);

  // Candidate Validation
  const candidateValidation = useMemo(() => {
    return validateSubjectWeeklySchedule(candidateSchedule, expectedWeeklyJP, schoolDaysPerWeek);
  }, [candidateSchedule, expectedWeeklyJP, schoolDaysPerWeek]);

  // Calculate effective weeks list
  const effectiveWeeks = useMemo(() => {
    if (!calendar || !calendarDays || calendarDays.length === 0) return 0;
    try {
      return getEffectiveWeeksList(calendar, calendarDays).length;
    } catch {
      return 0;
    }
  }, [calendar, calendarDays]);

  // Resolve planned meeting capacity
  const plannedResult = useMemo(() => {
    const calendarConfirmed = Boolean(calendar && calendar.workflowStatus === 'CONFIRMED');
    return resolvePlannedMeetingCapacity({
      schedule: candidateSchedule,
      expectedWeeklyJP,
      calendarConfirmed,
      effectiveWeekSlots: effectiveWeeks,
      calendar,
      calendarDays,
      semesterPlanId: candidateSchedule.semesterPlanId,
      schoolDaysPerWeek,
    });
  }, [candidateSchedule, expectedWeeklyJP, calendar, effectiveWeeks, calendarDays, schoolDaysPerWeek]);

  // Dirty state calculation
  const isDirty = useMemo(() => {
    if (!schedule) return true;
    return (
      JSON.stringify(draft.sessions) !== JSON.stringify(schedule.sessions) ||
      draft.basedOnWeeklyJP !== schedule.basedOnWeeklyJP
    );
  }, [draft, schedule]);

  const handleAddSession = () => {
    setDraft((prev) => {
      const nextOrder = prev.sessions.length + 1;
      const newSession: SubjectWeeklyScheduleSession = {
        id: generateStableId(),
        jp: 0,
        order: nextOrder,
      };
      return {
        ...prev,
        sessions: [...prev.sessions, newSession],
        updatedAt: new Date().toISOString(),
      };
    });
  };

  const handleUpdateSession = (sessionId: string, updates: Partial<SubjectWeeklyScheduleSession>) => {
    setDraft((prev) => {
      const newSessions = prev.sessions.map((s) => {
        if (s.id !== sessionId) return s;
        return { ...s, ...updates };
      });
      return {
        ...prev,
        sessions: newSessions,
        updatedAt: new Date().toISOString(),
      };
    });
  };

  const handleDeleteSession = (sessionId: string) => {
    setDraft((prev) => {
      const filtered = prev.sessions.filter((s) => s.id !== sessionId);
      const reordered = filtered.map((s, idx) => ({ ...s, order: idx + 1 }));
      return {
        ...prev,
        sessions: reordered,
        updatedAt: new Date().toISOString(),
      };
    });
  };

  const handleSave = () => {
    if (!expectedWeeklyJP || expectedWeeklyJP <= 0) {
      setSaveNotice({ type: 'error', message: 'JP mingguan canonical belum ditentukan.' });
      return;
    }

    const toSave: SubjectWeeklySchedule = {
      ...draft,
      basedOnWeeklyJP: expectedWeeklyJP,
      updatedAt: new Date().toISOString(),
    };

    const finalVal = validateSubjectWeeklySchedule(toSave, expectedWeeklyJP, schoolDaysPerWeek);
    if (!finalVal.isValid || !finalVal.isComplete || finalVal.isStale) {
      setSaveNotice({
        type: 'error',
        message: 'Pola pertemuan mingguan belum lengkap atau tidak valid sesuai JP mingguan.',
      });
      return;
    }

    const success = onSave(toSave);
    if (success) {
      setSaveNotice({ type: 'success', message: 'Pola pertemuan mingguan berhasil disimpan.' });
      setTimeout(() => setSaveNotice(null), 4000);
    } else {
      setSaveNotice({ type: 'error', message: 'Gagal menyimpan pola pertemuan.' });
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden mb-8">
      {/* Header */}
      <div className="p-5 sm:p-6 bg-slate-900 text-white flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-5 h-5 text-blue-400" />
            <h2 className="text-lg font-bold">Pola Pertemuan Mingguan</h2>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-semibold border border-blue-400/30">
              Pola Pertemuan
            </span>
          </div>
          <p className="text-xs text-slate-300">
            Tentukan jumlah pertemuan per minggu dan JP tiap pertemuan. Hari mengajar ditentukan nanti pada Alokasi Waktu.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <span className="block text-[10px] uppercase tracking-wider text-slate-400 font-bold">
              JP Mingguan Canonical
            </span>
            <span className="text-sm font-bold text-blue-400">
              {expectedWeeklyJP !== null ? `${expectedWeeklyJP} JP / minggu` : 'Belum Ditetapkan'}
            </span>
          </div>

          <button
            type="button"
            onClick={handleSave}
            disabled={!expectedWeeklyJP || expectedWeeklyJP <= 0 || !candidateValidation.isComplete || !isDirty}
            className={`px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition-all cursor-pointer ${
              !expectedWeeklyJP || expectedWeeklyJP <= 0 || !candidateValidation.isComplete || !isDirty
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                : 'bg-blue-600 text-white hover:bg-blue-500 shadow-md shadow-blue-600/20'
            }`}
          >
            <Save className="w-4 h-4" />
            <span>Simpan Pola Pertemuan</span>
          </button>
        </div>
      </div>

      {/* Save Notice */}
      {saveNotice && (
        <div
          className={`px-5 py-3 text-xs font-medium border-b flex items-center justify-between ${
            saveNotice.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : saveNotice.type === 'warning'
              ? 'bg-amber-50 text-amber-800 border-amber-200'
              : 'bg-rose-50 text-rose-800 border-rose-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {saveNotice.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : saveNotice.type === 'warning' ? (
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{saveNotice.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setSaveNotice(null)}
            className="text-[11px] font-bold underline hover:opacity-80 cursor-pointer"
          >
            Tutup
          </button>
        </div>
      )}

      {/* Persisted Stale Warning */}
      {persistedValidation?.isStale && (
        <div className="mx-5 mt-4 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">Perubahan JP Mingguan Terdeteksi</p>
            <p className="mt-0.5">
              JP mingguan berubah dari {schedule?.basedOnWeeklyJP ?? 0} menjadi {expectedWeeklyJP ?? 0} JP.
              Sesuaikan pola pertemuan lalu simpan ulang.
            </p>
          </div>
        </div>
      )}

      {/* Validation Errors */}
      {candidateValidation.errors.length > 0 && (
        <div className="mx-5 mt-4 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs">
          <ul className="list-disc pl-5 space-y-0.5">
            {candidateValidation.errors.map((err, idx) => (
              <li key={idx}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Schedule Table & Editor */}
      <div className="p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            Pertemuan Mingguan ({draft.sessions.length} Pertemuan)
          </div>
          <button
            type="button"
            onClick={handleAddSession}
            className="px-3 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-xs flex items-center gap-1.5 border border-blue-200 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Tambah Pertemuan Mingguan</span>
          </button>
        </div>

        <div className="space-y-3">
          {draft.sessions.map((session, idx) => (
            <div
              key={session.id}
              className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="flex items-center gap-3 flex-1">
                <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center shrink-0">
                  {idx + 1}
                </span>

                <div className="flex flex-row items-center gap-3 flex-1">
                  <div className="flex-1 text-xs font-bold text-slate-700">
                    Pertemuan {idx + 1}
                  </div>

                  <div className="w-48">
                    <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">
                      Jumlah JP
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={session.jp > 0 ? session.jp : ''}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        handleUpdateSession(session.id, {
                          jp: isNaN(val) ? 0 : Math.max(0, val),
                        });
                      }}
                      placeholder="JP..."
                      className="w-full text-xs font-semibold bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => handleDeleteSession(session.id)}
                  disabled={draft.sessions.length <= 1}
                  className="p-2 rounded-lg text-rose-500 hover:bg-rose-50 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                  title="Hapus Pertemuan"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Total Summary Bar */}
        <div className="p-4 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-between text-xs font-bold text-slate-800">
          <span>Total Alokasi JP Pertemuan:</span>
          <span
            className={`${
              candidateValidation.totalWeeklyJP === expectedWeeklyJP
                ? 'text-emerald-700'
                : 'text-rose-700'
            }`}
          >
            {candidateValidation.totalWeeklyJP} / {expectedWeeklyJP || 0} JP
          </span>
        </div>
      </div>

      {/* Capacity Summary Section */}
      <div className="p-5 sm:p-6 bg-slate-50 border-t border-slate-200 space-y-3">
        <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
          <Calendar className="w-4 h-4 text-blue-600" />
          <span>Kapasitas Pertemuan Perencanaan</span>
        </h3>

        {!plannedResult.isReady ? (
          <div className="p-4 rounded-xl border border-rose-200 bg-rose-50 text-rose-900 text-xs space-y-1">
            <p className="font-bold flex items-center gap-1.5 text-rose-800">
              <AlertTriangle className="w-4 h-4 text-rose-600" />
              <span>Gagal Menghitung Kapasitas Pertemuan Perencanaan</span>
            </p>
            <p className="font-semibold mt-0.5">
              {!calendar || calendar.workflowStatus !== 'CONFIRMED'
                ? 'Simpan dan tetapkan Kalender Pendidikan untuk menghitung kapasitas perencanaan.'
                : 'Lengkapi pola pertemuan dan pastikan Kalender Pendidikan valid.'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {isDirty ? (
              <div className="p-3.5 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-xs flex items-start gap-2.5 shadow-2xs">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Pratinjau draf — belum menjadi pola pertemuan tersimpan</p>
                  <p className="text-[11px] text-amber-800 mt-0.5">
                    Klik <strong>Simpan Pola Pertemuan</strong> untuk menyelesaikan tahap Waktu Semester.
                  </p>
                </div>
              </div>
            ) : schedule ? (
              <div className="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-950 text-xs flex items-center gap-2 shadow-2xs">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="font-bold">Pola pertemuan tersimpan</span>
              </div>
            ) : null}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-1">
                <span className="text-[10px] text-slate-500 font-bold uppercase">Pekan Efektif</span>
                <p className="text-base font-extrabold text-blue-600">{plannedResult.effectiveWeekSlots} Pekan</p>
              </div>
              <div className="p-3 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-1">
                <span className="text-[10px] text-slate-500 font-bold uppercase">Pertemuan / Minggu</span>
                <p className="text-base font-extrabold text-emerald-600">{plannedResult.meetingsPerWeek} Pertemuan</p>
              </div>
              <div className="p-3 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-1">
                <span className="text-[10px] text-slate-500 font-bold uppercase">
                  {plannedResult.capacitySource === 'ACTUAL_SLOTS' ? 'Pertemuan Aktual' : 'Pertemuan Rencana'}
                </span>
                <p className="text-base font-extrabold text-indigo-600">{plannedResult.totalMeetingCapacity} Pertemuan</p>
              </div>
              <div className="p-3 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-1">
                <span className="text-[10px] text-slate-500 font-bold uppercase">
                  {plannedResult.capacitySource === 'ACTUAL_SLOTS' ? 'JP Aktual' : 'JP Rencana'}
                </span>
                <p className="text-base font-extrabold text-amber-600">{plannedResult.totalJP} JP</p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-950 text-[11px] font-medium leading-relaxed">
              {plannedResult.capacitySource === 'ACTUAL_SLOTS' ? (
                <span>
                  ✓ <strong>Terkonfirmasi:</strong> Kapasitas dihitung dari slot tanggal efektif pembelajaran pada Kalender Pendidikan.
                  {typeof plannedResult.calendarLostJP === 'number' && plannedResult.calendarLostJP > 0 && ` Terdampak libur: -${plannedResult.calendarLostJP} JP.`}
                </span>
              ) : (
                <span>
                  💡 <strong>Catatan:</strong> Kapasitas di atas adalah estimasi sementara ({plannedResult.effectiveWeekSlots} pekan × {plannedResult.meetingsPerWeek} pertemuan). Slot tanggal aktual ditetapkan setelah hari mengajar dialokasikan pada Alokasi Waktu.
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
