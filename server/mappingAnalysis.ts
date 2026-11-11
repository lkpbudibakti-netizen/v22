import { attachMinimalAlignment } from './mappingMinimalAnalysis';
import { analyzeBabFirstMapping } from './mappingBabFirstAnalysis';
import { TPData, ATPData, ATPUnitMappingData } from '../src/types';
import { hasTeacherMaterialSupport } from '../src/services/mappingAlignmentService';

export interface MappingAnalysisResult {
  step07SemanticChecks?: import('../src/types').Step07SemanticCheck[];
  analysisNotice?: string;
  pedagogicalFindings?: import('../src/services/mappingAlignmentService').MappingPedagogicalFinding[];
  alignmentProposals?: import('../src/services/mappingAlignmentService').AlignmentProposal[];
  gapFindings?: { kind: 'TP' | 'ATP' | 'MATERIAL'; id: string; proposalIds: string[]; reason: string }[];
  summary: {
    totalAtp: number;
    mappedAtp: number;
    unmappedAtp: number;
    alignedAtp: number;
    reviewAtp: number;
    alignableMaterials: number;
    missingMaterialSuggestions: number;
    manualMaterialReview: number;
  };

  atpFindings: Array<{
    id: string;
    atpItemId: string;
    status: 'ALIGNED' | 'UNMAPPED' | 'REVIEW';

    currentUnitId?: string;
    suggestedUnitId?: string;
    suggestedMaterialId?: string;

    supportingTpIds: string[];

    strength?: 'STRONG' | 'MODERATE' | 'LOW';

    reason: string;

    action?: {
      type: 'ASSIGN_ATP_TO_UNIT';
      atpItemId: string;
      targetUnitId: string;
      linkedTpIds: string[];
      targetMaterialId?: string;
    };
  }>;

  materialFindings: Array<{
    id: string;
    reviewAction?: { type:'REVIEW_AND_APPROVE'; targetUnitId:string; targetMaterialId:string; classification:'NEEDS_APPROVAL' };
    linkedTpIds?: string[];
    linkedAtpItemIds?: string[];

    status: 'SUPPORTED' | 'ALIGNABLE' | 'MISSING_MATERIAL' | 'MANUAL_REVIEW';

    unitId: string;
    materialId?: string;

    suggestedTitle?: string;

    supportingTpIds: string[];
    supportingAtpItemIds: string[];

    strength?: 'STRONG' | 'MODERATE' | 'LOW';

    reason: string;

    action?: {
      type: 'ADD_MATERIAL_TO_UNIT';
      targetUnitId: string;
      title: string;
      linkedTpIds: string[];
      linkedAtpItemIds: string[];
    } | {
      type: 'ALIGN_EXISTING_MATERIAL';
      targetUnitId: string;
      targetMaterialId: string;
      linkedAtpItemIds: string[];
      linkedTpIds: string[];
    } | {
      type: 'RECOVER_ATP_LINEAGE';
      targetUnitId: string;
      targetMaterialId?: string;
      removeAtpItemIds: string[];
      linkedAtpItemIds: string[];
      linkedTpIds: string[];
    };
  }>;
}

export interface AnalyzeATPUnitMappingServerParams {
  step07Auto?: import('../src/types').Step07AutoRequest;
  subject?: string;
  grade?: string;
  phase?: string;
  tpData: TPData;
  atpData: ATPData;
  currentMapping: ATPUnitMappingData;
}

function getCanonicalTpsForAtpItem(atpItem: any): string[] {
  if (!atpItem) return [];
  if (Array.isArray(atpItem.linkedTpIds) && atpItem.linkedTpIds.length > 0) {
    return atpItem.linkedTpIds;
  }
  if (atpItem.tpId) {
    return [atpItem.tpId];
  }
  return [];
}

export function buildMappingAnalysisPrompt(params: AnalyzeATPUnitMappingServerParams): string {
  const { subject, grade, phase, tpData, atpData, currentMapping } = params;

  // Build TP Map
  const tpMap = new Map<string, any>();
  (tpData.items || []).forEach((t) => {
    tpMap.set(t.id, t);
  });

  // Prepare ATP context using canonical linkedTpIds
  const atpContext = (atpData.items || []).map((item, idx) => {
    const rawLinked = getCanonicalTpsForAtpItem(item);

    const linkedTps = rawLinked.map((id) => {
      const t = tpMap.get(id);
      return {
        tpId: id,
        code: t?.code || 'TP',
        statement: t?.statement || '',
        contentScope: t?.contentScope || '',
        competence: t?.competence || '',
      };
    });

    return {
      atpItemId: item.id,
      stepNumber: item.stepNumber,
      focus: item.focus || '',
      linkedTps,
    };
  });

  // Prepare Teacher's Manual Units & Materials
  const activeUnitId = params.step07Auto?.execution?.activeUnitId;
  const unitsContext = (currentMapping.units || []).map((u, idx) => {
    const isTargetUnit = !activeUnitId || u.id === activeUnitId;
    if (!isTargetUnit) {
      return {
        unitId: u.id,
        order: u.order,
        title: u.title,
        assignedAtpItemIds: u.linkedAtpItemIds || [],
        assignedTpIds: u.linkedTpIds || [],
        materials: (u.materials || []).map((m) => ({
          materialId: m.id,
          order: m.order,
          title: m.title || '',
          linkedAtpItemIds: m.linkedAtpItemIds || [],
          linkedTpIds: m.linkedTpIds || [],
        })),
      };
    }
    return {
      unitId: u.id,
      order: u.order,
      title: u.title,
      assignedAtpItemIds: u.linkedAtpItemIds || [],
      assignedTpIds: u.linkedTpIds || [],
      missingMaterialCoverage: {
        tpIds: (u.linkedTpIds || []).filter(id => !(u.materials || []).some(m => (m.linkedTpIds || []).includes(id))),
        atpItemIds: (u.linkedAtpItemIds || []).filter(id => !(u.materials || []).some(m => (m.linkedAtpItemIds || []).includes(id))),
      },
      materials: (u.materials || []).map((m, mIdx) => ({
        materialId: m.id,
        order: m.order,
        title: m.title || '',
        linkedAtpItemIds: m.linkedAtpItemIds || [],
        linkedTpIds: m.linkedTpIds || [],
      })),
    };
  });

  return `Petakan Bab/Lingkup Materi ke TP dan ATP kanonikal berdasarkan relevansi substansi, kompetensi, cakupan dan konteks mapel. Utamakan LINK_TP dan pertahankan judul asli yang relevan. Jangan membuat aktivitas, asesmen atau pembuktian kompetensi; itu tanggung jawab modul ajar.
Bab/Materi → pilih subset TP relevan → derive ATP canonical. CP/TP/ATP immutable. Gunakan hanya ID input. ATP diturunkan server dari TP; jangan mengarang ID atau mengubah sumber kanonikal. Jangan menyalin semua TP ke semua materi demi coverage.
AI boleh memperbaiki judul dan relasi, menambah materi hanya bila diperlukan, memindahkan materi atau menata ulang urutan materi existing; jangan menghapus materi guru otomatis. before harus exact terhadap sumber. Tindakan wajib mandiri/atomic dan memiliki alasan relevansi singkat, bukan kutipan kompetensi atau sertifikat semantik.
Jenis: LINK_TP, EDIT_MATERIAL, EDIT_UNIT_TITLE, ADD_MATERIAL, MOVE_MATERIAL, RESTRUCTURE_UNIT. RESTRUCTURE_UNIT hanya permutasi seluruh ID materi Bab, before=JSON.stringify(urutan ID). MOVE hanya pada rekonsiliasi lintas Bab yang diizinkan, sourceUnitId harus induk asli.
Jika relasi lama perlu dikoreksi gunakan LINK_TP replaceTpIds:true dengan subset TP relevan yang eksplisit. Pertahankan pemetaan manual yang sah dan cakupan global/lokal. Jika konteks tidak cukup, laporkan gap spesifik; jangan memaksakan relasi.
Subject: ${subject || ''}; grade: ${grade || ''}; phase: ${phase || ''}
TP CANONICAL: ${JSON.stringify(tpData.items)}
ATP CANONICAL: ${JSON.stringify(atpContext)}
BAB/MATERI ASLI: ${JSON.stringify(unitsContext)}
Kembalikan JSON {"atpFindings":[],"materialFindings":[],"alignmentProposals":[{"id":"unik","type":"LINK_TP","targetUnitId":"exact","targetMaterialId":"exact kecuali ADD","sourceUnitId":"untuk MOVE","linkedTpIds":["TP ID exact"],"before":"judul asli exact / JSON urutan untuk restructure","after":"judul revisi/baru bila diperlukan","materialOrder":[],"reason":"alasan relevansi singkat"}],"gapFindings":[{"kind":"MATERIAL|TP|ATP","id":"exact","reason":"masalah tersisa"}]}.
Tidak ada panggilan VERIFY kedua. Aplikasi menerapkan aksi yang lolos validasi struktur, referensi dan lineage lalu menyimpan hasil.${params.step07Auto?.scope==='STEP07_AUTO_REPAIR'?buildStep07AutoInstructions(params.step07Auto):''}`;
}

function sanitizeStep07AutoRequestForPrompt(request: import('../src/types').Step07AutoRequest): any {
  if (!request) return request;
  const copy = structuredClone(request);
  if (copy.repair?.failures) {
    copy.repair.failures = copy.repair.failures.slice(-10).map((f: any) => ({
      ...f,
      reason: typeof f.reason === 'string' ? f.reason.slice(0, 200) : f.reason,
    }));
  }
  if (copy.validation?.rejectedActions) {
    copy.validation.rejectedActions = copy.validation.rejectedActions.slice(-10).map((a: string) =>
      typeof a === 'string' ? a.slice(0, 200) : a
    );
  }
  return copy;
}

export function buildStep07AutoInstructions(request:import('../src/types').Step07AutoRequest):string {
  const sanitizedRequest = sanitizeStep07AutoRequestForPrompt(request);
  return `\nSTEP07_AUTO_REPAIR: satu analisis menghasilkan tindakan pemetaan otomatis, tanpa ACC atau verifikasi AI kedua. Pemeriksaan kelulusan hanya sumber siap, identitas, stale, kelengkapan struktur, cakupan TP/ATP, referensi dan lineage kanonikal.
REQUEST: ${JSON.stringify(sanitizedRequest)}
Jika execution.activeUnitId tersedia, ubah hanya Bab aktif. otherUnits hanya konteks. Tindakan lintas Bab hanya pada execution.reconciliation=true. GLOBAL boleh menutup TP/ATP yang belum tercakup dengan relasi lokal yang relevan, tetapi jangan menyelesaikan ulang Bab lokal BLOCKED.
Gunakan validation.issues dan repair.failures untuk memperbaiki gap tersisa; jangan mengulang proposal identik. Pertahankan Bab/materi yang sudah lengkap, judul yang relevan, semua ID kanonikal dan perubahan manual. Jangan mengubah status SIAP/identitas atau menghapus materi. Laporkan kegagalan secara spesifik bila tidak dapat diperbaiki.`;
}

export function sanitizeMappingAnalysisResult(rawResult: any, params: AnalyzeATPUnitMappingServerParams): MappingAnalysisResult {
  const result=attachMinimalAlignment(rawResult, params, analyzeBabFirstMapping(rawResult, params));
  if(params.step07Auto?.scope==='STEP07_AUTO_REPAIR'&&params.step07Auto.phase==='VERIFY') result.step07SemanticChecks=Array.isArray(rawResult?.step07SemanticChecks)?rawResult.step07SemanticChecks:[];
  return result;
}

export function fallbackAnalyzeMapping(params: AnalyzeATPUnitMappingServerParams): MappingAnalysisResult {
  return attachMinimalAlignment({}, params, analyzeBabFirstMapping({}, params));
}
