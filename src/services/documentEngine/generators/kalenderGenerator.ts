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
  createDocxSectionProperties,
} from '../docxStyles';
import { getSubjectJP, resolveCalendarSubjectCapacity, calculateEffectiveDays } from '../../jpEngine';
import { resolveSemesterJPFromValues } from '../../semesterJPResolver';
import { calendarDayLabel } from '../calendarPresentation';

export async function generateKalenderAkademik(context: DocumentGenerationContext): Promise<GeneratedDocumentResult> {
  const { school, profile, academicSetting, calendar, calendarDays } = context;

  const docChildren: (Paragraph | Table)[] = [];

  // Look up official JP
  const officialRule = getSubjectJP({
    curriculum: academicSetting.curriculum,
    level: academicSetting.level,
    grade: academicSetting.grade,
    subject: academicSetting.subject,
    academicYear: academicSetting.academicYear,
  });

  const weeklyJP = resolveSemesterJPFromValues(context.semesterJPSetting, context.annualJPReference).weeklyJP ?? academicSetting.subjectWeeklyJP ?? calendar?.jpPerWeek ?? academicSetting.totalHoursPerWeek ?? officialRule.weeklyJP ?? null;

  // Header
  docChildren.push(...createDocumentHeader('KALENDER AKADEMIK & JADWAL PENDIDIKAN', academicSetting.curriculum));

  // Metadata Table
  docChildren.push(
    createIdentityMetadataTable(school, profile, academicSetting, [
      ['Rentang Waktu Semester', `: ${calendar?.startDate || '-'} s/d ${calendar?.endDate || '-'}`],
      ['Hari Sekolah / Minggu', `: ${calendar?.schoolDaysPerWeek ? `${calendar.schoolDaysPerWeek} Hari Kerja` : '-'}`],
      ['Beban Jam Pelajaran (JP)', `: ${weeklyJP !== null ? `${weeklyJP} JP / Minggu` : '-'}`],
    ])
  );
  docChildren.push(new Paragraph({ spacing: { after: 180 } }));

  // Section 1: Ringkasan Hari Efektif
  docChildren.push(
    createSectionHeading('A. Ringkasan Hari & Minggu Efektif Pembelajaran', 1)
  );

  const daysList = calendarDays || [];
  const effectiveSummary = calendar ? calculateEffectiveDays(calendar, daysList) : undefined;
  const holidayCount = effectiveSummary?.holidayDays || 0;
  const eventCount = effectiveSummary?.schoolEventDays || 0;

  let effectiveDaysCount = 0;
  let effectiveWeeksCount = 0;
  let availableJPCount: number | null = null;

  if (calendar?.startDate && calendar?.endDate && (calendar.schoolDaysPerWeek === 5 || calendar.schoolDaysPerWeek === 6)) {
    const eff = calculateEffectiveDays(calendar, daysList);
    effectiveDaysCount = eff.effectiveLearningDays;
    const avail = resolveCalendarSubjectCapacity({ semesterPlanId: academicSetting.id,
      calendar, calendarDays: daysList, weeklyJP, schedule: context.subjectWeeklySchedule });
    effectiveWeeksCount = avail.effectiveWeeksRounded ?? 0;
    availableJPCount = avail.availableJP;
  }

  const summaryTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          createTableHeaderCell('No', 10, AlignmentType.CENTER),
          createTableHeaderCell('Komponen Perhitungan', 60, AlignmentType.LEFT),
          createTableHeaderCell('Keterangan / Jumlah', 30, AlignmentType.CENTER),
        ],
      }),
      new TableRow({
        children: [
          createTableDataCell('1', 10, AlignmentType.CENTER),
          createTableDataCell('Tahun Ajaran / Semester Aktif', 60),
          createTableDataCell(`${calendar?.academicYear || academicSetting.academicYear || '-'} (Semester ${calendar?.semester || academicSetting.semester || '-'})`, 30, AlignmentType.CENTER),
        ],
      }),
      new TableRow({
        children: [
          createTableDataCell('2', 10, AlignmentType.CENTER),
          createTableDataCell('Hari Sekolah per Minggu', 60),
          createTableDataCell(`${calendar?.schoolDaysPerWeek ? `${calendar.schoolDaysPerWeek} Hari` : '-'}`, 30, AlignmentType.CENTER),
        ],
      }),
      new TableRow({
        children: [
          createTableDataCell('3', 10, AlignmentType.CENTER),
          createTableDataCell('Jumlah Hari Efektif Belajar (HE)', 60),
          createTableDataCell(`${effectiveDaysCount} Hari`, 30, AlignmentType.CENTER),
        ],
      }),
      new TableRow({
        children: [
          createTableDataCell('4', 10, AlignmentType.CENTER),
          createTableDataCell('Jumlah Minggu Efektif (ME)', 60),
          createTableDataCell(`${effectiveWeeksCount} Minggu`, 30, AlignmentType.CENTER),
        ],
      }),
      new TableRow({
        children: [
          createTableDataCell('5', 10, AlignmentType.CENTER),
          createTableDataCell('Total Alokasi Waktu Mata Pelajaran', 60),
          createTableDataCell(availableJPCount !== null ? `${availableJPCount} JP / Semester` : '-', 30, AlignmentType.CENTER),
        ],
      }),
      new TableRow({
        children: [
          createTableDataCell('6', 10, AlignmentType.CENTER),
          createTableDataCell('Jumlah Hari Libur Nasional & Khusus Tercatat', 60),
          createTableDataCell(`${holidayCount} Hari`, 30, AlignmentType.CENTER),
        ],
      }),
      new TableRow({
        children: [
          createTableDataCell('7', 10, AlignmentType.CENTER),
          createTableDataCell('Jumlah Agenda Kegiatan Sekolah / Asesmen', 60),
          createTableDataCell(`${eventCount} Kegiatan`, 30, AlignmentType.CENTER),
        ],
      }),
    ],
  });

  docChildren.push(summaryTable);
  docChildren.push(new Paragraph({ spacing: { after: 180 } }));

  // Section 2: Agenda Kegiatan Khusus & Libur
  docChildren.push(
    createSectionHeading('B. Matriks Agenda & Catatan Kalender Pendidikan', 1)
  );

  const eventRows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: [
        createTableHeaderCell('No', 8, AlignmentType.CENTER),
        createTableHeaderCell('Tanggal', 22, AlignmentType.CENTER),
        createTableHeaderCell('Status / Kategori', 22, AlignmentType.CENTER),
        createTableHeaderCell('Uraian Agenda / Keterangan Libur', 48, AlignmentType.LEFT),
      ],
    }),
  ];

  if (daysList.length === 0) {
    eventRows.push(
      new TableRow({
        children: [
          createTableDataCell('1', 8, AlignmentType.CENTER),
          createTableDataCell('-', 22, AlignmentType.CENTER),
          createTableDataCell('Hari Efektif Standar', 22, AlignmentType.CENTER),
          createTableDataCell('Belum ada tanggal libur khusus atau agenda khusus yang ditambahkan pada kalender satuan pendidikan.', 48),
        ],
      })
    );
  } else {
    daysList.forEach((d, idx) => {
      const typeLabel = calendarDayLabel(d.status);
      eventRows.push(
        new TableRow({
          children: [
            createTableDataCell((idx + 1).toString(), 8, AlignmentType.CENTER),
            createTableDataCell(d.date, 22, AlignmentType.CENTER),
            createTableDataCell(typeLabel, 22, AlignmentType.CENTER),
            createTableDataCell(d.notes || '-', 48),
          ],
        })
      );
    });
  }

  docChildren.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: eventRows }));
  docChildren.push(new Paragraph({ spacing: { after: 240 } }));

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
  const fileName = `Kalender_Pendidikan_${academicSetting.academicYear ? academicSetting.academicYear.replace('/', '_') : '2026_2027'}.docx`;

  if (!context.skipDownload) {
    saveAs(blob, fileName);
  }

  return {
    success: true,
    type: 'KALENDER_AKADEMIK',
    title: 'Kalender Pendidikan & Jadwal',
    fileName,
    blob,
    record: {
      id: `doc-kalender-${Date.now()}`,
      type: 'KALENDER_AKADEMIK',
      title: 'Kalender Pendidikan & Jadwal',
      status: 'completed',
      lastGenerated: new Date().toISOString(),
      fileName,
      academicSettingId: academicSetting.id,
      workspaceId: context.workspace?.id,
    },
  };
}
