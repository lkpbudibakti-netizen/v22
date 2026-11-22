import React, { useState, useEffect } from 'react';
import { CPSourceFigures } from './CPSourceFigures';
import {
  FileSpreadsheet,
  Sparkles,
  Plus,
  Trash2,
  BookOpen,
  ArrowRight,
  Check,
  BrainCircuit,
  Lightbulb,
  Tag,
  Target,
  FileText,
  HelpCircle,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  ExternalLink,
  Search,
  CheckCircle2,
} from 'lucide-react';
import { CPData, CPElem, AcademicSetting, TeacherProfile, ActiveContext, CPSource, CPVerificationStatus, normalizeCPVerificationStatus } from '../types';
import { cpSourceRepository, CPSourceSearchResult, CPSourceSearchReport } from '../services/cpSourceRepository';
import { validateCPDataWorkflow } from '../services/cpWorkflowService';
// CPManager imports

interface CPManagerProps {
  cp: CPData;
  context: ActiveContext;
  academicSetting: AcademicSetting;
  profile: TeacherProfile;
  onSaveCP: (cp: CPData) => void;
  onNextStep: () => void;
}

export const CPSourceSearchDiagnostic: React.FC<{ report: CPSourceSearchReport }> = ({ report }) => (
  <div role="alert" className="p-4 border border-amber-300 rounded-xl bg-amber-50 text-xs text-amber-950 space-y-1 break-words">
    <p className="font-bold">Pencarian sumber CP resmi: {report.status}</p>
    <p>subject aktual: {report.context.subject || '(kosong)'}</p>
    <p>level: {report.context.level || '(kosong)'}</p>
    <p>phase: {report.context.phase || '(kosong)'}</p>
    <p>academicYear: {report.context.academicYear || '(kosong)'}</p>
    <p>reason: {report.reason}</p>
  </div>
);

export const CPManager: React.FC<CPManagerProps> = ({
  cp,
  context,
  academicSetting,
  profile,
  onSaveCP,
  onNextStep,
}) => {
  const [generalDescription, setGeneralDescription] = useState(cp.generalDescription || '');
  const [elements, setElements] = useState<CPElem[]>(cp.elements || []);
  const [source, setSource] = useState<CPSource | undefined>(cp.source);
  const [aiNotes, setAiNotes] = useState(cp.aiNotes || '');

  // Modal / Source selector state
  const [isSourceModalOpen, setIsSourceModalOpen] = useState(false);
  const [sourceSearch, setSourceSearch] = useState<CPSourceSearchReport | null>(null);
  const searchResults = sourceSearch?.results || [];
  const [selectedResult, setSelectedResult] = useState<CPSourceSearchResult | null>(null);

  const [saveToast, setSaveToast] = useState(false);
  const [pendingReviewedSource, setPendingReviewedSource] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Sync if prop changes
  useEffect(() => {
    setGeneralDescription(cp.generalDescription || '');
    setElements(cp.elements || []);
    setSource(cp.source);
    setPendingReviewedSource(false);
    setAiNotes(cp.aiNotes || '');
  }, [cp]);

  // Results belong to the exact context used for the search; never apply a stale selection.
  useEffect(() => {
    setIsSourceModalOpen(false);
    setSourceSearch(null);
    setSelectedResult(null);
  }, [context.subject, context.level, context.phase, context.academicYear,
    academicSetting.subject, academicSetting.level, academicSetting.phase, academicSetting.academicYear, academicSetting.id]);

  // Perform search based on ActiveContext
  const handleOpenSourceSearch = () => {
    const report = cpSourceRepository.searchSourceChoices(context, { academicSetting });
    setSourceSearch(report);
    setSelectedResult(report.status === 'RESOLVED' && report.results.length === 1 && report.results[0].isSelectable && !report.results[0].sourceMeta.sourceReview
      ? report.results[0] : null);
    setIsSourceModalOpen(true);
  };

  const handleApplySelectedSource = (item: CPSourceSearchResult) => {
    if (sourceSearch?.status !== 'RESOLVED' || !item.isSelectable) return;
    if (
      generalDescription.trim().length > 0 &&
      !confirm('Gantikan teks CP saat ini dengan rujukan terpilih?')
    ) {
      return;
    }

    setGeneralDescription(item.generalDescription);
    setElements(item.elements);
    setSource(item.sourceMeta);
    setIsSourceModalOpen(false);

    if (item.sourceMeta.sourceReview) {
      // A source choice edits only local draft state. Existing project identity and TP/ATP remain untouched.
      setPendingReviewedSource(true);
      return;
    }
    setPendingReviewedSource(false);

    // Auto save
    const now = new Date().toISOString();
    const candidate: CPData = {
      ...cp,
      academicSettingId: academicSetting.id,
      generalDescription: item.generalDescription,
      elements: item.elements,
      source: item.sourceMeta,
      lastEditedAt: now,
      updatedAt: now,
    };
    const validation = validateCPDataWorkflow(candidate, academicSetting);
    const updated: CPData = {
      ...candidate,
      workflowStatus: validation.status,
    };
    onSaveCP(updated);
  };

  const handleAddElement = () => {
    let maxNum = 0;
    elements.forEach((e) => {
      const match = (e.code || '').match(/^E(\d+)$/i);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) {
          maxNum = num;
        }
      }
    });
    const nextNum = maxNum + 1;
    const newElem: CPElem = {
      id: `elem-${Date.now()}`,
      code: `E${nextNum}`,
      name: '',
      content: '',
    };
    setElements([...elements, newElem]);
  };

  const handleRemoveElement = (id: string) => {
    setElements(elements.filter((e) => e.id !== id));
  };

  const handleElementChange = (id: string, field: keyof CPElem, val: string) => {
    setElements(elements.map((e) => (e.id === id ? { ...e, [field]: val } : e)));
  };

  const handleSave = (): boolean => {
    setValidationError(null);

    // 1. Fill empty codes with canonical fallback E1, E2, etc. before onSaveCP
    const updatedElements = elements.map((e, idx) => {
      const code = e.code && e.code.trim() ? e.code.trim().toUpperCase() : `E${idx + 1}`;
      return {
        ...e,
        code,
      };
    });

    // 2. Ensure codes are uppercase, match ^E\d+$, and are not duplicate
    const codes = new Set<string>();
    const elementCodeRegex = /^E\d+$/;
    for (const e of updatedElements) {
      if (!elementCodeRegex.test(e.code)) {
        setValidationError(`Format kode elemen "${e.code}" tidak sah! Format kode elemen harus sesuai pola E1, E2, dst (diawali huruf E kapital diikuti angka).`);
        return false;
      }
      if (codes.has(e.code)) {
        setValidationError(`Kode elemen "${e.code}" duplikat! Kode elemen harus unik dalam satu Capaian Pembelajaran.`);
        return false;
      }
      codes.add(e.code);
    }

    setElements(updatedElements);

    const now = new Date().toISOString();
    const candidate: CPData = {
      ...cp,
      academicSettingId: academicSetting.id,
      generalDescription,
      elements: updatedElements,
      source: source || {
        title: `CP ${academicSetting.subject} (${context.phase})`,
        institution: 'Entri Mandiri Guru',
        retrievedAt: now,
        verificationStatus: 'local_reference',
      },
      aiNotes: aiNotes || '',
      lastEditedAt: now,
      updatedAt: now,
    };
    const validation = validateCPDataWorkflow(candidate, academicSetting);
    const updated: CPData = {
      ...candidate,
      workflowStatus: validation.status,
    };
    onSaveCP(updated);
    setPendingReviewedSource(false);
    setSaveToast(true);
    setTimeout(() => setSaveToast(false), 2500);
    return true;
  };

  const handleSaveAndNext = () => {
    if (!generalDescription.trim() && elements.length === 0) {
      alert('Mohon isi deskripsi CP umum atau minimal 1 elemen CP sebelum melanjutkan.');
      return;
    }
    const savedSuccessfully = handleSave();
    if (savedSuccessfully) {
      onNextStep();
    }
  };

  const hasCP = (generalDescription && generalDescription.trim().length > 0) || elements.length > 0;

  return (
    <div className="space-y-6">
      {pendingReviewedSource && <p role="status" className="text-sm text-amber-800">Sumber REVIEW dimuat sebagai draft. CP tersimpan belum berubah. Gunakan Simpan CP untuk menyimpan perubahan secara eksplisit.</p>}
      {validationError && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h4 className="text-xs font-bold text-red-900 uppercase tracking-wider">Kesalahan Validasi</h4>
            <p className="text-xs text-red-700 font-medium leading-relaxed">{validationError}</p>
          </div>
        </div>
      )}

      {/* Step Banner */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-md bg-blue-100 text-blue-800 text-xs font-bold flex items-center justify-center">
                03
              </span>
              <h3 className="text-lg font-bold text-slate-900">Capaian Pembelajaran (CP)</h3>
            </div>
            <p className="text-sm text-slate-500 mt-1">
              Pilih sumber resmi atau masukkan Capaian Pembelajaran untuk <strong>{context.subject}</strong> ({context.grade} - {context.phase}).
              Data CP ini menjadi fondasi mutlak dalam penurunan Tujuan Pembelajaran (TP).
            </p>
          </div>

          {/* Search Official Sources Button */}
          <button
            id="btn-search-cp-source"
            onClick={handleOpenSourceSearch}
            className="inline-flex items-center gap-2 bg-blue-50 hover:bg-blue-100 text-blue-800 px-4 py-2.5 rounded-xl text-xs font-bold border border-blue-200 transition cursor-pointer self-start sm:self-auto shadow-2xs"
          >
            <Search className="w-4 h-4 text-blue-600" />
            <span>Cari Sumber CP Resmi ({context.phase})</span>
          </button>
        </div>

        {/* Source Metadata Banner */}
        <div className="mt-4 pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-slate-500 font-semibold">Status Sumber CP:</span>
            {(() => {
              const status = normalizeCPVerificationStatus(source?.verificationStatus);
              if (status === 'VERIFIED') {
                return (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Terverifikasi Resmi: {source?.institution}</span>
                  </span>
                );
              }
              if (status === 'LOCAL_REFERENCE') {
                return (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 font-medium">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                    <span>Referensi Lokal (Belum Terverifikasi SK BSKAP/BKPDM)</span>
                  </span>
                );
              }
              if (status === 'SUPERSEDED') {
                return (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-50 text-rose-800 border border-rose-200 font-medium">
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                    <span>Dokumen Kedaluwarsa / Digantikan</span>
                  </span>
                );
              }
              if (status === 'VERSION_CONFLICT') {
                return (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-purple-50 text-purple-800 border border-purple-200 font-medium">
                    <AlertTriangle className="w-3.5 h-3.5 text-purple-600" />
                    <span>Konflik Versi CP (Ambiguous)</span>
                  </span>
                );
              }
              return (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 border border-slate-200 font-medium">
                  <span>Input Mandiri / Draft</span>
                </span>
              );
            })()}
          </div>

          {source?.title && (
            <span className="text-slate-500 truncate max-w-md" title={source.title}>
              Dokumen: <strong className="text-slate-800 font-medium">{source.title}</strong>
            </span>
          )}
        </div>
      </div>

      {/* CP Editor Form */}
      <div className="space-y-5">
        <CPSourceFigures source={source} />
        {/* General CP Textarea */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <FileText className="w-4 h-4 text-blue-600" />
              <span>Deskripsi Umum Capaian Pembelajaran ({context.phase})</span>
            </label>
            <span className="text-[11px] text-slate-400">Teks naratif fase</span>
          </div>

          <textarea
            id="textarea-cp-general"
            rows={4}
            placeholder="Contoh: Pada akhir Fase B, peserta didik memiliki kemampuan berbahasa untuk berkomunikasi dan bernalar, sesuai dengan tujuan, konteks sosial, akademis..."
            value={generalDescription}
            onChange={(e) => setGeneralDescription(e.target.value)}
            className="w-full text-sm p-3.5 rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-600 leading-relaxed"
          />
        </div>

        {/* CP Elements Section */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Rincian Elemen CP ({elements.length})
              </h4>
              <p className="text-[11px] text-slate-500">
                Elemen mata pelajaran (misal: Menyimak, Membaca, Menulis, Keterampilan Gerak, dll)
              </p>
            </div>

            <button
              id="btn-add-cp-element"
              type="button"
              onClick={handleAddElement}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Tambah Elemen</span>
            </button>
          </div>

          {elements.length === 0 ? (
            <div className="p-6 text-center border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50 space-y-2">
              <p className="text-xs text-slate-500">
                Belum ada elemen CP terpisah. Anda dapat menambahkan elemen atau mengandalkan deskripsi CP umum di atas.
              </p>
              <button
                type="button"
                onClick={handleOpenSourceSearch}
                className="text-xs font-semibold text-blue-700 hover:underline inline-flex items-center gap-1"
              >
                <Search className="w-3.5 h-3.5" />
                <span>Ambil elemen otomatis dari sumber resmi</span>
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {elements.map((elem, idx) => (
                <div key={elem.id} className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-1">
                      <input
                        type="text"
                        placeholder="E1"
                        value={elem.code || `E${idx + 1}`}
                        onChange={(e) => handleElementChange(elem.id, 'code', e.target.value)}
                        className="w-16 text-xs font-bold text-blue-900 bg-blue-50 border border-blue-200 px-2 py-1.5 rounded-lg text-center uppercase focus:outline-hidden focus:ring-2 focus:ring-blue-600"
                        title="Kode Elemen CP"
                      />
                      <input
                        type="text"
                        placeholder="Nama Elemen (misal: Menyimak / Keterampilan Gerak)"
                        value={elem.name}
                        onChange={(e) => handleElementChange(elem.id, 'name', e.target.value)}
                        className="text-xs font-bold text-slate-800 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-600 flex-1"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveElement(elem.id)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg transition"
                      title="Hapus elemen ini"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <textarea
                    rows={2}
                    placeholder="Uraian capaian pada elemen ini..."
                    value={elem.content}
                    onChange={(e) => handleElementChange(elem.id, 'content', e.target.value)}
                    className="w-full text-xs p-2.5 rounded-lg border border-slate-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-600 leading-relaxed"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Action Footer */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
        <div className="flex items-center gap-2">
          <button
            id="btn-save-cp-draft"
            type="button"
            onClick={handleSave}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 shadow-xs transition"
          >
            Simpan Draft CP
          </button>
          {saveToast && (
            <span className="text-xs font-semibold text-emerald-700 flex items-center gap-1">
              <Check className="w-4 h-4 text-emerald-600" /> Data CP tersimpan
            </span>
          )}
        </div>

        <button
          id="btn-next-to-tp"
          type="button"
          onClick={handleSaveAndNext}
          className="w-full sm:w-auto flex items-center justify-center gap-2 bg-blue-900 hover:bg-blue-950 text-white py-2.5 px-6 rounded-xl text-sm font-semibold shadow-sm transition cursor-pointer"
        >
          <span>Simpan & Lanjut ke Bedah & Analisis CP (04)</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {/* MODAL: Official CP Source Browser & Verification Selection */}
      {isSourceModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-blue-700" />
                  <span>Pencarian Sumber Capaian Pembelajaran (CP)</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Konteks: {context.level} • {context.grade} ({context.phase}) • {context.subject}
                </p>
              </div>
              <button
                onClick={() => setIsSourceModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-semibold p-1"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {searchResults.some(item => item.sourceMeta.sourceReview) && <p className="text-xs text-amber-800">{sourceSearch?.reason}</p>}
              {sourceSearch && sourceSearch.status !== 'RESOLVED' && (
                <CPSourceSearchDiagnostic report={sourceSearch} />
              )}
              {searchResults.length === 0 ? (
                <div className="p-8 text-center border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50 space-y-3">
                  <p className="text-sm font-semibold text-slate-700">
                    Pencarian belum menghasilkan sumber CP yang dapat digunakan untuk mata pelajaran "{context.subject}".
                  </p>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    Periksa context dan alasan di atas, lalu perbaiki pengaturan akademik aktif dan cari ulang. Anda juga dapat menginputkan CP secara mandiri dari dokumen resmi.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {searchResults.map((item) => {
                    const isSelected = selectedResult?.id === item.id;
                    const itemVerStatus = normalizeCPVerificationStatus(item.verificationStatus);
                    const isVerified = itemVerStatus === 'VERIFIED';

                    return (
                      <div
                        key={item.id}
                        onClick={() => { if (sourceSearch?.status === 'RESOLVED' && item.isSelectable) setSelectedResult(item); }}
                        className={`p-4 rounded-2xl border transition cursor-pointer text-left space-y-2.5 ${
                          isSelected
                            ? 'border-blue-600 bg-blue-50/50 shadow-xs ring-2 ring-blue-600/20'
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              {isVerified ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800">
                                  <ShieldCheck className="w-3 h-3 text-emerald-600" />
                                  <span>Sumber Resmi Terverifikasi (VERIFIED)</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-amber-100 text-amber-800">
                                  <AlertTriangle className="w-3 h-3 text-amber-600" />
                                  <span>{itemVerStatus === 'VERSION_CONFLICT' ? 'Konflik Versi Sumber' : 'Sumber Belum Terverifikasi (UNVERIFIED)'}</span>
                                </span>
                              )}
                              {item.sourceMeta.sourceReview && <span className="text-xs font-semibold text-amber-800">Tambahan CP 046/2025 • {isVerified ? 'VERIFIED' : 'REVIEW / UNVERIFIED'}</span>}
                              <span className="text-xs font-mono font-bold text-slate-700">
                                {item.phase} ({item.grade})
                              </span>
                            </div>
                            <h4 className="text-sm font-bold text-slate-900 leading-tight">
                              {item.title}
                            </h4>
                            <p className="text-xs text-slate-500">
                              Diterbitkan oleh: <strong className="text-slate-700">{item.institution}</strong> ({item.documentYear})
                            </p>
                          </div>

                          <div className="shrink-0">
                            <div
                              className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                                isSelected
                                  ? 'border-blue-600 bg-blue-600 text-white'
                                  : 'border-slate-300 bg-white'
                              }`}
                            >
                              {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                            </div>
                          </div>
                        </div>

                        {/* Snippet preview */}
                        <CPSourceFigures source={item.sourceMeta} />
                        <p className="text-xs text-slate-600 line-clamp-2 italic bg-white p-2.5 rounded-xl border border-slate-200/80">
                          "{item.generalDescription}"
                        </p>

                        <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
                          <span>{item.elements.length} Elemen terstruktur</span>
                          {item.url && (
                            <span className="flex items-center gap-1 text-blue-600 hover:underline">
                              <span>Tautan Kemendikbud</span>
                              <ExternalLink className="w-3 h-3" />
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={() => setIsSourceModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition"
              >
                Tutup
              </button>

              {selectedResult && (
                <button
                  type="button"
                  onClick={() => handleApplySelectedSource(selectedResult)}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-blue-700 hover:bg-blue-800 shadow-xs transition inline-flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{selectedResult.sourceMeta.sourceReview ? 'Muat Sumber REVIEW ke Draft' : 'Gunakan Dokumen CP Ini'}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
