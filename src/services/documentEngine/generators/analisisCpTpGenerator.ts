import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableRow,
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
  createProseParagraph,
  createDocxSectionProperties,
} from '../docxStyles';

export async function generateAnalisisCpTp(
  context: DocumentGenerationContext
): Promise<GeneratedDocumentResult> {
  const { school, profile, academicSetting, cp, tp } = context;

  const docChildren: (Paragraph | Table)[] = [];

  // 1. Header Judul Resmi
  docChildren.push(
    ...createDocumentHeader(
      'ANALISIS CAPAIAN PEMBELAJARAN (CP) MENJADI TUJUAN PEMBELAJARAN (TP)',
      academicSetting.curriculum || '-'
    )
  );

  // 2. Metadata Tabel Identitas
  docChildren.push(createIdentityMetadataTable(school, profile, academicSetting));
  docChildren.push(new Paragraph({ spacing: { after: 180 } }));

  // 3. Dasar Rasionalisasi & Rujukan
  docChildren.push(
    createSectionHeading('A. Landasan dan Prinsip Analisis CP → TP', 1),
    createProseParagraph(
      'Berdasarkan Panduan Pembelajaran dan Asesmen Edisi Revisi 2025 serta Panduan Pengembangan Kurikulum Satuan Pendidikan Edisi Revisi 2025 (BSKAP Kemendikdasmen), proses penurunan Capaian Pembelajaran (CP) menjadi Tujuan Pembelajaran (TP) dilakukan melalui identifikasi kompetensi (keterampilan/kemampuan berpikir) dan lingkup materi esensial (konten inti). Hasil analisis ini menjadi rujukan resmi penyusunan Alur Tujuan Pembelajaran (ATP), Modul Ajar, dan instrumen asesmen kelas.'
    )
  );

  // 4. Deskripsi CP Rujukan
  const generalCpDesc = cp?.generalDescription?.trim()
    ? cp.generalDescription.trim()
    : (cp?.elements && cp.elements.length > 0)
    ? 'Capaian Pembelajaran pada fase ini dirinci melalui elemen-elemen berikut.'
    : '';

  if (generalCpDesc) {
    docChildren.push(
      createSectionHeading('B. Capaian Pembelajaran (CP) Fase & Mata Pelajaran', 1),
      createProseParagraph(generalCpDesc, { italics: true })
    );
  }

  // 5. Matriks Analisis CP -> TP
  docChildren.push(
    createSectionHeading('C. Matriks Pemetaan Analisis CP ke Tujuan Pembelajaran (TP)', 1)
  );

  // Table Headers
  const tableHeaderRow = new TableRow({
    tableHeader: true,
    children: [
      createTableHeaderCell('No', 5, AlignmentType.CENTER),
      createTableHeaderCell('Elemen CP', 16, AlignmentType.CENTER),
      createTableHeaderCell('Kalimat Capaian Pembelajaran', 25, AlignmentType.CENTER),
      createTableHeaderCell('Analisis Kompetensi (KKO)', 16, AlignmentType.CENTER),
      createTableHeaderCell('Analisis Lingkup Materi (Konten)', 16, AlignmentType.CENTER),
      createTableHeaderCell('Rumusan Tujuan Pembelajaran (TP)', 22, AlignmentType.CENTER),
    ],
  });

  const tableDataRows: TableRow[] = [];
  const cpElements = cp?.elements || [];
  const tpItems = tp?.items || [];
  const isBlankMode = context.documentMode === 'blank';

  let rowIndex = 1;

  if (isBlankMode) {
    for (let i = 1; i <= 10; i++) {
      tableDataRows.push(
        new TableRow({
          children: [
            createTableDataCell(String(i), 5, AlignmentType.CENTER),
            createTableDataCell('....................', 16),
            createTableDataCell('........................................', 25),
            createTableDataCell('....................', 16),
            createTableDataCell('....................', 16),
            createTableDataCell('........................................', 22),
          ],
        })
      );
    }
  } else if (cpElements.length > 0) {
    cpElements.forEach((elem) => {
      // Find TP items that relate to this element
      const matchingTPs = tpItems.filter(
        (t) =>
          (t.elementName && t.elementName.toLowerCase().trim() === elem.name.toLowerCase().trim()) ||
          (t.statement && t.statement.toLowerCase().includes(elem.name.toLowerCase()))
      );

      if (matchingTPs.length > 0) {
        matchingTPs.forEach((matchedTP, tpIdx) => {
          const isFirstInElem = tpIdx === 0;
          const p3Tag =
            matchedTP.p3Dimensions && matchedTP.p3Dimensions.length > 0
              ? `\n[P3: ${matchedTP.p3Dimensions.join(', ')}]`
              : '';

          tableDataRows.push(
            new TableRow({
              children: [
                createTableDataCell(String(rowIndex++), 5, AlignmentType.CENTER),
                createTableDataCell(isFirstInElem ? elem.name : `↳ (${elem.name})`, 16, AlignmentType.LEFT, isFirstInElem),
                createTableDataCell(isFirstInElem ? elem.content : '— s.d.a —', 25, AlignmentType.LEFT),
                createTableDataCell(matchedTP.competence || '-', 16, AlignmentType.LEFT),
                createTableDataCell(matchedTP.contentScope || '-', 16, AlignmentType.LEFT),
                createTableDataCell(
                  `${matchedTP.code ? `[${matchedTP.code}] ` : ''}${matchedTP.statement}${p3Tag}`,
                  22,
                  AlignmentType.LEFT
                ),
              ],
            })
          );
        });
      } else {
        // Element without formulated TPs yet
        tableDataRows.push(
          new TableRow({
            children: [
              createTableDataCell(String(rowIndex++), 5, AlignmentType.CENTER),
              createTableDataCell(elem.name, 16, AlignmentType.LEFT, true),
              createTableDataCell(elem.content, 25, AlignmentType.LEFT),
              createTableDataCell('-', 16, AlignmentType.CENTER),
              createTableDataCell('-', 16, AlignmentType.CENTER),
              createTableDataCell('-', 22, AlignmentType.CENTER),
            ],
          })
        );
      }
    });
  } else if (tpItems.length > 0) {
    // If no elements, map all TP items directly
    tpItems.forEach((item) => {
      const p3Tag =
        item.p3Dimensions && item.p3Dimensions.length > 0
          ? `\n[P3: ${item.p3Dimensions.join(', ')}]`
          : '';

      tableDataRows.push(
        new TableRow({
          children: [
            createTableDataCell(String(rowIndex++), 5, AlignmentType.CENTER),
            createTableDataCell(item.elementName || '-', 16, AlignmentType.LEFT),
            createTableDataCell(cp?.generalDescription || '-', 25, AlignmentType.LEFT),
            createTableDataCell(item.competence || '-', 16, AlignmentType.LEFT),
            createTableDataCell(item.contentScope || '-', 16, AlignmentType.LEFT),
            createTableDataCell(
              `${item.code ? `[${item.code}] ` : ''}${item.statement}${p3Tag}`,
              22,
              AlignmentType.LEFT
            ),
          ],
        })
      );
    });
  } else {
    tableDataRows.push(
      new TableRow({
        children: [
          createTableDataCell('1', 5, AlignmentType.CENTER),
          createTableDataCell('-', 16, AlignmentType.CENTER),
          createTableDataCell(cp?.generalDescription || '-', 25, AlignmentType.LEFT),
          createTableDataCell('-', 16, AlignmentType.CENTER),
          createTableDataCell('-', 16, AlignmentType.CENTER),
          createTableDataCell('-', 22, AlignmentType.CENTER),
        ],
      })
    );
  }

  const analysisTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [tableHeaderRow, ...tableDataRows],
  });

  docChildren.push(analysisTable);

  // 6. Catatan Telaah & Integrasi P3
  docChildren.push(
    createProseParagraph(
      'Catatan: Rumusan Tujuan Pembelajaran (TP) di atas memadukan aspek kompetensi, kedalaman materi kontekstual, dan penguatan Dimensi Profil Lulusan yang dapat disesuaikan dengan karakteristik murid dan daya dukung satuan pendidikan.',
      { firstLineIndent: false, italics: true }
    )
  );

  // 7. Lembar Pengesahan
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
  const fileName = `Analisis_CP_TP_${cleanSubject}_${cleanGrade}_${new Date().toISOString().slice(0, 10)}.docx`;

  if (!context.skipDownload) {
    saveAs(blob, fileName);
  }

  return {
    success: true,
    type: 'ANALISIS_CP_TP',
    title: 'Analisis Capaian Pembelajaran → Tujuan Pembelajaran',
    fileName,
    blob,
    record: {
      id: `doc-analisis-cp-tp-${Date.now()}`,
      type: 'ANALISIS_CP_TP',
      title: 'Analisis Capaian Pembelajaran → Tujuan Pembelajaran',
      status: 'completed',
      lastGenerated: new Date().toISOString(),
      fileName,
      academicSettingId: academicSetting.id,
      workspaceId: context.workspace?.id,
      sourceUpdatedAt: cp?.updatedAt || new Date().toISOString(),
      generatedAt: new Date().toISOString(),
      generatedFrom: `CP (${cp?.id || 'default'}) & TP (${tp?.id || 'default'})`,
    },
  };
}
