import JSZip from 'jszip';
import { administrationZipRoot, buildAnnualZipWorkItems, isAnnualZipDocument, semesterZipFolder, type AnnualZipWorkItem } from './annualZipPlan';
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
export function getDocumentZipFolder(type: DocumentType, isBlankMode: boolean = false): string {
  if (isBlankMode) {
    return '06_Format_Kosong';
  }

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
  instanceTitle?: string
): string {
  const isBlank = context.documentMode === 'blank';
  const cleanSubject = (context.academicSetting?.subject || 'Mapel').replace(/[^a-zA-Z0-9]/g, '_');
  const cleanGrade = (context.academicSetting?.grade || 'Kelas').replace(/[^a-zA-Z0-9]/g, '_');
  const seqStr = String(indexPrefix ?? getDocumentSequenceNumber(type)).padStart(2, '0');
  const blankTag = isBlank ? '_Format_Kosong' : '';

  // Multi-instance naming with sanitized title
  if (!isBlank && instanceTitle?.trim()) {
    const sanitizedTitle = sanitizeForFileName(instanceTitle.trim());
    if (type === 'MODUL_AJAR') {
      const cleanModTitle = sanitizedTitle.startsWith('Modul_Ajar')
        ? sanitizedTitle
        : `Modul_Ajar_${sanitizedTitle}`;
      return `${seqStr}_${cleanModTitle}.${ext}`;
    }
    if (type === 'ASESMEN') {
      const cleanAssessTitle = sanitizedTitle.startsWith('Asesmen')
        ? sanitizedTitle
        : `Asesmen_${sanitizedTitle}`;
      return `${seqStr}_${cleanAssessTitle}.${ext}`;
    }
  }

  if (type === 'CP') {
    return `${seqStr}_Capaian_Pembelajaran${blankTag}.${ext}`;
  }
  if (type === 'TP') {
    return `${seqStr}_Tujuan_Pembelajaran${blankTag}.${ext}`;
  }

  const baseNames: Record<DocumentType, string> = {
    ANALISIS_CP_TP: 'Analisis_CP_TP',
    ATP: 'ATP',
    PEMETAAN_ATP_UNIT: 'Pemetaan_ATP_Unit',
    KALENDER_AKADEMIK: 'Kalender_Pendidikan',
    ALOKASI_WAKTU: 'Alokasi_Waktu',
    PROTA: 'Program_Tahunan_PROTA',
    PROMES: 'Program_Semester_PROMES',
    MODUL_AJAR: 'Modul_Ajar_RPP',
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

  const name = baseNames[type] || type;

  return `${seqStr}_${name}_${cleanSubject}_${cleanGrade}${blankTag}.${ext}`;
}

/**
 * Ensures unique file names within a ZIP folder to prevent overwrites.
 */
function getUniqueZipFileName(folder: JSZip, candidateName: string): string {
  if (!folder.file(candidateName)) {
    return candidateName;
  }
  const lastDot = candidateName.lastIndexOf('.');
  const base = lastDot !== -1 ? candidateName.slice(0, lastDot) : candidateName;
  const ext = lastDot !== -1 ? candidateName.slice(lastDot) : '';
  let counter = 1;
  while (folder.file(`${base}_${counter}${ext}`)) {
    counter++;
  }
  return `${base}_${counter}${ext}`;
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
          type !== 'MODUL_AJAR' &&
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
  const rootFolder = administrationZipRoot(rawContext);
  for (const folder of ['Administrasi_Umum', 'Semester_1', 'Semester_2']) {
    const path = `${rootFolder}/${folder}`;
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

  const safeSubject = (rawContext.academicSetting?.subject || 'Mapel').replace(/[^a-zA-Z0-9]/g, '_');
  const safeGrade = ((rawContext.academicSetting?.grade || 'Kelas') + (rawContext.academicSetting?.classSection ? '_'+rawContext.academicSetting.classSection : '')).replace(/[^a-zA-Z0-9]/g, '_');
  const safeYear = sanitizeForFileName(rawContext.academicSetting?.academicYear || 'TahunAjaran');

  const formatTag = exportFormat === 'both' ? 'PDF_Word' : exportFormat === 'pdf' ? 'PDF' : 'Word';
  const modeTag = isBlank ? 'Format_Kosong_' : '';
  const zipFileName = `Paket_Administrasi_${modeTag}${safeSubject}_${safeGrade}_${safeYear}_${formatTag}.zip`;

  // Track item counts for ordering within folders
  const folderItemCount: Record<string, number> = {};
  const itemResults: ZipExportItemStatus[] = [];
  const workItems: ZipWorkItem[] = [];

  if (!isBlank) {
    const annualPlan = buildAnnualZipWorkItems(targetTypes, effectiveContextBase);
    workItems.push(...annualPlan.items);
    itemResults.push(...annualPlan.skipped);
  } else {
    for (const type of targetTypes) {
      const semester = rawContext.academicSetting?.semester?.startsWith('2') ? 2 : 1;
      const folderCategory = isAnnualZipDocument(type) ? 'Administrasi_Umum' : semesterZipFolder(semester);
      folderItemCount[folderCategory] = (folderItemCount[folderCategory] || 0) + 1;
      workItems.push({ type, context: effectiveContextBase, folderCategory, seqNum: folderItemCount[folderCategory] });
    }
  }

  const totalSteps = workItems.length * (exportFormat === 'both' ? 2 : 1);
  let currentStep = 0;

  for (const item of workItems) {
    const effectiveContext = resolveEffectiveContext(item.context);

    // Strict validation check using exact item context (instance-aware)
    const validation = validateDocumentRequirements(item.type, effectiveContext);
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

    const folderPath = `${rootFolder}/${item.folderCategory}`;
    let targetFolder = zip.folder(folderPath);
    if (!targetFolder) {
      targetFolder = zip;
    }
    foldersCreatedSet.add(folderPath);

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
        if (pdfResult.blob && pdfResult.blob.size > 0) {
          const candidatePdfName = item.fileStem ? `${item.fileStem}.pdf` : formatDocumentZipFileName(
            item.type,
            'pdf',
            effectiveContext,
            item.seqNum,
            item.instanceTitle
          );
          const pdfFileName = getUniqueZipFileName(targetFolder, candidatePdfName);
          targetFolder.file(pdfFileName, pdfResult.blob);
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

        if (docxResult.blob && docxResult.blob.size > 0) {
          const candidateDocxName = item.fileStem ? `${item.fileStem}.docx` : formatDocumentZipFileName(
            item.type,
            'docx',
            effectiveContext,
            item.seqNum,
            item.instanceTitle
          );
          const docxFileName = getUniqueZipFileName(targetFolder, candidateDocxName);
          targetFolder.file(docxFileName, docxResult.blob);
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
    throw new Error(
      (isBlank
        ? 'Tidak ada format dokumen kosong yang berhasil dibuat untuk kurikulum saat ini.'
        : 'Tidak ada dokumen administrasi yang memenuhi syarat kelengkapan data untuk diekspor ke dalam arsip ZIP.') +
      (errorDetails ? ` Detail: ${errorDetails}` : '')
    );
  }

  const zipBlob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  if (!rawContext.skipDownload) {
    saveAs(zipBlob, zipFileName);
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
    requestedCount,
    successCount,
    partialCount,
    skippedCount,
    failedCount,
  };
}
