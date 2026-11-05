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
  TableLayoutType,
} from 'docx';
import saveAs from 'file-saver';
import { DocumentGenerationContext, GeneratedDocumentResult } from '../types';
import { ATP_DOCUMENT_COLUMNS, buildATPDocumentProjection, getATPDocumentRowCells } from '../atpDocumentProjection';
import {
  createDocumentHeader,
  createIdentityMetadataTable,
  createTableHeaderCell,
  createSignoffBlock,
  createSectionHeading,
  createProseParagraph,
  createDocxSectionProperties,
  DOCX_FONT,
  DOCX_COLOR_BLACK,
} from '../docxStyles';

export async function generateATP(context: DocumentGenerationContext): Promise<GeneratedDocumentResult> {
  const { school, profile, academicSetting } = context;
  const projection = buildATPDocumentProjection(context);
  if (!projection.isReady) throw new Error(projection.error || 'ATP belum siap diekspor.');

  const docChildren: (Paragraph | Table)[] = [];

  // Header
  docChildren.push(...createDocumentHeader('ALUR TUJUAN PEMBELAJARAN (ATP)', academicSetting.curriculum));

  // Metadata Table
  docChildren.push(createIdentityMetadataTable(school, profile, academicSetting, [], { scope: 'YEAR' }));
  docChildren.push(new Paragraph({ spacing: { after: 180 } }));

  // Rasionalisasi Alur Pembelajaran
  if (projection.rationale) {
    docChildren.push(
      createSectionHeading('A. Rasionalisasi Alur Pembelajaran', 1),
      createProseParagraph(projection.rationale)
    );
  }

  // CP Ringkas
  if (projection.cpReferenceLines.length) {
    docChildren.push(
      createSectionHeading('B. Capaian Pembelajaran Rujukan', 1),
      createProseParagraph(projection.cpReferenceLines.join('\n'), { italics: true })
    );
  }

  // ATP Matrix Section Title
  docChildren.push(
    createSectionHeading('C. Matriks Alur Tujuan Pembelajaran', 1)
  );

  const widths = [12, 48, 40];
  const tableHeaderRow = new TableRow({
    tableHeader: true,
    children: ATP_DOCUMENT_COLUMNS.map((title, index) => createTableHeaderCell(title, widths[index], AlignmentType.CENTER)),
  });
  const createProjectionCell = (lines: string[], width: number, isCenter = false, emphasizeFirst = false) => new TableCell({
    width: { size: width, type: WidthType.PERCENTAGE },
    margins: { top: 100, bottom: 100, left: 120, right: 120 },
    children: lines.map((text, index) => new Paragraph({
      alignment: isCenter ? AlignmentType.CENTER : AlignmentType.LEFT,
      spacing: { line: 240, after: 50 },
      children: [new TextRun({ text, bold: emphasizeFirst && index === 0, size: 20, font: DOCX_FONT, color: DOCX_COLOR_BLACK })],
    })),
  });
  const tableDataRows = projection.rows.map(row => new TableRow({
    cantSplit: true,
    children: getATPDocumentRowCells(row).map((lines, index) => createProjectionCell(lines, widths[index], index === 0, index === 2)),
  }));
  const atpTable = new Table({
    layout: TableLayoutType.FIXED,
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [tableHeaderRow, ...tableDataRows],
  });

  docChildren.push(atpTable);

  // Sign-off
  docChildren.push(...createSignoffBlock(school, profile, context.documentMode === 'blank', context.documentDate));

  // Build Document (Portrait A4)
  const doc = new Document({
    sections: [
      {
        properties: createDocxSectionProperties('portrait'),
        children: docChildren,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const cleanSubject = (academicSetting.subject || 'Mapel').replace(/[^a-zA-Z0-9]/g, '_');
  const cleanGrade = (academicSetting.grade || 'Kelas').replace(/[^a-zA-Z0-9]/g, '_');
  const fileName = `ATP_${cleanSubject}_${cleanGrade}_${new Date().toISOString().slice(0, 10)}.docx`;

  if (!context.skipDownload) {
    saveAs(blob, fileName);
  }

  return {
    success: true,
    type: 'ATP',
    title: 'Alur Tujuan Pembelajaran (ATP)',
    fileName,
    blob,
    record: {
      id: `doc-atp-${Date.now()}`,
      type: 'ATP',
      title: 'Alur Tujuan Pembelajaran (ATP)',
      status: 'completed',
      lastGenerated: new Date().toISOString(),
      fileName,
      academicSettingId: academicSetting.id,
      workspaceId: context.workspace?.id,
    },
  };
}
