import { attachMinimalAlignment } from './mappingMinimalAnalysis';
import { analyzeBabFirstMapping } from './mappingBabFirstAnalysis';
import { TPData, ATPData, ATPUnitMappingData } from '../src/types';

export interface MappingAnalysisResult {
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
  const unitsContext = (currentMapping.units || []).map((u, idx) => {
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

  return `Analisis semantik seluruh TP/ATP dan seluruh Bab/Materi untuk perubahan seminimal mungkin.
CP/TP/ATP canonical immutable. ID Bab dan materi tetap. Judul Bab/Materi boleh disunting dengan diff sebelum/sesudah.
COPYEDIT: ejaan, kapitalisasi, tanda baca kosmetik. RENAME: makna dan cakupan tetap, hanya otomatis bila aturan kesetaraan deterministik membuktikannya. Jangan memakai jumlah kata/rasio kemiripan sebagai bukti.
EDIT_UNIT_TITLE menyunting judul Bab; EDIT_MATERIAL menyunting judul materi. Perubahan makna/cakupan adalah CONTENT_CHANGE dan wajib persetujuan guru; perubahan relasi adalah REALIGN dan wajib persetujuan guru. Jangan terus mengganti judul yang sudah baik pada analisis ulang.
Bab/Materi → pilih subset TP relevan → derive ATP canonical. Pertahankan stepNumber, focus, linkedTpIds ATP serta unit.order Bab.
Jangan menjadikan overlap keyword sebagai authority relevansi. Analisis kompetensi, lingkup, progresi dan konteks secara menyeluruh.
Evaluasi SETIAP materi, termasuk yang belum memiliki relasi meskipun coverage global sudah 100%. TP luas dapat relevan pada bela diri, senam, irama dan aktivitas air tanpa kata yang sama. Jelaskan aktivitas konkret yang membuktikan kompetensi TP (misalnya menginvestigasi konsep atau mentransfer strategi), bukan sekadar menyebut gerakan. Jangan mengarang aktivitas yang tidak ada di sumber; jika hanya judul belum cukup, beri kandidat TP dalam gapFindings dengan syarat bukti/aktivitas yang perlu dikonfirmasi guru. Ketiadaan keyword bukan alasan penolakan.
Jangan menambah materi baru untuk menutup coverage sebelum menilai materi existing. ADD/MOVE/perluasan substansi selalu menunggu persetujuan guru. Kepercayaan AI bukan otorisasi AUTO_APPLY; server memeriksa sumber dan riwayat persetujuan secara independen.
Untuk setiap gap pilih prioritas LINK_TP → EDIT_MATERIAL → ADD_MATERIAL → MOVE_MATERIAL → RESTRUCTURE_UNIT.
LINK_TP: usulan hubungan materi existing tanpa mengubah teks. EDIT_MATERIAL/EDIT_UNIT_TITLE: before harus exact; after berupa judul yang bermakna jelas. Kutipan kata yang sama bukan bukti dukungan kompetensi.
ADD_MATERIAL: boleh pada Bab yang SUDAH memiliki materi jika gap tidak dapat ditutup melalui materi existing. Jangan mengganti materi lama.
MOVE_MATERIAL: sourceUnitId dan targetUnitId existing, targetMaterialId exact. Jangan pindahkan ATP canonical atau ubah Bab.
RESTRUCTURE_UNIT adalah opsi terakhir: hanya mengurutkan materi existing di satu Bab, materialOrder berisi seluruh ID materi; before = JSON.stringify(urutan ID materi saat ini). Tidak membuat/menghapus/mengurutkan Bab.
Setiap action memerlukan linkedTpIds canonical, alasan pedagogis spesifik, evidence per TP berupa tpQuote substring exact pernyataan TP dan materialQuote substring exact materi ASLI (atau judul baru untuk ADD_MATERIAL).
Untuk menghindari kutipan terlalu pendek, COPY pernyataan TP utuh ke tpQuote dan judul materi asli utuh ke materialQuote (ADD_MATERIAL: copy judul after utuh). Jangan parafrase, ubah tanda baca atau rapikan spasi kutipan.
Minimum kutipan validator: tpQuote >= min(12, panjang pernyataan TP), materialQuote >= min(8, panjang judul sumber). Tetap harus substring exact, bukan keyword generik.
Gunakan ID tpId/unitId/materialId dari JSON sumber, bukan kode TP atau nomor Bab. before LINK_TP/EDIT_MATERIAL/MOVE_MATERIAL wajib judul asli exact; after EDIT/ADD wajib judul revisi/baru, bukan object atau penjelasan. MOVE sourceUnitId wajib Bab induk asli.
Gunakan satu type literal (contoh "LINK_TP"), bukan gabungan nama type dengan tanda |. Setiap proposal adalah action flat sesuai schema di bawah; envelope {id, action:{...}} juga didukung jika field yang sama tidak bertentangan. Semua penolakan validator tetap ditampilkan dan tidak dapat dipilih.
Server memisahkan redaksi otomatis terverifikasi dari usulan yang memerlukan persetujuan guru. Server menurunkan ATP induk, menghitung coverage dan memvalidasi lineage/progression/ID/substansi eksplisit.
Jangan memaksakan relasi demi Z=0. Untuk SETIAP TP uncovered, ATP unmapped, dan materi review, berikan proposal konkret atau alasan spesifik dalam gapFindings. Jangan mengarang ID.
Usulkan alternatif terpisah dan terurut prioritas; hindari beberapa perubahan bertentangan pada materi sama. Action harus mandiri/atomic; coverage dari data aktual, bukan klaim AI.
Subject: ${subject || ''}; grade: ${grade || ''}; phase: ${phase || ''}
SEMUA TP CANONICAL (termasuk TP tanpa ATP induk): ${JSON.stringify(tpData.items)}
ATP CANONICAL: ${JSON.stringify(atpContext)}
BAB/MATERI ASLI: ${JSON.stringify(unitsContext)}
Kembalikan JSON:
{
 "atpFindings": [], "materialFindings": [],
 "materialReviews": [{"unitId":"exact","materialId":"exact","candidates":[{"tpIds":["exact"],"reason":"Jelaskan hubungan kompetensi, aktivitas, cakupan dan konteks Bab; kandidat bersyarat bukan klaim sudah selaras.","evidence":[{"tpId":"exact","tpQuote":"pernyataan TP asli utuh","materialQuote":"judul materi asli utuh"}],"missingEvidence":["Aktivitas/bukti yang belum tersedia dan perlu dikonfirmasi guru, kosong bila cukup untuk diusulkan ACC"]}]}],
 "alignmentProposals": [{"id":"unik", "type":"EDIT_UNIT_TITLE|LINK_TP|EDIT_MATERIAL|ADD_MATERIAL|MOVE_MATERIAL|RESTRUCTURE_UNIT",
 "targetUnitId":"exact", "sourceUnitId":"untuk MOVE", "targetMaterialId":"exact kecuali ADD",
 "linkedTpIds":["exact"], "before":"judul asli exact / JSON ID order untuk restructure", "after":"judul revisi/baru",
 "materialOrder":["hanya untuk restructure"], "reason":"alasan pedagogis dan mengapa tindakan lebih kecil tidak cukup",
 "evidence":[{"tpId":"exact", "tpQuote":"kutipan TP exact", "materialQuote":"kutipan materi exact"}]}],
 "gapFindings":[{"kind":"TP|ATP|MATERIAL", "id":"exact", "reason":"alasan spesifik bila belum dapat diselaraskan"}]
}`;
}

export function sanitizeMappingAnalysisResult(rawResult: any, params: AnalyzeATPUnitMappingServerParams): MappingAnalysisResult {
  return attachMinimalAlignment(rawResult, params, analyzeBabFirstMapping(rawResult, params));
}

export function fallbackAnalyzeMapping(params: AnalyzeATPUnitMappingServerParams): MappingAnalysisResult {
  return attachMinimalAlignment({}, params, analyzeBabFirstMapping({}, params));
}
