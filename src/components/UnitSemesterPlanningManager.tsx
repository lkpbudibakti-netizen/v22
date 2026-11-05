import React, { useState, useMemo, useEffect } from 'react';
import {
  ATPUnitMappingData,
  UnitExecutionPlanData,
  UnitSemesterPlacement,
} from '../types';
import {
  resolveUnitSemesterPlacement,
  suggestSemesterBoundary,
} from '../services/unitSemesterPlanningService';
import { createEmptyUnitExecutionPlanData } from '../services/unitExecutionPlanService';
import { buildUnitSemesterPlanningDiagnosticReport } from '../services/diagnosticService';
import {
  Layers,
  Sparkles,
  Save,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Info,
  Calendar,
  BookOpen,
} from 'lucide-react';

export interface UnitSemesterPlanningManagerProps {
  mapping: ATPUnitMappingData;
  unitExecutionPlan: UnitExecutionPlanData;
  s1AvailableJP: number | null;
  s2AvailableJP: number | null;
  onSave: (plan: UnitExecutionPlanData) => boolean;
}

export const UnitSemesterPlanningManager: React.FC<UnitSemesterPlanningManagerProps> = ({
  mapping,
  unitExecutionPlan,
  s1AvailableJP,
  s2AvailableJP,
  onSave,
}) => {
  // Local draft state for semesterPlacement (can be undefined if not yet set)
  const [placementDraft, setPlacementDraft] = useState<UnitSemesterPlacement | undefined>(() => {
    if (unitExecutionPlan.semesterPlacement) {
      return JSON.parse(JSON.stringify(unitExecutionPlan.semesterPlacement));
    }
    return undefined;
  });

  const [saveNotice, setSaveNotice] = useState<{
    type: 'success' | 'error' | 'warning';
    message: string;
  } | null>(null);
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);

  const handleSyncMapping = () => {
    const freshPlan = createEmptyUnitExecutionPlanData(mapping);
    const success = onSave(freshPlan);
    if (success) {
      setIsSyncModalOpen(false);
      setPlacementDraft(undefined);
      setSaveNotice({
        type: 'success',
        message: 'Struktur Pertemuan berhasil disinkronkan dengan Pemetaan terbaru. Tetapkan kembali pembagian Semester 1 dan Semester 2.',
      });
      setTimeout(() => setSaveNotice(null), 6000);
    } else {
      setSaveNotice({
        type: 'error',
        message: 'Gagal melakukan sinkronisasi.',
      });
      setTimeout(() => setSaveNotice(null), 4000);
    }
  };

  // Sync draft only when persisted placement genuinely changes (stable scalar dependency)
  useEffect(() => {
    if (unitExecutionPlan.semesterPlacement) {
      setPlacementDraft(JSON.parse(JSON.stringify(unitExecutionPlan.semesterPlacement)));
    } else {
      setPlacementDraft(undefined);
    }
  }, [unitExecutionPlan?.id, unitExecutionPlan?.semesterPlacement?.updatedAt]);

  // Temporary draft plan combining parent unitExecutionPlan with local placementDraft
  const draftPlan: UnitExecutionPlanData = useMemo(() => {
    const plan: UnitExecutionPlanData = { ...unitExecutionPlan };
    if (placementDraft !== undefined) {
      plan.semesterPlacement = placementDraft;
    } else {
      delete plan.semesterPlacement;
    }
    return plan;
  }, [unitExecutionPlan, placementDraft]);

  // Validation
  const validation = useMemo(() => {
    return resolveUnitSemesterPlacement(draftPlan, mapping);
  }, [draftPlan, mapping]);

  // Substantive Dirty state comparison (ignoring updatedAt)
  const isDirty = useMemo(() => {
    const persisted = unitExecutionPlan.semesterPlacement;
    const draft = placementDraft;
    if (!persisted && !draft) return false;
    if (!persisted || !draft) return true;
    return (
      persisted.mode !== draft.mode ||
      persisted.semester1LastUnitId !== draft.semester1LastUnitId
    );
  }, [placementDraft, unitExecutionPlan.semesterPlacement]);

  const sortedUnits = useMemo(() => {
    return [...(mapping.units || [])].sort((a, b) => a.order - b.order);
  }, [mapping]);

  // Unit meeting counts lookup map
  const unitMeetingCounts = useMemo(() => {
    const map = new Map<string, number>();
    (unitExecutionPlan.units || []).forEach((u) => {
      map.set(u.unitId, (u.meetings || []).length);
    });
    return map;
  }, [unitExecutionPlan]);

  const handleBoundaryChange = (val: string) => {
    if (val === '__UNSET__') {
      setPlacementDraft(undefined);
    } else if (val === '__NONE__') {
      setPlacementDraft({
        mode: 'CONTIGUOUS_BOUNDARY',
        semester1LastUnitId: null,
        updatedAt: new Date().toISOString(),
      });
    } else {
      setPlacementDraft({
        mode: 'CONTIGUOUS_BOUNDARY',
        semester1LastUnitId: val,
        updatedAt: new Date().toISOString(),
      });
    }
  };

  const hasValidCapacity =
    s1AvailableJP !== null &&
    s2AvailableJP !== null &&
    s1AvailableJP > 0 &&
    s2AvailableJP > 0;

  const handleSuggest = () => {
    if (!hasValidCapacity) return;
    const suggestedId = suggestSemesterBoundary(unitExecutionPlan, mapping, s1AvailableJP, s2AvailableJP);
    if (suggestedId !== undefined) {
      setPlacementDraft({
        mode: 'CONTIGUOUS_BOUNDARY',
        semester1LastUnitId: suggestedId,
        updatedAt: new Date().toISOString(),
      });
      setSaveNotice({
        type: 'warning',
        message: 'Saran pembagian semester telah diterapkan pada draf. Tinjau dan klik Simpan Pembagian Semester.',
      });
    } else {
      alert('Jumlah Unit/Bab kurang dari 2, penentuan semester dapat dilakukan secara manual.');
    }
  };

  const handleSave = () => {
    if (!placementDraft) return;

    if (!validation.isValid) {
      setSaveNotice({
        type: 'error',
        message: 'Pembagian semester tidak valid. Periksa kembali batas akhir Semester 1.',
      });
      return;
    }

    if (validation.isStale) {
      setSaveNotice({
        type: 'error',
        message: 'Data stale relatif terhadap pemetaan terbaru.',
      });
      return;
    }

    const updatedPlan: UnitExecutionPlanData = {
      ...unitExecutionPlan,
      semesterPlacement: {
        ...placementDraft,
        updatedAt: new Date().toISOString(),
      },
      updatedAt: new Date().toISOString(),
    };

    const success = onSave(updatedPlan);
    if (success) {
      setSaveNotice({
        type: 'success',
        message: 'Pembagian Unit/Bab ke Semester berhasil disimpan.',
      });
      setTimeout(() => setSaveNotice(null), 4000);
    }
  };

  const handleCopyDiagnostic = async () => {
    try {
      const report = buildUnitSemesterPlanningDiagnosticReport({
        mapping,
        unitExecutionPlan: draftPlan,
        validation,
        s1AvailableJP,
        s2AvailableJP,
      });

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(report);
      } else {
        const area = document.createElement('textarea');
        area.value = report;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);

        try {
          area.select();
          const copied = document.execCommand('copy');
          if (!copied) {
            throw new Error('Clipboard fallback gagal.');
          }
        } finally {
          if (area.parentNode) {
            area.parentNode.removeChild(area);
          }
        }
      }

      setSaveNotice({
        type: 'success',
        message: 'Diagnostik Pembagian Bab berhasil disalin.',
      });
      setTimeout(() => setSaveNotice(null), 4000);
    } catch (err: any) {
      setSaveNotice({
        type: 'error',
        message: `Gagal menyalin diagnostik: ${err?.message || err}`,
      });
      setTimeout(() => setSaveNotice(null), 4000);
    }
  };

  // Separate units into S1 and S2 based on validation resolvedUnits if placementDraft is set
  const sem1Units = useMemo(() => {
    if (!placementDraft) return [];
    const s1Ids = new Set(validation.semester1UnitIds);
    return sortedUnits.filter((u) => s1Ids.has(u.id));
  }, [sortedUnits, validation.semester1UnitIds, placementDraft]);

  const sem2Units = useMemo(() => {
    if (!placementDraft) return sortedUnits; // If unset, preview shows all units as unassigned / default
    const s2Ids = new Set(validation.semester2UnitIds);
    return sortedUnits.filter((u) => s2Ids.has(u.id));
  }, [sortedUnits, validation.semester2UnitIds, placementDraft]);

  const selectValue =
    placementDraft === undefined
      ? '__UNSET__'
      : placementDraft.semester1LastUnitId === null
      ? '__NONE__'
      : placementDraft.semester1LastUnitId;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden mb-8">
      {/* Header */}
      <div className="p-5 sm:p-6 bg-slate-900 text-white flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Calendar className="w-5 h-5 text-blue-400" />
            <h2 className="text-lg font-bold">Pembagian Unit/Bab ke Semester</h2>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-semibold border border-blue-400/30">
              Whole Unit Placement
            </span>
          </div>
          <p className="text-xs text-slate-300">
            Satu Unit/Bab ditempatkan utuh pada satu semester. Pertemuan mengikuti semester Unit.
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {validation.isComplete ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              <CheckCircle2 className="w-3.5 h-3.5" /> PENEMPATAN LENGKAP
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
              <AlertCircle className="w-3.5 h-3.5" /> BELUM DITETAPKAN
            </span>
          )}

          <button
            type="button"
            onClick={handleCopyDiagnostic}
            className="px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition-all cursor-pointer bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
          >
            <span>Salin Diagnostik</span>
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={!placementDraft || !isDirty || !validation.isValid || validation.isStale}
            className={`px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition-all cursor-pointer ${
              !placementDraft || !isDirty || !validation.isValid || validation.isStale
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                : 'bg-blue-600 text-white hover:bg-blue-500 shadow-md shadow-blue-600/20'
            }`}
          >
            <Save className="w-4 h-4" />
            <span>Simpan Pembagian Semester</span>
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

      {/* Sync Modal */}
      {isSyncModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full space-y-4">
            <h3 className="font-bold text-lg text-slate-900">Sinkronisasi Pemetaan</h3>
            <p className="text-sm text-slate-600">
              Sinkronisasi akan:
              <br/>- membuat struktur Unit sesuai Pemetaan terbaru
              <br/>- menghapus Struktur Pertemuan lama
              <br/>- menghapus pembagian semester lama
              <br/>- tidak mengubah Waktu Semester 1 & 2
              <br/><br/>Lanjutkan?
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setIsSyncModalOpen(false)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer">Batal</button>
              <button onClick={handleSyncMapping} className="px-4 py-2 text-sm font-bold bg-blue-600 text-white hover:bg-blue-500 rounded-xl cursor-pointer">Lanjutkan</button>
            </div>
          </div>
        </div>
      )}

      {/* Warnings / Errors */}
      {validation.isStale && (
        <div className="mx-5 mt-4 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 flex items-center justify-between gap-4 text-xs">
          <p>
            <strong>Pemetaan Unit/Bab telah berubah.</strong><br/>
            Struktur Pertemuan masih menggunakan versi lama. Sinkronkan terlebih dahulu sebelum menyimpan pembagian semester.
          </p>
          <button
            type="button"
            onClick={() => setIsSyncModalOpen(true)}
            className="px-4 py-2 rounded-xl font-bold bg-amber-600 text-white hover:bg-amber-500 transition cursor-pointer shrink-0"
          >
            Sinkronkan dengan Pemetaan Terbaru
          </button>
        </div>
      )}
      {validation.errors.length > 0 && (
        <div className="mx-5 mt-4 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs">
          <ul className="list-disc pl-5 space-y-0.5">
            {validation.errors.map((err, idx) => (
              <li key={idx}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {validation.warnings.length > 0 && (
        <div className="mx-5 mt-4 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs">
          <ul className="list-disc pl-5 space-y-0.5">
            {validation.warnings.map((warn, idx) => (
              <li key={idx}>{warn}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Boundary Control & Suggestion */}
      <div className="p-5 sm:p-6 bg-slate-50 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1">
          <label className="text-xs font-bold text-slate-700 shrink-0">
            Batas Akhir Semester 1:
          </label>
          <select
            value={selectValue}
            onChange={(e) => handleBoundaryChange(e.target.value)}
            className="text-xs font-semibold bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-600 max-w-sm"
          >
            <option value="__UNSET__">Belum ditetapkan</option>
            <option value="__NONE__">Tidak ada Unit di Semester 1 (Semua masuk Semester 2)</option>
            {sortedUnits.map((u) => (
              <option key={u.id} value={u.id}>
                Setelah {u.title || `Bab ${u.order}`}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0">
          <button
            type="button"
            onClick={handleSuggest}
            disabled={!hasValidCapacity}
            className="px-4 py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-xs border border-indigo-200 flex items-center gap-1.5 shadow-2xs transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Sarankan Pembagian</span>
          </button>
          {!hasValidCapacity && (
            <span className="text-[11px] text-amber-700 font-medium">
              Lengkapi kapasitas Kalender/JP Semester 1 dan Semester 2 untuk mendapatkan saran otomatis.
            </span>
          )}
        </div>
      </div>

      <div className="px-5 py-2 text-[11px] text-slate-500 bg-white border-b border-slate-100">
        <em>Saran didasarkan pada rasio kapasitas semester dan jumlah Pertemuan per Unit. Guru tetap menetapkan hasil akhir.</em>
      </div>

      {/* Preview Two Columns */}
      <div className="p-5 sm:p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Semester 1 Section */}
        <div className="rounded-2xl border border-blue-200 bg-blue-50/30 p-4 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-blue-100">
            <h3 className="font-bold text-blue-900 text-sm flex items-center gap-2">
              <Calendar className="w-4 h-4 text-blue-700" />
              <span>SEMESTER 1 (Ganjil)</span>
            </h3>
            <span className="text-xs font-bold bg-blue-100 text-blue-800 px-2.5 py-0.5 rounded-full">
              {sem1Units.length} Unit
            </span>
          </div>

          {placementDraft === undefined ? (
            <div className="p-6 text-center rounded-xl border border-dashed border-blue-200 bg-white/50 text-xs text-slate-500">
              Belum ditetapkan — pilih Batas Akhir Semester 1 di atas.
            </div>
          ) : sem1Units.length === 0 ? (
            <div className="p-6 text-center rounded-xl border border-dashed border-blue-200 bg-white/50 text-xs text-slate-500">
              Tidak ada Unit di Semester 1
            </div>
          ) : (
            <div className="space-y-2">
              {sem1Units.map((u) => {
                const meetingsCount = unitMeetingCounts.get(u.id) || 0;
                return (
                  <div key={u.id} className="p-3 rounded-xl bg-white border border-blue-100 shadow-2xs flex items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-blue-600 shrink-0" />
                      <span className="font-bold text-slate-900">{u.title || `Bab ${u.order}`}</span>
                    </div>
                    <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">
                      {meetingsCount} Pertemuan
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Semester 2 Section */}
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50/30 p-4 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-indigo-100">
            <h3 className="font-bold text-indigo-900 text-sm flex items-center gap-2">
              <Calendar className="w-4 h-4 text-indigo-700" />
              <span>SEMESTER 2 (Genap)</span>
            </h3>
            <span className="text-xs font-bold bg-indigo-100 text-indigo-800 px-2.5 py-0.5 rounded-full">
              {sem2Units.length} Unit
            </span>
          </div>

          {placementDraft === undefined ? (
            <div className="p-6 text-center rounded-xl border border-dashed border-indigo-200 bg-white/50 text-xs text-slate-500">
              Belum ditetapkan (pratinjau default semua unit).
            </div>
          ) : sem2Units.length === 0 ? (
            <div className="p-6 text-center rounded-xl border border-dashed border-indigo-200 bg-white/50 text-xs text-slate-500">
              Tidak ada Unit di Semester 2
            </div>
          ) : (
            <div className="space-y-2">
              {sem2Units.map((u) => {
                const meetingsCount = unitMeetingCounts.get(u.id) || 0;
                return (
                  <div key={u.id} className="p-3 rounded-xl bg-white border border-indigo-100 shadow-2xs flex items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-indigo-600 shrink-0" />
                      <span className="font-bold text-slate-900">{u.title || `Bab ${u.order}`}</span>
                    </div>
                    <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">
                      {meetingsCount} Pertemuan
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
