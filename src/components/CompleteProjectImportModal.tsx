import React, { useMemo, useRef, useState } from 'react';
import { Upload, X, FileArchive } from 'lucide-react';
import type { AppStorageStateV5 } from '../types/storageV5';
import type { CompleteProjectArchive, CompleteProjectImportOptions } from '../types/completeProjectTransfer';
import { ADMINISTRATION_IMPORT_MODES } from '../types/completeProjectTransfer';
import { GRADE_PHASE_MAP } from '../data/curriculumDefaults';
import { resolveGrade } from '../services/cognitiveAdaptationService';
import { readCompleteProjectZip } from '../services/completeProjectZipService';
import { importCompleteAdministrationProject, importCompleteAdministrationProjectAndExport, prepareCompleteAdministrationProjectImport } from '../services/administrationProjectImportService';
import { importedProjectExportReadiness } from '../services/identityOnlyProjectExport';
import { generateZipBundle } from '../services/documentEngine';
import type { ZipExportResult, ZipExportFormat } from '../services/documentEngine/types';
import { loadStorageV5 } from '../services/storageV5';
import { getLocalTodayDocumentDate } from '../services/documentDateService';

type ImportedView = Pick<ReturnType<typeof importCompleteAdministrationProject>, 'state' | 'yearPlanId' | 'warnings' | 'mode' | 'nextStep'>;
export function CompleteProjectImportModal({ state, onClose, onSuccess, onContinue, importedYearPlanId }: {
  state: AppStorageStateV5; onClose: () => void;
  onSuccess: (result: ReturnType<typeof importCompleteAdministrationProject>) => void;
  onContinue?: (step: ReturnType<typeof importCompleteAdministrationProject>['nextStep']) => void;
  importedYearPlanId?: string;
}) {
  const [archive, setArchive] = useState<CompleteProjectArchive>();
  const [profileId, setProfileId] = useState(state.activeProfileId || state.profiles[0]?.id || '');
  const [mode, setMode] = useState<CompleteProjectImportOptions['mode']>('IDENTITY_ONLY');
  const submitting = useRef(false);
  const [documentDate] = useState(getLocalTodayDocumentDate());
  const [targetGrade, setTargetGrade] = useState('');
  const [targetClassSection, setTargetClassSection] = useState('');
  const [completed, setCompleted] = useState<ImportedView | undefined>(() => importedYearPlanId ? {
    state, yearPlanId: importedYearPlanId, warnings: [], mode: state.yearPlans.find(year=>year.id===importedYearPlanId)?.identityOnlyImport?.mode || 'CONTINUE_EDITING', nextStep: 'admin',
  } : undefined);
  const [zipResult, setZipResult] = useState<ZipExportResult>();
  const [zipFormat, setZipFormat] = useState<ZipExportFormat>('both');
  const [replace, setReplace] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const profile = state.profiles.find(p => p.id === profileId);
  const legacyMode = mode === 'COPY' || mode === 'RESTORE';
  const options: CompleteProjectImportOptions = { mode, targetProfileId: profileId, targetSchoolId: profile?.schoolId || '',
    documentDate,
    ...(mode === 'OTHER_CLASS' ? { targetGrade, targetClassSection } : {}),
    replaceYearPlanId: replace && mode === 'RESTORE' ? archive?.project.yearPlans[0].id : undefined };
  const preview = useMemo(() => {
    if (!archive || completed || mode === 'IDENTITY_ONLY') return undefined;
    try { return { result: prepareCompleteAdministrationProjectImport(state, archive, options), error: '' }; }
    catch (e) { return { result: undefined, error: e instanceof Error ? e.message : String(e) }; }
  }, [archive, state, mode, profileId, replace, documentDate, completed, targetGrade, targetClassSection]);
  const exportReadiness = useMemo(() => {
    if (!completed) return undefined;
    try { return { ...importedProjectExportReadiness(completed.state, completed.yearPlanId), error: '' }; }
    catch (error) { return { rows: [], readyCount: 0, skippedCount: 0, error: error instanceof Error ? error.message : 'Kesiapan ekspor belum dapat diperiksa.' }; }
  }, [completed]);
  const source = archive?.project;
  const sourceYear = source?.yearPlans[0];
  const progress = source ? [
    ['CP', source.annualData.cp.length], ['Analisis CP', source.annualData.cpAnalysis.length],
    ['TP', source.annualData.tp.reduce((n, e) => n + e.value.items.length, 0)],
    ['ATP', source.annualData.atp.reduce((n, e) => n + e.value.items.length, 0)],
    ['Bab', source.annualData.atpUnitMappings?.reduce((n, e) => n + e.value.units.length, 0) || 0],
    ['Lingkup Materi', source.annualData.atpUnitMappings?.reduce((n, e) => n + e.value.units.reduce((s, u) => s + u.materials.length, 0), 0) || 0],
    ['Pertemuan', source.annualData.unitExecutionPlans?.reduce((n, e) => n + e.value.units.reduce((s, u) => s + u.meetings.length, 0), 0) || 0],
    ['Rencana Pembelajaran', source.semesterData.learningPlan.reduce((n, e) => n + e.value.length, 0)],
    ['Paket Asesmen', source.semesterData.assessmentPackage.reduce((n, e) => n + e.value.length, 0)],
    ['Siswa', source.semesterData.roster.reduce((n, e) => n + e.value.length, 0)],
  ] : [];
  if (completed) return <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Ringkasan Kesiapan Ekspor">
    <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-auto space-y-4" data-export-busy={busy ? 'true' : 'false'}>
      <h2 className="text-lg font-bold">Ringkasan Kesiapan Ekspor</h2>
      <p className="text-sm">Identitas tujuan dipakai untuk dokumen baru. Kalender/jadwal sumber tidak dianggap sesuai tujuan tanpa validasi. Data siswa, presensi, nilai, dan pelaksanaan tidak disalin.</p>
      <p>Siap diekspor: {exportReadiness?.readyCount || 0}. Perlu penyesuaian: {exportReadiness?.skippedCount || 0}.</p>
      {exportReadiness?.error && <p role="alert" className="text-red-700">{exportReadiness.error}</p>}
      <ul className="text-xs space-y-1">{exportReadiness?.rows.map((row,index) => <li key={index}>{row.title}: {row.ready ? 'Siap diekspor' : row.reasons.join('; ')}</li>)}</ul>
      <details className="text-xs"><summary>Hasil validasi impor</summary><ul>{completed.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></details>
      <label className="text-sm">Format ZIP <select value={zipFormat} disabled={busy} onChange={event => setZipFormat(event.target.value as ZipExportFormat)} className="border p-1"><option value="both">PDF dan DOCX</option><option value="pdf">PDF</option><option value="docx">DOCX</option></select></label>
      <button type="button" disabled={busy || !exportReadiness?.readyCount} className="block rounded bg-blue-800 text-white p-3 disabled:opacity-40" onClick={async () => {
        setBusy(true); setError(''); setZipResult(undefined);
        try {
          const fresh = importedProjectExportReadiness(loadStorageV5(), completed.yearPlanId);
          setZipResult(await generateZipBundle({ types: fresh.types, format: zipFormat, documentMode: 'data' }, fresh.context));
        } catch (error) { setError(error instanceof Error ? error.message : 'ZIP belum dapat dibuat.'); }
        finally { setBusy(false); }
      }}>{busy ? 'Membuat ZIP...' : 'Unduh ZIP Administrasi'}</button>
      {zipResult && <div role="status" className="text-sm">
        <p>SUCCESS: {zipResult.successCount || 0} · PARTIAL: {zipResult.partialCount || 0} · SKIPPED: {zipResult.skippedCount || 0} · FAILED: {zipResult.failedCount || 0}</p>
        <p>{zipResult.partialCount || zipResult.skippedCount || zipResult.failedCount ? 'ZIP hanya memuat dokumen yang berhasil dibuat; paket belum lengkap.' : 'Seluruh dokumen yang diminta berhasil dibuat.'}</p>
        <ul>{zipResult.itemResults?.filter(item => item.reason).map((item,index) => <li key={index}>{item.type} {item.instanceTitle || ''}: {item.reason}</li>)}</ul>
      </div>}
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {completed.mode !== 'IDENTITY_ONLY' && onContinue && <button type="button" disabled={busy} onClick={()=>onContinue(completed.mode==='IDENTITY_SCHEDULE' ? 'annual-planning' : completed.nextStep)} className="block underline">{completed.mode==='IDENTITY_SCHEDULE' ? 'Sesuaikan Kalender, JP & Jadwal' : 'Lanjutkan Penyuntingan'}</button>}
      <button type="button" disabled={busy} onClick={onClose}>Tutup</button>
    </div>
  </div>;
  return <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Import Proyek Lengkap">
    <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-auto space-y-4" data-export-busy={busy ? 'true' : 'false'}>
      <div className="flex justify-between items-center"><h2 className="text-lg font-bold">Import Proyek Lengkap</h2>
        <button type="button" title="Tutup" aria-label="Tutup" disabled={busy} onClick={onClose}><X size={20} /></button></div>
      <label className="block text-sm font-medium">Arsip Proyek (.zip)
        <input className="block mt-2 w-full" type="file" accept=".zip,application/zip" disabled={busy}
          onChange={async e => {
            const file = e.target.files?.[0]; if (!file) return;
            setArchive(undefined); setError(''); setConfirmed(false); setReplace(false); setBusy(true);
            try { const loaded = await readCompleteProjectZip(await file.arrayBuffer()); setArchive(loaded); const year = loaded.project.yearPlans[0]; setTargetGrade((GRADE_PHASE_MAP[year.level] || []).find(item=>resolveGrade(undefined,item.grade)===resolveGrade(undefined,year.grade))?.grade || year.grade); setTargetClassSection(''); }
            catch (err) { setError(err instanceof Error ? err.message : String(err)); }
            finally { setBusy(false); }
          }} />
      </label>
      <fieldset className="grid sm:grid-cols-2 gap-3"><legend className="text-sm font-medium mb-2">Mode Impor Administrasi</legend>
        {ADMINISTRATION_IMPORT_MODES.map(item => <label key={item.mode} className="flex gap-2 text-sm border rounded p-3"><input type="radio" name="project-import-mode" value={item.mode} checked={mode===item.mode} disabled={busy} onChange={()=>{setMode(item.mode);setReplace(false);setConfirmed(false);}} /><span><strong>{item.title}</strong><small className="block">{item.description}</small></span></label>)}
      </fieldset>
      <details className="text-xs"><summary>Kompatibilitas impor lama (COPY / RESTORE)</summary>{([['COPY','Salin ke Profil Lain'],['RESTORE','Pulihkan Proyek']] as const).map(([value,label])=><label key={value} className="block"><input type="radio" name="project-import-mode" value={value} disabled={busy} checked={mode===value} onChange={()=>{setMode(value);setReplace(false);setConfirmed(false);}} />{label}</label>)}</details>
      {mode==='OTHER_CLASS' && sourceYear && <div className="flex gap-3 flex-wrap"><label>Kelas tujuan<select value={targetGrade} disabled={busy} onChange={event=>setTargetGrade(event.target.value)} className="block border p-2">{(GRADE_PHASE_MAP[sourceYear.level] || []).map(item=><option key={item.grade} value={item.grade}>{item.grade} — {item.phase}</option>)}</select></label><label>Rombel tujuan<input aria-label="Rombel tujuan" value={targetClassSection} disabled={busy} onChange={event=>setTargetClassSection(event.target.value)} className="block border p-2" placeholder="Contoh: B" /></label></div>}
      <label className="block text-sm font-medium">Profil Guru Tujuan
        <select className="block border rounded p-2 w-full mt-1" value={profileId} disabled={busy}
          onChange={e => { setProfileId(e.target.value); setConfirmed(false); setReplace(false); }}>
          {state.profiles.map(p => <option key={p.id} value={p.id}>{p.name} — {state.schools.find(s=>s.id===p.schoolId)?.name || 'Sekolah belum terhubung'}</option>)}
        </select></label>
      <label className="block text-sm font-medium">Sekolah Tujuan
        <select className="block border rounded p-2 w-full mt-1" value={profile?.schoolId || ''} disabled aria-label="Sekolah tujuan sesuai profil">
          <option value={profile?.schoolId || ''}>{state.schools.find(s => s.id === profile?.schoolId)?.name || 'Sekolah belum terhubung'}</option>
        </select></label>
      {source && <>
        {preview?.result && <div role="status" className="text-sm border rounded-lg p-3 space-y-1">
          <p className="font-semibold">Kesiapan Step 07</p>
          <p>Proyek asal: {preview.result.step7.source.canProceed ? 'Siap lanjut Step 08' : 'Perlu dilengkapi / ditinjau'}.</p>
          <p>Hasil import: {preview.result.step7.target.canProceed ? 'Siap lanjut Step 08 tanpa Analisis ulang' : 'Belum siap lanjut Step 08'}.</p>
          {preview.result.step7.origin === 'SOURCE_INCOMPLETE' && <p>Ketidaklengkapan sudah ada pada proyek asal. Relasi Bab/Materi dipertahankan saat import.</p>}
        </div>}
        <div className="border-t pt-3"><p className="font-semibold flex items-center gap-2"><FileArchive size={18}/>{sourceYear?.subject} / {sourceYear?.grade} / {sourceYear?.academicYear}</p>
          <p className="text-sm text-gray-600">Asal: {source.profiles[0]?.name} · {source.schools[0]?.name} · Versi {archive?.schemaVersion}</p>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm mt-3">{progress.map(([label, count]) => <div className="flex justify-between" key={label}><dt>{label}</dt><dd>{count}</dd></div>)}</dl>
        </div>
        {mode === 'RESTORE' && state.yearPlans.some(y => y.id === sourceYear?.id) &&
          <label className="flex gap-2 text-sm text-red-700"><input type="checkbox" checked={replace} disabled={busy}
            onChange={e => { setReplace(e.target.checked); setConfirmed(false); }} />Saya menyetujui penimpaan proyek asal yang sudah ada.</label>}
        {preview?.result?.warnings.length ? <div className="text-sm bg-amber-50 p-3 rounded border border-amber-200"><p className="font-semibold">Perlu Ditinjau</p>
          <ul className="list-disc pl-5 max-h-40 overflow-auto">{preview.result.warnings.map(w => <li key={w}>{w}</li>)}</ul></div> : null}
        {legacyMode && <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy}
          onChange={e => setConfirmed(e.target.checked)} />Saya telah meninjau isi proyek dan tujuan import, termasuk data siswa/nilai jika tersedia.</label>}
      </>}
      {(error || preview?.error) && <p role="alert" className="text-sm text-red-700">{error || preview?.error}</p>}
      <button type="button" className="flex gap-2 items-center bg-blue-800 text-white px-4 py-2 rounded disabled:opacity-40"
        disabled={busy || !archive || !profile?.schoolId || (legacyMode && (!confirmed || !preview?.result)) || (mode==='OTHER_CLASS' && (!targetGrade || !targetClassSection.trim()))} onClick={async () => {
          if (!archive || submitting.current) return; submitting.current = true; setBusy(true); setError('');
          try {
            if (mode === 'IDENTITY_ONLY') {
              const flow = await importCompleteAdministrationProjectAndExport(archive, options);
              setCompleted(flow.imported); setZipResult(flow.zipResult); setError(flow.exportError); onSuccess(flow.imported);
            } else {
              const result = importCompleteAdministrationProject(archive, options); if (!legacyMode) setCompleted(result); onSuccess(result);
              if (!legacyMode) onContinue?.(result.nextStep);
            }
          }
          catch (err) { setError(err instanceof Error ? err.message : String(err)); }
          finally { submitting.current = false; setBusy(false); }
        }}><Upload size={16} />{busy ? 'Memproses...' : mode === 'IDENTITY_ONLY' ? 'Impor & Unduh ZIP' : legacyMode ? 'Konfirmasi Import' : 'Impor & Lanjutkan'}</button>
    </div>
  </div>;
}
