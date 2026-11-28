import { assertProductionDocumentFile, productionFinding, formatProductionFindings, ProductionExportError } from '../productionValidation';
import JSZip from 'jszip';
import { administrationZipRoot, administrationZipFileName, buildAnnualZipWorkItems, type AnnualZipWorkItem } from './annualZipPlan';
import saveAs from 'file-saver';
import {
  DocumentType,
  DocumentGenerationContext,
  DocumentSnapshot,
  AppDocumentRecord,
  ZipExportFormat,
  ZipExportOptions,
  ZipExportResult,
  ZipExportItemStatus,
} from './types';
import { getCurriculumType } from '../curriculumRules';
import { resolveEffectiveContext } from './snapshot';
import { validateDocumentRequirements, generateDocument } from './index';
import { generatePdfDocument } from './renderers/pdf/pdfDocGenerators';
import { MERDEKA_EXPORT_DOC_TYPES } from '../curriculumRouter';

export const MERDEKA_DOC_TYPES: DocumentType[] = MERDEKA_EXPORT_DOC_TYPES;

export const K13_DOC_TYPES: DocumentType[] = [
  'ANALISIS_SKL_KI_KD',
  'PENETAPAN_KKM',
  'KALENDER_AKADEMIK',
  'ALOKASI_WAKTU',
  'PROTA',
  'PROMES',
  'DAFTAR_HADIR',
  'DAFTAR_NILAI',
  'JURNAL',
  'REMEDIAL_PENGAYAAN',
];

/**
 * Returns the official administration category folder based on document catalog.
 * Structure:
 * 01_Kurikulum
 * 02_Perencanaan
 * 03_Asesmen
 * 04_Pelaksanaan
 * 05_Tindak_Lanjut
 * 06_Format_Kosong
 */
export function getDocumentZipFolder(type: DocumentType, _identityMasked: boolean = false): string {
  switch (type) {
    case 'CP':
    case 'TP':
    case 'ANALISIS_CP_TP':
    case 'ANALISIS_SKL_KI_KD':
    case 'PENETAPAN_KKM':
      return '01_Kurikulum';

    case 'ATP':
    case 'PEMETAAN_ATP_UNIT':
    case 'KALENDER_AKADEMIK':
    case 'ALOKASI_WAKTU':
    case 'PROTA':
    case 'PROMES':
    case 'RPM':
    case 'MODUL_AJAR':
      return '02_Perencanaan';

    case 'KKTP':
    case 'ASESMEN':
    case 'DAFTAR_NILAI':
      return '03_Asesmen';

    case 'DAFTAR_HADIR':
    case 'JURNAL':
      return '04_Pelaksanaan';

    case 'REMEDIAL_PENGAYAAN':
      return '05_Tindak_Lanjut';

    default:
      return '02_Perencanaan';
  }
}

/**
 * Returns specific sub-category name inside 06_Format_Kosong if needed.
 */
export function getBlankSubCategoryFolder(type: DocumentType): string {
  switch (type) {
    case 'CP':
    case 'TP':
    case 'ANALISIS_CP_TP':
    case 'ANALISIS_SKL_KI_KD':
    case 'PENETAPAN_KKM':
      return '01_Kurikulum';

    case 'ATP':
    case 'PEMETAAN_ATP_UNIT':
    case 'KALENDER_AKADEMIK':
    case 'ALOKASI_WAKTU':
    case 'PROTA':
    case 'PROMES':
    case 'RPM':
    case 'MODUL_AJAR':
      return '02_Perencanaan';

    case 'KKTP':
    case 'ASESMEN':
    case 'DAFTAR_NILAI':
      return '03_Asesmen';

    case 'DAFTAR_HADIR':
    case 'JURNAL':
      return '04_Pelaksanaan';

    case 'REMEDIAL_PENGAYAAN':
      return '05_Tindak_Lanjut';

    default:
      return '02_Perencanaan';
  }
}

/**
 * Returns consistent sequence number within each category.
 */
export function getDocumentSequenceNumber(type: DocumentType): number {
  const sequenceMap: Record<DocumentType, number> = {
    CP: 1,
    TP: 2,
    ANALISIS_CP_TP: 3,
    ANALISIS_SKL_KI_KD: 1,
    PENETAPAN_KKM: 2,

    ATP: 1,
    PEMETAAN_ATP_UNIT: 2,
    KALENDER_AKADEMIK: 3,
    ALOKASI_WAKTU: 4,
    PROTA: 5,
    PROMES: 6,
    MODUL_AJAR: 7,
    RPM: 8,

    KKTP: 1,
    ASESMEN: 2,
    DAFTAR_NILAI: 3,

    DAFTAR_HADIR: 1,
    JURNAL: 2,

    REMEDIAL_PENGAYAAN: 1,
    HARI_EFEKTIF: 3,
  };

  return sequenceMap[type] || 1;
}

/**
 * Sanitizes strings for safe, stable file names.
 */
export function sanitizeForFileName(input: string): string {
  return input
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Formats a clean, consistent filename for packaging inside ZIP.
 */
export function formatDocumentZipFileName(
  type: DocumentType,
  ext: 'pdf' | 'docx',
  context: DocumentGenerationContext,
  indexPrefix?: number,
  instanceTitle?: string,
  fileStem?: string,
): string {
  const seq = String(indexPrefix ?? getDocumentSequenceNumber(type)).padStart(2, '0');
  const blankTag = context.documentMode === 'blank' ? '_Format_Kosong' : '';

  const baseNames: Record<DocumentType, string> = {
    ANALISIS_CP_TP: 'Analisis_CP_TP',
    ATP: 'ATP',
    PEMETAAN_ATP_UNIT: 'Pemetaan_ATP_Unit',
    KALENDER_AKADEMIK: 'Kalender_Pendidikan',
    ALOKASI_WAKTU: 'Alokasi_Waktu',
    PROTA: 'Program_Tahunan_PROTA',
    PROMES: 'Program_Semester_PROMES',
    MODUL_AJAR: 'Modul_Ajar_RPP',
    RPM: 'RPM',
    KKTP: 'KKTP',
    ASESMEN: 'Instrumen_Asesmen_Rubrik',
    DAFTAR_HADIR: 'Daftar_Hadir_Siswa',
    DAFTAR_NILAI: 'Buku_Daftar_Nilai',
    JURNAL: 'Jurnal_Harian_Mengajar',
    REMEDIAL_PENGAYAAN: 'Program_Remedial_Pengayaan',
    ANALISIS_SKL_KI_KD: 'Analisis_SKL_KI_KD',
    PENETAPAN_KKM: 'Penetapan_KKM',
    CP: 'Capaian_Pembelajaran',
    TP: 'Tujuan_Pembelajaran',
    HARI_EFEKTIF: 'Rincian_Hari_Efektif',
  };

  const multiInstance = type === 'MODUL_AJAR' || type === 'RPM' || type === 'ASESMEN';
  const title = multiInstance && instanceTitle?.trim() ? sanitizeForFileName(instanceTitle.replace(/[^a-zA-Z0-9 _-]/g, '_')) : '';
  const stem = fileStem || [seq, baseNames[type], title].filter(Boolean).join('_');
  return boundedZipName(stem, blankTag + '.' + ext);
}

// The root is at most 34 characters and the deepest folder prefix adds 24.
const maxZipFileNameLength = 64;
function boundedZipName(stem: string, suffix: string): string {
  return stem.slice(0, maxZipFileNameLength - suffix.length).replace(/[ ._-]+$/g, '') + suffix;
}

function getUniqueZipFileName(used: Set<string>, candidate: string): string {
  const lastDot = candidate.lastIndexOf('.');
  const stem = candidate.slice(0, lastDot);
  const ext = candidate.slice(lastDot);
  let name = candidate;
  for (let counter = 2; used.has(name.toLowerCase()); counter++) {
    name = boundedZipName(stem, '_' + counter + ext);
  }
  used.add(name.toLowerCase());
  return name;
}

type ZipWorkItem = AnnualZipWorkItem;

/**
 * Main ZIP Bundle Generator supporting:
 * 1. ZIP PDF (via PDF Renderer)
 * 2. ZIP Word (via DOCX Renderer)
 * 3. ZIP PDF + Word (Combination of both)
 * Data exports package one academic year: annual documents plus canonical semester folders.
 * Every file sits directly in the general-administration or semester folder under one readable root.
 */
// JSZip reads Blob input through FileReader, which is unavailable in Node.
async function zipDocumentData(blob: Blob): Promise<Blob | Uint8Array> {
  if (typeof FileReader !== 'undefined' || !(blob instanceof Blob)) return blob;
  return new Uint8Array(await blob.arrayBuffer());
}

export async function generateZipBundle(
  typesOrOptions: DocumentType[] | ZipExportOptions,
  rawContext: DocumentGenerationContext,
  formatParam: ZipExportFormat = 'pdf',
  onProgressParam?: (current: number, total: number, docTitle: string) => void,
  existingRecordsParam?: AppDocumentRecord[]
): Promise<ZipExportResult> {
  // Normalize options
  let targetTypes: DocumentType[];
  let exportFormat: ZipExportFormat = formatParam;
  let onProgress = onProgressParam;
  let documentMode = rawContext.documentMode || 'data';

  if (!Array.isArray(typesOrOptions) && typeof typesOrOptions === 'object') {
    const opts = typesOrOptions as ZipExportOptions;
    exportFormat = opts.format || 'pdf';
    documentMode = opts.documentMode || rawContext.documentMode || 'data';
    onProgress = opts.onProgress || onProgressParam;
    targetTypes = opts.types && opts.types.length > 0 ? opts.types : [];
  } else {
    targetTypes = typesOrOptions as DocumentType[];
  }

  const curType = getCurriculumType(
    rawContext.academicSetting?.curriculumType || rawContext.academicSetting?.curriculum
  );

  // If no explicit types specified, use curriculum-appropriate catalog
  if (!targetTypes || targetTypes.length === 0) {
    targetTypes = curType === 'K13' ? [...K13_DOC_TYPES] : [...MERDEKA_DOC_TYPES];
  } else {
    // Filter out types incompatible with current curriculum
    targetTypes = targetTypes.filter((type) => {
      if (curType === 'K13') {
        return (
          type !== 'ANALISIS_CP_TP' &&
          type !== 'ATP' &&
          type !== 'PEMETAAN_ATP_UNIT' &&
          type !== 'MODUL_AJAR' && type !== 'RPM' &&
          type !== 'KKTP' &&
          type !== 'ASESMEN' &&
          type !== 'CP' &&
          type !== 'TP'
        );
      } else {
        return type !== 'ANALISIS_SKL_KI_KD' && type !== 'PENETAPAN_KKM';
      }
    });
  }

  const zip = new JSZip();
  let exportedCount = 0;
  let pdfCount = 0;
  let docxCount = 0;
  const foldersCreatedSet = new Set<string>();
  const rootFolder = administrationZipRoot(resolveEffectiveContext({ ...rawContext, documentMode }));
  const folderPath = (format: 'pdf' | 'docx', category: string) =>
    [rootFolder, format === 'pdf' ? 'PDF' : 'WORD', category].join('/');
  const formats = exportFormat === 'both' ? ['pdf', 'docx'] as const : [exportFormat];
  for (const format of formats) for (const category of ['Administrasi_Umum', 'Semester_1', 'Semester_2']) {
    const path = folderPath(format, category);
    zip.folder(path);
    foldersCreatedSet.add(path);
  }
  const snapshots: DocumentSnapshot[] = [];

  const isBlank = documentMode === 'blank';
  const effectiveContextBase: DocumentGenerationContext = {
    ...rawContext,
    documentMode,
    skipDownload: true, // Crucial: prevents individual browser download prompts
  };

  const zipFileName = administrationZipFileName(effectiveContextBase, exportFormat);
  const usedNames = new Map<string, Set<string>>();
  const reserveName = (item: ZipWorkItem, context: DocumentGenerationContext, ext: 'pdf' | 'docx') => {
    const path = folderPath(ext, item.folderCategory);
    const used = usedNames.get(path) ?? new Set<string>();
    usedNames.set(path, used);
    return getUniqueZipFileName(used, formatDocumentZipFileName(
      item.type, ext, context, item.seqNum, item.instanceTitle, item.fileStem,
    ));
  };
  const itemResults: ZipExportItemStatus[] = [];
  const warnings: import('../productionValidation').ProductionFinding[] = [];
  const workItems: ZipWorkItem[] = [];

  {
    const annualPlan = buildAnnualZipWorkItems(targetTypes, effectiveContextBase);
    workItems.push(...annualPlan.items);
    itemResults.push(...annualPlan.skipped);
  }

  const totalSteps = workItems.length * (exportFormat === 'both' ? 2 : 1);
  let currentStep = 0;

  for (const item of workItems) {
    let effectiveContext: DocumentGenerationContext;
    let validation;
    try {
      effectiveContext = resolveEffectiveContext(item.context);
      validation = validateDocumentRequirements(item.type, effectiveContext);
      warnings.push(...(validation.findings || []).filter(finding => finding.classification === 'WARNING').map(finding => ({ ...finding, object: item.instanceTitle || item.type })));
    } catch (error) {
      itemResults.push({ type: item.type, instanceId: item.instanceId, instanceTitle: item.instanceTitle, status: 'FAILED', reason: error instanceof Error ? error.message : String(error) });
      continue;
    }
    if (!validation.isValid) {
      itemResults.push({
        type: item.type,
        instanceId: item.instanceId,
        instanceTitle: item.instanceTitle,
        status: 'SKIPPED',
        reason: validation.missingFields.join('; '),
      });
      continue;
    }

    const filesGenerated: string[] = [];
    let pdfSuccess = false;
    let docxSuccess = false;
    let pdfError: string | null = null;
    let docxError: string | null = null;

    const displayLabel = item.instanceTitle
      ? `${item.type} — ${item.instanceTitle}`
      : item.type;

    // 1. PDF Export (using PDF Renderer)
    if (exportFormat === 'pdf' || exportFormat === 'both') {
      try {
        currentStep++;
        if (onProgress) {
          onProgress(currentStep, totalSteps, `PDF: ${displayLabel}`);
        }
        const pdfResult = await generatePdfDocument(item.type, effectiveContext);
        if (rawContext.workMode === 'production') await assertProductionDocumentFile(pdfResult.blob, 'pdf');
        if (pdfResult.blob && pdfResult.blob.size > 0) {
          const targetFolder = zip.folder(folderPath('pdf', item.folderCategory))!;
          const pdfFileName = reserveName(item, effectiveContext, 'pdf');
          targetFolder.file(pdfFileName, await zipDocumentData(pdfResult.blob));
          filesGenerated.push(pdfFileName);
          pdfCount++;
          pdfSuccess = true;
          if (pdfResult.snapshot) {
            snapshots.push(pdfResult.snapshot);
          }
        } else {
          pdfError = 'File PDF kosong';
        }
      } catch (err: unknown) {
        console.warn(`[ZIP Engine] Error rendering PDF for ${displayLabel}:`, err);
        pdfError = err instanceof Error ? err.message : 'Gagal merender PDF';
      }
    }

    // 2. DOCX Export (using DOCX Renderer)
    if (exportFormat === 'docx' || exportFormat === 'both') {
      try {
        currentStep++;
        if (onProgress) {
          onProgress(currentStep, totalSteps, `Word: ${displayLabel}`);
        }
        const docxResult = await generateDocument(item.type, {
          ...effectiveContext,
          skipDownload: true,
        });

        if (rawContext.workMode === 'production') await assertProductionDocumentFile(docxResult.blob, 'docx');
        if (docxResult.blob && docxResult.blob.size > 0) {
          const targetFolder = zip.folder(folderPath('docx', item.folderCategory))!;
          const docxFileName = reserveName(item, effectiveContext, 'docx');
          targetFolder.file(docxFileName, await zipDocumentData(docxResult.blob));
          filesGenerated.push(docxFileName);
          docxCount++;
          docxSuccess = true;
          if (docxResult.record?.snapshot) {
            snapshots.push(docxResult.record.snapshot);
          }
        } else {
          docxError = 'File Word (DOCX) kosong';
        }
      } catch (err: unknown) {
        console.warn(`[ZIP Engine] Error rendering DOCX for ${displayLabel}:`, err);
        docxError = err instanceof Error ? err.message : 'Gagal merender DOCX';
      }
    }

    if (filesGenerated.length > 0) {
      exportedCount++;
    }

    if (exportFormat === 'both') {
      if (pdfSuccess && docxSuccess) {
        itemResults.push({
          type: item.type,
          instanceId: item.instanceId,
          instanceTitle: item.instanceTitle,
          status: 'SUCCESS',
          filesGenerated,
        });
      } else if (pdfSuccess || docxSuccess) {
        const partialReason = !pdfSuccess
          ? (pdfError ? `PDF gagal: ${pdfError}` : 'PDF gagal dibuat')
          : (docxError ? `Word gagal: ${docxError}` : 'Word gagal dibuat');
        itemResults.push({
          type: item.type,
          instanceId: item.instanceId,
          instanceTitle: item.instanceTitle,
          status: 'PARTIAL',
          reason: partialReason,
          filesGenerated,
        });
      } else {
        const failReasons = [
          pdfError ? `PDF: ${pdfError}` : null,
          docxError ? `Word: ${docxError}` : null,
        ]
          .filter(Boolean)
          .join('; ');
        itemResults.push({
          type: item.type,
          instanceId: item.instanceId,
          instanceTitle: item.instanceTitle,
          status: 'FAILED',
          reason: failReasons || 'Gagal membuat file dokumen',
        });
      }
    } else if (exportFormat === 'pdf') {
      if (pdfSuccess) {
        itemResults.push({
          type: item.type,
          instanceId: item.instanceId,
          instanceTitle: item.instanceTitle,
          status: 'SUCCESS',
          filesGenerated,
        });
      } else {
        itemResults.push({
          type: item.type,
          instanceId: item.instanceId,
          instanceTitle: item.instanceTitle,
          status: 'FAILED',
          reason: pdfError || 'Gagal merender PDF',
        });
      }
    } else {
      // exportFormat === 'docx'
      if (docxSuccess) {
        itemResults.push({
          type: item.type,
          instanceId: item.instanceId,
          instanceTitle: item.instanceTitle,
          status: 'SUCCESS',
          filesGenerated,
        });
      } else {
        itemResults.push({
          type: item.type,
          instanceId: item.instanceId,
          instanceTitle: item.instanceTitle,
          status: 'FAILED',
          reason: docxError || 'Gagal merender DOCX',
        });
      }
    }
  }

  const totalFiles = pdfCount + docxCount;
  if (totalFiles === 0) {
    const errorDetails = itemResults.map((r) => `${r.type}: ${r.status} (${r.reason})`).join('; ');
    if (rawContext.workMode === 'production') throw new ProductionExportError([
      ...itemResults.filter(item => item.status !== 'SUCCESS').map(item => productionFinding(item.type, item.instanceTitle || item.instanceId || item.type, 'BLOCKER_DOKUMEN', item.reason || item.status)),
      productionFinding('ZIP', zipFileName, 'BLOCKER_PAKET', 'Tidak ada satu pun dokumen yang berhasil dihasilkan.'),
    ], itemResults);
    throw new Error(
      (isBlank
        ? 'Tidak ada format dokumen kosong yang berhasil dibuat untuk kurikulum saat ini.'
        : 'Tidak ada dokumen administrasi yang memenuhi syarat kelengkapan data untuk diekspor ke dalam arsip ZIP.') +
      (errorDetails ? ` Detail: ${errorDetails}` : '')
    );
  }

  const incomplete = itemResults.some(item => item.status !== 'SUCCESS');
  if (rawContext.workMode === 'production' || incomplete) {
    const findings = itemResults.filter(item => item.status !== 'SUCCESS').map(item => productionFinding(item.type, item.instanceTitle || item.instanceId || item.type, 'BLOCKER_DOKUMEN', item.reason || item.status));
    zip.file(rootFolder + '/Laporan_Ekspor.txt', 'Status: ' + (incomplete ? 'TIDAK LENGKAP' : 'LENGKAP') + '\n' + formatProductionFindings([...findings, ...warnings]));
  }
  let zipBlob: Blob;
  try {
  zipBlob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  if (rawContext.workMode === 'production' && !zipBlob.size) throw new Error('ZIP kosong atau tidak valid.');
  if (!rawContext.skipDownload) {
    saveAs(zipBlob, zipFileName);
  }

  } catch (error) {
    if (rawContext.workMode !== 'production') throw error;
    throw new ProductionExportError([productionFinding('ZIP', zipFileName, 'BLOCKER_PAKET', error instanceof Error ? error.message : String(error))], itemResults);
  }
  const requestedCount = itemResults.length;
  const successCount = itemResults.filter((r) => r.status === 'SUCCESS').length;
  const partialCount = itemResults.filter((r) => r.status === 'PARTIAL').length;
  const skippedCount = itemResults.filter((r) => r.status === 'SKIPPED').length;
  const failedCount = itemResults.filter((r) => r.status === 'FAILED').length;
  const isComplete = requestedCount > 0 && successCount === requestedCount && partialCount === 0 && skippedCount === 0 && failedCount === 0;

  return {
    success: true,
    isComplete,
    zipFileName,
    zipBlob,
    exportedCount,
    pdfCount,
    docxCount,
    foldersCreated: Array.from(foldersCreatedSet),
    snapshots,
    itemResults,
    warnings,
    requestedCount,
    successCount,
    partialCount,
    skippedCount,
    failedCount,
  };
}
