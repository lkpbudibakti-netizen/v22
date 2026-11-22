import React, { useMemo, useState } from 'react';
import { Calendar, Clock, BookOpen, AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Edit2 } from 'lucide-react';
import {
  AcademicSetting,
  ATPUnitMappingData,
  UnitExecutionPlanData,
  LearningMeetingScheduleData,
  TPData,
  ATPData,
  SemesterJPSetting,
  AnnualJPReference,
} from '../../types';
import { resolveScheduledLearningMeetings } from '../../services/scheduledLearningMeetingProjectionService';
import { resolveSemesterJPFromValues } from '../../services/semesterJPResolver';

interface SemesterScheduleSummaryProps {
  academicSetting: AcademicSetting;
  atpUnitMapping?: ATPUnitMappingData;
  unitExecutionPlan?: UnitExecutionPlanData;
  learningMeetingSchedules?: {
    semesterPlanId: string;
    semester: 1 | 2;
    schedule: LearningMeetingScheduleData;
  }[];
  tp?: TPData;
  atp?: ATPData;
  semesterJPSetting?: SemesterJPSetting;
  annualJPReference?: AnnualJPReference;
  onBackToAnnualPlanning?: () => void;
}

export const SemesterScheduleSummary: React.FC<SemesterScheduleSummaryProps> = ({
  academicSetting,
  atpUnitMapping,
  unitExecutionPlan,
  learningMeetingSchedules = [],
  tp,
  atp,
  semesterJPSetting,
  annualJPReference,
  onBackToAnnualPlanning,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const activeSemesterNum = useMemo(() => {
    return academicSetting?.semester?.includes('1') ||
      academicSetting?.semester?.toLowerCase().includes('ganjil')
      ? 1
      : 2;
  }, [academicSetting]);

  const resolvedJP = useMemo(() => {
    return resolveSemesterJPFromValues(semesterJPSetting, annualJPReference);
  }, [semesterJPSetting, annualJPReference]);

  const projection = useMemo(() => {
    if (!atpUnitMapping || !unitExecutionPlan || !learningMeetingSchedules || learningMeetingSchedules.length === 0) {
      return {
        rows: [],
        isReady: false,
        errors: ['Prasyarat Perencanaan Tahunan (Step 08) belum lengkap. Silakan selesaikan Jadwal Aktual terlebih dahulu.'],
      };
    }

    try {
      const result = resolveScheduledLearningMeetings({
        mapping: atpUnitMapping,
        unitExecutionPlan,
        schedules: learningMeetingSchedules,
        tp,
        atp,
      });

      return {
        rows: result.rows,
        isReady: result.isValid && result.rows.length > 0,
        errors: result.errors,
      };
    } catch (err: any) {
      return {
        rows: [],
        isReady: false,
        errors: [err.message || 'Gagal meresolusi proyeksi jadwal.'],
      };
    }
  }, [atpUnitMapping, unitExecutionPlan, learningMeetingSchedules, tp, atp]);

  const activeRows = useMemo(() => {
    return projection.rows.filter((r) => r.semester === activeSemesterNum);
  }, [projection.rows, activeSemesterNum]);

  const sortedRows = useMemo(() => {
    return [...activeRows].sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      if (dateCompare !== 0) return dateCompare;
      const unitCompare = a.unitOrder - b.unitOrder;
      if (unitCompare !== 0) return unitCompare;
      return a.meetingOrder - b.meetingOrder;
    });
  }, [activeRows]);

  const meetingCount = activeRows.length;
  const totalJP = activeRows.reduce((sum, r) => sum + r.jp, 0);
  const firstDate = sortedRows[0]?.date;
  const lastDate = sortedRows.at(-1)?.date;

  const isK13Curriculum =
    academicSetting.curriculumType === 'K13' || academicSetting.curriculum?.includes('2013');

  if (isK13Curriculum) {
    return null;
  }

  const formatIndonesianDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    const months = ['Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des', 'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun'];
    const idMonths = {
      '01': 'Jan', '02': 'Feb', '03': 'Mar', '04': 'Apr', '05': 'Mei', '06': 'Jun',
      '07': 'Jul', '08': 'Agu', '09': 'Sep', '10': 'Okt', '11': 'Nov', '12': 'Des'
    };
    try {
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        const year = parts[0];
        const monthKey = parts[1];
        const day = parseInt(parts[2], 10);
        const monthName = idMonths[monthKey as keyof typeof idMonths] || monthKey;
        return `${day} ${monthName} ${year}`;
      }
      return dateStr;
    } catch {
      return dateStr;
    }
  };

  const rangeString = firstDate && lastDate
    ? `${formatIndonesianDate(firstDate)} – ${formatIndonesianDate(lastDate)}`
    : '-';

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs mb-6">
      {/* Header Bar */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-slate-50 cursor-pointer hover:bg-slate-100/80 transition-colors gap-3"
      >
        <div className="flex items-center gap-3">
          <Calendar className="w-5 h-5 text-indigo-600 shrink-0" />
          <div>
            <h3 className="text-sm font-bold text-slate-800">
              Ringkasan Jadwal &amp; Alokasi Waktu Semester {activeSemesterNum} (Read-Only)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Menggunakan jadwal aktual terencana dari Step 08 sebagai otoritas tunggal.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 self-end sm:self-center">
          {projection.isReady ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-semibold">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>SIAP</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-rose-50 text-rose-800 border border-rose-200 text-xs font-semibold">
              <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
              <span>BELUM SIAP</span>
            </span>
          )}
          {isOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </div>
      </div>

      {/* Main Stats Block */}
      <div className="p-4 grid grid-cols-2 md:grid-cols-5 gap-4 border-t border-slate-100 bg-white text-xs">
        <div className="p-3 rounded-lg bg-slate-50/60 border border-slate-100">
          <span className="text-slate-500 font-medium block">Jadwal Aktual</span>
          <span className={`text-sm font-bold mt-1.5 block ${projection.isReady ? 'text-emerald-700' : 'text-rose-600'}`}>
            {projection.isReady ? 'SIAP' : 'BELUM SIAP'}
          </span>
        </div>
        <div className="p-3 rounded-lg bg-slate-50/60 border border-slate-100">
          <span className="text-slate-500 font-medium block">JP / Minggu</span>
          <span className="text-sm font-bold text-slate-800 mt-1.5 block">
            {resolvedJP.weeklyJP ? `${resolvedJP.weeklyJP} JP` : '-'}
          </span>
        </div>
        <div className="p-3 rounded-lg bg-slate-50/60 border border-slate-100">
          <span className="text-slate-500 font-medium block">Pertemuan</span>
          <span className="text-sm font-bold text-slate-800 mt-1.5 block">
            {projection.isReady ? `${meetingCount}` : '0'}
          </span>
        </div>
        <div className="p-3 rounded-lg bg-slate-50/60 border border-slate-100">
          <span className="text-slate-500 font-medium block">Total JP Aktual</span>
          <span className="text-sm font-bold text-indigo-600 mt-1.5 block">
            {projection.isReady ? `${totalJP} JP` : '0 JP'}
          </span>
        </div>
        <div className="p-3 rounded-lg bg-slate-50/60 border border-slate-100 col-span-2 md:col-span-1">
          <span className="text-slate-500 font-medium block">Rentang Jadwal</span>
          <span className="text-xs font-semibold text-slate-800 mt-1.5 block leading-tight">
            {rangeString}
          </span>
        </div>
      </div>

      {/* Helper Banner & Action Button */}
      <div className="p-4 bg-indigo-50/30 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
        <span className="text-indigo-900 font-medium flex items-center gap-1.5">
          <Clock className="w-4 h-4 text-indigo-600 shrink-0" />
          <span>Perubahan hari mengajar atau jadwal aktual hanya dapat disesuaikan pada Step 08 Rencana Tahunan.</span>
        </span>
        {onBackToAnnualPlanning && (
          <button
            type="button"
            onClick={onBackToAnnualPlanning}
            className="inline-flex items-center gap-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg transition shrink-0 cursor-pointer"
          >
            <Edit2 className="w-3 h-3" />
            <span>Ubah di Rencana Tahunan</span>
          </button>
        )}
      </div>

      {/* Error Block */}
      {!projection.isReady && (
        <div className="p-4 bg-rose-50/50 border-t border-slate-100 text-xs text-rose-800 space-y-1">
          <div className="font-bold flex items-center gap-1 text-rose-900">
            <AlertCircle className="w-4 h-4" />
            <span>Perencanaan Waktu Tidak Valid</span>
          </div>
          <ul className="list-disc pl-5 mt-1 space-y-0.5">
            {projection.errors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Expandable Schedule Row List */}
      {isOpen && projection.isReady && (
        <div className="border-t border-slate-100 max-h-96 overflow-y-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-100 sticky top-0">
              <tr>
                <th className="py-2.5 px-4 w-12 text-center">No</th>
                <th className="py-2.5 px-3">Tanggal / Hari</th>
                <th className="py-2.5 px-3">Unit / Bab &amp; Pertemuan</th>
                <th className="py-2.5 px-3">Materi Pembelajaran</th>
                <th className="py-2.5 px-4 text-center w-20">Alokasi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedRows.map((row, index) => (
                <tr key={row.meetingId} className="hover:bg-slate-50/50 transition-colors">
                  <td className="py-2.5 px-4 text-center text-slate-400 font-semibold">{index + 1}</td>
                  <td className="py-2.5 px-3 font-medium text-slate-800 whitespace-nowrap">
                    <div>{formatIndonesianDate(row.date)}</div>
                    <div className="text-[10px] text-slate-400 font-normal">Pekan {row.weekIndex}</div>
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="font-semibold text-indigo-950">{row.unitTitle}</div>
                    <div className="text-[11px] text-slate-500 font-medium">{row.meetingTitle}</div>
                  </td>
                  <td className="py-2.5 px-3 text-slate-600 font-medium">
                    {row.materials && row.materials.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {row.materials.map((m) => (
                          <span key={m.id} className="px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded text-[10px] border border-slate-200">
                            {m.title}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-slate-400 italic">Materi Kegiatan Belajar</span>
                    )}
                  </td>
                  <td className="py-2.5 px-4 text-center font-bold text-indigo-700">{row.jp} JP</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
