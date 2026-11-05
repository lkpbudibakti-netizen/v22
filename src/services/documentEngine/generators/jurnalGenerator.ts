import { buildJurnalProjection, JURNAL_COLUMNS, JURNAL_WIDTHS, jurnalTableRows } from '../jurnalProjection';
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
  createDocxSectionProperties,
} from '../docxStyles';

export async function generateJurnal(context: DocumentGenerationContext): Promise<GeneratedDocumentResult> {
  const { school, profile, academicSetting } = context;
  const projection = buildJurnalProjection(context);
  if (!projection.isReady) throw new Error(projection.reasons.join("; ") + " Gunakan format kosong.");
  const isBlankMode = context.documentMode === 'blank';

  const docChildren: (Paragraph | Table)[] = [];

  // 1. Header
  const headerTitle = isBlankMode
    ? 'JURNAL HARIAN PEMBELAJARAN (FORMAT KOSONG)'
    : 'JURNAL HARIAN PEMBELAJARAN';
  docChildren.push(
    ...createDocumentHeader(
      headerTitle,
      `${academicSetting.curriculum || '-'} — ${academicSetting.subject || '-'} ${academicSetting.grade || '-'} TP ${academicSetting.academicYear || '-'}`
    )
  );

  // 2. Identity Metadata
  docChildren.push(
    createIdentityMetadataTable(school, profile, academicSetting, [
      ['Semester', `: ${academicSetting.semester || '-'}`],
      ['Total Murid', isBlankMode ? ': .......... Siswa' : `: ${context.students?.length || 0} Siswa`],
    ])
  );
  docChildren.push(new Paragraph({ spacing: { after: 180 } }));

  // 3. Jurnal Table Matrix
  docChildren.push(
    createSectionHeading('Matriks Catatan Jurnal Mengajar & Refleksi Pembelajaran', 1)
  );

  const tableHeaderRow = new TableRow({
    tableHeader: true,
    children: JURNAL_COLUMNS.map((label, index) => createTableHeaderCell(label, JURNAL_WIDTHS[index])),
  });
  const dataRows = jurnalTableRows(projection, isBlankMode).map(cells => new TableRow({
    cantSplit: false,
    children: cells.map((value, index) => createTableDataCell(value, JURNAL_WIDTHS[index], index === 0 ? AlignmentType.CENTER : AlignmentType.LEFT)),
  }));

  const jurnalTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [tableHeaderRow, ...dataRows],
    layout: TableLayoutType.FIXED,
  });

  docChildren.push(jurnalTable);

  // 4. Signoff Block
  docChildren.push(...createSignoffBlock(school, profile, isBlankMode, context.documentDate));

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
  const fileName = isBlankMode
    ? `[Format_Kosong]_Jurnal_Mengajar_${cleanSubject}_${cleanGrade}.docx`
    : `JURNAL_MENGAJAR_${cleanSubject}_${cleanGrade}_${new Date().toISOString().slice(0, 10)}.docx`;

  if (!context.skipDownload) {
    saveAs(blob, fileName);
  }

  return {
    success: true,
    type: 'JURNAL',
    title: isBlankMode ? 'Jurnal Harian Pembelajaran (Format Kosong)' : 'Jurnal Harian Pembelajaran',
    fileName,
    blob,
    record: {
      id: `doc-jurnal-${Date.now()}`,
      type: 'JURNAL',
      title: isBlankMode ? 'Jurnal Harian Pembelajaran (Format Kosong)' : 'Jurnal Harian Pembelajaran',
      status: 'completed',
      lastGenerated: new Date().toISOString(),
      fileName,
      academicSettingId: academicSetting.id,
      workspaceId: context.workspace?.id,
    },
  };
}
