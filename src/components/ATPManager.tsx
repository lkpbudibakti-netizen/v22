import React, { useState, useEffect } from 'react';
import {
  GitMerge,
  Sparkles,
  Plus,
  Trash2,
  Edit2,
  ArrowUp,
  ArrowDown,
  ArrowRight,
  Check,
  BookOpen,
  Target,
  AlertCircle,
  RefreshCw,
  Wand2,
  AlertTriangle,
  Clipboard,
} from 'lucide-react';
import { ATPData, ATPItem, TPData, CPData, CPAnalysisData, AcademicSetting, TeacherProfile, ActiveContext } from '../types';
import { generateATPWithAI, refineTextWithAI } from '../services/aiService';
import {
  validateATPReferences,
  resolveATPItemTPReferences,
  validateTPDataWorkflow,
} from '../services/cpWorkflowService';
import { prepareATPFinalization } from '../services/atpFinalizationService';
import {
  buildTPDiagnosticReport,
  recordDiagnosticEvent,
} from '../services/diagnosticService';

interface ATPManagerProps {
  atp: ATPData;
  tp: TPData;
  cp: CPData;
  cpAnalysis?: CPAnalysisData;
  context: ActiveContext;
  academicSetting: AcademicSetting;
  profile: TeacherProfile;
  onSaveATP: (atp: ATPData) => void;
  onNextStep: () => void;
  onBackToTP: () => void;
}

export const ATPManager: React.FC<ATPManagerProps> = ({
  atp,
  tp,
  cp,
  cpAnalysis,
  context,
  academicSetting,
  profile,
  onSaveATP,
  onNextStep,
  onBackToTP,
}) => {
  const [rationale, setRationale] = useState(atp.rationale || '');
  const [items, setItems] = useState<ATPItem[]>(atp.items || []);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState(false);

  // Edit / Add Item Modal
  const [isEditing, setIsEditing] = useState(false);
  const [currentItem, setCurrentItem] = useState<ATPItem | null>(null);
  const [isRefiningRationale, setIsRefiningRationale] = useState(false);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [showGenerateConfirmation, setShowGenerateConfirmation] = useState(false);

  useEffect(() => {
    setRationale(atp.rationale || '');
    setItems(atp.items || []);
  }, [atp]);

  const hasTP = tp.items && tp.items.length > 0;
  const tpValidation = validateTPDataWorkflow(tp, cp, cpAnalysis, academicSetting);
  const isTPReady = tpValidation.isSiap && tp.workflowStatus === 'SIAP' && tp.needsReview !== true;
  const tpReadinessReason = !isTPReady
    ? (!tpValidation.isSiap
        ? (tpValidation.issues[0] || 'TP belum memenuhi kriteria kanonikal SIAP.')
        : (tp.needsReview
            ? (tp.reviewReason || 'TP ditandai perlu ditinjau ulang (needsReview).')
            : 'TP belum dikonfirmasi atau disimpan sebagai SIAP.'))
    : undefined;

  const handleCopyDiagnostic = async () => {
    const report = buildTPDiagnosticReport({
      module: 'ATP',
      workspaceId: tp.workspaceId || atp.workspaceId,
      academicSetting,
      context,
      cp,
      cpAnalysis,
      tp,
      uiItemsCount: tp.items?.length ?? 0,
      validation: tpValidation,
      isStoredStatusAligned: (tp.workflowStatus || 'BELUM_DIMULAI') === tpValidation.status,
      atp,
      atpGate: isTPReady ? 'ALLOWED' : 'BLOCKED',
      atpGateReason: isTPReady ? undefined : tpReadinessReason,
      isTPReady,
      tpReadinessReason,
      learningPlanGate: atp.workflowStatus === 'SIAP' ? 'ALLOWED' : 'BLOCKED',
      learningPlanGateReason: atp.workflowStatus === 'SIAP' ? undefined : 'ATP belum berstatus SIAP.',
    });

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(report);
      } else {
        const area = document.createElement('textarea');
        area.value = report;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        document.body.removeChild(area);
      }
      setCopyNotice('Diagnostik berhasil disalin.');
      setTimeout(() => setCopyNotice(null), 3000);
    } catch {
      setGenerationError('Gagal menyalin diagnostik. Browser tidak memberi akses clipboard.');
    }
  };

  // Integrity Check: TP was modified after ATP was formed
  const isTPOutdated =
    hasTP &&
    items.length > 0 &&
    atp.basedOnTpUpdatedAt &&
    tp.updatedAt &&
    new Date(tp.updatedAt).getTime() > new Date(atp.basedOnTpUpdatedAt).getTime() + 1000;

  // Eksekusi penyusunan ATP dengan AI
  const executeGenerateAI = async () => {
    setIsGenerating(true);
    setGenerationError(null);

    recordDiagnosticEvent({
      scope: 'ATP',
      action: 'ATP_GENERATE_STARTED',
      status: 'STARTED',
      metadata: {
        tpItemsCount: tp.items?.length ?? 0,
        existingAtpItemsCount: items?.length ?? 0,
        tpWorkflowStatus: tp.workflowStatus,
      },
    });

    try {
      const generated = await generateATPWithAI({
        tps: tp.items,
        cpGeneral: cp.generalDescription,
        subject: context.subject,
        grade: context.grade,
        phase: context.phase,
        academicYear: context.academicYear,
      });

      const existingItems = items || [];
      const usedExistingIds = new Set<string>();

      const formattedItems: ATPItem[] = [];
      for (let idx = 0; idx < generated.items.length; idx++) {
        const item = generated.items[idx];
        const rawLinkedTpIds = Array.isArray(item.linkedTpIds) && item.linkedTpIds.length > 0
          ? item.linkedTpIds
          : item.tpId ? [item.tpId] : [];

        const focusTrimmed = item.focus ? String(item.focus).trim() : '';
        if (!focusTrimmed) {
          throw new Error(
            `Hasil susunan ATP AI pada langkah ke-${item.stepNumber || idx + 1} tidak memiliki fokus langkah pembelajaran yang valid.`
          );
        }

        const candidateItem: ATPItem = {
          id: '',
          stepNumber: item.stepNumber || idx + 1,
          linkedTpIds: rawLinkedTpIds,
          focus: focusTrimmed,
        };

        const refResult = resolveATPItemTPReferences(candidateItem, tp.items);
        if (!refResult.isValid) {
          throw new Error(
            `Hasil susunan ATP tidak valid pada langkah ke-${candidateItem.stepNumber}: ${refResult.issues.join('; ')}`
          );
        }

        // Canonical authority is linkedTpIds; DO NOT set candidateItem.tpId = primary.id
        const canonicalLinkedTpIds = refResult.canonicalTPItems.map((t) => t.id);
        const normalizedCandidateKey = [...canonicalLinkedTpIds].sort().join(',');

        // Preserve ATPItem.id if the new step represents the exact same grouping of linkedTpIds
        const matchedExisting = existingItems.find((existing) => {
          if (usedExistingIds.has(existing.id)) return false;
          const existingLinked = Array.isArray(existing.linkedTpIds) && existing.linkedTpIds.length > 0
            ? existing.linkedTpIds
            : existing.tpId ? [existing.tpId] : [];
          const existingKey = [...existingLinked].sort().join(',');
          return existingKey === normalizedCandidateKey;
        });

        const stableId = matchedExisting
          ? matchedExisting.id
          : `atp-item-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 6)}`;

        if (matchedExisting) {
          usedExistingIds.add(matchedExisting.id);
        }

        candidateItem.id = stableId;
        candidateItem.linkedTpIds = canonicalLinkedTpIds;
        formattedItems.push(candidateItem);
      }

      setRationale(generated.rationale);
      setItems(formattedItems);

      // Auto save as DRAFT (Teacher review required)
      const updated: ATPData = {
        ...atp,
        academicSettingId: academicSetting.id,
        tpDataId: tp.id,
        tpId: tp.id,
        academicYear: context.academicYear,
        subjectCode: context.subjectCode || context.subject,
        phase: context.phase,
        rationale: generated.rationale,
        items: formattedItems,
        generatedBy: 'AI',
        workflowStatus: 'DRAFT',
        generatedAt: new Date().toISOString(),
        needsReview: false,
        reviewReason: undefined,
        basedOnTpUpdatedAt: tp.updatedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      onSaveATP(updated);

      recordDiagnosticEvent({
        scope: 'ATP',
        action: 'ATP_GENERATE_SUCCESS',
        status: 'DRAFT',
        metadata: {
          generatedItemsCount: formattedItems.length,
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal menyusun ATP dengan AI';
      setGenerationError(msg);
      recordDiagnosticEvent({
        scope: 'ATP',
        action: 'ATP_GENERATE_FAILED',
        status: 'FAILED',
        metadata: {
          reason: msg,
        },
      });
    } finally {
      setIsGenerating(false);
    }
  };

  // Handle AI Generate ATP from TP
  const handleGenerateAI = async () => {
    if (!hasTP) {
      alert('Daftar TP belum tersedia. Harap rumuskan TP pada tahap 04 terlebih dahulu.');
      return;
    }
    if (!isTPReady) {
      alert(`TP belum SIAP untuk menyusun ATP: ${tpReadinessReason}`);
      return;
    }

    if (items.length > 0) {
      setShowGenerateConfirmation(true);
      return;
    }

    await executeGenerateAI();
  };

  const handleSave = () => {
    const isAiOrigin = atp.generatedBy === 'AI' || atp.generatedBy === 'AI_EDITED_BY_TEACHER';
    const updated: ATPData = {
      ...atp,
      academicSettingId: academicSetting.id,
      tpDataId: tp.id,
      tpId: tp.id,
      academicYear: context.academicYear,
      subjectCode: context.subjectCode || context.subject,
      phase: context.phase,
      rationale,
      items: items.map((item, idx) => ({ ...item, stepNumber: idx + 1 })),
      generatedBy: isAiOrigin ? 'AI_EDITED_BY_TEACHER' : 'TEACHER',
      needsReview: atp.needsReview,
      reviewReason: atp.reviewReason,
      basedOnTpUpdatedAt: atp.basedOnTpUpdatedAt,
      updatedAt: new Date().toISOString(),
    };
    onSaveATP(updated);
    setSaveNotice(true);
    setTimeout(() => setSaveNotice(false), 2500);
  };

  const handleConfirmAndFinalize = () => {
    const isAiOrigin = atp.generatedBy === 'AI' || atp.generatedBy === 'AI_EDITED_BY_TEACHER';
    const currentDraft: ATPData = {
      ...atp,
      items: items.map((item, idx) => ({ ...item, stepNumber: idx + 1 })),
    };

    const result = prepareATPFinalization({
      atp: currentDraft,
      tp,
      academicSetting,
      cp,
      cpAnalysis,
      rationale,
      isAiOrigin,
      subjectCode: context.subjectCode,
      subject: context.subject,
      phase: context.phase,
      academicYear: context.academicYear,
    });

    if (result.canFinalize && result.candidate) {
      onSaveATP(result.candidate);
      setSaveNotice(true);
      setTimeout(() => setSaveNotice(false), 2500);
    } else {
      alert(`ATP belum dapat difinalisasi karena ditemukan isu validasi:\n\n• ${result.issues.join('\n• ')}`);
    }
  };

  const handleSaveAndNext = () => {
    if (items.length === 0) {
      alert('Susun minimal 1 butir Alur Tujuan Pembelajaran (ATP) sebelum melanjutkan.');
      return;
    }
    const candidate: ATPData = {
      ...atp,
      rationale,
      items: items.map((item, idx) => ({ ...item, stepNumber: idx + 1 })),
      workflowStatus: atp.workflowStatus,
      needsReview: atp.needsReview,
    };
    const val = validateATPReferences(candidate, tp, academicSetting, cp, cpAnalysis);
    if (!val.isSiap || atp.workflowStatus !== 'SIAP' || atp.needsReview) {
      alert(`ATP belum SIAP untuk dilanjutkan: ${val.issues[0] || atp.reviewReason || 'Konfirmasi dan finalisasi ATP terlebih dahulu.'}`);
      return;
    }
    onNextStep();
  };

  const handleMove = (index: number, direction: 'up' | 'down') => {
    const newItems = [...items];
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= newItems.length) return;

    const temp = newItems[index];
    newItems[index] = newItems[targetIdx];
    newItems[targetIdx] = temp;

    setItems(newItems.map((it, idx) => ({ ...it, stepNumber: idx + 1 })));
  };

  const handleDelete = (id: string) => {
    if (confirm('Hapus baris alur pembelajaran ini?')) {
      setItems(items.filter((i) => i.id !== id).map((it, idx) => ({ ...it, stepNumber: idx + 1 })));
    }
  };

  const handleOpenAdd = () => {
    const nextStep = items.length + 1;
    setCurrentItem({
      id: `atp-item-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      stepNumber: nextStep,
      linkedTpIds: [],
      focus: '',
    });
    setIsEditing(true);
  };

  const handleOpenEdit = (item: ATPItem) => {
    const rawLinkedTpIds = Array.isArray(item.linkedTpIds) && item.linkedTpIds.length > 0
      ? [...item.linkedTpIds]
      : item.tpId ? [item.tpId] : [];
    setCurrentItem({
      ...item,
      linkedTpIds: rawLinkedTpIds,
      focus: item.focus || '',
    });
    setIsEditing(true);
  };

  const handleSaveItemModal = (e: React.FormEvent) => {
    e.preventDefault();
    const focusTrimmed = currentItem?.focus?.trim() || '';
    if (!focusTrimmed) {
      alert('Fokus langkah pembelajaran wajib diisi.');
      return;
    }

    const effectiveLinkedIds = Array.isArray(currentItem?.linkedTpIds) && currentItem.linkedTpIds.length > 0
      ? currentItem.linkedTpIds
      : currentItem?.tpId ? [currentItem.tpId] : [];

    if (!currentItem || effectiveLinkedIds.length === 0) {
      alert('Pilih minimal 1 butir Tujuan Pembelajaran (TP) untuk langkah pembelajaran ini.');
      return;
    }

    const exists = items.some((i) => i.id === currentItem.id);
    let toSave: any;

    if (exists) {
      const existing = items.find((i) => i.id === currentItem.id)!;
      toSave = {
        ...existing,
        linkedTpIds: effectiveLinkedIds,
        focus: focusTrimmed,
        tpId: existing.tpId,
      };
    } else {
      toSave = {
        id: currentItem.id,
        linkedTpIds: effectiveLinkedIds,
        focus: focusTrimmed,
      };
    }

    // 1. Ambil desiredStep dari currentItem.stepNumber
    const rawDesired = Number(currentItem.stepNumber) || 1;

    // 2. Clamp: minimal = 1, maksimal = items.length (edit) atau items.length + 1 (add)
    const minStep = 1;
    const maxStep = exists ? items.length : items.length + 1;
    const clampedStep = Math.max(minStep, Math.min(rawDesired, maxStep));
    const targetIndex = clampedStep - 1;

    // 3 & 4. Tempatkan toSave pada targetIndex
    let reorderedItems: ATPItem[];
    if (exists) {
      // keluarkan item existing dari array
      const remainingItems = items.filter((i) => i.id !== toSave.id);
      // masukkan toSave pada index desiredStep - 1
      reorderedItems = [
        ...remainingItems.slice(0, targetIndex),
        toSave,
        ...remainingItems.slice(targetIndex),
      ];
    } else {
      // masukkan toSave pada index desiredStep - 1
      reorderedItems = [
        ...items.slice(0, targetIndex),
        toSave,
        ...items.slice(targetIndex),
      ];
    }

    // 5. Renumber seluruh item: stepNumber = index + 1
    const finalizedItems = reorderedItems.map((it, idx) => ({
      ...it,
      stepNumber: idx + 1,
    }));

    setItems(finalizedItems);
    setIsEditing(false);
    setCurrentItem(null);
  };

  const handleRefineRationale = async () => {
    if (!rationale.trim()) {
      alert('Tulis draf rasionalisasi alur terlebih dahulu.');
      return;
    }
    setIsRefiningRationale(true);
    try {
      const refined = await refineTextWithAI({
        text: rationale,
        instruction:
          'Sempurnakan penjelasan rasionalisasi alur tujuan pembelajaran ini agar profesional, berlandaskan prinsip pedagogis bertahap (mudah ke sukar/konkret ke abstrak).',
        context: `${context.subject} ${context.grade} (${context.phase})`,
      });
      setRationale(refined);
    } catch {
      alert('Gagal menyempurnakan rasionalisasi dengan AI.');
    } finally {
      setIsRefiningRationale(false);
    }
  };

  if (!hasTP) {
    return (
      <div className="bg-white rounded-2xl p-8 border border-slate-200/80 shadow-xs text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center mx-auto">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h3 className="text-lg font-bold text-slate-900">Daftar Tujuan Pembelajaran (TP) Belum Ada</h3>
        <p className="text-sm text-slate-600 max-w-md mx-auto">
          Alur Tujuan Pembelajaran (ATP) disusun dengan mengurutkan dan mengelompokkan TP yang telah dibuat sebelumnya.
        </p>
        <button
          onClick={onBackToTP}
          className="inline-flex items-center gap-2 bg-blue-700 hover:bg-blue-800 text-white px-5 py-2.5 rounded-xl text-sm font-semibold shadow-xs transition"
        >
          <Target className="w-4 h-4" />
          <span>Kembali ke Tahap TP (05)</span>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Integrity Alert if TP was modified */}
      {isTPOutdated && (
        <div className="bg-amber-50 border border-amber-300 p-4 rounded-2xl flex items-start gap-3 text-amber-900 text-xs">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h4 className="font-bold text-sm text-amber-950">
              Pembaruan Terdeteksi pada Daftar Tujuan Pembelajaran (TP)
            </h4>
            <p className="text-amber-800">
              Daftar TP telah diperbarui setelah penyusunan matriks ATP ini. Anda dapat meninjau langkah alur di bawah atau klik tombol <strong>"Susun ATP dari TP (AI)"</strong> untuk menyelaraskan ulang alur secara otomatis.
            </p>
          </div>
        </div>
      )}

      {/* Step Header */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="w-6 h-6 rounded-md bg-blue-100 text-blue-800 text-xs font-bold flex items-center justify-center">
                06
              </span>
              <h3 className="text-lg font-bold text-slate-900">Penyusunan Alur Tujuan Pembelajaran (ATP)</h3>
              {atp.workflowStatus === 'DRAFT' && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">
                  DRAFT (Perlu Konfirmasi Guru)
                </span>
              )}
              {atp.workflowStatus === 'PERLU_DILENGKAPI' && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-300">
                  PERLU DILENGKAPI
                </span>
              )}
              {atp.workflowStatus === 'SIAP' && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                  SIAP
                </span>
              )}
            </div>
            <p className="text-sm text-slate-500 mt-1">
              Petakan alur pengurutan dan pengelompokan Tujuan Pembelajaran (TP) secara bertahap dan sistematis untuk <strong>{context.subject}</strong> ({context.grade}), Tahun Ajaran {context.academicYear || '-'}. Alokasi waktu dapat dilengkapi pada tahap perencanaan waktu berikutnya.
            </p>
          </div>

          {/* AI Generator Button & Diagnostic Button */}
          <div className="flex flex-col items-end gap-1.5 self-start sm:self-auto">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={handleCopyDiagnostic}
                className="inline-flex items-center gap-2 bg-white hover:bg-slate-50 text-slate-700 px-4 py-2.5 rounded-xl text-xs font-bold border border-slate-300 shadow-sm transition cursor-pointer"
                title="Salin laporan diagnostik kesiapan TP dan gerbang ATP"
              >
                <Clipboard className="w-4 h-4 text-slate-500" />
                <span>Salin Diagnostik</span>
              </button>

              <button
                id="btn-ai-generate-atp"
                onClick={handleGenerateAI}
                disabled={isGenerating || !isTPReady}
                title={!isTPReady ? tpReadinessReason : undefined}
                className="inline-flex items-center gap-2 bg-gradient-to-r from-blue-700 to-indigo-700 hover:from-blue-800 hover:to-indigo-800 text-white px-4 py-2.5 rounded-xl text-xs font-bold shadow-sm transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isGenerating ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>AI Sedang Menyusun Alur ATP...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-amber-300" />
                    <span>Susun ATP dari TP (AI)</span>
                  </>
                )}
              </button>
            </div>
            {copyNotice && (
              <span className="text-[11px] text-emerald-700 font-semibold text-right">
                ✓ {copyNotice}
              </span>
            )}
            {!isTPReady && (
              <span className="text-[11px] text-amber-700 font-medium text-right max-w-xs">
                Penyusunan diblokir: {tpReadinessReason}
              </span>
            )}
          </div>
        </div>

        {generationError && (
          <div className="mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">
            ⚠️ {generationError}
          </div>
        )}
      </div>

      {/* Rationale Section */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
            <BookOpen className="w-4 h-4 text-blue-600" />
            <span>Rasionalisasi Alur Pembelajaran</span>
          </label>
          <button
            type="button"
            onClick={handleRefineRationale}
            disabled={isRefiningRationale}
            className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-900 bg-blue-50 px-2.5 py-1 rounded-lg transition"
          >
            <Wand2 className="w-3.5 h-3.5 text-blue-600" />
            <span>{isRefiningRationale ? 'Memoles...' : 'Poles Rasionalisasi (AI)'}</span>
          </button>
        </div>
        <textarea
          id="textarea-atp-rationale"
          rows={3}
          placeholder="Jelaskan alasan pedagogis pengurutan alur pembelajaran ini (misal: dimulai dari pengenalan konsep dasar menuju penerapan aplikatif)..."
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          className="w-full text-sm p-3.5 rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-600 leading-relaxed"
        />
      </div>

      {/* ATP Table Matrix View: Pure Sequencing */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <h4 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
              <GitMerge className="w-4 h-4 text-blue-600" />
              <span>Matriks Alur Pembelajaran ({items.length} Langkah)</span>
            </h4>
          </div>

          <button
            id="btn-add-atp-step"
            onClick={handleOpenAdd}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition cursor-pointer self-start sm:self-auto"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Tambah Langkah Alur</span>
          </button>
        </div>

        {items.length === 0 ? (
          <div className="p-10 text-center border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50/50 space-y-3">
            <GitMerge className="w-10 h-10 text-slate-300 mx-auto" />
            <p className="text-xs text-slate-500">
              Belum ada baris ATP. Klik tombol <strong>"Susun ATP dari TP (AI)"</strong> di atas untuk membuat matriks secara otomatis.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-900 text-white font-semibold">
                  <th className="p-3 w-20 text-center">No / Langkah</th>
                  <th className="p-3 min-w-[200px]">Fokus Langkah</th>
                  <th className="p-3 min-w-[320px]">TP Tertaut</th>
                  <th className="p-3 w-28 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {items.map((item, idx) => {
                  const refResult = resolveATPItemTPReferences(item, tp.items);
                  return (
                    <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-3 text-center font-bold text-slate-700 bg-slate-50/50">
                        {idx + 1}
                      </td>
                      <td className="p-3 text-slate-900 leading-relaxed">
                        {item.focus ? (
                          <div className="font-semibold text-slate-900 text-xs">
                            {item.focus}
                          </div>
                        ) : (
                          <span className="text-slate-400 text-xs italic">-</span>
                        )}
                      </td>
                      <td className="p-3 font-medium text-slate-900 leading-relaxed">
                        {refResult.canonicalTPItems.length > 0 ? (
                          <div className="space-y-1.5">
                            {refResult.canonicalTPItems.map((t) => (
                              <div key={t.id} className="flex items-start gap-1.5 text-xs text-slate-800">
                                <span className="font-mono font-bold text-blue-900 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200 shrink-0">
                                  [{t.code || '-'}]
                                </span>
                                <span className="leading-snug pt-0.5">{t.statement}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-slate-800 text-xs">
                            {item.tpCode ? (
                              <span className="font-mono font-bold text-blue-900 mr-1.5">[{item.tpCode}]</span>
                            ) : null}
                            {item.tpStatement || '-'}
                          </div>
                        )}

                        <div className="flex flex-wrap items-center gap-1.5 mt-2">
                          {refResult.status === 'DANGLING_REFERENCE' && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                              ⚠️ TP Terhapus
                            </span>
                          )}
                          {refResult.status === 'AMBIGUOUS_REFERENCE' && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                              ⚠️ TP Ambigu
                            </span>
                          )}
                          {refResult.status === 'UNRESOLVED_REFERENCE' && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                              ⚠️ Terputus
                            </span>
                          )}
                          {refResult.status === 'LEGACY_MIGRATED' && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                              ℹ️ Migrasi
                            </span>
                          )}
                          {refResult.status === 'RESOLVED_REFERENCE' && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              ✓ Canonical {refResult.canonicalTPItems.length > 1 ? `(${refResult.canonicalTPItems.length} TP)` : ''}
                            </span>
                          )}

                          {/* Profil TP sebagai informasi turunan jika ada */}
                          {Array.from(new Set(refResult.canonicalTPItems.flatMap((t) => t.graduateProfileDimensions || t.p3Dimensions || []))).map((dim, di) => (
                            <span
                              key={di}
                              className="px-1.5 py-0.5 rounded bg-slate-50 text-[10px] text-slate-600 border border-slate-200"
                            >
                              {dim}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => handleMove(idx, 'up')}
                            disabled={idx === 0}
                            className="p-1 text-slate-400 hover:text-slate-700 rounded transition disabled:opacity-20"
                            title="Geser naik"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleMove(idx, 'down')}
                            disabled={idx === items.length - 1}
                            className="p-1 text-slate-400 hover:text-slate-700 rounded transition disabled:opacity-20"
                            title="Geser turun"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleOpenEdit(item)}
                            className="p-1 text-slate-400 hover:text-blue-600 rounded transition"
                            title="Edit baris ATP"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(item.id)}
                            className="p-1 text-slate-400 hover:text-rose-600 rounded transition"
                            title="Hapus baris"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Action Footer */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            id="btn-save-atp-draft"
            type="button"
            onClick={handleSave}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 shadow-xs transition cursor-pointer"
          >
            Simpan Matriks ATP
          </button>
          <button
            id="btn-confirm-atp-siap"
            type="button"
            onClick={handleConfirmAndFinalize}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 shadow-sm transition flex items-center gap-1.5 cursor-pointer"
          >
            <Check className="w-4 h-4" />
            <span>Konfirmasi & Finalisasi ATP (SIAP)</span>
          </button>
          {saveNotice && (
            <span className="text-xs font-semibold text-emerald-700 flex items-center gap-1">
              <Check className="w-4 h-4 text-emerald-600" /> Data ATP tersimpan
            </span>
          )}
        </div>

        <button
          id="btn-next-to-admin"
          type="button"
          onClick={handleSaveAndNext}
          className="w-full sm:w-auto flex items-center justify-center gap-2 bg-blue-900 hover:bg-blue-950 text-white py-2.5 px-6 rounded-xl text-sm font-semibold shadow-sm transition cursor-pointer"
        >
          <span>Lanjut ke Pemetaan Unit/Bab (07)</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {/* MODAL: Add / Edit ATP Step (Pure Sequencing: Focus, Linked TPs, Urutan) */}
      {isEditing && currentItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                {items.some((i) => i.id === currentItem.id) ? 'Edit Langkah ATP' : 'Tambah Langkah ATP'}
              </h3>
              <button
                onClick={() => setIsEditing(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-semibold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveItemModal} className="space-y-4">
              {/* Step Focus */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Fokus Langkah <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ringkasan fokus langkah pembelajaran ini..."
                  value={currentItem.focus || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, focus: e.target.value })}
                  className="w-full text-sm px-3 py-2 rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
                />
              </div>

              {/* Multi-TP Canonical Selection */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Pilih Tujuan Pembelajaran (1 atau Lebih TP) <span className="text-rose-500">*</span>
                </label>
                <div className="max-h-56 overflow-y-auto border border-slate-300 rounded-xl p-2.5 space-y-1.5 bg-slate-50/50">
                  {tp.items.map((tItem) => {
                    const isChecked = (currentItem.linkedTpIds || []).includes(tItem.id);
                    return (
                      <label
                        key={tItem.id}
                        className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer transition text-xs ${
                          isChecked
                            ? 'bg-blue-50 border border-blue-200 text-blue-950 font-medium'
                            : 'hover:bg-slate-100 text-slate-700 border border-transparent'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            const prevIds = currentItem.linkedTpIds || (currentItem.tpId ? [currentItem.tpId] : []);
                            const nextIds = e.target.checked
                              ? Array.from(new Set([...prevIds, tItem.id]))
                              : prevIds.filter((id) => id !== tItem.id);

                            setCurrentItem({
                              ...currentItem,
                              linkedTpIds: nextIds,
                            });
                          }}
                          className="mt-0.5 rounded text-blue-600 focus:ring-blue-500"
                        />
                        <div className="leading-snug">
                          <span className="font-mono font-bold text-blue-800">[{tItem.code}]</span> {tItem.statement}
                        </div>
                      </label>
                    );
                  })}
                </div>
                {(currentItem.linkedTpIds || []).length === 0 && (
                  <p className="text-[11px] text-rose-600 mt-1">
                    * Pilih minimal 1 butir TP untuk langkah pembelajaran ini.
                  </p>
                )}
              </div>

              {/* Selected Canonical TPs Summary */}
              {(currentItem.linkedTpIds || []).length > 0 && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-700 space-y-1">
                  <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 uppercase">
                    <span>TP Tertaut ({(currentItem.linkedTpIds || []).length} TP)</span>
                    <span className="text-blue-700 font-semibold text-[10px] bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                      Canonical
                    </span>
                  </div>
                  <div className="space-y-1">
                    {tp.items
                      .filter((t) => (currentItem.linkedTpIds || []).includes(t.id))
                      .map((t) => (
                        <div key={t.id} className="text-slate-800">
                          <strong className="font-mono text-blue-900">[{t.code}]</strong> {t.statement}
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Urutan */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Urutan Langkah
                </label>
                <input
                  type="number"
                  min="1"
                  required
                  value={currentItem.stepNumber}
                  onChange={(e) =>
                    setCurrentItem({ ...currentItem, stepNumber: parseInt(e.target.value, 10) || 1 })
                  }
                  className="w-full text-sm px-3 py-2 rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 transition cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 shadow-sm transition cursor-pointer"
                >
                  Simpan Langkah
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Konfirmasi Susun Ulang ATP dengan AI */}
      {showGenerateConfirmation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-amber-50 text-amber-600 border border-amber-200">
                <AlertTriangle className="w-5 h-5 shrink-0" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-bold text-slate-900">
                  Susun Ulang ATP dengan AI?
                </h3>
                <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                  ATP saat ini sudah memiliki susunan. Penyusunan dengan AI akan menata ulang langkah ATP berdasarkan TP terbaru. Data tidak akan difinalisasi otomatis dan hasil tetap DRAFT sampai dikonfirmasi guru.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowGenerateConfirmation(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={async () => {
                  setShowGenerateConfirmation(false);
                  await executeGenerateAI();
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-blue-700 hover:bg-blue-800 shadow-sm transition flex items-center gap-1.5 cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Susun Ulang dengan AI</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
