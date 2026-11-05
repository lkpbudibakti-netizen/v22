import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableRow,
  AlignmentType,
  WidthType,
  TableLayoutType,
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
  createProseParagraph,
  createDocxSectionProperties,
} from '../docxStyles';
import { buildPromesPresentation } from '../promesPresentation';
import { buildPromesProjection } from '../promesProjection';

export async function generatePROMES(context: DocumentGenerationContext): Promise<GeneratedDocumentResult> {
  const { school, profile, academicSetting } = context;

  const projection = buildPromesProjection(context);

  if (context.documentMode !== 'blank' && !projection.isReady) {
    throw new Error(
      projection.unreadyReason ||
        'Program Semester belum dapat dibuat karena prasyarat semester aktif belum lengkap.'
    );
  }

  const docChildren: (Paragraph | Table)[] = [];

  const semesterLabel = projection.semester === '1' ? 'Semester 1 (Ganjil)' : 'Semester 2 (Genap)';
  const presentation = buildPromesPresentation(projection, context.documentMode === 'blank');

  // 1. Header
  docChildren.push(
    ...createDocumentHeader(
      'PROGRAM SEMESTER (PROMES)',
      `${academicSetting.curriculum} — ${semesterLabel.toUpperCase()} TP ${academicSetting.academicYear || '2026/2027'}`
    )
  );

  // 2. Identity Box
  const weeklyJpText =
    projection.actualScheduledWeeklyJP !== null
      ? `${projection.actualScheduledWeeklyJP} JP / Minggu`
      : '-';

  const weeksText =
    projection.effectiveWeeksEquivalent !== null
      ? `${projection.effectiveWeeksEquivalent} Minggu (${projection.effectiveLearningDays || 0} Hari Efektif)`
      : '-';

  const availableJpText =
    projection.availableJP !== null ? `${projection.availableJP} JP` : '-';

  docChildren.push(
    createIdentityMetadataTable(school, profile, academicSetting, [
      ['Alokasi Intrakurikuler per Minggu', `: ${weeklyJpText}`],
      ['Minggu Efektif Semester', `: ${weeksText}`],
      ['Alokasi JP Semester', `: ${availableJpText}`],
    ])
  );
  docChildren.push(new Paragraph({ spacing: { after: 180 } }));

  // 3. Matrix Table
  docChildren.push(
    createSectionHeading('Matriks Distribusi Alokasi Waktu Pembelajaran Bulanan', 1)
  );

  const header = new TableRow({
    tableHeader: true,
    children: presentation.headers.map((title, index) => createTableHeaderCell(title, presentation.widths[index])),
  });
  const rows = [...presentation.rows, ...presentation.summaryRows].map((cells, rowIndex) => new TableRow({
    cantSplit: false,
    children: cells.map((text, index) => createTableDataCell(text, presentation.widths[index], presentation.alignments[index] === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT, rowIndex >= presentation.rows.length)),
  }));
  docChildren.push(new Table({
    layout: TableLayoutType.FIXED,
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [header, ...rows],
  }));
  docChildren.push(
    createSectionHeading('Status & Catatan Pelaksanaan', 2),
    createProseParagraph(presentation.notes, { firstLineIndent: false, italics: true })
  );

  // 4. Signoff Block
  docChildren.push(...createSignoffBlock(school, profile, context.documentMode === 'blank', context.documentDate));

  // Build Document (Landscape A4)
  const doc = new Document({
    sections: [
      {
        properties: createDocxSectionProperties('landscape'),
        children: docChildren,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const cleanSubject = (academicSetting.subject || 'Mapel').replace(/[^a-zA-Z0-9]/g, '_');
  const cleanGrade = (academicSetting.grade || 'Kelas').replace(/[^a-zA-Z0-9]/g, '_');
  const fileName = `PROMES_${cleanSubject}_${cleanGrade}_${new Date().toISOString().slice(0, 10)}.docx`;

  if (!context.skipDownload) {
    saveAs(blob, fileName);
  }

  return {
    success: true,
    type: 'PROMES',
    title: 'Program Semester (PROMES)',
    fileName,
    blob,
    record: {
      id: `doc-promes-${Date.now()}`,
      type: 'PROMES',
      title: 'Program Semester (PROMES)',
      status: 'completed',
      lastGenerated: new Date().toISOString(),
      fileName,
      academicSettingId: academicSetting.id,
      workspaceId: context.workspace?.id,
    },
  };
}
