import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  AlignmentType,
  WidthType,
} from 'docx';
import saveAs from 'file-saver';
import { DocumentGenerationContext, GeneratedDocumentResult } from '../types';
import {
  createDocumentHeader,
  createIdentityMetadataTable,
  createTableHeaderCell,
  createTableDataCell,
  createSignoffBlock,
  createSectionHeading,
  createDocxSectionProperties,
  DOCX_FONT,
} from '../docxStyles';
import { ATPItem, TimeAllocation } from '../../../types';

/**
 * Resolves active TimeAllocation by exact ATPItem id:
 * - allocation.atpItemId === ATPItem.id
 *   or
 *   allocation.sourceId === ATPItem.id with sourceType ATP_ITEM / compatible empty legacy sourceType.
 * - Ignores ASSESSMENT and RESERVE allocations.
 * - Does NOT use ATPItem.jp or ATPItem.allocatedJP as JP authority.
 */
function resolveAllocationForAtpItem(
  atpItem: ATPItem,
  timeAllocations?: TimeAllocation[]
): { weekStr: string; jpStr: string; jpNumber: number } {
  if (!timeAllocations || timeAllocations.length === 0) {
    return { weekStr: '-', jpStr: '-', jpNumber: 0 };
  }

  const matching = timeAllocations.filter((ta) => {
    if (ta.sourceType === 'ASSESSMENT' || ta.sourceType === 'RESERVE') {
      return false;
    }
    const isExact = ta.atpItemId === atpItem.id || ta.sourceId === atpItem.id;
    if (!isExact) return false;
    if (!ta.sourceType || ta.sourceType === 'ATP_ITEM') {
      return true;
    }
    return false;
  });

  if (matching.length === 0) {
    return { weekStr: '-', jpStr: '-', jpNumber: 0 };
  }

  let totalJp = 0;
  let hasValidJp = false;
  for (const ta of matching) {
    const val =
      typeof ta.allocatedJP === 'number' && ta.allocatedJP > 0
        ? ta.allocatedJP
        : typeof ta.jp === 'number' && ta.jp > 0
        ? ta.jp
        : null;
    if (val !== null) {
      totalJp += val;
      hasValidJp = true;
    }
  }

  const weekTokens: string[] = [];
  for (const ta of matching) {
    if (typeof ta.weekNumber === 'number' && ta.weekNumber > 0) {
      weekTokens.push(`Minggu ${ta.weekNumber}`);
    } else if (
      typeof (ta as any).startWeek === 'number' &&
      (ta as any).startWeek > 0
    ) {
      const sw = (ta as any).startWeek;
      const ew = (ta as any).endWeek;
      if (typeof ew === 'number' && ew > sw) {
        weekTokens.push(`Minggu ${sw}–${ew}`);
      } else {
        weekTokens.push(`Minggu ${sw}`);
      }
    }
  }

  const weekStr =
    weekTokens.length > 0 ? Array.from(new Set(weekTokens)).join(', ') : '-';
  const jpStr = hasValidJp ? `${totalJp} JP` : '-';

  return { weekStr, jpStr, jpNumber: totalJp };
}

interface UnitGroup {
  unitTitle: string;
  items: ATPItem[];
}

export async function generatePemetaanAtpUnit(
  context: DocumentGenerationContext
): Promise<GeneratedDocumentResult> {
  const { school, profile, academicSetting, atp, tp } = context;
  const isBlankMode = context.documentMode === 'blank';

  const docChildren: (Paragraph | Table)[] = [];

  // 1. Header Judul Dokumen
  docChildren.push(
    ...createDocumentHeader(
      'PEMETAAN ATP, UNIT/BAB, DAN LINGKUP MATERI',
      academicSetting.curriculum || 'Kurikulum Merdeka'
    )
  );

  // 2. Metadata Tabel Identitas
  docChildren.push(
    createIdentityMetadataTable(school, profile, academicSetting, [], {
      scope: 'YEAR',
    })
  );
  docChildren.push(new Paragraph({ spacing: { after: 180 } }));

  // 3. Judul Bagian Tabel
  docChildren.push(
    createSectionHeading(
      'Matriks Pemetaan Alur Tujuan Pembelajaran berdasarkan Unit / Bab',
      1
    )
  );

  // 4. Header Kolom Tabel
  const tableHeaderRow = new TableRow({
    tableHeader: true,
    children: [
      createTableHeaderCell('Unit / Bab', 18, AlignmentType.LEFT),
      createTableHeaderCell('TP dalam ATP', 20, AlignmentType.LEFT),
      createTableHeaderCell('ATP Langkah', 14, AlignmentType.CENTER),
      createTableHeaderCell('Lingkup Materi', 26, AlignmentType.LEFT),
      createTableHeaderCell('Minggu', 12, AlignmentType.CENTER),
      createTableHeaderCell('JP', 10, AlignmentType.CENTER),
    ],
  });

  const tableDataRows: TableRow[] = [];
  let grandTotalJp = 0;
  let hasAnyAllocation = false;

  // Flatten available allocations from timeAllocations and protaSemesterAllocations
  const allAllocations: TimeAllocation[] = [
    ...(context.timeAllocations || []),
    ...(context.protaSemesterAllocations?.flatMap((b) => b.allocations || []) || []),
  ];
  const seenAllocIds = new Set<string>();
  const uniqueAllocations: TimeAllocation[] = [];
  for (const alloc of allAllocations) {
    if (alloc.id) {
      if (seenAllocIds.has(alloc.id)) continue;
      seenAllocIds.add(alloc.id);
    }
    uniqueAllocations.push(alloc);
  }

  const availableTps = tp?.items || [];

  if (isBlankMode) {
    // Blank Mode Placeholders
    for (let i = 1; i <= 3; i++) {
      tableDataRows.push(
        new TableRow({
          children: [
            createTableDataCell('', 18, AlignmentType.LEFT),
            createTableDataCell('', 20, AlignmentType.LEFT),
            createTableDataCell(`Langkah ${i}`, 14, AlignmentType.CENTER),
            createTableDataCell('', 26, AlignmentType.LEFT),
            createTableDataCell('', 12, AlignmentType.CENTER),
            createTableDataCell('', 10, AlignmentType.CENTER),
          ],
        })
      );
    }
  } else {
    // Canonical Data Mode
    // 1. Sort ATP items by stepNumber
    const sortedItems = [...(atp?.items || [])].sort(
      (a, b) => (a.stepNumber || 0) - (b.stepNumber || 0)
    );

    // 2. Group by unitTitle while preserving first appearance order
    const groups: UnitGroup[] = [];
    const groupMap = new Map<string, UnitGroup>();

    for (const item of sortedItems) {
      const titleKey =
        item.unitTitle && item.unitTitle.trim().length > 0
          ? item.unitTitle.trim()
          : 'Tanpa Unit / Bab';

      let grp = groupMap.get(titleKey);
      if (!grp) {
        grp = { unitTitle: titleKey, items: [] };
        groupMap.set(titleKey, grp);
        groups.push(grp);
      }
      grp.items.push(item);
    }

    // 3. Build rows for each group
    for (const group of groups) {
      // Build TP chain in ATP step order without duplicates within this group
      const seenCodesInGroup = new Set<string>();
      const orderedTpCodes: string[] = [];

      for (const item of group.items) {
        const resolvedTp =
          availableTps.find((t) => t.id === item.tpId) ||
          availableTps.find(
            (t) =>
              t.code &&
              item.tpCode &&
              t.code.toUpperCase().trim() === item.tpCode.toUpperCase().trim()
          );

        const code = resolvedTp?.code || item.tpCode || '-';
        if (!seenCodesInGroup.has(code)) {
          seenCodesInGroup.add(code);
          orderedTpCodes.push(code);
        }
      }

      const tpChainStr =
        orderedTpCodes.length > 0 ? orderedTpCodes.join(' → ') : '-';

      // Create row for each ATP item in this group
      group.items.forEach((item, itemIdx) => {
        const isFirstInGroup = itemIdx === 0;
        const resolvedTp =
          availableTps.find((t) => t.id === item.tpId) ||
          availableTps.find(
            (t) =>
              t.code &&
              item.tpCode &&
              t.code.toUpperCase().trim() === item.tpCode.toUpperCase().trim()
          );

        const alloc = resolveAllocationForAtpItem(item, uniqueAllocations);
        if (alloc.jpNumber > 0) {
          grandTotalJp += alloc.jpNumber;
          hasAnyAllocation = true;
        }

        const materialText =
          item.materialScope || resolvedTp?.contentScope || '-';

        tableDataRows.push(
          new TableRow({
            children: [
              createTableDataCell(
                isFirstInGroup ? group.unitTitle : '',
                18,
                AlignmentType.LEFT,
                isFirstInGroup
              ),
              createTableDataCell(
                isFirstInGroup ? tpChainStr : '',
                20,
                AlignmentType.LEFT
              ),
              createTableDataCell(
                `Langkah ${item.stepNumber || itemIdx + 1}`,
                14,
                AlignmentType.CENTER
              ),
              createTableDataCell(materialText, 26, AlignmentType.LEFT),
              createTableDataCell(alloc.weekStr, 12, AlignmentType.CENTER),
              createTableDataCell(alloc.jpStr, 10, AlignmentType.CENTER),
            ],
          })
        );
      });
    }
  }

  // 5. Total Row
  const totalRow = new TableRow({
    children: [
      new TableCell({
        columnSpan: 5,
        margins: { top: 120, bottom: 120, left: 140, right: 140 },
        children: [
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({
                text: 'Total Alokasi Waktu (JP):',
                bold: true,
                size: 19,
                font: DOCX_FONT,
              }),
            ],
          }),
        ],
      }),
      new TableCell({
        margins: { top: 120, bottom: 120, left: 140, right: 140 },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: hasAnyAllocation ? `${grandTotalJp} JP` : '-',
                bold: true,
                size: 19,
                font: DOCX_FONT,
              }),
            ],
          }),
        ],
      }),
    ],
  });

  const matrixTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [tableHeaderRow, ...tableDataRows, totalRow],
  });

  docChildren.push(matrixTable);

  // 6. Tanda Tangan Resmi
  docChildren.push(
    ...createSignoffBlock(
      school,
      profile,
      context.documentMode === 'blank',
      context.documentDate
    )
  );

  // 7. Render Dokumen Landscape A4
  const doc = new Document({
    sections: [
      {
        properties: createDocxSectionProperties('landscape'),
        children: docChildren,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const cleanSubject = (academicSetting.subject || 'Mapel').replace(
    /[^a-zA-Z0-9]/g,
    '_'
  );
  const cleanGrade = (academicSetting.grade || 'Kelas').replace(
    /[^a-zA-Z0-9]/g,
    '_'
  );
  const fileName = `Pemetaan_ATP_Unit_${cleanSubject}_${cleanGrade}_${new Date()
    .toISOString()
    .slice(0, 10)}.docx`;

  if (!context.skipDownload) {
    saveAs(blob, fileName);
  }

  return {
    success: true,
    type: 'PEMETAAN_ATP_UNIT',
    title: 'Pemetaan ATP, Unit/Bab, dan Lingkup Materi',
    fileName,
    blob,
    record: {
      id: `doc-pemetaan-atp-unit-${Date.now()}`,
      type: 'PEMETAAN_ATP_UNIT',
      title: 'Pemetaan ATP, Unit/Bab, dan Lingkup Materi',
      status: 'completed',
      lastGenerated: new Date().toISOString(),
      fileName,
      academicSettingId: academicSetting.id,
      workspaceId: context.workspace?.id,
    },
  };
}
