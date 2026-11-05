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
import { getSubjectJP } from '../../jpEngine';
import { buildPromesProjection } from '../promesProjection';
import { formatAllocationStatusIndonesian } from '../promesPresentation';
import { buildK13AlokasiWaktuRows } from '../k13AlokasiWaktuHelper';
import { resolveMerdekaCanonicalTimeProjection } from '../meetingTimeProjection';

function formatDateIndonesian(dateStr: string): string {
  if (!dateStr) return '-';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const year = parts[0];
  const monthNum = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);
  const monthNames = [
    '',
    'Januari',
    'Februari',
    'Maret',
    'April',
    'Mei',
    'Juni',
    'Juli',
    'Agustus',
    'September',
    'Oktober',
    'November',
    'Desember',
  ];
  return `${day} ${monthNames[monthNum] || parts[1]} ${year}`;
}

export async function generateAlokasiWaktu(context: DocumentGenerationContext): Promise<GeneratedDocumentResult> {
  const { school, profile, academicSetting, calendar, timeAllocations, k13Analysis } = context;

  const docChildren: (Paragraph | Table)[] = [];

  const isK13Curriculum = academicSetting.curriculumType === 'K13' || academicSetting.curriculum === 'Kurikulum 2013';

  // Look up verified official rule
  const officialRule = getSubjectJP({
    curriculum: academicSetting.curriculum,
    level: academicSetting.level,
    grade: academicSetting.grade,
    subject: academicSetting.subject,
  });

  const activeSemesterNum =
    academicSetting?.semester?.includes('1') ||
    academicSetting?.semester?.toLowerCase().includes('ganjil')
      ? 1
      : 2;

  // Projection / Canonical setup for Kurikulum Merdeka
  const projection = buildPromesProjection(context);
  const merdekaCanonical = !isK13Curriculum ? resolveMerdekaCanonicalTimeProjection(context) : null;

  if (!isK13Curriculum && context.documentMode !== 'blank') {
    if (!merdekaCanonical?.isReady) {
      throw new Error(
        merdekaCanonical?.errors.length
          ? `Distribusi Alokasi Waktu belum dapat dibuat karena: ${merdekaCanonical.errors.join(' ')}`
          : 'Distribusi Alokasi Waktu belum dapat dibuat karena prasyarat semester aktif belum lengkap.'
      );
    }
  }

  const weeklyJP = isK13Curriculum
    ? (academicSetting.subjectWeeklyJP || calendar?.jpPerWeek || academicSetting.totalHoursPerWeek || officialRule.weeklyJP || null)
    : projection.actualScheduledWeeklyJP;

  // Resolved rows for K13
  const k13Rows = isK13Curriculum ? buildK13AlokasiWaktuRows(k13Analysis?.items || [], timeAllocations) : [];

  // Resolved rows for Merdeka (exact canonical meetings for active semester)
  const merdekaMeetings =
    !isK13Curriculum && merdekaCanonical?.rows
      ? merdekaCanonical.rows
          .filter((r) => r.semester === activeSemesterNum)
          .sort((a, b) => {
            if (a.date !== b.date) return a.date.localeCompare(b.date);
            if (a.unitOrder !== b.unitOrder) return a.unitOrder - b.unitOrder;
            return a.meetingOrder - b.meetingOrder;
          })
      : [];

  // Compute total planned JP
  let totalAllocatedJP = 0;
  if (isK13Curriculum) {
    totalAllocatedJP = k13Rows.reduce((sum, r) => sum + r.allocatedJP, 0);
  } else {
    totalAllocatedJP = merdekaMeetings.reduce((sum, m) => sum + m.jp, 0);
  }

  // Header
  docChildren.push(
    ...createDocumentHeader(
      'RINCIAN DISTRIBUSI ALOKASI WAKTU PEMBELAJARAN',
      `${academicSetting.curriculum} — TP ${academicSetting.academicYear || '-'}`
    )
  );

  // Metadata Table
  if (isK13Curriculum) {
    docChildren.push(
      createIdentityMetadataTable(school, profile, academicSetting, [
        ['Tahun Ajaran / Semester', `: ${academicSetting.academicYear || '-'} / ${academicSetting.semester || '-'}`],
        ['Beban JP Intrakurikuler per Minggu', `: ${weeklyJP !== null ? `${weeklyJP} JP / Minggu` : '-'}`],
        ['Total Alokasi Pembelajaran Terdata', `: ${totalAllocatedJP} Jam Pelajaran (JP)`],
        ['Dasar Regulasi Struktur', `: ${officialRule.regulation || 'Struktur Kustom Guru'}`],
      ])
    );
  } else {
    docChildren.push(
      createIdentityMetadataTable(school, profile, academicSetting, [
        ['Tahun Ajaran / Semester', `: ${academicSetting.academicYear || '-'} / ${academicSetting.semester || '-'}`],
        ['Beban JP Intrakurikuler per Minggu', `: ${weeklyJP !== null ? `${weeklyJP} JP / Minggu` : '-'}`],
        ['Alokasi JP Semester', `: ${projection.availableJP !== null ? `${projection.availableJP} Jam Pelajaran` : '-'}`],
        ['Total Alokasi Pembelajaran Terdata', `: ${totalAllocatedJP} Jam Pelajaran (JP)`],
        ['Selisih Alokasi JP', `: ${projection.remainingJP !== null ? `${projection.remainingJP} JP (${formatAllocationStatusIndonesian(projection.remainingJP)})` : '-'}`],
        ['Dasar Regulasi Struktur', `: ${officialRule.regulation || 'Struktur Kustom Guru'}`],
      ])
    );
  }
  docChildren.push(new Paragraph({ spacing: { after: 180 } }));

  // Section
  docChildren.push(
    createSectionHeading(
      isK13Curriculum
        ? 'A. Pemetaan Waktu Berdasarkan Analisis Kompetensi Dasar (KD)'
        : 'A. Pemetaan Waktu Berdasarkan Jadwal Aktual Pertemuan Pembelajaran',
      1
    )
  );

  const tableHeaderRow = isK13Curriculum
    ? new TableRow({
        tableHeader: true,
        children: [
          createTableHeaderCell('No', 8, AlignmentType.CENTER),
          createTableHeaderCell('Kompetensi Dasar (KD)', 16, AlignmentType.CENTER),
          createTableHeaderCell('Materi Pokok & Kegiatan Pembelajaran', 48, AlignmentType.LEFT),
          createTableHeaderCell('Alokasi JP', 14, AlignmentType.CENTER),
          createTableHeaderCell('Distribusi Pekan Ke-', 14, AlignmentType.CENTER),
        ],
      })
    : new TableRow({
        tableHeader: true,
        children: [
          createTableHeaderCell('No', 8, AlignmentType.CENTER),
          createTableHeaderCell('Unit/Bab / Pertemuan', 26, AlignmentType.CENTER),
          createTableHeaderCell('Materi Pembelajaran', 38, AlignmentType.LEFT),
          createTableHeaderCell('Alokasi JP', 14, AlignmentType.CENTER),
          createTableHeaderCell('Tanggal / Pekan', 14, AlignmentType.CENTER),
        ],
      });

  const rows: TableRow[] = [tableHeaderRow];

  if (isK13Curriculum) {
    if (k13Rows.length === 0) {
      rows.push(
        new TableRow({
          children: [
            createTableDataCell('1', 8, AlignmentType.CENTER),
            createTableDataCell('KD -', 16, AlignmentType.CENTER),
            createTableDataCell('Belum ada butir analisis KD yang disusun.', 48),
            createTableDataCell('-', 14, AlignmentType.CENTER),
            createTableDataCell('-', 14, AlignmentType.CENTER),
          ],
        })
      );
    } else {
      k13Rows.forEach((item, index) => {
        rows.push(
          new TableRow({
            children: [
              createTableDataCell((index + 1).toString(), 8, AlignmentType.CENTER),
              createTableDataCell(item.kdCode, 16, AlignmentType.LEFT, true),
              createTableDataCell(`${item.materi || '-'}${item.kegiatan ? `\n• Kegiatan: ${item.kegiatan}` : ''}`, 48),
              createTableDataCell(`${item.allocatedJP} JP`, 14, AlignmentType.CENTER, true),
              createTableDataCell(item.weekDisplay, 14, AlignmentType.CENTER),
            ],
          })
        );
      });
    }
  } else {
    if (merdekaMeetings.length === 0) {
      rows.push(
        new TableRow({
          children: [
            createTableDataCell('1', 8, AlignmentType.CENTER),
            createTableDataCell('Pertemuan -', 26, AlignmentType.CENTER),
            createTableDataCell('Belum ada jadwal aktual pertemuan yang disusun pada semester ini.', 38),
            createTableDataCell('-', 14, AlignmentType.CENTER),
            createTableDataCell('-', 14, AlignmentType.CENTER),
          ],
        })
      );
    } else {
      merdekaMeetings.forEach((item, index) => {
        const materialText =
          item.materials.map((m) => m.title).filter(Boolean).join(', ') || '-';
        const dateWeekText = `${formatDateIndonesian(item.date)} • Pekan ${item.weekIndex}`;

        rows.push(
          new TableRow({
            children: [
              createTableDataCell((index + 1).toString(), 8, AlignmentType.CENTER),
              createTableDataCell(`${item.unitTitle} — ${item.meetingTitle}`, 26, AlignmentType.LEFT, true),
              createTableDataCell(materialText, 38, AlignmentType.LEFT),
              createTableDataCell(`${item.jp} JP`, 14, AlignmentType.CENTER, true),
              createTableDataCell(dateWeekText, 14, AlignmentType.CENTER),
            ],
          })
        );
      });
    }
  }

  // Summary row
  const summaryRow = isK13Curriculum
    ? new TableRow({
        children: [
          createTableHeaderCell('', 8, AlignmentType.CENTER),
          createTableHeaderCell('TOTAL', 16, AlignmentType.CENTER),
          createTableHeaderCell('Total Alokasi Waktu Pembelajaran Terjadwal', 48, AlignmentType.LEFT),
          createTableHeaderCell(`${totalAllocatedJP} JP`, 14, AlignmentType.CENTER),
          createTableHeaderCell('-', 14, AlignmentType.CENTER),
        ],
      })
    : new TableRow({
        children: [
          createTableHeaderCell('', 8, AlignmentType.CENTER),
          createTableHeaderCell('TOTAL', 26, AlignmentType.CENTER),
          createTableHeaderCell('Total Alokasi Waktu Pembelajaran Terjadwal', 38, AlignmentType.LEFT),
          createTableHeaderCell(`${totalAllocatedJP} JP`, 14, AlignmentType.CENTER),
          createTableHeaderCell('-', 14, AlignmentType.CENTER),
        ],
      });

  rows.push(summaryRow);

  docChildren.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }));
  docChildren.push(new Paragraph({ spacing: { after: 240 } }));

  // Ringkasan Alokasi Waktu Pembelajaran Semester
  if (context.documentMode !== 'blank') {
    const statusDesc = formatAllocationStatusIndonesian(projection.remainingJP);
    const summaryLines = isK13Curriculum
      ? [
          `• Beban JP Intrakurikuler per Minggu: ${weeklyJP !== null ? `${weeklyJP} JP / Minggu` : '—'}`,
          `• Total Alokasi Pembelajaran Terdata: ${totalAllocatedJP} JP`,
          `• Keterangan Pelaksanaan: Alokasi terjadwal sesuai silabus KD semester aktif.`,
        ]
      : [
          `• Beban JP Intrakurikuler per Minggu: ${weeklyJP !== null ? `${weeklyJP} JP / Minggu` : '—'}`,
          `• Alokasi JP Semester: ${projection.availableJP !== null ? `${projection.availableJP} JP` : '—'}`,
          `• Total Alokasi Pembelajaran Terdata: ${totalAllocatedJP} JP`,
          `• Selisih Alokasi JP: ${projection.remainingJP !== null ? `${projection.remainingJP} JP` : '—'} (${statusDesc})`,
        ];

    docChildren.push(
      createSectionHeading('B. Ringkasan Alokasi Waktu Pembelajaran Semester', 1),
      createProseParagraph(summaryLines.join('\n'), { firstLineIndent: false }),
      new Paragraph({ spacing: { after: 240 } })
    );
  }

  // Signatures
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
  const safeSubject = (academicSetting.subject || 'Mapel').replace(/[^a-zA-Z0-9]/g, '_');
  const safeGrade = (academicSetting.grade || 'Kelas').replace(/[^a-zA-Z0-9]/g, '_');
  const fileName = `Alokasi_Waktu_${safeSubject}_${safeGrade}.docx`;

  if (!context.skipDownload) {
    saveAs(blob, fileName);
  }

  return {
    success: true,
    type: 'ALOKASI_WAKTU',
    title: `Alokasi Waktu - ${academicSetting.subject} ${academicSetting.grade}`,
    fileName,
    blob,
    record: {
      id: `doc-alokasi-${Date.now()}`,
      type: 'ALOKASI_WAKTU',
      title: `Alokasi Waktu - ${academicSetting.subject} ${academicSetting.grade}`,
      status: 'completed',
      lastGenerated: new Date().toISOString(),
      fileName,
      academicSettingId: academicSetting.id,
      workspaceId: context.workspace?.id,
    },
  };
}
