import * as XLSX from 'xlsx';
import { ATPUnitMapping, ATPUnitMaterial } from '../types';

export interface RawBabMateriRow {
  babOrder?: unknown;
  babTitle?: unknown;
  materialOrder?: unknown;
  materialTitle?: unknown;
  [key: string]: unknown;
}

export type ATPUnitMappingImportMode = 'FULL_STRUCTURE' | 'UPDATE_BAB_TITLES_ONLY';

export interface BabTitleChangePreview {
  babOrder: number;
  oldTitle: string;
  newTitle: string;
}

export interface ATPUnitMappingImportStats {
  totalBabs: number;
  totalMaterials: number;
  titleChangesCount?: number;
}

export interface ATPUnitMappingImportResult {
  success: boolean;
  mode: ATPUnitMappingImportMode;
  units?: ATPUnitMapping[];
  titleChanges?: BabTitleChangePreview[];
  errors?: string[];
  stats?: ATPUnitMappingImportStats;
}

/**
 * Normalizes header key to alphanumeric lowercase.
 */
function normalizeHeader(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Extracts raw row values across exact or friendly normalized headers.
 */
function extractRowValues(row: Record<string, unknown>): {
  rawBabOrder: unknown;
  rawBabTitle: unknown;
  rawMaterialOrder: unknown;
  rawMaterialTitle: unknown;
} {
  let rawBabOrder: unknown = undefined;
  let rawBabTitle: unknown = undefined;
  let rawMaterialOrder: unknown = undefined;
  let rawMaterialTitle: unknown = undefined;

  for (const [key, val] of Object.entries(row)) {
    const norm = normalizeHeader(key);

    if (
      rawBabOrder === undefined &&
      (norm === 'baborder' || norm === 'nomorbab' || norm === 'urutanbab' || norm === 'nobab')
    ) {
      rawBabOrder = val;
    } else if (
      rawBabTitle === undefined &&
      (norm === 'babtitle' || norm === 'judulbab' || norm === 'namabab' || norm === 'bab')
    ) {
      rawBabTitle = val;
    } else if (
      rawMaterialOrder === undefined &&
      (norm === 'materialorder' ||
        norm === 'nomormateri' ||
        norm === 'urutanmateri' ||
        norm === 'nomorlingkupmateri' ||
        norm === 'urutanlingkupmateri')
    ) {
      rawMaterialOrder = val;
    } else if (
      rawMaterialTitle === undefined &&
      (norm === 'materialtitle' ||
        norm === 'judulmateri' ||
        norm === 'lingkupmateri' ||
        norm === 'namamateri' ||
        norm === 'materi')
    ) {
      rawMaterialTitle = val;
    }
  }

  return { rawBabOrder, rawBabTitle, rawMaterialOrder, rawMaterialTitle };
}

/**
 * Validates and transforms parsed row data into canonical ATPUnitMapping[] structures without lineage.
 * If any error is found, returns success: false with full error list and NO partial results.
 */
export function validateAndBuildATPUnitMappings(
  rows: RawBabMateriRow[]
): ATPUnitMappingImportResult {
  const errors: string[] = [];

  if (!rows || rows.length === 0) {
    return {
      success: false,
      mode: 'FULL_STRUCTURE',
      errors: ['File atau sheet tidak memiliki baris data untuk diimpor.'],
    };
  }

  // Maps babOrder -> babTitle for conflicting title check
  const babTitleByOrder = new Map<number, string>();
  // Set to detect duplicate (babOrder, materialOrder) combination
  const seenBabMaterialCombo = new Set<string>();

  // Intermediate accumulator: babOrder -> { title, materials: [] }
  const babsMap = new Map<
    number,
    {
      babOrder: number;
      babTitle: string;
      materials: Array<{ materialOrder: number; materialTitle: string }>;
    }
  >();

  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx];
    const rowNumber = idx + 2; // Assuming row 1 was header in Excel

    const { rawBabOrder, rawBabTitle, rawMaterialOrder, rawMaterialTitle } = extractRowValues(row);

    // 1. Validate babOrder: must be positive integer
    let parsedBabOrder: number | null = null;
    if (rawBabOrder === undefined || rawBabOrder === null || String(rawBabOrder).trim() === '') {
      errors.push(`Baris ${rowNumber}: 'babOrder' wajib diisi.`);
    } else {
      const num = typeof rawBabOrder === 'number' ? rawBabOrder : Number(String(rawBabOrder).trim());
      if (!Number.isInteger(num) || num <= 0) {
        errors.push(
          `Baris ${rowNumber}: 'babOrder' harus berupa bilangan bulat positif (diterima: ${String(rawBabOrder)}).`
        );
      } else {
        parsedBabOrder = num;
      }
    }

    // 2. Validate babTitle: non-empty string
    let parsedBabTitle: string | null = null;
    if (rawBabTitle === undefined || rawBabTitle === null || String(rawBabTitle).trim() === '') {
      errors.push(`Baris ${rowNumber}: 'babTitle' wajib diisi.`);
    } else {
      parsedBabTitle = String(rawBabTitle).trim();
    }

    // 3. Validate materialOrder: must be positive integer
    let parsedMaterialOrder: number | null = null;
    if (rawMaterialOrder === undefined || rawMaterialOrder === null || String(rawMaterialOrder).trim() === '') {
      errors.push(`Baris ${rowNumber}: 'materialOrder' wajib diisi.`);
    } else {
      const num = typeof rawMaterialOrder === 'number' ? rawMaterialOrder : Number(String(rawMaterialOrder).trim());
      if (!Number.isInteger(num) || num <= 0) {
        errors.push(
          `Baris ${rowNumber}: 'materialOrder' harus berupa bilangan bulat positif (diterima: ${String(rawMaterialOrder)}).`
        );
      } else {
        parsedMaterialOrder = num;
      }
    }

    // 4. Validate materialTitle: non-empty string
    let parsedMaterialTitle: string | null = null;
    if (rawMaterialTitle === undefined || rawMaterialTitle === null || String(rawMaterialTitle).trim() === '') {
      errors.push(`Baris ${rowNumber}: 'materialTitle' wajib diisi.`);
    } else {
      parsedMaterialTitle = String(rawMaterialTitle).trim();
    }

    // If individual fields are valid, check cross-row integrity
    if (
      parsedBabOrder !== null &&
      parsedBabTitle !== null &&
      parsedMaterialOrder !== null &&
      parsedMaterialTitle !== null
    ) {
      // Conflicting title check for the same babOrder
      const existingTitle = babTitleByOrder.get(parsedBabOrder);
      if (existingTitle !== undefined && existingTitle !== parsedBabTitle) {
        errors.push(
          `Baris ${rowNumber}: Bab dengan urutan ${parsedBabOrder} memiliki judul yang bertentangan: '${existingTitle}' vs '${parsedBabTitle}'. Satu babOrder hanya boleh memiliki satu babTitle.`
        );
      } else if (existingTitle === undefined) {
        babTitleByOrder.set(parsedBabOrder, parsedBabTitle);
      }

      // Duplicate combination check (babOrder + materialOrder)
      const comboKey = `${parsedBabOrder}:${parsedMaterialOrder}`;
      if (seenBabMaterialCombo.has(comboKey)) {
        errors.push(
          `Baris ${rowNumber}: Duplikasi urutan materi pada Bab ${parsedBabOrder} ('materialOrder': ${parsedMaterialOrder}). Kombinasi babOrder dan materialOrder harus unik.`
        );
      } else {
        seenBabMaterialCombo.add(comboKey);
      }

      // Add to accumulator
      if (!babsMap.has(parsedBabOrder)) {
        babsMap.set(parsedBabOrder, {
          babOrder: parsedBabOrder,
          babTitle: parsedBabTitle,
          materials: [],
        });
      }
      babsMap.get(parsedBabOrder)!.materials.push({
        materialOrder: parsedMaterialOrder,
        materialTitle: parsedMaterialTitle,
      });
    }
  }

  // Fail-closed: Any error means NO partial result
  if (errors.length > 0) {
    return {
      success: false,
      mode: 'FULL_STRUCTURE',
      errors,
    };
  }

  // Sort Babs ascending by babOrder
  const sortedBabOrders = Array.from(babsMap.keys()).sort((a, b) => a - b);
  const units: ATPUnitMapping[] = [];
  let totalMaterials = 0;
  const now = Date.now();

  for (let bIdx = 0; bIdx < sortedBabOrders.length; bIdx++) {
    const babOrder = sortedBabOrders[bIdx];
    const babData = babsMap.get(babOrder)!;

    // Sort materials within Bab ascending by materialOrder
    const sortedMaterials = [...babData.materials].sort(
      (a, b) => a.materialOrder - b.materialOrder
    );

    const unitId = `unit-import-${now}-${bIdx + 1}-${Math.random().toString(36).substring(2, 7)}`;

    const materials: ATPUnitMaterial[] = sortedMaterials.map((m, mIdx) => {
      totalMaterials++;
      return {
        id: `mat-import-${now}-${bIdx + 1}-${mIdx + 1}-${Math.random().toString(36).substring(2, 7)}`,
        title: m.materialTitle,
        order: m.materialOrder,
        // STRICT CONTRACT: Lineage must be strictly empty
        linkedAtpItemIds: [],
        linkedTpIds: [],
      };
    });

    units.push({
      id: unitId,
      title: babData.babTitle,
      order: babData.babOrder,
      // STRICT CONTRACT: Lineage must be strictly empty
      linkedAtpItemIds: [],
      linkedTpIds: [],
      materials,
    });
  }

  return {
    success: true,
    mode: 'FULL_STRUCTURE',
    units,
    stats: {
      totalBabs: units.length,
      totalMaterials,
    },
  };
}

/**
 * Validates and updates ONLY the Bab titles of saved/current units matching babOrder.
 * Does NOT alter material scope, unit IDs, order, material IDs, TP/ATP, JP, or canonical lineage.
 */
export function validateAndUpdateBabTitlesOnly(
  rows: RawBabMateriRow[],
  currentUnits?: ATPUnitMapping[]
): ATPUnitMappingImportResult {
  if (!currentUnits || currentUnits.length === 0) {
    return {
      success: false,
      mode: 'UPDATE_BAB_TITLES_ONLY',
      errors: ['Tidak ada Bab tersimpan dalam draf untuk diperbarui nama judulnya. Buat atau impor Bab terlebih dahulu.'],
    };
  }

  if (!rows || rows.length === 0) {
    return {
      success: false,
      mode: 'UPDATE_BAB_TITLES_ONLY',
      errors: ['File atau sheet tidak memiliki baris data untuk diimpor.'],
    };
  }

  const errors: string[] = [];
  const babTitleByOrder = new Map<number, string>();

  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx];
    const rowNumber = idx + 2; // Assuming row 1 was header in Excel

    const { rawBabOrder, rawBabTitle } = extractRowValues(row);

    // Validate babOrder: must be positive integer
    let parsedBabOrder: number | null = null;
    if (rawBabOrder === undefined || rawBabOrder === null || String(rawBabOrder).trim() === '') {
      errors.push(`Baris ${rowNumber}: 'babOrder' wajib diisi.`);
    } else {
      const num = typeof rawBabOrder === 'number' ? rawBabOrder : Number(String(rawBabOrder).trim());
      if (!Number.isInteger(num) || num <= 0) {
        errors.push(
          `Baris ${rowNumber}: 'babOrder' harus berupa bilangan bulat positif (diterima: ${String(rawBabOrder)}).`
        );
      } else {
        parsedBabOrder = num;
      }
    }

    // Validate babTitle: non-empty string
    let parsedBabTitle: string | null = null;
    if (rawBabTitle === undefined || rawBabTitle === null || String(rawBabTitle).trim() === '') {
      errors.push(`Baris ${rowNumber}: 'babTitle' wajib diisi.`);
    } else {
      parsedBabTitle = String(rawBabTitle).trim();
    }

    if (parsedBabOrder !== null && parsedBabTitle !== null) {
      const existingTitle = babTitleByOrder.get(parsedBabOrder);
      if (existingTitle !== undefined && existingTitle !== parsedBabTitle) {
        errors.push(
          `Baris ${rowNumber}: Bab dengan urutan ${parsedBabOrder} memiliki judul yang bertentangan: '${existingTitle}' vs '${parsedBabTitle}'. Satu babOrder hanya boleh memiliki satu babTitle.`
        );
      } else if (existingTitle === undefined) {
        babTitleByOrder.set(parsedBabOrder, parsedBabTitle);
      }
    }
  }

  if (errors.length > 0) {
    return {
      success: false,
      mode: 'UPDATE_BAB_TITLES_ONLY',
      errors,
    };
  }

  const sortedCurrentUnits = [...currentUnits].sort((a, b) => a.order - b.order);
  const currentBabOrders = sortedCurrentUnits.map((u) => u.order);
  const excelBabOrders = Array.from(babTitleByOrder.keys()).sort((a, b) => a - b);

  if (excelBabOrders.length !== sortedCurrentUnits.length) {
    errors.push(
      `Diagnosis: Jumlah Bab dalam file Excel (${excelBabOrders.length}) tidak cocok dengan jumlah Bab tersimpan (${sortedCurrentUnits.length}). Mode 'Perbarui Nama Bab Saja' mengharuskan jumlah Bab sama persis.`
    );
  } else {
    for (let i = 0; i < excelBabOrders.length; i++) {
      if (excelBabOrders[i] !== currentBabOrders[i]) {
        errors.push(
          `Diagnosis: Urutan Bab dalam file Excel ([${excelBabOrders.join(', ')}]) tidak cocok dengan urutan Bab tersimpan ([${currentBabOrders.join(', ')}]).`
        );
        break;
      }
    }
  }

  if (errors.length > 0) {
    return {
      success: false,
      mode: 'UPDATE_BAB_TITLES_ONLY',
      errors,
    };
  }

  const titleChanges: BabTitleChangePreview[] = [];
  let titleChangesCount = 0;
  let totalMaterialsCount = 0;

  const updatedUnits: ATPUnitMapping[] = sortedCurrentUnits.map((unit) => {
    const newTitle = babTitleByOrder.get(unit.order)!;
    if (unit.title !== newTitle) {
      titleChangesCount++;
    }
    titleChanges.push({
      babOrder: unit.order,
      oldTitle: unit.title,
      newTitle,
    });
    totalMaterialsCount += unit.materials?.length || 0;

    return {
      ...unit,
      title: newTitle,
      materials: (unit.materials || []).map((m) => ({
        ...m,
        linkedAtpItemIds: [...(m.linkedAtpItemIds || [])],
        linkedTpIds: [...(m.linkedTpIds || [])],
      })),
      linkedAtpItemIds: [...(unit.linkedAtpItemIds || [])],
      linkedTpIds: [...(unit.linkedTpIds || [])],
    };
  });

  return {
    success: true,
    mode: 'UPDATE_BAB_TITLES_ONLY',
    units: updatedUnits,
    titleChanges,
    stats: {
      totalBabs: updatedUnits.length,
      totalMaterials: totalMaterialsCount,
      titleChangesCount,
    },
  };
}

/**
 * Parses raw ArrayBuffer or Uint8Array of XLSX file containing the 'BAB_MATERI' sheet.
 * Supports mode 'FULL_STRUCTURE' (default) or 'UPDATE_BAB_TITLES_ONLY'.
 */
export function parseBabMateriXlsx(
  data: ArrayBuffer | Uint8Array,
  mode: ATPUnitMappingImportMode = 'FULL_STRUCTURE',
  currentUnits?: ATPUnitMapping[]
): ATPUnitMappingImportResult {
  try {
    const workbook = XLSX.read(data, {
      type: 'array',
      cellDates: false,
      raw: false,
    });

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      return {
        success: false,
        mode,
        errors: ['File XLSX tidak memiliki sheet.'],
      };
    }

    // Find sheet BAB_MATERI (case-insensitive / whitespace trimmed)
    const targetSheetName = workbook.SheetNames.find(
      (name) => name.trim().toUpperCase() === 'BAB_MATERI'
    );

    if (!targetSheetName) {
      return {
        success: false,
        mode,
        errors: [
          `Sheet 'BAB_MATERI' tidak ditemukan dalam file XLSX. Sheet yang tersedia: ${workbook.SheetNames.join(', ')}. Pastikan sheet diberi nama 'BAB_MATERI'.`,
        ],
      };
    }

    const worksheet = workbook.Sheets[targetSheetName];
    if (!worksheet) {
      return {
        success: false,
        mode,
        errors: [`Sheet '${targetSheetName}' tidak dapat dibaca atau kosong.`],
      };
    }

    const rawRows = XLSX.utils.sheet_to_json<RawBabMateriRow>(worksheet, {
      defval: null,
      blankrows: false,
    });

    if (!rawRows || rawRows.length === 0) {
      return {
        success: false,
        mode,
        errors: [`Sheet '${targetSheetName}' tidak memiliki baris data.`],
      };
    }

    if (mode === 'UPDATE_BAB_TITLES_ONLY') {
      return validateAndUpdateBabTitlesOnly(rawRows, currentUnits);
    }

    return validateAndBuildATPUnitMappings(rawRows);
  } catch (err: any) {
    return {
      success: false,
      mode,
      errors: [err?.message || 'Terjadi kesalahan saat membaca file XLSX.'],
    };
  }
}

/**
 * Creates client-side Excel workbook for Bab & Materi template.
 */
export function createBabMateriTemplateWorkbook(): XLSX.WorkBook {
  const templateData = [
    {
      babOrder: 1,
      babTitle: 'Bab 1: Judul Bab',
      materialOrder: 1,
      materialTitle: 'Lingkup Materi 1',
    },
    {
      babOrder: 1,
      babTitle: 'Bab 1: Judul Bab',
      materialOrder: 2,
      materialTitle: 'Lingkup Materi 2',
    },
    {
      babOrder: 2,
      babTitle: 'Bab 2: Judul Bab',
      materialOrder: 1,
      materialTitle: 'Lingkup Materi 1',
    },
  ];

  const worksheet = XLSX.utils.json_to_sheet(templateData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'BAB_MATERI');

  worksheet['!cols'] = [
    { wch: 10 },
    { wch: 30 },
    { wch: 15 },
    { wch: 35 },
  ];

  return workbook;
}

/**
 * Downloads a client-side Excel template for Bab & Materi.
 */
export function downloadBabMateriTemplateXlsx(): void {
  const workbook = createBabMateriTemplateWorkbook();
  XLSX.writeFile(workbook, 'Template_Bab_Materi.xlsx');
}

